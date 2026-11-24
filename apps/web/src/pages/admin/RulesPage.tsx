import { useEffect, useState } from 'react';
import { DEFAULT_RULES, type MarkupTier, type TenantRules } from '@mice/shared';
import { api, errorMessage } from '../../api/client';
import { useApi } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { marginFromMarkup, pct } from '../../lib/format';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorBox, InlineError, Loading } from '../../components/ui';
import { ProductDecisionRules } from '../../components/ProductDecisionRules';
import { MoneyRules } from '../../components/MoneyRules';

/** Keys whose values are fractions → edited as %. */
const FRACTION_KEYS = new Set<keyof TenantRules>(['targetMarginMin', 'goodPriceAdvantage', 'goodPriceVsMedian', 'automationSampleRate', 'aiConfidenceThreshold', 'accommodationTaxRate']);
const SCALAR_KEYS: (keyof TenantRules)[] = [
  'targetMarginMin', 'goodPriceAdvantage', 'goodPriceVsMedian', 'customerOptionBusinessDays', 'quoteTargetBusinessDays', 'quoteFollowupBusinessDays',
  'optionExpiryWarningDays', 'quoteOptionsMin', 'quoteOptionsMax', 'rfqMinSuppliers', 'rfqMaxSuppliers', 'rfqReminderHours', 'rfqCallTaskHours',
  'maxNegotiationRounds', 'fieldExtraPerItemLimitTry', 'fieldExtraPerProjectLimitTry', 'unbilledPaymentEscalationDays', 'closingDeadlineDays',
  'automationPromotionThreshold', 'automationSampleRate', 'aiConfidenceThreshold', 'lowSupplierScore', 'guestDataRetentionDays', 'accommodationTaxRate',
  'criticalPushFallbackMinutes',
];

/** [Ürün kararı] boolean rules (docs/09 G-15 … G-17); defaults are the conservative option. */
const PRODUCT_TOGGLES: { key: 'hideCustomerFromSuppliers' | 'fieldRoleCanSeeFinancials' | 'outboundAutoSendRequiresStandingApproval'; label: string; hint: string }[] = [
  { key: 'hideCustomerFromSuppliers', label: 'Tedarikçiden müşteri adını gizle', hint: 'RFQ, hatırlatma, tedarikçi formu, konfirmasyon, rooming list: PRJ-0042-20270312-80 referansı (varsayılan: açık).' },
  { key: 'fieldRoleCanSeeFinancials', label: 'Saha rolü finansal verileri görebilir', hint: 'Kâr, P&L, finans kayıtları, teklif maliyet / marj, sözleşme tutarları (varsayılan: kapalı).' },
  { key: 'outboundAutoSendRequiresStandingApproval', label: 'Otomasyon terfisi dış mesajlar için kalıcı onay sayılır', hint: 'Açıksa terfi edilmiş RFQ / pazarlık / opsiyon / revizyon mesajları otomatik gider; kapalıyken yine tek dokunuşla onaya gelir (varsayılan: kapalı).' },
];
/** Candidates for `neverAutomateKinds` (AI action types / decision kinds that a promotion could otherwise automate). */
const AUTOMATABLE: { key: string; label: string }[] = [
  { key: 'customer_quote', label: 'Müşteri teklifi' }, { key: 'quote_approval', label: 'Teklif onayı' }, { key: 'margin_override', label: 'Marj altı açma' },
  { key: 'rfq_send', label: 'RFQ gönderimi' }, { key: 'negotiation_message', label: 'Pazarlık mesajı' }, { key: 'option_extension_request', label: 'Opsiyon uzatma talebi' },
  { key: 'revision_request', label: 'Revizyon talebi' }, { key: 'team_assignment', label: 'Ekip ataması' }, { key: 'low_confidence_payment_match', label: 'Düşük güvenli ödeme eşleşmesi' },
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
      <MoneyRules isAdmin={isAdmin} />
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

      {rules.supplierSeasonMarkups?.length || rules.supplierRfqHours?.length ? (
        <Card title="Kapsamlı kurallar (§16.5 kural önerilerinden)" padded={false}>
          <div className="table-wrap">
            <table className="table table--compact">
              <thead><tr><th scope="col">Tedarikçi</th><th scope="col">Kural</th><th scope="col">Değer</th><th scope="col"><span className="sr-only">İşlem</span></th></tr></thead>
              <tbody>
                {(rules.supplierSeasonMarkups ?? []).map((o, i) => (
                  <tr key={`s${i}`}>
                    <td>{o.supplierName ?? o.supplierId}</td>
                    <td>Sezon markup ({o.months.join(', ')}. ay) — yalnız fiyat sınıfı bilinmiyorsa</td>
                    <td className="num">{pct(o.markup)}</td>
                    <td className="num">{isAdmin ? <Button size="sm" variant="ghost" icon="x" onClick={() => setRules({ ...rules, supplierSeasonMarkups: rules.supplierSeasonMarkups.filter((_, j) => j !== i) })}>{t.common.remove}</Button> : null}</td>
                  </tr>
                ))}
                {(rules.supplierRfqHours ?? []).map((o, i) => (
                  <tr key={`r${i}`}>
                    <td>{o.supplierName ?? o.supplierId}</td>
                    <td>RFQ hatırlatma / telefon görevi</td>
                    <td className="num">{o.reminderHours} / {o.callTaskHours} sa</td>
                    <td className="num">{isAdmin ? <Button size="sm" variant="ghost" icon="x" onClick={() => setRules({ ...rules, supplierRfqHours: rules.supplierRfqHours.filter((_, j) => j !== i) })}>{t.common.remove}</Button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

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

      <Card title="Ürün kararları — gizlilik ve otomasyon">
        <p className="muted small">Ürün sahibi karar verene kadar güvenli (muhafazakâr) varsayılanlar; yalnız yönetici değiştirir.</p>
        <div className="stack">
          {PRODUCT_TOGGLES.map(({ key, label, hint }) => (
            <label key={key} className={`row ${changed.includes(key) ? 'field--changed' : ''}`}>
              <input type="checkbox" disabled={!isAdmin} checked={rules[key] === true} onChange={(e) => setRules({ ...rules, [key]: e.target.checked })} />
              <span><strong>{label}</strong><br /><span className="muted small">{hint}</span></span>
            </label>
          ))}
          <fieldset className={`field ${changed.includes('neverAutomateKinds') ? 'field--changed' : ''}`}>
            <legend className="field__label">Asla otomatiğe alınmayan işler (Face ID gereken para onayları)</legend>
            {AUTOMATABLE.map(({ key, label }) => (
              <label key={key} className="row">
                <input type="checkbox" disabled={!isAdmin} checked={rules.neverAutomateKinds.includes(key)}
                  onChange={(e) => setRules({ ...rules, neverAutomateKinds: e.target.checked ? [...rules.neverAutomateKinds, key] : rules.neverAutomateKinds.filter((x) => x !== key) })} />
                <span>{label} <span className="muted small mono">{key}</span></span>
              </label>
            ))}
          </fieldset>
          <label className={`field ${changed.includes('fxRateTypeForReporting') ? 'field--changed' : ''}`}>
            <span className="field__label">TL raporlamada kur türü (EUR'ya çevrimsiz ödeme / tahsilat: valör günü TCMB kuru)</span>
            <select className="input select" disabled={!isAdmin} value={rules.fxRateTypeForReporting ?? 'tcmb_forex_buying'}
              onChange={(e) => setRules({ ...rules, fxRateTypeForReporting: e.target.value as TenantRules['fxRateTypeForReporting'] })}>
              <option value="tcmb_forex_buying">TCMB döviz alış (varsayılan, VUK değerleme)</option>
              <option value="tcmb_forex_selling">TCMB döviz satış</option>
              <option value="tcmb_banknote_buying">TCMB efektif alış</option>
              <option value="tcmb_banknote_selling">TCMB efektif satış</option>
            </select>
          </label>
        </div>
      </Card>

      <ProductDecisionRules rules={rules} setRules={setRules} changed={changed} isAdmin={isAdmin} />

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
