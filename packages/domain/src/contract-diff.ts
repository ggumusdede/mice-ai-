// §7 Adım 5 — Sözleşme–teklif karşılaştırması alan alan
import type { ContractDiffItem, ContractFields } from '@mice/shared';
import { notImplemented } from './_todo.js';

/** The accepted quote, projected into the same shape as a contract for comparison. */
export interface QuoteSnapshotForContract extends ContractFields {
  /** descriptions of value-add (yalnız satış) lines — not errors if missing from supplier contract (§17.4) */
  valueAddDescriptions: string[];
}
/** Compares field by field: dates, pax, guarantee, rooms (type/count/nights/price), menu, hall, unit prices,
 *  VAT & accommodation-tax separation, payment, prepayment, cancellation, attrition, empty fields (customer/billing),
 *  and internal date inconsistencies (end < start, option after start). Numeric tolerance 0.01. */
export function diffContractVsQuote(contract: ContractFields, quote: QuoteSnapshotForContract): ContractDiffItem[] { return notImplemented('diffContractVsQuote'); }
export function isContractClean(diff: ContractDiffItem[]): boolean { return notImplemented('isContractClean'); }

/** §7 Adım 5 karşılıklı koşul riski: supplier requires prepayment but customer gives no deposit → risk = supplierTotal*prepay − customerTotal*deposit (>=0). */
export function conditionRisk(args: { supplierTotalEur: number; supplierPrepaymentRate: number; customerTotalEur: number; customerDepositRate: number }): { riskEur: number; note: string | null } { return notImplemented('conditionRisk'); }
