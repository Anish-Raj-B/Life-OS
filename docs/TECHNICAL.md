# LIFE OS — Technical Documentation

Companion to `README.md`. This file documents the implementation details needed to operate, audit and extend the system.

---

## A. Project overview

### Modules and routes

| Route | File | Notes |
|---|---|---|
| `/` | `src/pages/Dashboard.tsx` | Widgets composed from live collections |
| `/my-day` | `src/pages/MyDay.tsx` | Today's schedule/tasks/diary/flashcards |
| `/tasks` | `src/pages/Tasks.tsx` | List + filters + modal editor |
| `/timetable` | `src/pages/Timetable.tsx` | Timeline, week overview, overlap checks |
| `/analytics` | `src/pages/Analytics.tsx` | Charts, metric docs, range comparison |
| `/learning` | `src/pages/Learning.tsx` | Markdown learning records |
| `/sections` | `src/pages/Sections.tsx` | Section/topic tree |
| `/paths` | `src/pages/Paths.tsx` | Streak pathway visualisation |
| `/flashcards` | `src/pages/Flashcards.tsx` | Decks, review session (SM-2) |
| `/challenges` | `src/pages/Challenges.tsx` | Builder, runner, history |
| `/diary` | `src/pages/Diary.tsx` | Calendar + Markdown entry editor |
| `/goals` | `src/pages/Goals.tsx` | Goals and milestones |
| `/resources` | `src/pages/Resources.tsx` | Link manager |
| `/integrations` | `src/pages/Integrations.tsx` | GitHub / LeetCode / PicoCTF cards |
| `/profile` | `src/pages/Profile.tsx` | Personal identity and links |
| `/settings` | `src/pages/SettingsPage.tsx` | Preferences, sync, backup, deletion |
| `/admin` | `src/pages/Admin.tsx` | Admin-only control plane |
| `/login`, `/auth/callback` | `src/pages/Login.tsx` | Google OAuth entry / return |

All routes except `/login` render inside `Protected`, which requires a session and a non-suspended profile. Every module is lazily imported, so the shell downloads only what is visited.

### Code layout

```
src/
  components/   ui.tsx (design system), Charts.tsx, Layout.tsx,
                SearchPalette.tsx, TaskModal.tsx
  context/      AuthContext, SettingsContext, SyncContext
  hooks/        useCollection.ts
  lib/          env, supabase, types, utils, offline, api, srs,
                analytics, challenges, backup
  pages/        18 route components
supabase/
  migrations/   0001_schema, 0002_rls, 0003_storage_admin
  functions/    github-oauth, integrations-sync, ai-questions
public/         manifest.webmanifest, sw.js, _redirects, _headers, icons
```

Dependency direction: `pages → hooks/context → lib`. `lib/api.ts` is the only module that writes to Supabase for data CRUD; `lib/offline.ts` owns all IndexedDB access.

---

## B. Installation

Prerequisites: Node ≥ 20, npm ≥ 10. No global tooling is required except optionally the Supabase CLI.

```bash
npm install
cp .env.example .env
npm run dev
```

Environment variables read by the frontend (`src/lib/env.ts`):

| Variable | Required | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Project URL |
| `VITE_SUPABASE_ANON_KEY` | yes | Public anon key (RLS still applies) |
| `VITE_APP_URL` | no | Canonical origin for OAuth redirects |

`IS_CONFIGURED` validates that the URL is http(s), the key is longer than 20 chars, and neither still contains the example placeholder. If false, `<SetupRequired />` renders and no Supabase client is used.

---

## C. Database

35 tables in `public`, all created by migration. User-owned rows carry `user_id uuid not null references auth.users(id) on delete cascade`.

### Schema groups

- **Identity/config:** `profiles`, `user_roles`, `platform_settings`, `user_settings`.
- **Taxonomy:** `sections` (nullable `user_id` = global template), `topics`.
- **Tasks:** `tasks`, `task_categories`, `task_tags`, `task_reminders`.
- **Time:** `timetable_entries`.
- **Learning:** `learning_records`, `learning_resources`.
- **Pathways/streaks:** `learning_paths`, `learning_path_nodes`, `learning_daily_progress`, `streak_history`.
- **Flashcards:** `flashcard_decks`, `flashcards`, `flashcard_reviews`.
- **Challenges:** `question_bank`, `challenges`, `challenge_questions`, `challenge_attempts`, `challenge_answers`.
- **Life:** `diary_entries`, `goals`, `goal_milestones`.
- **Integrations:** `integration_accounts`, `integration_tokens`, `integration_activity`, `integration_sync_logs`.
- **Platform:** `notifications`, `backup_records`, `audit_logs`.

### Constraints and history rules

- `learning_path_nodes` has `unique (user_id, seq_number)` and `unique (user_id, node_date)` — numbering is global per user, never per path, and a user cannot create two nodes for one date.
- `learning_daily_progress` has `unique (node_id, stage)`.
- `learning_paths_one_current` is a partial unique index on `(user_id) where is_current` — at most one active path.
- `streak_history` rows are append-only snapshots written when a streak breaks.
- No `on delete set null` cascade destroys historical learning: deleting a section nulls references but keeps records.
- `touch_updated_at()` triggers fire on update for 17 tables; `bump_version()` increments `version` for the 11 tables that expose optimistic concurrency.

### Pathway numbering

`public.advance_learning_path()` (SECURITY DEFINER) runs server-side:

1. Resolves the user's current path and today's node (timezone-aware date is computed by the caller).
2. Computes the next `seq_number` as `max(seq_number) + 1` for the user (global, never reset).
3. If the previous node date is more than one day old, closes the current path (`is_current=false`), writes a `streak_history` row, and opens a new path before inserting the node.
4. Marks stages 1–3 in `learning_daily_progress`, and optionally marks the node verified with a source (`auto` or `manual`).

Because the sequence derives from existing rows, numbers are never reused and earlier paths are never modified.

---

## D. Row Level Security and authorization

`0002_rls.sql` defines:

- `public.is_admin()` — checks `user_roles` for the caller.
- `public.registration_enabled()` — reads the singleton `platform_settings` row.
- `on_auth_user_created()` — AFTER INSERT on `auth.users`; enforces the registration gate, creates profile/role/settings, copies the global section template.
- `guard_user_roles()` — raises on any non-admin role insert/update.
- RLS enabled + policies on every user-data table.

Policy shape (example):

```sql
create policy tasks_read on public.tasks for select to authenticated
  using (user_id = auth.uid());
create policy tasks_write on public.tasks for insert to authenticated
  with check (user_id = auth.uid() and not profile_suspended());
```

Notable policies:

- `sections_read`: `user_id = auth.uid() or (user_id is null and public.is_admin())`. Normal users see only their private copies, so the seeded global template does not duplicate the list.
- `integration_tokens`: **no policy at all**. Clients receive zero rows; only the service role (Edge Functions) reads it.
- `audit_logs`: insert/select restricted to admins; metadata only.
- `platform_settings`: readable by all authenticated users (theme/nav must apply globally), writable only by admins.

Client-side checks (`isAdmin` in `AuthContext`, `AdminOnly` route) are UX only. Every request is re-authorized by Postgres.

Admin RPCs are SECURITY DEFINER and re-check `is_admin()` internally: `admin_list_users(search)`, `admin_set_user_suspended(user_id, suspended)`, `log_admin_action(...)`, `delete_own_account()`.

---

## E. Frontend data layer

### Reads

`listRows(table, opts)` selects the whole collection (RLS scopes it), writes it to IndexedDB via `cacheCollection`, and returns `{ data, fromCache }`. On network failure it returns the cached copy; if there is none, it throws a typed message. `useCollection` subscribes to `onDataChanged` so mutations refresh every mounted consumer without refetch storms.

### Writes

`insertRow` / `updateRow` / `deleteRow` write immediately. If the failure `isNetworkError`, the mutation is queued.

Queued payloads are built by `offlinePayload`, which stamps `id`, `created_at`, `updated_at`, `version` and `user_id`. **`sanitize(table, payload)` strips any bookkeeping column the target table does not own**, using column sets mirrored from `0001_schema.sql` (`WITH_CREATED_AT`, `WITH_UPDATED_AT`, `WITH_VERSION`). This matters for `flashcard_reviews`, `challenge_questions`, `challenge_attempts`, `learning_daily_progress`, `goal_milestones`, `integration_activity`, `notifications`, `backup_records`, and other tables whose timestamp column is named differently (`reviewed_at`, `started_at`, `completed_at`) or absent.

### Outbox and conflicts

`flushOutbox()` processes items in creation order:

- `insert` → `upsert(..., onConflict: 'id')`.
- `update` with `expectedVersion` → `.eq('version', expectedVersion)`; zero rows updated is treated as a conflict by the caller path.
- `delete` → delete; missing row (`PGRST116`) is treated as already applied.
- Network error → stop, keep the queue, state `offline`.
- Server rejection → write a conflict record with the local payload and the server message, drop the item, state `error`.

Conflicts are surfaced in Settings with the table and reason. The server row is never overwritten by stale local data.

### Offline drafts

Diary drafts and learning notes are written to IndexedDB (`idb`) on a debounce, so a lost connection never loses typed text. Drafts are cleared only after the server confirms the insert/update.

---

## F. Metric definitions

`src/lib/analytics.ts` is the single source of truth, and the Analytics page renders the same text under "How metrics work".

| Metric | Definition |
|---|---|
| Created | `tasks.created_at` inside the range |
| Completed | `status='completed'` and `completed_at` inside the range |
| Cancelled | `status='cancelled'` and `updated_at` inside the range |
| Missed | `due_date` inside the range, not completed, not cancelled, `due_date < today` |
| Completion rate | `completed / (completed + missed) × 100`, **null** when the denominator is 0 |
| Learning minutes | Sum of `duration_minutes` on records dated in the range |
| Flashcards reviewed | Reviews with `reviewed_at` in the range |
| Challenge accuracy | `sum(score) / sum(total) × 100` over attempts completed in the range, null when no questions |
| Active days | Distinct dates with a completion, learning record or review |
| Productivity index | Derived: `completed + 0.5 × (day has learning)`, normalised to the best day in the range, 0–100 |
| Streak summary | Current streak + `streak_history` longest/completed paths |

Comparison (`compare(a, b)`) returns absolute difference, percentage change (null when the baseline is 0), and a direction. Missing historical data yields `null` → "unavailable", never a fabricated value. The comparison control supports yesterday/today, week-over-week, month-over-month, year-over-year and two custom ranges.

Heatmap levels are 0–4, scaled to the busiest day in the visible window.

---

## G. Integrations (implementation)

### github-oauth

- `POST {action:'start'}` → returns the GitHub authorize URL. State is `base64({uid, exp})` + HMAC-SHA256 signature using the client secret, valid 10 minutes.
- `GET ?code=&state=` → exchanges the code, fetches `/user`, upserts `integration_accounts`, stores the token in `integration_tokens`, logs the sync, then 302s to `APP_URL/integrations?github=connected`.
- `POST {action:'disconnect'}` → best-effort token revocation at GitHub, then deletes the token and marks the account `disconnected`.
- Caller identity is verified with `auth.getUser(token)` using the service-role client.

### integrations-sync

- **GitHub:** reads `/user`, up to 100 repos, and commits authored by the linked username in the 10 most recent repos over 90 days. Groups by day, upserts `integration_activity` with `source='api'`, `verified=true`, and an `external_id` that makes the upsert idempotent. Updates `metadata` with repo summaries, commit count and latest commit date. A 401 marks the account `error` with a reconnect message.
- **LeetCode:** calls the public GraphQL `matchedUser.submitStatsGlobal` query with a 9 s timeout. Success writes totals plus `auto_retrieved_at`; failure stores `last_error` and the UI switches to manual entry.
- **PicoCTF:** returns `{ok:false, reason:'unsupported'}` — manual tracking is the only supported path.

### ai-questions

Requires `AI_API_KEY`. Authenticates the user, loads their own learning records and topic names, builds a grounded prompt, and requests strict JSON. Returns `{ok:false, reason}` for not-configured, no-material, provider error or empty generation. The client always falls back to manual/flashcard questions.

---

## H. Security and operations

- Anon key only in the bundle; RLS is the authorization boundary.
- Service-role key exists only in Edge Function runtime.
- OAuth tokens: no RLS policy, revoked and deleted on disconnect.
- Storage: private buckets, path-prefix policies, signed URLs.
- `delete_own_account()` removes the caller's rows and auth user; the admin account is explicitly protected.
- `admin_set_user_suspended` blocks sign-in and is audited.
- `log_admin_action` records action, entity, entity id, metadata keys and timestamp.
- Security headers and SPA fallback ship in `public/_headers` and `public/_redirects`.
- The service worker never caches Supabase responses; only the shell and static assets.

---

## I. Testing

### Executed here

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | 17 passed / 17 (2 files) |
| `npm run build` | success, `dist/` produced |

Unit test coverage:

- `src/lib/srs.test.ts` — SM-2 intervals, ease floor, lapses, retention.
- `src/lib/analytics.test.ts` — completion/missed/cancelled counting, null completion rate, accuracy from completed attempts only, daily series length and clamped productivity, comparison with no baseline, heatmap bounds, inclusive ranges, review counting. Includes an explicit test that a cancellation outside the range is not counted.

### Not executed (environmental limitation)

No Supabase project or credentials were available, so the following are **unverified**, not passing:

1. Applying `0001`–`0003` to a real database.
2. Google sign-in round trip, session refresh, logout.
3. RLS cross-user isolation (two accounts), IDOR attempts, role escalation attempts.
4. Storage upload/download permission checks.
5. Owner bootstrap and the registration gate rejecting a second account.
6. `advance_learning_path()` numbering across a simulated streak break.
7. Edge Functions: GitHub connect/sync/disconnect, LeetCode fallback, AI fallback.
8. PWA install, offline mutation + reconnect flush, conflict display.
9. JSON export → import round trip.
10. Responsive layout at 360 / 768 / 1440 px.

---

## J. Manual test guide

### 0. Database

1. Create a Supabase project, run the three migrations in order.
2. Confirm tables exist and `select * from platform_settings` returns one row with `public_registration_enabled = false`.

### 1. Authentication and privacy

1. Set `.env`, run `npm run dev`, open the app. The login screen must appear (not the setup screen).
2. Sign in with `anishrajb21@gmail.com`. You should land on the dashboard and see **Admin** in the sidebar.
3. Check `select * from user_roles` → one row, role `admin`.
4. In a private window, try to sign in with a different Google account. It must fail with the registration-disabled message and create no `auth.users` row.
5. Admin → Overview → enable public registration. Try the second account again: it should succeed, get role `user`, and see no Admin item.
6. As the second user, confirm sections/tasks are empty and distinct. Attempt to read the first user's rows with the anon key in the browser console (`supabase.from('tasks').select('*')`) — only your own rows return.

### 2. Tasks

1. Create a task for today with priority High and a due time. Reload — it persists.
2. Complete it; check `completed_at` is set and `version` incremented.
3. Reopen it; create a cancelled task; confirm analytics does not count it as completed.
4. Create one overdue task; it appears under Overdue and in "missed" analytics.

### 3. Timetable

1. Add 06:00–07:00 Exercise and 09:00–10:30 Study. Reload — persisted.
2. Try overlapping 09:30–10:00; the app must reject it.
3. Switch to weekly view; change an end time earlier than the start; `timetable_time_order` must reject it.

### 4. Learning, sections, paths

1. Add a topic under Cybersecurity, then a learning record dated today with notes and 45 minutes.
2. Paths → mark stage 1, then 2, then 3. Node 1 exists with three progress rows.
3. Simulate a break: set the node date two days back in SQL, then mark today's stage. Expect a new path starting at the next global number (e.g. 2), the old path closed, and a `streak_history` row.
4. Confirm the first path is still visible and its number was not reused.

### 5. Flashcards

1. Create a deck and a card. Review it as "remembered" — `due_date` moves forward and a `flashcard_reviews` row is written.
2. Review another as "difficult" — ease drops, state becomes `difficult`, and it reappears soon.
3. Confirm totals (learned/pending/due/retention) match the rows.

### 6. Challenges

1. Add questions manually to the bank for a topic; run a 5-question mixed challenge.
2. Answer some wrong; the result screen shows score, percentage, time, explanations and topic weaknesses.
3. Reload Challenges — the attempt is in history.
4. With no AI key, verify the builder offers bank/flashcard questions and explains AI is unavailable. With a key set, generate and confirm questions are grounded in your records.

### 7. Diary, goals, resources

1. Write a diary entry, navigate to another page and back mid-typing — the draft survives.
2. Reload — the saved entry persists; only your account can see it.
3. Create a goal with two milestones; tick one; progress updates.
4. Add a resource with a bad URL (`javascript:alert(1)`); it must be rejected. Add a valid one; the link opens in a new tab with `rel="noopener noreferrer"`.

### 8. Analytics

1. Complete tasks on two different days; the line/bar/area charts show those days only.
2. Compare today vs the same date last week. With no historical data, values show as unavailable (not zero-filled fictions).
3. Compare two custom ranges and check the absolute/percentage columns against the raw rows.

### 9. Offline and sync

1. Create a task, then DevTools → Network → Offline. Create another task and complete the first.
2. The status shows offline/pending and the changes are visible immediately.
3. Go back online, press **Sync now**. Items flush, status becomes synced, and both exist in Postgres.
4. Force a conflict: edit the same row in SQL (bump `version`), then flush an older local update. A conflict appears in Settings and the server value is unchanged.

### 10. Backup

1. Export JSON; inspect that it contains your tables and **no** tokens.
2. Delete a task, then import the file in Merge mode — it returns.
3. Try Replace mode; the destructive confirmation must appear before anything is deleted.

### 11. Integrations

1. Configure the GitHub OAuth app and Supabase secrets, deploy functions.
2. Connect GitHub; you are redirected back with `github=connected`, and the username/repo count appear.
3. Press Sync; verified commit days appear in activity. Connecting without commits must not create streak evidence.
4. Disconnect; the token row is deleted and the card shows disconnected.
5. LeetCode: enter a username, press Refresh. Either real stats appear (marked auto) or an explicit "unavailable, use manual" error appears. Never invented numbers.
6. PicoCTF: log a challenge manually; it appears with a manual badge.

### 12. PWA and responsive

1. `npm run build && npm run preview`; in Chrome, install the app. It opens standalone.
2. Load once, go offline, relaunch: the shell opens and cached data renders with an offline indicator.
3. Repeat the main flows at 360 px, 768 px and 1440 px; check the sidebar collapses and charts remain readable.

### 13. Admin

1. As the owner, change the accent colour and application name; reload as the second user — they see the same theme and cannot change it.
2. Reorder navigation and disable a module; the sidebar changes for all users.
3. Suspend the second user; their next request is blocked and their data is preserved. Reactivate.
4. Check Admin → Audit log records these actions with no secrets.
5. As a non-admin, open `/admin` directly — you are redirected and the RPCs return permission errors if called manually.
