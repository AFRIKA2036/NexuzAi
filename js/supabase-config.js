// Public Supabase browser config.
// Fill these from Supabase Dashboard > Project Settings > API.
// Never place service_role keys, database passwords, or Stripe secrets here.
window.NEXUZ_SUPABASE_CONFIG = {
  url: '{{SUPABASE_URL}}',
  anonKey: '{{SUPABASE_ANON_KEY}}',
  // Optional override. If omitted, the app uses `${url}/functions/v1/ai-generate`.
  aiFunctionUrl: '{{AI_FUNCTION_URL}}',
  paystackPublicKey: '{{PAYSTACK_PUBLIC_KEY}}'
};
