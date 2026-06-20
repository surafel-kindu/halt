/**
 * Atomic-evaluation protocol.
 *
 * Simple stores (e.g. InMemoryStore) expose get/set and let the limiter run the
 * algorithm in-process. Distributed stores that can compute the decision
 * atomically (e.g. RedisStore via Lua) instead expose `evaluate()`: the limiter
 * hands them the resolved policy params + storage key and gets back a finished
 * Decision. The limiter prefers `evaluate()` when present (see core/limiter.ts).
 */

import { Decision } from './decision';
import { Algorithm } from './policy';

/** Everything an atomic store needs to compute a decision for one request. */
export interface EvaluateInput {
    /** Full storage key, already namespaced (e.g. `halt:public_api:1.2.3.4`). */
    key: string;
    /** Algorithm to apply. */
    algorithm: Algorithm;
    /** Requests permitted per window. */
    limit: number;
    /** Window length in seconds. */
    window: number;
    /** Bucket capacity (token/leaky bucket). */
    burst: number;
    /** Cost this request consumes. */
    cost: number;
    /** Seconds to keep the key alive in the backing store. */
    ttl: number;
}

/** A store that computes the rate-limit decision atomically on its own. */
export interface AtomicStore {
    evaluate(input: EvaluateInput): Promise<Decision>;
}

/** True if the store implements the atomic-evaluation protocol. */
export function isAtomicStore(store: unknown): store is AtomicStore {
    return (
        typeof store === 'object' &&
        store !== null &&
        typeof (store as AtomicStore).evaluate === 'function'
    );
}

/**
 * Minimal structural type for a Redis client (satisfied by ioredis and
 * node-redis v4+). Declared here so Halt has no hard dependency on any concrete
 * Redis package — the user injects their own client.
 */
export interface RedisClientLike {
    eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
    evalsha?(sha: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
    script?(subcommand: 'LOAD', script: string): Promise<unknown>;
}
