// Route registration index — EXTENSION POINT for phase B: add operations/finance/closing/reports/admin route modules here.
import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { coreRoutes } from './core.js';
import { referenceRoutes } from './reference.js';
import { publicRoutes } from './public.js';
import { operationsRoutes } from './operations.js';
import { adminRoutes } from './admin.js';
import { publicPhaseBRoutes } from './public-b.js';
import { healthRoutes } from './health.js';
import { pushRoutes } from './push.js';
import { inboundRoutes, inboundStaffRoutes } from './inbound.js';
import { importRoutes } from './import.js';
import { integrationRoutes } from './integrations.js';
import { teamRoutes } from './team.js';
import { procurementRoutes } from './procurement.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/health (liveness + db status), GET /api/ready (readiness)
  await app.register(healthRoutes);
  // Web Push subscriptions (§15)
  await app.register(pushRoutes);
  await app.register(authRoutes);
  await app.register(coreRoutes);
  await app.register(referenceRoutes);
  // encapsulated: rate limiting applies to /api/public/* only
  await app.register(publicRoutes);
  // phase B: steps 6–8, reports, admin; public rooming / consent / extras / survey (own rate-limited scope)
  await app.register(operationsRoutes);
  await app.register(adminRoutes);
  await app.register(publicPhaseBRoutes);
  // inbound e-mail / WhatsApp webhooks (signature-authenticated, raw body, own rate limit) + staff inbox views
  await app.register(inboundRoutes);
  await app.register(inboundStaffRoutes);
  // outbound integrations: per-user mailbox OAuth, §15 notification acknowledge / fallback phone
  await app.register(integrationRoutes);
  // §8 initial historical data import (admin only)
  await app.register(importRoutes);
  // v0.5-A ekip, iletişim ve kontrol (hızlı onay, nöbet, ekipler, devir-teslim, saha paketi, istisnalar)
  await app.register(teamRoutes);
  // v0.5-A para ve tedarik çekirdeği: settings (base currency), contract rates, allotments, supplier options
  await app.register(procurementRoutes);
}
