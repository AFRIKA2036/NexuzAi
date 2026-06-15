import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logger, generateRequestId } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  const requestId = generateRequestId();
  const functionName = 'paystack-initialize';
  const log = logger;

  log.info('Request started', { requestId, functionName });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      log.warn('Missing or invalid Authorization header', { requestId, functionName });
      return json({ success: false, error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = requiredEnv('SUPABASE_URL');
    const anonKey = requiredEnv('SUPABASE_ANON_KEY');
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user?.email) {
      log.authCheck(requestId, null, false, { error: userError?.message });
      return json({ success: false, error: 'Unauthorized' }, 401);
    }

    log.authCheck(requestId, userData.user.id, true);

    const { planId, callbackUrl } = await req.json();
    const planKey = String(planId);
    if (planKey !== 'pro' && planKey !== 'team') {
      log.warn('Invalid planId', { requestId, functionName, planId });
      throw new Error('Invalid planId');
    }
    if (!callbackUrl || typeof callbackUrl !== 'string') {
      log.warn('Missing callbackUrl', { requestId, functionName });
      throw new Error('Missing callbackUrl');
    }
    const callback = new URL(callbackUrl);
    if (!['http:', 'https:'].includes(callback.protocol)) {
      log.warn('Invalid callbackUrl protocol', { requestId, functionName, protocol: callback.protocol });
      throw new Error('Invalid callbackUrl');
    }

    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) {
      log.error('Paystack Secret Key not configured', { requestId, functionName });
      throw new Error('Paystack Secret Key not configured');
    }

    const amounts = {
      pro: 10586, // 105.86 GHS
      team: 34109 // 341.09 GHS
    };
    const amount = amounts[planKey];

    // Initialize transaction with Paystack
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: userData.user.email,
        amount,
        currency: 'GHS',
        callback_url: callback.toString(),
        metadata: { 
          planId: planKey,
          userId: userData.user.id,
          custom_fields: [
            {
              display_name: "Plan",
              variable_name: "plan",
              value: planKey
            }
          ]
        },
        channels: ['card', 'mobile_money', 'ussd', 'qr']
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.status) {
      log.error('Paystack initialization failed', { requestId, functionName, data });
      return json({ success: false, error: data.message || 'Payment provider rejected the request' }, 502);
    }

    // Return the authorization_url for the redirect
    log.info('Paystack initialization success', { requestId, functionName, reference: data.data.reference });
    return json({ success: true, url: data.data.authorization_url, reference: data.data.reference });

  } catch (err) {
    log.requestError(requestId, functionName, err);
    return json({ success: false, error: getErrorMessage(err) }, 400);
  }
});

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function getPaystackSecret() {
  return Deno.env.get('PAYSTACK_SECRET_KEY')
    || Deno.env.get('PAYSTACK_SECRET')
    || Deno.env.get('Paystack_secret_key');
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}
