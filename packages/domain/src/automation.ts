// §16 Kendini geliştiren yapı: otomasyon terfisi, örneklem denetimi, otomatik geri dönüş
import type { AutomationCounter } from '@mice/shared';
import { notImplemented } from './_todo.js';
export type AutomationOutcome = 'approved_clean' | 'edited' | 'rejected' | 'sample_ok' | 'sample_error' | 'error_detected';
export interface AutomationTransition { counter: AutomationCounter; proposePromotion: boolean; demoted: boolean }
/** approved_clean → consecutiveClean+1 (proposePromotion when reaching threshold in approval mode and action is promotable);
 *  edited/rejected → reset to 0; in auto mode sample_error/error_detected → demote to approval (reset counter). Forbidden actions never promote. */
export function applyAutomationOutcome(counter: AutomationCounter, outcome: AutomationOutcome, now: Date): AutomationTransition { return notImplemented('applyAutomationOutcome'); }
/** ~1 in 20 auto actions selected for admin sample audit. rng in [0,1). */
export function shouldSample(sampleRate: number, rng: () => number): boolean { return notImplemented('shouldSample'); }
export function promote(counter: AutomationCounter, now: Date): AutomationCounter { return notImplemented('promote'); }
