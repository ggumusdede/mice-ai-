// §7 Adım 8 Kapanış kontrolü
import type { ClosingCheck, ProfitSummary } from '@mice/shared';
export interface ClosingInput {
  supplierInvoicesExpected: number; supplierInvoicesReceived: number;
  customerInvoiceIssued: boolean; receivablesOpenEur: number; unbilledPayments: number; commissionsUnreconciled: number;
  lostReasonMissing: boolean;
  planned: ProfitSummary | null; actual: ProfitSummary | null;
  deviations: { reason: string; amountEur: number }[];
}
export function closingCheck(input: ClosingInput): ClosingCheck {
  const missingInv = Math.max(0, input.supplierInvoicesExpected - input.supplierInvoicesReceived);
  const items: ClosingCheck['items'] = [
    { key: 'supplier_invoices', label: 'Tüm tedarikçi faturaları geldi', ok: missingInv === 0, detail: `${input.supplierInvoicesReceived}/${input.supplierInvoicesExpected}` + (missingInv ? ` — ${missingInv} eksik` : '') },
    { key: 'customer_invoice', label: 'Müşteri faturası kesildi', ok: input.customerInvoiceIssued },
    { key: 'collections', label: 'Tahsilat tamam', ok: input.receivablesOpenEur <= 0.01, detail: input.receivablesOpenEur > 0.01 ? `Açık alacak ${Math.round(input.receivablesOpenEur * 100) / 100} EUR` : undefined },
    { key: 'unbilled_payments', label: 'Fatura edilmemiş ödeme yok', ok: input.unbilledPayments === 0, detail: input.unbilledPayments ? `${input.unbilledPayments} ödeme` : undefined },
    { key: 'commissions', label: 'Komisyonlar mutabık', ok: input.commissionsUnreconciled === 0, detail: input.commissionsUnreconciled ? `${input.commissionsUnreconciled} komisyon` : undefined },
    { key: 'lost_reason', label: 'Kayıp nedeni girildi', ok: !input.lostReasonMissing },
  ];
  for (const i of items) if (i.detail === undefined) delete i.detail;
  return {
    ok: items.every((i) => i.ok),
    items,
    planVsActual: { planned: input.planned, actual: input.actual, deviations: input.deviations },
  };
}

/** Supplier score 0..100 from response hours, contract error count, field issues, invoice mismatches (§7 Adım 8).
 *  Starts at 100; penalties: response time over 4h (linear, max −25 at ≥72h), contract errors (−15 per project-average, max −30),
 *  field issues (−15 per project-average, max −25), invoice mismatches (−10 per project-average, max −20). Unknown response time → no penalty. */
export function supplierScore(m: { avgResponseHours: number | null; contractErrors: number; fieldIssues: number; invoiceMismatches: number; projects: number }): number {
  const projects = Math.max(1, m.projects || 0);
  let score = 100;
  if (m.avgResponseHours != null && m.avgResponseHours > 4) score -= Math.min(25, ((m.avgResponseHours - 4) / 68) * 25);
  score -= Math.min(30, (Math.max(0, m.contractErrors) / projects) * 15);
  score -= Math.min(25, (Math.max(0, m.fieldIssues) / projects) * 15);
  score -= Math.min(20, (Math.max(0, m.invoiceMismatches) / projects) * 10);
  return Math.max(0, Math.min(100, Math.round(score)));
}
