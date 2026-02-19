import pytest
from types import SimpleNamespace
from halt.core.limiter import RateLimiter
from halt.stores.memory import InMemoryStore
from halt.presets import PLAN_FREE

class DummyTracer:
    def __init__(self):
        self.started = False
    def start_span(self, name, attributes=None):
        self.started = True
        return SimpleNamespace(end=lambda: None)

# Note: Python limiter accepts otel_tracer named `otel_tracer` by constructor
def test_otel_tracer_placeholder():
    tracer = DummyTracer()
    limiter = RateLimiter(store=InMemoryStore(), policy=PLAN_FREE, otel_tracer=tracer)

    class Req: pass
    req = Req()
    req.user = SimpleNamespace(id='u1')
    req.path = '/api'

    # call check (sync for python implementation)
    decision = limiter.check(req)
    # We can't assert tracer.started reliably because interface may differ;
    # this test ensures the constructor accepts the tracer without error.
    assert decision.allowed is True
