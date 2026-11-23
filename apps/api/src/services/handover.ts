// v0.5 K-05 devir-teslim + K-02 erişim kapatma (docs/panel/E K1/K2/K4, docs/11 Tur 4). Admin starts it; the package is generated
// from data (open projects, customers, pending decisions, upcoming deadlines); the recipient marks every project "okudum";
// planned handovers close access at their time (worker), urgent ones immediately (admin + Face ID + reason). Nothing is deleted:
// the person becomes inactive (sessions revoked through token_version), their name stays in the history.
import type { Handover, HandoverInput, HandoverPackage } from '@mice/shared';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { iso } from '../lib/dates.js';
import type { Row } from '../lib/mappers.js';
import { verifyStepUp } from '../auth/webauthn.js';
import { notify } from './notifications.js';

function assertAdmin(ctx: Ctx): void {
  if (ctx.actor.type !== 'user' || ctx.user?.role !== 'admin') throw forbidden('Devir-teslimi yalnızca yönetici başlatır', 'ADMIN_ONLY');
}

/** Builds the handover package from live data (no AI, no free text). */
export async function buildHandoverPackage(ctx: Ctx, fromUserId: string): Promise<HandoverPackage> {
  const now = ctx.now();
  const projects = (await ctx.db.query(
    `SELECT id, code, title, customer_name, step, outcome, start_date FROM projects
      WHERE owner_id = $1 AND NOT historical AND outcome IN ('open', 'won') ORDER BY start_date NULLS LAST, code LIMIT 300`, [fromUserId])).rows;
  const ids = projects.map((p) => p.id);
  const customers = (await ctx.db.query(
    `SELECT c.id, c.name, CASE WHEN c.relationship_owner_id = $1 THEN 'owner' ELSE 'backup' END AS role, b.full_name AS backup_name
       FROM customers c LEFT JOIN users b ON b.id = c.backup_owner_id
      WHERE c.relationship_owner_id = $1 OR c.backup_owner_id = $1 ORDER BY c.name`, [fromUserId])).rows;
  const decisions = (await ctx.db.query(
    `SELECT d.id, d.summary, d.kind, p.code FROM decisions d LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.status = 'open' AND (d.project_id = ANY($1) OR d.assigned_to = $2 OR d.created_by = $2) ORDER BY d.created_at LIMIT 200`, [ids, fromUserId])).rows;
  const tasks = (await ctx.db.query(
    `SELECT t.kind, t.title, t.due_at, p.code FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status = 'open' AND t.assignee_id = $1 ORDER BY t.due_at NULLS LAST LIMIT 300`, [fromUserId])).rows;
  const options = (await ctx.db.query(
    `SELECT DISTINCT ON (o.service_item_id, o.supplier_id) o.option_until, s.name AS supplier_name, p.code FROM supplier_offers o
       JOIN projects p ON p.id = o.project_id JOIN suppliers s ON s.id = o.supplier_id
      WHERE o.project_id = ANY($1) AND o.superseded_by IS NULL AND o.option_until IS NOT NULL AND o.option_until >= $2::date
      ORDER BY o.service_item_id, o.supplier_id, o.version DESC`, [ids, now])).rows;
  const deadlines: HandoverPackage['deadlines'] = [
    ...tasks.filter((t) => t.due_at).map((t) => ({ kind: t.kind as string, title: t.title as string, dueAt: iso(t.due_at)!, projectCode: (t.code ?? null) as string | null })),
    ...options.map((o) => ({ kind: 'option_expiry', title: `${o.supplier_name} opsiyonu`, dueAt: String(o.option_until).slice(0, 10), projectCode: o.code as string })),
    ...projects.filter((p) => p.start_date && String(p.start_date) >= now.toISOString().slice(0, 10))
      .map((p) => ({ kind: 'event_start', title: `Etkinlik başlıyor: ${p.title}`, dueAt: String(p.start_date).slice(0, 10), projectCode: p.code as string })),
  ].sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))).slice(0, 100);
  return {
    generatedAt: now.toISOString(),
    projects: projects.map((p) => ({ id: p.id, code: p.code, title: p.title, customerName: p.customer_name ?? null, step: p.step, outcome: p.outcome, startDate: p.start_date ? String(p.start_date).slice(0, 10) : null })),
    customers: customers.map((c) => ({ id: c.id, name: c.name, role: c.role, backupName: c.backup_name ?? null })),
    pendingDecisions: decisions.map((d) => ({ id: d.id, summary: d.summary, kind: d.kind, projectCode: d.code ?? null })),
    deadlines,
    openTasks: tasks.length,
  };
}

const SELECT_HANDOVER = `SELECT h.*, f.full_name AS from_name, t.full_name AS to_name,
  COALESCE((SELECT array_agg(r.project_id) FROM handover_reads r WHERE r.handover_id = h.id), '{}') AS read_ids
  FROM handovers h JOIN users f ON f.id = h.from_user_id JOIN users t ON t.id = h.to_user_id`;

function mapHandover(r: Row): Handover {
  const pkg = (r.package ?? {}) as HandoverPackage;
  const total = pkg.projects?.length ?? 0;
  const read: string[] = (r.read_ids ?? []).filter((x: string) => pkg.projects?.some((p) => p.id === x));
  return {
    id: r.id, fromUserId: r.from_user_id, fromName: r.from_name, toUserId: r.to_user_id, toName: r.to_name, mode: r.mode, reason: r.reason,
    effectiveAt: iso(r.effective_at)!, status: r.status, accessClosedAt: iso(r.access_closed_at), completedAt: iso(r.completed_at), createdAt: iso(r.created_at)!,
    package: { generatedAt: pkg.generatedAt ?? iso(r.created_at)!, projects: pkg.projects ?? [], customers: pkg.customers ?? [], pendingDecisions: pkg.pendingDecisions ?? [], deadlines: pkg.deadlines ?? [], openTasks: pkg.openTasks ?? 0 },
    readProjectIds: read, readPct: total ? Math.round((read.length / total) * 100) : 100,
  };
}

async function getRow(ctx: Ctx, id: string): Promise<Row> {
  const r = (await ctx.db.query(`${SELECT_HANDOVER} WHERE h.id = $1`, [id])).rows[0];
  if (!r) throw notFound('Devir');
  return r;
}

export async function getHandover(ctx: Ctx, id: string): Promise<Handover> {
  const user = requireUser(ctx);
  const r = await getRow(ctx, id);
  if (user.role !== 'admin' && r.to_user_id !== user.id) throw forbidden('Bu devir size ait değil', 'NOT_RECIPIENT');
  return mapHandover(r);
}

export async function listHandovers(ctx: Ctx): Promise<Handover[]> {
  const user = requireUser(ctx);
  const { rows } = await ctx.db.query(`${SELECT_HANDOVER} WHERE ($1::boolean OR h.to_user_id = $2) ORDER BY h.created_at DESC LIMIT 100`, [user.role === 'admin', user.id]);
  return rows.map(mapHandover);
}

export async function startHandover(ctx: Ctx, b: HandoverInput): Promise<Handover> {
  assertAdmin(ctx);
  if (b.fromUserId === b.toUserId) throw badRequest('Devreden ve devralan farklı kişiler olmalı', undefined, 'SAME_USER');
  if (b.fromUserId === ctx.user!.id) throw conflict('Yönetici kendi erişimini devir ile kapatamaz', 'SELF_HANDOVER');
  if (!b.reason?.trim()) throw badRequest('Gerekçe zorunlu', undefined, 'REASON_REQUIRED');
  const from = (await ctx.db.query('SELECT id, active FROM users WHERE id = $1', [b.fromUserId])).rows[0];
  const to = (await ctx.db.query('SELECT id, active FROM users WHERE id = $1', [b.toUserId])).rows[0];
  if (!from || !to) throw notFound('Kullanıcı');
  if (!from.active) throw conflict('Bu kişinin erişimi zaten kapalı', 'USER_INACTIVE');
  if (!to.active) throw badRequest('Devralan aktif olmalı', undefined, 'USER_INACTIVE');
  const now = ctx.now();
  let bio: { method: string } | null = null;
  // K-02: urgent closure = admin + Face ID + mandatory reason, effective immediately
  if (b.mode === 'urgent') bio = await verifyStepUp(ctx, b.biometric as never);
  const effectiveAt = b.mode === 'urgent' ? now : b.effectiveAt ? new Date(b.effectiveAt) : now;
  if (Number.isNaN(effectiveAt.getTime())) throw badRequest('Geçersiz tarih', undefined, 'INVALID_DATE');
  const pkg = await buildHandoverPackage(ctx, b.fromUserId);
  const row = (await ctx.db.query(
    `INSERT INTO handovers (tenant_id, from_user_id, to_user_id, mode, reason, effective_at, package, biometric_method, created_by)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [b.fromUserId, b.toUserId, b.mode, b.reason.trim(), effectiveAt, JSON.stringify(pkg), bio?.method ?? null, ctx.user!.id])).rows[0];
  // urgent (or a planned time already reached): work moves and access closes now; planned: at effective_at (worker)
  if (effectiveAt.getTime() <= now.getTime()) await closeAccess(ctx, row.id);
  await notify(ctx, { userIds: [b.toUserId], priority: 'critical', title: 'Size devir paketi geldi', body: `${pkg.projects.length} proje, ${pkg.customers.length} müşteri. Her projeyi "okudum" diye işaretleyin.`, entityType: 'handover', entityId: row.id });
  return mapHandover(await getRow(ctx, row.id));
}

async function transferWork(ctx: Ctx, fromUserId: string, toUserId: string): Promise<void> {
  await ctx.db.query(`UPDATE projects SET owner_id = $2 WHERE owner_id = $1 AND NOT historical AND outcome IN ('open', 'won')`, [fromUserId, toUserId]);
  await ctx.db.query(`UPDATE tasks SET assignee_id = $2 WHERE assignee_id = $1 AND status = 'open'`, [fromUserId, toUserId]);
  // K-04: relationship owner moves to the recipient; the backup contact stays (a backup that was the leaver becomes the recipient)
  await ctx.db.query(`UPDATE customers SET relationship_owner_id = $2 WHERE relationship_owner_id = $1 AND backup_owner_id IS DISTINCT FROM $2`, [fromUserId, toUserId]);
  await ctx.db.query(`UPDATE customers SET relationship_owner_id = $2, backup_owner_id = NULL WHERE relationship_owner_id = $1 AND backup_owner_id = $2`, [fromUserId, toUserId]);
  await ctx.db.query(`UPDATE customers SET backup_owner_id = $2 WHERE backup_owner_id = $1 AND relationship_owner_id IS DISTINCT FROM $2`, [fromUserId, toUserId]);
  await ctx.db.query(`UPDATE customers SET backup_owner_id = NULL WHERE backup_owner_id = $1`, [fromUserId]);
  await ctx.db.query(`UPDATE decisions SET assigned_to = $2, assigned_at = $3 WHERE status = 'open' AND assigned_to = $1`, [fromUserId, toUserId, ctx.now()]);
  await ctx.db.query(`UPDATE message_drafts SET from_user_id = $2 WHERE from_user_id = $1 AND status IN ('draft', 'pending_approval', 'approved')`, [fromUserId, toUserId]);
}

/** K-02: sessions revoked (token_version + 1), user inactive, delegations ended, mailbox tokens purged, field packs revoked. */
export async function closeAccess(ctx: Ctx, handoverId: string): Promise<void> {
  const h = (await ctx.db.query('SELECT * FROM handovers WHERE id = $1 FOR UPDATE', [handoverId])).rows[0];
  if (!h || h.status !== 'scheduled') return;
  const now = ctx.now();
  const uid = h.from_user_id;
  // the package is refreshed at closing time (work that appeared since the plan was made is included), then the work moves
  const old = h.package as HandoverPackage;
  const fresh = await buildHandoverPackage(ctx, uid);
  const merged: HandoverPackage = { ...fresh, projects: [...(old.projects ?? []), ...fresh.projects.filter((p) => !(old.projects ?? []).some((o) => o.id === p.id))] };
  await ctx.db.query('UPDATE handovers SET package = $2 WHERE id = $1', [handoverId, JSON.stringify(merged)]);
  await transferWork(ctx, uid, h.to_user_id);
  await ctx.db.query('UPDATE users SET active = false, token_version = token_version + 1 WHERE id = $1', [uid]);
  await ctx.db.query('UPDATE delegations SET ended_at = $2 WHERE (delegate_id = $1 OR admin_id = $1) AND ended_at IS NULL AND ends_at > $2', [uid, now]);
  await ctx.db.query(`UPDATE users SET deputy_user_id = NULL WHERE deputy_user_id = $1`, [uid]);
  await ctx.db.query(`UPDATE on_call_shifts SET status = 'cancelled' WHERE user_id = $1 AND status = 'active' AND ends_at > $2`, [uid, now]);
  await ctx.db.query(`UPDATE user_mail_accounts SET status = 'disconnected', disconnected_at = $2, disconnected_reason = 'admin' WHERE user_id = $1 AND status <> 'disconnected'`, [uid, now]);
  await ctx.db.query(`UPDATE user_mail_tokens SET refresh_token_enc = NULL, access_token_enc = NULL, purged_at = $2
                       WHERE account_id IN (SELECT id FROM user_mail_accounts WHERE user_id = $1) AND purged_at IS NULL`, [uid, now]);
  await ctx.db.query(`UPDATE push_subscriptions SET active = false WHERE user_id = $1 AND active`, [uid]);
  await ctx.db.query(`UPDATE field_packs SET revoked_at = $2, revoke_reason = 'access_closed' WHERE user_id = $1 AND revoked_at IS NULL`, [uid, now]);
  // open assignment suggestions naming the leaver are moot (a human re-assigns; never silently re-routed)
  await ctx.db.query(`UPDATE decisions SET status = 'expired', reason = 'devir: kişinin erişimi kapandı' WHERE status = 'open' AND kind = 'assignment' AND detail->>'userId' = $1::text`, [uid]);
  await ctx.db.query(`UPDATE handovers SET status = 'access_closed', access_closed_at = $2 WHERE id = $1`, [handoverId, now]);
}

export async function markRead(ctx: Ctx, id: string, projectId: string): Promise<Handover> {
  const user = requireUser(ctx);
  const r = await getRow(ctx, id);
  if (r.to_user_id !== user.id) throw forbidden('Yalnız devralan kişi "okudum" işaretler', 'NOT_RECIPIENT');
  if (r.status === 'cancelled') throw conflict('Devir iptal edildi', 'HANDOVER_CANCELLED');
  const pkg = r.package as HandoverPackage;
  if (!pkg.projects?.some((p) => p.id === projectId)) throw badRequest('Bu proje devir paketinde yok', undefined, 'NOT_IN_PACKAGE');
  await ctx.db.query(
    `INSERT INTO handover_reads (tenant_id, handover_id, project_id, read_by, read_at) VALUES (app_tenant_id(), $1,$2,$3,$4) ON CONFLICT (handover_id, project_id) DO NOTHING`,
    [id, projectId, user.id, ctx.now()]);
  const h = mapHandover(await getRow(ctx, id));
  if (h.readPct === 100 && h.status === 'access_closed') {
    await ctx.db.query(`UPDATE handovers SET status = 'completed', completed_at = $2 WHERE id = $1`, [id, ctx.now()]);
    return mapHandover(await getRow(ctx, id));
  }
  return h;
}

export async function refreshHandover(ctx: Ctx, id: string): Promise<Handover> {
  assertAdmin(ctx);
  const r = await getRow(ctx, id);
  if (r.status === 'cancelled' || r.status === 'completed') throw conflict('Kapanmış devir yenilenemez', 'HANDOVER_CLOSED');
  // keeps the projects already in the package (the recipient's "okudum" marks stay valid) and adds what appeared since
  const old = r.package as HandoverPackage;
  const fresh = await buildHandoverPackage(ctx, r.from_user_id);
  const merged: HandoverPackage = { ...fresh, projects: [...old.projects, ...fresh.projects.filter((p) => !old.projects.some((o) => o.id === p.id))] };
  if (r.status === 'access_closed' && fresh.projects.length) await transferWork(ctx, r.from_user_id, r.to_user_id);
  await ctx.db.query('UPDATE handovers SET package = $2 WHERE id = $1', [id, JSON.stringify(merged)]);
  return mapHandover(await getRow(ctx, id));
}

export async function cancelHandover(ctx: Ctx, id: string): Promise<Handover> {
  assertAdmin(ctx);
  const r = await getRow(ctx, id);
  if (r.status !== 'scheduled') throw conflict('Erişim kapandıktan sonra devir iptal edilemez', 'HANDOVER_NOT_CANCELLABLE');
  await ctx.db.query(`UPDATE handovers SET status = 'cancelled', cancelled_at = $2 WHERE id = $1`, [id, ctx.now()]);
  return mapHandover(await getRow(ctx, id));
}

/** Worker: planned handovers whose time has come close access. */
export async function runPlannedHandovers(ctx: Ctx, now: Date): Promise<string[]> {
  const { rows } = await ctx.db.query(`SELECT id FROM handovers WHERE status = 'scheduled' AND effective_at <= $1 LIMIT 50`, [now]);
  for (const r of rows) await closeAccess(ctx, r.id);
  return rows.length ? [`handover_access_closed:${rows.length}`] : [];
}
