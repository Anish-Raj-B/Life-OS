import { useState } from 'react';
import { Database, KeyRound, Terminal, Copy, Check } from 'lucide-react';
import { Button, Card } from '@/components/ui';

const STEPS = [
  {
    icon: Database,
    title: 'Create the Supabase project',
    body: 'Create a project at supabase.com, then run the migrations from supabase/migrations in order (0001 → 0003) with the SQL editor or `supabase db push`.',
  },
  {
    icon: KeyRound,
    title: 'Enable Google sign-in',
    body: 'Supabase → Authentication → Providers → Google. Add your Google OAuth client ID/secret and set the redirect URL to https://<project-ref>.supabase.co/auth/v1/callback.',
  },
  {
    icon: Terminal,
    title: 'Add the public keys to .env',
    body: 'Copy .env.example to .env and fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Project Settings → API). Only public values belong in a VITE_ variable.',
  },
];

export default function SetupRequired() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText('cp .env.example .env');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-5 py-12">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Configuration required</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">LIFE OS needs its Supabase project</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
        The application is built and wired to a real Supabase backend, but no project credentials were found at
        build time. Nothing is simulated — until these values are supplied, sign-in and data storage are disabled.
      </p>

      <div className="mt-6 space-y-3">
        {STEPS.map((step, i) => (
          <Card key={step.title}>
            <div className="flex gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                <step.icon size={16} />
              </span>
              <div>
                <p className="text-sm font-medium text-ink">
                  {i + 1}. {step.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{step.body}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-4" title="Local development">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-base/70 px-3 py-2 font-mono text-xs text-muted">
          <span>cp .env.example .env && npm install && npm run dev</span>
          <Button size="sm" variant="ghost" icon={copied ? Check : Copy} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          The initial administrator is bound to <span className="text-ink">anishrajb21@gmail.com</span> by a database
          trigger. Public registration stays disabled until the administrator enables it from the admin console.
        </p>
      </Card>
    </div>
  );
}
