// v0.5 S-15 "Günün paketi": one button downloads today's pack (name + room + transfer group + phone), the device keeps it
// encrypted; offline the list still opens until it expires. Revoked / expired packs are wiped as soon as the device is online.
// Read-only: nothing that needs an approval can be done from here.
import { useCallback, useEffect, useState } from 'react';
import type { FieldPackData } from '@mice/shared';
import { errorMessage } from '../api/client';
import { useOnline } from '../api/hooks';
import { teamApi } from '../api/teamClient';
import { BrowserPackStore, decryptPack, encryptPack, importPackKey, packExpired, searchPack, type PackStore } from '../lib/fieldPack';
import { dateTime } from '../lib/format';
import { Button, Callout, InlineError } from './ui';

const store: PackStore = new BrowserPackStore();

export function FieldPackCard() {
  const online = useOnline();
  const [data, setData] = useState<FieldPackData | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  const loadLocal = useCallback(async () => {
    const s = await store.load().catch(() => null);
    if (!s) { setData(null); return; }
    if (packExpired(s.pack)) { await store.wipe(); setData(null); setInfo('Paketin süresi doldu ve cihazdan silindi.'); return; }
    try {
      setData(await decryptPack(s.pack, s.key));
    } catch {
      await store.wipe();
      setData(null);
    }
  }, []);

  // remote revoke: online → ask the server; invalid → wipe
  useEffect(() => {
    void (async () => {
      await loadLocal();
      if (!online) return;
      const s = await store.load().catch(() => null);
      if (!s) return;
      try {
        const st = await teamApi.packStatus(s.pack.packId);
        if (!st.valid) {
          await store.wipe();
          setData(null);
          setInfo(st.reason === 'revoked' ? 'Paket yönetici tarafından iptal edildi ve cihazdan silindi.' : 'Paketin süresi doldu ve cihazdan silindi.');
        }
      } catch { /* offline / transient: keep the encrypted pack */ }
    })();
  }, [online, loadLocal]);

  const download = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await teamApi.issuePack();
      const key = await importPackKey(r.key);
      await store.save(await encryptPack(r.pack, key), key);
      setData(r.pack);
      setInfo('Paket bu cihaza şifreli kaydedildi. İnternet olmasa da açılır.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const guests = data ? searchPack(data, q) : [];
  const total = data ? data.projects.reduce((s, p) => s + p.guests.length, 0) : 0;
  return (
    <section className="field-section" aria-label="Günün paketi">
      <h2 className="section-title">Günün paketi (çevrimdışı)</h2>
      {data ? (
        <div className="stack-sm">
          <p className="muted small">{data.projects.length} proje · {total} kişi · {dateTime(data.expiresAt)} tarihine kadar geçerli</p>
          <Button variant="secondary" onClick={() => setOpen((x) => !x)} aria-expanded={open}>{open ? 'Listeyi gizle' : 'Kişi listesini aç'}</Button>
          {open ? (
            <>
              <input className="input" placeholder="Ad, oda veya grup ara" aria-label="Pakette ara" value={q} onChange={(e) => setQ(e.target.value)} />
              <ul className="simple-list" aria-label="Paket kişileri">
                {guests.slice(0, 300).map((g, i) => (
                  <li key={`${g.project}-${i}`} className="pack-guest">
                    <strong>{g.name}</strong>
                    <span className="mono">{g.room ? `Oda ${g.room}` : ''}</span>
                    <span className="muted small">{g.group ?? '—'} · {g.project}</span>
                    {g.phone ? <a className="small" href={`tel:${g.phone}`}>{g.phone}</a> : <span />}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {online ? <Button variant="ghost" size="sm" busy={busy} onClick={() => void download()}>Paketi yenile</Button> : null}
        </div>
      ) : (
        <div className="stack-sm">
          <p className="muted small">İnternet kesilirse kişi listesi (ad, oda, transfer grubu, telefon) telefonunuzda şifreli kalır.</p>
          <Button icon="cloud" busy={busy} disabled={!online} onClick={() => void download()}>Çevrimdışı için indir</Button>
        </div>
      )}
      {info ? <Callout tone="accent" icon="shield">{info}</Callout> : null}
      <p className="muted small">Onay gerektiren işler çevrimdışı yapılmaz.</p>
      <InlineError message={error} />
    </section>
  );
}
