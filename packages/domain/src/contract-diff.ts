// §7 Adım 5 — Sözleşme–teklif karşılaştırması alan alan
import type { ContractDiffItem, ContractFields } from '@mice/shared';
import { round2 } from './pricing.js';

/** The accepted quote, projected into the same shape as a contract for comparison. */
export interface QuoteSnapshotForContract extends ContractFields {
  /** descriptions of value-add (yalnız satış) lines — not errors if missing from supplier contract (§17.4) */
  valueAddDescriptions: string[];
}

const TOL = 0.01;

/** Normalizes free text for comparison: Turkish-aware lowercase, collapsed whitespace, trailing punctuation removed. */
export function normText(s: string | null | undefined): string {
  if (s == null) return '';
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/[\s ]+/g, ' ')
    .replace(/[.,;:!]+$/g, '')
    .trim();
}
const isEmpty = (v: unknown): boolean => v == null || (typeof v === 'string' && v.trim() === '');
const normScalar = (v: string | number | boolean): string => {
  if (typeof v !== 'string') return String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : normText(v);
};
const numEq = (a: number, b: number) => Math.abs(a - b) <= TOL + 1e-9;

/** Compares field by field: dates, pax, guarantee, rooms (type/count/nights/price), menu, hall, unit prices,
 *  VAT & accommodation-tax separation, payment, prepayment, cancellation, attrition, empty fields (customer/billing),
 *  and internal date inconsistencies (end < start, option after start). Numeric tolerance 0.01. */
export function diffContractVsQuote(contract: ContractFields, quote: QuoteSnapshotForContract): ContractDiffItem[] {
  const out: ContractDiffItem[] = [];
  const push = (i: ContractDiffItem) => out.push(i);

  // ---- empty mandatory fields on the contract (customer / billing / supplier) ----
  const mandatory: [keyof ContractFields, string][] = [
    ['supplierName', 'Tedarikçi'],
    ['customerName', 'Müşteri'],
    ['billingInfo', 'Fatura bilgisi'],
  ];
  for (const [f, label] of mandatory) {
    const cv = contract[f];
    const qv = quote[f];
    if (isEmpty(cv)) {
      push({ field: f, label, contractValue: cv ?? null, quoteValue: qv ?? null, severity: 'error', kind: 'empty_field', message: `${label} alanı sözleşmede boş.` });
    } else if (!isEmpty(qv) && normText(cv as string) !== normText(qv as string)) {
      push({ field: f, label, contractValue: cv, quoteValue: qv, severity: 'warning', kind: 'mismatch', message: `${label} farklı: sözleşme "${cv}", teklif "${qv}".` });
    }
  }

  // ---- exact-value fields (dates, pax, currency, separation flags) ----
  const exact: [keyof ContractFields, string, 'error' | 'warning'][] = [
    ['startDate', 'Başlangıç tarihi', 'error'],
    ['endDate', 'Bitiş tarihi', 'error'],
    ['pax', 'Kişi sayısı', 'error'],
    ['guaranteePax', 'Garanti kişi sayısı', 'error'],
    ['currency', 'Para birimi', 'error'],
    ['vatSeparated', 'KDV ayrımı', 'error'],
    ['accommodationTaxSeparated', 'Konaklama vergisi ayrımı', 'error'],
    ['prepaymentRate', 'Ön ödeme oranı', 'error'],
    ['optionDate', 'Opsiyon tarihi', 'warning'],
  ];
  for (const [f, label, sev] of exact) {
    const cv = contract[f] as string | number | boolean | null;
    const qv = quote[f] as string | number | boolean | null;
    if (cv == null && qv == null) continue;
    if (cv == null) {
      push({ field: f, label, contractValue: null, quoteValue: qv, severity: sev, kind: 'missing_in_contract', message: `${label} sözleşmede yok (teklif: ${qv}).` });
    } else if (qv == null) {
      push({ field: f, label, contractValue: cv, quoteValue: null, severity: 'warning', kind: 'missing_in_quote', message: `${label} teklifte yok (sözleşme: ${cv}).` });
    } else if (typeof cv === 'number' && typeof qv === 'number' ? !numEq(cv, qv) : normScalar(cv) !== normScalar(qv)) {
      push({ field: f, label, contractValue: cv, quoteValue: qv, severity: sev, kind: 'mismatch', message: `${label} farklı: sözleşme ${cv}, teklif ${qv}.` });
    }
  }

  // ---- total amount ----
  if (contract.totalAmount != null && quote.totalAmount != null && !numEq(contract.totalAmount, quote.totalAmount)) {
    push({ field: 'totalAmount', label: 'Toplam tutar', contractValue: contract.totalAmount, quoteValue: quote.totalAmount, severity: 'error', kind: 'mismatch', message: `Toplam tutar farklı: sözleşme ${contract.totalAmount}, teklif ${quote.totalAmount} (fark ${round2(contract.totalAmount - quote.totalAmount)}).` });
  } else if (contract.totalAmount == null && quote.totalAmount != null) {
    push({ field: 'totalAmount', label: 'Toplam tutar', contractValue: null, quoteValue: quote.totalAmount, severity: 'warning', kind: 'missing_in_contract', message: 'Toplam tutar sözleşmede yok.' });
  }

  // ---- free-text terms ----
  const texts: [keyof ContractFields, string][] = [
    ['menu', 'Menü'],
    ['hall', 'Salon'],
    ['paymentTerms', 'Ödeme koşulu'],
    ['cancellationTerms', 'İptal koşulu'],
    ['attritionTerms', 'Attrition koşulu'],
  ];
  for (const [f, label] of texts) {
    const cv = contract[f] as string | null;
    const qv = quote[f] as string | null;
    if (isEmpty(cv) && isEmpty(qv)) continue;
    if (isEmpty(cv)) {
      push({ field: f, label, contractValue: cv ?? null, quoteValue: qv, severity: 'error', kind: 'missing_in_contract', message: `${label} sözleşmede yok (teklif: "${qv}").` });
    } else if (isEmpty(qv)) {
      push({ field: f, label, contractValue: cv, quoteValue: qv ?? null, severity: 'warning', kind: 'missing_in_quote', message: `${label} sözleşmede var, teklifte yok: "${cv}".` });
    } else if (normText(cv) !== normText(qv)) {
      push({ field: f, label, contractValue: cv, quoteValue: qv, severity: 'warning', kind: 'mismatch', message: `${label} farklı: sözleşme "${cv}", teklif "${qv}".` });
    }
  }

  // ---- rooms (type / count / nights / unit price) ----
  const cRooms = new Map(contract.rooms.map((r) => [normText(r.type), r]));
  const qRoomKeys = new Set<string>();
  for (const qr of quote.rooms) {
    const key = normText(qr.type);
    qRoomKeys.add(key);
    const cr = cRooms.get(key);
    const base = `rooms.${qr.type}`;
    if (!cr) {
      push({ field: base, label: `Oda: ${qr.type}`, contractValue: null, quoteValue: qr, severity: 'error', kind: 'missing_in_contract', message: `${qr.type} odası sözleşmede yok.` });
      continue;
    }
    const cmp: ['count' | 'nights' | 'unitPrice', string][] = [
      ['count', 'oda sayısı'],
      ['nights', 'gece'],
      ['unitPrice', 'birim fiyat'],
    ];
    for (const [k, lbl] of cmp) {
      if (!numEq(cr[k], qr[k])) {
        push({ field: `${base}.${k}`, label: `Oda: ${qr.type} ${lbl}`, contractValue: cr[k], quoteValue: qr[k], severity: 'error', kind: 'mismatch', message: `${qr.type} ${lbl} farklı: sözleşme ${cr[k]}, teklif ${qr[k]}.` });
      }
    }
  }
  for (const cr of contract.rooms) {
    if (!qRoomKeys.has(normText(cr.type))) {
      push({ field: `rooms.${cr.type}`, label: `Oda: ${cr.type}`, contractValue: cr, quoteValue: null, severity: 'warning', kind: 'missing_in_quote', message: `${cr.type} odası sözleşmede var, teklifte yok.` });
    }
  }

  // ---- unit prices (value-add lines flagged, never errors §17.4) ----
  const valueAdd = new Set(quote.valueAddDescriptions.map(normText));
  const flaggedValueAdd = new Set<string>();
  const flagValueAdd = (desc: string, cv: unknown, qv: unknown) => {
    const k = normText(desc);
    if (flaggedValueAdd.has(k)) return;
    flaggedValueAdd.add(k);
    push({ field: `unitPrices.${desc}`, label: `Katma değer kalemi: ${desc}`, contractValue: cv, quoteValue: qv, severity: 'info', kind: 'value_add', message: `"${desc}" yalnız satış (katma değer) kalemi — sözleşmede olmaması hata değildir.` });
  };
  const cLines = new Map(contract.unitPrices.map((l) => [normText(l.description), l]));
  const qLineKeys = new Set<string>();
  for (const ql of quote.unitPrices) {
    const key = normText(ql.description);
    qLineKeys.add(key);
    const cl = cLines.get(key);
    if (valueAdd.has(key)) {
      flagValueAdd(ql.description, cl ?? null, ql);
      continue;
    }
    const base = `unitPrices.${ql.description}`;
    if (!cl) {
      push({ field: base, label: ql.description, contractValue: null, quoteValue: ql, severity: 'error', kind: 'missing_in_contract', message: `"${ql.description}" kalemi sözleşmede yok.` });
      continue;
    }
    if (!numEq(cl.unitPrice, ql.unitPrice)) {
      push({ field: `${base}.unitPrice`, label: `${ql.description} birim fiyat`, contractValue: cl.unitPrice, quoteValue: ql.unitPrice, severity: 'error', kind: 'mismatch', message: `"${ql.description}" birim fiyat farklı: sözleşme ${cl.unitPrice}, teklif ${ql.unitPrice}.` });
    }
    if (!numEq(cl.quantity, ql.quantity)) {
      push({ field: `${base}.quantity`, label: `${ql.description} miktar`, contractValue: cl.quantity, quoteValue: ql.quantity, severity: 'error', kind: 'mismatch', message: `"${ql.description}" miktar farklı: sözleşme ${cl.quantity}, teklif ${ql.quantity}.` });
    }
  }
  for (const cl of contract.unitPrices) {
    const key = normText(cl.description);
    if (qLineKeys.has(key)) continue;
    if (valueAdd.has(key)) {
      flagValueAdd(cl.description, cl, null);
      continue;
    }
    push({ field: `unitPrices.${cl.description}`, label: cl.description, contractValue: cl, quoteValue: null, severity: 'warning', kind: 'missing_in_quote', message: `"${cl.description}" kalemi sözleşmede var, teklifte yok.` });
  }
  for (const d of quote.valueAddDescriptions) flagValueAdd(d, null, null);

  // ---- internal date inconsistencies of the contract ----
  const s = contract.startDate?.slice(0, 10);
  const e = contract.endDate?.slice(0, 10);
  const o = contract.optionDate?.slice(0, 10);
  if (s && e && e < s) {
    push({ field: 'endDate', label: 'Tarih tutarsızlığı', contractValue: { startDate: s, endDate: e }, quoteValue: null, severity: 'error', kind: 'date_inconsistency', message: `Sözleşmede bitiş tarihi (${e}) başlangıçtan (${s}) önce.` });
  }
  if (o && s && o > s) {
    push({ field: 'optionDate', label: 'Tarih tutarsızlığı', contractValue: { optionDate: o, startDate: s }, quoteValue: null, severity: 'error', kind: 'date_inconsistency', message: `Sözleşmede opsiyon tarihi (${o}) etkinlik başlangıcından (${s}) sonra.` });
  }

  return out;
}

/** Clean = nothing to fix: only informational flags (e.g. value-add items) remain. Warnings and errors both keep the
 *  contract from signature (§7 Adım 5: "sözleşme temiz olana kadar imzaya geçilmez"). */
export function isContractClean(diff: ContractDiffItem[]): boolean {
  return diff.every((d) => d.severity === 'info');
}

/** §7 Adım 5 karşılıklı koşul riski: supplier requires prepayment but customer gives no deposit → risk = supplierTotal*prepay − customerTotal*deposit (>=0). */
export function conditionRisk(args: { supplierTotalEur: number; supplierPrepaymentRate: number; customerTotalEur: number; customerDepositRate: number }): { riskEur: number; note: string | null } {
  const prepay = Math.max(0, args.supplierTotalEur) * Math.max(0, args.supplierPrepaymentRate || 0);
  const deposit = Math.max(0, args.customerTotalEur) * Math.max(0, args.customerDepositRate || 0);
  const risk = round2(Math.max(0, prepay - deposit));
  if (risk <= 0) return { riskEur: 0, note: null };
  const p = Math.round((args.supplierPrepaymentRate || 0) * 100);
  const d = Math.round((args.customerDepositRate || 0) * 100);
  const note =
    d === 0
      ? `Tedarikçi %${p} ön ödeme istiyor (${round2(prepay)} EUR), müşteriden kapora yok — risk ${risk} EUR.`
      : `Tedarikçi %${p} ön ödeme istiyor (${round2(prepay)} EUR), müşteri kaporası %${d} (${round2(deposit)} EUR) — açık risk ${risk} EUR.`;
  return { riskEur: risk, note };
}
