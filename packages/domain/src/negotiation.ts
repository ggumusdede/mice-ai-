// §7 Adım 2 Pazarlık: sadece hacim, ilişki, esnek tarih, ödeme kolaylığı; rakip fiyatı yasak; en fazla 3 tur
import { notImplemented } from './_todo.js';
export const ALLOWED_NEGOTIATION_ARGUMENTS = ['volume', 'relationship', 'flexible_dates', 'payment_ease'] as const;
export function canNegotiate(currentRound: number, maxRounds: number): { allowed: boolean; reason?: string } { return notImplemented('canNegotiate'); }
/** Detects competitor-price leakage in a draft (supplier names other than the recipient, or competitor price mentions). */
export function negotiationDraftViolations(draft: string, otherSupplierNames: string[]): string[] { return notImplemented('negotiationDraftViolations'); }
