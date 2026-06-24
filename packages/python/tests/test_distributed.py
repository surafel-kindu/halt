"""Distributed correctness tests against a real Redis (atomic Lua).

Opt-in via REDIS_URL (skipped otherwise). Exercises concurrency, multi-process
workers, races, sliding-window boundaries, and window reset.
"""

import os
import time
import uuid

import pytest

REDIS_URL = os.environ.get("REDIS_URL")
pytestmark = pytest.mark.skipif(not REDIS_URL, reason="REDIS_URL not set")

from halt.core.policy import Algorithm  # noqa: E402
from halt.stores.redis import RedisStore  # noqa: E402


def _client():
    import redis

    return redis.Redis.from_url(REDIS_URL)


def _fresh_key():
    return f"halt:dist:{uuid.uuid4()}"


def _eval_once(args):
    """Module-level worker (picklable for ProcessPoolExecutor / spawn)."""
    key, algorithm, limit = args
    import redis

    from halt.stores.redis import RedisStore

    store = RedisStore(client=redis.Redis.from_url(os.environ["REDIS_URL"]))
    decision = store.evaluate(
        key=key, algorithm=algorithm, limit=limit, window=60, burst=limit, cost=1, ttl=120
    )
    return decision.allowed


ALGORITHMS = [
    Algorithm.FIXED_WINDOW,
    Algorithm.SLIDING_WINDOW,
    Algorithm.TOKEN_BUCKET,
    Algorithm.LEAKY_BUCKET,
]


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_concurrent_threads_exactly_limit(algorithm):
    """100+ concurrent threads (separate connections) => exactly `limit` allowed."""
    from concurrent.futures import ThreadPoolExecutor

    key = _fresh_key()

    def one(_):
        store = RedisStore(client=_client())
        d = store.evaluate(
            key=key, algorithm=algorithm, limit=50, window=60, burst=50, cost=1, ttl=120
        )
        return d.allowed

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(one, range(200)))

    assert sum(1 for r in results if r) == 50
    _client().delete(key)


def test_multiprocess_workers_share_one_limit():
    """Real OS processes sharing one Redis => exactly `limit` allowed."""
    from concurrent.futures import ProcessPoolExecutor

    key = _fresh_key()
    args = [(key, Algorithm.FIXED_WINDOW, 50)] * 200

    with ProcessPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_eval_once, args))

    assert sum(1 for r in results if r) == 50
    _client().delete(key)


@pytest.mark.parametrize("algorithm", [Algorithm.TOKEN_BUCKET, Algorithm.LEAKY_BUCKET])
def test_token_leaky_never_exceed_capacity(algorithm):
    from concurrent.futures import ThreadPoolExecutor

    key = _fresh_key()

    def one(_):
        store = RedisStore(client=_client())
        return store.evaluate(
            key=key, algorithm=algorithm, limit=30, window=60, burst=30, cost=1, ttl=120
        ).allowed

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(one, range(300)))

    assert sum(1 for r in results if r) == 30
    _client().delete(key)


def test_sliding_window_boundary():
    """Sliding-window entries fall out after the window passes."""
    store = RedisStore(client=_client())
    key = _fresh_key()

    allowed = sum(
        store.evaluate(
            key=key, algorithm=Algorithm.SLIDING_WINDOW, limit=5, window=2, burst=5, cost=1, ttl=120
        ).allowed
        for _ in range(8)
    )
    assert allowed == 5  # window full

    time.sleep(2.2)  # window slides past

    after = store.evaluate(
        key=key, algorithm=Algorithm.SLIDING_WINDOW, limit=5, window=2, burst=5, cost=1, ttl=120
    )
    assert after.allowed is True
    _client().delete(key)


def test_fixed_window_reset():
    """Fixed window resets after the window elapses (server-clock driven)."""
    store = RedisStore(client=_client())
    key = _fresh_key()

    allowed = sum(
        store.evaluate(
            key=key, algorithm=Algorithm.FIXED_WINDOW, limit=3, window=1, burst=3, cost=1, ttl=120
        ).allowed
        for _ in range(5)
    )
    assert allowed == 3

    time.sleep(1.2)  # window elapses

    after = store.evaluate(
        key=key, algorithm=Algorithm.FIXED_WINDOW, limit=3, window=1, burst=3, cost=1, ttl=120
    )
    assert after.allowed is True
    _client().delete(key)
