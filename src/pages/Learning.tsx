import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Clock, FileText, Plus, Tag, Trash2, Pencil, ExternalLink, Save } from 'lucide-react';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { deleteRow, insertRow, updateRow } from '@/lib/api';
import { clearDraft, readDraft, saveDraft } from '@/lib/offline';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, MarkdownView,
  Modal, PageHeader, SearchInput, Select, Tabs, TagInput, Textarea, useToast,
} from '@/components/ui';
import { prettyDate, safeUrl, todayISO, truncate } from '@/lib/utils';
import type { LearningRecord, Section, Topic } from '@/lib/types';

interface FormState {
  title: string;
  record_date: string;
  section_id: string;
  topic_id: string;
  learned: string;
  key_concepts: string;
  practice: string;
  understood: string;
  not_understood: string;
  mistakes: string;
  next_steps: string;
  notes_md: string;
  resources: { label: string; url: string }[];
  tags: string[];
  duration_minutes: string;
}

const blank = (): FormState => ({
  title: '',
  record_date: todayISO(),
  section_id: '',
  topic_id: '',
  learned: '',
  key_concepts: '',
  practice: '',
  understood: '',
  not_understood: '',
  mistakes: '',
  next_steps: '',
  notes_md: '',
  resources: [],
  tags: [],
  duration_minutes: '',
});

export default function Learning() {
  const { user } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const { data: records, loading, reload } = useCollection<LearningRecord>('learning_records', 'record_date', false);
  const { data: sections } = useCollection<Section>('sections', 'sort_order', true);
  const { data: topics } = useCollection<Topic>('topics', 'sort_order', true);

  const [query, setQuery] = useState(params.get('q') ?? '');
  const [sectionFilter, setSectionFilter] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LearningRecord | null>(null);
  const [form, setForm] = useState<FormState>(blank());
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [deleting, setDeleting] = useState<LearningRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  const active = useMemo(() => records.filter((r) => !r.deleted_at), [records]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return active
      .filter((r) => (sectionFilter ? r.section_id === sectionFilter : true))
      .filter((r) => (topicFilter ? r.topic_id === topicFilter : true))
      .filter((r) => (fromDate ? r.record_date >= fromDate : true))
      .filter((r) => (toDate ? r.record_date <= toDate : true))
      .filter((r) =>
        term
          ? [r.title, r.learned, r.key_concepts, r.notes_md, r.understood, r.not_understood, ...(r.tags ?? [])]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(term))
          : true,
      )
      .sort((a, b) => b.record_date.localeCompare(a.record_date) || b.created_at.localeCompare(a.created_at));
  }, [active, query, sectionFilter, topicFilter, fromDate, toDate]);

  const topicName = (id: string | null) => topics.find((t) => t.id === id)?.name;
  const sectionName = (id: string | null) => sections.find((s) => s.id === id)?.name;

  const draftKey = editing ? `learning:${editing.id}` : 'learning:new';

  // Autosave: debounce to IndexedDB so a crash or navigation never loses notes.
  useEffect(() => {
    if (!modalOpen) return;
    const timer = setTimeout(() => {
      void saveDraft(draftKey, form);
    }, 900);
    return () => clearTimeout(timer);
  }, [form, modalOpen, draftKey]);

  const openCreate = async () => {
    setEditing(null);
    setForm(blank());
    setMode('write');
    setDraftRestored(false);
    const draft = await readDraft<FormState>('learning:new');
    if (draft && (draft.title || draft.notes_md || draft.learned)) {
      setForm(draft);
      setDraftRestored(true);
    }
    setModalOpen(true);
  };

  const openEdit = async (record: LearningRecord) => {
    setEditing(record);
    setMode('write');
    setDraftRestored(false);
    const base: FormState = {
      title: record.title,
      record_date: record.record_date,
      section_id: record.section_id ?? '',
      topic_id: record.topic_id ?? '',
      learned: record.learned ?? '',
      key_concepts: record.key_concepts ?? '',
      practice: record.practice ?? '',
      understood: record.understood ?? '',
      not_understood: record.not_understood ?? '',
      mistakes: record.mistakes ?? '',
      next_steps: record.next_steps ?? '',
      notes_md: record.notes_md ?? '',
      resources: record.resources ?? [],
      tags: record.tags ?? [],
      duration_minutes: record.duration_minutes ? String(record.duration_minutes) : '',
    };
    const draft = await readDraft<FormState>(`learning:${record.id}`);
    setForm(draft ?? base);
    setDraftRestored(Boolean(draft));
    setModalOpen(true);
  };

  const save = async () => {
    if (!user) return;
    if (!form.title.trim()) {
      toast.error('A title is required.');
      return;
    }
    const resources = form.resources
      .map((r) => ({ label: r.label.trim() || r.url, url: safeUrl(r.url) }))
      .filter((r): r is { label: string; url: string } => Boolean(r.url));
    setBusy(true);
    try {
      const payload = {
        user_id: user.id,
        title: form.title.trim(),
        record_date: form.record_date,
        section_id: form.section_id || null,
        topic_id: form.topic_id || null,
        learned: form.learned.trim() || null,
        key_concepts: form.key_concepts.trim() || null,
        practice: form.practice.trim() || null,
        understood: form.understood.trim() || null,
        not_understood: form.not_understood.trim() || null,
        mistakes: form.mistakes.trim() || null,
        next_steps: form.next_steps.trim() || null,
        notes_md: form.notes_md,
        resources,
        tags: form.tags,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      };
      if (editing) {
        await updateRow('learning_records', editing.id, payload, editing.version);
        toast.success('Learning record updated.');
      } else {
        await insertRow('learning_records', payload);
        toast.success('Learning record saved. Previous entries are preserved.');
      }
      await clearDraft(draftKey);
      setModalOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the record.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteRow('learning_records', deleting.id, true);
      toast.success('Record deleted.');
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the record.');
    } finally {
      setBusy(false);
    }
  };

  const availableTopics = topics.filter((t) => !form.section_id || t.section_id === form.section_id);

  return (
    <div>
      <PageHeader
        eyebrow="Knowledge"
        title="Learning records"
        description="Document what you actually learned, day by day. New entries are appended; nothing overwrites the past."
        actions={<Button variant="primary" icon={Plus} onClick={() => void openCreate()}>New entry</Button>}
      />

      <Card className="mb-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <SearchInput value={query} onChange={setQuery} placeholder="Search notes, concepts, tags…" className="lg:col-span-2" />
          <Select value={sectionFilter} onChange={(e) => { setSectionFilter(e.target.value); setTopicFilter(''); }}>
            <option value="">All sections</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)}>
            <option value="">All topics</option>
            {topics.filter((t) => !sectionFilter || t.section_id === sectionFilter).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <Badge>{filtered.length} record{filtered.length === 1 ? '' : 's'}</Badge>
          {(query || sectionFilter || topicFilter || fromDate || toDate) && (
            <button
              onClick={() => { setQuery(''); setSectionFilter(''); setTopicFilter(''); setFromDate(''); setToDate(''); }}
              className="text-accent hover:underline"
            >
              clear filters
            </button>
          )}
        </div>
      </Card>

      {loading ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No learning records"
            description="Write your first entry: what you studied, what clicked, what did not."
            action={<Button variant="primary" icon={Plus} onClick={() => void openCreate()}>Write an entry</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((record) => (
            <Card key={record.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-ink">{record.title}</h3>
                    {sectionName(record.section_id) && <Badge tone="accent">{sectionName(record.section_id)}</Badge>}
                    {topicName(record.topic_id) && <Badge tone="info">{topicName(record.topic_id)}</Badge>}
                    {record.duration_minutes ? (
                      <Badge><Clock size={9} /> {record.duration_minutes} min</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">{prettyDate(record.record_date, 'EEEE, d MMMM yyyy')}</p>
                </div>
                <div className="flex gap-0.5">
                  <Button variant="ghost" size="sm" icon={Pencil} onClick={() => void openEdit(record)} aria-label="Edit" />
                  <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDeleting(record)} aria-label="Delete" />
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {record.learned && (
                  <Section label="What I learned"><p className="text-xs leading-relaxed text-muted">{record.learned}</p></Section>
                )}
                {record.key_concepts && (
                  <Section label="Key concepts"><p className="text-xs leading-relaxed text-muted">{record.key_concepts}</p></Section>
                )}
                {record.practice && (
                  <Section label="Practice"><p className="text-xs leading-relaxed text-muted">{record.practice}</p></Section>
                )}
                {record.not_understood && (
                  <Section label="Not understood"><p className="text-xs leading-relaxed text-warn">{record.not_understood}</p></Section>
                )}
                {record.mistakes && (
                  <Section label="Mistakes"><p className="text-xs leading-relaxed text-danger">{record.mistakes}</p></Section>
                )}
                {record.next_steps && (
                  <Section label="Next steps"><p className="text-xs leading-relaxed text-ink">{record.next_steps}</p></Section>
                )}
              </div>

              {record.notes_md && (
                <details className="mt-3 rounded-lg border border-line/60 px-3 py-2">
                  <summary className="cursor-pointer text-[11px] text-accent">Detailed notes</summary>
                  <div className="mt-2"><MarkdownView content={record.notes_md} /></div>
                </details>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(record.tags ?? []).map((tag) => (
                  <span key={tag} className="chip"><Tag size={9} /> {tag}</span>
                ))}
                {(record.resources ?? []).map((r, i) => {
                  const url = safeUrl(r.url);
                  return url ? (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-accent2 hover:underline">
                      <ExternalLink size={10} /> {truncate(r.label, 30)}
                    </a>
                  ) : null;
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit learning record' : 'New learning record'}
        description="Drafts autosave locally while you write."
        wide
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>Close</Button>
            <Button variant="primary" icon={Save} loading={busy} onClick={() => void save()}>Save record</Button>
          </>
        }
      >
        {draftRestored && (
          <p className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">
            An unsaved local draft was restored.
          </p>
        )}
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2">
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Authentication vs authorisation" />
            </Field>
            <Field label="Date"><Input type="date" value={form.record_date} onChange={(e) => setForm({ ...form, record_date: e.target.value })} /></Field>
            <Field label="Duration (minutes)"><Input type="number" min={0} value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></Field>
            <Field label="Section">
              <Select value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value, topic_id: '' })}>
                <option value="">No section</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Topic">
              <Select value={form.topic_id} onChange={(e) => setForm({ ...form, topic_id: e.target.value })}>
                <option value="">No topic</option>
                {availableTopics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="What I learned"><Textarea value={form.learned} onChange={(e) => setForm({ ...form, learned: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Key concepts"><Textarea value={form.key_concepts} onChange={(e) => setForm({ ...form, key_concepts: e.target.value })} /></Field>
            <Field label="Practical exercises"><Textarea value={form.practice} onChange={(e) => setForm({ ...form, practice: e.target.value })} /></Field>
            <Field label="What I understood"><Textarea value={form.understood} onChange={(e) => setForm({ ...form, understood: e.target.value })} /></Field>
            <Field label="What I did not understand"><Textarea value={form.not_understood} onChange={(e) => setForm({ ...form, not_understood: e.target.value })} /></Field>
            <Field label="Mistakes"><Textarea value={form.mistakes} onChange={(e) => setForm({ ...form, mistakes: e.target.value })} /></Field>
            <Field label="Next steps"><Textarea value={form.next_steps} onChange={(e) => setForm({ ...form, next_steps: e.target.value })} /></Field>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="label !mb-0">Detailed notes (Markdown)</span>
              <Tabs value={mode} onChange={setMode} items={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]} />
            </div>
            {mode === 'write' ? (
              <Textarea
                value={form.notes_md}
                onChange={(e) => setForm({ ...form, notes_md: e.target.value })}
                className="min-h-[180px] font-mono text-xs"
                placeholder={'## Summary\n\n- key idea\n- example command\n'}
              />
            ) : (
              <div className="min-h-[180px] rounded-xl border border-line bg-base/40 p-3">
                <MarkdownView content={form.notes_md} />
              </div>
            )}
          </div>

          <Field label="Tags"><TagInput value={form.tags} onChange={(tags) => setForm({ ...form, tags })} /></Field>

          <div>
            <span className="label">Links & references</span>
            <div className="space-y-2">
              {form.resources.map((resource, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder="Label"
                    value={resource.label}
                    onChange={(e) => {
                      const next = [...form.resources];
                      next[index] = { ...next[index], label: e.target.value };
                      setForm({ ...form, resources: next });
                    }}
                    className="max-w-[160px]"
                  />
                  <Input
                    placeholder="https://…"
                    value={resource.url}
                    onChange={(e) => {
                      const next = [...form.resources];
                      next[index] = { ...next[index], url: e.target.value };
                      setForm({ ...form, resources: next });
                    }}
                  />
                  <Button variant="ghost" onClick={() => setForm({ ...form, resources: form.resources.filter((_, i) => i !== index) })} aria-label="Remove">
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" icon={BookOpen} onClick={() => setForm({ ...form, resources: [...form.resources, { label: '', url: '' }] })}>
                Add reference
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete learning record"
        message={`"${deleting?.title ?? ''}" will be removed. Other records and your pathway history are untouched.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
