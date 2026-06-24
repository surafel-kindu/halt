# Halt v0.4.0 — Release Notes & Docs Handoff

**Released:** 2026-06-24 · `halt-rate` 0.4.0 on [npm](https://www.npmjs.com/package/halt-rate) and [PyPI](https://pypi.org/project/halt-rate/).
**Theme:** Dynamic limits (change without restart) + a stronger TypeScript package story.
**Compatibility:** Additive and backward-compatible — with one packaging **fix** (see §Fixed).

Follows `docs/RELEASE_0.3.0.md`. For two audiences: (A) a CHANGELOG entry, (B) the docs website.

---

## CHANGELOG (copy-paste)

```markdown
## [0.4.0] — 2026-06-24

### Added
- **Dynamic limits** — change limits at runtime without restarting:
  - `PolicyRegistry` (both languages): a mutable, in-process registry of named policies
    (`register`, `get`, `has`, `update`, `remove`, `list`, `resolver(selector)`). Use
    `registry.resolver(selector)` as the limiter's `policy`; `registry.update(name, …)` takes
    effect immediately.
  - `cachedPolicyResolver` / `cached_policy_resolver`: wrap a (possibly async) loader that reads
    Redis/DB/config with a per-key TTL cache, so limits propagate across a fleet and refresh live.
  - Python: `acheck` now supports **async policy resolvers** (awaits a coroutine result); the sync
    `check` raises a clear error if handed an async resolver.
- **TypeScript adapters**: new `halt-rate/hono` and `halt-rate/fastify`; the existing GraphQL
  (Apollo) adapter is now published as `halt-rate/graphql`. (Express + Next already shipped.)
- **Runtime/ESM-CJS docs**: core + `InMemoryStore` are edge-safe (no Node built-ins); package
  ships dual ESM + CJS with per-condition types.

### Fixed
- **`exports` map** pointed `require` at a non-existent `*.cjs` file and `import` at the CJS build.
  Corrected to `*.mjs` (ESM) / `*.js` (CJS) with per-condition `types` — `require()` now resolves.
- TS in-app algorithm cache was keyed by policy **name** only, so a changed limit was ignored on
  the in-memory path. Now keyed by name+algorithm+limit+window+burst (Redis path was already fine).

### Dependencies
- Optional peers (TS): `hono`, `fastify` (both optional).
```

---

## New public API (for the docs site)

### Dynamic limits — `PolicyRegistry`
```ts
import { RateLimiter, PolicyRegistry, presets } from 'halt-rate';
const registry = new PolicyRegistry([presets.PUBLIC_API]);
const limiter = new RateLimiter({ store, policy: registry.resolver(() => 'public_api') });
registry.update('public_api', { limit: 500 }); // live, no restart
```
```python
from halt import RateLimiter, PolicyRegistry, presets
registry = PolicyRegistry([presets.PUBLIC_API])
limiter = RateLimiter(store=store, policy=registry.resolver(lambda req: "public_api"))
registry.update("public_api", limit=500)  # live, no restart
```
Note for docs: raising `limit` past the old `burst` is handled automatically — `update` recomputes
the default `burst` when `limit` changes and `burst` isn't given.

### Dynamic limits — cached loader (cross-fleet)
```ts
import { cachedPolicyResolver } from 'halt-rate';
const policy = cachedPolicyResolver(async (req) => loadPolicyFromRedis(planFor(req)), { ttlMs: 5000, key: planFor });
const limiter = new RateLimiter({ store, policy });
```
```python
from halt import cached_policy_resolver
policy = cached_policy_resolver(load_policy_from_redis, ttl=5, key=plan_for)
limiter = RateLimiter(store=store, policy=policy)
decision = await limiter.acheck(request)   # async loader => use acheck
```
The loader is your source of truth; updating it (e.g. a row in Redis/DB) changes limits across all
instances within the TTL — no restart, no deploy.

### TypeScript adapters
```ts
// Hono (Node or edge)
import { haltMiddleware } from 'halt-rate/hono';
app.use('*', haltMiddleware({ limiter }));        // optional: getClientIp, onBlocked

// Fastify
import { haltHook } from 'halt-rate/fastify';
app.addHook('preHandler', haltHook({ limiter })); // optional: onBlocked

// GraphQL (Apollo)
import { haltApolloPlugin } from 'halt-rate/graphql';
```
All adapters set standard `RateLimit-*` headers and respond `429` with `{ error, message, retryAfter }`.

### Runtime support (TypeScript)
- **Edge-safe core**: the limiter, algorithms, `InMemoryStore`, extractors, presets, and the OTel
  adapter use no Node built-ins → run on Cloudflare Workers, Deno, Bun, Vercel Edge.
- **RedisStore is Node-only** (ioredis/TCP). For edge distributed limits, inject any object
  satisfying `RedisClientLike` (e.g. a fetch/REST Redis client).
- **ESM + CJS**: dual builds with correct `exports` conditions and types for each.
- The Hono adapter derives the client IP from edge headers (`x-forwarded-for` / `cf-connecting-ip`
  / `x-real-ip`) by default; override with `getClientIp`.

---

## Documentation site — what to add/update

1. **New "Dynamic limits" page**: the resolver concept, `PolicyRegistry` (runtime `update`),
   and `cachedPolicyResolver` for cross-fleet limits via a shared loader. Call out the
   "no restart" property explicitly (Upstash-parity).
2. **Framework pages**: add **Hono** and **Fastify** quick-starts; surface the now-published
   **GraphQL** adapter. Note edge usage for Hono.
3. **New "Runtime / Edge" page** (or section): edge-safe core vs Node-only RedisStore, the
   `RedisClientLike` injection path for edge, and ESM/CJS support.
4. **Install/optional-deps**: `npm install hono` / `npm install fastify` for those adapters.
5. **Python async page**: `acheck` now accepts async resolvers (cached loader reading Redis/DB).

---

## Verification (already run pre-release)
- TS: build (ESM+CJS+DTS) emits all five adapters; `npm test` green (registry + adapter +
  existing suites); distributed tests pass against a real Redis.
- Python: `pytest` green incl. new registry tests; `python -m build` + `twine check` pass.
- Dynamic-limit proof: a registry test raises a limit mid-run and the new limit is enforced
  without recreating the limiter.
