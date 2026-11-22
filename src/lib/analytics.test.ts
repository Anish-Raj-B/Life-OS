import { describe, expect, it } from 'vitest';
import { compare, dailySeries, heatmap, rangeFor, summarize } from './analytics';
import type { ChallengeAttempt, FlashcardReview, LearningRecord, Task } from './types';

const base = {
  user_id: 'u1',
  description: null,
  notes: null,
  reminder_at: null,
  section_id: null,
  topic_id: null,
  category_id: null,
  tags: [],
  links: [],
  sort_order: 0,
  version: 1,
  deleted_at: null,
  created_at: '2026-11-10T08:00:00.000Z',
};

const task = (over: Partial<Task>): Task =>
  ({
    ...base,
    id: over.id ?? Math.random().toString(),
    title: 'task',
    status: 'not_started',
    priority: 'medium',
    due_date: null,
    due_time: null,
    completed_at: null,
    updated_at: '2026-11-10T08:00:00.000Z',
    ...over,
  }) as Task;

const record: LearningRecord = {
  ...base,
  id: 'l1',
  record_date: '2026-11-20',
  title: 'Networking',
  notes_md: null,
  learned: 'TCP handshake',
  key_concepts: null,
  practice: null,
  understood: null,
  not_understood: null,
  mistakes: null,
  next_steps: null,
  resources: [],
  attachments: [],
  duration_minutes: 45,
} as LearningRecord;

describe('summarize', () => {
  it('counts completed work by completion date and ignores cancelled', () => {
    const tasks = [
      task({ id: 'a', status: 'completed', completed_at: '2026-11-20T10:00:00Z', due_date: '2026-11-20' }),
      // Canceled tasks are counted by when they were cancelled (updated_at).
      task({ id: 'b', status: 'cancelled', due_date: '2026-11-20', updated_at: '2026-11-19T12:00:00Z' }),
      task({ id: 'c', status: 'not_started', due_date: '2026-11-18' }),
    ];
    const summary = summarize(tasks, [record], [], [], { from: '2026-11-18', to: '2026-11-21' }, '2026-11-21');
    expect(summary.completed).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.missed).toBe(1);
    expect(summary.completionRate).toBe(50);
    expect(summary.learningMinutes).toBe(45);
  });

  it('does not count a cancellation outside the range', () => {
    const tasks = [task({ id: 'x', status: 'cancelled', due_date: '2026-11-20', updated_at: '2026-11-01T10:00:00Z' })];
    const summary = summarize(tasks, [], [], [], { from: '2026-11-18', to: '2026-11-21' }, '2026-11-21');
    expect(summary.cancelled).toBe(0);
  });

  it('returns null completion rate when nothing was due', () => {
    const summary = summarize([], [], [], [], { from: '2026-11-18', to: '2026-11-21' }, '2026-11-21');
    expect(summary.completionRate).toBeNull();
    expect(summary.accuracy).toBeNull();
  });

  it('calculates challenge accuracy from completed attempts', () => {
    const attempts = [
      { id: '1', total: 10, score: 7, completed_at: '2026-11-20T10:00:00Z' },
      { id: '2', total: 10, score: 9, completed_at: null },
    ] as unknown as ChallengeAttempt[];
    const summary = summarize([], [], [], attempts, { from: '2026-11-18', to: '2026-11-21' }, '2026-11-21');
    expect(summary.challenges).toBe(1);
    expect(summary.accuracy).toBe(70);
  });
});

describe('dailySeries', () => {
  it('creates one point per day and never exceeds 100 on the productivity index', () => {
    const tasks = [
      task({ id: 'a', status: 'completed', completed_at: '2026-11-20T10:00:00Z', due_date: '2026-11-20' }),
      task({ id: 'b', status: 'completed', completed_at: '2026-11-21T10:00:00Z', due_date: '2026-11-21' }),
    ];
    const points = dailySeries(tasks, [record], [], { from: '2026-11-18', to: '2026-11-21' });
    expect(points).toHaveLength(4);
    expect(points[0].date).toBe('2026-11-18');
    expect(points.at(-1)!.completed).toBe(1);
    points.forEach((point) => {
      expect(point.productivity).toBeGreaterThanOrEqual(0);
      expect(point.productivity).toBeLessThanOrEqual(100);
    });
  });
});

describe('compare', () => {
  it('reports absolute and percentage differences without inventing data', () => {
    const a = summarize([], [], [], [], { from: '2026-11-18', to: '2026-11-21' }, '2026-11-21');
    const b = summarize([], [], [], [], { from: '2026-11-11', to: '2026-11-14' }, '2026-11-21');
    const rows = compare(a, b);
    const completed = rows.find((row) => row.key === 'completed')!;
    expect(completed.a).toBe(0);
    expect(completed.b).toBe(0);
    expect(completed.pctChange).toBeNull(); // no division by zero
    expect(completed.direction).toBe('same');
  });
});

describe('heatmap and ranges', () => {
  it('produces levels between 0 and 4', () => {
    const points = dailySeries(
      [task({ id: 'a', status: 'completed', completed_at: '2026-11-20T10:00:00Z', due_date: '2026-11-20' })],
      [record],
      [],
      { from: '2026-11-18', to: '2026-11-21' },
    );
    heatmap(points, 4).forEach((cell) => {
      expect(cell.level).toBeGreaterThanOrEqual(0);
      expect(cell.level).toBeLessThanOrEqual(4);
    });
  });

  it('builds inclusive ranges', () => {
    const range = rangeFor(7, new Date('2026-11-21T12:00:00'));
    expect(range.to).toBe('2026-11-21');
    expect(range.from).toBe('2026-11-15');
  });
});

describe('reviews', () => {
  it('counts reviews inside the range for active days', () => {
    const reviews = [{ id: 'r', reviewed_at: '2026-11-20T09:00:00Z', remembered: true }] as unknown as FlashcardReview[];
    const summary = summarize([], [], reviews, [], { from: '2026-11-18', to: '2026-11-21' }, '2026-11-21');
    expect(summary.reviews).toBe(1);
    expect(summary.activeDays).toBe(1);
  });
});
