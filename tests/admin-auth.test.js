const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement(id) {
  return {
    id,
    value: '',
    innerText: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    dataset: {},
    style: {},
    listeners: {},
    classList: {
      contains: () => false,
      toggle: () => {},
      remove: () => {}
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    contains: () => false,
    getContext: () => ({})
  };
}

function setupAdminContext({ fetchImpl } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin', 'js', 'admin.js'), 'utf8');
  const ids = [
    'login-overlay',
    'auth-status',
    'auth-form',
    'auth-submit-btn',
    'magic-link-btn',
    'auth-timer',
    'timer-seconds',
    'sidebar',
    'menu-toggle',
    'refresh-btn',
    'total-users',
    'total-gens',
    'active-today',
    'paid-users',
    'plan-free',
    'plan-pro',
    'plan-team',
    'last-sync',
    'signupChart',
    'logout-btn',
    'auth-email',
    'auth-password'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, createElement(id)]));
  const tableBodies = {
    '#users-table tbody': createElement('users-tbody'),
    '#activity-table tbody': createElement('activity-tbody'),
    '#usage-table tbody': createElement('usage-tbody')
  };
  let session = null;
  const calls = { signIns: [], fetches: [], magicLinks: [] };

  const context = {
    window: {
      NEXUZ_SUPABASE_CONFIG: {
        url: 'https://test.supabase.co',
        anonKey: 'anon-key',
        adminFunctionUrl: 'https://test.supabase.co/functions/v1/admin-dashboard'
      },
      location: { origin: 'http://localhost' },
      innerWidth: 1280,
      supabase: {
        createClient: () => ({
          auth: {
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
            getSession: async () => ({ data: { session }, error: null }),
            signInWithPassword: async ({ email, password }) => {
              calls.signIns.push({ email, password });
              session = { access_token: 'admin-token', user: { email } };
              return { data: { session }, error: null };
            },
            signInWithOtp: async ({ email, options }) => {
              calls.magicLinks.push({ email, options });
              return { data: {}, error: null };
            },
            signOut: async () => {
              session = null;
              return { error: null };
            }
          }
        })
      }
    },
    document: {
      getElementById: (id) => elements[id] || createElement(id),
      querySelector: (selector) => tableBodies[selector] || createElement(selector),
      addEventListener: () => {}
    },
    fetch: async (url, options) => {
      calls.fetches.push({ url, options });
      if (fetchImpl) return fetchImpl(url, options);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          generatedAt: '2026-06-01T00:00:00.000Z',
          metrics: {
            totalUsers: 12,
            totalGenerations: 34,
            activeToday: 5,
            paidUsers: 3,
            plans: { free: 9, pro: 2, team: 1 }
          },
          signupTrend: [],
          recentGenerations: [],
          recentUsers: [],
          topUsageToday: []
        })
      };
    },
    console: { error: () => {} },
    setInterval: () => 1,
    clearInterval: () => {},
    Chart: null
  };
  context.globalThis = context;
  context.window.Chart = null;

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements, calls };
}

function flushAdminInit() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('admin login sends the Supabase session token to the admin dashboard API', async () => {
  const { elements, calls } = setupAdminContext();
  await flushAdminInit();

  elements['auth-email'].value = 'admin@example.com';
  elements['auth-password'].value = 'correct-password';

  await elements['auth-form'].onsubmit({ preventDefault: () => {} });

  assert.deepStrictEqual(calls.signIns[0], {
    email: 'admin@example.com',
    password: 'correct-password'
  });
  assert.strictEqual(calls.fetches[0].url, 'https://test.supabase.co/functions/v1/admin-dashboard');
  assert.strictEqual(calls.fetches[0].options.headers.Authorization, 'Bearer admin-token');
  assert.strictEqual(JSON.parse(calls.fetches[0].options.body).action, 'summary');
  assert.strictEqual(elements['login-overlay'].style.display, 'none');
  assert.strictEqual(elements['total-users'].innerText, '12');
});

test('admin login keeps the overlay visible when the API rejects a non-admin user', async () => {
  const { elements } = setupAdminContext({
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Admin access required' })
    })
  });
  await flushAdminInit();

  elements['auth-email'].value = 'member@example.com';
  elements['auth-password'].value = 'correct-password';

  await elements['auth-form'].onsubmit({ preventDefault: () => {} });

  assert.strictEqual(elements['login-overlay'].style.display, 'flex');
  assert.match(elements['auth-status'].innerText, /Access denied/);
  assert.strictEqual(elements['auth-submit-btn'].disabled, false);
  assert.strictEqual(elements['auth-submit-btn'].innerText, 'Sign In');
});

test('admin magic link uses the admin page as the redirect target', async () => {
  const { elements, calls } = setupAdminContext();
  await flushAdminInit();

  elements['auth-email'].value = 'admin@example.com';

  await elements['magic-link-btn'].onclick();

  assert.strictEqual(calls.magicLinks[0].email, 'admin@example.com');
  assert.strictEqual(
    calls.magicLinks[0].options.emailRedirectTo,
    'http://localhost/admin/index.html'
  );
  assert.match(elements['auth-status'].innerText, /Link sent/);
});
