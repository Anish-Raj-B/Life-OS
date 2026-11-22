import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Layers, Shield, Code, Boxes, ListChecks, Sparkles, Dumbbell, Rocket, Library, Folder } from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { deleteRow, insertRow, updateRow } from '@/lib/api';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, Modal,
  PageHeader, Progress, Select, Textarea, useToast,
} from '@/components/ui';
import type { LearningRecord, Section, Task, Topic } from '@/lib/types';

const ICONS: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  folder: Folder,
  shield: Shield,
  code: Code,
  boxes: Boxes,
  'list-checks': ListChecks,
  sparkles: Sparkles,
  dumbbell: Dumbbell,
  rocket: Rocket,
  library: Library,
  layers: Layers,
};

export default function Sections() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: sections, loading, reload } = useCollection<Section>('sections', 'sort_order', true);
  const { data: topics, reload: reloadTopics } = useCollection<Topic>('topics', 'sort_order', true);
  const { data: tasks } = useCollection<Task>('tasks', 'created_at', false);
  const { data: learning } = useCollection<LearningRecord>('learning_records', 'record_date', false);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [sectionModal, setSectionModal] = useState(false);
  const [topicModal, setTopicModal] = useState<string | null>(null);
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [form, setForm] = useState({ name: '', description: '', icon: 'folder', color: '', sort_order: 0 });
  const [topicForm, setTopicForm] = useState({ name: '', description: '', sort_order: 0 });
  const [deleting, setDeleting] = useState<{ kind: 'section' | 'topic'; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const ownedSections = useMemo(
    () => sections.filter((s) => s.user_id === user?.id).sort((a, b) => a.sort_order - b.sort_order),
    [sections, user?.id],
  );

  const openSection = (section?: Section) => {
    setEditingSection(section ?? null);
    setForm(
      section
        ? { name: section.name, description: section.description ?? '', icon: section.icon, color: section.color ?? '', sort_order: section.sort_order }
        : { name: '', description: '', icon: 'folder', color: '', sort_order: ownedSections.length + 1 },
    );
    setSectionModal(true);
  };

  const openTopic = (sectionId: string, topic?: Topic) => {
    setEditingTopic(topic ?? null);
    setTopicForm({
      name: topic?.name ?? '',
      description: topic?.description ?? '',
      sort_order: topic?.sort_order ?? topics.filter((t) => t.section_id === sectionId).length + 1,
    });
    setTopicModal(sectionId);
  };

  const saveSection = async () => {
    if (!user || !form.name.trim()) return;
    setBusy(true);
    try {
      if (editingSection) {
        await updateRow('sections', editingSection.id, {
          name: form.name.trim(),
          description: form.description.trim() || null,
          icon: form.icon,
          color: form.color || null,
          sort_order: Number(form.sort_order) || 0,
        }, editingSection.version);
        toast.success('Section updated.');
      } else {
        await insertRow('sections', {
          user_id: user.id,
          name: form.name.trim(),
          description: form.description.trim() || null,
          icon: form.icon,
          color: form.color || null,
          sort_order: Number(form.sort_order) || ownedSections.length + 1,
        });
        toast.success('Section created.');
      }
      setSectionModal(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the section.');
    } finally {
      setBusy(false);
    }
  };

  const saveTopic = async () => {
    if (!user || !topicModal || !topicForm.name.trim()) return;
    setBusy(true);
    try {
      if (editingTopic) {
        await updateRow('topics', editingTopic.id, {
          name: topicForm.name.trim(),
          description: topicForm.description.trim() || null,
          sort_order: Number(topicForm.sort_order) || 0,
        }, editingTopic.version);
        toast.success('Topic updated.');
      } else {
        await insertRow('topics', {
          user_id: user.id,
          section_id: topicModal,
          name: topicForm.name.trim(),
          description: topicForm.description.trim() || null,
          sort_order: Number(topicForm.sort_order) || 0,
        });
        toast.success('Topic created.');
      }
      setTopicModal(null);
      reloadTopics();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the topic.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteRow(deleting.kind === 'section' ? 'sections' : 'topics', deleting.id, true);
      toast.success(`${deleting.kind === 'section' ? 'Section' : 'Topic'} deleted.`);
      setDeleting(null);
      reload();
      reloadTopics();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete. Note: topics inside a section must be removed first.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        eyebrow="Structure"
        title="Sections & subjects"
        description="Your learning structure. Sections group tasks, records, flashcards and challenges; topics live inside them."
        actions={<Button variant="primary" icon={Plus} onClick={() => openSection()}>New section</Button>}
      />

      <div className="grid gap-3">
        {ownedSections.length === 0 && (
          <Card>
            <EmptyState icon={Layers} title="No sections" description="Create your first section — for example Cybersecurity or General Tasks." action={<Button variant="primary" icon={Plus} onClick={() => openSection()}>Create section</Button>} />
          </Card>
        )}

        {ownedSections.map((section) => {
          const Icon = ICONS[section.icon] ?? Folder;
          const sectionTopics = topics.filter((t) => t.section_id === section.id).sort((a, b) => a.sort_order - b.sort_order);
          const sectionTasks = tasks.filter((t) => t.section_id === section.id && !t.deleted_at && t.status !== 'cancelled');
          const done = sectionTasks.filter((t) => t.status === 'completed').length;
          const entryCount = learning.filter((l) => l.section_id === section.id && !l.deleted_at).length;
          const open = expanded === section.id;

          return (
            <Card key={section.id} padded={false}>
              <div className="flex items-start gap-3 p-3.5">
                <button
                  onClick={() => setExpanded(open ? null : section.id)}
                  className="mt-0.5 text-muted"
                  aria-label={open ? 'Collapse' : 'Expand'}
                >
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
                  <Icon size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{section.name}</p>
                    <Badge>{sectionTopics.length} topic{sectionTopics.length === 1 ? '' : 's'}</Badge>
                    <Badge tone="info">{entryCount} entries</Badge>
                  </div>
                  {section.description && <p className="mt-0.5 text-xs text-muted">{section.description}</p>}
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={sectionTasks.length ? (done / sectionTasks.length) * 100 : 0} tone={sectionTasks.length && done === sectionTasks.length ? 'ok' : 'accent'} />
                    <span className="shrink-0 text-[10px] text-muted">{done}/{sectionTasks.length}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <button onClick={() => openSection(section)} className="btn btn-ghost !p-1.5 text-muted" aria-label="Edit section"><Pencil size={14} /></button>
                  <button onClick={() => setDeleting({ kind: 'section', id: section.id, name: section.name })} className="btn btn-ghost !p-1.5 text-muted hover:text-danger" aria-label="Delete section"><Trash2 size={14} /></button>
                </div>
              </div>

              {open && (
                <div className="border-t border-line/60 px-3.5 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Topics</p>
                    <Button size="sm" variant="ghost" icon={Plus} onClick={() => openTopic(section.id)}>Add topic</Button>
                  </div>
                  {sectionTopics.length === 0 ? (
                    <p className="py-2 text-xs text-muted">No topics yet. Add the subtopics you actually study.</p>
                  ) : (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {sectionTopics.map((topic) => {
                        const topicTasks = tasks.filter((t) => t.topic_id === topic.id && !t.deleted_at);
                        const topicEntries = learning.filter((l) => l.topic_id === topic.id && !l.deleted_at).length;
                        return (
                          <div key={topic.id} className={clsx('flex items-center gap-2 rounded-lg border border-line/50 px-2.5 py-2')}>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs text-ink">{topic.name}</p>
                              <p className="text-[10px] text-muted">{topicTasks.length} tasks · {topicEntries} entries</p>
                            </div>
                            <button onClick={() => openTopic(section.id, topic)} className="text-muted hover:text-accent" aria-label="Edit topic"><Pencil size={12} /></button>
                            <button onClick={() => setDeleting({ kind: 'topic', id: topic.id, name: topic.name })} className="text-muted hover:text-danger" aria-label="Delete topic"><Trash2 size={12} /></button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="mt-4" title="How sections are used">
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted">
          <li>· Tasks, learning records, flashcards, resources and challenges all reference a section and optionally a topic.</li>
          <li>· Deleting a section keeps your records — their section reference becomes empty rather than deleting history.</li>
          <li>· Global section templates are managed by the administrator; your own sections are private to your account.</li>
        </ul>
      </Card>

      <Modal
        open={sectionModal}
        onClose={() => setSectionModal(false)}
        title={editingSection ? 'Edit section' : 'New section'}
        footer={<><Button onClick={() => setSectionModal(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void saveSection()}>Save</Button></>}
      >
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Operating Systems" /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Icon">
              <Select value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
                {Object.keys(ICONS).map((key) => <option key={key} value={key}>{key}</option>)}
              </Select>
            </Field>
            <Field label="Order"><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(topicModal)}
        onClose={() => setTopicModal(null)}
        title={editingTopic ? 'Edit topic' : 'New topic'}
        footer={<><Button onClick={() => setTopicModal(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void saveTopic()}>Save</Button></>}
      >
        <div className="space-y-3">
          <Field label="Name"><Input value={topicForm.name} onChange={(e) => setTopicForm({ ...topicForm, name: e.target.value })} /></Field>
          <Field label="Description"><Textarea value={topicForm.description} onChange={(e) => setTopicForm({ ...topicForm, description: e.target.value })} /></Field>
          <Field label="Order"><Input type="number" value={topicForm.sort_order} onChange={(e) => setTopicForm({ ...topicForm, sort_order: Number(e.target.value) })} /></Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.kind ?? 'item'}`}
        message={
          deleting?.kind === 'section'
            ? `"${deleting?.name}" will be removed. Topics inside it are removed too; your tasks, records and cards remain but lose this reference.`
            : `"${deleting?.name}" will be removed. Linked tasks and records keep their history.`
        }
        confirmLabel="Delete"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
