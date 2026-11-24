// v0.5 "Ürün kararları" (docs/12): the owner's decisions as agency rules, grouped and collapsed — one short line per setting,
// sensible defaults, advanced items hidden until opened. Saved with the Rules page's own save bar (admin only).
import type { ReactNode } from 'react';
import type { TenantRules } from '@mice/shared';
import { Card } from './ui';

type Bool = { [K in keyof TenantRules]: TenantRules[K] extends boolean ? K : never }[keyof TenantRules];
type Num = { [K in keyof TenantRules]: TenantRules[K] extends number ? K : never }[keyof TenantRules];

interface Props { rules: TenantRules; setRules: (r: TenantRules) => void; changed: (keyof TenantRules)[]; isAdmin: boolean }

/** The 17 cautious defaults of docs/11 §H (S-26), plain Turkish. `later` = the feature itself arrives in v0.6 (default kept). */
export const PANEL_DEFAULTS: { key: keyof TenantRules; label: string; later?: boolean }[] = [
  { key: 'negotiationUseHotelOwnPublicPrice', label: '1. Otelin kendi kamuya açık fiyatı pazarlıkta kullanılabilir (rakip fiyatı her zaman yasak)' },
  { key: 'rfqShowBudget', label: '2. RFQ’da müşteri bütçesi tedarikçiye gösterilir' },
  { key: 'supplierQualitativeSummary', label: '3. Tedarikçiye puansız, nitel performans özeti taslağı hazırlanır (skor paylaşılmaz)' },
  { key: 'supplierPagePoweredBy', label: '4. Tedarikçi sayfasında "powered by" imzası (belgelerde platform logosu hiç olmaz)' },
  { key: 'crisisSpendCapTry', label: '5. Kriz harcama tavanı (TL) — kriz vekili kendi Face ID’siyle onaylar' },
  { key: 'roomingChangeMode', label: '6. Rooming farkı otele: fark + güncel tam liste' },
  { key: 'postEventReportBusinessDays', label: '7. Etkinlik sonrası rapor süresi (iş günü)' },
  { key: 'participantMessagingDefault', label: '8. Katılımcıya doğrudan mesaj (proje bazında müşteri açtırır)' },
  { key: 'participantPreferencesRequireConsent', label: '9. Katılımcı tercihleri projeler arası yalnız açık rızayla saklanır' },
  { key: 'departedMailboxRetentionDays', label: '10. Ayrılanın kurumsal kutusu devralanın projelerine bağlı kalır (gün, yönetici onayıyla)' },
  { key: 'officeSupportRoleEnabled', label: '11. Ofis destek rolü', later: true },
  { key: 'fieldAdvanceSelfViewOnly', label: '12. Saha yalnız kendi avans bakiyesini ve fişlerini görür', later: true },
  { key: 'cashWeightedProfitSeparate', label: '13. Finansman maliyeti ayrı "nakit ağırlıklı kâr" göstergesi', later: true },
  { key: 'billingModelRequiresApproval', label: '14. Faturalama modelini sistem önerir, finans / yönetici onaylar' },
  { key: 'visaInsuranceTrackingOnly', label: '15. Vize / sigorta yalnız takip (poliçe satışı yok)', later: true },
  { key: 'leakScanGuaranteeDesignPartnersOnly', label: '16. "Kaçak taraması" garantisi yalnız tasarım ortaklarıyla' },
  { key: 'departedAgencyReadOnlyDays', label: '17. Ayrılan acentaya salt okuma + dışa aktarım penceresi (gün)' },
];

export function ProductDecisionRules({ rules, setRules, changed, isAdmin }: Props) {
  const set = <K extends keyof TenantRules>(k: K, v: TenantRules[K]) => setRules({ ...rules, [k]: v });
  const cls = (k: keyof TenantRules) => (changed.includes(k) ? 'field--changed' : '');
  const toggle = (k: Bool, label: ReactNode, hint?: string) => (
    <label key={k} className={`row ${cls(k)}`}>
      <input type="checkbox" disabled={!isAdmin} checked={rules[k] === true} onChange={(e) => set(k, e.target.checked as never)} />
      <span>{label}{hint ? <><br /><span className="muted small">{hint}</span></> : null}</span>
    </label>
  );
  const number = (k: Num, label: string, hint?: string) => (
    <label key={k} className={`field ${cls(k)}`}>
      <span className="field__label">{label}</span>
      <input className="input" type="number" min={0} step="any" disabled={!isAdmin} value={rules[k] as number} onChange={(e) => set(k, Number(e.target.value) as never)} />
      {hint ? <span className="muted small">{hint}</span> : null}
    </label>
  );
  const select = <K extends 'participantMessagingDefault' | 'roomingChangeMode'>(k: K, label: string, opts: [TenantRules[K], string][]) => (
    <label key={k} className={`field ${cls(k)}`}>
      <span className="field__label">{label}</span>
      <select className="input select" disabled={!isAdmin} value={rules[k] as string} onChange={(e) => set(k, e.target.value as TenantRules[K])}>
        {opts.map(([v, l]) => <option key={v as string} value={v as string}>{l}</option>)}
      </select>
    </label>
  );
  const bonus = rules.bonusFormula;
  const qh = rules.quietHours;

  return (
    <Card title="Ürün kararları (v0.5)">
      <p className="muted small">Ürün sahibinin kararları; temkinli varsayılanlarla gelir. Değiştirmek için ilgili başlığı açın.</p>

      <details className="more">
        <summary>Mesaj onayı ve nöbet</summary>
        <div className="stack-sm">
          {number('quickApprovalEscalationMinutes', 'Kart kaç dakika bekleyince sıradaki kişiye geçsin? (0 = kapalı)', 'Nöbetçi → vekili → yönetici. Otomatik onay yok.')}
          {toggle('onCallAssignOutsideBusinessHours', 'Mesai dışında mesaj kartları nöbetçiye gitsin')}
          {number('collectionReminderAfterDays', 'Vadesi kaç gün geçen fatura için ödeme hatırlatması hazırlansın? (0 = kapalı)')}
          {select('participantMessagingDefault', 'Katılımcıya doğrudan mesaj (varsayılan)', [['off', 'Kapalı'], ['logistics', 'Yalnız lojistik'], ['on', 'Açık']])}
        </div>
      </details>

      <details className="more">
        <summary>Bildirimler</summary>
        <div className="stack-sm">
          <label className={`row ${cls('quietHours')}`}>
            <input type="checkbox" disabled={!isAdmin} checked={qh.enabled} onChange={(e) => set('quietHours', { ...qh, enabled: e.target.checked })} />
            <span>Sessiz saat (varsayılan kapalı: bildirimler her zaman gelir)<br /><span className="muted small">Açıkken rutin özetler pencere bitince gelir; kritikler ve nöbetçi her zaman.</span></span>
          </label>
          {qh.enabled ? (
            <span className="row">
              <input aria-label="Sessiz saat başlangıcı" className="input" type="time" disabled={!isAdmin} value={qh.start} onChange={(e) => set('quietHours', { ...qh, start: e.target.value })} />
              <input aria-label="Sessiz saat bitişi" className="input" type="time" disabled={!isAdmin} value={qh.end} onChange={(e) => set('quietHours', { ...qh, end: e.target.value })} />
            </span>
          ) : null}
          {toggle('busyDelegationEnabled', 'Son tarihli kart yanıtsız kalırsa vekile yönlensin', 'Önce onaylayana kritik bildirim gider; karar yine insanda.')}
          {rules.busyDelegationEnabled ? (
            <div className="row-wrap">
              {number('busyDelegationWaitHours', 'Bekleme (saat)')}
              {number('busyDelegationLeadHours', 'Son tarihe kalan (saat)')}
            </div>
          ) : null}
        </div>
      </details>

      <details className="more">
        <summary>Ekip ve performans</summary>
        <div className="stack-sm">
          <p className="muted small">İsimli sıralamayı yalnız yönetici görür; çalışan yalnız kendi rakamlarını görür.</p>
          {toggle('showEstimatedBonus', 'Satışçı "Benim panom"da tahmini primini görsün', 'Bilgi amaçlıdır; kesin prim finans onayıyla.')}
          {rules.showEstimatedBonus ? (
            <div className="row-wrap">
              <label className={`field ${cls('bonusFormula')}`}>
                <span className="field__label">Prim oranı (%)</span>
                <input className="input" type="number" min={0} step="0.5" disabled={!isAdmin} value={+(bonus.rate * 100).toFixed(2)} onChange={(e) => set('bonusFormula', { ...bonus, rate: Number(e.target.value) / 100 })} />
              </label>
              <label className={`field ${cls('bonusFormula')}`}>
                <span className="field__label">Neyin üzerinden?</span>
                <select className="input select" disabled={!isAdmin} value={bonus.onlyCollected ? 'collected' : bonus.basis} onChange={(e) => set('bonusFormula', e.target.value === 'collected' ? { basis: 'realized_profit', rate: bonus.rate, onlyCollected: true } : { basis: e.target.value as 'realized_profit' | 'planned_profit', rate: bonus.rate, onlyCollected: false })}>
                  <option value="collected">Tahsil edilmiş projelerin kârı</option>
                  <option value="realized_profit">Gerçekleşen kâr</option>
                  <option value="planned_profit">Planlanan kâr</option>
                </select>
              </label>
            </div>
          ) : null}
          {toggle('requireBackupContact', 'Her müşteride yedek irtibat iste')}
        </div>
      </details>

      <details className="more">
        <summary>Hesaplar, saha ve ses</summary>
        <div className="stack-sm">
          <label className={`field ${cls('corporateMailDomains')}`}>
            <span className="field__label">Kurumsal e-posta alan adları (virgülle)</span>
            <input className="input" disabled={!isAdmin} placeholder="boş = giriş adresinin alan adı" value={rules.corporateMailDomains.join(', ')}
              onChange={(e) => set('corporateMailDomains', e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))} />
            <span className="muted small">Kişisel hesap (gmail vb.) yalnız kişi bazında yönetici istisnasıyla. Kişisel WhatsApp okunmaz; "Projeye ilet" kullanılır.</span>
          </label>
          {toggle('fieldPackEnabled', 'Saha ekibi günün paketini çevrimdışı için indirebilsin', 'Ad, oda, transfer grubu ve telefon; cihazda şifreli; uzaktan iptal edilir.')}
          {rules.fieldPackEnabled ? (
            <>
              {toggle('fieldPackIncludePhone', 'Pakette telefon da olsun (kriz yoklaması için)')}
              {number('fieldPackValidHours', 'Paket kaç saat geçerli? (gün başından)')}
            </>
          ) : null}
          {toggle('voiceFeaturesEnabled', 'Sesle yazma / sesli not açık', 'Tarayıcı sesi üçüncü taraf hizmete gönderebilir; açmadan önce ekibe bildirin.')}
        </div>
      </details>

      <details className="more">
        <summary>Panelin temkinli varsayılanları (17 madde)</summary>
        <div className="stack-sm">
          {PANEL_DEFAULTS.map(({ key, label, later }) => {
            const v = rules[key];
            const hint = later ? 'v0.6 ile gelecek işin varsayılanı' : undefined;
            if (key === 'participantMessagingDefault') return <p key={key} className="muted small">{label}: yukarıda "Mesaj onayı ve nöbet" altında.</p>;
            if (key === 'roomingChangeMode') return select('roomingChangeMode', label, [['diff_and_full', 'Fark + güncel tam liste'], ['diff_only', 'Yalnız fark'], ['full_only', 'Yalnız tam liste']]);
            if (typeof v === 'boolean') return toggle(key as Bool, label, hint);
            if (typeof v === 'number') return number(key as Num, label, hint);
            return null;
          })}
        </div>
      </details>
    </Card>
  );
}
