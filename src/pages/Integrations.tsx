import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Github, Trophy, Layers, RefreshCw, Unplug, Plug, Plus, Clock, AlertTriangle, Info, CheckCircle2, ExternalLink,
} from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { insertRow, invokeFunction, listRows } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, InfoNote, Input, LoadingBlock,
  Modal, PageHeader, Select, TagInput, Textarea, useToast,
} from '@/components/ui';
import { prettyDate, safeUrl, todayISO } from '@/lib/utils';
import type {
  IntegrationAccount, IntegrationActivity, IntegrationSyncLog, Provider,
} from '@/lib/types';

const PROVIDERS: {
  id: Provider;
  name: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  blurb: string;
  automatic: boolean;
}[] = [
  { id: 'github', name: 'GitHub', icon: Github, blurb: 'OAuth connection with verified commit activity from the official REST API.', automatic: true },
  { id: 'leetcode', name: 'LeetCode', icon: Trophy, blurb: 'Best-effort automatic statistics; manual tracking is always available.', automatic: true },
  { id: 'picoctf', name: 'PicoCTF', icon: Layers, blurb: 'Manual challenge log — PicoCTF has no public statistics API.', automatic: false },
];

export default function Integrations() {
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data: accounts, loading, reload } = useCollection<IntegrationAccount>('integration_accounts', 'created_at', false);
  const { data: activity, reload: reloadActivity } = useCollection<IntegrationActivity>('integration_activity', 'activity_date', false);
  const [logs, setLogs] = useState<IntegrationSyncLog[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [usernameModal, setUsernameModal] = useState<Provider | null>(null);
  const [username, setUsername] = useState('');
  const [manualOpen, setManualOpen] = useState<Provider | null>(null);
  const [manual, setManual] = useState({
    title: '',
    category: '',
    difficulty: 'easy',
    date: todayISO(),
    notes: '',
    link: '',
    tags: [] as string[],
    count: 1,
  });
  const [lcStats, setLcStats] = useState({ total: '', easy: '', medium: '', hard: '' });
  const [disconnect, setDisconnect] = useState<Provider | null>(null);

  const account = (provider: Provider) => accounts.find((a) => a.provider === provider);

  useEffect(() => {
    void listRows<IntegrationSyncLog>('integration_sync_logs', { order: 'created_at', ascending: false, limit: 25 })
      .then(({ data }) => setLogs(data))
      .catch(() => setLogs([]));
  }, [accounts]);

  useEffect(() => {
    const github = params.get('github');
    if (github === 'connected') {
      toast.success('GitHub connected.');
      reload();
      setParams({}, { replace: true });
    } else if (github === 'error') {
      toast.error(`GitHub connection failed (${params.get('reason') ?? 'unknown'}).`);
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activityFor = (provider: Provider) =>
    activity.filter((a) => a.provider === provider).sort((a, b) => b.activity_date.localeCompare(a.activity_date));

  const connectGithub = async () => {
    setBusy('github');
    try {
      const result = await invokeFunction<{ url?: string; error?: string }>('github-oauth', { action: 'start' });
      if (result.url) {
        window.location.assign(result.url);
        return;
      }
      toast.error(result.error === 'github_not_configured' ? 'GitHub OAuth is not configured on the server yet.' : 'Could not start the connection.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start GitHub OAuth.');
    } finally {
      setBusy(null);
    }
  };

  const sync = async (provider: Provider) => {
    setBusy(`sync-${provider}`);
    try {
      const result = await invokeFunction<{ ok: boolean; reason?: string; message?: string }>('integrations-sync', { provider });
      if (result.ok) {
        toast.success(provider === 'github' ? 'GitHub activity synced.' : 'Statistics synced.');
      } else if (result.reason === 'unsupported' || result.reason === 'auto_unavailable') {
        toast.info(result.message ?? 'Automatic retrieval is unavailable. Use manual tracking.');
      } else if (result.reason === 'not_connected') {
        toast.error('Connect the account first.');
      } else {
        toast.error(result.message ?? 'Sync failed.');
      }
      reload();
      const fresh = await listRows<IntegrationSyncLog>('integration_sync_logs', { order: 'created_at', ascending: false, limit: 25 });
      setLogs(fresh.data);
      reloadActivity();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setBusy(null);
    }
  };

  const saveUsername = async () => {
    if (!user || !usernameModal || !username.trim()) return;
    setBusy('username');
    try {
      const { error } = await supabase.from('integration_accounts').upsert(
        {
          user_id: user.id,
          provider: usernameModal,
          external_username: username.trim(),
          status: 'connected',
          metadata: {},
        },
        { onConflict: 'user_id,provider' },
      );
      if (error) throw error;
      toast.success('Username saved. Use Refresh to attempt automatic retrieval.');
      setUsernameModal(null);
      setUsername('');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the username.');
    } finally {
      setBusy(null);
    }
  };

  const doDisconnect = async () => {
    if (!disconnect) return;
    setBusy('disconnect');
    try {
      if (disconnect === 'github') {
        await invokeFunction('github-oauth', { action: 'disconnect' });
      } else {
        const target = account(disconnect);
        if (target) {
          const { error } = await supabase.from('integration_accounts')
            .update({ status: 'disconnected', external_username: null })
            .eq('id', target.id);
          if (error) throw error;
        }
      }
      toast.success('Disconnected.');
      setDisconnect(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not disconnect.');
    } finally {
      setBusy(null);
    }
  };

  const saveManual = async () => {
    if (!user || !manualOpen) return;
    setBusy('manual');
    try {
      const details: Record<string, unknown> = {
        title: manual.title.trim(),
        category: manual.category.trim() || null,
        difficulty: manual.difficulty,
        notes: manual.notes.trim() || null,
        link: safeUrl(manual.link),
      };

      if (manualOpen === 'leetcode') {
        // A manual snapshot: written with source=manual so the UI never implies
        // these came from LeetCode automatically.
        await insertRow('integration_activity', {
          user_id: user.id,
          provider: 'leetcode',
          activity_date: manual.date,
          kind: 'manual_snapshot',
          count: Number(manual.count) || 1,
          details,
          external_id: `lc-manual-${Date.now()}`,
          source: 'manual',
          verified: false,
        });
        const target = account('leetcode');
        if (target) {
          await supabase.from('integration_accounts').update({
            metadata: {
              ...(target.metadata ?? {}),
              total_solved: Number(lcStats.total) || target.metadata?.total_solved || null,
              easy_solved: Number(lcStats.easy) || target.metadata?.easy_solved || null,
              medium_solved: Number(lcStats.medium) || target.metadata?.medium_solved || null,
              hard_solved: Number(lcStats.hard) || target.metadata?.hard_solved || null,
              manual_updated_at: new Date().toISOString(),
            },
          }).eq('id', target.id);
        }
      } else {
        await insertRow('integration_activity', {
          user_id: user.id,
          provider: 'picoctf',
          activity_date: manual.date,
          kind: 'challenge',
          count: 1,
          details,
          external_id: `pico-${Date.now()}`,
          source: 'manual',
          verified: false,
        });
      }

      toast.success('Logged manually.');
      setManualOpen(null);
      setManual({ title: '', category: '', difficulty: 'easy', date: todayISO(), notes: '', link: '', tags: [], count: 1 });
      setLcStats({ total: '', easy: '', medium: '', hard: '' });
      reloadActivity();
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the entry.');
    } finally {
      setBusy(null);
    }
  };

  const picoCount = useMemo(() => activityFor('picoctf').length, [activity]);
  const picoCategories = useMemo(() => {
    const set = new Set(activityFor('picoctf').map((a) => String(a.details?.category ?? '')).filter(Boolean));
    return [...set];
  }, [activity]);

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        eyebrow="Connected data"
        title="Integrations"
        description="Optional connections. LIFE OS works fully without them; tokens are held only in server-side storage."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {PROVIDERS.map((provider) => {
          const acc = account(provider.id);
          const connected = acc && acc.status !== 'disconnected';
          const Icon = provider.icon;
          const items = activityFor(provider.id);
          return (
            <Card
              key={provider.id}
              title={<span className="flex items-center gap-2"><Icon size={15} /> {provider.name}</span>}
              subtitle={provider.blurb}
              actions={<Badge tone={connected ? 'ok' : 'neutral'}>{connected ? acc?.status === 'error' ? 'needs attention' : 'connected' : 'not connected'}</Badge>}
            >
              {provider.id === 'github' ? (
                connected ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      {acc?.metadata?.avatar_url && <img src={acc.metadata.avatar_url} alt="" className="h-7 w-7 rounded-full" />}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink">{acc?.external_username}</p>
                        <p className="text-[10px] text-muted">last sync {acc?.last_synced_at ? prettyDate(acc.last_synced_at, 'd MMM HH:mm') : 'never'}</p>
                      </div>
                    </div>
                    <dl className="space-y-1 text-[11px]">
                      <Row label="Repositories" value={String(acc?.metadata?.public_repos ?? '—')} />
                      <Row label="Commits (90d)" value={String(acc?.metadata?.commits_90d ?? 0)} />
                      <Row label="Latest commit" value={acc?.metadata?.latest_commit_at ? prettyDate(acc.metadata.latest_commit_at, 'd MMM HH:mm') : '—'} />
                      <Row label="Verified days" value={String(items.filter((i) => i.verified).length)} />
                    </dl>
                    {acc?.metadata?.repositories?.length > 0 && (
                      <div className="space-y-1">
                        {acc.metadata.repositories.slice(0, 3).map((repo: any) => (
                          <a key={repo.full_name} href={repo.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded-md border border-line/50 px-2 py-1 text-[10px] text-muted hover:border-accent/40">
                            <span className="truncate">{repo.name}</span>
                            <span className="flex items-center gap-1"><ExternalLink size={9} />{repo.language ?? '—'}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-1.5">
                      <Button size="sm" icon={RefreshCw} loading={busy === 'sync-github'} onClick={() => void sync('github')}>Refresh</Button>
                      <Button size="sm" variant="ghost" icon={Unplug} onClick={() => setDisconnect('github')}>Disconnect</Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted">Connect with GitHub OAuth to import commit activity.</p>
                    <Button variant="primary" size="sm" icon={Github} loading={busy === 'github'} onClick={() => void connectGithub()}>Connect GitHub</Button>
                    <p className="text-[10px] text-muted/70">Requires GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the server.</p>
                  </div>
                )
              ) : provider.id === 'leetcode' ? (
                <div className="space-y-2.5">
                  <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink">{acc?.external_username ?? 'No username set'}</p>
                      <p className="text-[10px] text-muted">
                        {acc?.metadata?.auto_retrieved_at
                          ? `auto retrieved ${prettyDate(acc.metadata.auto_retrieved_at, 'd MMM HH:mm')}`
                          : acc?.metadata?.manual_updated_at
                            ? `manual ${prettyDate(acc.metadata.manual_updated_at, 'd MMM HH:mm')}`
                            : 'not synced'}
                      </p>
                    </div>
                    <Badge tone={acc?.metadata?.auto_retrieved_at ? 'ok' : 'warn'}>
                      {acc?.metadata?.auto_retrieved_at ? 'auto' : 'manual'}
                    </Badge>
                  </div>
                  <dl className="space-y-1 text-[11px]">
                    <Row label="Total solved" value={String(acc?.metadata?.total_solved ?? '—')} />
                    <Row label="Easy / Med / Hard" value={`${acc?.metadata?.easy_solved ?? '—'} / ${acc?.metadata?.medium_solved ?? '—'} / ${acc?.metadata?.hard_solved ?? '—'}`} />
                  </dl>
                  {acc?.last_error && (
                    <p className="flex gap-1.5 rounded-lg border border-warn/30 bg-warn/5 px-2 py-1.5 text-[10px] leading-relaxed text-warn">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {acc.last_error}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" icon={Plus} onClick={() => { setUsernameModal('leetcode'); setUsername(acc?.external_username ?? ''); }}>
                      {acc?.external_username ? 'Change user' : 'Set username'}
                    </Button>
                    <Button size="sm" icon={RefreshCw} loading={busy === 'sync-leetcode'} onClick={() => void sync('leetcode')}>Refresh</Button>
                    <Button size="sm" variant="ghost" icon={Plus} onClick={() => setManualOpen('leetcode')}>Log manually</Button>
                    {connected && <Button size="sm" variant="ghost" icon={Unplug} onClick={() => setDisconnect('leetcode')} />}
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink">{acc?.external_username ?? 'No username set'}</p>
                      <p className="text-[10px] text-muted">{picoCount} challenge{picoCount === 1 ? '' : 's'} logged manually</p>
                    </div>
                    <Badge tone="warn">manual</Badge>
                  </div>
                  <dl className="space-y-1 text-[11px]">
                    <Row label="Challenges" value={String(picoCount)} />
                    <Row label="Categories" value={picoCategories.length ? picoCategories.slice(0, 3).join(', ') : '—'} />
                    <Row label="Last entry" value={items[0] ? prettyDate(items[0].activity_date, 'd MMM') : '—'} />
                  </dl>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" icon={Plus} onClick={() => { setUsernameModal('picoctf'); setUsername(acc?.external_username ?? ''); }}>
                      {acc?.external_username ? 'Change user' : 'Set username'}
                    </Button>
                    <Button size="sm" variant="primary" icon={Plus} onClick={() => setManualOpen('picoctf')}>Log challenge</Button>
                    {connected && <Button size="sm" variant="ghost" icon={Unplug} onClick={() => setDisconnect('picoctf')} />}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Activity log" subtitle="Every record states whether it was verified automatically or entered manually">
          {activity.length === 0 ? (
            <EmptyState icon={Plug} title="No activity yet" description="Connect GitHub or log a challenge manually." />
          ) : (
            <div className="max-h-[380px] space-y-1.5 overflow-y-auto">
              {[...activity]
                .sort((a, b) => b.activity_date.localeCompare(a.activity_date))
                .map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-2 rounded-lg border border-line/50 px-2.5 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] text-ink">
                        {item.provider === 'picoctf'
                          ? String(item.details?.title ?? 'Challenge')
                          : item.kind === 'commit'
                            ? `${item.count} commit${item.count === 1 ? '' : 's'}`
                            : item.kind.replace('_', ' ')}
                      </p>
                      <p className="text-[10px] text-muted">
                        {prettyDate(item.activity_date, 'd MMM yyyy')}
                        {item.details?.category ? ` · ${item.details.category}` : ''}
                        {item.details?.difficulty ? ` · ${item.details.difficulty}` : ''}
                      </p>
                    </div>
                    <Badge tone={item.verified ? 'ok' : 'warn'}>
                      {item.verified ? <CheckCircle2 size={9} /> : <Info size={9} />}
                      {item.verified ? 'verified' : 'manual'}
                    </Badge>
                  </div>
                ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Sync log" subtitle="Most recent server responses">
            {logs.length === 0 ? (
              <p className="text-xs text-muted">No sync attempts yet.</p>
            ) : (
              <ul className="space-y-1">
                {logs.slice(0, 8).map((log) => (
                  <li key={log.id} className="flex items-start gap-2 text-[10px]">
                    <span className={clsx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', log.status === 'success' ? 'bg-ok' : 'bg-danger')} />
                    <span className="min-w-0">
                      <span className="text-ink">{log.provider}</span>{' '}
                      <span className="text-muted">{log.message ?? log.status}</span>
                      <span className="block text-muted/60">{prettyDate(log.created_at, 'd MMM HH:mm')}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Honest limitations">
            <ul className="space-y-2 text-[11px] leading-relaxed text-muted">
              <li>· <span className="text-ink">GitHub</span> — commits authored by the linked account in repositories you can access. Opening GitHub does not count.</li>
              <li>· <span className="text-ink">LeetCode</span> — no official public API. Automatic retrieval uses an unofficial endpoint and may fail; manual entry always works.</li>
              <li>· <span className="text-ink">PicoCTF</span> — no permitted public statistics endpoint. Challenges are manual records, never scraped.</li>
              <li>· Tokens are stored in a server-only table with no client policy; disconnecting revokes them where the provider allows.</li>
            </ul>
            <div className="mt-3">
              <InfoNote>An integration failure never blocks the rest of LIFE OS.</InfoNote>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={Boolean(usernameModal)}
        onClose={() => setUsernameModal(null)}
        title={`${usernameModal === 'leetcode' ? 'LeetCode' : 'PicoCTF'} username`}
        description="Stored with your account. Used only for display and optional retrieval."
        footer={<><Button onClick={() => setUsernameModal(null)}>Cancel</Button><Button variant="primary" loading={busy === 'username'} onClick={() => void saveUsername()}>Save</Button></>}
      >
        <Field label="Username"><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your-handle" /></Field>
        {usernameModal === 'leetcode' && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="Total solved"><Input type="number" min={0} value={lcStats.total} onChange={(e) => setLcStats({ ...lcStats, total: e.target.value })} /></Field>
              <Field label="Easy"><Input type="number" min={0} value={lcStats.easy} onChange={(e) => setLcStats({ ...lcStats, easy: e.target.value })} /></Field>
              <Field label="Medium"><Input type="number" min={0} value={lcStats.medium} onChange={(e) => setLcStats({ ...lcStats, medium: e.target.value })} /></Field>
              <Field label="Hard"><Input type="number" min={0} value={lcStats.hard} onChange={(e) => setLcStats({ ...lcStats, hard: e.target.value })} /></Field>
            </div>
            <p className="mt-2 text-[10px] text-muted">Saved to your LeetCode account metadata as a manual snapshot. Empty fields are not overwritten.</p>
          </>
        )}
      </Modal>

      <Modal
        open={Boolean(manualOpen)}
        onClose={() => setManualOpen(null)}
        title={manualOpen === 'picoctf' ? 'Log a PicoCTF challenge' : 'Log LeetCode activity'}
        description="Marked as manual and unverified — exactly as it is."
        footer={<><Button onClick={() => setManualOpen(null)}>Cancel</Button><Button variant="primary" loading={busy === 'manual'} onClick={() => void saveManual()}>Save</Button></>}
      >
        <div className="space-y-3">
          <Field label={manualOpen === 'picoctf' ? 'Challenge name' : 'What did you solve?'}>
            <Input value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} placeholder={manualOpen === 'picoctf' ? 'e.g. Mod 26' : 'e.g. Two Sum'} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category"><Input value={manual.category} onChange={(e) => setManual({ ...manual, category: e.target.value })} placeholder="Cryptography…" /></Field>
            <Field label="Difficulty">
              <Select value={manual.difficulty} onChange={(e) => setManual({ ...manual, difficulty: e.target.value })}>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </Select>
            </Field>
            <Field label="Date"><Input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} /></Field>
            <Field label="Count"><Input type="number" min={1} value={manual.count} onChange={(e) => setManual({ ...manual, count: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Link"><Input value={manual.link} onChange={(e) => setManual({ ...manual, link: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Notes / evidence"><Textarea value={manual.notes} onChange={(e) => setManual({ ...manual, notes: e.target.value })} /></Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(disconnect)}
        title="Disconnect integration"
        message="The connection and its stored token will be removed. Your logged activity history stays in place."
        confirmLabel="Disconnect"
        destructive
        busy={busy === 'disconnect'}
        onCancel={() => setDisconnect(null)}
        onConfirm={() => void doDisconnect()}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="max-w-[62%] truncate text-right text-ink">{value}</dd>
    </div>
  );
}
