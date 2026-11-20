// Route registration index — EXTENSION POINT for phase B: add operations/finance/closing/reports/admin route modules here.
import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { coreRoutes } from './core.js';
import { referenceRoutes } from './reference.js';
import { publicRoutes } from './public.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(coreRoutes);
  await app.register(referenceRoutes);
  // encapsulated: rate limiting applies to /api/public/* only
  await app.register(publicRoutes);
}
