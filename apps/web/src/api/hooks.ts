import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { ApiClientError, errorMessage } from './client';

export interface Resource<T> {
  data: T | undefined;
  error: ApiClientError | Error | null;
  loading: boolean;
  /** re-fetch; resolves when done */
  reload: () => Promise<void>;
  setData: (updater: T | ((prev: T | undefined) => T)) => void;
  lastLoadedAt: number | null;
}

/** Fetch on mount / when deps change. Ignores stale responses. Optional polling interval (ms). */
export function useApi<T>(fn: () => Promise<T>, deps: DependencyList, opts: { pollMs?: number; enabled?: boolean } = {}): Resource<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiClientError | Error | null>(null);
  const [loading, setLoading] = useState(opts.enabled !== false);
  const [lastLoadedAt, setLast] = useState<number | null>(null);
  const reqId = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const enabled = opts.enabled !== false;

  const load = useCallback(async () => {
    if (!enabled) return;
    const id = ++reqId.current;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (id !== reqId.current) return;
      setDataState(d);
      setError(null);
      setLast(Date.now());
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof Error ? e : new Error(errorMessage(e)));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!opts.pollMs || !enabled) return;
    const h = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, opts.pollMs);
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(h);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load, opts.pollMs, enabled]);

  const setData = useCallback((u: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof u === 'function' ? (u as (p: T | undefined) => T)(prev) : u));
  }, []);

  return { data, error, loading, reload: load, setData, lastLoadedAt };
}

export interface Mutation<A extends unknown[], R> {
  run: (...args: A) => Promise<R | undefined>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
}

/** Wrap an action; captures error message for display; returns undefined on failure. */
export function useMutation<A extends unknown[], R>(fn: (...args: A) => Promise<R>, onSuccess?: (r: R) => void): Mutation<A, R> {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const okRef = useRef(onSuccess);
  okRef.current = onSuccess;
  const run = useCallback(async (...args: A) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fnRef.current(...args);
      okRef.current?.(r);
      return r;
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, error, clearError: () => setError(null) };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
