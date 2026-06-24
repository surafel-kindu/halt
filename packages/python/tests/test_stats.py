"""Unit tests for the in-process StatsCollector (pure, no Redis)."""

from halt import StatsCollector, RateLimiter, InMemoryStore, Policy
from halt.core.decision import Decision


ALLOW = Decision(allowed=True, limit=10, remaining=9, reset_at=0)
BLOCK = Decision(allowed=False, limit=10, remaining=0, reset_at=0, retry_after=5)


def test_counts_totals_and_breakdowns():
    s = StatsCollector()
    s.on_allowed("u1", ALLOW, {"policy": "api", "endpoint": "/a", "cost": 2, "plan": "pro"})
    s.on_allowed("u1", ALLOW, {"policy": "api", "endpoint": "/a", "cost": 3, "plan": "pro"})
    s.on_blocked("u2", BLOCK, {"policy": "api", "endpoint": "/a"})

    snap = s.snapshot()
    assert snap["allowed_total"] == 2
    assert snap["blocked_total"] == 1
    assert snap["by_policy"]["api"] == {"allowed": 2, "blocked": 1}
    assert snap["by_endpoint"]["/a"] == {"allowed": 2, "blocked": 1, "cost": 5}


def test_top_limited_keys_sorted():
    s = StatsCollector()
    for _ in range(3):
        s.on_blocked("heavy", BLOCK, {"policy": "api"})
    s.on_blocked("light", BLOCK, {"policy": "api"})

    top = s.snapshot()["top_limited_keys"]
    assert top[0] == {"key": "heavy", "blocked": 3}
    assert top[1] == {"key": "light", "blocked": 1}


def test_top_n_limit():
    s = StatsCollector(top_n=2)
    for k in ("a", "b", "c", "d"):
        s.on_blocked(k, BLOCK, {"policy": "api"})
    assert len(s.snapshot()["top_limited_keys"]) == 2


def test_cost_by_plan_allowed_only():
    s = StatsCollector()
    s.on_allowed("u1", ALLOW, {"policy": "p", "cost": 4, "plan": "free"})
    s.on_allowed("u2", ALLOW, {"policy": "p", "cost": 6, "plan": "pro"})
    s.on_blocked("u3", BLOCK, {"policy": "p", "cost": 99, "plan": "pro"})

    assert s.snapshot()["cost_by_plan"] == {"free": 4, "pro": 6}


def test_eviction_of_smallest():
    s = StatsCollector(max_tracked_keys=2)
    s.on_blocked("keep", BLOCK, {})
    s.on_blocked("keep", BLOCK, {})  # count 2
    s.on_blocked("drop", BLOCK, {})  # count 1
    s.on_blocked("new", BLOCK, {})  # evicts 'drop'

    keys = [k["key"] for k in s.snapshot()["top_limited_keys"]]
    assert "keep" in keys
    assert "drop" not in keys


def test_quota_penalty_violation_counts():
    s = StatsCollector()
    s.on_quota_exceeded("u1", object())
    s.on_penalty_applied("u1", object())
    s.on_violation("u1", object(), 1.0)
    snap = s.snapshot()
    assert snap["quota_exceeded"] == 1
    assert snap["penalties_applied"] == 1
    assert snap["violations"] == 1


def test_reset():
    s = StatsCollector()
    s.on_allowed("u", ALLOW, {"policy": "p"})
    s.reset()
    assert s.snapshot()["allowed_total"] == 0
    assert s.snapshot()["tracked_keys"] == 0


def test_wires_into_limiter():
    s = StatsCollector()
    limiter = RateLimiter(
        store=InMemoryStore(),
        policy=Policy(name="tiny", limit=1, window=60, plan="free"),
        exempt_private_ips=False,
        telemetry=s,
    )

    class Req:
        path = "/x"

    req = Req()
    req.socket = type("S", (), {"remoteAddress": "8.8.8.8"})()
    for _ in range(3):
        limiter.check(req)

    snap = s.snapshot()
    assert snap["allowed_total"] + snap["blocked_total"] == 3
    assert snap["blocked_total"] > 0
    assert "tiny" in snap["by_policy"]
