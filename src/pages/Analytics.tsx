import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, BarChart3, BookOpen, CalendarRange, Info, Minus } from 'lucide-react';
import clsx from 'clsx';
import { useCollection } from '@/hooks/useCollection';
import {
  Badge, Button, Card, EmptyState, InfoNote, Input, PageHeader, Select, StatCard, Tabs,
} from '@/components/ui';
import { BarSeries, Donut, TrendArea, TrendLine } from '@/components/Charts';
import {
  METRIC_LABELS, compare, dailySeries, heatmap, priorityBreakdown, rangeFor, summarize,
  type DateRange, type MetricKey,
} from '@/lib/analytics';
import { addDays, formatNumber, isoDate, prettyDate, todayISO } from '@/lib/utils';
import type {
  ChallengeAttempt, FlashcardReview, LearningRecord, Task, Topic,
} from '@/lib/types';

type Preset =
  | 'today_yesterday' | 'today_lastweek' | 'today_lastmonth' | 'today_lastyear'
  | 'week_previous' | 'month_previous' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today_yesterday', label: 'Yesterday vs today' },
  { value: 'today_lastweek', label: 'Today vs same day last week' },
  { value: 'today_lastmonth', label: 'Today vs same day last month' },
  { value: 'today_lastyear', label: 'Today vs same day last year' },
  { value: 'week_previous', label: 'This week vs previous week' },
  { value: 'month_previous', label: 'This month vs previous month' },
  { value: 'custom', label: 'Custom range vs custom range' },
];

function presetRanges(preset: Preset, customA: DateRange, customB: DateRange): { a: DateRange; b: DateRange } {
  const today = todayISO();
  switch (preset) {
    case 'today_yesterday':
      return { a: { from: today, to: today }, b: { from: addDays(today, -1), to: addDays(today, -1) } };
    case 'today_lastweek':
      return { a: { from: today, to: today }, b: { from: addDays(today, -7), to: addDays(today, -7) } };
    case 'today_lastmonth':
      return { a: { from: today, to: today }, b: { from: addDays(today, -30), to: addDays(today, -30) } };
    case 'today_lastyear':
      return { a: { from: today, to: today }, b: { from: addDays(today, -365), to: addDays(today, -365) } };
    case 'week_previous':
      return { a: { from: addDays(today, -6), to: today }, b: { from: addDays(today, -13), to: addDays(today, -7) } };
    case 'month_previous':
      return { a: { from: addDays(today, -29), to: today }, b: { from: addDays(today, -59), to: addDays(today, -30) } };
    case 'custom':
      return { a: customA, b: customB };
  }
}

export default function Analytics() {
  const { data: tasks } = useCollection<Task>('tasks', 'created_at', false);
  const { data: learning } = useCollection<LearningRecord>('learning_records', 'record_date', false);
  const { data: reviews } = useCollection<FlashcardReview>('flashcard_reviews', 'reviewed_at', false);
  const { data: attempts } = useCollection<ChallengeAttempt>('challenge_attempts', 'started_at', false);
  const { data: topics } = useCollection<Topic>('topics', 'sort_order', true);

  const [windowDays, setWindowDays] = useState('30');
  const [chart, setChart] = useState<'area' | 'line' | 'bar'>('area');
  const [preset, setPreset] = useState<Preset>('week_previous');
  const [customA, setCustomA] = useState<DateRange>({ from: addDays(todayISO(), -6), to: todayISO() });
  const [customB, setCustomB] = useState<DateRange>({ from: addDays(todayISO(), -13), to: addDays(todayISO(), -7) });

  const activeTasks = useMemo(() => tasks.filter((t) => !t.deleted_at), [tasks]);
  const range = useMemo(() => rangeFor(Number(windowDays)), [windowDays]);
  const points = useMemo(() => dailySeries(activeTasks, learning, reviews, range), [activeTasks, learning, reviews, range]);
  const summary = useMemo(() => summarize(activeTasks, learning, reviews, attempts, range), [activeTasks, learning, reviews, attempts, range]);

  const { a: rangeA, b: rangeB } = useMemo(
    () => presetRanges(preset, customA, customB),
    [preset, customA, customB],
  );
  const summaryA = useMemo(() => summarize(activeTasks, learning, reviews, attempts, rangeA), [activeTasks, learning, reviews, attempts, rangeA]);
  const summaryB = useMemo(() => summarize(activeTasks, learning, reviews, attempts, rangeB), [activeTasks, learning, reviews, attempts, rangeB]);
  const comparison = useMemo(() => compare(summaryA, summaryB), [summaryA, summaryB]);

  // Historical availability: the earliest stored record of any kind.
  const earliestRecord = useMemo(() => {
    const dates = [
      ...activeTasks.map((t) => t.created_at?.slice(0, 10)),
      ...learning.map((l) => l.record_date),
      ...reviews.map((r) => r.reviewed_at?.slice(0, 10)),
    ].filter(Boolean) as string[];
    return dates.sort()[0] ?? null;
  }, [activeTasks, learning, reviews]);

  const comparable = !earliestRecord || rangeB.to >= earliestRecord;

  const aligned = useMemo(() => {
    const daysA = dailySeries(activeTasks, learning, reviews, rangeA);
    const daysB = dailySeries(activeTasks, learning, reviews, rangeB);
    const length = Math.max(daysA.length, daysB.length);
    return Array.from({ length }, (_, i) => ({
      label: `Day ${i + 1}`,
      current: daysA[i]?.completed ?? 0,
      previous: daysB[i]?.completed ?? 0,
      currentLearning: daysA[i]?.learningMinutes ?? 0,
      previousLearning: daysB[i]?.learningMinutes ?? 0,
    }));
  }, [activeTasks, learning, reviews, rangeA, rangeB]);

  const heat = useMemo(() => heatmap(dailySeries(activeTasks, learning, reviews, rangeFor(182)), 26), [activeTasks, learning, reviews]);
  const priorities = useMemo(() => priorityBreakdown(activeTasks), [activeTasks]);

  const topicAccuracy = useMemo(() => {
    const totals = new Map<string, { correct: number; total: number }>();
    for (const attempt of attempts) {
      if (!attempt.completed_at) continue;
      for (const row of attempt.topic_breakdown ?? []) {
        if (!row.topic_id) continue;
        const current = totals.get(row.topic_id) ?? { correct: 0, total: 0 };
        current.correct += row.correct;
        current.total += row.total;
        totals.set(row.topic_id, current);
      }
    }
    return [...totals.entries()]
      .map(([topicId, value]) => ({
        name: topics.find((t) => t.id === topicId)?.name ?? 'Topic',
        accuracy: value.total ? Math.round((value.correct / value.total) * 100) : 0,
        total: value.total,
      }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 8);
  }, [attempts, topics]);

  const trendData = points;
  const trendSeries = [
    { key: 'completed', label: 'Completed', color: '#8b5cf6' },
    { key: 'created', label: 'Created', color: '#3b82f6' },
    { key: 'missed', label: 'Missed', color: '#f87171' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Measurement"
        title="Productivity analytics"
        description="Every number on this page is computed from rows in your database. Missing history is shown as unavailable, never invented."
        actions={
          <Select value={windowDays} onChange={(e) => setWindowDays(e.target.value)} className="w-40">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 365 days</option>
          </Select>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Completed" value={summary.completed} hint={`${summary.created} created`} tone="ok" icon={BarChart3} />
        <StatCard
          label="Completion rate"
          value={summary.completionRate === null ? '—' : `${summary.completionRate}%`}
          hint={summary.completionRate === null ? 'no due tasks in range' : `${summary.missed} missed`}
          tone="accent"
        />
        <StatCard label="Learning minutes" value={formatNumber(summary.learningMinutes)} hint={`${summary.learningRecords} entries`} tone="warn" icon={BookOpen} />
        <StatCard
          label="Challenge accuracy"
          value={summary.accuracy === null ? '—' : `${summary.accuracy}%`}
          hint={`${summary.challenges} attempts`}
          tone="accent"
        />
      </div>

      <Card
        title="Task activity"
        subtitle={`${prettyDate(range.from, 'd MMM')} → ${prettyDate(range.to, 'd MMM yyyy')}`}
        actions={
          <Tabs
            value={chart}
            onChange={setChart}
            items={[
              { value: 'area', label: 'Area' },
              { value: 'line', label: 'Line' },
              { value: 'bar', label: 'Bar' },
            ]}
          />
        }
      >
        {trendData.length === 0 ? (
          <EmptyState title="No data in this range" description="Create and complete tasks to populate the chart." />
        ) : chart === 'area' ? (
          <TrendArea data={trendData} series={trendSeries} height={280} />
        ) : chart === 'line' ? (
          <TrendLine data={trendData} series={trendSeries} height={280} />
        ) : (
          <BarSeries data={trendData} x="date" series={trendSeries} height={280} />
        )}
      </Card>

      <Card
        title="Compare periods"
        subtitle="Select two periods and compare the same measured metrics"
        actions={<CalendarRange size={15} className="text-muted" />}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="label">Comparison</span>
            <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>
          <div className="flex items-end">
            <div className="flex w-full flex-wrap items-center gap-2 text-[11px] text-muted">
              <Badge tone="accent">A {prettyDate(rangeA.from, 'd MMM')} → {prettyDate(rangeA.to, 'd MMM')}</Badge>
              <Badge tone="info">B {prettyDate(rangeB.from, 'd MMM')} → {prettyDate(rangeB.to, 'd MMM')}</Badge>
            </div>
          </div>
        </div>

        {preset === 'custom' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line/60 p-3">
              <p className="mb-2 text-[11px] font-medium text-accent">Range A</p>
              <div className="flex gap-2">
                <Input type="date" value={customA.from} onChange={(e) => setCustomA({ ...customA, from: e.target.value })} />
                <Input type="date" value={customA.to} onChange={(e) => setCustomA({ ...customA, to: e.target.value })} />
              </div>
            </div>
            <div className="rounded-xl border border-line/60 p-3">
              <p className="mb-2 text-[11px] font-medium text-accent2">Range B</p>
              <div className="flex gap-2">
                <Input type="date" value={customB.from} onChange={(e) => setCustomB({ ...customB, from: e.target.value })} />
                <Input type="date" value={customB.to} onChange={(e) => setCustomB({ ...customB, to: e.target.value })} />
              </div>
            </div>
          </div>
        )}

        {!comparable ? (
          <div className="mt-4">
            <EmptyState
              icon={Info}
              title="Historical data unavailable"
              description={`Your earliest stored record is ${prettyDate(earliestRecord, 'd MMM yyyy')}. Nothing exists for ${prettyDate(rangeB.from, 'd MMM yyyy')} – ${prettyDate(rangeB.to, 'd MMM yyyy')}, so a comparison cannot be shown.`}
            />
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {comparison.map((row) => {
                const Icon = row.direction === 'up' ? ArrowUpRight : row.direction === 'down' ? ArrowDownRight : Minus;
                const favourable =
                  row.key === 'missed' || row.key === 'cancelled' ? row.direction === 'down' : row.direction === 'up';
                return (
                  <div key={row.key} className="rounded-xl border border-line/60 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted">{METRIC_LABELS[row.key as MetricKey]}</p>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-lg font-semibold text-ink">{row.a ?? '—'}</span>
                      <span className="text-[11px] text-muted">vs {row.b ?? '—'}</span>
                      {row.diff !== null && row.diff !== 0 && (
                        <span className={clsx('ml-auto inline-flex items-center gap-0.5 text-[11px]', favourable ? 'text-ok' : 'text-danger')}>
                          <Icon size={11} />
                          {row.pctChange === null ? `${row.diff}` : `${row.pctChange > 0 ? '+' : ''}${row.pctChange}%`}
                        </span>
                      )}
                    </div>
                    {row.diff !== null && (
                      <p className="mt-0.5 text-[10px] text-muted">
                        absolute {row.diff > 0 ? '+' : ''}{row.diff}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <p className="mb-2 text-[11px] font-medium text-muted">Completed tasks by day index</p>
              <BarSeries
                data={aligned}
                x="label"
                series={[
                  { key: 'current', label: 'Period A', color: '#8b5cf6' },
                  { key: 'previous', label: 'Period B', color: '#3b82f6' },
                ]}
                height={220}
              />
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card title="Activity heatmap" subtitle="Last 26 weeks · tasks completed + learning days">
          <div className="flex gap-[3px] overflow-x-auto pb-1">
            {Array.from({ length: 26 }, (_, week) => (
              <div key={week} className="flex flex-col gap-[3px]">
                {Array.from({ length: 7 }, (_, day) => {
                  const cell = heat[week * 7 + day];
                  if (!cell) return <span key={day} className="h-3 w-3 rounded-sm bg-line/30" />;
                  const shade = ['bg-line/30', 'bg-accent/25', 'bg-accent/45', 'bg-accent/70', 'bg-accent'][cell.level];
                  return (
                    <span
                      key={day}
                      title={`${prettyDate(cell.date, 'd MMM yyyy')} · ${cell.value} activity point${cell.value === 1 ? '' : 's'}`}
                      className={clsx('h-3 w-3 rounded-sm', shade)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted">
            less
            {['bg-line/30', 'bg-accent/25', 'bg-accent/45', 'bg-accent/70', 'bg-accent'].map((c) => (
              <span key={c} className={clsx('h-2.5 w-2.5 rounded-sm', c)} />
            ))}
            more
          </div>
        </Card>

        <Card title="Open tasks by priority" subtitle="Excludes completed and cancelled">
          {priorities.every((p) => p.value === 0) ? (
            <EmptyState title="Nothing open" description="All tasks are closed." />
          ) : (
            <Donut data={priorities.filter((p) => p.value > 0)} centerValue={String(priorities.reduce((s, p) => s + p.value, 0))} centerLabel="open" />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Weak areas" subtitle="Challenge accuracy per topic (lowest first)">
          {topicAccuracy.length === 0 ? (
            <EmptyState title="No challenge history" description="Take a challenge in a topic to measure accuracy." />
          ) : (
            <BarSeries
              data={topicAccuracy}
              series={[{ key: 'accuracy', label: 'Accuracy %', color: '#fbbf24' }]}
              height={230}
            />
          )}
        </Card>

        <Card title="How metrics work" subtitle="Exact definitions used above">
          <ul className="space-y-2 text-[11px] leading-relaxed text-muted">
            <li><span className="text-ink">Completed</span> — tasks with status completed whose completed_at is inside the period.</li>
            <li><span className="text-ink">Missed</span> — tasks due inside the period that are not completed or cancelled and whose due date has passed.</li>
            <li><span className="text-ink">Completion rate</span> — completed ÷ (completed + missed). Shown as “—” when the denominator is zero.</li>
            <li><span className="text-ink">Productivity index</span> — completed tasks (+0.5 for a day with learning), normalized to the busiest day in the window.</li>
            <li><span className="text-ink">Learning minutes</span> — the sum of duration_minutes you logged on learning records.</li>
            <li><span className="text-ink">Challenge accuracy</span> — correct answers ÷ answered questions in completed attempts.</li>
            <li><span className="text-ink">Active days</span> — distinct days with a completion, learning entry or review.</li>
          </ul>
          <div className="mt-3">
            <InfoNote>
              Historical records are never rewritten. If you edit a past learning record, its new version replaces the
              text but the date and the challenge attempt history stay untouched.
            </InfoNote>
          </div>
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[11px] text-muted">
          <span>
            Range in view: {prettyDate(range.from)} → {prettyDate(range.to)} · {summary.activeDays} active day
            {summary.activeDays === 1 ? '' : 's'}
          </span>
          <span>{earliestRecord ? `History starts ${prettyDate(earliestRecord, 'd MMM yyyy')}` : 'No history yet'}</span>
        </div>
      </Card>
    </div>
  );
}
