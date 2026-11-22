/**
 * Analytics are computed only from stored rows. Nothing is simulated.
 *
 * Metric definitions (also surfaced in the Analytics page's "How metrics work"
 * panel):
 *
 *  - created:      tasks whose created_at falls inside the range.
 *  - completed:    tasks with status 'completed' whose completed_at falls inside
 *                  the range. Cancelled tasks are never counted as completed.
 *  - missed:       tasks whose due_date falls inside the range, which are not
 *                  completed and not cancelled, and whose due date is in the past.
 *  - completion %: completed / (completed + missed) × 100. When the denominator
 *                  is zero the value is null (shown as "no data"), never 0.
 *  - productivity index: an explicitly derived score =
 *                  (completed × 1 + days with any learning stage × 0.5)
 *                  normalized against the best day in the range. It is labelled
 *                  as a derived index, not a physiological measurement.
 *  - learning minutes: the sum of duration_minutes on learning records dated in
 *                  the range (0 when the user did not log a duration).
 *  - challenge accuracy: correct answers / answered questions across attempts
 *                  completed in the range.
 */
import { addDays, isoDate } from './utils';
import type {
  ChallengeAttempt,
  DiaryEntry,
  Flashcard,
  FlashcardReview,
  LearningRecord,
  StreakHistory,
  Task,
  TimetableEntry,
} from './types';

export interface DateRange {
  from: string;
  to: string;
}

export const rangeFor = (days: number, end = new Date()): DateRange => ({
  from: addDays(isoDate(end), -(days - 1)),
  to: isoDate(end),
});

export const inRange = (value: string | null | undefined, range: DateRange): boolean => {
  if (!value) return false;
  const day = value.slice(0, 10);
  return day >= range.from && day <= range.to;
};

const dayKeys = (range: DateRange): string[] => {
  const keys: string[] = [];
  let cursor = range.from;
  let guard = 0;
  while (cursor <= range.to && guard < 400) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return keys;
};

export interface DayPoint {
  date: string;
  created: number;
  completed: number;
  missed: number;
  learningMinutes: number;
  reviews: number;
  productivity: number;
}

export function dailySeries(
  tasks: Task[],
  learning: LearningRecord[],
  reviews: FlashcardReview[],
  range: DateRange,
  today = isoDate(new Date()),
): DayPoint[] {
  const keys = dayKeys(range);
  const map = new Map<string, DayPoint>(
    keys.map((date) => [date, { date, created: 0, completed: 0, missed: 0, learningMinutes: 0, reviews: 0, productivity: 0 }]),
  );

  for (const task of tasks) {
    const createdKey = task.created_at?.slice(0, 10);
    if (createdKey && map.has(createdKey)) map.get(createdKey)!.created += 1;
    if (task.status === 'completed' && task.completed_at) {
      const key = task.completed_at.slice(0, 10);
      if (map.has(key)) map.get(key)!.completed += 1;
    }
    if (
      task.due_date &&
      map.has(task.due_date) &&
      task.status !== 'completed' &&
      task.status !== 'cancelled' &&
      task.due_date < today
    ) {
      map.get(task.due_date)!.missed += 1;
    }
  }

  for (const record of learning) {
    if (map.has(record.record_date)) {
      map.get(record.record_date)!.learningMinutes += record.duration_minutes ?? 0;
    }
  }

  for (const review of reviews) {
    const key = review.reviewed_at?.slice(0, 10);
    if (key && map.has(key)) map.get(key)!.reviews += 1;
  }

  const points = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  // Derived productivity index, normalized to the busiest day in the range.
  const raw = points.map((p) => p.completed + (p.learningMinutes > 0 ? 0.5 : 0));
  const peak = Math.max(1, ...raw);
  points.forEach((p, i) => {
    p.productivity = Math.round((raw[i] / peak) * 100);
  });
  return points;
}

export interface RangeSummary {
  created: number;
  completed: number;
  cancelled: number;
  missed: number;
  completionRate: number | null;
  learningRecords: number;
  learningMinutes: number;
  reviews: number;
  challenges: number;
  accuracy: number | null;
  activeDays: number;
}

export function summarize(
  tasks: Task[],
  learning: LearningRecord[],
  reviews: FlashcardReview[],
  attempts: ChallengeAttempt[],
  range: DateRange,
  today = isoDate(new Date()),
): RangeSummary {
  const created = tasks.filter((t) => inRange(t.created_at, range)).length;
  const completedTasks = tasks.filter((t) => t.status === 'completed' && inRange(t.completed_at, range));
  const cancelled = tasks.filter((t) => t.status === 'cancelled' && inRange(t.updated_at ?? t.created_at, range)).length;
  const missed = tasks.filter(
    (t) =>
      t.due_date &&
      inRange(t.due_date, range) &&
      t.status !== 'completed' &&
      t.status !== 'cancelled' &&
      t.due_date < today,
  ).length;

  const denominator = completedTasks.length + missed;
  const completionRate = denominator === 0 ? null : Math.round((completedTasks.length / denominator) * 100);

  const learningInRange = learning.filter((l) => inRange(l.record_date, range));
  const reviewsInRange = reviews.filter((r) => inRange(r.reviewed_at, range));
  const attemptsInRange = attempts.filter((a) => a.completed_at && inRange(a.completed_at, range));

  const answered = attemptsInRange.reduce((sum, a) => sum + a.total, 0);
  const correct = attemptsInRange.reduce((sum, a) => sum + a.score, 0);

  const activeDates = new Set<string>();
  completedTasks.forEach((t) => activeDates.add(t.completed_at!.slice(0, 10)));
  learningInRange.forEach((l) => activeDates.add(l.record_date));
  reviewsInRange.forEach((r) => activeDates.add(r.reviewed_at.slice(0, 10)));

  return {
    created,
    completed: completedTasks.length,
    cancelled,
    missed,
    completionRate,
    learningRecords: learningInRange.length,
    learningMinutes: learningInRange.reduce((s, l) => s + (l.duration_minutes ?? 0), 0),
    reviews: reviewsInRange.length,
    challenges: attemptsInRange.length,
    accuracy: answered === 0 ? null : Math.round((correct / answered) * 100),
    activeDays: activeDates.size,
  };
}

export type MetricKey = keyof RangeSummary;

export const METRIC_LABELS: Record<MetricKey, string> = {
  created: 'Tasks created',
  completed: 'Tasks completed',
  cancelled: 'Tasks cancelled',
  missed: 'Tasks missed',
  completionRate: 'Completion rate',
  learningRecords: 'Learning entries',
  learningMinutes: 'Learning minutes',
  reviews: 'Flashcards reviewed',
  challenges: 'Challenges taken',
  accuracy: 'Challenge accuracy',
  activeDays: 'Active days',
};

export interface ComparisonRow {
  key: MetricKey;
  label: string;
  a: number | null;
  b: number | null;
  diff: number | null;
  pctChange: number | null;
  direction: 'up' | 'down' | 'same' | 'none';
}

export function compare(a: RangeSummary, b: RangeSummary): ComparisonRow[] {
  return (Object.keys(METRIC_LABELS) as MetricKey[]).map((key) => {
    const av = a[key];
    const bv = b[key];
    const hasBoth = av !== null && bv !== null;
    const diff = hasBoth ? (av as number) - (bv as number) : null;
    const pctChange =
      hasBoth && (bv as number) !== 0 ? Math.round((((av as number) - (bv as number)) / (bv as number)) * 100) : null;
    return {
      key,
      label: METRIC_LABELS[key],
      a: av,
      b: bv,
      diff,
      pctChange,
      direction:
        diff === null ? 'none' : diff > 0 ? 'up' : diff < 0 ? 'down' : 'same',
    };
  });
}

export function heatmap(points: DayPoint[], weeks = 26): { date: string; value: number; level: number }[] {
  const slice = points.slice(-weeks * 7);
  const max = Math.max(1, ...slice.map((p) => p.completed + (p.learningMinutes > 0 ? 1 : 0)));
  return slice.map((p) => {
    const value = p.completed + (p.learningMinutes > 0 ? 1 : 0);
    const level = value === 0 ? 0 : Math.ceil((value / max) * 4);
    return { date: p.date, value, level };
  });
}

export function taskBreakdown(tasks: Task[], range?: DateRange): { name: string; value: number }[] {
  const scoped = range ? tasks.filter((t) => inRange(t.due_date ?? t.created_at, range)) : tasks;
  const counts: Record<string, number> = {
    Completed: 0,
    'In progress': 0,
    'Not started': 0,
    Cancelled: 0,
  };
  for (const t of scoped) {
    if (t.status === 'completed') counts.Completed += 1;
    else if (t.status === 'in_progress') counts['In progress'] += 1;
    else if (t.status === 'cancelled') counts.Cancelled += 1;
    else counts['Not started'] += 1;
  }
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));
}

export function priorityBreakdown(tasks: Task[]): { name: string; value: number }[] {
  const buckets: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').forEach((t) => {
    buckets[t.priority] = (buckets[t.priority] ?? 0) + 1;
  });
  return Object.entries(buckets).map(([name, value]) => ({
    name: name[0].toUpperCase() + name.slice(1),
    value,
  }));
}

export function streakSummary(history: StreakHistory[], currentStreakDays: number) {
  const longest = history.reduce((max, h) => Math.max(max, h.days_count), currentStreakDays);
  return {
    current: currentStreakDays,
    longest,
    completedPaths: history.length,
    totalDays: history.reduce((s, h) => s + h.days_count, 0) + currentStreakDays,
  };
}

export function upcomingTasks(tasks: Task[], days = 7): Task[] {
  const today = isoDate(new Date());
  const until = addDays(today, days);
  return tasks
    .filter(
      (t) =>
        t.due_date &&
        t.due_date >= today &&
        t.due_date <= until &&
        t.status !== 'completed' &&
        t.status !== 'cancelled',
    )
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
}

export function dueCards(cards: Flashcard[], today = isoDate(new Date())): Flashcard[] {
  return cards.filter((c) => !c.deleted_at && c.due_date <= today);
}

export function todayTimetable(entries: TimetableEntry[], date = isoDate(new Date())): TimetableEntry[] {
  return entries
    .filter((e) => e.day_date === date && !e.deleted_at)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export function diaryStreak(entries: DiaryEntry[]): number {
  const days = new Set(entries.filter((e) => !e.deleted_at).map((e) => e.entry_date));
  let streak = 0;
  let cursor = isoDate(new Date());
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
