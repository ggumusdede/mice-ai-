// Web Push (§15 bildirim): subscribe this device with the server's VAPID key; the service worker (public/sw.js) shows
// the notification and opens the decision inbox on click. iOS / iPadOS only allow push for home-screen web apps (16.4+).
import { request } from '../api/client';

export type PushState = 'unsupported' | 'ios_needs_install' | 'denied' | 'disabled_on_server' | 'off' | 'on';

/** base64url (VAPID public key) → Uint8Array for PushManager.subscribe. Pure. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** iPhone / iPad (incl. iPadOS that reports "Macintosh" with touch). Pure. */
export function isIos(ua: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

/** Pure decision used by the profile sheet. */
export function pushStateFor(env: { supported: boolean; ios: boolean; standalone: boolean; permission: NotificationPermission | 'unknown'; serverEnabled: boolean; subscribed: boolean }): PushState {
  if (env.ios && !env.standalone) return 'ios_needs_install';
  if (!env.supported) return 'unsupported';
  if (!env.serverEnabled) return 'disabled_on_server';
  if (env.permission === 'denied') return 'denied';
  return env.subscribed && env.permission === 'granted' ? 'on' : 'off';
}

function supported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function standalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js').catch(() => null));
}

async function serverKey(): Promise<string | null> {
  const r = await request<{ enabled: boolean; publicKey: string | null }>('GET', '/push/vapid-public-key');
  return r.enabled ? r.publicKey : null;
}

export async function currentPushState(): Promise<PushState> {
  const ios = isIos(navigator.userAgent, navigator.maxTouchPoints);
  const isSupported = supported();
  if (!isSupported || (ios && !standalone())) return pushStateFor({ supported: isSupported, ios, standalone: standalone(), permission: 'unknown', serverEnabled: true, subscribed: false });
  const key = await serverKey().catch(() => null);
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return pushStateFor({ supported: true, ios, standalone: standalone(), permission: Notification.permission, serverEnabled: !!key, subscribed: !!sub });
}

/** Must be called from a user gesture (iOS requirement). */
export async function enablePush(): Promise<PushState> {
  const key = await serverKey();
  if (!key) return 'disabled_on_server';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource }));
  await request('POST', '/push/subscribe', { subscription: sub.toJSON(), userAgent: navigator.userAgent.slice(0, 300) });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await request('POST', '/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
  }
  return 'off';
}
