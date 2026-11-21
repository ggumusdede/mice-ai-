import { describe, expect, it } from 'vitest';
import { applyAutomationOutcome, shouldSample, promote, recordAutoExecution } from '../src/automation.js';
import { canDecide, requiresBiometric, roleCan, ADMIN_ONLY_DECISIONS, activeDelegation } from '../src/authority.js';
import { fieldExtraNeedsAdmin } from '../src/field-extras.js';
import { counter, rules } from './fixtures.js';
import type { Delegation, DecisionKind } from '@mice/shared';

const now = new Date('2026-11-20T10:00:00Z');

describe('automation (§16)', () => {
  it('20 clean approvals → propose promotion exactly when reaching threshold', () => {
    let c = counter();
    const proposals: number[] = [];
    for (let i = 1; i <= 22; i++) {
      const t = applyAutomationOutcome(c, 'approved_clean', now);
      if (t.proposePromotion) proposals.push(i);
      c = t.counter;
    }
    expect(proposals).toEqual([20]);
    expect(c.consecutiveClean).toBe(22);
  });
  it('edit or rejection resets the streak', () => {
    const t = applyAutomationOutcome(counter({ consecutiveClean: 19 }), 'edited', now);
    expect(t.counter.consecutiveClean).toBe(0);
    expect(applyAutomationOutcome(counter({ consecutiveClean: 5 }), 'rejected', now).counter.consecutiveClean).toBe(0);
  });
  it('forbidden / autonomous actions never propose promotion', () => {
    for (const actionType of ['money_movement', 'supplier_confirmation', 'contract_signature', 'rule_change', 'request_extraction'] as const) {
      const t = applyAutomationOutcome(counter({ actionType, consecutiveClean: 19 }), 'approved_clean', now);
      expect(t.proposePromotion).toBe(false);
    }
  });
  it('no proposal in auto mode', () => {
    expect(applyAutomationOutcome(counter({ mode: 'auto', consecutiveClean: 19 }), 'approved_clean', now).proposePromotion).toBe(false);
  });
  it('auto-demotion on sample error or detected error', () => {
    const auto = counter({ mode: 'auto', consecutiveClean: 30, promotedAt: '2026-11-01T00:00:00Z' });
    const t = applyAutomationOutcome(auto, 'sample_error', now);
    expect(t.demoted).toBe(true);
    expect(t.counter).toMatchObject({ mode: 'approval', consecutiveClean: 0, sampleErrors: 1, totalSampled: 1, demotedAt: now.toISOString() });
    const t2 = applyAutomationOutcome(auto, 'error_detected', now);
    expect(t2.demoted).toBe(true);
    expect(t2.counter.mode).toBe('approval');
  });
  it('sample_ok counts the sample and keeps auto mode', () => {
    const t = applyAutomationOutcome(counter({ mode: 'auto' }), 'sample_ok', now);
    expect(t.demoted).toBe(false);
    expect(t.counter).toMatchObject({ mode: 'auto', totalSampled: 1, sampleErrors: 0 });
  });
  it('errors in approval mode reset the streak without "demotion"', () => {
    const t = applyAutomationOutcome(counter({ consecutiveClean: 10 }), 'error_detected', now);
    expect(t.demoted).toBe(false);
    expect(t.counter.consecutiveClean).toBe(0);
  });
  it('a forbidden action somehow in auto mode is demoted immediately', () => {
    const t = applyAutomationOutcome(counter({ actionType: 'money_movement', mode: 'auto' }), 'approved_clean', now);
    expect(t.demoted).toBe(true);
    expect(t.counter.mode).toBe('approval');
  });
  it('does not mutate the input', () => {
    const c = counter();
    applyAutomationOutcome(c, 'approved_clean', now);
    expect(c.consecutiveClean).toBe(0);
  });
  it('promote: suggest actions only', () => {
    const p = promote(counter({ consecutiveClean: 20 }), now);
    expect(p).toMatchObject({ mode: 'auto', promotedAt: now.toISOString() });
    expect(() => promote(counter({ actionType: 'money_movement' }), now)).toThrow();
    expect(() => promote(counter({ actionType: 'supplier_accreditation' }), now)).toThrow();
  });
  it('shouldSample ~1/20', () => {
    expect(shouldSample(rules.automationSampleRate, () => 0.049)).toBe(true);
    expect(shouldSample(rules.automationSampleRate, () => 0.05)).toBe(false);
    expect(shouldSample(0, () => 0)).toBe(false);
    expect(shouldSample(1, () => 0.99)).toBe(true);
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let n = 0;
    for (let i = 0; i < 20000; i++) if (shouldSample(0.05, rng)) n++;
    expect(n / 20000).toBeGreaterThan(0.04);
    expect(n / 20000).toBeLessThan(0.06);
  });
  it('recordAutoExecution counts auto runs and samples', () => {
    const r = recordAutoExecution(counter({ mode: 'auto' }), () => 0.01);
    expect(r).toMatchObject({ sampled: true, counter: { totalAuto: 1 } });
    expect(recordAutoExecution(counter(), () => 0).sampled).toBe(false);
  });
});

describe('authority & delegation (§17.1)', () => {
  const delegation: Delegation = { id: 'd1', tenantId: 't', adminId: 'admin', delegateId: 'u2', startsAt: '2026-11-18T00:00:00Z', endsAt: '2026-11-25T00:00:00Z' };
  const clerk = { id: 'u2', role: 'clerk_sales' as const };
  it('admin can decide everything, not via delegation', () => {
    expect(canDecide({ id: 'a', role: 'admin' }, { kind: 'supplier_accreditation', requiredRole: 'admin' }, [], now)).toEqual({ allowed: true, viaDelegation: false });
  });
  it('delegate may approve payments and contracts within the date range (flagged)', () => {
    for (const kind of ['payment_approval', 'contract_approval', 'quote_approval', 'margin_override'] as DecisionKind[]) {
      expect(canDecide(clerk, { kind, requiredRole: 'admin' }, [delegation], now)).toEqual({ allowed: true, viaDelegation: true });
    }
  });
  it('delegate never decides accreditation / rule changes / automation promotion', () => {
    for (const kind of ADMIN_ONLY_DECISIONS) {
      const r = canDecide(clerk, { kind, requiredRole: 'admin' }, [delegation], now);
      expect(r.allowed).toBe(false);
      expect(r.reason).toBeTruthy();
    }
  });
  it('delegation outside its range (expired / not started / other user) does not apply', () => {
    expect(canDecide(clerk, { kind: 'payment_approval', requiredRole: 'admin' }, [delegation], new Date('2026-11-25T00:00:01Z')).allowed).toBe(false);
    expect(canDecide(clerk, { kind: 'payment_approval', requiredRole: 'admin' }, [delegation], new Date('2026-11-17T23:59:59Z')).reason).toMatch(/Vekâlet/);
    expect(canDecide({ id: 'u3', role: 'clerk_sales' }, { kind: 'payment_approval', requiredRole: 'admin' }, [delegation], now).allowed).toBe(false);
    expect(activeDelegation('u2', [delegation], new Date('2026-11-25T00:00:00Z'))).toEqual(delegation); // end inclusive
  });
  it('a matching non-admin role decides its own decisions', () => {
    expect(canDecide({ id: 'f', role: 'finance' }, { kind: 'low_confidence_review', requiredRole: 'finance' }, [], now)).toEqual({ allowed: true, viaDelegation: false });
    expect(canDecide({ id: 'f', role: 'finance' }, { kind: 'payment_approval', requiredRole: 'admin' }, [], now).allowed).toBe(false);
  });
  it('biometric for money and contract approvals', () => {
    expect(requiresBiometric('payment_approval')).toBe(true);
    expect(requiresBiometric('contract_approval')).toBe(true);
    expect(requiresBiometric('field_extra')).toBe(true);
    // a customer quote is a money commitment (§15) — approval and margin override need Face ID too
    expect(requiresBiometric('quote_approval')).toBe(true);
    expect(requiresBiometric('margin_override')).toBe(true);
    expect(requiresBiometric('rfq_send')).toBe(false);
    expect(requiresBiometric('assignment')).toBe(false);
    expect(requiresBiometric('checklist_question')).toBe(false);
  });
  it('role capabilities', () => {
    for (const c of ['confirm_supplier', 'sign_contract', 'approve_payment', 'accredit_supplier'] as const) {
      expect(roleCan('clerk_sales', c)).toBe(false);
      expect(roleCan('clerk_ops', c)).toBe(false);
    }
    expect(roleCan('clerk_sales', 'send_quote')).toBe(true);
    expect(roleCan('clerk_sales', 'create_candidate_supplier')).toBe(true);
    expect(roleCan('finance', 'create_payment_request')).toBe(true);
    expect(roleCan('finance', 'approve_payment')).toBe(false);
    expect(roleCan('finance', 'match_invoices')).toBe(true);
    expect(roleCan('field', 'field_extra')).toBe(true);
    expect(roleCan('signatory', 'sign_contract')).toBe(true);
    expect(roleCan('admin', 'change_rules')).toBe(true);
    expect(roleCan('clerk_sales', 'change_rules')).toBe(false);
  });
});

describe('fieldExtraNeedsAdmin (5.000 TL / item, 15.000 TL / project)', () => {
  const limits = { perItem: rules.fieldExtraPerItemLimitTry, perProject: rules.fieldExtraPerProjectLimitTry };
  it('within limits (inclusive boundaries)', () => {
    expect(fieldExtraNeedsAdmin(5000, 0, limits)).toBe(false);
    expect(fieldExtraNeedsAdmin(5000, 10000, limits)).toBe(false);
    expect(fieldExtraNeedsAdmin(0, 0, limits)).toBe(false);
  });
  it('above per-item or per-project limits', () => {
    expect(fieldExtraNeedsAdmin(5000.01, 0, limits)).toBe(true);
    expect(fieldExtraNeedsAdmin(4000, 11001, limits)).toBe(true);
    expect(fieldExtraNeedsAdmin(1, 15000, limits)).toBe(true);
  });
  it('invalid amount → admin', () => {
    expect(fieldExtraNeedsAdmin(NaN, 0, limits)).toBe(true);
  });
});
