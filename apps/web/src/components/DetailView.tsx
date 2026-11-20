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
  severity: 'Önem', projectExtrasTry: 'Projede ekstra toplamı (TL)', description: 'Açıklama', name: 'Ad', score: 'Skor',
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
    const cols = Array.from(new Set(v.flatMap((x) => (x && typeof x === 'object' ? Object.keys(x) : [])))).slice(0, 6);
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

/** Generic, readable rendering of Decision.detail (Record<string, unknown>). */
export function DetailView({ data, nested = false }: { data: Record<string, unknown>; nested?: boolean }) {
  const entries = Object.entries(data ?? {});
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
