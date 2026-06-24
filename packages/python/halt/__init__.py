"""Halt - Rate limiting middleware with safe defaults and Redis-backed accuracy."""

__version__ = "0.3.0"

from halt.core.limiter import RateLimiter
from halt.core.policy import Policy, KeyStrategy, Algorithm
from halt.core.decision import Decision
from halt.stores.memory import InMemoryStore
from halt import presets

# SaaS features
from halt.core.quota import (
    QuotaManager,
    Quota,
    QuotaPeriod,
    QUOTA_FREE_MONTHLY,
    QUOTA_PRO_MONTHLY,
    QUOTA_ENTERPRISE_MONTHLY,
    QUOTA_FREE_DAILY,
    QUOTA_PRO_DAILY,
)
from halt.core.penalty import (
    PenaltyManager,
    Penalty,
    PenaltyConfig,
    PENALTY_LENIENT,
    PENALTY_MODERATE,
    PENALTY_STRICT,
)

# Observability
from halt.core.telemetry import (
    TelemetryHooks,
    LoggingTelemetry,
    MetricsTelemetry,
    CompositeTelemetry,
)
from halt.core.stats import StatsCollector

__all__ = [
    "RateLimiter",
    "Policy",
    "KeyStrategy",
    "Algorithm",
    "Decision",
    "InMemoryStore",
    "presets",
    # SaaS
    "QuotaManager",
    "Quota",
    "QuotaPeriod",
    "QUOTA_FREE_MONTHLY",
    "QUOTA_PRO_MONTHLY",
    "QUOTA_ENTERPRISE_MONTHLY",
    "QUOTA_FREE_DAILY",
    "QUOTA_PRO_DAILY",
    "PenaltyManager",
    "Penalty",
    "PenaltyConfig",
    "PENALTY_LENIENT",
    "PENALTY_MODERATE",
    "PENALTY_STRICT",
    # Observability
    "TelemetryHooks",
    "LoggingTelemetry",
    "MetricsTelemetry",
    "CompositeTelemetry",
    "StatsCollector",
]

try:
    from halt.stores.redis import RedisStore, AsyncRedisStore

    __all__.append("RedisStore")
    __all__.append("AsyncRedisStore")
except ImportError:
    pass

# OpenTelemetry adapter is dependency-free to import (meter is injected); the
# optional opentelemetry-api dep is only needed to auto-acquire a meter.
from halt.observability.otel import OpenTelemetryMetrics  # noqa: E402

__all__.append("OpenTelemetryMetrics")
