// §7 Adım 6 Sözleşme tarihlerinden otomatik takvim
import type { ContractFields } from '@mice/shared';
export interface OpsTaskSpec { kind: 'final_pax' | 'attrition' | 'rooming_list' | 'menu_approval' | 'tech_brief' | 'transfer_list' | 'payment_due' | 'event_day_checklist'; title: string; dueDate: string; role: 'clerk_ops' | 'finance' | 'field' }

const DAY = 86_400_000;
function addDays(iso: string, days: number): string {
  const t = Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(t)) throw new Error(`operationsCalendar: invalid date "${iso}"`);
  return new Date(t + days * DAY).toISOString().slice(0, 10);
}

/** "14 gün önce" / "14 days before" / "T-14" → 14. */
function daysBefore(text: string | null): number | null {
  if (!text) return null;
  const m = /(\d{1,3})\s*(?:gün|gun|days?)\s*(?:önce|once|öncesi|before|prior)/i.exec(text) ?? /\bT\s*-\s*(\d{1,3})\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

const pctIn = (s: string): number | null => {
  const m = /%\s*(\d{1,3}(?:[.,]\d+)?)|(\d{1,3}(?:[.,]\d+)?)\s*%/.exec(s);
  if (!m) return null;
  return Number((m[1] ?? m[2]).replace(',', '.'));
};

/** Parses payment clauses: "%30 imzada", "%50 etkinlikten 30 gün önce", "kalan etkinlik bitiminden 15 gün sonra", "check-out'ta". */
export function parsePaymentSchedule(paymentTerms: string | null, eventStart: string, eventEnd: string, signedAt: string | null): { dueDate: string; percent: number | null; text: string }[] {
  if (!paymentTerms) return [];
  const out: { dueDate: string; percent: number | null; text: string }[] = [];
  const clauses = paymentTerms.split(/[;\n]|,(?!\d)|\s+ve\s+|\s+and\s+/i).map((c) => c.trim()).filter(Boolean);
  for (const c of clauses) {
    const pct = pctIn(c);
    let due: string | null = null;
    const before = /(\d{1,3})\s*(?:gün|gun|days?)\s*(?:önce|once|before|prior)/i.exec(c);
    const after = /(\d{1,3})\s*(?:gün|gun|days?)\s*(?:sonra|after)/i.exec(c);
    if (before) due = addDays(eventStart, -Number(before[1]));
    else if (after) {
      const fromSigning = /(imza|sign|onay|confirm)/i.test(c) && signedAt;
      due = addDays(fromSigning ? (signedAt as string) : eventEnd, Number(after[1]));
    } else if (/(imza|sign|konfirm|confirm|rezervasyon|booking)/i.test(c) && signedAt) due = addDays(signedAt, 7);
    else if (/(giriş|giris|check-?in|arrival|varış)/i.test(c)) due = eventStart.slice(0, 10);
    else if (/(çıkış|cikis|check-?out|departure|bitiş|bitis)/i.test(c)) due = eventEnd.slice(0, 10);
    if (due) out.push({ dueDate: due, percent: pct, text: c });
  }
  return out;
}

/** Derives the operations calendar from contract dates/terms + event start. Defaults when unspecified:
 *  final pax/attrition T-14, rooming list T-10, menu approval T-7, tech brief T-5, transfer list T-3, checklist T-1;
 *  payment due dates parsed from paymentTerms/prepaymentRate when possible (prepayment due at signing+7d).
 *  Attrition / final pax deadline is taken from attritionTerms ("N gün önce") when present.
 *  Prepayment without a signing date falls back to T-30. Result sorted by due date. */
export function operationsCalendar(contract: ContractFields, eventStart: string, signedAt: string | null): OpsTaskSpec[] {
  const start = (contract.startDate ?? eventStart).slice(0, 10);
  const end = (contract.endDate ?? start).slice(0, 10);
  const signed = signedAt ? signedAt.slice(0, 10) : null;
  const tMinus = (n: number) => addDays(start, -n);
  const attrDays = daysBefore(contract.attritionTerms) ?? 14;

  const tasks: OpsTaskSpec[] = [
    { kind: 'final_pax', title: 'Final kişi sayısını tedarikçiye bildir', dueDate: tMinus(attrDays), role: 'clerk_ops' },
    { kind: 'attrition', title: 'Attrition (düşüş) son tarihi — oda/kişi düşüşlerini kontrol et', dueDate: tMinus(attrDays), role: 'clerk_ops' },
    { kind: 'rooming_list', title: 'Rooming list gönder', dueDate: tMinus(10), role: 'clerk_ops' },
    { kind: 'menu_approval', title: 'Menü onayını al', dueDate: tMinus(7), role: 'clerk_ops' },
    { kind: 'tech_brief', title: 'Teknik brief gönder', dueDate: tMinus(5), role: 'clerk_ops' },
    { kind: 'transfer_list', title: 'Transfer listesini gönder', dueDate: tMinus(3), role: 'clerk_ops' },
    { kind: 'event_day_checklist', title: 'Etkinlik günü kontrol listesi', dueDate: tMinus(1), role: 'field' },
  ];

  const payments = parsePaymentSchedule(contract.paymentTerms, start, end, signed);
  if (contract.prepaymentRate != null && contract.prepaymentRate > 0) {
    const pct = Math.round(contract.prepaymentRate * 100);
    const alreadyParsed = payments.some((p) => p.percent === pct);
    if (!alreadyParsed) {
      tasks.push({ kind: 'payment_due', title: `Ön ödeme %${pct}`, dueDate: signed ? addDays(signed, 7) : tMinus(30), role: 'finance' });
    }
  }
  for (const p of payments) {
    tasks.push({ kind: 'payment_due', title: p.percent != null ? `Ödeme %${p.percent} — ${p.text}` : `Ödeme — ${p.text}`, dueDate: p.dueDate, role: 'finance' });
  }
  return tasks.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}
