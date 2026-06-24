"""
Example demonstrating SaaS platform with plan-based rate limiting,
quotas, penalties, and telemetry.
"""

import logging
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import JSONResponse

from halt import RateLimiter, InMemoryStore, presets
from halt import QuotaManager, QUOTA_FREE_MONTHLY, QUOTA_PRO_MONTHLY
from halt import PenaltyManager, PENALTY_MODERATE
from halt import LoggingTelemetry, CompositeTelemetry, StatsCollector

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize storage
store = InMemoryStore()

# Initialize managers
quota_manager = QuotaManager(store)
penalty_manager = PenaltyManager(store, config=PENALTY_MODERATE)

# Initialize telemetry
telemetry = LoggingTelemetry(logger)

# Create FastAPI app
app = FastAPI(title="SaaS API with Halt")


# Mock user database
USERS = {
    "user_free_123": {"plan": "free", "api_key": "key_free_123"},
    "user_pro_456": {"plan": "pro", "api_key": "key_pro_456"},
    "user_enterprise_789": {"plan": "enterprise", "api_key": "key_enterprise_789"},
}


def get_user_from_api_key(api_key: str) -> dict:
    """Get user from API key."""
    for user_id, user_data in USERS.items():
        if user_data["api_key"] == api_key:
            return {"id": user_id, **user_data}
    raise HTTPException(status_code=401, detail="Invalid API key")


def get_current_user(request: Request) -> dict:
    """Dependency to get current user from API key."""
    api_key = request.headers.get("X-API-Key")
    if not api_key:
        raise HTTPException(status_code=401, detail="API key required")
    return get_user_from_api_key(api_key)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Rate limiting middleware with plan-based limits."""
    
    # Skip rate limiting for health check
    if request.url.path == "/health":
        return await call_next(request)
    
    # Get API key
    api_key = request.headers.get("X-API-Key")
    if not api_key:
        return JSONResponse(
            status_code=401,
            content={"error": "API key required"}
        )
    
    try:
        user = get_user_from_api_key(api_key)
    except HTTPException:
        return JSONResponse(
            status_code=401,
            content={"error": "Invalid API key"}
        )
    
    user_id = user["id"]
    plan = user["plan"]
    
    # Get plan-based policy
    policy = presets.get_plan_policy(plan)
    
    # Check penalty status
    penalty = penalty_manager.get_penalty(user_id)
    if penalty.is_active():
        telemetry.on_penalty_applied(user_id, penalty)
        return JSONResponse(
            status_code=429,
            content={
                "error": "Rate limit penalty active",
                "penalty_until": penalty.penalty_until,
                "time_remaining": penalty.time_remaining(),
                "abuse_score": penalty.abuse_score
            }
        )
    
    # Check quota
    quota = QUOTA_FREE_MONTHLY if plan == "free" else QUOTA_PRO_MONTHLY
    allowed, current_quota = quota_manager.check_quota(user_id, quota)
    
    if not allowed:
        telemetry.on_quota_exceeded(user_id, current_quota)
        return JSONResponse(
            status_code=429,
            content={
                "error": "Monthly quota exceeded",
                "quota_limit": current_quota.limit,
                "quota_used": current_quota.current_usage,
                "reset_at": current_quota.reset_at
            },
            headers={
                "X-Quota-Limit": str(current_quota.limit),
                "X-Quota-Remaining": str(current_quota.remaining()),
                "X-Quota-Reset": str(current_quota.reset_at)
            }
        )
    
    # Check rate limit
    limiter = RateLimiter(store=store, policy=policy)
    
    # Mock request object for limiter
    class MockRequest:
        def __init__(self, user_id):
            self.user_id = user_id
    
    mock_request = MockRequest(user_id)
    decision = limiter.check(mock_request)
    
    # Log telemetry
    metadata = {"policy": policy.name, "algorithm": policy.algorithm.value, "plan": plan}
    telemetry.on_check(user_id, decision, metadata)
    
    if not decision.allowed:
        # Record violation for penalty system
        penalty_manager.record_violation(user_id, severity=1.0)
        telemetry.on_blocked(user_id, decision, metadata)
        
        return JSONResponse(
            status_code=429,
            content={
                "error": "Rate limit exceeded",
                "retry_after": decision.retry_after
            },
            headers={
                "RateLimit-Limit": str(decision.limit),
                "RateLimit-Remaining": str(decision.remaining),
                "RateLimit-Reset": str(decision.reset_at),
                "Retry-After": str(decision.retry_after)
            }
        )
    
    # Consume quota
    quota_manager.consume_quota(user_id, quota)
    telemetry.on_allowed(user_id, decision, metadata)
    
    # Add rate limit headers
    response = await call_next(request)
    response.headers["RateLimit-Limit"] = str(decision.limit)
    response.headers["RateLimit-Remaining"] = str(decision.remaining)
    response.headers["RateLimit-Reset"] = str(decision.reset_at)
    response.headers["X-Quota-Remaining"] = str(current_quota.remaining())
    
    return response


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/api/data")
async def get_data(user: dict = Depends(get_current_user)):
    """Get data (rate limited)."""
    return {
        "data": [1, 2, 3, 4, 5],
        "user": user["id"],
        "plan": user["plan"]
    }


@app.get("/api/premium")
async def get_premium_data(user: dict = Depends(get_current_user)):
    """Get premium data (rate limited)."""
    if user["plan"] == "free":
        raise HTTPException(status_code=403, detail="Premium feature - upgrade required")
    
    return {
        "premium_data": "secret information",
        "user": user["id"],
        "plan": user["plan"]
    }


@app.get("/api/quota")
async def get_quota_status(user: dict = Depends(get_current_user)):
    """Get current quota status."""
    quota = QUOTA_FREE_MONTHLY if user["plan"] == "free" else QUOTA_PRO_MONTHLY
    current_quota = quota_manager.get_quota(user["id"], quota)
    
    return {
        "quota_name": current_quota.name,
        "limit": current_quota.limit,
        "used": current_quota.current_usage,
        "remaining": current_quota.remaining(),
        "reset_at": current_quota.reset_at,
        "period": current_quota.period.value
    }


@app.get("/api/penalty")
async def get_penalty_status(user: dict = Depends(get_current_user)):
    """Get current penalty status."""
    penalty = penalty_manager.get_penalty(user["id"])
    
    return {
        "abuse_score": penalty.abuse_score,
        "violations": penalty.violations,
        "penalty_active": penalty.is_active(),
        "penalty_until": penalty.penalty_until,
        "time_remaining": penalty.time_remaining() if penalty.is_active() else 0
    }


if __name__ == "__main__":
    import uvicorn
    
    print("="*60)
    print("SaaS Platform with Halt - Advanced Features Demo")
    print("="*60)
    print("\nFeatures:")
    print("  ✅ Plan-based rate limiting (Free, Pro, Enterprise)")
    print("  ✅ Monthly quotas")
    print("  ✅ Penalty system for abuse detection")
    print("  ✅ Telemetry and logging")
    print("\nTest users:")
    print("  Free:       X-API-Key: key_free_123       (100 req/hour, 10k/month)")
    print("  Pro:        X-API-Key: key_pro_456        (2000 req/hour, 100k/month)")
    print("  Enterprise: X-API-Key: key_enterprise_789 (20k req/hour, 1M/month)")
    print("\nEndpoints:")
    print("  GET /api/data          - Get data")
    print("  GET /api/premium       - Get premium data (Pro+ only)")
    print("  GET /api/quota         - Check quota status")
    print("  GET /api/penalty       - Check penalty status")
    print("\nExample:")
    print('  curl -H "X-API-Key: key_free_123" http://localhost:8000/api/data')
    print('  curl -H "X-API-Key: key_pro_456" http://localhost:8000/api/premium')
    print("="*60)
    
    uvicorn.run(app, host="0.0.0.0", port=8000)
