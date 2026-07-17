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
  const url = String(cfg.url || '').trim();
  const anonKey = String(cfg.anonKey || '').trim();
  const isMissingUrl = !url || url.includes('{{') || url.includes('YOUR_SUPABASE');
  const isMissingAnonKey = !anonKey || anonKey.includes('{{') || anonKey.includes('YOUR_SUPABASE');

  return !isMissingUrl && !isMissingAnonKey;
}

async function initSupabase() {
  if (!isSupabaseConfigured()) {
    console.log("Supabase not configured. Running in Demo Mode.");
    return false;
  }

  if (!window.supabase) {
    console.error("Supabase library (window.supabase) not found. Check your index.html script tags.");
    return false;
  }

  try {
    const cfg = window.NEXUZ_SUPABASE_CONFIG;
    supabaseState.client = window.supabase.createClient(cfg.url, cfg.anonKey);
    supabaseState.ready = true;
    
    if (window.CONFIG) {
      const projectUrl = String(cfg.url || '').replace(/\/+$/, '');
      window.CONFIG.cloudProxyUrl = cfg.aiFunctionUrl || `${projectUrl}/functions/v1/ai-generate`;
    }

    const { data, error } = await supabaseState.client.auth.getSession();
    if (error) throw error;

    supabaseState.session = data.session;
    if (data.session?.user) await hydrateUserFromSupabase(data.session.user);

    supabaseState.client.auth.onAuthStateChange(async (_event, session) => {
      console.log("Auth State Changed:", _event);
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

    console.log("Supabase initialized successfully.");
    return true;
  } catch (err) {
    console.error("Supabase Initialization Error:", err);
    supabaseState.ready = false;
    supabaseState.client = null;
    return false;
  }
}

// When the page loads with a password-reset/recovery link in the URL hash
// (from a "Forgot password" email), open the reset page.
function detectRecoveryLink() {
  const hash = window.location.hash || '';
  if (hash.includes('access_token') && hash.includes('type=recovery')) {
    window.location.replace(`${window.location.origin}/reset-password.html${hash}`);
    return true;
  }
  return false;
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

async function supabaseForgotPassword(email) {
  if (!supabaseState.ready) throw new Error('Supabase is not configured');
  // Redirect back to the site's password-reset page after the user clicks the
  // link in the email. The reset page reads the tokens from the URL hash.
  const redirectTo = `${window.location.origin}/reset-password.html`;
  const { error } = await supabaseState.client.auth.resetPasswordForEmail(email, {
    redirectTo
  });
  if (error) throw error;
}

async function supabaseUpdatePassword(newPassword) {
  if (!supabaseState.ready) throw new Error('Supabase is not configured');
  const { data, error } = await supabaseState.client.auth.updateUser({ password: newPassword });
  if (error) throw error;
  return data;
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

async function fetchTeamContext() {
  if (!supabaseState.ready || !state.user?.id) return null;

  // Find teams where user is either an owner or a member
  const { data: teams, error } = await supabaseState.client
    .from('teams')
    .select('*, team_members!inner(role)')
    .eq('team_members.user_id', state.user.id);

  if (error) {
    console.error('Error fetching team context:', error);
    return null;
  }
  
  return teams?.[0] || null;
}

async function fetchTeamMembers(teamId) {
  if (!supabaseState.ready || !teamId) return [];

  const { data, error } = await supabaseState.client
    .from('team_members')
    .select('role, profiles(id, email, full_name)')
    .eq('team_id', teamId);

  if (error) {
    console.error('Error fetching team members:', error);
    return [];
  }

  return data.map(m => ({
    id: m.profiles.id,
    name: m.profiles.full_name,
    email: m.profiles.email,
    role: m.role,
    joined: '' // Joined date not in team_members yet, could add if needed
  }));
}

async function addTeamMemberByEmail(teamId, email, role = 'member') {
  if (!supabaseState.ready || !teamId) return;

  // 1. Find user by email (requires profile to be readable)
  const { data: profile, error: findError } = await supabaseState.client
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (findError || !profile) {
    throw new Error(findError?.message || `User with email ${email} not found.`);
  }

  // 2. Insert into team_members
  const { error: insertError } = await supabaseState.client
    .from('team_members')
    .insert({ team_id: teamId, user_id: profile.id, role });

  if (insertError) throw insertError;
}

async function removeTeamMemberFromDb(teamId, userId) {
  if (!supabaseState.ready || !teamId) return;

  const { error } = await supabaseState.client
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', userId);

  if (error) throw error;
}

async function fetchSharedDocuments(teamId) {
  if (!supabaseState.ready || !teamId) return [];

  const { data, error } = await supabaseState.client
    .from('generations')
    .select('*, profiles(full_name, email)')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching shared docs:', error);
    return [];
  }

  return data.map(d => ({
    id: d.id,
    name: `Team-${d.agent_id}-${d.id.slice(0, 4)}.txt`,
    creator: d.profiles?.full_name || d.profiles?.email || 'Unknown',
    size: `${Math.ceil(d.output.length / 1024)} KB`,
    date: d.created_at.slice(0, 10),
    content: d.output
  }));
}

async function shareToTeamWorkspaceDb(teamId, agentId, prompt, output) {
  if (!supabaseState.ready || !state.user?.id || !teamId) return;

  const { error } = await supabaseState.client.from('generations').insert({
    user_id: state.user.id,
    team_id: teamId,
    agent_id: agentId,
    prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
    output,
    output_format: 'text'
  });

  if (error) throw error;
}

async function saveGenerationRecord(agentId, prompt, output) {
  if (!supabaseState.ready || !state.user?.id || !output) return;
  
  // If we are using the Cloud Proxy, the Edge Function already saves the generation.
  // We only save manually if it's NOT the cloud proxy (e.g. local proxy).
  if (window.CONFIG?.proxyUrl?.includes('/functions/v1/ai-generate')) return;

  // We could also check if the user is in a team and auto-share if desired,
  // but usually sharing to workspace is an explicit action.
  await supabaseState.client.from('generations').insert({
    user_id: state.user.id,
    agent_id: agentId,
    prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt),
    output,
    output_format: 'text'
  });
}

