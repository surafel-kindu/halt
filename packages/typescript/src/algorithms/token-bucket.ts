/**
 * Token bucket rate limiting algorithm.
 */

import { Decision } from '../core/decision';

export interface TokenBucketState {
    tokens: number;
    lastRefill: number;
}

export class TokenBucket {
    private capacity: number;
    private rate: number;
    private window: number;

    constructor(capacity: number, rate: number, window: number) {
        this.capacity = capacity;
        this.rate = rate / window; // tokens per second
        this.window = window;
    }

    /**
     * Check if request is allowed and consume tokens.
     */
    checkAndConsume(
        currentTokens: number,
        lastRefill: number,
        cost: number,
        now: number = Date.now() / 1000
    ): { decision: Decision; newTokens: number; newLastRefill: number } {
        // Refill tokens based on elapsed time
        const elapsed = now - lastRefill;
        const refillAmount = elapsed * this.rate;
        const newTokens = Math.min(this.capacity, currentTokens + refillAmount);

        // Calculate reset time (when bucket will be full)
        const tokensNeeded = this.capacity - newTokens;
        const resetAt = Math.floor(now + tokensNeeded / this.rate);

        // Check if we have enough tokens
        if (newTokens >= cost) {
            // Consume tokens
            const tokensAfterConsume = newTokens - cost;
            const remaining = Math.floor(tokensAfterConsume);

            return {
                decision: {
                    allowed: true,
                    limit: Math.floor(this.rate * this.window),
                    remaining,
                    resetAt,
                },
                newTokens: tokensAfterConsume,
                newLastRefill: now,
            };
        } else {
            // Not enough tokens
            const tokensDeficit = cost - newTokens;
            const retryAfter = Math.floor(tokensDeficit / this.rate) + 1;

            return {
                decision: {
                    allowed: false,
                    limit: Math.floor(this.rate * this.window),
                    remaining: 0,
                    resetAt,
                    retryAfter,
                },
                newTokens,
                newLastRefill: lastRefill, // Don't update last_refill on rejection
            };
        }
    }

    /**
     * Get initial state for a new key.
     */
    initialState(now: number = Date.now() / 1000): TokenBucketState {
        return {
            tokens: this.capacity,
            lastRefill: now,
        };
    }
}
