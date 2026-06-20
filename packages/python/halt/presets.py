"""Preset rate limiting policies for common use cases."""

from halt.core.policy import Policy, KeyStrategy, Algorithm


# Public API - moderate limits for general public access
PUBLIC_API = Policy(
    name="public_api",
    limit=100,
    window=60,  # 1 minute
    burst=120,
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.IP,
)

# Authentication endpoints - strict limits to prevent brute force
AUTH_ENDPOINTS = Policy(
    name="auth_endpoints",
    limit=5,
    window=60,  # 1 minute
    burst=10,
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.IP,
    block_duration=300,  # 5 minute cooldown after limit exceeded
)

# Expensive operations - very strict limits for resource-intensive endpoints
EXPENSIVE_OPS = Policy(
    name="expensive_ops",
    limit=10,
    window=3600,  # 1 hour
    burst=15,
    cost=10,  # Each request costs 10 tokens
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.USER,
)

# Strict API - for sensitive operations
STRICT_API = Policy(
    name="strict_api",
    limit=20,
    window=60,  # 1 minute
    burst=25,
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.API_KEY,
)

# Generous API - for internal or trusted services
GENEROUS_API = Policy(
    name="generous_api",
    limit=1000,
    window=60,  # 1 minute
    burst=1200,
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.IP,
)

# Plan-based presets for SaaS platforms
PLAN_FREE = Policy(
    name="free_plan",
    limit=100,
    window=3600,  # 100 requests per hour
    burst=120,
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.USER,
)

PLAN_STARTER = Policy(
    name="starter_plan",
    limit=500,
    window=3600,  # 500 requests per hour
    burst=600,
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.USER,
)

PLAN_PRO = Policy(
    name="pro_plan",
    limit=2000,
    window=3600,  # 2000 requests per hour
    burst=2500,
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.USER,
)

PLAN_BUSINESS = Policy(
    name="business_plan",
    limit=5000,
    window=3600,  # 5000 requests per hour
    burst=6000,
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.USER,
)

PLAN_ENTERPRISE = Policy(
    name="enterprise_plan",
    limit=20000,
    window=3600,  # 20000 requests per hour
    burst=25000,
    algorithm=Algorithm.TOKEN_BUCKET,
    key_strategy=KeyStrategy.USER,
)

# Plan mapping helper
PLAN_TIERS = {
    "free": PLAN_FREE,
    "starter": PLAN_STARTER,
    "pro": PLAN_PRO,
    "business": PLAN_BUSINESS,
    "enterprise": PLAN_ENTERPRISE,
}


def get_plan_policy(plan_name: str) -> Policy:
    """Get the policy for a plan tier.

    Args:
        plan_name: Plan tier name (free, starter, pro, business, enterprise).

    Returns:
        The Policy for the plan.

    Raises:
        ValueError: If the plan name is invalid.
    """
    normalized = plan_name.lower()
    if normalized not in PLAN_TIERS:
        valid = ", ".join(PLAN_TIERS.keys())
        raise ValueError(f"Invalid plan: {plan_name}. Valid plans: {valid}")
    return PLAN_TIERS[normalized]
