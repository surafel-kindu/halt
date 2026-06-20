# Halt — Redis Support: Documentation Handoff

**Date:** 2026-06-20
**Scope:** Production Redis support added to the `halt-rate` SDK (both TypeScript and Python packages).
**Audience:** The Halt documentation website (`halt-website`) development session.

This document lists everything that changed in the SDK so the docs site can be updated.
It is organized as: (1) what to change in existing docs, (2) new public API to document,
(3) copy-paste examples, (4) behavioral notes worth documenting, (5) other SDK fixes that
affect documented behavior.

---

## 0. TL;DR for the website

- Redis is **no longer "coming soon"** — it's a first-class production store. Update every
  "Redis (coming soon / planned)" mention to "available".
- Redis is **atomic** (Lua), **cluster-safe**, **fail-open by default** (configurable), and
  in Python comes in **sync and async** flavors.
- New public exports to document: `RedisStore` (both), `AsyncRedisStore` (Python),
  plus the atomic-store types in TS (`AtomicStore`, `EvaluateInput`, `RedisClientLike`).
- Two behavior changes worth a docs note: Python now has `limiter.acheck()` (async), and
  the `RateLimit-Limit` header for token-bucket now reports the configured limit (not burst).

---

## 1. Existing docs to update

| Location / topic | Change |
|---|---|
| Storage backends list / comparison table | Mark **Redis** as available; recommend it for production. Tag it: atomic (Lua), distributed, cluster-safe, sync+async (Python). |
| Any "Redis — coming soon / planned / stubbed" copy | Remove the "coming soon"; replace with the real usage (see §3). |
| Install / optional dependencies pages | TS: `npm install ioredis`. Python: `pip install halt-rate[redis]`. |
| Algorithm docs (token bucket) | Note `RateLimit-Limit` = configured `limit` (e.g. 100), not `burst`. (Changed in Python to match TS — see §5.) |
| FastAPI / async docs | Document `await limiter.acheck(request)` and `AsyncRedisStore`. The FastAPI middleware now uses `acheck` internally, so async stores work end-to-end. |
| Feature lists / homepage bullets | "Redis-backed accuracy" is now real, not aspirational. |

> Note: the SDK package READMEs (`packages/typescript/README.md`,
> `packages/python/README.md`) were already updated with Redis sections — they are a good
> source of canonical copy for the website.

---

## 2. New public API surface

### TypeScript (`halt-rate`)

New exports from the package root:

```ts
import {
  RedisStore,             // class — the Redis store
  type RedisStoreOptions, // constructor options
  type FailMode,          // 'open' | 'closed'
  type AtomicStore,       // interface a store implements to compute decisions itself
  type EvaluateInput,     // payload the limiter passes to an atomic store
  type RedisClientLike,   // minimal structural client type (ioredis / node-redis v4+)
  isAtomicStore,          // helper
} from 'halt-rate';
```

`RedisStoreOptions`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `client` | `RedisClientLike` | — (required) | A connected Redis client (ioredis or node-redis v4+). Injected by the user. |
| `failMode` | `'open' \| 'closed'` | `'open'` | Behavior when Redis is unreachable. `open` = allow; `closed` = block (429). |
| `onError` | `(err) => void` | — | Called with the underlying error on any Redis failure. |
| `metricsRecorder` | `(name, tags?, value?) => void` | — | Metrics hook (see §4 for emitted names). |

> TypeScript is **async-only** (JS has no synchronous network I/O). `limiter.check()` is
> already async, so nothing changes for callers.

### Python (`halt-rate`)

New exports from `halt`:

```python
from halt import RedisStore        # synchronous store (wraps redis.Redis)
from halt import AsyncRedisStore   # asynchronous store (wraps redis.asyncio.Redis)
```

Both constructors accept:

| Arg | Type | Default | Meaning |
|---|---|---|---|
| `client` | redis client | — (required) | `redis.Redis` (sync) or `redis.asyncio.Redis` (async), injected. |
| `fail_mode` | `"open" \| "closed"` | `"open"` | Same as TS `failMode`. |
| `on_error` | `Callable[[Exception], None]` | `None` | Called on any Redis error. |
| `metrics_recorder` | `Callable[..., None]` | `None` | Metrics hook. |

New limiter method:

```python
decision = await limiter.acheck(request, cost=None)   # async variant of check()
```

`acheck()` uses an async store's `aevaluate` when present, falls back to a sync
`evaluate`, then to the in-process path. Use it with `AsyncRedisStore` (and it's already
wired into the FastAPI middleware).

New FastAPI helper:

```python
from halt.adapters.fastapi import create_async_limiter_dependency  # async Depends() variant
```

---

## 3. Copy-paste examples

### TypeScript — Redis (production)

```ts
import Redis from 'ioredis';
import { RateLimiter, RedisStore, presets } from 'halt-rate';

const store = new RedisStore({
  client: new Redis(process.env.REDIS_URL),
  failMode: 'open', // 'open' (default) allows on Redis outage; 'closed' blocks
  onError: (err) => console.error('redis rate-limit error', err),
});

const limiter = new RateLimiter({ store, policy: presets.PUBLIC_API });
const decision = await limiter.check(req);
```

Works the same behind the Express and Next.js adapters — just pass this `store`.

### Python — Redis (sync)

```python
import redis
from halt import RateLimiter, RedisStore, presets

store = RedisStore(
    client=redis.Redis.from_url("redis://localhost:6379"),
    fail_mode="open",
)
limiter = RateLimiter(store=store, policy=presets.PUBLIC_API)
decision = limiter.check(request)
```

### Python — Redis (async, FastAPI / asyncio)

```python
import redis.asyncio as aioredis
from halt import RateLimiter, AsyncRedisStore, presets

store = AsyncRedisStore(client=aioredis.Redis.from_url("redis://localhost:6379"))
limiter = RateLimiter(store=store, policy=presets.PUBLIC_API)

decision = await limiter.acheck(request)
```

FastAPI middleware (already calls `acheck`, so async store works as-is):

```python
from halt.adapters.fastapi import HaltMiddleware
app.add_middleware(HaltMiddleware, limiter=limiter)
```

---

## 4. Behavioral notes worth documenting

**Atomicity.** All four algorithms (token-bucket, fixed-window, leaky-bucket, sliding-window)
are implemented as **single-key Lua scripts** executed inside Redis, so a burst of concurrent
requests can never over-admit past the limit. Verified: 200 concurrent requests against a
`limit=50` policy → exactly 50 allowed.

**Server clock.** Scripts read time from the Redis server (`TIME`), so app-server clock skew
across a fleet does not affect accuracy.

**Algorithm storage shapes** (useful for an "under the hood" section):
- token-bucket / fixed-window / leaky-bucket → a Redis **HASH** per key.
- sliding-window → a Redis **sorted set (ZSET)** acting as a true request log
  (`ZADD` / `ZREMRANGEBYSCORE` / `ZCARD`).

**Redis Cluster.** Every script touches exactly one key, so it's cluster-safe out of the box.
To colocate related keys on the same slot, wrap the variable part of the key in a hash tag,
e.g. `halt:{user-123}:...`.

**Fail-open vs fail-closed.** Default is **fail-open** (allow on Redis outage — don't take
traffic down). Set `failMode: 'closed'` / `fail_mode="closed"` for abuse-sensitive routes to
return 429 when Redis is unreachable. Failures fire `onError` and metrics.

**Metrics emitted** (via `metricsRecorder` / `metrics_recorder`):
`halt.request.checked`, `halt.redis.error`, `halt.request.fail_open`,
`halt.request.fail_closed`.

**Client injection.** Halt does not depend on a specific Redis library — the user passes a
client. TS: ioredis (peer dep) or node-redis v4+. Python: `redis` (optional extra
`halt-rate[redis]`), both `redis.Redis` and `redis.asyncio.Redis`.

---

## 5. Other SDK fixes that affect documented behavior

These were fixed alongside Redis and may need doc/example corrections:

1. **Python token-bucket `RateLimit-Limit`**: previously reported the burst capacity; now
   reports the configured `limit` (e.g. 100, not 120). Now matches the TypeScript behavior.
   Update any Python examples/screenshots that showed the old value.

2. **Python SaaS plan presets** are now available (were missing vs TS):
   `presets.PLAN_FREE`, `PLAN_STARTER`, `PLAN_PRO`, `PLAN_BUSINESS`, `PLAN_ENTERPRISE`,
   `presets.PLAN_TIERS`, and `presets.get_plan_policy("pro")`. The plan-based / SaaS docs
   can now show identical Python and TS examples.

3. **Per-request policy resolvers in Python** now work reliably (previously could fail when a
   resolver callable was supplied instead of a static policy). Per-user / per-plan limit docs
   apply equally to Python now.

4. **New async path (Python)**: `limiter.acheck()` and `create_async_limiter_dependency()` —
   document these in the FastAPI / async sections.

---

## 6. Versioning / packaging note

- These changes are additive (new exports, new optional behavior) — no breaking changes to
  existing public APIs, aside from the Python token-bucket `limit` value correction in §5.1.
- Released as **v0.2.0** (minor bump from 0.1.1).
- The SDK source repo publishes packages as `halt-rate` on npm and PyPI.
```
