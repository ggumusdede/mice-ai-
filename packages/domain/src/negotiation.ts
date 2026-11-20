// §7 Adım 2 Pazarlık: sadece hacim, ilişki, esnek tarih, ödeme kolaylığı; rakip fiyatı yasak; en fazla 3 tur
export const ALLOWED_NEGOTIATION_ARGUMENTS = ['volume', 'relationship', 'flexible_dates', 'payment_ease'] as const;

/** currentRound = number of negotiation rounds already drafted for this offer (0 = none yet). */
export function canNegotiate(currentRound: number, maxRounds: number): { allowed: boolean; reason?: string } {
  if (currentRound < maxRounds) return { allowed: true };
  return { allowed: false, reason: `En fazla ${maxRounds} pazarlık turu taslağı hazırlanır; sonrası insan (telefon).` };
}

const COMPETITOR_PATTERNS: [RegExp, string][] = [
  [/\brakip/iu, 'Rakip ifadesi kullanılmış'],
  [/\b(başka|diğer)\s+(bir\s+)?(otel|oteller|tedarikçi|firma|tesis|acenta|teklif)/iu, 'Başka tedarikçi / teklif referansı'],
  [/\b(competitor|competing)/i, 'Competitor reference'],
  [/\b(another|other)\s+(hotel|supplier|vendor|venue|offer|quote|property)/i, 'Other supplier / offer reference'],
  [/\b(daha\s+ucuza?\s+(veriyor|veren|verdi|teklif)|daha\s+düşük\s+teklif\s+(aldık|var))/iu, 'Başka tekliften daha ucuz fiyat iması'],
  [/\b(cheaper|lower)\s+(offer|quote|price)\s+(from|elsewhere|at)/i, 'Cheaper offer elsewhere'],
  [/\b(aldığımız|elimizdeki)\s+(diğer\s+)?teklif/iu, 'Elimizdeki diğer teklif referansı'],
];

/** Detects competitor-price leakage in a draft (supplier names other than the recipient, or competitor price mentions). */
export function negotiationDraftViolations(draft: string, otherSupplierNames: string[]): string[] {
  const out: string[] = [];
  const lower = draft.toLocaleLowerCase('tr-TR');
  for (const name of otherSupplierNames) {
    const n = name.trim();
    if (n.length < 2) continue;
    if (lower.includes(n.toLocaleLowerCase('tr-TR'))) out.push(`Rakip tedarikçi adı geçiyor: ${n}`);
  }
  for (const [re, label] of COMPETITOR_PATTERNS) if (re.test(draft)) out.push(label);
  return out;
}
