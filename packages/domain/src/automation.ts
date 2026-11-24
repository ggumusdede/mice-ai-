// §16 Kendini geliştiren yapı: otomasyon terfisi, örneklem denetimi, otomatik geri dönüş
import { isPromotable, type AutomationCounter } from '@mice/shared';

export type AutomationOutcome = 'approved_clean' | 'edited' | 'rejected' | 'sample_ok' | 'sample_error' | 'error_detected';
export interface AutomationTransition { counter: AutomationCounter; proposePromotion: boolean; demoted: boolean }

function demote(c: AutomationCounter, now: Date): AutomationCounter {
  return { ...c, mode: 'approval', consecutiveClean: 0, demotedAt: now.toISOString() };
}

/** approved_clean → consecutiveClean+1 (proposePromotion when reaching threshold in approval mode and action is promotable);
 *  edited/rejected → reset to 0; in auto mode sample_error/error_detected → demote to approval (reset counter). Forbidden actions never promote.
 *  Defensive: a non-promotable (forbidden / autonomous / unknown) action found in 'auto' mode is demoted on any outcome. */
export function applyAutomationOutcome(counter: AutomationCounter, outcome: AutomationOutcome, now: Date): AutomationTransition {
  const promotable = isPromotable(counter.actionType);
  let c: AutomationCounter = { ...counter };
  let proposePromotion = false;
  let demoted = false;

  if (c.mode === 'auto' && !promotable) {
    return { counter: demote(c, now), proposePromotion: false, demoted: true };
  }

  switch (outcome) {
    case 'approved_clean': {
      const before = c.consecutiveClean;
      c.consecutiveClean = before + 1;
      proposePromotion = c.mode === 'approval' && promotable && c.threshold > 0 && before < c.threshold && c.consecutiveClean >= c.threshold;
      break;
    }
    case 'edited':
    case 'rejected':
      c.consecutiveClean = 0;
      break;
    case 'sample_ok':
      c.totalSampled += 1;
      break;
    case 'sample_error':
      c.totalSampled += 1;
      c.sampleErrors += 1;
      if (c.mode === 'auto') {
        c = demote(c, now);
        demoted = true;
      } else c.consecutiveClean = 0;
      break;
    case 'error_detected':
      if (c.mode === 'auto') {
        c = demote(c, now);
        demoted = true;
      } else c.consecutiveClean = 0;
      break;
  }
  return { counter: c, proposePromotion, demoted };
}

/** ~1 in 20 auto actions selected for admin sample audit. rng in [0,1). */
export function shouldSample(sampleRate: number, rng: () => number): boolean {
  if (!(sampleRate > 0)) return false;
  if (sampleRate >= 1) return true;
  return rng() < sampleRate;
}

/** Admin-approved promotion to auto mode. Throws for non-promotable actions (§6 Yasak list never goes automatic). */
export function promote(counter: AutomationCounter, now: Date): AutomationCounter {
  if (!isPromotable(counter.actionType)) throw new Error(`Action "${counter.actionType}" can never be automated (§6/§16)`);
  return { ...counter, mode: 'auto', promotedAt: now.toISOString() };
}

/** (additive) Records one automatic execution; returns the updated counter and whether it was picked for sample audit. */
export function recordAutoExecution(counter: AutomationCounter, rng: () => number): { counter: AutomationCounter; sampled: boolean } {
  if (counter.mode !== 'auto') return { counter, sampled: false };
  return { counter: { ...counter, totalAuto: counter.totalAuto + 1 }, sampled: shouldSample(counter.sampleRate, rng) };
}
