import { describe, it, expect, vi } from 'vitest';
import { RateLimiter } from '../src/core/limiter';
import { InMemoryStore } from '../src/stores/memory';
import { PLAN_FREE } from '../src/presets';

describe('OpenTelemetry hooks', () => {
  it('starts a span when tracer provided', async () => {
    const tracer = { startSpan: vi.fn(() => ({ end: vi.fn() })) } as any;
    const limiter = new RateLimiter({ store: new InMemoryStore(), policy: PLAN_FREE, otelTracer: tracer });
    const req = { user: { id: 'u1' }, socket: { remoteAddress: '1.2.3.4' }, path: '/api' };
    const decision = await limiter.check(req);
    expect(tracer.startSpan).toHaveBeenCalled();
    expect(decision.allowed).toBe(true);
  });
});
