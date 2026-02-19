import pytest
from halt.core.limiter import RateLimiter
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
