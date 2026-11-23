// v0.5-A Kurallar sayfası: "Ana para birimi" (S-19; yönetici, Face ID kararı, yalnız yeni projeler) + para / tedarik kuralları
// (S-06 kapora önce, S-07 kur payı, S-03 hatırlatma günleri) — kısa, sade, ileri ayarlar katlanmış. Kendi kaydet düğmesi var.
import { useEffect, useState } from 'react';
import { BASE_CURRENCIES, DEFAULT_RULES, type TenantRules } from '@mice/shared';
import { api, errorMessage } from '../api/client';
import { moneyApi } from '../api/moneyClient';
import { useApi } from '../api/hooks';
import { useT } from '../i18n';
import { biometricAssertion, deviceLabel } from '../lib/webauthn';
import { useToast } from './Toast';
import { Button, Callout, Card, InlineError } from './ui';

type Keys = 'depositFirstMode' | 'quoteFxBufferDefault' | 'showFxBufferToCustomer' | 'showFxClauseOnQuote' | 'quoteFxClauseText' | 'allotmentReleaseWarningDays' | 'supplierOptionWarningDays';

export function MoneyRules({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  const toast = useToast();
  const settings = useApi(() => moneyApi.settings(), []);
  const rulesRes = useApi(() => api.rules.get(), []);
  const [next, setNext] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [r, setR] = useState<Pick<TenantRules, Keys> | null>(null);
  useEffect(() => {
    if (rulesRes.data) {
      const d = { ...DEFAULT_RULES, ...rulesRes.data };
      setR({ depositFirstMode: d.depositFirstMode, quoteFxBufferDefault: d.quoteFxBufferDefault, showFxBufferToCustomer: d.showFxBufferToCustomer, showFxClauseOnQuote: d.showFxClauseOnQuote, quoteFxClauseText: d.quoteFxClauseText, allotmentReleaseWarningDays: d.allotmentReleaseWarningDays, supplierOptionWarningDays: d.supplierOptionWarningDays });
    }
  }, [rulesRes.data]);
  const cur = settings.data?.baseCurrency ?? 'EUR';
  const pending = settings.data?.pendingBaseCurrency ?? null;

  const change = async () => {
    setBusy(true);
    setError(null);
    try {
      const { decisionId } = await moneyApi.requestBaseCurrency(next, reason.trim());
      try {
        const biometric = await biometricAssertion(decisionId);
        await api.decisions.decide(decisionId, { action: 'approve', biometric, device: deviceLabel() });
        toast(t.money.baseChanged(next));
      } catch {
        toast(t.money.basePending(next)); // Face ID not available here → approve from the decision inbox
      }
      setNext('');
      setReason('');
      await settings.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!r) return;
    setBusy(true);
    setError(null);
    try {
      await api.rules.patch(r);
      toast(t.money.saved);
      await rulesRes.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t.money.baseCurrency}>
      <div className="stack">
        <p><strong>{t.money.baseCurrent(cur)}</strong></p>
        {pending ? <Callout tone="warning" icon="alert">{t.money.basePending(pending.currency)}</Callout> : null}
        {isAdmin ? (
          <>
            <Callout tone="accent" icon="info">{t.money.baseWarning}</Callout>
            <div className="grid-2">
              <label className="field">
                <span className="field__label">{t.money.baseNew}</span>
                <select className="input select" value={next} onChange={(e) => setNext(e.target.value)}>
                  <option value="">—</option>
                  {BASE_CURRENCIES.filter((c) => c !== cur).map((c) => <option key={c} value={c}>{c === 'TRY' ? 'TL (TRY)' : c}</option>)}
                </select>
              </label>
              {next ? (
                <label className="field">
                  <span className="field__label">{t.money.baseReason}</span>
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
              ) : null}
            </div>
            {next ? <div className="row-end"><Button busy={busy} disabled={!reason.trim()} onClick={() => void change()}>{t.money.baseChange}</Button></div> : null}
          </>
        ) : null}
        {r ? (
          <details className="more">
            <summary>{t.money.controlRules}</summary>
            <div className="stack">
              <label className="field">
                <span className="field__label">{t.money.depositFirstMode}</span>
                <select className="input select" disabled={!isAdmin} value={r.depositFirstMode} onChange={(e) => setR({ ...r, depositFirstMode: e.target.value as 'warn' | 'block' })}>
                  <option value="warn">{t.money.depositWarn}</option>
                  <option value="block">{t.money.depositBlock}</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">{t.money.fxBufferDefault}</span>
                <input className="input" type="number" step="0.5" min="0" disabled={!isAdmin} value={+(r.quoteFxBufferDefault * 100).toFixed(2)} onChange={(e) => setR({ ...r, quoteFxBufferDefault: Math.max(0, Number(e.target.value)) / 100 })} />
                <span className="field__hint">{t.money.fxBufferHint}</span>
              </label>
              <label className="row"><input type="checkbox" disabled={!isAdmin} checked={r.showFxBufferToCustomer} onChange={(e) => setR({ ...r, showFxBufferToCustomer: e.target.checked })} /><span>{t.money.showFxBuffer}</span></label>
              <label className="row"><input type="checkbox" disabled={!isAdmin} checked={r.showFxClauseOnQuote} onChange={(e) => setR({ ...r, showFxClauseOnQuote: e.target.checked })} /><span>{t.money.showFxClause}</span></label>
              {r.showFxClauseOnQuote ? (
                <label className="field"><span className="field__label">{t.money.fxClause}</span><textarea className="input" rows={2} disabled={!isAdmin} value={r.quoteFxClauseText} onChange={(e) => setR({ ...r, quoteFxClauseText: e.target.value })} /></label>
              ) : null}
              <div className="grid-2">
                <label className="field"><span className="field__label">{t.money.releaseDays}</span><input className="input" type="number" min="1" disabled={!isAdmin} value={r.allotmentReleaseWarningDays} onChange={(e) => setR({ ...r, allotmentReleaseWarningDays: Math.max(1, Number(e.target.value)) })} /></label>
                <label className="field"><span className="field__label">{t.money.optionDays}</span><input className="input" type="number" min="1" disabled={!isAdmin} value={r.supplierOptionWarningDays} onChange={(e) => setR({ ...r, supplierOptionWarningDays: Math.max(1, Number(e.target.value)) })} /></label>
              </div>
              {isAdmin ? <div className="row-end"><Button variant="secondary" busy={busy} onClick={() => void save()}>{t.money.save}</Button></div> : null}
            </div>
          </details>
        ) : null}
        <InlineError message={error} />
      </div>
    </Card>
  );
}
