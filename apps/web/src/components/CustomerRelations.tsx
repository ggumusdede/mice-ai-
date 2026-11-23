// v0.5 K-04 ilişki sahibi + yedek irtibat and S-08 müşteri adı gizleme istisnası (admin) — one collapsed card on the customers page.
import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useApi } from '../api/hooks';
import { teamApi } from '../api/teamClient';
import { Button, Card, InlineError, Pill } from './ui';

export function CustomerRelations() {
  const rel = useApi(() => teamApi.relationships(), []);
  const users = useApi(() => api.users.list(), []);
  const suppliers = useApi(() => api.suppliers.list(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const people = (users.data ?? []).filter((u) => u.active);
  const missing = (rel.data ?? []).filter((r) => r.missingBackup).length;
  const set = async (customerId: string, b: { ownerId?: string | null; backupId?: string | null }) => {
    setError(null);
    try { await teamApi.setRelationship(customerId, b); await rel.reload(); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <Card title="İlişki sahibi ve gizlilik istisnaları">
      <p className="muted small">Her müşteride bir ilişki sahibi ve bir yedek irtibat olsun; biri ayrılırsa ilişki kopmaz.{missing ? ` ${missing} müşteride yedek eksik.` : ''}</p>
      <details className="more">
        <summary>Müşterileri düzenle ({rel.data?.length ?? 0})</summary>
        <ul className="simple-list">
          {(rel.data ?? []).map((r) => (
            <li key={r.customerId} className="simple-item">
              <span className="simple-item__main"><span className="simple-item__title">{r.customerName}</span> {r.missingBackup ? <Pill tone="warning">Yedek yok</Pill> : null}</span>
              <div className="row-wrap" style={{ flexBasis: '100%' }}>
                {(['ownerId', 'backupId'] as const).map((k) => (
                  <label key={k} className="field">
                    <span className="field__label">{k === 'ownerId' ? 'İlişki sahibi' : 'Yedek irtibat'}</span>
                    <select className="input select" value={(k === 'ownerId' ? r.ownerId : r.backupId) ?? ''} onChange={(e) => void set(r.customerId, { [k]: e.target.value || null })}>
                      <option value="">—</option>
                      {people.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <button type="button" className="link-btn small" onClick={() => setOpen(open === r.customerId ? null : r.customerId)}>Müşterinin kendi anlaşmalı otelleri</button>
              {open === r.customerId ? <Disclosures customerId={r.customerId} suppliers={(suppliers.data ?? []).map((s) => ({ id: s.id, name: s.name }))} /> : null}
            </li>
          ))}
        </ul>
      </details>
      <InlineError message={error} />
    </Card>
  );
}

function Disclosures({ customerId, suppliers }: { customerId: string; suppliers: { id: string; name: string }[] }) {
  const list = useApi(() => teamApi.disclosures(customerId), [customerId]);
  const [supplierId, setSupplierId] = useState('');
  const [reason, setReason] = useState('Müşterinin kurumsal anlaşmalı oteli');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack-sm" style={{ flexBasis: '100%' }}>
      <p className="muted small">Normalde tedarikçiler müşteri adını görmez. Müşterinin kendi anlaşması olan otel için yönetici istisna açabilir; istediğiniz zaman geri alırsınız.</p>
      {(list.data ?? []).filter((d) => d.active).map((d) => (
        <div key={d.id} className="row"><span>{d.supplierName} — {d.reason}</span>
          <Button size="sm" variant="ghost" onClick={async () => { await teamApi.revokeDisclosure(d.id); await list.reload(); }}>Geri al</Button></div>
      ))}
      <div className="row-wrap">
        <label className="field"><span className="field__label">Otel / tedarikçi</span>
          <select className="input select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Seçin</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="field"><span className="field__label">Gerekçe</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      <Button size="sm" disabled={!supplierId || !reason.trim()} onClick={async () => {
        setError(null);
        try { await teamApi.grantDisclosure(customerId, { supplierId, reason }); setSupplierId(''); await list.reload(); } catch (e) { setError(errorMessage(e)); }
      }}>İstisna aç</Button>
      <InlineError message={error} />
    </div>
  );
}

/** D-2 team rollup for the admin's team-performance page. */
export function TeamRollup({ teams }: { teams: NonNullable<import('@mice/shared').TeamPerformanceReport['teams']> }) {
  if (!teams.length) return null;
  return (
    <Card title="Ekipler">
      <p className="muted small">Teklif kalitesi hazırlayana ve ekibine yazılır.</p>
      <ul className="simple-list">
        {teams.map((t) => (
          <li key={t.teamId} className="simple-item">
            <span className="simple-item__main"><span className="simple-item__title">{t.name}</span> <span className="muted small">({t.memberCount} kişi{t.leaderName ? `, lider ${t.leaderName}` : ''})</span>
              <br /><span className="small">Kazanılan {t.won} / kaybedilen {t.lost} · teklif {t.quotesBuilt} · düzeltme oranı {t.correctionRate == null ? '—' : `%${Math.round(t.correctionRate * 100)}`}</span></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
