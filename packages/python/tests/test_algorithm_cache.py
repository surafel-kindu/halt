import pytest
from types import SimpleNamespace
from halt.core.limiter import RateLimiter
from halt.core.policy import Policy, Algorithm
from halt.stores.memory import InMemoryStore
from halt.presets import PLAN_FREE

def test_multiple_checks_consistent():
    limiter = RateLimiter(store=InMemoryStore(), policy=PLAN_FREE)

    class Req: pass
    req = Req()
    req.path = '/api'
    req.socket = SimpleNamespace(remoteAddress='1.2.3.4')

    d1 = limiter.check(req)
    d2 = limiter.check(req)
    assert d1.limit == d2.limit


def test_sliding_precision_default_and_validation():
    default_policy = Policy(
        name="sliding_default",
        limit=10,
        window=60,
        algorithm=Algorithm.SLIDING_WINDOW,
    )
    assert default_policy.sliding_precision == 10

    with pytest.raises(ValueError, match="sliding_precision must be positive"):
        Policy(
            name="sliding_invalid",
            limit=10,
            window=60,
            algorithm=Algorithm.SLIDING_WINDOW,
            sliding_precision=0,
        )


def test_sliding_precision_part_of_algorithm_cache_key():
    def resolver(req):
        return Policy(
            name="sliding_dynamic",
            limit=10,
            window=60,
            algorithm=Algorithm.SLIDING_WINDOW,
            sliding_precision=req.precision,
        )

    limiter = RateLimiter(store=InMemoryStore(), policy=resolver, exempt_private_ips=False)

    class Req:
        pass

    req_low = Req()
    req_low.path = "/api"
    req_low.precision = 5
    req_low.socket = SimpleNamespace(remoteAddress="8.8.8.8")

    req_high = Req()
    req_high.path = "/api"
    req_high.precision = 20
    req_high.socket = SimpleNamespace(remoteAddress="8.8.8.8")

    limiter.check(req_low)
    limiter.check(req_high)

    assert len(limiter._algorithm_cache) == 2
