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
    'payment-revenue',
    'plan-free',
    'plan-pro',
    'plan-team',
    'payments-sync',
    'payments-successful',
    'payments-paystack',
    'payments-supabase',
    'payments-refresh-btn',
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
    '#usage-table tbody': createElement('usage-tbody'),
    '#payments-table tbody': createElement('payments-tbody')
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
          topUsageToday: [],
          payments: {
            providerConfigured: true,
            providerError: '',
            totalRows: 1,
            successfulCount: 1,
            paystackCount: 1,
            supabaseOnlyCount: 0,
            totalSuccessfulAmount: 150,
            currency: 'GHS',
            rows: [{
              source: 'paystack',
              email: 'payer@example.com',
              fullName: 'Paying User',
              plan: 'pro',
              status: 'success',
              reference: 'ref_123',
              customerCode: 'CUS_123',
              amount: 150,
              currency: 'GHS',
              channel: 'card',
              paidAt: '2026-06-01T00:00:00.000Z',
              createdAt: '2026-06-01T00:00:00.000Z'
            }]
          }
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
  return { context, elements, tableBodies, calls };
}

function flushAdminInit() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('admin login sends the Supabase session token to the admin dashboard API', async () => {
  const { elements, tableBodies, calls } = setupAdminContext();
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
  assert.strictEqual(elements['payment-revenue'].innerText, 'GHS 150');
  assert.match(tableBodies['#payments-table tbody'].innerHTML, /ref_123/);
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

test('admin payments refresh calls the payments action and renders returned rows', async () => {
  const { elements, tableBodies, calls } = setupAdminContext({
    fetchImpl: async (_url, options) => {
      const action = JSON.parse(options.body).action;
      if (action === 'summary') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            generatedAt: '2026-06-01T00:00:00.000Z',
            metrics: { totalUsers: 0, totalGenerations: 0, activeToday: 0, paidUsers: 0, plans: {} },
            signupTrend: [],
            recentGenerations: [],
            recentUsers: [],
            topUsageToday: [],
            payments: { rows: [], totalSuccessfulAmount: 0, currency: 'GHS' }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          payments: {
            providerConfigured: false,
            totalRows: 1,
            successfulCount: 0,
            paystackCount: 0,
            supabaseOnlyCount: 1,
            totalSuccessfulAmount: 0,
            currency: '',
            rows: [{
              source: 'supabase',
              email: 'stored@example.com',
              fullName: 'Stored Payment',
              plan: 'team',
              status: 'profile_record',
              reference: 'stored_ref',
              customerCode: 'CUS_STORED',
              amount: null,
              currency: '',
              paidAt: '2026-06-01T00:00:00.000Z',
              createdAt: '2026-06-01T00:00:00.000Z'
            }]
          }
        })
      };
    }
  });
  await flushAdminInit();

  elements['auth-email'].value = 'admin@example.com';
  elements['auth-password'].value = 'correct-password';
  await elements['auth-form'].onsubmit({ preventDefault: () => {} });
  await elements['payments-refresh-btn'].onclick();

  assert.strictEqual(JSON.parse(calls.fetches.at(-1).options.body).action, 'payments');
  assert.match(tableBodies['#payments-table tbody'].innerHTML, /stored_ref/);
  assert.match(elements['payments-sync'].innerText, /Supabase payment references/);
});
