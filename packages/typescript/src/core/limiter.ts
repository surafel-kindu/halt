/**
 * Main rate limiter implementation.
 */

import { Decision } from './decision';
import { Policy, KeyStrategy, Algorithm, normalizePolicy } from './policy';
import {
    extractIp,
    extractUserId,
    extractApiKey,
    extractPath,
    isHealthCheck,
    isPrivateIp,
} from './extractors';
import { TokenBucket, TokenBucketState } from '../algorithms/token-bucket';
import { FixedWindow, FixedWindowState } from '../algorithms/fixed-window';
import { SlidingWindow, SlidingWindowState } from '../algorithms/sliding-window';
import { LeakyBucket } from '../algorithms/leaky-bucket';
import { Store } from '../stores/memory';

type AlgorithmInstance = TokenBucket | FixedWindow | SlidingWindow | LeakyBucket;

export interface RateLimiterOptions {
    store: Store;
    /** Either a static policy or a resolver returning a policy per-request */
    policy: Policy | ((request: any) => Policy | Promise<Policy>);
    trustedProxies?: string[];
    exemptPrivateIps?: boolean;
    /** Optional OpenTelemetry-like tracer (object with startSpan) */
    otelTracer?: any;
    /** Optional metrics recorder: (name, tags?, value?) => void */
    metricsRecorder?: (name: string, tags?: Record<string, string>, value?: number) => void;
}

export class RateLimiter {
    private store: Store;
    private policyOrResolver: Policy | ((request: any) => Policy | Promise<Policy>);
    private trustedProxies: string[];
    private exemptPrivateIps: boolean;
    private algorithmCache: Map<string, AlgorithmInstance>;
    private otelTracer?: any;
    private metricsRecorder?: (name: string, tags?: Record<string, string>, value?: number) => void;

    constructor(options: RateLimiterOptions) {
        this.store = options.store;
        this.policyOrResolver = options.policy;
        this.trustedProxies = options.trustedProxies ?? [];
        this.exemptPrivateIps = options.exemptPrivateIps ?? true;
        this.algorithmCache = new Map();
        this.otelTracer = options.otelTracer;
        this.metricsRecorder = options.metricsRecorder;
    }

    /**
     * Check if request is allowed under rate limit.
     */
    /**
     * Check if request is allowed under rate limit.
     * This method is async because policy resolution may be async (e.g. DB lookup).
     */
    async check(request: any, cost?: number): Promise<Decision> {
        // Resolve policy (static or per-request)
        const resolved =
            typeof this.policyOrResolver === 'function'
                ? await (this.policyOrResolver as (r: any) => Policy | Promise<Policy>)(request)
                : (this.policyOrResolver as Policy);

        const policy = normalizePolicy(resolved);
        const requestCost = cost ?? policy.cost;

        // Quick exemptions check (policy-aware)
        if (this.isExempt(request, policy)) {
            const resp: Decision = {
                allowed: true,
                limit: policy.limit,
                remaining: policy.limit,
                resetAt: Math.floor(Date.now() / 1000 + policy.window),
            };
            this.metricsRecorder?.('halt.request.exempt', { policy: policy.name }, 1);
            return resp;
        }

        // Extract key
        const key = this.extractKey(request, policy);
        if (!key) {
            const resp: Decision = {
                allowed: true,
                limit: policy.limit,
                remaining: policy.limit,
                resetAt: Math.floor(Date.now() / 1000 + policy.window),
            };
            this.metricsRecorder?.('halt.request.no_key', { policy: policy.name }, 1);
            return resp;
        }

        const storageKey = `halt:${policy.name}:${key}`;

        // Get or create algorithm instance for this policy
        let algorithm = this.algorithmCache.get(policy.name);
        if (!algorithm) {
            if (policy.algorithm === Algorithm.TOKEN_BUCKET) {
                algorithm = new TokenBucket(policy.burst, policy.limit, policy.window);
            } else if (policy.algorithm === Algorithm.FIXED_WINDOW) {
                algorithm = new FixedWindow(policy.limit, policy.window);
            } else if (policy.algorithm === Algorithm.SLIDING_WINDOW) {
                algorithm = new SlidingWindow(policy.limit, policy.window);
            } else if (policy.algorithm === Algorithm.LEAKY_BUCKET) {
                const leakRate = policy.limit / policy.window;
                algorithm = new LeakyBucket(policy.burst, leakRate, policy.window);
            } else {
                throw new Error(`Algorithm ${policy.algorithm} not implemented`);
            }
            this.algorithmCache.set(policy.name, algorithm);
        }

        // Instrumentation: start a span if tracer available
        const span = this.otelTracer?.startSpan?.('halt.check', { attributes: { policy: policy.name, key } });

        const state = this.store.get(storageKey);
        let decision: Decision;

        if (algorithm instanceof TokenBucket) {
            let tokens: number;
            let lastRefill: number;

            if (!state) {
                const initialState = algorithm.initialState();
                tokens = initialState.tokens;
                lastRefill = initialState.lastRefill;
            } else {
                tokens = state.tokens;
                lastRefill = state.lastRefill;
            }

            const result = algorithm.checkAndConsume(tokens, lastRefill, requestCost);
            decision = result.decision;

            const ttl = policy.window * 2;
            this.store.set(storageKey, { tokens: result.newTokens, lastRefill: result.newLastRefill }, ttl);
        } else if (algorithm instanceof FixedWindow) {
            let count: number;
            let windowStart: number;

            if (!state) {
                const initialState = algorithm.initialState();
                count = initialState.count;
                windowStart = initialState.windowStart;
            } else {
                count = state.count;
                windowStart = state.windowStart;
            }

            const result = algorithm.checkAndConsume(count, windowStart, requestCost);
            decision = result.decision;

            const ttl = policy.window * 2;
            this.store.set(storageKey, { count: result.newCount, windowStart: result.newWindowStart }, ttl);
        } else if (algorithm instanceof SlidingWindow) {
            const buckets = state || algorithm.initialState();
            const result = algorithm.checkAndConsume(buckets, requestCost);
            decision = result.decision;

            const ttl = policy.window * 2;
            this.store.set(storageKey, result.newBuckets, ttl);
        } else if (algorithm instanceof LeakyBucket) {
            let level: number;
            let lastLeak: number;

            if (!state) {
                const initialState = algorithm.initialState();
                level = initialState.level;
                lastLeak = initialState.lastLeak;
            } else {
                level = state.level;
                lastLeak = state.lastLeak;
            }

            const result = algorithm.checkAndConsume(level, lastLeak, requestCost);
            decision = result.decision;

            const ttl = policy.window * 2;
            this.store.set(storageKey, { level: result.newLevel, lastLeak: result.newLastLeak }, ttl);
        } else {
            throw new Error(`Algorithm ${typeof algorithm} not supported`);
        }

        // Metrics and telemetry
        this.metricsRecorder?.('halt.request.checked', { policy: policy.name, allowed: String(decision.allowed) }, 1);
        if (decision.allowed) {
            this.metricsRecorder?.('halt.request.allowed', { policy: policy.name }, 1);
        } else {
            this.metricsRecorder?.('halt.request.blocked', { policy: policy.name }, 1);
        }

        span?.end?.();

        return decision;
    }

    /**
     * Extract rate limit key from request based on policy strategy.
     */
    private extractKey(request: any): string | null {
        // Use custom extractor if provided
        if (this.policy.keyExtractor) {
            return this.policy.keyExtractor(request);
        }

        // Use built-in strategies
        if (this.policy.keyStrategy === KeyStrategy.IP) {
            return extractIp(request, this.trustedProxies);
        }

        if (this.policy.keyStrategy === KeyStrategy.USER) {
            return extractUserId(request);
        }

        if (this.policy.keyStrategy === KeyStrategy.API_KEY) {
            return extractApiKey(request);
        }

        if (this.policy.keyStrategy === KeyStrategy.COMPOSITE) {
            // Composite: user:ip or api_key:ip
            const user = extractUserId(request);
            const apiKey = extractApiKey(request);
            const ip = extractIp(request, this.trustedProxies);

            if (user && ip) {
                return `${user}:${ip}`;
            } else if (apiKey && ip) {
                return `${apiKey}:${ip}`;
            } else if (user) {
                return user;
            } else if (apiKey) {
                return apiKey;
            } else {
                return ip;
            }
        }

        return null;
    }

    /**
     * Check if request is exempt from rate limiting.
     */
    private isExempt(request: any): boolean {
        // Check health check paths
        const path = extractPath(request);
        if (path && isHealthCheck(path)) {
            return true;
        }

        // Check custom exemptions
        if (path && this.policy.exemptions.includes(path)) {
            return true;
        }

        // Check private IPs
        if (this.exemptPrivateIps) {
            const ip = extractIp(request, this.trustedProxies);
            if (ip && isPrivateIp(ip)) {
                return true;
            }
        }

        // Check IP exemptions
        const ip = extractIp(request, this.trustedProxies);
        if (ip && this.policy.exemptions.includes(ip)) {
            return true;
        }

        return false;
    }
}
