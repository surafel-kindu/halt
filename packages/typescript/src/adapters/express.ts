/**
 * Express middleware adapter for Halt rate limiting.
 */

import { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../core/limiter';
import { toHeaders } from '../core/decision';

export interface ExpressHaltOptions {
    limiter: RateLimiter;
    onBlocked?: (req: Request, res: Response) => void;
}

/**
 * Create Express middleware for rate limiting.
 */
export function haltMiddleware(options: ExpressHaltOptions) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(options.limiter.check(req)).then((decision) => {
            if (decision.allowed) {
                const headers = toHeaders(decision);
                for (const [key, value] of Object.entries(headers)) {
                    res.setHeader(key, value);
                }
                next();
            } else {
                if (options.onBlocked) {
                    options.onBlocked(req, res);
                } else {
                    const headers = toHeaders(decision);
                    for (const [key, value] of Object.entries(headers)) {
                        res.setHeader(key, value);
                    }

                    res.status(429).json({
                        error: 'rate_limit_exceeded',
                        message: 'Too many requests. Please try again later.',
                        retryAfter: decision.retryAfter,
                    });
                }
            }
        }).catch(next);
    };
}

/**
 * Create a route-specific rate limiter middleware.
 */
export function createLimiter(limiter: RateLimiter) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(limiter.check(req)).then((decision) => {
            if (decision.allowed) {
                const headers = toHeaders(decision);
                for (const [key, value] of Object.entries(headers)) {
                    res.setHeader(key, value);
                }
                next();
            } else {
                const headers = toHeaders(decision);
                for (const [key, value] of Object.entries(headers)) {
                    res.setHeader(key, value);
                }

                res.status(429).json({
                    error: 'rate_limit_exceeded',
                    message: 'Too many requests. Please try again later.',
                    retryAfter: decision.retryAfter,
                });
            }
        }).catch(next);
    };
}
