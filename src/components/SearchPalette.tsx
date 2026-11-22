import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, ListChecks, NotebookPen, Link2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Modal, Badge } from './ui';

interface Hit {
  id: string;
  kind: 'task' | 'learning' | 'diary' | 'resource';
  title: string;
  snippet?: string | null;
  path: string;
}

const ICONS = { task: ListChecks, learning: FileText, diary: NotebookPen, resource: Link2 };

/** Real server-side search across the signed-in user's records. */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) {
      setTerm('');
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const like = `%${query}%`;
      const [tasks, learning, diary, resources] = await Promise.all([
        supabase.from('tasks').select('id,title,description').ilike('title', like).limit(5),
        supabase.from('learning_records').select('id,title,notes_md').ilike('title', like).limit(5),
        supabase.from('diary_entries').select('id,title,entry_date').ilike('content_md', like).limit(5),
        supabase.from('learning_resources').select('id,title,url').ilike('title', like).limit(5),
      ]);
      if (cancelled) return;
      const next: Hit[] = [
        ...(tasks.data ?? []).map((r: any) => ({ id: r.id, kind: 'task' as const, title: r.title, snippet: r.description, path: `/tasks?q=${encodeURIComponent(query)}` })),
        ...(learning.data ?? []).map((r: any) => ({ id: r.id, kind: 'learning' as const, title: r.title, snippet: r.notes_md?.slice(0, 90), path: `/learning?q=${encodeURIComponent(query)}` })),
        ...(diary.data ?? []).map((r: any) => ({ id: r.id, kind: 'diary' as const, title: r.title ?? 'Diary entry', snippet: r.entry_date, path: `/diary?q=${encodeURIComponent(query)}` })),
        ...(resources.data ?? []).map((r: any) => ({ id: r.id, kind: 'resource' as const, title: r.title, snippet: r.url, path: `/resources?q=${encodeURIComponent(query)}` })),
      ];
      setHits(next);
      setLoading(false);
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const grouped = useMemo(() => hits, [hits]);

  return (
    <Modal open={open} onClose={onClose} title="Search LIFE OS" description="Tasks, learning records, diary entries and saved resources.">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Type at least two characters…"
          className="input py-2.5 pl-9"
        />
      </div>
      <div className="mt-4 space-y-1">
        {loading && (
          <p className="flex items-center gap-2 py-3 text-xs text-muted">
            <Loader2 size={14} className="animate-spin" /> Searching…
          </p>
        )}
        {!loading && term.trim().length >= 2 && grouped.length === 0 && (
          <p className="py-4 text-xs text-muted">No matches in your records.</p>
        )}
        {grouped.map((hit) => {
          const Icon = ICONS[hit.kind];
          return (
            <button
              key={`${hit.kind}-${hit.id}`}
              onClick={() => {
                onClose();
                navigate(hit.path);
              }}
              className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-raised/70"
            >
              <Icon size={15} className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{hit.title}</span>
                {hit.snippet && <span className="block truncate text-[11px] text-muted">{hit.snippet}</span>}
              </span>
              <Badge>{hit.kind}</Badge>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
