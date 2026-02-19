"""Main rate limiter implementation."""

import time
from typing import Any, Optional, Union
from halt.core.policy import Policy, KeyStrategy, Algorithm
from halt.core.decision import Decision
from halt.core.extractors import (
    extract_ip,
    extract_user_id,
    extract_api_key,
    is_health_check,
    is_private_ip,
)
from halt.algorithms.token_bucket import TokenBucket
from halt.algorithms.fixed_window import FixedWindow
from halt.algorithms.sliding_window import SlidingWindow
from halt.algorithms.leaky_bucket import LeakyBucket


class RateLimiter:
    """Main rate limiter class that orchestrates policy, storage, and algorithms."""
    
    def __init__(
        self,
        store: Any,
        policy: "Policy | Callable[[Any], Policy]",
        trusted_proxies: Optional[list[str]] = None,
        exempt_private_ips: bool = True,
        otel_tracer: Optional[Any] = None,
        metrics_recorder: Optional[callable] = None,
    ) -> None:
        """Initialize rate limiter.
        
        Args:
            store: Storage backend (InMemoryStore or RedisStore)
            policy: Rate limiting policy
            trusted_proxies: List of trusted proxy IPs/networks for X-Forwarded-For
            exempt_private_ips: Whether to exempt private IPs from rate limiting
        """
        self.store = store
        self.policy_or_resolver = policy
        self.trusted_proxies = trusted_proxies or []
        self.exempt_private_ips = exempt_private_ips
        self.otel_tracer = otel_tracer
        self.metrics_recorder = metrics_recorder
        
        # Initialize algorithm based on policy
        if policy.algorithm == Algorithm.TOKEN_BUCKET:
            self.algorithm = TokenBucket(
                capacity=policy.burst or policy.limit,
                rate=policy.limit,
                window=policy.window,
            )
        elif policy.algorithm == Algorithm.FIXED_WINDOW:
            self.algorithm = FixedWindow(
                limit=policy.limit,
                window=policy.window,
            )
        elif policy.algorithm == Algorithm.SLIDING_WINDOW:
            self.algorithm = SlidingWindow(
                limit=policy.limit,
                window=policy.window,
            )
        elif policy.algorithm == Algorithm.LEAKY_BUCKET:
            # Leaky bucket: leak_rate = limit / window (requests per second)
            leak_rate = policy.limit / policy.window
            self.algorithm = LeakyBucket(
                capacity=policy.burst or policy.limit,
                leak_rate=leak_rate,
                window=policy.window,
            )
        else:
            raise NotImplementedError(f"Algorithm {policy.algorithm} not implemented")
    
    def check(
        self,
        request: Any,
        cost: Optional[int] = None,
        algorithm: Optional[Algorithm] = None,
    ) -> Decision:
        """Check if request is allowed under rate limit.
        
        Args:
            request: Request object (framework-specific)
            cost: Cost of this request (defaults to policy.cost)
            algorithm: Override algorithm for this request (optional)
        
        Returns:
            Decision object with rate limit information
        """
        if cost is None:
            # resolve policy cost if needed
            cost = None
        
        # Resolve policy (supports static or callable resolver)
        if callable(self.policy_or_resolver):
            resolved_policy = self.policy_or_resolver(request)
        else:
            resolved_policy = self.policy_or_resolver

        self.policy = resolved_policy

        if cost is None:
            cost = self.policy.cost

        # Check exemptions
        if self._is_exempt(request):
            return Decision(
                allowed=True,
                limit=self.policy.limit,
                remaining=self.policy.limit,
                reset_at=int(time.time() + self.policy.window),
            )
        
        # Extract rate limit key
        key = self._extract_key(request)
        if key is None:
            # If we can't extract a key, allow the request
            return Decision(
                allowed=True,
                limit=self.policy.limit,
                remaining=self.policy.limit,
                reset_at=int(time.time() + self.policy.window),
            )
        
        # Add policy name prefix to key
        storage_key = f"halt:{self.policy.name}:{key}"
        
        # Get current state from storage
        state = self.store.get(storage_key)
        
        # Handle different algorithms
        if isinstance(self.algorithm, TokenBucket):
            if state is None:
                tokens, last_refill = self.algorithm.initial_state()
            else:
                tokens, last_refill = state
            
            decision, new_tokens, new_last_refill = self.algorithm.check_and_consume(
                current_tokens=tokens,
                last_refill=last_refill,
                cost=cost,
            )
            
            # Update storage
            ttl = self.policy.window * 2
            self.store.set(storage_key, (new_tokens, new_last_refill), ttl=ttl)
        
        elif isinstance(self.algorithm, FixedWindow):
            if state is None:
                count, window_start = self.algorithm.initial_state()
            else:
                count, window_start = state
            
            decision, new_count, new_window_start = self.algorithm.check_and_consume(
                current_count=count,
                window_start=window_start,
                cost=cost,
            )
            
            # Update storage
            ttl = self.policy.window * 2
            self.store.set(storage_key, (new_count, new_window_start), ttl=ttl)
        
        elif isinstance(self.algorithm, SlidingWindow):
            buckets = state if state is not None else self.algorithm.initial_state()
            
            decision, new_buckets = self.algorithm.check_and_consume(
                buckets=buckets,
                cost=cost,
            )
            
            # Update storage
            ttl = self.policy.window * 2
            self.store.set(storage_key, new_buckets, ttl=ttl)
        
        elif isinstance(self.algorithm, LeakyBucket):
            if state is None:
                level, last_leak = self.algorithm.initial_state()
            else:
                level, last_leak = state
            
            decision, new_level, new_last_leak = self.algorithm.check_and_consume(
                current_level=level,
                last_leak=last_leak,
                cost=cost,
            )
            
            # Update storage
            ttl = self.policy.window * 2
            self.store.set(storage_key, (new_level, new_last_leak), ttl=ttl)
        
        else:
            raise NotImplementedError(f"Algorithm {type(self.algorithm)} not supported")
        
        return decision
    
    def _extract_key(self, request: Any) -> Optional[str]:
        """Extract rate limit key from request based on policy strategy.
        
        Args:
            request: Request object
        
        Returns:
            Rate limit key or None
        """
        # Use custom extractor if provided
        if self.policy.key_extractor:
            return self.policy.key_extractor(request)
        
        # Use built-in strategies
        if self.policy.key_strategy == KeyStrategy.IP:
            return extract_ip(request, self.trusted_proxies)
        
        elif self.policy.key_strategy == KeyStrategy.USER:
            return extract_user_id(request)
        
        elif self.policy.key_strategy == KeyStrategy.API_KEY:
            return extract_api_key(request)
        
        elif self.policy.key_strategy == KeyStrategy.COMPOSITE:
            # Composite: user:ip or api_key:ip
            user = extract_user_id(request)
            api_key = extract_api_key(request)
            ip = extract_ip(request, self.trusted_proxies)
            
            if user and ip:
                return f"{user}:{ip}"
            elif api_key and ip:
                return f"{api_key}:{ip}"
            elif user:
                return user
            elif api_key:
                return api_key
            else:
                return ip
        
        return None
    
    def _is_exempt(self, request: Any) -> bool:
        """Check if request is exempt from rate limiting.
        
        Args:
            request: Request object
        
        Returns:
            True if exempt, False otherwise
        """
        # Check health check paths
        path = self._get_path(request)
        if path and is_health_check(path):
            return True
        
        # Check custom exemptions
        if path and path in self.policy.exemptions:
            return True
        
        # Check private IPs
        if self.exempt_private_ips:
            ip = extract_ip(request, self.trusted_proxies)
            if ip and is_private_ip(ip):
                return True
        
        # Check IP exemptions
        ip = extract_ip(request, self.trusted_proxies)
        if ip and ip in self.policy.exemptions:
            return True
        
        return False
    
    def _get_path(self, request: Any) -> Optional[str]:
        """Extract path from request object.
        
        Args:
            request: Request object
        
        Returns:
            Request path or None
        """
        # Try different framework patterns
        if hasattr(request, "url") and hasattr(request.url, "path"):
            # FastAPI/Starlette
            return request.url.path
        elif hasattr(request, "path"):
            # Flask/Django
            return request.path
        
        return None
