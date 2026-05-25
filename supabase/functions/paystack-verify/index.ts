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
    if (!reference || !planId) throw new Error('Missing reference or planId');

    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
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

    // Check amount (Paystack subunit is cents/kobo)
    // For USD: $9 -> 900, $29 -> 2900
    const expectedAmount = planId === 'team' ? 2900 : 900;
    if (data.data.amount < expectedAmount) {
      console.error('Amount mismatch', { received: data.data.amount, expected: expectedAmount });
      return new Response(JSON.stringify({ success: false, error: 'Payment amount mismatch' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // Update user profile in Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from JWT
    const authHeader = req.headers.get('Authorization')!;
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new Error('Unauthorized');

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ 
        plan: planId,
        paystack_last_reference: reference,
        paystack_customer_code: data.data.customer.customer_code
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Profile update failed:', updateError);
      throw new Error('Failed to update user profile');
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (err) {
    console.error('Verification error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
