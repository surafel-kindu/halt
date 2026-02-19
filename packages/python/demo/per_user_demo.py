from halt.core.limiter import RateLimiter
from halt.stores.memory import InMemoryStore
from halt.presets import PLAN_FREE, PLAN_PRO

# Simple subscription map (replace with DB)
subscriptions = {
    "user_free": "free",
    "user_pro": "pro",
}

def resolver(request):
    user = getattr(request, 'user', None)
    user_id = None
    if user:
        user_id = getattr(user, 'id', None)
    if not user_id:
        user_id = getattr(request, 'user_id', None)

    plan = subscriptions.get(user_id, 'free')
    if plan == 'pro':
        return PLAN_PRO
    return PLAN_FREE

limiter = RateLimiter(store=InMemoryStore(), policy=resolver)

class Req:
    def __init__(self):
        self.user = type('U', (), {'id': 'user_pro'})
        self.path = '/api'
        self.socket = type('S', (), {'remoteAddress': '1.2.3.4'})

req = Req()
decision = limiter.check(req)
print('decision', decision)
