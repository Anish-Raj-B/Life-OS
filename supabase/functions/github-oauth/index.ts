// Supabase Edge Function: github-oauth
// Handles the GitHub OAuth 2.0 handshake server-side so that no token or
// client secret ever reaches the browser.
//
//   POST  { action: "start" }        -> { url }        (state signed with HMAC)
//   GET   ?code=&state=              -> 302 to APP_URL/integrations?github=connected
//   POST  { action: "disconnect" }   -> revokes the token at GitHub, deletes it
//
// Required secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, APP_URL,
//                   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { createHmac } from 'node:crypto';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const env = (k: string) => Deno.env.get(k) ?? '';

const sign = (payload: string) =>
  createHmac('sha256', env('GITHUB_CLIENT_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY'))
    .update(payload)
    .digest('base64url');

function makeState(userId: string) {
  const payload = btoa(JSON.stringify({ uid: userId, exp: Date.now() + 10 * 60_000 }));
  return `${payload}.${sign(payload)}`;
}

function readState(state: string): string | null {
  const [payload, sig] = state.split('.');
  if (!payload || !sig || sign(payload) !== sig) return null;
  try {
    const data = JSON.parse(atob(payload));
    if (!data.uid || Date.now() > data.exp) return null;
    return data.uid as string;
  } catch {
    return null;
  }
}

function admin() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

async function currentUser(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);

  // ── OAuth callback ────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.searchParams.has('code')) {
    const code = url.searchParams.get('code')!;
    const uid = readState(url.searchParams.get('state') ?? '');
    const appUrl = env('APP_URL') || url.origin;
    if (!uid) return Response.redirect(`${appUrl}/integrations?github=error&reason=state`, 302);

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: env('GITHUB_CLIENT_ID'),
          client_secret: env('GITHUB_CLIENT_SECRET'),
          code,
        }),
      });
      const tokenJson = await tokenRes.json() as { access_token?: string; scope?: string; error?: string };
      if (!tokenJson.access_token) {
        return Response.redirect(`${appUrl}/integrations?github=error&reason=exchange`, 302);
      }

      const ghUser = await (await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'LIFE-OS',
        },
      })).json() as { id: number; login: string; avatar_url?: string };

      const db = admin();
      const { data: account, error } = await db
        .from('integration_accounts')
        .upsert({
          user_id: uid,
          provider: 'github',
          external_username: ghUser.login,
          external_user_id: String(ghUser.id),
          status: 'connected',
          scopes: (tokenJson.scope ?? 'read:user').split(/[ ,]+/).filter(Boolean),
          metadata: { avatar_url: ghUser.avatar_url },
          last_synced_at: null,
          last_error: null,
        }, { onConflict: 'user_id,provider' })
        .select('id')
        .single();
      if (error || !account) {
        return Response.redirect(`${appUrl}/integrations?github=error&reason=store`, 302);
      }

      await db.from('integration_tokens').upsert({
        account_id: account.id,
        user_id: uid,
        access_token: tokenJson.access_token,
        updated_at: new Date().toISOString(),
      });
      await db.from('integration_sync_logs').insert({
        user_id: uid, provider: 'github', status: 'success', message: 'GitHub account connected.',
      });
      return Response.redirect(`${appUrl}/integrations?github=connected`, 302);
    } catch (e) {
      return Response.redirect(`${appUrl}/integrations?github=error&reason=network`, 302);
    }
  }

  // ── authenticated actions ─────────────────────────────────────────────────
  const user = await currentUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body: { action?: string } = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { /* empty body */ }
  }

  if (body.action === 'start') {
    if (!env('GITHUB_CLIENT_ID')) return json({ error: 'github_not_configured' }, 503);
    const redirect = `${url.origin}${url.pathname}`;
    const params = new URLSearchParams({
      client_id: env('GITHUB_CLIENT_ID'),
      redirect_uri: redirect,
      scope: 'read:user public_repo',
      state: makeState(user.id),
      allow_signup: 'true',
    });
    return json({ url: `https://github.com/login/oauth/authorize?${params}` });
  }

  if (body.action === 'disconnect') {
    const db = admin();
    const { data: account } = await db
      .from('integration_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'github')
      .maybeSingle();

    if (account) {
      const { data: tok } = await db
        .from('integration_tokens')
        .select('access_token')
        .eq('account_id', account.id)
        .maybeSingle();

      if (tok?.access_token) {
        // Best-effort revocation at GitHub; local deletion happens regardless.
        await fetch(`https://api.github.com/applications/${env('GITHUB_CLIENT_ID')}/token`, {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${btoa(`${env('GITHUB_CLIENT_ID')}:${env('GITHUB_CLIENT_SECRET')}`)}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'LIFE-OS',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ access_token: tok.access_token }),
        }).catch(() => null);
      }

      await db.from('integration_tokens').delete().eq('account_id', account.id);
      await db.from('integration_accounts')
        .update({ status: 'disconnected', last_error: null })
        .eq('id', account.id);
      await db.from('integration_sync_logs').insert({
        user_id: user.id, provider: 'github', status: 'success', message: 'GitHub disconnected.',
      });
    }
    return json({ ok: true });
  }

  return json({ error: 'unknown_action' }, 400);
});
