"""Main rate limiter implementation."""

import inspect
import time
from typing import Any, Callable, Optional, Tuple, Union
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
        policy: "Union[Policy, Callable[[Any], Policy]]",
        trusted_proxies: Optional[list] = None,
        exempt_private_ips: bool = True,
        otel_tracer: Optional[Any] = None,
        metrics_recorder: Optional[Callable] = None,
        telemetry: Optional[Any] = None,
    ) -> None:
        """Initialize rate limiter.

        Args:
            store: Storage backend. A simple store (InMemoryStore — the limiter
                runs the algorithm in-process) or an atomic store (RedisStore /
                AsyncRedisStore — the store computes the decision via Lua).
            policy: A static Policy or a resolver callable returning a Policy
                per request (for per-user / per-plan limits).
            trusted_proxies: Trusted proxy IPs/networks for X-Forwarded-For.
            exempt_private_ips: Whether to exempt private IPs from rate limiting.
            otel_tracer: Optional OpenTelemetry-like tracer (has ``start_span``).
            metrics_recorder: Optional ``(name, tags, value)`` metrics hook.
            telemetry: Optional high-level observability hooks (StatsCollector,
                OpenTelemetryMetrics, LoggingTelemetry, or a CompositeTelemetry).
        """
        self.store = store
        self.policy_or_resolver = policy
        self.trusted_proxies = trusted_proxies or []
        self.exempt_private_ips = exempt_private_ips
        self.otel_tracer = otel_tracer
        self.metrics_recorder = metrics_recorder
        self.telemetry = telemetry
        # Algorithm instances are built lazily per resolved policy and cached
        # (only used for the in-process path; atomic stores run Lua instead).
        self._algorithm_cache: dict = {}

    def _emit_telemetry(
        self, request: Any, key: str, decision: Decision, policy: Policy, cost: int
    ) -> None:
        """Fan a finished decision out to the telemetry hooks with rich metadata."""
        if not self.telemetry:
            return
        algorithm = policy.algorithm
        metadata = {
            "policy": policy.name,
            "algorithm": algorithm.value if hasattr(algorithm, "value") else algorithm,
            "key_strategy": getattr(policy.key_strategy, "value", policy.key_strategy),
            "endpoint": self._get_path(request),
            "cost": cost,
            "plan": policy.plan,
        }
        self.telemetry.on_check(key, decision, metadata)
        if decision.allowed:
            self.telemetry.on_allowed(key, decision, metadata)
        else:
            self.telemetry.on_blocked(key, decision, metadata)

    # ----- algorithm construction (in-process path) -----------------------

    def _get_algorithm(self, policy: Policy) -> Any:
        """Build (and cache) the algorithm instance for a resolved policy.

        Cached by the parameters that affect behavior, so a resolver returning
        different limits under the same policy name stays correct.
        """
        cache_key = (
            policy.name,
            policy.algorithm,
            policy.limit,
            policy.window,
            policy.burst,
            policy.sliding_precision,
        )
        algorithm = self._algorithm_cache.get(cache_key)
        if algorithm is not None:
            return algorithm

        if policy.algorithm == Algorithm.TOKEN_BUCKET:
            algorithm = TokenBucket(
                capacity=policy.burst or policy.limit,
                rate=policy.limit,
                window=policy.window,
            )
        elif policy.algorithm == Algorithm.FIXED_WINDOW:
            algorithm = FixedWindow(limit=policy.limit, window=policy.window)
        elif policy.algorithm == Algorithm.SLIDING_WINDOW:
            algorithm = SlidingWindow(
                limit=policy.limit,
                window=policy.window,
                precision=policy.sliding_precision,
            )
        elif policy.algorithm == Algorithm.LEAKY_BUCKET:
            leak_rate = policy.limit / policy.window
            algorithm = LeakyBucket(
                capacity=policy.burst or policy.limit,
                leak_rate=leak_rate,
                window=policy.window,
            )
        else:
            raise NotImplementedError(f"Algorithm {policy.algorithm} not implemented")

        self._algorithm_cache[cache_key] = algorithm
        return algorithm

    # ----- shared request preparation -------------------------------------

    def _allow_all(self, policy: Policy) -> Decision:
        return Decision(
            allowed=True,
            limit=policy.limit,
            remaining=policy.limit,
            reset_at=int(time.time() + policy.window),
        )

    def _resolve_policy(self, request: Any) -> Any:
        """Resolve the policy (may return a coroutine for async resolvers)."""
        if callable(self.policy_or_resolver):
            return self.policy_or_resolver(request)
        return self.policy_or_resolver

    def _prepare(
        self, request: Any, policy: Policy, cost: Optional[int]
    ) -> Tuple[Optional[Decision], Optional[Policy], Optional[str], Optional[str], int]:
        """Apply exemptions and extract the storage key for an already-resolved policy.

        Returns ``(early_decision, policy, storage_key, raw_key, cost)``. When
        ``early_decision`` is set the caller should return it directly.
        """
        if cost is None:
            cost = policy.cost

        if self._is_exempt(request, policy):
            return self._allow_all(policy), policy, None, None, cost

        key = self._extract_key(request, policy)
        if key is None:
            return self._allow_all(policy), policy, None, None, cost

        storage_key = f"halt:{policy.name}:{key}"
        return None, policy, storage_key, key, cost

    def _evaluate_args(self, policy: Policy, storage_key: str, cost: int) -> dict:
        return dict(
            key=storage_key,
            algorithm=policy.algorithm,
            limit=policy.limit,
            window=policy.window,
            burst=policy.burst or policy.limit,
            cost=cost,
            ttl=policy.window * 2,
        )

    # ----- public API -----------------------------------------------------

    def check(self, request: Any, cost: Optional[int] = None) -> Decision:
        """Check if a request is allowed under the rate limit (synchronous).

        Delegates to an atomic store's ``evaluate`` when available, otherwise
        runs the algorithm in-process against the simple store.
        """
        policy = self._resolve_policy(request)
        if inspect.iscoroutine(policy):
            policy.close()
            raise RuntimeError(
                "Async policy resolver requires acheck(): use `await limiter.acheck(request)`"
            )
        early, policy, storage_key, raw_key, cost = self._prepare(request, policy, cost)
        if early is not None:
            return early

        if hasattr(self.store, "evaluate"):
            decision = self.store.evaluate(**self._evaluate_args(policy, storage_key, cost))
        else:
            decision = self._compute_in_app(policy, storage_key, cost)

        self._emit_telemetry(request, raw_key, decision, policy, cost)
        return decision

    async def acheck(self, request: Any, cost: Optional[int] = None) -> Decision:
        """Async variant of :meth:`check` for async stores / frameworks.

        Uses an atomic store's ``aevaluate`` when available, falls back to a
        synchronous ``evaluate``, and finally to the in-process path. Supports
        async policy resolvers (e.g. a cached loader reading Redis/DB).
        """
        policy = self._resolve_policy(request)
        if inspect.iscoroutine(policy):
            policy = await policy
        early, policy, storage_key, raw_key, cost = self._prepare(request, policy, cost)
        if early is not None:
            return early

        if hasattr(self.store, "aevaluate"):
            decision = await self.store.aevaluate(**self._evaluate_args(policy, storage_key, cost))
        elif hasattr(self.store, "evaluate"):
            decision = self.store.evaluate(**self._evaluate_args(policy, storage_key, cost))
        else:
            decision = self._compute_in_app(policy, storage_key, cost)

        self._emit_telemetry(request, raw_key, decision, policy, cost)
        return decision

    # ----- in-process algorithm path --------------------------------------

    def _compute_in_app(self, policy: Policy, storage_key: str, cost: int) -> Decision:
        """Run the algorithm in-process using the simple (KV) store."""
        algorithm = self._get_algorithm(policy)
        state = self.store.get(storage_key)
        ttl = policy.window * 2

        if isinstance(algorithm, TokenBucket):
            if state is None:
                tokens, last_refill = algorithm.initial_state()
            else:
                tokens, last_refill = state
            decision, new_tokens, new_last_refill = algorithm.check_and_consume(
                current_tokens=tokens, last_refill=last_refill, cost=cost
            )
            self.store.set(storage_key, (new_tokens, new_last_refill), ttl=ttl)

        elif isinstance(algorithm, FixedWindow):
            if state is None:
                count, window_start = algorithm.initial_state()
            else:
                count, window_start = state
            decision, new_count, new_window_start = algorithm.check_and_consume(
                current_count=count, window_start=window_start, cost=cost
            )
            self.store.set(storage_key, (new_count, new_window_start), ttl=ttl)

        elif isinstance(algorithm, SlidingWindow):
            buckets = state if state is not None else algorithm.initial_state()
            decision, new_buckets = algorithm.check_and_consume(buckets=buckets, cost=cost)
            self.store.set(storage_key, new_buckets, ttl=ttl)

        elif isinstance(algorithm, LeakyBucket):
            if state is None:
                level, last_leak = algorithm.initial_state()
            else:
                level, last_leak = state
            decision, new_level, new_last_leak = algorithm.check_and_consume(
                current_level=level, last_leak=last_leak, cost=cost
            )
            self.store.set(storage_key, (new_level, new_last_leak), ttl=ttl)

        else:
            raise NotImplementedError(f"Algorithm {type(algorithm)} not supported")

        return decision

    # ----- key extraction & exemptions ------------------------------------

    def _extract_key(self, request: Any, policy: Policy) -> Optional[str]:
        """Extract the rate limit key from a request based on policy strategy."""
        if policy.key_extractor:
            return policy.key_extractor(request)

        if policy.key_strategy == KeyStrategy.IP:
            return extract_ip(request, self.trusted_proxies)

        elif policy.key_strategy == KeyStrategy.USER:
            return extract_user_id(request)

        elif policy.key_strategy == KeyStrategy.API_KEY:
            return extract_api_key(request)

        elif policy.key_strategy == KeyStrategy.COMPOSITE:
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

    def _is_exempt(self, request: Any, policy: Policy) -> bool:
        """Check if a request is exempt from rate limiting."""
        path = self._get_path(request)
        if path and is_health_check(path):
            return True

        if path and path in policy.exemptions:
            return True

        if self.exempt_private_ips:
            ip = extract_ip(request, self.trusted_proxies)
            if ip and is_private_ip(ip):
                return True

        ip = extract_ip(request, self.trusted_proxies)
        if ip and ip in policy.exemptions:
            return True

        return False

    def _get_path(self, request: Any) -> Optional[str]:
        """Extract the request path (framework-agnostic)."""
        if hasattr(request, "url") and hasattr(request.url, "path"):
            # FastAPI/Starlette
            return request.url.path
        elif hasattr(request, "path"):
            # Flask/Django
            return request.path

        return None
