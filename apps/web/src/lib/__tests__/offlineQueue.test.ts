import { describe, expect, it } from 'vitest';
import { flushQueue, makeQueued, MemoryQueueStore, outcomeForStatus } from '../offlineQueue';

const q = (label: string, t: number) => makeQueued({ method: 'POST', path: `/x/${label}`, body: { label }, label }, t);

describe('offline queue', () => {
  it('replays oldest-first and removes sent items', async () => {
    const s = new MemoryQueueStore();
    await s.put(q('b', 2));
    await s.put(q('a', 1));
    const seen: string[] = [];
    const r = await flushQueue(s, async (req) => (seen.push(req.label), { outcome: 'ok' }));
    expect(seen).toEqual(['a', 'b']);
    expect(r).toMatchObject({ sent: 2, remaining: 0, stoppedOnRetry: false });
  });
  it('stops on retry to preserve order and counts attempts', async () => {
    const s = new MemoryQueueStore();
    await s.put(q('a', 1));
    await s.put(q('b', 2));
    const r = await flushQueue(s, async () => ({ outcome: 'retry', error: 'offline' }));
    expect(r).toMatchObject({ sent: 0, remaining: 2, stoppedOnRetry: true });
    const items = await s.all();
    expect(items.find((i) => i.label === 'a')?.attempts).toBe(1);
    expect(items.find((i) => i.label === 'b')?.attempts).toBe(0);
  });
  it('drops permanent failures and reports them; thrown errors are retries', async () => {
    const s = new MemoryQueueStore();
    await s.put(q('bad', 1));
    await s.put(q('good', 2));
    const r = await flushQueue(s, async (req) => (req.label === 'bad' ? { outcome: 'drop', error: '422' } : { outcome: 'ok' }));
    expect(r.dropped.map((d) => d.label)).toEqual(['bad']);
    expect(r.sent).toBe(1);
    await s.put(q('x', 3));
    const r2 = await flushQueue(s, async () => { throw new Error('boom'); });
    expect(r2.stoppedOnRetry).toBe(true);
  });
  it('drops after maxAttempts', async () => {
    const s = new MemoryQueueStore();
    await s.put({ ...q('a', 1), attempts: 2 });
    const r = await flushQueue(s, async () => ({ outcome: 'retry' }), { maxAttempts: 3 });
    expect(r.dropped).toHaveLength(1);
    expect(r.remaining).toBe(0);
  });
  it('classifies statuses', () => {
    expect(outcomeForStatus(201)).toBe('ok');
    expect(outcomeForStatus(503)).toBe('retry');
    expect(outcomeForStatus(422)).toBe('drop');
  });
});
