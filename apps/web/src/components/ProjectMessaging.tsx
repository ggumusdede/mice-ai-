// v0.5 S-01 / S-02 / S-09 on the project page: "Hazır mesaj" (ready-made template → one-tap approval card; nothing leaves before
// a human approves) and "Projeye ilet" (paste a message from a personal WhatsApp / mail — personal accounts are never read).
// Participant messaging (off by default) sits under "Diğer ayarlar".
import { useState } from 'react';
import type { QuickTemplate } from '@mice/shared';
import { errorMessage } from '../api/client';
import { useApi } from '../api/hooks';
import { teamApi } from '../api/teamClient';
import { useAuth } from '../auth/AuthContext';
import { BottomSheet } from './BottomSheet';
import { Button, Callout, InlineError, Segmented } from './ui';
import { useToast } from './Toast';

export function ProjectMessaging({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState<'quick' | 'forward' | null>(null);
  if (!user) return null;
  const canQuick = ['admin', 'clerk_sales', 'clerk_ops'].includes(user.role);
  return (
    <div className="row">
      {canQuick ? <Button variant="secondary" size="sm" icon="send" onClick={() => setOpen('quick')}>Hazır mesaj</Button> : null}
      <Button variant="ghost" size="sm" icon="link" onClick={() => setOpen('forward')}>Projeye ilet</Button>
      {open === 'quick' ? <QuickMessageSheet projectId={projectId} onClose={() => setOpen(null)} /> : null}
      {open === 'forward' ? <ForwardSheet projectId={projectId} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function QuickMessageSheet({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const toast = useToast();
  const templates = useApi(() => teamApi.quickTemplates(), []);
  const pm = useApi(() => teamApi.participantMessaging(projectId), [projectId]);
  const [key, setKey] = useState<string | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [to, setTo] = useState('');
  const [toParticipants, setToParticipants] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tpl: QuickTemplate | undefined = templates.data?.find((x) => x.key === key);
  const list = (templates.data ?? []).filter((x) => x.key !== 'collection_reminder');
  const needsTo = tpl ? tpl.recipient !== 'customer' || tpl.channel !== 'email' || toParticipants : false;

  const submit = async () => {
    if (!tpl) return;
    setBusy(true);
    setError(null);
    try {
      await teamApi.quickMessage(projectId, { template: tpl.key, vars, ...(to.trim() ? { to: to.trim() } : {}), ...(toParticipants ? { recipient: 'participant' } : {}) });
      toast('Mesaj hazır — karar kutusunda tek dokunuşla onaylanır');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open onClose={onClose} title="Hazır mesaj" footer={tpl ? (
      <div className="sheet-actions">
        <Button size="lg" className="btn--block" icon="check" busy={busy} disabled={tpl.inputs.some((i) => i.required && !vars[i.key]?.trim()) || (needsTo && !to.trim())} onClick={() => void submit()}>Onaya hazırla</Button>
        <Button variant="ghost" disabled={busy} onClick={() => setKey(null)}>Başka şablon</Button>
      </div>
    ) : undefined}>
      {!tpl ? (
        <ul className="simple-list" aria-label="Şablonlar">
          {list.map((x) => (
            <li key={x.key}>
              <button type="button" className="simple-item" style={{ width: '100%', textAlign: 'left' }} onClick={() => { setKey(x.key); setVars({}); setTo(''); setToParticipants(false); }}>
                <span className="simple-item__main"><span className="simple-item__title">{x.label}</span><br /><span className="muted small">{x.hint}</span></span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="stack-sm">
          <p className="muted small">{tpl.hint} Mesaj gönderilmez; önce onay kartı açılır.</p>
          {tpl.inputs.map((i) => (
            <label key={i.key} className="field">
              <span className="field__label">{i.label}{i.required ? '' : ' (isteğe bağlı)'}</span>
              <input className="input" value={vars[i.key] ?? ''} onChange={(e) => setVars({ ...vars, [i.key]: e.target.value })} />
            </label>
          ))}
          <label className="field">
            <span className="field__label">{tpl.channel === 'email' ? 'Alıcı e-posta' : 'Alıcı telefon'}{needsTo ? '' : ' (boşsa müşteri irtibatı)'}</span>
            <input className="input" inputMode={tpl.channel === 'email' ? 'email' : 'tel'} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {tpl.logistics ? (
            <details className="more">
              <summary>Katılımcılara gönder</summary>
              {pm.data?.mode === 'off' ? (
                <Callout tone="warning" icon="shield">Bu projede katılımcıya doğrudan mesaj kapalı. Müşteri izin verirse proje ayarından açılır.</Callout>
              ) : (
                <label className="row"><input type="checkbox" checked={toParticipants} onChange={(e) => setToParticipants(e.target.checked)} /> <span>Katılımcıya gidecek (izin: {pm.data?.mode === 'on' ? 'açık' : 'yalnız lojistik'})</span></label>
              )}
              <ParticipantSetting projectId={projectId} onChanged={() => void pm.reload()} />
            </details>
          ) : null}
          <InlineError message={error} />
        </div>
      )}
    </BottomSheet>
  );
}

function ParticipantSetting({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const pm = useApi(() => teamApi.participantMessaging(projectId), [projectId]);
  const [mode, setMode] = useState<'off' | 'logistics' | 'on' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cur = mode ?? pm.data?.mode ?? 'off';
  return (
    <div className="stack-sm">
      <Segmented label="Katılımcıya mesaj" value={cur} onChange={(v) => setMode(v)} options={[{ value: 'off', label: 'Kapalı' }, { value: 'logistics', label: 'Lojistik' }, { value: 'on', label: 'Açık' }]} />
      {mode && mode !== pm.data?.mode ? (
        <>
          <input className="input" placeholder="Müşteri izni: kim, ne zaman?" aria-label="Müşteri izni" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" onClick={async () => {
            setError(null);
            try { await teamApi.setParticipantMessaging(projectId, mode, reason); await pm.reload(); setMode(null); onChanged(); } catch (e) { setError(errorMessage(e)); }
          }}>Kaydet</Button>
        </>
      ) : null}
      <InlineError message={error} />
    </div>
  );
}

function ForwardSheet({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [source, setSource] = useState<'whatsapp' | 'email' | 'other'>('whatsapp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <BottomSheet open onClose={onClose} title="Projeye ilet" footer={
      <div className="sheet-actions">
        <Button size="lg" className="btn--block" icon="check" busy={busy} disabled={!text.trim()} onClick={async () => {
          setBusy(true);
          setError(null);
          try { await teamApi.forward(projectId, { text, source }); toast('Projeye eklendi'); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
        }}>Projeye ekle</Button>
      </div>
    }>
      <div className="stack-sm">
        <p className="muted small">Kişisel WhatsApp veya e-postanızdaki mesajı buraya yapıştırın. Sistem kişisel hesaplarınızı okumaz; mesaj "kişisel kanal, çalışan iletti" etiketiyle projeye eklenir.</p>
        <Segmented label="Kaynak" value={source} onChange={setSource} options={[{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'email', label: 'E-posta' }, { value: 'other', label: 'Diğer' }]} />
        <textarea className="input textarea" rows={6} aria-label="İletilecek mesaj" value={text} onChange={(e) => setText(e.target.value)} />
        <InlineError message={error} />
      </div>
    </BottomSheet>
  );
}
