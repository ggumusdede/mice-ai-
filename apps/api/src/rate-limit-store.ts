// Shared rate-limit store for multi-instance API deploys (security review residual risk 2 / G-21). The default store of
// @fastify/rate-limit is in-process memory: with N API instances behind a load balancer every limit is effectively ×N.
// RATE_LIMIT_REDIS_URL=redis://… switches all limiters (login, /api/public/*) to the plugin's built-in Redis store.
// `ioredis` is an OPTIONAL dependency: it is loaded only when the variable is set (`npm i ioredis -w apps/api` in that
// deployment); without it the API refuses to start instead of silently falling back to per-instance limits.
import type { FastifyInstance } from 'fastify';

let shared: Promise<{ quit(): Promise<unknown> }> | null = null;

/** Extra options for `app.register(rateLimit, …)`: `{}` (memory store) or the shared Redis store. */
export async function rateLimitStore(app: FastifyInstance): Promise<Record<string, unknown>> {
  const url = app.deps.config.rateLimitRedisUrl;
  if (!url) return {};
  shared ??= (async () => {
    const moduleName = 'ioredis'; // not a static import: the package is optional
    let mod: { default?: unknown };
    try {
      mod = (await import(moduleName)) as { default?: unknown };
    } catch {
      throw new Error('RATE_LIMIT_REDIS_URL is set but the optional package "ioredis" is not installed (npm i ioredis -w apps/api)');
    }
    const Redis = (mod.default ?? mod) as new (u: string, o: Record<string, unknown>) => { quit(): Promise<unknown> };
    return new Redis(url, { connectTimeout: 1000, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  })();
  const redis = await shared;
  app.addHook('onClose', async () => {
    if (!shared) return;
    shared = null;
    await redis.quit().catch(() => {});
  });
  // skipOnError: a Redis outage must not take the whole API down (limits pause, errors are logged by the plugin)
  return { redis, nameSpace: 'mice-rl:', skipOnError: true };
}
