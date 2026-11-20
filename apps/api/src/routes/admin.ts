// Phase B staff routes — Adım 8 closing, §16.6 weekly report, admin (rules / users / delegations / checklist). §17.1:
// rule, threshold and authority changes stay with the Admin (never a delegate, never AI).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUTHORITY_LEVELS, DEFAULT_RULES, ROLES, type TenantRules } from '@mice/shared';
import { asUser, idParam, list, parse, requireAuth } from './_helpers.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { mapChecklist, mapDelegation, mapUser } from '../lib/mappers.js';
import { loadRules, setRule } from '../services/rules.js';
import { closeProject, computeClosingCheck } from '../services/closing.js';
import { userStats, weeklyReport } from '../services/reports.js';
import { expireDecisionsFor } from '../services/decisions.js';
import type { Ctx } from '../context.js';

const auth = { preHandler: requireAuth };

/** Admin only, human only (§6 rule_change is forbidden for AI; delegates cannot change rules / authority). */
function assertAdminHuman(ctx: Ctx): void {
  if (ctx.actor.type !== 'user' || ctx.user?.role !== 'admin') throw forbidden('Kural / eşik / yetki değişikliğini yalnızca yönetici yapar (vekil ve yapay zekâ yapamaz)', 'ADMIN_ONLY');
}

/** Light shape check against the default value's JSON type. */
function sameShape(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return Array.isArray(b);
  if (a === null) return true;
  if (typeof a === 'object') return typeof b === 'object' && b !== null && !Array.isArray(b);
  return typeof a === typeof b;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ---------------- closing (Adım 8)
  app.get('/api/projects/:id/closing-check', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, (ctx) => computeClosingCheck(ctx, id));
  });
  app.post('/api/projects/:id/close', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ lessonsLearned: z.string().max(10_000).optional() }), req.body);
    return asUser(req, (ctx) => closeProject(ctx, id, body));
  });

  // ---------------- reports (§16.6)
  app.get('/api/reports/weekly', auth, async (req) => {
    const q = parse(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
    return asUser(req, (ctx) => weeklyReport(ctx, q.weekStart), ['admin']);
  });

  // ---------------- rules (Blok 5: table, not code — admin changes)
  app.patch('/api/rules', auth, async (req) => {
    const body = parse(z.record(z.unknown()), req.body);
    return asUser(req, async (ctx) => {
      assertAdminHuman(ctx);
      const reason = typeof body.reason === 'string' ? body.reason : null;
      const patch = Object.entries(body).filter(([k]) => k !== 'reason');
      if (!patch.length) throw badRequest('Değişecek kural yok');
      for (const [k, v] of patch) {
        if (!(k in DEFAULT_RULES)) throw badRequest(`Bilinmeyen kural: ${k}`, undefined, 'UNKNOWN_RULE');
        if (!sameShape(DEFAULT_RULES[k as keyof TenantRules], v)) throw badRequest(`Geçersiz değer: ${k}`, undefined, 'INVALID_RULE_VALUE');
        if (typeof v === 'number' && (!Number.isFinite(v) || v < 0)) throw badRequest(`Geçersiz değer: ${k}`, undefined, 'INVALID_RULE_VALUE');
      }
      for (const [k, v] of patch) await setRule(ctx.db, k as keyof TenantRules, v, ctx.user!.id, reason);
      return loadRules(ctx.db);
    });
  });

  // ---------------- users (§4 kişi bazlı yetki: only Admin changes the level)
  app.patch('/api/users/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({
      authorityLevel: z.enum(AUTHORITY_LEVELS).optional(),
      authorityScope: z.object({ customerIds: z.array(z.string().uuid()).optional(), eventTypes: z.array(z.string()).optional() }).optional(),
      role: z.enum(ROLES).optional(), canSign: z.boolean().optional(), active: z.boolean().optional(), fullName: z.string().min(1).max(200).optional(),
      languages: z.array(z.enum(['tr', 'en', 'ru'])).optional(),
    }), req.body);
    return asUser(req, async (ctx) => {
      assertAdminHuman(ctx);
      const cur = (await ctx.db.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
      if (!cur) throw notFound('Kullanıcı');
      if (id === ctx.user!.id && ((body.role && body.role !== 'admin') || body.active === false)) throw conflict('Yönetici kendi rolünü düşüremez / kendini pasife alamaz', 'SELF_DEMOTION');
      const { rows } = await ctx.db.query(
        `UPDATE users SET authority_level = COALESCE($2, authority_level), authority_scope = COALESCE($3, authority_scope), role = COALESCE($4, role),
           can_sign = COALESCE($5, can_sign), active = COALESCE($6, active), full_name = COALESCE($7, full_name), languages = COALESCE($8, languages)
         WHERE id = $1 RETURNING *`,
        [id, body.authorityLevel ?? null, body.authorityScope ? JSON.stringify(body.authorityScope) : null, body.role ?? null, body.canSign ?? null,
          body.active ?? null, body.fullName ?? null, body.languages ?? null]);
      return mapUser(rows[0]);
    });
  });
  app.get('/api/users/:id/stats', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => {
      if (ctx.user!.role !== 'admin' && ctx.user!.id !== id) throw forbidden('Yalnızca kendi istatistiğinizi görebilirsiniz');
      if (!(await ctx.db.query('SELECT 1 FROM users WHERE id = $1', [id])).rowCount) throw notFound('Kullanıcı');
      return userStats(ctx, id);
    });
  });

  // ---------------- delegations (§17.1) — no DELETE: POST /:id/end
  app.get('/api/delegations', auth, async (req) => asUser(req, async (ctx) => {
    const admin = ctx.user!.role === 'admin';
    const { rows } = await ctx.db.query(
      `SELECT * FROM delegations WHERE ($1::uuid IS NULL OR delegate_id = $1 OR admin_id = $1) ORDER BY starts_at DESC LIMIT 500`, [admin ? null : ctx.user!.id]);
    return list(rows.map(endedDelegation));
  }));
  app.post('/api/delegations', auth, async (req) => {
    const body = parse(z.object({ delegateId: z.string().uuid(), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }), reason: z.string().max(500).optional() }), req.body);
    return asUser(req, async (ctx) => {
      assertAdminHuman(ctx);
      if (Date.parse(body.endsAt) <= Date.parse(body.startsAt)) throw badRequest('Bitiş başlangıçtan sonra olmalı', undefined, 'INVALID_RANGE');
      if (body.delegateId === ctx.user!.id) throw badRequest('Kendinize vekâlet veremezsiniz', undefined, 'INVALID_DELEGATE');
      const d = (await ctx.db.query('SELECT * FROM users WHERE id = $1 AND active', [body.delegateId])).rows[0];
      if (!d) throw notFound('Vekil kullanıcı');
      const { rows } = await ctx.db.query(
        `INSERT INTO delegations (tenant_id, admin_id, delegate_id, starts_at, ends_at, reason) VALUES (app_tenant_id(), $1,$2,$3,$4,$5) RETURNING *`,
        [ctx.user!.id, body.delegateId, body.startsAt, body.endsAt, body.reason ?? null]);
      return mapDelegation(rows[0]);
    });
  });
  app.post('/api/delegations/:id/end', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    return asUser(req, async (ctx) => {
      assertAdminHuman(ctx);
      const { rows } = await ctx.db.query('UPDATE delegations SET ended_at = COALESCE(ended_at, $2) WHERE id = $1 RETURNING *', [id, ctx.now()]);
      if (!rows[0]) throw notFound('Vekâlet');
      return endedDelegation(rows[0]);
    });
  });

  // ---------------- checklist (Blok 8): AI suggests, admin approves
  app.patch('/api/checklist/:id', auth, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ status: z.enum(['active', 'rejected']), question: z.string().min(3).max(500).optional() }), req.body);
    return asUser(req, async (ctx) => {
      assertAdminHuman(ctx);
      const { rows } = await ctx.db.query(
        `UPDATE checklist_questions SET status = $2, question = COALESCE($3, question) WHERE id = $1 RETURNING *`, [id, body.status, body.question ?? null]);
      if (!rows[0]) throw notFound('Kontrol listesi sorusu');
      await expireDecisionsFor(ctx, 'checklist_question', id, ['checklist_question']);
      return mapChecklist(rows[0]);
    });
  });
}

/** An ended delegation reports its effective end (ended_at when earlier than ends_at). */
function endedDelegation(r: Record<string, unknown>) {
  const d = mapDelegation(r);
  const ended = r.ended_at ? new Date(r.ended_at as string | Date).toISOString() : null;
  if (ended && Date.parse(ended) < Date.parse(d.endsAt)) d.endsAt = ended;
  return d;
}
