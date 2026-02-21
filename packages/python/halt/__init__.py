"""Halt - Rate limiting middleware with safe defaults and Redis-backed accuracy."""

__version__ = "0.1.1"

from halt.core.limiter import RateLimiter
from halt.core.policy import Policy, KeyStrategy, Algorithm
from halt.core.decision import Decision
from halt.stores.memory import InMemoryStore
from halt import presets

__all__ = [
    "RateLimiter",
    "Policy",
    "KeyStrategy",
    "Algorithm",
    "Decision",
    "InMemoryStore",
    "presets",
]

try:
    from halt.stores.redis import RedisStore
    __all__.append("RedisStore")
except ImportError:
    pass
