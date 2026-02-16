/**
 * Telemetry hooks for observability and monitoring.
 */

import { Decision } from './decision';
import { Quota } from './quota';
import { Penalty } from './penalty';

export interface TelemetryHooks {
    onCheck?(key: string, decision: Decision, metadata?: Record<string, any>): void;
    onAllowed?(key: string, decision: Decision, metadata?: Record<string, any>): void;
    onBlocked?(key: string, decision: Decision, metadata?: Record<string, any>): void;
    onQuotaCheck?(identifier: string, quota: Quota, allowed: boolean): void;
    onQuotaExceeded?(identifier: string, quota: Quota): void;
    onPenaltyApplied?(identifier: string, penalty: Penalty): void;
    onViolation?(identifier: string, penalty: Penalty, severity: number): void;
}

export class LoggingTelemetry implements TelemetryHooks {
    constructor(private logger: Console = console) { }

    onCheck(key: string, decision: Decision, metadata?: Record<string, any>): void {
        this.logger.debug(
            `Rate limit check: key=${key}, allowed=${decision.allowed}, ` +
            `remaining=${decision.remaining}, metadata=${JSON.stringify(metadata)}`
        );
    }

    onAllowed(key: string, decision: Decision, metadata?: Record<string, any>): void {
        this.logger.info(`Request allowed: key=${key}, remaining=${decision.remaining}`);
    }

    onBlocked(key: string, decision: Decision, metadata?: Record<string, any>): void {
        this.logger.warn(
            `Request blocked: key=${key}, retry_after=${decision.retryAfter}s, ` +
            `metadata=${JSON.stringify(metadata)}`
        );
    }

    onQuotaCheck(identifier: string, quota: Quota, allowed: boolean): void {
        this.logger.debug(
            `Quota check: identifier=${identifier}, quota=${quota.name}, ` +
            `allowed=${allowed}, remaining=${quota.limit - (quota.currentUsage || 0)}`
        );
    }

    onQuotaExceeded(identifier: string, quota: Quota): void {
        this.logger.warn(
            `Quota exceeded: identifier=${identifier}, quota=${quota.name}, ` +
            `limit=${quota.limit}, reset_at=${quota.resetAt}`
        );
    }

    onPenaltyApplied(identifier: string, penalty: Penalty): void {
        this.logger.warn(
            `Penalty applied: identifier=${identifier}, ` +
            `abuse_score=${penalty.abuseScore}, penalty_until=${penalty.penaltyUntil}`
        );
    }

    onViolation(identifier: string, penalty: Penalty, severity: number): void {
        this.logger.info(
            `Violation recorded: identifier=${identifier}, severity=${severity}, ` +
            `abuse_score=${penalty.abuseScore}, violations=${penalty.violations}`
        );
    }
}

export class MetricsTelemetry implements TelemetryHooks {
    constructor(private metricsClient: any) { }

    onCheck(key: string, decision: Decision, metadata?: Record<string, any>): void {
        this.metricsClient.increment('halt.checks.total', this.getTags(metadata));
    }

    onAllowed(key: string, decision: Decision, metadata?: Record<string, any>): void {
        this.metricsClient.increment('halt.requests.allowed', this.getTags(metadata));
        this.metricsClient.gauge('halt.remaining', decision.remaining, this.getTags(metadata));
    }

    onBlocked(key: string, decision: Decision, metadata?: Record<string, any>): void {
        this.metricsClient.increment('halt.requests.blocked', this.getTags(metadata));
    }

    onQuotaCheck(identifier: string, quota: Quota, allowed: boolean): void {
        const tags = { quota: quota.name, period: quota.period };
        this.metricsClient.increment('halt.quota.checks', tags);
        this.metricsClient.gauge(
            'halt.quota.remaining',
            quota.limit - (quota.currentUsage || 0),
            tags
        );
    }

    onQuotaExceeded(identifier: string, quota: Quota): void {
        const tags = { quota: quota.name, period: quota.period };
        this.metricsClient.increment('halt.quota.exceeded', tags);
    }

    onPenaltyApplied(identifier: string, penalty: Penalty): void {
        this.metricsClient.increment('halt.penalties.applied');
        this.metricsClient.gauge('halt.penalties.abuse_score', penalty.abuseScore);
    }

    onViolation(identifier: string, penalty: Penalty, severity: number): void {
        this.metricsClient.increment('halt.violations.total');
        this.metricsClient.histogram('halt.violations.severity', severity);
    }

    private getTags(metadata?: Record<string, any>): Record<string, any> {
        if (!metadata) {
            return {};
        }

        return {
            policy: metadata.policy,
            algorithm: metadata.algorithm,
        };
    }
}

export class CompositeTelemetry implements TelemetryHooks {
    constructor(private hooks: TelemetryHooks[]) { }

    onCheck(key: string, decision: Decision, metadata?: Record<string, any>): void {
        this.hooks.forEach((hook) => hook.onCheck?.(key, decision, metadata));
    }

    onAllowed(key: string, decision: Decision, metadata?: Record<string, any>): void {
        this.hooks.forEach((hook) => hook.onAllowed?.(key, decision, metadata));
    }

    onBlocked(key: string, decision: Decision, metadata?: Record<string, any>): void {
        this.hooks.forEach((hook) => hook.onBlocked?.(key, decision, metadata));
    }

    onQuotaCheck(identifier: string, quota: Quota, allowed: boolean): void {
        this.hooks.forEach((hook) => hook.onQuotaCheck?.(identifier, quota, allowed));
    }

    onQuotaExceeded(identifier: string, quota: Quota): void {
        this.hooks.forEach((hook) => hook.onQuotaExceeded?.(identifier, quota));
    }

    onPenaltyApplied(identifier: string, penalty: Penalty): void {
        this.hooks.forEach((hook) => hook.onPenaltyApplied?.(identifier, penalty));
    }

    onViolation(identifier: string, penalty: Penalty, severity: number): void {
        this.hooks.forEach((hook) => hook.onViolation?.(identifier, penalty, severity));
    }
}
