import { useEffect, useState } from 'react';
import { Plus, Trash2, Link2 } from 'lucide-react';
import { Button, Field, Input, Modal, Select, TagInput, Textarea, useToast } from './ui';
import { insertRow, updateRow } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { safeUrl, todayISO } from '@/lib/utils';
import type { Priority, Section, Task, TaskStatus, Topic } from '@/lib/types';

interface TaskForm {
  title: string;
  description: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  due_date: string;
  due_time: string;
  reminder_at: string;
  section_id: string;
  topic_id: string;
  tags: string[];
  links: { label: string; url: string }[];
}

const emptyForm = (dueDate?: string): TaskForm => ({
  title: '',
  description: '',
  notes: '',
  status: 'not_started',
  priority: 'medium',
  due_date: dueDate ?? todayISO(),
  due_time: '',
  reminder_at: '',
  section_id: '',
  topic_id: '',
  tags: [],
  links: [],
});

const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function TaskModal({
  open,
  onClose,
  task,
  defaultDate,
  sections,
  topics,
}: {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaultDate?: string;
  sections: Section[];
  topics: Topic[];
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<TaskForm>(emptyForm(defaultDate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (task) {
      setForm({
        title: task.title,
        description: task.description ?? '',
        notes: task.notes ?? '',
        status: task.status,
        priority: task.priority,
        due_date: task.due_date ?? '',
        due_time: task.due_time?.slice(0, 5) ?? '',
        reminder_at: toLocalInput(task.reminder_at),
        section_id: task.section_id ?? '',
        topic_id: task.topic_id ?? '',
        tags: task.tags ?? [],
        links: task.links ?? [],
      });
    } else {
      setForm(emptyForm(defaultDate));
    }
  }, [open, task, defaultDate]);

  const set = <K extends keyof TaskForm>(key: K, value: TaskForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const availableTopics = topics.filter((t) => !form.section_id || t.section_id === form.section_id);

  const submit = async () => {
    if (!user) return;
    if (!form.title.trim()) {
      setError('A title is required.');
      return;
    }
    const links = form.links
      .map((l) => ({ label: l.label.trim() || l.url, url: safeUrl(l.url) }))
      .filter((l): l is { label: string; url: string } => Boolean(l.url));
    if (form.links.length && links.length !== form.links.length) {
      setError('Links must be valid http(s) URLs.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const completed = form.status === 'completed';
      const payload = {
        user_id: user.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        notes: form.notes.trim() || null,
        status: form.status,
        priority: form.priority,
        due_date: form.due_date || null,
        due_time: form.due_time || null,
        reminder_at: form.reminder_at ? new Date(form.reminder_at).toISOString() : null,
        section_id: form.section_id || null,
        topic_id: form.topic_id || null,
        tags: form.tags,
        links,
        completed_at: completed ? (task?.completed_at ?? new Date().toISOString()) : null,
      };

      if (task) {
        await updateRow('tasks', task.id, payload, task.version);
        toast.success('Task updated.');
      } else {
        await insertRow('tasks', payload);
        toast.success('Task created.');
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the task.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : 'New task'}
      description="Saved to your private workspace and available offline."
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {task ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" error={error ?? undefined}>
          <Input
            autoFocus
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="What needs to happen?"
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Optional context"
            className="min-h-[70px]"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </Field>
          <Field label="Due date">
            <Input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
          </Field>
          <Field label="Due time">
            <Input type="time" value={form.due_time} onChange={(e) => set('due_time', e.target.value)} />
          </Field>
          <Field label="Reminder" hint="Used for browser reminders when enabled in Settings.">
            <Input
              type="datetime-local"
              value={form.reminder_at}
              onChange={(e) => set('reminder_at', e.target.value)}
            />
          </Field>
          <Field label="Reminder offset">
            <Select
              value=""
              onChange={(e) => {
                const hours = Number(e.target.value);
                if (!form.due_date || Number.isNaN(hours)) return;
                const base = new Date(`${form.due_date}T${form.due_time || '09:00'}:00`);
                base.setHours(base.getHours() - hours);
                set('reminder_at', toLocalInput(base.toISOString()));
              }}
            >
              <option value="">Quick fill…</option>
              <option value="0">At due time</option>
              <option value="1">1 hour before</option>
              <option value="3">3 hours before</option>
              <option value="24">1 day before</option>
            </Select>
          </Field>
          <Field label="Section">
            <Select
              value={form.section_id}
              onChange={(e) => {
                set('section_id', e.target.value);
                set('topic_id', '');
              }}
            >
              <option value="">No section</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Topic">
            <Select value={form.topic_id} onChange={(e) => set('topic_id', e.target.value)}>
              <option value="">No topic</option>
              {availableTopics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Tags">
          <TagInput value={form.tags} onChange={(tags) => set('tags', tags)} />
        </Field>

        <div>
          <span className="label">Links</span>
          <div className="space-y-2">
            {form.links.map((link, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  placeholder="Label"
                  value={link.label}
                  onChange={(e) => {
                    const next = [...form.links];
                    next[index] = { ...next[index], label: e.target.value };
                    set('links', next);
                  }}
                  className="max-w-[160px]"
                />
                <Input
                  placeholder="https://…"
                  value={link.url}
                  onChange={(e) => {
                    const next = [...form.links];
                    next[index] = { ...next[index], url: e.target.value };
                    set('links', next);
                  }}
                />
                <Button
                  variant="ghost"
                  onClick={() => set('links', form.links.filter((_, i) => i !== index))}
                  aria-label="Remove link"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={Link2} onClick={() => set('links', [...form.links, { label: '', url: '' }])}>
              Add link
            </Button>
          </div>
        </div>

        <Field label="Notes">
          <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything else…" />
        </Field>
      </div>
    </Modal>
  );
}

export function QuickAdd({
  onCreated,
  placeholder = 'Add a task and press Enter…',
  defaultDate,
}: {
  onCreated?: () => void;
  placeholder?: string;
  defaultDate?: string;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const title = value.trim();
    if (!title || !user) return;
    setBusy(true);
    try {
      await insertRow('tasks', {
        user_id: user.id,
        title,
        status: 'not_started',
        priority: 'medium',
        due_date: defaultDate ?? todayISO(),
        tags: [],
        links: [],
      });
      setValue('');
      toast.success('Task added.');
      onCreated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add task.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Plus size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder={placeholder}
          className="input pl-9"
        />
      </div>
      <Button variant="primary" loading={busy} onClick={() => void submit()} disabled={!value.trim()}>
        Add
      </Button>
    </div>
  );
}
