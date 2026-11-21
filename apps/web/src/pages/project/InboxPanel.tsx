// "Gelen kutusu" — inbound e-mail / WhatsApp messages linked to this project (sender, subject, time, resulting offer / intake).
import { Link } from 'react-router-dom';
import type { InboundMessageSummary } from '@mice/shared';
import { api } from '../../api/client';
import { useApi } from '../../api/hooks';
import { Card, EmptyState, ErrorBox, Pill, type Tone } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useProject } from './ProjectContext';

export const INBOUND_KIND_LABEL: Record<string, { label: string; tone: Tone }> = {
  new_request: { label: 'Yeni talep', tone: 'accent' },
  supplier_reply: { label: 'Tedarikçi yanıtı', tone: 'success' },
  supplier_message: { label: 'Tedarikçi iletisi', tone: 'warning' },
  customer_reply: { label: 'Müşteri yanıtı', tone: 'neutral' },
  customer_revision: { label: 'Revizyon isteği', tone: 'warning' },
  customer_acceptance: { label: 'Kabul bildirimi', tone: 'purple' },
  project_reply: { label: 'Yazışma', tone: 'neutral' },
  extra_approval: { label: 'Ekstra onayı', tone: 'success' },
  auto_reply: { label: 'Otomatik yanıt', tone: 'neutral' },
  rejected: { label: 'Reddedildi', tone: 'danger' },
  unlinked: { label: 'Bağlanamadı', tone: 'warning' },
};

export function inboundKind(kind: string | null): { label: string; tone: Tone } {
  return (kind && INBOUND_KIND_LABEL[kind]) || { label: 'Gelen ileti', tone: 'neutral' };
}

export function InboxPanel() {
  const { detail } = useProject();
  const id = detail.project.id;
  const res = useApi(() => api.projects.inbound(id), [id]);
  return (
    <Card title="Gelen kutusu" padded={false}>
      {res.error ? <div style={{ padding: 16 }}><ErrorBox error={res.error} onRetry={() => void res.reload()} /></div> : null}
      {!res.error && res.data && !res.data.length ? <EmptyState icon="check" title="Bu projeye bağlı gelen e-posta / WhatsApp iletisi yok" /> : null}
      {res.data?.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Gönderen</th>
                <th scope="col">Konu / ileti</th>
                <th scope="col">Zaman</th>
                <th scope="col">Sonuç</th>
              </tr>
            </thead>
            <tbody>
              {res.data.map((m) => <InboxRow key={m.id} m={m} projectId={id} />)}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function InboxRow({ m, projectId }: { m: InboundMessageSummary; projectId: string }) {
  const k = inboundKind(m.kind);
  return (
    <tr>
      <td>
        <strong>{m.supplierName ?? m.senderName ?? m.fromAddress ?? '—'}</strong>
        <div className="muted small">{m.channel === 'whatsapp' ? 'WhatsApp' : 'E-posta'}{m.senderName && m.fromAddress ? ` · ${m.fromAddress}` : ''}</div>
      </td>
      <td className="col-notes">
        {m.subject ? <div>{m.subject}</div> : null}
        <div className="muted small">{m.preview.slice(0, 140)}</div>
        {m.attachments.length ? <div className="muted small">Ek: {m.attachments.map((a) => `${a.filename}${a.accepted ? '' : ' (reddedildi)'}`).join(', ')}</div> : null}
      </td>
      <td className="small">{dateTime(m.receivedAt)}</td>
      <td>
        <Pill tone={k.tone}>{k.label}</Pill>
        {m.status === 'needs_review' || m.status === 'failed' ? <div><Pill tone="warning" icon="alert">İnceleyin</Pill></div> : null}
        {m.offerId ? <div className="small"><Link to={`/projeler/${projectId}/offers`}>Teklif v{m.offerVersion ?? '?'} →</Link></div> : null}
        {m.intakeProjectId && m.intakeProjectId === projectId && m.kind === 'new_request' ? <div className="muted small">Bu talepten açıldı</div> : null}
        {m.note ? <div className="muted small">{m.note}</div> : null}
      </td>
    </tr>
  );
}
