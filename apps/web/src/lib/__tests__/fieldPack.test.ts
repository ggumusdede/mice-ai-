import { describe, expect, it } from 'vitest';
import type { FieldPackData } from '@mice/shared';
import { decryptPack, encryptPack, importPackKey, MemoryPackStore, packExpired, searchPack } from '../fieldPack';
import { isApprovalPath, makeQueued } from '../offlineQueue';

const data: FieldPackData = {
  packId: 'p1', date: '2026-11-24', issuedAt: '2026-11-24T05:00:00Z', expiresAt: '2026-11-25T09:00:00Z', userName: 'Saha',
  projects: [{ id: 'x', code: 'PRJ-1', title: 'Bayi', venue: null, startDate: null, endDate: null, guests: [{ name: 'Şükrü Öztürk', room: '204', group: 'Otobüs 1', phone: '+90532' }] }],
};
const key32 = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

describe('S-15 çevrimdışı saha paketi (cihazda şifreli)', () => {
  it('şifreler / çözer; şifreli metin kişisel veri içermez', async () => {
    const key = await importPackKey(key32());
    const s = await encryptPack(data, key);
    expect(s.ct).not.toContain('Şükrü');
    expect(atob(s.ct)).not.toContain('204');
    expect(await decryptPack(s, key)).toEqual(data);
  });
  it('anahtar dışa aktarılamaz; yanlış anahtar veya değiştirilmiş paket açılmaz', async () => {
    const key = await importPackKey(key32());
    expect(key.extractable).toBe(false);
    const s = await encryptPack(data, key);
    await expect(decryptPack(s, await importPackKey(key32()))).rejects.toBeTruthy();
    await expect(decryptPack({ ...s, packId: 'başka' }, key)).rejects.toBeTruthy();
    await expect(importPackKey(btoa('kisa'))).rejects.toThrow();
  });
  it('süre sonu ve arama', async () => {
    expect(packExpired({ expiresAt: '2026-11-25T09:00:00Z' }, new Date('2026-11-25T08:59:00Z'))).toBe(false);
    expect(packExpired({ expiresAt: '2026-11-25T09:00:00Z' }, new Date('2026-11-25T09:00:00Z'))).toBe(true);
    expect(searchPack(data, 'sukru')).toHaveLength(1);
    expect(searchPack(data, '204')).toHaveLength(1);
    expect(searchPack(data, 'otobüs 2')).toHaveLength(0);
  });
  it('uzaktan iptalde silinir (store)', async () => {
    const st = new MemoryPackStore();
    const key = await importPackKey(key32());
    await st.save(await encryptPack(data, key), key);
    expect(await st.load()).not.toBeNull();
    await st.wipe();
    expect(await st.load()).toBeNull();
  });
  it('onay gerektiren hiçbir istek çevrimdışı kuyruğa girmez', () => {
    for (const p of ['/decisions/1/decide', '/decisions/batch-approve', '/quotes/1/approve', '/drafts/1/send', '/contracts/1/sign', '/handovers/1/read']) {
      expect(isApprovalPath(p)).toBe(true);
      expect(() => makeQueued({ method: 'POST', path: p, body: {}, label: 'x' })).toThrow(/çevrimdışı/);
    }
    expect(isApprovalPath('/projects/1/field-extras')).toBe(false);
    expect(isApprovalPath('/projects/1/field-issues')).toBe(false);
  });
});
