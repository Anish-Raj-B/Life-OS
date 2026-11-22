// Supabase Edge Function: integrations-sync
// Pulls real activity data for connected integrations and records it with a
// source + verification flag. Never fabricates numbers: when a provider has no
// permitted public endpoint the function reports `unsupported` and the UI
// falls back to manual tracking.
//
//   POST { provider: "github" | "leetcode" | "picoctf" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const env = (k: string) => Deno.env.get(k) ?? '';

function admin() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

const gh = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'LIFE-OS',
  'X-GitHub-Api-Version': '2022-11-28',
});

async function syncGithub(db: ReturnType<typeof admin>, userId: string) {
  const { data: account } = await db
    .from('integration_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'github')
    .maybeSingle();

  if (!account || account.status !== 'connected') {
    return { ok: false, reason: 'not_connected' as const };
  }

  const { data: tok } = await db
    .from('integration_tokens')
    .select('access_token')
    .eq('account_id', account.id)
    .maybeSingle();

  if (!tok?.access_token) return { ok: false, reason: 'no_token' as const };

  const token = tok.access_token as string;
  const username = account.external_username as string;

  const userRes = await fetch('https://api.github.com/user', { headers: gh(token) });
  if (userRes.status === 401) {
    await db.from('integration_accounts').update({ status: 'error', last_error: 'GitHub token expired — reconnect.' }).eq('id', account.id);
    return { ok: false, reason: 'token_invalid' as const };
  }
  const profile = await userRes.json() as any;

  const reposRes = await fetch(
    `https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator`,
    { headers: gh(token) },
  );
  const repos = reposRes.ok ? (await reposRes.json() as any[]) : [];

  // Public commit metadata authored by the linked account, last 90 days.
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const repoFullNames: string[] = repos.slice(0, 10).map((r) => r.full_name);
  const commits: any[] = [];

  for (const full of repoFullNames) {
    const res = await fetch(
      `https://api.github.com/repos/${full}/commits?author=${encodeURIComponent(username)}&since=${since}&per_page=30`,
      { headers: gh(token) },
    );
    if (!res.ok) continue; // rate limited / empty repo — skip quietly
    const list = await res.json() as any[];
    for (const c of list) {
      commits.push({
        sha: c.sha,
        repo: full,
        date: c.commit?.author?.date,
        message: (c.commit?.message ?? '').split('\n')[0].slice(0, 160),
        url: c.html_url,
        author_login: c.author?.login ?? username,
      });
    }
  }

  // Persist verified per-day activity. Only commits whose author matches the
  // linked account count as streak evidence.
  const byDay = new Map<string, any[]>();
  for (const c of commits) {
    if (!c.date) continue;
    const day = c.date.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), c]);
  }

  const rows = [...byDay.entries()].map(([day, list]) => ({
    user_id: userId,
    provider: 'github',
    activity_date: day,
    kind: 'commit',
    count: list.length,
    details: { commits: list.slice(0, 10) },
    external_id: `gh-${day}-${list.length}`,
    source: 'api',
    verified: true,
  }));

  if (rows.length) {
    await db.from('integration_activity').upsert(rows, {
      onConflict: 'user_id,provider,external_id',
      ignoreDuplicates: true,
    });
  }

  const latest = commits.map((c) => c.date).filter(Boolean).sort().at(-1) ?? null;

  await db.from('integration_accounts').update({
    status: 'connected',
    last_synced_at: new Date().toISOString(),
    last_error: null,
    metadata: {
      avatar_url: profile.avatar_url,
      public_repos: profile.public_repos,
      followers: profile.followers,
      bio: profile.bio,
      html_url: profile.html_url,
      repositories: repos.slice(0, 8).map((r) => ({
        name: r.name,
        full_name: r.full_name,
        url: r.html_url,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        pushed_at: r.pushed_at,
      })),
      commits_90d: commits.length,
      latest_commit_at: latest,
    },
  }).eq('id', account.id);

  await db.from('integration_sync_logs').insert({
    user_id: userId, provider: 'github', status: 'success',
    message: `Synced ${commits.length} commits across ${repoFullNames.length} repositories.`,
  });

  return { ok: true, commits: commits.length, days: rows.length, latest };
}

async function syncLeetcode(db: ReturnType<typeof admin>, userId: string) {
  const { data: account } = await db
    .from('integration_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'leetcode')
    .maybeSingle();

  if (!account?.external_username) return { ok: false, reason: 'no_username' as const };

  // LeetCode publishes no official public API. This endpoint is best-effort and
  // may be unavailable; the caller must treat a failure as "manual tracking".
  try {
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: 'https://leetcode.com' },
      body: JSON.stringify({
        query: `query userStats($u: String!) {
          matchedUser(username: $u) {
            username
            submitStatsGlobal { acSubmissionNum { difficulty count } }
          }
        }`,
        variables: { u: account.external_username },
      }),
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) throw new Error(`leetcode responded ${res.status}`);
    const body = await res.json() as any;
    const stats = body?.data?.matchedUser?.submitStatsGlobal?.acSubmissionNum;
    if (!Array.isArray(stats) || stats.length === 0) throw new Error('no stats returned');

    const nums = Object.fromEntries(stats.map((s: any) => [s.difficulty, s.count]));
    await db.from('integration_accounts').update({
      status: 'connected',
      last_synced_at: new Date().toISOString(),
      last_error: null,
      metadata: {
        ...(account.metadata ?? {}),
        total_solved: nums.All ?? 0,
        easy_solved: nums.Easy ?? 0,
        medium_solved: nums.Medium ?? 0,
        hard_solved: nums.Hard ?? 0,
        auto_retrieved_at: new Date().toISOString(),
        endpoint: 'unofficial-graphql',
      },
    }).eq('id', account.id);

    await db.from('integration_sync_logs').insert({
      user_id: userId, provider: 'leetcode', status: 'success',
      message: 'Automatic statistics retrieved (unofficial endpoint).',
    });
    return { ok: true, auto: true, stats: nums };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unavailable';
    await db.from('integration_accounts').update({
      last_synced_at: new Date().toISOString(),
      last_error: `Automatic retrieval unavailable (${message}). Use manual entry.`,
    }).eq('id', account.id);
    await db.from('integration_sync_logs').insert({
      user_id: userId, provider: 'leetcode', status: 'error', message,
    });
    return { ok: false, reason: 'auto_unavailable' as const, message };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const db = admin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return json({ error: 'unauthorized' }, 401);

  let provider = '';
  try { provider = (await req.json()).provider ?? ''; } catch { /* noop */ }
  const userId = data.user.id;

  try {
    if (provider === 'github') return json(await syncGithub(db, userId));
    if (provider === 'leetcode') return json(await syncLeetcode(db, userId));
    if (provider === 'picoctf') {
      // PicoCTF exposes no permitted public statistics API and requires no
      // credentials to be shared. Manual tracking is the supported path.
      return json({
        ok: false,
        reason: 'unsupported',
        message: 'PicoCTF has no public statistics endpoint. Log challenges manually; they appear in your progress with a manual badge.',
      }, 200);
    }
    return json({ error: 'unknown_provider' }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'sync failed';
    await db.from('integration_sync_logs').insert({
      user_id: userId, provider: provider || 'unknown', status: 'error', message,
    });
    return json({ ok: false, error: message }, 500);
  }
});
