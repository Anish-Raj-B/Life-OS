import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  addMonths, eachDayOfInterval, endOfMonth, format, getDay, isSameMonth, parseISO, startOfMonth, subMonths,
} from 'date-fns';
import { NotebookPen, Plus, Search, Trash2, ChevronLeft, ChevronRight, Smile, Save } from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { deleteRow, insertRow, updateRow } from '@/lib/api';
import { clearDraft, readDraft, saveDraft } from '@/lib/offline';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, MarkdownView,
  Modal, PageHeader, SearchInput, Tabs, TagInput, Textarea, useToast,
} from '@/components/ui';
import { prettyDate, todayISO } from '@/lib/utils';
import type { DiaryEntry } from '@/lib/types';

const MOODS = [
  { value: 1, label: 'Very low' },
  { value: 2, label: 'Low' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Great' },
];

export default function Diary() {
  const { user } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const { data: entries, loading, reload } = useCollection<DiaryEntry>('diary_entries', 'entry_date', false);

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
  const [form, setForm] = useState({ title: '', content: '', mood: 0, tags: [] as string[] });
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [deleting, setDeleting] = useState<DiaryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  const active = useMemo(() => entries.filter((e) => !e.deleted_at), [entries]);
  const byDate = useMemo(() => {
    const map = new Map<string, DiaryEntry[]>();
    for (const entry of active) {
      map.set(entry.entry_date, [...(map.get(entry.entry_date) ?? []), entry]);
    }
    return map;
  }, [active]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return active
      .filter((e) => (term ? [e.title, e.content_md, ...(e.tags ?? [])].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)) : true))
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
  }, [active, query]);

  const days = useMemo(() => eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }), [month]);
  const leading = (getDay(startOfMonth(month)) + 6) % 7; // Monday-first grid

  const draftKey = `diary:${selectedDate}:${editing?.id ?? 'new'}`;

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void saveDraft(draftKey, form), 800);
    return () => clearTimeout(timer);
  }, [form, open, draftKey]);

  const openEditor = async (entry?: DiaryEntry) => {
    setEditing(entry ?? null);
    setMode('write');
    setDraftRestored(false);
    const base = entry
      ? { title: entry.title ?? '', content: entry.content_md, mood: entry.mood ?? 0, tags: entry.tags ?? [] }
      : { title: '', content: '', mood: 0, tags: [] as string[] };
    const draft = await readDraft<typeof base>(`diary:${entry?.entry_date ?? selectedDate}:${entry?.id ?? 'new'}`);
    setForm(draft ?? base);
    setDraftRestored(Boolean(draft));
    setOpen(true);
  };

  const save = async () => {
    if (!user) return;
    if (!form.content.trim()) {
      toast.error('Write something before saving.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        user_id: user.id,
        entry_date: selectedDate,
        title: form.title.trim() || `Entry for ${selectedDate}`,
        content_md: form.content,
        mood: form.mood || null,
        tags: form.tags,
        links: [],
      };
      if (editing) {
        await updateRow('diary_entries', editing.id, payload, editing.version);
      } else {
        await insertRow('diary_entries', payload);
      }
      await clearDraft(draftKey);
      toast.success('Diary entry saved privately.');
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the entry.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteRow('diary_entries', deleting.id, true);
      toast.success('Entry deleted.');
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the entry.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        eyebrow="Private"
        title="Diary"
        description="Your day-to-day record. Entries are readable only by your account and never appear on any profile."
        actions={<Button variant="primary" icon={Plus} onClick={() => void openEditor()}>Write entry</Button>}
      />

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card
          padded={false}
          title={format(month, 'MMMM yyyy')}
          actions={
            <div className="flex gap-0.5">
              <button onClick={() => setMonth(subMonths(month, 1))} className="btn btn-ghost !p-1.5" aria-label="Previous month"><ChevronLeft size={14} /></button>
              <button onClick={() => setMonth(addMonths(month, 1))} className="btn btn-ghost !p-1.5" aria-label="Next month"><ChevronRight size={14} /></button>
            </div>
          }
        >
          <div className="px-3 pb-3">
            <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[9px] uppercase tracking-wider text-muted">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: leading }, (_, i) => <span key={`pad-${i}`} />)}
              {days.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const hasEntries = byDate.has(key);
                const isToday = key === todayISO();
                const isSelected = key === selectedDate;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(key)}
                    className={clsx(
                      'relative aspect-square rounded-lg text-[11px] transition',
                      isSelected ? 'bg-accent text-white' : isToday ? 'border border-accent/50 text-accent' : 'text-muted hover:bg-raised/70',
                    )}
                  >
                    {format(day, 'd')}
                    {hasEntries && !isSelected && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => { setSelectedDate(todayISO()); setMonth(startOfMonth(new Date())); }}
              className="mt-3 w-full text-[10px] text-accent hover:underline"
            >
              Jump to today
            </button>
          </div>

          <div className="border-t border-line/60 px-3 py-3">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
              {prettyDate(selectedDate, 'EEEE, d MMM')}
            </p>
            {(byDate.get(selectedDate) ?? []).length === 0 ? (
              <button onClick={() => void openEditor()} className="w-full rounded-lg border border-dashed border-line/70 px-2 py-3 text-[11px] text-muted hover:border-accent/40">
                No entry — write one
              </button>
            ) : (
              <div className="space-y-1">
                {(byDate.get(selectedDate) ?? []).map((entry) => (
                  <button key={entry.id} onClick={() => void openEditor(entry)} className="block w-full rounded-lg border border-line/50 px-2 py-1.5 text-left hover:border-accent/40">
                    <p className="truncate text-[11px] text-ink">{entry.title ?? 'Untitled'}</p>
                    <p className="truncate text-[10px] text-muted">{entry.content_md.slice(0, 60)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Search diary entries…" />
          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={NotebookPen}
                title={query ? 'No matching entries' : 'Your diary is empty'}
                description={query ? 'Try a different word or clear the search.' : 'Start with today — a few honest lines are enough.'}
                action={!query ? <Button variant="primary" onClick={() => void openEditor()} icon={Plus}>Write today</Button> : undefined}
              />
            </Card>
          ) : (
            filtered.map((entry) => (
              <Card key={entry.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">{entry.title ?? 'Untitled'}</h3>
                      {entry.mood && <Badge tone="info"><Smile size={9} /> {MOODS.find((m) => m.value === entry.mood)?.label}</Badge>}
                      <Badge>{prettyDate(entry.entry_date, 'd MMM yyyy')}</Badge>
                    </div>
                    <p className="text-[10px] text-muted">updated {prettyDate(entry.updated_at ?? entry.created_at, 'd MMM HH:mm')}</p>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <button onClick={() => { setSelectedDate(entry.entry_date); void openEditor(entry); }} className="btn btn-ghost !p-1.5 text-muted" aria-label="Edit entry"><NotebookPen size={13} /></button>
                    <button onClick={() => setDeleting(entry)} className="btn btn-ghost !p-1.5 text-muted hover:text-danger" aria-label="Delete entry"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="mt-2 max-h-52 overflow-hidden">
                  <MarkdownView content={entry.content_md} />
                </div>
                {(entry.tags ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {entry.tags.map((tag) => <span key={tag} className="chip">#{tag}</span>)}
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit diary entry' : 'New diary entry'}
        description={`${prettyDate(selectedDate, 'EEEE, d MMMM yyyy')} · private, drafts autosave locally`}
        wide
        footer={<><Button onClick={() => setOpen(false)}>Close</Button><Button variant="primary" icon={Save} loading={busy} onClick={() => void save()}>Save entry</Button></>}
      >
        {draftRestored && (
          <p className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">Restored an unsaved draft.</p>
        )}
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Optional" /></Field>
            <Field label="Mood">
              <div className="flex gap-1">
                {MOODS.map((mood) => (
                  <button
                    key={mood.value}
                    onClick={() => setForm({ ...form, mood: form.mood === mood.value ? 0 : mood.value })}
                    title={mood.label}
                    className={clsx(
                      'flex-1 rounded-lg border px-1 py-1.5 text-[10px] transition',
                      form.mood === mood.value ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted hover:border-accent/40',
                    )}
                  >
                    {mood.value}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="label !mb-0">Entry</span>
              <Tabs value={mode} onChange={setMode} items={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]} />
            </div>
            {mode === 'write' ? (
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="What happened today? What did you notice?"
                className="min-h-[280px] font-mono text-xs leading-relaxed"
              />
            ) : (
              <div className="min-h-[280px] rounded-xl border border-line bg-base/40 p-3">
                <MarkdownView content={form.content} />
              </div>
            )}
          </div>
          <Field label="Tags"><TagInput value={form.tags} onChange={(tags) => setForm({ ...form, tags })} /></Field>
          <Field label="Date"><Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} /></Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete diary entry"
        message={`"${deleting?.title ?? 'This entry'}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete permanently"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
