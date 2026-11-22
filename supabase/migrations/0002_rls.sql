-- ============================================================================
-- LIFE OS — 0002 authorisation, bootstrap, RLS
-- Authorisation is decided in the database, never by the client.
-- ============================================================================

-- ── helpers ─────────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.registration_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select public_registration_enabled from public.platform_settings where id = 1), false);
$$;
grant execute on function public.registration_enabled() to anon, authenticated;

-- ── bootstrap: gate registration, create profile/role/sections ──────────────
create or replace function public.on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_email constant text := 'anishrajb21@gmail.com';
  is_owner boolean;
  sec record;
begin
  is_owner := lower(coalesce(new.email, '')) = admin_email;

  -- Privacy gate: while public registration is disabled only the owner may
  -- ever obtain an account. Raising here aborts the auth.users insert, so the
  -- OAuth sign-in fails and no session is created.
  if not is_owner and not public.registration_enabled() then
    raise exception 'LIFE_OS_REGISTRATION_DISABLED'
      using errcode = 'P0001',
            hint = 'This workspace is private. Ask the administrator for access.';
  end if;

  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role, granted_by)
  values (new.id, case when is_owner then 'admin' else 'user' end, null)
  on conflict (user_id) do nothing;

  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  -- Give every new account its own copy of the global section template.
  for sec in
    select * from public.sections where user_id is null order by sort_order
  loop
    insert into public.sections (user_id, name, description, icon, color, sort_order)
    values (new.id, sec.name, sec.description, sec.icon, sec.color, sec.sort_order);
  end loop;

  -- Seed the initial Cybersecurity topic tree for the copied section.
  insert into public.topics (user_id, section_id, name, sort_order)
  select new.id, s.id, t.name, t.ord
  from public.sections s
  cross join lateral (values
    ('Networking', 1), ('Operating Systems', 2), ('Linux', 3), ('Windows Security', 4),
    ('SOC Fundamentals', 5), ('SIEM', 6), ('Vulnerability Assessment', 7),
    ('Web Security', 8), ('Penetration Testing', 9), ('Cloud Security', 10),
    ('Digital Forensics', 11), ('Cryptography', 12)
  ) as t(name, ord)
  where s.user_id = new.id and s.name = 'Cybersecurity';

  insert into public.notifications (user_id, kind, title, body, url)
  values (
    new.id, 'system', 'Welcome to LIFE OS',
    'Start by adding today''s tasks and your timetable.',
    '/tasks'
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.on_auth_user_created();

-- ── role hardening: nobody can change their own role from a client ──────────
create or replace function public.guard_user_roles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'ROLE_CHANGE_FORBIDDEN' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.user_id = auth.uid() and new.role <> old.role then
    raise exception 'ROLE_CHANGE_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger user_roles_guard
  before insert or update on public.user_roles
  for each row execute function public.guard_user_roles();

-- ── learning pathway engine ─────────────────────────────────────────────────
-- All numbering and streak bookkeeping happens server-side so a client can
-- never reuse a node number, delete a previous path, or back-date a streak.
create or replace function public.advance_learning_path(
  p_stages smallint[] default null,
  p_evidence text default null,
  p_verified boolean default false,
  p_timezone text default 'Asia/Kolkata'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date;
  v_path public.learning_paths;
  v_last_date date;
  v_node public.learning_path_nodes;
  v_seq integer;
  v_stage smallint;
  v_created_path boolean := false;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_today := (now() at time zone coalesce(p_timezone, 'Asia/Kolkata'))::date;

  select * into v_path from public.learning_paths
    where user_id = v_user and is_current limit 1;

  -- Close the current path when the streak genuinely broke (a full day passed
  -- without any stage being recorded). The old path and its nodes are kept.
  if v_path.id is not null then
    select max(node_date) into v_last_date
      from public.learning_path_nodes where path_id = v_path.id;

    if v_last_date is not null and v_today > v_last_date + 1 then
      update public.learning_paths
        set is_current = false, status = 'broken', end_date = v_last_date
        where id = v_path.id;

      insert into public.streak_history (user_id, path_id, start_date, end_date, days_count, stages_completed)
      select v_user, v_path.id, v_path.start_date, v_last_date,
             (select count(*) from public.learning_path_nodes where path_id = v_path.id),
             (select count(*) from public.learning_daily_progress p
                join public.learning_path_nodes n on n.id = p.node_id
               where n.path_id = v_path.id);

      v_path := null;
    end if;
  end if;

  if v_path.id is null then
    insert into public.learning_paths (user_id, name, start_date, is_current, status)
    values (v_user, 'Path', v_today, true, 'active')
    returning * into v_path;
    v_created_path := true;
  end if;

  select * into v_node from public.learning_path_nodes
    where user_id = v_user and node_date = v_today limit 1;

  if v_node.id is null then
    -- Globally sequential per user: never reuses a number across paths.
    select coalesce(max(seq_number), 0) + 1 into v_seq
      from public.learning_path_nodes where user_id = v_user;

    insert into public.learning_path_nodes
      (user_id, path_id, seq_number, node_date, verified, verification_source, note)
    values
      (v_user, v_path.id, v_seq, v_today, p_verified,
       case when p_verified then 'auto' else 'none' end, p_evidence)
    returning * into v_node;
  elsif p_evidence is not null then
    update public.learning_path_nodes set note = p_evidence where id = v_node.id;
  end if;

  if p_verified then
    update public.learning_path_nodes
      set verified = true,
          verification_source = case when verification_source = 'none' then 'manual' else verification_source end
      where id = v_node.id;
  end if;

  if p_stages is not null then
    foreach v_stage in array p_stages loop
      if v_stage between 1 and 3 then
        insert into public.learning_daily_progress (user_id, node_id, stage, evidence)
        values (v_user, v_node.id, v_stage, p_evidence)
        on conflict (node_id, stage) do nothing;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'path_id', v_path.id,
    'new_path', v_created_path,
    'node', to_jsonb(v_node)
  );
end;
$$;

revoke all on function public.advance_learning_path(smallint[], text, boolean, text) from public;
grant execute on function public.advance_learning_path(smallint[], text, boolean, text) to authenticated;

-- ── challenge grading (server-side, stored answer never leaves unless allowed) ─
create or replace function public.grade_challenge_attempt(
  p_challenge_id uuid,
  p_answers jsonb,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.challenge_attempts;
  v_item jsonb;
  v_q public.challenge_questions;
  v_correct integer := 0;
  v_total integer := 0;
  v_breakdown jsonb := '[]'::jsonb;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.challenges where id = p_challenge_id and user_id = v_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.challenge_attempts (user_id, challenge_id, total, duration_seconds)
  values (v_user, p_challenge_id, jsonb_array_length(p_answers), p_duration_seconds)
  returning * into v_attempt;

  for v_item in select * from jsonb_array_elements(p_answers)
  loop
    select * into v_q from public.challenge_questions
      where id = (v_item->>'question_id')::uuid and challenge_id = p_challenge_id;
    continue when v_q.id is null;

    v_total := v_total + 1;
    if coalesce(v_item->>'self_correct', '') = 'true' then
      v_correct := v_correct + 1;
    elsif v_q.type in ('multiple_choice', 'true_false', 'fill_blank') then
      if lower(trim(coalesce(v_item->>'answer', ''))) = lower(trim(v_q.correct_answer)) then
        v_correct := v_correct + 1;
      end if;
    end if;
  end loop;

  update public.challenge_attempts
    set completed_at = now(), score = v_correct, total = v_total
    where id = v_attempt.id;

  return jsonb_build_object('attempt_id', v_attempt.id, 'score', v_correct, 'total', v_total);
end;
$$;

grant execute on function public.grade_challenge_attempt(uuid, jsonb, integer) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_settings enable row level security;
alter table public.platform_settings enable row level security;
alter table public.sections enable row level security;
alter table public.topics enable row level security;
alter table public.task_categories enable row level security;
alter table public.task_tags enable row level security;
alter table public.tasks enable row level security;
alter table public.task_reminders enable row level security;
alter table public.timetable_entries enable row level security;
alter table public.learning_records enable row level security;
alter table public.learning_resources enable row level security;
alter table public.learning_paths enable row level security;
alter table public.learning_path_nodes enable row level security;
alter table public.learning_daily_progress enable row level security;
alter table public.streak_history enable row level security;
alter table public.flashcard_decks enable row level security;
alter table public.flashcards enable row level security;
alter table public.flashcard_reviews enable row level security;
alter table public.question_bank enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_questions enable row level security;
alter table public.challenge_attempts enable row level security;
alter table public.challenge_answers enable row level security;
alter table public.diary_entries enable row level security;
alter table public.goals enable row level security;
alter table public.goal_milestones enable row level security;
alter table public.integration_accounts enable row level security;
alter table public.integration_tokens enable row level security;
alter table public.integration_activity enable row level security;
alter table public.integration_sync_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.backup_records enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: read/update self; admin may read all (for user management).
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_roles: a user may read only their own role; only admins read all.
create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy user_roles_admin_write on public.user_roles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- platform settings: everyone authenticated reads; only admins write.
create policy platform_settings_read on public.platform_settings for select
  to anon, authenticated using (true);
create policy platform_settings_write on public.platform_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy user_settings_own on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- sections: users read their own copies (seeded on first sign-in). The global
-- template rows are only readable by the administrator, otherwise every user
-- would see both a global and a personal copy of each section.
create policy sections_read on public.sections for select to authenticated
  using (user_id = auth.uid() or (user_id is null and public.is_admin()));
create policy sections_write on public.sections for insert to authenticated
  with check (user_id = auth.uid() or (user_id is null and public.is_admin()));
create policy sections_update on public.sections for update to authenticated
  using (user_id = auth.uid() or (user_id is null and public.is_admin()))
  with check (user_id = auth.uid() or (user_id is null and public.is_admin()));
create policy sections_delete on public.sections for delete to authenticated
  using (user_id = auth.uid() or (user_id is null and public.is_admin()));

-- generic per-owner tables
do $$
declare t text;
begin
  foreach t in array array[
    'topics','task_categories','task_tags','tasks','task_reminders',
    'timetable_entries','learning_records','learning_resources','learning_paths',
    'learning_path_nodes','learning_daily_progress','streak_history',
    'flashcard_decks','flashcards','flashcard_reviews','question_bank',
    'challenges','challenge_questions','challenge_attempts','challenge_answers',
    'diary_entries','goals','goal_milestones','integration_accounts',
    'integration_activity','integration_sync_logs','notifications','backup_records'
  ] loop
    execute format('create policy %I_owner on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
  end loop;
end $$;

-- audit logs: admins read, server writes only.
create policy audit_logs_admin_read on public.audit_logs for select to authenticated
  using (public.is_admin());

-- integration_tokens has RLS enabled with NO policy: inaccessible to clients.
