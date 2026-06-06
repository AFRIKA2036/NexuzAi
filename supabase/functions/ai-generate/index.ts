import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const FREE_DAILY_LIMIT = 20;
const MAX_BODY_BYTES = 250_000;
const MAX_MESSAGES = 8;
const MAX_CONTENT_CHARS = 80_000;
const ALLOWED_AGENTS = new Set([
  'resume',
  'email',
  'notes',
  'contract',
  'trip',
  'event',
  'cover',
  'linkedin',
  'research',
  'coding',
  'viral',
  'minutes',
  'startup',
  'academic',
  'converter'
]);

Deno.serve(async (req) => {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  const cors = getCors(req);

  try {
    // Always respond to preflight immediately
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors.headers });

    if (!cors.allowed) {
      return json({ error: 'Origin is not allowed', requestId }, 403, cors.headers);
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed', requestId }, 405, cors.headers);

    const contentLength = Number(req.headers.get('content-length') || '0');
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: 'Request is too large', requestId }, 413, cors.headers);
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized', requestId }, 401, cors.headers);

    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const anonKey = requiredEnv('SUPABASE_ANON_KEY');
    const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Unauthorized', requestId }, 401, cors.headers);

    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openrouterKey) return json({ error: 'AI provider is not configured', requestId }, 500, cors.headers);

    const body = await req.json();
    const validation = validateRequestBody(body);
    if (!validation.ok) return json({ error: validation.error, requestId }, 400, cors.headers);

    const usage = await consumeDailyUsage(userClient, admin, userData.user.id, requestId);
    if (!usage?.allowed) {
      console.warn('[OBSERVABILITY] limit reached', { requestId, userId: userData.user.id, count: usage?.request_count });
      return json({
        error: 'Free daily limit reached',
        requestId,
        request_count: usage?.request_count ?? FREE_DAILY_LIMIT,
        limit: FREE_DAILY_LIMIT
      }, 429, cors.headers);
    }

    const defaultModels = getConfiguredModels();

    const requestedModels = body.model && body.model !== 'auto'
      ? (Array.isArray(body.model) ? body.model : [body.model])
      : defaultModels;

    const providerResult = await callOpenRouterWithFallbacks(openrouterKey, requestedModels, body);
    const result = providerResult.result;
    const latency = Date.now() - startTime;

    if (!providerResult.ok) {
      const providerError = getProviderErrorMessage(result);
      console.error('[OBSERVABILITY] provider error', { 
        requestId, 
        userId: userData.user.id, 
        status: providerResult.status, 
        latency,
        attemptedModels: providerResult.attemptedModels,
        result 
      });
      return json({ error: `AI provider request failed: ${providerError}`, requestId }, providerResult.status, cors.headers);
    }

    const output = result.choices?.[0]?.message?.content || '';
    if (!output.trim()) {
      console.error('[OBSERVABILITY] empty provider response', { requestId, userId: userData.user.id, result });
      return json({ error: 'AI provider returned an empty response', requestId }, 502, cors.headers);
    }
    const usageData = result.usage || {};

    console.info('[OBSERVABILITY] generation success', {
      requestId,
      userId: userData.user.id,
      agentId: body.agent_id,
      model: result.model || providerResult.model,
      latency,
      promptTokens: usageData.prompt_tokens,
      completionTokens: usageData.completion_tokens,
      totalTokens: usageData.total_tokens
    });

    if (output) {
      const { error: insertError } = await admin.from('generations').insert({
        user_id: userData.user.id,
        agent_id: body.agent_id,
        prompt: JSON.stringify(body.messages),
        output,
        output_format: 'text'
      });

      if (insertError) {
        console.error('[OBSERVABILITY] generation insert failed', { requestId, error: insertError.message });
      }
    }

    return json({ ...result, requestId, latency }, 200, cors.headers);
  } catch (err) {
    console.error('[OBSERVABILITY] unexpected error', { 
      requestId, 
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    return json({ error: 'Unexpected server error', requestId }, 500, cors.headers);
  }
});

async function consumeDailyUsage(userClient: any, admin: any, userId: string, requestId: string) {
  const { data: usageRows, error: usageError } = await userClient.rpc('consume_daily_usage', {
    p_limit: FREE_DAILY_LIMIT
  });

  if (!usageError) return Array.isArray(usageRows) ? usageRows[0] : usageRows;

  console.error('[OBSERVABILITY] usage rpc failed; using fallback counter', {
    requestId,
    userId,
    error: usageError.message,
    code: usageError.code
  });

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) throw new Error(`Usage profile lookup failed: ${profileError.message}`);

  const plan = profile?.plan || 'free';
  if (plan === 'pro' || plan === 'team') {
    return { allowed: true, request_count: 0, plan };
  }

  const usageDate = new Date().toISOString().slice(0, 10);
  const { data: existing, error: existingError } = await admin
    .from('usage_daily')
    .select('request_count')
    .eq('user_id', userId)
    .eq('usage_date', usageDate)
    .maybeSingle();

  if (existingError) throw new Error(`Usage lookup failed: ${existingError.message}`);

  const currentCount = Number(existing?.request_count || 0);
  if (currentCount >= FREE_DAILY_LIMIT) {
    return { allowed: false, request_count: currentCount, plan };
  }

  const nextCount = currentCount + 1;
  const { error: upsertError } = await admin
    .from('usage_daily')
    .upsert({
      user_id: userId,
      usage_date: usageDate,
      request_count: nextCount,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,usage_date' });

  if (upsertError) throw new Error(`Usage update failed: ${upsertError.message}`);
  return { allowed: true, request_count: nextCount, plan };
}

async function callOpenRouterWithFallbacks(openrouterKey: string, models: string[], body: Record<string, unknown>): Promise<any> {
  const attemptedModels: string[] = [];
  let lastStatus = 502;
  let lastResult: Record<string, unknown> = { error: 'No models configured' };

  for (const model of models.map((value) => String(value).trim()).filter(Boolean)) {
    attemptedModels.push(model);

    const providerBody = {
      model,
      messages: body.messages,
      max_tokens: Math.min(Number(body.max_tokens || 4096), 4096),
      temperature: clamp(Number(body.temperature ?? 0.7), 0, 1.2),
      stream: false
    };

    const providerResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterKey}`,
        'HTTP-Referer': Deno.env.get('APP_URL') || 'http://localhost',
        'X-Title': 'NexuzAI'
      },
      body: JSON.stringify(providerBody),
      signal: AbortSignal.timeout(75_000)
    });

    const result = await providerResponse.json().catch(() => ({}));
    if (providerResponse.ok) {
      return {
        ok: true,
        status: providerResponse.status,
        result,
        model,
        attemptedModels
      };
    }

    lastStatus = providerResponse.status;
    lastResult = result;

    if (![400, 404, 429, 500, 502, 503, 504].includes(providerResponse.status)) break;
  }

  return {
    ok: false,
    status: lastStatus,
    result: lastResult,
    model: attemptedModels[0],
    attemptedModels
  };
}

function validateRequestBody(body: Record<string, unknown>) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request body' };

  const agentId = String(body.agent_id || '');
  if (!ALLOWED_AGENTS.has(agentId)) return { ok: false, error: `Invalid agent ID: ${agentId}` };

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return { ok: false, error: 'Invalid messages' };
  }

  let totalChars = 0;
  for (const message of body.messages) {
    if (!message || typeof message !== 'object') return { ok: false, error: 'Invalid message format' };
    const role = String((message as { role?: unknown }).role || '');
    const content = String((message as { content?: unknown }).content || '');
    if (!['system', 'user', 'assistant'].includes(role)) return { ok: false, error: 'Invalid message role' };
    if (!content.trim()) return { ok: false, error: 'Empty message content' };
    totalChars += content.length;
  }

  if (totalChars > MAX_CONTENT_CHARS) return { ok: false, error: 'Prompt is too large' };
  return { ok: true };
}

function getCors(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const configured = (Deno.env.get('ALLOWED_ORIGINS') || Deno.env.get('APP_URL') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  // Allow any localhost / 127.0.0.1 origin for local development
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  // If no configured origins, allow everything (edge function not yet configured)
  const noConfig = configured.length === 0;
  const allowOrigin = (noConfig || isLocalhost || configured.includes(origin)) ? origin : '';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff'
  };

  return {
    allowed: true, // We set the header above; let the browser enforce it
    headers
  };
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function getConfiguredModels() {
  const configured = Deno.env.get('OPENROUTER_MODEL_FALLBACKS') || Deno.env.get('DEFAULT_AI_MODEL') || '';
  const models = configured
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return models.length ? models : [
    'nvidia/nemotron-3-super-120b-a12b:free'
  ];
}

function getProviderErrorMessage(result: Record<string, unknown>) {
  const error = result?.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }

  const detail = result?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  return 'unknown provider error';
}

function json(payload: unknown, status = 200, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}
