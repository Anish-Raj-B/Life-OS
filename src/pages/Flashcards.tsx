import { useMemo, useState } from 'react';
import {
  Plus, Pencil, Trash2, RotateCcw, ChevronLeft, ChevronRight, Shuffle, ExternalLink,
  CreditCard, GraduationCap, TrendingUp,
} from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import { useAuth } from '@/context/AuthContext';
import { deleteRow, insertRow, updateRow } from '@/lib/api';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, LoadingBlock, Modal,
  PageHeader, Progress, Select, TagInput, Tabs, Textarea, useToast,
} from '@/components/ui';
import { RATINGS, retention, schedule } from '@/lib/srs';
import { prettyDate, safeUrl, todayISO } from '@/lib/utils';
import type { Flashcard, FlashcardDeck, FlashcardReview, Section, Topic } from '@/lib/types';

type CardForm = {
  question: string;
  answer: string;
  explanation: string;
  reference_url: string;
  tags: string[];
};

const blankCard = (): CardForm => ({ question: '', answer: '', explanation: '', reference_url: '', tags: [] });

export default function Flashcards() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: decks, loading, reload } = useCollection<FlashcardDeck>('flashcard_decks', 'created_at', false);
  const { data: cards, reload: reloadCards } = useCollection<Flashcard>('flashcards', 'created_at', false);
  const { data: reviews, reload: reloadReviews } = useCollection<FlashcardReview>('flashcard_reviews', 'reviewed_at', false);
  const { data: sections } = useCollection<Section>('sections', 'sort_order', true);
  const { data: topics } = useCollection<Topic>('topics', 'sort_order', true);

  const [tab, setTab] = useState<'decks' | 'study' | 'history'>('decks');
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const [deckModal, setDeckModal] = useState(false);
  const [editingDeck, setEditingDeck] = useState<FlashcardDeck | null>(null);
  const [deckForm, setDeckForm] = useState({ name: '', description: '', section_id: '', topic_id: '' });
  const [cardModal, setCardModal] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [cardForm, setCardForm] = useState<CardForm>(blankCard());
  const [deletingDeck, setDeletingDeck] = useState<FlashcardDeck | null>(null);
  const [deletingCard, setDeletingCard] = useState<Flashcard | null>(null);
  const [busy, setBusy] = useState(false);

  // study session
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [sessionDone, setSessionDone] = useState(0);
  const [scope, setScope] = useState<'due' | 'all'>('due');

  const activeDecks = useMemo(() => decks.filter((d) => !d.deleted_at), [decks]);
  const activeCards = useMemo(() => cards.filter((c) => !c.deleted_at), [cards]);
  const deckCards = useMemo(
    () => activeCards.filter((c) => (selectedDeck ? c.deck_id === selectedDeck : true)),
    [activeCards, selectedDeck],
  );

  const dueNow = activeCards.filter((c) => c.due_date <= todayISO());
  const learned = activeCards.filter((c) => c.repetitions > 0);
  const retentionRate = retention(reviews);

  const deckName = (id: string) => activeDecks.find((d) => d.id === id)?.name ?? 'Deck';

  const openDeck = (deck?: FlashcardDeck) => {
    setEditingDeck(deck ?? null);
    setDeckForm({
      name: deck?.name ?? '',
      description: deck?.description ?? '',
      section_id: deck?.section_id ?? '',
      topic_id: deck?.topic_id ?? '',
    });
    setDeckModal(true);
  };

  const saveDeck = async () => {
    if (!user || !deckForm.name.trim()) return;
    setBusy(true);
    try {
      if (editingDeck) {
        await updateRow('flashcard_decks', editingDeck.id, {
          name: deckForm.name.trim(),
          description: deckForm.description.trim() || null,
          section_id: deckForm.section_id || null,
          topic_id: deckForm.topic_id || null,
        }, editingDeck.version);
        toast.success('Deck updated.');
      } else {
        await insertRow('flashcard_decks', {
          user_id: user.id,
          name: deckForm.name.trim(),
          description: deckForm.description.trim() || null,
          section_id: deckForm.section_id || null,
          topic_id: deckForm.topic_id || null,
        });
        toast.success('Deck created.');
      }
      setDeckModal(false);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the deck.');
    } finally {
      setBusy(false);
    }
  };

  const openCard = (deckId: string, card?: Flashcard) => {
    setSelectedDeck(deckId);
    setEditingCard(card ?? null);
    setCardForm(
      card
        ? {
            question: card.question,
            answer: card.answer,
            explanation: card.explanation ?? '',
            reference_url: card.reference_url ?? '',
            tags: card.tags ?? [],
          }
        : blankCard(),
    );
    setCardModal(true);
  };

  const saveCard = async () => {
    if (!user || !selectedDeck || !cardForm.question.trim() || !cardForm.answer.trim()) {
      toast.error('Both a question and an answer are required.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        user_id: user.id,
        deck_id: selectedDeck,
        question: cardForm.question.trim(),
        answer: cardForm.answer.trim(),
        explanation: cardForm.explanation.trim() || null,
        reference_url: safeUrl(cardForm.reference_url),
        tags: cardForm.tags,
      };
      if (editingCard) {
        await updateRow('flashcards', editingCard.id, payload, editingCard.version);
        toast.success('Card updated.');
      } else {
        await insertRow('flashcards', payload);
        toast.success('Card added.');
      }
      setCardModal(false);
      reloadCards();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the card.');
    } finally {
      setBusy(false);
    }
  };

  const startSession = (mode: 'due' | 'all' = scope) => {
    const pool = (selectedDeck ? activeCards.filter((c) => c.deck_id === selectedDeck) : activeCards)
      .filter((c) => (mode === 'due' ? c.due_date <= todayISO() : true));
    if (pool.length === 0) {
      toast.info(mode === 'due' ? 'Nothing is due in this deck. Try "all cards".' : 'This deck has no cards yet.');
      return;
    }
    setQueue(pool);
    setIndex(0);
    setFlipped(false);
    setSessionDone(0);
    setTab('study');
  };

  const rate = async (rating: number) => {
    const card = queue[index];
    if (!card || !user) return;
    const next = schedule(
      { ease: Number(card.ease), interval_days: card.interval_days, repetitions: card.repetitions, lapses: card.lapses },
      rating,
    );
    try {
      await updateRow('flashcards', card.id, {
        ease: next.ease,
        interval_days: next.interval_days,
        repetitions: next.repetitions,
        lapses: next.lapses,
        due_date: next.due_date,
        state: next.state,
        last_reviewed_at: new Date().toISOString(),
      }, card.version);
      await insertRow('flashcard_reviews', {
        user_id: user.id,
        card_id: card.id,
        rating,
        remembered: rating >= 3,
        difficult: rating < 3,
        interval_before: card.interval_days,
        interval_after: next.interval_days,
        ease_after: next.ease,
      });
      setSessionDone((n) => n + 1);
      setFlipped(false);
      if (index + 1 >= queue.length) {
        setIndex(queue.length);
        toast.success('Session complete.');
        reloadCards();
        reloadReviews();
      } else {
        setIndex(index + 1);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the review.');
    }
  };

  const removeDeck = async () => {
    if (!deletingDeck) return;
    setBusy(true);
    try {
      await deleteRow('flashcard_decks', deletingDeck.id, true);
      toast.success('Deck deleted.');
      setDeletingDeck(null);
      reload();
      reloadCards();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the deck.');
    } finally {
      setBusy(false);
    }
  };

  const removeCard = async () => {
    if (!deletingCard) return;
    setBusy(true);
    try {
      await deleteRow('flashcards', deletingCard.id, true);
      toast.success('Card deleted.');
      setDeletingCard(null);
      reloadCards();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the card.');
    } finally {
      setBusy(false);
    }
  };

  const current = queue[index];

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader
        eyebrow="Recall"
        title="Flashcards"
        description="Spaced repetition with the SM-2 algorithm. Every review is stored, so retention is measured, not guessed."
        actions={<Button variant="primary" icon={Plus} onClick={() => openDeck()}>New deck</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-3.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">Total cards</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{activeCards.length}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">Learned</p>
          <p className="mt-1 text-2xl font-semibold text-ink">{learned.length}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">Due now</p>
          <p className="mt-1 text-2xl font-semibold text-warn">{dueNow.length}</p>
        </div>
        <div className="card p-3.5">
          <p className="text-[10px] uppercase tracking-wider text-muted">Retention</p>
          <p className="mt-1 text-2xl font-semibold text-ok">{reviews.length ? `${retentionRate}%` : '—'}</p>
          <p className="text-[10px] text-muted">{reviews.length} reviews</p>
        </div>
      </div>

      <div className="mb-3">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'decks', label: 'Decks' },
            { value: 'study', label: 'Study' },
            { value: 'history', label: 'Reviews' },
          ]}
        />
      </div>

      {tab === 'decks' && (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card title="Decks" subtitle={`${activeDecks.length} deck${activeDecks.length === 1 ? '' : 's'}`} padded={false}>
            <button
              onClick={() => setSelectedDeck(null)}
              className={clsx('flex w-full items-center justify-between px-3 py-2 text-left text-xs', !selectedDeck ? 'bg-accent/10 text-ink' : 'text-muted hover:bg-raised/60')}
            >
              All cards <span>{activeCards.length}</span>
            </button>
            {activeDecks.map((deck) => {
              const count = activeCards.filter((c) => c.deck_id === deck.id).length;
              return (
                <button
                  key={deck.id}
                  onClick={() => setSelectedDeck(deck.id)}
                  className={clsx('flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs', selectedDeck === deck.id ? 'bg-accent/10 text-ink' : 'text-muted hover:bg-raised/60')}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{deck.name}</span>
                    <span className="text-[10px] text-muted">{count} cards</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); openDeck(deck); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') openDeck(deck); }}
                      className="text-muted hover:text-accent"
                      aria-label="Edit deck"
                    >
                      <Pencil size={12} />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); setDeletingDeck(deck); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') setDeletingDeck(deck); }}
                      className="text-muted hover:text-danger"
                      aria-label="Delete deck"
                    >
                      <Trash2 size={12} />
                    </span>
                  </span>
                </button>
              );
            })}
          </Card>

          <Card
            title={selectedDeck ? deckName(selectedDeck) : 'All cards'}
            subtitle={`${deckCards.length} card${deckCards.length === 1 ? '' : 's'}`}
            actions={
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => startSession('due')} icon={RotateCcw}>Study due</Button>
                <Button size="sm" variant="primary" icon={Plus} onClick={() => { if (!selectedDeck) { toast.info('Create or select a deck first.'); return; } openCard(selectedDeck); }}>
                  Add card
                </Button>
              </div>
            }
          >
            {deckCards.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title="No cards here"
                description={selectedDeck ? 'Add your first question and answer.' : 'Create a deck, then add cards.'}
                action={<Button onClick={() => openDeck()} icon={Plus}>New deck</Button>}
              />
            ) : (
              <div className="space-y-2">
                {deckCards.map((card) => (
                  <div key={card.id} className="rounded-xl border border-line/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-ink">{card.question}</p>
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted">{card.answer}</p>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        <button onClick={() => openCard(card.deck_id, card)} className="btn btn-ghost !p-1.5 text-muted" aria-label="Edit card"><Pencil size={12} /></button>
                        <button onClick={() => setDeletingCard(card)} className="btn btn-ghost !p-1.5 text-muted hover:text-danger" aria-label="Delete card"><Trash2 size={12} /></button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={card.state === 'difficult' ? 'danger' : card.state === 'review' ? 'ok' : 'neutral'}>{card.state}</Badge>
                      <Badge>due {prettyDate(card.due_date, 'd MMM')}</Badge>
                      {card.repetitions > 0 && <Badge tone="info">{card.interval_days}d interval</Badge>}
                      {(card.tags ?? []).map((tag) => <span key={tag} className="chip">#{tag}</span>)}
                      {safeUrl(card.reference_url ?? '') && (
                        <a href={safeUrl(card.reference_url ?? '')!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-accent2 hover:underline">
                          <ExternalLink size={9} /> reference
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'study' && (
        <Card
          title="Study session"
          subtitle={selectedDeck ? deckName(selectedDeck) : 'All decks'}
          actions={
            <div className="flex gap-1.5">
              <Select value={scope} onChange={(e) => setScope(e.target.value as 'due' | 'all')} className="!w-32 !py-1 !text-xs">
                <option value="due">Due only</option>
                <option value="all">All cards</option>
              </Select>
              <Button size="sm" icon={RotateCcw} onClick={() => startSession(scope)}>Start</Button>
            </div>
          }
        >
          {queue.length === 0 ? (
            <EmptyState icon={GraduationCap} title="No active session" description="Pick a deck, choose a scope and press Start." />
          ) : index >= queue.length ? (
            <div className="py-8 text-center">
              <p className="text-lg font-semibold text-ok">Session complete</p>
              <p className="mt-1 text-sm text-muted">{sessionDone} card{sessionDone === 1 ? '' : 's'} reviewed.</p>
              <Button className="mt-4" onClick={() => startSession(scope)} icon={RotateCcw}>Study again</Button>
            </div>
          ) : (
            <div className="mx-auto max-w-xl">
              <div className="mb-3 flex items-center justify-between text-[11px] text-muted">
                <span>Card {index + 1} of {queue.length}</span>
                <span>{sessionDone} reviewed</span>
              </div>
              <Progress value={(index / queue.length) * 100} />

              <button
                onClick={() => setFlipped((v) => !v)}
                className="mt-4 flex min-h-[220px] w-full flex-col items-center justify-center rounded-2xl border border-line bg-gradient-to-br from-raised/60 to-surface px-6 py-8 text-center transition hover:border-accent/40"
              >
                <p className="text-lg font-medium leading-snug text-ink">{current?.question}</p>
                {flipped ? (
                  <div className="mt-5 w-full border-t border-line/60 pt-4">
                    <p className="text-sm leading-relaxed text-accent2">{current?.answer}</p>
                    {current?.explanation && <p className="mt-2 text-xs leading-relaxed text-muted">{current.explanation}</p>}
                  </div>
                ) : (
                  <p className="mt-4 text-[11px] text-muted">Tap to reveal the answer</p>
                )}
              </button>

              <div className="mt-3 flex justify-center gap-1.5">
                <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => { setIndex(index - 1); setFlipped(false); }} icon={ChevronLeft}>Back</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Shuffle}
                  onClick={() => {
                    const shuffled = [...queue.slice(index)].sort(() => Math.random() - 0.5);
                    setQueue([...queue.slice(0, index), ...shuffled]);
                    setFlipped(false);
                  }}
                >
                  Shuffle rest
                </Button>
                <Button size="sm" variant="ghost" disabled={index >= queue.length - 1} onClick={() => { setIndex(index + 1); setFlipped(false); }} icon={ChevronRight}>Skip</Button>
              </div>

              {flipped && (
                <div className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                  {RATINGS.map((rating) => (
                    <button
                      key={rating.value}
                      onClick={() => void rate(rating.value)}
                      title={rating.hint}
                      className={clsx(
                        'rounded-xl border px-2 py-2 text-[11px] font-medium transition',
                        rating.value < 3
                          ? 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/20'
                          : rating.value === 3
                            ? 'border-warn/30 bg-warn/10 text-warn hover:bg-warn/20'
                            : 'border-ok/30 bg-ok/10 text-ok hover:bg-ok/20',
                      )}
                    >
                      {rating.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {tab === 'history' && (
        <Card title="Review history" subtitle={`${reviews.length} reviews stored`}>
          {reviews.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No reviews yet" description="Study a deck and your ratings will appear here." />
          ) : (
            <div className="max-h-[520px] space-y-1.5 overflow-y-auto">
              {reviews.slice(0, 100).map((review) => {
                const card = cards.find((c) => c.id === review.card_id);
                return (
                  <div key={review.id} className="flex items-center justify-between gap-2 rounded-lg border border-line/50 px-2.5 py-1.5 text-[11px]">
                    <span className="min-w-0 truncate text-muted">{card?.question ?? 'Deleted card'}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={review.remembered ? 'ok' : 'danger'}>rating {review.rating}</Badge>
                      <span className="text-muted">{prettyDate(review.reviewed_at, 'd MMM HH:mm')}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <Modal
        open={deckModal}
        onClose={() => setDeckModal(false)}
        title={editingDeck ? 'Edit deck' : 'New deck'}
        footer={<><Button onClick={() => setDeckModal(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void saveDeck()}>Save</Button></>}
      >
        <div className="space-y-3">
          <Field label="Deck name"><Input value={deckForm.name} onChange={(e) => setDeckForm({ ...deckForm, name: e.target.value })} /></Field>
          <Field label="Description"><Textarea value={deckForm.description} onChange={(e) => setDeckForm({ ...deckForm, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Section">
              <Select value={deckForm.section_id} onChange={(e) => setDeckForm({ ...deckForm, section_id: e.target.value, topic_id: '' })}>
                <option value="">None</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Topic">
              <Select value={deckForm.topic_id} onChange={(e) => setDeckForm({ ...deckForm, topic_id: e.target.value })}>
                <option value="">None</option>
                {topics.filter((t) => !deckForm.section_id || t.section_id === deckForm.section_id).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={cardModal}
        onClose={() => setCardModal(false)}
        title={editingCard ? 'Edit card' : 'New card'}
        footer={<><Button onClick={() => setCardModal(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void saveCard()}>Save</Button></>}
      >
        <div className="space-y-3">
          <Field label="Question"><Textarea value={cardForm.question} onChange={(e) => setCardForm({ ...cardForm, question: e.target.value })} /></Field>
          <Field label="Answer"><Textarea value={cardForm.answer} onChange={(e) => setCardForm({ ...cardForm, answer: e.target.value })} /></Field>
          <Field label="Explanation"><Textarea value={cardForm.explanation} onChange={(e) => setCardForm({ ...cardForm, explanation: e.target.value })} /></Field>
          <Field label="Reference link"><Input value={cardForm.reference_url} onChange={(e) => setCardForm({ ...cardForm, reference_url: e.target.value })} placeholder="https://…" /></Field>
          <Field label="Tags"><TagInput value={cardForm.tags} onChange={(tags) => setCardForm({ ...cardForm, tags })} /></Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletingDeck)}
        title="Delete deck"
        message={`"${deletingDeck?.name ?? ''}" and its cards will be removed. Review history stays for your analytics.`}
        confirmLabel="Delete deck"
        destructive
        busy={busy}
        onCancel={() => setDeletingDeck(null)}
        onConfirm={() => void removeDeck()}
      />
      <ConfirmDialog
        open={Boolean(deletingCard)}
        title="Delete card"
        message="This card will stop appearing in reviews. Past reviews are preserved."
        confirmLabel="Delete card"
        destructive
        busy={busy}
        onCancel={() => setDeletingCard(null)}
        onConfirm={() => void removeCard()}
      />
    </div>
  );
}
