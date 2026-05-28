import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-paystack-signature',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const signature = req.headers.get('x-paystack-signature');
  const paystackSecret = getPaystackSecret();

  if (!signature || !paystackSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Verify signature
  const bodyText = await req.text();
  const hmac = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(paystackSecret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    hmac,
    new TextEncoder().encode(bodyText)
  );
  const hash = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (hash !== signature) {
    console.error('Invalid signature');
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
  }

  const event = JSON.parse(bodyText);
  console.log('Paystack Webhook Event:', event.event);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    if (event.event === 'charge.success') {
      const data = event.data;
      const planId = data.metadata?.planId;
      const email = data.customer.email;
      
      console.log(`Charge success for ${email}. Plan: ${planId}`);

      if (planId && (planId === 'pro' || planId === 'team')) {
        await updateProfileByEmail(supabase, email, {
          plan: planId,
          paystack_customer_code: data.customer.customer_code,
          paystack_last_reference: data.reference
        });
        console.log(`Successfully upgraded ${email} to ${planId}`);
      }
    } else if (event.event === 'subscription.create' || event.event === 'subscription.enable') {
      // Handle recurring subscription events
      const data = event.data;
      const email = data.customer.email;
      const planCode = data.plan.plan_code;
      
      // Map your Paystack plan codes to your internal plan IDs if needed
      let planId = 'pro';
      if (data.plan.amount === 45000) planId = 'team';

      await updateProfileByEmail(supabase, email, {
        plan: planId,
        paystack_customer_code: data.customer.customer_code
      });
      console.log(`Successfully updated subscription for ${email} to ${planId}`);
    } else if (event.event === 'subscription.disable') {
      // Handle subscription cancellation
      const data = event.data;
      const email = data.customer.email;
      
      const { error } = await supabase
        .from('profiles')
        .update({ plan: 'free' })
        .eq('email', email);

      if (error) throw error;
      console.log(`Successfully downgraded ${email} to free`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(JSON.stringify({ error: getErrorMessage(err) }), {
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

async function updateProfileByEmail(supabase: any, email: string, update: Record<string, unknown>) {
  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('email', email);

  if (!error) return;

  const message = error.message || '';
  if (!message.includes('paystack_last_reference') && !message.includes('paystack_customer_code')) {
    throw error;
  }

  console.warn('Paystack tracking columns are missing; updating plan only');
  const { error: planOnlyError } = await supabase
    .from('profiles')
    .update({ plan: update.plan })
    .eq('email', email);

  if (planOnlyError) throw planOnlyError;
}
