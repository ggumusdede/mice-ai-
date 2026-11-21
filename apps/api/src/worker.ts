// Follow-up worker (§7 Adım 1/4/7/8): RFQ 24h reminder (autonomous, pre-approved template), 48h call task,
// quote follow-up drafts, option expiry alarms (+ extension draft), unbilled-payment escalation, closing overdue.
// Runs per tenant in its own withTenant() transaction. `runFollowupsOnce(now)` is callable from tests.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { dueFollowups, type FollowupAction, type FollowupState } from '@mice/domain';
import { createAiService } from '@mice/ai';
import { loadConfig } from './config.js';
import { initPool, withoutTenant, closePool } from './db/pool.js';
import { withSystemCtx, type AppDeps, type Ctx } from './context.js';
import { createDeliveryProvider } from './services/delivery.js';
import { loadDeliveryConfig } from './delivery-config.js';
import { setNotificationService } from './services/notifications.js';
import { createNotificationService } from './services/push.js';
import { registerAll } from './services/registry.js';
import { createDecision } from './services/decisions.js';
import { aiDraft } from './services/drafts.js';
import { aiGate } from './services/automation.js';
import { logAiAction } from './services/ai-log.js';
import { iso } from './lib/dates.js';
import { runPostJobs, runPreJobs } from './jobs.js';

/** §6 single external exception: pre-approved template, no AI-generated text, no new link. */
export const RFQ_REMINDER_TEMPLATE: Record<string, (v: { contact: string; code: string; item: string; sender: string }) => { subject: string; body: string }> = {
  tr: (v) => ({ subject: `Hatırlatma: ${v.code} fiyat talebi`, body: `Merhaba ${v.contact},\n\n${v.code} referanslı "${v.item}" fiyat talebimiz için yanıtınızı bekliyoruz. Teklif formu bağlantısı ilk e-postamızdadır; dilerseniz bu e-postaya yanıt olarak da iletebilirsiniz.\n\nTeşekkürler,\n${v.sender}` }),
  en: (v) => ({ subject: `Reminder: ${v.code} request for quotation`, body: `Dear ${v.contact},\n\nWe are looking forward to your quotation for "${v.item}" (ref. ${v.code}). The offer form link is in our first e-mail; you may also simply reply to this e-mail.\n\nThank you,\n${v.sender}` }),
  ru: (v) => ({ subject: `Напоминание: запрос ${v.code}`, body: `Здравствуйте, ${v.contact}!\n\nНапоминаем о нашем запросе цены «${v.item}» (${v.code}). Ссылка на форму — в нашем первом письме; можно ответить и на это письмо.\n\nСпасибо,\n${v.sender}` }),
};

async function buildState(ctx: Ctx, now: Date): Promise<FollowupState> {
  const q = (sql: string) => ctx.db.query(sql).then((r) => r.rows);
  const rfqs = await q(`SELECT id, status, sent_at, reminder_sent_at, call_task_created_at, reminder_hours, call_hours FROM rfqs WHERE status = 'sent'`);
  const quotes = await q(`SELECT id, status, sent_at, option_until, last_followup_at FROM quotes WHERE status = 'sent'`);
  const offers = await q(`SELECT o.id, o.option_until, o.alarmed_at, (si.selected_offer_id = o.id) AS selected FROM supplier_offers o
                          JOIN service_items si ON si.id = o.service_item_id JOIN projects p ON p.id = o.project_id
                          WHERE o.superseded_by IS NULL AND o.option_until IS NOT NULL AND p.outcome IN ('open','won') AND si.status <> 'confirmed'`);
  const payments = await q(`SELECT id, created_at, booked_at, payer_user_id, escalated_at, last_reminder_at FROM bank_transactions WHERE status = 'unmatched' AND amount < 0`);
  const projects = await q(`SELECT id, event_ended_at, closed_at, overdue_alerted_at FROM projects WHERE closed_at IS NULL AND event_ended_at IS NOT NULL`);
  return {
    now,
    rfqs: rfqs.map((r) => ({ id: r.id, status: r.status, sentAt: iso(r.sent_at), reminderSentAt: iso(r.reminder_sent_at), callTaskCreatedAt: iso(r.call_task_created_at), reminderHours: r.reminder_hours ?? undefined, callHours: r.call_hours ?? undefined })),
    quotes: quotes.map((r) => ({ id: r.id, status: r.status, sentAt: iso(r.sent_at), optionUntil: r.option_until, lastFollowupAt: iso(r.last_followup_at) })),
    offers: offers.map((r) => ({ id: r.id, optionUntil: r.option_until, selected: !!r.selected, alarmedAt: iso(r.alarmed_at) })),
    unmatchedPayments: payments.map((r) => ({ id: r.id, since: `${r.booked_at}T00:00:00Z`, payerUserId: r.payer_user_id, escalatedAt: iso(r.escalated_at), lastReminderAt: iso(r.last_reminder_at) })),
    projects: projects.map((r) => ({ id: r.id, eventEndedAt: iso(r.event_ended_at), closedAt: iso(r.closed_at), overdueAlertedAt: iso(r.overdue_alerted_at) })),
  };
}

async function task(ctx: Ctx, t: { projectId: string | null; assigneeId: string | null; kind: string; title: string; originKey: string; entityType: string; entityId: string; dueAt?: Date | null }): Promise<void> {
  await ctx.db.query(
    `INSERT INTO tasks (tenant_id, project_id, assignee_id, kind, title, due_at, source, origin_key, entity_type, entity_id)
     VALUES (app_tenant_id(), $1,$2,$3,$4,$5,'ai',$6,$7,$8) ON CONFLICT (tenant_id, origin_key) DO NOTHING`,
    [t.projectId, t.assigneeId, t.kind, t.title, t.dueAt ?? null, t.originKey, t.entityType, t.entityId]);
}

async function execute(ctx: Ctx, a: FollowupAction, now: Date): Promise<string> {
  switch (a.type) {
    case 'supplier_reminder': {
      const r = (await ctx.db.query(
        `SELECT r.*, s.email, s.contact_name, s.name AS supplier_name, p.code, p.owner_id, si.description, u.email AS sender_email, u.full_name AS sender_name
           FROM rfqs r JOIN suppliers s ON s.id = r.supplier_id JOIN projects p ON p.id = r.project_id JOIN service_items si ON si.id = r.service_item_id
           LEFT JOIN users u ON u.id = COALESCE(r.sent_by, p.owner_id) WHERE r.id = $1 FOR UPDATE OF r`, [a.rfqId])).rows[0];
      if (!r) return 'skip';
      await ctx.db.query('UPDATE rfqs SET reminder_sent_at = $2 WHERE id = $1', [a.rfqId, now]);
      if (r.email && r.sender_email) {
        const tpl = (RFQ_REMINDER_TEMPLATE[r.language] ?? RFQ_REMINDER_TEMPLATE.tr)({ contact: r.contact_name ?? r.supplier_name, code: r.code, item: r.description, sender: r.sender_name });
        await ctx.deps.email.send(ctx.db, { tenantId: ctx.tenantId, projectId: r.project_id, from: r.sender_email, to: r.email, subject: tpl.subject, body: tpl.body, autonomous: true });
        await logAiAction(ctx, { actionType: 'supplier_rfq_reminder', projectId: r.project_id, entityType: 'rfq', entityId: r.id, result: { confidence: 1, model: 'template', data: { template: r.language } } });
      }
      return 'supplier_reminder';
    }
    case 'call_task': {
      const r = (await ctx.db.query(`SELECT r.*, s.name AS supplier_name, s.phone, p.code, p.owner_id FROM rfqs r JOIN suppliers s ON s.id = r.supplier_id JOIN projects p ON p.id = r.project_id WHERE r.id = $1`, [a.rfqId])).rows[0];
      if (!r) return 'skip';
      await ctx.db.query('UPDATE rfqs SET call_task_created_at = $2 WHERE id = $1', [a.rfqId, now]);
      await task(ctx, { projectId: r.project_id, assigneeId: r.owner_id ?? r.sent_by, kind: 'call_supplier', title: `${r.code}: ${r.supplier_name} yanıt vermedi — telefonla arayın${r.phone ? ` (${r.phone})` : ''}`, originKey: `rfq:${r.id}:call`, entityType: 'rfq', entityId: r.id, dueAt: now });
      await logAiAction(ctx, { actionType: 'internal_alarm_task', projectId: r.project_id, entityType: 'rfq', entityId: r.id, result: { confidence: 1, model: 'rules', data: { type: 'call_task' } } });
      return 'call_task';
    }
    case 'quote_followup_draft': {
      const q = (await ctx.db.query(
        `SELECT q.*, p.code, p.owner_id, p.customer_id, c.contacts, c.name AS customer_name, c.rules AS crules FROM quotes q JOIN projects p ON p.id = q.project_id
           LEFT JOIN customers c ON c.id = p.customer_id WHERE q.id = $1`, [a.quoteId])).rows[0];
      if (!q) return 'skip';
      await ctx.db.query('UPDATE quotes SET last_followup_at = $2 WHERE id = $1', [a.quoteId, now]);
      const to = (q.contacts ?? []).find((c: { email?: string }) => c.email)?.email ?? null;
      const sender = q.owner_id ? (await ctx.db.query('SELECT full_name FROM users WHERE id = $1', [q.owner_id])).rows[0]?.full_name : undefined;
      const draft = await aiDraft(ctx, {
        kind: 'quote_followup', language: q.crules?.preferredLanguage ?? 'tr', senderName: sender, recipientName: q.customer_name,
        facts: { projectCode: q.code, reason: a.reason, optionUntil: q.option_until, sentAt: q.sent_at },
      }, { projectId: q.project_id, to, status: 'pending_approval', requiresApproval: true, fromUserId: q.owner_id, entityType: 'quote', entityId: q.id });
      // external message → human approval (no counter: not an auto-promotable send)
      await createDecision(ctx, {
        projectId: q.project_id, kind: 'outbound_message', badge: 'suggestion', urgent: a.reason === 'option_expiring',
        summary: `${q.code}: teklif takibi (${a.reason === 'option_expiring' ? 'opsiyon bitiyor' : 'yanıt yok'})`,
        detail: { draftId: draft.id, quoteId: q.id, reason: a.reason, to }, draft: { subject: draft.subject, body: draft.body },
        requiredRole: 'clerk_sales', entityType: 'message_draft', entityId: draft.id, primaryActionLabel: 'Takip mesajını gönder',
      });
      return 'quote_followup_draft';
    }
    case 'option_expiry_alarm': {
      const o = (await ctx.db.query(
        `SELECT o.*, s.name AS supplier_name, s.email, s.contact_name, p.code, p.owner_id FROM supplier_offers o JOIN suppliers s ON s.id = o.supplier_id
           JOIN projects p ON p.id = o.project_id WHERE o.id = $1`, [a.offerId])).rows[0];
      if (!o) return 'skip';
      await ctx.db.query('UPDATE supplier_offers SET alarmed_at = $2 WHERE id = $1', [a.offerId, now]);
      await task(ctx, { projectId: o.project_id, assigneeId: o.owner_id, kind: 'option_expiry', title: `${o.code}: ${o.supplier_name} opsiyonu ${a.optionUntil} tarihinde bitiyor`, originKey: `offer:${o.id}:option`, entityType: 'supplier_offer', entityId: o.id, dueAt: now });
      const draft = await aiDraft(ctx, {
        kind: 'option_extension', language: 'tr', recipientName: o.contact_name ?? o.supplier_name,
        facts: { projectCode: o.code, optionUntil: a.optionUntil },
      }, { projectId: o.project_id, to: o.email, status: 'pending_approval', requiresApproval: true, fromUserId: o.owner_id, entityType: 'supplier_offer', entityId: o.id });
      await aiGate(ctx, 'option_extension_request', {
        projectId: o.project_id, kind: 'outbound_message', badge: 'critical', urgent: true,
        summary: `${o.code}: ${o.supplier_name} opsiyonu ${a.optionUntil} — uzatma talebi`,
        detail: { draftId: draft.id, offerId: o.id, optionUntil: a.optionUntil }, draft: { subject: draft.subject, body: draft.body },
        requiredRole: 'clerk_sales', entityType: 'message_draft', entityId: draft.id, aiActionId: draft.ai_action_id, primaryActionLabel: 'Uzatma talebini gönder',
      });
      return 'option_expiry_alarm';
    }
    case 'unbilled_payment_escalation': {
      await ctx.db.query('UPDATE bank_transactions SET escalated_at = $2 WHERE id = $1', [a.bankTransactionId, now]);
      const t = (await ctx.db.query('SELECT * FROM bank_transactions WHERE id = $1', [a.bankTransactionId])).rows[0];
      await createDecision(ctx, {
        kind: 'unbilled_payment_escalation', badge: 'critical', urgent: true,
        summary: `Fatura edilmemiş ödeme 7 gündür açık: ${t.amount} ${t.currency} — ${t.description}`,
        detail: { bankTransactionId: t.id }, requiredRole: 'admin', entityType: 'bank_transaction', entityId: t.id, primaryActionLabel: 'İncele',
      });
      return 'unbilled_payment_escalation';
    }
    case 'unbilled_payment_daily_reminder': {
      await ctx.db.query('UPDATE bank_transactions SET last_reminder_at = $2 WHERE id = $1', [a.bankTransactionId, now]);
      await task(ctx, { projectId: null, assigneeId: a.userId, kind: 'unbilled_payment', title: 'Bu ödeme nereye fatura edildi?', originKey: `bank:${a.bankTransactionId}:reminder:${now.toISOString().slice(0, 10)}`, entityType: 'bank_transaction', entityId: a.bankTransactionId, dueAt: now });
      return 'unbilled_payment_daily_reminder';
    }
    case 'closing_overdue': {
      await ctx.db.query('UPDATE projects SET overdue_alerted_at = $2 WHERE id = $1', [a.projectId, now]);
      const p = (await ctx.db.query('SELECT code FROM projects WHERE id = $1', [a.projectId])).rows[0];
      await createDecision(ctx, {
        projectId: a.projectId, kind: 'closing_overdue', badge: 'critical', summary: `${p.code}: etkinlik bitiminden 30 gün geçti, finansal kapanış yapılmadı`,
        requiredRole: 'admin', entityType: 'project', entityId: a.projectId, primaryActionLabel: 'Kapanışa git',
      });
      return 'closing_overdue';
    }
  }
}

export async function runFollowupsForTenant(deps: AppDeps, tenantId: string, now: Date): Promise<string[]> {
  return withSystemCtx(deps, tenantId, { type: 'system', id: null }, async (ctx) => {
    const rules = await ctx.rules();
    const done: string[] = await runPreJobs(ctx, now);
    const actions = dueFollowups(await buildState(ctx, now), rules, rules.businessHours);
    for (const a of actions) done.push(await execute(ctx, a, now));
    done.push(...(await runPostJobs(ctx, now, actions)));
    return done;
  });
}

/** One pass over all tenants. */
export async function runFollowupsOnce(deps: AppDeps, now: Date = deps.now()): Promise<Record<string, string[]>> {
  registerAll();
  const tenants = await withoutTenant((db) => db.query<{ app_tenant_ids: string }>('SELECT app_tenant_ids()').then((r) => r.rows.map((x) => x.app_tenant_ids)));
  const out: Record<string, string[]> = {};
  for (const t of tenants) {
    try {
      out[t] = await runFollowupsForTenant(deps, t, now);
    } catch (e) {
      console.error(`[worker] tenant ${t} failed`, e);
      out[t] = [`error:${(e as Error).message}`];
    }
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const config = loadConfig();
  initPool(config.databaseUrl);
  const delivery = loadDeliveryConfig();
  setNotificationService(createNotificationService(delivery));
  const deps: AppDeps = { config, ai: createAiService(process.env), email: createDeliveryProvider(delivery), now: () => new Date(), rng: Math.random };
  const once = process.argv.includes('--once');
  let running: Promise<void> | null = null;
  const tick = () => (running = runFollowupsOnce(deps)
    .then((r) => console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg: 'worker tick', result: r })))
    .catch((e) => console.error(e))
    .finally(() => { running = null; }));
  if (once) tick().finally(() => closePool());
  else {
    tick();
    const timer = setInterval(() => { if (!running) tick(); }, config.workerIntervalMs);
    // graceful shutdown: stop scheduling, let the current pass finish (each tenant is one transaction), close the pool
    const stop = async () => {
      clearInterval(timer);
      const force = setTimeout(() => process.exit(1), Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000));
      force.unref();
      if (running) await running;
      await closePool();
      process.exit(0);
    };
    process.on('SIGINT', () => void stop());
    process.on('SIGTERM', () => void stop());
  }
}
