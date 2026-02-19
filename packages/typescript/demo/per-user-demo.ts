import { RateLimiter } from '../src/core/limiter';
import { InMemoryStore } from '../src/stores/memory';
import { PLAN_FREE, PLAN_PRO } from '../src/presets';

// Simple in-memory subscription map (replace with DB/Redis in production)
const subscriptions: Record<string, string> = {
  user_free: 'free',
  user_pro: 'pro',
};

// Resolver that returns a Policy per request
const resolver = (req: any) => {
  const userId = req.user?.id || req.userId;
  const plan = subscriptions[userId] || 'free';
  if (plan === 'pro') return PLAN_PRO;
  return PLAN_FREE;
};

const limiter = new RateLimiter({
  store: new InMemoryStore(),
  policy: resolver,
  metricsRecorder: (name, tags, value) => console.log('metric', name, tags, value),
});

async function demo() {
  const req = { user: { id: 'user_pro' }, socket: { remoteAddress: '1.2.3.4' }, path: '/api' };
  const decision = await limiter.check(req);
  console.log('decision', decision);
}

demo().catch(console.error);
