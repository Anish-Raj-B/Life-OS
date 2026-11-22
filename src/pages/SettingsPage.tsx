import { useEffect, useRef, useState } from 'react';
import {
  Bell, Download, Upload, RefreshCw, Trash2, Smartphone, AlertTriangle, CheckCircle2,
  CloudOff, ShieldAlert, Database,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/context/SyncContext';
import { supabase } from '@/lib/supabase';
import { flushOutbox, insertRow } from '@/lib/api';
import { clearCache } from '@/lib/offline';
import { buildBackup, downloadBackup, importBackup, validateBackup, type BackupFile } from '@/lib/backup';
import {
  Badge, Button, Card, ConfirmDialog, Field, InfoNote, LoadingBlock, Modal, PageHeader,
  Progress, Select, Toggle, useToast,
} from '@/components/ui';
import type { UserSettings } from '@/lib/types';

/** Mirrors the column defaults in 0001_schema.sql so the page works before the
 *  row exists (a missing row must not leave the page stuck on a loader). */
const defaultSettings = (userId: string): UserSettings => ({
  user_id: userId,
  notifications: { tasks: true, timetable: true, flashcards: true, streaks: true, challenges: false, browser: false },
  week_starts_on: 1,
  timetable_start: '06:00',
  timetable_end: '23:00',
});

const CATEGORIES = [
  { key: 'tasks', label: 'Upcoming and overdue tasks', description: 'Tasks due today or past their due date.' },
  { key: 'timetable', label: 'Timetable blocks', description: 'Reminders attached to scheduled blocks.' },
  { key: 'flashcards', label: 'Flashcard revision', description: 'When cards become due.' },
  { key: 'streaks', label: 'Learning streaks', description: 'Missed learning days and streak milestones.' },
  { key: 'challenges', label: 'Challenges', description: 'Suggested revision challenges.' },
];

export default function SettingsPage() {
  const { profile, user, deleteAccount, isAdmin } = useAuth();
  const { state, pending, conflicts, syncNow, online } = useSync();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importPreview, setImportPreview] = useState<{ file: BackupFile; counts: Record<string, number>; errors: string[] } | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importing, setImporting] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );

  useEffect(() => {
    if (!user) return;
    supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle().then(({ data }) => {
      setSettings((data as UserSettings) ?? defaultSettings(user.id));
    });
  }, [user]);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const saveSettings = async (patch: Partial<UserSettings>) => {
    if (!user || !settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      const { error } = await supabase.from('user_settings').upsert({ ...next, user_id: user.id });
      if (error) throw error;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save preferences.');
    } finally {
      setSaving(false);
    }
  };

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') {
      toast.error('This browser does not support notifications.');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      toast.success('Notifications enabled for this device.');
      new Notification('LIFE OS', { body: 'Notifications are enabled on this device.' });
    } else {
      toast.info('Permission was not granted — in-app reminders still work.');
    }
  };

  const exportBackup = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const backup = await buildBackup(user.id);
      downloadBackup(backup);
      await insertRow('backup_records', {
        user_id: user.id,
        kind: 'manual',
        size_bytes: JSON.stringify(backup).length,
        note: 'Manual JSON export',
      });
      toast.success('Backup downloaded.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const pickFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validation = validateBackup(parsed);
      setImportPreview({ file: parsed as BackupFile, counts: validation.counts, errors: validation.errors });
      if (!validation.ok) toast.error('The file has validation problems — review them before importing.');
    } catch (e) {
      toast.error('That file is not valid JSON.');
    }
  };

  const runImport = async () => {
    if (!user || !importPreview) return;
    setImporting(true);
    try {
      const result = await importBackup(importPreview.file, user.id, importMode);
      const total = Object.values(result.imported).reduce((s, n) => s + n, 0);
      toast.success(`Imported ${total} records.`);
      if (result.skipped.length) toast.info(`${result.skipped.length} rows were skipped (duplicates or invalid references).`);
      setImportPreview(null);
      void clearCache();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const install = async () => {
    if (!installPrompt) {
      toast.info('Use your browser menu → "Install app" or "Add to Home screen".');
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') toast.success('Installing LIFE OS.');
    setInstallPrompt(null);
  };

  const removeAccount = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Account deletion failed.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (!settings) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Device, notification, synchronisation and data controls. Theme and navigation are administrator-managed."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Notifications" subtitle="In-app reminders are delivered while LIFE OS is open">
          <div className="mb-3 flex items-center justify-between rounded-xl border border-line/60 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-accent" />
              <div>
                <p className="text-xs text-ink">Browser permission</p>
                <p className="text-[10px] text-muted">
                  {permission === 'granted' ? 'Granted on this device' : permission === 'denied' ? 'Blocked in browser settings' : 'Not requested yet'}
                </p>
              </div>
            </div>
            <Badge tone={permission === 'granted' ? 'ok' : permission === 'denied' ? 'danger' : 'warn'}>{permission}</Badge>
          </div>
          <Button size="sm" onClick={() => void requestNotifications()} disabled={permission === 'granted'}>Request permission</Button>

          <div className="mt-3 divide-y divide-line/50">
            {CATEGORIES.map((category) => (
              <Toggle
                key={category.key}
                label={category.label}
                description={category.description}
                checked={Boolean(settings.notifications?.[category.key])}
                onChange={(value) => void saveSettings({ notifications: { ...settings.notifications, [category.key]: value } })}
              />
            ))}
          </div>
          <div className="mt-3">
            <InfoNote>
              Browser notifications are only delivered while the app is open unless the installed PWA and the browser
              allow background delivery. LIFE OS does not claim push delivery where none is configured — scheduled
              reminders are checked in-app.
            </InfoNote>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Workspace preferences">
            <div className="space-y-3">
              <Field label="Week starts on">
                <Select
                  value={String(settings.week_starts_on)}
                  onChange={(e) => void saveSettings({ week_starts_on: Number(e.target.value) })}
                >
                  <option value="1">Monday</option>
                  <option value="0">Sunday</option>
                  <option value="6">Saturday</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Timetable start"><input type="time" className="input" value={settings.timetable_start.slice(0, 5)} onChange={(e) => void saveSettings({ timetable_start: e.target.value })} /></Field>
                <Field label="Timetable end"><input type="time" className="input" value={settings.timetable_end.slice(0, 5)} onChange={(e) => void saveSettings({ timetable_end: e.target.value })} /></Field>
              </div>
              <p className="text-[10px] text-muted">Timezone: <span className="text-ink">{profile?.timezone ?? 'Asia/Kolkata'}</span> (change on your profile)</p>
              {saving && <p className="text-[10px] text-accent">Saving…</p>}
            </div>
          </Card>

          <Card title="Install & offline">
            <div className="flex items-center gap-2 text-[11px] text-muted">
              {online ? <CheckCircle2 size={13} className="text-ok" /> : <CloudOff size={13} className="text-warn" />}
              {online ? 'Online' : 'Offline — changes are queued locally'}
              <Badge tone={state === 'error' ? 'danger' : pending ? 'warn' : 'ok'}>{state}</Badge>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              LIFE OS is installable. Offline task creation, task completion, diary drafts and learning notes are stored
              in IndexedDB and synchronised when the connection returns.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" icon={Smartphone} onClick={() => void install()}>Install app</Button>
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void syncNow()}>Sync now</Button>
            </div>
            <p className="mt-2 text-[10px] text-muted">{pending} pending change{pending === 1 ? '' : 's'}</p>
            {conflicts.length > 0 && (
              <div className="mt-3 rounded-xl border border-danger/30 bg-danger/5 p-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-danger"><AlertTriangle size={12} /> {conflicts.length} sync conflict{conflicts.length === 1 ? '' : 's'}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-muted">
                  These changes were rejected by the server because newer data already existed. Nothing was overwritten.
                </p>
                <ul className="mt-1.5 space-y-1">
                  {conflicts.slice(0, 4).map((conflict) => (
                    <li key={conflict.id} className="text-[10px] text-muted">
                      {conflict.table} · {conflict.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Backup & restore" subtitle="JSON export of your own records only">
          <div className="flex flex-wrap gap-2">
            <Button icon={Download} loading={exporting} onClick={() => void exportBackup()}>Export JSON</Button>
            <Button icon={Upload} onClick={() => fileRef.current?.click()}>Import JSON</Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void pickFile(file); e.currentTarget.value = ''; }}
            />
          </div>
          <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-muted">
            <p><span className="text-ink">JSON export</span> — portable copy of tasks, timetable, sections, learning records, pathways, flashcards, challenges, diary, goals, resources and integration activity. Enables migration and restore.</p>
            <p><span className="text-ink">Database backups</span> — Supabase performs infrastructure backups for disaster recovery; they are not user-portable and cannot restore a single record.</p>
            <p>OAuth tokens, integration secrets and audit logs are never included.</p>
          </div>
        </Card>

        <Card title="Account" subtitle="Your identity and data">
          <dl className="space-y-2 text-[11px]">
            <div className="flex justify-between"><dt className="text-muted">Signed in as</dt><dd className="text-ink">{profile?.email}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Role</dt><dd className="text-ink">{isAdmin ? 'Administrator' : 'User'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Member since</dt><dd className="text-ink">{profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}</dd></div>
          </dl>
          <div className="mt-3">
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => {
                if (isAdmin) {
                  toast.error('The administrator account cannot be deleted from inside the app.');
                  return;
                }
                setConfirmDelete(true);
              }}
            >
              Delete my account
            </Button>
            <p className="mt-2 text-[10px] leading-relaxed text-muted">
              Deleting removes your profile and every record you own. The administrator account is protected.
            </p>
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="Offline queue" subtitle="Ordered mutations waiting for the server">
        <div className="flex items-center gap-3">
          <Progress value={pending === 0 ? 100 : 40} tone={state === 'error' ? 'danger' : pending ? 'warn' : 'ok'} />
          <span className="shrink-0 text-[10px] text-muted">{pending === 0 ? 'all synced' : `${pending} queued`}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" icon={RefreshCw} onClick={() => { void flushOutbox().then(() => toast.success('Queue flushed.')); }}>Flush queue</Button>
          <Button size="sm" variant="ghost" icon={Database} onClick={() => { void clearCache(); toast.success('Local cache cleared. Reload to refetch.'); }}>Clear cache</Button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted">
          A record is never shown as synchronised until the server confirms it. Rejected changes are listed above as
          conflicts rather than silently overwriting newer data.
        </p>
      </Card>

      <Modal
        open={Boolean(importPreview)}
        onClose={() => setImportPreview(null)}
        title="Import backup"
        description="Validated before anything is written"
        footer={
          <>
            <Button onClick={() => setImportPreview(null)}>Cancel</Button>
            <Button variant="primary" loading={importing} onClick={() => (importMode === 'replace' ? setConfirmReplace(true) : void runImport())}>
              Import
            </Button>
          </>
        }
      >
        {importPreview && (
          <div className="space-y-3">
            {importPreview.errors.length > 0 && (
              <div className="rounded-xl border border-danger/30 bg-danger/5 p-2.5 text-[11px] text-danger">
                {importPreview.errors.map((error) => <p key={error}>· {error}</p>)}
              </div>
            )}
            <div className="rounded-xl border border-line/60 p-2.5">
              <p className="text-[11px] font-medium text-ink">Contents</p>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted">
                {Object.entries(importPreview.counts).map(([table, count]) => (
                  <span key={table}>{table}: <span className="text-ink">{count}</span></span>
                ))}
              </div>
            </div>
            <Field label="Import mode">
              <Select value={importMode} onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}>
                <option value="merge">Merge — keep existing records, add imported ones</option>
                <option value="replace">Replace — delete my current records first</option>
              </Select>
            </Field>
            {importMode === 'replace' && (
              <p className="rounded-xl border border-warn/30 bg-warn/5 p-2.5 text-[11px] leading-relaxed text-warn">
                Replace deletes your existing tasks, records, diary, decks and challenges (including ones not in this
                file) before importing. This cannot be undone.
              </p>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmReplace}
        title="Replace all records?"
        message="Your current tasks, learning records, diary entries, flashcards, challenges and goals will be deleted, then the backup will be imported. Integration connections stay intact."
        confirmLabel="Replace and import"
        destructive
        busy={importing}
        onCancel={() => setConfirmReplace(false)}
        onConfirm={async () => { setConfirmReplace(false); await runImport(); }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete your account"
        message="This permanently removes your account and every record you own. You will be signed out. This cannot be undone."
        confirmLabel="Delete permanently"
        destructive
        busy={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void removeAccount()}
      />

      {state === 'error' && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-danger"><ShieldAlert size={12} /> Some queued changes were rejected. Review conflicts above.</p>
      )}
      <p className={clsx('mt-4 text-[10px]', 'text-muted/60')}>LIFE OS v1.0 · PWA · {online ? 'online' : 'offline'}</p>
    </div>
  );
}
