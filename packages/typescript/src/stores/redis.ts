/**
 * Redis storage backend for Halt — production-grade, atomic rate limiting.
 *
 * Implements the atomic-evaluation protocol (`AtomicStore`): the full
 * check-and-consume runs inside Redis via a Lua script, so limits stay accurate
 * under concurrent load from any number of app servers. Works on standalone
 * Redis and Redis Cluster (every script touches a single key).
 *
 * The Redis client is injected, so Halt has no hard dependency on any client
 * library. Any ioredis / node-redis v4+ instance works:
 *
 *   import Redis from 'ioredis';
 *   import { RedisStore } from 'halt-rate';
 *   const store = new RedisStore({ client: new Redis(process.env.REDIS_URL) });
 */

import { Decision } from '../core/decision';
import { Algorithm } from '../core/policy';
import { AtomicStore, EvaluateInput, RedisClientLike } from '../core/store';
import { SCRIPTS } from './redis-scripts';

/** Behavior when Redis is unreachable or errors. */
export type FailMode = 'open' | 'closed';

export interface RedisStoreOptions {
    /** A connected Redis client (ioredis or node-redis v4+). */
    client: RedisClientLike;
    /**
     * What to do when Redis can't be reached.
     * - `'open'` (default): allow the request — don't take down traffic when the
     *   limiter's backing store is down.
     * - `'closed'`: block the request (429) — safer for abuse-sensitive routes.
     */
    failMode?: FailMode;
    /** Called with the underlying error whenever a Redis call fails. */
    onError?: (err: unknown) => void;
    /** Metrics hook: (name, tags?, value?) => void. */
    metricsRecorder?: (name: string, tags?: Record<string, string>, value?: number) => void;
}

export class RedisStore implements AtomicStore {
    private client: RedisClientLike;
    private failMode: FailMode;
    private onError?: (err: unknown) => void;
    private metricsRecorder?: RedisStoreOptions['metricsRecorder'];
    /** Cache of script source -> SHA loaded into Redis, to use EVALSHA. */
    private shaCache: Map<string, string> = new Map();

    constructor(options: RedisStoreOptions) {
        this.client = options.client;
        this.failMode = options.failMode ?? 'open';
        this.onError = options.onError;
        this.metricsRecorder = options.metricsRecorder;
    }

    async evaluate(input: EvaluateInput): Promise<Decision> {
        const script = SCRIPTS[input.algorithm];
        if (!script) {
            throw new Error(`Algorithm ${input.algorithm} not supported by RedisStore`);
        }

        const args: (string | number)[] = [
            input.limit,
            input.window,
            input.burst,
            input.cost,
            input.ttl,
        ];

        try {
            const raw = await this.run(script, input.key, args);
            return this.toDecision(raw, input);
        } catch (err) {
            this.onError?.(err);
            this.metricsRecorder?.('halt.redis.error', { algorithm: input.algorithm }, 1);
            return this.failDecision(input);
        }
    }

    /** Run a script via EVALSHA, falling back to EVAL (and caching the SHA). */
    private async run(
        script: string,
        key: string,
        args: (string | number)[]
    ): Promise<unknown> {
        const sha = this.shaCache.get(script);
        if (sha && this.client.evalsha) {
            try {
                return await this.client.evalsha(sha, 1, key, ...args);
            } catch (err) {
                // NOSCRIPT: script was flushed from Redis; fall through to EVAL.
                if (!isNoScriptError(err)) throw err;
            }
        }

        const result = await this.client.eval(script, 1, key, ...args);
        // Cache the SHA for subsequent EVALSHA calls (best-effort).
        if (!this.shaCache.has(script) && this.client.script) {
            try {
                const loaded = await this.client.script('LOAD', script);
                if (typeof loaded === 'string') this.shaCache.set(script, loaded);
            } catch {
                /* SHA caching is an optimization; ignore failures. */
            }
        }
        return result;
    }

    /** Map the Lua array [allowed, limit, remaining, resetAt, retryAfter] to a Decision. */
    private toDecision(raw: unknown, input: EvaluateInput): Decision {
        if (!Array.isArray(raw) || raw.length < 4) {
            throw new Error(`Unexpected Redis script result: ${JSON.stringify(raw)}`);
        }
        const [allowed, limit, remaining, resetAt, retryAfter] = raw.map((v) => Number(v));

        const decision: Decision = {
            allowed: allowed === 1,
            limit,
            remaining,
            resetAt,
        };
        if (!decision.allowed && retryAfter !== undefined && retryAfter >= 0) {
            decision.retryAfter = retryAfter;
        }

        this.metricsRecorder?.(
            'halt.request.checked',
            { algorithm: input.algorithm, allowed: String(decision.allowed) },
            1
        );
        return decision;
    }

    /** Decision returned when Redis is unreachable, per failMode. */
    private failDecision(input: EvaluateInput): Decision {
        const resetAt = Math.floor(Date.now() / 1000 + input.window);
        if (this.failMode === 'open') {
            this.metricsRecorder?.('halt.request.fail_open', { algorithm: input.algorithm }, 1);
            return { allowed: true, limit: input.limit, remaining: input.limit, resetAt };
        }
        this.metricsRecorder?.('halt.request.fail_closed', { algorithm: input.algorithm }, 1);
        return {
            allowed: false,
            limit: input.limit,
            remaining: 0,
            resetAt,
            retryAfter: input.window,
        };
    }
}

function isNoScriptError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        String((err as { message?: string }).message ?? '').includes('NOSCRIPT')
    );
}

// Re-export the algorithm enum location for convenience in user code.
export { Algorithm };
