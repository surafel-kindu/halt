/**
 * Example demonstrating all three rate limiting algorithms.
 */

import { RateLimiter, InMemoryStore, Policy, Algorithm, KeyStrategy } from '../src';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testAlgorithm(
    algorithm: Algorithm,
    name: string,
    slidingPrecision?: number
): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log(`Testing ${name}`);
    console.log('='.repeat(60));

    const policy: Policy = {
        name: name.toLowerCase().replace(/\s+/g, '_'),
        limit: 5,
        window: 10, // 10 seconds
        algorithm,
        keyStrategy: KeyStrategy.IP,
        ...(algorithm === Algorithm.SLIDING_WINDOW && slidingPrecision
            ? { slidingPrecision }
            : {}),
    };

    if (algorithm === Algorithm.SLIDING_WINDOW && slidingPrecision) {
        console.log(`Sliding precision: ${slidingPrecision}`);
    }

    const limiter = new RateLimiter({
        store: new InMemoryStore(),
        policy,
    });

    // Mock request
    const request = {
        socket: { remoteAddress: '192.168.1.100' },
        headers: {},
    };

    // Make 7 requests
    for (let i = 0; i < 7; i++) {
        const decision = await limiter.check(request);

        const status = decision.allowed ? '✅ ALLOWED' : '❌ BLOCKED';
        console.log(`Request ${i + 1}: ${status}`);
        console.log(`  Limit: ${decision.limit}`);
        console.log(`  Remaining: ${decision.remaining}`);
        console.log(`  Reset at: ${decision.resetAt}`);

        if (!decision.allowed && decision.retryAfter) {
            console.log(`  Retry after: ${decision.retryAfter}s`);
        }

        console.log();
        await sleep(500); // Small delay between requests
    }
}

async function main() {
    console.log('Halt Rate Limiting - Algorithm Comparison');
    console.log('This demo shows how different algorithms behave');
    console.log('Policy: 5 requests per 10 seconds');

    // Test Token Bucket
    await testAlgorithm(Algorithm.TOKEN_BUCKET, 'Token Bucket');

    // Test Fixed Window
    await testAlgorithm(Algorithm.FIXED_WINDOW, 'Fixed Window');

    // Test Sliding Window with custom precision
    await testAlgorithm(Algorithm.SLIDING_WINDOW, 'Sliding Window', 20);

    console.log('\n' + '='.repeat(60));
    console.log('Algorithm Comparison Complete!');
    console.log('='.repeat(60));
    console.log('\nKey Differences:');
    console.log('- Token Bucket: Smooth refill, handles bursts well');
    console.log('- Fixed Window: Simple, but can allow 2x at boundaries');
    console.log('- Sliding Window: Most accurate, higher memory usage');
}

main().catch(console.error);
