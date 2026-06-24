/**
 * In-process statistics collector for rate-limit observability.
 *
 * Implements `TelemetryHooks`, so you plug it into a RateLimiter (and optionally
 * QuotaManager / PenaltyManager) and it aggregates everything in memory. Call
 * `snapshot()` to expose a `/halt/stats` endpoint or log periodically.
 *
 * It is per-process by design — for a fleet, run it on each instance and roll up
 * across instances with the OpenTelemetry adapter (see observability/otel). Memory
 * is bounded: the tracked-key table is capped and the smallest counters are evicted.
 *
 *   const stats = new StatsCollector();
 *   const limiter = new RateLimiter({ store, policy, telemetry: stats });
 *   app.get('/halt/stats', (_req, res) => res.json(stats.snapshot()));
 */

import { Decision } from './decision';
import { TelemetryHooks } from './telemetry';
import { Quota } from './quota';
import { Penalty } from './penalty';

export interface StatsCollectorOptions {
    /** How many top limited keys `snapshot()` returns (default 20). */
    topN?: number;
    /** Max distinct keys tracked for the top-N table before eviction (default 10000). */
    maxTrackedKeys?: number;
}

interface Tally {
    allowed: number;
    blocked: number;
}

interface EndpointTally extends Tally {
    cost: number;
}

export interface StatsSnapshot {
    allowedTotal: number;
    blockedTotal: number;
    /** Per-policy allowed/blocked counts. */
    byPolicy: Record<string, Tally>;
    /** Per-endpoint allowed/blocked counts and consumed cost. */
    byEndpoint: Record<string, EndpointTally>;
    /** Highest-blocked keys (users / API keys / IPs), descending. */
    topLimitedKeys: Array<{ key: string; blocked: number }>;
    /** Consumed cost per plan (allowed requests only). */
    costByPlan: Record<string, number>;
    /** Count of quota-exceeded events (from QuotaManager telemetry). */
    quotaExceeded: number;
    /** Count of penalties applied (from PenaltyManager telemetry). */
    penaltiesApplied: number;
    /** Count of recorded violations (from PenaltyManager telemetry). */
    violations: number;
    /** Number of distinct keys currently tracked for top-N. */
    trackedKeys: number;
}

export class StatsCollector implements TelemetryHooks {
    private topN: number;
    private maxTrackedKeys: number;

    private allowedTotal = 0;
    private blockedTotal = 0;
    private byPolicy = new Map<string, Tally>();
    private byEndpoint = new Map<string, EndpointTally>();
    private limitedKeys = new Map<string, number>();
    private costByPlan = new Map<string, number>();
    private quotaExceededCount = 0;
    private penaltiesAppliedCount = 0;
    private violationsCount = 0;

    constructor(options: StatsCollectorOptions = {}) {
        this.topN = options.topN ?? 20;
        this.maxTrackedKeys = options.maxTrackedKeys ?? 10000;
    }

    onAllowed(_key: string, _decision: Decision, metadata?: Record<string, any>): void {
        this.allowedTotal++;
        const cost = Number(metadata?.cost ?? 1);
        this.policyTally(metadata).allowed++;

        const endpoint = metadata?.endpoint;
        if (endpoint) {
            const e = this.endpointTally(endpoint);
            e.allowed++;
            e.cost += cost;
        }

        const plan = metadata?.plan ?? metadata?.policy ?? 'unknown';
        this.costByPlan.set(plan, (this.costByPlan.get(plan) ?? 0) + cost);
    }

    onBlocked(key: string, _decision: Decision, metadata?: Record<string, any>): void {
        this.blockedTotal++;
        this.policyTally(metadata).blocked++;

        const endpoint = metadata?.endpoint;
        if (endpoint) {
            this.endpointTally(endpoint).blocked++;
        }

        if (key) this.trackLimitedKey(key);
    }

    onQuotaExceeded(_identifier: string, _quota: Quota): void {
        this.quotaExceededCount++;
    }

    onPenaltyApplied(_identifier: string, _penalty: Penalty): void {
        this.penaltiesAppliedCount++;
    }

    onViolation(_identifier: string, _penalty: Penalty, _severity: number): void {
        this.violationsCount++;
    }

    /** Point-in-time view of the aggregated stats. */
    snapshot(): StatsSnapshot {
        const topLimitedKeys = [...this.limitedKeys.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, this.topN)
            .map(([key, blocked]) => ({ key, blocked }));

        return {
            allowedTotal: this.allowedTotal,
            blockedTotal: this.blockedTotal,
            byPolicy: mapToObject(this.byPolicy),
            byEndpoint: mapToObject(this.byEndpoint),
            topLimitedKeys,
            costByPlan: mapToObject(this.costByPlan),
            quotaExceeded: this.quotaExceededCount,
            penaltiesApplied: this.penaltiesAppliedCount,
            violations: this.violationsCount,
            trackedKeys: this.limitedKeys.size,
        };
    }

    /** Clear all counters (e.g. after exporting). */
    reset(): void {
        this.allowedTotal = 0;
        this.blockedTotal = 0;
        this.byPolicy.clear();
        this.byEndpoint.clear();
        this.limitedKeys.clear();
        this.costByPlan.clear();
        this.quotaExceededCount = 0;
        this.penaltiesAppliedCount = 0;
        this.violationsCount = 0;
    }

    private policyTally(metadata?: Record<string, any>): Tally {
        const policy = metadata?.policy ?? 'unknown';
        let t = this.byPolicy.get(policy);
        if (!t) {
            t = { allowed: 0, blocked: 0 };
            this.byPolicy.set(policy, t);
        }
        return t;
    }

    private endpointTally(endpoint: string): EndpointTally {
        let e = this.byEndpoint.get(endpoint);
        if (!e) {
            e = { allowed: 0, blocked: 0, cost: 0 };
            this.byEndpoint.set(endpoint, e);
        }
        return e;
    }

    private trackLimitedKey(key: string): void {
        const current = this.limitedKeys.get(key);
        if (current !== undefined) {
            this.limitedKeys.set(key, current + 1);
            return;
        }
        if (this.limitedKeys.size >= this.maxTrackedKeys) {
            this.evictSmallest();
        }
        this.limitedKeys.set(key, 1);
    }

    /** Evict the lowest-count tracked key to keep memory bounded. */
    private evictSmallest(): void {
        let minKey: string | undefined;
        let minVal = Infinity;
        for (const [k, v] of this.limitedKeys) {
            if (v < minVal) {
                minVal = v;
                minKey = k;
            }
        }
        if (minKey !== undefined) this.limitedKeys.delete(minKey);
    }
}

function mapToObject<V>(map: Map<string, V>): Record<string, V> {
    const out: Record<string, V> = {};
    for (const [k, v] of map) out[k] = v;
    return out;
}
