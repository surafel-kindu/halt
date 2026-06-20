/**
 * Tests for RedisStore.
 *
 * Unit tests (decision mapping, fail-open/closed) use a fake client and always
 * run. The atomicity / real-script tests require a reachable Redis and are
 * skipped unless REDIS_URL is set.
 */

import { describe, it, expect } from 'vitest';
import { RedisStore } from '../src/stores/redis';
import { RateLimiter } from '../src/core/limiter';
import { Algorithm } from '../src/core/policy';
import type { RedisClientLike, EvaluateInput } from '../src/core/store';

function input(over: Partial<EvaluateInput> = {}): EvaluateInput {
    return {
        key: 'halt:p:1.2.3.4',
        algorithm: Algorithm.FIXED_WINDOW,
        limit: 10,
        window: 60,
        burst: 12,
        cost: 1,
        ttl: 120,
        ...over,
    };
}

/** Fake client whose eval() returns a canned array (or throws). */
function fakeClient(result: unknown | (() => never)): RedisClientLike {
    return {
        async eval() {
            if (typeof result === 'function') return (result as () => never)();
            return result;
        },
    };
}

describe('RedisStore decision mapping', () => {
    it('maps an allowed decision', async () => {
        const store = new RedisStore({ client: fakeClient([1, 10, 7, 1781000000, -1]) });
        const d = await store.evaluate(input());
        expect(d.allowed).toBe(true);
        expect(d.limit).toBe(10);
        expect(d.remaining).toBe(7);
        expect(d.resetAt).toBe(1781000000);
        expect(d.retryAfter).toBeUndefined();
    });

    it('maps a blocked decision with retryAfter', async () => {
        const store = new RedisStore({ client: fakeClient([0, 10, 0, 1781000000, 5]) });
        const d = await store.evaluate(input());
        expect(d.allowed).toBe(false);
        expect(d.remaining).toBe(0);
        expect(d.retryAfter).toBe(5);
    });
});

describe('RedisStore fail modes', () => {
    const thrower = () => {
        throw new Error('connection refused');
    };

    it('fails open by default (allows on error)', async () => {
        const store = new RedisStore({ client: fakeClient(thrower) });
        const d = await store.evaluate(input());
        expect(d.allowed).toBe(true);
        expect(d.remaining).toBe(10);
    });

    it('fails closed when configured (blocks on error)', async () => {
        const store = new RedisStore({ client: fakeClient(thrower), failMode: 'closed' });
        const d = await store.evaluate(input());
        expect(d.allowed).toBe(false);
        expect(d.retryAfter).toBe(60);
    });

    it('invokes onError and metrics hooks on failure', async () => {
        const errors: unknown[] = [];
        const metrics: string[] = [];
        const store = new RedisStore({
            client: fakeClient(thrower),
            onError: (e) => errors.push(e),
            metricsRecorder: (name) => metrics.push(name),
        });
        await store.evaluate(input());
        expect(errors).toHaveLength(1);
        expect(metrics).toContain('halt.redis.error');
        expect(metrics).toContain('halt.request.fail_open');
    });
});

describe('RateLimiter delegates to atomic store', () => {
    it('uses the store evaluate() path for atomic stores', async () => {
        let received: EvaluateInput | undefined;
        const atomic = {
            async evaluate(i: EvaluateInput) {
                received = i;
                return { allowed: true, limit: i.limit, remaining: i.limit - 1, resetAt: 0 };
            },
        };
        const limiter = new RateLimiter({
            store: atomic,
            policy: { name: 'p', limit: 10, window: 60 },
            exemptPrivateIps: false,
        });
        const req = { socket: { remoteAddress: '8.8.8.8' } };
        const d = await limiter.check(req);
        expect(d.allowed).toBe(true);
        expect(received?.key).toContain('halt:p:');
        expect(received?.algorithm).toBe(Algorithm.TOKEN_BUCKET);
        expect(received?.ttl).toBe(120);
    });
});

// --------------------------------------------------------------------------- //
// Integration against a real Redis (atomic Lua). Opt-in via REDIS_URL.
// --------------------------------------------------------------------------- //

const REDIS_URL = process.env.REDIS_URL;

describe.skipIf(!REDIS_URL)('RedisStore against real Redis', () => {
    // Lazy import so ioredis isn't required when REDIS_URL is unset.
    async function makeClient() {
        const { default: Redis } = await import('ioredis');
        return new Redis(REDIS_URL as string);
    }

    it('fixed window: exactly `limit` allowed under concurrency', async () => {
        const client = await makeClient();
        const store = new RedisStore({ client: client as unknown as RedisClientLike });
        const key = `halt:test:${Math.random().toString(36).slice(2)}`;

        const results = await Promise.all(
            Array.from({ length: 200 }, () =>
                store.evaluate(input({ key, limit: 50, window: 60, burst: 50 }))
            )
        );
        expect(results.filter((d) => d.allowed).length).toBe(50);

        await client.del(key);
        await client.quit();
    });

    it('sliding window: exactly `limit` allowed', async () => {
        const client = await makeClient();
        const store = new RedisStore({ client: client as unknown as RedisClientLike });
        const key = `halt:test:${Math.random().toString(36).slice(2)}`;

        let allowed = 0;
        for (let i = 0; i < 8; i++) {
            const d = await store.evaluate(
                input({ key, algorithm: Algorithm.SLIDING_WINDOW, limit: 5, window: 60, burst: 5 })
            );
            if (d.allowed) allowed++;
        }
        expect(allowed).toBe(5);

        await client.del(key);
        await client.quit();
    });
});
