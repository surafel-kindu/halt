<p align="center">
    <img src="assets/logo-small.png" alt="Halt logo" width="64" height="64">
</p>
# Halt

Halt is a lightweight rate limiting middleware library for services and APIs. It's
designed to be easy to plug into frameworks (Express, Next, FastAPI, Flask, Django)
and flexible enough for SaaS use-cases (per-user / plan-based limits).

Core ideas:
- Simple policy model (limit, window, algorithm)
- Per-request policy resolver (support per-user/plan limits)
- Multiple algorithms: token-bucket, fixed-window, sliding-window, leaky-bucket
- Pluggable stores: in-memory (dev), Redis/DB (production)
- Observability hooks (OpenTelemetry / metrics recorder)

Quick highlights (what changed)
- You can now pass a policy *resolver* when constructing a limiter. The resolver
  receives each request and returns a `Policy` — ideal for user-specific limits.
- The limiter accepts an optional `otelTracer` and `metricsRecorder` hook for
  lightweight telemetry integration.
- Adapters (Express, Next) now support the async policy resolver flow.

Features
- Per-user / per-plan limits via resolver
- Telemetry hooks (OpenTelemetry spans)
- Metrics recorder hook for counters/gauges
- Algorithm instance caching per policy name
- In-memory and pluggable distributed stores (Redis recommended for production)

Storage Backends (explicit)
- InMemory (development): `packages/typescript/src/stores/memory.ts`, `packages/python/halt/stores/memory.py`
- PostgreSQL (production, ACID): `packages/typescript/src/stores/postgres.ts`, `packages/python/halt/stores/postgres.py`
- MongoDB (production, TTL indexes): `packages/typescript/src/stores/mongodb.ts`, `packages/python/halt/stores/mongodb.py`
- DynamoDB (AWS serverless): `packages/typescript/src/stores/dynamodb.ts` (Python: `packages/python/examples/postgres_example.py` shows usage)
- Memcached (distributed cache): `packages/typescript/src/stores/memcached.ts`
- Redis (recommended distributed store): Redis support is planned/partially stubbed in docs; implement a `RedisStore` backing with atomic ops for strict global limits (I can add this next).

Getting started (TypeScript)

1. Install dev deps and run tests

```bash
cd packages/typescript
npm install
npm test
```

2. Example using a per-user policy resolver

See `packages/typescript/demo/per-user-demo.ts` for a small runnable example.

Getting started (Python)

1. Create a venv and install

```bash
cd packages/python
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
pytest
```

2. See `packages/python/demo/per_user_demo.py` for a quick example using a resolver.

Tests & Demos
- TypeScript demos: `packages/typescript/demo`
- Python demos: `packages/python/demo`
- Tests: `packages/typescript/tests` and `packages/python/tests`

Roadmap (short)
- Improve distributed store implementations (Redis Lua scripts)
- Add idempotent response middleware (optional)
- Expand dashboards and metrics exporters
- GraphQL support (Apollo / Graphene adapters included)

If you'd like, I can add a Redis `Store` implementation and full idempotency middleware next.

Support & Community
- Discord: https://discord.gg/halt
- GitHub Issues: https://github.com/yourusername/halt/issues
- Documentation: https://docs.halt.dev (or ./docs)

Contributing
- Read the contribution guidelines in `CONTRIBUTING.md` and the license in `LICENSE`.
  Open a PR against `main` and use conventional commits for clear changelogs.
