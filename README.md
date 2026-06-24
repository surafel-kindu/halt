<img width="100" height="100" alt="Halt logo" src="https://github.com/user-attachments/assets/53536c8e-c7a5-490e-b21e-2501887ad92c" />

# Halt

**SaaS-aware, cross-language rate limiting for APIs and services.** One consistent model in
**TypeScript and Python** for per-user / per-API-key / per-plan limits, quotas, weighted
endpoints, abuse controls, distributed accuracy via atomic Redis, and built-in observability.
Plugs into Express, Next, FastAPI, Flask, and Django.

📖 **Documentation & guides: [halt.afroawi.com](https://halt.afroawi.com)**

## Packages

| Package | Install | Registry |
|---|---|---|
| TypeScript — [`packages/typescript`](packages/typescript) | `npm install halt-rate` | [npm](https://www.npmjs.com/package/halt-rate) |
| Python — [`packages/python`](packages/python) | `pip install halt-rate` | [PyPI](https://pypi.org/project/halt-rate/) |

## Why Halt

- **SaaS-aware**, not just "requests per IP": per-user / per-API-key / per-plan limits, quotas,
  and weighted (cost-based) endpoints.
- **Cross-language parity**: the same policies, algorithms, and behavior in TS and Python.
- **Distributed & accurate**: `RedisStore` runs each check as a single-key Lua script, so limits
  stay exact under concurrency across a fleet (sync + async in Python).
- **Dynamic limits**: change limits at runtime with a `PolicyRegistry` or a cached loader (reading
  Redis/DB/config) — no restart.
- **Abuse controls**: progressive penalties / abuse scoring.
- **Observability built-in**: zero-dep `StatsCollector` (blocked counts, top limited keys,
  endpoint cost, plan consumption) plus an OpenTelemetry metrics adapter.
- **Framework adapters**: Express, Next, Hono, Fastify, Flask, FastAPI, Django, GraphQL — with
  edge-runtime support in TypeScript.

## Quick start

See the per-package READMEs ([TypeScript](packages/typescript/README.md) ·
[Python](packages/python/README.md)) for a minimal example, and
**[halt.afroawi.com/docs](https://halt.afroawi.com/docs)** for full usage guidance.

## Development

```bash
# TypeScript
cd packages/typescript && npm install && npm test

# Python
cd packages/python && pip install -e ".[dev]" && pytest
```

Distributed/Redis tests are opt-in via the `REDIS_URL` environment variable.

## Contributing & License

See [CONTRIBUTING.md](CONTRIBUTING.md). Open PRs against `main` using conventional commits.
Licensed under [MIT](LICENSE).
