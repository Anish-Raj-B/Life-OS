import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link2, Plus, Trash2, Pencil, ExternalLink, Copy } from 'lucide-react';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { deleteRow, insertRow, updateRow } from '@/lib/api';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, Modal,
  PageHeader, SearchInput, Select, TagInput, Textarea, useToast,
} from '@/components/ui';
import { prettyDate, safeUrl } from '@/lib/utils';
import type { LearningResource, Section, Topic } from '@/lib/types';

const blank = () => ({ title: '', url: '', description: '', notes: '', section_id: '', topic_id: '', tags: [] as string[] });

export default function Resources() {
  const { user } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const { data: resources, loading, reload } = useCollection<LearningResource>('learning_resources', 'created_at', false);
  const { data: sections } = useCollection<Section>('sections', 'sort_order', true);
  const { data: topics } = useCollection<Topic>('topics', 'sort_order', true);

  const [query, setQuery] = useState(params.get('q') ?? '');
  const [sectionFilter, setSectionFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LearningResource | null>(null);
  const [form, setForm] = useState(blank());
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LearningResource | null>(null);
  const [busy, setBusy] = useState(false);

  const active = useMemo(() => resources.filter((r) => !r.deleted_at), [resources]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return active
      .filter((r) => (sectionFilter ? r.section_id === sectionFilter : true))
      .filter((r) =>
        term
          ? [r.title, r.url, r.description, r.notes, ...(r.tags ?? [])].filter(Boolean).some((v) => String(v).toLowerCase().includes(term))
          : true,
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [active, query, sectionFilter]);

  const openResource = (resource?: LearningResource) => {
    setEditing(resource ?? null);
    setError(null);
    setForm(
      resource
        ? {
            title: resource.title,
            url: resource.url,
            description: resource.description ?? '',
            notes: resource.notes ?? '',
            section_id: resource.section_id ?? '',
            topic_id: resource.topic_id ?? '',
            tags: resource.tags ?? [],
          }
        : blank(),
    );
    setOpen(true);
  };

  const save = async () => {
    if (!user) return;
    if (!form.title.trim()) {
      setError('A title is required.');
      return;
    }
    const url = safeUrl(form.url);
    if (!url) {
      setError('Enter a valid http(s) URL.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        user_id: user.id,
        title: form.title.trim(),
        url,
        description: form.description.trim() || null,
        notes: form.notes.trim() || null,
        section_id: form.section_id || null,
        topic_id: form.topic_id || null,
        tags: form.tags,
      };
      if (editing) {
        await updateRow('learning_resources', editing.id, payload, editing.version);
        toast.success('Resource updated.');
      } else {
        await insertRow('learning_resources', payload);
        toast.success('Resource saved.');
      }
      setOpen(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the resource.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteRow('learning_resources', deleting.id, true);
      toast.success('Resource deleted.');
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the resource.');
    } finally {
      setBusy(false);
    }
  };

  const sectionName = (id: string | null) => sections.find((s) => s.id === id)?.name;
  const topicName = (id: string | null) => topics.find((t) => t.id === id)?.name;

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        eyebrow="Library"
        title="Resources"
        description="Saved links with context, so you can find the thing you read six months ago."
        actions={<Button variant="primary" icon={Plus} onClick={() => openResource()}>Add resource</Button>}
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <SearchInput value={query} onChange={setQuery} placeholder="Search title, URL, notes, tags…" className="flex-1" />
        <Select value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} className="sm:w-52">
          <option value="">All sections</option>
          {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={Link2}
            title={query ? 'No matching resources' : 'No resources saved'}
            description="Documentation, courses, papers, tools — keep them where you will find them."
            action={!query ? <Button variant="primary" icon={Plus} onClick={() => openResource()}>Add the first one</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((resource) => (
            <Card key={resource.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-ink">{resource.title}</h3>
                  <a
                    href={safeUrl(resource.url) ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-[11px] text-accent2 hover:underline"
                  >
                    <ExternalLink size={10} className="shrink-0" /> <span className="truncate">{resource.url}</span>
                  </a>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(resource.url);
                      toast.success('Link copied.');
                    }}
                    className="btn btn-ghost !p-1.5 text-muted"
                    aria-label="Copy link"
                  >
                    <Copy size={12} />
                  </button>
                  <button onClick={() => openResource(resource)} className="btn btn-ghost !p-1.5 text-muted" aria-label="Edit"><Pencil size={12} /></button>
                  <button onClick={() => setDeleting(resource)} className="btn btn-ghost !p-1.5 text-muted hover:text-danger" aria-label="Delete"><Trash2 size={12} /></button>
                </div>
              </div>
              {resource.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{resource.description}</p>}
              {resource.notes && <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted/80">{resource.notes}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {sectionName(resource.section_id) && <Badge tone="accent">{sectionName(resource.section_id)}</Badge>}
                {topicName(resource.topic_id) && <Badge tone="info">{topicName(resource.topic_id)}</Badge>}
                {(resource.tags ?? []).map((tag) => <span key={tag} className="chip">#{tag}</span>)}
              </div>
              <p className="mt-2 text-[10px] text-muted/70">added {prettyDate(resource.created_at, 'd MMM yyyy')}</p>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit resource' : 'Add resource'}
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></>}
      >
        <div className="space-y-3">
          <Field label="Title" error={error ?? undefined}><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="URL" hint="Only http(s) links are accepted."><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[60px]" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Section">
              <Select value={form.section_id} onChange={(e) => setForm({ ...form, section_id: e.target.value, topic_id: '' })}>
                <option value="">None</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Topic">
              <Select value={form.topic_id} onChange={(e) => setForm({ ...form, topic_id: e.target.value })}>
                <option value="">None</option>
                {topics.filter((t) => !form.section_id || t.section_id === form.section_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Tags"><TagInput value={form.tags} onChange={(tags) => setForm({ ...form, tags })} /></Field>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete resource"
        message={`"${deleting?.title ?? ''}" will be removed from your library.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
