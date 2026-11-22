import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, errorMessage } from '@/lib/supabase';
import { APP_ORIGIN } from '@/lib/env';
import type { Profile } from '@/lib/types';

interface AuthValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: 'admin' | 'user' | null;
  isAdmin: boolean;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

const REGISTRATION_MESSAGE =
  'This LIFE OS workspace is private. Public registration is disabled, so this Google account cannot sign in.';

function readUrlError(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const search = new URLSearchParams(window.location.search);
  const description = hash.get('error_description') ?? search.get('error_description') ?? hash.get('error') ?? search.get('error');
  if (!description) return null;
  if (/REGISTRATION_DISABLED|registration/i.test(description)) return REGISTRATION_MESSAGE;
  if (/access_denied|consent/i.test(description)) return 'Google sign-in was cancelled before it completed.';
  return decodeURIComponent(description.replace(/\+/g, ' '));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(readUrlError);

  const loadProfile = useCallback(async (user: User) => {
    const [{ data: profileRow, error: profileError }, { data: roleRow }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
    ]);

    if (profileError) {
      setAuthError(profileError.message);
      return;
    }
    setProfile((profileRow as Profile) ?? null);
    setRole((roleRow?.role as 'admin' | 'user') ?? 'user');

    if (profileRow?.suspended) {
      await supabase.auth.signOut();
      setAuthError('This account has been suspended by the administrator.');
      setProfile(null);
      setRole(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) await loadProfile(data.session.user);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (next?.user) {
        void loadProfile(next.user);
      } else {
        setProfile(null);
        setRole(null);
      }
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${APP_ORIGIN}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
    if (error) setAuthError(error.message);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setRole(null);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) await loadProfile(data.user);
  }, [loadProfile]);

  const deleteAccount = useCallback(async () => {
    const { error } = await supabase.rpc('delete_own_account');
    if (error) throw new Error(errorMessage(error, 'Account deletion failed.'));
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user: session?.user ?? null,
      session,
      profile,
      role,
      isAdmin: role === 'admin',
      loading,
      authError,
      clearAuthError: () => setAuthError(null),
      signInWithGoogle,
      signOut,
      refresh,
      deleteAccount,
    }),
    [session, profile, role, loading, authError, signInWithGoogle, signOut, refresh, deleteAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
