// Production delivery channels: SMTP e-mail provider (mocked nodemailer transport), channel routing, outbox retry by the
// worker, Web Push subscriptions + critical / digest delivery (mocked web-push), health / readiness, log redaction.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REQUEST_TEXT, client, clock, closeApp, login, newTenant, ownerSql, resetClock, type Client } from './helpers.js';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server.js';
import { loadDeliveryConfig } from '../src/delivery-config.js';
import { ChannelRouter, createDeliveryProvider, runOutboxJobs } from '../src/services/delivery.js';
import { buildMail, isPermanentSmtpError, parseProjectReplyTag, projectReplyAddress, retryDelayMs, SmtpEmailProvider, type MailOptions, type MailTransport } from '../src/services/email-smtp.js';
import { OutboxEmailProvider } from '../src/services/email.js';
import { normalizeMsisdn, whatsappTemplatePayload, WhatsAppCloudProvider } from '../src/services/messaging.js';
import { createNotificationService, isAllowedPushEndpoint, pushPayload, WebPushNotificationService, type PushSender, type PushSendOptions, type PushSubscriptionKeys } from '../src/services/push.js';
import { ConsoleNotificationService, flushNotificationDigests, notify, setNotificationService } from '../src/services/notifications.js';
import { withSystemCtx, type Ctx } from '../src/context.js';
import { redactUrl, trustProxyOption } from '../src/logger.js';
import { GmailApiProvider } from '../src/services/email-oauth.js';

// ---------------------------------------------------------------- mocks
class MockTransport implements MailTransport {
  sent: MailOptions[] = [];
  failWith: unknown[] = [];
  async sendMail(mail: MailOptions) {
    const err = this.failWith.shift();
    if (err) throw err;
    this.sent.push(mail);
    return { messageId: mail.messageId, response: '250 OK' };
  }
}
class MockPush implements PushSender {
  calls: { sub: PushSubscriptionKeys; payload: any; opts: PushSendOptions }[] = [];
  statusFor = new Map<string, number>();
  async send(sub: PushSubscriptionKeys, payload: string, opts: PushSendOptions) {
    const status = this.statusFor.get(sub.endpoint);
    if (status) throw Object.assign(new Error(`push ${status}`), { statusCode: status });
    this.calls.push({ sub, payload: JSON.parse(payload), opts });
    return { statusCode: 201 };
  }
}

const VAPID = { VAPID_PUBLIC_KEY: 'BAlfnGtnBKcC5J_c56TsVAkgQVvfLJpMAsiMnOoolBY3JyRf-nJGCIz9FvJEndQQ0fcLsS_Jf0jzIAdx1xatbDA', VAPID_PRIVATE_KEY: 't2eujzhJitxfgZxpaOW9jb4ahB5PmiTIwVAWA-rUrx0', VAPID_SUBJECT: 'mailto:ops@test.example' };
const SMTP_ENV = { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.test', EMAIL_REPLY_ADDRESS: 'replies@agency.test', GUEST_DATA_KEY: 'test-guest-key' };
const sub = (id: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } });

// ---------------------------------------------------------------- pure
describe('delivery config & pure helpers', () => {
  it('selects the e-mail provider by EMAIL_PROVIDER (outbox default, smtp needs SMTP_HOST)', () => {
    expect(loadDeliveryConfig({}).email.provider).toBe('outbox');
    expect(createDeliveryProvider(loadDeliveryConfig({})).email).toBeInstanceOf(OutboxEmailProvider);
    expect(() => loadDeliveryConfig({ EMAIL_PROVIDER: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(() => loadDeliveryConfig({ EMAIL_PROVIDER: 'sendgrid' })).toThrow(/EMAIL_PROVIDER/);
    const cfg = loadDeliveryConfig({ ...SMTP_ENV, SMTP_PORT: '465' });
    expect(cfg.email.smtp).toMatchObject({ host: 'smtp.test', port: 465, secure: true });
    expect(cfg.email.messageIdDomain).toBe('agency.test');
    const router = createDeliveryProvider(cfg, { transport: new MockTransport() });
    expect(router).toBeInstanceOf(ChannelRouter);
    expect(router.name).toBe('smtp');
    expect(router.email).toBeInstanceOf(SmtpEmailProvider);
    expect(router.messaging.name).toBe('outbox');
    expect(loadDeliveryConfig({}).push.vapid).toBeNull();
    expect(createNotificationService(loadDeliveryConfig({}))).toBeInstanceOf(ConsoleNotificationService);
    expect(createNotificationService(loadDeliveryConfig(VAPID))).toBeInstanceOf(WebPushNotificationService);
  });

  it('builds From = user, plus-addressed Reply-To, Message-ID and thread headers', () => {
    const m = buildMail({
      outboxId: 'abc', from: 'clerk@agency.test', to: 'otel@example.com', subject: 'RFQ', body: 'x', projectCode: 'PRJ-0042-ANADOLU-0312-SK-MODA',
      replyAddress: 'replies@agency.test', messageIdDomain: 'agency.test', previousMessageId: '<prev@agency.test>', envelopeFrom: 'bounce@agency.test', autonomous: true,
    });
    expect(m.from).toBe('clerk@agency.test');
    expect(m.replyTo).toEqual(['replies+prj-0042@agency.test', 'clerk@agency.test']);
    expect(m.messageId).toBe('<abc@agency.test>');
    expect(m.inReplyTo).toBe('<prev@agency.test>');
    expect(m.references).toEqual(['<prev@agency.test>']);
    expect(m.headers).toMatchObject({ 'X-MICE-Project': 'PRJ-0042', // short ref: the full code (customer name) never leaves in a header
       'X-MICE-Outbox-Id': 'abc', 'Auto-Submitted': 'auto-generated' });
    expect(m.envelope).toEqual({ from: 'bounce@agency.test', to: 'otel@example.com' });
    const plain = buildMail({ outboxId: 'b', from: 'a@x.test', to: 'b@y.test', subject: null, body: 'x', messageIdDomain: 'x.test' });
    expect(plain.replyTo).toBeUndefined();
    expect(plain.inReplyTo).toBeUndefined();
    expect(plain.headers['Auto-Submitted']).toBeUndefined();
    expect(projectReplyAddress('ops+old@agency.test', 'PRJ-0007-X')).toBe('ops+prj-0007@agency.test');
    expect(parseProjectReplyTag('Replies+prj-0042@agency.test')).toBe('PRJ-0042');
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(30)).toBe(6 * 3_600_000);
    expect(isPermanentSmtpError({ responseCode: 550 })).toBe(true);
    expect(isPermanentSmtpError({ responseCode: 421 })).toBe(false);
    expect(isPermanentSmtpError(new Error('ECONNRESET'))).toBe(false);
  });

  it('messaging: E.164 normalisation and WhatsApp template payload', async () => {
    expect(normalizeMsisdn('0532 123 45 67')).toBe('+905321234567');
    expect(normalizeMsisdn('5321234567')).toBe('+905321234567');
    expect(normalizeMsisdn('+49 151 2345678')).toBe('+491512345678');
    expect(normalizeMsisdn('abc')).toBeNull();
    const p = whatsappTemplatePayload('0532 123 45 67', { name: 'field_extra_approval', language: 'tr', params: ['Selin', 'PRJ-0042', '6.000 TL'], buttonUrlSuffix: 'tok' });
    expect(p).toMatchObject({ messaging_product: 'whatsapp', to: '905321234567', type: 'template', template: { name: 'field_extra_approval', language: { code: 'tr' } } });
    expect((p.template as any).components).toHaveLength(2);
    const wa = new WhatsAppCloudProvider({ phoneNumberId: '123', token: null, apiVersion: 'v21.0' });
    expect(wa.buildRequest({ tenantId: 't', channel: 'whatsapp', from: 'a', to: '+905321234567', body: '', template: { name: 'x', language: 'tr', params: [] } }).url).toBe('https://graph.facebook.com/v21.0/123/messages');
    // live implementation (integrations-*.test.ts); without a token it refuses instead of calling Meta
    await expect(wa.send(null as never, { tenantId: 't', channel: 'whatsapp', from: 'a', to: 'b', body: '' })).rejects.toThrow(/not configured/);
    expect(new GmailApiProvider().name).toBe('gmail_api');
  });

  it('push endpoint SSRF guard, payload, URL redaction, trust proxy', () => {
    const hosts = loadDeliveryConfig({}).push.allowedHosts;
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x', hosts)).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QG…', hosts)).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x', hosts)).toBe(true);
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x', hosts)).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/latest', hosts)).toBe(false);
    expect(isAllowedPushEndpoint('https://evilfcm.googleapis.com.attacker.test/x', hosts)).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x', hosts)).toBe(false);
    expect(JSON.parse(pushPayload({ tenantId: 't', userId: 'u', title: 'PRJ-1 ödeme', body: '5.000 EUR', priority: 'critical' }, true))).toMatchObject({ title: 'MICE OS', url: '/' });
    expect(redactUrl('/api/public/rfq/abcdefghijklmnopqrstuvwxyz/files?x=1')).toBe('/api/public/rfq/[token]/files');
    expect(redactUrl('/s/rfq/abcdefghijklmnop')).toBe('/s/rfq/[token]');
    expect(redactUrl('/api/projects/123?q=Anadolu')).toBe('/api/projects/123');
    expect(trustProxyOption(undefined)).toBe(false);
    expect(trustProxyOption('1')).toBe(true);
    expect(trustProxyOption('10.0.0.0/8, 172.16.0.0/12')).toEqual(['10.0.0.0/8', '172.16.0.0/12']);
  });
});

// ---------------------------------------------------------------- integration
let app: FastifyInstance;
let t: Awaited<ReturnType<typeof newTenant>>;
let admin: Client, clerk: Client;
let projectId: string, projectCode: string;
const transport = new MockTransport();
const push = new MockPush();
const savedEnv = { ...process.env };

beforeAll(async () => {
  Object.assign(process.env, VAPID);
  resetClock();
  const cfg = loadDeliveryConfig({ ...SMTP_ENV, ...VAPID });
  app = await buildApp({
    email: createDeliveryProvider(cfg, { transport, now: () => clock.now, log: false }),
    notifications: createNotificationService(cfg, push),
    now: () => clock.now,
    logger: false,
  });
  t = await newTenant('delivery');
  admin = client(app, await login(app, t.users.admin.email));
  clerk = client(app, await login(app, t.users.clerk.email));
  const intake = await clerk.post('/api/intake', { channel: 'email', body: REQUEST_TEXT, fromAddress: 'musteri@example.com', customerId: t.customers.new });
  expect(intake.status).toBe(200);
  projectId = intake.body.project.id;
  projectCode = intake.body.project.code;
});
afterAll(async () => {
  setNotificationService(new ConsoleNotificationService());
  process.env = savedEnv;
  await closeApp({ app, email: null as never });
});

const sys = <T>(fn: (ctx: Ctx) => Promise<T>) => withSystemCtx<T>(app.deps, t.tenantId, { type: 'system', id: null }, fn);
const outbox = (id: string) => ownerSql(`SELECT o.*, p.body_enc IS NOT NULL AS has_payload, p.purged_at FROM outbox o LEFT JOIN outbox_payloads p ON p.outbox_id = o.id WHERE o.id = $1`, [id]).then((r) => r[0]);

describe('SMTP provider (mocked transport)', () => {
  it('sends from the user, threads per project + recipient, keeps a redacted outbox copy', async () => {
    const from = t.users.clerk.email;
    const a = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, projectId, from, to: 'otel@example.com', subject: 'RFQ 1', body: 'Form: https://x/s/rfq/SECRET-TOKEN-123', secrets: ['SECRET-TOKEN-123'] }));
    const b = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, projectId, from, to: 'otel@example.com', subject: 'Re: RFQ 1', body: 'ikinci' }));
    const [m1, m2] = transport.sent.slice(-2);
    expect(m1.from).toBe(from);
    expect(m1.text).toContain('SECRET-TOKEN-123'); // the recipient gets the real link …
    expect(m1.messageId).toBe(`<${a.id}@agency.test>`);
    expect(m1.replyTo?.[0]).toMatch(/^replies\+prj-\d+@agency\.test$/);
    expect(m1.headers['X-MICE-Project']).toBe(projectCode.split('-').slice(0, 2).join('-'));
    expect(m1.inReplyTo).toBeUndefined();
    expect(m2.inReplyTo).toBe(m1.messageId);
    expect(m2.references).toEqual([m1.messageId]);
    const row = await outbox(a.id);
    expect(row).toMatchObject({ status: 'sent', provider: 'smtp', attempts: 1, project_id: projectId, message_id: m1.messageId, has_payload: false });
    expect(row.body).not.toContain('SECRET-TOKEN-123'); // … the audit copy does not
    expect(row.purged_at).not.toBeNull();
    expect((await outbox(b.id)).in_reply_to).toBe(m1.messageId);
    const audit = await ownerSql(`SELECT count(*)::int AS n FROM audit_log WHERE entity = 'outbox_payloads'`);
    expect(audit[0].n).toBe(0);
  });

  it('records a temporary failure and the worker retries it after the backoff', async () => {
    transport.failWith.push(Object.assign(new Error('421 try later'), { responseCode: 421 }));
    const r = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, projectId, from: t.users.clerk.email, to: 'kalamis@example.com', subject: 'RFQ', body: 'link SECRET-2', secrets: ['SECRET-2'] }));
    let row = await outbox(r.id);
    expect(row).toMatchObject({ status: 'failed', attempts: 1, has_payload: true });
    expect(row.last_error).toContain('421');
    expect(new Date(row.next_attempt_at).getTime()).toBe(clock.now.getTime() + 60_000);
    expect(await sys((ctx) => runOutboxJobs(ctx, clock.now))).toEqual([]); // not due yet
    const later = new Date(clock.now.getTime() + 61_000);
    const before = transport.sent.length;
    expect(await sys((ctx) => runOutboxJobs(ctx, later))).toContain('outbox_sent:1');
    expect(transport.sent.length).toBe(before + 1);
    expect(transport.sent.at(-1)!.text).toBe('link SECRET-2'); // decrypted payload, unredacted
    expect(transport.sent.at(-1)!.messageId).toBe(row.message_id);
    row = await outbox(r.id);
    expect(row).toMatchObject({ status: 'sent', attempts: 2, has_payload: false });
  });

  it('a permanent failure is given up once and the sender + admins are notified', async () => {
    transport.failWith.push(Object.assign(new Error('550 mailbox unavailable'), { responseCode: 550 }));
    const r = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, projectId, from: t.users.clerk.email, to: 'nobody@example.com', subject: 'RFQ', body: 'x' }));
    const row = await outbox(r.id);
    expect(row).toMatchObject({ status: 'failed', attempts: 1, next_attempt_at: null, has_payload: false });
    expect(await sys((ctx) => runOutboxJobs(ctx, clock.now))).toContain('outbox_gave_up:1');
    expect(await sys((ctx) => runOutboxJobs(ctx, clock.now))).toEqual([]); // only once
    const n = await ownerSql(`SELECT user_id, priority FROM notifications WHERE tenant_id = $1 AND entity_type = 'outbox' AND entity_id = $2`, [t.tenantId, r.id]);
    expect(n.map((x) => x.user_id).sort()).toEqual([t.users.admin.id, t.users.clerk.id].sort());
    expect(n.every((x) => x.priority === 'critical')).toBe(true);
  });

  it('queue mode only enqueues; the worker delivers', async () => {
    const tr = new MockTransport();
    const p = createDeliveryProvider(loadDeliveryConfig({ ...SMTP_ENV, EMAIL_SEND_MODE: 'queue' }), { transport: tr, now: () => clock.now, log: false });
    const deps = { ...app.deps, email: p };
    const r = await withSystemCtx(deps, t.tenantId, { type: 'system', id: null }, (ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, from: t.users.clerk.email, to: 'q@example.com', subject: 's', body: 'b' }));
    expect(tr.sent).toHaveLength(0);
    expect((await outbox(r.id)).status).toBe('queued');
    await withSystemCtx(deps, t.tenantId, { type: 'system', id: null }, (ctx) => runOutboxJobs(ctx, clock.now));
    expect(tr.sent).toHaveLength(1);
    expect((await outbox(r.id)).status).toBe('sent');
  });

  it('routes sms / whatsapp to the messaging outbox, not SMTP', async () => {
    const before = transport.sent.length;
    const r = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, channel: 'sms', from: t.users.field.email, to: '+905321234567', subject: null, body: 'Onay: https://x/e/TOK-XYZ', secrets: ['TOK-XYZ'] }));
    expect(transport.sent.length).toBe(before);
    const row = await outbox(r.id);
    expect(row).toMatchObject({ channel: 'sms', provider: 'outbox', status: 'sent' });
    expect(row.body).not.toContain('TOK-XYZ');
  });
});

describe('Web Push (mocked web-push)', () => {
  it('exposes the VAPID public key and validates subscriptions', async () => {
    const k = await clerk.get('/api/push/vapid-public-key');
    expect(k.body).toEqual({ enabled: true, publicKey: VAPID.VAPID_PUBLIC_KEY });
    expect((await client(app).get('/api/push/vapid-public-key')).status).toBe(401);
    const bad = await admin.post('/api/push/subscribe', { subscription: { ...sub('x'), endpoint: 'https://169.254.169.254/latest/meta-data' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('PUSH_ENDPOINT_NOT_ALLOWED');
    expect((await admin.post('/api/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'not base64!', auth: 'x' } } })).status).toBe(400);
  });

  it('subscribe upserts per endpoint; unsubscribe marks inactive (no DELETE)', async () => {
    const s1 = await admin.post('/api/push/subscribe', { subscription: sub('admin-phone'), userAgent: 'iPhone PWA' });
    expect(s1.status).toBe(200);
    const again = await admin.post('/api/push/subscribe', { subscription: sub('admin-phone') });
    expect(again.body.id).toBe(s1.body.id);
    const shared = await clerk.post('/api/push/subscribe', { subscription: sub('shared-tablet') });
    const moved = await admin.post('/api/push/subscribe', { subscription: sub('shared-tablet') }); // same device, other user
    expect(moved.body.id).toBe(shared.body.id);
    let rows = await ownerSql(`SELECT user_id, active FROM push_subscriptions WHERE id = $1`, [shared.body.id]);
    expect(rows[0]).toMatchObject({ user_id: t.users.admin.id, active: true });
    expect((await clerk.post('/api/push/unsubscribe', { endpoint: sub('shared-tablet').endpoint })).body.deactivated).toBe(0); // not clerk's anymore
    expect((await admin.post('/api/push/unsubscribe', { endpoint: sub('shared-tablet').endpoint })).body).toEqual({ ok: true, deactivated: 1 });
    rows = await ownerSql(`SELECT active, deactivated_reason, deactivated_at FROM push_subscriptions WHERE id = $1`, [shared.body.id]);
    expect(rows[0]).toMatchObject({ active: false, deactivated_reason: 'user' });
    expect(rows[0].deactivated_at).not.toBeNull();
    const del = await app.inject({ method: 'DELETE', url: '/api/push/subscribe' });
    expect(del.statusCode).toBe(404);
    // the app role cannot delete rows (immutable records)
    await expect(ownerSql(`SET ROLE mice_app; DELETE FROM push_subscriptions WHERE id = '${shared.body.id}'`)).rejects.toThrow();
  });

  it('critical notifications are pushed immediately, routine ones only in the digest', async () => {
    push.calls = [];
    await sys((ctx) => notify(ctx, { userIds: [t.users.admin.id], priority: 'critical', title: 'Ödeme onayı bekliyor', body: '5.000 EUR', entityType: 'decision' }));
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0].sub.endpoint).toBe(sub('admin-phone').endpoint); // the inactive tablet is skipped
    expect(push.calls[0].payload).toMatchObject({ title: 'Ödeme onayı bekliyor', body: '5.000 EUR', url: '/', priority: 'critical' });
    expect(push.calls[0].opts).toMatchObject({ urgency: 'high', vapidDetails: { publicKey: VAPID.VAPID_PUBLIC_KEY, subject: VAPID.VAPID_SUBJECT } });

    push.calls = [];
    await sys((ctx) => notify(ctx, { userIds: [t.users.admin.id], priority: 'routine', title: 'Rutin 1' }));
    await sys((ctx) => notify(ctx, { userIds: [t.users.admin.id], priority: 'routine', title: 'Rutin 2' }));
    expect(push.calls).toHaveLength(0);
    expect(await sys((ctx) => flushNotificationDigests(ctx, clock.now))).toBe(0); // 10:00 local: slot not reached
    const slot = new Date('2026-11-20T15:00:00Z'); // 18:00 Istanbul
    expect(await sys((ctx) => flushNotificationDigests(ctx, slot))).toBe(1);
    expect(push.calls).toHaveLength(1);
    expect(push.calls[0].payload.title).toMatch(/rutin bildirim/);
    expect(push.calls[0].payload.body).toContain('Rutin 1');
    expect(push.calls[0].payload.body).toContain('Rutin 2');
    expect(push.calls[0].opts).toMatchObject({ urgency: 'normal', topic: 'mice-digest' });
  });

  it('410 Gone from the push service deactivates the subscription without breaking the transaction', async () => {
    push.statusFor.set(sub('admin-phone').endpoint, 410);
    const n = await sys(async (ctx) => {
      const sent = await notify(ctx, { userIds: [t.users.admin.id], priority: 'critical', title: 'X' });
      // the transaction is still usable after the failed push
      return { sent, ok: (await ctx.db.query('SELECT 1 AS ok')).rows[0].ok };
    });
    expect(n).toEqual({ sent: 1, ok: 1 });
    const rows = await ownerSql(`SELECT active, deactivated_reason, failure_count FROM push_subscriptions WHERE endpoint = $1`, [sub('admin-phone').endpoint]);
    expect(rows[0]).toMatchObject({ active: false, deactivated_reason: 'expired', failure_count: 1 });
    push.statusFor.clear();
  });
});

describe('health / readiness', () => {
  it('GET /api/health reports db status; GET /api/ready checks migrations', async () => {
    const h = await app.inject({ method: 'GET', url: '/api/health' });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toMatchObject({ ok: true, status: 'ok', db: 'up' });
    const r = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ready: true, db: 'up', pendingMigrations: [] });
  });
});
