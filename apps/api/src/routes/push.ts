// Web Push subscription endpoints (§15). Records are never deleted: unsubscribe marks the row inactive.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadDeliveryConfig } from '../delivery-config.js';
import { subscribePush, unsubscribePush } from '../services/push.js';
import { asUser, parse, requireAuth } from './_helpers.js';

const auth = { preHandler: requireAuth };
const b64url = z.string().min(8).max(512).regex(/^[A-Za-z0-9_-]+=*$/);
const subscribeBody = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(2048),
    keys: z.object({ p256dh: b64url, auth: b64url }),
  }),
  userAgent: z.string().max(300).nullish(),
});
const unsubscribeBody = z.object({ endpoint: z.string().url().max(2048) });

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadDeliveryConfig();
  app.get('/api/push/vapid-public-key', auth, async () => ({ enabled: !!cfg.push.vapid, publicKey: cfg.push.vapid?.publicKey ?? null }));
  app.post('/api/push/subscribe', auth, async (req) => {
    const b = parse(subscribeBody, req.body);
    return asUser(req, (ctx) => subscribePush(ctx, { ...b.subscription, userAgent: b.userAgent ?? (req.headers['user-agent'] as string | undefined) ?? null }, cfg.push.allowedHosts));
  });
  app.post('/api/push/unsubscribe', auth, async (req) => {
    const b = parse(unsubscribeBody, req.body);
    return asUser(req, (ctx) => unsubscribePush(ctx, b.endpoint));
  });
}
