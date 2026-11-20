// Phase B public token routes (no login, rate-limited): rooming form (/r/<token>), consent withdrawal, field-extra customer
// approval (/e/<token>), closing survey (/survey/<token>). The tenant is resolved from the token HASH; everything else runs
// under RLS scoped to the one entity the token names.
import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { parse, tokenParam } from './_helpers.js';
import { withPublicToken } from './public.js';
import { sha256Hex } from '../lib/crypto.js';
import { publicRoomingSubmit, publicRoomingView, withdrawConsent } from '../services/guests.js';
import { publicApproveExtra, publicExtraView } from '../services/operations.js';
import { publicSurveySubmit, publicSurveyView } from '../services/closing.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function publicPhaseBRoutes(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, { max: app.deps.config.publicRateLimitPerMinute, timeWindow: '1 minute' });

  app.get('/api/public/rooming/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    return withPublicToken(app, 'rooming', token, 'customer', (ctx, id) => publicRoomingView(ctx, id, sha256Hex(token)));
  });
  app.post('/api/public/rooming/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const body = parse(z.object({
      guests: z.array(z.object({
        fullName: z.string().trim().min(1).max(200), email: z.string().email().max(200).optional().or(z.literal('')), phone: z.string().max(50).optional(),
        roomType: z.string().max(40).optional(), arrival: isoDate.optional().or(z.literal('')), departure: isoDate.optional().or(z.literal('')),
        consentReuse: z.boolean(),
      })).min(1).max(1000),
    }), req.body);
    return withPublicToken(app, 'rooming', token, 'customer', (ctx, id) => publicRoomingSubmit(ctx, id, sha256Hex(token), body));
  });
  // The withdrawal link travels in the guest's e-mail: GET shows a one-button confirmation page (no side effect),
  // POST (JSON from the web app, or the page's form) withdraws.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, _body, done) => done(null, {}));
  app.get('/api/public/consent/:token/withdraw', async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    await withPublicToken(app, 'consent', token, 'customer', async () => true);
    reply.type('text/html; charset=utf-8');
    return page('Kişisel veri izni', `<p>Bilgilerinizin sonraki etkinliklerde kullanılmasına verdiğiniz izni geri almak için onaylayın.</p>
      <form method="post"><button type="submit">İznimi geri al</button></form>`);
  });
  app.post('/api/public/consent/:token/withdraw', async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    const r = await withPublicToken(app, 'consent', token, 'customer', (ctx, guestId) => withdrawConsent(ctx, guestId, 'public_link'));
    if (String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
      reply.type('text/html; charset=utf-8');
      return page('Kişisel veri izni', '<p>İzniniz geri alındı. Verileriniz yasal saklama süresi sonunda anonimleştirilecek.</p>');
    }
    return { ok: r.ok };
  });

  app.get('/api/public/extras/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    return withPublicToken(app, 'extra', token, 'customer', (ctx, id) => publicExtraView(ctx, id));
  });
  app.post('/api/public/extras/:token/approve', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const { approverName } = parse(z.object({ approverName: z.string().trim().min(2).max(200) }), req.body);
    return withPublicToken(app, 'extra', token, 'customer', (ctx, id) => publicApproveExtra(ctx, id, approverName));
  });

  app.get('/api/public/survey/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    return withPublicToken(app, 'survey', token, 'customer', (ctx, id) => publicSurveyView(ctx, id));
  });
  app.post('/api/public/survey/:token', async (req) => {
    const { token } = parse(tokenParam, req.params);
    const body = parse(z.object({ answers: z.record(z.union([z.number(), z.string().max(4000)])) }), req.body);
    return withPublicToken(app, 'survey', token, 'customer', (ctx, id) => publicSurveySubmit(ctx, id, body));
  });
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1d1d1f}button{font-size:1rem;padding:.6rem 1.2rem;border-radius:.6rem;border:0;background:#0a66c2;color:#fff}</style>
</head><body><h1>${title}</h1>${body}</body></html>`;
}
