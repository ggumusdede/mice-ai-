// Outbound integrations (staff): per-user mailbox OAuth connect / status / disconnect, critical-notification acknowledge
// (§15 fallback), the user's own fallback phone number. Nothing is deleted: disconnect marks the account inactive.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withSystemCtx } from '../context.js';
import { loadDeliveryConfig } from '../delivery-config.js';
import { badRequest } from '../errors.js';
import { completeMailOAuth, disconnectMailAccount, listMailAccounts, MAIL_OAUTH_PROVIDERS, OAuthCallbackError, startMailOAuth, type MailOAuthProvider } from '../services/mail-accounts.js';
import { normalizeMsisdn } from '../services/messaging.js';
import { ackNotification, verifyPushAckToken } from '../services/notifications.js';
import { asUser, idParam, list, parse, requireAuth } from './_helpers.js';

const auth = { preHandler: requireAuth };
const providerParam = z.object({ provider: z.enum(MAIL_OAUTH_PROVIDERS as [MailOAuthProvider, ...MailOAuthProvider[]]) });

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadDeliveryConfig();
  const oauth = cfg.email.oauth;
  const back = (q: Record<string, string>) => `${app.deps.config.publicBaseUrl || ''}/?${new URLSearchParams(q).toString()}`;

  app.get('/api/mail/accounts', auth, async (req) => asUser(req, async (ctx) => ({
    ...list(await listMailAccounts(ctx)),
    providers: { google: !!oauth.google, microsoft: !!oauth.microsoft },
    emailProvider: cfg.email.provider,
    fallback: oauth.fallback,
  })));

  /** → {url}: the web app navigates there (a bearer token cannot ride along a browser redirect). */
  app.get('/api/mail/oauth/:provider/start', auth, async (req) => {
    const { provider } = parse(providerParam, req.params);
    return asUser(req, (ctx) => startMailOAuth(ctx, provider, oauth));
  });

  /** Provider redirect target (no JWT — the signed, single-use state carries user + tenant). Always 302 back to the app. */
  app.get('/api/mail/oauth/:provider/callback', async (req, reply) => {
    const p = providerParam.safeParse(req.params);
    if (!p.success) return reply.redirect(back({ mail_oauth: 'error', reason: 'unknown_provider' }));
    const q = (req.query ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof q[k] === 'string' ? (q[k] as string) : undefined);
    try {
      const r = await completeMailOAuth(app.deps, p.data.provider, { code: s('code'), state: s('state'), error: s('error') }, oauth);
      return reply.redirect(back({ mail_oauth: 'connected', provider: p.data.provider, address: r.emailAddress }));
    } catch (e) {
      const reason = e instanceof OAuthCallbackError ? e.reason : 'internal_error';
      req.log?.warn?.({ reason, err: (e as Error).message }, 'mail oauth callback failed');
      return reply.redirect(back({ mail_oauth: 'error', reason }));
    }
  });

  app.post('/api/mail/accounts/:id/disconnect', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => disconnectMailAccount(ctx, id, oauth));
  });

  // ---------------- §15 acknowledge (stops the WhatsApp / SMS fallback)
  app.post('/api/notifications/:id/ack', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => ({ ok: await ackNotification(ctx.db, id, 'api', ctx.now(), ctx.user!.id) }));
  });
  /** Service worker on notification click — signed per-notification token, no login (it can only mark that row opened). */
  app.post('/api/push/ack/:token', async (req, reply) => {
    const token = String((req.params as { token?: string }).token ?? '');
    const v = verifyPushAckToken(app.deps.config.jwtSecret, token);
    if (!v || !z.string().uuid().safeParse(v.notificationId).success) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Bulunamadı' } });
    const ok = await withSystemCtx(app.deps, v.tenantId, { type: 'system', id: null }, (ctx) => ackNotification(ctx.db, v.notificationId, 'push_click', ctx.now()));
    return { ok };
  });

  // ---------------- own fallback phone (WhatsApp / SMS for unopened critical notifications)
  app.get('/api/me/notify-phone', auth, async (req) => asUser(req, async (ctx) => {
    const r = (await ctx.db.query('SELECT notify_phone FROM users WHERE id = $1', [ctx.user!.id])).rows[0];
    return { phone: r?.notify_phone ?? null, channelLive: !!(cfg.messaging.sms || (cfg.messaging.provider === 'whatsapp_cloud' && cfg.messaging.whatsapp.token)) };
  }));
  app.post('/api/me/notify-phone', auth, async (req) => {
    const b = parse(z.object({ phone: z.string().max(32).nullable() }), req.body);
    const phone = b.phone?.trim() ? normalizeMsisdn(b.phone) : null;
    if (b.phone?.trim() && !phone) throw badRequest('Geçersiz telefon numarası', undefined, 'INVALID_PHONE');
    return asUser(req, async (ctx) => {
      await ctx.db.query('UPDATE users SET notify_phone = $2 WHERE id = $1', [ctx.user!.id, phone]);
      return { phone };
    });
  });
}
