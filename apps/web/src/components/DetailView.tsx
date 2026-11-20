import type { ReactNode } from 'react';
import { date, eur, humanizeKey, num, pct } from '../lib/format';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const FRACTION_KEY = /(margin|markup|rate|advantage|pct|percent|confidence|share)$/i;
const MONEY_KEY = /(eur|amount|price|cost|sale|total|profit)$/i;

/** Known labels for decision.detail keys; unknown keys are humanized. */
const LABELS: Record<string, string> = {
  costEur: 'Alış', saleEur: 'Satış', profitEur: 'Kâr', margin: 'Marj (Kâr ÷ Satış)', markup: 'Markup (Kâr ÷ Alış)',
  targetMarginMin: 'Hedef min. marj', amountEur: 'Tutar (EUR)', amountTry: 'Tutar (TL)', supplierName: 'Tedarikçi',
  customerName: 'Müşteri', optionUntil: 'Opsiyon', violations: 'Kural dışı maddeler', blockReasons: 'Bloklanma nedenleri',
  reasons: 'Gerekçeler', evidence: 'Dayanak veri', riskEur: 'Risk tutarı', conditionRiskEur: 'Koşul riski',
  prepaymentRate: 'Ön ödeme oranı', depositRate: 'Kapora oranı', dueDate: 'Vade', invoiceNo: 'Fatura no',
  actionType: 'İş türü', consecutiveClean: 'Düzeltmesiz seri', threshold: 'Eşik', question: 'Soru', eventType: 'Etkinlik tipi',
  to: 'Alıcı', subject: 'Konu', body: 'Mesaj', diff: 'Farklar', suppliers: 'Tedarikçiler', userName: 'Kişi', reason: 'Gerekçe',
  advantage: 'Avantaj', pax: 'Kişi', startDate: 'Başlangıç', endDate: 'Bitiş', options: 'Seçenekler', title: 'Başlık',
  confidence: 'Güven', field: 'Alan', label: 'Alan', contractValue: 'Sözleşme', quoteValue: 'Teklif', message: 'Açıklama',
  severity: 'Önem', status: 'Durum', currency: 'Para birimi', totalAmount: 'Toplam tutar', diffInfo: 'Farklar', supplierPrepaymentRate: 'Tedarikçi ön ödeme', customerDepositRate: 'Müşteri kaporası', note: 'Not', itemId: 'Kalem', lowFields: 'Emin olunmayan alanlar', fieldConfidence: 'Alan güvenleri', extractionConfidence: 'Okuma güveni', lowConfidence: 'Düşük güven', round: 'Tur', arguments: 'Argümanlar', quoteVersion: 'Teklif sürümü', overrideReason: 'Aralık dışı gerekçesi', fullName: 'Ad soyad', duplicates: 'Olası mükerrer', supplierNames: 'Tedarikçiler', deadlineHours: 'Yanıt süresi (saat)', projectExtrasTry: 'Projede ekstra toplamı (TL)', description: 'Açıklama', name: 'Ad', score: 'Skor',
};

/** Common enum values that show up inside decision details. */
const VALUE_LABELS: Record<string, string> = {
  accredited: 'Akredite', candidate: 'Aday', passive: 'Pasif', error: 'Hata', warning: 'Uyarı', info: 'Bilgi', critical: 'Kritik',
};

export function labelFor(key: string): string {
  return LABELS[key] ?? humanizeKey(key);
}

export function formatValue(key: string, v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="muted">—</span>;
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
  if (typeof v === 'number') {
    if (FRACTION_KEY.test(key) && Math.abs(v) <= 1.5) return pct(v);
    if (/try$/i.test(key)) return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(v);
    if (MONEY_KEY.test(key)) return eur(v);
    return num(v);
  }
  if (typeof v === 'string') {
    if (VALUE_LABELS[v]) return VALUE_LABELS[v];
    if (ISO_DATE.test(v)) return date(v, v.length > 10 ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : undefined);
    return <span className="pre-line">{v}</span>;
  }
  if (Array.isArray(v)) {
    if (!v.length) return <span className="muted">—</span>;
    if (v.every((x) => typeof x !== 'object' || x === null)) {
      return (
        <ul className="bullets">
          {v.map((x, i) => <li key={i}>{formatValue(key, x)}</li>)}
        </ul>
      );
    }
    const cols = Array.from(new Set(v.flatMap((x) => (x && typeof x === 'object' ? Object.keys(x) : []))))
      .filter((c) => !(/(^id|Id)$/.test(c) && v.every((x) => isUuidish((x as Record<string, unknown>)?.[c]))))
      .slice(0, 6);
    return (
      <div className="table-wrap">
        <table className="table table--compact">
          <thead><tr>{cols.map((c) => <th key={c} scope="col">{labelFor(c)}</th>)}</tr></thead>
          <tbody>
            {v.map((row, i) => (
              <tr key={i}>
                {cols.map((c) => <td key={c}>{formatValue(c, (row as Record<string, unknown>)?.[c])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (typeof v === 'object') return <DetailView data={v as Record<string, unknown>} nested />;
  return String(v);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuidish(v: unknown): boolean {
  if (typeof v === 'string') return UUID.test(v);
  if (Array.isArray(v)) return v.length > 0 && v.every((x) => typeof x === 'string' && UUID.test(x));
  return v === null;
}

/** Generic, readable rendering of Decision.detail (Record<string, unknown>). */
export function DetailView({ data, nested = false }: { data: Record<string, unknown>; nested?: boolean }) {
  // internal UUID references (userId, supplierIds, …) mean nothing to the decider
  const entries = Object.entries(data ?? {}).filter(([k, v]) => !(/(^id|Id|Ids)$/.test(k) && isUuidish(v)));
  if (!entries.length) return null;
  return (
    <dl className={`kv ${nested ? 'kv--nested' : ''}`}>
      {entries.map(([k, v]) => (
        <div key={k} className="kv__row">
          <dt>{labelFor(k)}</dt>
          <dd>{formatValue(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}
