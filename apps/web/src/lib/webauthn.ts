// §15 Onay hareketi: tek dokunuş + Face ID (WebAuthn step-up) for money/contract decisions.
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { DecisionInput } from '@mice/shared';
import { api } from '../api/client';

type AuthOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];
type RegOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

/** Server may return the options directly or wrapped ({options} / {optionsJSON}). */
function unwrap<T>(resp: Record<string, unknown>): T {
  const inner = (resp.optionsJSON ?? resp.options ?? resp) as T;
  return inner;
}

export function webauthnSupported(): boolean {
  try {
    return typeof window !== 'undefined' && window.isSecureContext && browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!webauthnSupported()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

/** Runs the Face ID / Touch ID assertion and returns the DecisionInput.biometric payload. */
export async function biometricAssertion(decisionId?: string): Promise<NonNullable<DecisionInput['biometric']>> {
  const opts = unwrap<AuthOptions>(await api.auth.webauthnAuthOptions(decisionId ? { decisionId } : undefined));
  const assertion = await startAuthentication({ optionsJSON: opts });
  return { method: 'webauthn', assertion };
}

/** Register this device's platform authenticator for the logged-in user (the server re-checks the password first). */
export async function registerBiometric(password: string): Promise<boolean> {
  const opts = unwrap<RegOptions>(await api.auth.webauthnRegisterOptions(password));
  const response = await startRegistration({ optionsJSON: opts });
  const r = await api.auth.webauthnRegisterVerify(response, deviceLabel());
  return !!r?.verified;
}

/** A short device descriptor stored with the decision (kim / ne zaman / hangi cihaz). */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  let dev = 'Web';
  if (/iPhone/.test(ua)) dev = 'iPhone';
  else if (/iPad/.test(ua)) dev = 'iPad';
  else if (/Android/.test(ua)) dev = 'Android';
  else if (/Macintosh/.test(ua)) dev = 'Mac';
  else if (/Windows/.test(ua)) dev = 'Windows';
  return `${dev}${standalone ? ' (PWA)' : ''}`;
}
