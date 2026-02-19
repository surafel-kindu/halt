import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/core/limiter';
import { InMemoryStore } from '../src/stores/memory';
import { PLAN_FREE } from '../src/presets';

describe('Algorithm caching', () => {
  it('runs multiple checks consistently for same policy', async () => {
    const limiter = new RateLimiter({ store: new InMemoryStore(), policy: PLAN_FREE });
    const req = { socket: { remoteAddress: '1.2.3.4' }, path: '/api' };
    const d1 = await limiter.check(req);
    const d2 = await limiter.check(req);
    expect(d1.limit).toBe(d2.limit);
  });
});
