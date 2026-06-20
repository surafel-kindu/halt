"""Token bucket rate limiting algorithm."""

import time
from typing import Optional
from halt.core.decision import Decision


class TokenBucket:
    """Token bucket algorithm for rate limiting.
    
    The token bucket algorithm maintains a bucket of tokens that refills at a constant rate.
    Each request consumes tokens. If there aren't enough tokens, the request is denied.
    
    This algorithm naturally handles burst traffic while maintaining average rate limits.
    """
    
    def __init__(self, capacity: int, rate: float, window: int) -> None:
        """Initialize token bucket.
        
        Args:
            capacity: Maximum number of tokens (burst size)
            rate: Number of requests allowed per window
            window: Time window in seconds
        """
        self.capacity = capacity
        self.rate = rate / window  # tokens per second
        self.window = window
    
    def check_and_consume(
        self,
        current_tokens: float,
        last_refill: float,
        cost: int,
        now: Optional[float] = None,
    ) -> tuple[Decision, float, float]:
        """Check if request is allowed and consume tokens.
        
        Args:
            current_tokens: Current token count
            last_refill: Last refill timestamp
            cost: Number of tokens to consume
            now: Current timestamp (defaults to time.time())
        
        Returns:
            Tuple of (Decision, new_tokens, new_last_refill)
        """
        if now is None:
            now = time.time()
        
        # Refill tokens based on elapsed time
        elapsed = now - last_refill
        refill_amount = elapsed * self.rate
        new_tokens = min(self.capacity, current_tokens + refill_amount)
        
        # Calculate reset time (when bucket will be full)
        tokens_needed = self.capacity - new_tokens
        reset_at = int(now + (tokens_needed / self.rate))
        
        # Check if we have enough tokens
        if new_tokens >= cost:
            # Consume tokens
            new_tokens -= cost
            remaining = int(new_tokens)
            
            return (
                Decision(
                    allowed=True,
                    limit=int(self.rate * self.window),
                    remaining=remaining,
                    reset_at=reset_at,
                ),
                new_tokens,
                now,
            )
        else:
            # Not enough tokens
            tokens_deficit = cost - new_tokens
            retry_after = int(tokens_deficit / self.rate) + 1
            
            return (
                Decision(
                    allowed=False,
                    limit=int(self.rate * self.window),
                    remaining=0,
                    reset_at=reset_at,
                    retry_after=retry_after,
                ),
                new_tokens,
                last_refill,  # Don't update last_refill on rejection
            )
    
    def initial_state(self, now: Optional[float] = None) -> tuple[float, float]:
        """Get initial state for a new key.
        
        Args:
            now: Current timestamp (defaults to time.time())
        
        Returns:
            Tuple of (tokens, last_refill)
        """
        if now is None:
            now = time.time()
        return (float(self.capacity), now)
