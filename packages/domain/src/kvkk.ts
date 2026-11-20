// §17.9 Rıza bazlı saklama
import { notImplemented } from './_todo.js';
export function retentionUntil(eventEnd: string, retentionDays: number): string { return notImplemented('retentionUntil'); }
/** Should this guest be anonymized now? consent → keep (unless withdrawn → anonymize after retention or immediately if past). */
export function shouldAnonymize(g: { consentReuse: boolean; consentWithdrawnAt: string | null; anonymizedAt: string | null; retentionUntil: string | null }, now: Date): boolean { return notImplemented('shouldAnonymize'); }
/** Pseudonymization for LLM calls (§18.2): replaces names/emails/phones with stable tokens; returns mapping to restore. */
export function pseudonymize(text: string, knownNames: string[]): { text: string; mapping: Record<string, string> } { return notImplemented('pseudonymize'); }
export function restorePseudonyms(text: string, mapping: Record<string, string>): string { return notImplemented('restorePseudonyms'); }
