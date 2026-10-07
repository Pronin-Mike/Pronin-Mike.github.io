import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

/* ============================================================================
 * AuthContext.tsx — сессия пользователя Supabase Auth.
 * Регистрации нет: пользователь создаётся вручную в панели Supabase.
 * ========================================================================== */

const AUTH_ERRORS: Record<string, string> = {
  'Invalid login credentials': 'Неверный email или пароль.',
  'Email not confirmed': 'Email не подтверждён. Подтвердите пользователя в Supabase.',
  'User not found': 'Пользователь не найден.',
  'Too many requests': 'Слишком много попыток входа. Попробуйте позже.',
  'Failed to fetch': 'Нет связи с Supabase. Проверьте VITE_SUPABASE_URL и интернет.'
};

function humanize(message: string): string {
  return AUTH_ERRORS[message] ?? message;
}

export interface AuthValue {
  session: Session | null;
  email: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    let active = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    if (error) throw new Error(humanize(error.message));
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(humanize(error.message));
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      email: session?.user.email ?? null,
      loading,
      signIn,
      signOut
    }),
    [session, loading, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth используется вне AuthProvider');
  return context;
}
