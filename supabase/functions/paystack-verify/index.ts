import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { reference, planId } = await req.json();
    const planKey = String(planId);
    if (!reference || !planKey) throw new Error('Missing reference or planId');
    if (planKey !== 'pro' && planKey !== 'team') throw new Error('Invalid planId');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized');

    const paystackSecret = getPaystackSecret();
    if (!paystackSecret) throw new Error('Paystack Secret Key not configured');

    // Verify transaction with Paystack
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok || !data.status || data.data.status !== 'success') {
      console.error('Paystack verification failed:', data);
      return new Response(JSON.stringify({ success: false, error: data.message || 'Verification failed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // Check amount (Paystack subunit for GHS is pesewas)
    // 150 GHS -> 15000 pesewas, 450 GHS -> 45000 pesewas
    const expectedAmount = planKey === 'team' ? 45000 : 15000;

    console.log(`Verifying payment for ${planKey}. Expected: ${expectedAmount}, Received: ${data.data.amount} ${data.data.currency}`);

    if (data.data.amount !== expectedAmount) {
      console.error('Amount mismatch', { received: data.data.amount, expected: expectedAmount });
      return new Response(JSON.stringify({ success: false, error: `Payment amount mismatch. Expected ${expectedAmount} subunits but received ${data.data.amount}.` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (data.data.currency !== 'GHS') {
      console.error('Currency mismatch', { received: data.data.currency, expected: 'GHS' });
      return new Response(JSON.stringify({ success: false, error: 'Payment currency mismatch.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }


    // Update user profile in Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Supabase service credentials are not configured');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized');

    const metadata = data.data.metadata || {};
    if (metadata.userId && metadata.userId !== user.id) {
      console.error('Payment user mismatch', { expected: user.id, received: metadata.userId });
      return new Response(JSON.stringify({ success: false, error: 'Payment does not belong to this user.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (metadata.planId && metadata.planId !== planKey) {
      console.error('Payment plan mismatch', { expected: planKey, received: metadata.planId });
      return new Response(JSON.stringify({ success: false, error: 'Payment plan mismatch.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    await updateProfilePlan(supabase, user.id, planKey, reference, data.data.customer?.customer_code);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    console.error('Verification error:', err);
    return new Response(JSON.stringify({ success: false, error: getErrorMessage(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function getPaystackSecret() {
  return Deno.env.get('PAYSTACK_SECRET_KEY')
    || Deno.env.get('PAYSTACK_SECRET')
    || Deno.env.get('Paystack_secret_key');
}

async function updateProfilePlan(
  supabase: any,
  userId: string,
  planId: string,
  reference: string,
  customerCode?: string
) {
  const update = {
    plan: planId,
    paystack_last_reference: reference,
    paystack_customer_code: customerCode || null
  };

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', userId);

  if (!error) return;

  const message = error.message || '';
  if (!message.includes('paystack_last_reference') && !message.includes('paystack_customer_code')) {
    console.error('Profile update failed:', error);
    throw new Error('Failed to update user profile');
  }

  console.warn('Paystack tracking columns are missing; updating plan only');
  const { error: planOnlyError } = await supabase
    .from('profiles')
    .update({ plan: planId })
    .eq('id', userId);

  if (planOnlyError) {
    console.error('Profile plan update failed:', planOnlyError);
    throw new Error('Failed to update user profile');
  }
}
