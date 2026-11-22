import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, CalendarClock, CheckCircle2, CreditCard, Flame, Github,
  Layers, ListChecks, NotebookPen, Plus, Target, Trophy, TrendingUp, CircleDot,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { useCollection } from '@/hooks/useCollection';
import { Badge, Button, Card, EmptyState, InfoNote, LoadingBlock, Progress, StatCard } from '@/components/ui';
import { TrendArea } from '@/components/Charts';
import {
  dailySeries, dueCards, rangeFor, streakSummary, todayTimetable, upcomingTasks,
} from '@/lib/analytics';
import { addDays, greeting, initials, prettyDate, timeLabel, todayISO } from '@/lib/utils';
import type {
  ChallengeAttempt, DiaryEntry, Flashcard, FlashcardReview, Goal, IntegrationAccount,
  LearningPath, LearningPathNode, LearningRecord, Section, StreakHistory, Task, TimetableEntry,
} from '@/lib/types';

function currentStreak(dates: string[]): number {
  const set = new Set(dates);
  let cursor = todayISO();
  if (!set.has(cursor)) cursor = addDays(cursor, -1);
  let count = 0;
  while (set.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export default function Dashboard() {
  const { profile, user } = useAuth();
  const { data: tasks } = useCollection<Task>('tasks', 'created_at', false);
  const { data: entries } = useCollection<TimetableEntry>('timetable_entries', 'day_date', false);
  const { data: nodes } = useCollection<LearningPathNode>('learning_path_nodes', 'node_date', false);
  const { data: history } = useCollection<StreakHistory>('streak_history', 'start_date', false);
  const { data: paths } = useCollection<LearningPath>('learning_paths', 'start_date', false);
  const { data: cards } = useCollection<Flashcard>('flashcards', 'due_date', true);
  const { data: reviews } = useCollection<FlashcardReview>('flashcard_reviews', 'reviewed_at', false);
  const { data: learning } = useCollection<LearningRecord>('learning_records', 'record_date', false);
  const { data: attempts } = useCollection<ChallengeAttempt>('challenge_attempts', 'started_at', false);
  const { data: integrations } = useCollection<IntegrationAccount>('integration_accounts', 'created_at', false);
  const { data: sections } = useCollection<Section>('sections', 'sort_order', true);
  const { data: goals } = useCollection<Goal>('goals', 'created_at', false);
  const { data: diary } = useCollection<DiaryEntry>('diary_entries', 'entry_date', false);

  const today = todayISO();
  const activeTasks = tasks.filter((t) => !t.deleted_at);

  const stats = useMemo(() => {
    const todays = activeTasks.filter((t) => t.due_date === today);
    const completed = todays.filter((t) => t.status === 'completed').length;
    const pending = todays.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length;
    const overdue = activeTasks.filter(
      (t) => t.due_date && t.due_date < today && t.status !== 'completed' && t.status !== 'cancelled',
    ).length;
    return { todays, completed, pending, overdue };
  }, [activeTasks, today]);

  const series = useMemo(() => dailySeries(activeTasks, learning, reviews, rangeFor(14)), [activeTasks, learning, reviews]);
  const streak = useMemo(() => currentStreak(nodes.map((n) => n.node_date)), [nodes]);
  const streakInfo = useMemo(() => streakSummary(history, streak), [history, streak]);
  const due = useMemo(() => dueCards(cards), [cards]);
  const schedule = useMemo(() => todayTimetable(entries, today), [entries, today]);
  const upcoming = useMemo(() => upcomingTasks(activeTasks, 7).slice(0, 5), [activeTasks]);
  const currentPath = paths.find((p) => p.is_current);
  const todayDiary = diary.find((d) => d.entry_date === today && !d.deleted_at);

  const recentNodes = [...nodes].sort((a, b) => b.node_date.localeCompare(a.node_date)).slice(0, 7).reverse();

  const integration = (provider: string) => integrations.find((i) => i.provider === provider);
  const github = integration('github');
  const leetcode = integration('leetcode');
  const pico = integration('picoctf');

  const sectionProgress = useMemo(() => {
    return sections
      .filter((s) => !s.archived)
      .map((section) => {
        const sectionTasks = activeTasks.filter((t) => t.section_id === section.id && t.status !== 'cancelled');
        const done = sectionTasks.filter((t) => t.status === 'completed').length;
        const entriesCount = learning.filter((l) => l.section_id === section.id).length;
        return { section, total: sectionTasks.length, done, entries: entriesCount };
      })
      .filter((s) => s.total > 0 || s.entries > 0)
      .sort((a, b) => b.total + b.entries - (a.total + a.entries))
      .slice(0, 4);
  }, [sections, activeTasks, learning]);

  const activeGoals = goals.filter((g) => g.status === 'active').slice(0, 3);

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-2xl border border-line/70 bg-gradient-to-br from-surface via-surface to-raised/60 p-5 sm:p-6">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent/15 blur-[70px]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="h-12 w-12 rounded-2xl object-cover ring-1 ring-line" />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent/20 text-sm font-semibold text-accent">
                {initials(profile?.full_name)}
              </span>
            )}
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted">{prettyDate(today, 'EEEE, d MMMM yyyy')}</p>
              <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
                {greeting()}, {profile?.full_name?.split(' ')[0] ?? 'there'}.
              </h1>
              <p className="mt-1 text-xs text-muted">
                {stats.pending === 0 && stats.overdue === 0
                  ? 'Nothing is pending for today. Use the space to learn something new.'
                  : `${stats.pending} task${stats.pending === 1 ? '' : 's'} due today${stats.overdue ? ` · ${stats.overdue} overdue` : ''}.`}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/tasks"><Button icon={Plus}>Add task</Button></Link>
            <Link to="/challenges"><Button variant="primary" icon={Trophy}>Start a challenge</Button></Link>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Done today" value={`${stats.completed}/${stats.todays.length}`} hint="tasks completed" tone="ok" icon={CheckCircle2} />
        <StatCard label="Pending" value={stats.pending} hint="remaining today" tone="accent" icon={ListChecks} />
        <StatCard label="Overdue" value={stats.overdue} hint="needs rescheduling" tone="danger" icon={CalendarClock} />
        <StatCard label="Learning streak" value={`${streak}d`} hint={`longest ${streakInfo.longest}d`} tone="warn" icon={Flame} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card
          title="Daily productivity"
          subtitle="Last 14 days · completed tasks and learning minutes"
          actions={<Link to="/analytics" className="text-[11px] text-accent hover:underline">Full analytics</Link>}
        >
          <TrendArea
            data={series}
            series={[
              { key: 'completed', label: 'Tasks completed', color: '#8b5cf6' },
              { key: 'productivity', label: 'Productivity index', color: '#3b82f6' },
            ]}
            height={230}
          />
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            The productivity index is derived from completed tasks plus days with learning activity, normalized to
            your busiest day in the window. Nothing is estimated.
          </p>
        </Card>

        <Card
          title="Today's timetable"
          subtitle={`${schedule.length} block${schedule.length === 1 ? '' : 's'}`}
          actions={<Link to="/timetable" className="text-[11px] text-accent hover:underline">Open</Link>}
        >
          {schedule.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No blocks today" description="Add a time block to structure the day." action={<Link to="/timetable"><Button size="sm">Plan the day</Button></Link>} />
          ) : (
            <ul className="space-y-1.5">
              {schedule.slice(0, 6).map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 rounded-lg border border-line/50 px-2.5 py-2">
                  <span className="w-[92px] shrink-0 font-mono text-[10px] text-muted">{timeLabel(entry.start_time)}–{timeLabel(entry.end_time)}</span>
                  <span className="truncate text-xs text-ink">{entry.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Learning pathway"
          subtitle={currentPath ? `Active since ${prettyDate(currentPath.start_date, 'd MMM')}` : 'No active path'}
          actions={<Link to="/paths" className="text-[11px] text-accent hover:underline">View</Link>}
        >
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-2xl font-semibold text-ink">{streak}</p>
              <p className="text-[11px] text-muted">consecutive days</p>
            </div>
            <Badge tone={streakInfo.completedPaths ? 'info' : 'neutral'}>
              {streakInfo.completedPaths} past path{streakInfo.completedPaths === 1 ? '' : 's'}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recentNodes.length === 0 && <p className="text-xs text-muted">Record today's first stage to start a node.</p>}
            {recentNodes.map((node) => (
              <span key={node.id} className="grid h-8 w-8 place-items-center rounded-full border border-accent/30 bg-accent/10 text-[10px] font-semibold text-accent">
                {node.seq_number}
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
            <Flame size={12} className="text-warn" /> {streakInfo.totalDays} learning days recorded in total
          </div>
        </Card>

        <Card
          title="Revision due"
          subtitle={`${due.length} card${due.length === 1 ? '' : 's'} ready`}
          actions={<Link to="/flashcards" className="text-[11px] text-accent hover:underline">Study</Link>}
        >
          {due.length === 0 ? (
            <EmptyState icon={CreditCard} title="Nothing due" description="Your spaced-repetition queue is clear." />
          ) : (
            <>
              <ul className="space-y-1.5">
                {due.slice(0, 3).map((card) => (
                  <li key={card.id} className="rounded-lg border border-line/50 px-2.5 py-2">
                    <p className="truncate text-xs text-ink">{card.question}</p>
                    <p className="mt-0.5 text-[10px] text-muted">due {prettyDate(card.due_date, 'd MMM')}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-3"><Progress value={Math.min(100, due.length * 10)} tone="warn" /></div>
            </>
          )}
        </Card>

        <Card
          title="Quick diary"
          subtitle={todayDiary ? 'Today is documented' : 'Not written yet'}
          actions={<Link to="/diary" className="text-[11px] text-accent hover:underline">Diary</Link>}
        >
          {todayDiary ? (
            <p className="line-clamp-5 whitespace-pre-wrap text-xs leading-relaxed text-muted">{todayDiary.content_md}</p>
          ) : (
            <EmptyState icon={NotebookPen} title="Capture today" description="A few honest lines are enough." action={<Link to="/diary"><Button size="sm" icon={Plus}>Write</Button></Link>} />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <IntegrationCard
          title="GitHub"
          icon={Github}
          account={github}
          rows={
            github
              ? [
                  ['Username', github.external_username ?? '—'],
                  ['Repositories', String(github.metadata?.public_repos ?? '—')],
                  ['Commits (90d)', String(github.metadata?.commits_90d ?? 0)],
                  ['Latest', github.metadata?.latest_commit_at ? prettyDate(github.metadata.latest_commit_at, 'd MMM') : '—'],
                ]
              : []
          }
        />
        <IntegrationCard
          title="LeetCode"
          icon={Trophy}
          account={leetcode}
          rows={
            leetcode
              ? [
                  ['Username', leetcode.external_username ?? '—'],
                  ['Total solved', String(leetcode.metadata?.total_solved ?? 'manual')],
                  ['Easy', String(leetcode.metadata?.easy_solved ?? '—')],
                  ['Medium', String(leetcode.metadata?.medium_solved ?? '—')],
                ]
              : []
          }
          note={leetcode?.metadata?.endpoint ? 'auto (unofficial endpoint)' : 'manual tracking'}
        />
        <IntegrationCard
          title="PicoCTF"
          icon={Layers}
          account={pico}
          rows={
            pico
              ? [
                  ['Username', pico.external_username ?? '—'],
                  ['Mode', 'manual'],
                  ['Last sync', pico.last_synced_at ? prettyDate(pico.last_synced_at, 'd MMM HH:mm') : '—'],
                ]
              : []
          }
          note="challenges logged manually"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="Upcoming" subtitle="Next 7 days" actions={<Link to="/tasks" className="text-[11px] text-accent hover:underline">All</Link>}>
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Nothing scheduled" description="Upcoming deadlines appear here." />
          ) : (
            <ul className="space-y-1.5">
              {upcoming.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3 rounded-lg border border-line/50 px-2.5 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-ink">{task.title}</p>
                    <p className="text-[10px] text-muted">{prettyDate(task.due_date, 'EEE d MMM')}</p>
                  </div>
                  <Badge tone={task.priority === 'critical' ? 'danger' : task.priority === 'high' ? 'warn' : 'neutral'}>{task.priority}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Section progress" subtitle="Based on tasks and learning entries" actions={<Link to="/sections" className="text-[11px] text-accent hover:underline">Sections</Link>}>
          {sectionProgress.length === 0 ? (
            <EmptyState icon={Layers} title="No activity yet" description="Assign tasks to sections to track progress." />
          ) : (
            <div className="space-y-3">
              {sectionProgress.map(({ section, total, done, entries: count }) => (
                <div key={section.id}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-ink">{section.name}</span>
                    <span className="text-muted">{done}/{total} tasks · {count} entries</span>
                  </div>
                  <Progress value={total ? (done / total) * 100 : 0} tone={total && done === total ? 'ok' : 'accent'} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Goals" subtitle="Active long-term targets" actions={<Link to="/goals" className="text-[11px] text-accent hover:underline">Manage</Link>}>
          {activeGoals.length === 0 ? (
            <EmptyState icon={Target} title="No active goals" description="Define what you are working toward." />
          ) : (
            <div className="space-y-3">
              {activeGoals.map((goal) => (
                <div key={goal.id}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="truncate text-ink">{goal.name}</span>
                    <span className="text-muted">{goal.progress}%</span>
                  </div>
                  <Progress value={goal.progress} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Challenges" subtitle="Recent attempts" actions={<Link to="/challenges" className="text-[11px] text-accent hover:underline">Start</Link>}>
          {attempts.filter((a) => a.completed_at).length === 0 ? (
            <EmptyState icon={Trophy} title="No attempts yet" description="Test what you have learned; no AI key required." />
          ) : (
            <ul className="space-y-1.5">
              {attempts.filter((a) => a.completed_at).slice(0, 4).map((attempt) => (
                <li key={attempt.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted">{prettyDate(attempt.completed_at, 'd MMM HH:mm')}</span>
                  <Badge tone={attempt.total && attempt.score / attempt.total >= 0.7 ? 'ok' : 'warn'}>
                    {attempt.score}/{attempt.total}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Notifications" subtitle="Reminders you have enabled" actions={<Link to="/settings" className="text-[11px] text-accent hover:underline">Settings</Link>}>
          <InfoNote>
            Browser notifications require permission on this device. Task and timetable reminders are stored with the
            record, so they are scheduled by the app while it is open. Nothing is sent while the app is closed unless
            you have installed it and permitted notifications.
          </InfoNote>
          <p className="mt-3 text-[11px] text-muted">
            Timezone in use: <span className="text-ink">{profile?.timezone ?? 'Asia/Kolkata'}</span>
          </p>
        </Card>
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-muted">
            <CircleDot size={13} className="text-ok" />
            {user?.email} · {profile?.onboarded ? 'profile complete' : 'profile incomplete'}
          </div>
          <div className="flex gap-2">
            <Link to="/analytics"><Button size="sm" icon={BarChart3}>Analytics</Button></Link>
            <Link to="/learning"><Button size="sm" variant="ghost" icon={TrendingUp}>Log learning</Button></Link>
            <Link to="/profile" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
              Profile <ArrowRight size={11} />
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}

function IntegrationCard({
  title,
  icon: Icon,
  account,
  rows,
  note,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  account?: IntegrationAccount;
  rows: [string, string][];
  note?: string;
}) {
  const connected = account && account.status !== 'disconnected';
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon size={14} /> {title}
        </span>
      }
      subtitle={connected ? (account?.external_username ?? 'connected') : 'not connected'}
      actions={<Badge tone={connected ? 'ok' : 'neutral'}>{connected ? 'connected' : 'off'}</Badge>}
    >
      {connected ? (
        <>
          <dl className="space-y-1">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 text-[11px]">
                <dt className="text-muted">{label}</dt>
                <dd className="max-w-[60%] truncate text-right text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {note && <p className="mt-2 text-[10px] text-muted">{note}</p>}
        </>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-muted">Connect {title} to surface genuine activity here.</p>
          <Link to="/integrations"><Button size="sm">Connect</Button></Link>
        </div>
      )}
    </Card>
  );
}
