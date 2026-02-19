import { describe, it, expect, vi } from 'vitest';
import { RateLimiter } from '../src/core/limiter';
import { InMemoryStore } from '../src/stores/memory';
import { PLAN_FREE, PLAN_PRO } from '../src/presets';

describe('Policy resolver', () => {
  it('resolves per-user policy and applies limits', async () => {
    const store = new InMemoryStore();
    const resolver = (req: any) => (req.user?.id === 'user_pro' ? PLAN_PRO : PLAN_FREE);
    const metrics = vi.fn();

    const limiter = new RateLimiter({ store, policy: resolver, metricsRecorder: metrics });

    const req = { user: { id: 'user_pro' }, socket: { remoteAddress: '1.2.3.4' }, path: '/api' };
    const decision = await limiter.check(req);

    expect(decision.allowed).toBe(true);
    expect(decision.limit).toBe(PLAN_PRO.limit);
    expect(metrics).toHaveBeenCalled();
  });
});
