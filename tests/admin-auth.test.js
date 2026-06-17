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

function setupAdminContext({ metadataOverrides, fetchImpl } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin', 'js', 'admin.js'), 'utf8');
  const ids = [
    'login-overlay',
    'auth-status',
    'google-login-btn',
    'sidebar',
    'menu-toggle',
    'refresh-btn',
    'payments-refresh-btn',
    'total-users',
    'paid-users',
    'payment-revenue',
    'revenue-7d',
    'conversion-rate',
    'revenue-today',
    'plan-free',
    'plan-pro',
    'plan-team',
    'last-sync',
    'signupChart',
    'revenueChart',
    'logout-btn',
    'payments-successful',
    'payments-abandoned',
    'payments-failed',
    'payments-pending',
    'payments-paystack',
    'payments-supabase',
    'payments-sync'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, createElement(id)]));
  const tableBodies = {
    '#users-table tbody': createElement('users-tbody'),
    '#activity-table tbody': createElement('activity-tbody'),
    '#usage-table tbody': createElement('usage-tbody'),
    '#payments-table tbody': createElement('payments-tbody')
  };

  const user = {
    email: 'admin@example.com',
    app_metadata: {
      provider: 'google',
      is_admin: true,
      role: 'admin',
      ...metadataOverrides
    },
    user_metadata: {
      provider: 'google',
      full_name: 'Admin User'
    }
  };

  let session = { access_token: 'admin-token', user };

  const context = {
    window: {
      NEXUZ_SUPABASE_CONFIG: {
        url: 'https://test.supabase.co',
        anonKey: 'anon-key',
        adminFunctionUrl: 'https://test.supabase.co/functions/v1/admin-dashboard'
      },
      location: { href: 'http://localhost/admin/index.html', origin: 'http://localhost' },
      innerWidth: 1280,
      supabase: {
        createClient: () => ({
          auth: {
            onAuthStateChange: (handler) => {
              // Store handler for later use
              context._authHandler = handler;
              return { data: { subscription: { unsubscribe: () => {} } } };
            },
            getSession: async () => ({ data: { session }, error: null }),
            signInWithOAuth: async ({ provider, options }) => {
              context._oauthCall = { provider, options };
              return { data: {}, error: null };
            },
            signOut: async () => {
              session = null;
              return { error: null };
            }
          }
        })
      },
      Chart: null,
      formatNumber: (v) => String(Number(v || 0).toLocaleString()),
      formatCurrency: (v) => v ? `GHS ${v}` : '-',
      formatShortDate: (v) => v || '',
      formatDateTime: (v) => v || '-',
      escapeHtml: (v) => String(v ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
      slug: (v) => String(v || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    },
    document: {
      getElementById: (id) => elements[id] || createElement(id),
      querySelector: (selector) => tableBodies[selector] || createElement(selector),
      addEventListener: () => {}
    },
    fetch: async (url, options) => {
      context._fetches = context._fetches || [];
      context._fetches.push({ url, options });
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
            totalRows: 1,
            successfulCount: 1,
            paystackCount: 1,
            supabaseOnlyCount: 0,
            totalSuccessfulAmount: 150,
            currency: 'GHS',
            rows: []
          }
        })
      };
    },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    setInterval: () => 1,
    clearInterval: () => {}
  };
  context._oauthCall = null;
  context._fetches = [];
  context._authHandler = null;

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements, tableBodies };
}

function flushInit() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('admin session with is_admin=true loads dashboard', async () => {
  const { elements, context } = setupAdminContext({
    metadataOverrides: { is_admin: true, role: 'admin' }
  });
  await flushInit();

  assert.strictEqual(elements['login-overlay'].style.display, 'none', 'overlay should be hidden for admin');
  assert.strictEqual(elements['total-users'].innerText, '12');
  assert.strictEqual(elements['payment-revenue'].innerText, 'GHS 150');
  assert.strictEqual(context._fetches.length, 1);
  assert.strictEqual(
    context._fetches[0].options.headers.Authorization,
    'Bearer admin-token'
  );
  assert.strictEqual(JSON.parse(context._fetches[0].options.body).action, 'summary');
});

test('admin session with role=admin loads dashboard', async () => {
  const { elements } = setupAdminContext({
    metadataOverrides: { is_admin: false, role: 'admin' }
  });
  await flushInit();

  assert.strictEqual(elements['login-overlay'].style.display, 'none', 'overlay should be hidden');
});

test('admin session with roles=[admin] loads dashboard', async () => {
  const { elements } = setupAdminContext({
    metadataOverrides: { is_admin: false, role: 'user', roles: ['admin'] }
  });
  await flushInit();

  assert.strictEqual(elements['login-overlay'].style.display, 'none', 'overlay should be hidden for roles array admin');
});

test('non-admin user sees access denied', async () => {
  const { elements } = setupAdminContext({
    metadataOverrides: { is_admin: false, role: 'user' }
  });
  await flushInit();

  assert.strictEqual(elements['login-overlay'].style.display, 'flex', 'overlay should stay visible');
  assert.match(elements['auth-status'].innerText, /Access denied/);
});

test('non-google provider sees access denied', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin', 'js', 'admin.js'), 'utf8');
  const ids = [
    'login-overlay', 'auth-status', 'google-login-btn', 'sidebar',
    'menu-toggle', 'refresh-btn', 'payments-refresh-btn',
    'total-users', 'paid-users', 'payment-revenue',
    'revenue-7d', 'conversion-rate', 'revenue-today',
    'plan-free', 'plan-pro', 'plan-team', 'last-sync',
    'signupChart', 'revenueChart', 'logout-btn',
    'payments-successful', 'payments-abandoned', 'payments-failed',
    'payments-pending', 'payments-paystack', 'payments-supabase', 'payments-sync'
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, createElement(id)]));

  const user = {
    email: 'admin@example.com',
    app_metadata: { provider: 'email', is_admin: true, role: 'admin' },
    user_metadata: { provider: 'email', full_name: 'Admin User' }
  };

  let session = { access_token: 'admin-token', user };

  const context = {
    window: {
      NEXUZ_SUPABASE_CONFIG: {
        url: 'https://test.supabase.co',
        anonKey: 'anon-key',
        adminFunctionUrl: 'https://test.supabase.co/functions/v1/admin-dashboard'
      },
      location: { href: 'http://localhost/admin/index.html', origin: 'http://localhost' },
      innerWidth: 1280,
      supabase: {
        createClient: () => ({
          auth: {
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
            getSession: async () => ({ data: { session }, error: null }),
            signInWithOAuth: async () => ({ data: {}, error: null }),
            signOut: async () => { session = null; return { error: null }; }
          }
        })
      },
      Chart: null,
      formatNumber: (v) => String(Number(v || 0).toLocaleString()),
      formatCurrency: (v) => v ? `GHS ${v}` : '-',
      formatShortDate: (v) => v || '',
      formatDateTime: (v) => v || '-',
      escapeHtml: (v) => String(v ?? ''),
      slug: (v) => String(v || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    },
    document: {
      getElementById: (id) => elements[id] || createElement(id),
      querySelector: () => createElement('generic'),
      addEventListener: () => {}
    },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    console: { error: () => {}, warn: () => {}, log: () => {} },
    setInterval: () => 1,
    clearInterval: () => {}
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(elements['login-overlay'].style.display, 'flex', 'overlay should stay visible for non-google');
  assert.match(elements['auth-status'].innerText, /Access denied/);
});

test('API 403 shows access denied message', async () => {
  const { elements } = setupAdminContext({
    metadataOverrides: { is_admin: true, role: 'admin' },
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Admin access required' })
    })
  });
  await flushInit();

  assert.strictEqual(elements['login-overlay'].style.display, 'flex', 'overlay for 403');
  assert.match(elements['auth-status'].innerText, /Access denied/);
});

test('API 401 shows session expired message', async () => {
  const { elements } = setupAdminContext({
    metadataOverrides: { is_admin: true, role: 'admin' },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    })
  });
  await flushInit();

  assert.strictEqual(elements['login-overlay'].style.display, 'flex', 'overlay for 401');
  assert.match(elements['auth-status'].innerText, /session expired/i);
});

test('unconfigured supabase shows config message', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin', 'js', 'admin.js'), 'utf8');

  const elements = Object.fromEntries(
    ['login-overlay', 'auth-status', 'google-login-btn', 'sidebar'].map(id => [id, createElement(id)])
  );

  const context = {
    window: {
      NEXUZ_SUPABASE_CONFIG: {
        url: '{{SUPABASE_URL}}',
        anonKey: '{{SUPABASE_ANON_KEY}}'
      },
      location: { href: 'http://localhost/admin/index.html' },
      supabase: null
    },
    document: {
      getElementById: (id) => elements[id] || createElement(id),
      querySelector: () => createElement('generic'),
      addEventListener: () => {}
    },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    setInterval: () => 1,
    clearInterval: () => {}
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(elements['google-login-btn'].disabled, true, 'login btn disabled when unconfigured');
  assert.match(elements['auth-status'].innerText, /not configured/i);
});

test('google login btn triggers OAuth redirect', async () => {
  const { elements, context } = setupAdminContext({
    metadataOverrides: { is_admin: false, role: 'user' }
  });
  await flushInit();

  elements['google-login-btn'].onclick();
  await flushInit();

  assert.ok(context._oauthCall, 'OAuth should be called');
  assert.strictEqual(context._oauthCall.provider, 'google');
  assert.strictEqual(
    context._oauthCall.options.redirectTo,
    'http://localhost/admin/index.html'
  );
});

test('callAdminApi sends bearer token on every request', async () => {
  const { elements, context } = setupAdminContext({
    metadataOverrides: { is_admin: true, role: 'admin' }
  });
  await flushInit();

  assert.strictEqual(context._fetches[0].options.headers.Authorization, 'Bearer admin-token');
  assert.strictEqual(
    context._fetches[0].url,
    'https://test.supabase.co/functions/v1/admin-dashboard'
  );
});

test('sign out event shows overlay', async () => {
  const { elements, context } = setupAdminContext({
    metadataOverrides: { is_admin: true, role: 'admin' }
  });
  await flushInit();

  assert.ok(context._authHandler, 'auth handler should be registered');
  await context._authHandler('SIGNED_OUT', null);
  await flushInit();
  assert.strictEqual(elements['login-overlay'].style.display, 'flex', 'overlay after logout');
});
