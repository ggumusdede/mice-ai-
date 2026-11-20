import { useState } from 'react';
import type { GeneratedDocument } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useT } from '../../i18n';
import { relative } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, DocStatusPill, ProfitBlock } from '../../components/ui';
import { useProject } from './ProjectContext';

const ACTOR_LABEL: Record<string, string> = { user: 'Ekip', ai: 'Yapay zekâ', supplier: 'Tedarikçi', customer: 'Müşteri', system: 'Sistem' };

/** Right panel (§15): expected vs realized profit (margin & markup separate), document statuses, recent activity. */
export function SidePanel() {
  const t = useT();
  const { detail, reload } = useProject();
  const toast = useToast();
  const [busyDoc, setBusyDoc] = useState<string | null>(null);

  const regenerate = async (doc: GeneratedDocument) => {
    setBusyDoc(doc.id);
    try {
      await api.documents.regenerate(doc.id);
      await reload();
      toast(t.common.saved);
    } catch (e) {
      toast(errorMessage(e), 'danger');
    } finally {
      setBusyDoc(null);
    }
  };

  return (
    <aside className="project__side" aria-label="Proje özeti">
      <section className="card card--padded">
        <ProfitBlock title={t.profit.expected} value={detail.profit.expected} />
        <hr className="divider" />
        <ProfitBlock title={t.profit.realized} value={detail.profit.realized} />
      </section>

      <section className="card card--padded">
        <h2 className="card__title">{t.project.documents}</h2>
        {detail.documents.length ? (
          <ul className="list">
            {detail.documents.map((d) => (
              <li key={d.id} className="list__row">
                <div>
                  <div>{t.docKind[d.kind] ?? d.kind} <span className="muted small">v{d.version}</span></div>
                  {d.staleReason ? <div className="muted small">{d.staleReason}</div> : <div className="muted small">{relative(d.generatedAt)}</div>}
                </div>
                <div className="list__end">
                  <DocStatusPill status={d.status} />
                  {d.status === 'stale' ? (
                    <Button size="sm" variant="ghost" icon="refresh" busy={busyDoc === d.id} onClick={() => void regenerate(d)} aria-label={`${t.project.regenerate}: ${t.docKind[d.kind]}`}>
                      {t.project.regenerate}
                    </Button>
                  ) : d.downloadUrl ? (
                    <a className="btn btn--ghost btn--sm" href={d.downloadUrl} target="_blank" rel="noreferrer">PDF</a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="muted">—</p>}
      </section>

      <section className="card card--padded">
        <h2 className="card__title">{t.project.activity}</h2>
        {detail.recentActivity.length ? (
          <ol className="timeline">
            {detail.recentActivity.slice(0, 12).map((a) => (
              <li key={a.id} className={`timeline__item timeline__item--${a.actorType}`}>
                <span className="timeline__dot" aria-hidden />
                <div>
                  <div className="small">
                    <strong>{ACTOR_LABEL[a.actorType] ?? a.actorType}</strong> · {a.entity} · {a.action}
                  </div>
                  <div className="muted small">{relative(a.at)}{a.device ? ` · ${a.device}` : ''}</div>
                </div>
              </li>
            ))}
          </ol>
        ) : <p className="muted">—</p>}
      </section>
    </aside>
  );
}
