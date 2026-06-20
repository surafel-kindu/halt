"""Storage backends for Halt rate limiting."""

from halt.stores.memory import InMemoryStore

__all__ = ["InMemoryStore"]

# Redis stores require the optional 'redis' dependency.
try:
    from halt.stores.redis import RedisStore, AsyncRedisStore

    __all__ += ["RedisStore", "AsyncRedisStore"]
except ImportError:  # pragma: no cover
    pass
