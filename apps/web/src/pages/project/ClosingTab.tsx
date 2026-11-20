import { useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { dateTime, eur } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Callout, Card, ErrorBox, InlineError, Loading, ProfitBlock, TextArea } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { useProject } from './ProjectContext';

export function ClosingTab() {
  const t = useT();
  const toast = useToast();
  const { detail, reload } = useProject();
  const res = useApi(() => api.projects.closingCheck(detail.project.id), [detail.project.id]);
  const [lessons, setLessons] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = !!detail.project.closedAt;

  return (
    <div className="stack stack--lg">
      {res.error ? <ErrorBox error={res.error} onRetry={() => void res.reload()} /> : null}
      {res.loading && !res.data ? <Loading /> : null}
      {res.data ? (
        <>
          <Card title={t.closing.checklist}>
            <ul className="checklist">
              {res.data.items.map((i) => (
                <li key={i.key} className={`checklist__item ${i.ok ? 'is-ok' : 'is-missing'}`}>
                  <span className="checklist__icon" aria-hidden><Icon name={i.ok ? 'check' : 'x'} size={16} /></span>
                  <span>
                    {i.label}
                    <span className="sr-only">{i.ok ? ' — tamam' : ' — eksik'}</span>
                    {i.detail ? <span className="muted small"> · {i.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={t.closing.planVsActual}>
            <div className="grid-2">
              <ProfitBlock title={t.closing.planned} value={res.data.planVsActual.planned} />
              <ProfitBlock title={t.closing.actual} value={res.data.planVsActual.actual} />
            </div>
            {res.data.planVsActual.deviations.length ? (
              <>
                <h3 className="section-title">{t.closing.deviations}</h3>
                <ul className="list">
                  {res.data.planVsActual.deviations.map((d, i) => (
                    <li key={i} className="list__row"><span>{d.reason}</span><strong className={d.amountEur < 0 ? 'text-danger' : 'text-success'}>{eur(d.amountEur)}</strong></li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>
        </>
      ) : null}

      <Card title={t.closing.lessons}>
        {closed ? (
          <Callout tone="success" icon="check">{t.closing.closed} · {dateTime(detail.project.closedAt)}</Callout>
        ) : (
          <>
            <TextArea label={t.closing.lessons} hint={t.closing.lessonsHint} rows={5} value={lessons} onChange={(e) => setLessons(e.target.value)} />
            {res.data && !res.data.ok ? <Callout tone="warning" icon="alert">{t.closing.notReady}</Callout> : null}
            <InlineError message={error} />
            <div className="row-end">
              <Button icon="check" busy={busy} disabled={!res.data?.ok} onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await api.projects.close(detail.project.id, lessons.trim() || undefined);
                  await reload();
                  toast(t.closing.closed);
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}>{t.closing.close}</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
