// §7 Adım 0 — Talep analizi: inbound message → AI extraction → project (always gets a code) → duplicates,
// missing list + question draft, supplier pre-match, assignment suggestion. received_at starts the business clock.
import type { IntakeRequest, IntakeResponse, RequestExtraction, ServiceKind } from '@mice/shared';
import {
  findDuplicates, markLowConfidence, missingFromChecklist, rfqMinimumMissing, suggestAssignee, slugTr,
} from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { mapChecklist, mapDraft, mapProject } from '../lib/mappers.js';
import { isoDate, nightsBetween } from '../lib/dates.js';
import { logAiAction } from './ai-log.js';
import { aiDraft } from './drafts.js';
import { nextSeq, projectCode } from './projects.js';
import { rankForProject } from './suppliers.js';
import { aiGate } from './automation.js';

const val = <T>(e: { value: T | null } | undefined): T | null => (e ? e.value : null);

const MIN_FIELD_LABELS: Record<string, string> = {
  startDate: 'Tarih', pax: 'Kişi sayısı', city: 'Şehir / semt', district: 'Şehir / semt', roomSplit: 'Oda dağılımı (SGL/DBL)',
  rooms: 'Oda dağılımı (SGL/DBL)', hallLayout: 'Salon düzeni', budget: 'Bütçe (veya segment)',
};

async function matchCustomer(ctx: Ctx, customerId: string | undefined, name: string | null): Promise<{ id: string; name: string } | null> {
  if (customerId) {
    const r = (await ctx.db.query('SELECT id, name FROM customers WHERE id = $1', [customerId])).rows[0];
    return r ?? null;
  }
  if (!name) return null;
  const { rows } = await ctx.db.query('SELECT id, name, short_code FROM customers');
  const key = slugTr(name);
  if (!key) return null;
  const hit = rows.find((r) => {
    const n = slugTr(r.name);
    return n === key || n.includes(key) || key.includes(n) || slugTr(r.short_code) === key;
  });
  return hit ? { id: hit.id, name: hit.name } : null;
}

export async function runIntake(ctx: Ctx, req: IntakeRequest): Promise<IntakeResponse> {
  const user = requireUser(ctx);
  const rules = await ctx.rules();
  const now = ctx.now();
  const receivedAt = req.receivedAt ? new Date(req.receivedAt) : now;

  // 1) raw inbound message
  const inbound = (await ctx.db.query(
    `INSERT INTO inbound_messages (tenant_id, channel, from_address, subject, body, received_at, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.channel, req.fromAddress ?? null, req.subject ?? null, req.body, receivedAt, user.id],
  )).rows[0];

  // 2) AI extraction (autonomous, logged with confidence)
  const customers = (await ctx.db.query('SELECT name FROM customers')).rows.map((r) => r.name as string);
  const text = [req.subject, req.body].filter(Boolean).join('\n');
  const ai = await ctx.deps.ai.extractRequest(text, { channel: req.channel, today: isoDate(now), knownCustomers: customers });
  const extraction: RequestExtraction = markLowConfidence(ai.data, rules.aiConfidenceThreshold);
  const aiActionId = await logAiAction(ctx, {
    actionType: 'request_extraction', result: { ...ai, data: extraction }, entityType: 'inbound_message', entityId: inbound.id,
    inputSummary: { channel: req.channel, length: req.body.length },
  });

  // 3) customer match
  const customer = await matchCustomer(ctx, req.customerId, val(extraction.customerName));
  const customerName = customer?.name ?? val(extraction.customerName);

  // 4) project with code (every request gets one — lost requests are measured too)
  const seq = await nextSeq(ctx, 'project');
  const start = val(extraction.startDate);
  const pax = val(extraction.pax);
  const code = await projectCode(ctx, { seq, customer_id: customer?.id ?? null, customer_name: customerName, start_date: start, pax, venue_name: null });
  const title = [customerName, val(extraction.eventType), pax ? `${pax} kişi` : null].filter(Boolean).join(' · ') || req.subject || 'Yeni talep';
  const p = (await ctx.db.query(
    `INSERT INTO projects (tenant_id, seq, code, customer_id, customer_name, title, event_type, start_date, end_date, date_flexibility,
       pax, rooms_sgl, rooms_dbl, city, district, hall_layout, fnb_needs, technical_needs, transfer_needs, budget, budget_currency,
       decision_date, billing_info, extraction, received_at, target_business_days, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
    [seq, code, customer?.id ?? null, customerName, title, val(extraction.eventType), start, val(extraction.endDate),
      val(extraction.dateFlexibility), pax, val(extraction.roomsSgl), val(extraction.roomsDbl), val(extraction.city),
      val(extraction.district), val(extraction.hallLayout), val(extraction.fnb), val(extraction.technical), val(extraction.transfer),
      val(extraction.budget), val(extraction.budgetCurrency), val(extraction.decisionDate), val(extraction.billingInfo),
      JSON.stringify(extraction), receivedAt, rules.quoteTargetBusinessDays, user.id],
  )).rows[0];
  await ctx.db.query('UPDATE inbound_messages SET project_id = $2 WHERE id = $1', [inbound.id, p.id]);
  await ctx.db.query('UPDATE ai_actions SET project_id = $2 WHERE id = $1', [aiActionId, p.id]);

  // 5) service items drafted from the request (team edits them)
  await createItemsFromRequest(ctx, p);

  // 6) duplicates: same customer + overlapping dates, open project
  const open = (await ctx.db.query(
    `SELECT id, code, customer_name, start_date, end_date FROM projects WHERE outcome = 'open' AND id <> $1`, [p.id])).rows;
  const duplicates = findDuplicates(
    { customerName, startDate: start, endDate: val(extraction.endDate) },
    open.map((o) => ({ id: o.id, code: o.code, customerName: o.customer_name, startDate: o.start_date, endDate: o.end_date })),
  );

  // 7) missing list: RFQ minimum + learning checklist
  const minMissing = rfqMinimumMissing({
    startDate: p.start_date, pax: p.pax, city: p.city, district: p.district, roomsSgl: p.rooms_sgl, roomsDbl: p.rooms_dbl,
    hallLayout: p.hall_layout, budget: p.budget, budgetSegment: p.budget_segment,
  });
  const checklist = (await ctx.db.query(`SELECT * FROM checklist_questions WHERE status = 'active'`)).rows.map(mapChecklist);
  const fromChecklist = missingFromChecklist(extraction, checklist, p.event_type, rules.aiConfidenceThreshold);
  const missingFields = [...new Set([...minMissing, ...fromChecklist.map((m) => m.field).filter((f): f is string => !!f)])];
  const missingQuestions = [...new Set([
    ...minMissing.map((f) => `${MIN_FIELD_LABELS[f] ?? f} bilgisini paylaşabilir misiniz?`),
    ...fromChecklist.map((m) => m.question),
  ])];

  // 8) missing-info question draft — no price inside, so the clerk may send it without admin approval (§7 Adım 0)
  let questionDraft = null;
  if (missingQuestions.length) {
    const lang = extraction.language ?? 'tr';
    const row = await aiDraft(ctx, {
      kind: 'missing_info', language: lang, recipientName: customerName,
      facts: { projectCode: code, questions: missingQuestions, eventType: p.event_type, startDate: start, pax },
    }, { projectId: p.id, to: req.fromAddress ?? null, status: 'draft', requiresApproval: false, fromUserId: user.id, entityType: 'project', entityId: p.id });
    questionDraft = mapDraft(row);
  }

  // 9) supplier pre-match (accredited first, then candidates; requested district first)
  const preMatchedSuppliers = (await rankForProject(ctx, p, (p.rooms_sgl ?? 0) + (p.rooms_dbl ?? 0) > 0 ? 'accommodation' : 'hall')).slice(0, 5);

  // 10) assignment suggestion → 'assignment' decision (admin one-tap) via the automation gate
  const users = (await ctx.db.query(
    `SELECT u.id, u.full_name, u.role,
       (SELECT count(*) FROM projects x WHERE x.owner_id = u.id AND x.outcome = 'open')::int AS open_projects,
       (SELECT count(*) FROM projects x WHERE x.owner_id = u.id AND $1::uuid IS NOT NULL AND x.customer_id = $1)::int AS customer_projects
     FROM users u WHERE u.active AND u.role IN ('clerk_sales')`,
    [customer?.id ?? null],
  )).rows;
  const suggestion = suggestAssignee(users.map((u) => ({ id: u.id, fullName: u.full_name, role: u.role, openProjects: u.open_projects, customerProjects: u.customer_projects })));
  if (suggestion) {
    const assignAi = await logAiAction(ctx, { actionType: 'team_assignment', projectId: p.id, result: { confidence: 1, model: 'rules', data: suggestion } });
    await aiGate(ctx, 'team_assignment', {
      projectId: p.id, kind: 'assignment', badge: 'suggestion',
      summary: `${code}: ${suggestion.fullName} atansın mı?`,
      detail: { userId: suggestion.userId, fullName: suggestion.fullName, reason: suggestion.reason, duplicates },
      aiNote: suggestion.reason, requiredRole: 'admin', entityType: 'project', entityId: p.id,
      draft: { userId: suggestion.userId }, aiActionId: assignAi,
    });
  }

  const fresh = (await ctx.db.query('SELECT * FROM projects WHERE id = $1', [p.id])).rows[0];
  return {
    project: mapProject(fresh),
    duplicates,
    missingFields,
    missingQuestions,
    questionDraft,
    preMatchedSuppliers,
    assignmentSuggestion: suggestion,
    rfqReady: minMissing.length === 0,
  };
}

/** Initial service items from the extracted request (§5): accommodation, hall, F&B, transfer, technical. */
async function createItemsFromRequest(ctx: Ctx, p: Record<string, any>): Promise<void> {
  const nights = nightsBetween(p.start_date, p.end_date);
  const items: { kind: ServiceKind; description: string; quantity: number; unit: string; nights: number | null; specs: Record<string, unknown> }[] = [];
  const rooms = (p.rooms_sgl ?? 0) + (p.rooms_dbl ?? 0);
  if (rooms > 0) items.push({ kind: 'accommodation', description: `Konaklama ${p.rooms_sgl ?? 0} SGL + ${p.rooms_dbl ?? 0} DBL`, quantity: rooms, unit: 'room_night', nights: nights && nights > 0 ? nights : 1, specs: { roomsSgl: p.rooms_sgl, roomsDbl: p.rooms_dbl } });
  if (p.hall_layout) items.push({ kind: 'hall', description: `Toplantı salonu (${p.hall_layout})`, quantity: 1, unit: 'day', nights: null, specs: { layout: p.hall_layout, pax: p.pax } });
  if (p.fnb_needs) items.push({ kind: 'fnb', description: `Yiyecek-içecek: ${p.fnb_needs}`, quantity: p.pax ?? 1, unit: 'pax_day', nights: null, specs: { menu: p.fnb_needs } });
  if (p.transfer_needs) items.push({ kind: 'transfer', description: `Transfer: ${p.transfer_needs}`, quantity: 1, unit: 'lump_sum', nights: null, specs: { detail: p.transfer_needs } });
  if (p.technical_needs) items.push({ kind: 'technical', description: `Teknik: ${p.technical_needs}`, quantity: 1, unit: 'lump_sum', nights: null, specs: { detail: p.technical_needs } });
  let sort = 0;
  for (const it of items) {
    await ctx.db.query(
      `INSERT INTO service_items (tenant_id, project_id, kind, description, date_from, date_to, quantity, unit, nights, specs, sort)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [p.id, it.kind, it.description, p.start_date, p.end_date, it.quantity, it.unit, it.nights, JSON.stringify(it.specs), sort++],
    );
  }
}
