// §7 Adım 7 Banka hareketi ↔ fatura ↔ proje eşleştirmesi
import { notImplemented } from './_todo.js';
export interface MatchCandidate { entryId: string; confidence: number; reasons: string[] }
/** Scores open finance entries for a bank transaction by amount (exact/near), currency, reference/invoice no/name tokens in description, date proximity to due date.
 *  Sorted desc. Confidence >= threshold → auto-match allowed (autonomous); below → 'low_confidence_payment_match' suggestion. */
export function matchBankTransaction(tx: { amount: number; currency: string; description: string; counterparty: string | null; bookedAt: string }, entries: { id: string; amount: number; currency: string; reference: string | null; invoiceNo: string | null; counterpartyName: string | null; dueDate: string | null; direction: 'in' | 'out' }[]): MatchCandidate[] { return notImplemented('matchBankTransaction'); }
/** Parses a bank statement CSV (Turkish bank export variants: ; or , separators, dd.mm.yyyy dates, 1.234,56 amounts). */
export function parseBankCsv(csv: string): { bookedAt: string; amount: number; currency: string; description: string; counterparty: string | null }[] { return notImplemented('parseBankCsv'); }
export function parseTrNumber(s: string): number { return notImplemented('parseTrNumber'); }
