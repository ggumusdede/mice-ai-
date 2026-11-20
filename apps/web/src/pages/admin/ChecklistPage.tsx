import { Link } from 'react-router-dom';
import type { ChecklistQuestion } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorBox, Loading, Pill } from '../../components/ui';

const SOURCE: Record<ChecklistQuestion['source'], string> = { seed: 'Başlangıç', ai: 'Yapay zekâ', closing: 'Kapanış dersi', user: 'Ekip' };

export function ChecklistPage() {
  const t = useT();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const res = useApi(() => api.checklist.list(), []);
  if (res.error && !res.data) return <ErrorBox error={res.error} onRetry={() => void res.reload()} />;
  if (!res.data) return <Loading />;
  const suggested = res.data.filter((q) => q.status === 'suggested');
  const active = res.data.filter((q) => q.status === 'active');

  const setStatus = async (q: ChecklistQuestion, status: 'active' | 'rejected') => {
    try {
      const n = await api.checklist.setStatus(q.id, status);
      res.setData((p) => (p ?? []).map((x) => (x.id === n.id ? n : x)));
    } catch (e) {
      toast(errorMessage(e), 'danger');
    }
  };

  const table = (rows: ChecklistQuestion[], actions: boolean) => (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th scope="col">{t.admin.question}</th><th scope="col">{t.admin.eventType}</th><th scope="col">Kaynak</th>{actions ? <th scope="col"><span className="sr-only">İşlem</span></th> : null}</tr></thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.id}>
              <td>{q.question}{q.field ? <div className="muted small mono">{q.field}</div> : null}</td>
              <td>{q.eventType ?? <span className="muted">{t.admin.allEvents}</span>}</td>
              <td><Pill tone={q.source === 'ai' || q.source === 'closing' ? 'purple' : 'neutral'}>{SOURCE[q.source]}</Pill></td>
              {actions ? (
                <td className="num nowrap">
                  {isAdmin ? (
                    <>
                      <Button size="sm" variant="secondary" icon="check" onClick={() => void setStatus(q, 'active')}>{t.common.approve}</Button>
                      <Button size="sm" variant="ghost" onClick={() => void setStatus(q, 'rejected')}>{t.common.reject}</Button>
                    </>
                  ) : <Link to="/" className="link-btn">{t.admin.approveInInbox}</Link>}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="stack stack--lg">
      <Card title={`${t.admin.suggested} (${suggested.length})`} padded={false}>
        {suggested.length ? table(suggested, true) : <p className="muted card--padded">—</p>}
      </Card>
      <Card title={`${t.admin.active} (${active.length})`} padded={false}>
        {table(active, false)}
      </Card>
    </div>
  );
}
