# Halt — TypeScript SDK

**SaaS-aware, cross-language rate limiting.** Per-user / per-API-key / per-plan limits, quotas, weighted endpoints, abuse controls, atomic Redis accuracy, and built-in observability — with a matching [Python package](https://pypi.org/project/halt-rate/).

[![npm](https://img.shields.io/npm/v/halt-rate.svg)](https://www.npmjs.com/package/halt-rate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

📖 **Full documentation: [halt.afroawi.com](https://halt.afroawi.com)**

## Install

```bash
npm install halt-rate
# optional: production store + metrics
npm install ioredis @opentelemetry/api
```

## Quick start

```typescript
import { RateLimiter, InMemoryStore, presets } from 'halt-rate';

const limiter = new RateLimiter({
  store: new InMemoryStore(), // use RedisStore in production
  policy: presets.PUBLIC_API, // 100 req/min per IP
});

const decision = await limiter.check(req);
if (!decision.allowed) {
  // respond 429, Retry-After: decision.retryAfter
}
```

Production Redis, Express/Next adapters, plan-based limits, quotas, penalties, and
observability are covered in the docs → **[halt.afroawi.com/docs](https://halt.afroawi.com/docs)**.

## Features

- Algorithms: token bucket, fixed/sliding window, leaky bucket
- Keys: IP, user, API key, composite, or custom
- Atomic **Redis** store (Lua, cluster-safe, fail-open) + in-memory dev store
- **Dynamic limits**: change limits at runtime with `PolicyRegistry` / cached loaders — no restart
- SaaS: per-plan limits, quotas, weighted endpoints, abuse penalties
- Observability: `StatsCollector` + OpenTelemetry metrics
- Adapters: Express, Next.js, **Hono**, **Fastify**, GraphQL (Apollo)

## Runtime support

Ships dual **ESM + CJS** with types. The core (limiter, algorithms, in-memory store) is
**edge-safe** — runs on Cloudflare Workers, Deno, Bun, and Vercel Edge. `RedisStore` is Node-only
(TCP); for edge distributed limits, inject any `RedisClientLike` (e.g. a fetch/REST client).
Full guidance: **[halt.afroawi.com/docs](https://halt.afroawi.com/docs)**.

## Links

- Docs: https://halt.afroawi.com
- npm: https://www.npmjs.com/package/halt-rate
- Source & issues: https://github.com/surafel-kindu/halt

## License

MIT
