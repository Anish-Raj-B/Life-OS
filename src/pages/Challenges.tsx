import { useMemo, useRef, useState } from 'react';
import {
  Trophy, Plus, Clock, Check, X, Sparkles, ChevronRight, Trash2, BookOpen, RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { deleteRow, insertRow, invokeFunction, updateRow } from '@/lib/api';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, Modal,
  PageHeader, Progress, Select, Tabs, Textarea, useToast,
} from '@/components/ui';
import { buildQuestions, grade, isCorrect, isSelfGraded } from '@/lib/challenges';
import { prettyDate, todayISO } from '@/lib/utils';
import type {
  Challenge, ChallengeAnswer, ChallengeAttempt, ChallengeQuestion, Flashcard,
  FlashcardDeck, QuestionBankItem, Section, Topic,
} from '@/lib/types';

interface BuilderState {
  title: string;
  section_id: string;
  topic_ids: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'mixed';
  count: number;
  useAI: boolean;
  manual: { question: string; answer: string; explanation: string; type: string; options: string }[];
}

const blankBuilder = (): BuilderState => ({
  title: '',
  section_id: '',
  topic_ids: [],
  difficulty: 'mixed',
  count: 10,
  useAI: false,
  manual: [],
});

export default function Challenges() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: challenges, loading, reload } = useCollection<Challenge>('challenges', 'created_at', false);
  const { data: questions, reload: reloadQuestions } = useCollection<ChallengeQuestion>('challenge_questions', 'position', true);
  const { data: attempts, reload: reloadAttempts } = useCollection<ChallengeAttempt>('challenge_attempts', 'started_at', false);
  const { data: answers, reload: reloadAnswers } = useCollection<ChallengeAnswer>('challenge_answers', 'created_at', false);
  const { data: bank } = useCollection<QuestionBankItem>('question_bank', 'created_at', false);
  const { data: cards } = useCollection<Flashcard>('flashcards', 'created_at', false);
  const { data: decks } = useCollection<FlashcardDeck>('flashcard_decks', 'created_at', false);
  const { data: sections } = useCollection<Section>('sections', 'sort_order', true);
  const { data: topics } = useCollection<Topic>('topics', 'sort_order', true);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [builder, setBuilder] = useState<BuilderState>(blankBuilder());
  const [creating, setCreating] = useState(false);
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
  const [runnerIndex, setRunnerIndex] = useState(0);
  const [responses, setResponses] = useState<Record<string, { answer: string; self?: boolean }>>({});
  const [startedAt, setStartedAt] = useState<number>(0);
  const [result, setResult] = useState<{
    attemptId: string;
    score: number;
    total: number;
    percentage: number;
    graded: ReturnType<typeof grade>['graded'];
    breakdown: ReturnType<typeof grade>['breakdown'];
    duration: number;
  } | null>(null);
  const [deleting, setDeleting] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'challenges' | 'history' | 'bank'>('challenges');
  const [bankForm, setBankForm] = useState({ section_id: '', topic_id: '', type: 'multiple_choice', question: '', options: '', correct_answer: '', explanation: '', difficulty: 'intermediate' });
  const [bankOpen, setBankOpen] = useState(false);
  const startedRef = useRef<number>(0);
  void startedAt;
  void decks;

  const activeChallenges = challenges;
  const attemptHistory = attempts.filter((a) => a.completed_at);

  const activeChallengeQuestions = useMemo(
    () => questions.filter((q) => q.challenge_id === activeChallenge?.id).sort((a, b) => a.position - b.position),
    [questions, activeChallenge],
  );

  const topicName = (id: string | null) => topics.find((t) => t.id === id)?.name ?? 'Unassigned';

  const topicOptions = builder.section_id
    ? topics.filter((t) => t.section_id === builder.section_id)
    : topics;

  const create = async () => {
    if (!user) return;
    const selectedTopics = builder.topic_ids;
    if (selectedTopics.length === 0 && !builder.section_id) {
      toast.error('Select a section or at least one topic.');
      return;
    }

    setCreating(true);
    try {
      const deckTopicIds = new Set(topics.filter((t) => selectedTopics.includes(t.id)).map((t) => t.id));
      const poolCards = cards.filter((c) => {
        if (c.deleted_at) return false;
        const deck = decks.find((d) => d.id === c.deck_id);
        if (!deck) return false;
        if (deck.topic_id && deckTopicIds.has(deck.topic_id)) return true;
        if (deck.section_id && deck.section_id === builder.section_id) return true;
        return false;
      });

      let drafts = buildQuestions({
        topicIds: selectedTopics,
        difficulty: builder.difficulty,
        count: builder.count,
        bank,
        flashcards: poolCards,
        sectionId: builder.section_id || null,
      }).map((d) => ({ ...d, topic_id: d.topic_id ?? selectedTopics[0] ?? null }));

      // Manual questions always take priority when supplied.
      if (builder.manual.length) {
        const manual = builder.manual
          .filter((m) => m.question.trim() && m.answer.trim())
          .map((m) => ({
            type: m.type as any,
            question: m.question.trim(),
            options: m.options.split('\n').map((o) => o.trim()).filter(Boolean),
            correct_answer: m.answer.trim(),
            explanation: m.explanation.trim() || null,
            topic_id: selectedTopics[0] ?? null,
            difficulty: builder.difficulty === 'mixed' ? 'intermediate' : builder.difficulty,
          }));
        drafts = [...manual, ...drafts].slice(0, builder.count);
      }

      if (builder.useAI) {
        try {
          const ai = await invokeFunction<{ ok: boolean; questions?: any[]; reason?: string; message?: string }>(
            'ai-questions',
            { topic_ids: selectedTopics, difficulty: builder.difficulty, count: builder.count },
          );
          if (ai.ok && ai.questions?.length) {
            const aiDrafts = ai.questions.map((q) => ({
              type: q.type,
              question: q.question,
              options: q.options ?? [],
              correct_answer: q.correct_answer,
              explanation: q.explanation ?? null,
              topic_id: selectedTopics[0] ?? null,
              difficulty: builder.difficulty === 'mixed' ? 'intermediate' : builder.difficulty,
            }));
            drafts = [...drafts, ...aiDrafts].slice(0, builder.count);
            toast.info('AI questions added (stored with source "ai").');
          } else {
            toast.info(
              ai.reason === 'ai_not_configured'
                ? 'AI is not configured — using your own question bank instead.'
                : ai.message ?? 'AI generation unavailable — using your own question bank.',
            );
          }
        } catch {
          toast.info('AI request failed — continuing with your own question bank.');
        }
      }

      if (drafts.length === 0) {
        toast.error('No questions available for that selection. Add flashcards, bank questions, or write them manually.');
        return;
      }

      const challengePayload = {
        user_id: user.id,
        title: builder.title.trim() || `${topicName(selectedTopics[0] ?? null)} challenge`,
        section_id: builder.section_id || null,
        topic_ids: selectedTopics,
        difficulty: builder.difficulty,
        question_count: drafts.length,
        source: builder.useAI ? 'ai' : 'bank',
      };
      const created = await insertRow<Challenge>('challenges', challengePayload);
      const challengeId = created.row.id;

      for (let i = 0; i < drafts.length; i += 1) {
        const draft = drafts[i];
        await insertRow('challenge_questions', {
          user_id: user.id,
          challenge_id: challengeId,
          topic_id: draft.topic_id,
          position: i + 1,
          type: draft.type,
          question: draft.question,
          options: draft.options,
          correct_answer: draft.correct_answer,
          explanation: draft.explanation,
          difficulty: draft.difficulty,
        });
      }

      await reload();
      await reloadQuestions();
      setBuilderOpen(false);
      setBuilder(blankBuilder());
      const full = { ...created.row, question_count: drafts.length } as Challenge;
      startChallenge(full);
      toast.success(`${drafts.length} questions ready.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the challenge.');
    } finally {
      setCreating(false);
    }
  };

  const startChallenge = (challenge: Challenge) => {
    const count = questions.filter((q) => q.challenge_id === challenge.id).length;
    if (count === 0) {
      toast.error('This challenge has no questions.');
      return;
    }
    setActiveChallenge(challenge);
    setRunnerIndex(0);
    setResponses({});
    setResult(null);
    startedRef.current = Date.now();
    setStartedAt(Date.now());
  };

  const submit = async () => {
    if (!user || !activeChallenge) return;
    const graded = grade(activeChallengeQuestions, responses);
    const duration = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
    setBusy(true);
    try {
      const attempt = await insertRow<ChallengeAttempt>('challenge_attempts', {
        user_id: user.id,
        challenge_id: activeChallenge.id,
        started_at: new Date(startedRef.current).toISOString(),
        completed_at: new Date().toISOString(),
        score: graded.score,
        total: graded.total,
        duration_seconds: duration,
        topic_breakdown: graded.breakdown,
      });

      for (const item of graded.graded) {
        await insertRow('challenge_answers', {
          user_id: user.id,
          attempt_id: attempt.row.id,
          question_id: item.question.id,
          answer: item.answer,
          is_correct: item.correct,
          time_seconds: null,
        });
      }

      setResult({
        attemptId: attempt.row.id,
        score: graded.score,
        total: graded.total,
        percentage: graded.percentage,
        graded: graded.graded,
        breakdown: graded.breakdown,
        duration,
      });
      reloadAttempts();
      reloadAnswers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the attempt.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteRow('challenges', deleting.id);
      toast.success('Challenge deleted.');
      setDeleting(null);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  };

  const saveBankItem = async () => {
    if (!user || !bankForm.question.trim() || !bankForm.correct_answer.trim()) {
      toast.error('Question and answer are required.');
      return;
    }
    setBusy(true);
    try {
      await insertRow('question_bank', {
        user_id: user.id,
        section_id: bankForm.section_id || null,
        topic_id: bankForm.topic_id || null,
        type: bankForm.type,
        question: bankForm.question.trim(),
        options: bankForm.options.split('\n').map((o) => o.trim()).filter(Boolean),
        correct_answer: bankForm.correct_answer.trim(),
        explanation: bankForm.explanation.trim() || null,
        difficulty: bankForm.difficulty,
        source: 'manual',
      });
      toast.success('Question saved to your bank.');
      setBankOpen(false);
      setBankForm({ section_id: '', topic_id: '', type: 'multiple_choice', question: '', options: '', correct_answer: '', explanation: '', difficulty: 'intermediate' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the question.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock />;

  const currentQuestion = activeChallengeQuestions[runnerIndex];
  const answeredCount = Object.keys(responses).length;

  const best = attemptHistory.length ? Math.max(...attemptHistory.map((a) => (a.total ? a.score / a.total : 0))) : 0;
  const average = attemptHistory.length
    ? Math.round(
        (attemptHistory.reduce((s, a) => s + (a.total ? a.score / a.total : 0), 0) / attemptHistory.length) * 100,
      )
    : null;

  return (
    <div>
      <PageHeader
        eyebrow="Assessment"
        title="Challenges"
        description="Test yourself using only the material you have recorded. AI is optional; your bank and flashcards always work."
        actions={
          <>
            <Button icon={BookOpen} onClick={() => setBankOpen(true)}>Add bank question</Button>
            <Button variant="primary" icon={Plus} onClick={() => setBuilderOpen(true)}>New challenge</Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-3.5"><p className="text-[10px] uppercase tracking-wider text-muted">Challenges</p><p className="mt-1 text-2xl font-semibold text-ink">{activeChallenges.length}</p></div>
        <div className="card p-3.5"><p className="text-[10px] uppercase tracking-wider text-muted">Attempts</p><p className="mt-1 text-2xl font-semibold text-ink">{attemptHistory.length}</p></div>
        <div className="card p-3.5"><p className="text-[10px] uppercase tracking-wider text-muted">Best score</p><p className="mt-1 text-2xl font-semibold text-ok">{attemptHistory.length ? `${Math.round(best * 100)}%` : '—'}</p></div>
        <div className="card p-3.5"><p className="text-[10px] uppercase tracking-wider text-muted">Average</p><p className="mt-1 text-2xl font-semibold text-accent">{average === null ? '—' : `${average}%`}</p></div>
      </div>

      <div className="mb-3">
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'challenges', label: 'Challenges' },
          { value: 'history', label: 'History' },
          { value: 'bank', label: `Question bank (${bank.length})` },
        ]} />
      </div>

      {tab === 'challenges' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {activeChallenges.length === 0 && (
            <div className="sm:col-span-2">
              <Card><EmptyState icon={Trophy} title="No challenges yet" description="Build one from your flashcards or question bank." action={<Button variant="primary" icon={Plus} onClick={() => setBuilderOpen(true)}>Create challenge</Button>} /></Card>
            </div>
          )}
          {activeChallenges.map((challenge) => {
            const count = questions.filter((q) => q.challenge_id === challenge.id).length;
            const attemptsForChallenge = attemptHistory.filter((a) => a.challenge_id === challenge.id);
            const last = attemptsForChallenge[0];
            return (
              <Card key={challenge.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-ink">{challenge.title}</h3>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {count} question{count === 1 ? '' : 's'} · {challenge.difficulty} · source {challenge.source}
                    </p>
                    {last && (
                      <p className="mt-1 text-[11px] text-muted">
                        Last: <span className={last.total && last.score / last.total >= 0.7 ? 'text-ok' : 'text-warn'}>{last.score}/{last.total}</span>
                        {' '}· {prettyDate(last.completed_at, 'd MMM HH:mm')}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="primary" onClick={() => startChallenge(challenge)}>Take</Button>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDeleting(challenge)} aria-label="Delete challenge" />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {tab === 'history' && (
        <Card title="Attempt history" subtitle="Every attempt is stored with its topic breakdown">
          {attemptHistory.length === 0 ? (
            <EmptyState icon={Trophy} title="No completed attempts" description="Finish a challenge to see results here." />
          ) : (
            <div className="space-y-2">
              {attemptHistory.map((attempt, i) => {
                const challenge = challenges.find((c) => c.id === attempt.challenge_id);
                const previous = attemptHistory[i + 1];
                const delta = previous && previous.total ? Math.round(((attempt.score / attempt.total) - (previous.score / previous.total)) * 100) : null;
                return (
                  <div key={attempt.id} className="rounded-xl border border-line/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-ink">{challenge?.title ?? 'Deleted challenge'}</p>
                        <p className="text-[10px] text-muted">
                          {prettyDate(attempt.completed_at, 'd MMM yyyy HH:mm')} · {attempt.duration_seconds ?? 0}s
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {delta !== null && (
                          <Badge tone={delta >= 0 ? 'ok' : 'danger'}>{delta >= 0 ? '+' : ''}{delta}% vs previous</Badge>
                        )}
                        <Badge tone={attempt.total && attempt.score / attempt.total >= 0.7 ? 'ok' : 'warn'}>
                          {attempt.score}/{attempt.total} · {attempt.total ? Math.round((attempt.score / attempt.total) * 100) : 0}%
                        </Badge>
                      </div>
                    </div>
                    {attempt.topic_breakdown?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {attempt.topic_breakdown.map((row) => (
                          <span key={row.topic_id ?? 'unassigned'} className="chip">
                            {topicName(row.topic_id)}: {row.correct}/{row.total}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {tab === 'bank' && (
        <Card title="Your question bank" subtitle="Ambient questions reused when building challenges">
          {bank.length === 0 ? (
            <EmptyState icon={BookOpen} title="No saved questions" description="Add questions manually, or convert flashcards by creating a challenge." action={<Button onClick={() => setBankOpen(true)} icon={Plus}>Add question</Button>} />
          ) : (
            <div className="space-y-1.5">
              {bank.map((item) => (
                <div key={item.id} className="rounded-lg border border-line/50 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs text-ink">{item.question}</p>
                    <div className="flex shrink-0 gap-1"><Badge>{item.type}</Badge><Badge tone="info">{item.difficulty}</Badge></div>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">Answer: {item.correct_answer}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Builder */}
      <Modal
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        title="Build a challenge"
        description="Questions come from your selected topics only."
        wide
        footer={<><Button onClick={() => setBuilderOpen(false)}>Cancel</Button><Button variant="primary" loading={creating} onClick={() => void create()}>Create & start</Button></>}
      >
        <div className="space-y-3">
          <Field label="Title"><Input value={builder.title} onChange={(e) => setBuilder({ ...builder, title: e.target.value })} placeholder="Optional — defaults to topic name" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Section">
              <Select value={builder.section_id} onChange={(e) => setBuilder({ ...builder, section_id: e.target.value, topic_ids: [] })}>
                <option value="">All sections</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Difficulty">
              <Select value={builder.difficulty} onChange={(e) => setBuilder({ ...builder, difficulty: e.target.value as BuilderState['difficulty'] })}>
                <option value="mixed">Mixed</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </Select>
            </Field>
            <Field label="Questions">
              <Select value={String(builder.count)} onChange={(e) => setBuilder({ ...builder, count: Number(e.target.value) })}>
                {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n} questions</option>)}
                <option value="25">25 questions</option>
                <option value="30">30 questions</option>
              </Select>
            </Field>
            <Field label="AI generation" hint="Optional. Requires a server-side key; your bank always works.">
              <div className="flex h-[38px] items-center gap-2 rounded-xl border border-line bg-raised/70 px-3">
                <input type="checkbox" id="use-ai" checked={builder.useAI} onChange={(e) => setBuilder({ ...builder, useAI: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--c-accent))]" />
                <label htmlFor="use-ai" className="text-xs text-ink">Ask AI for extra questions</label>
                <Sparkles size={13} className="ml-auto text-accent" />
              </div>
            </Field>
          </div>

          <div>
            <span className="label">Topics ({builder.topic_ids.length} selected)</span>
            <div className="max-h-40 overflow-y-auto rounded-xl border border-line p-2">
              {topicOptions.length === 0 && <p className="px-1 py-2 text-xs text-muted">No topics in this section.</p>}
              {topicOptions.map((topic) => (
                <label key={topic.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-raised/60">
                  <input
                    type="checkbox"
                    checked={builder.topic_ids.includes(topic.id)}
                    onChange={(e) =>
                      setBuilder((b) => ({
                        ...b,
                        topic_ids: e.target.checked ? [...b.topic_ids, topic.id] : b.topic_ids.filter((id) => id !== topic.id),
                      }))
                    }
                    className="h-3.5 w-3.5 accent-[rgb(var(--c-accent))]"
                  />
                  <span className="text-ink">{topic.name}</span>
                  <span className="ml-auto text-[10px] text-muted">
                    {bank.filter((q) => q.topic_id === topic.id).length} bank
                  </span>
                </label>
              ))}
            </div>
            {builder.section_id && <p className="mt-1 text-[10px] text-muted">Selecting topics narrows the pool; leaving all unchecked uses the whole section.</p>}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label !mb-0">Write questions manually (optional)</span>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => setBuilder({ ...builder, manual: [...builder.manual, { question: '', answer: '', explanation: '', type: 'multiple_choice', options: '' }] })}>Add</Button>
            </div>
            <div className="space-y-2">
              {builder.manual.map((item, index) => (
                <div key={index} className="space-y-1.5 rounded-xl border border-line/60 p-2.5">
                  <div className="flex gap-2">
                    <Select value={item.type} onChange={(e) => { const next = [...builder.manual]; next[index] = { ...item, type: e.target.value }; setBuilder({ ...builder, manual: next }); }} className="!w-40 !py-1 !text-xs">
                      <option value="multiple_choice">Multiple choice</option>
                      <option value="true_false">True / false</option>
                      <option value="fill_blank">Fill blank</option>
                      <option value="scenario">Scenario</option>
                      <option value="conceptual">Conceptual</option>
                      <option value="practical">Practical</option>
                    </Select>
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setBuilder({ ...builder, manual: builder.manual.filter((_, i) => i !== index) })} aria-label="Remove" />
                  </div>
                  <Textarea placeholder="Question" value={item.question} onChange={(e) => { const next = [...builder.manual]; next[index] = { ...item, question: e.target.value }; setBuilder({ ...builder, manual: next }); }} className="min-h-[56px] text-xs" />
                  {item.type === 'multiple_choice' && (
                    <Textarea placeholder="One option per line" value={item.options} onChange={(e) => { const next = [...builder.manual]; next[index] = { ...item, options: e.target.value }; setBuilder({ ...builder, manual: next }); }} className="min-h-[56px] text-xs" />
                  )}
                  <Input placeholder="Correct answer" value={item.answer} onChange={(e) => { const next = [...builder.manual]; next[index] = { ...item, answer: e.target.value }; setBuilder({ ...builder, manual: next }); }} />
                  <Input placeholder="Explanation (optional)" value={item.explanation} onChange={(e) => { const next = [...builder.manual]; next[index] = { ...item, explanation: e.target.value }; setBuilder({ ...builder, manual: next }); }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Runner */}
      <Modal
        open={Boolean(activeChallenge) && !result}
        onClose={() => setActiveChallenge(null)}
        title={activeChallenge?.title ?? 'Challenge'}
        description={activeChallenge ? `Question ${Math.min(runnerIndex + 1, activeChallengeQuestions.length)} of ${activeChallengeQuestions.length}` : ''}
        wide
        footer={
          <>
            <Button onClick={() => setActiveChallenge(null)}>Exit</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={answeredCount < activeChallengeQuestions.length}
              onClick={() => void submit()}
              icon={Check}
            >
              Submit ({answeredCount}/{activeChallengeQuestions.length})
            </Button>
          </>
        }
      >
        {currentQuestion && (
          <div>
            <Progress value={((runnerIndex + 1) / activeChallengeQuestions.length) * 100} />
            <div className="mt-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="accent">{currentQuestion.type.replace('_', ' ')}</Badge>
                <Badge>{currentQuestion.difficulty}</Badge>
                <Badge tone="info">{topicName(currentQuestion.topic_id)}</Badge>
              </div>
              <p className="mt-3 text-sm font-medium leading-relaxed text-ink">{currentQuestion.question}</p>

              <div className="mt-3 space-y-1.5">
                {currentQuestion.options?.length > 0 ? (
                  currentQuestion.options.map((option) => {
                    const selected = responses[currentQuestion.id]?.answer === option;
                    return (
                      <button
                        key={option}
                        onClick={() => setResponses({ ...responses, [currentQuestion.id]: { answer: option } })}
                        className={clsx(
                          'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition',
                          selected ? 'border-accent bg-accent/10 text-ink' : 'border-line/70 text-muted hover:border-accent/40',
                        )}
                      >
                        <span className={clsx('grid h-4 w-4 shrink-0 place-items-center rounded-full border', selected ? 'border-accent bg-accent text-white' : 'border-line')}>
                          {selected && <Check size={9} />}
                        </span>
                        {option}
                      </button>
                    );
                  })
                ) : isSelfGraded(currentQuestion.type) ? (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Write your answer…"
                      value={responses[currentQuestion.id]?.answer ?? ''}
                      onChange={(e) => setResponses({ ...responses, [currentQuestion.id]: { answer: e.target.value, self: responses[currentQuestion.id]?.self } })}
                      className="min-h-[100px] text-xs"
                    />
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line/60 px-3 py-2 text-xs">
                      <input
                        type="checkbox"
                        checked={Boolean(responses[currentQuestion.id]?.self)}
                        onChange={(e) => setResponses({ ...responses, [currentQuestion.id]: { answer: responses[currentQuestion.id]?.answer ?? '', self: e.target.checked } })}
                        className="h-3.5 w-3.5 accent-[rgb(var(--c-accent))]"
                      />
                      I answered this correctly (self-assessed)
                    </label>
                  </div>
                ) : (
                  <Input
                    placeholder="Type your answer…"
                    value={responses[currentQuestion.id]?.answer ?? ''}
                    onChange={(e) => setResponses({ ...responses, [currentQuestion.id]: { answer: e.target.value } })}
                  />
                )}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <Button size="sm" variant="ghost" disabled={runnerIndex === 0} onClick={() => setRunnerIndex(runnerIndex - 1)}>Previous</Button>
                <Button
                  size="sm"
                  icon={ChevronRight}
                  disabled={runnerIndex >= activeChallengeQuestions.length - 1}
                  onClick={() => setRunnerIndex(runnerIndex + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Results */}
      <Modal
        open={Boolean(result)}
        onClose={() => { setResult(null); setActiveChallenge(null); }}
        title="Challenge results"
        description={`${result?.score}/${result?.total} correct · ${result?.duration}s`}
        wide
        footer={<Button variant="primary" onClick={() => { setResult(null); setActiveChallenge(null); }}>Done</Button>}
      >
        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-xl border border-line bg-raised/40 p-4">
              <div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 border-accent/30">
                <span className="text-lg font-semibold text-ink">{result.percentage}%</span>
              </div>
              <div>
                <p className="text-sm text-ink">
                  {result.percentage >= 80 ? 'Strong result.' : result.percentage >= 50 ? 'Reasonable — some gaps.' : 'Needs revision.'}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {result.score} correct · {result.total - result.score} incorrect · {result.duration}s
                </p>
              </div>
            </div>

            {result.breakdown.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Topic performance</p>
                <div className="space-y-1.5">
                  {result.breakdown.map((row) => (
                    <div key={row.topic_id ?? 'unassigned'} className="flex items-center gap-2 text-[11px]">
                      <span className="w-32 shrink-0 truncate text-ink">{topicName(row.topic_id)}</span>
                      <Progress value={(row.correct / Math.max(row.total, 1)) * 100} tone={row.correct === row.total ? 'ok' : row.correct / row.total >= 0.5 ? 'warn' : 'danger'} />
                      <span className="w-10 shrink-0 text-right text-muted">{row.correct}/{row.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Answer review</p>
              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {result.graded.map((item, i) => (
                  <div key={item.question.id} className={clsx('rounded-xl border p-3', item.correct ? 'border-ok/30 bg-ok/5' : 'border-danger/30 bg-danger/5')}>
                    <div className="flex items-start gap-2">
                      <span className={clsx('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full', item.correct ? 'bg-ok text-white' : 'bg-danger text-white')}>
                        {item.correct ? <Check size={10} /> : <X size={10} />}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-ink">{i + 1}. {item.question.question}</p>
                        <p className="mt-1 text-[11px] text-muted">Your answer: <span className="text-ink">{item.answer || '—'}</span></p>
                        {!item.correct && <p className="text-[11px] text-ok">Correct: {item.question.correct_answer}</p>}
                        {item.question.explanation && <p className="mt-1 text-[11px] leading-relaxed text-muted">{item.question.explanation}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {result.breakdown.filter((b) => b.correct / b.total < 0.6).length > 0 && (
              <div className="rounded-xl border border-warn/30 bg-warn/5 p-3">
                <p className="text-[11px] font-medium text-warn">Recommended revision</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {result.breakdown.filter((b) => b.correct / b.total < 0.6).map((b) => topicName(b.topic_id)).join(', ')}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={bankOpen}
        onClose={() => setBankOpen(false)}
        title="Add a question to your bank"
        footer={<><Button onClick={() => setBankOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void saveBankItem()}>Save question</Button></>}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Section">
              <Select value={bankForm.section_id} onChange={(e) => setBankForm({ ...bankForm, section_id: e.target.value, topic_id: '' })}>
                <option value="">None</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Topic">
              <Select value={bankForm.topic_id} onChange={(e) => setBankForm({ ...bankForm, topic_id: e.target.value })}>
                <option value="">None</option>
                {topics.filter((t) => !bankForm.section_id || t.section_id === bankForm.section_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </Field>
            <Field label="Type">
              <Select value={bankForm.type} onChange={(e) => setBankForm({ ...bankForm, type: e.target.value })}>
                <option value="multiple_choice">Multiple choice</option>
                <option value="true_false">True / false</option>
                <option value="fill_blank">Fill blank</option>
                <option value="scenario">Scenario</option>
                <option value="conceptual">Conceptual</option>
                <option value="practical">Practical</option>
              </Select>
            </Field>
            <Field label="Difficulty">
              <Select value={bankForm.difficulty} onChange={(e) => setBankForm({ ...bankForm, difficulty: e.target.value })}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </Select>
            </Field>
          </div>
          <Field label="Question"><Textarea value={bankForm.question} onChange={(e) => setBankForm({ ...bankForm, question: e.target.value })} /></Field>
          <Field label="Options" hint="One per line (multiple choice only)"><Textarea value={bankForm.options} onChange={(e) => setBankForm({ ...bankForm, options: e.target.value })} /></Field>
          <Field label="Correct answer"><Input value={bankForm.correct_answer} onChange={(e) => setBankForm({ ...bankForm, correct_answer: e.target.value })} /></Field>
          <Field label="Explanation"><Textarea value={bankForm.explanation} onChange={(e) => setBankForm({ ...bankForm, explanation: e.target.value })} /></Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete challenge"
        message={`"${deleting?.title ?? ''}" and its questions will be deleted. Completed attempts keep their scores in history.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
