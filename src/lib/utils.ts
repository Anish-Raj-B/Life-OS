/** Small helpers for dates, ids and text. */
import { format, parseISO, isValid } from 'date-fns';

export const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export const todayISO = (): string => format(new Date(), 'yyyy-MM-dd');

export const isoDate = (d: Date | string): string =>
  typeof d === 'string' ? d.slice(0, 10) : format(d, 'yyyy-MM-dd');

export const prettyDate = (value?: string | null, pattern = 'EEE, d MMM yyyy'): string => {
  if (!value) return '—';
  const d = value.length === 10 ? parseISO(value) : new Date(value);
  return isValid(d) ? format(d, pattern) : '—';
};

export const prettyDateTime = (value?: string | null): string =>
  value ? prettyDate(value, 'd MMM yyyy · HH:mm') : '—';

export const timeLabel = (t?: string | null): string => (t ? t.slice(0, 5) : '—');

export const minutesBetween = (a: string, b: string): number => {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return bh * 60 + bm - (ah * 60 + am);
};

export const addDays = (date: string, days: number): string => {
  const d = parseISO(date);
  d.setDate(d.getDate() + days);
  return format(d, 'yyyy-MM-dd');
};

export const clamp = (n: number, min = 0, max = 100): number => Math.min(max, Math.max(min, n));

export const pct = (part: number, total: number): number =>
  total <= 0 ? 0 : Math.round((part / total) * 100);

export const formatNumber = (n: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);

export const greeting = (date = new Date()): string => {
  const h = date.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Good night';
};

export const initials = (name?: string | null): string =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('') || 'L';

export const truncate = (s: string, n = 120): string =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** Only http(s) URLs are accepted so links can never run javascript:. */
export const safeUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    /* invalid */
  }
  return null;
};

export const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

export const debounce = <A extends unknown[]>(fn: (...args: A) => void, ms = 300) => {
  let t: ReturnType<typeof setTimeout>;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};
