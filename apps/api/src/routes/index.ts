// Route registration index — EXTENSION POINT for phase B: add operations/finance/closing/reports/admin route modules here.
import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { coreRoutes } from './core.js';
import { referenceRoutes } from './reference.js';
import { publicRoutes } from './public.js';
import { operationsRoutes } from './operations.js';
import { adminRoutes } from './admin.js';
import { publicPhaseBRoutes } from './public-b.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(coreRoutes);
  await app.register(referenceRoutes);
  // encapsulated: rate limiting applies to /api/public/* only
  await app.register(publicRoutes);
  // phase B: steps 6–8, reports, admin; public rooming / consent / extras / survey (own rate-limited scope)
  await app.register(operationsRoutes);
  await app.register(adminRoutes);
  await app.register(publicPhaseBRoutes);
}
