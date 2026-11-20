import { useMemo, useState, type FormEvent } from 'react';
import { DEFAULT_RULES, type FieldExtraInput, type FieldIssueInput, type Project } from '@mice/shared';
import { api, errorMessage } from '../api/client';
import { useApi } from '../api/hooks';
import { useT } from '../i18n';
import { dateRange, dateTime, todayISO, tl } from '../lib/format';
import { extraLimitStatus } from '../lib/fieldLimits';
import { useOfflineQueue } from '../lib/OfflineQueueProvider';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Button, Callout, EmptyState, ErrorBox, InlineError, Loading, Pill, Segmented } from '../components/ui';

function isToday(p: Project, today: string) {
  if (!p.startDate) return false;
  const end = p.endDate ?? p.startDate;
  return p.startDate <= today && today <= end;
}

export function FieldPanelPage() {
  const t = useT();
  const today = todayISO();
  const projects = useApi(() => api.projects.list({ outcome: 'won' }), []);
  const rules = useApi(() => api.rules.get().catch(() => DEFAULT_RULES), []);
  const todays = useMemo(() => (projects.data ?? []).filter((p) => isToday(p, today)), [projects.data, today]);
  const upcoming = useMemo(
    () => (projects.data ?? []).filter((p) => !isToday(p, today) && (p.startDate ?? '') > today).sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '')).slice(0, 5),
    [projects.data, today],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = (projects.data ?? []).find((p) => p.id === (selectedId ?? todays[0]?.id)) ?? null;
  const limits = { perItem: rules.data?.fieldExtraPerItemLimitTry ?? DEFAULT_RULES.fieldExtraPerItemLimitTry, perProject: rules.data?.fieldExtraPerProjectLimitTry ?? DEFAULT_RULES.fieldExtraPerProjectLimitTry };

  return (
    <div className="mobile-page field-panel">
      <header className="page-head page-head--large">
        <div>
          <p className="page-head__eyebrow">{new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
          <h1 className="page-head__title">{t.field.title}</h1>
        </div>
      </header>
      <QueueIndicator />

      {projects.error && !projects.data ? <ErrorBox error={projects.error} onRetry={() => void projects.reload()} /> : null}
      {projects.loading && !projects.data ? <Loading /> : null}

      {projects.data ? (
        <section aria-label={t.field.todayProjects}>
          <h2 className="section-title">{t.field.todayProjects}</h2>
          {todays.length || upcoming.length ? (
            <ul className="field-projects">
              {[...todays, ...upcoming].map((p) => (
                <li key={p.id}>
                  <button type="button" className={`fproj ${selected?.id === p.id ? 'is-active' : ''}`} onClick={() => setSelectedId(p.id)} aria-pressed={selected?.id === p.id}>
                    <span className="fproj__code mono">{p.code}</span>
                    <span className="fproj__name">{p.customerName ?? p.title}</span>
                    <span className="fproj__meta">{p.venueName ?? p.city ?? ''} · {dateRange(p.startDate, p.endDate)}</span>
                    {isToday(p, today) ? <Pill tone="success">{t.common.today}</Pill> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon="field" title={t.field.noProjects} />}
        </section>
      ) : null}

      {selected ? (
        <>
          <FieldChecklist projectId={selected.id} />
          <IssueForm projectId={selected.id} />
          <ExtraForm projectId={selected.id} limits={limits} />
        </>
      ) : null}
    </div>
  );
}

function QueueIndicator() {
  const t = useT();
  const q = useOfflineQueue();
  if (q.online && !q.pending.length && !q.dropped.length) {
    return (
      <div className="netstate netstate--ok" role="status">
        <Icon name="cloud" size={16} /> {t.field.online}
      </div>
    );
  }
  return (
    <div className="stack stack--sm">
      <div className={`netstate ${q.online ? 'netstate--pending' : 'netstate--offline'}`} role="status" aria-live="polite">
        <Icon name={q.online ? 'cloud' : 'cloudOff'} size={16} />
        <span>{q.online ? t.field.online : t.field.offline}</span>
        {q.pending.length ? <span>· {t.field.offlineQueue(q.pending.length)}</span> : null}
        {q.online && q.pending.length ? (
          <Button size="sm" variant="ghost" busy={q.syncing} onClick={() => void q.flush()}>{t.field.syncNow}</Button>
        ) : null}
      </div>
      {q.pending.length ? (
        <ul className="queue-list">
          {q.pending.map((p) => <li key={p.id}><span>{p.label}</span><span className="muted small">{dateTime(new Date(p.createdAt).toISOString())}{p.attempts ? ` · ${p.attempts}×` : ''}</span></li>)}
        </ul>
      ) : null}
      {q.dropped.length ? (
        <Callout tone="danger" icon="alert" title="Gönderilemeyen kayıtlar">
          <ul className="bullets">{q.dropped.map((d) => <li key={d.id}>{d.label}: {d.lastError}</li>)}</ul>
          <Button size="sm" variant="ghost" onClick={q.dismissDropped}>{t.common.close}</Button>
        </Callout>
      ) : null}
    </div>
  );
}

function FieldChecklist({ projectId }: { projectId: string }) {
  const t = useT();
  const toast = useToast();
  const q = useOfflineQueue();
  const res = useApi(() => api.tasks.list({ mine: 1, status: 'open' }), []);
  const [done, setDone] = useState<Set<string>>(new Set());
  const tasks = (res.data ?? []).filter((x) => x.projectId === projectId);
  return (
    <section className="card card--padded" aria-label={t.field.checklist}>
      <h2 className="card__title">{t.field.checklist}</h2>
      {res.loading && !res.data ? <Loading /> : null}
      {res.data && !tasks.length ? <p className="muted">{t.ops.noTasks}</p> : null}
      <ul className="checklist checklist--touch">
        {tasks.map((task) => {
          const isDone = done.has(task.id);
          return (
            <li key={task.id} className={`checklist__item ${isDone ? 'is-ok' : ''}`}>
              <button
                type="button"
                className="checklist__toggle"
                aria-pressed={isDone}
                disabled={isDone}
                onClick={async () => {
                  setDone((s) => new Set(s).add(task.id));
                  try {
                    const r = await q.submit({ method: 'POST', path: `/tasks/${encodeURIComponent(task.id)}/complete`, body: {}, label: `✓ ${task.title}` });
                    if (r.queued) toast(t.common.offlineSaved, 'neutral');
                  } catch (e) {
                    setDone((s) => { const n = new Set(s); n.delete(task.id); return n; });
                    toast(errorMessage(e), 'danger');
                  }
                }}
              >
                <span className="checklist__icon" aria-hidden><Icon name={isDone ? 'check' : 'plus'} size={16} /></span>
                <span className="checklist__text">{task.title}{task.dueAt ? <span className="muted small"> · {dateTime(task.dueAt)}</span> : null}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function IssueForm({ projectId }: { projectId: string }) {
  const t = useT();
  const toast = useToast();
  const q = useOfflineQueue();
  const [f, setF] = useState<FieldIssueInput>({ description: '', severity: 'medium' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: FieldIssueInput = { ...f, description: f.description.trim(), occurredAt: new Date().toISOString() };
      const r = await q.submit({ method: 'POST', path: `/projects/${encodeURIComponent(projectId)}/field-issues`, body, label: `Sorun: ${body.description.slice(0, 40)}` });
      toast(r.queued ? t.common.offlineSaved : t.common.saved, r.queued ? 'neutral' : 'success');
      setF({ description: '', severity: 'medium' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card card--padded stack" onSubmit={submit} aria-label={t.field.issue}>
      <h2 className="card__title">{t.field.issue}</h2>
      <label className="sr-only" htmlFor="issue-desc">{t.field.issue}</label>
      <textarea id="issue-desc" className="input textarea" rows={3} placeholder={t.field.issuePlaceholder} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required />
      <div className="field">
        <span className="field__label">{t.field.severity}</span>
        <Segmented label={t.field.severity} value={f.severity} onChange={(v) => setF({ ...f, severity: v })} options={(['low', 'medium', 'high'] as const).map((s) => ({ value: s, label: t.field.sev[s] }))} />
      </div>
      <InlineError message={error} />
      <Button type="submit" size="lg" className="btn--block" busy={busy} disabled={!f.description.trim()}>{t.field.logIssue}</Button>
    </form>
  );
}

function ExtraForm({ projectId, limits }: { projectId: string; limits: { perItem: number; perProject: number } }) {
  const t = useT();
  const toast = useToast();
  const q = useOfflineQueue();
  const extras = useApi(() => api.projects.fieldExtras(projectId), [projectId]);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queuedForProject = q.pending
    .filter((p) => p.path === `/projects/${encodeURIComponent(projectId)}/field-extras`)
    .reduce((s, p) => s + ((p.body as FieldExtraInput)?.amountTry ?? 0), 0);
  const soFar = (extras.data ?? []).reduce((s, e) => s + e.amountTry, 0) + queuedForProject;
  const amt = Number(amount.replace(/\./g, '').replace(',', '.'));
  const status = extraLimitStatus(amt, soFar, limits);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!desc.trim() || !(amt > 0)) return;
    setBusy(true);
    setError(null);
    try {
      const body: FieldExtraInput = { description: desc.trim(), amountTry: amt, customerPhone: phone.trim() || undefined };
      const r = await q.submit({ method: 'POST', path: `/projects/${encodeURIComponent(projectId)}/field-extras`, body, label: `Ekstra: ${body.description.slice(0, 30)} · ${tl(amt)}` });
      toast(r.queued ? t.common.offlineSaved : t.common.saved, r.queued ? 'neutral' : 'success');
      setDesc('');
      setAmount('');
      if (!r.queued) void extras.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card card--padded stack" onSubmit={submit} aria-label={t.field.extra}>
      <h2 className="card__title">{t.field.extra}</h2>
      <p className="muted small">{t.field.limitInfo(tl(limits.perItem), tl(limits.perProject))}</p>
      <div className="field">
        <label className="field__label" htmlFor="x-desc">{t.field.extraDesc}</label>
        <input id="x-desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} required placeholder="Örn: ek coffee break (30 kişi)" />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="x-amt">{t.field.extraAmount}</label>
        <input id="x-amt" className="input input--xl" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="0" />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="x-phone">{t.field.customerPhone} <span className="muted">({t.common.optional})</span></label>
        <input id="x-phone" className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="limitbar" aria-live="polite">
        <div className="limitbar__row"><span>{t.field.projectTotal}</span><strong>{tl(soFar)} / {tl(limits.perProject)}</strong></div>
        <div className="limitbar__track" aria-hidden>
          <span className="limitbar__fill" style={{ width: `${Math.min(100, (soFar / limits.perProject) * 100)}%` }} />
          {amt > 0 ? <span className={`limitbar__add ${status.needsAdmin ? 'is-over' : ''}`} style={{ left: `${Math.min(100, (soFar / limits.perProject) * 100)}%`, width: `${Math.max(0, Math.min(100 - (soFar / limits.perProject) * 100, (amt / limits.perProject) * 100))}%` }} /> : null}
        </div>
        {amt > 0 ? (
          status.needsAdmin ? (
            <Callout tone="warning" icon="alert">{t.field.needsAdmin}</Callout>
          ) : (
            <Callout tone="success" icon="check">{t.field.withinLimits}</Callout>
          )
        ) : null}
      </div>
      <InlineError message={error} />
      <Button type="submit" size="lg" className="btn--block" icon="send" busy={busy} disabled={!desc.trim() || !(amt > 0)}>{t.field.extraSubmit}</Button>

      {extras.data?.length ? (
        <ul className="list small">
          {extras.data.map((x) => (
            <li key={x.id} className="list__row">
              <span>{x.description}<span className="muted"> · {tl(x.amountTry)}</span></span>
              {x.customerApprovedAt ? <Pill tone="success" icon="check">{x.customerApproverName ?? t.ops.customerApproval}</Pill> : <Pill tone="warning">{t.ops.waitingApproval}</Pill>}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
