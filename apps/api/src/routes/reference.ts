// Read-mostly reference data needed by phase A screens (every staff role may read).
// Mutating admin routes (rules PATCH, users PATCH, delegations, checklist PATCH) are phase B.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asUser, idParam, list, parse, requireAuth } from './_helpers.js';
import { mapAudit, mapChecklist, mapCounter, mapCustomer, mapUser } from '../lib/mappers.js';
import { loadRules } from '../services/rules.js';
import { notFound } from '../errors.js';

const auth = { preHandler: requireAuth };

const customerBody = z.object({
  name: z.string().min(1), shortCode: z.string().min(1).max(20), taxOffice: z.string().nullish(), taxNumber: z.string().nullish(),
  billingAddress: z.string().nullish(), contacts: z.array(z.object({ name: z.string(), email: z.string().optional(), phone: z.string().optional(), title: z.string().optional() })).optional(),
  rules: z.object({
    firmApproval: z.enum(['online', 'signed_or_po']).optional(), depositRate: z.number().min(0).max(1).optional(),
    omitPaymentCancellationClauses: z.boolean().optional(), specialClauses: z.array(z.string()).optional(),
    preferredLanguage: z.enum(['tr', 'en', 'ru']).optional(), preferredCurrency: z.enum(['EUR', 'TRY', 'USD', 'GBP']).optional(),
  }).optional(),
});

export async function referenceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/rules', auth, async (req) => asUser(req, (ctx) => loadRules(ctx.db)));
  app.get('/api/users', auth, async (req) => asUser(req, async (ctx) => list((await ctx.db.query('SELECT * FROM users ORDER BY full_name')).rows.map(mapUser))));
  app.get('/api/checklist', auth, async (req) => asUser(req, async (ctx) => list((await ctx.db.query('SELECT * FROM checklist_questions ORDER BY status, created_at')).rows.map(mapChecklist))));
  app.get('/api/automation', auth, async (req) => asUser(req, async (ctx) => list((await ctx.db.query('SELECT * FROM automation_counters ORDER BY action_type')).rows.map(mapCounter))));
  app.get('/api/audit', auth, async (req) => {
    const q = parse(z.object({ entity: z.string().optional(), entityId: z.string().optional() }), req.query);
    return asUser(req, async (ctx) => list((await ctx.db.query(
      `SELECT * FROM audit_log WHERE ($1::text IS NULL OR entity = $1) AND ($2::text IS NULL OR entity_id = $2) ORDER BY at DESC, id DESC LIMIT 500`,
      [q.entity ?? null, q.entityId ?? null])).rows.map(mapAudit)), ['admin']);
  });

  app.get('/api/customers', auth, async (req) => asUser(req, async (ctx) => list((await ctx.db.query('SELECT * FROM customers ORDER BY name')).rows.map(mapCustomer))));
  app.post('/api/customers', auth, async (req) => {
    const b = parse(customerBody, req.body);
    return asUser(req, async (ctx) => {
      const rules = { firmApproval: 'signed_or_po', depositRate: 0, omitPaymentCancellationClauses: false, specialClauses: [], preferredLanguage: 'tr', preferredCurrency: 'EUR', ...(b.rules ?? {}) };
      // §17.2: relaxing firm approval (online) is a customer rule → admin only
      if (rules.firmApproval === 'online' && ctx.user!.role !== 'admin') rules.firmApproval = 'signed_or_po';
      const { rows } = await ctx.db.query(
        `INSERT INTO customers (tenant_id, name, short_code, tax_office, tax_number, billing_address, contacts, rules)
         VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [b.name, b.shortCode, b.taxOffice ?? null, b.taxNumber ?? null, b.billingAddress ?? null, JSON.stringify(b.contacts ?? []), JSON.stringify(rules)]);
      return mapCustomer(rows[0]);
    });
  });
  app.patch('/api/customers/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const b = parse(customerBody.partial(), req.body);
    return asUser(req, async (ctx) => {
      const cur = (await ctx.db.query('SELECT * FROM customers WHERE id = $1', [id])).rows[0];
      if (!cur) throw notFound('Müşteri');
      if (b.rules && ctx.user!.role !== 'admin') throw (await import('../errors.js')).forbidden('Müşteri kurallarını yalnızca yönetici değiştirir');
      const { rows } = await ctx.db.query(
        `UPDATE customers SET name = COALESCE($2, name), short_code = COALESCE($3, short_code), tax_office = COALESCE($4, tax_office),
           tax_number = COALESCE($5, tax_number), billing_address = COALESCE($6, billing_address), contacts = COALESCE($7, contacts),
           rules = rules || COALESCE($8, '{}'::jsonb) WHERE id = $1 RETURNING *`,
        [id, b.name ?? null, b.shortCode ?? null, b.taxOffice ?? null, b.taxNumber ?? null, b.billingAddress ?? null,
          b.contacts ? JSON.stringify(b.contacts) : null, b.rules ? JSON.stringify(b.rules) : null]);
      return mapCustomer(rows[0]);
    });
  });
}
