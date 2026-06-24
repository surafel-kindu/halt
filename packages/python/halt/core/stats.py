"""In-process statistics collector for rate-limit observability.

Implements the ``TelemetryHooks`` protocol, so you plug it into a RateLimiter
(and optionally QuotaManager / PenaltyManager) and it aggregates everything in
memory. Call ``snapshot()`` to expose a ``/halt/stats`` endpoint or log periodically.

It is per-process by design — for a fleet, run it on each instance and roll up
across instances with the OpenTelemetry adapter (see halt.observability.otel).
Memory is bounded: the tracked-key table is capped and the smallest counters are
evicted.

    stats = StatsCollector()
    limiter = RateLimiter(store=store, policy=policy, telemetry=stats)
    # ... later ...
    return stats.snapshot()
"""

from typing import Any, Dict, Optional

from halt.core.decision import Decision


class StatsCollector:
    """Per-process aggregator of rate-limit telemetry."""

    def __init__(self, top_n: int = 20, max_tracked_keys: int = 10000) -> None:
        """Initialize the collector.

        Args:
            top_n: How many top limited keys ``snapshot()`` returns.
            max_tracked_keys: Max distinct keys tracked before eviction.
        """
        self.top_n = top_n
        self.max_tracked_keys = max_tracked_keys

        self.allowed_total = 0
        self.blocked_total = 0
        self._by_policy: Dict[str, Dict[str, int]] = {}
        self._by_endpoint: Dict[str, Dict[str, float]] = {}
        self._limited_keys: Dict[str, int] = {}
        self._cost_by_plan: Dict[str, float] = {}
        self.quota_exceeded = 0
        self.penalties_applied = 0
        self.violations = 0

    # ----- telemetry hooks -------------------------------------------------

    def on_check(self, key: str, decision: Decision, metadata: Optional[dict] = None) -> None:
        """No-op (counts are recorded in on_allowed / on_blocked)."""

    def on_allowed(self, key: str, decision: Decision, metadata: Optional[dict] = None) -> None:
        self.allowed_total += 1
        meta = metadata or {}
        cost = float(meta.get("cost", 1))
        self._policy_tally(meta)["allowed"] += 1

        endpoint = meta.get("endpoint")
        if endpoint:
            e = self._endpoint_tally(endpoint)
            e["allowed"] += 1
            e["cost"] += cost

        plan = meta.get("plan") or meta.get("policy") or "unknown"
        self._cost_by_plan[plan] = self._cost_by_plan.get(plan, 0) + cost

    def on_blocked(self, key: str, decision: Decision, metadata: Optional[dict] = None) -> None:
        self.blocked_total += 1
        meta = metadata or {}
        self._policy_tally(meta)["blocked"] += 1

        endpoint = meta.get("endpoint")
        if endpoint:
            self._endpoint_tally(endpoint)["blocked"] += 1

        if key:
            self._track_limited_key(key)

    def on_quota_check(self, identifier: str, quota: Any, allowed: bool) -> None:
        """No-op (exceedances are recorded in on_quota_exceeded)."""

    def on_quota_exceeded(self, identifier: str, quota: Any) -> None:
        self.quota_exceeded += 1

    def on_penalty_applied(self, identifier: str, penalty: Any) -> None:
        self.penalties_applied += 1

    def on_violation(self, identifier: str, penalty: Any, severity: float) -> None:
        self.violations += 1

    # ----- output ----------------------------------------------------------

    def snapshot(self) -> dict:
        """Point-in-time view of the aggregated stats."""
        top = sorted(self._limited_keys.items(), key=lambda kv: kv[1], reverse=True)
        top_limited_keys = [{"key": k, "blocked": v} for k, v in top[: self.top_n]]

        return {
            "allowed_total": self.allowed_total,
            "blocked_total": self.blocked_total,
            "by_policy": {k: dict(v) for k, v in self._by_policy.items()},
            "by_endpoint": {k: dict(v) for k, v in self._by_endpoint.items()},
            "top_limited_keys": top_limited_keys,
            "cost_by_plan": dict(self._cost_by_plan),
            "quota_exceeded": self.quota_exceeded,
            "penalties_applied": self.penalties_applied,
            "violations": self.violations,
            "tracked_keys": len(self._limited_keys),
        }

    def reset(self) -> None:
        """Clear all counters (e.g. after exporting)."""
        self.allowed_total = 0
        self.blocked_total = 0
        self._by_policy.clear()
        self._by_endpoint.clear()
        self._limited_keys.clear()
        self._cost_by_plan.clear()
        self.quota_exceeded = 0
        self.penalties_applied = 0
        self.violations = 0

    # ----- helpers ---------------------------------------------------------

    def _policy_tally(self, meta: dict) -> Dict[str, int]:
        policy = meta.get("policy") or "unknown"
        t = self._by_policy.get(policy)
        if t is None:
            t = {"allowed": 0, "blocked": 0}
            self._by_policy[policy] = t
        return t

    def _endpoint_tally(self, endpoint: str) -> Dict[str, float]:
        e = self._by_endpoint.get(endpoint)
        if e is None:
            e = {"allowed": 0, "blocked": 0, "cost": 0}
            self._by_endpoint[endpoint] = e
        return e

    def _track_limited_key(self, key: str) -> None:
        if key in self._limited_keys:
            self._limited_keys[key] += 1
            return
        if len(self._limited_keys) >= self.max_tracked_keys:
            self._evict_smallest()
        self._limited_keys[key] = 1

    def _evict_smallest(self) -> None:
        if not self._limited_keys:
            return
        min_key = min(self._limited_keys, key=self._limited_keys.get)
        del self._limited_keys[min_key]
