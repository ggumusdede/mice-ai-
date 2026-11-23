// v0.5 S-09 "Projeye ilet" — PWA share target (/ilet?text=…): a message shared from personal WhatsApp / mail is attached to a
// project with the label "kişisel kanal, çalışan iletti". Nothing is read from personal accounts.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useApi } from '../api/hooks';
import { teamApi } from '../api/teamClient';
import { PageHeader } from '../components/AppShell';
import { useToast } from '../components/Toast';
import { Button, Card, InlineError } from '../components/ui';

export function ForwardToProjectPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [text, setText] = useState([sp.get('title'), sp.get('text'), sp.get('url')].filter(Boolean).join('\n'));
  const [q, setQ] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = useApi(() => api.projects.list({}), []);
  const list = useMemo(() => (projects.data ?? []).filter((p) => !q || `${p.code} ${p.title} ${p.customerName ?? ''}`.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))).slice(0, 30), [projects.data, q]);
  return (
    <div className="page mobile-page">
      <PageHeader title="Projeye ilet" />
      <Card>
        <p className="muted small">Sistem kişisel hesaplarınızı okumaz. Buraya paylaştığınız mesaj seçtiğiniz projeye "kişisel kanal, çalışan iletti" etiketiyle eklenir.</p>
        <textarea className="input textarea" rows={6} aria-label="Mesaj" value={text} onChange={(e) => setText(e.target.value)} />
        <input className="input" placeholder="Proje ara (kod, müşteri)" aria-label="Proje ara" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input select" aria-label="Proje" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Proje seçin</option>
          {list.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.customerName ?? p.title}</option>)}
        </select>
        <Button size="lg" className="btn--block" icon="check" busy={busy} disabled={!projectId || !text.trim()} onClick={async () => {
          setBusy(true);
          setError(null);
          try { await teamApi.forward(projectId, { text, source: 'whatsapp' }); toast('Projeye eklendi'); nav(`/projeler/${projectId}`); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
        }}>Projeye ekle</Button>
        <InlineError message={error} />
      </Card>
    </div>
  );
}
