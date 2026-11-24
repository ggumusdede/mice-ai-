import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { dateTime } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Callout, Card, ErrorBox, InlineError, Loading, Pill, Select, TextInput } from '../../components/ui';

export function DelegationsPage() {
  const t = useT();
  const toast = useToast();
  const { isAdmin, user } = useAuth();
  const res = useApi(() => api.delegations.list(), []);
  const users = useApi(() => api.users.list(), []);
  const [f, setF] = useState({ delegateId: '', startsAt: '', endsAt: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (id: string) => users.data?.find((u) => u.id === id)?.fullName ?? id.slice(0, 8);
  const now = Date.now();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await api.delegations.create({ delegateId: f.delegateId, startsAt: new Date(f.startsAt).toISOString(), endsAt: new Date(f.endsAt).toISOString() });
      res.setData((p) => [d, ...(p ?? [])]);
      setF({ delegateId: '', startsAt: '', endsAt: '' });
      toast(t.common.saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack stack--lg">
      <Callout tone="purple" icon="shield">{t.admin.delegationNote}</Callout>
      {isAdmin ? (
        <Card title={t.admin.newDelegation}>
          <form className="form-grid" onSubmit={submit}>
            <Select label={t.admin.delegate} value={f.delegateId} onChange={(e) => setF({ ...f, delegateId: e.target.value })} required>
              <option value="" disabled>—</option>
              {(users.data ?? []).filter((u) => u.id !== user?.id && u.active).map((u) => <option key={u.id} value={u.id}>{u.fullName} · {t.role[u.role]}</option>)}
            </Select>
            <TextInput label={t.admin.startsAt} type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required />
            <TextInput label={t.admin.endsAt} type="datetime-local" value={f.endsAt} min={f.startsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} required />
            <div className="span-full row-end">
              <InlineError message={error} />
              <Button type="submit" busy={busy}>{t.common.create}</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title={t.admin.delegations} padded={false}>
        {res.error ? <ErrorBox error={res.error} onRetry={() => void res.reload()} /> : null}
        {!res.data && res.loading ? <Loading /> : null}
        {res.data ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">{t.admin.delegate}</th><th scope="col">{t.admin.startsAt}</th><th scope="col">{t.admin.endsAt}</th><th scope="col">{t.common.status}</th><th scope="col"><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {res.data.map((d) => {
                  const active = new Date(d.startsAt).getTime() <= now && new Date(d.endsAt).getTime() >= now;
                  const ended = new Date(d.endsAt).getTime() < now;
                  return (
                    <tr key={d.id}>
                      <td>{name(d.delegateId)}</td>
                      <td>{dateTime(d.startsAt)}</td>
                      <td>{dateTime(d.endsAt)}</td>
                      <td>{active ? <Pill tone="success">{t.admin.active}</Pill> : ended ? <Pill>Bitti</Pill> : <Pill tone="accent">Planlı</Pill>}</td>
                      <td className="num">{isAdmin && !ended ? (
                        <Button size="sm" variant="ghost" onClick={async () => {
                          try {
                            const n = await api.delegations.end(d.id);
                            res.setData((p) => (p ?? []).map((x) => (x.id === n.id ? n : x)));
                          } catch (e) {
                            toast(errorMessage(e), 'danger');
                          }
                        }}>{t.admin.endDelegation}</Button>
                      ) : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
