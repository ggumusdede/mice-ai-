// Per-user OAuth mailboxes (Gmail API / Microsoft Graph) — connect flow (signed state, PKCE, single use, expiry), token
// encryption at rest, refresh (cached / expired / 401 / invalid_grant), sending from the human's own mailbox with thread
// headers, hold-and-notify fallback, disconnect. ALL HTTP is mocked (setIntegrationFetch) — nothing reaches Google / Microsoft.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { REQUEST_TEXT, client, clock, closeApp, login, newTenant, ownerSql, resetClock, type Client } from './helpers.js';
import { buildApp } from '../src/server.js';
import { loadDeliveryConfig } from '../src/delivery-config.js';
import { createDeliveryProvider, runOutboxJobs, type ChannelRouter } from '../src/services/delivery.js';
import { OAuthEmailProvider } from '../src/services/email-oauth.js';
import { setIntegrationFetch, type FetchLike } from '../src/services/integrations-http.js';
import { pkcePair } from '../src/services/mail-accounts.js';
import { withSystemCtx, type Ctx } from '../src/context.js';
import { ConsoleNotificationService, setNotificationService } from '../src/services/notifications.js';

const ENV = {
  EMAIL_PROVIDER: 'oauth', EMAIL_OAUTH_FALLBACK: 'hold', OAUTH_GOOGLE_CLIENT_ID: 'g-client', OAUTH_GOOGLE_CLIENT_SECRET: 'g-secret',
  OAUTH_MICROSOFT_CLIENT_ID: 'm-client', OAUTH_MICROSOFT_CLIENT_SECRET: 'm-secret', OAUTH_MICROSOFT_TENANT: 'contoso-tenant',
  MAIL_TOKEN_KEY: 'test-mail-token-key', MAIL_OAUTH_REDIRECT_BASE: 'https://app.agency.test', EMAIL_REPLY_ADDRESS: 'replies@agency.test',
};

interface Call { url: string; method: string; headers: Record<string, string>; body: string }
const calls: Call[] = [];
/** per-URL-prefix responders; the first matching prefix wins */
let routes: [string, (c: Call) => { status: number; body?: unknown; text?: string }][] = [];
const mockFetch: FetchLike = async (url, init) => {
  const c: Call = { url, method: init.method, headers: init.headers, body: typeof init.body === 'string' ? init.body : init.body ? Buffer.from(init.body).toString() : '' };
  calls.push(c);
  const r = routes.find(([p]) => url.startsWith(p));
  if (!r) return new Response('{"error":"unmocked"}', { status: 599 });
  const res = r[1](c);
  return new Response(res.text ?? (res.body === undefined ? '' : JSON.stringify(res.body)), { status: res.status, headers: { 'content-type': 'application/json' } });
};

const tokenQueue: { status: number; body: unknown }[] = [];
let userinfoEmail = '';
let gmailQueue: number[] = [];
let tokenSeq = 0;
function defaultRoutes() {
  routes = [
    ['https://oauth2.googleapis.com/token', () => tokenQueue.shift() ?? { status: 200, body: { access_token: `g-access-${++tokenSeq}`, expires_in: 3600 } }],
    ['https://oauth2.googleapis.com/revoke', () => ({ status: 200, body: {} })],
    ['https://openidconnect.googleapis.com/v1/userinfo', () => ({ status: 200, body: { email: userinfoEmail, email_verified: true } })],
    ['https://login.microsoftonline.com/contoso-tenant/oauth2/v2.0/token', () => tokenQueue.shift() ?? { status: 200, body: { access_token: `m-access-${++tokenSeq}`, expires_in: 3600 } }],
    ['https://graph.microsoft.com/v1.0/me?', () => ({ status: 200, body: { mail: userinfoEmail, userPrincipalName: userinfoEmail } })],
    ['https://graph.microsoft.com/v1.0/me/messages/', () => ({ status: 202 })],
    ['https://graph.microsoft.com/v1.0/me/messages', () => ({ status: 201, body: { id: 'AAMk-draft-1', conversationId: 'conv-1', internetMessageId: '<exch-1@prod.outlook.com>' } })],
    ['https://gmail.googleapis.com/gmail/v1/users/me/messages/send', (c) => {
      const st = gmailQueue.shift() ?? 200;
      if (st !== 200) return { status: st, body: { error: { code: st, message: `status ${st}` } } };
      return { status: 200, body: { id: `gm-${calls.length}`, threadId: JSON.parse(c.body).threadId ?? 'thread-1' } };
    }],
  ];
}

let app: FastifyInstance;
let t: Awaited<ReturnType<typeof newTenant>>;
let clerk: Client;
let admin: Client;
let projectId: string;
const saved = { ...process.env };

beforeAll(async () => {
  resetClock();
  Object.assign(process.env, ENV);
  setIntegrationFetch(mockFetch);
  defaultRoutes();
  const router = createDeliveryProvider(loadDeliveryConfig({ ...process.env }), { now: () => clock.now });
  app = await buildApp({ email: router, now: () => clock.now, logger: false });
  t = await newTenant('mailoauth');
  clerk = client(app, await login(app, t.users.clerk.email));
  admin = client(app, await login(app, t.users.admin.email));
  const intake = await clerk.post('/api/intake', { channel: 'email', body: REQUEST_TEXT, fromAddress: 'musteri@example.com', customerId: t.customers.new });
  projectId = intake.body.project.id;
});
afterAll(async () => {
  setIntegrationFetch(null);
  setNotificationService(new ConsoleNotificationService());
  process.env = saved;
  await closeApp({ app, email: null as never });
});

const sys = <T>(fn: (ctx: Ctx) => Promise<T>) => withSystemCtx<T>(app.deps, t.tenantId, { type: 'system', id: null }, fn);
const callback = (provider: string, q: Record<string, string>) => app.inject({ method: 'GET', url: `/api/mail/oauth/${provider}/callback?${new URLSearchParams(q)}` });
const reason = (loc: string | undefined) => new URL(loc ?? '', 'https://x.test').searchParams.get('reason');
async function start(c: Client, provider = 'google') {
  const r = await c.get(`/api/mail/oauth/${provider}/start`);
  expect(r.status).toBe(200);
  return new URL(r.body.url);
}
async function connect(c: Client, email: string, provider = 'google') {
  userinfoEmail = email;
  const u = await start(c, provider);
  const r = await callback(provider, { code: 'auth-code-1', state: u.searchParams.get('state')! });
  expect(r.statusCode).toBe(302);
  expect(r.headers.location).toContain('mail_oauth=connected');
  return u;
}

describe('OAuth connect flow', () => {
  it('start: authorization URL with PKCE S256, offline access, login hint; verifier stored encrypted', async () => {
    const u = await start(clerk);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = u.searchParams;
    expect(q.get('client_id')).toBe('g-client');
    expect(q.get('redirect_uri')).toBe('https://app.agency.test/api/mail/oauth/google/callback');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get('scope')).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('login_hint')).toBe(t.users.clerk.email);
    const row = (await ownerSql(`SELECT code_verifier_enc, expires_at FROM mail_oauth_states WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`, [t.tenantId]))[0];
    const verifier = (await ownerSql(`SELECT pgp_sym_decrypt($1::bytea, $2) AS v`, [row.code_verifier_enc, ENV.MAIL_TOKEN_KEY]))[0].v;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(q.get('code_challenge'));
    expect(Buffer.from(row.code_verifier_enc).toString('latin1')).not.toContain(verifier);
    const p = pkcePair();
    expect(createHash('sha256').update(p.verifier).digest('base64url')).toBe(p.challenge);
    // start needs a login
    expect((await app.inject({ method: 'GET', url: '/api/mail/oauth/google/start' })).statusCode).toBe(401);
  });

  it('rejects tampered, foreign-provider, expired and replayed states before any token request', async () => {
    const u = await start(clerk);
    const state = u.searchParams.get('state')!;
    const n = calls.length;
    const [body, sig] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), u: t.users.admin.id })).toString('base64url');
    expect(reason((await callback('google', { code: 'c', state: `${forged}.${sig}` })).headers.location)).toBe('invalid_state');
    expect(reason((await callback('google', { code: 'c', state: `${body}.${sig.slice(0, -2)}xx` })).headers.location)).toBe('invalid_state');
    expect(reason((await callback('google', { code: 'c' })).headers.location)).toBe('invalid_state');
    expect(reason((await callback('microsoft', { code: 'c', state })).headers.location)).toBe('invalid_state');
    clock.now = new Date(clock.now.getTime() + 11 * 60_000); // TTL 10 min
    expect(reason((await callback('google', { code: 'c', state })).headers.location)).toBe('state_expired');
    resetClock();
    expect(calls.length).toBe(n); // no token / userinfo request was made
    // single use
    userinfoEmail = t.users.clerk.email;
    tokenQueue.push({ status: 200, body: { access_token: 'g-access-0', refresh_token: 'g-refresh-0', expires_in: 3600 } });
    const u2 = await start(clerk);
    const s2 = u2.searchParams.get('state')!;
    expect((await callback('google', { code: 'c', state: s2 })).headers.location).toContain('mail_oauth=connected');
    expect(reason((await callback('google', { code: 'c', state: s2 })).headers.location)).toBe('state_used');
  });

  it('exchanges the code with the PKCE verifier; tokens are encrypted at rest and never audited; foreign mailbox refused', async () => {
    tokenQueue.push({ status: 200, body: { access_token: 'g-access-initial', refresh_token: 'g-refresh-SECRET-1', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.send' } });
    const u = await connect(clerk, t.users.clerk.email);
    const tok = calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token').at(-1)!;
    const form = new URLSearchParams(tok.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('auth-code-1');
    expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(u.searchParams.get('code_challenge'));
    expect(form.get('redirect_uri')).toBe('https://app.agency.test/api/mail/oauth/google/callback');
    const acc = (await ownerSql(`SELECT a.*, tk.refresh_token_enc, tk.access_token_enc FROM user_mail_accounts a JOIN user_mail_tokens tk ON tk.account_id = a.id
                                  WHERE a.tenant_id = $1 AND a.user_id = $2 AND a.status = 'active'`, [t.tenantId, t.users.clerk.id]))[0];
    expect(acc).toMatchObject({ provider: 'google', email_address: t.users.clerk.email.toLowerCase(), status: 'active' });
    expect(Buffer.from(acc.refresh_token_enc).toString('latin1')).not.toContain('g-refresh-SECRET-1');
    expect((await ownerSql(`SELECT pgp_sym_decrypt($1::bytea, $2) AS v`, [acc.refresh_token_enc, ENV.MAIL_TOKEN_KEY]))[0].v).toBe('g-refresh-SECRET-1');
    const audit = await ownerSql(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND (entity IN ('user_mail_tokens', 'mail_oauth_states') OR after::text LIKE '%g-refresh-SECRET%')`, [t.tenantId]);
    expect(audit[0].n).toBe(0);
    // the account row (no secrets) is audited
    expect((await ownerSql(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND entity = 'user_mail_accounts'`, [t.tenantId]))[0].n).toBeGreaterThan(0);
    // previous connection (single-use test) was replaced, not deleted
    expect((await ownerSql(`SELECT count(*)::int AS n FROM user_mail_accounts WHERE user_id = $1 AND status = 'disconnected' AND disconnected_reason = 'replaced'`, [t.users.clerk.id]))[0].n).toBe(1);
    const list = await clerk.get('/api/mail/accounts');
    expect(list.body).toMatchObject({ providers: { google: true, microsoft: true }, emailProvider: 'oauth', fallback: 'hold' });
    expect(list.body.items).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('g-refresh');
    // somebody else's mailbox (§3.3: only the user's own address)
    tokenQueue.push({ status: 200, body: { access_token: 'x', refresh_token: 'y', expires_in: 3600 } });
    userinfoEmail = 'private.person@gmail.com';
    const u2 = await start(admin);
    expect(reason((await callback('google', { code: 'c', state: u2.searchParams.get('state')! })).headers.location)).toBe('mailbox_mismatch');
    expect((await ownerSql(`SELECT count(*)::int AS n FROM user_mail_accounts WHERE user_id = $1`, [t.users.admin.id]))[0].n).toBe(0);
  });
});

describe('sending from the user\'s own mailbox', () => {
  const sends = () => calls.filter((c) => c.url.startsWith('https://gmail.googleapis.com'));
  const rawOf = (c: Call) => Buffer.from(JSON.parse(c.body).raw, 'base64url').toString('utf8');

  it('Gmail: From = the user, Bearer = that user\'s token, Message-ID / In-Reply-To / References / threadId', async () => {
    const before = sends().length;
    const from = t.users.clerk.email;
    const a = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, projectId, from, to: 'otel@example.com', subject: 'RFQ 1', body: 'Form: https://x/s/rfq/SECRET-TOKEN-9', secrets: ['SECRET-TOKEN-9'] }));
    const b = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, projectId, from, to: 'otel@example.com', subject: 'Re: RFQ 1', body: 'ikinci' }));
    const [s1, s2] = sends().slice(before);
    expect(s1.headers.Authorization).toBe('Bearer g-access-initial'); // cached access token, no refresh
    const raw1 = rawOf(s1);
    expect(raw1).toMatch(new RegExp(`^From: ${from.replace('.', '\\.')}`, 'mi'));
    expect(raw1).toContain(`Message-ID: <${a.id}@agency.test>`);
    expect(raw1).toMatch(/^X-MICE-Project: PRJ-\d+/im);
    expect(raw1).toContain('replies+');
    expect(raw1).toContain('SECRET-TOKEN-9'); // the recipient gets the link …
    const row1 = (await ownerSql('SELECT * FROM outbox WHERE id = $1', [a.id]))[0];
    expect(row1).toMatchObject({ provider: 'gmail_api', status: 'sent', from_address: from, provider_thread_id: 'thread-1' });
    expect(row1.body).not.toContain('SECRET-TOKEN-9'); // … the outbox copy does not
    const raw2 = rawOf(s2);
    expect(raw2).toContain(`In-Reply-To: <${a.id}@agency.test>`);
    expect(raw2).toContain(`References: <${a.id}@agency.test>`);
    expect(JSON.parse(s2.body).threadId).toBe('thread-1');
    expect((await ownerSql('SELECT status, in_reply_to FROM outbox WHERE id = $1', [b.id]))[0]).toEqual({ status: 'sent', in_reply_to: `<${a.id}@agency.test>` });
    expect((await ownerSql('SELECT body_enc FROM outbox_payloads WHERE outbox_id = $1', [a.id]))[0].body_enc).toBeNull();
  });

  it('refreshes on 401 and retries once; refreshes an expired access token before sending', async () => {
    gmailQueue = [401];
    const before = calls.length;
    const r = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, from: t.users.clerk.email, to: 'b@example.com', subject: 's', body: 'b' }));
    const seq = calls.slice(before).map((c) => c.url.split('?')[0]);
    expect(seq).toEqual(['https://gmail.googleapis.com/gmail/v1/users/me/messages/send', 'https://oauth2.googleapis.com/token', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send']);
    const refresh = new URLSearchParams(calls[before + 1].body);
    expect(refresh.get('grant_type')).toBe('refresh_token');
    expect(refresh.get('refresh_token')).toBe('g-refresh-SECRET-1');
    expect(calls[before + 2].headers.Authorization).toMatch(/^Bearer g-access-\d+$/);
    expect((await ownerSql('SELECT status FROM outbox WHERE id = $1', [r.id]))[0].status).toBe('sent');
    // 2 h later the cached token has expired → refresh first (rotated refresh token is stored)
    clock.now = new Date(clock.now.getTime() + 2 * 3_600_000);
    tokenQueue.push({ status: 200, body: { access_token: 'g-access-rotated', refresh_token: 'g-refresh-SECRET-2', expires_in: 3600 } });
    const b2 = calls.length;
    await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, from: t.users.clerk.email, to: 'b@example.com', subject: 's2', body: 'b' }));
    expect(calls[b2].url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[b2 + 1].headers.Authorization).toBe('Bearer g-access-rotated');
    const enc = (await ownerSql(`SELECT pgp_sym_decrypt(t.refresh_token_enc, $2) AS r FROM user_mail_tokens t JOIN user_mail_accounts a ON a.id = t.account_id WHERE a.user_id = $1 AND a.status = 'active'`, [t.users.clerk.id, ENV.MAIL_TOKEN_KEY]))[0];
    expect(enc.r).toBe('g-refresh-SECRET-2');
    resetClock();
  });

  it('transient API error → worker retry with backoff; permanent 4xx → given up', async () => {
    gmailQueue = [503];
    const r = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, from: t.users.clerk.email, to: 'c@example.com', subject: 's', body: 'b' }));
    let row = (await ownerSql('SELECT * FROM outbox WHERE id = $1', [r.id]))[0];
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
    expect(row.next_attempt_at).toBeTruthy();
    expect(await sys((ctx) => runOutboxJobs(ctx, new Date(clock.now.getTime() + 2 * 60_000)))).toContain('outbox_sent:1');
    row = (await ownerSql('SELECT * FROM outbox WHERE id = $1', [r.id]))[0];
    expect(row).toMatchObject({ status: 'sent', attempts: 2, provider: 'gmail_api' });
    gmailQueue = [400];
    const p = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, from: t.users.clerk.email, to: 'd@example.com', subject: 's', body: 'b' }));
    row = (await ownerSql('SELECT * FROM outbox WHERE id = $1', [p.id]))[0];
    expect(row.status).toBe('failed');
    expect(row.next_attempt_at).toBeNull();
  });

  it('no connected mailbox + fallback hold → queued, sender notified; delivered from their mailbox once connected', async () => {
    const ops = t.users.ops;
    const r = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, from: ops.email, to: 'e@example.com', subject: 'Hold', body: 'held' }));
    let row = (await ownerSql('SELECT * FROM outbox WHERE id = $1', [r.id]))[0];
    expect(row).toMatchObject({ status: 'queued', provider: 'oauth', last_error: 'MAILBOX_NOT_CONNECTED' });
    const n = await ownerSql(`SELECT title FROM notifications WHERE user_id = $1 AND entity_type = 'outbox' AND entity_id = $2`, [ops.id, r.id]);
    expect(n).toHaveLength(1);
    // still not connected after 10 min: stays held, no second notification
    await sys((ctx) => runOutboxJobs(ctx, new Date(clock.now.getTime() + 11 * 60_000)));
    expect((await ownerSql('SELECT status FROM outbox WHERE id = $1', [r.id]))[0].status).toBe('queued');
    // connect (Microsoft this time) → the worker delivers through Graph (MIME create + send)
    const opsClient = client(app, await login(app, ops.email));
    tokenQueue.push({ status: 200, body: { access_token: 'm-access-ops', refresh_token: 'm-refresh-ops', expires_in: 3600 } });
    await connect(opsClient, ops.email, 'microsoft');
    const before = calls.length;
    expect(await sys((ctx) => runOutboxJobs(ctx, new Date(clock.now.getTime() + 22 * 60_000)))).toContain('outbox_sent:1');
    const [create, send] = calls.slice(before);
    expect(create.url).toBe('https://graph.microsoft.com/v1.0/me/messages');
    expect(create.headers['Content-Type']).toBe('text/plain');
    expect(create.headers.Authorization).toBe('Bearer m-access-ops');
    expect(Buffer.from(create.body, 'base64').toString('utf8')).toMatch(new RegExp(`^From: ${ops.email.replace('.', '\\.')}`, 'mi'));
    expect(send.url).toBe('https://graph.microsoft.com/v1.0/me/messages/AAMk-draft-1/send');
    row = (await ownerSql('SELECT * FROM outbox WHERE id = $1', [r.id]))[0];
    expect(row).toMatchObject({ status: 'sent', provider: 'ms_graph', provider_thread_id: 'conv-1', message_id: '<exch-1@prod.outlook.com>' });
  });

  it('invalid_grant → account needs_reauth, user notified, message held; disconnect marks inactive (no DELETE) and revokes', async () => {
    clock.now = new Date(clock.now.getTime() + 3 * 3_600_000); // access token expired
    tokenQueue.push({ status: 400, body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } });
    const r = await sys((ctx) => ctx.deps.email.send(ctx.db, { tenantId: t.tenantId, from: t.users.clerk.email, to: 'f@example.com', subject: 's', body: 'b' }));
    expect((await ownerSql('SELECT status, last_error FROM outbox WHERE id = $1', [r.id]))[0]).toEqual({ status: 'queued', last_error: 'MAILBOX_NOT_CONNECTED' });
    const acc = (await ownerSql(`SELECT id, status FROM user_mail_accounts WHERE user_id = $1 AND status <> 'disconnected'`, [t.users.clerk.id]))[0];
    expect(acc.status).toBe('needs_reauth');
    expect((await ownerSql(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND entity_type = 'user_mail_account'`, [t.users.clerk.id]))[0].n).toBe(1);
    // reconnect, then disconnect
    tokenQueue.push({ status: 200, body: { access_token: 'g-access-new', refresh_token: 'g-refresh-new', expires_in: 3600 } });
    await connect(clerk, t.users.clerk.email);
    const live = (await clerk.get('/api/mail/accounts')).body.items[0];
    expect((await admin.post(`/api/mail/accounts/${live.id}/disconnect`)).status).toBe(200); // admin may disconnect
    const revoke = calls.filter((c) => c.url === 'https://oauth2.googleapis.com/revoke').at(-1)!;
    expect(new URLSearchParams(revoke.body).get('token')).toBe('g-refresh-new');
    const row = (await ownerSql(`SELECT a.status, a.disconnected_reason, t.refresh_token_enc, t.access_token_enc FROM user_mail_accounts a JOIN user_mail_tokens t ON t.account_id = a.id WHERE a.id = $1`, [live.id]))[0];
    expect(row).toEqual({ status: 'disconnected', disconnected_reason: 'admin', refresh_token_enc: null, access_token_enc: null });
    expect((await clerk.get('/api/mail/accounts')).body.items).toHaveLength(0);
    const field = client(app, await login(app, t.users.field.email));
    expect((await field.post(`/api/mail/accounts/${live.id}/disconnect`)).status).toBe(403);
    resetClock();
  });

  it('config: oauth needs client credentials; fallback smtp delegates to SMTP for senders without a mailbox', () => {
    expect(() => loadDeliveryConfig({ EMAIL_PROVIDER: 'oauth' })).toThrow(/OAUTH_GOOGLE_CLIENT_ID/);
    expect(() => loadDeliveryConfig({ ...ENV, EMAIL_OAUTH_FALLBACK: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(() => loadDeliveryConfig({ ...ENV, EMAIL_OAUTH_FALLBACK: 'nope' })).toThrow(/EMAIL_OAUTH_FALLBACK/);
    const r = createDeliveryProvider(loadDeliveryConfig({ ...ENV, EMAIL_OAUTH_FALLBACK: 'smtp', SMTP_HOST: 'smtp.test' }), { transport: { sendMail: async () => ({}) } }) as ChannelRouter;
    expect(r.email).toBeInstanceOf(OAuthEmailProvider);
    expect(r.name).toBe('oauth');
  });
});
