import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check, Clock, Pencil, Sun, NotebookPen, Plus, Route as RouteIcon } from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { insertRow, updateRow } from '@/lib/api';
import { rpc } from '@/lib/api';
import {
  Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Progress, Textarea, useToast,
} from '@/components/ui';
import { QuickAdd } from '@/components/TaskModal';
import { todayTimetable } from '@/lib/analytics';
import { isoDate, prettyDate, timeLabel, todayISO } from '@/lib/utils';
import type {
  DailyProgress, DiaryEntry, LearningPathNode, Task, TimetableEntry,
} from '@/lib/types';

const STAGES = [
  { stage: 1 as const, label: 'I started today' },
  { stage: 2 as const, label: 'Today I learned something' },
  { stage: 3 as const, label: 'I practiced what I learned' },
];

export default function MyDay() {
  const { user } = useAuth();
  const toast = useToast();
  const today = todayISO();
  const { data: tasks, reload } = useCollection<Task>('tasks', 'created_at', false);
  const { data: entries, reload: reloadEntries } = useCollection<TimetableEntry>('timetable_entries', 'day_date', false);
  const { data: nodes, reload: reloadNodes } = useCollection<LearningPathNode>('learning_path_nodes', 'node_date', false);
  const { data: progress, reload: reloadProgress } = useCollection<DailyProgress>('learning_daily_progress', 'completed_at', false);
  const { data: diary, reload: reloadDiary } = useCollection<DiaryEntry>('diary_entries', 'entry_date', false);

  const [slotOpen, setSlotOpen] = useState(false);
  const [slot, setSlot] = useState({ start: '09:00', end: '10:30', title: '', description: '' });
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [savingDiary, setSavingDiary] = useState(false);
  const [busyStage, setBusyStage] = useState<number | null>(null);

  const todayTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.deleted_at && (t.due_date === today || t.completed_at?.slice(0, 10) === today))
        .sort((a, b) => a.status.localeCompare(b.status)),
    [tasks, today],
  );
  const doneCount = todayTasks.filter((t) => t.status === 'completed').length;
  const schedule = useMemo(() => todayTimetable(entries, today), [entries, today]);
  const todayNode = nodes.find((n) => n.node_date === today);
  const todayStages = progress.filter((p) => p.node_id === todayNode?.id).map((p) => p.stage);
  const todayDiary = diary.find((d) => d.entry_date === today && !d.deleted_at);

  const unscheduled = todayTasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' && !schedule.some((s) => s.task_id === t.id),
  );

  const completeStage = async (stage: 1 | 2 | 3) => {
    if (!user) return;
    setBusyStage(stage);
    try {
      await rpc('advance_learning_path', {
        p_stages: [stage],
        p_evidence: null,
        p_verified: false,
        p_timezone: 'Asia/Kolkata',
      });
      reloadNodes();
      reloadProgress();
      toast.success(`Stage ${stage} recorded.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record stage.');
    } finally {
      setBusyStage(null);
    }
  };

  const toggleTask = async (task: Task) => {
    const completed = task.status === 'completed';
    await updateRow(
      'tasks',
      task.id,
      { status: completed ? 'not_started' : 'completed', completed_at: completed ? null : new Date().toISOString() },
      task.version,
    );
    reload();
  };

  const addSlot = async () => {
    if (!user || !slot.title.trim()) return;
    if (slot.end <= slot.start) {
      toast.error('End time must be after the start time.');
      return;
    }
    const clash = schedule.some((s) => slot.start < s.end_time && slot.end > s.start_time);
    if (clash) {
      toast.error('That time overlaps an existing slot.');
      return;
    }
    try {
      await insertRow('timetable_entries', {
        user_id: user.id,
        day_date: today,
        start_time: slot.start,
        end_time: slot.end,
        title: slot.title.trim(),
        description: slot.description.trim() || null,
        recurrence: { type: 'none' },
      });
      setSlotOpen(false);
      setSlot({ start: '09:00', end: '10:30', title: '', description: '' });
      reloadEntries();
      toast.success('Time block added.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the block.');
    }
  };

  const saveDiary = async () => {
    if (!user || !draft.trim()) return;
    setSavingDiary(true);
    try {
      if (todayDiary) {
        await updateRow('diary_entries', todayDiary.id, { content_md: draft, title: todayDiary.title }, todayDiary.version);
      } else {
        await insertRow('diary_entries', {
          user_id: user.id,
          entry_date: today,
          title: `Entry for ${today}`,
          content_md: draft,
          tags: [],
          links: [],
        });
      }
      setDiaryOpen(false);
      setDraft('');
      reloadDiary();
      toast.success('Diary entry saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the entry.');
    } finally {
      setSavingDiary(false);
    }
  };

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  return (
    <div>
      <PageHeader
        eyebrow={prettyDate(today, 'EEEE')}
        title="My Day"
        description={`${prettyDate(today)} · a single view of everything scheduled for today.`}
        actions={
          <>
            <Button icon={Plus} onClick={() => setSlotOpen(true)}>Time block</Button>
            <Button variant="primary" icon={NotebookPen} onClick={() => { setDraft(todayDiary?.content_md ?? ''); setDiaryOpen(true); }}>
              {todayDiary ? 'Edit diary' : 'Quick diary'}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4">
          <Card
            title="Today's tasks"
            subtitle={`${doneCount}/${todayTasks.length} complete`}
            actions={<Link to="/tasks" className="text-[11px] text-accent hover:underline">All tasks</Link>}
          >
            <div className="mb-3"><QuickAdd onCreated={reload} /></div>
            {todayTasks.length > 0 && <div className="mb-3"><Progress value={(doneCount / Math.max(todayTasks.length, 1)) * 100} tone={doneCount === todayTasks.length ? 'ok' : 'accent'} /></div>}
            {todayTasks.length === 0 ? (
              <EmptyState icon={Sun} title="A clear day" description="Add your first task for today above." />
            ) : (
              <ul className="space-y-1.5">
                {todayTasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-2.5 rounded-lg border border-line/50 px-2.5 py-2">
                    <button
                      onClick={() => void toggleTask(task)}
                      aria-label={task.status === 'completed' ? 'Reopen' : 'Complete'}
                      className={clsx(
                        'grid h-5 w-5 place-items-center rounded-full border',
                        task.status === 'completed' ? 'border-ok bg-ok/80 text-white' : 'border-line hover:border-accent',
                      )}
                    >
                      {task.status === 'completed' && <Check size={12} />}
                    </button>
                    <span className={clsx('flex-1 truncate text-sm', task.status === 'completed' && 'text-muted line-through')}>{task.title}</span>
                    <Badge tone={task.priority === 'critical' ? 'danger' : task.priority === 'high' ? 'warn' : 'neutral'}>{task.priority}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Today's timetable"
            subtitle={schedule.length ? `${schedule.length} blocks` : 'No blocks yet'}
            actions={<Link to="/timetable" className="text-[11px] text-accent hover:underline">Open timetable</Link>}
          >
            {schedule.length === 0 ? (
              <EmptyState icon={CalendarClock} title="No time blocks" description="Block your day so your schedule can be verified against it." action={<Button onClick={() => setSlotOpen(true)} icon={Plus}>Add time block</Button>} />
            ) : (
              <ol className="relative space-y-2 border-l border-line/70 pl-4">
                {schedule.map((entry) => {
                  const [h, m] = entry.start_time.split(':').map(Number);
                  const [eh, em] = entry.end_time.split(':').map(Number);
                  const isNow = nowMinutes >= h * 60 + m && nowMinutes < eh * 60 + em;
                  return (
                    <li key={entry.id} className="relative">
                      <span className={clsx('absolute -left-[22px] top-2.5 h-2.5 w-2.5 rounded-full border-2', isNow ? 'border-accent bg-accent' : 'border-line bg-surface')} />
                      <div className={clsx('rounded-lg border px-3 py-2', isNow ? 'border-accent/40 bg-accent/5' : 'border-line/50')}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm text-ink">{entry.title}</p>
                          <span className="flex items-center gap-1 text-[11px] text-muted">
                            <Clock size={10} /> {timeLabel(entry.start_time)}–{timeLabel(entry.end_time)}
                          </span>
                        </div>
                        {entry.description && <p className="mt-0.5 text-[11px] text-muted">{entry.description}</p>}
                        {isNow && <Badge tone="accent" className="mt-1.5">in progress now</Badge>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Learning pathway" subtitle="Today's three stages" actions={<Link to="/paths" className="text-[11px] text-accent hover:underline">Pathways</Link>}>
            <div className="space-y-2">
              {STAGES.map((item) => {
                const complete = todayStages.includes(item.stage);
                return (
                  <div key={item.stage} className="flex items-center justify-between gap-3 rounded-lg border border-line/60 px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <span className={clsx('grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold', complete ? 'bg-ok/20 text-ok' : 'bg-raised text-muted')}>
                        {item.stage}
                      </span>
                      <span className={clsx('text-xs', complete ? 'text-muted line-through' : 'text-ink')}>{item.label}</span>
                    </div>
                    {complete ? (
                      <Badge tone="ok"><Check size={10} /> done</Badge>
                    ) : (
                      <Button size="sm" loading={busyStage === item.stage} onClick={() => void completeStage(item.stage)}>Mark</Button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
              <RouteIcon size={12} className="text-accent" />
              {todayNode ? `Node #${todayNode.seq_number} · ${todayNode.verified ? 'verified activity' : 'manual progress'}` : 'No node recorded for today yet.'}
            </div>
          </Card>

          <Card title="Quick diary" subtitle={todayDiary ? 'Saved for today — tap to edit' : 'Capture the day while it is fresh'}>
            {todayDiary ? (
              <button onClick={() => { setDraft(todayDiary.content_md); setDiaryOpen(true); }} className="w-full text-left">
                <p className="line-clamp-5 whitespace-pre-wrap text-xs leading-relaxed text-muted">{todayDiary.content_md}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent"><Pencil size={11} /> Edit entry</span>
              </button>
            ) : (
              <button onClick={() => { setDraft(''); setDiaryOpen(true); }} className="w-full rounded-lg border border-dashed border-line/80 px-3 py-6 text-xs text-muted hover:border-accent/40">
                Write a few lines about today…
              </button>
            )}
          </Card>

          <Card title="Unscheduled tasks" subtitle="Not attached to any time block today">
            {unscheduled.length === 0 ? (
              <p className="text-xs text-muted">Every open task is inside a time block.</p>
            ) : (
              <ul className="space-y-1.5">
                {unscheduled.slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-ink">{t.title}</span>
                    <Link to="/timetable" className="shrink-0 text-[11px] text-accent hover:underline">Schedule</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={slotOpen}
        onClose={() => setSlotOpen(false)}
        title="Add time block"
        description={`${prettyDate(today)} · overlaps are rejected`}
        footer={
          <>
            <Button onClick={() => setSlotOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void addSlot()}>Add block</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Activity"><Input value={slot.title} onChange={(e) => setSlot({ ...slot, title: e.target.value })} placeholder="e.g. Deep work: Python" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><Input type="time" value={slot.start} onChange={(e) => setSlot({ ...slot, start: e.target.value })} /></Field>
            <Field label="End"><Input type="time" value={slot.end} onChange={(e) => setSlot({ ...slot, end: e.target.value })} /></Field>
          </div>
          <Field label="Description"><Textarea value={slot.description} onChange={(e) => setSlot({ ...slot, description: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal
        open={diaryOpen}
        onClose={() => setDiaryOpen(false)}
        title="Diary"
        description={`${prettyDate(today)} · private to you`}
        wide
        footer={
          <>
            <Button onClick={() => setDiaryOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={savingDiary} onClick={() => void saveDiary()}>Save entry</Button>
          </>
        }
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What happened today? Markdown supported."
          className="min-h-[240px] font-mono text-xs"
        />
      </Modal>
    </div>
  );
}
