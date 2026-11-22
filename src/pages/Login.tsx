import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Zap, ShieldCheck, Loader2, AlertTriangle, ListChecks, Route, BarChart3 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';

const HIGHLIGHTS = [
  { icon: ListChecks, title: 'Tasks, timetable and focus', text: 'Plan the day, assign time blocks and keep completion history.' },
  { icon: Route, title: 'Learning pathways', text: 'Streak nodes stay on record even when a streak breaks.' },
  { icon: BarChart3, title: 'Real analytics', text: 'Charts built only from your stored records — no invented numbers.' },
];

export default function Login() {
  const { user, loading, signInWithGoogle, authError, clearAuthError } = useAuth();
  const { registrationEnabled, settings, appName } = useSettings();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Sign in · LIFE OS';
  }, []);

  if (!loading && user) return <Navigate to="/" replace />;

  const handleSignIn = async () => {
    setBusy(true);
    clearAuthError();
    await signInWithGoogle();
    setBusy(false);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line/60 p-10 lg:flex">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-accent/20 blur-[90px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-accent2/15 blur-[100px]" />

        <div className="relative flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent2 text-white shadow-lg shadow-accent/25">
            <Zap size={17} />
          </span>
          <span className="text-sm font-semibold tracking-tight">{appName}</span>
        </div>

        <div className="relative max-w-lg">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-ink">
            Your personal operating system for
            <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent"> focused, documented progress</span>.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Every task, study session, flashcard and diary entry is stored in your own private workspace and
            synchronised across devices.
          </p>

          <div className="mt-8 space-y-3">
            {HIGHLIGHTS.map((item) => (
              <div key={item.title} className="flex gap-3 rounded-xl border border-line/70 bg-surface/50 p-3.5">
                <item.icon size={17} className="mt-0.5 shrink-0 text-accent" />
                <div>
                  <p className="text-xs font-semibold text-ink">{item.title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11px] text-muted/70">
          Row-level security isolates every account. Integration tokens never reach the browser.
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent2 text-white">
              <Zap size={17} />
            </span>
            <span className="text-sm font-semibold">{appName}</span>
          </div>

          <h2 className="text-xl font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-muted">
            {registrationEnabled
              ? 'Continue with your Google account to open your workspace.'
              : 'This workspace is private. Only the owner account can sign in.'}
          </p>

          {authError && (
            <div className="mt-5 flex gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs leading-relaxed text-danger">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          <button
            onClick={() => void handleSignIn()}
            disabled={busy || loading}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-sm font-medium text-[#1f1f1f] transition hover:bg-white/90 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.2h6.6c-.1 1.1-.8 2.7-2.3 3.8l-.02.13 3.3 2.6.23.02c2.1-1.9 3.3-4.8 3.3-8.5" />
                <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5l-.12.01-3.4 2.7-.04.12C3.7 21.3 7.6 24 12 24" />
                <path fill="#FBBC05" d="M5.3 14.4c-.25-.7-.4-1.5-.4-2.4s.14-1.7.38-2.4l-.01-.16L1.8 7.1l-.11.05C.9 8.6.5 10.2.5 12s.4 3.4 1.2 4.85z" />
                <path fill="#EA4335" d="M12 4.7c2.2 0 3.7.9 4.6 1.7l3.4-3.3C17.9 1.2 15.2 0 12 0 7.6 0 3.7 2.7 1.7 6.7l3.6 2.8c.9-2.9 3.6-4.8 6.7-4.8" />
              </svg>
            )}
            {busy ? 'Redirecting to Google…' : 'Continue with Google'}
          </button>

          <div className="mt-6 flex items-start gap-2 rounded-xl border border-line/70 bg-surface/50 p-3 text-[11px] leading-relaxed text-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-ok" />
            <span>
              {registrationEnabled
                ? 'New here? Your Google account creates your own private workspace immediately.'
                : 'Public registration is disabled. If you are not the administrator, sign-in will be refused by the server.'}
            </span>
          </div>

          <p className="mt-8 text-center text-[10px] text-muted/60">
            Version {settings?.app_name ? '1.0' : '1.0'} · sessions are refreshed automatically
          </p>
        </div>
      </section>
    </div>
  );
}
