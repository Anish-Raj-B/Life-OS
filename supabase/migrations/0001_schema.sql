-- ============================================================================
-- LIFE OS — 0001 core schema
-- Every user-owned table carries user_id -> auth.users(id) and a version column
-- for conflict-aware synchronisation. Global platform configuration lives in
-- its own tables and is never mixed with user data.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── shared helpers ──────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Bumps `version` on every update so clients can detect stale writes.
create or replace function public.bump_version()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

-- ── platform configuration (global, not user owned) ─────────────────────────
create table public.platform_settings (
  id smallint primary key default 1 check (id = 1),
  public_registration_enabled boolean not null default false,
  app_name text not null default 'LIFE OS',
  announcement text,
  theme jsonb not null default jsonb_build_object(
    'accent', '#8b5cf6',
    'accent2', '#3b82f6',
    'surface', '#12121a',
    'base', '#0c0c11',
    'radius', '0.9rem',
    'fontSans', 'Inter',
    'mode', 'dark'
  ),
  navigation jsonb not null default '[]'::jsonb,
  dashboard_layout jsonb not null default '[]'::jsonb,
  modules jsonb not null default '{}'::jsonb,
  defaults jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.platform_settings (id) values (1) on conflict do nothing;

-- ── identity ────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  bio text,
  user_role text,
  career_objective text,
  long_term_ambition text,
  short_term_goals text,
  interests text[] not null default '{}',
  skills text[] not null default '{}',
  technologies text[] not null default '{}',
  current_projects text,
  learning_priorities text,
  career_direction text,
  target_achievements text,
  links jsonb not null default '[]'::jsonb,
  github_url text,
  leetcode_url text,
  picoctf_url text,
  portfolio_url text,
  timezone text not null default 'Asia/Kolkata',
  onboarded boolean not null default false,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin', 'user')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null
);

-- Only admins may write roles. Nobody may insert an 'admin' row except through
-- the bootstrap trigger below (which runs as the table owner).
create index user_roles_role_idx on public.user_roles(role);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notifications jsonb not null default jsonb_build_object(
    'tasks', true, 'timetable', true, 'flashcards', true,
    'streaks', true, 'challenges', false, 'browser', false
  ),
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  timetable_start time not null default '06:00',
  timetable_end time not null default '23:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── sections / topics ───────────────────────────────────────────────────────
-- user_id IS NULL => global template row managed by the administrator.
-- On first sign-in each user receives a private copy of the global template.
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  description text,
  icon text not null default 'folder',
  color text,
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index sections_user_idx on public.sections(user_id);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid not null references public.sections(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create index topics_user_idx on public.topics(user_id);
create index topics_section_idx on public.topics(section_id);

-- ── tasks ───────────────────────────────────────────────────────────────────
create table public.task_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#8b5cf6',
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.task_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  notes text,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'cancelled')),
  priority text not null default 'medium'
    check (priority in ('critical', 'high', 'medium', 'low')),
  due_date date,
  due_time time,
  reminder_at timestamptz,
  completed_at timestamptz,
  section_id uuid references public.sections(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  category_id uuid references public.task_categories(id) on delete set null,
  tags text[] not null default '{}',
  links jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_user_due_idx on public.tasks(user_id, due_date);
create index tasks_user_status_idx on public.tasks(user_id, status);
create index tasks_user_completed_idx on public.tasks(user_id, completed_at);

create table public.task_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  remind_at timestamptz not null,
  channel text not null default 'browser' check (channel in ('browser', 'in_app')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index task_reminders_due_idx on public.task_reminders(user_id, remind_at);

-- ── timetable ───────────────────────────────────────────────────────────────
create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_date date not null,
  start_time time not null,
  end_time time not null,
  title text not null,
  description text,
  task_id uuid references public.tasks(id) on delete set null,
  section_id uuid references public.sections(id) on delete set null,
  reminder_at timestamptz,
  recurrence jsonb not null default '{"type":"none"}'::jsonb,
  sort_order integer not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timetable_time_order check (end_time > start_time)
);
create index timetable_user_day_idx on public.timetable_entries(user_id, day_date);

-- ── learning ────────────────────────────────────────────────────────────────
create table public.learning_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid references public.sections(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  title text not null,
  record_date date not null default current_date,
  notes_md text,
  learned text,
  key_concepts text,
  practice text,
  understood text,
  not_understood text,
  mistakes text,
  next_steps text,
  resources jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index learning_records_user_date_idx on public.learning_records(user_id, record_date desc);

create table public.learning_resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid references public.sections(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  title text not null,
  url text not null,
  description text,
  notes text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  deleted_at timestamptz
);
create index learning_resources_user_idx on public.learning_resources(user_id);

-- ── learning pathways / streaks ─────────────────────────────────────────────
create table public.learning_paths (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Path',
  start_date date not null,
  end_date date,
  status text not null default 'active' check (status in ('active', 'complete', 'broken')),
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index learning_paths_one_current
  on public.learning_paths(user_id) where is_current;

create table public.learning_path_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path_id uuid not null references public.learning_paths(id) on delete cascade,
  seq_number integer not null,
  node_date date not null,
  verified boolean not null default false,
  verification_source text not null default 'none' check (verification_source in ('none', 'manual', 'auto')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, seq_number),
  unique (user_id, node_date)
);
create index learning_path_nodes_path_idx on public.learning_path_nodes(path_id, seq_number);

create table public.learning_daily_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id uuid not null references public.learning_path_nodes(id) on delete cascade,
  stage smallint not null check (stage between 1 and 3),
  evidence text,
  completed_at timestamptz not null default now(),
  unique (node_id, stage)
);
create index learning_daily_progress_user_idx on public.learning_daily_progress(user_id, completed_at);

create table public.streak_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  path_id uuid not null references public.learning_paths(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days_count integer not null,
  stages_completed integer not null default 0,
  broken_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index streak_history_user_idx on public.streak_history(user_id, start_date desc);

-- ── flashcards ──────────────────────────────────────────────────────────────
create table public.flashcard_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid references public.sections(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  name text not null,
  description text,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index flashcard_decks_user_idx on public.flashcard_decks(user_id);

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references public.flashcard_decks(id) on delete cascade,
  question text not null,
  answer text not null,
  explanation text,
  reference_url text,
  tags text[] not null default '{}',
  -- SM-2 scheduling state
  ease numeric(4, 2) not null default 2.50 check (ease >= 1.3),
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  lapses integer not null default 0,
  due_date date not null default current_date,
  last_reviewed_at timestamptz,
  state text not null default 'new' check (state in ('new', 'learning', 'review', 'difficult')),
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index flashcards_deck_idx on public.flashcards(deck_id);
create index flashcards_user_due_idx on public.flashcards(user_id, due_date);

create table public.flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.flashcards(id) on delete cascade,
  rating smallint not null check (rating between 0 and 5),
  remembered boolean not null default false,
  difficult boolean not null default false,
  interval_before integer,
  interval_after integer,
  ease_after numeric(4, 2),
  reviewed_at timestamptz not null default now()
);
create index flashcard_reviews_user_idx on public.flashcard_reviews(user_id, reviewed_at desc);

-- ── challenges ──────────────────────────────────────────────────────────────
create table public.question_bank (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  section_id uuid references public.sections(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  type text not null default 'multiple_choice'
    check (type in ('multiple_choice', 'true_false', 'fill_blank', 'scenario', 'conceptual', 'practical')),
  question text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null,
  explanation text,
  difficulty text not null default 'intermediate'
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  source text not null default 'manual' check (source in ('manual', 'flashcard', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index question_bank_topic_idx on public.question_bank(user_id, topic_id);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  section_id uuid references public.sections(id) on delete set null,
  topic_ids uuid[] not null default '{}',
  difficulty text not null default 'mixed'
    check (difficulty in ('beginner', 'intermediate', 'advanced', 'mixed')),
  question_count integer not null default 10 check (question_count between 1 and 100),
  source text not null default 'bank' check (source in ('bank', 'ai', 'manual')),
  created_at timestamptz not null default now()
);
create index challenges_user_idx on public.challenges(user_id, created_at desc);

create table public.challenge_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  position integer not null,
  type text not null default 'multiple_choice',
  question text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null,
  explanation text,
  difficulty text not null default 'intermediate',
  unique (challenge_id, position)
);
create index challenge_questions_challenge_idx on public.challenge_questions(challenge_id);

create table public.challenge_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  score integer not null default 0,
  total integer not null default 0,
  duration_seconds integer,
  topic_breakdown jsonb not null default '[]'::jsonb
);
create index challenge_attempts_user_idx on public.challenge_attempts(user_id, started_at desc);

create table public.challenge_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null references public.challenge_attempts(id) on delete cascade,
  question_id uuid references public.challenge_questions(id) on delete set null,
  answer text,
  is_correct boolean not null default false,
  time_seconds integer,
  created_at timestamptz not null default now()
);
create index challenge_answers_attempt_idx on public.challenge_answers(attempt_id);

-- ── diary / goals / notifications / backups / audit ─────────────────────────
create table public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  title text,
  content_md text not null default '',
  mood smallint check (mood between 1 and 5),
  tags text[] not null default '{}',
  links jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index diary_user_date_idx on public.diary_entries(user_id, entry_date desc);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  category text,
  start_date date,
  target_date date,
  progress integer not null default 0 check (progress between 0 and 100),
  status text not null default 'active' check (status in ('active', 'completed', 'paused', 'abandoned')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_user_idx on public.goals(user_id);

create table public.goal_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null,
  due_date date,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index goal_milestones_goal_idx on public.goal_milestones(goal_id);

-- ── integrations ────────────────────────────────────────────────────────────
create table public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('github', 'leetcode', 'picoctf')),
  external_username text,
  external_user_id text,
  status text not null default 'connected'
    check (status in ('connected', 'error', 'disconnected')),
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create index integration_accounts_user_idx on public.integration_accounts(user_id);

-- OAuth tokens. No RLS policy grants access to any client role: only the
-- service role (edge functions) can read or write this table.
create table public.integration_tokens (
  account_id uuid primary key references public.integration_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.integration_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('github', 'leetcode', 'picoctf')),
  activity_date date not null,
  kind text not null,
  count integer not null default 1,
  details jsonb not null default '{}'::jsonb,
  external_id text,
  source text not null default 'api' check (source in ('api', 'manual')),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, provider, external_id)
);
create index integration_activity_user_idx on public.integration_activity(user_id, activity_date desc);

create table public.integration_sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  status text not null check (status in ('success', 'error')),
  message text,
  created_at timestamptz not null default now()
);
create index integration_sync_logs_user_idx on public.integration_sync_logs(user_id, created_at desc);

-- ── platform notifications & misc ───────────────────────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  url text,
  read_at timestamptz,
  scheduled_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

create table public.backup_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'manual' check (kind in ('manual', 'automatic', 'restore')),
  size_bytes integer,
  note text,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs(created_at desc);

-- ── updated_at triggers ─────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'platform_settings','profiles','user_settings','sections','topics','tasks',
    'timetable_entries','learning_records','learning_resources','learning_paths',
    'learning_path_nodes','flashcard_decks','flashcards','question_bank','goals',
    'diary_entries','integration_accounts'
  ] loop
    execute format(
      'create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()',
      t, t);
  end loop;
end $$;

-- version bumping for conflict detection
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','sections','topics','tasks','timetable_entries','learning_records',
    'learning_resources','flashcard_decks','flashcards','goals','diary_entries'
  ] loop
    execute format(
      'create trigger %I_version before update on public.%I for each row execute function public.bump_version()',
      t, t);
  end loop;
end $$;

-- ── global section template seed ────────────────────────────────────────────
insert into public.sections (user_id, name, description, icon, sort_order)
values
  (null, 'Cybersecurity', 'Offensive, defensive and forensic security learning.', 'shield', 1),
  (null, 'Programming', 'Languages, algorithms and problem solving.', 'code', 2),
  (null, 'Software Development', 'Engineering, architecture and shipping software.', 'boxes', 3),
  (null, 'General Tasks', 'Everyday tasks that do not belong to a subject.', 'list-checks', 4),
  (null, 'Personal Development', 'Habits, discipline and self-improvement.', 'sparkles', 5),
  (null, 'Fitness', 'Training, nutrition and physical health.', 'dumbbell', 6),
  (null, 'Projects', 'Active builds and long-running work.', 'rocket', 7),
  (null, 'Learning Resources', 'Courses, books, docs and references.', 'library', 8);

-- Topics are personal: each account receives its own topic tree from the
-- on_auth_user_created trigger in 0002_rls.sql. Nothing is seeded globally.
