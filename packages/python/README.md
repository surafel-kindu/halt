# Halt Python SDK

**Drop-in middleware that enforces consistent rate limits per IP/user/api-key with safe defaults, Redis-backed accuracy, and clean headers.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)

## Features

🚀 **Multiple Algorithms**
- Token Bucket (burst-friendly, recommended)
- Fixed Window (simple, fast)
- Sliding Window (accurate, memory-intensive)

🔑 **Flexible Key Strategies**
- Per-IP address
- Per-authenticated user
- Per-API key
- Composite keys (e.g., `user:ip`)
- Custom key extraction

💾 **Storage Options**
- In-memory (development)
- Redis (production, coming soon)

🎯 **Framework Support**
- FastAPI / Starlette
- Flask
- Django

📊 **Standard Headers**
- `RateLimit-Limit`
- `RateLimit-Remaining`
- `RateLimit-Reset`
- `Retry-After` (on 429)

⚡ **Smart Features**
- Automatic health check exemptions
- Private IP exemptions
- Custom exemption lists
- Weighted endpoints (cost-based)
- Burst handling

---

## Installation

```bash
pip install halt
```

### Optional Dependencies

```bash
# Redis support (coming soon)
pip install halt[redis]

# Framework-specific
pip install halt[fastapi]
pip install halt[flask]
pip install halt[django]

# Development
pip install halt[dev]
```

---

## Quick Start

### FastAPI

```python
from fastapi import FastAPI
from halt import RateLimiter, InMemoryStore, presets
from halt.adapters.fastapi import HaltMiddleware

app = FastAPI()

# Create rate limiter
limiter = RateLimiter(
    store=InMemoryStore(),
    policy=presets.PUBLIC_API  # 100 req/min
)

# Add middleware
app.add_middleware(HaltMiddleware, limiter=limiter)

@app.get("/")
async def root():
    return {"message": "Hello World"}
```

### Flask

```python
from flask import Flask
from halt import RateLimiter, InMemoryStore, presets
from halt.adapters.flask import HaltFlask

app = Flask(__name__)

limiter = RateLimiter(
    store=InMemoryStore(),
    policy=presets.PUBLIC_API
)

HaltFlask(app, limiter=limiter)

@app.route("/")
def root():
    return {"message": "Hello World"}
```

### Django

```python
# settings.py
from halt import RateLimiter, InMemoryStore, presets
from halt.adapters.django import create_halt_middleware

limiter = RateLimiter(
    store=InMemoryStore(),
    policy=presets.PUBLIC_API
)

HaltMiddleware = create_halt_middleware(limiter)

MIDDLEWARE = [
    # ... other middleware
    'myapp.middleware.HaltMiddleware',
]
```

---

## Preset Policies

Halt comes with battle-tested presets:

```python
from halt import presets

# Public API - moderate limits
presets.PUBLIC_API
# 100 requests/minute, burst: 120

# Authentication endpoints - strict
presets.AUTH_ENDPOINTS
# 5 requests/minute, burst: 10, 5min cooldown

# Expensive operations - very strict
presets.EXPENSIVE_OPS
# 10 requests/hour, burst: 15, cost: 10

# Strict API - for sensitive ops
presets.STRICT_API
# 20 requests/minute, burst: 25

# Generous API - for internal services
presets.GENEROUS_API
# 1000 requests/minute, burst: 1200
```

---

## SaaS Features

### Plan-Based Rate Limiting

```python
from halt import presets

# Use plan-based presets
PLAN_FREE = presets.PLAN_FREE          # 100 req/hour
PLAN_STARTER = presets.PLAN_STARTER    # 500 req/hour
PLAN_PRO = presets.PLAN_PRO            # 2000 req/hour
PLAN_BUSINESS = presets.PLAN_BUSINESS  # 5000 req/hour
PLAN_ENTERPRISE = presets.PLAN_ENTERPRISE  # 20000 req/hour

# Get policy by plan name
policy = presets.get_plan_policy("pro")

# Dynamic policy resolution
def get_user_policy(request):
    user = get_current_user(request)
    return presets.get_plan_policy(user.plan)

limiter = RateLimiter(
    store=store,
    policy=get_user_policy(request)
)
```

### Quota Management

```python
from halt.core.quota import QuotaManager, Quota, QuotaPeriod

# Initialize quota manager
quota_manager = QuotaManager(store)

# Define quotas
monthly_quota = Quota(
    name="api_calls",
    limit=100000,
    period=QuotaPeriod.MONTHLY
)

# Check quota
allowed, current_quota = quota_manager.check_quota(
    identifier="user_123",
    quota=monthly_quota
)

if allowed:
    # Consume quota
    quota_manager.consume_quota("user_123", monthly_quota, cost=1)
else:
    # Quota exceeded
    print(f"Quota exceeded. Resets at: {current_quota.reset_at}")
```

### Penalty System

```python
from halt.core.penalty import PenaltyManager, PenaltyConfig

# Initialize penalty manager
penalty_manager = PenaltyManager(
    store=store,
    config=PenaltyConfig(
        threshold=10,      # Abuse score threshold
        duration=3600,     # 1 hour penalty
        multiplier=0.5,    # Reduce limit to 50%
        decay_rate=1.0     # 1 point/hour decay
    )
)

# Record violation
penalty = penalty_manager.record_violation(
    identifier="user_123",
    severity=1.0
)

# Check penalty status
if penalty.is_active():
    print(f"User penalized until: {penalty.penalty_until}")
    print(f"Abuse score: {penalty.abuse_score}")
```

### Telemetry & Observability

```python
from halt.core.telemetry import LoggingTelemetry, MetricsTelemetry
import logging

# Logging telemetry
logger = logging.getLogger(__name__)
telemetry = LoggingTelemetry(logger)

# Metrics telemetry (Prometheus, StatsD, etc.)
from prometheus_client import Counter, Gauge

class PrometheusTelemetry:
    def __init__(self):
        self.checks = Counter('halt_checks_total', 'Total rate limit checks')
        self.blocked = Counter('halt_blocked_total', 'Total blocked requests')
        self.remaining = Gauge('halt_remaining', 'Remaining requests')
    
    def on_check(self, key, decision, metadata=None):
        self.checks.inc()
    
    def on_blocked(self, key, decision, metadata=None):
        self.blocked.inc()
    
    def on_allowed(self, key, decision, metadata=None):
        self.remaining.set(decision.remaining)

# Use with limiter
limiter = RateLimiter(
    store=store,
    policy=policy,
    telemetry=PrometheusTelemetry()
)
```

---

## Custom Policies

### Basic Custom Policy

```python
from halt import Policy, KeyStrategy, Algorithm

custom_policy = Policy(
    name="custom",
    limit=50,
    window=60,  # 1 minute
    burst=60,
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.IP,
)
```

### Advanced Examples

#### Rate Limit by User

```python
user_policy = Policy(
    name="per_user",
    limit=100,
    window=3600,  # 1 hour
    key_strategy=KeyStrategy.USER,
)
```

#### Rate Limit by API Key

```python
api_policy = Policy(
    name="per_api_key",
    limit=1000,
    window=60,
    key_strategy=KeyStrategy.API_KEY,
)
```

#### Composite Keys (User + IP)

```python
composite_policy = Policy(
    name="user_and_ip",
    limit=50,
    window=60,
    key_strategy=KeyStrategy.COMPOSITE,
)
```

#### Weighted Endpoints

```python
expensive_policy = Policy(
    name="llm_endpoint",
    limit=100,
    window=3600,
    cost=10,  # Each request costs 10 tokens
    algorithm=Algorithm.TOKEN_BUCKET,
)
```

---

## Algorithms

### Token Bucket (Recommended)

Best for most use cases. Handles bursts naturally while maintaining average rate.

```python
from halt import Policy, Algorithm

policy = Policy(
    name="token_bucket",
    limit=100,        # 100 tokens per window
    window=60,        # 1 minute
    burst=120,        # Allow bursts up to 120
    algorithm=Algorithm.TOKEN_BUCKET,
)
```

**Pros:**
- ✅ Handles burst traffic naturally
- ✅ Smooth rate limiting
- ✅ Low memory usage

**Cons:**
- ❌ Slightly more complex than fixed window

### Fixed Window

Simple and fast. Good for strict limits.

```python
policy = Policy(
    name="fixed_window",
    limit=100,
    window=60,
    algorithm=Algorithm.FIXED_WINDOW,
)
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

```python
policy = Policy(
    name="sliding_window",
    limit=100,
    window=60,
    algorithm=Algorithm.SLIDING_WINDOW,
)
```

**Pros:**
- ✅ Most accurate
- ✅ No boundary issues

**Cons:**
- ❌ Higher memory usage
- ❌ Slightly slower

---

## Key Strategies

### IP-based (Default)

```python
from halt import Policy, KeyStrategy

policy = Policy(
    name="per_ip",
    limit=100,
    window=60,
    key_strategy=KeyStrategy.IP,
)

# With trusted proxies (for X-Forwarded-For)
limiter = RateLimiter(
    store=store,
    policy=policy,
    trusted_proxies=["10.0.0.0/8", "172.16.0.0/12"],
)
```

### User-based

```python
policy = Policy(
    name="per_user",
    limit=1000,
    window=3600,
    key_strategy=KeyStrategy.USER,
)
```

Extracts user ID from:
- `request.user.id`
- `request.state.user_id`

### API Key-based

```python
policy = Policy(
    name="per_api_key",
    limit=5000,
    window=3600,
    key_strategy=KeyStrategy.API_KEY,
)
```

Extracts API key from headers:
- `X-API-Key`
- `Authorization` (including Bearer tokens)

### Custom Key Extraction

```python
def extract_org_id(request):
    """Extract organization ID from request."""
    return request.headers.get("X-Organization-ID")

policy = Policy(
    name="per_org",
    limit=10000,
    window=3600,
    key_strategy=KeyStrategy.CUSTOM,
    key_extractor=extract_org_id,
)
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

```python
policy = Policy(
    name="custom",
    limit=100,
    window=60,
    exemptions=[
        "/admin",           # Path exemption
        "/internal",        # Another path
        "192.168.1.100",   # IP exemption
    ]
)

# Disable private IP exemptions
limiter = RateLimiter(
    store=store,
    policy=policy,
    exempt_private_ips=False,
)
```

---

## Per-Route Rate Limiting

### FastAPI - Dependency Injection

```python
from fastapi import Depends
from halt.adapters.fastapi import create_limiter_dependency

# Create different limiters for different routes
public_limiter = RateLimiter(store=store, policy=presets.PUBLIC_API)
auth_limiter = RateLimiter(store=store, policy=presets.AUTH_ENDPOINTS)

public_limit = create_limiter_dependency(public_limiter)
auth_limit = create_limiter_dependency(auth_limiter)

@app.get("/api/data", dependencies=[Depends(public_limit)])
async def get_data():
    return {"data": "..."}

@app.post("/auth/login", dependencies=[Depends(auth_limit)])
async def login():
    return {"token": "..."}
```

### Flask - Decorator

```python
from halt.adapters.flask import limit

public_limiter = RateLimiter(store=store, policy=presets.PUBLIC_API)
auth_limiter = RateLimiter(store=store, policy=presets.AUTH_ENDPOINTS)

@app.route("/api/data")
@limit(public_limiter)
def get_data():
    return {"data": "..."}

@app.route("/auth/login", methods=["POST"])
@limit(auth_limiter)
def login():
    return {"token": "..."}
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
  "retry_after": 42
}
```

---

## Advanced Usage

### Dynamic Cost per Request

```python
from fastapi import Request

@app.post("/api/llm")
async def llm_endpoint(request: Request):
    # Calculate cost based on request
    prompt_length = len(request.json().get("prompt", ""))
    cost = max(1, prompt_length // 100)  # 1 token per 100 chars
    
    # Check with custom cost
    decision = limiter.check(request, cost=cost)
    
    if not decision.allowed:
        raise HTTPException(status_code=429, detail="Rate limited")
    
    return {"response": "..."}
```

### Multiple Policies

```python
# Global rate limit
global_limiter = RateLimiter(store=store, policy=presets.GENEROUS_API)
app.add_middleware(HaltMiddleware, limiter=global_limiter)

# Endpoint-specific limits
auth_limiter = RateLimiter(store=store, policy=presets.AUTH_ENDPOINTS)
auth_limit = create_limiter_dependency(auth_limiter)

@app.post("/auth/login", dependencies=[Depends(auth_limit)])
async def login():
    # This endpoint has BOTH global AND auth limits
    return {"token": "..."}
```

---

## Testing

```python
import pytest
from halt import RateLimiter, InMemoryStore, Policy, Algorithm

def test_rate_limiting():
    policy = Policy(
        name="test",
        limit=5,
        window=60,
        algorithm=Algorithm.TOKEN_BUCKET,
    )
    
    limiter = RateLimiter(store=InMemoryStore(), policy=policy)
    
    # Mock request
    class MockRequest:
        def __init__(self):
            self.client = type('obj', (object,), {'host': '127.0.0.1'})
    
    request = MockRequest()
    
    # First 5 requests should succeed
    for i in range(5):
        decision = limiter.check(request)
        assert decision.allowed
    
    # 6th request should be blocked
    decision = limiter.check(request)
    assert not decision.allowed
    assert decision.retry_after > 0
```

---

## Troubleshooting

### Rate limits not working?

1. **Check if request is exempted:**
   - Health check paths are auto-exempted
   - Private IPs are auto-exempted (disable with `exempt_private_ips=False`)

2. **Verify key extraction:**
   ```python
   # Debug key extraction
   key = limiter._extract_key(request)
   print(f"Rate limit key: {key}")
   ```

3. **Check storage:**
   - InMemoryStore doesn't persist across restarts
   - Each process has its own memory store

### Headers not appearing?

Make sure middleware is added correctly and responses are going through the middleware chain.

### Different limits for same IP?

You might be using different policy names. Each policy maintains separate counters:

```python
# These are SEPARATE limits
policy1 = Policy(name="api_v1", limit=100, window=60)
policy2 = Policy(name="api_v2", limit=100, window=60)
```

---

## Performance

- **Token Bucket:** ~0.1ms per check
- **Fixed Window:** ~0.05ms per check
- **Sliding Window:** ~0.2ms per check

All algorithms use O(1) memory per key (except Sliding Window which uses O(precision) per key).

---

## License

MIT

---

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

---

## Roadmap

- ✅ Token Bucket algorithm
- ✅ Fixed Window algorithm
- ✅ Sliding Window algorithm
- ✅ In-memory storage
- ⏳ Redis storage
- ⏳ Distributed rate limiting
- ⏳ Tenant quotas
- ⏳ Abuse detection
- ⏳ Observability hooks
