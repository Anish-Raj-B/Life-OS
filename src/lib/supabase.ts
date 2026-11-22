import { createClient } from '@supabase/supabase-js';
import { IS_CONFIGURED, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

// The client is created even when unconfigured so module imports stay typed;
// the app renders the setup screen and never issues a request in that state.
export const supabase = createClient(
  IS_CONFIGURED ? SUPABASE_URL : 'http://127.0.0.1:54321',
  IS_CONFIGURED ? SUPABASE_ANON_KEY : 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'life-os-auth',
    },
    global: { headers: { 'x-application-name': 'life-os' } },
  },
);

export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String((error as any)?.message ?? error);
  return (
    error instanceof TypeError ||
    /failed to fetch|networkerror|network request failed|load failed|fetch failed|offline/i.test(message)
  );
}

export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (!error) return fallback;
  if (error instanceof Error) return error.message;
  const anyErr = error as any;
  if (anyErr.message) return String(anyErr.message);
  if (anyErr.details) return String(anyErr.details);
  return fallback;
}
