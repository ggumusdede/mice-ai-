import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { Decision, DecisionInput } from '@mice/shared';
import { api, errorMessage } from '../api/client';
import { useApi } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n';
import { relative, dateTime } from '../lib/format';
import { biometricAssertion, deviceLabel, webauthnSupported } from '../lib/webauthn';
import { BottomSheet } from '../components/BottomSheet';
import { DetailView } from '../components/DetailView';
import { DraftEditor } from '../components/DraftEditor';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { Button, Callout, DecisionBadgePill, ErrorBox, InlineError, Pill, Spinner } from '../components/ui';
import { OneTapStrip, QuickBatchCard, isQuickCard } from '../components/QuickApproval';

/** Decision effects come back as machine codes (`project_assigned:<uuid>`, `rfq_sent:<id>`); show them in Turkish. */
const EFFECT_LABELS: Record<string, string> = {
  project_assigned: 'Proje atandı', assignment_rejected: 'Atama reddedildi', rfq_sent: 'RFQ gönderildi', rfqs_cancelled: 'RFQ’lar iptal edildi',
  quote_approved: 'Teklif onaylandı', quote_rejected: 'Teklif reddedildi', quote_returned_for_edit: 'Teklif düzeltmeye döndü',
  margin_override_applied: 'Marj istisnası uygulandı', margin_override_recorded: 'Marj istisnası kaydedildi', margin_override_rejected: 'Marj istisnası reddedildi',
  quote_still_blocked: 'Teklif hâlâ bloklu', supplier_accredited: 'Tedarikçi akredite edildi', accreditation_rejected: 'Akreditasyon reddedildi',
  draft_approved: 'Taslak onaylandı', draft_sent: 'Mesaj gönderildi', draft_discarded: 'Taslak iptal edildi', revision_request_sent: 'Revizyon talebi gönderildi',
  diff_dismissed: 'Fark kapatıldı', contract_approved: 'Sözleşme onaylandı', contract_returned: 'Sözleşme taslağa döndü', contract_locked: 'Sözleşme kilitlendi',
  contract_approval_requested: 'Sözleşme onayı istendi', condition_risk_not_accepted: 'Koşul riski kabul edilmedi', condition_risk_accepted: 'Koşul riski kabul edildi', contract_not_pending: 'Sözleşme onay beklemiyor', acknowledged: 'Not alındı',
  automation_promoted: 'Otomasyona alındı', automation_promotion_proposed: 'Otomasyon önerildi', automation_demoted: 'Otomasyondan çıkarıldı',
  promotion_declined: 'Otomasyon önerisi reddedildi', sample_reviewed: 'Örneklem incelendi', audit_sample_created: 'Örneklem denetimi açıldı',
  checklist_question_activated: 'Soru kontrol listesine eklendi', checklist_question_rejected: 'Soru reddedildi', rule_changed: 'Kural güncellendi',
  rule_suggestion_rejected: 'Kural önerisi reddedildi', offer_verified: 'Okuma doğrulandı', reading_rejected: 'Okuma reddedildi',
};
export function effectLabel(code: string): string {
  const [key, arg] = code.split(':', 2);
  const label = EFFECT_LABELS[key];
  if (!label) return code.replace(/_/g, ' ');
  // ids carry no meaning for the user; keep short non-id arguments (rule key, action type)
  return arg && !/^[0-9a-f-]{20,}$/i.test(arg) ? `${label} (${arg})` : label;
}

const BADGE_ORDER = { critical: 0, within_rules: 1, suggestion: 2 } as const;

export function sortDecisions(list: Decision[]): Decision[] {
  return [...list].sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      BADGE_ORDER[a.badge] - BADGE_ORDER[b.badge] ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export function DecisionInboxPage() {
  const t = useT();
  const { user } = useAuth();
  const res = useApi(() => api.decisions.list('open'), [], { pollMs: 30_000 });
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useMemo(() => sortDecisions(res.data ?? []), [res.data]);
  // v0.5 S-01: outbound message cards — one-tap strip under each, a batch card on top when 2+ wait ("tek tek bak" filters)
  const quick = useMemo(() => list.filter(isQuickCard), [list]);
  const [onlyMessages, setOnlyMessages] = useState(false);
  const shown = onlyMessages && quick.length ? quick : list;
  const dropIds = (ids: string[]) => res.setData((prev) => (prev ?? []).filter((x) => !ids.includes(x.id)));
  const current = list.find((d) => d.id === openId) ?? null;

  // pull-to-refresh
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const THRESHOLD = 72;
  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    await res.reload();
    setRefreshing(false);
  }, [res]);

  if (user?.role === 'field' && !res.loading && !list.length) return <Navigate to="/saha" replace />;

  return (
    <div
      className="inbox mobile-page"
      onTouchStart={(e) => {
        if (window.scrollY <= 0) startY.current = e.touches[0].clientY;
      }}
      onTouchMove={(e) => {
        if (startY.current === null) return;
        const d = e.touches[0].clientY - startY.current;
        setPull(d > 0 ? Math.min(110, d * 0.5) : 0);
      }}
      onTouchEnd={() => {
        if (pull >= THRESHOLD * 0.75) void doRefresh();
        setPull(0);
        startY.current = null;
      }}
    >
      <div className="ptr" style={{ height: refreshing ? 44 : pull }} aria-hidden={!refreshing && !pull}>
        {refreshing ? <Spinner label={t.inbox.refreshing} /> : pull ? <span className="muted small">{pull >= THRESHOLD * 0.75 ? t.inbox.releaseToRefresh : t.inbox.pullToRefresh}</span> : null}
      </div>

      <header className="page-head page-head--large">
        <div>
          <p className="page-head__eyebrow">{new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
          <h1 className="page-head__title">{t.inbox.title}</h1>
          <p className="page-head__sub" aria-live="polite">{res.data ? t.inbox.subtitle(list.length) : ' '}</p>
        </div>
        <div className="page-head__actions">
          <button type="button" className="icon-btn icon-btn--filled" onClick={() => void doRefresh()} aria-label={t.common.reload} disabled={refreshing}>
            <Icon name="refresh" className={refreshing || res.loading ? 'spin' : ''} />
          </button>
        </div>
      </header>

      {res.error && !res.data ? <ErrorBox error={res.error} onRetry={() => void res.reload()} /> : null}
      {!res.data && res.loading ? <InboxSkeleton /> : null}

      {res.data && list.length === 0 ? <AllGood lastLoadedAt={res.lastLoadedAt} /> : null}

      <QuickBatchCard cards={quick} onlyMessages={onlyMessages} onToggle={() => setOnlyMessages((x) => !x)} onDone={dropIds} />

      {shown.length > 0 ? (
        <ul className="decision-list" aria-label={t.inbox.title}>
          {shown.map((d) => (
            <li key={d.id}>
              <DecisionCard d={d} onOpen={() => setOpenId(d.id)} />
              {isQuickCard(d) ? <OneTapStrip d={d} onDone={(id) => dropIds([id])} /> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {current ? (
        <DecisionSheet
          decision={current}
          onClose={() => setOpenId(null)}
          onDecided={(id) => {
            res.setData((prev) => (prev ?? []).filter((x) => x.id !== id));
            setOpenId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DecisionCard({ d, onOpen }: { d: Decision; onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" className={`dcard dcard--${d.badge} ${d.urgent ? 'dcard--urgent' : ''}`} onClick={onOpen}>
      <div className="dcard__top">
        <span className="dcard__kind">{t.decisionKind[d.kind] ?? d.kind}</span>
        <span className="dcard__badges">
          {d.urgent ? <Pill tone="danger" icon="alert">{t.inbox.urgent}</Pill> : null}
          {d.routedToDeputy ? <Pill tone="purple" icon="shield">Vekil olarak size</Pill> : null}
          <DecisionBadgePill badge={d.badge} />
        </span>
      </div>
      <p className="dcard__summary">{d.summary}</p>
      <div className="dcard__meta">
        {d.projectCode ? <span className="dcard__code">{d.projectCode}</span> : <span />}
        <span className="dcard__time">
          {d.requiresBiometric ? <Icon name="faceid" size={14} title="Face ID" /> : null}
          {relative(d.createdAt)}
          <Icon name="chevronRight" size={16} />
        </span>
      </div>
    </button>
  );
}

function AllGood({ lastLoadedAt }: { lastLoadedAt: number | null }) {
  const t = useT();
  return (
    <div className="allgood" role="status">
      <div className="allgood__orb" aria-hidden>
        <Icon name="check" size={44} />
      </div>
      <h2 className="allgood__title">{t.inbox.allGoodTitle}</h2>
      <p className="allgood__body">{t.inbox.allGoodBody}</p>
      {lastLoadedAt ? <p className="muted small">{t.common.lastUpdated}: {dateTime(new Date(lastLoadedAt).toISOString())}</p> : null}
    </div>
  );
}

function InboxSkeleton() {
  return (
    <ul className="decision-list" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i}><div className="dcard dcard--skeleton"><span /><span /><span /></div></li>
      ))}
    </ul>
  );
}

type Mode = 'view' | 'edit' | 'reject';

export function DecisionSheet({ decision: d, onClose, onDecided }: { decision: Decision; onClose: () => void; onDecided: (id: string) => void }) {
  const t = useT();
  const toast = useToast();
  const { isDelegate } = useAuth();
  const [mode, setMode] = useState<Mode>('view');
  const [draft, setDraft] = useState<Record<string, unknown>>(d.draft ?? {});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bioFailed, setBioFailed] = useState(false);
  const canWebauthn = webauthnSupported();
  const showDevFallback = d.requiresBiometric && (!canWebauthn || bioFailed || import.meta.env.DEV);

  const decide = async (input: Omit<DecisionInput, 'device' | 'biometric'>, biometric: 'webauthn' | 'dev' | 'none') => {
    setBusy(true);
    setError(null);
    try {
      let bio: DecisionInput['biometric'];
      if (biometric === 'webauthn') {
        try {
          bio = await biometricAssertion(d.id);
        } catch (e) {
          setBioFailed(true);
          throw new Error(`${t.inbox.biometricFailed}: ${errorMessage(e)}`);
        }
      } else if (biometric === 'dev') bio = { method: 'dev' };
      const r = await api.decisions.decide(d.id, { ...input, device: deviceLabel(), biometric: bio });
      toast(r.effects?.length ? `${t.inbox.decided} · ${[...new Set(r.effects.map(effectLabel))].join(' · ')}` : t.inbox.decided);
      onDecided(d.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // §17: a below-target margin can only be opened with a written reason (server: REASON_REQUIRED)
  const needsApproveReason = d.kind === 'margin_override';
  const [approveReason, setApproveReason] = useState('');
  const approveInput = (base: Omit<DecisionInput, 'device' | 'biometric'>) => (needsApproveReason ? { ...base, reason: approveReason.trim() } : base);
  const approveBlocked = needsApproveReason && !approveReason.trim();

  const approveMode: 'webauthn' | 'dev' | 'none' = d.requiresBiometric ? (canWebauthn ? 'webauthn' : 'dev') : 'none';
  const hasDraft = d.draft && Object.keys(d.draft).length > 0;

  const footer =
    mode === 'view' ? (
      <div className="sheet-actions">
        <Button size="lg" className="btn--block" icon={d.requiresBiometric ? 'faceid' : 'check'} busy={busy} disabled={approveBlocked} onClick={() => void decide(approveInput({ action: 'approve' }), approveMode)}>
          {d.primaryActionLabel || t.common.approve}
        </Button>
        {showDevFallback && approveMode === 'webauthn' ? (
          <Button variant="ghost" size="sm" icon="shield" disabled={busy || approveBlocked} onClick={() => void decide(approveInput({ action: 'approve' }), 'dev')}>
            {t.inbox.devFallback}
          </Button>
        ) : null}
        <div className="sheet-actions__row">
          <Button variant="secondary" icon="doc" disabled={busy} onClick={() => setMode('edit')}>
            {t.common.edit}
          </Button>
          <Button variant="secondary" className="btn--danger-text" icon="x" disabled={busy} onClick={() => setMode('reject')}>
            {t.common.reject}
          </Button>
        </div>
      </div>
    ) : mode === 'edit' ? (
      <div className="sheet-actions">
        <Button size="lg" className="btn--block" icon={d.requiresBiometric ? 'faceid' : 'check'} busy={busy} disabled={approveBlocked} onClick={() => void decide(approveInput({ action: 'edit', edits: draft }), approveMode)}>
          {t.inbox.sendEdits}
        </Button>
        {showDevFallback && approveMode === 'webauthn' ? (
          <Button variant="ghost" size="sm" icon="shield" disabled={busy || approveBlocked} onClick={() => void decide(approveInput({ action: 'edit', edits: draft }), 'dev')}>
            {t.inbox.devFallback}
          </Button>
        ) : null}
        <Button variant="ghost" disabled={busy} onClick={() => setMode('view')}>{t.common.back}</Button>
      </div>
    ) : (
      <div className="sheet-actions">
        <Button variant="danger" size="lg" className="btn--block" busy={busy} disabled={!reason.trim()} onClick={() => void decide({ action: 'reject', reason: reason.trim() }, 'none')}>
          {t.common.reject}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setMode('view')}>{t.common.back}</Button>
      </div>
    );

  return (
    <BottomSheet open onClose={onClose} title={t.decisionKind[d.kind] ?? d.kind} footer={footer}>
      <div className="dsheet">
        <div className="dsheet__badges">
          <DecisionBadgePill badge={d.badge} />
          {d.urgent ? <Pill tone="danger" icon="alert">{t.inbox.urgent}</Pill> : null}
          {d.projectCode && d.projectId ? (
            <Link className="pill pill--accent" to={`/projeler/${d.projectId}`} onClick={onClose}>
              {d.projectCode}
            </Link>
          ) : d.projectCode ? <Pill>{d.projectCode}</Pill> : null}
        </div>
        <p className="dsheet__summary">{d.summary}</p>

        {isDelegate ? (
          <Callout tone="purple" icon="shield">{t.inbox.delegationMarker}</Callout>
        ) : null}

        {mode === 'view' ? (
          <>
            {d.aiNote ? (
              <div className="ainote">
                <div className="ainote__head"><Icon name="sparkle" size={16} /> {t.inbox.aiNote}</div>
                <p className="pre-line">{d.aiNote}</p>
              </div>
            ) : null}
            {d.detail && Object.keys(d.detail).length ? (
              <section aria-label={t.inbox.detail}>
                <h3 className="section-title">{t.inbox.detail}</h3>
                <DetailView data={d.detail} />
              </section>
            ) : null}
            {needsApproveReason ? (
              <div className="field">
                <label className="field__label" htmlFor="approve-reason">{t.inbox.approveReasonLabel}</label>
                <textarea id="approve-reason" className="input textarea" rows={3} placeholder={t.inbox.approveReasonPlaceholder} value={approveReason} onChange={(e) => setApproveReason(e.target.value)} />
              </div>
            ) : null}
            {d.requiresBiometric ? (
              <Callout tone="accent" icon="faceid">
                {t.inbox.biometricRequired}
                {!canWebauthn ? <><br />{t.inbox.webauthnUnavailable}</> : null}
              </Callout>
            ) : null}
          </>
        ) : null}

        {mode === 'edit' ? (
          <section>
            <h3 className="section-title">{t.inbox.editTitle}</h3>
            <p className="muted small">{t.inbox.editHint}</p>
            {hasDraft ? <DraftEditor draft={draft} onChange={setDraft} /> : (
              <div className="field">
                <label className="field__label" htmlFor="edit-note">{t.common.notes}</label>
                <textarea id="edit-note" className="input textarea" rows={5} value={String(draft.note ?? '')} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </div>
            )}
          </section>
        ) : null}

        {mode === 'reject' ? (
          <div className="field">
            <label className="field__label" htmlFor="reject-reason">{t.inbox.rejectReasonLabel}</label>
            <textarea id="reject-reason" className="input textarea" rows={4} autoFocus placeholder={t.inbox.rejectReasonPlaceholder} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        ) : null}

        <InlineError message={error} />
      </div>
    </BottomSheet>
  );
}
