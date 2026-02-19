/**
 * Next.js adapter for Halt rate limiting.
 */

import { NextRequest, NextResponse } from 'next/server';
import { RateLimiter, RateLimiterOptions } from '../core/limiter';
import { toHeaders } from '../core/decision';
import { Policy } from '../core/policy';

/**
 * Create Next.js middleware for rate limiting.
 */
export function haltMiddleware(options: RateLimiterOptions) {
    const limiter = new RateLimiter(options);

    return async (request: NextRequest) => {
        const decision = await limiter.check(request);

        if (decision.allowed) {
            // Allow request with rate limit headers
            const response = NextResponse.next();
            const headers = toHeaders(decision);
            for (const [key, value] of Object.entries(headers)) {
                response.headers.set(key, value);
            }
            return response;
        } else {
            // Block request
            const headers = toHeaders(decision);
            return NextResponse.json(
                {
                    error: 'rate_limit_exceeded',
                    message: 'Too many requests. Please try again later.',
                    retryAfter: decision.retryAfter,
                },
                {
                    status: 429,
                    headers,
                }
            );
        }
    };
}

/**
 * Wrapper for Next.js route handlers to add rate limiting.
 */
export function withHalt<T extends (...args: any[]) => Promise<Response>>(
    handler: T,
    options: RateLimiterOptions
): T {
    const limiter = new RateLimiter(options);

    return (async (...args: any[]) => {
        const request = args[0] as NextRequest;
        const decision = await limiter.check(request);

        if (decision.allowed) {
            // Call the original handler
            const response = await handler(...args);

            // Add rate limit headers
            const headers = toHeaders(decision);
            for (const [key, value] of Object.entries(headers)) {
                response.headers.set(key, value);
            }

            return response;
        } else {
            // Block request
            const headers = toHeaders(decision);
            return NextResponse.json(
                {
                    error: 'rate_limit_exceeded',
                    message: 'Too many requests. Please try again later.',
                    retryAfter: decision.retryAfter,
                },
                {
                    status: 429,
                    headers,
                }
            );
        }
    }) as T;
}

/**
 * Simple wrapper that accepts just a policy for convenience.
 */
export function withPolicy<T extends (...args: any[]) => Promise<Response>>(
    handler: T,
    policy: Policy,
    store: RateLimiterOptions['store']
): T {
    return withHalt(handler, { store, policy });
}
