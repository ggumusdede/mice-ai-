// §7 Adım 6 Operasyon takibi: operations calendar from the signed contract (tasks to the responsible role), field extras
// (§17.1 / §17.7 limits + customer one-tap approval + reflect decision), field issues, daily 3-line summary, change flow.
import type { ContractFields, DailySummary, FieldExtra, FieldExtraInput, FieldIssue, FieldIssueInput, Role } from '@mice/shared';
import { changeImpact, fieldExtraNeedsAdmin, operationsCalendar, roleCan, startOfLocalDate, type OpsTaskSpec } from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden, gone, notFound } from '../errors.js';
import { iso, isoDate } from '../lib/dates.js';
import { newPublicToken } from '../lib/crypto.js';
import type { Row } from '../lib/mappers.js';
import { logAiAction } from './ai-log.js';
import { createDecision } from './decisions.js';
import { createDraft, sendDraft } from './drafts.js';
import { currentFx, toEur } from './fx.js';
import { getProjectRow, setStep } from './projects.js';
import { notify } from './notifications.js';
import type { PublicExtraView } from '@mice/shared';

// ------------------------------------------------------------------ operations calendar (on contract signature)
/** Which calendar tasks are relevant for a contract, by the kinds of its service items. */
function relevantKinds(itemKinds: Set<string>): Set<OpsTaskSpec['kind']> {
  const out = new Set<OpsTaskSpec['kind']>(['payment_due', 'event_day_checklist']);
  if (itemKinds.has('accommodation')) ['final_pax', 'attrition', 'rooming_list'].forEach((k) => out.add(k as OpsTaskSpec['kind']));
  if (itemKinds.has('fnb') || itemKinds.has('hall')) ['final_pax', 'menu_approval'].forEach((k) => out.add(k as OpsTaskSpec['kind']));
  if (itemKinds.has('technical') || itemKinds.has('hall')) out.add('tech_brief');
  if (itemKinds.has('transfer')) out.add('transfer_list');
  if (!itemKinds.size) ['final_pax', 'menu_approval', 'tech_brief'].forEach((k) => out.add(k as OpsTaskSpec['kind']));
  return out;
}

/** Responsible user for a role: the project owner if they hold it, else the first active user with that role, else owner/admin. */
async function assigneeFor(ctx: Ctx, role: Role, p: Row): Promise<string | null> {
  if (p.owner_id) {
    const o = (await ctx.db.query('SELECT role FROM users WHERE id = $1 AND active', [p.owner_id])).rows[0];
    if (o?.role === role) return p.owner_id;
  }
  const u = (await ctx.db.query('SELECT id FROM users WHERE role = $1 AND active ORDER BY created_at LIMIT 1', [role])).rows[0];
  if (u) return u.id;
  return p.owner_id ?? (await ctx.db.query(`SELECT id FROM users WHERE role = 'admin' AND active ORDER BY created_at LIMIT 1`)).rows[0]?.id ?? null;
}

/** Called after a contract is signed: tasks from contract dates/terms, each assigned to the responsible role. */
export async function generateOperationsCalendar(ctx: Ctx, contractId: string): Promise<number> {
  const c = (await ctx.db.query('SELECT * FROM contracts WHERE id = $1', [contractId])).rows[0];
  if (!c || c.status !== 'signed') return 0;
  const p = await getProjectRow(ctx, c.project_id);
  const eventStart = (c.fields as ContractFields)?.startDate ?? p.start_date;
  if (!eventStart) return 0;
  const rules = await ctx.rules();
  const tz = rules.businessHours.timezone;
  const supplier = (await ctx.db.query('SELECT name FROM suppliers WHERE id = $1', [c.supplier_id])).rows[0];
  const kinds = new Set<string>((await ctx.db.query('SELECT kind FROM service_items WHERE id = ANY($1)', [c.service_item_ids])).rows.map((r) => r.kind));
  const relevant = relevantKinds(kinds);
  const specs = operationsCalendar(c.fields as ContractFields, eventStart, iso(c.signed_at)).filter((s) => relevant.has(s.kind));
  const root = c.amendment_of ?? c.id;
  let n = 0;
  for (const [i, s] of specs.entries()) {
    const assignee = await assigneeFor(ctx, s.role, p);
    // event-day checklist is per project; everything else per supplier contract (amendments reuse the original's keys)
    const key = s.kind === 'event_day_checklist' ? `project:${p.id}:ops:event_day_checklist` : `contract:${root}:ops:${s.kind}:${s.kind === 'payment_due' ? i : s.dueDate}`;
    const due = new Date(startOfLocalDate(s.dueDate, tz).getTime() + 10 * 3_600_000); // 10:00 local
    const title = s.kind === 'event_day_checklist' ? `${p.code}: ${s.title}` : `${p.code} · ${supplier?.name ?? ''}: ${s.title}`;
    const r = await ctx.db.query(
      `INSERT INTO tasks (tenant_id, project_id, assignee_id, kind, title, due_at, source, origin_key, entity_type, entity_id)
       VALUES (app_tenant_id(), $1,$2,$3,$4,$5,'rule',$6,'contract',$7) ON CONFLICT (tenant_id, origin_key) DO NOTHING`,
      [p.id, assignee, s.kind, title, due, key, c.id]);
    n += r.rowCount ?? 0;
  }
  await logAiAction(ctx, { actionType: 'internal_alarm_task', projectId: p.id, entityType: 'contract', entityId: c.id, result: { confidence: 1, model: 'rules', data: { tasks: n } } });
  return n;
}

// ------------------------------------------------------------------ field extras (§17.1 / §17.7)
function mapExtra(r: Row): FieldExtra & { adminStatus: string; customerApprovedAmountTry: number | null } {
  return {
    id: r.id, projectId: r.project_id, description: r.description, amountTry: Number(r.amount_try), enteredBy: r.entered_by,
    needsAdminApproval: r.needs_admin_approval, customerApprovedAt: iso(r.customer_approved_at), customerApproverName: r.customer_approver_name,
    reflectedToCustomer: r.reflected_to_customer, notReflectedReason: r.not_reflected_reason, createdAt: iso(r.created_at)!,
    adminStatus: r.admin_status, customerApprovedAmountTry: r.customer_approved_amount_try != null ? Number(r.customer_approved_amount_try) : null,
  };
}

export async function listFieldExtras(ctx: Ctx, projectId: string): Promise<FieldExtra[]> {
  await getProjectRow(ctx, projectId);
  return (await ctx.db.query('SELECT * FROM field_extras WHERE project_id = $1 ORDER BY created_at', [projectId])).rows.map(mapExtra);
}

export async function createFieldExtra(ctx: Ctx, projectId: string, input: FieldExtraInput & { clientId?: string }): Promise<FieldExtra & { approvalLink: string }> {
  const user = requireUser(ctx);
  if (!roleCan(user.role, 'field_extra') && user.role !== 'clerk_ops') throw forbidden('Saha ekstrası yalnızca saha sorumlusu / operasyon girer', 'FORBIDDEN');
  if (!(input.amountTry > 0)) throw badRequest('Tutar pozitif olmalı', undefined, 'INVALID_AMOUNT');
  const p = await getProjectRow(ctx, projectId);
  if (input.clientId) {
    const dup = (await ctx.db.query('SELECT * FROM field_extras WHERE offline_client_id = $1', [input.clientId])).rows[0];
    if (dup) return { ...mapExtra(dup), approvalLink: '' }; // offline replay: idempotent
  }
  const rules = await ctx.rules();
  const soFar = Number((await ctx.db.query(
    `SELECT COALESCE(sum(amount_try), 0) AS s FROM field_extras WHERE project_id = $1 AND admin_status <> 'rejected'`, [projectId])).rows[0].s);
  const needsAdmin = fieldExtraNeedsAdmin(input.amountTry, soFar, { perItem: rules.fieldExtraPerItemLimitTry, perProject: rules.fieldExtraPerProjectLimitTry });
  const customer = p.customer_id ? (await ctx.db.query('SELECT name, contacts FROM customers WHERE id = $1', [p.customer_id])).rows[0] : null;
  const phone = input.customerPhone?.trim() || (customer?.contacts ?? []).find((c: { phone?: string }) => c.phone)?.phone || null;
  const row = (await ctx.db.query(
    `INSERT INTO field_extras (tenant_id, project_id, description, amount_try, entered_by, needs_admin_approval, admin_status, customer_phone, offline_client_id)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projectId, input.description, input.amountTry, user.id, needsAdmin, needsAdmin ? 'pending' : 'not_required', phone, input.clientId ?? null])).rows[0];

  if (needsAdmin) {
    const d = await createDecision(ctx, {
      projectId, kind: 'field_extra', badge: 'critical', urgent: true,
      summary: `${p.code}: saha ekstrası ${input.amountTry.toLocaleString('tr-TR')} TL — limit aşıldı (${input.description})`,
      detail: { fieldExtraId: row.id, amountTry: input.amountTry, projectTotalBeforeTry: soFar, perItemLimitTry: rules.fieldExtraPerItemLimitTry, perProjectLimitTry: rules.fieldExtraPerProjectLimitTry, enteredBy: user.fullName },
      aiNote: `Kalem limiti ${rules.fieldExtraPerItemLimitTry.toLocaleString('tr-TR')} TL, proje limiti ${rules.fieldExtraPerProjectLimitTry.toLocaleString('tr-TR')} TL (§17.1). Müşteri onayı her durumda ayrıca kaydedilir.`,
      requiredRole: 'admin', entityType: 'field_extra', entityId: row.id, primaryActionLabel: 'Face ID ile onayla',
    });
    await ctx.db.query('UPDATE field_extras SET admin_decision_id = $2 WHERE id = $1', [row.id, d.id]);
  }

  // customer's written approval is ALWAYS recorded: one-tap link via SMS / WhatsApp (sent by the field lead — a human action)
  const { token, hash } = newPublicToken();
  await ctx.db.query(
    `INSERT INTO public_tokens (tenant_id, purpose, token_hash, entity_type, entity_id, expires_at) VALUES (app_tenant_id(), 'extra', $1, 'field_extra', $2, $3)`,
    [hash, row.id, new Date(ctx.now().getTime() + 30 * 86_400_000)]);
  const approvalLink = `${ctx.deps.config.publicBaseUrl}/e/${token}`;
  const draft = await createDraft(ctx, {
    projectId, kind: 'other', channel: phone ? 'sms' : 'whatsapp', to: phone,
    subject: null, body: `${p.code}: "${input.description}" ek hizmeti ${input.amountTry.toLocaleString('tr-TR')} TL. Onay için: {{APPROVAL_LINK}}`,
    status: 'draft', fromUserId: user.id, entityType: 'field_extra', entityId: row.id,
  });
  if (phone) {
    await sendDraft(ctx, draft.id, { approvedByDecision: true, render: (b) => ({ body: b.replace('{{APPROVAL_LINK}}', approvalLink), secrets: [token] }) });
  }
  return { ...mapExtra(row), approvalLink };
}

export async function publicExtraView(ctx: Ctx, extraId: string): Promise<PublicExtraView> {
  const r = (await ctx.db.query('SELECT e.*, p.code FROM field_extras e JOIN projects p ON p.id = e.project_id WHERE e.id = $1', [extraId])).rows[0];
  if (!r) throw notFound('Ekstra');
  const t = (await ctx.db.query(`SELECT expires_at FROM public_tokens WHERE purpose = 'extra' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [extraId])).rows[0];
  if (t?.expires_at && new Date(t.expires_at) < ctx.now() && !r.customer_approved_at) throw gone('Onay bağlantısının süresi doldu', 'LINK_EXPIRED');
  const agency = (await ctx.db.query('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
  return {
    agencyName: agency, projectCode: r.code, description: r.description, amountTry: Number(r.amount_try), createdAt: iso(r.created_at)!,
    approvedAt: iso(r.customer_approved_at), approverName: r.customer_approver_name,
  };
}

/** Customer one-tap approval: person, time and amount are recorded (§17.7). */
export async function publicApproveExtra(ctx: Ctx, extraId: string, approverName: string): Promise<{ ok: true }> {
  const r = (await ctx.db.query('SELECT * FROM field_extras WHERE id = $1 FOR UPDATE', [extraId])).rows[0];
  if (!r) throw notFound('Ekstra');
  await publicExtraView(ctx, extraId);
  if (r.customer_approved_at) throw conflict('Bu ekstra zaten onaylandı', 'ALREADY_APPROVED');
  await ctx.db.query(
    `UPDATE field_extras SET customer_approved_at = $2, customer_approver_name = $3, customer_approved_amount_try = amount_try WHERE id = $1`,
    [extraId, ctx.now(), approverName.trim()]);
  await notify(ctx, { userIds: [r.entered_by], priority: 'routine', title: `Müşteri ekstrayı onayladı: ${r.description} (${Number(r.amount_try).toLocaleString('tr-TR')} TL)`, projectId: r.project_id, entityType: 'field_extra', entityId: extraId });
  return { ok: true };
}

/** Reflect to customer or not; "not reflected" requires a reason (§7 Adım 6). */
export async function reflectFieldExtra(ctx: Ctx, id: string, input: { reflected: boolean; reason?: string }): Promise<FieldExtra> {
  const user = requireUser(ctx);
  if (user.role === 'field' || user.role === 'signatory') throw forbidden('Yansıtma kararını ekip (operasyon / satış / finans / yönetici) verir');
  if (!input.reflected && !input.reason?.trim()) throw badRequest('Yansıtılmadıysa gerekçe zorunludur', undefined, 'REASON_REQUIRED');
  const r = (await ctx.db.query(
    `UPDATE field_extras SET reflected_to_customer = $2, not_reflected_reason = $3, reflected_by = $4, reflected_at = $5 WHERE id = $1 RETURNING *`,
    [id, input.reflected, input.reflected ? null : input.reason!.trim(), user.id, ctx.now()])).rows[0];
  if (!r) throw notFound('Ekstra');
  return mapExtra(r);
}

/** Admin screen: total NOT reflected amounts per project and per customer. */
export async function unreflectedTotals(ctx: Ctx): Promise<{ byProject: { projectId: string; code: string; amountTry: number; amountEur: number; count: number }[]; byCustomer: { customerId: string | null; customerName: string | null; amountTry: number; amountEur: number }[]; totalTry: number; totalEur: number }> {
  const fx = await currentFx(ctx.db);
  const eur = (try_: number) => Math.round(toEur(fx, try_, 'TRY') * 100) / 100;
  const rows = (await ctx.db.query(
    `SELECT p.id, p.code, p.customer_id, p.customer_name, sum(e.amount_try) AS s, count(*)::int AS n FROM field_extras e JOIN projects p ON p.id = e.project_id
      WHERE e.reflected_to_customer = false GROUP BY p.id, p.code, p.customer_id, p.customer_name ORDER BY s DESC`)).rows;
  const byCustomer = new Map<string, { customerId: string | null; customerName: string | null; amountTry: number; amountEur: number }>();
  for (const r of rows) {
    const k = r.customer_id ?? r.customer_name ?? '-';
    const c = byCustomer.get(k) ?? { customerId: r.customer_id, customerName: r.customer_name, amountTry: 0, amountEur: 0 };
    c.amountTry += Number(r.s);
    c.amountEur = eur(c.amountTry);
    byCustomer.set(k, c);
  }
  const totalTry = rows.reduce((s, r) => s + Number(r.s), 0);
  return {
    byProject: rows.map((r) => ({ projectId: r.id, code: r.code, amountTry: Number(r.s), amountEur: eur(Number(r.s)), count: r.n })),
    byCustomer: [...byCustomer.values()], totalTry, totalEur: eur(totalTry),
  };
}

// ------------------------------------------------------------------ field issues
function mapIssue(r: Row): FieldIssue & { supplierId: string | null } {
  return { id: r.id, projectId: r.project_id, description: r.description, severity: r.severity, occurredAt: iso(r.occurred_at)!, enteredBy: r.entered_by, createdAt: iso(r.created_at)!, supplierId: r.supplier_id };
}
export async function listFieldIssues(ctx: Ctx, projectId: string): Promise<FieldIssue[]> {
  await getProjectRow(ctx, projectId);
  return (await ctx.db.query('SELECT * FROM field_issues WHERE project_id = $1 ORDER BY occurred_at DESC', [projectId])).rows.map(mapIssue);
}
export async function createFieldIssue(ctx: Ctx, projectId: string, input: FieldIssueInput & { supplierId?: string }): Promise<FieldIssue> {
  const user = requireUser(ctx);
  const p = await getProjectRow(ctx, projectId);
  const r = (await ctx.db.query(
    `INSERT INTO field_issues (tenant_id, project_id, supplier_id, description, severity, occurred_at, entered_by) VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6) RETURNING *`,
    [projectId, input.supplierId ?? null, input.description, input.severity, input.occurredAt ?? ctx.now(), user.id])).rows[0];
  if (input.severity === 'high') {
    await notify(ctx, { roles: ['admin'], userIds: p.owner_id ? [p.owner_id] : [], priority: 'critical', title: `${p.code}: sahada kritik sorun — ${input.description}`, projectId, entityType: 'field_issue', entityId: r.id });
  }
  return mapIssue(r);
}

// ------------------------------------------------------------------ daily 3-line summary (§7 Adım 6)
export async function dailySummary(ctx: Ctx, projectId: string, day: Date = ctx.now()): Promise<DailySummary & { draftId?: string }> {
  const p = await getProjectRow(ctx, projectId);
  const rules = await ctx.rules();
  const tz = rules.businessHours.timezone;
  const today = isoDate(day, tz);
  const from = startOfLocalDate(today, tz);
  const to = startOfLocalDate(today, tz, 1);
  const tasks = (await ctx.db.query(
    `SELECT count(*) FILTER (WHERE status = 'done' AND completed_at >= $2 AND completed_at < $3)::int AS done,
            count(*) FILTER (WHERE status = 'open' AND due_at < $3)::int AS open_due FROM tasks WHERE project_id = $1`, [projectId, from, to])).rows[0];
  const issues = (await ctx.db.query(
    `SELECT severity, description FROM field_issues WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at < $3 ORDER BY occurred_at`, [projectId, from, to])).rows;
  const extras = (await ctx.db.query(
    `SELECT count(*)::int AS n, COALESCE(sum(amount_try), 0) AS s, count(*) FILTER (WHERE customer_approved_at IS NULL)::int AS pending
       FROM field_extras WHERE project_id = $1 AND created_at >= $2 AND created_at < $3`, [projectId, from, to])).rows[0];
  const lines = [
    tasks.open_due ? `Görevler: ${tasks.done} tamamlandı, ${tasks.open_due} açık iş bekliyor.` : `Görevler: ${tasks.done} tamamlandı, bekleyen iş yok.`,
    issues.length ? `Sorunlar: ${issues.length} kayıt (${issues.filter((i) => i.severity === 'high').length} kritik) — ${issues[0].description}.` : 'Sorunlar: sahada sorun kaydı yok.',
    extras.n ? `Ekstralar: ${extras.n} kalem, ${Number(extras.s).toLocaleString('tr-TR')} TL (${extras.pending} müşteri onayı bekliyor).` : 'Ekstralar: bugün ekstra harcama yok.',
  ];
  let out = lines;
  try {
    const r = await ctx.deps.ai.draftMessage({ kind: 'daily_summary', language: 'tr', senderName: ctx.user?.fullName ?? 'Ekip', facts: { projectCode: p.code, date: today, summaryLines: lines } });
    await logAiAction(ctx, { actionType: 'draft_generation', result: r, projectId, inputSummary: { kind: 'daily_summary', date: today } });
    const aiLines = r.data.body.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-•*]\s+/.test(l)).map((l) => l.replace(/^[-•*]\s+/, ''));
    if (aiLines.length >= 3) out = aiLines.slice(0, 3);
  } catch {
    /* deterministic lines are the fallback */
  }
  return { lines: out };
}

// ------------------------------------------------------------------ change flow on a service item (§7 Adım 6)
/** After a confirmed/contracted item changes quantity / nights: new cost / sale / margin; supplier notification draft;
 *  decision for the admin when the margin falls below target. */
export async function itemChangeFlow(ctx: Ctx, itemId: string, before: Row): Promise<string[]> {
  const after = (await ctx.db.query('SELECT * FROM service_items WHERE id = $1', [itemId])).rows[0];
  const p = await getProjectRow(ctx, after.project_id);
  if (p.step < 5) return [];
  const qtyBefore = Number(before.quantity) * (before.nights > 0 ? Number(before.nights) : 1);
  const qtyAfter = after.status === 'cancelled' ? 0 : Number(after.quantity) * (after.nights > 0 ? Number(after.nights) : 1);
  if (qtyBefore === qtyAfter || !(qtyBefore > 0)) return [];
  const ratio = qtyAfter / qtyBefore;
  const quote = (await ctx.db.query(`SELECT id, accepted_option_no FROM quotes WHERE project_id = $1 AND status = 'accepted' ORDER BY version DESC LIMIT 1`, [p.id])).rows[0];
  if (!quote) return [];
  const lines = (await ctx.db.query('SELECT * FROM quote_lines WHERE quote_id = $1 AND option_no = $2', [quote.id, quote.accepted_option_no])).rows;
  const m = (l: Row) => Number(l.quantity) * (l.nights > 0 ? Number(l.nights) : 1);
  let costB = 0, saleB = 0, costA = 0, saleA = 0;
  for (const l of lines) {
    const c = Number(l.unit_cost_eur) * m(l), s = Number(l.unit_price_eur) * m(l);
    costB += c; saleB += s;
    const f = l.service_item_id === itemId ? ratio : 1;
    costA += c * f; saleA += s * f;
  }
  // the sale price is only adjusted if the change is reflected to the customer; worst case (not reflected) is what the admin sees
  const rules = await ctx.rules();
  const notReflected = changeImpact({ costEur: costB, saleEur: saleB }, { costEur: costA, saleEur: saleB }, rules.targetMarginMin);
  const reflected = changeImpact({ costEur: costB, saleEur: saleB }, { costEur: costA, saleEur: saleA }, rules.targetMarginMin);
  const effects = ['change_impact_computed'];
  const sel = after.selected_offer_id ? (await ctx.db.query('SELECT o.supplier_id, s.name, s.email, s.contact_name FROM supplier_offers o JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = $1', [after.selected_offer_id])).rows[0] : null;
  if (sel) {
    await createDraft(ctx, {
      projectId: p.id, kind: 'other', to: sel.email, subject: `${p.code}: değişiklik bildirimi`,
      body: `Merhaba ${sel.contact_name ?? sel.name},\n\n${p.code} kapsamında "${after.description}" kalemi değişti: ${before.quantity}${before.nights ? ` × ${before.nights} gece` : ''} → ${after.status === 'cancelled' ? 'iptal' : `${after.quantity}${after.nights ? ` × ${after.nights} gece` : ''}`}. Güncel teyidinizi rica ederiz.\n\n${ctx.user?.fullName ?? ''}`,
      status: 'draft', requiresApproval: true, fromUserId: p.owner_id ?? ctx.user?.id ?? null, entityType: 'service_item', entityId: itemId,
    });
    effects.push('supplier_notification_draft');
  }
  await ctx.db.query(
    `INSERT INTO tasks (tenant_id, project_id, assignee_id, kind, title, source, origin_key, entity_type, entity_id)
     VALUES (app_tenant_id(), $1,$2,'change_flow',$3,'rule',$4,'service_item',$5) ON CONFLICT (tenant_id, origin_key) DO NOTHING`,
    [p.id, p.owner_id, `${p.code}: "${after.description}" değişti — maliyet farkı ${Math.round(reflected.deltaCostEur)} EUR; müşteriye yansıtma kararı`, `item:${itemId}:change:${Date.now()}`, itemId]);
  if (notReflected.belowTarget) {
    await createDecision(ctx, {
      projectId: p.id, kind: 'condition_risk', badge: 'critical', urgent: true,
      summary: `${p.code}: "${after.description}" değişikliği sonrası marj %${Math.round(notReflected.newMargin * 1000) / 10} — hedefin altında`,
      detail: { itemId, impact: notReflected, before: { quantity: before.quantity, nights: before.nights }, after: { quantity: after.quantity, nights: after.nights, status: after.status }, impactIfNotReflected: notReflected, impactIfReflected: reflected, changeFlow: true },
      aiNote: `Müşteriye yansıtılırsa yeni marj %${Math.round(reflected.newMargin * 1000) / 10}.`,
      requiredRole: 'admin', entityType: 'service_item', entityId: itemId, primaryActionLabel: 'Gördüm',
    });
    effects.push('margin_below_target_decision');
  }
  return effects;
}

/** Worker: marks projects whose event has ended (start of the day after end_date) so closing deadlines can run. */
export async function markEndedEvents(ctx: Ctx, now: Date): Promise<number> {
  const rules = await ctx.rules();
  const tz = rules.businessHours.timezone;
  const { rows } = await ctx.db.query(`SELECT id, end_date, start_date FROM projects WHERE outcome = 'won' AND event_ended_at IS NULL AND COALESCE(end_date, start_date) IS NOT NULL`);
  let n = 0;
  for (const r of rows) {
    const endedAt = startOfLocalDate(r.end_date ?? r.start_date, tz, 1);
    if (endedAt <= now) {
      await ctx.db.query('UPDATE projects SET event_ended_at = $2 WHERE id = $1', [r.id, endedAt]);
      await setStep(ctx, r.id, 7);
      n++;
    }
  }
  return n;
}
