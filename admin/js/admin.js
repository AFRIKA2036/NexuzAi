// admin/js/admin.js

const config = window.NEXUZ_SUPABASE_CONFIG || {};
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');
const refreshBtn = document.getElementById('refresh-btn');
const paymentsRefreshBtn = document.getElementById('payments-refresh-btn');
const usersTable = document.querySelector('#users-table tbody');
const paymentsTable = document.querySelector('#payments-table tbody');

let growthChart = null;
let revenueChart = null;
let dashboardReady = false;

function adminFunctionUrl() {
  const projectUrl = String(config.url || '').replace(/\/+$/, '');
  return config.adminFunctionUrl || `${projectUrl}/functions/v1/admin-dashboard`;
}

function isConfigured() {
  return Boolean(
    config.url &&
    !String(config.url).includes('YOUR_SUPABASE')
  );
}

function initDashboard() {
  if (dashboardReady) return;
  dashboardReady = true;

  if (refreshBtn) refreshBtn.onclick = loadDashboard;
  if (paymentsRefreshBtn) paymentsRefreshBtn.onclick = loadPayments;

  if (menuToggle && sidebar) {
    menuToggle.onclick = () => sidebar.classList.toggle('open');
  }

  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 1024 &&
      sidebar &&
      !sidebar.contains(e.target) &&
      e.target !== menuToggle) {
      sidebar.classList.remove('open');
    }
  });

  if (usersTable) {
    usersTable.addEventListener('change', async (e) => {
      if (!e.target.classList.contains('plan-select')) return;
      await updateUserPlan(e.target);
    });
  }
}

async function loadDashboard() {
  if (!refreshBtn) return;
  refreshBtn.disabled = true;
  refreshBtn.innerText = 'Syncing...';

  try {
    const data = await callAdminApi({ action: 'summary' });
    renderDashboard(data);
  } catch (err) {
    console.error(err);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.innerText = 'Update Stream';
  }
}

async function callAdminApi(payload) {
  const response = await fetch(adminFunctionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `Admin API failed with ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return data;
}

function renderDashboard(data) {
  const metrics = data.metrics || {};
  const payments = data.payments || {};
  const revenueTrend = payments.revenueTrend || [];

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  };

  set('total-users', formatNumber(metrics.totalUsers));
  set('paid-users', formatNumber(metrics.paidUsers));
  set('payment-revenue', formatCurrency(payments.totalSuccessfulAmount, payments.currency));

  const revenue7d = revenueTrend.slice(-7).reduce((acc, curr) => acc + curr.amount, 0);
  set('revenue-7d', formatCurrency(revenue7d, payments.currency));

  const totalAttempts = payments.successfulCount + payments.failedCount + payments.abandonedCount;
  const conversionRate = totalAttempts > 0 ? (payments.successfulCount / totalAttempts * 100).toFixed(1) : '0';
  set('conversion-rate', `${conversionRate}%`);

  const revenueToday = revenueTrend.length > 0 ? revenueTrend[revenueTrend.length - 1].amount : 0;
  set('revenue-today', formatCurrency(revenueToday, payments.currency));

  const plans = metrics.plans || {};
  set('plan-free', formatNumber(plans.free));
  set('plan-pro', formatNumber(plans.pro));
  set('plan-team', formatNumber(plans.team));
  set('last-sync', `Last sync: ${formatDateTime(data.generatedAt)}`);

  renderGrowthChart(data.signupTrend || []);
  renderRevenueChart(revenueTrend);
  renderActivity(data.recentGenerations || []);
  renderUsers(data.recentUsers || []);
  renderUsage(data.topUsageToday || []);
  renderPayments(payments);
}

function renderActivity(rows) {
  const tbody = document.querySelector('#activity-table tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No recent activity.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((gen) => `
    <tr>
      <td><span class="user-name">${escapeHtml(gen.email || 'Unknown')}</span></td>
      <td><code>${escapeHtml(gen.agentId || 'unknown')}</code></td>
      <td>${escapeHtml(gen.prompt || '')}</td>
      <td style="color: #64748b; font-size: 0.8rem;">${formatDateTime(gen.createdAt)}</td>
    </tr>
  `).join('');
}

function renderUsers(rows) {
  if (!usersTable) return;
  if (!rows.length) {
    usersTable.innerHTML = '<tr><td colspan="4" class="empty-state">No users found.</td></tr>';
    return;
  }

  usersTable.innerHTML = rows.map((user) => `
    <tr>
      <td>
        <span class="user-name">${escapeHtml(user.fullName || user.email || 'Unknown')}</span>
        <span class="user-email">${escapeHtml(user.email || '')}</span>
      </td>
      <td>
        <select class="plan-select" data-user-id="${escapeHtml(user.id)}" data-current-plan="${escapeHtml(user.plan)}">
          ${['free', 'pro', 'team'].map((plan) => `<option value="${plan}" ${plan === user.plan ? 'selected' : ''}>${plan}</option>`).join('')}
        </select>
      </td>
      <td style="color: #94a3b8;">${formatDate(user.createdAt)}</td>
      <td style="color: #64748b;">${formatDateTime(user.updatedAt)}</td>
    </tr>
  `).join('');
}

function renderUsage(rows) {
  const tbody = document.querySelector('#usage-table tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No usage recorded today.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((row) => `
    <tr>
      <td><span class="user-name">${escapeHtml(row.email || 'Unknown')}</span></td>
      <td>${formatNumber(row.requestCount)}</td>
      <td style="color: #64748b;">${formatDateTime(row.updatedAt)}</td>
    </tr>
  `).join('');
}

async function loadPayments() {
  if (!paymentsRefreshBtn) return;
  paymentsRefreshBtn.disabled = true;
  paymentsRefreshBtn.innerText = 'Refreshing...';

  try {
    const data = await callAdminApi({ action: 'payments' });
    renderPayments(data.payments || {});
  } catch (err) {
    console.error(err);
  } finally {
    paymentsRefreshBtn.disabled = false;
    paymentsRefreshBtn.innerText = 'Refresh Payments';
  }
}

function renderPayments(payments) {
  if (!paymentsTable) return;
  const rows = payments.rows || [];

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  };

  set('payment-revenue', formatCurrency(payments.totalSuccessfulAmount, payments.currency));
  set('payments-successful', formatNumber(payments.successfulCount));
  set('payments-abandoned', formatNumber(payments.abandonedCount));
  set('payments-failed', formatNumber(payments.failedCount));
  set('payments-pending', formatNumber(payments.pendingCount));
  set('payments-paystack', formatNumber(payments.paystackCount));
  set('payments-supabase', formatNumber(payments.supabaseOnlyCount));

  const syncEl = document.getElementById('payments-sync');
  if (syncEl) {
    syncEl.innerText = payments.providerConfigured
      ? payments.providerError
        ? `Paystack sync warning: ${payments.providerError}. Showing Supabase records plus any fetched Paystack rows.`
        : `Synced ${formatNumber(payments.totalRows)} payment records from Paystack and Supabase.`
      : 'Paystack secret is not configured. Showing Supabase payment references only.';
  }

  if (!rows.length) {
    paymentsTable.innerHTML = '<tr><td colspan="7" class="empty-state">No payment records found.</td></tr>';
    return;
  }

  paymentsTable.innerHTML = rows.map((payment) => {
    const status = String(payment.status || 'unknown');
    const source = String(payment.source || 'supabase');
    return `
      <tr>
        <td>
          <span class="user-name">${escapeHtml(payment.fullName || payment.email || 'Unknown')}</span>
          <span class="user-email">${escapeHtml(payment.email || payment.customerCode || '')}</span>
        </td>
        <td>${escapeHtml(payment.plan || 'unknown')}</td>
        <td>${formatCurrency(payment.amount, payment.currency)}</td>
        <td><span class="status-pill ${escapeHtml(slug(status))}">${escapeHtml(status)}</span></td>
        <td><code class="reference-code" title="${escapeHtml(payment.reference || '')}">${escapeHtml(payment.reference || '-')}</code></td>
        <td><span class="source-pill ${escapeHtml(slug(source))}">${escapeHtml(source)}</span></td>
        <td style="color: #64748b;">${formatDateTime(payment.paidAt || payment.createdAt)}</td>
      </tr>
    `;
  }).join('');
}

async function updateUserPlan(select) {
  const userId = select.dataset.userId;
  const nextPlan = select.value;
  const previousPlan = select.dataset.currentPlan;

  select.disabled = true;
  try {
    await callAdminApi({ action: 'updatePlan', userId, plan: nextPlan });
    select.dataset.currentPlan = nextPlan;
    await loadDashboard();
  } catch (err) {
    select.value = previousPlan;
    console.error('Plan update failed:', err.message);
  } finally {
    select.disabled = false;
  }
}

function renderGrowthChart(rows) {
  if (!window.Chart) return;
  const ctx = document.getElementById('signupChart');
  if (!ctx) return;
  const context = ctx.getContext('2d');
  const labels = rows.map((row) => formatShortDate(row.date));
  const values = rows.map((row) => Number(row.count || 0));

  if (growthChart) growthChart.destroy();

  growthChart = new Chart(context, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Signups',
        data: values,
        borderColor: '#2563eb',
        borderWidth: 4,
        pointRadius: 5,
        pointBackgroundColor: '#2563eb',
        tension: 0.35,
        fill: true,
        backgroundColor: 'rgba(37, 99, 235, 0.16)'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b', stepSize: 1 } },
        x: { grid: { display: false }, ticks: { color: '#64748b' } }
      }
    }
  });
}

function renderRevenueChart(rows) {
  if (!window.Chart) return;
  const ctx = document.getElementById('revenueChart');
  if (!ctx) return;
  const context = ctx.getContext('2d');
  const labels = rows.map((row) => formatShortDate(row.date));
  const values = rows.map((row) => Number(row.amount || 0));

  if (revenueChart) revenueChart.destroy();

  revenueChart = new Chart(context, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Revenue',
        data: values,
        backgroundColor: 'rgba(74, 240, 200, 0.16)',
        borderColor: '#4af0c8',
        borderWidth: 2,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#64748b' } },
        x: { grid: { display: false }, ticks: { color: '#64748b' } }
      }
    }
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatCurrency(value, currency) {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value || 0);
  const code = currency && currency !== 'mixed' ? String(currency) : 'GHS';
  const formatted = numeric.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    maximumFractionDigits: 2
  });
  return currency === 'mixed' ? `${formatted} mixed` : `${code} ${formatted}`;
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString();
}

function formatShortDate(value) {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

// Initialize the dashboard without authentication.
if (!isConfigured()) {
  console.warn('Admin: Supabase URL is not configured for this deployment.');
}

initDashboard();
loadDashboard();
