// Projects: one project = one record (§5). PATCH changes propagate staleness via DB triggers (§3.5).
import type {
  AskResponse, AuditEntry, Project, ProjectAlert, ProjectDetail, ProfitSummary, ServiceItemDetail, SimilarProject,
} from '@mice/shared';
import { businessMinutesBetween, businessMinutesPerDay, formatProjectCode, profitSummary } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, notFound } from '../errors.js';
import {
  mapAudit, mapContract, mapCustomer, mapDocument, mapProject, mapRfq, mapServiceItem, mapTask, type Row,
} from '../lib/mappers.js';
import { isoDate } from '../lib/dates.js';
import { evaluateItemOffers } from './offers.js';
import { loadQuotes } from './quotes.js';
import { logAiAction } from './ai-log.js';
import { canSeeFinancials, redactAudit, redactProjectDetail, redactSimilar } from './visibility.js';

export async function getProjectRow(ctx: Ctx, id: string, forUpdate = false): Promise<Row> {
  const { rows } = await ctx.db.query(`SELECT * FROM projects WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound('Proje');
  return rows[0];
}

export async function nextSeq(ctx: Ctx, name: string): Promise<number> {
  const { rows } = await ctx.db.query(
    `INSERT INTO tenant_sequences (tenant_id, name, value) VALUES (app_tenant_id(), $1, 1)
     ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_sequences.value + 1 RETURNING value`,
    [name],
  );
  return rows[0].value;
}

export async function projectCode(ctx: Ctx, p: { seq: number; customer_id: string | null; customer_name: string | null; start_date: string | null; pax: number | null; venue_name: string | null }): Promise<string> {
  const rules = await ctx.rules();
  let customer = p.customer_name;
  if (p.customer_id) {
    const c = (await ctx.db.query('SELECT short_code FROM customers WHERE id = $1', [p.customer_id])).rows[0];
    if (c) customer = c.short_code;
  }
  return formatProjectCode({ prefix: rules.projectCodePrefix, seq: p.seq, customer, date: p.start_date, pax: p.pax, venue: p.venue_name });
}

export async function listProjects(ctx: Ctx, f: { q?: string; outcome?: string; step?: number }): Promise<Project[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(`(code ILIKE $${params.length} OR title ILIKE $${params.length} OR customer_name ILIKE $${params.length})`);
  }
  if (f.outcome) {
    params.push(f.outcome);
    where.push(`outcome = $${params.length}`);
  }
  if (f.step !== undefined) {
    params.push(f.step);
    where.push(`step = $${params.length}`);
  }
  const { rows } = await ctx.db.query(
    `SELECT * FROM projects ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY received_at DESC LIMIT 500`, params);
  return rows.map(mapProject);
}

const PATCHABLE: Record<string, string> = {
  title: 'title', customerId: 'customer_id', customerName: 'customer_name', eventType: 'event_type', startDate: 'start_date',
  endDate: 'end_date', dateFlexibility: 'date_flexibility', pax: 'pax', roomsSgl: 'rooms_sgl', roomsDbl: 'rooms_dbl', city: 'city',
  district: 'district', hallLayout: 'hall_layout', fnbNeeds: 'fnb_needs', technicalNeeds: 'technical_needs',
  transferNeeds: 'transfer_needs', budget: 'budget', budgetCurrency: 'budget_currency', budgetSegment: 'budget_segment',
  decisionDate: 'decision_date', billingInfo: 'billing_info', venueName: 'venue_name', targetBusinessDays: 'target_business_days',
  targetOverrideReason: 'target_override_reason', customerWaitMinutes: 'customer_wait_minutes', eventEndedAt: 'event_ended_at',
};
const CODE_FIELDS = new Set(['customer_id', 'customer_name', 'start_date', 'pax', 'venue_name']);

export async function patchProject(ctx: Ctx, id: string, patch: Record<string, unknown>): Promise<Project> {
  const before = await getProjectRow(ctx, id, true);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const changed = new Set<string>();
  for (const [k, v] of Object.entries(patch)) {
    const col = PATCHABLE[k];
    if (!col) continue;
    params.push(v);
    sets.push(`${col} = $${params.length}`);
    changed.add(col);
  }
  if (changed.has('target_business_days')) {
    const rules = await ctx.rules();
    const reason = (patch.targetOverrideReason as string | undefined) ?? (patch.reason as string | undefined);
    if (Number(patch.targetBusinessDays) !== rules.quoteTargetBusinessDays && !reason?.trim()) {
      throw badRequest('Teklif süresi hedefi yalnızca gerekçeyle değiştirilebilir (§17.10)', undefined, 'REASON_REQUIRED');
    }
    if (!changed.has('target_override_reason')) {
      params.push(reason ?? null);
      sets.push(`target_override_reason = $${params.length}`);
    }
  }
  if (!sets.length) return mapProject(before);
  const { rows } = await ctx.db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  let after = rows[0];
  if ([...changed].some((c) => CODE_FIELDS.has(c))) {
    const code = await projectCode(ctx, after);
    if (code !== after.code) after = (await ctx.db.query('UPDATE projects SET code = $2 WHERE id = $1 RETURNING *', [id, code])).rows[0];
  }
  return mapProject(after);
}

export async function assignProject(ctx: Ctx, id: string, userId: string): Promise<Project> {
  await getProjectRow(ctx, id);
  const u = await ctx.db.query('SELECT id FROM users WHERE id = $1 AND active', [userId]);
  if (!u.rowCount) throw notFound('Kullanıcı');
  const { rows } = await ctx.db.query('UPDATE projects SET owner_id = $2 WHERE id = $1 RETURNING *', [id, userId]);
  // assignment decided by a human → any open AI assignment suggestion is moot
  await ctx.db.query(`UPDATE decisions SET status = 'expired' WHERE status = 'open' AND kind = 'assignment' AND project_id = $1`, [id]);
  return mapProject(rows[0]);
}

/** §7 Adım 4: won / lost (lost requires a reason). Losing closes the project's supplier links (§17.5). */
export async function setOutcome(ctx: Ctx, id: string, outcome: 'won' | 'lost', lostReason?: string): Promise<Project> {
  const p = await getProjectRow(ctx, id, true);
  if (outcome === 'lost' && !lostReason?.trim()) throw badRequest('Kayıp nedeni zorunludur', undefined, 'LOST_REASON_REQUIRED');
  const step = outcome === 'won' ? Math.max(p.step, 5) : p.step;
  const { rows } = await ctx.db.query(
    'UPDATE projects SET outcome = $2, lost_reason = $3, step = $4 WHERE id = $1 RETURNING *',
    [id, outcome, outcome === 'lost' ? lostReason!.trim() : null, step],
  );
  if (outcome === 'lost') {
    await ctx.db.query(
      `UPDATE rfqs SET status = 'closed', closed_reason = 'project_lost', link_expires_at = LEAST(COALESCE(link_expires_at, $2), $2)
       WHERE project_id = $1 AND status NOT IN ('closed','cancelled')`,
      [id, ctx.now()],
    );
  }
  return mapProject(rows[0]);
}

export async function setStep(ctx: Ctx, id: string, step: number, onlyForward = true): Promise<void> {
  await ctx.db.query(`UPDATE projects SET step = ${onlyForward ? 'GREATEST(step, $2)' : '$2'} WHERE id = $1`, [id, step]);
}

// ------------------------------------------------------------------ detail
export async function projectDetail(ctx: Ctx, id: string): Promise<ProjectDetail> {
  const p = await getProjectRow(ctx, id);
  const project = mapProject(p);
  const rules = await ctx.rules();
  const customerRow = p.customer_id ? (await ctx.db.query('SELECT * FROM customers WHERE id = $1', [p.customer_id])).rows[0] : null;
  const itemRows = (await ctx.db.query('SELECT * FROM service_items WHERE project_id = $1 ORDER BY sort, created_at', [id])).rows;
  const rfqRows = (await ctx.db.query('SELECT * FROM rfqs WHERE project_id = $1 ORDER BY created_at', [id])).rows;
  const quotes = await loadQuotes(ctx, { projectId: id });
  const accepted = quotes.find((q) => q.status === 'accepted' && q.acceptedOptionNo != null);
  const latest = quotes.find((q) => q.status !== 'superseded');
  const refQuote = accepted ?? latest ?? null;
  const refOption = refQuote ? refQuote.options.find((o) => o.optionNo === (refQuote.acceptedOptionNo ?? 1)) ?? refQuote.options[0] : null;

  const alerts: ProjectAlert[] = [];
  const items: ServiceItemDetail[] = [];
  for (const it of itemRows) {
    const ev = await evaluateItemOffers(ctx, it, p);
    const lines = refOption?.lines.filter((l) => l.serviceItemId === it.id) ?? [];
    const mult = (l: { quantity: number; nights: number | null }) => l.quantity * (l.nights && l.nights > 0 ? l.nights : 1);
    const selected = ev.evaluations.find((e) => e.offerId === it.selected_offer_id) ?? null;
    const selectedOffer = ev.offers.find((o) => o.id === it.selected_offer_id) ?? null;
    const selSupplier = selectedOffer ? ev.suppliers.find((s) => s.id === selectedOffer.supplierId) : null;
    items.push({
      ...mapServiceItem(it),
      offers: ev.offers,
      evaluations: ev.evaluations,
      rfqs: rfqRows.filter((r) => r.service_item_id === it.id).map(mapRfq),
      selectedSupplierName: selSupplier?.name ?? null,
      costEur: lines.length ? lines.reduce((s, l) => s + l.unitCostEur * mult(l), 0) : selected?.normalized.totalNetExVatEur ?? null,
      saleEur: lines.length ? lines.reduce((s, l) => s + l.unitPriceEur * mult(l), 0) : null,
      priceClass: selected?.priceClass ?? null,
    });
    if (selSupplier?.status === 'candidate') {
      alerts.push({ level: 'critical', code: 'CANDIDATE_SUPPLIER', message: `${selSupplier.name} aday tedarikçi — müşteriye sunmak için akreditasyon gerekli`, entityId: selSupplier.id });
    }
    for (const o of ev.offers) {
      if (o.confidence != null && o.confidence < rules.aiConfidenceThreshold && !o.verifiedBy) {
        alerts.push({ level: 'warning', code: 'OFFER_NEEDS_REVIEW', message: `${it.description}: düşük güvenli teklif okuması doğrulanmalı`, entityId: o.id });
      }
    }
    if (selectedOffer?.optionUntil) {
      const days = (Date.parse(selectedOffer.optionUntil) - Date.parse(isoDate(ctx.now()))) / 86_400_000;
      if (days <= rules.optionExpiryWarningDays) {
        alerts.push({ level: days < 0 ? 'critical' : 'warning', code: 'OPTION_EXPIRING', message: `${it.description}: tedarikçi opsiyonu ${selectedOffer.optionUntil}`, entityId: selectedOffer.id });
      }
    }
  }
  const docRows = (await ctx.db.query(
    `SELECT id, tenant_id, project_id, kind, version, status, stale_reason, generated_at, content, (file_data IS NOT NULL) AS has_file
     FROM documents WHERE project_id = $1 AND superseded_by IS NULL ORDER BY kind, version DESC`, [id])).rows;
  for (const d of docRows) {
    if (d.status === 'stale') alerts.push({ level: 'warning', code: 'DOCUMENT_STALE', message: `${d.kind} belgesi eski: ${d.stale_reason}`, entityId: d.id });
  }
  const contracts = (await ctx.db.query('SELECT * FROM contracts WHERE project_id = $1 AND superseded_by IS NULL ORDER BY created_at', [id])).rows.map(mapContract);
  const tasks = (await ctx.db.query(`SELECT * FROM tasks WHERE project_id = $1 ORDER BY status, due_at NULLS LAST`, [id])).rows.map(mapTask);
  const activity = (await ctx.db.query('SELECT * FROM audit_log WHERE project_id = $1 ORDER BY at DESC, id DESC LIMIT 20', [id])).rows.map(mapAudit);

  const expected: ProfitSummary | null = refOption ? refOption.totals : null;
  const fin = (await ctx.db.query(
    `SELECT kind, sum(amount_eur) AS s FROM finance_entries WHERE project_id = $1 AND status <> 'cancelled'
       AND kind IN ('supplier_invoice','customer_invoice') GROUP BY kind`, [id])).rows;
  const cost = fin.find((r) => r.kind === 'supplier_invoice')?.s;
  const sale = fin.find((r) => r.kind === 'customer_invoice')?.s;
  const realized = cost != null || sale != null ? profitSummary(Number(cost ?? 0), Number(sale ?? 0)) : null;

  const cal = rules.businessHours;
  const end = p.quote_sent_at ?? ctx.now();
  const detail: ProjectDetail = {
    project,
    customer: customerRow ? mapCustomer(customerRow) : null,
    items,
    quotes,
    contracts,
    documents: docRows.map(mapDocument),
    tasks,
    alerts,
    profit: { expected, realized },
    recentActivity: activity,
    stepTimer: {
      businessMinutesElapsed: businessMinutesBetween(new Date(p.received_at), new Date(end), cal),
      targetBusinessMinutes: Number(p.target_business_days) * businessMinutesPerDay(cal),
      customerWaitMinutes: p.customer_wait_minutes,
    },
  };
  // least privilege ([Ürün kararı] fieldRoleCanSeeFinancials): the field role gets no money data
  return (await canSeeFinancials(ctx)) ? detail : redactProjectDetail(detail);
}

export async function projectTimeline(ctx: Ctx, id: string): Promise<AuditEntry[]> {
  await getProjectRow(ctx, id);
  const { rows } = await ctx.db.query('SELECT * FROM audit_log WHERE project_id = $1 ORDER BY at ASC, id ASC LIMIT 2000', [id]);
  const entries = rows.map(mapAudit);
  return (await canSeeFinancials(ctx)) ? entries : redactAudit(entries);
}

/** Know-how screen (§4): similar past projects, with what price they were won/lost. */
export async function similarProjects(ctx: Ctx, id: string): Promise<SimilarProject[]> {
  const p = await getProjectRow(ctx, id);
  const { rows } = await ctx.db.query(
    `SELECT p.*,
       (SELECT sum(ql.unit_price_eur * ql.quantity * GREATEST(COALESCE(ql.nights,1),1)) FROM quotes q JOIN quote_lines ql ON ql.quote_id = q.id
         WHERE q.project_id = p.id AND q.status <> 'superseded' AND ql.option_no = COALESCE(q.accepted_option_no, 1)
           AND q.version = (SELECT max(version) FROM quotes q2 WHERE q2.project_id = p.id)) AS sale,
       (SELECT sum(ql.unit_cost_eur * ql.quantity * GREATEST(COALESCE(ql.nights,1),1)) FROM quotes q JOIN quote_lines ql ON ql.quote_id = q.id
         WHERE q.project_id = p.id AND q.status <> 'superseded' AND ql.option_no = COALESCE(q.accepted_option_no, 1)
           AND q.version = (SELECT max(version) FROM quotes q2 WHERE q2.project_id = p.id)) AS cost
     FROM projects p
     WHERE p.id <> $1 AND (
       ($2::uuid IS NOT NULL AND p.customer_id = $2)
       OR ($3::text IS NOT NULL AND p.event_type = $3 AND ($4::int IS NULL OR p.pax BETWEEN $4 * 0.5 AND $4 * 1.5))
       OR ($5::text IS NOT NULL AND p.district = $5 AND ($4::int IS NULL OR p.pax BETWEEN $4 * 0.5 AND $4 * 1.5)))
     ORDER BY (p.customer_id = $2) DESC NULLS LAST, p.received_at DESC LIMIT 10`,
    [id, p.customer_id, p.event_type, p.pax, p.district],
  );
  const out = rows.map((r) => {
    const sale = r.sale != null ? Number(r.sale) : null;
    const cost = r.cost != null ? Number(r.cost) : null;
    return {
      projectId: r.id, code: r.code, customerName: r.customer_name, eventType: r.event_type, pax: r.pax, outcome: r.outcome,
      totalSaleEur: sale != null ? Math.round(sale * 100) / 100 : null,
      margin: sale && cost != null ? (sale - cost) / sale : null, lostReason: r.lost_reason,
    };
  });
  return (await canSeeFinancials(ctx)) ? out : redactSimilar(out);
}

/** "Bu projeye sor" (§15): answers only from this project's facts (§3.7 — says "veri yok" otherwise). */
export async function askProject(ctx: Ctx, id: string | null, question: string): Promise<AskResponse> {
  requireUser(ctx);
  const facts: Record<string, unknown> = {};
  const sources: AskResponse['sources'] = [];
  let label = 'Genel';
  if (id) {
    const detail = await projectDetail(ctx, id);
    label = detail.project.code;
    facts.project = detail.project;
    facts.customer = detail.customer ? { name: detail.customer.name, rules: detail.customer.rules } : null;
    facts.items = detail.items.map((i) => ({
      kind: i.kind, description: i.description, quantity: i.quantity, selectedSupplier: i.selectedSupplierName, costEur: i.costEur,
      saleEur: i.saleEur, offers: i.evaluations.map((e) => ({ supplierId: e.normalized.supplierId, totalNetEur: e.normalized.totalNetExVatEur, priceClass: e.priceClass, advantage: e.advantage })),
    }));
    facts.quotes = detail.quotes.map((q) => ({ version: q.version, status: q.status, options: q.options.map((o) => ({ title: o.title, totals: o.totals })) }));
    facts.contracts = detail.contracts.map((c) => ({ status: c.status, supplierId: c.supplierId, diffCount: c.diff.length }));
    facts.alerts = detail.alerts;
    sources.push({ type: 'project', id, label: detail.project.code });
    if (detail.project.customerId && (await canSeeFinancials(ctx))) {
      const hist = await similarProjects(ctx, id);
      facts.customerHistory = hist;
      for (const h of hist.slice(0, 5)) sources.push({ type: 'project', id: h.projectId, label: h.code });
      const venues = (await ctx.db.query(
        `SELECT p.code, p.start_date, s.name AS supplier, ph.kind, ph.unit_price_eur, ph.price_type FROM price_history ph
           JOIN projects p ON p.id = ph.project_id LEFT JOIN suppliers s ON s.id = ph.supplier_id
          WHERE p.customer_id = $1 AND p.id <> $2 ORDER BY ph.created_at DESC LIMIT 30`,
        [detail.project.customerId, id])).rows;
      facts.customerPriceHistory = venues;
    }
  }
  const result = await ctx.deps.ai.ask({ question, contextLabel: label, facts });
  await logAiAction(ctx, { actionType: 'comparison', result, projectId: id, inputSummary: { question } });
  return { answer: result.data.answer, sources, confidence: result.confidence };
}
