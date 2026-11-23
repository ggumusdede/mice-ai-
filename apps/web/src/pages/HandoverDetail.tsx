// v0.5 K-05 devir paketi: the recipient goes through every project and taps "Okudum"; admin sees progress.
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useApi } from '../api/hooks';
import { teamApi } from '../api/teamClient';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { Button, Card, ErrorBox, Loading, Pill } from '../components/ui';
import { date } from '../lib/format';

export function HandoverDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const h = useApi(() => teamApi.handover(id), [id]);
  if (h.error && !h.data) return <div className="page"><ErrorBox error={h.error} onRetry={() => void h.reload()} /></div>;
  if (!h.data) return <Loading />;
  const d = h.data;
  const mine = user?.id === d.toUserId;
  const read = new Set(d.readProjectIds);
  return (
    <div className="page mobile-page">
      <PageHeader title="Devir paketi" subtitle={`${d.fromName} → ${d.toName} · okundu %${d.readPct}`} />
      <div className="progress" aria-label={`Okundu %${d.readPct}`}><span style={{ width: `${d.readPct}%` }} /></div>
      <div className="stack stack--lg">
        <Card title={`Projeler (${d.package.projects.length})`}>
          {mine ? <p className="muted small">Her projeyi açıp inceleyin, sonra "Okudum" deyin.</p> : null}
          <ul className="simple-list">
            {d.package.projects.map((p) => (
              <li key={p.id} className="simple-item">
                <span className="simple-item__main"><Link to={`/projeler/${p.id}`} className="simple-item__title">{p.code}</Link><br /><span className="muted small">{p.title}{p.startDate ? ` · ${date(p.startDate)}` : ''}</span></span>
                {read.has(p.id) ? <Pill tone="success" icon="check">Okundu</Pill> : mine ? (
                  <Button size="sm" icon="check" onClick={async () => {
                    try { h.setData(await teamApi.markRead(d.id, p.id)); toast('Okundu olarak işaretlendi'); } catch (e) { toast(errorMessage(e)); }
                  }}>Okudum</Button>
                ) : <Pill>Bekliyor</Pill>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title={`Yaklaşan son tarihler (${d.package.deadlines.length})`}>
          {d.package.deadlines.length ? (
            <ul className="simple-list">{d.package.deadlines.map((x, i) => <li key={i} className="simple-item"><span className="simple-item__main">{x.title}<br /><span className="muted small">{x.projectCode ?? ''} · {date(String(x.dueAt).slice(0, 10))}</span></span></li>)}</ul>
          ) : <p className="muted small">Yok.</p>}
        </Card>
        <details className="more">
          <summary>Müşteriler ({d.package.customers.length}) ve bekleyen kararlar ({d.package.pendingDecisions.length})</summary>
          <ul className="simple-list">
            {d.package.customers.map((c) => <li key={c.id} className="simple-item">{c.name} · {c.role === 'owner' ? 'ilişki sahibi' : 'yedek'}{c.backupName ? ` · yedek: ${c.backupName}` : ''}</li>)}
            {d.package.pendingDecisions.map((x) => <li key={x.id} className="simple-item">{x.summary}</li>)}
          </ul>
        </details>
      </div>
    </div>
  );
}
