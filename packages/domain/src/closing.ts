// §7 Adım 8 Kapanış kontrolü
import type { ClosingCheck, ProfitSummary } from '@mice/shared';
import { notImplemented } from './_todo.js';
export interface ClosingInput {
  supplierInvoicesExpected: number; supplierInvoicesReceived: number;
  customerInvoiceIssued: boolean; receivablesOpenEur: number; unbilledPayments: number; commissionsUnreconciled: number;
  lostReasonMissing: boolean;
  planned: ProfitSummary | null; actual: ProfitSummary | null;
  deviations: { reason: string; amountEur: number }[];
}
export function closingCheck(input: ClosingInput): ClosingCheck { return notImplemented('closingCheck'); }
/** Supplier score 0..100 from response hours, contract error count, field issues, invoice mismatches (§7 Adım 8). */
export function supplierScore(m: { avgResponseHours: number | null; contractErrors: number; fieldIssues: number; invoiceMismatches: number; projects: number }): number { return notImplemented('supplierScore'); }
