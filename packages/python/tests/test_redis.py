"""Tests for the Redis stores.

Unit tests (decision mapping, fail-open/closed) use a stub client and always
run. The atomicity / real-script tests require a reachable Redis and are skipped
unless the REDIS_URL environment variable is set (Lua can't run under fakeredis
without lupa).
"""

import asyncio
import os

import pytest

from halt import Algorithm
from halt.stores.redis import RedisStore, AsyncRedisStore

try:
    from redis.exceptions import RedisError
except ImportError:  # pragma: no cover
    RedisError = Exception


# --------------------------------------------------------------------------- #
# Unit tests with a stub client (no real Redis / Lua needed)
# --------------------------------------------------------------------------- #

class _StubScript:
    def __init__(self, behavior):
        self._behavior = behavior

    def __call__(self, keys=None, args=None):
        return self._behavior()


class _StubClient:
    """Stands in for redis.Redis; register_script returns a programmable script."""

    def __init__(self, behavior):
        self._behavior = behavior

    def register_script(self, lua):
        return _StubScript(self._behavior)


def _args(**over):
    base = dict(
        key="halt:p:1.2.3.4",
        algorithm=Algorithm.FIXED_WINDOW,
        limit=10,
        window=60,
        burst=12,
        cost=1,
        ttl=120,
    )
    base.update(over)
    return base


def test_maps_allowed_decision():
    client = _StubClient(lambda: [1, 10, 7, 1781000000, -1])
    store = RedisStore(client=client)
    d = store.evaluate(**_args())
    assert d.allowed is True
    assert d.limit == 10
    assert d.remaining == 7
    assert d.reset_at == 1781000000
    assert d.retry_after is None


def test_maps_blocked_decision_with_retry_after():
    client = _StubClient(lambda: [0, 10, 0, 1781000000, 5])
    store = RedisStore(client=client)
    d = store.evaluate(**_args())
    assert d.allowed is False
    assert d.remaining == 0
    assert d.retry_after == 5


def _raise():
    raise RedisError("connection refused")


def test_fail_open_allows_on_error():
    store = RedisStore(client=_StubClient(_raise), fail_mode="open")
    d = store.evaluate(**_args())
    assert d.allowed is True
    assert d.limit == 10
    assert d.remaining == 10


def test_fail_closed_blocks_on_error():
    store = RedisStore(client=_StubClient(_raise), fail_mode="closed")
    d = store.evaluate(**_args())
    assert d.allowed is False
    assert d.remaining == 0
    assert d.retry_after == 60  # window


def test_on_error_and_metrics_hooks_fire():
    errors = []
    metrics = []
    store = RedisStore(
        client=_StubClient(_raise),
        fail_mode="open",
        on_error=errors.append,
        metrics_recorder=lambda *a: metrics.append(a[0]),
    )
    store.evaluate(**_args())
    assert len(errors) == 1
    assert "halt.redis.error" in metrics
    assert "halt.request.fail_open" in metrics


def test_invalid_fail_mode_rejected():
    with pytest.raises(ValueError):
        RedisStore(client=_StubClient(lambda: []), fail_mode="nope")


# --------------------------------------------------------------------------- #
# Integration tests against a real Redis (atomic Lua). Opt-in via REDIS_URL.
# --------------------------------------------------------------------------- #

REDIS_URL = os.environ.get("REDIS_URL")


def _real_sync_client():
    import redis

    client = redis.Redis.from_url(REDIS_URL)
    client.ping()
    return client


@pytest.mark.skipif(not REDIS_URL, reason="REDIS_URL not set")
def test_fixed_window_sequential_real():
    import uuid

    client = _real_sync_client()
    store = RedisStore(client=client)
    key = f"halt:test:{uuid.uuid4()}"

    allowed = 0
    for _ in range(15):
        d = store.evaluate(
            key=key, algorithm=Algorithm.FIXED_WINDOW,
            limit=10, window=60, burst=10, cost=1, ttl=120,
        )
        if d.allowed:
            allowed += 1
    assert allowed == 10  # exactly the limit
    client.delete(key)


@pytest.mark.skipif(not REDIS_URL, reason="REDIS_URL not set")
def test_fixed_window_atomic_under_concurrency_real():
    """Fire many concurrent checks; Lua atomicity => exactly `limit` allowed."""
    import uuid
    from concurrent.futures import ThreadPoolExecutor

    import redis

    key = f"halt:test:{uuid.uuid4()}"

    def one():
        # Each thread uses its own connection to a shared Redis.
        client = redis.Redis.from_url(REDIS_URL)
        store = RedisStore(client=client)
        d = store.evaluate(
            key=key, algorithm=Algorithm.FIXED_WINDOW,
            limit=50, window=60, burst=50, cost=1, ttl=120,
        )
        return d.allowed

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(lambda _: one(), range(200)))

    assert sum(1 for r in results if r) == 50
    redis.Redis.from_url(REDIS_URL).delete(key)


@pytest.mark.skipif(not REDIS_URL, reason="REDIS_URL not set")
def test_sliding_window_real():
    import uuid

    client = _real_sync_client()
    store = RedisStore(client=client)
    key = f"halt:test:{uuid.uuid4()}"

    allowed = sum(
        store.evaluate(
            key=key, algorithm=Algorithm.SLIDING_WINDOW,
            limit=5, window=60, burst=5, cost=1, ttl=120,
        ).allowed
        for _ in range(8)
    )
    assert allowed == 5
    client.delete(key)


@pytest.mark.skipif(not REDIS_URL, reason="REDIS_URL not set")
def test_async_store_real():
    """AsyncRedisStore end-to-end (run via asyncio.run to avoid plugin dependency)."""
    import uuid

    import redis.asyncio as aioredis

    async def run():
        client = aioredis.Redis.from_url(REDIS_URL)
        store = AsyncRedisStore(client=client)
        key = f"halt:test:{uuid.uuid4()}"
        allowed = 0
        for _ in range(8):
            d = await store.aevaluate(
                key=key, algorithm=Algorithm.FIXED_WINDOW,
                limit=5, window=60, burst=5, cost=1, ttl=120,
            )
            allowed += int(d.allowed)
        await client.delete(key)
        await client.aclose()
        return allowed

    assert asyncio.run(run()) == 5
