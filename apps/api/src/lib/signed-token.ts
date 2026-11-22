// Compact HMAC-signed tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256(key, payload part)).
// Used for the OAuth connect `state` (bound to user + tenant, short TTL) and the push-acknowledge link (§15 fallback).
// The key is derived per purpose from a server secret, so a token for one purpose never verifies for another.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function purposeKey(secret: string, purpose: string): Buffer {
  return createHmac('sha256', secret).update(`mice:${purpose}`).digest();
}

export function signToken(key: Buffer, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Payload when the signature matches (timing-safe), else null. Expiry is checked by the caller. */
export function verifyToken<T = Record<string, unknown>>(key: Buffer, token: string): T | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'utf8');
  const expected = Buffer.from(createHmac('sha256', key).update(body).digest('base64url'), 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return v && typeof v === 'object' ? (v as T) : null;
  } catch {
    return null;
  }
}
