import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Plus, Trash2, Pencil, Repeat, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { insertRow, deleteRow, updateRow } from '@/lib/api';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, Modal,
  PageHeader, Select, Tabs, Textarea, useToast,
} from '@/components/ui';
import { addDays, minutesBetween, prettyDate, timeLabel, todayISO } from '@/lib/utils';
import type { Section, Task, TimetableEntry } from '@/lib/types';

interface SlotForm {
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  task_id: string;
  section_id: string;
  reminder_at: string;
  repeat: 'none' | 'daily' | 'weekly';
  until: string;
}

const blank = (): SlotForm => ({
  title: '',
  description: '',
  start_time: '09:00',
  end_time: '10:00',
  task_id: '',
  section_id: '',
  reminder_at: '',
  repeat: 'none',
  until: addDays(todayISO(), 7),
});

export default function Timetable() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: entries, loading, reload } = useCollection<TimetableEntry>('timetable_entries', 'day_date', false);
  const { data: tasks } = useCollection<Task>('tasks', 'due_date', true);
  const { data: sections } = useCollection<Section>('sections', 'sort_order', true);

  const [date, setDate] = useState(todayISO());
  const [tab, setTab] = useState<'day' | 'week'>('day');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TimetableEntry | null>(null);
  const [form, setForm] = useState<SlotForm>(blank());
  const [deleting, setDeleting] = useState<TimetableEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const active = useMemo(() => entries.filter((e) => !e.deleted_at), [entries]);
  const dayEntries = useMemo(
    () => active.filter((e) => e.day_date === date).sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [active, date],
  );

  const weekDays = useMemo(() => {
    const base = new Date(`${date}T00:00:00`);
    const day = base.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = addDays(date, mondayOffset);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [date]);

  const unscheduled = useMemo(
    () =>
      tasks.filter(
        (t) =>
          !t.deleted_at &&
          t.due_date === date &&
          t.status !== 'completed' &&
          t.status !== 'cancelled' &&
          !dayEntries.some((e) => e.task_id === t.id),
      ),
    [tasks, date, dayEntries],
  );

  const now = new Date();
  const nowLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const openCreate = () => {
    setEditing(null);
    setForm(blank());
    setOpen(true);
  };

  const openEdit = (entry: TimetableEntry) => {
    setEditing(entry);
    setForm({
      title: entry.title,
      description: entry.description ?? '',
      start_time: entry.start_time.slice(0, 5),
      end_time: entry.end_time.slice(0, 5),
      task_id: entry.task_id ?? '',
      section_id: entry.section_id ?? '',
      reminder_at: entry.reminder_at ? entry.reminder_at.slice(0, 16) : '',
      repeat: (entry.recurrence?.type as SlotForm['repeat']) ?? 'none',
      until: entry.recurrence?.until ?? addDays(entry.day_date, 7),
    });
    setOpen(true);
  };

  const validate = (slot: SlotForm, ignoreId?: string): string | null => {
    if (!slot.title.trim()) return 'Give the block an activity name.';
    if (slot.end_time <= slot.start_time) return 'The end time must be after the start time.';
    const clash = active.some(
      (e) =>
        e.day_date === date &&
        e.id !== ignoreId &&
        slot.start_time < e.end_time &&
        slot.end_time > e.start_time,
    );
    if (clash) return 'This block overlaps an existing block on the same day.';
    return null;
  };

  const save = async () => {
    if (!user) return;
    const problem = validate(form, editing?.id);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const base = {
        user_id: user.id,
        day_date: date,
        start_time: form.start_time,
        end_time: form.end_time,
        title: form.title.trim(),
        description: form.description.trim() || null,
        task_id: form.task_id || null,
        section_id: form.section_id || null,
        reminder_at: form.reminder_at ? new Date(form.reminder_at).toISOString() : null,
        recurrence: form.repeat === 'none' ? { type: 'none' } : { type: form.repeat, until: form.until },
      };

      if (editing) {
        await updateRow('timetable_entries', editing.id, base, editing.version);
        toast.success('Time block updated.');
      } else {
        await insertRow('timetable_entries', base);
        if (form.repeat !== 'none') {
          // Materialise the recurrence as individual rows so each day can be
          // edited independently and history stays intact.
          let cursor = addDays(date, form.repeat === 'daily' ? 1 : 7);
          let created = 0;
          while (cursor <= form.until && created < 60) {
            const clash = active.some(
              (e) => e.day_date === cursor && form.start_time < e.end_time && form.end_time > e.start_time,
            );
            if (!clash) {
              await insertRow('timetable_entries', { ...base, day_date: cursor });
              created += 1;
            }
            cursor = addDays(cursor, form.repeat === 'daily' ? 1 : 7);
          }
          toast.success(`Block added with ${created} recurring copies.`);
        } else {
          toast.success('Time block added.');
        }
      }
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the block.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteRow('timetable_entries', deleting.id, true);
      toast.success('Block removed.');
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the block.');
    } finally {
      setBusy(false);
    }
  };

  const assignTask = async (entry: TimetableEntry, taskId: string) => {
    await updateRow('timetable_entries', entry.id, { task_id: taskId || null }, entry.version);
    reload();
  };

  return (
    <div>
      <PageHeader
        eyebrow="Structure"
        title="Timetable"
        description="Build each day deliberately. Overlaps are rejected and every block lives in the database."
        actions={<Button variant="primary" icon={Plus} onClick={openCreate}>New block</Button>}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" onClick={() => setDate(addDays(date, tab === 'day' ? -1 : -7))} aria-label="Previous">
            <ChevronLeft size={16} />
          </Button>
          <button onClick={() => setDate(todayISO())} className="btn !px-3 !py-1.5 text-xs">
            Today
          </button>
          <Button variant="ghost" onClick={() => setDate(addDays(date, tab === 'day' ? 1 : 7))} aria-label="Next">
            <ChevronRight size={16} />
          </Button>
          <span className="ml-1 text-sm text-ink">{prettyDate(date, 'EEEE, d MMMM yyyy')}</span>
        </div>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />
      </div>

      {loading ? (
        <LoadingBlock />
      ) : tab === 'day' ? (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Card title="Timeline" subtitle={`${dayEntries.length} block${dayEntries.length === 1 ? '' : 's'} · ${date === todayISO() ? 'today' : prettyDate(date, 'd MMM')}`}>
            {dayEntries.length === 0 ? (
              <EmptyState icon={Clock} title="The day is open" description="Add time blocks so your schedule is intentional." action={<Button onClick={openCreate} icon={Plus}>Add block</Button>} />
            ) : (
              <div className="relative">
                {date === todayISO() && (
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[10px] font-mono text-accent">{nowLabel}</span>
                    <div className="h-px flex-1 bg-gradient-to-r from-accent/70 to-transparent" />
                    <span className="text-[10px] text-accent">now</span>
                  </div>
                )}
                <ol className="space-y-2">
                  {dayEntries.map((entry) => {
                    const isNow =
                      date === todayISO() && nowLabel >= entry.start_time.slice(0, 5) && nowLabel < entry.end_time.slice(0, 5);
                    return (
                      <li
                        key={entry.id}
                        className={clsx(
                          'group rounded-xl border p-3 transition',
                          isNow ? 'border-accent/50 bg-accent/5' : 'border-line/60 bg-surface/60 hover:border-accent/30',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-ink">{entry.title}</p>
                              {isNow && <Badge tone="accent">now</Badge>}
                              {entry.recurrence?.type !== 'none' && (
                                <Badge tone="info"><Repeat size={9} /> {entry.recurrence?.type}</Badge>
                              )}
                            </div>
                            {entry.description && <p className="mt-1 text-xs text-muted">{entry.description}</p>}
                            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                              <Clock size={10} /> {timeLabel(entry.start_time)}–{timeLabel(entry.end_time)}
                              <span className="text-muted/60">· {minutesBetween(entry.start_time, entry.end_time)} min</span>
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-0.5">
                            <button onClick={() => openEdit(entry)} className="btn btn-ghost !p-1.5 text-muted" aria-label="Edit block">
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => setDeleting(entry)} className="btn btn-ghost !p-1.5 text-muted hover:text-danger" aria-label="Delete block">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider text-muted">Task</span>
                          <select
                            value={entry.task_id ?? ''}
                            onChange={(e) => void assignTask(entry, e.target.value)}
                            className="input !py-1 !text-[11px]"
                          >
                            <option value="">Not linked</option>
                            {tasks
                              .filter((t) => !t.deleted_at && t.status !== 'completed')
                              .map((t) => (
                                <option key={t.id} value={t.id}>{t.title}</option>
                              ))}
                          </select>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <Card title="Unscheduled tasks" subtitle={`Due ${prettyDate(date, 'd MMM')}`}>
              {unscheduled.length === 0 ? (
                <p className="text-xs text-muted">No unassigned tasks for this day.</p>
              ) : (
                <ul className="space-y-1.5">
                  {unscheduled.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-2 rounded-lg border border-warn/20 bg-warn/5 px-2.5 py-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">{task.title}</span>
                      <button
                        onClick={async () => {
                          if (!user) return;
                          await insertRow('timetable_entries', {
                            user_id: user.id,
                            day_date: date,
                            start_time: '09:00',
                            end_time: '09:30',
                            title: task.title,
                            task_id: task.id,
                            recurrence: { type: 'none' },
                          });
                          reload();
                          toast.info('Added a placeholder block — adjust the time.');
                        }}
                        className="shrink-0 text-[10px] text-accent hover:underline"
                      >
                        Schedule
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Day summary">
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between"><dt className="text-muted">Blocks</dt><dd className="text-ink">{dayEntries.length}</dd></div>
                <div className="flex justify-between">
                  <dt className="text-muted">Scheduled minutes</dt>
                  <dd className="text-ink">{dayEntries.reduce((s, e) => s + minutesBetween(e.start_time, e.end_time), 0)}</dd>
                </div>
                <div className="flex justify-between"><dt className="text-muted">Linked tasks</dt><dd className="text-ink">{dayEntries.filter((e) => e.task_id).length}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Unscheduled</dt><dd className={unscheduled.length ? 'text-warn' : 'text-ink'}>{unscheduled.length}</dd></div>
              </dl>
              {unscheduled.length > 0 && (
                <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-warn">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" /> Some tasks due today have no time block.
                </p>
              )}
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
          {weekDays.map((day) => {
            const items = active.filter((e) => e.day_date === day).sort((a, b) => a.start_time.localeCompare(b.start_time));
            return (
              <Card key={day} className={clsx(day === todayISO() && 'border-accent/40')} padded={false}>
                <button onClick={() => { setDate(day); setTab('day'); }} className="w-full px-3 py-2 text-left">
                  <p className="text-[10px] uppercase tracking-wider text-muted">{prettyDate(day, 'EEE')}</p>
                  <p className={clsx('text-sm font-semibold', day === todayISO() ? 'text-accent' : 'text-ink')}>{prettyDate(day, 'd MMM')}</p>
                </button>
                <div className="space-y-1 px-2 pb-2">
                  {items.length === 0 && <p className="px-1 py-2 text-[10px] text-muted">Empty</p>}
                  {items.map((e) => (
                    <div key={e.id} className="rounded-md border border-line/50 px-1.5 py-1">
                      <p className="truncate text-[10px] text-ink">{e.title}</p>
                      <p className="font-mono text-[9px] text-muted">{timeLabel(e.start_time)}</p>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit time block' : 'New time block'}
        description={`${prettyDate(date)} · overlaps are validated`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void save()}>{editing ? 'Save' : 'Add block'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Activity"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Revision: cryptography" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></Field>
            <Field label="End"><Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></Field>
          </div>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[70px]" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Linked task">
              <Select value={form.task_id} onChange={(e) => setForm({ ...form, task_id: e.target.value })}>
                <option value="">Not linked</option>
                {tasks.filter((t) => !t.deleted_at).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </Select>
            </Field>
            <Field label="Section">
              <Select value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value })}>
                <option value="">None</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Reminder">
              <Input type="datetime-local" value={form.reminder_at} onChange={(e) => setForm({ ...form, reminder_at: e.target.value })} />
            </Field>
            {!editing && (
              <>
                <Field label="Repeat">
                  <Select value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value as SlotForm['repeat'] })}>
                    <option value="none">Does not repeat</option>
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                  </Select>
                </Field>
                {form.repeat !== 'none' && (
                  <Field label="Repeat until">
                    <Input type="date" value={form.until} min={date} onChange={(e) => setForm({ ...form, until: e.target.value })} />
                  </Field>
                )}
              </>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Remove time block"
        message={`"${deleting?.title ?? ''}" will be removed from this day.`}
        confirmLabel="Remove"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
