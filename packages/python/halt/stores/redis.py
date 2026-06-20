"""Redis storage backend for Halt - production-grade, atomic rate limiting.

Provides both a synchronous store (``RedisStore``, wrapping ``redis.Redis``) and
an asynchronous one (``AsyncRedisStore``, wrapping ``redis.asyncio.Redis``). Both
implement the atomic-evaluation protocol: the full check-and-consume runs inside
Redis via a Lua script, so limits stay accurate under concurrent load. Works on
standalone Redis and Redis Cluster (every script touches a single key).

The Redis client is injected, so Halt has no hard dependency on a particular
connection setup::

    import redis
    from halt import RedisStore

    store = RedisStore(client=redis.Redis.from_url("redis://localhost:6379"))

    # async
    import redis.asyncio as aioredis
    from halt import AsyncRedisStore

    store = AsyncRedisStore(client=aioredis.Redis.from_url("redis://localhost:6379"))
"""

import time
from typing import Any, Callable, Optional

from halt.core.decision import Decision
from halt.core.policy import Algorithm
from halt.stores.redis_scripts import SCRIPTS

try:  # pragma: no cover - import guard
    from redis.exceptions import RedisError
except ImportError:  # pragma: no cover
    RedisError = Exception  # type: ignore


FailMode = str  # "open" | "closed"


def _require_redis() -> None:
    try:
        import redis  # noqa: F401
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "The Redis stores require the 'redis' package. "
            "Install it with: pip install halt-rate[redis]"
        ) from exc


def _algo_key(algorithm: Any) -> str:
    """Normalize an Algorithm enum (or its string value) to a SCRIPTS key."""
    return algorithm.value if isinstance(algorithm, Algorithm) else str(algorithm)


def _to_decision(raw: Any) -> Decision:
    """Map the Lua array [allowed, limit, remaining, reset_at, retry_after]."""
    if not isinstance(raw, (list, tuple)) or len(raw) < 4:
        raise ValueError(f"Unexpected Redis script result: {raw!r}")

    allowed = int(raw[0]) == 1
    limit = int(raw[1])
    remaining = int(raw[2])
    reset_at = int(raw[3])
    retry_after_raw = int(raw[4]) if len(raw) > 4 else -1

    retry_after = None
    if not allowed and retry_after_raw >= 0:
        retry_after = retry_after_raw

    return Decision(
        allowed=allowed,
        limit=limit,
        remaining=remaining,
        reset_at=reset_at,
        retry_after=retry_after,
    )


class _BaseRedisStore:
    """Shared config + fail-open/closed handling for the Redis stores."""

    def __init__(
        self,
        client: Any,
        fail_mode: FailMode = "open",
        on_error: Optional[Callable[[Exception], None]] = None,
        metrics_recorder: Optional[Callable[..., None]] = None,
    ) -> None:
        _require_redis()
        if fail_mode not in ("open", "closed"):
            raise ValueError("fail_mode must be 'open' or 'closed'")
        self.client = client
        self.fail_mode = fail_mode
        self.on_error = on_error
        self.metrics_recorder = metrics_recorder
        # register_script handles EVALSHA with automatic EVAL fallback.
        self._scripts = {name: client.register_script(lua) for name, lua in SCRIPTS.items()}

    def _args(self, limit: int, window: int, burst: int, cost: int, ttl: int) -> list:
        return [limit, window, burst, cost, ttl]

    def _record(self, name: str, algorithm: Any, allowed: Optional[bool] = None) -> None:
        if not self.metrics_recorder:
            return
        tags = {"algorithm": _algo_key(algorithm)}
        if allowed is not None:
            tags["allowed"] = str(allowed)
        self.metrics_recorder(name, tags, 1)

    def _fail_decision(self, limit: int, window: int, algorithm: Any) -> Decision:
        reset_at = int(time.time() + window)
        if self.fail_mode == "open":
            self._record("halt.request.fail_open", algorithm)
            return Decision(allowed=True, limit=limit, remaining=limit, reset_at=reset_at)
        self._record("halt.request.fail_closed", algorithm)
        return Decision(
            allowed=False,
            limit=limit,
            remaining=0,
            reset_at=reset_at,
            retry_after=window,
        )


class RedisStore(_BaseRedisStore):
    """Synchronous Redis store (wraps ``redis.Redis``)."""

    def evaluate(
        self,
        *,
        key: str,
        algorithm: Any,
        limit: int,
        window: int,
        burst: int,
        cost: int,
        ttl: int,
    ) -> Decision:
        script = self._scripts.get(_algo_key(algorithm))
        if script is None:
            raise NotImplementedError(f"Algorithm {algorithm} not supported by RedisStore")

        try:
            raw = script(keys=[key], args=self._args(limit, window, burst, cost, ttl))
            decision = _to_decision(raw)
            self._record("halt.request.checked", algorithm, decision.allowed)
            return decision
        except RedisError as exc:
            if self.on_error:
                self.on_error(exc)
            self._record("halt.redis.error", algorithm)
            return self._fail_decision(limit, window, algorithm)


class AsyncRedisStore(_BaseRedisStore):
    """Asynchronous Redis store (wraps ``redis.asyncio.Redis``)."""

    async def aevaluate(
        self,
        *,
        key: str,
        algorithm: Any,
        limit: int,
        window: int,
        burst: int,
        cost: int,
        ttl: int,
    ) -> Decision:
        script = self._scripts.get(_algo_key(algorithm))
        if script is None:
            raise NotImplementedError(f"Algorithm {algorithm} not supported by AsyncRedisStore")

        try:
            raw = await script(keys=[key], args=self._args(limit, window, burst, cost, ttl))
            decision = _to_decision(raw)
            self._record("halt.request.checked", algorithm, decision.allowed)
            return decision
        except RedisError as exc:
            if self.on_error:
                self.on_error(exc)
            self._record("halt.redis.error", algorithm)
            return self._fail_decision(limit, window, algorithm)
