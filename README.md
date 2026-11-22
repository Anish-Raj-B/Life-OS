# LIFE OS

A private, database-backed personal operating system for tasks, time, learning and long-term progress.

LIFE OS is a React + TypeScript single-page application backed by Supabase (PostgreSQL, Auth, Storage, Row Level Security). It is installable as a PWA, works offline for supported operations, and keeps every user's data isolated at the database layer.

---

## 1. What it does

| Module | Purpose |
|---|---|
| Dashboard | Daily summary: tasks, timetable, streak, pathways, integration cards, reminders |
| My Day | Focused view of today: schedule, due tasks, quick diary, flashcard reminder |
| Tasks | Create/edit/complete/reopen; priorities, deadlines, reminders, tags, links, filters and saved views |
| Timetable | Per-day time blocks, overlap validation, recurrence, current-time indicator |
| Analytics | Recharts dashboards + metric definitions + arbitrary date-range comparison |
| Learning | Dated learning records with Markdown notes, concepts, mistakes, next steps, duration |
| Sections | Subject tree (global template copied per user) with topics, progress and records |
| Paths | Visual streak pathways with three daily stages, globally sequential node numbers, permanent history |
| Flashcards | Decks and cards with SM-2 spaced repetition and review history |
| Challenges | Question-bank / flashcard / optional-AI quizzes with scoring and topic breakdown |
| Diary | Private dated Markdown entries with mood, tags and drafts |
| Goals | Long-term goals with milestones and progress |
| Resources | Categorised link manager with URL validation |
| Integrations | GitHub OAuth, LeetCode best-effort sync + manual fallback, PicoCTF manual tracking |
| Profile | Identity, ambitions, skills, links, timezone |
| Settings | Notifications, workspace preferences, offline queue, JSON backup/restore, account deletion |
| Admin | Global theme/navigation/modules/defaults, user list, suspension, announcements, audit log |

---

## 2. Architecture

```
Browser (React SPA, PWA)
  ├─ Supabase JS client (anon key only)  ──►  Supabase Postgres + RLS
  │                                           Supabase Auth (Google OAuth)
  │                                           Supabase Storage (avatars, attachments)
  ├─ IndexedDB (idb)                     ──►  read cache, outbox queue, diary drafts
  └─ supabase.functions.invoke()         ──►  Edge Functions (service role, never in browser)
                                               ├─ github-oauth
                                               ├─ integrations-sync
                                               └─ ai-questions (optional)
Cloudflare Pages serves the static build + SPA fallback.
```

- **One shared codebase**, responsive from 360 px to desktop.
- **Only public values in the bundle**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_URL`.
- **No service-role key in the browser.** Privileged operations run in SECURITY DEFINER SQL functions or Edge Functions.
- Dependency versions are pinned and `package-lock.json` is committed.

Full architecture, schema and security detail: [`docs/TECHNICAL.md`](docs/TECHNICAL.md).

---

## 3. Installation

**Prerequisites:** Node 20+ (developed on Node 24), npm 10+, a Supabase project, and (optional) the Supabase CLI.

```bash
npm install
cp .env.example .env      # then fill in the two Supabase values
npm run dev               # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`tsc --noEmit`) then production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm test` | Vitest (SRS + analytics unit tests) |
| `npm run preview` | Serve the production build locally |

If `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are missing or still placeholders, the app renders a setup screen instead of fake data. That is intentional.

---

## 4. Supabase configuration

### 4.1 Create the project and apply migrations

1. Create a project at <https://supabase.com/dashboard>.
2. Apply the SQL in order (SQL editor, or CLI):
   - `supabase/migrations/0001_schema.sql` — tables, indexes, `updated_at` / `version` triggers, global section seed.
   - `supabase/migrations/0002_rls.sql` — `is_admin()`, registration gate + bootstrap trigger, role hardening, `advance_learning_path()`, all RLS policies.
   - `supabase/migrations/0003_storage_admin.sql` — storage buckets/policies, profile field guard, audit helper, `admin_set_user_suspended`, `delete_own_account`, `admin_list_users`, owner-role bootstrap.
3. With the CLI:

   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```

4. Copy **Project URL** and **anon public key** into `.env`:

   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   ```

### 4.2 Authentication

- **Site URL:** `https://<your-domain>` (or `http://localhost:5173` locally).
- **Redirect URLs:** add `http://localhost:5173/**`, `https://<your-domain>/**`, and the Pages preview URL if used.
- **Google provider:** enable it under Authentication → Providers → Google and paste the Client ID/Secret from Google Cloud (below).
- Sign in once with `anishrajb21@gmail.com`. The `on_auth_user_created` trigger creates the profile, grants the **admin** role, creates `user_settings`, and copies the global section template into that user's private sections.

### 4.3 Registration gate

`PUBLIC_REGISTRATION_ENABLED` is stored in `public.platform_settings.public_registration_enabled` and starts as `false`. While false, the sign-up trigger raises `LIFE_OS_REGISTRATION_DISABLED` for every email except the owner, aborting the `auth.users` insert so no session and no data are created. The administrator can enable it from **Admin → Overview**; every later account gets role `user` and an isolated workspace.

### 4.4 Storage

`0003_storage_admin.sql` creates two **private** buckets: `avatars` and `attachments`, with policies restricting objects to `<user_id>/...` paths. Files are served through signed URLs.

### 4.5 Edge Functions

```bash
supabase functions deploy github-oauth integrations-sync ai-questions
```

Secrets (server-side only):

```bash
supabase secrets set \
  GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=... \
  APP_URL=https://<your-domain>
# optional AI:
supabase secrets set AI_API_KEY=... AI_BASE_URL=https://api.openai.com/v1 AI_MODEL=gpt-4o-mini
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions automatically.

---

## 5. Cloudflare Pages deployment

1. Push the repository to GitHub.
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings:
   - **Framework preset:** None (or Vite)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node version:** 20 or newer (`NODE_VERSION=20`)
4. Environment variables (Production **and** Preview):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_URL` = your production origin
5. `public/_redirects` contains `/* /index.html 200` for client-side routing; `public/_headers` sets baseline security headers.
6. Add the Pages domain to Supabase **Auth → URL Configuration → Redirect URLs** and to the Google OAuth authorized origins.
7. Custom domain: Pages → Custom domains → add and follow the DNS instructions, then update `VITE_APP_URL` and Supabase URLs to match.

Nothing here has been executed against a live account from this environment; see "Testing status".

---

## 6. Integrations

### GitHub (real OAuth + REST API)

1. GitHub → Settings → Developer settings → **OAuth Apps → New OAuth App**.
2. **Homepage URL:** `https://<your-domain>`.
3. **Authorization callback URL:** `https://<project-ref>.supabase.co/functions/v1/github-oauth`.
4. Put the Client ID/Secret in Supabase secrets (never in `VITE_*`).
5. In the app: **Integrations → GitHub → Connect**. Tokens are stored in `integration_tokens`, which has **no RLS policy** — only the service role can read it.
6. **Sync** stores verified per-day commit activity (`source='api'`, `verified=true`). Connecting an account alone never counts as contribution. Disconnect revokes the token at GitHub and deletes it locally.

Scopes requested: `read:user public_repo` (minimum needed to read public commit metadata).

### LeetCode (best effort + honest fallback)

No official public API exists. `integrations-sync` calls LeetCode's public GraphQL endpoint. If it fails, times out, or returns nothing, the app stores an explicit `last_error`, shows "automatic retrieval unavailable", and offers manual entry. Manual statistics are recorded with `source='manual'` and shown as such. No numbers are invented.

### PicoCTF (manual by design)

There is no permitted public statistics API and LIFE OS never asks for a PicoCTF password. Challenges are logged manually (name, category, difficulty, date, notes, link, evidence) and marked `manual`.

### AI questions (optional)

`ai-questions` returns `ai_not_configured` when no key is set; the Challenges module then uses the user's own question bank and flashcards. Generated questions are grounded in the user's learning records and labelled as practice, not official exam items. Every challenge works without any AI key.

---

## 7. Security model (summary)

- **RLS on every user-data table** for SELECT/INSERT/UPDATE/DELETE, scoped to `auth.uid()`.
- **Admin role** lives in `public.user_roles`, written only by SECURITY DEFINER triggers/functions; `guard_user_roles` rejects client role changes; `is_admin()` is used inside policies.
- **Diary, learning and integration rows are never readable by other users, including the admin.** Admin tools expose account metadata only.
- **OAuth tokens** are in a table with no client-visible policy; Edge Functions use the service role.
- **Storage** objects are owner-scoped by path prefix.
- **Profile privilege fields** (`suspended`, role-related) are guarded by trigger.
- **Audit log** records admin actions with metadata only — never tokens or private content.
- Every privileged UI action is backed by a policy or function, so opening a route in a non-admin session cannot grant access.

---

## 8. Offline & sync behaviour

- Supabase responses are cached in IndexedDB per collection; reads fall back to cache when offline.
- Writes that fail with a network error are queued in an outbox with an expected `version`.
- On reconnect the queue is flushed in order. Version mismatch or server rejection creates a **conflict** entry and never overwrites newer server data; the UI shows `pending`, `syncing`, `synced`, `offline`, or `error`.
- A record is never displayed as synced before the server confirms it.
- The service worker caches only the app shell — never Supabase responses.

---

## 9. Backup & restore

Settings → **Export JSON** writes your own tasks, timetable, sections/topics, learning records, pathways, flashcards, challenges, diary, goals, resources and integration activity. Tokens, secrets and audit logs are excluded.

Import validates the file, shows per-table counts, and asks for confirmation. **Merge** keeps existing rows; **Replace** deletes your current records first (with an explicit destructive confirmation).

Database backups (Supabase infrastructure) are for disaster recovery; JSON exports are portable and per-record restorable. They are not interchangeable.

---

## 10. Testing

```bash
npm run typecheck     # clean
npm test              # 17 tests, 2 files
npm run build         # succeeds
```

Covered by unit tests: SM-2 scheduling (`srs.test.ts`), analytics aggregation/comparison/heatmap (`analytics.test.ts`).

Not executed in this environment: SQL migrations against a live database, OAuth sign-in, RLS cross-user checks, storage permissions, Edge Function calls, PWA install, and browser interaction testing. See `docs/TECHNICAL.md` §7 for the exact list and a manual test plan.

---

## 11. Known limitations

- Supabase credentials were not available here, so migrations and functions are unexecuted; components compile but no live request was made.
- Background push notifications are not implemented. In-app and browser notifications work only while the app is open; the UI states this rather than claiming push delivery.
- LeetCode retrieval depends on an unofficial endpoint and can break; manual tracking is the guaranteed path.
- PicoCTF is manual-only by design.
- Cloudflare Pages deployment and custom-domain setup require your account.
- Capacitor/Tauri packaging is not configured in this repository; the SPA is structured to be wrappable (hash-free routing can be switched if a native shell needs it).

## 12. Future work

Public registration (already built, flag-off), a hybrid per-user workspace mode on top of `platform_settings`, native Android (Capacitor) and Windows (Tauri) shells, additional integrations, and automated end-to-end tests against a disposable Supabase project.
