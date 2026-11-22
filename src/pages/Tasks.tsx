import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Check, RotateCcw, Pencil, Trash2, ExternalLink, CalendarDays, Flag, AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import { deleteRow, updateRow } from '@/lib/api';
import { useToast } from '@/components/ui';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, LoadingBlock, PageHeader, SearchInput, Tabs,
} from '@/components/ui';
import { TaskModal, QuickAdd } from '@/components/TaskModal';
import { addDays, isoDate, prettyDate, safeUrl, todayISO } from '@/lib/utils';
import type { Section, Task, Topic } from '@/lib/types';

type View = 'today' | 'tomorrow' | 'week' | 'upcoming' | 'overdue' | 'completed' | 'all';

const PRIORITY_TONE = {
  critical: 'danger',
  high: 'warn',
  medium: 'info',
  low: 'neutral',
} as const;

export default function Tasks() {
  const toast = useToast();
  const [params] = useSearchParams();
  const { data: tasks, loading, error, reload } = useCollection<Task>('tasks', 'created_at', false);
  const { data: sections } = useCollection<Section>('sections', 'sort_order', true);
  const { data: topics } = useCollection<Topic>('topics', 'sort_order', true);

  const [view, setView] = useState<View>('today');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [priority, setPriority] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);

  const today = todayISO();
  const active = useMemo(() => tasks.filter((t) => !t.deleted_at), [tasks]);

  const scoped = useMemo(() => {
    const endOfWeek = addDays(today, 7 - new Date().getDay());
    return active.filter((t) => {
      const open = t.status !== 'completed' && t.status !== 'cancelled';
      if (view === 'today') return t.due_date === today;
      if (view === 'tomorrow') return t.due_date === addDays(today, 1);
      if (view === 'week') return t.due_date && t.due_date >= today && t.due_date <= endOfWeek;
      if (view === 'upcoming') return t.due_date && t.due_date > today && open;
      if (view === 'overdue') return Boolean(t.due_date && t.due_date < today && open);
      if (view === 'completed') return t.status === 'completed';
      return true;
    });
  }, [active, view, today]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return scoped
      .filter((t) => (priority ? t.priority === priority : true))
      .filter((t) => (sectionFilter ? t.section_id === sectionFilter : true))
      .filter((t) =>
        term
          ? [t.title, t.description, t.notes, ...(t.tags ?? [])]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(term))
          : true,
      )
      .sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
        if (a.status === 'completed' && b.status !== 'completed') return 1;
        if (b.status === 'completed' && a.status !== 'completed') return -1;
        if (a.due_date !== b.due_date) return (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999');
        if (a.priority !== b.priority) return order[a.priority] - order[b.priority];
        return b.created_at.localeCompare(a.created_at);
      });
  }, [scoped, query, priority, sectionFilter]);

  const counts = useMemo(
    () => ({
      today: active.filter((t) => t.due_date === today).length,
      overdue: active.filter(
        (t) => t.due_date && t.due_date < today && t.status !== 'completed' && t.status !== 'cancelled',
      ).length,
      completed: active.filter((t) => t.status === 'completed').length,
    }),
    [active, today],
  );

  const toggleComplete = async (task: Task) => {
    const completed = task.status === 'completed';
    try {
      await updateRow(
        'tasks',
        task.id,
        {
          status: completed ? 'not_started' : 'completed',
          completed_at: completed ? null : new Date().toISOString(),
        },
        task.version,
      );
      toast.success(completed ? 'Task reopened.' : 'Task completed.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update task.');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteRow('tasks', deleting.id, true);
      toast.success('Task deleted.');
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete task.');
    } finally {
      setBusy(false);
    }
  };

  const sectionName = (id: string | null) => sections.find((s) => s.id === id)?.name;

  return (
    <div>
      <PageHeader
        eyebrow="Execution"
        title="Tasks"
        description="Everything you owe your future self, with completion timestamps that feed your analytics."
        actions={
          <Button
            variant="primary"
            icon={Plus}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            New task
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card flex items-center gap-3 p-3.5">
          <CalendarDays size={16} className="text-accent" />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted">Due today</p>
            <p className="text-lg font-semibold text-ink">{counts.today}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-3.5">
          <AlertCircle size={16} className="text-danger" />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted">Overdue</p>
            <p className="text-lg font-semibold text-ink">{counts.overdue}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 p-3.5">
          <Check size={16} className="text-ok" />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted">Completed</p>
            <p className="text-lg font-semibold text-ink">{counts.completed}</p>
          </div>
        </div>
      </div>

      <Card padded={false} className="mb-4">
        <div className="space-y-3 p-3 sm:p-4">
          <QuickAdd onCreated={reload} placeholder="Quick add a task for today…" />
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { value: 'today', label: 'Today' },
              { value: 'tomorrow', label: 'Tomorrow' },
              { value: 'week', label: 'This week' },
              { value: 'upcoming', label: 'Upcoming' },
              { value: 'overdue', label: 'Overdue' },
              { value: 'completed', label: 'Completed' },
              { value: 'all', label: 'All' },
            ]}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchInput value={query} onChange={setQuery} placeholder="Search title, notes or tags…" className="flex-1" />
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="input sm:w-40">
              <option value="">All priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} className="input sm:w-48">
              <option value="">All sections</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {loading && <LoadingBlock />}
      {error && !loading && (
        <Card>
          <EmptyState title="Could not load tasks" description={error} action={<Button onClick={reload}>Retry</Button>} />
        </Card>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Card>
          <EmptyState
            icon={Check}
            title="Nothing here"
            description="This view is empty. Add a task or change the filter."
            action={<Button variant="primary" icon={Plus} onClick={() => { setEditing(null); setModalOpen(true); }}>New task</Button>}
          />
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map((task) => {
          const done = task.status === 'completed';
          const overdue =
            Boolean(task.due_date && task.due_date < today) && !done && task.status !== 'cancelled';
          return (
            <article
              key={task.id}
              className={clsx(
                'group flex items-start gap-3 rounded-xl border border-line/70 bg-surface/70 p-3 transition hover:border-accent/30',
                done && 'opacity-60',
              )}
            >
              <button
                onClick={() => void toggleComplete(task)}
                aria-label={done ? 'Reopen task' : 'Complete task'}
                className={clsx(
                  'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition',
                  done ? 'border-ok bg-ok/80 text-white' : 'border-line hover:border-accent',
                )}
              >
                {done ? <Check size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-muted/40 group-hover:bg-accent" />}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={clsx('text-sm font-medium text-ink', done && 'line-through')}>{task.title}</p>
                  <Badge tone={PRIORITY_TONE[task.priority]}>
                    <Flag size={9} /> {task.priority}
                  </Badge>
                  {task.status === 'in_progress' && <Badge tone="info">in progress</Badge>}
                  {task.status === 'cancelled' && <Badge tone="neutral">cancelled</Badge>}
                  {overdue && <Badge tone="danger">overdue</Badge>}
                  {sectionName(task.section_id) && <Badge>{sectionName(task.section_id)}</Badge>}
                </div>
                {task.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{task.description}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                  {task.due_date && (
                    <span className={clsx(overdue && 'text-danger')}>
                      {prettyDate(task.due_date, 'EEE, d MMM')}
                      {task.due_time ? ` · ${task.due_time.slice(0, 5)}` : ''}
                    </span>
                  )}
                  {task.completed_at && <span className="text-ok">completed {prettyDate(task.completed_at, 'd MMM HH:mm')}</span>}
                  {(task.tags ?? []).map((tag) => (
                    <span key={tag} className="chip">#{tag}</span>
                  ))}
                  {(task.links ?? []).map((link, i) => {
                    const url = safeUrl(link.url);
                    return url ? (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent2 hover:underline">
                        <ExternalLink size={10} /> {link.label || 'link'}
                      </a>
                    ) : null;
                  })}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  onClick={() => {
                    setEditing(task);
                    setModalOpen(true);
                  }}
                  className="btn btn-ghost !p-1.5 text-muted"
                  aria-label="Edit task"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => setDeleting(task)}
                  className="btn btn-ghost !p-1.5 text-muted hover:text-danger"
                  aria-label="Delete task"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <TaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        task={editing}
        defaultDate={view === 'tomorrow' ? addDays(today, 1) : isoDate(new Date())}
        sections={sections}
        topics={topics}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete task"
        message={`"${deleting?.title ?? ''}" will be removed from your task list. Analytics history for this task will no longer include it.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
