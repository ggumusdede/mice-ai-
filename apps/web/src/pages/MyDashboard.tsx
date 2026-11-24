// v0.5 S-10 / S-11 / S-12 / S-14 "Benim panom": own figures only (no names, no ranking), optional estimated bonus, the agency's
// promise-keeping score, handovers to me, my quiet hours. Plain, one card per topic.
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { errorMessage } from '../api/client';
import { useApi } from '../api/hooks';
import { teamApi } from '../api/teamClient';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/AppShell';
import { Card, ErrorBox, InlineError, Loading, Stat } from '../components/ui';
import { eur, pct } from '../lib/format';

export function MyDashboardPage() {
  const { user } = useAuth();
  const perf = useApi(() => teamApi.myPerformance(), []);
  const promise = useApi(() => (user?.role === 'field' ? Promise.resolve(null) : teamApi.promiseKeeping()), [user?.role]);
  const handovers = useApi(() => teamApi.handovers(), []);
  const mineHandovers = (handovers.data ?? []).filter((h) => h.toUserId === user?.id && h.status !== 'cancelled');
  const r = perf.data?.row;
  return (
    <div className="page mobile-page">
      <PageHeader title="Benim panom" subtitle={perf.data ? `${perf.data.from} – ${perf.data.to}${perf.data.teamName ? ` · ${perf.data.teamName}` : ''}` : undefined} />
      <div className="stack stack--lg">
        {mineHandovers.length ? (
          <Card title="Size devredilen işler">
            <ul className="simple-list">
              {mineHandovers.map((h) => (
                <li key={h.id} className="simple-item">
                  <span className="simple-item__main">{h.fromName}: {h.package.projects.length} proje · okundu %{h.readPct}</span>
                  <Link className="btn btn--primary btn--sm" to={`/devir/${h.id}`}>Paketi aç</Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        {perf.error && !perf.data ? <ErrorBox error={perf.error} onRetry={() => void perf.reload()} /> : null}
        {!perf.data && perf.loading ? <Loading /> : null}
        {perf.data ? (
          <Card title="Kendi rakamlarım">
            {r ? (
              <div className="rules-grid">
                <Stat label="Talep" value={r.requests} />
                <Stat label="Gönderilen teklif" value={r.quotesSent} />
                <Stat label="Kazanılan / kaybedilen" value={`${r.won} / ${r.lost}`} />
                <Stat label="Kazanma oranı" value={r.winRate == null ? '—' : pct(r.winRate)} />
                <Stat label="Ort. teklif süresi (iş saati)" value={r.avgQuoteBusinessHours ?? '—'} sub={`hedef ${r.quoteTargetBusinessHours} sa`} />
                {r.realizedProfitEur != null ? <Stat label="Gerçekleşen kâr" value={eur(r.realizedProfitEur)} /> : null}
              </div>
            ) : <p className="muted small">Bu dönemde size ait kayıt yok.</p>}
            {perf.data.estimatedBonus ? (
              <div className="stack-sm">
                <Stat label="Tahmini prim" value={eur(perf.data.estimatedBonus.amount)} tone="accent" />
                <p className="muted small">{perf.data.estimatedBonus.explanation}</p>
              </div>
            ) : null}
            <p className="muted small">{perf.data.note} Başkalarının rakamlarını ve sıralamayı görmezsiniz.</p>
          </Card>
        ) : null}
        {promise.data ? (
          <Card title="Tedarikçiye söz tutma (acenta)">
            <p className="big-number">{promise.data.agency.score == null ? '—' : `${promise.data.agency.score}/100`}</p>
            <p className="muted small">Zamanında ödenen tedarikçi ödemeleri {promise.data.agency.paymentsOnTime}/{promise.data.agency.paymentsDue} · son tarihten önce ele alınan opsiyonlar {promise.data.agency.optionsHandled}/{promise.data.agency.optionsDue}. {promise.data.note}</p>
          </Card>
        ) : null}
        <QuietHoursCard />
        <p className="small"><Link to="/olcum">Sistem neyi ölçer, neyi ölçmez?</Link></p>
      </div>
    </div>
  );
}

function QuietHoursCard() {
  const pref = useApi(() => teamApi.myPreferences(), []);
  const [error, setError] = useState<string | null>(null);
  if (!pref.data) return null;
  const own = pref.data.quietHours;
  const eff = own ?? pref.data.agencyQuietHours;
  const save = async (q: typeof own) => {
    setError(null);
    try { pref.setData(await teamApi.setMyPreferences(q)); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    <Card title="Bildirimler">
      <label className="row">
        <input type="checkbox" checked={eff.enabled} onChange={(e) => void save({ ...eff, enabled: e.target.checked })} />
        <span>Sessiz saat {eff.enabled ? `(${eff.start}–${eff.end})` : ''}<br /><span className="muted small">Kapalıyken bildirimler her zaman gelir. Açıkken rutin özetler bekler; kritik olanlar ve nöbet her zaman gelir.</span></span>
      </label>
      {eff.enabled ? (
        <span className="row">
          <input aria-label="Başlangıç" className="input" type="time" value={eff.start} onChange={(e) => void save({ ...eff, start: e.target.value })} />
          <input aria-label="Bitiş" className="input" type="time" value={eff.end} onChange={(e) => void save({ ...eff, end: e.target.value })} />
        </span>
      ) : null}
      {own ? <button type="button" className="link-btn small" onClick={() => void save(null)}>Acenta ayarına dön</button> : null}
      <InlineError message={error} />
    </Card>
  );
}
