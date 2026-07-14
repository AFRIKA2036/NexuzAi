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

  const context = {
    window: {
      NEXUZ_SUPABASE_CONFIG: {
        url: 'https://test.supabase.co',
        anonKey: 'anon-key',
        adminFunctionUrl: 'https://test.supabase.co/functions/v1/admin-dashboard'
      },
      location: { href: 'http://localhost/admin/index.html', pathname: '/admin/index.html', origin: 'http://localhost' },
      innerWidth: 1280,
      Chart: null
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
  context._fetches = [];

  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, elements, tableBodies };
}

function flushInit() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('dashboard loads without authentication', async () => {
  const { elements } = setupAdminContext();
  await flushInit();

  assert.strictEqual(elements['total-users'].innerText, '12', 'total users rendered');
  assert.strictEqual(elements['payment-revenue'].innerText, 'GHS 150', 'revenue rendered');
});

test('admin api is called on load without an auth token', async () => {
  const { context } = setupAdminContext();
  await flushInit();

  assert.strictEqual(context._fetches.length, 1, 'one fetch on load');
  const headers = context._fetches[0].options.headers;
  assert.strictEqual(headers['Authorization'], undefined, 'no bearer token sent');
});

test('api failure is handled gracefully without crashing', async () => {
  const { elements, context } = setupAdminContext({
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) })
  });
  await flushInit();

  assert.strictEqual(elements['refresh-btn'].innerText, 'Update Stream', 'refresh button reset after failure');
  assert.strictEqual(context._fetches.length, 1, 'attempted a single fetch');
});
