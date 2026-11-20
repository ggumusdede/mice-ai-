import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MeResponse, User } from '@mice/shared';
import { api, getToken, onUnauthorized, setToken } from '../api/client';

interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: User | null;
  me: MeResponse | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  /** true when the current user is acting as an admin's delegate right now (§17.1) */
  isDelegate: boolean;
  isAdmin: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<AuthState['status']>(getToken() ? 'loading' : 'anonymous');

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
    setStatus('anonymous');
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setStatus('anonymous');
      return;
    }
    try {
      const m = await api.auth.me();
      setMe(m);
      setStatus('authenticated');
    } catch (e) {
      // network failure while offline: keep the token, stay "loading" → show retry
      if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 0) {
        setStatus((s) => (s === 'loading' ? 'loading' : s));
        return;
      }
      logout();
    }
  }, [logout]);

  useEffect(() => {
    onUnauthorized(logout);
    void refresh();
    return () => onUnauthorized(null);
  }, [logout, refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api.auth.login({ email, password });
      setToken(r.token);
      try {
        setMe(await api.auth.me());
      } catch {
        setMe({ user: r.user, tenant: { id: r.user.tenantId, name: '' }, activeDelegationsForMe: [] });
      }
      setStatus('authenticated');
    },
    [],
  );

  const value = useMemo<AuthState>(() => {
    const user = me?.user ?? null;
    const now = Date.now();
    const isDelegate =
      !!me && user?.role !== 'admin' &&
      me.activeDelegationsForMe.some((d) => new Date(d.startsAt).getTime() <= now && new Date(d.endsAt).getTime() >= now);
    return { status, user, me, login, logout, refresh, isDelegate, isAdmin: user?.role === 'admin' };
  }, [status, me, login, logout, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
