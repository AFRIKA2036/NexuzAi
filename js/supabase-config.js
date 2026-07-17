// Public Supabase browser config.
// Fill these from Supabase Dashboard > Project Settings > API.
// Never place service_role keys, database passwords, or Stripe secrets here.
// The anon key below is a PUBLIC key (safe to ship in the browser). The
// previous deploy shipped an invalid placeholder (eyJhbG...FOc8), which broke
// every login with "Invalid login credentials" because the app never
// authenticated to Supabase. This is the real project anon key.
window.NEXUZ_SUPABASE_CONFIG = {
  url: 'https://onanhpeqttqdruruemwr.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uYW5ocGVxdHRxZHJ1cnVlbXdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzQ2NDMsImV4cCI6MjA5NDUxMDY0M30.aU63Ch6OzLHfGhWc08Fcbmmx0dl-GtogGKiHdYlFOc8',
  // Optional override. If omitted, the app uses `${url}/functions/v1/ai-generate`.
  aiFunctionUrl: '{{AI_FUNCTION_URL}}',
  paystackPublicKey: '{{PAYSTACK_PUBLIC_KEY}}'
};
