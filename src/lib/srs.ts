/**
 * SM-2 spaced repetition (Piotr Wozniak, 1987) implemented transparently.
 *
 * The learner rates recall 0–5 after flipping a card:
 *   0 total blackout … 3 correct with difficulty … 5 perfect recall
 *
 * - rating >= 3 counts as "remembered" and advances the interval
 *   (1 day, then 6 days, then previous interval × ease factor).
 * - rating < 3 resets the repetition counter, increments lapses and schedules
 *   the card for tomorrow.
 * - Ease factor starts at 2.5 and moves by 0.1 − (5−q)(0.08 + (5−q)·0.02),
 *   never dropping below 1.3.
 */
import { addDays, todayISO } from './utils';

export interface SrsState {
  ease: number;
  interval_days: number;
  repetitions: number;
  lapses: number;
  due_date: string;
  state: 'new' | 'learning' | 'review' | 'difficult';
}

export const RATINGS = [
  { value: 0, label: 'Blackout', hint: 'No recall at all' },
  { value: 2, label: 'Wrong', hint: 'Incorrect but familiar' },
  { value: 3, label: 'Hard', hint: 'Correct with effort' },
  { value: 4, label: 'Good', hint: 'Correct with hesitation' },
  { value: 5, label: 'Easy', hint: 'Perfect recall' },
] as const;

export function schedule(
  current: Pick<SrsState, 'ease' | 'interval_days' | 'repetitions' | 'lapses'>,
  rating: number,
  from = todayISO(),
): SrsState {
  const q = Math.max(0, Math.min(5, Math.round(rating)));
  const remembered = q >= 3;

  const ease = Math.max(1.3, current.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  const repetitions = remembered ? current.repetitions + 1 : 0;
  const lapses = remembered ? current.lapses : current.lapses + 1;

  let interval: number;
  if (!remembered) interval = 1;
  else if (repetitions === 1) interval = 1;
  else if (repetitions === 2) interval = 6;
  else interval = Math.max(1, Math.round(Math.max(current.interval_days, 1) * ease));

  const state: SrsState['state'] = !remembered
    ? 'difficult'
    : repetitions >= 3
      ? 'review'
      : repetitions === 1 && current.repetitions === 0
        ? 'learning'
        : 'review';

  return {
    ease: Math.round(ease * 100) / 100,
    interval_days: interval,
    repetitions,
    lapses,
    due_date: addDays(from, interval),
    state,
  };
}

export function isDue(card: { due_date: string }, today = todayISO()): boolean {
  return card.due_date <= today;
}

export function retention(reviews: { remembered: boolean }[]): number {
  if (reviews.length === 0) return 0;
  return Math.round((reviews.filter((r) => r.remembered).length / reviews.length) * 100);
}
