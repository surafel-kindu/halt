/**
 * Example demonstrating SaaS platform with plan-based rate limiting,
 * quotas, penalties, and telemetry using Express.
 */

import express, { Request, Response, NextFunction } from 'express';
import { RateLimiter } from '../src/core/limiter';
import { InMemoryStore } from '../src/stores/memory';
import { getPlanPolicy } from '../src/presets';
import { QuotaManager, QUOTA_FREE_MONTHLY, QUOTA_PRO_MONTHLY } from '../src/core/quota';
import { PenaltyManager, PENALTY_MODERATE } from '../src/core/penalty';
import { LoggingTelemetry } from '../src/core/telemetry';

const app = express();
app.use(express.json());

// Initialize storage
const store = new InMemoryStore();

// Initialize managers
const quotaManager = new QuotaManager(store);
const penaltyManager = new PenaltyManager(store, PENALTY_MODERATE);

// Initialize telemetry
const telemetry = new LoggingTelemetry(console);

// Mock user database
const USERS: Record<string, { plan: string; apiKey: string }> = {
    user_free_123: { plan: 'free', apiKey: 'key_free_123' },
    user_pro_456: { plan: 'pro', apiKey: 'key_pro_456' },
    user_enterprise_789: { plan: 'enterprise', apiKey: 'key_enterprise_789' },
};

function getUserFromApiKey(apiKey: string): { id: string; plan: string } | null {
    for (const [userId, userData] of Object.entries(USERS)) {
        if (userData.apiKey === apiKey) {
            return { id: userId, plan: userData.plan };
        }
    }
    return null;
}

// Rate limiting middleware
app.use(async (req: Request, res: Response, next: NextFunction) => {
    // Skip health check
    if (req.path === '/health') {
        return next();
    }

    // Get API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
    }

    const user = getUserFromApiKey(apiKey);
    if (!user) {
        return res.status(401).json({ error: 'Invalid API key' });
    }

    // Check penalty status
    const penalty = await penaltyManager.getPenalty(user.id);
    if (penaltyManager.isActive(penalty)) {
        telemetry.onPenaltyApplied?.(user.id, penalty);
        return res.status(429).json({
            error: 'Rate limit penalty active',
            penaltyUntil: penalty.penaltyUntil,
            timeRemaining: penaltyManager.timeRemaining(penalty),
            abuseScore: penalty.abuseScore,
        });
    }

    // Check quota
    const quota = user.plan === 'free' ? QUOTA_FREE_MONTHLY : QUOTA_PRO_MONTHLY;
    const { allowed, quota: currentQuota } = await quotaManager.checkQuota(user.id, quota);

    if (!allowed) {
        telemetry.onQuotaExceeded?.(user.id, currentQuota);
        return res.status(429).json({
            error: 'Monthly quota exceeded',
            quotaLimit: currentQuota.limit,
            quotaUsed: currentQuota.currentUsage,
            resetAt: currentQuota.resetAt,
        });
    }

    // Check rate limit
    const policy = getPlanPolicy(user.plan);
    const limiter = new RateLimiter({ store, policy });

    const decision = limiter.check(req);

    const metadata = { policy: policy.name, algorithm: policy.algorithm, plan: user.plan };
    telemetry.onCheck?.(user.id, decision, metadata);

    if (!decision.allowed) {
        // Record violation
        await penaltyManager.recordViolation(user.id, 1.0);
        telemetry.onBlocked?.(user.id, decision, metadata);

        return res.status(429).json({
            error: 'Rate limit exceeded',
            retryAfter: decision.retryAfter,
        });
    }

    // Consume quota
    await quotaManager.consumeQuota(user.id, quota);
    telemetry.onAllowed?.(user.id, decision, metadata);

    // Add headers
    res.setHeader('RateLimit-Limit', decision.limit.toString());
    res.setHeader('RateLimit-Remaining', decision.remaining.toString());
    res.setHeader('RateLimit-Reset', decision.resetAt.toString());
    res.setHeader('X-Quota-Remaining', quotaManager.remaining(currentQuota).toString());

    next();
});

// Routes
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

app.get('/api/data', (req, res) => {
    const apiKey = req.headers['x-api-key'] as string;
    const user = getUserFromApiKey(apiKey);

    res.json({
        data: [1, 2, 3, 4, 5],
        user: user?.id,
        plan: user?.plan,
    });
});

app.get('/api/premium', (req, res) => {
    const apiKey = req.headers['x-api-key'] as string;
    const user = getUserFromApiKey(apiKey);

    if (user?.plan === 'free') {
        return res.status(403).json({ error: 'Premium feature - upgrade required' });
    }

    res.json({
        premiumData: 'secret information',
        user: user?.id,
        plan: user?.plan,
    });
});

app.get('/api/quota', async (req, res) => {
    const apiKey = req.headers['x-api-key'] as string;
    const user = getUserFromApiKey(apiKey);

    if (!user) {
        return res.status(401).json({ error: 'Invalid API key' });
    }

    const quota = user.plan === 'free' ? QUOTA_FREE_MONTHLY : QUOTA_PRO_MONTHLY;
    const currentQuota = await quotaManager.getQuota(user.id, quota);

    res.json({
        quotaName: currentQuota.name,
        limit: currentQuota.limit,
        used: currentQuota.currentUsage,
        remaining: quotaManager.remaining(currentQuota),
        resetAt: currentQuota.resetAt,
        period: currentQuota.period,
    });
});

app.get('/api/penalty', async (req, res) => {
    const apiKey = req.headers['x-api-key'] as string;
    const user = getUserFromApiKey(apiKey);

    if (!user) {
        return res.status(401).json({ error: 'Invalid API key' });
    }

    const penalty = await penaltyManager.getPenalty(user.id);

    res.json({
        abuseScore: penalty.abuseScore,
        violations: penalty.violations,
        penaltyActive: penaltyManager.isActive(penalty),
        penaltyUntil: penalty.penaltyUntil,
        timeRemaining: penaltyManager.timeRemaining(penalty),
    });
});

const PORT = 3000;

app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('SaaS Platform with Halt - Advanced Features Demo');
    console.log('='.repeat(60));
    console.log('\nFeatures:');
    console.log('  ✅ Plan-based rate limiting (Free, Pro, Enterprise)');
    console.log('  ✅ Monthly quotas');
    console.log('  ✅ Penalty system for abuse detection');
    console.log('  ✅ Telemetry and logging');
    console.log('\nTest users:');
    console.log('  Free:       X-API-Key: key_free_123       (100 req/hour, 10k/month)');
    console.log('  Pro:        X-API-Key: key_pro_456        (2000 req/hour, 100k/month)');
    console.log('  Enterprise: X-API-Key: key_enterprise_789 (20k req/hour, 1M/month)');
    console.log('\nEndpoints:');
    console.log('  GET /api/data          - Get data');
    console.log('  GET /api/premium       - Get premium data (Pro+ only)');
    console.log('  GET /api/quota         - Check quota status');
    console.log('  GET /api/penalty       - Check penalty status');
    console.log('\nExample:');
    console.log('  curl -H "X-API-Key: key_free_123" http://localhost:3000/api/data');
    console.log('  curl -H "X-API-Key: key_pro_456" http://localhost:3000/api/premium');
    console.log('='.repeat(60));
});
