/**
 * Dynamic limits — change policies at runtime without restarting.
 *
 * `PolicyRegistry` holds named policies you can mutate live. Use it as the
 * limiter's `policy` via `registry.resolver(selector)`:
 *
 *   const registry = new PolicyRegistry([presets.PUBLIC_API]);
 *   const limiter = new RateLimiter({
 *     store,
 *     policy: registry.resolver((req) => 'public_api'),
 *   });
 *   // later, no restart:
 *   registry.update('public_api', { limit: 500 });
 *
 * For limits stored in Redis/DB/config (and shared across a fleet), use
 * `cachedPolicyResolver` with a loader that reads that shared state.
 */

import { Policy } from './policy';

export class PolicyRegistry {
    private policies = new Map<string, Policy>();

    constructor(initial: Policy[] = []) {
        for (const p of initial) this.register(p);
    }

    /** Add or replace a policy (keyed by `policy.name`). */
    register(policy: Policy): this {
        this.policies.set(policy.name, policy);
        return this;
    }

    get(name: string): Policy | undefined {
        return this.policies.get(name);
    }

    has(name: string): boolean {
        return this.policies.has(name);
    }

    /** Mutate fields of an existing policy at runtime (e.g. `{ limit: 500 }`). */
    update(name: string, patch: Partial<Omit<Policy, 'name'>>): Policy {
        const existing = this.policies.get(name);
        if (!existing) throw new Error(`Unknown policy: ${name}`);
        const updated: Policy = { ...existing, ...patch, name: existing.name };
        // If the limit changed but burst wasn't given, let normalizePolicy recompute
        // the default burst (otherwise a stale smaller burst fails validation).
        if (patch.limit !== undefined && patch.burst === undefined) {
            delete updated.burst;
        }
        this.policies.set(name, updated);
        return updated;
    }

    remove(name: string): boolean {
        return this.policies.delete(name);
    }

    list(): Policy[] {
        return [...this.policies.values()];
    }

    /**
     * Build a resolver for the limiter's `policy` option.
     * @param selector maps a request to a registered policy name.
     */
    resolver(selector: (request: any) => string): (request: any) => Policy {
        return (request: any) => {
            const name = selector(request);
            const policy = this.policies.get(name);
            if (!policy) throw new Error(`Unknown policy: ${name}`);
            return policy;
        };
    }
}

export interface CachedPolicyResolverOptions {
    /** Cache entry lifetime in ms (default 5000). */
    ttlMs?: number;
    /** Cache key for a request (default: the loaded policy is shared under one key). */
    key?: (request: any) => string;
}

/**
 * Wrap a (possibly async) loader with a per-key TTL cache. The loader reads your
 * source of truth (Redis/DB/config), so limits propagate across a fleet and
 * refresh live — without restarting. Use the returned function as `policy`.
 */
export function cachedPolicyResolver(
    loader: (request: any) => Policy | Promise<Policy>,
    options: CachedPolicyResolverOptions = {}
): (request: any) => Promise<Policy> {
    const ttlMs = options.ttlMs ?? 5000;
    const keyFn = options.key ?? (() => '__default__');
    const cache = new Map<string, { policy: Policy; expires: number }>();

    return async (request: any): Promise<Policy> => {
        const key = keyFn(request);
        const now = Date.now();
        const hit = cache.get(key);
        if (hit && hit.expires > now) {
            return hit.policy;
        }
        const policy = await loader(request);
        cache.set(key, { policy, expires: now + ttlMs });
        return policy;
    };
}
