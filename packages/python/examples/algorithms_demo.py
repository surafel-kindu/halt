"""
Example demonstrating all three rate limiting algorithms.
"""

from halt import RateLimiter, InMemoryStore, Policy, Algorithm, KeyStrategy
import time


def test_algorithm(algorithm: Algorithm, name: str, sliding_precision: int | None = None):
    """Test a specific algorithm."""
    print(f"\n{'='*60}")
    print(f"Testing {name}")
    print('='*60)

    policy_kwargs = dict(
        name=name.lower().replace(' ', '_'),
        limit=5,
        window=10,  # 10 seconds
        algorithm=algorithm,
        key_strategy=KeyStrategy.IP,
    )

    if algorithm == Algorithm.SLIDING_WINDOW and sliding_precision is not None:
        policy_kwargs["sliding_precision"] = sliding_precision
        print(f"Sliding precision: {sliding_precision}")

    policy = Policy(**policy_kwargs)
    
    limiter = RateLimiter(store=InMemoryStore(), policy=policy)
    
    # Mock request
    class MockRequest:
        def __init__(self):
            self.client = type('obj', (object,), {'host': '192.168.1.100'})
    
    request = MockRequest()
    
    # Make 7 requests
    for i in range(7):
        decision = limiter.check(request)
        
        status = "✅ ALLOWED" if decision.allowed else "❌ BLOCKED"
        print(f"Request {i+1}: {status}")
        print(f"  Limit: {decision.limit}")
        print(f"  Remaining: {decision.remaining}")
        print(f"  Reset at: {decision.reset_at}")
        
        if not decision.allowed and decision.retry_after:
            print(f"  Retry after: {decision.retry_after}s")
        
        print()
        time.sleep(0.5)  # Small delay between requests


if __name__ == "__main__":
    print("Halt Rate Limiting - Algorithm Comparison")
    print("This demo shows how different algorithms behave")
    print("Policy: 5 requests per 10 seconds")
    
    # Test Token Bucket
    test_algorithm(Algorithm.TOKEN_BUCKET, "Token Bucket")
    
    # Test Fixed Window
    test_algorithm(Algorithm.FIXED_WINDOW, "Fixed Window")
    
    # Test Sliding Window with custom precision
    test_algorithm(Algorithm.SLIDING_WINDOW, "Sliding Window", sliding_precision=20)
    
    print("\n" + "="*60)
    print("Algorithm Comparison Complete!")
    print("="*60)
    print("\nKey Differences:")
    print("- Token Bucket: Smooth refill, handles bursts well")
    print("- Fixed Window: Simple, but can allow 2x at boundaries")
    print("- Sliding Window: Most accurate, higher memory usage")
