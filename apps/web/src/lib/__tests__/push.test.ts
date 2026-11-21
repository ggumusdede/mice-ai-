import { describe, expect, it } from 'vitest';
import { isIos, pushStateFor, urlBase64ToUint8Array } from '../push';

describe('web push helpers', () => {
  it('decodes a base64url VAPID key', () => {
    const k = urlBase64ToUint8Array('BAlfnGtnBKcC5J_c56TsVAkgQVvfLJpMAsiMnOoolBY3JyRf-nJGCIz9FvJEndQQ0fcLsS_Jf0jzIAdx1xatbDA');
    expect(k).toHaveLength(65); // uncompressed P-256 point
    expect(k[0]).toBe(4);
  });
  it('detects iOS incl. iPadOS desktop UA', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
  });
  it('iOS outside the home screen gets the install hint; otherwise permission / subscription decide', () => {
    const base = { supported: true, ios: false, standalone: false, permission: 'default' as const, serverEnabled: true, subscribed: false };
    expect(pushStateFor({ ...base, ios: true, supported: false })).toBe('ios_needs_install');
    expect(pushStateFor({ ...base, ios: true, standalone: true })).toBe('off');
    expect(pushStateFor({ ...base, supported: false })).toBe('unsupported');
    expect(pushStateFor({ ...base, serverEnabled: false })).toBe('disabled_on_server');
    expect(pushStateFor({ ...base, permission: 'denied' })).toBe('denied');
    expect(pushStateFor({ ...base, permission: 'granted', subscribed: true })).toBe('on');
  });
});
