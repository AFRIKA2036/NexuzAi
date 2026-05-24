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
  'linkedin'
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

    const openrouterKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openrouterKey) return json({ error: 'AI provider is not configured', requestId }, 500, cors.headers);

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

    const body = await req.json();
    const validation = validateRequestBody(body);
    if (!validation.ok) return json({ error: validation.error, requestId }, 400, cors.headers);

    const { data: usageRows, error: usageError } = await userClient.rpc('consume_daily_usage', {
      p_limit: FREE_DAILY_LIMIT
    });
    if (usageError) {
      console.error('[OBSERVABILITY] usage rpc failed', { requestId, userId: userData.user.id, error: usageError.message });
      return json({ error: 'Usage check failed', requestId }, 500, cors.headers);
    }

    const usage = Array.isArray(usageRows) ? usageRows[0] : usageRows;
    if (!usage?.allowed) {
      console.warn('[OBSERVABILITY] limit reached', { requestId, userId: userData.user.id, count: usage?.request_count });
      return json({
        error: 'Free daily limit reached',
        requestId,
        request_count: usage?.request_count ?? FREE_DAILY_LIMIT,
        limit: FREE_DAILY_LIMIT
      }, 429, cors.headers);
    }

    const defaultModels = [
      Deno.env.get('DEFAULT_AI_MODEL') || 'deepseek/deepseek-v4-flash:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'openai/gpt-oss-120b:free'
    ];

    const providerModels = body.model && body.model !== 'auto'
        ? (Array.isArray(body.model) ? body.model : [body.model])
        : defaultModels;

    const providerBody = {
      models: providerModels,
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
        'X-Title': 'NexusAI'
      },
      body: JSON.stringify(providerBody),
      signal: AbortSignal.timeout(75_000)
    });

    const result = await providerResponse.json().catch(() => ({}));
    const latency = Date.now() - startTime;

    if (!providerResponse.ok) {
      console.error('[OBSERVABILITY] provider error', { 
        requestId, 
        userId: userData.user.id, 
        status: providerResponse.status, 
        latency,
        result 
      });
      return json({ error: 'AI provider request failed', requestId }, providerResponse.status, cors.headers);
    }

    const output = result.choices?.[0]?.message?.content || '';
    const usageData = result.usage || {};

    console.info('[OBSERVABILITY] generation success', {
      requestId,
      userId: userData.user.id,
      agentId: body.agent_id,
      model: result.model || (Array.isArray(providerModels) ? providerModels[0] : providerModels),
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

function validateRequestBody(body: Record<string, unknown>) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request body' };

  const agentId = String(body.agent_id || '');
  if (!ALLOWED_AGENTS.has(agentId)) return { ok: false, error: 'Invalid agent' };

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

function json(payload: unknown, status = 200, headers: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}
