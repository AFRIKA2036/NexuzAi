// Supabase integration layer. The app still works in local/demo mode when
// Supabase is not configured.
const supabaseState = {
  client: null,
  ready: false,
  session: null
};

window.supabaseState = supabaseState;

function isSupabaseConfigured() {
  const cfg = window.NEXUZ_SUPABASE_CONFIG || {};
  return Boolean(
    cfg.url &&
    cfg.anonKey &&
    !cfg.url.includes('YOUR_SUPABASE') &&
    !cfg.anonKey.includes('YOUR_SUPABASE')
  );
}

async function initSupabase() {
  if (!window.supabase || !isSupabaseConfigured()) return false;

  const cfg = window.NEXUZ_SUPABASE_CONFIG;
  supabaseState.client = window.supabase.createClient(cfg.url, cfg.anonKey);
  supabaseState.ready = true;
  if (cfg.aiFunctionUrl && window.CONFIG) window.CONFIG.cloudProxyUrl = cfg.aiFunctionUrl;

  const { data } = await supabaseState.client.auth.getSession();
  supabaseState.session = data.session;
  if (data.session?.user) await hydrateUserFromSupabase(data.session.user);

  supabaseState.client.auth.onAuthStateChange(async (_event, session) => {
    supabaseState.session = session;
    if (session?.user) {
      await hydrateUserFromSupabase(session.user);
    } else {
      state.user = null;
      state.plan = 'free';
      localStorage.removeItem('nexuz_user');
      localStorage.removeItem('nexuz_plan');
      updateNavForAuth();
    }
  });

  return true;
}

async function hydrateUserFromSupabase(user) {
  await ensureSupabaseProfile(user);

  let plan = 'free';
  const { data: profile } = await supabaseState.client
    .from('profiles')
    .select('plan, full_name')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.plan) plan = profile.plan;

  state.user = {
    id: user.id,
    email: user.email,
    name: profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'User'
  };
  state.plan = plan;
  localStorage.setItem('nexuz_user', JSON.stringify(state.user));
  localStorage.setItem('nexuz_plan', state.plan);
  updateNavForAuth();
  updateProBadges();
}

async function ensureSupabaseProfile(user) {
  if (!supabaseState.ready || !user?.id) return;

  // First, check if the profile already exists (avoids RLS insert violations)
  const { data: existing } = await supabaseState.client
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'User';

  if (existing) {
    // Profile exists — safe to UPDATE our own row (SELECT own row is allowed by RLS)
    const { error } = await supabaseState.client
      .from('profiles')
      .update({ email: user.email, full_name: fullName })
      .eq('id', user.id);
    if (error) console.warn('Profile update failed (non-fatal):', error.message);
  } else {
    // Profile doesn't exist — try INSERT (requires RLS policy allowing authenticated INSERT)
    const { error } = await supabaseState.client
      .from('profiles')
      .insert({ id: user.id, email: user.email, full_name: fullName, plan: 'free' });
    if (error) console.warn('Profile create failed (non-fatal):', error.message);
  }
}

async function supabaseLogin(email, password, mode = 'signin') {
  if (!supabaseState.ready) return null;

  let result;
  if (mode === 'signup') {
    result = await supabaseState.client.auth.signUp({
      email,
      password,
      options: { data: { full_name: email.split('@')[0] } }
    });
  } else {
    result = await supabaseState.client.auth.signInWithPassword({ email, password });
  }

  const { data, error } = result;
  if (error) throw error;
  if (data.user) await hydrateUserFromSupabase(data.user);
  return data;
}

async function supabaseLogout() {
  if (!supabaseState.ready) return;
  await supabaseState.client.auth.signOut();
}

async function supabaseOAuth(provider) {
  if (!supabaseState.ready) throw new Error('Supabase is not configured');

  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabaseState.client.auth.signInWithOAuth({
    provider,
    options: { redirectTo }
  });

  if (error) throw error;
}

async function getSupabaseAccessToken() {
  if (!supabaseState.ready) return null;
  const { data } = await supabaseState.client.auth.getSession();
  return data.session?.access_token || null;
}

async function saveGenerationRecord(agentId, prompt, output) {
  if (!supabaseState.ready || !state.user?.id || !output) return;
  if (window.CONFIG?.proxyUrl?.includes('/functions/v1/ai-generate')) return;

  await supabaseState.client.from('generations').insert({
    user_id: state.user.id,
    agent_id: agentId,
    prompt,
    output,
    output_format: 'text'
  });
}
