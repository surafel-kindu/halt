"""Dynamic limits — change policies at runtime without restarting.

``PolicyRegistry`` holds named policies you can mutate live. Use it as the
limiter's ``policy`` via ``registry.resolver(selector)``::

    registry = PolicyRegistry([presets.PUBLIC_API])
    limiter = RateLimiter(store=store, policy=registry.resolver(lambda req: "public_api"))
    # later, no restart:
    registry.update("public_api", limit=500)

For limits stored in Redis/DB/config (and shared across a fleet), use
``cached_policy_resolver`` with a loader that reads that shared state. An async
loader works with ``limiter.acheck`` (sync loader with ``limiter.check``).
"""

import dataclasses
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union

from halt.core.policy import Policy


class PolicyRegistry:
    """Mutable, in-process registry of named policies."""

    def __init__(self, initial: Optional[List[Policy]] = None) -> None:
        self._policies: Dict[str, Policy] = {}
        for p in initial or []:
            self.register(p)

    def register(self, policy: Policy) -> "PolicyRegistry":
        """Add or replace a policy (keyed by ``policy.name``)."""
        self._policies[policy.name] = policy
        return self

    def get(self, name: str) -> Optional[Policy]:
        return self._policies.get(name)

    def has(self, name: str) -> bool:
        return name in self._policies

    def update(self, name: str, **patch: Any) -> Policy:
        """Mutate fields of an existing policy at runtime (e.g. ``limit=500``)."""
        existing = self._policies.get(name)
        if existing is None:
            raise KeyError(f"Unknown policy: {name}")
        patch.pop("name", None)
        # If the limit changed but burst wasn't given, recompute the default burst
        # (otherwise a stale smaller burst fails Policy validation).
        if "limit" in patch and "burst" not in patch:
            patch["burst"] = None
        updated = dataclasses.replace(existing, **patch)
        self._policies[name] = updated
        return updated

    def remove(self, name: str) -> bool:
        return self._policies.pop(name, None) is not None

    def list(self) -> List[Policy]:
        return list(self._policies.values())

    def resolver(self, selector: Callable[[Any], str]) -> Callable[[Any], Policy]:
        """Build a resolver for the limiter's ``policy`` argument.

        Args:
            selector: maps a request to a registered policy name.
        """

        def _resolve(request: Any) -> Policy:
            name = selector(request)
            policy = self._policies.get(name)
            if policy is None:
                raise KeyError(f"Unknown policy: {name}")
            return policy

        return _resolve


def cached_policy_resolver(
    loader: Callable[[Any], Union[Policy, Awaitable[Policy]]],
    ttl: float = 5.0,
    key: Optional[Callable[[Any], str]] = None,
) -> Callable[[Any], Union[Policy, Awaitable[Policy]]]:
    """Wrap a (possibly async) loader with a per-key TTL cache.

    The loader reads your source of truth (Redis/DB/config), so limits propagate
    across a fleet and refresh live — without restarting. Use the returned function
    as the limiter's ``policy``. An async loader requires ``limiter.acheck``.

    Args:
        loader: ``(request) -> Policy`` (or awaitable of Policy).
        ttl: cache entry lifetime in seconds.
        key: cache key for a request (default: single shared key).
    """
    key_fn = key or (lambda _req: "__default__")
    cache: Dict[str, Any] = {}

    def _make(request: Any):
        k = key_fn(request)
        hit = cache.get(k)
        if hit is not None and hit[1] > time.monotonic():
            return hit[0]
        result = loader(request)
        if hasattr(result, "__await__"):

            async def _await_and_cache():
                policy = await result
                cache[k] = (policy, time.monotonic() + ttl)
                return policy

            return _await_and_cache()
        cache[k] = (result, time.monotonic() + ttl)
        return result

    return _make
