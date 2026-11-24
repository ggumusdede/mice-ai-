// Optional IMAP polling worker (INBOUND_EMAIL_MODE=imap): `npm run inbound:imap -w apps/api` (`-- --once` for one pass).
// Reads UNSEEN messages of one mailbox (IMAP_*), parses the raw MIME (mailparser), hands each message to the SAME router as
// the webhooks (processInboundEmail — idempotent by Message-ID, so a crash between processing and flagging is harmless),
// then flags \Seen (or moves it to IMAP_PROCESSED_MAILBOX). A message whose processing fails stays UNSEEN and is retried.
// One process per mailbox / tenant; run it as a single instance (no leader lock needed: idempotency covers overlaps).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAiService } from '@mice/ai';
import { loadConfig } from './config.js';
import { closePool, initPool, withoutTenant } from './db/pool.js';
import type { AppDeps } from './context.js';
import { createDeliveryProvider } from './services/delivery.js';
import { loadDeliveryConfig } from './delivery-config.js';
import { loadInboundConfig, type InboundConfig } from './inbound-config.js';
import { registerAll } from './services/registry.js';
import { setNotificationService } from './services/notifications.js';
import { createNotificationService } from './services/push.js';
import { fromMime } from './services/inbound/normalize.js';
import { processInboundEmail } from './services/inbound/email-router.js';

/** The subset of ImapFlow used here (tests inject a fake). */
export interface ImapLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
  search(q: { seen: boolean }, o: { uid: true }): Promise<number[] | false | undefined>;
  fetchOne(uid: string, q: { source: true }, o: { uid: true }): Promise<{ source?: Buffer } | false>;
  messageFlagsAdd(uid: string, flags: string[], o: { uid: true }): Promise<boolean>;
  messageMove(uid: string, dest: string, o: { uid: true }): Promise<unknown>;
}

export async function createImapClient(cfg: InboundConfig['imap']): Promise<ImapLike> {
  if (!cfg.host || !cfg.user || !cfg.pass) throw new Error('IMAP_HOST, IMAP_USER and IMAP_PASS are required for INBOUND_EMAIL_MODE=imap');
  const { ImapFlow } = await import('imapflow');
  return new ImapFlow({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, logger: false }) as unknown as ImapLike;
}

export async function tenantIdForSlug(slug: string): Promise<string> {
  const r = await withoutTenant((db) => db.query('SELECT tenant_id FROM resolve_inbound_channel($1, $2)', ['email', slug]).then((x) => x.rows[0]));
  if (!r) throw new Error(`IMAP_TENANT "${slug}" not found / not active`);
  return r.tenant_id;
}

export interface ImapPollResult { fetched: number; processed: number; duplicates: number; failed: number }

export async function pollImapOnce(deps: AppDeps, cfg: InboundConfig, client: ImapLike, tenantId: string): Promise<ImapPollResult> {
  const out: ImapPollResult = { fetched: 0, processed: 0, duplicates: 0, failed: 0 };
  const lock = await client.getMailboxLock(cfg.imap.mailbox);
  try {
    const uids = ((await client.search({ seen: false }, { uid: true })) || []).slice(0, cfg.imap.maxMessagesPerPoll);
    for (const n of uids) {
      const uid = String(n);
      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      out.fetched += 1;
      if (msg.source.length > cfg.email.maxRequestBytes) {
        await client.messageFlagsAdd(uid, ['\\Seen', '\\Flagged'], { uid: true }); // too large: leave it for a human, flagged
        out.failed += 1;
        continue;
      }
      try {
        const r = await processInboundEmail(deps, tenantId, await fromMime(msg.source), { source: 'imap', cfg: cfg.email });
        if (r.duplicate) out.duplicates += 1;
        else out.processed += 1;
        if (cfg.imap.processedMailbox) await client.messageMove(uid, cfg.imap.processedMailbox, { uid: true });
        else await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      } catch (e) {
        out.failed += 1; // stays UNSEEN → retried next poll (the failure is recorded in inbound_messages)
        console.error(JSON.stringify({ level: 'error', msg: 'imap message failed', uid, error: (e as Error).message }));
      }
    }
  } finally {
    lock.release();
  }
  return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    const inbound = loadInboundConfig();
    if (inbound.email.mode !== 'imap') {
      console.error('INBOUND_EMAIL_MODE is not "imap" — the IMAP poller does not start (webhooks are used).');
      process.exit(1);
    }
    const config = loadConfig();
    initPool(config.databaseUrl);
    registerAll();
    const delivery = loadDeliveryConfig();
    setNotificationService(createNotificationService(delivery));
    const deps: AppDeps = { config, ai: createAiService(process.env), email: createDeliveryProvider(delivery), now: () => new Date(), rng: Math.random };
    const tenantId = await tenantIdForSlug(inbound.imap.tenantSlug);
    const once = process.argv.includes('--once');
    let stopping = false;
    const pass = async () => {
      const client = await createImapClient(inbound.imap);
      await client.connect();
      try {
        const r = await pollImapOnce(deps, inbound, client, tenantId);
        console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg: 'imap poll', result: r }));
      } finally {
        await client.logout().catch(() => {});
      }
    };
    process.on('SIGINT', () => { stopping = true; });
    process.on('SIGTERM', () => { stopping = true; });
    do {
      await pass().catch((e) => console.error(e));
      if (once) break;
      await new Promise((r) => setTimeout(r, inbound.imap.pollIntervalMs));
    } while (!stopping);
    await closePool();
    process.exit(0);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
