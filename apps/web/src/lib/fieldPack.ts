// v0.5 S-15 / K-24 çevrimdışı saha paketi — on the device the pack exists ONLY encrypted (AES-256-GCM, WebCrypto). The key comes
// from the server session once (POST /api/field/packs) and is kept as a NON-EXTRACTABLE CryptoKey in IndexedDB (falls back to
// memory); the ciphertext sits in localStorage. Read-only: approvals are never possible offline. Remote revoke / expiry: whenever
// the device is online it asks /api/field/packs/:id/status and wipes the pack when it is no longer valid; offline, the pack
// refuses to open after its expiry time.
import type { FieldPackData } from '@mice/shared';

export interface StoredPack {
  packId: string;
  date: string;
  expiresAt: string;
  userName: string;
  savedAt: string;
  iv: string;
  ct: string;
}

const b64 = (u: Uint8Array) => {
  let s = '';
  for (const c of u) s += String.fromCharCode(c);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('Bu tarayıcı şifreli çevrimdışı paketi desteklemiyor');
  return c.subtle;
}

/** Imports the server-issued raw key as a non-extractable AES-GCM key (it can encrypt / decrypt, never be read back). */
export async function importPackKey(rawB64: string): Promise<CryptoKey> {
  const raw = unb64(rawB64);
  if (raw.length !== 32) throw new Error('Geçersiz paket anahtarı');
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPack(data: FieldPackData, key: CryptoKey, now = new Date()): Promise<StoredPack> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(data.packId);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(JSON.stringify(data))));
  return { packId: data.packId, date: data.date, expiresAt: data.expiresAt, userName: data.userName, savedAt: now.toISOString(), iv: b64(iv), ct: b64(ct) };
}

export async function decryptPack(p: StoredPack, key: CryptoKey): Promise<FieldPackData> {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(p.iv), additionalData: new TextEncoder().encode(p.packId) }, key, unb64(p.ct));
  return JSON.parse(new TextDecoder().decode(pt)) as FieldPackData;
}

export function packExpired(p: Pick<StoredPack, 'expiresAt'>, now = new Date()): boolean {
  return Date.parse(p.expiresAt) <= now.getTime();
}

/** Simple, case/diacritic-insensitive search over the decrypted pack (name, room, group). */
export function searchPack(data: FieldPackData, q: string): { project: string; name: string; room: string | null; group: string | null; phone: string | null }[] {
  const norm = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const n = norm(q.trim());
  const out: { project: string; name: string; room: string | null; group: string | null; phone: string | null }[] = [];
  for (const p of data.projects) {
    for (const g of p.guests) {
      if (!n || norm(`${g.name} ${g.room ?? ''} ${g.group ?? ''}`).includes(n)) out.push({ project: p.code, ...g });
    }
  }
  return out;
}

// ------------------------------------------------------------------ device storage
export interface PackStore {
  load(): Promise<{ pack: StoredPack; key: CryptoKey } | null>;
  save(pack: StoredPack, key: CryptoKey): Promise<void>;
  wipe(): Promise<void>;
}

export class MemoryPackStore implements PackStore {
  private v: { pack: StoredPack; key: CryptoKey } | null = null;
  async load() { return this.v; }
  async save(pack: StoredPack, key: CryptoKey) { this.v = { pack, key }; }
  async wipe() { this.v = null; }
}

const LS_KEY = 'mice.fieldPack';
const DB = 'mice-field-pack';

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('keys');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('keys', mode);
      const r = fn(tx.objectStore('keys'));
      tx.oncomplete = () => { open.result.close(); resolve(r ? (r.result as T) : undefined); };
      tx.onerror = () => { open.result.close(); reject(tx.error); };
    };
  });
}

/** Browser store: ciphertext in localStorage, the CryptoKey (structured-clonable, non-extractable) in IndexedDB. */
export class BrowserPackStore implements PackStore {
  private memKey: CryptoKey | null = null;
  async load() {
    let raw: string | null = null;
    try { raw = localStorage.getItem(LS_KEY); } catch { /* storage blocked */ }
    if (!raw) return null;
    let key: CryptoKey | null = this.memKey;
    if (!key && typeof indexedDB !== 'undefined') {
      try { key = ((await idb<CryptoKey>('readonly', (s) => s.get('pack'))) ?? null); } catch { key = null; }
    }
    if (!key) return null;
    return { pack: JSON.parse(raw) as StoredPack, key };
  }
  async save(pack: StoredPack, key: CryptoKey) {
    this.memKey = key;
    try { localStorage.setItem(LS_KEY, JSON.stringify(pack)); } catch { /* storage blocked → memory only for this session */ }
    if (typeof indexedDB !== 'undefined') {
      try { await idb('readwrite', (s) => { s.put(key, 'pack'); }); } catch { /* memory only */ }
    }
  }
  async wipe() {
    this.memKey = null;
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    if (typeof indexedDB !== 'undefined') {
      try { await idb('readwrite', (s) => { s.delete('pack'); }); } catch { /* ignore */ }
    }
  }
}
