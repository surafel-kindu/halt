/**
 * Policy model for rate limiting configuration.
 */

export enum KeyStrategy {
    IP = 'ip',
    USER = 'user',
    API_KEY = 'api_key',
    COMPOSITE = 'composite',
    CUSTOM = 'custom',
}

export enum Algorithm {
    TOKEN_BUCKET = 'token_bucket',
    FIXED_WINDOW = 'fixed_window',
    SLIDING_WINDOW = 'sliding_window',
    LEAKY_BUCKET = 'leaky_bucket',
}

export interface Policy {
    /** Human-readable policy name */
    name: string;
    /** Maximum number of requests allowed */
    limit: number;
    /** Time window in seconds */
    window: number;
    /** Rate limiting algorithm to use */
    algorithm?: Algorithm;
    /** Strategy for extracting the rate limit key */
    keyStrategy?: KeyStrategy;
    /** Maximum burst size (for token bucket) */
    burst?: number;
    /** Number of sub-windows for sliding window (higher = more accurate, more memory) */
    slidingPrecision?: number;
    /** Cost per request (default: 1) */
    cost?: number;
    /** Duration to block after limit exceeded (seconds) */
    blockDuration?: number;
    /** Custom function to extract key from request */
    keyExtractor?: (request: any) => string | null;
    /** List of paths or IPs to exempt from rate limiting */
    exemptions?: string[];
    /** Optional plan/tier label for observability tagging (e.g. "pro"). */
    plan?: string;
}

/**
 * Validate and normalize policy configuration.
 */
export function normalizePolicy(policy: Policy): Required<Policy> {
    const normalized: Required<Policy> = {
        name: policy.name,
        limit: policy.limit,
        window: policy.window,
        algorithm: policy.algorithm ?? Algorithm.TOKEN_BUCKET,
        keyStrategy: policy.keyStrategy ?? KeyStrategy.IP,
        burst: policy.burst ?? Math.floor(policy.limit * 1.2),
        slidingPrecision: policy.slidingPrecision ?? 10,
        cost: policy.cost ?? 1,
        blockDuration: policy.blockDuration ?? undefined,
        keyExtractor: policy.keyExtractor ?? undefined,
        exemptions: policy.exemptions ?? [],
        plan: policy.plan ?? undefined,
    } as Required<Policy>;

    // Validation
    if (normalized.limit <= 0) {
        throw new Error('limit must be positive');
    }

    if (normalized.window <= 0) {
        throw new Error('window must be positive');
    }

    if (normalized.cost <= 0) {
        throw new Error('cost must be positive');
    }

    if (!Number.isInteger(normalized.slidingPrecision) || normalized.slidingPrecision <= 0) {
        throw new Error('slidingPrecision must be a positive integer');
    }

    if (normalized.burst < normalized.limit) {
        throw new Error('burst must be >= limit');
    }

    return normalized;
}
