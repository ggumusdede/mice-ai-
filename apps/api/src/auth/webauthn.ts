// §15 Face ID step-up via WebAuthn (platform authenticator). Money & contract decisions require it.
// Dev fallback { method: 'dev' } is accepted only when NODE_ENV !== 'production' or ALLOW_DEV_BIOMETRIC=1.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { DecisionInput } from '@mice/shared';
import type { Ctx } from '../context.js';
import { requireUser } from '../context.js';
import { badRequest, forbidden } from '../errors.js';

const CHALLENGE_TTL_MS = 5 * 60_000;

async function storeChallenge(ctx: Ctx, purpose: 'register' | 'authenticate', challenge: string): Promise<void> {
  const user = requireUser(ctx);
  await ctx.db.query(
    `INSERT INTO auth_challenges (tenant_id, user_id, purpose, challenge, expires_at) VALUES (app_tenant_id(), $1, $2, $3, $4)`,
    [user.id, purpose, challenge, new Date(ctx.now().getTime() + CHALLENGE_TTL_MS)],
  );
}

async function consumeChallenge(ctx: Ctx, purpose: 'register' | 'authenticate'): Promise<string> {
  const user = requireUser(ctx);
  const { rows } = await ctx.db.query(
    `SELECT id, challenge FROM auth_challenges WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > $3
     ORDER BY created_at DESC LIMIT 1`,
    [user.id, purpose, ctx.now()],
  );
  if (!rows[0]) throw forbidden('Doğrulama isteği bulunamadı veya süresi doldu', 'WEBAUTHN_CHALLENGE_MISSING');
  await ctx.db.query('UPDATE auth_challenges SET used_at = now() WHERE id = $1', [rows[0].id]);
  return rows[0].challenge;
}

export async function registrationOptions(ctx: Ctx) {
  const user = requireUser(ctx);
  const { config } = ctx.deps;
  const { rows } = await ctx.db.query('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
  const options = await generateRegistrationOptions({
    rpName: config.webauthn.rpName,
    rpID: config.webauthn.rpId,
    userName: user.email,
    userDisplayName: user.fullName,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: rows.map((r) => ({ id: r.credential_id, transports: r.transports })),
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
  });
  await storeChallenge(ctx, 'register', options.challenge);
  return options;
}

export async function registrationVerify(ctx: Ctx, response: RegistrationResponseJSON, deviceLabel?: string) {
  const user = requireUser(ctx);
  const { config } = ctx.deps;
  const expectedChallenge = await consumeChallenge(ctx, 'register');
  const v = await verifyRegistrationResponse({
    response, expectedChallenge, expectedOrigin: config.webauthn.origins, expectedRPID: config.webauthn.rpId, requireUserVerification: true,
  }).catch((e: Error) => {
    throw badRequest(e.message, undefined, 'WEBAUTHN_INVALID');
  });
  if (!v.verified || !v.registrationInfo) throw badRequest('Kayıt doğrulanamadı', undefined, 'WEBAUTHN_INVALID');
  const c = v.registrationInfo.credential;
  await ctx.db.query(
    `INSERT INTO webauthn_credentials (tenant_id, user_id, credential_id, public_key, counter, transports, device_label, backed_up)
     VALUES (app_tenant_id(), $1, $2, $3, $4, $5, $6, $7)`,
    [user.id, c.id, Buffer.from(c.publicKey), c.counter, c.transports ?? [], deviceLabel ?? null, v.registrationInfo.credentialBackedUp],
  );
  return { verified: true, credentialId: c.id };
}

export async function authenticationOptions(ctx: Ctx) {
  const user = requireUser(ctx);
  const { rows } = await ctx.db.query('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);
  const options = await generateAuthenticationOptions({
    rpID: ctx.deps.config.webauthn.rpId,
    allowCredentials: rows.map((r) => ({ id: r.credential_id, transports: r.transports })),
    userVerification: 'required',
  });
  await storeChallenge(ctx, 'authenticate', options.challenge);
  return { ...options, devFallbackAllowed: ctx.deps.config.allowDevBiometric };
}

export async function verifyAssertion(ctx: Ctx, assertion: AuthenticationResponseJSON): Promise<{ credentialId: string }> {
  const user = requireUser(ctx);
  const { config } = ctx.deps;
  if (!assertion || typeof assertion !== 'object' || typeof assertion.id !== 'string') throw badRequest('Geçersiz WebAuthn yanıtı', undefined, 'WEBAUTHN_INVALID');
  const { rows } = await ctx.db.query(
    'SELECT * FROM webauthn_credentials WHERE user_id = $1 AND credential_id = $2 AND revoked_at IS NULL',
    [user.id, assertion.id],
  );
  if (!rows[0]) throw forbidden('Bu cihaz kayıtlı değil', 'WEBAUTHN_UNKNOWN_CREDENTIAL');
  const expectedChallenge = await consumeChallenge(ctx, 'authenticate');
  const v = await verifyAuthenticationResponse({
    response: assertion, expectedChallenge, expectedOrigin: config.webauthn.origins, expectedRPID: config.webauthn.rpId,
    credential: { id: rows[0].credential_id, publicKey: new Uint8Array(rows[0].public_key), counter: Number(rows[0].counter), transports: rows[0].transports },
    requireUserVerification: true,
  }).catch((e: Error) => {
    throw forbidden(e.message, 'BIOMETRIC_FAILED');
  });
  if (!v.verified) throw forbidden('Biyometrik doğrulama başarısız', 'BIOMETRIC_FAILED');
  await ctx.db.query('UPDATE webauthn_credentials SET counter = $2, last_used_at = now() WHERE id = $1', [rows[0].id, v.authenticationInfo.newCounter]);
  return { credentialId: rows[0].credential_id };
}

/** Step-up check used by the decision inbox. Returns the method used for the decision record. */
export async function verifyStepUp(ctx: Ctx, biometric: DecisionInput['biometric']): Promise<{ method: string; credentialId: string | null }> {
  if (!biometric) throw forbidden('Bu onay Face ID (biyometrik doğrulama) gerektirir', 'BIOMETRIC_REQUIRED');
  if (biometric.method === 'dev') {
    if (!ctx.deps.config.allowDevBiometric) throw forbidden('Geliştirici biyometrik atlaması bu ortamda kapalı', 'BIOMETRIC_REQUIRED');
    return { method: 'dev', credentialId: null };
  }
  if (biometric.method === 'webauthn') {
    const r = await verifyAssertion(ctx, biometric.assertion as AuthenticationResponseJSON);
    return { method: 'webauthn', credentialId: r.credentialId };
  }
  throw forbidden('Bilinmeyen doğrulama yöntemi', 'BIOMETRIC_REQUIRED');
}
