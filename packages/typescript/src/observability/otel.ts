/**
 * OpenTelemetry metrics adapter for Halt.
 *
 * Implements `TelemetryHooks` over the OTel metrics API. You inject a Meter, so
 * Halt keeps no hard dependency on `@opentelemetry/api`:
 *
 *   import { metrics } from '@opentelemetry/api';
 *   import { OpenTelemetryMetrics } from 'halt-rate';
 *
 *   const telemetry = new OpenTelemetryMetrics(metrics.getMeter('halt'));
 *   const limiter = new RateLimiter({ store, policy, telemetry });
 *
 * Request spans are already covered by the limiter's `otelTracer` option; this
 * adapter adds counters for dashboards/alerts. Roll up across instances with your
 * OTel collector.
 */

import { Decision } from '../core/decision';
import { TelemetryHooks } from '../core/telemetry';
import { Quota } from '../core/quota';
import { Penalty } from '../core/penalty';

/** Minimal structural types satisfied by `@opentelemetry/api` (no hard dep). */
export interface OTelCounterLike {
    add(value: number, attributes?: Record<string, string | number | boolean>): void;
}
export interface OTelMeterLike {
    createCounter(name: string, options?: { description?: string; unit?: string }): OTelCounterLike;
}

export class OpenTelemetryMetrics implements TelemetryHooks {
    private requests: OTelCounterLike;
    private blocked: OTelCounterLike;
    private cost: OTelCounterLike;
    private quotaExceededCounter: OTelCounterLike;
    private penaltyAppliedCounter: OTelCounterLike;
    private violationsCounter: OTelCounterLike;

    constructor(meter: OTelMeterLike) {
        this.requests = meter.createCounter('halt.requests', {
            description: 'Total rate-limit checks',
        });
        this.blocked = meter.createCounter('halt.blocked', {
            description: 'Rate-limited (blocked) requests',
        });
        this.cost = meter.createCounter('halt.cost', {
            description: 'Consumed request cost (weighted endpoints)',
        });
        this.quotaExceededCounter = meter.createCounter('halt.quota.exceeded', {
            description: 'Quota-exceeded events',
        });
        this.penaltyAppliedCounter = meter.createCounter('halt.penalty.applied', {
            description: 'Penalties applied (abuse controls)',
        });
        this.violationsCounter = meter.createCounter('halt.violations', {
            description: 'Recorded abuse violations',
        });
    }

    onAllowed(_key: string, _decision: Decision, metadata?: Record<string, any>): void {
        const policy = String(metadata?.policy ?? 'unknown');
        this.requests.add(1, { policy, allowed: 'true' });
        const endpoint = metadata?.endpoint;
        const plan = String(metadata?.plan ?? metadata?.policy ?? 'unknown');
        const cost = Number(metadata?.cost ?? 1);
        this.cost.add(cost, endpoint ? { endpoint: String(endpoint), plan } : { plan });
    }

    onBlocked(_key: string, _decision: Decision, metadata?: Record<string, any>): void {
        const policy = String(metadata?.policy ?? 'unknown');
        this.requests.add(1, { policy, allowed: 'false' });
        const endpoint = metadata?.endpoint;
        this.blocked.add(1, endpoint ? { policy, endpoint: String(endpoint) } : { policy });
    }

    onQuotaExceeded(_identifier: string, quota: Quota): void {
        this.quotaExceededCounter.add(1, { quota: quota.name });
    }

    onPenaltyApplied(_identifier: string, _penalty: Penalty): void {
        this.penaltyAppliedCounter.add(1);
    }

    onViolation(_identifier: string, _penalty: Penalty, severity: number): void {
        this.violationsCounter.add(1, { severity });
    }
}
