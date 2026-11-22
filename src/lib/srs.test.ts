import { describe, expect, it } from 'vitest';
import { retention, schedule } from './srs';

const fresh = { ease: 2.5, interval_days: 0, repetitions: 0, lapses: 0 };

describe('SM-2 schedule', () => {
  it('schedules a first successful review one day out', () => {
    const next = schedule(fresh, 4, '2026-11-21');
    expect(next.interval_days).toBe(1);
    expect(next.repetitions).toBe(1);
    expect(next.due_date).toBe('2026-11-22');
    expect(next.state).toBe('learning');
  });

  it('uses a 6 day interval on the second success', () => {
    const first = schedule(fresh, 5, '2026-11-21');
    const second = schedule(first, 5, '2026-11-22');
    expect(second.interval_days).toBe(6);
    expect(second.repetitions).toBe(2);
    expect(second.due_date).toBe('2026-11-28');
  });

  it('multiplies the interval by ease after two successes', () => {
    let state = schedule(fresh, 5, '2026-11-01');
    state = schedule(state, 5, '2026-11-02');
    const third = schedule(state, 5, '2026-11-08');
    expect(third.repetitions).toBe(3);
    expect(third.interval_days).toBe(Math.round(6 * third.ease));
    expect(third.state).toBe('review');
  });

  it('resets repetitions, raises lapses and retries tomorrow on failure', () => {
    const learned = { ease: 2.5, interval_days: 30, repetitions: 5, lapses: 0 };
    const failed = schedule(learned, 1, '2026-11-21');
    expect(failed.repetitions).toBe(0);
    expect(failed.lapses).toBe(1);
    expect(failed.interval_days).toBe(1);
    expect(failed.due_date).toBe('2026-11-22');
    expect(failed.state).toBe('difficult');
  });

  it('never lets ease fall below 1.3', () => {
    let state = { ease: 1.4, interval_days: 10, repetitions: 4, lapses: 0 };
    for (let i = 0; i < 8; i += 1) state = { ...state, ...schedule(state, 0) };
    expect(state.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('rewards an easy answer with a higher ease factor', () => {
    const easy = schedule(fresh, 5, '2026-11-21');
    const hard = schedule(fresh, 3, '2026-11-21');
    expect(easy.ease).toBeGreaterThan(hard.ease);
  });
});

describe('retention', () => {
  it('returns 0 with no reviews rather than dividing by zero', () => {
    expect(retention([])).toBe(0);
  });

  it('computes the remembered percentage', () => {
    expect(retention([{ remembered: true }, { remembered: true }, { remembered: false }, { remembered: true }])).toBe(75);
  });
});
