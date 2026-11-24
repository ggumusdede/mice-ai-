import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PROJECT_OUTCOMES, WORKFLOW_STEPS } from '@mice/shared';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { useT } from '../i18n';
import { dateRange, relative } from '../lib/format';
import { PageHeader } from '../components/AppShell';
import { Icon } from '../components/Icon';
import { StepProgress } from '../components/StepProgress';
import { EmptyState, ErrorBox, Loading, Pill, type Tone } from '../components/ui';

const OUTCOME_TONE: Record<string, Tone> = { open: 'accent', won: 'success', lost: 'danger', cancelled: 'neutral', closed: 'neutral' };

export function ProjectsPage() {
  const t = useT();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const step = params.get('step') ?? '';
  const outcome = params.get('outcome') ?? '';
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(h);
  }, [q]);
  const res = useApi(() => api.projects.list({ q: debounced, step, outcome }), [debounced, step, outcome]);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader
        title={t.projects.title}
        actions={
          <Link to="/projeler/yeni" className="btn btn--primary">
            <Icon name="plus" size={18} />
            {t.projects.newRequest}
          </Link>
        }
      />
      <div className="toolbar" role="search">
        <label className="search">
          <Icon name="search" size={18} />
          <span className="sr-only">{t.common.search}</span>
          <input
            className="search__input"
            type="search"
            placeholder={t.projects.searchPlaceholder}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setParam('q', e.target.value);
            }}
          />
        </label>
        <label className="toolbar__filter">
          <span className="sr-only">{t.projects.stepFilter}</span>
          <select className="input select" value={step} onChange={(e) => setParam('step', e.target.value)}>
            <option value="">{t.projects.stepFilter}: {t.common.all}</option>
            {WORKFLOW_STEPS.map((s) => (
              <option key={s.step} value={s.step}>{s.step} · {s.label}</option>
            ))}
          </select>
        </label>
        <label className="toolbar__filter">
          <span className="sr-only">{t.projects.outcomeFilter}</span>
          <select className="input select" value={outcome} onChange={(e) => setParam('outcome', e.target.value)}>
            <option value="">{t.projects.outcomeFilter}: {t.common.all}</option>
            {PROJECT_OUTCOMES.map((o) => <option key={o} value={o}>{t.outcome[o]}</option>)}
          </select>
        </label>
      </div>

      {res.error ? <ErrorBox error={res.error} onRetry={() => void res.reload()} /> : null}
      {!res.data && res.loading ? <Loading /> : null}
      {res.data && !res.data.length ? <EmptyState icon="folder" title={t.projects.empty} /> : null}

      {res.data && res.data.length ? (
        <div className="card table-wrap">
          <table className="table table--hover">
            <thead>
              <tr>
                <th scope="col">{t.projects.code}</th>
                <th scope="col">{t.projects.customer}</th>
                <th scope="col">{t.projects.dates}</th>
                <th scope="col" className="num">{t.projects.pax}</th>
                <th scope="col">{t.projects.step}</th>
                <th scope="col">{t.projects.outcome}</th>
                <th scope="col">{t.projects.received}</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((p) => (
                <tr key={p.id} onClick={() => nav(`/projeler/${p.id}`)} className="is-clickable">
                  <td>
                    <Link to={`/projeler/${p.id}`} className="mono strong" onClick={(e) => e.stopPropagation()}>{p.code}</Link>
                    <div className="muted small">{p.title}</div>
                  </td>
                  <td>{p.customerName ?? '—'}<div className="muted small">{[p.city, p.district].filter(Boolean).join(' / ')}</div></td>
                  <td className="nowrap">{dateRange(p.startDate, p.endDate)}</td>
                  <td className="num">{p.pax ?? '—'}</td>
                  <td><StepProgress step={p.step} compact /></td>
                  <td><Pill tone={OUTCOME_TONE[p.outcome] ?? 'neutral'}>{t.outcome[p.outcome]}</Pill></td>
                  <td className="nowrap muted">{relative(p.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
