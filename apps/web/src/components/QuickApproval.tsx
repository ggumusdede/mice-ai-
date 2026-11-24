// v0.5 S-01 hızlı onay: outbound message cards get a one-tap button under the card, and when several wait, ONE batch card on
// top ("5 mesaj onay bekliyor — hepsini onayla / tek tek bak"). Each approval is still its own decision with its own audit trail
// (POST /api/decisions/batch-approve decides them one by one); nothing is ever sent automatically. Face ID cards are never here.
import { useState } from 'react';
import type { Decision } from '@mice/shared';
import { QUICK_APPROVAL_KINDS } from '@mice/shared';
import { api, errorMessage } from '../api/client';
import { teamApi } from '../api/teamClient';
import { deviceLabel } from '../lib/webauthn';
import { Button, InlineError } from './ui';
import { useToast } from './Toast';

/** Cards that may be approved with one tap (outbound messages without a biometric gate). */
export function isQuickCard(d: Decision): boolean {
  return (QUICK_APPROVAL_KINDS as readonly string[]).includes(d.kind) && !d.requiresBiometric;
}

export function channelLabel(d: Pick<Decision, 'detail' | 'kind'>): string {
  const ch = (d.detail?.channel as string | undefined) ?? (d.kind === 'rfq_send' ? 'email' : undefined);
  return ch === 'whatsapp' ? 'WhatsApp' : ch === 'sms' ? 'SMS' : 'E-posta';
}

/** Batch card: shown when 2+ message cards wait. "Tek tek bak" filters the list below to the messages. */
export function QuickBatchCard({ cards, onlyMessages, onToggle, onDone }: { cards: Decision[]; onlyMessages: boolean; onToggle: () => void; onDone: (ids: string[]) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (cards.length < 2) return null;
  const approveAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await teamApi.batchApprove(cards.map((c) => c.id), deviceLabel());
      const failed = r.results.filter((x) => !x.ok);
      toast(failed.length ? `${r.approved} mesaj gönderildi; ${failed.length} mesajı açıp bakın` : `${r.approved} mesaj onaylandı ve gönderildi`);
      if (failed.length) setError(failed.map((f) => f.error).filter(Boolean).join(' · '));
      onDone(r.results.filter((x) => x.ok).map((x) => x.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const channels = [...new Set(cards.map(channelLabel))].join(', ');
  return (
    <section className="qa-batch" aria-label="Toplu mesaj onayı">
      <h2 className="qa-batch__title">{cards.length} mesaj onay bekliyor</h2>
      <p className="muted small">{channels} · her mesaj sizin onayınızla, ayrı kayıtla gider.</p>
      <div className="qa-batch__actions">
        <Button icon="check" busy={busy} onClick={() => void approveAll()}>Hepsini onayla</Button>
        <Button variant="secondary" disabled={busy} onClick={onToggle} aria-pressed={onlyMessages}>{onlyMessages ? 'Tüm kartlar' : 'Tek tek bak'}</Button>
      </div>
      <InlineError message={error} />
    </section>
  );
}

/** One-tap strip under a message card: who it goes to + "Tek dokunuşla gönder". Open the card to edit or reject. */
export function OneTapStrip({ d, onDone }: { d: Decision; onDone: (id: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const to = d.detail?.to ? String(d.detail.to) : null;
  return (
    <div className="qa-strip">
      <span className="qa-strip__to muted small">
        {channelLabel(d)}{to ? ` · ${to}` : ''}{d.assignedToName ? ` · ${d.escalationLevel ? 'size yükseldi' : 'nöbet'}` : ''}
      </span>
      <Button size="sm" variant="secondary" icon="send" busy={busy} aria-label={`Tek dokunuşla gönder: ${d.summary}`} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await api.decisions.decide(d.id, { action: 'approve', device: deviceLabel() });
          toast('Onaylandı ve gönderildi');
          onDone(d.id);
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}>Tek dokunuşla gönder</Button>
      <InlineError message={error} />
    </div>
  );
}
