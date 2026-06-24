"""OpenTelemetry metrics adapter for Halt.

Implements the ``TelemetryHooks`` protocol over the OTel metrics API. You can
inject a Meter (so Halt keeps no hard dependency on ``opentelemetry-api``), or
let it acquire one lazily::

    # inject (recommended)
    from opentelemetry import metrics
    from halt import OpenTelemetryMetrics
    telemetry = OpenTelemetryMetrics(meter=metrics.get_meter("halt"))

    # or auto-acquire (requires opentelemetry-api installed)
    telemetry = OpenTelemetryMetrics()

    limiter = RateLimiter(store=store, policy=policy, telemetry=telemetry)

Request spans are already covered by the limiter's ``otel_tracer`` option; this
adapter adds counters for dashboards/alerts. Roll up across instances with your
OTel collector.
"""

from typing import Any, Optional

from halt.core.decision import Decision


class OpenTelemetryMetrics:
    """Feed Halt telemetry into OpenTelemetry counters."""

    def __init__(self, meter: Optional[Any] = None) -> None:
        """Initialize the adapter.

        Args:
            meter: An OTel Meter (``opentelemetry.metrics.Meter``). If omitted,
                one is acquired via ``opentelemetry.metrics.get_meter("halt")``,
                which requires the optional ``opentelemetry-api`` dependency.
        """
        if meter is None:
            try:
                from opentelemetry import metrics
            except ImportError as exc:  # pragma: no cover
                raise ImportError(
                    "OpenTelemetryMetrics requires opentelemetry-api. "
                    "Install it with: pip install halt-rate[otel] "
                    "(or pass an existing meter=...)"
                ) from exc
            meter = metrics.get_meter("halt")

        self._requests = meter.create_counter(
            "halt.requests", description="Total rate-limit checks"
        )
        self._blocked = meter.create_counter(
            "halt.blocked", description="Rate-limited (blocked) requests"
        )
        self._cost = meter.create_counter(
            "halt.cost", description="Consumed request cost (weighted endpoints)"
        )
        self._quota_exceeded = meter.create_counter(
            "halt.quota.exceeded", description="Quota-exceeded events"
        )
        self._penalty_applied = meter.create_counter(
            "halt.penalty.applied", description="Penalties applied (abuse controls)"
        )
        self._violations = meter.create_counter(
            "halt.violations", description="Recorded abuse violations"
        )

    def on_check(self, key: str, decision: Decision, metadata: Optional[dict] = None) -> None:
        """No-op (counts recorded in on_allowed / on_blocked)."""

    def on_allowed(self, key: str, decision: Decision, metadata: Optional[dict] = None) -> None:
        meta = metadata or {}
        policy = str(meta.get("policy", "unknown"))
        self._requests.add(1, {"policy": policy, "allowed": "true"})
        plan = str(meta.get("plan") or meta.get("policy") or "unknown")
        cost = float(meta.get("cost", 1))
        endpoint = meta.get("endpoint")
        attrs = {"plan": plan}
        if endpoint:
            attrs["endpoint"] = str(endpoint)
        self._cost.add(cost, attrs)

    def on_blocked(self, key: str, decision: Decision, metadata: Optional[dict] = None) -> None:
        meta = metadata or {}
        policy = str(meta.get("policy", "unknown"))
        self._requests.add(1, {"policy": policy, "allowed": "false"})
        attrs = {"policy": policy}
        endpoint = meta.get("endpoint")
        if endpoint:
            attrs["endpoint"] = str(endpoint)
        self._blocked.add(1, attrs)

    def on_quota_check(self, identifier: str, quota: Any, allowed: bool) -> None:
        """No-op (exceedances recorded in on_quota_exceeded)."""

    def on_quota_exceeded(self, identifier: str, quota: Any) -> None:
        self._quota_exceeded.add(1, {"quota": getattr(quota, "name", "unknown")})

    def on_penalty_applied(self, identifier: str, penalty: Any) -> None:
        self._penalty_applied.add(1)

    def on_violation(self, identifier: str, penalty: Any, severity: float) -> None:
        self._violations.add(1, {"severity": severity})
