/**
 * Tests for the Hono and Fastify adapters (lightweight fakes, no real servers).
 */

import { describe, it, expect } from 'vitest';
import { haltMiddleware as honoHalt } from '../src/adapters/hono';
import { haltHook as fastifyHalt } from '../src/adapters/fastify';
import { RateLimiter } from '../src/core/limiter';
import { InMemoryStore } from '../src/stores/memory';
import { Algorithm } from '../src/core/policy';

function makeLimiter(limit = 1) {
    return new RateLimiter({
        store: new InMemoryStore(),
        policy: { name: 'a', limit, window: 60, algorithm: Algorithm.FIXED_WINDOW },
        exemptPrivateIps: false,
    });
}

// ----- Hono -------------------------------------------------------------- //

function fakeHonoCtx(headers: Record<string, string>, path = '/x') {
    const set: Record<string, string> = {};
    return {
        req: {
            header: (n?: string) => (n === undefined ? headers : headers[n.toLowerCase()]),
            path,
            url: `http://localhost${path}`,
        },
        header: (k: string, v: string) => {
            set[k] = v;
        },
        get: () => undefined,
        json: (body: any, status?: number) => ({ body, status: status ?? 200, headers: set }),
        _set: set,
    };
}

describe('Hono adapter', () => {
    it('allows, then blocks with 429 and rate-limit headers', async () => {
        const mw = honoHalt({ limiter: makeLimiter(1) });
        let nextCalls = 0;
        const next = async () => {
            nextCalls++;
        };

        const c1 = fakeHonoCtx({ 'x-forwarded-for': '9.9.9.9' });
        await mw(c1 as any, next);
        expect(nextCalls).toBe(1); // allowed

        const c2 = fakeHonoCtx({ 'x-forwarded-for': '9.9.9.9' });
        const res: any = await mw(c2 as any, next);
        expect(nextCalls).toBe(1); // next NOT called again
        expect(res.status).toBe(429);
        expect(res.body.error).toBe('rate_limit_exceeded');
        expect(c2._set['RateLimit-Limit']).toBe('1');
    });
});

// ----- Fastify ----------------------------------------------------------- //

function fakeReply() {
    const headers: Record<string, string> = {};
    const state: any = { code: 200, body: undefined, headers };
    const reply: any = {
        header: (k: string, v: string) => {
            headers[k] = v;
            return reply;
        },
        code: (c: number) => {
            state.code = c;
            return reply;
        },
        send: (b: any) => {
            state.body = b;
            return reply;
        },
        _state: state,
    };
    return reply;
}

describe('Fastify adapter', () => {
    it('allows, then blocks with 429 and rate-limit headers', async () => {
        const hook = fastifyHalt({ limiter: makeLimiter(1) });
        const req = { ip: '9.9.9.9', headers: {}, url: '/y' };

        const r1 = fakeReply();
        await hook(req as any, r1);
        expect(r1._state.code).toBe(200); // allowed, untouched
        expect(r1._state.headers['RateLimit-Limit']).toBe('1');

        const r2 = fakeReply();
        await hook(req as any, r2);
        expect(r2._state.code).toBe(429); // blocked
        expect(r2._state.body.error).toBe('rate_limit_exceeded');
    });
});
