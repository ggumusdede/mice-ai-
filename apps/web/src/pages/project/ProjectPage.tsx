import { useMemo, useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { businessDuration, dateRange, staleReason } from '../../lib/format';
import { StepProgress } from '../../components/StepProgress';
import { Icon } from '../../components/Icon';
import { BottomSheet } from '../../components/BottomSheet';
import { useToast } from '../../components/Toast';
import { Button, EmptyState, ErrorBox, Loading, Pill, TextArea, type Tone } from '../../components/ui';
import { ProjectContext } from './ProjectContext';
import { SidePanel } from './SidePanel';
import { AskBar } from './AskBar';
import { OverviewTab } from './OverviewTab';
import { ItemsTab } from './ItemsTab';
import { OffersTab } from './OffersTab';
import { ComparisonTab } from './ComparisonTab';
import { QuoteTab } from './QuoteTab';
import { ContractsTab } from './ContractsTab';
import { OperationsTab } from './OperationsTab';
import { FinanceTab } from './FinanceTab';
import { ClosingTab } from './ClosingTab';
import { FINANCIAL_TABS, useCanSeeFinancials } from '../../lib/visibility';

const TABS = ['overview', 'items', 'offers', 'comparison', 'quote', 'contracts', 'operations', 'finance', 'closing'] as const;
type TabKey = (typeof TABS)[number];
const ALERT_TONE: Record<string, Tone> = { info: 'accent', warning: 'warning', critical: 'danger' };

export function ProjectPage() {
  const t = useT();
  const { id = '', tab = 'overview' } = useParams();
  const res = useApi(() => api.projects.get(id), [id]);
  const ctx = useMemo(() => (res.data ? { detail: res.data, reload: res.reload } : null), [res.data, res.reload]);
  const [outcomeOpen, setOutcomeOpen] = useState<null | 'won' | 'lost'>(null);
  const canSeeFinancials = useCanSeeFinancials();

  if (res.error && !res.data) return <div className="page"><ErrorBox error={res.error} onRetry={() => void res.reload()} /></div>;
  if (!ctx) return <div className="page"><Loading /></div>;

  const { project, customer, alerts, stepTimer } = ctx.detail;
  const tabs = canSeeFinancials ? TABS : TABS.filter((k) => !FINANCIAL_TABS.includes(k));
  const current = (tabs as readonly string[]).includes(tab) ? (tab as TabKey) : 'overview';
  const overTarget = stepTimer.businessMinutesElapsed > stepTimer.targetBusinessMinutes;

  return (
    <ProjectContext.Provider value={ctx}>
      <div className="project">
        <header className="project__head">
          <div className="project__id">
            <div className="project__code mono">{project.code}</div>
            <h1 className="project__title">{customer?.name ?? project.customerName ?? project.title}</h1>
            <div className="project__meta">
              <span>{project.title}</span>
              <span>{dateRange(project.startDate, project.endDate)}</span>
              {project.pax ? <span>{project.pax} kişi</span> : null}
              {project.city ? <span>{[project.city, project.district].filter(Boolean).join(' / ')}</span> : null}
              <Pill tone={project.outcome === 'won' ? 'success' : project.outcome === 'lost' ? 'danger' : 'accent'}>{t.outcome[project.outcome]}</Pill>
            </div>
          </div>
          <div className="project__head-side">
            <div className={`timer ${overTarget ? 'timer--over' : ''}`} title={t.project.timer}>
              <span className="timer__label">{t.project.timer}</span>
              <span className="timer__value">
                {t.project.timerOf(businessDuration(stepTimer.businessMinutesElapsed), businessDuration(stepTimer.targetBusinessMinutes))}
              </span>
              {stepTimer.customerWaitMinutes ? <span className="timer__sub">{t.project.customerWait}: {businessDuration(stepTimer.customerWaitMinutes)}</span> : null}
            </div>
            {project.outcome === 'open' && project.step >= 3 ? (
              <div className="row">
                <Button variant="secondary" size="sm" icon="check" onClick={() => setOutcomeOpen('won')}>{t.project.won}</Button>
                <Button variant="secondary" size="sm" icon="x" onClick={() => setOutcomeOpen('lost')}>{t.project.lost}</Button>
              </div>
            ) : null}
          </div>
        </header>

        <StepProgress step={project.step} />

        <section className="alerts" aria-label={t.project.alerts}>
          {alerts.length ? (
            alerts.map((a, i) => (
              <div key={`${a.code}-${i}`} className={`alert alert--${ALERT_TONE[a.level] ?? 'neutral'}`} role={a.level === 'critical' ? 'alert' : undefined}>
                <Icon name={a.level === 'info' ? 'info' : 'alert'} size={16} />
                <span>{a.code === 'DOCUMENT_STALE' ? alertStale(a.message, t.docKind as Record<string, string>) : a.message}</span>
              </div>
            ))
          ) : (
            <div className="alert alert--neutral"><Icon name="sparkle" size={16} /><span>{t.project.noAlerts}</span></div>
          )}
        </section>

        <nav className="tabs" aria-label="Proje bölümleri">
          {tabs.map((k) => (
            <NavLink key={k} to={`/projeler/${id}/${k === 'overview' ? '' : k}`} end className={() => `tabs__tab ${current === k ? 'is-active' : ''}`} aria-current={current === k ? 'page' : undefined}>
              {t.project.tabs[k]}
            </NavLink>
          ))}
        </nav>

        <div className="project__body">
          <div className="project__main">
            {current === 'overview' ? <OverviewTab /> : null}
            {current === 'items' ? <ItemsTab /> : null}
            {current === 'offers' ? <OffersTab /> : null}
            {current === 'comparison' ? <ComparisonTab /> : null}
            {current === 'quote' ? <QuoteTab /> : null}
            {current === 'contracts' ? <ContractsTab /> : null}
            {current === 'operations' ? <OperationsTab /> : null}
            {current === 'finance' ? <FinanceTab /> : null}
            {current === 'closing' ? <ClosingTab /> : null}
          </div>
          <SidePanel />
        </div>

        <AskBar projectId={project.id} />
      </div>

      {outcomeOpen ? <OutcomeSheet kind={outcomeOpen} onClose={() => setOutcomeOpen(null)} /> : null}
    </ProjectContext.Provider>
  );
}

function OutcomeSheet({ kind, onClose }: { kind: 'won' | 'lost'; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <ProjectContext.Consumer>
      {(ctx) => (
        <BottomSheet
          open
          onClose={onClose}
          title={kind === 'won' ? t.project.won : t.project.lost}
          footer={
            <Button
              size="lg"
              className="btn--block"
              variant={kind === 'won' ? 'primary' : 'danger'}
              busy={busy}
              disabled={kind === 'lost' && !reason.trim()}
              onClick={async () => {
                if (!ctx) return;
                setBusy(true);
                try {
                  await api.projects.outcome(ctx.detail.project.id, { outcome: kind, lostReason: kind === 'lost' ? reason.trim() : undefined });
                  await ctx.reload();
                  toast(t.common.saved);
                  onClose();
                } catch (e) {
                  toast(errorMessage(e), 'danger');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t.project.markOutcome}
            </Button>
          }
        >
          {kind === 'lost' ? (
            <TextArea label={t.project.lostReason} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
          ) : (
            <p>{ctx?.detail.project.code}</p>
          )}
        </BottomSheet>
      )}
    </ProjectContext.Consumer>
  );
}

export function ProjectNotFound() {
  const t = useT();
  return <EmptyState icon="folder" title={t.project.notFound} />;
}

/** `pnl belgesi eski: quote değişti: accepted_option_no` → `Kâr-zarar tablosu eski — Müşteri teklifi değişti (kabul edilen seçenek)` */
function alertStale(message: string, docKind: Record<string, string>): string {
  const m = /^(\w+) belgesi eski: (.*)$/.exec(message);
  if (!m) return message;
  return `${docKind[m[1]] ?? m[1]} güncel değil — ${staleReason(m[2])}`;
}
