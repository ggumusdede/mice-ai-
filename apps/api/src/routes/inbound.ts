// Inbound channels (§7 Adım 0 / Adım 1, docs/07 §6–§7): provider-agnostic e-mail webhook + Postmark / Mailgun / raw MIME
// adapters, WhatsApp Cloud API webhook, and the staff views. Webhooks have NO login: they are authenticated by signature
// (per-tenant HMAC secret, Mailgun signing key, Postmark Basic auth, Meta X-Hub-Signature-256) and rate limited. The raw
// body is kept for signature verification (own content-type parsers, encapsulated in this plugin).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { rateLimitStore } from '../rate-limit-store.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { withoutTenant } from '../db/pool.js';
import { AppError, badRequest, notFound } from '../errors.js';
import { loadInboundConfig, type InboundConfig } from '../inbound-config.js';
import { asUser, idParam, list, parse, requireAuth } from './_helpers.js';
import {
  fromMailgun, fromMime, fromPostmark, fromWebhookJson, verifyBasicAuth, verifyMailgunSignature, verifyWebhookSignature, type InboundAttachment,
  type SignatureFailure,
} from '../services/inbound/normalize.js';
import { processInboundEmail } from '../services/inbound/email-router.js';
import { processWhatsAppWebhook, verifyMetaSignature, verifySubscription, whatsappWebhookSchema } from '../services/inbound/whatsapp.js';
import { listProjectInbound } from '../services/inbound/views.js';

const keyParam = z.object({ key: z.string().min(2).max(100).regex(/^[A-Za-z0-9_-]+$/) });

const invalidSignature = (why: SignatureFailure | 'unknown_tenant') => new AppError(401, 'INVALID_SIGNATURE', 'İmza doğrulanamadı', { reason: why === 'unknown_tenant' || why === 'no_secret' ? 'not_configured' : why });

/** Route key → tenant + secret. The env secret (INBOUND_EMAIL_SECRET) is a fallback ONLY for INBOUND_EMAIL_TENANT. */
async function emailTenant(cfg: InboundConfig['email'], key: string): Promise<{ tenantId: string; secret: string | null }> {
  const hit = await withoutTenant((db) => db.query('SELECT tenant_id, slug, secret FROM resolve_inbound_channel($1, $2)', ['email', key]).then((r) => r.rows[0]));
  if (!hit) throw invalidSignature('unknown_tenant');
  const secret = hit.secret ?? (hit.slug === cfg.fallbackTenantSlug ? cfg.fallbackSecret : null);
  return { tenantId: hit.tenant_id, secret };
}

function rawOf(req: FastifyRequest): Buffer {
  const b = req.body as unknown;
  return Buffer.isBuffer(b) ? b : Buffer.alloc(0);
}

function jsonOf(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('Geçersiz JSON', undefined, 'INVALID_JSON');
  }
}

export async function inboundRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadInboundConfig();
  await app.register(rateLimit, { ...(await rateLimitStore(app)), max: Number(process.env.INBOUND_RATE_LIMIT ?? 300), timeWindow: '1 minute' });
  // keep the raw bytes: signatures are computed over them (JSON is parsed only after verification)
  app.addContentTypeParser(['application/json', 'message/rfc822', 'application/octet-stream', 'text/plain'], { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  const limits = { email: { bodyLimit: cfg.email.maxRequestBytes }, wa: { bodyLimit: cfg.whatsapp.maxRequestBytes } };

  // ---------------- generic signed JSON webhook
  app.post('/api/inbound/email/:key', limits.email, async (req) => {
    const { key } = parse(keyParam, req.params);
    const t = await emailTenant(cfg.email, key);
    const raw = rawOf(req);
    const fail = verifyWebhookSignature(t.secret, { signature: req.headers['x-mice-signature'] as string | undefined, timestamp: req.headers['x-mice-timestamp'] as string | undefined }, raw, app.deps.now(), cfg.email.replayWindowSeconds);
    if (fail) throw invalidSignature(fail);
    const email = fromWebhookJson(jsonOf(raw), cfg.email.maxAttachmentBytes);
    return processInboundEmail(app.deps, t.tenantId, email, { source: 'webhook', cfg: cfg.email });
  });

  // ---------------- raw MIME (SES → S3/SNS forwarder, any MTA pipe), same HMAC headers
  app.post('/api/inbound/email/:key/mime', limits.email, async (req) => {
    const { key } = parse(keyParam, req.params);
    const t = await emailTenant(cfg.email, key);
    const raw = rawOf(req);
    const fail = verifyWebhookSignature(t.secret, { signature: req.headers['x-mice-signature'] as string | undefined, timestamp: req.headers['x-mice-timestamp'] as string | undefined }, raw, app.deps.now(), cfg.email.replayWindowSeconds);
    if (fail) throw invalidSignature(fail);
    const email = await fromMime(raw);
    return processInboundEmail(app.deps, t.tenantId, email, { source: 'mime', cfg: cfg.email });
  });

  // ---------------- Postmark inbound webhook (Basic auth in the webhook URL: https://inbound:<secret>@api…/postmark)
  app.post('/api/inbound/email/:key/postmark', limits.email, async (req) => {
    const { key } = parse(keyParam, req.params);
    const t = await emailTenant(cfg.email, key);
    const fail = verifyBasicAuth(t.secret, req.headers.authorization);
    if (fail) throw invalidSignature(fail);
    const email = fromPostmark(jsonOf(rawOf(req)), cfg.email.maxAttachmentBytes);
    return processInboundEmail(app.deps, t.tenantId, email, { source: 'postmark', cfg: cfg.email });
  });

  // ---------------- Mailgun route "forward" (multipart; signature = HMAC(signing key, timestamp + token))
  app.post('/api/inbound/email/:key/mailgun', limits.email, async (req) => {
    const { key } = parse(keyParam, req.params);
    const t = await emailTenant(cfg.email, key);
    if (!req.isMultipart()) throw badRequest('multipart/form-data bekleniyor', undefined, 'NO_INPUT');
    const fields: Record<string, string> = {};
    const files: InboundAttachment[] = [];
    for await (const part of req.parts({ limits: { files: cfg.email.maxAttachments + 1, fileSize: cfg.email.maxAttachmentBytes + 1, fieldSize: 5 * 1024 * 1024 } })) {
      if (part.type === 'file') files.push({ filename: part.filename, contentType: part.mimetype, content: await part.toBuffer() });
      else fields[part.fieldname] = String(part.value);
    }
    const fail = verifyMailgunSignature(t.secret, fields, app.deps.now(), cfg.email.replayWindowSeconds);
    if (fail) throw invalidSignature(fail);
    return processInboundEmail(app.deps, t.tenantId, fromMailgun(fields, files), { source: 'mailgun', cfg: cfg.email });
  });

  // ---------------- WhatsApp Cloud API
  app.get('/api/inbound/whatsapp', async (req, reply) => {
    const challenge = verifySubscription(cfg.whatsapp, (req.query ?? {}) as Record<string, unknown>);
    if (!challenge) return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Doğrulama başarısız' } });
    return reply.type('text/plain').send(challenge);
  });
  app.post('/api/inbound/whatsapp', limits.wa, async (req) => {
    const raw = rawOf(req);
    if (!verifyMetaSignature(cfg.whatsapp.appSecret, req.headers['x-hub-signature-256'] as string | undefined, raw)) {
      throw invalidSignature(cfg.whatsapp.appSecret ? 'bad_signature' : 'no_secret');
    }
    const payload = whatsappWebhookSchema.parse(jsonOf(raw));
    const r = await processWhatsAppWebhook(app.deps, payload, cfg.whatsapp);
    return { ok: true, processed: r.processed, ignored: r.ignored };
  });
}

/** Staff views / settings (JWT). Separate plugin: the raw-body parsers above must not apply here. */
export async function inboundStaffRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: requireAuth };
  app.get('/api/projects/:id/inbound-messages', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await listProjectInbound(ctx, id)));
  });
  // inbound channel settings (admin). The e-mail secret is generated here and returned ONCE.
  app.get('/api/inbound-channels', auth, async (req) => asUser(req, async (ctx) => list((await ctx.db.query(
    `SELECT id, channel, route_key, active, created_at, (secret IS NOT NULL) AS has_secret FROM inbound_channels WHERE active ORDER BY channel`)).rows.map((r) => ({
    id: r.id, channel: r.channel, routeKey: r.route_key, hasSecret: r.has_secret, createdAt: r.created_at,
  }))), ['admin']));
  app.post('/api/inbound-channels', auth, async (req) => {
    const body = parse(z.object({ channel: z.enum(['email', 'whatsapp']), routeKey: z.string().min(4).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(), rotateSecret: z.boolean().optional() }), req.body);
    return asUser(req, async (ctx) => {
      if (body.channel === 'whatsapp' && !body.routeKey) throw badRequest('WhatsApp için routeKey = phone_number_id gerekli', undefined, 'ROUTE_KEY_REQUIRED');
      const cur = (await ctx.db.query(`SELECT * FROM inbound_channels WHERE channel = $1 AND active FOR UPDATE`, [body.channel])).rows[0];
      const secret = body.channel === 'email' && (!cur?.secret || body.rotateSecret) ? randomBytes(32).toString('base64url') : null;
      // nothing is deleted: the previous row is deactivated, a new one carries the new settings
      if (cur) await ctx.db.query('UPDATE inbound_channels SET active = false, updated_at = now() WHERE id = $1', [cur.id]);
      const row = (await ctx.db.query(
        `INSERT INTO inbound_channels (tenant_id, channel, route_key, secret, created_by) VALUES (app_tenant_id(), $1,$2,$3,$4) RETURNING id, channel, route_key`,
        [body.channel, body.routeKey ?? cur?.route_key ?? null, secret ?? cur?.secret ?? null, ctx.user!.id])).rows[0];
      return { id: row.id, channel: row.channel, routeKey: row.route_key, ...(secret ? { secret } : {}) };
    }, ['admin']);
  });
  app.get('/api/inbound-messages/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => {
      const r = (await listProjectInbound(ctx, null, id))[0];
      if (!r) throw notFound('Gelen ileti');
      return r;
    });
  });
}
