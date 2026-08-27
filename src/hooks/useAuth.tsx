/**
 * Auth. Email + password only — no magic link, no SMS OTP (SMS needs a paid
 * provider and breaks the free-to-build constraint; phone auth is a later wave).
 *
 * Discovery is *not* gated on auth. You can browse, search and watch the pulse
 * of any venue in the world signed out. Only submitting a check-in requires an
 * account, because a check-in has to belong to someone.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { getBackend } from '@/data/backend';
import type { AuthResult, AuthUser, Session } from '@/lib/types';

type AuthContextValue = {
  user: AuthUser | null;
  ready: boolean;
  mode: 'demo' | 'supabase';
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'demo' | 'supabase'>('demo');

  useEffect(() => {
    let alive = true;
    getBackend()
      .then((backend) => {
        if (!alive) return;
        setMode(backend.kind);
        return backend.getSession().then((s) => {
          if (!alive) return;
          setSession(s);
          setReady(true);
          return backend.onAuthChange((next) => alive && setSession(next));
        });
      })
      .catch(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const backend = await getBackend();
    return backend.signIn(email, password);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const backend = await getBackend();
    return backend.signUp(email, password);
  }, []);

  const signOut = useCallback(async () => {
    const backend = await getBackend();
    await backend.signOut();
  }, []);

  const value = useMemo(
    () => ({ user: session?.user ?? null, ready, mode, signIn, signUp, signOut }),
    [session, ready, mode, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
