/**
 * Challenge assembly and grading.
 *
 * Questions come from the user's own question bank and flashcards for the
 * selected topics — never from an unrelated corpus. If AI generation is
 * configured it is requested server-side and the results are stored as
 * source='ai' so they are visibly distinguishable.
 */
import { uuid } from './utils';
import type {
  ChallengeQuestion,
  Flashcard,
  QuestionBankItem,
  QuestionType,
} from './types';

export interface DraftQuestion {
  type: QuestionType;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string | null;
  topic_id: string | null;
  difficulty: string;
}

export interface BuildArgs {
  topicIds: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'mixed';
  count: number;
  bank: QuestionBankItem[];
  flashcards: Flashcard[];
  sectionId?: string | null;
}

export function buildQuestions({ topicIds, difficulty, count, bank, flashcards, sectionId }: BuildArgs): DraftQuestion[] {
  const topicSet = new Set(topicIds);
  const matchDifficulty = (d: string) => difficulty === 'mixed' || d === difficulty;

  const fromBank: DraftQuestion[] = bank
    .filter((q) => (!topicIds.length || (q.topic_id && topicSet.has(q.topic_id))) && matchDifficulty(q.difficulty))
    .map((q) => ({
      type: q.type,
      question: q.question,
      options: q.options ?? [],
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      topic_id: q.topic_id,
      difficulty: q.difficulty,
    }));

  // Flashcards are converted to fill-in prompts so they can be graded exactly.
  const fromCards: DraftQuestion[] = flashcards
    .filter((c) => !c.deleted_at)
    .map((c) => ({
      type: 'fill_blank' as QuestionType,
      question: c.question,
      options: [],
      correct_answer: c.answer,
      explanation: c.explanation,
      topic_id: null,
      difficulty: difficulty === 'mixed' ? 'intermediate' : difficulty,
    }));

  void sectionId;
  const pool = [...fromBank, ...fromCards].sort(() => Math.random() - 0.5);
  return pool.slice(0, count);
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const OPEN_TYPES: QuestionType[] = ['scenario', 'conceptual', 'practical'];

export const isSelfGraded = (type: QuestionType): boolean => OPEN_TYPES.includes(type);

export function isCorrect(question: ChallengeQuestion, answer: string): boolean {
  return normalizeAnswer(answer) === normalizeAnswer(question.correct_answer);
}

export interface GradedAnswer {
  question: ChallengeQuestion;
  answer: string;
  correct: boolean;
}

export function grade(questions: ChallengeQuestion[], answers: Record<string, { answer: string; self?: boolean }>) {
  const graded: GradedAnswer[] = questions.map((q) => {
    const entry = answers[q.id];
    const answer = entry?.answer ?? '';
    const correct = isSelfGraded(q.type) ? Boolean(entry?.self) : isCorrect(q, answer);
    return { question: q, answer, correct };
  });
  const score = graded.filter((g) => g.correct).length;

  const byTopic = new Map<string, { topic_id: string | null; correct: number; total: number }>();
  for (const g of graded) {
    const key = g.question.topic_id ?? 'unassigned';
    const current = byTopic.get(key) ?? { topic_id: g.question.topic_id, correct: 0, total: 0 };
    current.total += 1;
    if (g.correct) current.correct += 1;
    byTopic.set(key, current);
  }

  return {
    graded,
    score,
    total: questions.length,
    percentage: questions.length ? Math.round((score / questions.length) * 100) : 0,
    breakdown: [...byTopic.values()],
  };
}

export function buildAttemptPayload(input: {
  userId: string;
  challengeId: string;
  score: number;
  total: number;
  durationSeconds: number;
  breakdown: { topic_id: string | null; correct: number; total: number }[];
}) {
  return {
    id: uuid(),
    user_id: input.userId,
    challenge_id: input.challengeId,
    started_at: new Date(Date.now() - input.durationSeconds * 1000).toISOString(),
    completed_at: new Date().toISOString(),
    score: input.score,
    total: input.total,
    duration_seconds: input.durationSeconds,
    topic_breakdown: input.breakdown,
  };
}
