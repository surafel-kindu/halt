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
