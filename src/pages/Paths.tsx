import { useMemo, useState } from 'react';
import { Check, Flame, Flag, ShieldCheck, Plus, Route as RouteIcon, History, Layout, Ban } from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { rpc, insertRow, updateRow } from '@/lib/api';
import {
  Badge, Button, Card, EmptyState, Field, InfoNote, Input, LoadingBlock, Modal,
  PageHeader, Tabs, Textarea, useToast,
} from '@/components/ui';
import { addDays, prettyDate, todayISO } from '@/lib/utils';
import type {
  DailyProgress, LearningPath, LearningPathNode, Section, StreakHistory,
} from '@/lib/types';

type LayoutMode = 'linear' | 'zigzag' | 'horizontal' | 'vertical';

const STAGES = [
  { stage: 1 as const, short: 'Started', label: 'I started today' },
  { stage: 2 as const, short: 'Learned', label: 'Today I learned something' },
  { stage: 3 as const, short: 'Practised', label: 'I practiced what I learned' },
];

export default function Paths() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: nodes, loading, reload } = useCollection<LearningPathNode>('learning_path_nodes', 'node_date', false);
  const { data: paths, reload: reloadPaths } = useCollection<LearningPath>('learning_paths', 'start_date', false);
  const { data: progress, reload: reloadProgress } = useCollection<DailyProgress>('learning_daily_progress', 'completed_at', false);
  const { data: history, reload: reloadHistory } = useCollection<StreakHistory>('streak_history', 'start_date', false);
  const { data: sections } = useCollection<Section>('sections', 'sort_order', true);

  const [layout, setLayout] = useState<LayoutMode>('horizontal');
  const [tab, setTab] = useState<'current' | 'history'>('current');
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceForm, setAdvanceForm] = useState({ stages: [1, 2, 3] as number[], evidence: '', verified: false, verifiedBy: 'manual' as 'manual' | 'auto' });
  const [busy, setBusy] = useState(false);
  const [verifyNode, setVerifyNode] = useState<LearningPathNode | null>(null);
  const [verifyNote, setVerifyNote] = useState('');

  void sections;

  const today = todayISO();
  const currentPath = paths.find((p) => p.is_current);
  const currentNodes = useMemo(
    () => nodes.filter((n) => n.path_id === currentPath?.id).sort((a, b) => a.seq_number - b.seq_number),
    [nodes, currentPath],
  );

  const todayNode = nodes.find((n) => n.node_date === today);
  const todayStages = progress.filter((p) => p.node_id === todayNode?.id).map((p) => p.stage);

  const streak = useMemo(() => {
    const dates = new Set(nodes.map((n) => n.node_date));
    let cursor = today;
    if (!dates.has(cursor)) cursor = addDays(cursor, -1);
    let count = 0;
    while (dates.has(cursor)) {
      count += 1;
      cursor = addDays(cursor, -1);
    }
    return count;
  }, [nodes, today]);

  const advance = async () => {
    setBusy(true);
    try {
      await rpc('advance_learning_path', {
        p_stages: advanceForm.stages,
        p_evidence: advanceForm.evidence.trim() || null,
        p_verified: advanceForm.verified,
        p_timezone: 'Asia/Kolkata',
      });
      if (advanceForm.verified) {
        // Mark the verification source explicitly; server keeps 'manual' unless
        // an integration supplied the evidence.
        const node = nodes.find((n) => n.node_date === today);
        if (node) {
          await updateRow('learning_path_nodes', node.id, {
            verification_source: advanceForm.verifiedBy,
            verified: true,
            note: advanceForm.evidence.trim() || node.note,
          });
        }
      }
      toast.success('Progress recorded.');
      setAdvanceOpen(false);
      setAdvanceForm({ stages: [1, 2, 3], evidence: '', verified: false, verifiedBy: 'manual' });
      reload();
      reloadPaths();
      reloadProgress();
      reloadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record progress.');
    } finally {
      setBusy(false);
    }
  };

  const toggleStage = async (node: LearningPathNode, stage: 1 | 2 | 3) => {
    if (!user) return;
    const existing = progress.find((p) => p.node_id === node.id && p.stage === stage);
    try {
      if (existing) {
        // Only the record itself is removed; node numbering and paths are untouched.
        const { supabase } = await import('@/lib/supabase');
        await supabase.from('learning_daily_progress').delete().eq('id', existing.id);
      } else {
        await insertRow('learning_daily_progress', {
          user_id: user.id,
          node_id: node.id,
          stage,
          evidence: null,
        });
      }
      reloadProgress();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the stage.');
    }
  };

  const saveVerification = async () => {
    if (!verifyNode) return;
    setBusy(true);
    try {
      await updateRow('learning_path_nodes', verifyNode.id, {
        verified: true,
        verification_source: 'manual',
        note: verifyNote.trim() || verifyNode.note,
      });
      toast.success('Node verified manually.');
      setVerifyNode(null);
      setVerifyNote('');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not verify the node.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        eyebrow="Momentum"
        title="Learning pathways"
        description="Each learning day becomes a numbered node. A broken streak closes the path and starts a new one — numbering never resets."
        actions={<Button variant="primary" icon={Plus} onClick={() => setAdvanceOpen(true)}>Record today</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div className="card p-3.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">Current streak</p>
          <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold text-ink"><Flame size={17} className="text-warn" />{streak}d</p>
        </div>
        <div className="card p-3.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">Current path</p>
          <p className="mt-1 text-sm font-semibold text-ink">{currentPath ? prettyDate(currentPath.start_date, 'd MMM yyyy') : '—'}</p>
          <p className="text-[10px] text-muted">{currentNodes.length} node{currentNodes.length === 1 ? '' : 's'}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">Total days</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{history.reduce((s, h) => s + h.days_count, 0) + currentNodes.length}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">Longest streak</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{Math.max(streak, ...history.map((h) => h.days_count), 0)}d</p>
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onChange={setTab} items={[{ value: 'current', label: 'Current path' }, { value: 'history', label: 'Past paths' }]} />
        {tab === 'current' && (
          <div className="flex items-center gap-1.5">
            <Layout size={13} className="text-muted" />
            <Tabs
              value={layout}
              onChange={setLayout}
              items={[
                { value: 'horizontal', label: 'Horizontal' },
                { value: 'vertical', label: 'Vertical' },
                { value: 'linear', label: 'Linear' },
                { value: 'zigzag', label: 'Zigzag' },
              ]}
            />
          </div>
        )}
      </div>

      {tab === 'current' ? (
        <Card
          title="Pathway"
          subtitle={currentPath ? `Started ${prettyDate(currentPath.start_date, 'd MMM yyyy')} · node numbers are global` : 'No path started yet'}
        >
          {currentNodes.length === 0 ? (
            <EmptyState
              icon={RouteIcon}
              title="Your first node is waiting"
              description="Record today's progress to create node #1 and open a path."
              action={<Button variant="primary" icon={Plus} onClick={() => setAdvanceOpen(true)}>Record today</Button>}
            />
          ) : (
            <PathCanvas nodes={currentNodes} progress={progress} layout={layout} onStage={toggleStage} onVerify={(node) => { setVerifyNode(node); setVerifyNote(node.note ?? ''); }} />
          )}

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {STAGES.map((stage) => {
              const done = todayStages.includes(stage.stage);
              return (
                <div key={stage.stage} className={clsx('rounded-xl border px-3 py-2', done ? 'border-ok/30 bg-ok/5' : 'border-line/60')}>
                  <p className="text-[10px] uppercase tracking-wider text-muted">Stage {stage.stage}</p>
                  <p className="mt-0.5 text-xs text-ink">{stage.label}</p>
                  <p className="mt-1 text-[10px] text-muted">{done ? 'completed today' : 'not recorded today'}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <InfoNote>
              Verification: <span className="text-ink">auto</span> means an integration supplied qualifying activity
              (for example a verified commit), <span className="text-ink">manual</span> means you confirmed it yourself
              with an optional note. A stage recorded without evidence is still valid progress, just unverified.
            </InfoNote>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {history.length === 0 && paths.filter((p) => !p.is_current).length === 0 ? (
            <Card>
              <EmptyState icon={History} title="No past paths yet" description="When a streak breaks, the completed path is preserved here with its dates and node numbers." />
            </Card>
          ) : (
            [...paths]
              .filter((p) => !p.is_current)
              .sort((a, b) => b.start_date.localeCompare(a.start_date))
              .map((path) => {
                const pathNodes = nodes.filter((n) => n.path_id === path.id).sort((a, b) => a.seq_number - b.seq_number);
                const record = history.find((h) => h.path_id === path.id);
                const stageCount = progress.filter((p) => pathNodes.some((n) => n.id === p.node_id)).length;
                return (
                  <Card key={path.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-ink">
                            {prettyDate(path.start_date, 'd MMM')} → {prettyDate(path.end_date ?? '', 'd MMM yyyy')}
                          </h3>
                          <Badge tone="neutral"><Ban size={9} /> broken</Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-muted">
                          Nodes {pathNodes[0]?.seq_number ?? '—'}–{pathNodes[pathNodes.length - 1]?.seq_number ?? '—'} ·{' '}
                          {record?.days_count ?? pathNodes.length} days · {stageCount} stages completed
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {pathNodes.map((node) => (
                          <span
                            key={node.id}
                            title={`#${node.seq_number} · ${prettyDate(node.node_date, 'd MMM')}`}
                            className={clsx(
                              'grid h-7 w-7 place-items-center rounded-full border text-[10px] font-semibold',
                              node.verified ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line bg-raised text-muted',
                            )}
                          >
                            {node.seq_number}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Card>
                );
              })
          )}
          {history.length > 0 && (
            <Card title="Streak records" subtitle="Immutable history of completed paths">
              <ul className="space-y-1.5">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-line/50 px-2.5 py-2 text-[11px]">
                    <span className="text-ink">{prettyDate(h.start_date, 'd MMM yyyy')} → {prettyDate(h.end_date, 'd MMM yyyy')}</span>
                    <span className="text-muted">{h.days_count} days · {h.stages_completed} stages</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      <Modal
        open={advanceOpen}
        onClose={() => setAdvanceOpen(false)}
        title="Record today's learning"
        description={`${prettyDate(today, 'EEEE, d MMMM yyyy')} · Asia/Kolkata`}
        footer={<><Button onClick={() => setAdvanceOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void advance()}>Save progress</Button></>}
      >
        <div className="space-y-4">
          <div>
            <span className="label">Stages completed today</span>
            <div className="space-y-1.5">
              {STAGES.map((stage) => {
                const checked = advanceForm.stages.includes(stage.stage);
                return (
                  <label key={stage.stage} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line/60 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setAdvanceForm((f) => ({
                          ...f,
                          stages: e.target.checked ? [...f.stages, stage.stage] : f.stages.filter((s) => s !== stage.stage),
                        }))
                      }
                      className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                    />
                    <span className="text-xs text-ink">{stage.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <Field label="Evidence / note" hint="What did you actually do? Links or a short description.">
            <Textarea value={advanceForm.evidence} onChange={(e) => setAdvanceForm({ ...advanceForm, evidence: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2.5 rounded-lg border border-line/60 px-3 py-2">
            <input
              type="checkbox"
              checked={advanceForm.verified}
              onChange={(e) => setAdvanceForm({ ...advanceForm, verified: e.target.checked })}
              className="h-4 w-4 accent-[rgb(var(--c-accent))]"
            />
            <span className="text-xs text-ink">Mark this node as verified</span>
          </label>
          {advanceForm.verified && (
            <Field label="Verification source">
              <Tabs
                value={advanceForm.verifiedBy}
                onChange={(value) => setAdvanceForm({ ...advanceForm, verifiedBy: value })}
                items={[{ value: 'manual', label: 'Manual confirmation' }, { value: 'auto', label: 'Integration evidence' }]}
              />
            </Field>
          )}
        </div>
      </Modal>

      <Modal
        open={Boolean(verifyNode)}
        onClose={() => setVerifyNode(null)}
        title={`Verify node #${verifyNode?.seq_number ?? ''}`}
        description={verifyNode ? prettyDate(verifyNode.node_date, 'EEEE, d MMMM yyyy') : ''}
        footer={<><Button onClick={() => setVerifyNode(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void saveVerification()}>Verify</Button></>}
      >
        <Field label="Evidence note" hint="Describe what you did — this is your own record, not an audit.">
          <Textarea value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}

function PathCanvas({
  nodes,
  progress,
  layout,
  onStage,
  onVerify,
}: {
  nodes: LearningPathNode[];
  progress: DailyProgress[];
  layout: LayoutMode;
  onStage: (node: LearningPathNode, stage: 1 | 2 | 3) => void;
  onVerify: (node: LearningPathNode) => void;
}) {
  const isVertical = layout === 'vertical';
  const isZigzag = layout === 'zigzag';

  return (
    <div className={clsx('relative', isVertical ? 'flex flex-col gap-0' : 'overflow-x-auto pb-2')}>
      <div
        className={clsx(
          isVertical ? 'flex flex-col items-start gap-0' : 'flex min-w-min items-start gap-0',
          isZigzag && 'items-center',
        )}
      >
        {nodes.map((node, index) => {
          const stages = progress.filter((p) => p.node_id === node.id).map((p) => p.stage);
          const complete = stages.length === 3;
          const offset = isZigzag ? (index % 2 === 0 ? 'translate-y-0' : 'translate-y-6') : '';
          return (
            <div key={node.id} className={clsx('relative flex', isVertical ? 'flex-row items-stretch' : 'flex-col items-center')}>
              <div className={clsx('flex', isVertical ? 'flex-col items-center' : 'w-full items-center', offset)}>
                <div className={clsx('flex', isVertical ? 'flex-col items-center' : 'items-center')}>
                  {index > 0 && (
                    <span
                      aria-hidden
                      className={clsx(
                        'bg-line',
                        isVertical ? 'h-6 w-px' : 'h-px w-8 sm:w-12',
                      )}
                    />
                  )}
                  <button
                    onClick={() => onVerify(node)}
                    title={`Node #${node.seq_number} · ${prettyDate(node.node_date, 'd MMM')} — click to verify`}
                    className={clsx(
                      'grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 text-[11px] font-semibold transition',
                      complete
                        ? 'border-ok bg-ok/15 text-ok'
                        : node.verified
                          ? 'border-accent/60 bg-accent/10 text-accent'
                          : 'border-line bg-surface text-muted hover:border-accent/50',
                    )}
                  >
                    <span>#{node.seq_number}</span>
                  </button>
                  {index < nodes.length - 1 && (
                    <span aria-hidden className={clsx('bg-line', isVertical ? 'h-6 w-px' : 'h-px w-8 sm:w-12')} />
                  )}
                </div>
                <div className={clsx('mt-1.5 w-[104px] text-center', isVertical && 'mt-0 w-[140px] pb-3 text-left')}>
                  <p className="text-[10px] text-muted">{prettyDate(node.node_date, 'd MMM')}</p>
                  <div className="mt-1 flex justify-center gap-1">
                    {STAGES.map((stage) => {
                      const active = stages.includes(stage.stage);
                      return (
                        <button
                          key={stage.stage}
                          onClick={() => onStage(node, stage.stage)}
                          title={`${stage.label} — click to toggle`}
                          aria-label={`Stage ${stage.stage} for node ${node.seq_number}`}
                          className={clsx(
                            'grid h-4 w-4 place-items-center rounded-full border',
                            active ? 'border-ok bg-ok/70 text-white' : 'border-line bg-raised',
                          )}
                        >
                          {active && <Check size={8} />}
                        </button>
                      );
                    })}
                  </div>
                  {node.verified ? (
                    <p className="mt-1 inline-flex items-center gap-0.5 text-[9px] text-ok">
                      <ShieldCheck size={9} /> {node.verification_source}
                    </p>
                  ) : (
                    <p className="mt-1 text-[9px] text-muted/70">unverified</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3 text-[10px] text-muted">
        <span className="flex items-center gap-1"><Flag size={10} /> node number is global across all paths</span>
      </div>
    </div>
  );
}
