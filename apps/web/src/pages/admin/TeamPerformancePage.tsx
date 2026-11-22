import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TeamPerformanceRow } from '@mice/shared';
import { api } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { date, eur, pct, tl, todayISO } from '../../lib/format';
import { Card, EmptyState, ErrorBox, Loading, Pill, Stat } from '../../components/ui';

type Preset = '12m' | '6m' | '3m' | 'ytd' | 'custom';

/** Rolling period (inclusive end = today). */
export function periodFor(preset: Exclude<Preset, 'custom'>, today: string): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  if (preset === 'ytd') return { from: `${y}-01-01`, to: today };
  const months = preset === '12m' ? 12 : preset === '6m' ? 6 : 3;
  return { from: todayISO(new Date(y, m - 1 - months, d + 1)), to: today };
}

const hours = (h: number | null) => (h == null ? '—' : `${h.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sa`);
const realized = (r: Pick<TeamPerformanceRow, 'realizedProfitEur' | 'realizedProfitTry'>) =>
  r.realizedProfitEur == null ? '—' : `${eur(r.realizedProfitEur, 0)}${r.realizedProfitTry != null ? ` · ${tl(r.realizedProfitTry)}` : ''}`;

/** Q7 / §4 karar verisi, §16.7 6. ay yetki gözden geçirmesi — per salesperson (project owner). */
export function TeamPerformancePage() {
  const t = useT();
  const today = todayISO();
  const [preset, setPreset] = useState<Preset>('12m');
  const [custom, setCustom] = useState(() => periodFor('12m', today));
  const period = useMemo(() => (preset === 'custom' ? custom : periodFor(preset, today)), [preset, custom, today]);
  const res = useApi(() => api.reports.teamPerformance(period), [period.from, period.to]);
  const r = res.data;
  const tp = t.teamPerf;
  const rows = r?.rows.filter((x) => x.requests || x.won || x.lost || x.quotesBuilt || x.quotesSent) ?? [];

  return (
    <div className="stack stack--lg tp">
      <Card title={tp.title}>
        <p className="muted small">{tp.subtitle}</p>
        <div className="row tp__period" role="group" aria-label={tp.period}>
          <label className="inline-field">
            <span className="small muted">{tp.period}</span>
            <select className="input select input--sm" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              <option value="12m">{tp.last12}</option>
              <option value="6m">{tp.last6}</option>
              <option value="3m">{tp.last3}</option>
              <option value="ytd">{tp.ytd}</option>
              <option value="custom">{tp.custom}</option>
            </select>
          </label>
          {preset === 'custom' ? (
            <>
              <label className="inline-field"><span className="small muted">{tp.from}</span>
                <input className="input input--sm" type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
              <label className="inline-field"><span className="small muted">{tp.to}</span>
                <input className="input input--sm" type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
            </>
          ) : <span className="small muted">{date(period.from)} – {date(period.to)}</span>}
        </div>
      </Card>
      {res.error ? <ErrorBox error={res.error} onRetry={() => void res.reload()} /> : null}
      {res.loading && !r ? <Loading /> : null}
      {r ? (
        <>
          <div className="stats">
            <Stat label={tp.requests} value={r.totals.requests} />
            <Stat label={tp.quotesSent} value={r.totals.quotesSent} />
            <Stat label={tp.wonLost} value={`${r.totals.won} / ${r.totals.lost}`} sub={`${tp.winRate}: ${pct(r.totals.winRate, 0)}`} />
            <Stat label={tp.quoteTime} value={hours(r.totals.avgQuoteBusinessHours)} sub={`${tp.target}: ${hours(r.totals.quoteTargetBusinessHours)}`}
              tone={r.totals.avgQuoteBusinessHours != null && r.totals.avgQuoteBusinessHours <= r.totals.quoteTargetBusinessHours ? 'success' : 'warning'} />
            {r.financialsVisible ? <Stat label={tp.realized} value={realized(r.totals)} /> : null}
          </div>
          {!rows.length ? <EmptyState icon="info" title={tp.empty} /> : (
            <>
              <div className="table-wrap tp__table">
                <table className="table table--compact">
                  <thead>
                    <tr>
                      <th scope="col">{tp.person}</th>
                      <th scope="col" className="num">{tp.requests}</th>
                      <th scope="col" className="num">{tp.quotesSent}</th>
                      <th scope="col" className="num">{tp.won}</th>
                      <th scope="col" className="num">{tp.lost}</th>
                      <th scope="col" className="num">{tp.winRate}</th>
                      <th scope="col" className="num">{tp.quoteTime}</th>
                      {r.financialsVisible ? <><th scope="col" className="num">{tp.margin}</th><th scope="col" className="num">{tp.markup}</th><th scope="col" className="num">{tp.realized}</th></> : null}
                      <th scope="col" className="num">{tp.correction}</th>
                      <th scope="col" className="num">{tp.approvalFree}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => (
                      <tr key={x.userId} data-user={x.userId}>
                        <td>{x.fullName}{x.historicalProjects ? <span className="small muted"> · {tp.historical(x.historicalProjects)}</span> : null}</td>
                        <td className="num">{x.requests}</td>
                        <td className="num">{x.quotesSent}</td>
                        <td className="num">{x.won}</td>
                        <td className="num">{x.lost}</td>
                        <td className="num">{pct(x.winRate, 0)}</td>
                        <td className={`num ${x.avgQuoteBusinessHours != null && x.avgQuoteBusinessHours > x.quoteTargetBusinessHours ? 'text-warning' : ''}`}>{hours(x.avgQuoteBusinessHours)}</td>
                        {r.financialsVisible ? <><td className="num">{pct(x.avgPlannedMargin)}</td><td className="num">{pct(x.avgPlannedMarkup)}</td><td className="num">{realized(x)}</td></> : null}
                        <td className="num">{pct(x.correctionRate, 0)} <span className="small muted">({x.quotesCorrected}/{x.quotesReviewed})</span></td>
                        <td className="num">{x.approvalRequiredQuotes} / {x.freeQuotes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="tp__cards" aria-label={tp.title}>
                {rows.map((x) => (
                  <li key={x.userId} className="card card--padded tp__card" data-user={x.userId}>
                    <div className="tp__card-head"><strong>{x.fullName}</strong><Pill tone={x.winRate != null && x.winRate >= 0.5 ? 'success' : 'neutral'}>{tp.winRate}: {pct(x.winRate, 0)}</Pill></div>
                    <dl className="tp__kv">
                      <dt>{tp.requests}</dt><dd>{x.requests}</dd>
                      <dt>{tp.quotesSent}</dt><dd>{x.quotesSent}</dd>
                      <dt>{tp.wonLost}</dt><dd>{x.won} / {x.lost}</dd>
                      <dt>{tp.quoteTime}</dt><dd>{hours(x.avgQuoteBusinessHours)} <span className="muted">/ {hours(x.quoteTargetBusinessHours)}</span></dd>
                      {r.financialsVisible ? <><dt>{tp.margin}</dt><dd>{pct(x.avgPlannedMargin)}</dd><dt>{tp.markup}</dt><dd>{pct(x.avgPlannedMarkup)}</dd><dt>{tp.realized}</dt><dd>{realized(x)}</dd></> : null}
                      <dt>{tp.correction}</dt><dd>{pct(x.correctionRate, 0)} ({x.quotesCorrected}/{x.quotesReviewed})</dd>
                      <dt>{tp.approvalFree}</dt><dd>{x.approvalRequiredQuotes} / {x.freeQuotes}</dd>
                      {x.historicalProjects ? <><dt>{tp.historicalLabel}</dt><dd>{x.historicalProjects}</dd></> : null}
                    </dl>
                  </li>
                ))}
              </ul>
              {rows.some((x) => x.lost) ? (
                <Card title={tp.lostTitle}>
                  {rows.filter((x) => x.lost).map((x) => (
                    <details key={x.userId} className="details tp__lost">
                      <summary>{x.fullName} — {tp.lostCount(x.lost)}</summary>
                      <div className="chips">{x.lostReasons.map((lr) => <Pill key={lr.reason} tone="danger">{lr.reason} · {lr.count}</Pill>)}</div>
                      <ul className="list">
                        {x.lostProjects.map((l) => (
                          <li key={l.projectId} className="list__row">
                            <div>
                              {l.historical ? <span className="mono">{l.code}</span> : <Link className="mono" to={`/projeler/${l.projectId}`}>{l.code}</Link>}
                              <div className="small muted">{l.customerName ?? l.title}</div>
                            </div>
                            <div className="list__end small">{l.lostReason ?? '—'}{l.decidedAt ? <span className="muted"> · {date(l.decidedAt)}</span> : null}</div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </Card>
              ) : null}
            </>
          )}
          <p className="small muted">{tp.footnote}</p>
        </>
      ) : null}
    </div>
  );
}
