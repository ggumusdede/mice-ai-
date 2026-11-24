// WhatsApp Cloud API + TR SMS gateway sending and the §15 critical-push fallback. ALL HTTP is mocked (setIntegrationFetch).
// Field-extra approval: WhatsApp template with quick-reply payload `extra_approve:<token>` (the inbound handler's format),
// signature-less outbound (Bearer only), delivery receipts from the status webhook, permanent WhatsApp failure → SMS,
// 24 h window → session text / interactive button; SMS request shape + error handling; fallback timing / idempotency / ack.
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, clock, closeApp, login, newTenant, ownerSql, resetClock, type Client } from './helpers.js';
import { signedProject } from './phase-b-helpers.js';
import { buildApp } from '../src/server.js';
import { loadDeliveryConfig, type SmsConfig } from '../src/delivery-config.js';
import { ChannelRouter, createDeliveryProvider, runOutboxJobs } from '../src/services/delivery.js';
import { HttpSmsProvider, LiveMessagingProvider, smsRequest, whatsappTemplatePayload } from '../src/services/messaging.js';
import { setIntegrationFetch, type FetchLike, HttpError } from '../src/services/integrations-http.js';
import { runCriticalPushFallback } from '../src/services/critical-fallback.js';
import { ConsoleNotificationService, notify, setNotificationService } from '../src/services/notifications.js';
import { withSystemCtx, type Ctx } from '../src/context.js';

const PNID = `pnid-out-${Date.now()}`;
const WA_SECRET = 'test-meta-app-secret-out';
const SMS_URL = 'https://sms.gateway.test/sms/rest/v2/send';
const ENV = {
  MESSAGING_PROVIDER: 'whatsapp_cloud', WHATSAPP_TOKEN: 'wa-system-user-token', WHATSAPP_PHONE_NUMBER_ID: PNID, WHATSAPP_API_VERSION: 'v21.0',
  WHATSAPP_APP_SECRET: WA_SECRET, SMS_PROVIDER: 'http', SMS_API_URL: SMS_URL, SMS_API_USER: 'acente', SMS_API_PASSWORD: 'sms-pass', SMS_SENDER: 'ACENTA',
};
const WA_URL = `https://graph.facebook.com/v21.0/${PNID}/messages`;

interface Call { url: string; headers: Record<string, string>; body: any }
const calls: Call[] = [];
let waQueue: { status: number; body: unknown }[] = [];
let smsQueue: { status: number; text: string }[] = [];
let seq = 0;
const mockFetch: FetchLike = async (url, init) => {
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  calls.push({ url, headers: init.headers, body });
  if (url === WA_URL) {
    const r = waQueue.shift() ?? { status: 200, body: { messaging_product: 'whatsapp', contacts: [{ wa_id: body.to }], messages: [{ id: `wamid.OUT${++seq}` }] } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }
  if (url === SMS_URL) {
    const r = smsQueue.shift() ?? { status: 200, text: JSON.stringify({ code: '00', jobid: `job-${++seq}`, description: 'queued' }) };
    return new Response(r.text, { status: r.status });
  }
  return new Response('unmocked', { status: 599 });
};

let app: FastifyInstance;
let t: Awaited<ReturnType<typeof newTenant>>;
let admin: Client;
let field: Client;
let sp: Awaited<ReturnType<typeof signedProject>>;
const pushes = new ConsoleNotificationService();
const saved = { ...process.env };

beforeAll(async () => {
  resetClock();
  Object.assign(process.env, ENV);
  setIntegrationFetch(mockFetch);
  app = await buildApp({ email: createDeliveryProvider(loadDeliveryConfig({ ...process.env }), { now: () => clock.now }), now: () => clock.now, logger: false, notifications: pushes });
  t = await newTenant('wa-out');
  admin = client(app, await login(app, t.users.admin.email));
  field = client(app, await login(app, t.users.field.email));
  sp = await signedProject(app, admin, t);
  expect((await admin.post('/api/inbound-channels', { channel: 'whatsapp', routeKey: PNID })).status).toBe(200);
});
afterAll(async () => {
  setIntegrationFetch(null);
  setNotificationService(new ConsoleNotificationService());
  process.env = saved;
  await closeApp({ app, email: null as never });
});

const sys = <T>(fn: (ctx: Ctx) => Promise<T>) => withSystemCtx<T>(app.deps, t.tenantId, { type: 'system', id: null }, fn);
const waCalls = () => calls.filter((c) => c.url === WA_URL);
const smsCalls = () => calls.filter((c) => c.url === SMS_URL);
const statusHook = (statuses: unknown[]) => {
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PNID }, statuses } }] }] });
  return app.inject({ method: 'POST', url: '/api/inbound/whatsapp', payload: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', WA_SECRET).update(raw).digest('hex')}` } });
};

describe('pure payloads', () => {
  it('template with quick-reply + URL buttons; SMS request shape (Basic auth, msgheader, 90-prefixed number)', () => {
    const p = whatsappTemplatePayload('0532 123 45 67', { name: 'field_extra_approval', language: 'tr', params: ['A', 'B'], buttons: [{ type: 'quick_reply', payload: 'extra_approve:tok' }, { type: 'url', text: 'tok' }] });
    expect((p.template as any).components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] },
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'extra_approve:tok' }] },
      { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'tok' }] },
    ]);
    const cfg = loadDeliveryConfig(ENV).messaging.sms!;
    const r = smsRequest(cfg, '0532 123 45 67', 'Merhaba');
    expect(r.url).toBe(SMS_URL);
    expect(r.headers.Authorization).toBe(`Basic ${Buffer.from('acente:sms-pass').toString('base64')}`);
    expect(r.body).toEqual({ msgheader: 'ACENTA', encoding: 'TR', iysfilter: '0', messages: [{ msg: 'Merhaba', no: '905321234567' }] });
    expect(() => loadDeliveryConfig({ SMS_PROVIDER: 'http' })).toThrow(/SMS_API_URL/);
    expect(() => loadDeliveryConfig({ SMS_PROVIDER: 'netgsm' })).toThrow(/SMS_PROVIDER/);
  });

  it('SMS gateway responses: 00 → job id, plain-text legacy, permanent codes, retryable codes / HTTP errors', async () => {
    const sms = new HttpSmsProvider(loadDeliveryConfig(ENV).messaging.sms as SmsConfig);
    smsQueue = [{ status: 200, text: JSON.stringify({ code: '00', jobid: '17377215342605050417149344' }) }];
    expect(await sms.deliver('+905321234567', 'x')).toEqual({ messageId: '17377215342605050417149344' });
    smsQueue = [{ status: 200, text: '00 123456789' }];
    expect((await sms.deliver('+905321234567', 'x')).messageId).toBe('123456789');
    const fail = async (r: { status: number; text: string }) => {
      smsQueue = [r];
      return sms.deliver('+905321234567', 'x').then(() => null, (e: HttpError) => e);
    };
    expect(await fail({ status: 200, text: JSON.stringify({ code: '30' }) })).toMatchObject({ retryable: false, code: '30' });
    expect(await fail({ status: 200, text: JSON.stringify({ code: '40' }) })).toMatchObject({ retryable: false });
    expect(await fail({ status: 200, text: JSON.stringify({ code: '80' }) })).toMatchObject({ retryable: true });
    expect(await fail({ status: 503, text: 'down' })).toMatchObject({ retryable: true, status: 503 });
    expect(await fail({ status: 401, text: 'no' })).toMatchObject({ retryable: false });
  });
});

describe('live WhatsApp / SMS delivery', () => {
  it('field extra → WhatsApp template, quick-reply payload extra_approve:<token>, Bearer only, token redacted in the outbox', async () => {
    const ex = await field.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'Ek coffee break', amountTry: 3000, customerPhone: '0532 111 22 33' });
    expect(ex.status).toBe(200);
    const token = ex.body.approvalLink.split('/e/')[1];
    const call = waCalls().at(-1)!;
    expect(call.headers.Authorization).toBe('Bearer wa-system-user-token');
    expect(Object.keys(call.headers).map((h) => h.toLowerCase())).not.toContain('x-hub-signature-256');
    expect(call.body).toMatchObject({ messaging_product: 'whatsapp', to: '905321112233', type: 'template', template: { name: 'field_extra_approval', language: { code: 'tr' } } });
    const comps = call.body.template.components;
    expect(comps[0].parameters.map((p: any) => p.text)).toEqual([expect.any(String), sp.code, 'Ek coffee break', '3.000 TL', expect.any(String)]);
    expect(comps[1]).toEqual({ type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `extra_approve:${token}` }] });
    // the inbound handler accepts exactly this payload format
    expect(`extra_approve:${token}`).toMatch(/^extra_approve:([A-Za-z0-9_-]{20,200})$/);
    const row = (await ownerSql(`SELECT * FROM outbox WHERE tenant_id = $1 AND provider = 'whatsapp_cloud' ORDER BY created_at DESC LIMIT 1`, [t.tenantId]))[0];
    expect(row).toMatchObject({ channel: 'whatsapp', status: 'sent', to_address: '+905321112233', from_address: t.users.field.email, provider_message_id: call.body && expect.stringMatching(/^wamid\.OUT/), delivery_status: 'sent' });
    expect(row.body).not.toContain(token);
    expect((await ownerSql('SELECT body_enc FROM outbox_payloads WHERE outbox_id = $1', [row.id]))[0].body_enc).toBeNull();

    // status webhook → delivery receipt (never downgraded), then failed
    const wamid = row.provider_message_id;
    const r1 = await statusHook([{ id: wamid, status: 'delivered', timestamp: String(Math.floor(clock.now.getTime() / 1000)) }, { id: wamid, status: 'read', timestamp: String(Math.floor(clock.now.getTime() / 1000) + 60) }]);
    expect(r1.json()).toMatchObject({ ok: true, statuses: 2 });
    await statusHook([{ id: wamid, status: 'delivered' }]);
    let o = (await ownerSql('SELECT delivery_status, delivered_at, read_at, status FROM outbox WHERE id = $1', [row.id]))[0];
    expect(o.delivery_status).toBe('read');
    expect(o.read_at).toBeTruthy();
    await statusHook([{ id: wamid, status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message' }] }]);
    o = (await ownerSql('SELECT delivery_status, status, last_error, next_attempt_at FROM outbox WHERE id = $1', [row.id]))[0];
    expect(o).toMatchObject({ delivery_status: 'failed', status: 'failed', next_attempt_at: null });
    expect(o.last_error).toContain('131047');
    // unknown wamid / foreign tenant: nothing happens
    expect((await statusHook([{ id: 'wamid.unknown', status: 'read' }])).json().statuses).toBe(0);
  });

  it('permanent WhatsApp error → SMS fallback; transient → worker retry', async () => {
    waQueue = [{ status: 400, body: { error: { code: 131026, message: 'Message undeliverable' } } }];
    const smsBefore = smsCalls().length;
    const ex = await field.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'Ek ses sistemi', amountTry: 1200, customerPhone: '+90 533 222 33 44' });
    const token = ex.body.approvalLink.split('/e/')[1];
    const sms = smsCalls().slice(smsBefore);
    expect(sms).toHaveLength(1);
    expect(sms[0].body.messages[0]).toMatchObject({ no: '905332223344' });
    expect(sms[0].body.messages[0].msg).toContain(token); // the customer gets the link by SMS …
    const rows = await ownerSql(`SELECT provider, status, body, last_error FROM outbox WHERE tenant_id = $1 AND to_address = '+905332223344' ORDER BY created_at`, [t.tenantId]);
    rows.sort((a, b) => (a.provider < b.provider ? 1 : -1));
    expect(rows.map((r) => [r.provider, r.status])).toEqual([['whatsapp_cloud', 'failed'], ['sms_http', 'sent']]);
    expect(rows[0].last_error).toMatch(/131026.*→ SMS/);
    expect(rows.every((r) => !r.body.includes(token))).toBe(true); // … no copy keeps it
    // transient (rate limit) → retried by the worker
    waQueue = [{ status: 429, body: { error: { code: 130429, message: 'rate' } } }];
    await field.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'Ek su', amountTry: 300, customerPhone: '+90 534 000 00 01' });
    let row = (await ownerSql(`SELECT id, status, next_attempt_at FROM outbox WHERE tenant_id = $1 AND to_address = '+905340000001'`, [t.tenantId]))[0];
    expect(row.status).toBe('failed');
    expect(row.next_attempt_at).toBeTruthy();
    expect(await sys((ctx) => runOutboxJobs(ctx, new Date(clock.now.getTime() + 2 * 60_000)))).toContain('outbox_sent:1');
    row = (await ownerSql('SELECT status FROM outbox WHERE id = $1', [row.id]))[0];
    expect(row.status).toBe('sent');
  });

  it('inside the 24 h window: session text / interactive approval button instead of a template', async () => {
    await ownerSql(`INSERT INTO inbound_messages (tenant_id, channel, from_address, body, received_at) VALUES ($1, 'whatsapp', '+905359998877', 'merhaba', $2)`, [t.tenantId, new Date(clock.now.getTime() - 3_600_000)]);
    const ex = await field.post(`/api/projects/${sp.projectId}/field-extras`, { description: 'Ek fotoğrafçı', amountTry: 900, customerPhone: '0535 999 88 77' });
    const token = ex.body.approvalLink.split('/e/')[1];
    const c = waCalls().at(-1)!;
    expect(c.body).toMatchObject({ type: 'interactive', to: '905359998877', interactive: { type: 'button', action: { buttons: [{ type: 'reply', reply: { id: `extra_approve:${token}`, title: 'Onaylıyorum' } }] } } });
    expect(c.body.interactive.body.text).toContain('Ek fotoğrafçı');
    // plain whatsapp text (no template) in the window
    await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, channel: 'whatsapp', from: t.users.ops.email, to: '+905359998877', subject: null, body: 'Transfer 09:30' }));
    expect(waCalls().at(-1)!.body).toMatchObject({ type: 'text', text: { body: 'Transfer 09:30' } });
    // outside the window, no template, WhatsApp requested → SMS
    const before = smsCalls().length;
    await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, channel: 'whatsapp', from: t.users.ops.email, to: '+905350000099', subject: null, body: 'Bilgi' }));
    expect(smsCalls().length).toBe(before + 1);
  });

  it('no live channel: router keeps the outbox behaviour', () => {
    const r = createDeliveryProvider(loadDeliveryConfig({})) as ChannelRouter;
    expect(r.messagingLive).toBe(false);
    expect(r.messaging.name).toBe('outbox');
    const smsOnly = createDeliveryProvider(loadDeliveryConfig({ SMS_PROVIDER: 'http', SMS_API_URL: SMS_URL, SMS_SENDER: 'X' })) as ChannelRouter;
    expect(smsOnly.messaging).toBeInstanceOf(LiveMessagingProvider);
    expect(smsOnly.messagingLive).toBe(true);
  });
});

describe('§15 critical push fallback', () => {
  it('waits N minutes, sends ONE WhatsApp template to the admin, is idempotent, skips acknowledged / phone-less', async () => {
    await ownerSql('UPDATE users SET notify_phone = $2 WHERE id = $1', [t.users.admin.id, '+905301112233']);
    const t0 = clock.now;
    pushes.delivered.length = 0;
    // earlier critical cards of this tenant (contract / field extra flow) were opened
    await ownerSql(`UPDATE notifications SET read_at = now() WHERE tenant_id = $1`, [t.tenantId]);
    await sys((ctx) => notify(ctx, { userIds: [t.users.admin.id], priority: 'critical', title: 'Opsiyon bugün bitiyor', entityType: 'test', entityId: null }));
    await sys((ctx) => notify(ctx, { userIds: [t.users.admin.id], priority: 'critical', title: 'Acil ödeme', entityType: 'test', entityId: null }));
    await sys((ctx) => notify(ctx, { userIds: [t.users.clerk.id], priority: 'critical', title: 'Clerk kritik', entityType: 'test', entityId: null }));
    const ack = pushes.delivered.find((p) => p.title === 'Acil ödeme')!.ackUrl!;
    expect(ack).toMatch(/^\/api\/push\/ack\//);
    const before = waCalls().length;
    const at = (min: number) => new Date(t0.getTime() + min * 60_000);
    expect(await sys((ctx) => runCriticalPushFallback(ctx, at(10)))).toEqual([]);
    expect(waCalls().length).toBe(before);
    const out = await sys((ctx) => runCriticalPushFallback(ctx, at(16)));
    expect(out).toEqual(['critical_fallback:2']); // admin only, one message for both
    const c = waCalls().at(-1)!;
    expect(c.body).toMatchObject({ to: '905301112233', type: 'template', template: { name: 'critical_alert' } });
    expect(c.body.template.components[0].parameters[0].text).toBe('2');
    expect(await sys((ctx) => runCriticalPushFallback(ctx, at(30)))).toEqual([]); // idempotent
    expect(waCalls().length).toBe(before + 1);
    const rows = await ownerSql(`SELECT fallback_status, fallback_outbox_id FROM notifications WHERE user_id = $1 AND entity_type = 'test'`, [t.users.admin.id]);
    expect(rows.every((r) => r.fallback_status === 'sent' && r.fallback_outbox_id)).toBe(true);

    // acknowledged via the service-worker link → no fallback
    await sys((ctx) => notify(ctx, { userIds: [t.users.admin.id], priority: 'critical', title: 'Sözleşme riski', entityType: 'test2', entityId: null }));
    const link = pushes.delivered.at(-1)!.ackUrl!;
    expect((await app.inject({ method: 'POST', url: `${link}x` })).statusCode).toBe(404); // tampered
    const okAck = await app.inject({ method: 'POST', url: link });
    expect(okAck.json()).toEqual({ ok: true });
    expect(await sys((ctx) => runCriticalPushFallback(ctx, at(60)))).toEqual([]);
    expect((await ownerSql(`SELECT acked_via, read_at IS NOT NULL AS read FROM notifications WHERE user_id = $1 AND entity_type = 'test2'`, [t.users.admin.id]))[0]).toEqual({ acked_via: 'push_click', read: true });
    // in-app acknowledge works too (own notifications only)
    await sys((ctx) => notify(ctx, { userIds: [t.users.admin.id], priority: 'critical', title: 'X', entityType: 'test3', entityId: null }));
    const id = pushes.delivered.at(-1)!.notificationId!;
    expect((await field.post(`/api/notifications/${id}/ack`)).body).toEqual({ ok: false });
    expect((await admin.post(`/api/notifications/${id}/ack`)).body).toEqual({ ok: true });
    void ack;

    // admin without a phone → marked, nothing sent; rule 0 disables
    await ownerSql('UPDATE users SET notify_phone = NULL WHERE id = $1', [t.users.admin.id]);
    await sys((ctx) => notify(ctx, { userIds: [t.users.admin.id], priority: 'critical', title: 'Y', entityType: 'test4', entityId: null }));
    const n0 = waCalls().length + smsCalls().length;
    expect(await sys((ctx) => runCriticalPushFallback(ctx, at(120)))).toEqual(['critical_fallback_no_phone:1']);
    expect(waCalls().length + smsCalls().length).toBe(n0);
    expect((await admin.patch('/api/rules', { criticalPushFallbackMinutes: 0 })).status).toBe(200);
    await ownerSql('UPDATE users SET notify_phone = $2 WHERE id = $1', [t.users.admin.id, '+905301112233']);
    await sys((ctx) => notify(ctx, { userIds: [t.users.admin.id], priority: 'critical', title: 'Z', entityType: 'test5', entityId: null }));
    expect(await sys((ctx) => runCriticalPushFallback(ctx, at(240)))).toEqual([]);
    // own phone via the profile API (normalised)
    expect((await admin.post('/api/me/notify-phone', { phone: '0530 111 22 33' })).body).toEqual({ phone: '+905301112233' });
    expect((await admin.post('/api/me/notify-phone', { phone: 'abc' })).status).toBe(400);
    expect((await admin.get('/api/me/notify-phone')).body).toMatchObject({ phone: '+905301112233', channelLive: true });
  });
});
