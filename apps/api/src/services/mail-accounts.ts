// Per-user OAuth mailbox connection (§3.3 "insanın kendi adresinden", docs/07 §6): each staff user connects their OWN
// Google Workspace (Gmail API, scope gmail.send) or Microsoft 365 (Graph, Mail.Send) mailbox; outgoing mail then leaves
// from that mailbox (Sent Items, replies to the user's inbox).
//
// Connect flow (authorization code + PKCE S256):
//   GET /api/mail/oauth/:provider/start (JWT) → {url}: a `state` = HMAC-signed {tenant, user, provider, nonce, exp} (TTL
//   MAIL_OAUTH_STATE_TTL_SECONDS, default 10 min); the PKCE code_verifier stays server-side (mail_oauth_states, encrypted,
//   single use). GET /api/mail/oauth/:provider/callback?code&state → signature + expiry + single use + provider checked
//   BEFORE any token request; code exchanged with the verifier; the mailbox address is read from the provider (userinfo /
//   Graph /me) and must equal the user's login address (MAIL_OAUTH_REQUIRE_SAME_ADDRESS, default on); refresh + access token
//   stored pgcrypto-encrypted (user_mail_tokens, not audited). Disconnect = status 'disconnected' + tokens emptied (no DELETE)
//   + best-effort revoke at Google.
// Token refresh: cached access token until 60 s before expiry; refresh_token grant (rotation honoured); invalid_grant →
// account 'needs_reauth' (user notified); transient errors → exponential backoff (next_refresh_at).
// Implemented and unit-tested with mocked HTTP; NOT yet tested against live Google / Microsoft tenants.
import { createHash, randomBytes } from 'node:crypto';
import type { Ctx } from '../context.js';
import type { Db } from '../db/pool.js';
import { withTenant } from '../db/pool.js';
import type { OAuthMailConfig } from '../delivery-config.js';
import { badRequest, notFound, forbidden } from '../errors.js';
import { sha256Hex } from '../lib/crypto.js';
import { purposeKey, signToken, verifyToken } from '../lib/signed-token.js';
import { retryDelayMs } from './email-smtp.js';
import { HttpError, formBody, httpCall, isRetryableStatus } from './integrations-http.js';
import { getNotificationService } from './notifications.js';

export type MailOAuthProvider = 'google' | 'microsoft';
export const MAIL_OAUTH_PROVIDERS: MailOAuthProvider[] = ['google', 'microsoft'];

export interface ProviderEndpoints { authUrl: string; tokenUrl: string; userInfoUrl: string; revokeUrl: string | null; scopes: string[]; extraAuthParams: Record<string, string> }

export function providerEndpoints(p: MailOAuthProvider, cfg: OAuthMailConfig): ProviderEndpoints {
  if (p === 'google') {
    return {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      revokeUrl: 'https://oauth2.googleapis.com/revoke',
      scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'],
      // offline → refresh token; consent → a refresh token also on reconnect
      extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    };
  }
  const tenant = encodeURIComponent(cfg.microsoft?.tenant ?? 'organizations');
  return {
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
    revokeUrl: null,
    scopes: ['offline_access', 'openid', 'email', 'https://graph.microsoft.com/Mail.Send', 'https://graph.microsoft.com/User.Read'],
    extraAuthParams: { response_mode: 'query', prompt: 'select_account' },
  };
}

function client(p: MailOAuthProvider, cfg: OAuthMailConfig) {
  const c = p === 'google' ? cfg.google : cfg.microsoft;
  if (!c) throw badRequest(`${p === 'google' ? 'Google' : 'Microsoft'} e-posta bağlantısı yapılandırılmamış`, undefined, 'MAIL_OAUTH_NOT_CONFIGURED');
  return c;
}

export function redirectUri(p: MailOAuthProvider, cfg: OAuthMailConfig): string {
  return `${cfg.redirectBase}/api/mail/oauth/${p}/callback`;
}

/** PKCE (RFC 7636): verifier 43 chars base64url, challenge = BASE64URL(SHA256(verifier)). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

interface StatePayload { t: string; u: string; p: MailOAuthProvider; n: string; e: number }
const stateKey = (secret: string) => purposeKey(secret, 'mail-oauth-state');

/** GET /api/mail/oauth/:provider/start */
export async function startMailOAuth(ctx: Ctx, provider: MailOAuthProvider, cfg: OAuthMailConfig): Promise<{ url: string; expiresAt: string }> {
  const user = ctx.user;
  if (!user) throw forbidden('Giriş gerekli');
  const c = client(provider, cfg);
  const ep = providerEndpoints(provider, cfg);
  const now = ctx.now();
  const exp = Math.floor(now.getTime() / 1000) + cfg.stateTtlSeconds;
  const state = signToken(stateKey(ctx.deps.config.jwtSecret), { t: ctx.tenantId, u: user.id, p: provider, n: randomBytes(16).toString('base64url'), e: exp } satisfies StatePayload);
  const { verifier, challenge } = pkcePair();
  await ctx.db.query(
    `INSERT INTO mail_oauth_states (tenant_id, user_id, provider, state_hash, code_verifier_enc, expires_at) VALUES (app_tenant_id(), $1, $2, $3, pgp_sym_encrypt($4, $5), $6)`,
    [user.id, provider, sha256Hex(state), verifier, cfg.tokenKey, new Date(exp * 1000)]);
  const q = new URLSearchParams({
    client_id: c.clientId, response_type: 'code', redirect_uri: redirectUri(provider, cfg), scope: ep.scopes.join(' '), state,
    code_challenge: challenge, code_challenge_method: 'S256', login_hint: user.email, ...ep.extraAuthParams,
  });
  return { url: `${ep.authUrl}?${q.toString()}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export class OAuthCallbackError extends Error {
  constructor(readonly reason: string, message?: string) {
    super(message ?? reason);
  }
}

interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }

async function tokenRequest(url: string, body: Record<string, string>, timeoutMs: number): Promise<TokenResponse> {
  const r = await httpCall(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: formBody(body) }, timeoutMs);
  const j = (r.json ?? {}) as TokenResponse;
  if (r.status >= 200 && r.status < 300 && j.access_token) return j;
  throw new HttpError(r.status, `token endpoint ${r.status}: ${j.error ?? ''} ${j.error_description ?? r.text.slice(0, 200)}`.trim(), isRetryableStatus(r.status), j.error);
}

/** GET /api/mail/oauth/:provider/callback — returns the mailbox address; throws OAuthCallbackError(reason). */
export async function completeMailOAuth(
  deps: { config: { jwtSecret: string }; now: () => Date },
  provider: MailOAuthProvider, query: { code?: string; state?: string; error?: string }, cfg: OAuthMailConfig,
): Promise<{ tenantId: string; userId: string; accountId: string; emailAddress: string }> {
  const s = query.state ? verifyToken<StatePayload>(stateKey(deps.config.jwtSecret), query.state) : null;
  if (!s || typeof s.t !== 'string' || typeof s.u !== 'string' || typeof s.e !== 'number') throw new OAuthCallbackError('invalid_state');
  if (s.p !== provider) throw new OAuthCallbackError('invalid_state', 'provider mismatch');
  const now = deps.now();
  if (s.e * 1000 < now.getTime()) throw new OAuthCallbackError('state_expired');
  if (query.error) throw new OAuthCallbackError('denied', query.error);
  if (!query.code || query.code.length > 4096) throw new OAuthCallbackError('missing_code');
  const c = client(provider, cfg);
  const ep = providerEndpoints(provider, cfg);
  // the state row is claimed (single use) in its own committed transaction, so a failed exchange cannot be replayed
  const verifier = await withTenant(s.t, { type: 'user', id: s.u }, async (db) => {
    const row = (await db.query(
      `SELECT id, user_id, provider, expires_at, used_at, pgp_sym_decrypt(code_verifier_enc, $2) AS verifier FROM mail_oauth_states WHERE state_hash = $1 FOR UPDATE`,
      [sha256Hex(query.state!), cfg.tokenKey])).rows[0];
    if (!row || row.user_id !== s.u || row.provider !== provider) throw new OAuthCallbackError('invalid_state');
    if (row.used_at) throw new OAuthCallbackError('state_used');
    if (new Date(row.expires_at) < now) throw new OAuthCallbackError('state_expired');
    await db.query('UPDATE mail_oauth_states SET used_at = $2, code_verifier_enc = NULL WHERE id = $1', [row.id, now]);
    return row.verifier as string;
  });
  let tokens: TokenResponse;
  try {
    tokens = await tokenRequest(ep.tokenUrl, {
      grant_type: 'authorization_code', code: query.code, redirect_uri: redirectUri(provider, cfg), client_id: c.clientId, client_secret: c.clientSecret, code_verifier: verifier,
    }, cfg.timeoutMs);
  } catch (e) {
    throw new OAuthCallbackError('token_exchange_failed', (e as Error).message);
  }
  if (!tokens.refresh_token) throw new OAuthCallbackError('no_refresh_token');
  const info = await httpCall(ep.userInfoUrl, { method: 'GET', headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' } }, cfg.timeoutMs);
  const ij = (info.json ?? {}) as { email?: string; email_verified?: boolean; mail?: string | null; userPrincipalName?: string };
  const address = (provider === 'google' ? (ij.email_verified === false ? null : ij.email) : ij.mail || ij.userPrincipalName)?.trim().toLowerCase();
  if (info.status !== 200 || !address) throw new OAuthCallbackError('userinfo_failed');
  return withTenant(s.t, { type: 'user', id: s.u }, async (db) => {
    const u = (await db.query('SELECT id, email, active FROM users WHERE id = $1', [s.u])).rows[0];
    if (!u || !u.active) throw new OAuthCallbackError('user_inactive');
    if (cfg.requireSameAddress && String(u.email).toLowerCase() !== address) throw new OAuthCallbackError('mailbox_mismatch', `${address} ≠ ${u.email}`);
    await db.query(
      `UPDATE user_mail_accounts SET status = 'disconnected', disconnected_at = $2, disconnected_reason = 'replaced', updated_at = $2 WHERE user_id = $1 AND status <> 'disconnected'`,
      [s.u, now]);
    await db.query(`UPDATE user_mail_tokens SET refresh_token_enc = NULL, access_token_enc = NULL, purged_at = $2, updated_at = $2
                     WHERE account_id IN (SELECT id FROM user_mail_accounts WHERE user_id = $1 AND status = 'disconnected') AND purged_at IS NULL`, [s.u, now]);
    const acc = (await db.query(
      `INSERT INTO user_mail_accounts (tenant_id, user_id, provider, email_address, scopes, connected_at) VALUES (app_tenant_id(), $1, $2, $3, $4, $5) RETURNING id`,
      [s.u, provider, address, (tokens.scope ?? ep.scopes.join(' ')).split(/\s+/).filter(Boolean), now])).rows[0];
    await db.query(
      `INSERT INTO user_mail_tokens (tenant_id, account_id, refresh_token_enc, access_token_enc, access_expires_at)
       VALUES (app_tenant_id(), $1, pgp_sym_encrypt($2, $4), pgp_sym_encrypt($3, $4), $5)`,
      [acc.id, tokens.refresh_token, tokens.access_token, cfg.tokenKey, new Date(now.getTime() + Number(tokens.expires_in ?? 3600) * 1000)]);
    return { tenantId: s.t, userId: s.u, accountId: acc.id as string, emailAddress: address };
  });
}

export interface MailAccountView { id: string; provider: MailOAuthProvider; emailAddress: string; status: string; connectedAt: string; lastUsedAt: string | null; lastError: string | null }

export async function listMailAccounts(ctx: Ctx): Promise<MailAccountView[]> {
  const { rows } = await ctx.db.query(
    `SELECT * FROM user_mail_accounts WHERE user_id = $1 AND status <> 'disconnected' ORDER BY connected_at DESC`, [ctx.user!.id]);
  return rows.map((r) => ({ id: r.id, provider: r.provider, emailAddress: r.email_address, status: r.status, connectedAt: new Date(r.connected_at).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null, lastError: r.last_error }));
}

/** Disconnect (own account, or admin for anyone in the tenant): status → disconnected, tokens emptied, Google token revoked. */
export async function disconnectMailAccount(ctx: Ctx, accountId: string, cfg: OAuthMailConfig): Promise<{ ok: true }> {
  const user = ctx.user!;
  const acc = (await ctx.db.query(
    `SELECT a.*, pgp_sym_decrypt(t.refresh_token_enc, $2) AS refresh FROM user_mail_accounts a LEFT JOIN user_mail_tokens t ON t.account_id = a.id WHERE a.id = $1 FOR UPDATE OF a`,
    [accountId, cfg.tokenKey])).rows[0];
  if (!acc) throw notFound('E-posta hesabı');
  if (acc.user_id !== user.id && user.role !== 'admin') throw forbidden('Yalnızca kendi e-posta hesabınızı ayırabilirsiniz');
  const now = ctx.now();
  if (acc.status !== 'disconnected') {
    await ctx.db.query(`UPDATE user_mail_accounts SET status = 'disconnected', disconnected_at = $2, disconnected_reason = $3, updated_at = $2 WHERE id = $1`,
      [accountId, now, acc.user_id === user.id ? 'user' : 'admin']);
    await ctx.db.query(`UPDATE user_mail_tokens SET refresh_token_enc = NULL, access_token_enc = NULL, access_expires_at = NULL, purged_at = $2, updated_at = $2 WHERE account_id = $1`, [accountId, now]);
    const ep = providerEndpoints(acc.provider, cfg);
    if (ep.revokeUrl && acc.refresh) {
      await httpCall(ep.revokeUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formBody({ token: acc.refresh }) }, cfg.timeoutMs)
        .catch((e) => console.error('[mail-oauth] revoke failed', (e as Error).message));
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------- token store (used by the OAuth e-mail provider)

export interface MailboxAccess { accountId: string; userId: string; provider: MailOAuthProvider; emailAddress: string; token: string }

export class MailboxNeedsReauth extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailboxNeedsReauth';
  }
}

export class OAuthTokenStore {
  constructor(private cfg: OAuthMailConfig, private now: () => Date = () => new Date()) {}

  /** The live (active) mailbox of the user whose address is `fromAddress` in the current tenant, or null. */
  async accountFor(db: Db, fromAddress: string): Promise<{ id: string; user_id: string; provider: MailOAuthProvider; email_address: string } | null> {
    const { rows } = await db.query(
      `SELECT a.id, a.user_id, a.provider, a.email_address FROM user_mail_accounts a JOIN users u ON u.id = a.user_id
        WHERE lower(u.email) = lower($1) AND u.active AND a.status = 'active' ORDER BY a.connected_at DESC LIMIT 1`, [fromAddress]);
    return rows[0] ?? null;
  }

  /** Access token (cached, or refreshed). `force` after a 401. Throws MailboxNeedsReauth / HttpError(retryable). */
  async accessToken(db: Db, accountId: string, opts: { force?: boolean } = {}): Promise<string> {
    const now = this.now();
    const t = (await db.query(
      `SELECT t.id, t.access_expires_at, t.next_refresh_at, t.refresh_failures, a.provider, a.user_id, a.status,
              pgp_sym_decrypt(t.access_token_enc, $2) AS access, pgp_sym_decrypt(t.refresh_token_enc, $2) AS refresh
         FROM user_mail_tokens t JOIN user_mail_accounts a ON a.id = t.account_id WHERE t.account_id = $1 FOR UPDATE OF t`,
      [accountId, this.cfg.tokenKey])).rows[0];
    if (!t || t.status !== 'active' || !t.refresh) throw new MailboxNeedsReauth('mailbox not connected');
    if (!opts.force && t.access && t.access_expires_at && new Date(t.access_expires_at).getTime() - 60_000 > now.getTime()) return t.access;
    if (t.next_refresh_at && new Date(t.next_refresh_at) > now) throw new HttpError(0, 'token refresh backoff', true, 'REFRESH_BACKOFF');
    const provider = t.provider as MailOAuthProvider;
    const c = client(provider, this.cfg);
    try {
      const r = await tokenRequest(providerEndpoints(provider, this.cfg).tokenUrl, {
        grant_type: 'refresh_token', refresh_token: t.refresh, client_id: c.clientId, client_secret: c.clientSecret,
        ...(provider === 'microsoft' ? { scope: providerEndpoints(provider, this.cfg).scopes.join(' ') } : {}),
      }, this.cfg.timeoutMs);
      await db.query(
        `UPDATE user_mail_tokens SET access_token_enc = pgp_sym_encrypt($2, $5), access_expires_at = $3, refresh_failures = 0, next_refresh_at = NULL, updated_at = $4,
                refresh_token_enc = CASE WHEN $6::text IS NULL THEN refresh_token_enc ELSE pgp_sym_encrypt($6::text, $5) END WHERE id = $1`,
        [t.id, r.access_token, new Date(now.getTime() + Number(r.expires_in ?? 3600) * 1000), now, this.cfg.tokenKey, r.refresh_token ?? null]);
      return r.access_token!;
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(0, String(e), true);
      if (!err.retryable && (err.code === 'invalid_grant' || err.status === 400 || err.status === 401)) {
        await this.markNeedsReauth(db, accountId, t.user_id, err.message);
        throw new MailboxNeedsReauth(err.message);
      }
      const failures = Number(t.refresh_failures) + 1;
      await db.query('UPDATE user_mail_tokens SET refresh_failures = $2, next_refresh_at = $3, updated_at = $4 WHERE id = $1',
        [t.id, failures, new Date(now.getTime() + retryDelayMs(failures)), now]);
      throw new HttpError(err.status, `token refresh failed: ${err.message}`, true, 'REFRESH_FAILED');
    }
  }

  async markUsed(db: Db, accountId: string): Promise<void> {
    await db.query('UPDATE user_mail_accounts SET last_used_at = $2, last_error = NULL WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < $2::timestamptz - interval \'1 hour\' OR last_error IS NOT NULL)', [accountId, this.now()]);
  }

  async markNeedsReauth(db: Db, accountId: string, userId: string, error: string): Promise<void> {
    const now = this.now();
    const r = await db.query(`UPDATE user_mail_accounts SET status = 'needs_reauth', last_error = $2, updated_at = $3 WHERE id = $1 AND status = 'active'`, [accountId, error.slice(0, 300), now]);
    await db.query('UPDATE user_mail_tokens SET access_token_enc = NULL, refresh_token_enc = NULL, purged_at = $2 WHERE account_id = $1', [accountId, now]);
    if (r.rowCount) await notifyUserDirect(db, userId, 'E-posta hesabınızı yeniden bağlayın', 'Posta kutunuzun izni sona erdi; mesajlar gönderilemiyor. Profil → "E-posta hesabını bağla".', 'user_mail_account', accountId, now);
  }
}

/** Critical notification for one user from a provider (no Ctx available): stored + delivered like notify(). */
export async function notifyUserDirect(db: Db, userId: string, title: string, body: string, entityType: string, entityId: string | null, now: Date): Promise<void> {
  await db.query('SAVEPOINT notify_direct');
  try {
    const t = (await db.query(
      `INSERT INTO notifications (tenant_id, user_id, priority, title, body, entity_type, entity_id, status, deliver_after, sent_at)
       VALUES (app_tenant_id(), $1, 'critical', $2, $3, $4, $5, 'sent', $6, $6) RETURNING tenant_id`, [userId, title, body, entityType, entityId, now])).rows[0];
    await db.query('RELEASE SAVEPOINT notify_direct');
    await getNotificationService().deliver({ tenantId: t.tenant_id, userId, title, body, priority: 'critical', url: '/' }, db);
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT notify_direct').catch(() => {});
    console.error('[mail-oauth] notification failed', (e as Error).message);
  }
}
