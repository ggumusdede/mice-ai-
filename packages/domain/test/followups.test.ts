import { describe, expect, it } from 'vitest';
import { dueFollowups, type FollowupState } from '../src/followups.js';
import { cal, rules } from './fixtures.js';

const empty = (now: string, over: Partial<FollowupState> = {}): FollowupState => ({ now: new Date(now), rfqs: [], quotes: [], offers: [], unmatchedPayments: [], projects: [], ...over });
const rfq = (over: Partial<FollowupState['rfqs'][number]> = {}) => ({ id: 'r1', status: 'sent', sentAt: '2026-11-16T07:00:00Z', reminderSentAt: null, callTaskCreatedAt: null, ...over });

describe('RFQ follow-ups (24h reminder / 48h call task)', () => {
  it('nothing before 24h', () => {
    expect(dueFollowups(empty('2026-11-17T06:59:00Z', { rfqs: [rfq()] }), rules, cal)).toEqual([]);
  });
  it('reminder at 24h', () => {
    expect(dueFollowups(empty('2026-11-17T07:00:00Z', { rfqs: [rfq()] }), rules, cal)).toEqual([{ type: 'supplier_reminder', rfqId: 'r1' }]);
  });
  it('idempotent: no repeat once reminderSentAt recorded', () => {
    expect(dueFollowups(empty('2026-11-17T12:00:00Z', { rfqs: [rfq({ reminderSentAt: '2026-11-17T07:00:00Z' })] }), rules, cal)).toEqual([]);
  });
  it('call task at 48h, once', () => {
    const s = empty('2026-11-18T07:00:00Z', { rfqs: [rfq({ reminderSentAt: '2026-11-17T07:00:00Z' })] });
    expect(dueFollowups(s, rules, cal)).toEqual([{ type: 'call_task', rfqId: 'r1' }]);
    s.rfqs[0].callTaskCreatedAt = '2026-11-18T07:00:00Z';
    expect(dueFollowups(s, rules, cal)).toEqual([]);
  });
  it('per-RFQ override (urgent 12/24h) and non-sent RFQs ignored', () => {
    const s = empty('2026-11-16T19:00:00Z', { rfqs: [rfq({ reminderHours: 12, callHours: 24 }), rfq({ id: 'r2', status: 'responded' }), rfq({ id: 'r3', sentAt: null })] });
    expect(dueFollowups(s, rules, cal)).toEqual([{ type: 'supplier_reminder', rfqId: 'r1' }]);
  });
});

describe('quote follow-ups', () => {
  const q = (over: Partial<FollowupState['quotes'][number]> = {}) => ({ id: 'q1', status: 'sent', sentAt: '2026-11-19T11:00:00Z', optionUntil: null, lastFollowupAt: null, ...over });
  it('no_response after 2 business days (Thu → Mon, weekend skipped)', () => {
    expect(dueFollowups(empty('2026-11-22T11:00:00Z', { quotes: [q()] }), rules, cal)).toEqual([]); // Sunday
    expect(dueFollowups(empty('2026-11-23T10:59:00Z', { quotes: [q()] }), rules, cal)).toEqual([]);
    expect(dueFollowups(empty('2026-11-23T11:00:00Z', { quotes: [q()] }), rules, cal)).toEqual([{ type: 'quote_followup_draft', quoteId: 'q1', reason: 'no_response' }]);
  });
  it('not repeated once a follow-up is recorded; ignored when not sent', () => {
    expect(dueFollowups(empty('2026-11-24T11:00:00Z', { quotes: [q({ lastFollowupAt: '2026-11-23T11:00:00Z' })] }), rules, cal)).toEqual([]);
    expect(dueFollowups(empty('2026-11-24T11:00:00Z', { quotes: [q({ status: 'accepted' })] }), rules, cal)).toEqual([]);
  });
  it('option_expiring 2 days before option end, even after an earlier no_response follow-up', () => {
    const quote = q({ optionUntil: '2026-11-30', lastFollowupAt: '2026-11-23T11:00:00Z' });
    expect(dueFollowups(empty('2026-11-27T20:00:00Z', { quotes: [quote] }), rules, cal)).toEqual([]); // 27th 23:00 local
    expect(dueFollowups(empty('2026-11-27T21:00:00Z', { quotes: [quote] }), rules, cal)).toEqual([{ type: 'quote_followup_draft', quoteId: 'q1', reason: 'option_expiring' }]); // 28th 00:00 local
    // recorded inside the window → idempotent
    expect(dueFollowups(empty('2026-11-29T09:00:00Z', { quotes: [{ ...quote, lastFollowupAt: '2026-11-28T08:00:00Z' }] }), rules, cal)).toEqual([]);
    // option already over → nothing
    expect(dueFollowups(empty('2026-12-01T09:00:00Z', { quotes: [quote] }), rules, cal)).toEqual([]);
  });
  it('one draft per quote per run (option_expiring wins over no_response)', () => {
    const out = dueFollowups(empty('2026-11-29T09:00:00Z', { quotes: [q({ optionUntil: '2026-11-30' })] }), rules, cal);
    expect(out).toEqual([{ type: 'quote_followup_draft', quoteId: 'q1', reason: 'option_expiring' }]);
  });
});

describe('supplier option expiry alarm', () => {
  const o = (over: Partial<FollowupState['offers'][number]> = {}) => ({ id: 'o1', optionUntil: '2026-11-30', selected: true, alarmedAt: null, ...over });
  it('alarms selected offers from 2 days before, once', () => {
    expect(dueFollowups(empty('2026-11-27T12:00:00Z', { offers: [o()] }), rules, cal)).toEqual([]);
    expect(dueFollowups(empty('2026-11-28T12:00:00Z', { offers: [o()] }), rules, cal)).toEqual([{ type: 'option_expiry_alarm', offerId: 'o1', optionUntil: '2026-11-30' }]);
    expect(dueFollowups(empty('2026-11-28T12:00:00Z', { offers: [o({ alarmedAt: '2026-11-28T00:00:00Z' })] }), rules, cal)).toEqual([]);
    expect(dueFollowups(empty('2026-11-28T12:00:00Z', { offers: [o({ selected: false }), o({ id: 'o2', optionUntil: null })] }), rules, cal)).toEqual([]);
  });
});

describe('unbilled payments', () => {
  const p = (over: Partial<FollowupState['unmatchedPayments'][number]> = {}) => ({ id: 'b1', since: '2026-11-16T08:00:00Z', payerUserId: 'u1', escalatedAt: null, lastReminderAt: null, ...over });
  it('daily reminder to payer, once per local day', () => {
    expect(dueFollowups(empty('2026-11-16T09:00:00Z', { unmatchedPayments: [p()] }), rules, cal)).toEqual([{ type: 'unbilled_payment_daily_reminder', bankTransactionId: 'b1', userId: 'u1' }]);
    expect(dueFollowups(empty('2026-11-16T20:00:00Z', { unmatchedPayments: [p({ lastReminderAt: '2026-11-16T09:00:00Z' })] }), rules, cal)).toEqual([]);
    // 2026-11-16T21:30Z is already 17 Nov local
    expect(dueFollowups(empty('2026-11-16T21:30:00Z', { unmatchedPayments: [p({ lastReminderAt: '2026-11-16T09:00:00Z' })] }), rules, cal)).toHaveLength(1);
  });
  it('escalates after 7 days, once', () => {
    const s = empty('2026-11-23T08:00:00Z', { unmatchedPayments: [p({ lastReminderAt: '2026-11-23T06:00:00Z' })] });
    expect(dueFollowups(s, rules, cal)).toEqual([{ type: 'unbilled_payment_escalation', bankTransactionId: 'b1' }]);
    expect(dueFollowups(empty('2026-11-23T07:59:00Z', { unmatchedPayments: [p({ lastReminderAt: '2026-11-23T06:00:00Z' })] }), rules, cal)).toEqual([]);
    expect(dueFollowups(empty('2026-11-25T08:00:00Z', { unmatchedPayments: [p({ escalatedAt: '2026-11-23T08:00:00Z', lastReminderAt: '2026-11-25T06:00:00Z' })] }), rules, cal)).toEqual([]);
  });
});

describe('closing overdue (event end + 30 days)', () => {
  const pr = (over: Partial<FollowupState['projects'][number]> = {}) => ({ id: 'p1', eventEndedAt: '2026-10-01T15:00:00Z', closedAt: null, overdueAlertedAt: null, ...over });
  it('alerts only after 30 days, once, and never for closed projects', () => {
    expect(dueFollowups(empty('2026-10-31T15:00:00Z', { projects: [pr()] }), rules, cal)).toEqual([]);
    expect(dueFollowups(empty('2026-10-31T15:01:00Z', { projects: [pr()] }), rules, cal)).toEqual([{ type: 'closing_overdue', projectId: 'p1' }]);
    expect(dueFollowups(empty('2026-11-15T00:00:00Z', { projects: [pr({ overdueAlertedAt: '2026-11-01T00:00:00Z' }), pr({ id: 'p2', closedAt: '2026-10-20T00:00:00Z' }), pr({ id: 'p3', eventEndedAt: null })] }), rules, cal)).toEqual([]);
  });
});
