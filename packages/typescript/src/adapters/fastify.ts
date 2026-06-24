/**
 * Fastify adapter for Halt rate limiting.
 *
 *   import Fastify from 'fastify';
 *   import { RateLimiter, InMemoryStore, presets } from 'halt-rate';
 *   import { haltHook } from 'halt-rate/fastify';
 *
 *   const limiter = new RateLimiter({ store: new InMemoryStore(), policy: presets.PUBLIC_API });
 *   const app = Fastify();
 *   app.addHook('preHandler', haltHook({ limiter }));
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { RateLimiter } from '../core/limiter';
import { toHeaders } from '../core/decision';

export interface FastifyHaltOptions {
    limiter: RateLimiter;
    /** Custom blocked response. */
    onBlocked?: (request: FastifyRequest, reply: FastifyReply) => unknown;
}

/**
 * Create a Fastify `preHandler` hook for rate limiting. Fastify's request already
 * exposes `ip`, `headers`, and `url`, which Halt's extractors understand directly.
 */
export function haltHook(options: FastifyHaltOptions) {
    const { limiter, onBlocked } = options;

    return async (request: FastifyRequest, reply: FastifyReply) => {
        const decision = await limiter.check(request);

        for (const [key, value] of Object.entries(toHeaders(decision))) {
            reply.header(key, value);
        }

        if (decision.allowed) return;

        if (onBlocked) return onBlocked(request, reply);
        return reply.code(429).send({
            error: 'rate_limit_exceeded',
            message: 'Too many requests. Please try again later.',
            retryAfter: decision.retryAfter,
        });
    };
}

/** Alias for symmetry with the other adapters. */
export const haltMiddleware = haltHook;
