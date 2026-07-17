// Public Supabase browser config.
// Fill these from Supabase Dashboard > Project Settings > API.
// Never place service_role keys, database passwords, or Stripe secrets here.
// The anon key below is a PUBLIC key (safe to ship in the browser). The
// previous deploy shipped an invalid placeholder (eyJhbG...FOc8), which broke
// every login with "Invalid login credentials" because the app never
// authenticated to Supabase. This is the real project anon key.
window.NEXUZ_SUPABASE_CONFIG = {
  url: '{{SUPABASE_URL}}',
  anonKey: '{{SUPABASE_ANON_KEY}}',
  // Optional override. If omitted, the app uses `${url}/functions/v1/ai-generate`.
  aiFunctionUrl: '{{AI_FUNCTION_URL}}',
  paystackPublicKey: '{{PAYSTACK_PUBLIC_KEY}}'
};
