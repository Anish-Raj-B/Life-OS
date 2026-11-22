import { useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, Users, Search, UserX, UserCheck, Palette, LayoutGrid, Flag, ScrollText,
  Save, Lock, Info, Sliders,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { useSettings, DEFAULT_MODULES, DEFAULT_NAV } from '@/context/SettingsContext';
import { supabase } from '@/lib/supabase';
import { useCollection } from '@/hooks/useCollection';
import {
  Badge, Button, Card, ConfirmDialog, Field, InfoNote, Input, LoadingBlock, PageHeader,
  Select, Tabs, Textarea, Toggle, useToast,
} from '@/components/ui';
import { prettyDate } from '@/lib/utils';
import type { AuditLog, NavItem, PlatformSettings } from '@/lib/types';

interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  suspended: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

type Tab = 'overview' | 'users' | 'appearance' | 'navigation' | 'modules' | 'defaults' | 'audit';

const MODULE_LABELS: Record<string, string> = {
  myday: 'My Day',
  tasks: 'Tasks',
  timetable: 'Timetable',
  analytics: 'Analytics',
  learning: 'Learning records',
  sections: 'Sections',
  paths: 'Learning paths',
  flashcards: 'Flashcards',
  challenges: 'Challenges',
  diary: 'Diary',
  goals: 'Goals',
  resources: 'Resources',
  integrations: 'Integrations',
};

export default function Admin() {
  const { user, isAdmin } = useAuth();
  const { settings, refresh } = useSettings();
  const toast = useToast();
  const { data: auditLogs } = useCollection<AuditLog>('audit_logs', 'created_at', false);

  const [tab, setTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [usersLoading, setUsersLoading] = useState(false);
  const [suspendTarget, setSuspendTarget] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState(false);

  const [draft, setDraft] = useState<PlatformSettings | null>(settings);
  const [navDraft, setNavDraft] = useState<NavItem[]>(settings?.navigation?.length ? settings.navigation : DEFAULT_NAV);
  const [modules, setModules] = useState<Record<string, boolean>>({ ...DEFAULT_MODULES, ...(settings?.modules ?? {}) });

  useEffect(() => {
    if (settings) {
      setDraft(settings);
      setNavDraft(settings.navigation?.length ? settings.navigation : DEFAULT_NAV);
      setModules({ ...DEFAULT_MODULES, ...(settings.modules ?? {}) });
    }
  }, [settings]);

  const loadUsers = async (search = '') => {
    setUsersLoading(true);
    const { data, error } = await supabase.rpc('admin_list_users', { p_search: search });
    if (error) toast.error(error.message);
    setUsers((data ?? []) as AdminUser[]);
    setUsersLoading(false);
  };

  useEffect(() => {
    if (isAdmin) void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const audit = async (action: string, entity: string, metadata: Record<string, unknown> = {}) => {
    await supabase.rpc('log_admin_action', {
      p_action: action,
      p_entity: entity,
      p_entity_id: entity,
      p_metadata: metadata,
    });
  };

  const saveSettings = async (patch: Partial<PlatformSettings>, action = 'settings.update', entity = 'platform_settings') => {
    if (!draft) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('platform_settings').update(patch).eq('id', 1);
      if (error) throw error;
      await audit(action, entity, { keys: Object.keys(patch) });
      await refresh();
      toast.success('Global configuration updated. All users receive this change.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  };

  const toggleSuspend = async () => {
    if (!suspendTarget) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_set_user_suspended', {
        p_user_id: suspendTarget.id,
        p_suspended: !suspendTarget.suspended,
      });
      if (error) throw error;
      toast.success(suspendTarget.suspended ? 'Account activated.' : 'Account suspended.');
      setSuspendTarget(null);
      await loadUsers(userSearch);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the account.');
    } finally {
      setBusy(false);
    }
  };

  const activeUsers = useMemo(() => users.filter((u) => !u.suspended).length, [users]);
  const admins = useMemo(() => users.filter((u) => u.role === 'admin').length, [users]);

  if (!isAdmin) return <LoadingBlock label="Checking permissions…" />;

  return (
    <div>
      <PageHeader
        eyebrow="Control plane"
        title="Administration"
        description="Central configuration for the whole platform. Authorisation is enforced by the database, not this screen."
        actions={<Badge tone="accent"><ShieldCheck size={10} /> administrator</Badge>}
      />

      <div className="mb-4 overflow-x-auto">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'users', label: 'Users' },
            { value: 'appearance', label: 'Appearance' },
            { value: 'navigation', label: 'Navigation' },
            { value: 'modules', label: 'Modules' },
            { value: 'defaults', label: 'Defaults' },
            { value: 'audit', label: 'Audit log' },
          ]}
        />
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-4"><p className="text-[10px] uppercase tracking-wider text-muted">Accounts</p><p className="mt-1 text-2xl font-semibold text-ink">{users.length}</p></div>
            <div className="card p-4"><p className="text-[10px] uppercase tracking-wider text-muted">Active</p><p className="mt-1 text-2xl font-semibold text-ok">{activeUsers}</p></div>
            <div className="card p-4"><p className="text-[10px] uppercase tracking-wider text-muted">Administrators</p><p className="mt-1 text-2xl font-semibold text-accent">{admins}</p></div>
            <div className="card p-4"><p className="text-[10px] uppercase tracking-wider text-muted">Registration</p><p className="mt-1 text-sm font-semibold text-ink">{settings?.public_registration_enabled ? 'Open' : 'Private'}</p></div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Access policy" subtitle="Enforced by database triggers and RLS">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 rounded-xl border border-line/60 p-3">
                  <div>
                    <p className="flex items-center gap-1.5 text-xs text-ink"><Lock size={12} /> Private workspace</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-muted">
                      When public registration is disabled, the sign-up trigger rejects every account except the owner
                      before a session can be created.
                    </p>
                  </div>
                  <Badge tone={settings?.public_registration_enabled ? 'warn' : 'ok'}>
                    {settings?.public_registration_enabled ? 'registration open' : 'private'}
                  </Badge>
                </div>
                <Toggle
                  label="Enable public registration"
                  description="New Google accounts will create their own isolated workspace. Only anishrajb21@gmail.com can hold the admin role."
                  checked={Boolean(draft?.public_registration_enabled)}
                  onChange={(value) => {
                    if (!draft) return;
                    setDraft({ ...draft, public_registration_enabled: value });
                    void saveSettings({ public_registration_enabled: value }, value ? 'registration.enable' : 'registration.disable');
                  }}
                />
                <InfoNote>
                  Administrator privileges come from <code className="text-ink">public.user_roles</code>. A trigger
                  inserts the role for the owner's email and rejects any role change made by a non-admin at the database
                  level — changing a frontend field cannot grant access.
                </InfoNote>
              </div>
            </Card>

            <Card title="Announcement" subtitle="Shown as a banner across the app">
              <Field label="Message">
                <Textarea
                  value={draft?.announcement ?? ''}
                  onChange={(e) => draft && setDraft({ ...draft, announcement: e.target.value })}
                  placeholder="Leave empty to hide the banner"
                />
              </Field>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" icon={Save} loading={busy} onClick={() => void saveSettings({ announcement: draft?.announcement?.trim() || null }, 'announcement.update')}>
                  Publish
                </Button>
                <Button size="sm" variant="ghost" onClick={() => draft && setDraft({ ...draft, announcement: '' })}>Clear</Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <Card
          title="Registered users"
          subtitle="Account management is prepared for a public launch"
          actions={
            <div className="flex gap-1.5">
              <Input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search email or name" className="!w-48 !py-1 !text-xs" />
              <Button size="sm" icon={Search} onClick={() => void loadUsers(userSearch)}>Search</Button>
            </div>
          }
        >
          {usersLoading ? (
            <LoadingBlock />
          ) : users.length === 0 ? (
            <p className="text-xs text-muted">No accounts found.</p>
          ) : (
            <div className="space-y-1.5">
              {users.map((account) => (
                <div key={account.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line/50 px-3 py-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {account.avatar_url ? (
                      <img src={account.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-raised text-[10px] text-muted">
                        {(account.full_name ?? account.email ?? '?').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xs text-ink">{account.full_name ?? 'Unnamed'}</p>
                      <p className="truncate text-[10px] text-muted">{account.email}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={account.role === 'admin' ? 'accent' : 'neutral'}>{account.role}</Badge>
                    {account.suspended && <Badge tone="danger">suspended</Badge>}
                    <span className="text-[10px] text-muted">joined {prettyDate(account.created_at, 'd MMM yyyy')}</span>
                    <span className="text-[10px] text-muted">· last in {account.last_sign_in_at ? prettyDate(account.last_sign_in_at, 'd MMM') : 'never'}</span>
                    {account.id !== user?.id && account.role !== 'admin' && (
                      <Button
                        size="sm"
                        variant={account.suspended ? 'ghost' : 'danger'}
                        icon={account.suspended ? UserCheck : UserX}
                        onClick={() => setSuspendTarget(account)}
                      >
                        {account.suspended ? 'Activate' : 'Suspend'}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <InfoNote>
              Administrators see account identities only — never another user's tasks, diary or learning records. RLS
              policies do not grant content access to the admin role.
            </InfoNote>
          </div>
        </Card>
      )}

      {tab === 'appearance' && draft && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card title="Global theme" subtitle="Applied to every user immediately on their next load">
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ['accent', 'Primary accent'],
                ['accent2', 'Secondary accent'],
                ['base', 'Background'],
                ['surface', 'Surface'],
              ] as const).map(([key, label]) => (
                <Field key={key} label={label}>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={draft.theme?.[key] ?? '#8b5cf6'}
                      onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, [key]: e.target.value } })}
                      className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-raised"
                      aria-label={label}
                    />
                    <Input
                      value={draft.theme?.[key] ?? ''}
                      onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, [key]: e.target.value } })}
                    />
                  </div>
                </Field>
              ))}
              <Field label="Typography">
                <Select
                  value={draft.theme?.fontSans ?? 'Inter'}
                  onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, fontSans: e.target.value } })}
                >
                  <option value="Inter">Inter</option>
                  <option value="system-ui">System UI</option>
                  <option value="Georgia">Georgia (serif)</option>
                  <option value="JetBrains Mono">JetBrains Mono</option>
                </Select>
              </Field>
              <Field label="Corner radius">
                <Select
                  value={draft.theme?.radius ?? '0.9rem'}
                  onChange={(e) => setDraft({ ...draft, theme: { ...draft.theme, radius: e.target.value } })}
                >
                  <option value="0.35rem">Sharp</option>
                  <option value="0.9rem">Balanced</option>
                  <option value="1.4rem">Soft</option>
                </Select>
              </Field>
              <Field label="Application name" className="sm:col-span-2">
                <Input value={draft.app_name} onChange={(e) => setDraft({ ...draft, app_name: e.target.value })} />
              </Field>
            </div>
            <div className="mt-3">
              <Button variant="primary" icon={Save} loading={busy} onClick={() => void saveSettings({ theme: draft.theme, app_name: draft.app_name }, 'theme.update')}>
                Apply global theme
              </Button>
            </div>
          </Card>

          <Card title="Preview">
            <div className="rounded-xl border border-line p-4" style={{ background: draft.theme?.base }}>
              <div className="rounded-lg p-3" style={{ background: draft.theme?.surface, borderRadius: draft.theme?.radius }}>
                <p className="text-xs" style={{ color: '#e9e9f0', fontFamily: draft.theme?.fontSans }}>{draft.app_name}</p>
                <div className="mt-2 h-1.5 w-full rounded-full" style={{ background: draft.theme?.accent }} />
                <div className="mt-1 h-1.5 w-2/3 rounded-full" style={{ background: draft.theme?.accent2 }} />
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted">
              Users cannot override these values; the palette is applied from platform settings at runtime.
            </p>
          </Card>
        </div>
      )}

      {tab === 'navigation' && (
        <Card title="Navigation structure" subtitle="Order, labels and visibility of every module">
          <div className="space-y-1.5">
            {navDraft.map((item, index) => (
              <div key={item.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-line/50 px-3 py-2">
                <span className="w-6 text-[10px] text-muted">{index + 1}</span>
                <Input
                  value={item.label}
                  onChange={(e) => {
                    const next = [...navDraft];
                    next[index] = { ...item, label: e.target.value };
                    setNavDraft(next);
                  }}
                  className="!w-44 !py-1 !text-xs"
                />
                <span className="font-mono text-[10px] text-muted">{item.path}</span>
                {item.adminOnly && <Badge tone="accent">admin only</Badge>}
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => {
                    const next = [...navDraft];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    setNavDraft(next);
                  }}>↑</Button>
                  <Button size="sm" variant="ghost" disabled={index === navDraft.length - 1} onClick={() => {
                    const next = [...navDraft];
                    [next[index + 1], next[index]] = [next[index], next[index + 1]];
                    setNavDraft(next);
                  }}>↓</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" icon={Save} loading={busy} onClick={() => void saveSettings({ navigation: navDraft }, 'navigation.update')}>
              Save navigation
            </Button>
            <Button onClick={() => setNavDraft(DEFAULT_NAV)}>Reset to default</Button>
          </div>
        </Card>
      )}

      {tab === 'modules' && (
        <Card title="Available modules" subtitle="Disabling a module removes it from navigation for every user">
          <div className="grid gap-1 sm:grid-cols-2">
            {Object.keys(MODULE_LABELS).map((key) => (
              <Toggle
                key={key}
                label={MODULE_LABELS[key]}
                checked={Boolean(modules[key])}
                onChange={(value) => setModules({ ...modules, [key]: value })}
              />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" icon={Save} loading={busy} onClick={() => void saveSettings({ modules }, 'modules.update')}>
              Save modules
            </Button>
            <Button onClick={() => setModules({ ...DEFAULT_MODULES })}>Enable all</Button>
          </div>
          <div className="mt-3">
            <InfoNote>
              Routes stay reachable for direct navigation so no data becomes inaccessible, but disabled modules disappear
              from the sidebar and mobile navigation.
            </InfoNote>
          </div>
        </Card>
      )}

      {tab === 'defaults' && draft && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Timetable defaults" subtitle="Starting values for every user">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Day starts">
                <input type="time" className="input" value={draft.defaults?.timetable_start ?? '06:00'}
                  onChange={(e) => setDraft({ ...draft, defaults: { ...draft.defaults, timetable_start: e.target.value } })} />
              </Field>
              <Field label="Day ends">
                <input type="time" className="input" value={draft.defaults?.timetable_end ?? '23:00'}
                  onChange={(e) => setDraft({ ...draft, defaults: { ...draft.defaults, timetable_end: e.target.value } })} />
              </Field>
              <Field label="Week starts on">
                <Select value={String(draft.defaults?.week_starts_on ?? 1)}
                  onChange={(e) => setDraft({ ...draft, defaults: { ...draft.defaults, week_starts_on: Number(e.target.value) } })}>
                  <option value="1">Monday</option>
                  <option value="0">Sunday</option>
                </Select>
              </Field>
              <Field label="Default timezone">
                <Input value={draft.defaults?.timezone ?? 'Asia/Kolkata'}
                  onChange={(e) => setDraft({ ...draft, defaults: { ...draft.defaults, timezone: e.target.value } })} />
              </Field>
            </div>
            <Button className="mt-3" variant="primary" icon={Save} loading={busy} onClick={() => void saveSettings({ defaults: draft.defaults }, 'defaults.update')}>
              Save defaults
            </Button>
          </Card>

          <Card title="Admin surface notes">
            <ul className="space-y-2 text-[11px] leading-relaxed text-muted">
              <li className="flex gap-1.5"><Palette size={12} className="mt-0.5 shrink-0 text-accent" /> Theme, typography, radius and application name are global.</li>
              <li className="flex gap-1.5"><LayoutGrid size={12} className="mt-0.5 shrink-0 text-accent" /> Navigation order and labels are global; module visibility is global.</li>
              <li className="flex gap-1.5"><Flag size={12} className="mt-0.5 shrink-0 text-accent" /> Announcements appear for every signed-in user.</li>
              <li className="flex gap-1.5"><Users size={12} className="mt-0.5 shrink-0 text-accent" /> Account suspension blocks sign-in; deletion removes data permanently.</li>
              <li className="flex gap-1.5"><Sliders size={12} className="mt-0.5 shrink-0 text-accent" /> A future hybrid workspace mode can build on this configuration layer.</li>
            </ul>
            <div className="mt-3">
              <InfoNote>Platform-wide content analytics are intentionally not exposed: RLS prevents reading other users' records, including for administrators.</InfoNote>
            </div>
          </Card>
        </div>
      )}

      {tab === 'audit' && (
        <Card title="Audit trail" subtitle="Sensitive administrative actions only — never tokens or private content">
          {auditLogs.length === 0 ? (
            <p className="text-xs text-muted">No administrative actions recorded yet.</p>
          ) : (
            <div className="space-y-1">
              {auditLogs.map((log) => (
                <div key={log.id} className={clsx('flex flex-wrap items-center gap-2 rounded-lg border border-line/50 px-2.5 py-1.5 text-[11px]')}>
                  <ScrollText size={11} className="text-muted" />
                  <span className="text-ink">{log.action}</span>
                  <span className="text-muted">{log.entity}</span>
                  <span className="ml-auto text-[10px] text-muted/70">{prettyDate(log.created_at, 'd MMM yyyy HH:mm')}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(suspendTarget)}
        title={suspendTarget?.suspended ? 'Activate account' : 'Suspend account'}
        message={
          suspendTarget?.suspended
            ? `Restore access for ${suspendTarget?.email}.`
            : `${suspendTarget?.email} will be blocked at sign-in and signed out on their next request. Their data is preserved.`
        }
        confirmLabel={suspendTarget?.suspended ? 'Activate' : 'Suspend'}
        destructive={!suspendTarget?.suspended}
        busy={busy}
        onCancel={() => setSuspendTarget(null)}
        onConfirm={() => void toggleSuspend()}
      />

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-line/60 bg-surface/50 p-3 text-[10px] leading-relaxed text-muted">
        <Info size={12} className="mt-0.5 shrink-0 text-accent2" />
        Every privileged operation on this page is also enforced server-side: RLS on platform_settings, user_roles and
        profiles, plus SECURITY DEFINER functions that re-check <code className="text-ink">is_admin()</code>. Opening this
        route in a non-admin session redirects before any request is made.
      </div>
    </div>
  );
}
