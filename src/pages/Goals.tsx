import { useMemo, useState } from 'react';
import { Target, Plus, Trash2, Pencil, Check, Flag, CalendarDays } from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { deleteRow, insertRow, updateRow } from '@/lib/api';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, Modal,
  PageHeader, Progress, Select, Tabs, Textarea, useToast,
} from '@/components/ui';
import { prettyDate, todayISO } from '@/lib/utils';
import type { Goal, Milestone } from '@/lib/types';

interface GoalForm {
  name: string;
  description: string;
  category: string;
  start_date: string;
  target_date: string;
  progress: number;
  status: Goal['status'];
}

const blank = (): GoalForm => ({
  name: '',
  description: '',
  category: '',
  start_date: todayISO(),
  target_date: '',
  progress: 0,
  status: 'active',
});

export default function Goals() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: goals, loading, reload } = useCollection<Goal>('goals', 'created_at', false);
  const { data: milestones, reload: reloadMilestones } = useCollection<Milestone>('goal_milestones', 'sort_order', true);

  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [form, setForm] = useState<GoalForm>(blank());
  const [deleting, setDeleting] = useState<Goal | null>(null);
  const [milestoneFor, setMilestoneFor] = useState<Goal | null>(null);
  const [milestoneForm, setMilestoneForm] = useState({ title: '', due_date: '' });
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () => goals.filter((g) => (filter === 'all' ? true : filter === 'active' ? g.status === 'active' : g.status === 'completed')),
    [goals, filter],
  );

  const openGoal = (goal?: Goal) => {
    setEditing(goal ?? null);
    setForm(
      goal
        ? {
            name: goal.name,
            description: goal.description ?? '',
            category: goal.category ?? '',
            start_date: goal.start_date ?? '',
            target_date: goal.target_date ?? '',
            progress: goal.progress,
            status: goal.status,
          }
        : blank(),
    );
    setOpen(true);
  };

  const save = async () => {
    if (!user || !form.name.trim()) return;
    setBusy(true);
    try {
      const payload = {
        user_id: user.id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        start_date: form.start_date || null,
        target_date: form.target_date || null,
        progress: Math.max(0, Math.min(100, Number(form.progress) || 0)),
        status: form.status,
      };
      if (editing) {
        await updateRow('goals', editing.id, payload, editing.version);
        toast.success('Goal updated.');
      } else {
        await insertRow('goals', payload);
        toast.success('Goal created.');
      }
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the goal.');
    } finally {
      setBusy(false);
    }
  };

  const setProgress = async (goal: Goal, progress: number) => {
    const clamped = Math.max(0, Math.min(100, progress));
    await updateRow('goals', goal.id, {
      progress: clamped,
      status: clamped === 100 ? 'completed' : goal.status === 'completed' ? 'active' : goal.status,
    }, goal.version);
    reload();
  };

  const toggleMilestone = async (milestone: Milestone) => {
    await updateRow('goal_milestones', milestone.id, {
      completed_at: milestone.completed_at ? null : new Date().toISOString(),
    });
    // Recompute progress from milestones when any exist.
    const goalMilestones = milestones.filter((m) => m.goal_id === milestone.goal_id);
    const completed = goalMilestones.filter((m) => (m.id === milestone.id ? !milestone.completed_at : m.completed_at)).length;
    const goal = goals.find((g) => g.id === milestone.goal_id);
    if (goal && goalMilestones.length) {
      const progress = Math.round((completed / goalMilestones.length) * 100);
      await updateRow('goals', goal.id, { progress, status: progress === 100 ? 'completed' : 'active' }, goal.version);
      reload();
    }
    reloadMilestones();
  };

  const addMilestone = async () => {
    if (!user || !milestoneFor || !milestoneForm.title.trim()) return;
    setBusy(true);
    try {
      await insertRow('goal_milestones', {
        user_id: user.id,
        goal_id: milestoneFor.id,
        title: milestoneForm.title.trim(),
        due_date: milestoneForm.due_date || null,
        sort_order: milestones.filter((m) => m.goal_id === milestoneFor.id).length + 1,
      });
      toast.success('Milestone added.');
      setMilestoneForm({ title: '', due_date: '' });
      reloadMilestones();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the milestone.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteRow('goals', deleting.id);
      toast.success('Goal deleted.');
      setDeleting(null);
      reload();
      reloadMilestones();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the goal.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        eyebrow="Direction"
        title="Goals"
        description="Long-term targets with measurable progress. Progress is whatever you record — it is not estimated for you."
        actions={<Button variant="primary" icon={Plus} onClick={() => openGoal()}>New goal</Button>}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onChange={setFilter} items={[
          { value: 'all', label: 'All', badge: goals.length },
          { value: 'active', label: 'Active', badge: goals.filter((g) => g.status === 'active').length },
          { value: 'completed', label: 'Completed', badge: goals.filter((g) => g.status === 'completed').length },
        ]} />
        <p className="text-[11px] text-muted">
          {goals.length ? `${Math.round(goals.reduce((s, g) => s + g.progress, 0) / goals.length)}% average progress` : 'No goals yet'}
        </p>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={Target} title="No goals here" description="Define a target you can measure — a certification, a project, a habit." action={<Button variant="primary" icon={Plus} onClick={() => openGoal()}>Create a goal</Button>} />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((goal) => {
            const goalMilestones = milestones.filter((m) => m.goal_id === goal.id).sort((a, b) => a.sort_order - b.sort_order);
            const done = goalMilestones.filter((m) => m.completed_at).length;
            const overdue = goal.target_date && goal.target_date < todayISO() && goal.status === 'active';
            return (
              <Card key={goal.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">{goal.name}</h3>
                      <Badge tone={goal.status === 'completed' ? 'ok' : goal.status === 'paused' ? 'warn' : goal.status === 'abandoned' ? 'danger' : 'accent'}>
                        {goal.status}
                      </Badge>
                      {goal.category && <Badge>{goal.category}</Badge>}
                      {overdue && <Badge tone="danger">past target date</Badge>}
                    </div>
                    {goal.description && <p className="mt-1 text-xs leading-relaxed text-muted">{goal.description}</p>}
                    <p className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                      <CalendarDays size={10} />
                      {goal.start_date ? prettyDate(goal.start_date, 'd MMM yyyy') : '—'} → {goal.target_date ? prettyDate(goal.target_date, 'd MMM yyyy') : 'open'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button onClick={() => openGoal(goal)} className="btn btn-ghost !p-1.5 text-muted" aria-label="Edit goal"><Pencil size={13} /></button>
                    <button onClick={() => setDeleting(goal)} className="btn btn-ghost !p-1.5 text-muted hover:text-danger" aria-label="Delete goal"><Trash2 size={13} /></button>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-muted">Progress</span>
                    <span className="text-ink">{goal.progress}%</span>
                  </div>
                  <Progress value={goal.progress} tone={goal.progress === 100 ? 'ok' : 'accent'} />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={goal.progress}
                    onChange={(e) => void setProgress(goal, Number(e.target.value))}
                    className="mt-2 w-full accent-[rgb(var(--c-accent))]"
                    aria-label={`Progress for ${goal.name}`}
                  />
                </div>

                <div className="mt-3 border-t border-line/50 pt-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-wider text-muted">Milestones ({done}/{goalMilestones.length})</p>
                    <button onClick={() => setMilestoneFor(goal)} className="text-[10px] text-accent hover:underline">add</button>
                  </div>
                  {goalMilestones.length === 0 ? (
                    <p className="text-[11px] text-muted">No milestones — break the goal into checkpoints.</p>
                  ) : (
                    <ul className="space-y-1">
                      {goalMilestones.map((milestone) => (
                        <li key={milestone.id} className="flex items-center gap-2">
                          <button
                            onClick={() => void toggleMilestone(milestone)}
                            aria-label={milestone.completed_at ? 'Mark incomplete' : 'Mark complete'}
                            className={clsx(
                              'grid h-4 w-4 shrink-0 place-items-center rounded border',
                              milestone.completed_at ? 'border-ok bg-ok/70 text-white' : 'border-line hover:border-accent',
                            )}
                          >
                            {milestone.completed_at && <Check size={9} />}
                          </button>
                          <span className={clsx('flex-1 text-[11px]', milestone.completed_at ? 'text-muted line-through' : 'text-ink')}>
                            {milestone.title}
                          </span>
                          {milestone.due_date && <span className="text-[9px] text-muted">{prettyDate(milestone.due_date, 'd MMM')}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit goal' : 'New goal'}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}
      >
        <div className="space-y-3">
          <Field label="Goal name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Earn eJPT certification" /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category"><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Career, health…" /></Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Goal['status'] })}>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="paused">Paused</option>
                <option value="abandoned">Abandoned</option>
              </Select>
            </Field>
            <Field label="Start date"><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></Field>
            <Field label="Target date"><Input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /></Field>
            <Field label="Progress %" className="col-span-2">
              <Input type="number" min={0} max={100} value={form.progress} onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })} />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(milestoneFor)}
        onClose={() => setMilestoneFor(null)}
        title={`Milestones · ${milestoneFor?.name ?? ''}`}
        description="Toggle existing milestones to update progress automatically."
        footer={<Button onClick={() => setMilestoneFor(null)}>Done</Button>}
      >
        <div className="space-y-3">
          <ul className="space-y-1">
            {milestones.filter((m) => m.goal_id === milestoneFor?.id).map((milestone) => (
              <li key={milestone.id} className="flex items-center gap-2 rounded-lg border border-line/60 px-2 py-1.5">
                <button
                  onClick={() => void toggleMilestone(milestone)}
                  className={clsx('grid h-4 w-4 place-items-center rounded border', milestone.completed_at ? 'border-ok bg-ok/70 text-white' : 'border-line')}
                  aria-label="Toggle milestone"
                >
                  {milestone.completed_at && <Check size={9} />}
                </button>
                <span className={clsx('flex-1 text-[11px]', milestone.completed_at ? 'text-muted line-through' : 'text-ink')}>{milestone.title}</span>
                <button
                  onClick={async () => { await deleteRow('goal_milestones', milestone.id); reloadMilestones(); }}
                  className="text-muted hover:text-danger"
                  aria-label="Delete milestone"
                >
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-[1fr_130px] gap-2">
            <Input placeholder="New milestone" value={milestoneForm.title} onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })} />
            <Input type="date" value={milestoneForm.due_date} onChange={(e) => setMilestoneForm({ ...milestoneForm, due_date: e.target.value })} />
          </div>
          <Button icon={Flag} loading={busy} onClick={() => void addMilestone()}>Add milestone</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete goal"
        message={`"${deleting?.name ?? ''}" and its milestones will be removed.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
