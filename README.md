# Halt

**Drop-in rate limiting middleware with safe defaults, multiple storage backends, and SaaS-ready features.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

---

## Features

🚀 **Four Rate Limiting Algorithms**
- Token Bucket (burst-friendly, recommended)
- Fixed Window (simple, fast)
- Sliding Window (accurate, memory-intensive)
- Leaky Bucket (traffic shaping, constant rate)

💾 **Multiple Storage Backends**
- In-Memory (development)
- Redis (production, distributed)
- PostgreSQL (ACID, relational)
- MongoDB (document store, TTL indexes)
- DynamoDB (AWS serverless)
- Memcached (distributed cache)

🎯 **SaaS-Ready Features**
- Plan-based rate limiting (FREE, STARTER, PRO, BUSINESS, ENTERPRISE)
- Quota management (hourly, daily, monthly, yearly)
- Penalty system (abuse detection, progressive penalties)
- Telemetry hooks (logging, metrics, observability)

🔧 **Framework Support**
- **Python:** FastAPI, Flask, Django
- **TypeScript:** Express, Next.js

✨ **Smart Features**
- Automatic health check exemptions
- Private IP exemptions
- Custom exemption lists
- Weighted endpoints (cost-based limiting)
- Per-request algorithm override
- Standard rate limit headers

---

## Quick Start

### Python

```bash
pip install halt
```

```python
from fastapi import FastAPI
from halt import RateLimiter, InMemoryStore, presets
from halt.adapters.fastapi import HaltMiddleware

app = FastAPI()

limiter = RateLimiter(
    store=InMemoryStore(),
    policy=presets.PUBLIC_API  # 100 req/min
)

app.add_middleware(HaltMiddleware, limiter=limiter)
```

### TypeScript

```bash
npm install halt
```

```typescript
import express from 'express';
import { RateLimiter, InMemoryStore, presets } from 'halt';
import { haltMiddleware } from 'halt/express';

const app = express();

const limiter = new RateLimiter({
  store: new InMemoryStore(),
  policy: presets.PUBLIC_API, // 100 req/min
});

app.use(haltMiddleware(limiter));
```

---

## Storage Backends

### PostgreSQL (Python)

```python
from halt.stores.postgres import PostgresStore

store = PostgresStore(
    connection_string="postgresql://user:pass@localhost/db"
)
```

### MongoDB (Python)

```python
from halt.stores.mongodb import MongoDBStore

store = MongoDBStore(
    connection_string="mongodb://localhost:27017",
    database="halt_db"
)
```

### DynamoDB (Python)

```python
from halt.stores.dynamodb import DynamoDBStore

store = DynamoDBStore(
    table_name="rate_limits",
    region_name="us-east-1"
)
```

---

## SaaS Features

### Plan-Based Rate Limiting

```python
from halt import presets

# Use plan-based presets
policy = presets.get_plan_policy("pro")  # 2000 req/hour

# Available plans
# - FREE: 100 req/hour
# - STARTER: 500 req/hour
# - PRO: 2000 req/hour
# - BUSINESS: 5000 req/hour
# - ENTERPRISE: 20000 req/hour
```

### Quota Management

```python
from halt.core.quota import QuotaManager, Quota, QuotaPeriod

quota_manager = QuotaManager(store)

monthly_quota = Quota(
    name="api_calls",
    limit=100000,
    period=QuotaPeriod.MONTHLY
)

allowed, current_quota = quota_manager.check_quota(
    identifier="user_123",
    quota=monthly_quota
)
```

### Penalty System

```python
from halt.core.penalty import PenaltyManager

penalty_manager = PenaltyManager(store)

# Record violation
penalty = penalty_manager.record_violation(
    identifier="user_123",
    severity=1.0
)

# Check penalty status
if penalty.is_active():
    print(f"Penalized until: {penalty.penalty_until}")
```

---

## Documentation

- **[Python SDK](./packages/python/README.md)** - Complete Python documentation
- **[TypeScript SDK](./packages/typescript/README.md)** - Complete TypeScript documentation
- **[CI/CD Setup](./CI_CD_SETUP.md)** - Automated deployment guide
- **[Contributing](./CONTRIBUTING.md)** - Contribution guidelines
- **[Deployment](./DEPLOYMENT.md)** - Publishing to PyPI and npm

---

## Examples

### Python
- [FastAPI Example](./packages/python/examples/fastapi_example.py)
- [Flask Example](./packages/python/examples/flask_example.py)
- [PostgreSQL Storage](./packages/python/examples/postgres_example.py)
- [MongoDB Storage](./packages/python/examples/mongodb_example.py)
- [SaaS Platform](./packages/python/examples/saas_platform_example.py)
- [Algorithm Comparison](./packages/python/examples/algorithms_demo.py)

### TypeScript
- [Express Example](./packages/typescript/examples/express-example.ts)
- [Next.js App Router](./packages/typescript/examples/nextjs-route-example.ts)
- [Algorithm Comparison](./packages/typescript/examples/algorithms-demo.ts)

---

## Roadmap

### v0.3 (Current)
- ✅ Leaky Bucket algorithm
- ✅ PostgreSQL, MongoDB, DynamoDB, Memcached stores (Python)
- ✅ Quota system
- ✅ Penalty system
- ✅ Telemetry hooks
- ✅ Plan-based presets
- ⏳ TypeScript storage backends
- ⏳ Redis store

### v0.4 (Next)
- OpenTelemetry integration
- Distributed global limits
- Idempotent response mode
- Enhanced metrics and dashboards

### v1.0 (Future)
- Adaptive limits
- Advanced abuse detection
- Multi-region support
- GraphQL support

---

## Performance

| Algorithm | Throughput | Memory | Accuracy |
|-----------|-----------|--------|----------|
| Token Bucket | ~100k req/s | Low | High |
| Fixed Window | ~120k req/s | Very Low | Medium |
| Sliding Window | ~80k req/s | Medium | Very High |
| Leaky Bucket | ~90k req/s | Low | High |

*Benchmarks on M1 Mac, in-memory storage*

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Support

- 📧 Email: support@halt.dev
- 💬 Discord: [Join our community](https://discord.gg/halt)
- 🐛 Issues: [GitHub Issues](https://github.com/yourusername/halt/issues)
- 📖 Docs: [Full Documentation](https://halt.dev/docs)
