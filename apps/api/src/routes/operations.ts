// Phase B staff routes — Adım 6 operations (guests / rooming, field extras & issues, daily summary) and Adım 7 finance.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CURRENCIES } from '@mice/shared';
import { asUser, idParam, list, parse, readMultipart, requireAuth } from './_helpers.js';
import { badRequest, conflict } from '../errors.js';
import { createRoomingLink, listGuests, staffAddGuests, withdrawConsent } from '../services/guests.js';
import {
  createFieldExtra, createFieldIssue, dailySummary, listFieldExtras, listFieldIssues, reflectFieldExtra, unreflectedTotals,
} from '../services/operations.js';
import {
  createPaymentRequest, importBankStatement, listBankTransactions, listCommissions, listEntries, manualMatch, markPaid, mikroExport,
  recordCustomerInvoice, recordSupplierInvoice, reconcileCommission,
} from '../services/finance.js';
import { generateDocument } from '../services/documents.js';
import { roomingListXlsx } from '../services/documents-b.js';
import { loadQuotes } from '../services/quotes.js';
import { getProjectRow } from '../services/projects.js';
import { mapDocument } from '../lib/mappers.js';

const auth = { preHandler: requireAuth };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const guestInput = z.object({
  fullName: z.string().min(1).max(200), email: z.string().max(200).nullish(), phone: z.string().max(50).nullish(), roomType: z.string().max(40).nullish(),
  arrival: isoDate.nullish(), departure: isoDate.nullish(), consentReuse: z.boolean().optional(),
});

export async function operationsRoutes(app: FastifyInstance): Promise<void> {
  // ---------------- guests / rooming list (KVKK)
  app.get('/api/projects/:id/guests', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await listGuests(ctx, id)));
  });
  app.post('/api/projects/:id/guests', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const raw = Array.isArray(req.body) ? req.body : (req.body as { guests?: unknown })?.guests;
    const guests = parse(z.array(guestInput).min(1).max(1000), raw);
    return asUser(req, async (ctx) => list(await staffAddGuests(ctx, id, guests)));
  });
  app.post('/api/projects/:id/rooming-link', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => createRoomingLink(ctx, id), ['admin', 'clerk_ops', 'clerk_sales']);
  });
  // (additive) standard rooming list Excel template, rendered live — PII decrypted only for roles with view_guest_pii (§17.9)
  app.get('/api/projects/:id/rooming-list.xlsx', auth, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const file = await asUser(req, (ctx) => roomingListXlsx(ctx, id));
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.fileName)}"`);
    reply.header('X-Row-Count', String(file.rows));
    reply.header('X-PII-Masked', file.masked ? '1' : '0');
    return reply.send(file.data);
  });
  // (additive) generate a project document from data: program, rooming_list (counts only), pnl (planned + realized)
  app.post('/api/projects/:id/documents', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const { kind } = parse(z.object({ kind: z.enum(['program', 'rooming_list', 'pnl']) }), req.body);
    return asUser(req, async (ctx) => {
      await getProjectRow(ctx, id);
      let entityId: string | null = null;
      if (kind === 'pnl') {
        const quotes = await loadQuotes(ctx, { projectId: id });
        const q = quotes.find((x) => x.status === 'accepted') ?? quotes.find((x) => x.status !== 'superseded');
        if (!q) throw conflict('Kâr-zarar tablosu için müşteri teklifi gerekli', 'NO_QUOTE');
        entityId = q.id;
      }
      return mapDocument(await generateDocument(ctx, kind, id, entityId));
    }, ['admin', 'clerk_sales', 'clerk_ops', 'finance']);
  });
  // (additive) staff-recorded consent withdrawal (guest asked by phone / e-mail)
  app.post('/api/guests/:id/withdraw-consent', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => withdrawConsent(ctx, id, 'staff'), ['admin', 'clerk_ops']);
  });

  // ---------------- field extras (§17.1 / §17.7)
  app.get('/api/projects/:id/field-extras', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await listFieldExtras(ctx, id)));
  });
  app.post('/api/projects/:id/field-extras', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ description: z.string().min(1).max(500), amountTry: z.number().positive().max(10_000_000), customerPhone: z.string().max(50).optional(), clientId: z.string().max(100).optional() }), req.body);
    return asUser(req, (ctx) => createFieldExtra(ctx, id, body));
  });
  app.post('/api/field-extras/:id/reflect', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ reflected: z.boolean(), reason: z.string().max(2000).optional() }), req.body);
    return asUser(req, (ctx) => reflectFieldExtra(ctx, id, body));
  });
  // (additive) admin screen: unreflected totals per project / customer
  app.get('/api/field-extras/unreflected-totals', auth, async (req) => asUser(req, (ctx) => unreflectedTotals(ctx), ['admin']));

  // ---------------- field issues
  app.get('/api/projects/:id/field-issues', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => list(await listFieldIssues(ctx, id)));
  });
  app.post('/api/projects/:id/field-issues', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ description: z.string().min(1).max(2000), severity: z.enum(['low', 'medium', 'high']), occurredAt: z.string().datetime({ offset: true }).optional(), supplierId: z.string().uuid().optional() }), req.body);
    return asUser(req, (ctx) => createFieldIssue(ctx, id, body));
  });

  app.get('/api/projects/:id/daily-summary', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => dailySummary(ctx, id));
  });

  // ---------------- finance (Adım 7)
  app.get('/api/finance/entries', auth, async (req) => {
    const q = parse(z.object({ projectId: z.string().uuid().optional(), kind: z.string().optional(), status: z.string().optional() }), req.query);
    return asUser(req, async (ctx) => list(await listEntries(ctx, q)));
  });
  const invoiceFields = z.object({
    projectId: z.string().uuid().optional(), supplierId: z.string().uuid().optional(), invoiceNo: z.string().min(1).max(60).optional(),
    amount: z.coerce.number().nonnegative().optional(), currency: z.enum(CURRENCIES).optional(), vatAmount: z.coerce.number().nonnegative().optional(),
    issueDate: isoDate.optional(), dueDate: isoDate.optional(), serviceItemIds: z.array(z.string().uuid()).optional(), text: z.string().max(200_000).optional(),
  });
  app.post('/api/finance/supplier-invoices', auth, async (req) => {
    const mp = await readMultipart(req);
    let raw: Record<string, unknown>;
    if (mp) {
      raw = Object.fromEntries(Object.entries(mp.fields).filter(([, v]) => v !== ''));
      if (typeof raw.serviceItemIds === 'string') raw.serviceItemIds = (raw.serviceItemIds as string).split(',').map((s) => s.trim()).filter(Boolean);
    } else raw = Object.fromEntries(Object.entries((req.body as Record<string, unknown>) ?? {}).filter(([, v]) => v !== '' && v !== null));
    const body = parse(invoiceFields, raw);
    return asUser(req, (ctx) => recordSupplierInvoice(ctx, { ...body, file: mp?.file }));
  });
  // (additive) the customer invoice number issued in Mikro
  app.post('/api/finance/customer-invoices', auth, async (req) => {
    const body = parse(z.object({ projectId: z.string().uuid(), invoiceNo: z.string().min(1).max(60), amount: z.number().nonnegative(), currency: z.enum(CURRENCIES), vatAmount: z.number().nonnegative().optional(), issueDate: isoDate.optional(), dueDate: isoDate.optional() }), req.body);
    return asUser(req, (ctx) => recordCustomerInvoice(ctx, body));
  });
  app.post('/api/finance/payment-requests', auth, async (req) => {
    const { entryId } = parse(z.object({ entryId: z.string().uuid() }), req.body);
    return asUser(req, (ctx) => createPaymentRequest(ctx, entryId));
  });
  // (additive) a human records the bank payment of an APPROVED request (the system never pays)
  app.post('/api/finance/entries/:id/mark-paid', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ paidAt: z.string().optional(), reference: z.string().max(200).optional() }), req.body);
    return asUser(req, (ctx) => markPaid(ctx, id, body));
  });
  app.post('/api/finance/bank-statements', auth, async (req) => {
    const mp = await readMultipart(req);
    let file = mp?.file;
    if (!file) {
      const b = req.body as { csv?: string } | undefined;
      if (typeof b?.csv === 'string') file = { filename: 'ekstre.csv', mimetype: 'text/csv', buffer: Buffer.from(b.csv, 'utf8') };
    }
    if (!file) throw badRequest('Ekstre dosyası gerekli (multipart alan adı: file)', undefined, 'NO_INPUT');
    const f = file;
    return asUser(req, (ctx) => importBankStatement(ctx, f));
  });
  app.get('/api/finance/bank-transactions', auth, async (req) => {
    const q = parse(z.object({ status: z.enum(['unmatched', 'suggested', 'matched', 'ignored']).optional() }), req.query);
    // the agency's whole bank movement list (counterparties, amounts) is finance data — not for sales / field roles
    return asUser(req, async (ctx) => list(await listBankTransactions(ctx, q.status)), ['admin', 'finance']);
  });
  app.post('/api/finance/bank-transactions/:id/match', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const { entryId } = parse(z.object({ entryId: z.string().uuid() }), req.body);
    return asUser(req, (ctx) => manualMatch(ctx, id, entryId));
  });
  app.post('/api/projects/:id/customer-invoice-draft', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => {
      await getProjectRow(ctx, id);
      return mapDocument(await generateDocument(ctx, 'customer_invoice_draft', id, null));
    }, ['admin', 'finance']);
  });
  app.get('/api/finance/export/mikro', auth, async (req, reply) => {
    const q = parse(z.object({ from: isoDate.optional(), to: isoDate.optional() }), req.query);
    const file = await asUser(req, (ctx) => mikroExport(ctx, q.from, q.to));
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${file.fileName}"`);
    reply.header('X-Row-Count', String(file.rows));
    return reply.send(file.data);
  });
  app.get('/api/finance/commissions', auth, async (req) => {
    const q = parse(z.object({ projectId: z.string().uuid().optional() }), req.query);
    return asUser(req, async (ctx) => list(await listCommissions(ctx, q.projectId)), ['admin', 'finance']);
  });
  // (additive) commission reconciliation
  app.post('/api/finance/commissions/:id/reconcile', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ invoiceNo: z.string().max(60).optional(), amount: z.number().nonnegative().optional() }), req.body);
    return asUser(req, (ctx) => reconcileCommission(ctx, id, body));
  });
}
