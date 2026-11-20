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
import { registerRoutes } from './routes/index.js';
import { OutboxEmailProvider, type EmailProvider } from './services/email.js';
import { registerAll } from './services/registry.js';
import type { AiService } from '@mice/ai';

export interface BuildOptions {
  config?: Partial<AppConfig>;
  ai?: AiService;
  email?: EmailProvider;
  now?: () => Date;
  rng?: () => number;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config: AppConfig = { ...loadConfig(), ...(opts.config ?? {}) };
  initPool(config.databaseUrl);
  registerAll();
  const deps: AppDeps = {
    config,
    ai: opts.ai ?? createAiService(process.env),
    email: opts.email ?? new OutboxEmailProvider({ log: config.nodeEnv === 'development' }),
    now: opts.now ?? (() => new Date()),
    rng: opts.rng ?? Math.random,
  };
  const app = Fastify({ logger: opts.logger ?? config.nodeEnv === 'development', bodyLimit: 10 * 1024 * 1024 });
  app.decorate('deps', deps);
  registerErrorHandler(app);
  await app.register(cors, { origin: config.corsOrigins, credentials: true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });
  await registerRoutes(app);
  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    const app = await buildApp();
    const { port, host } = app.deps.config;
    const shutdown = async () => {
      await app.close();
      await closePool();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    await app.listen({ port, host });
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
