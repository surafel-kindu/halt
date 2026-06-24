/**
 * Tests for dynamic limits: PolicyRegistry + cachedPolicyResolver.
 */

import { describe, it, expect } from 'vitest';
import { PolicyRegistry, cachedPolicyResolver } from '../src/core/registry';
import { RateLimiter } from '../src/core/limiter';
import { InMemoryStore } from '../src/stores/memory';
import { Algorithm, Policy } from '../src/core/policy';

const fixed = (name = 'api', limit = 2): Policy => ({
    name,
    limit,
    window: 60,
    algorithm: Algorithm.FIXED_WINDOW,
});

describe('PolicyRegistry', () => {
    it('supports CRUD', () => {
        const reg = new PolicyRegistry([fixed()]);
        expect(reg.has('api')).toBe(true);
        expect(reg.get('api')?.limit).toBe(2);
        reg.register(fixed('other', 9));
        expect(reg.list().map((p) => p.name).sort()).toEqual(['api', 'other']);
        expect(reg.remove('other')).toBe(true);
        expect(reg.has('other')).toBe(false);
    });

    it('recomputes burst when raising the limit', () => {
        const reg = new PolicyRegistry([{ ...fixed(), burst: 2 }]);
        const updated = reg.update('api', { limit: 500 });
        expect(updated.limit).toBe(500);
        expect(updated.burst).toBeUndefined(); // recomputed by normalizePolicy at check time
    });

    it('throws on update of unknown policy', () => {
        expect(() => new PolicyRegistry().update('nope', { limit: 1 })).toThrow();
    });

    it('changes the limit at runtime without restart', async () => {
        const reg = new PolicyRegistry([fixed('api', 2)]);
        const limiter = new RateLimiter({
            store: new InMemoryStore(),
            policy: reg.resolver(() => 'api'),
            exemptPrivateIps: false,
        });
        const req = { socket: { remoteAddress: '8.8.8.8' }, url: '/x' };

        expect((await limiter.check(req)).allowed).toBe(true);
        expect((await limiter.check(req)).allowed).toBe(true);
        expect((await limiter.check(req)).allowed).toBe(false); // limit=2 reached

        reg.update('api', { limit: 5 }); // raise live

        expect((await limiter.check(req)).allowed).toBe(true); // now allowed
    });
});

describe('cachedPolicyResolver', () => {
    it('caches within the TTL and reloads after', async () => {
        let calls = 0;
        const resolver = cachedPolicyResolver(
            async () => {
                calls++;
                return fixed('api', 10);
            },
            { ttlMs: 30 }
        );

        await resolver({});
        await resolver({});
        expect(calls).toBe(1); // cached

        await new Promise((r) => setTimeout(r, 40));
        await resolver({});
        expect(calls).toBe(2); // reloaded after TTL
    });
});
