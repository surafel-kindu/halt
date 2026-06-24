"""Tests for dynamic limits: PolicyRegistry + cached_policy_resolver."""

import asyncio

import pytest

from halt import (
    PolicyRegistry,
    cached_policy_resolver,
    RateLimiter,
    InMemoryStore,
    Policy,
)
from halt.core.policy import Algorithm


def _req(ip="8.8.8.8"):
    r = type("Req", (), {"path": "/x"})()
    r.socket = type("S", (), {"remoteAddress": ip})()
    return r


def _fixed(name="api", limit=2):
    return Policy(name=name, limit=limit, window=60, algorithm=Algorithm.FIXED_WINDOW)


# ----- registry CRUD -------------------------------------------------------


def test_registry_crud():
    reg = PolicyRegistry([_fixed()])
    assert reg.has("api")
    assert reg.get("api").limit == 2
    reg.register(_fixed("other", 9))
    assert {p.name for p in reg.list()} == {"api", "other"}
    assert reg.remove("other") is True
    assert reg.has("other") is False


def test_update_recomputes_burst_on_limit_raise():
    reg = PolicyRegistry([_fixed(limit=2)])  # burst defaults to 2
    updated = reg.update("api", limit=500)  # must not fail burst >= limit
    assert updated.limit == 500
    assert updated.burst >= 500


def test_update_unknown_raises():
    reg = PolicyRegistry()
    with pytest.raises(KeyError):
        reg.update("nope", limit=1)


# ----- dynamic limits without restart --------------------------------------


def test_dynamic_limit_change_takes_effect():
    reg = PolicyRegistry([_fixed(limit=2)])
    limiter = RateLimiter(
        store=InMemoryStore(),
        policy=reg.resolver(lambda r: "api"),
        exempt_private_ips=False,
    )
    req = _req()

    assert limiter.check(req).allowed is True
    assert limiter.check(req).allowed is True
    assert limiter.check(req).allowed is False  # limit=2 reached

    reg.update("api", limit=5)  # raise the limit live — no restart

    assert limiter.check(req).allowed is True  # now allowed under the new limit


# ----- cached loader resolver ----------------------------------------------


def test_cached_resolver_caches_within_ttl():
    calls = []

    def loader(_req):
        calls.append(1)
        return _fixed(limit=10)

    resolver = cached_policy_resolver(loader, ttl=10)
    resolver(_req())
    resolver(_req())
    assert len(calls) == 1  # second call served from cache


def test_async_resolver_works_via_acheck():
    async def aresolver(_req):
        return _fixed(limit=10)

    limiter = RateLimiter(store=InMemoryStore(), policy=aresolver, exempt_private_ips=False)
    decision = asyncio.run(limiter.acheck(_req()))
    assert decision.allowed is True


def test_async_resolver_rejected_by_sync_check():
    async def aresolver(_req):
        return _fixed(limit=10)

    limiter = RateLimiter(store=InMemoryStore(), policy=aresolver, exempt_private_ips=False)
    with pytest.raises(RuntimeError):
        limiter.check(_req())


def test_cached_async_loader_resolves_via_acheck():
    async def loader(_req):
        return _fixed(limit=10)

    resolver = cached_policy_resolver(loader, ttl=5)
    limiter = RateLimiter(store=InMemoryStore(), policy=resolver, exempt_private_ips=False)
    assert asyncio.run(limiter.acheck(_req())).allowed is True
