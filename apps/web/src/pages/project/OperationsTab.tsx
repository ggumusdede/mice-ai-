import { useState } from 'react';
import type { FieldExtra, Task } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { date, dateTime, tl } from '../../lib/format';
import { groupTasksByDay } from '../../lib/tasks';
import { useToast } from '../../components/Toast';
import { Button, Card, CopyLink, ErrorBox, InlineError, Loading, Pill } from '../../components/ui';
import { useProject } from './ProjectContext';

export function OperationsTab() {
  return (
    <div className="stack stack--lg">
      <div className="grid-2 grid-2--top">
        <TasksCalendar />
        <DailySummaryCard />
      </div>
      <FieldExtrasCard />
      <GuestsCard />
    </div>
  );
}

function TasksCalendar() {
  const t = useT();
  const toast = useToast();
  const { detail, reload } = useProject();
  const groups = groupTasksByDay(detail.tasks);
  const complete = async (task: Task) => {
    try {
      await api.tasks.complete(task.id);
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'danger');
    }
  };
  return (
    <Card title={t.ops.calendar}>
      {groups.length ? (
        <ol className="cal">
          {groups.map((g) => (
            <li key={g.day} className={`cal__day ${g.overdue ? 'cal__day--overdue' : ''}`}>
              <div className="cal__date">
                <span className="cal__dnum">{g.day === 'none' ? '—' : date(g.day, { day: 'numeric' })}</span>
                <span className="cal__mon">{g.day === 'none' ? '' : date(g.day, { month: 'short', weekday: 'short' })}</span>
              </div>
              <ul className="cal__tasks">
                {g.tasks.map((task) => (
                  <li key={task.id} className={`cal__task ${task.status !== 'open' ? 'is-done' : ''}`}>
                    <span>{task.title}{task.source === 'ai' ? <Pill tone="purple">AI</Pill> : null}</span>
                    {task.status === 'open' ? (
                      <Button size="sm" variant="ghost" icon="check" onClick={() => void complete(task)} aria-label={`${t.ops.complete}: ${task.title}`}>{t.ops.complete}</Button>
                    ) : <Pill tone="success">{t.ops.complete}</Pill>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : <p className="muted">{t.ops.noTasks}</p>}
    </Card>
  );
}

function DailySummaryCard() {
  const t = useT();
  const { detail } = useProject();
  const res = useApi(() => api.projects.dailySummary(detail.project.id), [detail.project.id]);
  return (
    <Card title={t.ops.dailySummary}>
      {res.loading && !res.data ? <Loading /> : null}
      {res.data?.lines.length ? <ol className="summary-lines">{res.data.lines.map((l, i) => <li key={i}>{l}</li>)}</ol> : !res.loading ? <p className="muted">—</p> : null}
    </Card>
  );
}

function FieldExtrasCard() {
  const t = useT();
  const { detail } = useProject();
  const res = useApi(() => api.projects.fieldExtras(detail.project.id), [detail.project.id]);
  const total = (res.data ?? []).reduce((s, e) => s + e.amountTry, 0);
  return (
    <Card title={t.ops.extras} actions={res.data?.length ? <span className="small muted">{t.common.total}: {tl(total)}</span> : null} padded={false}>
      {res.error ? <ErrorBox error={res.error} onRetry={() => void res.reload()} /> : null}
      {res.loading && !res.data ? <Loading /> : null}
      {res.data && !res.data.length ? <p className="muted card--padded">{t.ops.noExtras}</p> : null}
      {res.data?.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.common.description}</th>
                <th scope="col" className="num">{t.common.amount}</th>
                <th scope="col">{t.ops.customerApproval}</th>
                <th scope="col">{t.ops.reflect}</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((x) => <ExtraRow key={x.id} x={x} onChange={(n) => res.setData((p) => (p ?? []).map((e) => (e.id === n.id ? n : e)))} />)}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function ExtraRow({ x, onChange }: { x: FieldExtra; onChange: (x: FieldExtra) => void }) {
  const t = useT();
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reflect = async (reflected: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.fieldExtras.reflect(x.id, { reflected, reason: reflected ? undefined : reason.trim() }));
      setReasonOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <tr>
      <td>
        {x.description}
        <div className="muted small">{dateTime(x.createdAt)}</div>
        {x.needsAdminApproval ? <Pill tone="warning">{t.ops.needsAdmin}</Pill> : <Pill tone="success">{t.ops.withinLimit}</Pill>}
      </td>
      <td className="num">{tl(x.amountTry)}</td>
      <td>
        {x.customerApprovedAt ? (
          <><Pill tone="success" icon="check">{t.ops.approvedBy(x.customerApproverName ?? '')}</Pill><div className="muted small">{dateTime(x.customerApprovedAt)}</div></>
        ) : <Pill tone="warning">{t.ops.waitingApproval}</Pill>}
      </td>
      <td>
        {x.reflectedToCustomer === true ? <Pill tone="success">{t.ops.reflected}</Pill> : null}
        {x.reflectedToCustomer === false ? <><Pill tone="neutral">{t.ops.notReflected}</Pill><div className="small muted">{x.notReflectedReason}</div></> : null}
        {x.reflectedToCustomer === null ? (
          reasonOpen ? (
            <div className="stack stack--sm">
              <label className="sr-only" htmlFor={`nr-${x.id}`}>{t.ops.notReflectReason}</label>
              <input id={`nr-${x.id}`} className="input input--sm" placeholder={t.ops.notReflectReason} value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="row">
                <Button size="sm" variant="ghost" onClick={() => setReasonOpen(false)}>{t.common.cancel}</Button>
                <Button size="sm" busy={busy} disabled={!reason.trim()} onClick={() => void reflect(false)}>{t.common.save}</Button>
              </div>
            </div>
          ) : (
            <div className="row">
              <Button size="sm" variant="secondary" busy={busy} onClick={() => void reflect(true)}>{t.ops.reflect}</Button>
              <Button size="sm" variant="ghost" onClick={() => setReasonOpen(true)}>{t.ops.notReflect}</Button>
            </div>
          )
        ) : null}
        <InlineError message={error} />
      </td>
    </tr>
  );
}

function GuestsCard() {
  const t = useT();
  const toast = useToast();
  const { detail } = useProject();
  const res = useApi(() => api.projects.guests(detail.project.id), [detail.project.id]);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const consented = (res.data ?? []).filter((g) => g.consentReuse && !g.consentWithdrawnAt).length;
  return (
    <Card
      title={t.ops.guests}
      padded={false}
      actions={
        <Button size="sm" variant="secondary" icon="link" busy={busy} onClick={async () => {
          setBusy(true);
          try {
            setLink((await api.projects.roomingLink(detail.project.id)).url);
          } catch (e) {
            toast(errorMessage(e), 'danger');
          } finally {
            setBusy(false);
          }
        }}>{t.ops.roomingLink}</Button>
      }
    >
      {link ? <div className="card--padded"><CopyLink url={link} /></div> : null}
      {res.error ? <div className="card--padded"><ErrorBox error={res.error} onRetry={() => void res.reload()} /></div> : null}
      {res.loading && !res.data ? <Loading /> : null}
      {res.data && !res.data.length ? <p className="muted card--padded">{t.ops.noGuests}</p> : null}
      {res.data?.length ? (
        <>
          <p className="small muted card--padded">{res.data.length} misafir · {t.ops.consentYes}: {consented}</p>
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr><th scope="col">{t.publicPages.fullName}</th><th scope="col">{t.ops.room}</th><th scope="col">{t.ops.arrival}</th><th scope="col">{t.ops.departure}</th><th scope="col">{t.ops.consent}</th></tr>
              </thead>
              <tbody>
                {res.data.map((g) => (
                  <tr key={g.id}>
                    <td>{g.anonymizedAt ? <span className="muted">Anonimleştirildi</span> : g.fullName}<div className="muted small">{[g.email, g.phone].filter(Boolean).join(' · ')}</div></td>
                    <td>{g.roomType ?? '—'}</td>
                    <td>{date(g.arrival)}</td>
                    <td>{date(g.departure)}</td>
                    <td>
                      {g.consentReuse && !g.consentWithdrawnAt ? <Pill tone="success">{t.ops.consentYes}</Pill> : <Pill>{t.ops.consentNo}</Pill>}
                      {g.retentionUntil && !g.consentReuse ? <div className="muted small">Saklama: {date(g.retentionUntil)}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Card>
  );
}
