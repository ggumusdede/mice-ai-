import { useEffect, useState } from 'react';
import { DEFAULT_RULES, type MarkupTier, type TenantRules } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { marginFromMarkup, pct } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorBox, InlineError, Loading } from '../../components/ui';

/** Keys whose values are fractions → edited as %. */
const FRACTION_KEYS = new Set<keyof TenantRules>(['targetMarginMin', 'goodPriceAdvantage', 'goodPriceVsMedian', 'automationSampleRate', 'aiConfidenceThreshold', 'accommodationTaxRate']);
const SCALAR_KEYS: (keyof TenantRules)[] = [
  'targetMarginMin', 'goodPriceAdvantage', 'goodPriceVsMedian', 'customerOptionBusinessDays', 'quoteTargetBusinessDays', 'quoteFollowupBusinessDays',
  'optionExpiryWarningDays', 'quoteOptionsMin', 'quoteOptionsMax', 'rfqMinSuppliers', 'rfqMaxSuppliers', 'rfqReminderHours', 'rfqCallTaskHours',
  'maxNegotiationRounds', 'fieldExtraPerItemLimitTry', 'fieldExtraPerProjectLimitTry', 'unbilledPaymentEscalationDays', 'closingDeadlineDays',
  'automationPromotionThreshold', 'automationSampleRate', 'aiConfidenceThreshold', 'lowSupplierScore', 'guestDataRetentionDays', 'accommodationTaxRate',
];

/** §8 Blok 5 — "Kod değil tablo; yönetici değiştirir." Admin only; AI can never call PATCH /rules. */
export function RulesPage() {
  const t = useT();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const res = useApi(() => api.rules.get(), []);
  const [rules, setRules] = useState<TenantRules | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (res.data) setRules({ ...DEFAULT_RULES, ...res.data });
  }, [res.data]);

  if (res.error && !res.data) return <ErrorBox error={res.error} onRetry={() => void res.reload()} />;
  if (!rules) return <Loading />;

  const changed = (Object.keys(rules) as (keyof TenantRules)[]).filter((k) => JSON.stringify(rules[k]) !== JSON.stringify(res.data?.[k]));
  const setTier = (i: number, patch: Partial<MarkupTier>) => setRules({ ...rules, markupTiers: rules.markupTiers.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <div className="stack stack--lg">
      <Card title={t.admin.markupTiers} padded={false}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t.admin.minAdvantage}</th>
                <th scope="col">{t.admin.markup} (Kâr ÷ Alış)</th>
                <th scope="col">{t.admin.impliedMargin} (Kâr ÷ Satış)</th>
                <th scope="col"><span className="sr-only">İşlem</span></th>
              </tr>
            </thead>
            <tbody>
              {[...rules.markupTiers].map((tier, i) => (
                <tr key={i}>
                  <td>
                    <label className="sr-only" htmlFor={`tier-a-${i}`}>{t.admin.minAdvantage}</label>
                    <span className="input-affix"><input id={`tier-a-${i}`} className="input input--sm" type="number" step="0.5" disabled={!isAdmin} value={+(tier.minAdvantage * 100).toFixed(2)} onChange={(e) => setTier(i, { minAdvantage: Number(e.target.value) / 100 })} /><span>%</span></span>
                  </td>
                  <td>
                    <label className="sr-only" htmlFor={`tier-m-${i}`}>{t.admin.markup}</label>
                    <span className="input-affix"><input id={`tier-m-${i}`} className="input input--sm" type="number" step="0.5" disabled={!isAdmin} value={+(tier.markup * 100).toFixed(2)} onChange={(e) => setTier(i, { markup: Number(e.target.value) / 100 })} /><span>%</span></span>
                  </td>
                  <td className="muted">{pct(marginFromMarkup(tier.markup))}</td>
                  <td className="num">{isAdmin && rules.markupTiers.length > 1 ? <Button size="sm" variant="ghost" icon="x" onClick={() => setRules({ ...rules, markupTiers: rules.markupTiers.filter((_, j) => j !== i) })}>{t.common.remove}</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isAdmin ? (
          <div className="card--padded">
            <Button size="sm" variant="ghost" icon="plus" onClick={() => {
              const last = rules.markupTiers[rules.markupTiers.length - 1];
              setRules({ ...rules, markupTiers: [...rules.markupTiers, { minAdvantage: (last?.minAdvantage ?? 0) + 0.05, markup: (last?.markup ?? 0.05) + 0.05 }] });
            }}>{t.admin.addTier}</Button>
          </div>
        ) : null}
      </Card>

      <Card title={t.admin.rules}>
        <div className="rules-grid">
          {SCALAR_KEYS.map((k) => {
            const v = rules[k] as number;
            const frac = FRACTION_KEYS.has(k);
            const id = `rule-${k}`;
            return (
              <div key={k} className={`field ${changed.includes(k) ? 'field--changed' : ''}`}>
                <label className="field__label" htmlFor={id}>{t.ruleLabels[k] ?? k}</label>
                <span className="input-affix">
                  <input id={id} className="input" type="number" step="any" disabled={!isAdmin} value={frac ? +(v * 100).toFixed(4) : v} onChange={(e) => setRules({ ...rules, [k]: frac ? Number(e.target.value) / 100 : Number(e.target.value) })} />
                  {frac ? <span>%</span> : null}
                </span>
              </div>
            );
          })}
          <div className="field">
            <label className="field__label" htmlFor="rule-prefix">{t.ruleLabels.projectCodePrefix}</label>
            <input id="rule-prefix" className="input" disabled={!isAdmin} value={rules.projectCodePrefix} onChange={(e) => setRules({ ...rules, projectCodePrefix: e.target.value })} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="rule-vat-acc">KDV konaklama / hizmet</label>
            <span className="row">
              <span className="input-affix"><input id="rule-vat-acc" className="input" type="number" disabled={!isAdmin} value={+(rules.vatRates.accommodation * 100).toFixed(2)} onChange={(e) => setRules({ ...rules, vatRates: { ...rules.vatRates, accommodation: Number(e.target.value) / 100 } })} /><span>%</span></span>
              <span className="input-affix"><input aria-label="KDV hizmet" className="input" type="number" disabled={!isAdmin} value={+(rules.vatRates.service * 100).toFixed(2)} onChange={(e) => setRules({ ...rules, vatRates: { ...rules.vatRates, service: Number(e.target.value) / 100 } })} /><span>%</span></span>
            </span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="rule-bh">Mesai saatleri</label>
            <span className="row">
              <input id="rule-bh" className="input" type="time" disabled={!isAdmin} value={rules.businessHours.start} onChange={(e) => setRules({ ...rules, businessHours: { ...rules.businessHours, start: e.target.value } })} />
              <input aria-label="Mesai bitişi" className="input" type="time" disabled={!isAdmin} value={rules.businessHours.end} onChange={(e) => setRules({ ...rules, businessHours: { ...rules.businessHours, end: e.target.value } })} />
            </span>
          </div>
        </div>
      </Card>

      {isAdmin ? (
        <div className="sticky-actions">
          <InlineError message={error} />
          <span className="muted small">{changed.length ? `${changed.length} değişiklik` : ''}</span>
          <Button variant="ghost" disabled={!changed.length} onClick={() => setRules({ ...DEFAULT_RULES, ...res.data! })}>{t.common.cancel}</Button>
          <Button busy={busy} disabled={!changed.length} onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const patch = Object.fromEntries(changed.map((k) => [k, rules[k]])) as Partial<TenantRules>;
              res.setData(await api.rules.patch(patch));
              toast(t.admin.rulesSaved);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}>{t.common.save}</Button>
        </div>
      ) : null}
    </div>
  );
}
