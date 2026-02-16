/**
 * Preset rate limiting policies for common use cases.
 */

import { Policy, KeyStrategy, Algorithm } from '../core/policy';

// Public API - moderate limits for general public access
export const PUBLIC_API: Policy = {
    name: 'public_api',
    limit: 100,
    window: 60, // 1 minute
    burst: 120,
    algorithm: Algorithm.TOKEN_BUCKET,
    keyStrategy: KeyStrategy.IP,
};

// Authentication endpoints - strict limits to prevent brute force
export const AUTH_ENDPOINTS: Policy = {
    name: 'auth_endpoints',
    limit: 5,
    window: 60, // 1 minute
    burst: 10,
    algorithm: Algorithm.TOKEN_BUCKET,
    keyStrategy: KeyStrategy.IP,
    blockDuration: 300, // 5 minute cooldown after limit exceeded
};

// Expensive operations - very strict limits for resource-intensive endpoints
export const EXPENSIVE_OPS: Policy = {
    name: 'expensive_ops',
    limit: 10,
    window: 3600, // 1 hour
    burst: 15,
    cost: 10, // Each request costs 10 tokens
    algorithm: Algorithm.TOKEN_BUCKET,
    keyStrategy: KeyStrategy.USER,
};

// Strict API - for sensitive operations
export const STRICT_API: Policy = {
    name: 'strict_api',
    limit: 20,
    window: 60, // 1 minute
    burst: 25,
    algorithm: Algorithm.TOKEN_BUCKET,
    keyStrategy: KeyStrategy.API_KEY,
};

// Generous API - for internal or trusted services
export const GENEROUS_API: Policy = {
    name: 'generous_api',
    limit: 1000,
    window: 60, // 1 minute
    burst: 1200,
    algorithm: Algorithm.TOKEN_BUCKET,
    keyStrategy: KeyStrategy.IP,
};

// Plan-based presets for SaaS platforms
export const PLAN_FREE: Policy = {
    name: 'free_plan',
    limit: 100,
    window: 3600, // 100 requests per hour
    burst: 120,
    algorithm: Algorithm.TOKEN_BUCKET,
    keyStrategy: KeyStrategy.USER,
};

export const PLAN_STARTER: Policy = {
    name: 'starter_plan',
    limit: 500,
    window: 3600, // 500 requests per hour
    burst: 600,
    algorithm: Algorithm.TOKEN_BUCKET,
    keyStrategy: KeyStrategy.USER,
};

export const PLAN_PRO: Policy = {
    name: 'pro_plan',
    limit: 2000,
    window: 3600, // 2000 requests per hour
    burst: 2500,
    algorithm: Algorithm.TOKEN_BUCKET,
    keyStrategy: KeyStrategy.USER,
};

export const PLAN_BUSINESS: Policy = {
    name: 'business_plan',
    limit: 5000,
    window: 3600, // 5000 requests per hour
    burst: 6000,
    algorithm: Algorithm.TOKEN_BUCKET,
    keyStrategy: KeyStrategy.USER,
};

export const PLAN_ENTERPRISE: Policy = {
    name: 'enterprise_plan',
    limit: 20000,
    window: 3600, // 20000 requests per hour
    burst: 25000,
    algorithm: Algorithm.TOKEN_BUCKET,
    keyStrategy: KeyStrategy.USER,
};

// Plan mapping helper
export const PLAN_TIERS: Record<string, Policy> = {
    free: PLAN_FREE,
    starter: PLAN_STARTER,
    pro: PLAN_PRO,
    business: PLAN_BUSINESS,
    enterprise: PLAN_ENTERPRISE,
};

/**
 * Get policy for a plan tier.
 * @param planName - Plan tier name (free, starter, pro, business, enterprise)
 * @returns Policy for the plan
 * @throws Error if plan name is invalid
 */
export function getPlanPolicy(planName: string): Policy {
    const normalized = planName.toLowerCase();
    if (!(normalized in PLAN_TIERS)) {
        throw new Error(
            `Invalid plan: ${planName}. Valid plans: ${Object.keys(PLAN_TIERS).join(', ')}`
        );
    }
    return PLAN_TIERS[normalized];
}
