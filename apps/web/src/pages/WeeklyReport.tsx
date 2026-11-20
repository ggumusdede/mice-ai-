import { useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { useT } from '../i18n';
import { date, eur, pct, todayISO, weekStartISO } from '../lib/format';
import { PageHeader } from '../components/AppShell';
import { Sparkline } from '../components/Sparkline';
import { Icon } from '../components/Icon';
import { Card, ErrorBox, Loading, Pill, Stat } from '../components/ui';

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + days));
}
const shiftWeek = (iso: string, weeks: number) => weekStartISO(new Date(`${addDays(iso, weeks * 7)}T12:00:00`));

/** §16.6 Haftalık gelişim raporu — tek ekran. */
export function WeeklyReportPage() {
  const t = useT();
  const [week, setWeek] = useState(() => weekStartISO());
  const res = useApi(() => api.reports.weekly(week), [week]);
  const r = res.data;
  const thisWeek = weekStartISO();

  return (
    <div className="page report">
      <PageHeader
        title={t.report.title}
        actions={
          <div className="weekpicker" role="group" aria-label={t.report.week}>
            <button type="button" className="icon-btn" aria-label="Önceki hafta" onClick={() => setWeek((w) => shiftWeek(w, -1))}><Icon name="chevronLeft" /></button>
            <span className="weekpicker__label">{date(week, { day: 'numeric', month: 'short' })} – {date(addDays(week, 6), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <button type="button" className="icon-btn" aria-label="Sonraki hafta" disabled={week >= thisWeek} onClick={() => setWeek((w) => shiftWeek(w, 1))}><Icon name="chevronRight" /></button>
          </div>
        }
      />
      {res.error ? <ErrorBox error={res.error} onRetry={() => void res.reload()} /> : null}
      {res.loading && !r ? <Loading /> : null}
      {r ? (
        <div className="report__grid">
          <Card title={t.report.quoteTime} className="report__wide">
            <div className="stats">
              <Stat
                label={t.report.median}
                value={r.quoteTime.medianBusinessHours !== null ? t.report.hours(r.quoteTime.medianBusinessHours) : '—'}
                sub={`${t.report.target}: ${t.report.hours(r.quoteTime.targetBusinessHours)}`}
                tone={r.quoteTime.medianBusinessHours !== null && r.quoteTime.medianBusinessHours <= r.quoteTime.targetBusinessHours ? 'success' : 'warning'}
              />
              <Stat label={t.report.onTarget} value={pct(r.quoteTime.onTargetRate, 0)} />
              <Stat label={t.report.customerWait} value={t.report.hours(r.quoteTime.customerWaitHours)} sub="Ayrı satır (§17.10)" />
            </div>
            {r.quoteTime.medianBusinessHours !== null ? (
              <div className="meter" aria-hidden>
                <span className="meter__fill" style={{ width: `${Math.min(100, (r.quoteTime.medianBusinessHours / Math.max(r.quoteTime.targetBusinessHours * 1.5, 1)) * 100)}%` }} />
                <span className="meter__target" style={{ left: `${(1 / 1.5) * 100}%` }} />
              </div>
            ) : null}
            {r.quoteTime.overrides.length ? (
              <details className="details">
                <summary>{t.report.overrides} ({r.quoteTime.overrides.length})</summary>
                <ul className="bullets small">{r.quoteTime.overrides.map((o, i) => <li key={i}><span className="mono">{o.projectCode}</span> — {o.reason}</li>)}</ul>
              </details>
            ) : null}
          </Card>

          <Card title={t.report.corrections}>
            <div className="stats">
              <Stat label={t.report.corrections} value={pct(r.corrections.rate, 0)} />
            </div>
            <div className="spark-wrap">
              <span className="small muted">{t.report.trend}</span>
              <Sparkline values={r.corrections.trend} width={220} height={48} label={t.report.corrections} />
            </div>
          </Card>

          <Card title={t.report.wonLost}>
            <div className="stats">
              <Stat label={t.report.won} value={r.quotes.won} tone="success" />
              <Stat label={t.report.lost} value={r.quotes.lost} tone="danger" />
            </div>
            {r.quotes.lostReasons.length ? (
              <>
                <h3 className="section-title small">{t.report.lostReasons}</h3>
                <ul className="bars">
                  {r.quotes.lostReasons.map((lr) => {
                    const max = Math.max(...r.quotes.lostReasons.map((x) => x.count), 1);
                    return (
                      <li key={lr.reason} className="bars__row">
                        <span className="bars__label">{lr.reason}</span>
                        <span className="bars__track"><span className="bars__fill" style={{ width: `${(lr.count / max) * 100}%` }} /></span>
                        <span className="bars__val">{lr.count}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </Card>

          <Card title={t.report.automation}>
            <div className="stats stats--4">
              <Stat label={t.report.autoCount} value={r.automation.autoCount} />
              <Stat label={t.report.sampled} value={r.automation.sampled} />
              <Stat label={t.report.sampleErrors} value={r.automation.sampleErrors} tone={r.automation.sampleErrors ? 'danger' : undefined} />
              <Stat label={t.report.demotions} value={r.automation.demotions} tone={r.automation.demotions ? 'warning' : undefined} />
            </div>
          </Card>

          <Card title={t.report.unreflected}>
            <div className="stats">
              <Stat label={t.report.unreflected} value={eur(r.unreflectedPriceDiffEur)} tone={r.unreflectedPriceDiffEur > 0 ? 'warning' : undefined} />
            </div>
          </Card>

          <Card title={t.report.pending}>
            <div className="stats">
              <Stat label={t.report.rules} value={r.pending.rules} />
              <Stat label={t.report.automations} value={r.pending.automations} />
              <Stat label={t.report.checklist} value={r.pending.checklist} />
            </div>
          </Card>

          <Card title={t.report.style} className="report__wide">
            {r.styleUpdate ? <p className="pre-line">{r.styleUpdate}</p> : <p className="muted">{t.report.noStyle}</p>}
          </Card>

          {r.rfqOverrides.length ? (
            <Card title={t.report.rfqOverrides} className="report__wide">
              <ul className="list">
                {r.rfqOverrides.map((o, i) => <li key={i} className="list__row"><Pill>{o.projectCode}</Pill><span>{o.reason}</span></li>)}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
