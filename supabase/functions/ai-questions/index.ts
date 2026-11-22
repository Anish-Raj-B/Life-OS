// Supabase Edge Function: ai-questions
// OPTIONAL question generation. The app is fully usable without any AI key:
// challenges are built from the user's own question bank and flashcards.
//
// The provider key lives only in Supabase secrets. This function authenticates
// the caller, loads their own learning records for the selected topics, and
// asks the model for questions grounded in that material.
//
//   POST { topic_ids: string[], difficulty: string, count: number, section_id?: string }

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

type Generated = {
  type: 'multiple_choice' | 'true_false' | 'fill_blank' | 'scenario' | 'conceptual' | 'practical';
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!env('AI_API_KEY')) {
    // Expected, not an error: the client falls back to the manual question bank.
    return json({ ok: false, reason: 'ai_not_configured' }, 200);
  }

  const service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth, error: authError } = await service.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({})) as {
    topic_ids?: string[]; difficulty?: string; count?: number;
  };
  const topicIds = (body.topic_ids ?? []).slice(0, 8);
  const count = Math.min(Math.max(Number(body.count ?? 10), 1), 20);
  const difficulty = ['beginner', 'intermediate', 'advanced'].includes(body.difficulty ?? '')
    ? body.difficulty
    : 'mixed';

  if (topicIds.length === 0) return json({ ok: false, reason: 'no_topics' }, 200);

  const { data: records } = await service
    .from('learning_records')
    .select('title, learned, key_concepts, notes_md, topic_id')
    .eq('user_id', auth.user.id)
    .in('topic_id', topicIds)
    .order('record_date', { ascending: false })
    .limit(12);

  const { data: topics } = await service
    .from('topics')
    .select('name')
    .eq('user_id', auth.user.id)
    .in('id', topicIds);

  const context = (records ?? [])
    .map((r) => `# ${r.title}\n${r.learned ?? ''}\n${r.key_concepts ?? ''}\n${(r.notes_md ?? '').slice(0, 900)}`)
    .join('\n---\n')
    .slice(0, 10000);

  if (!context.trim()) {
    return json({
      ok: false,
      reason: 'no_material',
      message: 'Add learning records for the selected topics first, or write questions manually.',
    }, 200);
  }

  const prompt = `You write practice questions for a personal learning app.
Topics: ${(topics ?? []).map((t) => t.name).join(', ')}.
Difficulty: ${difficulty}.
Source material written by the learner:
${context}

Return STRICT JSON: {"questions":[{"type":"multiple_choice|true_false|fill_blank|scenario|conceptual|practical","question":"...","options":["..."],"correct_answer":"...","explanation":"..."}]}
Rules: exactly ${count} questions; only cover the source material; multiple_choice needs 4 options; true_false uses options ["True","False"]; fill_blank has empty options and a single word/phrase answer. These are practice questions, not official exam items.`;

  try {
    const res = await fetch(`${env('AI_BASE_URL') || 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('AI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env('AI_MODEL') || 'gpt-4o-mini',
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You generate grounded study questions and reply with JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!res.ok) return json({ ok: false, reason: 'provider_error', status: res.status }, 200);
    const payload = await res.json() as any;
    const raw = payload?.choices?.[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { questions?: Generated[] };
    const questions = (parsed.questions ?? []).slice(0, count).filter((q) => q?.question && q?.correct_answer);
    if (!questions.length) return json({ ok: false, reason: 'empty_generation' }, 200);

    return json({ ok: true, questions, model: env('AI_MODEL') || 'gpt-4o-mini' });
  } catch (e) {
    return json({ ok: false, reason: 'provider_unreachable', message: String(e) }, 200);
  }
});
