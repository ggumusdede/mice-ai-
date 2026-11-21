// Public token routes (no login). The tenant is resolved from the token HASH by a SECURITY DEFINER function;
// everything afterwards runs under RLS in that tenant, scoped to the single entity the token names.
// Rate-limited (registered inside an encapsulated plugin with @fastify/rate-limit).
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { CURRENCIES, SERVICE_KINDS, type ActorType } from '@mice/shared';
import { withoutTenant } from '../db/pool.js';
import { withSystemCtx, type Ctx } from '../context.js';
import { sha256Hex } from '../lib/crypto.js';
import { notFound, badRequest } from '../errors.js';
import { parse, readMultipart, tokenParam } from './_helpers.js';
import { getRfqRow, publicRfqView, publicSubmitOffer } from '../services/rfqs.js';
import { parseOffer } from '../services/offers.js';
import { publicAccept, publicQuoteView, publicRevision } from '../services/quotes.js';

/** Token → tenant + entity (by hash, SECURITY DEFINER). Throws 404 for an unknown / revoked token. */
export async function resolvePublicToken(kind: string, token: string): Promise<{ tenant_id: string; entity_id: string }> {
  const hash = sha256Hex(token);
  const hit = await withoutTenant((db) => db.query('SELECT tenant_id, entity_id FROM resolve_public_token($1, $2)', [kind, hash]).then((r) => r.rows[0]));
  if (!hit) throw notFound('Bağlantı');
  return hit;
}

export async function withPublicToken<T>(app: FastifyInstance, kind: string, token: string, actorType: ActorType, fn: (ctx: Ctx, entityId: string) => Promise<T>,
  resolved?: { tenant_id: string; entity_id: string }): Promise<T> {
  const hit = resolved ?? (await resolvePublicToken(kind, token));
  return withSystemCtx(app.deps, hit.tenant_id, { type: actorType, id: hit.entity_id }, (ctx) => fn(ctx, hit.entity_id));
}

const offerLine = z.object({
  description: z.string().min(1), kind: z.enum(SERVICE_KINDS), quantity: z.number().nonnegative(), unit: z.string().min(1),
  nights: z.number().int().nonnegative().optional(), unitPrice: z.number().nonnegative(), vatIncluded: z.boolean(), vatRate: z.number().min(0).max(100),
  accommodationTaxIncluded: z.boolean().optional(), roomType: z.string().optional(), board: z.string().optional(),
});

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, { max: app.deps.config.publicRateLimitPerMinute, timeWindow: '1 minute' });

  // ---------------- supplier portal (§10)
  app.get('/api/public/rfq/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    return withPublicToken(app, 'rfq', token, 'supplier', (ctx, id) => publicRfqView(ctx, id));
  });
  app.post('/api/public/rfq/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const body = parse(z.object({
      currency: z.enum(CURRENCIES), lines: z.array(offerLine).min(1).max(100), optionUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      guaranteePax: z.number().int().nonnegative().optional(), paymentTerms: z.string().max(2000).optional(), prepaymentRate: z.number().min(0).max(1).optional(),
      cancellationTerms: z.string().max(2000).optional(), attritionTerms: z.string().max(2000).optional(), notes: z.string().max(4000).optional(),
    }), req.body);
    return withPublicToken(app, 'rfq', token, 'supplier', (ctx, id) => publicSubmitOffer(ctx, id, body));
  });
  app.post('/api/public/rfq/:token/files', async (req) => {
    const { token } = parse(tokenParam, req.params);
    // validate the link BEFORE accepting up to 20 MB, and read the upload outside the DB transaction (pool connections)
    const hit = await resolvePublicToken('rfq', token);
    const mp = await readMultipart(req);
    if (!mp?.file) throw badRequest('Dosya gerekli (multipart alan adı: file)', undefined, 'NO_INPUT');
    const file = mp.file;
    return withPublicToken(app, 'rfq', token, 'supplier', async (ctx, id) => {
      const rfq = await getRfqRow(ctx, id);
      await publicRfqView(ctx, id); // validates link state (closed / expired)
      if (rfq.deadline_at && new Date(rfq.deadline_at) < ctx.now()) throw badRequest('Yanıt süresi doldu', undefined, 'RFQ_READ_ONLY');
      const offer = await parseOffer(ctx, rfq.service_item_id, { file, supplierId: rfq.supplier_id, rfqId: rfq.id, viaPublicLink: true });
      return { ok: true as const, fileName: file.filename, version: offer.version };
    }, hit);
  });

  // ---------------- customer quote approval (§7 Adım 4)
  app.get('/api/public/quotes/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    return withPublicToken(app, 'quote', token, 'customer', (ctx, id) => publicQuoteView(ctx, id));
  });
  app.post('/api/public/quotes/:token/accept', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const body = parse(z.object({ optionNo: z.number().int().min(1), approverName: z.string().min(1).max(200), poNumber: z.string().max(100).optional() }), req.body);
    return withPublicToken(app, 'quote', token, 'customer', (ctx, id) => publicAccept(ctx, id, body));
  });
  app.post('/api/public/quotes/:token/revision', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const { message } = parse(z.object({ message: z.string().min(1).max(5000) }), req.body);
    return withPublicToken(app, 'quote', token, 'customer', (ctx, id) => publicRevision(ctx, id, message));
  });
}
