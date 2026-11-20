import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiClientError, request } from '../api/client';
import { useOnline } from '../api/hooks';
import {
  defaultQueueStore, flushQueue, makeQueued, outcomeForStatus, type QueuedRequest, type QueueStore, type Sender,
} from './offlineQueue';

interface OfflineQueueState {
  online: boolean;
  pending: QueuedRequest[];
  dropped: QueuedRequest[];
  syncing: boolean;
  /** Send now if possible; on network failure store in IndexedDB and return {queued:true}. */
  submit: <T>(req: Pick<QueuedRequest, 'method' | 'path' | 'body' | 'label'>) => Promise<{ queued: false; result: T } | { queued: true }>;
  flush: () => Promise<void>;
  dismissDropped: () => void;
}

const Ctx = createContext<OfflineQueueState | null>(null);

const sender: Sender = async (req) => {
  try {
    await request(req.method, req.path, req.body);
    return { outcome: 'ok' };
  } catch (e) {
    if (e instanceof ApiClientError) {
      return { outcome: e.status === 0 ? 'retry' : outcomeForStatus(e.status), error: e.message };
    }
    return { outcome: 'retry', error: String(e) };
  }
};

export function OfflineQueueProvider({ children, store }: { children: ReactNode; store?: QueueStore }) {
  const storeRef = useRef<QueueStore>(store ?? defaultQueueStore());
  const online = useOnline();
  const [pending, setPending] = useState<QueuedRequest[]>([]);
  const [dropped, setDropped] = useState<QueuedRequest[]>([]);
  const [syncing, setSyncing] = useState(false);
  const flushing = useRef(false);

  const refresh = useCallback(async () => {
    try {
      setPending(await storeRef.current.all());
    } catch {
      /* ignore */
    }
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    setSyncing(true);
    try {
      const r = await flushQueue(storeRef.current, sender);
      if (r.dropped.length) setDropped((d) => [...d, ...r.dropped]);
    } finally {
      flushing.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh().then(() => {
      if (navigator.onLine) void flush();
    });
  }, [refresh, flush]);

  useEffect(() => {
    if (online) void flush();
  }, [online, flush]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => e.data === 'flush-queue' && void flush();
    navigator.serviceWorker?.addEventListener('message', onMsg);
    const h = window.setInterval(() => {
      if (navigator.onLine && pending.length) void flush();
    }, 30_000);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMsg);
      window.clearInterval(h);
    };
  }, [flush, pending.length]);

  const submit = useCallback<OfflineQueueState['submit']>(
    async (req) => {
      const enqueue = async () => {
        await storeRef.current.put(makeQueued(req));
        await refresh();
        return { queued: true as const };
      };
      if (!navigator.onLine) return enqueue();
      try {
        const result = await request<never>(req.method, req.path, req.body);
        return { queued: false as const, result };
      } catch (e) {
        if (e instanceof ApiClientError && (e.status === 0 || e.status >= 500)) return enqueue();
        throw e;
      }
    },
    [refresh],
  );

  const value = useMemo<OfflineQueueState>(
    () => ({ online, pending, dropped, syncing, submit, flush, dismissDropped: () => setDropped([]) }),
    [online, pending, dropped, syncing, submit, flush],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOfflineQueue(): OfflineQueueState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOfflineQueue outside provider');
  return v;
}
