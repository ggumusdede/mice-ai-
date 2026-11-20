// Phase A staff routes: decisions, intake, projects, items, suppliers, RFQs, offers, quotes, contracts, drafts, tasks, documents.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DecisionInput } from '@mice/shared';
import { INBOUND_CHANNELS, SERVICE_KINDS, LANGUAGES, CURRENCIES, OFFER_SOURCES } from '@mice/shared';
import { ALLOWED_NEGOTIATION_ARGUMENTS } from '@mice/domain';
import { asUser, idParam, list, parse, readMultipart, requireAuth, sendPdf } from './_helpers.js';
import { decide, getDecision, listDecisions } from '../services/decisions.js';
import { runIntake } from '../services/intake.js';
import {
  askProject, assignProject, getProjectRow, listProjects, patchProject, projectDetail, projectTimeline, setOutcome, similarProjects,
} from '../services/projects.js';
import { createItem, patchItem, selectOffer, shortlistForItem } from '../services/items.js';
import { createSupplier, getSupplierRow, listSuppliers, patchSupplier } from '../services/suppliers.js';
import { cancelRfq, createRfqs, rotateRfqLink } from '../services/rfqs.js';
import { addChannelPrice, ensureNegotiationCallTask, comparison, manualOffer, negotiate, parseOffer, verifyOffer } from '../services/offers.js';
import { buildQuote, getQuote, recordFirmApproval, sendQuote } from '../services/quotes.js';
import { amendContract, compareContract, createContract, getContractRow, listContracts, onSupplierConfirmationSent, parseContract, signContract } from '../services/contracts.js';
import { editDraft, getDraftRow, listDrafts, sendDraft } from '../services/drafts.js';
import { getDocumentFile, latestDocumentFor, listDocuments, regenerateDocument } from '../services/documents.js';
import { mapContract, mapSupplier, mapTask } from '../lib/mappers.js';
import { AppError, badRequest, notFound } from '../errors.js';
import { createDecision } from '../services/decisions.js';

const auth = { preHandler: requireAuth };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

const decisionInput = z.object({
  action: z.enum(['approve', 'edit', 'reject']),
  edits: z.record(z.unknown()).optional(),
  reason: z.string().max(2000).optional(),
  device: z.string().max(200).optional(),
  biometric: z.union([z.object({ method: z.literal('webauthn'), assertion: z.unknown() }), z.object({ method: z.literal('dev') })]).optional(),
});

const offerLine = z.object({
  description: z.string(), kind: z.enum(SERVICE_KINDS), quantity: z.number().nonnegative(), unit: z.string(), nights: z.number().int().nonnegative().optional(),
  unitPrice: z.number().nonnegative(), vatIncluded: z.boolean(), vatRate: z.number().min(0).max(100), accommodationTaxIncluded: z.boolean().optional(),
  roomType: z.string().optional(), board: z.string().optional(),
});
const offerTerms = {
  currency: z.enum(CURRENCIES), lines: z.array(offerLine), optionUntil: isoDate.nullish(), guaranteePax: z.number().int().nullish(),
  attritionTerms: z.string().nullish(), paymentTerms: z.string().nullish(), prepaymentRate: z.number().min(0).max(1).nullish(),
  cancellationTerms: z.string().nullish(), overtimeTerms: z.string().nullish(), notes: z.string().nullish(),
};
const manualOfferBody = z.object({ supplierId: z.string().uuid(), rfqId: z.string().uuid().nullish(), source: z.enum(OFFER_SOURCES).default('manual'), ...offerTerms });

const itemInput = z.object({
  kind: z.enum(SERVICE_KINDS), description: z.string().min(1), dateFrom: isoDate.optional(), dateTo: isoDate.optional(), quantity: z.number().nonnegative(),
  unit: z.string().min(1), nights: z.number().int().nonnegative().optional(), specs: z.record(z.unknown()).optional(), valueAdd: z.boolean().optional(),
});

export async function coreRoutes(app: FastifyInstance): Promise<void> {
  // ---------------- decisions (§15)
  app.get('/api/decisions', auth, async (req) => {
    const q = parse(z.object({ status: z.string().optional(), projectId: z.string().uuid().optional() }), req.query);
    return asUser(req, async (ctx) => list(await listDecisions(ctx, q)));
  });
  app.get('/api/decisions/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => getDecision(ctx, id));
  });
  app.post('/api/decisions/:id/decide', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(decisionInput, req.body);
    return asUser(req, (ctx) => decide(ctx, id, body as DecisionInput));
  });

  // ---------------- intake (Adım 0)
  app.post('/api/intake', auth, async (req) => {
    const body = parse(z.object({
      channel: z.enum(INBOUND_CHANNELS), body: z.string().min(1).max(100_000), fromAddress: z.string().optional(), subject: z.string().optional(),
      customerId: z.string().uuid().optional(), receivedAt: z.string().datetime({ offset: true }).optional(),
    }), req.body);
    return asUser(req, (ctx) => runIntake(ctx, body));
  });

  // ---------------- projects
  app.get('/api/projects', auth, async (req) => {
    const q = parse(z.object({ q: z.string().optional(), outcome: z.string().optional(), step: z.coerce.number().int().min(0).max(8).optional() }), req.query);
    return asUser(req, async (ctx) => list(await listProjects(ctx, q)));
  });
  app.get('/api/projects/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => projectDetail(ctx, id));
  });
  app.patch('/api/projects/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.record(z.unknown()), req.body);
    return asUser(req, (ctx) => patchProject(ctx, id, body));
  });
  app.post('/api/projects/:id/assign', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const { userId } = parse(z.object({ userId: z.string().uuid() }), req.body);
    return asUser(req, (ctx) => assignProject(ctx, id, userId), ['admin']);
  });
  app.post('/api/projects/:id/outcome', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ outcome: z.enum(['won', 'lost']), lostReason: z.string().optional() }), req.body);
    return asUser(req, (ctx) => setOutcome(ctx, id, body.outcome, body.lostReason));
  });
  app.post('/api/projects/:id/ask', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const { question } = parse(z.object({ question: z.string().min(1).max(2000) }), req.body);
    return asUser(req, (ctx) => askProject(ctx, id, question));
  });
  app.post('/api/assist/ask', auth, async (req) => {
    const body = parse(z.object({ question: z.string().min(1).max(2000), context: z.object({ projectId: z.string().uuid().optional() }).optional() }), req.body);
    return asUser(req, (ctx) => askProject(ctx, body.context?.projectId ?? null, body.question));
  });
  app.post('/api/assist/voice-command', auth, async (req) => {
    const { transcript } = parse(z.object({ transcript: z.string().min(1).max(5000) }), req.body);
    return asUser(req, async (ctx) => {
      const r = await ctx.deps.ai.interpretCommand(transcript, new Date(ctx.now()).toISOString().slice(0, 10));
      if (r.data.intent === 'create_project') return { intent: 'create_project' as const, intake: await runIntake(ctx, { channel: 'voice', body: r.data.requestText ?? transcript }) };
      if (r.data.intent === 'ask') return { intent: 'ask' as const, answer: (await askProject(ctx, null, r.data.question ?? transcript)).answer };
      return { intent: 'unknown' as const };
    });
  });
  app.get('/api/projects/:id/timeline', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await projectTimeline(ctx, id)));
  });
  app.get('/api/projects/:id/similar', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await similarProjects(ctx, id)));
  });

  // ---------------- service items (§5)
  app.post('/api/projects/:id/items', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(itemInput, req.body);
    return asUser(req, (ctx) => createItem(ctx, id, body));
  });
  app.patch('/api/items/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(itemInput.partial().extend({ status: z.enum(['open', 'cancelled']).optional() }), req.body);
    return asUser(req, (ctx) => patchItem(ctx, id, body));
  });
  app.post('/api/items/:id/select-offer', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const { offerId } = parse(z.object({ offerId: z.string().uuid() }), req.body);
    return asUser(req, (ctx) => selectOffer(ctx, id, offerId));
  });
  app.get('/api/items/:id/shortlist', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await shortlistForItem(ctx, id)));
  });

  // ---------------- suppliers
  app.get('/api/suppliers', auth, async (req) => {
    const q = parse(z.object({ kind: z.string().optional(), city: z.string().optional(), status: z.string().optional(), q: z.string().optional() }), req.query);
    return asUser(req, async (ctx) => list(await listSuppliers(ctx, q)));
  });
  app.get('/api/suppliers/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => mapSupplier(await getSupplierRow(ctx, id)));
  });
  const supplierBody = z.object({
    name: z.string().min(1).optional(), kinds: z.array(z.enum(SERVICE_KINDS)).optional(), city: z.string().optional(), district: z.string().nullish(),
    lat: z.number().nullish(), lng: z.number().nullish(), capacityPax: z.number().int().nullish(), roomCount: z.number().int().nullish(),
    halls: z.array(z.record(z.unknown())).optional(), segment: z.string().nullish(), email: z.string().nullish(), phone: z.string().nullish(),
    contactName: z.string().nullish(), commission: z.record(z.unknown()).nullish(), paymentTerms: z.string().nullish(),
    status: z.enum(['candidate', 'accredited', 'passive']).optional(), reason: z.string().optional(),
  });
  app.post('/api/suppliers', auth, async (req) => {
    const body = parse(supplierBody, req.body);
    return asUser(req, (ctx) => createSupplier(ctx, body as never));
  });
  app.patch('/api/suppliers/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(supplierBody, req.body);
    return asUser(req, (ctx) => patchSupplier(ctx, id, body as never));
  });

  // ---------------- RFQ (Adım 1)
  app.post('/api/items/:id/rfqs', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({
      supplierIds: z.array(z.string().uuid()).min(1).max(20), deadlineHours: z.number().int().min(1).max(24 * 30).optional(),
      overrideReason: z.string().max(1000).optional(), language: z.enum(LANGUAGES).optional(),
    }), req.body);
    return asUser(req, async (ctx) => list(await createRfqs(ctx, id, body)));
  });
  app.post('/api/rfqs/:id/cancel', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(z.object({ reason: z.string().min(1) }), req.body);
    return asUser(req, (ctx) => cancelRfq(ctx, id, reason));
  });
  // (additive) one-time supplier link for manual sharing (rotates the token; only the hash is stored)
  app.post('/api/rfqs/:id/link', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => rotateRfqLink(ctx, id));
  });

  // ---------------- offers & comparison (Adım 2)
  app.post('/api/items/:id/offers', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(manualOfferBody, req.body);
    return asUser(req, (ctx) => manualOffer(ctx, id, body as never));
  });
  app.post('/api/items/:id/offers/parse', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const mp = await readMultipart(req);
    const raw = mp ? mp.fields : (req.body as Record<string, unknown>);
    const body = parse(z.object({ text: z.string().max(200_000).optional(), supplierId: z.string().uuid().optional(), rfqId: z.string().uuid().optional() }), raw);
    if (!mp?.file && !body.text) throw badRequest('Dosya (multipart) veya metin gerekli', undefined, 'NO_INPUT');
    return asUser(req, (ctx) => parseOffer(ctx, id, { ...body, file: mp?.file }));
  });
  app.post('/api/offers/:id/verify', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object(offerTerms).partial(), req.body);
    return asUser(req, (ctx) => verifyOffer(ctx, id, body as never));
  });
  app.get('/api/items/:id/comparison', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => comparison(ctx, id));
  });
  app.post('/api/offers/:id/negotiate', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ arguments: z.array(z.enum(ALLOWED_NEGOTIATION_ARGUMENTS)).min(1) }), req.body);
    try {
      return await asUser(req, (ctx) => negotiate(ctx, id, body.arguments));
    } catch (e) {
      if (e instanceof AppError && e.code === 'NEGOTIATION_LIMIT') await asUser(req, (ctx) => ensureNegotiationCallTask(ctx, id));
      throw e;
    }
  });
  app.post('/api/channel-prices', auth, async (req) => {
    const body = parse(z.object({
      supplierId: z.string().uuid(), date: isoDate, roomType: z.string().min(1), board: z.string().min(1),
      cancellation: z.enum(['flexible', 'non_refundable']), price: z.number().positive(), currency: z.string().min(3).max(3), source: z.string().min(1),
    }), req.body);
    return asUser(req, (ctx) => addChannelPrice(ctx, body));
  });

  // ---------------- quotes (Adım 3/4)
  app.post('/api/projects/:id/quotes', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({
      currency: z.string().optional(), optionUntil: isoDate.optional(), marginOverrideReason: z.string().optional(),
      options: z.array(z.object({
        title: z.string().min(1),
        lines: z.array(z.object({ serviceItemId: z.string().uuid(), offerId: z.string().uuid().nullish(), markup: z.number().min(-0.5).max(5).optional(), unitPriceEur: z.number().nonnegative().optional() })).min(1),
      })).min(1).max(5),
    }), req.body);
    return asUser(req, (ctx) => buildQuote(ctx, id, body as never));
  });
  app.get('/api/projects/:id/quotes', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list((await projectDetail(ctx, id)).quotes));
  });
  app.get('/api/quotes/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => getQuote(ctx, id));
  });
  app.post('/api/quotes/:id/send', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => sendQuote(ctx, id));
  });
  app.post('/api/quotes/:id/firm-approval', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ poNumber: z.string().optional(), signedFormFileName: z.string().optional() }), req.body);
    return asUser(req, (ctx) => recordFirmApproval(ctx, id, body));
  });
  app.get('/api/quotes/:id/pdf', auth, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const file = await asUser(req, async (ctx) => {
      const doc = await latestDocumentFor(ctx, 'quote', 'quote', id);
      if (!doc) throw notFound('Teklif belgesi');
      return getDocumentFile(ctx, doc.id);
    });
    return sendPdf(reply, file);
  });

  // ---------------- contracts (Adım 5)
  app.post('/api/projects/:id/contracts', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ supplierId: z.string().uuid(), serviceItemIds: z.array(z.string().uuid()).min(1), template: z.enum(['agency', 'supplier']).default('agency') }), req.body);
    return asUser(req, (ctx) => createContract(ctx, id, body));
  });
  app.get('/api/projects/:id/contracts', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await listContracts(ctx, id)));
  });
  app.get('/api/contracts/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => mapContract(await getContractRow(ctx, id)));
  });
  app.post('/api/contracts/:id/parse', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const mp = await readMultipart(req);
    const text = mp ? mp.fields.text : (req.body as { text?: string } | undefined)?.text;
    if (!mp?.file && !text) throw badRequest('Dosya (multipart) veya metin gerekli', undefined, 'NO_INPUT');
    return asUser(req, (ctx) => parseContract(ctx, id, { text, file: mp?.file }));
  });
  app.post('/api/contracts/:id/compare', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => compareContract(ctx, id));
  });
  app.post('/api/contracts/:id/sign', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ signedBy: z.string().uuid(), scanFileName: z.string().optional() }), req.body);
    return asUser(req, (ctx) => signContract(ctx, id, body));
  });
  app.post('/api/contracts/:id/amend', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ changes: z.record(z.unknown()), reason: z.string().min(1) }), req.body);
    return asUser(req, (ctx) => amendContract(ctx, id, body as never));
  });

  // ---------------- drafts (§3.3)
  app.get('/api/drafts', auth, async (req) => {
    const q = parse(z.object({ projectId: z.string().uuid().optional() }), req.query);
    return asUser(req, async (ctx) => list(await listDrafts(ctx, q.projectId)));
  });
  app.patch('/api/drafts/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ body: z.string().min(1).optional(), subject: z.string().nullish(), to: z.string().nullish() }), req.body);
    return asUser(req, (ctx) => editDraft(ctx, id, body));
  });
  app.post('/api/drafts/:id/send', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => {
      const d = await getDraftRow(ctx, id);
      const sent = await sendDraft(ctx, id);
      if (d.kind === 'supplier_confirmation' && d.entity_type === 'contract') await onSupplierConfirmationSent(ctx, d.entity_id);
      return sent;
    });
  });
  // (additive) ask for approval of an outbound draft that requires it (e.g. a hand-written supplier message)
  app.post('/api/drafts/:id/request-approval', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => {
      const d = await getDraftRow(ctx, id);
      await ctx.db.query(`UPDATE message_drafts SET status = 'pending_approval', requires_approval = true WHERE id = $1 AND status = 'draft'`, [id]);
      return createDecision(ctx, {
        projectId: d.project_id, kind: 'outbound_message', badge: 'suggestion', summary: `Mesaj onayı: ${d.subject ?? d.kind}`,
        detail: { draftId: id, to: d.to_address }, draft: { subject: d.subject, body: d.body }, requiredRole: 'admin',
        entityType: 'message_draft', entityId: id,
      });
    });
  });

  // ---------------- documents (§3.5)
  app.get('/api/projects/:id/documents', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const q = parse(z.object({ history: z.coerce.boolean().optional() }), req.query);
    return asUser(req, async (ctx) => {
      await getProjectRow(ctx, id);
      return list(await listDocuments(ctx, id, q.history));
    });
  });
  app.post('/api/documents/:id/regenerate', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => regenerateDocument(ctx, id));
  });
  app.get('/api/documents/:id/file', auth, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const file = await asUser(req, (ctx) => getDocumentFile(ctx, id));
    return sendPdf(reply, file);
  });

  // ---------------- tasks
  app.get('/api/tasks', auth, async (req) => {
    const q = parse(z.object({ mine: z.string().optional(), status: z.enum(['open', 'done', 'cancelled']).optional(), projectId: z.string().uuid().optional() }), req.query);
    return asUser(req, async (ctx) => {
      const { rows } = await ctx.db.query(
        `SELECT * FROM tasks WHERE ($1::uuid IS NULL OR assignee_id = $1) AND ($2::text IS NULL OR status = $2) AND ($3::uuid IS NULL OR project_id = $3)
         ORDER BY due_at NULLS LAST, created_at LIMIT 500`,
        [q.mine === '1' || q.mine === 'true' ? ctx.user!.id : null, q.status ?? null, q.projectId ?? null]);
      return list(rows.map(mapTask));
    });
  });
  app.post('/api/tasks/:id/complete', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => {
      const { rows } = await ctx.db.query(
        `UPDATE tasks SET status = 'done', completed_by = $2, completed_at = $3 WHERE id = $1 AND status = 'open' RETURNING *`, [id, ctx.user!.id, ctx.now()]);
      if (!rows[0]) throw notFound('Açık görev');
      return mapTask(rows[0]);
    });
  });
}
