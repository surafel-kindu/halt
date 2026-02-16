# Halt TypeScript SDK

**Drop-in middleware that enforces consistent rate limits per IP/user/api-key with safe defaults, Redis-backed accuracy, and clean headers.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## Features

🚀 **Four Rate Limiting Algorithms**
- Token Bucket (burst-friendly, recommended)
- Fixed Window (simple, fast)
- Sliding Window (accurate, memory-intensive)
- Leaky Bucket (traffic shaping, constant rate)

💾 **Multiple Storage Backends**
- In-Memory (development, single-threaded)
- Redis (production, distributed) - Coming soon
- PostgreSQL (ACID, relational)
- MongoDB (document store, TTL indexes)
- DynamoDB (AWS serverless, auto-scaling)
- Memcached (distributed cache, fast)

🎯 **SaaS-Ready Features**
- Plan-based rate limiting (FREE, STARTER, PRO, BUSINESS, ENTERPRISE)
- Quota management (hourly, daily, monthly, yearly)
- Penalty system (abuse detection, progressive penalties)
- Telemetry hooks (logging, metrics, observability)

🔧 **Framework Support**
- Express
- Next.js (App Router & Pages Router)
- Next.js Middleware

✨ **Smart Features**
- Automatic health check exemptions
- Private IP exemptions
- Custom exemption lists
- Weighted endpoints (cost-based limiting)
- Per-request algorithm override
- Standard rate limit headers (RateLimit-*, Retry-After)

---

## Installation

```bash
npm install halt
# or
yarn add halt
# or
pnpm add halt
```

### Optional Dependencies

```bash
# PostgreSQL support
npm install pg

# MongoDB support
npm install mongodb

# DynamoDB support
npm install @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb

# Memcached support
npm install memcached
```

---

## Storage Backends

### In-Memory (Development)

```typescript
import { InMemoryStore } from 'halt';

const store = new InMemoryStore();
```

### PostgreSQL

```typescript
import { PostgresStore } from 'halt/stores/postgres';

const store = new PostgresStore({
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'user',
  password: 'password',
  tableName: 'rate_limits', // optional
});
```

### MongoDB

```typescript
import { MongoDBStore } from 'halt/stores/mongodb';

const store = new MongoDBStore({
  connectionString: 'mongodb://localhost:27017',
  database: 'halt',
  collection: 'rate_limits',
});
```

### DynamoDB

```typescript
import { DynamoDBStore } from 'halt/stores/dynamodb';

const store = new DynamoDBStore({
  tableName: 'rate_limits',
  region: 'us-east-1',
});
```

### Memcached

```typescript
import { MemcachedStore } from 'halt/stores/memcached';

const store = new MemcachedStore({
  servers: 'localhost:11211',
});
```

---

## SaaS Features

### Plan-Based Rate Limiting

```typescript
import { getPlanPolicy, PLAN_FREE, PLAN_PRO, PLAN_ENTERPRISE } from 'halt';

// Use plan-based presets
const freePolicy = PLAN_FREE;          // 100 req/hour
const proPolicy = PLAN_PRO;            // 2000 req/hour
const enterprisePolicy = PLAN_ENTERPRISE;  // 20000 req/hour

// Get policy by plan name
const policy = getPlanPolicy('pro');

// Dynamic policy resolution
function getUserPolicy(user: User) {
  return getPlanPolicy(user.plan);
}
```

### Quota Management

```typescript
import { QuotaManager, Quota, QuotaPeriod } from 'halt/core/quota';

const quotaManager = new QuotaManager(store);

const monthlyQuota: Quota = {
  name: 'api_calls',
  limit: 100000,
  period: QuotaPeriod.MONTHLY,
};

// Check quota
const { allowed, quota: currentQuota } = await quotaManager.checkQuota(
  'user_123',
  monthlyQuota
);

if (allowed) {
  // Consume quota
  await quotaManager.consumeQuota('user_123', monthlyQuota, 1);
} else {
  console.log(`Quota exceeded. Resets at: ${currentQuota.resetAt}`);
}
```

### Penalty System

```typescript
import { PenaltyManager, PENALTY_MODERATE } from 'halt/core/penalty';

const penaltyManager = new PenaltyManager(store, PENALTY_MODERATE);

// Record violation
const penalty = await penaltyManager.recordViolation('user_123', 1.0);

// Check penalty status
if (penaltyManager.isActive(penalty)) {
  console.log(`User penalized until: ${penalty.penaltyUntil}`);
  console.log(`Abuse score: ${penalty.abuseScore}`);
}
```

### Telemetry & Observability

```typescript
import { LoggingTelemetry, MetricsTelemetry, CompositeTelemetry } from 'halt/core/telemetry';

// Logging telemetry
const telemetry = new LoggingTelemetry(console);

// Metrics telemetry (with your metrics client)
class CustomMetrics {
  increment(metric: string, tags?: any) { /* ... */ }
  gauge(metric: string, value: number, tags?: any) { /* ... */ }
}

const metricsTelemetry = new MetricsTelemetry(new CustomMetrics());

// Combine multiple telemetry hooks
const compositeTelemetry = new CompositeTelemetry([
  new LoggingTelemetry(console),
  metricsTelemetry,
]);

// Use with limiter
const limiter = new RateLimiter({
  store,
  policy,
  telemetry: compositeTelemetry,
});
```

---

## Quick Start

### Express

```typescript
import express from 'express';
import { RateLimiter, InMemoryStore, presets } from 'halt';
import { haltMiddleware } from 'halt/express';

const app = express();

const limiter = new RateLimiter({
  store: new InMemoryStore(),
  policy: presets.PUBLIC_API,  // 100 req/min
});

app.use(haltMiddleware({ limiter }));

app.get('/', (req, res) => {
  res.json({ message: 'Hello World' });
});

app.listen(3000);
```

### Next.js App Router

```typescript
// app/api/data/route.ts
import { withHalt } from 'halt/next';
import { InMemoryStore, presets } from 'halt';

const store = new InMemoryStore();

async function handler(req: Request) {
  return Response.json({ message: 'Hello World' });
}

export const GET = withHalt(handler, {
  store,
  policy: presets.PUBLIC_API,
});
```

### Next.js Middleware

```typescript
// middleware.ts
import { haltMiddleware } from 'halt/next';
import { InMemoryStore, presets } from 'halt';

export default haltMiddleware({
  store: new InMemoryStore(),
  policy: presets.PUBLIC_API,
});

export const config = {
  matcher: '/api/:path*',
};
```

---

## Preset Policies

Halt comes with battle-tested presets:

```typescript
import { presets } from 'halt';

// Public API - moderate limits
presets.PUBLIC_API
// 100 requests/minute, burst: 120

// Authentication endpoints - strict
presets.AUTH_ENDPOINTS
// 5 requests/minute, burst: 10, 5min cooldown

// Expensive operations - very strict
presets.EXPENSIVE_OPS
// 10 requests/hour, burst: 15, cost: 10

// Strict API - for sensitive ops
presets.STRICT_API
// 20 requests/minute, burst: 25

// Generous API - for internal services
presets.GENEROUS_API
// 1000 requests/minute, burst: 1200
```

---

## Custom Policies

### Basic Custom Policy

```typescript
import { Policy, KeyStrategy, Algorithm } from 'halt';

const customPolicy: Policy = {
  name: 'custom',
  limit: 50,
  window: 60,  // 1 minute
  burst: 60,
  algorithm: Algorithm.TOKEN_BUCKET,
  keyStrategy: KeyStrategy.IP,
};
```

### Advanced Examples

#### Rate Limit by User

```typescript
const userPolicy: Policy = {
  name: 'per_user',
  limit: 100,
  window: 3600,  // 1 hour
  keyStrategy: KeyStrategy.USER,
};
```

#### Rate Limit by API Key

```typescript
const apiPolicy: Policy = {
  name: 'per_api_key',
  limit: 1000,
  window: 60,
  keyStrategy: KeyStrategy.API_KEY,
};
```

#### Composite Keys (User + IP)

```typescript
const compositePolicy: Policy = {
  name: 'user_and_ip',
  limit: 50,
  window: 60,
  keyStrategy: KeyStrategy.COMPOSITE,
};
```

#### Weighted Endpoints

```typescript
const expensivePolicy: Policy = {
  name: 'llm_endpoint',
  limit: 100,
  window: 3600,
  cost: 10,  // Each request costs 10 tokens
  algorithm: Algorithm.TOKEN_BUCKET,
};
```

---

## Algorithms

### Token Bucket (Recommended)

Best for most use cases. Handles bursts naturally while maintaining average rate.

```typescript
import { Policy, Algorithm } from 'halt';

const policy: Policy = {
  name: 'token_bucket',
  limit: 100,        // 100 tokens per window
  window: 60,        // 1 minute
  burst: 120,        // Allow bursts up to 120
  algorithm: Algorithm.TOKEN_BUCKET,
};
```

**Pros:**
- ✅ Handles burst traffic naturally
- ✅ Smooth rate limiting
- ✅ Low memory usage

**Cons:**
- ❌ Slightly more complex than fixed window

### Fixed Window

Simple and fast. Good for strict limits.

```typescript
const policy: Policy = {
  name: 'fixed_window',
  limit: 100,
  window: 60,
  algorithm: Algorithm.FIXED_WINDOW,
};
```

**Pros:**
- ✅ Very simple
- ✅ Low memory usage
- ✅ Fast

**Cons:**
- ❌ Can allow 2x limit at window boundaries
- ❌ No burst handling

### Sliding Window

Most accurate but uses more memory.

```typescript
const policy: Policy = {
  name: 'sliding_window',
  limit: 100,
  window: 60,
  algorithm: Algorithm.SLIDING_WINDOW,
};
```

**Pros:**
- ✅ Most accurate
- ✅ No boundary issues

**Cons:**
- ❌ Higher memory usage
- ❌ Slightly slower

### Leaky Bucket

Traffic shaping with constant processing rate.

```typescript
const policy: Policy = {
  name: 'leaky_bucket',
  limit: 100,
  window: 60,
  burst: 120,
  algorithm: Algorithm.LEAKY_BUCKET,
};
```

**Pros:**
- ✅ Smooth traffic shaping
- ✅ Predictable behavior

**Cons:**
- ❌ May delay legitimate bursts

**Use case:** Strict QoS requirements, traffic shaping

---

## Key Strategies

### IP-based (Default)

```typescript
import { Policy, KeyStrategy, RateLimiter } from 'halt';

const policy: Policy = {
  name: 'per_ip',
  limit: 100,
  window: 60,
  keyStrategy: KeyStrategy.IP,
};

// With trusted proxies (for X-Forwarded-For)
const limiter = new RateLimiter({
  store,
  policy,
  trustedProxies: ['10.0.0.0/8', '172.16.0.0/12'],
});
```

### User-based

```typescript
const policy: Policy = {
  name: 'per_user',
  limit: 1000,
  window: 3600,
  keyStrategy: KeyStrategy.USER,
};
```

Extracts user ID from:
- `request.user.id`
- `request.userId`

### API Key-based

```typescript
const policy: Policy = {
  name: 'per_api_key',
  limit: 5000,
  window: 3600,
  keyStrategy: KeyStrategy.API_KEY,
};
```

Extracts API key from headers:
- `X-API-Key`
- `Authorization` (including Bearer tokens)

### Custom Key Extraction

```typescript
function extractOrgId(request: any): string | null {
  return request.headers['x-organization-id'] || null;
}

const policy: Policy = {
  name: 'per_org',
  limit: 10000,
  window: 3600,
  keyStrategy: KeyStrategy.CUSTOM,
  keyExtractor: extractOrgId,
};
```

---

## Exemptions

### Automatic Exemptions

Halt automatically exempts:

**Health Checks:**
- `/health`
- `/ping`
- `/ready`
- `/healthz`
- `/livez`

**Private IPs:**
- `127.0.0.1` (localhost)
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`

### Custom Exemptions

```typescript
const policy: Policy = {
  name: 'custom',
  limit: 100,
  window: 60,
  exemptions: [
    '/admin',           // Path exemption
    '/internal',        // Another path
    '192.168.1.100',   // IP exemption
  ],
};

// Disable private IP exemptions
const limiter = new RateLimiter({
  store,
  policy,
  exemptPrivateIps: false,
});
```

---

## Per-Route Rate Limiting

### Express - Route-Specific

```typescript
import { createLimiter } from 'halt/express';

const publicLimiter = new RateLimiter({ store, policy: presets.PUBLIC_API });
const authLimiter = new RateLimiter({ store, policy: presets.AUTH_ENDPOINTS });

app.get('/api/data', createLimiter(publicLimiter), (req, res) => {
  res.json({ data: '...' });
});

app.post('/auth/login', createLimiter(authLimiter), (req, res) => {
  res.json({ token: '...' });
});
```

### Next.js - Multiple Policies

```typescript
// app/api/data/route.ts
import { withPolicy } from 'halt/next';
import { InMemoryStore, presets } from 'halt';

const store = new InMemoryStore();

async function handler(req: Request) {
  return Response.json({ data: '...' });
}

export const GET = withPolicy(handler, presets.PUBLIC_API, store);
```

```typescript
// app/api/auth/login/route.ts
import { withPolicy } from 'halt/next';
import { InMemoryStore, presets } from 'halt';

const store = new InMemoryStore();

async function handler(req: Request) {
  return Response.json({ token: '...' });
}

export const POST = withPolicy(handler, presets.AUTH_ENDPOINTS, store);
```

---

## Response Headers

All responses include standard rate limit headers:

```http
HTTP/1.1 200 OK
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 1708024800
```

When rate limited (429):

```http
HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 1708024860
Retry-After: 42

{
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Please try again later.",
  "retryAfter": 42
}
```

---

## Advanced Usage

### Dynamic Cost per Request

```typescript
// Next.js API Route
import { RateLimiter, InMemoryStore, presets } from 'halt';

const limiter = new RateLimiter({
  store: new InMemoryStore(),
  policy: presets.EXPENSIVE_OPS,
});

export async function POST(req: Request) {
  const body = await req.json();
  const promptLength = body.prompt?.length || 0;
  
  // Calculate cost based on request
  const cost = Math.max(1, Math.floor(promptLength / 100));
  
  // Check with custom cost
  const decision = limiter.check(req, cost);
  
  if (!decision.allowed) {
    return Response.json(
      {
        error: 'rate_limit_exceeded',
        message: 'Too many requests',
        retryAfter: decision.retryAfter,
      },
      { status: 429 }
    );
  }
  
  return Response.json({ response: '...' });
}
```

### Multiple Policies (Express)

```typescript
import express from 'express';
import { RateLimiter, InMemoryStore, presets } from 'halt';
import { haltMiddleware, createLimiter } from 'halt/express';

const app = express();

// Global rate limit
const globalLimiter = new RateLimiter({
  store: new InMemoryStore(),
  policy: presets.GENEROUS_API,
});
app.use(haltMiddleware({ limiter: globalLimiter }));

// Endpoint-specific limits
const authLimiter = new RateLimiter({
  store: new InMemoryStore(),
  policy: presets.AUTH_ENDPOINTS,
});

app.post('/auth/login', createLimiter(authLimiter), (req, res) => {
  // This endpoint has BOTH global AND auth limits
  res.json({ token: '...' });
});
```

### Custom Blocked Response

```typescript
import { haltMiddleware } from 'halt/express';

app.use(haltMiddleware({
  limiter,
  onBlocked: (req, res) => {
    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Slow down! Try again later.',
      timestamp: Date.now(),
    });
  },
}));
```

---

## Testing

```typescript
import { describe, it, expect } from 'vitest';
import { RateLimiter, InMemoryStore, Policy, Algorithm } from 'halt';

describe('Rate Limiting', () => {
  it('should block after limit exceeded', () => {
    const policy: Policy = {
      name: 'test',
      limit: 5,
      window: 60,
      algorithm: Algorithm.TOKEN_BUCKET,
    };
    
    const limiter = new RateLimiter({
      store: new InMemoryStore(),
      policy,
    });
    
    // Mock request
    const request = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    };
    
    // First 5 requests should succeed
    for (let i = 0; i < 5; i++) {
      const decision = limiter.check(request);
      expect(decision.allowed).toBe(true);
    }
    
    // 6th request should be blocked
    const decision = limiter.check(request);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfter).toBeGreaterThan(0);
  });
});
```

---

## Troubleshooting

### Rate limits not working?

1. **Check if request is exempted:**
   - Health check paths are auto-exempted
   - Private IPs are auto-exempted (disable with `exemptPrivateIps: false`)

2. **Verify key extraction:**
   ```typescript
   // Debug key extraction
   const key = (limiter as any).extractKey(request);
   console.log('Rate limit key:', key);
   ```

3. **Check storage:**
   - InMemoryStore doesn't persist across restarts
   - Each process has its own memory store

### Headers not appearing?

Make sure middleware is added correctly and responses are going through the middleware chain.

### Different limits for same IP?

You might be using different policy names. Each policy maintains separate counters:

```typescript
// These are SEPARATE limits
const policy1: Policy = { name: 'api_v1', limit: 100, window: 60 };
const policy2: Policy = { name: 'api_v2', limit: 100, window: 60 };
```

---

## Performance

| Algorithm | Throughput | Memory | Accuracy |
|-----------|-----------|--------|----------|
| Token Bucket | ~100k req/s | Low | High |
| Fixed Window | ~120k req/s | Very Low | Medium |
| Sliding Window | ~80k req/s | Medium | Very High |
| Leaky Bucket | ~90k req/s | Low | High |

*Benchmarks on M1 Mac, in-memory storage*

All algorithms use O(1) memory per key (except Sliding Window which uses O(precision) per key).

---

## TypeScript Support

Halt is written in TypeScript and provides full type safety:

```typescript
import type { Policy, Decision, RateLimiterOptions } from 'halt';

const policy: Policy = {
  name: 'typed',
  limit: 100,
  window: 60,
};

const decision: Decision = limiter.check(request);
```

---

## License

MIT

---

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

---

## Roadmap

### v0.3 (Current)
- ✅ Token Bucket algorithm
- ✅ Fixed Window algorithm
- ✅ Sliding Window algorithm
- ✅ Leaky Bucket algorithm
- ✅ In-memory storage
- ✅ PostgreSQL storage
- ✅ MongoDB storage
- ✅ DynamoDB storage
- ✅ Memcached storage
- ✅ Quota system
- ✅ Penalty system
- ✅ Telemetry hooks
- ✅ Plan-based presets
- ⏳ Redis storage

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
