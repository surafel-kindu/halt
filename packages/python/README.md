# Halt — Python SDK

**SaaS-aware, cross-language rate limiting.** Per-user / per-API-key / per-plan limits, quotas, weighted endpoints, abuse controls, atomic Redis accuracy (sync + async), and built-in observability — with a matching [TypeScript package](https://www.npmjs.com/package/halt-rate).

[![PyPI](https://img.shields.io/pypi/v/halt-rate.svg)](https://pypi.org/project/halt-rate/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

📖 **Full documentation: [halt.afroawi.com](https://halt.afroawi.com)**

## Install

```bash
pip install halt-rate
# optional extras
pip install "halt-rate[redis]"    # production store (sync + async)
pip install "halt-rate[fastapi]"  # framework adapter
pip install "halt-rate[otel]"     # OpenTelemetry metrics
```

Installs as `halt-rate`; import as `halt`.

## Quick start

```python
from halt import RateLimiter, InMemoryStore, presets

limiter = RateLimiter(
    store=InMemoryStore(),      # use RedisStore in production
    policy=presets.PUBLIC_API,  # 100 req/min per IP
)

decision = limiter.check(request)   # or: await limiter.acheck(request)
if not decision.allowed:
    # respond 429, Retry-After: decision.retry_after
    ...
```

Production Redis (sync + async), FastAPI/Flask/Django adapters, plan-based limits, quotas,
penalties, and observability are covered in the docs → **[halt.afroawi.com/docs](https://halt.afroawi.com/docs)**.

## Features

- Algorithms: token bucket, fixed/sliding window, leaky bucket
- Keys: IP, user, API key, composite, or custom
- Atomic **Redis** store (Lua, cluster-safe, fail-open), sync **and** async, + in-memory dev store
- SaaS: per-plan limits, quotas, weighted endpoints, abuse penalties
- Observability: `StatsCollector` + OpenTelemetry metrics
- Adapters: FastAPI, Flask, Django

## Links

- Docs: https://halt.afroawi.com
- PyPI: https://pypi.org/project/halt-rate/
- Source & issues: https://github.com/surafel-kindu/halt

## License

MIT
