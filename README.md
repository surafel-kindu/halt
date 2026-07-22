<img width="1983" height="793" alt="ChatGPT Image Jul 6, 2026, 04_33_44 PM" src="https://github.com/user-attachments/assets/dec288f2-2884-4070-8b30-1fc71b902d8d" />

# Halt

**SaaS-aware, cross-language rate limiting for APIs and services.** One consistent model in
**TypeScript and Python** for per-user / per-API-key / per-plan limits, quotas, weighted
endpoints, abuse controls, distributed accuracy via atomic Redis, and built-in observability.
Plugs into Express, Next, FastAPI, Flask, and Django.

📖 **Documentation & guides: [https://halt.afroawi.com/docs](https://halt.afroawi.com/docs)**

## Packages

| Package | Install | Registry | Installs |
|---|---|---|---|
| TypeScript — [`packages/typescript`](packages/typescript) | `npm install halt-rate` | [npm](https://www.npmjs.com/package/halt-rate) | ![NPM Downloads](https://img.shields.io/npm/d18m/halt-rate?style=flat-square&labelColor=blue&color=orange) |
| Python — [`packages/python`](packages/python) | `pip install halt-rate` | [PyPI](https://pypi.org/project/halt-rate/) | [![PyPI Downloads](https://static.pepy.tech/personalized-badge/halt-rate?period=total&units=NONE&left_color=BLUE&right_color=RED&left_text=downloads)](https://pepy.tech/projects/halt-rate) |

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
