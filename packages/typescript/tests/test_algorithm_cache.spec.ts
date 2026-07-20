import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/core/limiter';
import { InMemoryStore } from '../src/stores/memory';
import { PLAN_FREE } from '../src/presets';
import { Algorithm, Policy } from '../src/core/policy';
import { SlidingWindow } from '../src/algorithms/sliding-window';

describe('Algorithm caching', () => {
  it('runs multiple checks consistently for same policy', async () => {
    const limiter = new RateLimiter({ store: new InMemoryStore(), policy: PLAN_FREE });
    const req = { socket: { remoteAddress: '1.2.3.4' }, path: '/api' };
    const d1 = await limiter.check(req);
    const d2 = await limiter.check(req);
    expect(d1.limit).toBe(d2.limit);
  });

  it('uses default slidingPrecision and validates invalid values', async () => {
    const req = { socket: { remoteAddress: '8.8.8.8' }, path: '/api' };

    const defaultPolicy: Policy = {
      name: 'sliding-default',
      limit: 10,
      window: 60,
      algorithm: Algorithm.SLIDING_WINDOW,
    };
    const limiter = new RateLimiter({ store: new InMemoryStore(), policy: defaultPolicy, exemptPrivateIps: false });
    await limiter.check(req);

    const algorithm = Array.from((limiter as any).algorithmCache.values())[0];
    expect(algorithm).toBeInstanceOf(SlidingWindow);
    expect((algorithm as any).precision).toBe(10);

    const invalidPolicy: Policy = {
      name: 'sliding-invalid',
      limit: 10,
      window: 60,
      algorithm: Algorithm.SLIDING_WINDOW,
      slidingPrecision: 0,
    };
    const invalidLimiter = new RateLimiter({ store: new InMemoryStore(), policy: invalidPolicy, exemptPrivateIps: false });
    await expect(invalidLimiter.check(req)).rejects.toThrow('slidingPrecision must be a positive integer');
  });

  it('includes slidingPrecision in the cache key for dynamic policies', async () => {
    const resolver = (req: any): Policy => ({
      name: 'sliding-dynamic',
      limit: 10,
      window: 60,
      algorithm: Algorithm.SLIDING_WINDOW,
      slidingPrecision: req.precision,
    });

    const limiter = new RateLimiter({ store: new InMemoryStore(), policy: resolver, exemptPrivateIps: false });
    const reqLow = { socket: { remoteAddress: '8.8.8.8' }, path: '/api', precision: 5 };
    const reqHigh = { socket: { remoteAddress: '8.8.8.8' }, path: '/api', precision: 20 };

    await limiter.check(reqLow);
    await limiter.check(reqHigh);

    expect((limiter as any).algorithmCache.size).toBe(2);
  });
});
