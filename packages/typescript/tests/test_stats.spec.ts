/**
 * Unit tests for the in-process StatsCollector (pure, no Redis).
 */

import { describe, it, expect } from 'vitest';
import { StatsCollector } from '../src/core/stats';
import { RateLimiter } from '../src/core/limiter';
import { InMemoryStore } from '../src/stores/memory';
import { Decision } from '../src/core/decision';

const allow: Decision = { allowed: true, limit: 10, remaining: 9, resetAt: 0 };
const block: Decision = { allowed: false, limit: 10, remaining: 0, resetAt: 0, retryAfter: 5 };

describe('StatsCollector', () => {
    it('counts allowed/blocked totals and per-policy/endpoint', () => {
        const s = new StatsCollector();
        s.onAllowed('u1', allow, { policy: 'api', endpoint: '/a', cost: 2, plan: 'pro' });
        s.onAllowed('u1', allow, { policy: 'api', endpoint: '/a', cost: 3, plan: 'pro' });
        s.onBlocked('u2', block, { policy: 'api', endpoint: '/a' });

        const snap = s.snapshot();
        expect(snap.allowedTotal).toBe(2);
        expect(snap.blockedTotal).toBe(1);
        expect(snap.byPolicy.api).toEqual({ allowed: 2, blocked: 1 });
        expect(snap.byEndpoint['/a']).toEqual({ allowed: 2, blocked: 1, cost: 5 });
    });

    it('tracks top limited keys in descending order', () => {
        const s = new StatsCollector();
        for (let i = 0; i < 3; i++) s.onBlocked('heavy', block, { policy: 'api' });
        s.onBlocked('light', block, { policy: 'api' });

        const top = s.snapshot().topLimitedKeys;
        expect(top[0]).toEqual({ key: 'heavy', blocked: 3 });
        expect(top[1]).toEqual({ key: 'light', blocked: 1 });
    });

    it('respects topN limit', () => {
        const s = new StatsCollector({ topN: 2 });
        for (const k of ['a', 'b', 'c', 'd']) s.onBlocked(k, block, { policy: 'api' });
        expect(s.snapshot().topLimitedKeys).toHaveLength(2);
    });

    it('sums consumed cost per plan (allowed only)', () => {
        const s = new StatsCollector();
        s.onAllowed('u1', allow, { policy: 'p', cost: 4, plan: 'free' });
        s.onAllowed('u2', allow, { policy: 'p', cost: 6, plan: 'pro' });
        s.onBlocked('u3', block, { policy: 'p', cost: 99, plan: 'pro' }); // not counted

        expect(s.snapshot().costByPlan).toEqual({ free: 4, pro: 6 });
    });

    it('evicts smallest when exceeding maxTrackedKeys', () => {
        const s = new StatsCollector({ maxTrackedKeys: 2 });
        s.onBlocked('keep', block, {});
        s.onBlocked('keep', block, {}); // count 2
        s.onBlocked('drop', block, {}); // count 1
        s.onBlocked('new', block, {}); // triggers eviction of 'drop'

        const keys = s.snapshot().topLimitedKeys.map((k) => k.key);
        expect(keys).toContain('keep');
        expect(keys).not.toContain('drop');
    });

    it('counts quota/penalty/violation events', () => {
        const s = new StatsCollector();
        s.onQuotaExceeded('u1', { name: 'q', limit: 1, period: 'monthly' as any });
        s.onPenaltyApplied('u1', {} as any);
        s.onViolation('u1', {} as any, 1);
        const snap = s.snapshot();
        expect(snap.quotaExceeded).toBe(1);
        expect(snap.penaltiesApplied).toBe(1);
        expect(snap.violations).toBe(1);
    });

    it('reset() clears all counters', () => {
        const s = new StatsCollector();
        s.onAllowed('u', allow, { policy: 'p' });
        s.reset();
        expect(s.snapshot().allowedTotal).toBe(0);
        expect(s.snapshot().trackedKeys).toBe(0);
    });

    it('wires into the limiter end-to-end', async () => {
        const s = new StatsCollector();
        const limiter = new RateLimiter({
            store: new InMemoryStore(),
            policy: { name: 'tiny', limit: 1, window: 60, plan: 'free' },
            exemptPrivateIps: false,
            telemetry: s,
        });
        const req = { socket: { remoteAddress: '8.8.8.8' }, url: '/x' };
        await limiter.check(req); // allowed (burst)
        await limiter.check(req);
        await limiter.check(req);

        const snap = s.snapshot();
        expect(snap.allowedTotal + snap.blockedTotal).toBe(3);
        expect(snap.blockedTotal).toBeGreaterThan(0);
        expect(snap.byPolicy.tiny).toBeDefined();
    });
});
