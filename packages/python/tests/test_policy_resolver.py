import pytest
from halt.core.limiter import RateLimiter
from halt.stores.memory import InMemoryStore
from halt.presets import PLAN_FREE, PLAN_PRO

def resolver(req):
    user = getattr(req, 'user', None)
    user_id = getattr(user, 'id', None) if user else None
    return PLAN_PRO if user_id == 'user_pro' else PLAN_FREE

def test_policy_resolver_allows_request():
    store = InMemoryStore()
    limiter = RateLimiter(store=store, policy=resolver)

    class Req:
        pass

    req = Req()
    req.user = type('U', (), {'id': 'user_pro'})
    req.path = '/api'

    decision = limiter.check(req)
    assert decision.allowed is True
    assert decision.limit == PLAN_PRO.limit
