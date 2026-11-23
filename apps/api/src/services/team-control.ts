// v0.5-A "Ekip, iletişim ve kontrol" — S-01 hızlı onay (nöbetçi, eskalasyon, toplu kart, hazır şablonlar), S-13 meşgul vekâleti,
// S-02 katılımcı mesajı ayarı, D-2 ekipler, S-09 kişisel hesap istisnası / projeye ilet, S-14 sessiz saat ayarları.
// Ana çatı 5/6: nothing here approves or sends anything by itself — cards are routed to people and people decide.
import {
  QUICK_TEMPLATES, type BatchApproveResponse, type Decision, type OnCallShift, type QuickApprovalCard, type QuickMessageRequest,
  type QuickTemplate, type Team, type TeamInput, type TenantRules, type UserTeamSettings,
} from '@mice/shared';
import {
  QUICK_APPROVAL_DECISION_KINDS, deadlineRouting, escalationChain, escalationDue, localDate, nextInChain, participantMessageAllowed,
  renderTemplate, withinBusinessHours,
} from '@mice/domain';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import { iso } from '../lib/dates.js';
import type { Row } from '../lib/mappers.js';
import { createDecision, decide, listDecisions, onDecisionCreated } from './decisions.js';
import { createDraft } from './drafts.js';
import { notify } from './notifications.js';
import { getProjectRow } from './projects.js';
import { supplierRef } from './visibility.js';

const QUICK = new Set(QUICK_APPROVAL_DECISION_KINDS);
const MAX_ESCALATION_LEVEL = 3;

function assertAdmin(ctx: Ctx): void {
  if (ctx.actor.type !== 'user' || ctx.user?.role !== 'admin') throw forbidden('Bu ayarı yalnızca yönetici değiştirir', 'ADMIN_ONLY');
}

// ================================================================== nöbet çizelgesi (on-call)
const mapShift = (r: Row): OnCallShift => ({
  id: r.id, userId: r.user_id, userName: r.user_name ?? '', startsAt: iso(r.starts_at)!, endsAt: iso(r.ends_at)!, note: r.note ?? null, status: r.status,
});

export async function listShifts(ctx: Ctx, q: { from?: string; to?: string } = {}): Promise<OnCallShift[]> {
  const from = q.from ? new Date(q.from) : new Date(ctx.now().getTime() - 7 * 86_400_000);
  const to = q.to ? new Date(q.to) : new Date(ctx.now().getTime() + 60 * 86_400_000);
  const { rows } = await ctx.db.query(
    `SELECT s.*, u.full_name AS user_name FROM on_call_shifts s JOIN users u ON u.id = s.user_id
      WHERE s.status = 'active' AND s.ends_at > $1 AND s.starts_at < $2 ORDER BY s.starts_at LIMIT 500`, [from, to]);
  return rows.map(mapShift);
}

export async function currentOnCall(ctx: Ctx, at: Date = ctx.now()): Promise<OnCallShift | null> {
  const { rows } = await ctx.db.query(
    `SELECT s.*, u.full_name AS user_name FROM on_call_shifts s JOIN users u ON u.id = s.user_id
      WHERE s.status = 'active' AND u.active AND s.starts_at <= $1 AND s.ends_at > $1 ORDER BY s.starts_at DESC LIMIT 1`, [at]);
  return rows[0] ? mapShift(rows[0]) : null;
}

export async function createShift(ctx: Ctx, b: { userId: string; startsAt: string; endsAt: string; note?: string }): Promise<OnCallShift> {
  assertAdmin(ctx);
  if (new Date(b.endsAt) <= new Date(b.startsAt)) throw badRequest('Bitiş başlangıçtan sonra olmalı', undefined, 'INVALID_PERIOD');
  const u = (await ctx.db.query('SELECT id, active FROM users WHERE id = $1', [b.userId])).rows[0];
  if (!u?.active) throw badRequest('Nöbetçi aktif bir kullanıcı olmalı', undefined, 'USER_INACTIVE');
  const { rows } = await ctx.db.query(
    `INSERT INTO on_call_shifts (tenant_id, user_id, starts_at, ends_at, note, created_by) VALUES (app_tenant_id(), $1,$2,$3,$4,$5) RETURNING id`,
    [b.userId, b.startsAt, b.endsAt, b.note?.trim() || null, ctx.user!.id]);
  return (await listShifts(ctx, { from: '1970-01-01', to: '2999-01-01' })).find((s) => s.id === rows[0].id)!;
}

export async function cancelShift(ctx: Ctx, id: string): Promise<{ ok: true }> {
  assertAdmin(ctx);
  const r = await ctx.db.query(`UPDATE on_call_shifts SET status = 'cancelled' WHERE id = $1 AND status = 'active'`, [id]);
  if (!r.rowCount) throw notFound('Nöbet');
  return { ok: true };
}

// ================================================================== S-01 kart oluşunca nöbetçiye ata
/** onDecisionCreated hook: an outbound card opened while an on-call shift runs (outside business hours by default) is assigned
 *  to the on-call person and pushed to them (critical). The card stays decidable by the usual roles too. */
export async function assignOnCall(ctx: Ctx, d: Decision): Promise<void> {
  if (!QUICK.has(d.kind) || d.requiresBiometric || d.assignedTo) return;
  const rules = await ctx.rules();
  const now = ctx.now();
  if (rules.onCallAssignOutsideBusinessHours && withinBusinessHours(now, rules.businessHours)) return;
  const oc = await currentOnCall(ctx, now);
  if (!oc) return;
  await ctx.db.query(`UPDATE decisions SET assigned_to = $2, assigned_at = $3 WHERE id = $1 AND assigned_to IS NULL AND status = 'open'`, [d.id, oc.userId, now]);
  await notify(ctx, { userIds: [oc.userId], priority: 'critical', title: `Nöbet: ${d.summary}`, body: 'Tek dokunuşla onaylayabilir veya düzeltebilirsiniz.', projectId: d.projectId, entityType: 'decision', entityId: d.id });
}

let hooked = false;
export function registerTeamControl(): void {
  if (hooked) return;
  hooked = true;
  onDecisionCreated(assignOnCall);
}

// ================================================================== S-01 eskalasyon + S-13 meşgul vekâleti (worker)
async function deputyOf(ctx: Ctx, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const r = (await ctx.db.query(`SELECT d.id FROM users u JOIN users d ON d.id = u.deputy_user_id AND d.active WHERE u.id = $1`, [userId])).rows[0];
  return r?.id ?? null;
}
async function activeAdmins(ctx: Ctx): Promise<string[]> {
  return (await ctx.db.query(`SELECT id FROM users WHERE active AND role = 'admin' ORDER BY created_at, id`)).rows.map((r) => r.id as string);
}

/** Cards assigned to a person and not handled within N minutes move to the next person (nöbetçi → vekili → yönetici). */
export async function runEscalations(ctx: Ctx, now: Date): Promise<string[]> {
  const rules = await ctx.rules();
  const minutes = rules.quickApprovalEscalationMinutes;
  if (!(minutes > 0)) return [];
  const { rows } = await ctx.db.query(
    `SELECT id, summary, project_id, assigned_to, assigned_at, escalation_level FROM decisions
      WHERE status = 'open' AND assigned_to IS NOT NULL AND kind = ANY($1) AND NOT requires_biometric AND escalation_level < $2
      ORDER BY assigned_at LIMIT 200 FOR UPDATE SKIP LOCKED`, [[...QUICK], MAX_ESCALATION_LEVEL]);
  const admins = await activeAdmins(ctx);
  let n = 0;
  for (const r of rows) {
    if (!escalationDue(new Date(r.assigned_at ?? now), now, minutes)) continue;
    const chain = escalationChain({ first: r.assigned_to, firstDeputy: await deputyOf(ctx, r.assigned_to), admins });
    const next = nextInChain(chain, r.assigned_to);
    if (!next) continue;
    await ctx.db.query(`UPDATE decisions SET assigned_to = $2, assigned_at = $3, escalation_level = escalation_level + 1 WHERE id = $1`, [r.id, next, now]);
    await notify(ctx, { userIds: [next], priority: 'critical', title: `Bekleyen mesaj kartı size geldi: ${r.summary}`, body: `${minutes} dakikadır yanıt bekliyordu.`, projectId: r.project_id, entityType: 'decision', entityId: r.id });
    n++;
  }
  return n ? [`cards_escalated:${n}`] : [];
}

/** S-13: deadline-linked cards — after waitHours and within leadHours of the deadline: critical notice to the approver, then
 *  (≥ 30 min later) routed to the approver's deputy. Never approved automatically. */
export async function runBusyDelegation(ctx: Ctx, now: Date): Promise<string[]> {
  const rules = await ctx.rules();
  if (!rules.busyDelegationEnabled) return [];
  const { rows } = await ctx.db.query(
    `SELECT id, kind, summary, project_id, required_role, assigned_to, created_at, deadline_at, approver_notified_at FROM decisions
      WHERE status = 'open' AND deadline_at IS NOT NULL AND routed_to_deputy_at IS NULL ORDER BY deadline_at LIMIT 200 FOR UPDATE SKIP LOCKED`);
  const out = { notified: 0, routed: 0 };
  for (const r of rows) {
    const notifiedAt = r.approver_notified_at ? new Date(r.approver_notified_at) : null;
    if (notifiedAt && now.getTime() - notifiedAt.getTime() < 30 * 60_000) continue;
    const step = deadlineRouting({
      enabled: true, createdAt: new Date(r.created_at), deadlineAt: new Date(r.deadline_at), now,
      waitHours: rules.busyDelegationWaitHours, leadHours: rules.busyDelegationLeadHours, approverNotified: !!notifiedAt, routed: false,
    });
    if (step === 'notify_approver') {
      await notify(ctx, r.assigned_to
        ? { userIds: [r.assigned_to], priority: 'critical', title: `Son tarih yaklaşıyor: ${r.summary}`, body: 'Yanıt gelmezse kart vekilinize yönlenecek.', projectId: r.project_id, entityType: 'decision', entityId: r.id }
        : { roles: r.required_role === 'admin' ? ['admin'] : ['admin', r.required_role], priority: 'critical', title: `Son tarih yaklaşıyor: ${r.summary}`, body: 'Yanıt gelmezse kart vekile yönlenecek.', projectId: r.project_id, entityType: 'decision', entityId: r.id });
      await ctx.db.query('UPDATE decisions SET approver_notified_at = $2 WHERE id = $1', [r.id, now]);
      out.notified++;
    } else if (step === 'route_to_deputy') {
      const owners = r.assigned_to ? [r.assigned_to] : await activeAdmins(ctx);
      let deputy: string | null = null;
      for (const o of owners) if ((deputy = await deputyOf(ctx, o))) break;
      if (!deputy) continue;
      await ctx.db.query('UPDATE decisions SET deputy_id = $2, routed_to_deputy_at = $3 WHERE id = $1', [r.id, deputy, now]);
      await notify(ctx, { userIds: [deputy], priority: 'critical', title: `Vekil olarak size yönlendirildi: ${r.summary}`, body: 'Son tarih yaklaşıyor; karar sizde (Face ID gereken kartlarda Face ID istenir).', projectId: r.project_id, entityType: 'decision', entityId: r.id });
      out.routed++;
    }
  }
  const res: string[] = [];
  if (out.notified) res.push(`deadline_approver_notified:${out.notified}`);
  if (out.routed) res.push(`deadline_routed_to_deputy:${out.routed}`);
  return res;
}

// ================================================================== S-01 toplu onay
export async function listQuickApprovals(ctx: Ctx): Promise<QuickApprovalCard[]> {
  const cards = (await listDecisions(ctx, { status: 'open' })).filter((d) => QUICK.has(d.kind) && !d.requiresBiometric);
  if (!cards.length) return [];
  const draftIds = cards.map((d) => (d.detail?.draftId as string | undefined) ?? (d.entityType === 'message_draft' ? d.entityId : null)).filter((x): x is string => !!x);
  const drafts = new Map<string, Row>((await ctx.db.query('SELECT id, channel, to_address, subject, body FROM message_drafts WHERE id = ANY($1)', [draftIds])).rows.map((r) => [r.id, r]));
  return cards.map((d) => {
    const did = (d.detail?.draftId as string | undefined) ?? (d.entityType === 'message_draft' ? d.entityId : null);
    const dr = did ? drafts.get(did) : undefined;
    const body = String(dr?.body ?? (d.draft?.body as string | undefined) ?? '');
    const rfqCount = Array.isArray(d.detail?.rfqIds) ? (d.detail.rfqIds as unknown[]).length : 0;
    return {
      decisionId: d.id, kind: d.kind, projectId: d.projectId, projectCode: d.projectCode, summary: d.summary,
      channel: (dr?.channel ?? (d.kind === 'rfq_send' ? 'email' : null)) as QuickApprovalCard['channel'],
      to: dr?.to_address ?? (d.detail?.to as string | undefined) ?? (rfqCount ? `${rfqCount} tedarikçi` : null),
      subject: dr?.subject ?? (d.draft?.subject as string | undefined) ?? null,
      preview: body.length > 240 ? `${body.slice(0, 237)}…` : body,
      urgent: d.urgent, assignedToName: d.assignedToName ?? null, escalationLevel: d.escalationLevel ?? 0, createdAt: d.createdAt,
    };
  });
}

/** One tap → N decisions. Each card is decided separately (own decision row, own audit trail, own effect); one failure does not
 *  roll back the others (savepoint per card). Only one-tap outbound kinds without a biometric gate. */
export async function batchApprove(ctx: Ctx, ids: string[], device?: string): Promise<BatchApproveResponse> {
  requireUser(ctx);
  const uniq = [...new Set(ids)];
  if (!uniq.length) throw badRequest('Onaylanacak kart yok', undefined, 'EMPTY_BATCH');
  if (uniq.length > 50) throw badRequest('Bir seferde en fazla 50 kart', undefined, 'BATCH_TOO_LARGE');
  const results: BatchApproveResponse['results'] = [];
  for (const id of uniq) {
    const row = (await ctx.db.query('SELECT kind, requires_biometric FROM decisions WHERE id = $1', [id])).rows[0];
    if (!row) { results.push({ id, ok: false, code: 'NOT_FOUND', error: 'Kart bulunamadı' }); continue; }
    if (!QUICK.has(row.kind) || row.requires_biometric) { results.push({ id, ok: false, code: 'NOT_BATCHABLE', error: 'Bu kart toplu onaylanamaz; tek tek açın' }); continue; }
    await ctx.db.query('SAVEPOINT batch_item');
    try {
      const r = await decide(ctx, id, { action: 'approve', device });
      await ctx.db.query('RELEASE SAVEPOINT batch_item');
      results.push({ id, ok: true, effects: r.effects });
    } catch (e) {
      await ctx.db.query('ROLLBACK TO SAVEPOINT batch_item');
      const err = e instanceof AppError ? e : null;
      results.push({ id, ok: false, code: err?.code ?? 'FAILED', error: err?.message ?? 'Onaylanamadı' });
    }
  }
  return { results, approved: results.filter((r) => r.ok).length };
}

// ================================================================== S-01 hazır şablonlar (tek dokunuş kart)
export function quickTemplates(rules: TenantRules): QuickTemplate[] {
  const o = rules.quickMessageTemplates ?? {};
  return QUICK_TEMPLATES.map((t) => ({ ...t, ...(o[t.key]?.subject ? { subject: o[t.key].subject! } : {}), ...(o[t.key]?.body ? { body: o[t.key].body } : {}) }));
}

export async function participantMessagingMode(ctx: Ctx, projectId: string): Promise<{ mode: 'off' | 'logistics' | 'on'; source: 'project' | 'agency' }> {
  const p = await getProjectRow(ctx, projectId);
  if (p.participant_messaging) return { mode: p.participant_messaging, source: 'project' };
  return { mode: (await ctx.rules()).participantMessagingDefault, source: 'agency' };
}

export async function setParticipantMessaging(ctx: Ctx, projectId: string, mode: 'off' | 'logistics' | 'on', reason: string): Promise<{ mode: string; source: 'project' }> {
  const user = requireUser(ctx);
  if (!['admin', 'clerk_ops', 'clerk_sales'].includes(user.role)) throw forbidden('Katılımcı mesaj ayarını yönetici / operasyon / satış değiştirir');
  if (mode !== 'off' && !reason.trim()) throw badRequest('Müşterinin iznini kısaca yazın (kim, ne zaman)', undefined, 'REASON_REQUIRED');
  await getProjectRow(ctx, projectId);
  await ctx.db.query('UPDATE projects SET participant_messaging = $2 WHERE id = $1', [projectId, mode]);
  await ctx.db.query(`INSERT INTO inbound_messages (tenant_id, project_id, channel, body, source, kind, sender_name, created_by, received_at)
    VALUES (app_tenant_id(), $1, 'manual', $2, 'system', 'note', 'Katılımcı mesaj ayarı', $3, $4)`,
    [projectId, `Katılımcıya doğrudan mesaj: ${mode === 'off' ? 'kapalı' : mode === 'logistics' ? 'yalnız lojistik' : 'açık'}. ${reason.trim()}`, user.id, ctx.now()]);
  return { mode, source: 'project' };
}

export async function createQuickMessage(ctx: Ctx, projectId: string, req: QuickMessageRequest): Promise<Decision> {
  const user = requireUser(ctx);
  if (user.role === 'finance' && req.template !== 'collection_reminder') throw forbidden('Bu hazır mesajı finans rolü açamaz');
  const rules = await ctx.rules();
  const tpl = quickTemplates(rules).find((t) => t.key === req.template);
  if (!tpl) throw badRequest('Bilinmeyen şablon', undefined, 'UNKNOWN_TEMPLATE');
  const p = await getProjectRow(ctx, projectId);
  const recipient = req.recipient ?? tpl.recipient;
  if (recipient === 'participant') {
    const m = await participantMessagingMode(ctx, projectId);
    if (!participantMessageAllowed(m.mode, tpl.logistics)) {
      throw conflict(m.mode === 'off' ? 'Katılımcıya doğrudan mesaj bu projede kapalı (müşteri izni gerekir)' : 'Bu projede katılımcıya yalnız lojistik mesaj gidebilir', 'PARTICIPANT_MESSAGING_OFF');
    }
  }
  const channel = req.channel ?? tpl.channel;
  const cust = p.customer_id ? (await ctx.db.query('SELECT name, contacts FROM customers WHERE id = $1', [p.customer_id])).rows[0] : null;
  const contact = (cust?.contacts ?? []).find((c: { email?: string; phone?: string }) => (channel === 'email' ? c.email : c.phone));
  const to = req.to?.trim() || (recipient === 'customer' ? (channel === 'email' ? contact?.email : contact?.phone) ?? null : null);
  if (!to) throw badRequest('Alıcı adresi / telefonu girin', undefined, 'RECIPIENT_MISSING');
  const ownerId: string = p.owner_id ?? user.id;
  const sender = (await ctx.db.query('SELECT full_name FROM users WHERE id = $1', [ownerId])).rows[0]?.full_name ?? user.fullName;
  const agency = (await ctx.db.query('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
  const vars: Record<string, string> = {
    projectCode: recipient === 'supplier' ? await supplierRef(ctx, p.code) : p.code, customerName: cust?.name ?? p.customer_name ?? '',
    senderName: sender, agencyName: agency, ...(req.vars ?? {}),
  };
  const missingInputs = tpl.inputs.filter((i) => i.required && !String(vars[i.key] ?? '').trim()).map((i) => i.label);
  if (missingInputs.length) throw badRequest(`Eksik bilgi: ${missingInputs.join(', ')}`, { missing: missingInputs }, 'TEMPLATE_INPUT_MISSING');
  const subject = renderTemplate(tpl.subject, vars).text;
  const body = renderTemplate(tpl.body, vars).text;
  const draft = await createDraft(ctx, {
    projectId, kind: 'quick_template', channel, to, subject: channel === 'email' ? subject : null, body,
    status: 'pending_approval', requiresApproval: true, fromUserId: ownerId, entityType: 'project', entityId: projectId,
  });
  await ctx.db.query('UPDATE message_drafts SET template_key = $2, recipient_type = $3 WHERE id = $1', [draft.id, tpl.key, recipient]);
  const urgent = tpl.key === 'crisis_notice' || tpl.key === 'delay_notice';
  return createDecision(ctx, {
    projectId, kind: 'outbound_message', badge: urgent ? 'critical' : 'suggestion', urgent,
    summary: `${p.code}: ${tpl.label}`, detail: { draftId: draft.id, to, channel, template: tpl.label },
    draft: { subject: draft.subject, body: draft.body }, requiredRole: urgent ? 'clerk_ops' : 'clerk_sales',
    entityType: 'message_draft', entityId: draft.id, primaryActionLabel: 'Onayla ve gönder',
  });
}

/** S-01 tahsilat hatırlatması: customer invoices N days past due → one ready-made reminder card per invoice per week (finance
 *  approves with one tap; never automated). */
export async function runCollectionReminders(ctx: Ctx, now: Date): Promise<string[]> {
  const rules = await ctx.rules();
  const days = rules.collectionReminderAfterDays;
  if (!(days > 0)) return [];
  const today = localDate(now, rules.businessHours.timezone);
  const { rows } = await ctx.db.query(
    `SELECT f.id, f.project_id, f.amount, f.currency, f.due_date, p.code, p.owner_id, c.name AS customer_name, c.contacts
       FROM finance_entries f JOIN projects p ON p.id = f.project_id LEFT JOIN customers c ON c.id = p.customer_id
      WHERE f.kind = 'customer_invoice' AND f.status IN ('open', 'approved') AND f.due_date IS NOT NULL AND f.due_date <= $1::date - $2::int
        AND NOT EXISTS (SELECT 1 FROM message_drafts m WHERE m.kind = 'collection_reminder' AND m.entity_type = 'finance_entry' AND m.entity_id = f.id
                          AND m.created_at > $3::timestamptz - interval '7 days')
      ORDER BY f.due_date LIMIT 50`, [today, days, now]);
  if (!rows.length) return [];
  const tpl = quickTemplates(rules).find((t) => t.key === 'collection_reminder')!;
  const agency = (await ctx.db.query('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
  let n = 0;
  for (const r of rows) {
    const to = (r.contacts ?? []).find((c: { email?: string }) => c.email)?.email ?? null;
    const sender = r.owner_id ? (await ctx.db.query('SELECT full_name FROM users WHERE id = $1', [r.owner_id])).rows[0]?.full_name : null;
    const vars = { projectCode: r.code, customerName: r.customer_name ?? '', senderName: sender ?? agency, agencyName: agency,
      amount: `${Number(r.amount).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${r.currency}`, dueDate: String(r.due_date).slice(0, 10) };
    const draft = await createDraft(ctx, {
      projectId: r.project_id, kind: 'collection_reminder', channel: 'email', to, subject: renderTemplate(tpl.subject, vars).text, body: renderTemplate(tpl.body, vars).text,
      status: 'pending_approval', requiresApproval: true, fromUserId: r.owner_id, entityType: 'finance_entry', entityId: r.id,
    });
    await ctx.db.query(`UPDATE message_drafts SET template_key = 'collection_reminder', recipient_type = 'customer' WHERE id = $1`, [draft.id]);
    await createDecision(ctx, {
      projectId: r.project_id, kind: 'outbound_message', badge: 'suggestion', summary: `${r.code}: ödeme hatırlatması (${vars.amount}, vade ${vars.dueDate})`,
      detail: { draftId: draft.id, to, channel: 'email', template: tpl.label }, draft: { subject: draft.subject, body: draft.body },
      requiredRole: 'finance', entityType: 'message_draft', entityId: draft.id, primaryActionLabel: 'Hatırlatmayı gönder',
    });
    n++;
  }
  return [`collection_reminders:${n}`];
}

// ================================================================== D-2 ekipler
export async function listTeams(ctx: Ctx): Promise<Team[]> {
  const teams = (await ctx.db.query(`SELECT t.*, l.full_name AS leader_name FROM teams t LEFT JOIN users l ON l.id = t.leader_id ORDER BY t.active DESC, t.name`)).rows;
  const members = (await ctx.db.query(`SELECT id, full_name, role, active, team_id FROM users WHERE team_id IS NOT NULL ORDER BY full_name`)).rows;
  return teams.map((t) => ({
    id: t.id, name: t.name, leaderId: t.leader_id, leaderName: t.leader_name ?? null, active: t.active,
    members: members.filter((m) => m.team_id === t.id).map((m) => ({ userId: m.id, fullName: m.full_name, role: m.role, active: m.active })),
  }));
}

async function setMembers(ctx: Ctx, teamId: string, memberIds: string[] | undefined, leaderId: string | null | undefined): Promise<void> {
  if (memberIds) {
    await ctx.db.query('UPDATE users SET team_id = NULL WHERE team_id = $1 AND NOT (id = ANY($2))', [teamId, memberIds]);
    if (memberIds.length) await ctx.db.query('UPDATE users SET team_id = $1 WHERE id = ANY($2)', [teamId, memberIds]);
  }
  // the leader is always a member of their own team
  if (leaderId) await ctx.db.query('UPDATE users SET team_id = $1 WHERE id = $2', [teamId, leaderId]);
}

export async function createTeam(ctx: Ctx, b: TeamInput): Promise<Team> {
  assertAdmin(ctx);
  const t = (await ctx.db.query(`INSERT INTO teams (tenant_id, name, leader_id, created_by) VALUES (app_tenant_id(), $1, $2, $3) RETURNING id`,
    [b.name.trim(), b.leaderId ?? null, ctx.user!.id])).rows[0];
  await setMembers(ctx, t.id, b.memberIds, b.leaderId);
  return (await listTeams(ctx)).find((x) => x.id === t.id)!;
}

export async function updateTeam(ctx: Ctx, id: string, b: Partial<TeamInput> & { active?: boolean }): Promise<Team> {
  assertAdmin(ctx);
  const cur = (await ctx.db.query('SELECT * FROM teams WHERE id = $1', [id])).rows[0];
  if (!cur) throw notFound('Ekip');
  await ctx.db.query(
    `UPDATE teams SET name = COALESCE($2, name), leader_id = CASE WHEN $3::boolean THEN $4 ELSE leader_id END, active = COALESCE($5, active) WHERE id = $1`,
    [id, b.name?.trim() || null, b.leaderId !== undefined, b.leaderId ?? null, b.active ?? null]);
  if (b.active === false) await ctx.db.query('UPDATE users SET team_id = NULL WHERE team_id = $1', [id]);
  else await setMembers(ctx, id, b.memberIds, b.leaderId);
  return (await listTeams(ctx)).find((x) => x.id === id)!;
}

// ================================================================== kişi ayarları (ekip, vekil, kişisel hesap istisnası, sessiz saat)
const mapSettings = (r: Row): UserTeamSettings => ({
  userId: r.id, fullName: r.full_name, email: r.email, role: r.role, active: r.active, teamId: r.team_id ?? null,
  deputyUserId: r.deputy_user_id ?? null, personalAccountAllowed: !!r.personal_account_allowed, quietHours: r.quiet_hours ?? null,
});

export async function listUserSettings(ctx: Ctx): Promise<UserTeamSettings[]> {
  assertAdmin(ctx);
  return (await ctx.db.query('SELECT * FROM users ORDER BY active DESC, full_name')).rows.map(mapSettings);
}

export async function updateUserSettings(ctx: Ctx, id: string, b: Partial<Pick<UserTeamSettings, 'teamId' | 'deputyUserId' | 'personalAccountAllowed' | 'quietHours'>>): Promise<UserTeamSettings> {
  assertAdmin(ctx);
  if (b.deputyUserId === id) throw badRequest('Kişi kendi vekili olamaz', undefined, 'DEPUTY_SELF');
  const { rows } = await ctx.db.query(
    `UPDATE users SET team_id = CASE WHEN $2::boolean THEN $3 ELSE team_id END, deputy_user_id = CASE WHEN $4::boolean THEN $5 ELSE deputy_user_id END,
       personal_account_allowed = COALESCE($6, personal_account_allowed), quiet_hours = CASE WHEN $7::boolean THEN $8::jsonb ELSE quiet_hours END
     WHERE id = $1 RETURNING *`,
    [id, b.teamId !== undefined, b.teamId ?? null, b.deputyUserId !== undefined, b.deputyUserId ?? null, b.personalAccountAllowed ?? null,
      b.quietHours !== undefined, b.quietHours ? JSON.stringify(b.quietHours) : null]);
  if (!rows[0]) throw notFound('Kullanıcı');
  return mapSettings(rows[0]);
}

export async function myPreferences(ctx: Ctx): Promise<{ quietHours: UserTeamSettings['quietHours']; agencyQuietHours: TenantRules['quietHours'] }> {
  const u = requireUser(ctx);
  const r = (await ctx.db.query('SELECT quiet_hours FROM users WHERE id = $1', [u.id])).rows[0];
  return { quietHours: r?.quiet_hours ?? null, agencyQuietHours: (await ctx.rules()).quietHours };
}
export async function setMyPreferences(ctx: Ctx, quietHours: UserTeamSettings['quietHours']): Promise<{ quietHours: UserTeamSettings['quietHours']; agencyQuietHours: TenantRules['quietHours'] }> {
  const u = requireUser(ctx);
  await ctx.db.query('UPDATE users SET quiet_hours = $2::jsonb WHERE id = $1', [u.id, quietHours ? JSON.stringify(quietHours) : null]);
  return myPreferences(ctx);
}

// ================================================================== S-09 "Projeye ilet" (kişisel kanaldan, okumadan)
export async function forwardToProject(ctx: Ctx, projectId: string, b: { text: string; source: 'whatsapp' | 'email' | 'other'; from?: string }): Promise<{ id: string }> {
  const user = requireUser(ctx);
  await getProjectRow(ctx, projectId);
  const label = b.source === 'whatsapp' ? 'Kişisel WhatsApp' : b.source === 'email' ? 'Kişisel e-posta' : 'Kişisel kanal';
  const { rows } = await ctx.db.query(
    `INSERT INTO inbound_messages (tenant_id, project_id, channel, from_address, subject, body, source, kind, sender_name, created_by, received_at)
     VALUES (app_tenant_id(), $1, 'manual', $2, $3, $4, 'personal_forward', 'forwarded_personal', $5, $6, $7) RETURNING id`,
    [projectId, b.from?.trim() || null, `${label} — ${user.fullName} iletti`, b.text.trim(), `${label}, çalışan iletti (${user.fullName})`, user.id, ctx.now()]);
  return { id: rows[0].id };
}
