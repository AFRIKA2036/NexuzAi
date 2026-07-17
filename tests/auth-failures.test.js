const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function setupAuthContext({ supabaseConfig } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-service.js'), 'utf8');
  const authCalls = { createClients: [], signUps: [] };
  
  const mockSupabase = {
    createClient: (url, key) => {
      authCalls.createClients.push({ url, key });
      return {
        auth: {
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
          signInWithPassword: async ({ email, password }) => {
            if (email === 'fail@example.com') return { data: { user: null }, error: { message: 'Invalid login credentials' } };
            if (email === 'bad-email') return { data: { user: null }, error: { message: 'Unable to validate email' } };
            return { data: { user: { id: '123', email } }, error: null };
          },
          signUp: async ({ email, password }) => {
            authCalls.signUps.push({ email, password });
            if (email === 'exists@example.com') return { data: { user: null }, error: { message: 'User already registered' } };
            return { data: { user: { id: '456', email } }, error: null };
          },
          signOut: async () => ({ error: null })
        },
        from: (table) => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null })
            })
          }),
          insert: async () => ({ error: null }),
          update: () => ({
            eq: async () => ({ error: null })
          })
        })
      };
    }
  };

  const context = {
    window: {
      location: { origin: 'http://localhost', pathname: '/' },
      supabase: mockSupabase,
      NEXUZ_SUPABASE_CONFIG: supabaseConfig || { url: 'https://test.supabase.co', anonKey: 'test-key' }
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    state: { user: null, plan: 'free' },
    updateNavForAuth: () => {},
    updateProBadges: () => {},
    document: {
      querySelectorAll: () => [],
      getElementById: () => null
    },
    console: { warn: () => {}, error: () => {}, log: () => {} }
  };
  context.globalThis = context;
  context.authCalls = authCalls;

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test('initSupabase does not create a client without an anon key', async () => {
  const context = setupAuthContext({
    supabaseConfig: { url: 'https://test.supabase.co', anonKey: '' }
  });

  const ready = await context.initSupabase();

  assert.strictEqual(ready, false);
  assert.deepStrictEqual(context.authCalls.createClients, []);
});

test('supabaseLogin handles wrong passwords/credentials', async () => {
  const context = setupAuthContext();
  const { supabaseLogin, initSupabase } = context;
  
  await initSupabase();
  
  try {
    await supabaseLogin('fail@example.com', 'wrongpassword');
    assert.fail('Should have thrown an error');
  } catch (err) {
    assert.strictEqual(err.message, 'Invalid login credentials');
  }
});

test('supabaseLogin handles bad email formats', async () => {
  const context = setupAuthContext();
  const { supabaseLogin, initSupabase } = context;
  
  await initSupabase();
  
  try {
    await supabaseLogin('bad-email', 'password');
    assert.fail('Should have thrown an error');
  } catch (err) {
    assert.strictEqual(err.message, 'Unable to validate email');
  }
});

test('supabaseLogin handles existing user on signup', async () => {
  const context = setupAuthContext();
  const { supabaseLogin, initSupabase } = context;
  
  await initSupabase();
  
  try {
    await supabaseLogin('exists@example.com', 'password', 'signup');
    assert.fail('Should have thrown an error');
  } catch (err) {
    assert.strictEqual(err.message, 'User already registered');
  }
});

test('supabaseLogin succeeds on signup and hydrates the new user', async () => {
  const context = setupAuthContext();
  const { supabaseLogin, initSupabase } = context;

  await initSupabase();

  const data = await supabaseLogin('newadmin@example.com', 'password', 'signup');
  assert.ok(data.user);
  assert.strictEqual(data.user.email, 'newadmin@example.com');
  assert.deepStrictEqual(context.authCalls.signUps[0], {
    email: 'newadmin@example.com',
    password: 'password'
  });
  assert.strictEqual(context.state.user.email, 'newadmin@example.com');
  assert.strictEqual(context.state.plan, 'free');
});

  test('supabaseLogin surfaces a clear error when sign-in returns no user/session', async () => {
    const context = setupAuthContext({
      supabaseConfig: { url: 'https://test.supabase.co', anonKey: 'test-key' }
    });
    const { supabaseLogin, initSupabase } = context;

    // Simulate a confirmed-email-required / pending response: no error,
    // but Supabase returns neither a user nor a session. Override the
    // factory BEFORE initSupabase creates the client.
    const originalSignIn = context.window.supabase.createClient;
    context.window.supabase.createClient = (url, key) => {
      const client = originalSignIn(url, key);
      client.auth.signInWithPassword = async () => ({
        data: { user: null, session: null },
        error: null
      });
      return client;
    };

    await initSupabase();

    try {
      await supabaseLogin('pending@example.com', 'password');
      assert.fail('Should have thrown for a no-user/no-session sign-in');
    } catch (err) {
      assert.match(err.message, /Sign in failed/i);
    }
  });

  test('supabaseLogin succeeds with correct credentials', async () => {
  const context = setupAuthContext();
  const { supabaseLogin, initSupabase } = context;
  
  await initSupabase();
  
  const data = await supabaseLogin('success@example.com', 'password');
  assert.ok(data.user);
  assert.strictEqual(data.user.email, 'success@example.com');
});
