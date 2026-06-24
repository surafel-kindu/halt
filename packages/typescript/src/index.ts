/**
 * Halt - Rate limiting middleware with safe defaults and Redis-backed accuracy.
 */

export { RateLimiter, type RateLimiterOptions } from './core/limiter';
export { type Decision, toHeaders } from './core/decision';
export {
    type Policy,
    KeyStrategy,
    Algorithm,
    normalizePolicy,
} from './core/policy';
export { InMemoryStore, type Store } from './stores/memory';
export { RedisStore, type RedisStoreOptions, type FailMode } from './stores/redis';
export {
    type AtomicStore,
    type EvaluateInput,
    type RedisClientLike,
    isAtomicStore,
} from './core/store';
export * as presets from './presets';
export * as extractors from './core/extractors';

// Dynamic limits
export {
    PolicyRegistry,
    cachedPolicyResolver,
    type CachedPolicyResolverOptions,
} from './core/registry';

// SaaS features
export {
    QuotaManager,
    QuotaPeriod,
    type Quota,
    QUOTA_FREE_MONTHLY,
    QUOTA_PRO_MONTHLY,
    QUOTA_ENTERPRISE_MONTHLY,
    QUOTA_FREE_DAILY,
    QUOTA_PRO_DAILY,
} from './core/quota';
export {
    PenaltyManager,
    type Penalty,
    type PenaltyConfig,
    PENALTY_LENIENT,
    PENALTY_MODERATE,
    PENALTY_STRICT,
} from './core/penalty';

// Observability
export {
    type TelemetryHooks,
    LoggingTelemetry,
    MetricsTelemetry,
    CompositeTelemetry,
} from './core/telemetry';
export {
    StatsCollector,
    type StatsCollectorOptions,
    type StatsSnapshot,
} from './core/stats';
export {
    OpenTelemetryMetrics,
    type OTelMeterLike,
    type OTelCounterLike,
} from './observability/otel';
