// Fastify app factory. buildApp() is used by tests (app.inject); running this file starts the server (PORT, default 3001).
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAiService } from '@mice/ai';
import { loadConfig, type AppConfig } from './config.js';
import { closePool, initPool } from './db/pool.js';
import type { AppDeps } from './context.js';
import { registerErrorHandler } from './errors.js';
import { registerSecurityHeaders } from './security-headers.js';
import { registerRoutes } from './routes/index.js';
import type { EmailProvider } from './services/email.js';
import { createDeliveryProvider } from './services/delivery.js';
import { loadDeliveryConfig } from './delivery-config.js';
import { setNotificationService, type NotificationService } from './services/notifications.js';
import { createNotificationService } from './services/push.js';
import { loggerOptions, trustProxyOption } from './logger.js';
import { markShuttingDown } from './routes/health.js';
import { registerAll } from './services/registry.js';
import type { AiService } from '@mice/ai';

export interface BuildOptions {
  config?: Partial<AppConfig>;
  ai?: AiService;
  email?: EmailProvider;
  now?: () => Date;
  rng?: () => number;
  logger?: boolean;
  /** replaces the process-wide NotificationService (tests: mocked web push) */
  notifications?: NotificationService;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config: AppConfig = { ...loadConfig(), ...(opts.config ?? {}) };
  initPool(config.databaseUrl);
  registerAll();
  const deps: AppDeps = {
    config,
    ai: opts.ai ?? createAiService(process.env),
    // EMAIL_PROVIDER=smtp|outbox; sms / whatsapp → MessagingProvider (outbox)
    email: opts.email ?? createDeliveryProvider(loadDeliveryConfig()),
    now: opts.now ?? (() => new Date()),
    rng: opts.rng ?? Math.random,
  };
  if (opts.notifications) setNotificationService(opts.notifications);
  const logger = opts.logger === false ? false : opts.logger === true || config.nodeEnv !== 'test' ? loggerOptions() : false;
  const app = Fastify({
    logger,
    bodyLimit: 10 * 1024 * 1024,
    // behind nginx / a load balancer: real client IP for rate limiting and logs (TRUST_PROXY)
    trustProxy: trustProxyOption(process.env.TRUST_PROXY),
    requestIdHeader: 'x-request-id',
  });
  app.decorate('deps', deps);
  registerErrorHandler(app);
  registerSecurityHeaders(app);
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  await registerRoutes(app);
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    // VAPID keys → Web Push; else console fallback (every notification is stored in `notifications` either way)
    setNotificationService(createNotificationService(loadDeliveryConfig()));
    const app = await buildApp();
    const { port, host } = app.deps.config;
    // graceful shutdown: /api/ready → 503, stop accepting, finish in-flight requests, close the pool; hard exit after 15 s
    let closing = false;
    const shutdown = async (signal: string) => {
      if (closing) return;
      closing = true;
      markShuttingDown();
      app.log.info({ signal }, 'shutting down');
      const force = setTimeout(() => process.exit(1), Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 15_000));
      force.unref();
      try {
        await app.close();
        await closePool();
      } finally {
        process.exit(0);
      }
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    await app.listen({ port, host });
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
