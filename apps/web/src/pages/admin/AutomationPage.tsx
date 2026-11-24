import { AI_ACTIONS } from '@mice/shared';
import { api } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useT } from '../../i18n';
import { dateTime, pct } from '../../lib/format';
import { Card, ErrorBox, Loading, Pill } from '../../components/ui';

export function AutomationPage() {
  const t = useT();
  const res = useApi(() => api.automation.list(), []);
  if (res.error && !res.data) return <ErrorBox error={res.error} onRetry={() => void res.reload()} />;
  if (!res.data) return <Loading />;
  return (
    <Card title={t.admin.automation} padded={false}>
      <p className="muted small card--padded">§16: Belirli sayıda düzeltmesiz onaydan sonra sistem otomatiğe terfi önerir; Yasak listesindeki işler hiçbir koşulda otomatiğe geçmez.</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">İş türü</th>
              <th scope="col">{t.admin.mode}</th>
              <th scope="col">{t.admin.consecutive}</th>
              <th scope="col">{t.admin.sampleRate}</th>
              <th scope="col" className="num">{t.report.autoCount}</th>
              <th scope="col" className="num">{t.report.sampled}</th>
              <th scope="col" className="num">{t.report.sampleErrors}</th>
              <th scope="col">Son değişiklik</th>
            </tr>
          </thead>
          <tbody>
            {res.data.map((c) => {
              const progress = Math.min(1, c.consecutiveClean / Math.max(1, c.threshold));
              return (
                <tr key={c.actionType}>
                  <td>{AI_ACTIONS[c.actionType]?.label ?? c.actionType}</td>
                  <td>{c.mode === 'auto' ? <Pill tone="success">{t.admin.modeAuto}</Pill> : <Pill>{t.admin.modeApproval}</Pill>}</td>
                  <td>
                    <div className="mini-progress" role="progressbar" aria-valuemin={0} aria-valuemax={c.threshold} aria-valuenow={c.consecutiveClean} aria-label={t.admin.consecutive}>
                      <span style={{ width: `${progress * 100}%` }} />
                    </div>
                    <span className="small muted">{c.consecutiveClean} / {c.threshold}</span>
                  </td>
                  <td>{pct(c.sampleRate)}</td>
                  <td className="num">{c.totalAuto}</td>
                  <td className="num">{c.totalSampled}</td>
                  <td className="num">{c.sampleErrors ? <span className="text-danger">{c.sampleErrors}</span> : 0}</td>
                  <td className="small">{c.demotedAt && (!c.promotedAt || c.demotedAt > c.promotedAt) ? <>Geri dönüş · {dateTime(c.demotedAt)}</> : c.promotedAt ? <>Terfi · {dateTime(c.promotedAt)}</> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
