/**
 * Hono adapter for Halt rate limiting.
 *
 * Works on Node and on edge runtimes (Cloudflare Workers, Deno, Bun, Vercel Edge)
 * when paired with an edge-compatible store (the in-memory store, or a Redis client
 * satisfying `RedisClientLike`).
 *
 *   import { Hono } from 'hono';
 *   import { RateLimiter, InMemoryStore, presets } from 'halt-rate';
 *   import { haltMiddleware } from 'halt-rate/hono';
 *
 *   const limiter = new RateLimiter({ store: new InMemoryStore(), policy: presets.PUBLIC_API });
 *   const app = new Hono();
 *   app.use('*', haltMiddleware({ limiter }));
 */

import type { Context, Next } from 'hono';
import { RateLimiter } from '../core/limiter';
import { toHeaders } from '../core/decision';

export interface HonoHaltOptions {
    limiter: RateLimiter;
    /** Custom blocked response; return a Response. */
    onBlocked?: (c: Context) => Response | Promise<Response>;
    /** Resolve the client IP (edge runtimes have no socket). Defaults to common headers. */
    getClientIp?: (c: Context) => string | undefined;
}

function defaultClientIp(c: Context): string | undefined {
    const h = (name: string) => c.req.header(name);
    const xff = h('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim();
    return h('cf-connecting-ip') || h('x-real-ip') || undefined;
}

/** Create a Hono middleware for rate limiting. */
export function haltMiddleware(options: HonoHaltOptions) {
    const { limiter, onBlocked, getClientIp = defaultClientIp } = options;

    return async (c: Context, next: Next) => {
        const request = {
            headers: c.req.header(), // Record<string, string>, lowercased keys
            ip: getClientIp(c),
            path: c.req.path,
            url: c.req.url,
            user: c.get('user'),
        };

        const decision = await limiter.check(request);

        for (const [key, value] of Object.entries(toHeaders(decision))) {
            c.header(key, value);
        }

        if (decision.allowed) {
            await next();
            return;
        }

        if (onBlocked) return onBlocked(c);
        return c.json(
            {
                error: 'rate_limit_exceeded',
                message: 'Too many requests. Please try again later.',
                retryAfter: decision.retryAfter,
            },
            429
        );
    };
}
