const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function setupAuthContext() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'supabase-service.js'), 'utf8');
  
  const mockSupabase = {
    createClient: (url, key) => ({
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: async ({ email, password }) => {
          if (email === 'fail@example.com') return { data: { user: null }, error: { message: 'Invalid login credentials' } };
          if (email === 'bad-email') return { data: { user: null }, error: { message: 'Unable to validate email' } };
          return { data: { user: { id: '123', email } }, error: null };
        },
        signUp: async ({ email, password }) => {
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
    })
  };

  const context = {
    window: {
      location: { origin: 'http://localhost', pathname: '/' },
      supabase: mockSupabase,
      NEXUZ_SUPABASE_CONFIG: { url: 'https://test.supabase.co', anonKey: 'test-key' }
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    state: { user: null, plan: 'free' },
    updateNavForAuth: () => {},
    updateProBadges: () => {},
    console: { warn: () => {}, error: () => {}, log: () => {} }
  };
  context.globalThis = context;

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

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

test('supabaseLogin succeeds with correct credentials', async () => {
  const context = setupAuthContext();
  const { supabaseLogin, initSupabase } = context;
  
  await initSupabase();
  
  const data = await supabaseLogin('success@example.com', 'password');
  assert.ok(data.user);
  assert.strictEqual(data.user.email, 'success@example.com');
});
