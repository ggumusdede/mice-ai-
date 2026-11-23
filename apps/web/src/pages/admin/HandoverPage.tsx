// v0.5 K-05 devir-teslim (admin): planned (access closes at the chosen time) or urgent (now; Face ID + reason). The package is
// built from data; the recipient marks every project "okudum". One primary action; history collapsed.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { HandoverInput } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { teamApi } from '../../api/teamClient';
import { biometricAssertion, webauthnSupported } from '../../lib/webauthn';
import { dateTime } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Card, Callout, InlineError, Loading, Pill, Segmented } from '../../components/ui';

const STATUS: Record<string, string> = { scheduled: 'Planlandı', access_closed: 'Erişim kapandı', completed: 'Tamamlandı', cancelled: 'İptal' };

export function HandoverPage() {
  const toast = useToast();
  const users = useApi(() => api.users.list(), []);
  const list = useApi(() => teamApi.handovers(), []);
  const [mode, setMode] = useState<'planned' | 'urgent'>('planned');
  const [f, setF] = useState({ fromUserId: '', toUserId: '', reason: '', effectiveAt: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!users.data) return <Loading />;
  const active = users.data.filter((u) => u.active);
  const sel = (k: 'fromUserId' | 'toUserId', label: string) => (
    <label className="field">
      <span className="field__label">{label}</span>
      <select className="input select" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        <option value="">Seçin</option>
        {active.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
      </select>
    </label>
  );
  const start = async (bio: 'webauthn' | 'dev' | null) => {
    setBusy(true);
    setError(null);
    try {
      const b: HandoverInput = { fromUserId: f.fromUserId, toUserId: f.toUserId, mode, reason: f.reason };
      if (mode === 'planned' && f.effectiveAt) b.effectiveAt = new Date(f.effectiveAt).toISOString();
      if (mode === 'urgent') b.biometric = bio === 'webauthn' ? await biometricAssertion() : { method: 'dev' };
      await teamApi.startHandover(b);
      toast(mode === 'urgent' ? 'Erişim kapatıldı, devir paketi hazır' : 'Devir planlandı');
      setF({ fromUserId: '', toUserId: '', reason: '', effectiveAt: '' });
      await list.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const ready = f.fromUserId && f.toUserId && f.fromUserId !== f.toUserId && f.reason.trim();
  return (
    <div className="stack stack--lg">
      <Card title="Devir-teslim başlat">
        <p className="muted small">Açık projeler, müşteriler, bekleyen kararlar ve yaklaşan son tarihlerden paket hazırlanır. Devralan her projeyi "okudum" diye işaretler. Kayıtlar silinmez; ayrılanın adı geçmişte kalır.</p>
        <div className="row-wrap">{sel('fromUserId', 'Ayrılan / devreden')}{sel('toUserId', 'Devralan')}</div>
        <Segmented label="Tür" value={mode} onChange={setMode} options={[{ value: 'planned', label: 'Planlı' }, { value: 'urgent', label: 'Acil' }]} />
        {mode === 'planned' ? (
          <label className="field"><span className="field__label">Erişim ne zaman kapansın? (boş = şimdi)</span><input className="input" type="datetime-local" value={f.effectiveAt} onChange={(e) => setF({ ...f, effectiveAt: e.target.value })} /></label>
        ) : <Callout tone="warning" icon="faceid">Acil kapatma hemen işler: oturumlar düşer, posta bağlantısı ve saha paketleri iptal edilir. Face ID gerekir.</Callout>}
        <label className="field"><span className="field__label">Gerekçe</span><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="ör. İşten ayrılış" /></label>
        <Button icon={mode === 'urgent' ? 'faceid' : 'check'} busy={busy} disabled={!ready} onClick={() => void start(mode === 'urgent' && webauthnSupported() && !import.meta.env.DEV ? 'webauthn' : 'dev')}>
          {mode === 'urgent' ? 'Face ID ile erişimi kapat' : 'Devri planla'}
        </Button>
        <InlineError message={error} />
      </Card>
      <Card title="Devirler">
        {list.data?.length ? (
          <ul className="simple-list">
            {list.data.map((h) => (
              <li key={h.id} className="simple-item">
                <span className="simple-item__main">
                  <span className="simple-item__title">{h.fromName} → {h.toName}</span> <Pill tone={h.status === 'completed' ? 'success' : h.status === 'cancelled' ? 'neutral' : 'accent'}>{STATUS[h.status]}</Pill>
                  <br /><span className="muted small">{h.mode === 'urgent' ? 'Acil' : 'Planlı'} · {dateTime(h.effectiveAt)} · okundu %{h.readPct}</span>
                  <div className="progress" aria-label={`Okundu %${h.readPct}`}><span style={{ width: `${h.readPct}%` }} /></div>
                </span>
                <Link className="btn btn--secondary btn--sm" to={`/devir/${h.id}`}>Paketi aç</Link>
                {h.status === 'scheduled' ? <Button size="sm" variant="ghost" onClick={async () => { await teamApi.cancelHandover(h.id); await list.reload(); }}>İptal</Button> : null}
              </li>
            ))}
          </ul>
        ) : <p className="muted small">Henüz devir yok.</p>}
      </Card>
    </div>
  );
}
