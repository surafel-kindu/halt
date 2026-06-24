/**
 * Distributed correctness tests against a real Redis (atomic Lua).
 *
 * Opt-in via REDIS_URL (skipped otherwise). These exercise concurrency, races,
 * sliding-window boundaries, and window reset — the properties that matter for a
 * production distributed limiter.
 */

import { describe, it, expect } from 'vitest';
import { RedisStore } from '../src/stores/redis';
import { Algorithm } from '../src/core/policy';
import type { RedisClientLike, EvaluateInput } from '../src/core/store';

const REDIS_URL = process.env.REDIS_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function input(over: Partial<EvaluateInput>): EvaluateInput {
    return {
        key: '',
        algorithm: Algorithm.FIXED_WINDOW,
        limit: 50,
        window: 60,
        burst: 50,
        cost: 1,
        ttl: 120,
        ...over,
    };
}

describe.skipIf(!REDIS_URL)('distributed correctness (real Redis)', () => {
    async function makeClient(): Promise<RedisClientLike & { del: any; quit: any }> {
        const { default: Redis } = await import('ioredis');
        return new Redis(REDIS_URL as string) as any;
    }

    function freshKey(): string {
        return `halt:dist:${Math.random().toString(36).slice(2)}`;
    }

    // 100+ concurrent requests across every algorithm => never over-admit.
    for (const algorithm of [
        Algorithm.FIXED_WINDOW,
        Algorithm.SLIDING_WINDOW,
        Algorithm.TOKEN_BUCKET,
        Algorithm.LEAKY_BUCKET,
    ]) {
        it(`${algorithm}: 200 concurrent => exactly 50 allowed`, async () => {
            const client = await makeClient();
            const store = new RedisStore({ client });
            const key = freshKey();

            const results = await Promise.all(
                Array.from({ length: 200 }, () =>
                    store.evaluate(input({ key, algorithm, limit: 50, burst: 50 }))
                )
            );
            const allowed = results.filter((d) => d.allowed).length;
            expect(allowed).toBe(50);

            await client.del(key);
            await client.quit();
        });
    }

    // Many independent connections (simulated multiple workers) share one limit.
    it('multiple connections share one global limit', async () => {
        const key = freshKey();
        const clients = await Promise.all(Array.from({ length: 10 }, () => makeClient()));
        const stores = clients.map((client) => new RedisStore({ client }));

        const tasks: Promise<boolean>[] = [];
        for (let i = 0; i < 200; i++) {
            const store = stores[i % stores.length];
            tasks.push(
                store
                    .evaluate(input({ key, algorithm: Algorithm.FIXED_WINDOW, limit: 50, burst: 50 }))
                    .then((d) => d.allowed)
            );
        }
        const allowed = (await Promise.all(tasks)).filter(Boolean).length;
        expect(allowed).toBe(50);

        await clients[0].del(key);
        await Promise.all(clients.map((c) => c.quit()));
    });

    // Token + leaky buckets must never exceed capacity under a concurrent burst.
    it('token/leaky never exceed capacity under race', async () => {
        for (const algorithm of [Algorithm.TOKEN_BUCKET, Algorithm.LEAKY_BUCKET]) {
            const client = await makeClient();
            const store = new RedisStore({ client });
            const key = freshKey();
            const results = await Promise.all(
                Array.from({ length: 300 }, () =>
                    store.evaluate(input({ key, algorithm, limit: 30, burst: 30 }))
                )
            );
            const allowed = results.filter((d) => d.allowed).length;
            expect(allowed).toBeLessThanOrEqual(30);
            expect(allowed).toBe(30);
            await client.del(key);
            await client.quit();
        }
    });

    // Sliding window: entries fall out of the window over time.
    it('sliding-window boundary: count slides after the window passes', async () => {
        const client = await makeClient();
        const store = new RedisStore({ client });
        const key = freshKey();
        const cfg = { key, algorithm: Algorithm.SLIDING_WINDOW, limit: 5, window: 2, burst: 5 };

        let allowed = 0;
        for (let i = 0; i < 8; i++) allowed += (await store.evaluate(input(cfg))).allowed ? 1 : 0;
        expect(allowed).toBe(5); // window full

        await sleep(2200); // let the window slide past

        const after = await store.evaluate(input(cfg));
        expect(after.allowed).toBe(true); // capacity freed up

        await client.del(key);
        await client.quit();
    });

    // Fixed window resets after the window elapses (server-clock driven).
    it('fixed-window resets after the window elapses', async () => {
        const client = await makeClient();
        const store = new RedisStore({ client });
        const key = freshKey();
        const cfg = { key, algorithm: Algorithm.FIXED_WINDOW, limit: 3, window: 1, burst: 3 };

        let allowed = 0;
        for (let i = 0; i < 5; i++) allowed += (await store.evaluate(input(cfg))).allowed ? 1 : 0;
        expect(allowed).toBe(3);

        await sleep(1200); // window elapses

        const after = await store.evaluate(input(cfg));
        expect(after.allowed).toBe(true); // reset to full

        await client.del(key);
        await client.quit();
    });
});
