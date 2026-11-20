import { describe, expect, it } from 'vitest';
import { AI_ACTIONS } from '@mice/shared';
import { AiAuthorityError, aiMayPerform, assertAiMayPerform, draftActionFor } from '../src/index.js';

describe('assertAiMayPerform (§6 closed list)', () => {
  it('autonomous actions run in both modes', () => {
    expect(assertAiMayPerform('request_extraction', 'autonomous')).toBe('autonomous');
    expect(assertAiMayPerform('draft_generation', 'draft')).toBe('autonomous');
    expect(assertAiMayPerform('supplier_rfq_reminder', 'autonomous')).toBe('autonomous');
  });
  it('suggest actions: draft ok, autonomous only when promoted (§16)', () => {
    expect(assertAiMayPerform('rfq_send', 'draft')).toBe('suggest');
    expect(() => assertAiMayPerform('rfq_send', 'autonomous')).toThrow(AiAuthorityError);
    expect(assertAiMayPerform('rfq_send', 'autonomous', { promoted: true })).toBe('suggest');
  });
  it('forbidden actions always throw, in every mode, even when "promoted"', () => {
    const forbidden = Object.entries(AI_ACTIONS).filter(([, v]) => v.authority === 'forbidden').map(([k]) => k);
    expect(forbidden).toContain('money_movement');
    for (const a of forbidden) {
      for (const mode of ['autonomous', 'draft'] as const) {
        expect(() => assertAiMayPerform(a, mode, { promoted: true })).toThrow(AiAuthorityError);
      }
    }
    try { assertAiMayPerform('contract_signature', 'draft'); } catch (e) {
      expect((e as AiAuthorityError).code).toBe('ai_forbidden_action');
      expect((e as AiAuthorityError).message).toMatch(/Sözleşme imzası/);
    }
  });
  it('unknown actions are forbidden (closed list)', () => {
    expect(() => assertAiMayPerform('wire_transfer_now', 'draft')).toThrow(/kapalı listede yok/);
    expect(aiMayPerform('wire_transfer_now', 'draft')).toBe(false);
    expect(aiMayPerform('comparison', 'autonomous')).toBe(true);
  });
  it('every draft kind maps to a non-forbidden action', () => {
    for (const k of ['missing_info', 'rfq', 'rfq_reminder', 'negotiation', 'quote_cover', 'quote_followup', 'option_extension', 'revision_request', 'supplier_confirmation', 'daily_summary', 'other'] as const) {
      expect(() => assertAiMayPerform(draftActionFor(k), 'draft')).not.toThrow();
    }
  });
});
