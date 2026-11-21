// Inbound e-mail router (§7 Adım 0 talep alımı + Adım 1 "yanıt okuma", docs/07 §6 projeye bağlama sırası).
//
//   1. idempotency — one inbound_messages row per Message-ID (a replay / provider retry is a no-op)
//   2. auto-replies / bounces / our own reply mailbox → stored, ignored
//   3. thread → project, in this order:
//        a. In-Reply-To / References = one of OUR outbox Message-IDs (<outbox-id@domain>) or an earlier inbound message
//        b. plus address in To/Cc: replies+prj-0042@agency → PRJ-0042
//        c. subject tag [PRJ-0042]
//        d. (no thread) sender is a supplier with exactly ONE open RFQ
//   4. linked + sender is that RFQ's supplier → supplier reply: offer reading (attachment PDF/XLSX/CSV/image or the reply
//      text) through the existing parseOffer path → new offer version; low confidence → review card as today
//      linked + sender is the customer → attached; acceptance / revision-like → internal task + owner notification (never
//      an automatic acceptance)
//   5. not linked, not a supplier → new request (runIntake, duplicate check, missing-info draft …)
//   6. not linked supplier mail → stored as 'unlinked' + "bu mail hangi projeye ait?" notification
//
// The mail text is DATA for extraction only. No instruction inside an e-mail is followed.
import type { AppDeps, Ctx } from '../../context.js';
import { withSystemCtx } from '../../context.js';
import { setActor } from '../../db/pool.js';
import type { InboundConfig } from '../../inbound-config.js';
import type { Row } from '../../lib/mappers.js';
import { parseProjectReplyTag } from '../email-smtp.js';
import { runIntake } from '../intake.js';
import { notify } from '../notifications.js';
import { parseOffer } from '../offers.js';
import {
  claimInbound, customerFollowUp, loadResult, recordInboundFailure, reviewTask, updateInbound, type InboundFields, type InboundResult,
} from './common.js';
import { checkAttachments, isAutoReply, stripQuoted, type AttachmentCheck, type NormalizedEmail } from './normalize.js';

type EmailCfg = InboundConfig['email'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'icloud.com', 'yandex.com', 'yandex.com.tr', 'mail.ru', 'proton.me', 'protonmail.com']);

interface ThreadHit { projectId: string; method: 'message_id' | 'plus_address' | 'subject_tag' | 'open_rfq'; outbox?: Row | null; rfqId?: string | null }

/** Process one normalized e-mail for a tenant. Throws only for infrastructure errors (after recording the failure). */
export async function processInboundEmail(deps: AppDeps, tenantId: string, email: NormalizedEmail, opts: { source: string; cfg: EmailCfg }): Promise<InboundResult> {
  const { checks, accepted } = checkAttachments(email.attachments, opts.cfg);
  const fields: InboundFields = {
    channel: 'email', source: opts.source, providerMessageId: email.messageId, fromAddress: email.from.address, senderName: email.from.name,
    toAddresses: email.to, ccAddresses: email.cc, subject: email.subject || null, body: email.text || '(boş ileti)',
    inReplyTo: email.inReplyTo, threadRefs: email.references, receivedAt: deps.now(), attachments: checks,
  };
  try {
    return await withSystemCtx(deps, tenantId, { type: 'system', id: null }, async (ctx) => {
      const claim = await claimInbound(ctx, fields);
      if (claim.duplicate) return loadResult(ctx, claim.id, true);
      await route(ctx, claim.id, email, accepted, checks, opts.cfg);
      return loadResult(ctx, claim.id, false);
    });
  } catch (e) {
    await recordInboundFailure(deps, tenantId, fields, e);
    throw e;
  }
}

async function route(ctx: Ctx, id: string, email: NormalizedEmail, accepted: ReturnType<typeof checkAttachments>['accepted'], checks: AttachmentCheck[], cfg: EmailCfg): Promise<void> {
  const from = email.from.address;
  if (isAutoReply(email) || (cfg.replyAddress && sameMailbox(from, cfg.replyAddress))) {
    const t = await findThread(ctx, email, cfg);
    await updateInbound(ctx, id, { kind: 'auto_reply', status: 'ignored', projectId: t?.projectId ?? null, linkMethod: t?.method ?? 'none', note: 'Otomatik yanıt / geri dönen ileti — işlenmedi' });
    return;
  }
  const suppliers = (await ctx.db.query(`SELECT * FROM suppliers WHERE lower(email) = $1 ORDER BY status = 'passive', created_at`, [from])).rows;
  let thread = await findThread(ctx, email, cfg);
  if (!thread && suppliers.length) {
    const open = (await ctx.db.query(
      `SELECT r.id, r.project_id FROM rfqs r JOIN projects p ON p.id = r.project_id
        WHERE r.supplier_id = ANY($1) AND r.status IN ('sent','responded') AND p.outcome = 'open'`, [suppliers.map((s) => s.id)])).rows;
    if (open.length === 1) thread = { projectId: open[0].project_id, method: 'open_rfq', rfqId: open[0].id };
  }

  if (!thread) {
    if (suppliers.length) {
      await updateInbound(ctx, id, { kind: 'unlinked', status: 'needs_review', supplierId: suppliers[0].id, linkMethod: 'none', note: 'Tedarikçi e-postası projeye bağlanamadı' });
      await notify(ctx, { roles: ['admin', 'clerk_sales'], priority: 'routine', title: `Bu e-posta hangi projeye ait? ${suppliers[0].name}: ${email.subject || '(konusuz)'}`, entityType: 'inbound_message', entityId: id });
      return;
    }
    return newRequest(ctx, id, email);
  }

  const project = (await ctx.db.query('SELECT * FROM projects WHERE id = $1', [thread.projectId])).rows[0];
  await updateInbound(ctx, id, { projectId: project.id, linkMethod: thread.method, outboxId: thread.outbox?.id ?? null });

  // ---- supplier reply
  const supplierIds = suppliers.map((s) => s.id);
  if (supplierIds.length) {
    const rfq = await rfqForReply(ctx, project.id, supplierIds, thread);
    const supplier = suppliers.find((s) => s.id === rfq?.supplier_id) ?? suppliers[0];
    if (rfq === 'ambiguous' || !rfq) {
      const title = rfq === 'ambiguous'
        ? `${project.code}: ${supplier.name} yanıtı birden fazla RFQ ile eşleşti — teklifi ilgili kaleme elle okutun`
        : `${project.code}: ${supplier.name} e-postası (açık RFQ yok) — okuyun`;
      const taskId = await reviewTask(ctx, { projectId: project.id, assigneeId: project.owner_id ?? null, kind: 'inbound_supplier_review', title, inboundId: id });
      await updateInbound(ctx, id, { kind: 'supplier_message', status: 'needs_review', supplierId: supplier.id, taskId, note: title });
      await notify(ctx, { userIds: project.owner_id ? [project.owner_id] : undefined, roles: project.owner_id ? undefined : ['admin'], priority: 'routine', title, projectId: project.id, entityType: 'inbound_message', entityId: id });
      return;
    }
    return supplierReply(ctx, id, email, project, supplier, rfq, accepted, checks);
  }

  // ---- customer (or another participant of the thread)
  const customerId = await customerOf(ctx, project, from, thread);
  if (customerId !== false) {
    const r = await customerFollowUp(ctx, id, project, stripQuoted(email.text), 'e-posta');
    await updateInbound(ctx, id, { kind: r.kind, customerId: customerId || null, taskId: r.taskId, status: 'processed' });
    return;
  }
  const title = `${project.code}: projeye bağlı yeni e-posta (${from})`;
  await notify(ctx, { userIds: project.owner_id ? [project.owner_id] : undefined, roles: project.owner_id ? undefined : ['admin'], priority: 'routine', title, body: email.subject, projectId: project.id, entityType: 'inbound_message', entityId: id });
  await updateInbound(ctx, id, { kind: 'project_reply', status: 'processed' });
}

function sameMailbox(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/\+[^@]*@/, '@');
  return norm(a) === norm(b);
}

async function projectByTag(ctx: Ctx, tag: string): Promise<Row | null> {
  if (!/^[A-Z]+-\d+$/.test(tag)) return null;
  return (await ctx.db.query(`SELECT id FROM projects WHERE upper(code) = $1 OR upper(code) LIKE $1 || '-%' ORDER BY created_at LIMIT 1`, [tag])).rows[0] ?? null;
}

/** 3a–3c of the header comment. */
export async function findThread(ctx: Ctx, email: NormalizedEmail, cfg: Pick<EmailCfg, 'messageIdDomain'>): Promise<ThreadHit | null> {
  // newest reference first (In-Reply-To, then References from the end)
  const refs = [...new Set([email.inReplyTo, ...[...email.references].reverse()].filter((x): x is string => !!x))].slice(0, 50);
  if (refs.length) {
    const uuids = refs.map((r) => /^<([^@>]+)@([^>]+)>$/.exec(r)).filter((m): m is RegExpExecArray => !!m && UUID_RE.test(m[1]) && m[2].toLowerCase() === cfg.messageIdDomain).map((m) => m[1]);
    const rows = (await ctx.db.query(
      `SELECT o.*, COALESCE(o.project_id, d.project_id) AS thread_project_id, d.kind AS draft_kind
         FROM outbox o LEFT JOIN message_drafts d ON d.id = o.draft_id
        WHERE o.message_id = ANY($1::text[]) OR o.id = ANY($2::uuid[])`, [refs, uuids])).rows;
    for (const ref of refs) {
      const hit = rows.find((r) => r.message_id === ref || `<${r.id}@${cfg.messageIdDomain}>` === ref.toLowerCase());
      if (hit?.thread_project_id) return { projectId: hit.thread_project_id, method: 'message_id', outbox: hit };
    }
    const prev = (await ctx.db.query(
      `SELECT project_id, provider_message_id FROM inbound_messages WHERE channel = 'email' AND provider_message_id = ANY($1::text[]) AND project_id IS NOT NULL`, [refs])).rows;
    for (const ref of refs) {
      const hit = prev.find((r) => r.provider_message_id === ref);
      if (hit) return { projectId: hit.project_id, method: 'message_id', outbox: null };
    }
  }
  for (const addr of [...email.to, ...email.cc]) {
    const tag = parseProjectReplyTag(addr);
    const p = tag ? await projectByTag(ctx, tag) : null;
    if (p) return { projectId: p.id, method: 'plus_address' };
  }
  const m = /\[?\b(PRJ-\d{3,6})\b/i.exec(email.subject);
  if (m) {
    const p = await projectByTag(ctx, m[1].toUpperCase());
    if (p) return { projectId: p.id, method: 'subject_tag' };
  }
  return null;
}

async function rfqForReply(ctx: Ctx, projectId: string, supplierIds: string[], thread: ThreadHit): Promise<Row | 'ambiguous' | null> {
  const byId = async (id: string) => (await ctx.db.query(`SELECT * FROM rfqs WHERE id = $1 AND status IN ('sent','responded')`, [id])).rows[0] ?? null;
  if (thread.rfqId) return byId(thread.rfqId);
  if (thread.outbox?.draft_id) {
    const r = (await ctx.db.query(`SELECT * FROM rfqs WHERE draft_id = $1 AND status IN ('sent','responded') AND supplier_id = ANY($2)`, [thread.outbox.draft_id, supplierIds])).rows[0];
    if (r) return r;
  }
  const rows = (await ctx.db.query(
    `SELECT * FROM rfqs WHERE project_id = $1 AND supplier_id = ANY($2) AND status IN ('sent','responded') ORDER BY sent_at DESC NULLS LAST`, [projectId, supplierIds])).rows;
  if (rows.length > 1) return 'ambiguous';
  return rows[0] ?? null;
}

const OFFER_KINDS = new Set(['pdf', 'xlsx', 'csv', 'image', 'text']);

async function supplierReply(ctx: Ctx, id: string, email: NormalizedEmail, project: Row, supplier: Row, rfq: Row,
  accepted: ReturnType<typeof checkAttachments>['accepted'], checks: AttachmentCheck[]): Promise<void> {
  const file = accepted.find((a) => OFFER_KINDS.has(a.kind) && a.kind !== 'text') ?? accepted.find((a) => a.kind === 'text');
  const text = stripQuoted(email.text);
  let offerId: string | null = null;
  let note: string | null = null;
  await ctx.db.query('SAVEPOINT inbound_offer');
  try {
    // the supplier is the author of this reading (audit), exactly like the public RFQ link
    await setActor(ctx.db, { type: 'supplier', id: supplier.id });
    const offer = await parseOffer(ctx, rfq.service_item_id, {
      text: text || undefined, file: file ? { filename: file.filename, mimetype: file.contentType, buffer: file.content } : undefined,
      supplierId: supplier.id, rfqId: rfq.id, viaPublicLink: true,
    });
    offerId = offer.id;
    await ctx.db.query('RELEASE SAVEPOINT inbound_offer');
  } catch (e) {
    await ctx.db.query('ROLLBACK TO SAVEPOINT inbound_offer');
    note = `Teklif okunamadı: ${(e as Error).message}`.slice(0, 500);
  } finally {
    await setActor(ctx.db, { type: 'system', id: null });
  }
  if (file) {
    const used = checks.find((c) => c.accepted && c.filename === file.filename);
    if (used) {
      (used as AttachmentCheck & { usedFor?: string }).usedFor = offerId ? 'offer' : 'offer_failed';
      await ctx.db.query('UPDATE inbound_messages SET attachments = $2 WHERE id = $1', [id, JSON.stringify(checks)]);
    }
  }
  const owner = project.owner_id ? [project.owner_id] : undefined;
  if (offerId) {
    const v = (await ctx.db.query('SELECT version, confidence FROM supplier_offers WHERE id = $1', [offerId])).rows[0];
    await notify(ctx, { userIds: owner, roles: owner ? undefined : ['admin'], priority: 'routine', title: `${project.code}: ${supplier.name} e-postayla yanıtladı — teklif v${v.version} okundu`, projectId: project.id, entityType: 'supplier_offer', entityId: offerId });
    await updateInbound(ctx, id, { kind: 'supplier_reply', status: 'processed', supplierId: supplier.id, rfqId: rfq.id, offerId });
  } else {
    const title = `${project.code}: ${supplier.name} yanıtı okunamadı — elle girin`;
    const taskId = await reviewTask(ctx, { projectId: project.id, assigneeId: project.owner_id ?? null, kind: 'inbound_supplier_review', title, inboundId: id });
    await updateInbound(ctx, id, { kind: 'supplier_reply', status: 'needs_review', supplierId: supplier.id, rfqId: rfq.id, taskId, note });
  }
}

/** customer id ('' when the sender is a participant we wrote to but not a stored contact); false when not the customer side. */
async function customerOf(ctx: Ctx, project: Row, from: string, thread: ThreadHit): Promise<string | false> {
  if (project.customer_id) {
    const c = (await ctx.db.query('SELECT id, contacts FROM customers WHERE id = $1', [project.customer_id])).rows[0];
    const contacts = ((c?.contacts ?? []) as { email?: string }[]).map((x) => x.email?.toLowerCase()).filter((x): x is string => !!x);
    if (contacts.includes(from)) return c.id;
    const dom = from.split('@')[1];
    if (dom && !PUBLIC_DOMAINS.has(dom) && contacts.some((x) => x.split('@')[1] === dom)) return c.id;
  }
  if (thread.outbox && String(thread.outbox.to_address).toLowerCase() === from && thread.outbox.draft_kind !== 'rfq') return project.customer_id ?? '';
  const known = (await ctx.db.query(
    `SELECT 1 FROM inbound_messages WHERE project_id = $1 AND lower(from_address) = $2 AND (kind IS NULL OR kind IN ('new_request','customer_reply','customer_revision','customer_acceptance'))
     UNION ALL SELECT 1 FROM outbox o LEFT JOIN message_drafts d ON d.id = o.draft_id
      WHERE COALESCE(o.project_id, d.project_id) = $1 AND lower(o.to_address) = $2 AND COALESCE(d.kind, '') <> 'rfq' LIMIT 1`, [project.id, from])).rows[0];
  return known ? project.customer_id ?? '' : false;
}

async function newRequest(ctx: Ctx, id: string, email: NormalizedEmail): Promise<void> {
  const customer = (await ctx.db.query(
    `SELECT id FROM customers c WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(c.contacts) x WHERE lower(x->>'email') = $1) LIMIT 1`, [email.from.address])).rows[0];
  const r = await runIntake(ctx, {
    channel: 'email', body: email.text || email.subject || '(boş ileti)', subject: email.subject || undefined, fromAddress: email.from.address,
    customerId: customer?.id, receivedAt: ctx.now().toISOString(),
  }, { inboundId: id, createdBy: null });
  await updateInbound(ctx, id, { kind: 'new_request', status: 'processed', intakeProjectId: r.project.id, projectId: r.project.id, linkMethod: 'new_intake', customerId: customer?.id ?? null });
  const dup = r.duplicates.length ? ` — olası mükerrer: ${r.duplicates.map((d) => d.code).join(', ')}` : '';
  await notify(ctx, {
    roles: ['admin'], priority: r.duplicates.length ? 'critical' : 'routine', title: `Yeni e-posta talebi: ${r.project.code}${dup}`,
    body: email.subject, projectId: r.project.id, entityType: 'inbound_message', entityId: id,
  });
}
