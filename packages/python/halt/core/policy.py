"""Policy model for rate limiting configuration."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Callable, Any


class KeyStrategy(str, Enum):
    """Strategy for extracting rate limit keys from requests."""
    
    IP = "ip"
    USER = "user"
    API_KEY = "api_key"
    COMPOSITE = "composite"
    CUSTOM = "custom"


class Algorithm(str, Enum):
    """Rate limiting algorithm."""
    
    TOKEN_BUCKET = "token_bucket"
    FIXED_WINDOW = "fixed_window"
    SLIDING_WINDOW = "sliding_window"
    LEAKY_BUCKET = "leaky_bucket"


@dataclass
class Policy:
    """Rate limiting policy configuration.
    
    Attributes:
        name: Human-readable policy name
        limit: Maximum number of requests allowed
        window: Time window in seconds
        algorithm: Rate limiting algorithm to use
        key_strategy: Strategy for extracting the rate limit key
        burst: Maximum burst size (for token bucket)
        sliding_precision: Number of sub-windows for sliding window
        cost: Cost per request (default: 1)
        block_duration: Duration to block after limit exceeded (seconds)
        key_extractor: Custom function to extract key from request
        exemptions: List of paths or IPs to exempt from rate limiting
    """
    
    name: str
    limit: int
    window: int
    algorithm: Algorithm = Algorithm.TOKEN_BUCKET
    key_strategy: KeyStrategy = KeyStrategy.IP
    burst: Optional[int] = None
    sliding_precision: int = 10
    cost: int = 1
    block_duration: Optional[int] = None
    key_extractor: Optional[Callable[[Any], Optional[str]]] = None
    exemptions: list[str] = field(default_factory=list)
    plan: Optional[str] = None

    def __post_init__(self) -> None:
        """Validate and set defaults."""
        if self.burst is None:
            # Default burst is 20% more than limit
            self.burst = int(self.limit * 1.2)
        
        if self.limit <= 0:
            raise ValueError("limit must be positive")
        
        if self.window <= 0:
            raise ValueError("window must be positive")
        
        if self.cost <= 0:
            raise ValueError("cost must be positive")

        if self.sliding_precision <= 0:
            raise ValueError("sliding_precision must be positive")
        
        if self.burst < self.limit:
            raise ValueError("burst must be >= limit")
