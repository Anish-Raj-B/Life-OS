-- ============================================================================
-- LIFE OS — 0003 storage, admin helpers, audit trigger
-- ============================================================================

-- ── storage buckets and per-user isolation ──────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do nothing;

-- Files live under <user_id>/... ; policies enforce the first path segment.
create policy "avatars read" on storage.objects for select
  using (bucket_id = 'avatars');
create policy "avatars write" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments write" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- Users may edit their own profile, but never their suspension state, email
-- or admin-visible fields. Enforced in the database, not the client.
create or replace function public.guard_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.suspended is distinct from old.suspended then
      raise exception 'FIELD_FORBIDDEN: suspended' using errcode = '42501';
    end if;
    if new.email is distinct from old.email then
      raise exception 'FIELD_FORBIDDEN: email' using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'FIELD_FORBIDDEN: id' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_fields();

-- ── audit helper callable only by admins ────────────────────────────────────
create or replace function public.log_admin_action(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  -- Never record tokens or credentials: the caller controls metadata and the
  -- admin UI only sends identifiers and counters.
  insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
grant execute on function public.log_admin_action(text, text, text, jsonb) to authenticated;

-- Admin: suspend / unsuspend / delete a user account (server-side, audited).
create or replace function public.admin_set_user_suspended(p_user_id uuid, p_suspended boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY' using errcode = '42501'; end if;
  update public.profiles set suspended = p_suspended where id = p_user_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, metadata)
  values (auth.uid(), case when p_suspended then 'user.suspend' else 'user.activate' end,
          'profiles', p_user_id::text, '{}'::jsonb);
end;
$$;
grant execute on function public.admin_set_user_suspended(uuid, boolean) to authenticated;

-- Account self-deletion: removes the auth user, cascading every owned record.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if exists (select 1 from public.user_roles where user_id = v_user and role = 'admin') then
    raise exception 'ADMIN_CANNOT_SELF_DELETE' using errcode = '42501';
  end if;
  delete from auth.users where id = v_user;
end;
$$;
grant execute on function public.delete_own_account() to authenticated;

-- Directory search for the admin panel (never exposes secrets).
create or replace function public.admin_list_users(p_search text default null)
returns table (
  id uuid, email text, full_name text, avatar_url text, role text,
  suspended boolean, created_at timestamptz, last_sign_in_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.email, p.full_name, p.avatar_url,
         coalesce(r.role, 'user'), p.suspended, p.created_at, u.last_sign_in_at
  from public.profiles p
  left join public.user_roles r on r.user_id = p.id
  left join auth.users u on u.id = p.id
  where public.is_admin()
    and (p_search is null or p_search = ''
         or p.email ilike '%' || p_search || '%'
         or coalesce(p.full_name, '') ilike '%' || p_search || '%')
  order by p.created_at desc
  limit 200;
$$;
grant execute on function public.admin_list_users(text) to authenticated;

-- Bootstrap the owner role if the account already existed before this migration.
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where lower(email) = 'anishrajb21@gmail.com'
on conflict (user_id) do update set role = 'admin';

-- Guarantee no other account can ever hold the admin role.
delete from public.user_roles
where role = 'admin'
  and user_id not in (select id from auth.users where lower(email) = 'anishrajb21@gmail.com');
