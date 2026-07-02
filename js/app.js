// ══════════════════════════════════════════════
//  NexuzAI - Main Application Logic
// ══════════════════════════════════════════════

// ─── STATE ────────────────────────────────────
const state = {
  user: JSON.parse(localStorage.getItem('nexuz_user') || 'null'),
  plan: localStorage.getItem('nexuz_plan') || 'free',
  currentAgent: null,
  currentPlanSelection: 'pro',
  authMode: 'signin',
  output: '',
  verificationMode: false // Disabled for production
};

// ─── API CONFIG ───────────────────────────────
const CONFIG = {
  useLocal: false, // Default: use Cloud Mode (Supabase edge function)
  localProxyUrl: 'http://localhost:8000/v1/chat/completions',
  cloudProxyUrl: '', // Set by supabase-config.js via supabase-service.js
  get proxyUrl() { return this.useLocal ? this.localProxyUrl : (this.cloudProxyUrl || this.localProxyUrl); },
  healthUrl: 'http://localhost:8000/health',
  model: 'nvidia/nemotron-3-super-120b-a12b:free'
};
window.CONFIG = CONFIG;

// ─── UTILITIES ────────────────────────────────
function isLocalProxyUrl(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url || '');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) {
    console.log("Toast:", msg);
    return;
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── COOKIE CONSENT ──────────────────────────
function checkCookieConsent() {
  const consent = localStorage.getItem('nexuz_cookie_consent');
  const banner = document.getElementById('cookieBanner');
  if (!consent && banner) {
    banner.classList.add('show');
  }
}

function acceptCookies() {
  localStorage.setItem('nexuz_cookie_consent', 'true');
  closeCookieBanner();
  showToast('✓ Preferences saved');
}

function closeCookieBanner() {
  const banner = document.getElementById('cookieBanner');
  if (banner) banner.classList.remove('show');
}

// ─── INIT ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log("NexuzAI Initializing...");
    
    // Safety check for critical DOM elements
    if (!document.getElementById('hamburger')) console.warn("Missing #hamburger element");
    
    if (typeof initSupabase === 'function') {
      await initSupabase();
    }
    
    updateNavForAuth();
    addLocalToggle();
    if (typeof autoDetectMode === 'function') await autoDetectMode();
    
    checkServerHealth();
    checkCookieConsent(); 
    checkPaymentCallback(); // Check if we just returned from Paystack
    setInterval(checkServerHealth, 30000);

    // Smooth scroll
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href === '#') {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        if (href === '#team-hub') return;
        e.preventDefault();
        const target = document.querySelector(href);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
        else if (href !== '#') window.location.hash = href;
      });
    });

    // Hamburger
    const hamburger = document.getElementById('hamburger');
    if (hamburger) {
      hamburger.addEventListener('click', () => {
        const links = document.querySelector('.nav-links');
        if (links) {
          links.style.display = (links.style.display === 'flex') ? 'none' : 'flex';
          links.style.flexDirection = 'column';
          links.style.position = 'absolute';
          links.style.top = '60px';
          links.style.right = '1rem';
          links.style.background = 'var(--bg3)';
          links.style.padding = '1rem';
          links.style.borderRadius = 'var(--radius)';
          links.style.border = '1px solid var(--border)';
        }
      });
    }

    // Login button
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (state.user) {
          logout();
        } else {
          openLoginModal();
        }
      });
    }

    // Form formatting
    const cardInput = document.getElementById('payCard');
    if (cardInput) {
      cardInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '').substring(0, 16);
        e.target.value = v.replace(/(.{4})/g, '$1 ').trim();
      });
    }

    const expiryInput = document.getElementById('payExpiry');
    if (expiryInput) {
      expiryInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length >= 2) v = v.substring(0,2) + '/' + v.substring(2,4);
        e.target.value = v;
      });
    }
  } catch (err) {
    console.error("Critical Initialization Error:", err);
  }
});

function addLocalToggle() {
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;
  
  const toggle = document.createElement('div');
  toggle.className = 'local-toggle';
  toggle.innerHTML = `
    <div id="serverStatus" class="status-dot"></div>
    <label class="switch">
      <input type="checkbox" id="localToggle" ${CONFIG.useLocal ? 'checked' : ''}>
      <span class="slider round"></span>
    </label>
    <span style="font-size: 0.8rem; color: var(--text2); margin-left: 0.5rem;">Offline Mode</span>
  `;
  navLinks.prepend(toggle);

  const localToggleInput = document.getElementById('localToggle');
  if (localToggleInput) {
    localToggleInput.addEventListener('change', (e) => {
      CONFIG.useLocal = e.target.checked;
      localStorage.setItem('nexuz_use_local', CONFIG.useLocal);
      showToast(CONFIG.useLocal ? '✦ Switched to Offline Mode' : '✦ Switched to Cloud Mode');
    });
  }
}

async function checkServerHealth() {
  const dot = document.getElementById('serverStatus');
  if (!dot) return;
  
  // Skip health check on production (Vercel) - local proxy won't be available
  if (CONFIG.healthUrl.startsWith('http://localhost') && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1')) {
    dot.style.background = '#666';
    dot.style.opacity = '0.6';
    dot.title = 'Server check skipped (production)';
    return false;
  }
  
  try {
    const res = await fetch(CONFIG.healthUrl, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      dot.style.background = '#22c55e';
      dot.style.opacity = '0.8';
      dot.title = `Server Online (${data.mode || 'Active'})`;
      return true;
    } else {
      dot.style.background = '#ef4444';
      dot.style.opacity = '0.8';
      return false;
    }
  } catch (e) {
    dot.style.background = '#ef4444';
    dot.style.opacity = '0.8';
    return false;
  }
}

async function autoDetectMode() {
  const saved = localStorage.getItem('nexuz_use_local');
  if (saved !== null) {
    CONFIG.useLocal = (saved === 'true');
    const toggle = document.getElementById('localToggle');
    if (toggle) toggle.checked = CONFIG.useLocal;
    return;
  }
  // Auto-detect based on availability
  // Skip on production (Vercel) - local proxy won't be available
  if (CONFIG.healthUrl.startsWith('http://localhost') && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1')) {
    return;
  }
  try {
    const res = await fetch(CONFIG.healthUrl, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      CONFIG.useLocal = true;
      const toggle = document.getElementById('localToggle');
      if (toggle) toggle.checked = true;
    }
  } catch (_) {}
}

// ─── AUTH ──────────────────────────────────────
function updateNavForAuth() {
  const btn = document.getElementById('loginBtn');
  const teamLink = document.getElementById('teamHubLink');
  const getStartedBtn = document.getElementById('getStartedBtn');
  const navLinks = document.querySelector('.nav-links');
  
  if (!btn || !navLinks) return;

  const oldAdminLink = document.getElementById('adminDashboardLink');
  if (oldAdminLink) oldAdminLink.remove();

  if (state.user) {
    btn.textContent = `Logout (${state.user.email.split('@')[0]})`;
    if (getStartedBtn) getStartedBtn.style.display = 'none';

    const adminMetadata = window.supabaseState?.session?.user?.app_metadata || {};
    const userProvider = window.supabaseState?.session?.user?.app_metadata?.provider || window.supabaseState?.session?.user?.user_metadata?.provider;
    const isAdmin = (adminMetadata.is_admin === true || adminMetadata.role === 'admin' || (Array.isArray(adminMetadata.roles) && adminMetadata.roles.includes('admin'))) && userProvider === 'google';
    if (isAdmin) {
      const adminLink = document.createElement('a');
      adminLink.id = 'adminDashboardLink';
      adminLink.href = '/admin/index.html';
      adminLink.innerHTML = 'Admin <span class="nav-badge">Portal</span>';
      adminLink.style.color = 'var(--accent)';
      navLinks.insertBefore(adminLink, btn);
    }
  } else {
    btn.textContent = 'Login';
    if (getStartedBtn) getStartedBtn.style.display = 'inline-block';
  }

  if (teamLink) {
    teamLink.style.display = (state.plan === 'team' || state.verificationMode) ? 'inline-block' : 'none';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPass');
  if (!emailInput || !passInput) return;

  const email = emailInput.value;
  const pass = passInput.value;

  if (email && pass) {
    if (!window.supabaseState?.ready) {
      showToast('❌ Auth Offline');
      return;
    }
    try {
      await supabaseLogin(email, pass, state.authMode);
      if (state.authMode === 'signup') {
        showToast('✅ Account created! Check your email.');
        openLoginModal('signin');
      } else {
        closeLoginModal();
        showToast(`✅ Welcome back!`);
      }
    } catch (err) {
      showToast(err.message || "Auth failed");
    }
  }
}

async function handleOAuth(provider) {
  if (!window.supabaseState?.ready) return;
  try { await supabaseOAuth(provider); } catch (err) { showToast(err.message); }
}

async function logout() {
  if (window.supabaseState?.ready) await supabaseLogout();
  state.user = null;
  state.plan = 'free';
  localStorage.removeItem('nexuz_user');
  localStorage.removeItem('nexuz_plan');
  updateNavForAuth();
  showToast('Logged out');
}

async function handleForgotPassword() {
  const emailInput = document.getElementById('loginEmail');
  const email = emailInput?.value?.trim();
  
  if (!email) {
    showToast('Please enter your email first');
    emailInput?.focus();
    return;
  }
  
  if (!window.supabaseState?.ready) {
    showToast('Supabase not configured');
    return;
  }
  
  try {
    await supabaseForgotPassword(email);
    showToast(`Password reset email sent to ${email}. Check your inbox.`);
  } catch (err) {
    showToast(err.message || 'Failed to send reset email');
  }
}

// ─── AGENT MODAL ──────────────────────────────
function openAgent(agentId) {
  const agent = AGENTS[agentId];
  if (!agent) return;

  if (!state.user) {
    state.currentAgent = agentId;
    openLoginModal('signup');
    showToast('Create an account to start');
    return;
  }

  if (agent.tier === 'pro' && state.plan !== 'pro' && state.plan !== 'team') {
    openPaymentModal('pro');
    return;
  }

  state.currentAgent = agentId;
  const icon = document.getElementById('modalIcon');
  const title = document.getElementById('modalTitle');
  const desc = document.getElementById('modalDesc');
  const output = document.getElementById('modalOutput');
  const body = document.getElementById('modalBody');

  if (icon) icon.textContent = agent.icon;
  if (title) title.textContent = agent.title;
  if (desc) desc.textContent = agent.desc;
  if (output) output.style.display = 'none';
  if (body) body.innerHTML = buildForm(agent);

  document.getElementById('agentModal')?.classList.add('active');
}

function buildForm(agent) {
  let html = '<div class="loading-bar" id="loadingBar"></div>';
  html += '<div id="progressPercent">0%</div>';
  agent.fields.forEach(field => {
    html += `<label>${field.label}</label>`;
    if (field.type === 'textarea') {
      html += `<textarea id="field_${field.id}" placeholder="${field.placeholder}" rows="${field.rows || 4}"></textarea>`;
    } else if (field.type === 'select') {
      html += `<select id="field_${field.id}">${field.options.map(opt => `<option value="${opt}">${opt}</option>`).join('')}</select>`;
    } else if (field.type === 'file') {
      html += `<div class="file-input-wrapper">
                <input type="file" id="field_${field.id}" accept="${field.accept || '*'}" onchange="handleFileSelected(this, '${field.id}')" />
                <div id="file_label_${field.id}" class="file-name-display">No file chosen</div>
              </div>`;
    } else {
      html += `<input type="text" id="field_${field.id}" placeholder="${field.placeholder}" />`;
    }
  });
  html += `<button class="modal-submit" id="agentSubmitBtn" onclick="runAgent()">✦ Generate with AI</button>`;
  return html;
}

// ─── AGENT LOGIC ──────────────────────────────
async function runAgent() {
  const agent = AGENTS[state.currentAgent];
  if (!agent) return;

  const fields = {};
  agent.fields.forEach(f => {
    const el = document.getElementById(`field_${f.id}`);
    fields[f.id] = (f.type === 'file') ? (window.fileStore?.[f.id] || "") : (el ? el.value.trim() : "");
  });

  if (!Object.values(fields).some(v => v)) {
    showToast('⚠ Please fill in fields');
    return;
  }

  const btn = document.getElementById('agentSubmitBtn');
  const bar = document.getElementById('loadingBar');
  const progressText = document.getElementById('progressPercent');
  if (btn) btn.disabled = true;
  if (bar) bar.classList.add('active');

  let progress = 0;
  let progressDone = false;

  try {
    const outputDiv = document.getElementById('modalOutput');
    const content = document.getElementById('outputContent');
    if (outputDiv) outputDiv.style.display = 'block';
    if (content) content.innerHTML = '✦ Thinking...';

    const system = agent.systemPrompt;
    const user = agent.buildPrompt(fields);
    
    const updateProgress = (pct) => {
      progress = Math.min(100, Math.max(progress, pct));
      if (bar) bar.style.width = progress + '%';
      if (progressText) progressText.textContent = Math.round(progress) + '%';
    };

    const tickProgress = async () => {
      while (!progressDone && progress < 70) {
        const remaining = 70 - progress;
        const step = Math.max(1, remaining * 0.12);
        updateProgress(progress + step);
        await new Promise(r => setTimeout(r, 180 + Math.random() * 220));
      }
    };
    const ticker = tickProgress();

    const result = await callAIAPI(system, user, state.currentAgent, (text) => {
      if (content) content.innerHTML = formatAIResponse(text || '✦ Thinking...');
      state.output = text;
      updateProgress(85);
    }, (pct) => {
      updateProgress(pct);
    });

    progressDone = true;
    await ticker;
    updateProgress(100);
    
    if (result && result.trim()) {
      if (content) content.innerHTML = formatAIResponse(result);
      state.output = result;
    }
    showToast('✓ Done');
  } catch (err) {
    showToast(err.message);
  } finally {
    progressDone = true;
    if (btn) btn.disabled = false;
    if (bar) {
      bar.classList.remove('active');
      bar.style.width = '100%';
    }
    if (progressText) progressText.textContent = '100%';
  }
}

async function callAIAPI(system, user, agentId, onChunk, onProgress) {
  const isCloud = !CONFIG.useLocal && CONFIG.cloudProxyUrl;
  const url = isCloud ? CONFIG.cloudProxyUrl : CONFIG.localProxyUrl;
  
  const headers = { 'Content-Type': 'application/json' };
  if (isCloud) {
    const token = await getSupabaseAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const cfg = window.NEXUZ_SUPABASE_CONFIG || {};
    if (cfg.anonKey) headers.apikey = cfg.anonKey;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent_id: agentId,
      model: CONFIG.model || 'auto',
      messages: [{role:'system', content:system}, {role:'user', content:user}],
      stream: true
    })
  });

  if (!res.ok) {
    let errorText = 'AI Connection Failed';
    try {
      const errorData = await res.json();
      if (errorData.error) errorText = errorData.error;
    } catch {}
    throw new Error(errorText);
  }

  const contentType = res.headers.get('content-type') || '';
  const isStream = contentType.includes('text/event-stream');

  if (!isStream) {
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (onProgress) {
      onProgress(100);
      await new Promise(r => setTimeout(r, 150));
    }
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value);
    const lines = buffer.split('\n');
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.error && parsed.error.message) {
            throw new Error(parsed.error.message);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'AI Connection Failed') throw e;
        }
        full += line + '\n';
        if (onChunk) onChunk(full);
      }
    }
  }
  return full;
}

function formatAIResponse(text) {
  return escapeHtml(text).replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

// ─── MODAL CONTROLS ───────────────────────────
function closeModal() { document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active')); }
function closeLoginModal() { document.getElementById('loginModal')?.classList.remove('active'); }
function closePaymentModal() { document.getElementById('paymentModal')?.classList.remove('active'); }

function openLoginModal(mode = 'signin') {
  state.authMode = mode;
  const signup = (mode === 'signup');
  const title = document.getElementById('authTitle');
  const btn = document.getElementById('authSubmitBtn');
  if (title) title.textContent = signup ? 'Create Account' : 'Welcome Back';
  if (btn) btn.textContent = signup ? 'Sign Up' : 'Sign In';
  document.getElementById('loginModal')?.classList.add('active');
}

function openPaymentModal(planId) {
  state.currentPlanSelection = planId;
  const title = document.getElementById('paymentTitle');
  if (title) title.textContent = `Upgrade to ${planId.toUpperCase()}`;
  
  // Populate payment summary
  const summary = document.getElementById('paymentSummary');
  const prices = { pro: { price: 9, period: 'month', name: 'Pro', amount: 900 }, team: { price: 29, period: 'month', name: 'Team', amount: 2900 } };
  const plan = prices[planId] || prices.pro;
  if (summary) {
    summary.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:1rem; background:var(--bg3); border-radius:var(--radius); border:1px solid var(--border);">
        <div>
          <strong>${plan.name} Plan</strong>
          <p style="margin:0.25rem 0 0; color:var(--text2); font-size:0.85rem;">$${plan.price}/${plan.period} • Cancel anytime</p>
        </div>
        <span style="font-size:1.5rem; font-weight:700; color:var(--accent);">$${plan.price}/${plan.period}</span>
      </div>
    `;
  }
  
  // Simple paystack checkout button
  const plans = document.getElementById('paymentPlans');
  if (plans) {
    plans.innerHTML = `
      <p style="font-size:0.85rem; color:var(--text2); margin-bottom:0.75rem; text-align:center;">
        Secure checkout via Paystack (Card & Mobile Money supported)
      </p>
    `;
  }
  
  document.getElementById('paymentModal')?.classList.add('active');
}

function selectPlan(id) { 
  if (id === 'free') { showToast('Free plan active'); return; }
  openPaymentModal(id); 
}

function checkPro(agentId) {
  if (!state.user) {
    state.currentAgent = agentId;
    openLoginModal('signup');
    showToast('Create an account to access Pro agents');
    return;
  }
  if (state.plan === 'pro' || state.plan === 'team') {
    openAgent(agentId);
  } else {
    openPaymentModal('pro');
    showToast('Upgrade to Pro to unlock this agent');
  }
}

// Check for payment redirect callback
async function checkPaymentCallback() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');
  const plan = localStorage.getItem('pending_plan');

  if (reference && plan) {
    // Clear URL parameters
    const newUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, newUrl);
    
    localStorage.removeItem('pending_plan');
    showToast('Verifying payment...');
    
    // Open modal to show progress
    openPaymentModal(plan);
    const btn = document.getElementById('paySubmitBtn');
    const btnText = document.getElementById('payBtnText');
    if (btn) btn.disabled = true;
    if (btnText) btnText.textContent = 'Verifying...';
    
    await verifyPayment(reference, plan);
  }
}

// Initialize Paystack Payment (Redirect Flow)
async function initPaystackPayment() {
  const btn = document.getElementById('paySubmitBtn');
  const btnText = document.getElementById('payBtnText');
  const plan = state.currentPlanSelection || 'pro';
  
  if (!state.user) {
    showToast('Please login to continue');
    closePaymentModal();
    openLoginModal('signin');
    return;
  }

  if (btn) btn.disabled = true;
  if (btnText) btnText.textContent = 'Preparing checkout...';

  try {
    const token = await getSupabaseAccessToken();
    if (!token) throw new Error('Authentication required');

    const baseUrl = window.NEXUZ_SUPABASE_CONFIG?.url || '';
    const functionUrl = `${baseUrl.replace(/\/+$/, '')}/functions/v1/paystack-initialize`;
    
    // Save selection to localStorage
    localStorage.setItem('pending_plan', plan);

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        planId: plan,
        callbackUrl: window.location.origin + window.location.pathname
      })
    });

    const data = await response.json();
    if (data.success && data.url) {
      if (btnText) btnText.textContent = 'Redirecting to Paystack...';
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Failed to initialize payment');
    }
  } catch (err) {
    console.error('Payment Init Error:', err);
    showToast('Error: ' + err.message);
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Proceed to Payment';
  }
}

// Verify payment with Supabase Edge Function
async function verifyPayment(reference, plan) {
  try {
    const token = await getSupabaseAccessToken();
    if (!token) throw new Error('Authentication required');

    const baseUrl = window.NEXUZ_SUPABASE_CONFIG?.url || '';
    const functionUrl = `${baseUrl.replace(/\/+$/, '')}/functions/v1/paystack-verify`;

    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ reference, planId: plan })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Upgrade successful! Welcome to ' + plan.toUpperCase());
      closePaymentModal();
      // Refresh user plan
      if (typeof hydrateUserFromSupabase === 'function' && state.user) {
        await hydrateUserFromSupabase(state.user);
      }
    } else {
      showToast('Payment verification failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    showToast('Verification error: ' + err.message);
  } finally {
    const btn = document.getElementById('paySubmitBtn');
    const btnText = document.getElementById('payBtnText');
    if (btn) btn.disabled = false;
    if (btnText) btnText.textContent = 'Proceed to Payment';
  }
}

// ─── SEARCH ───────────────────────────────────
function filterAgents() {
  const queryInput = document.getElementById('agentSearch');
  if (!queryInput) return;
  const query = queryInput.value.toLowerCase().trim();
  const cards = document.querySelectorAll('.agent-card');
  const grid = document.getElementById('agentsGrid');
  
  let count = 0;
  cards.forEach(card => {
    const text = card.innerText.toLowerCase();
    if (text.includes(query)) {
      card.style.display = 'block';
      count++;
    } else {
      card.style.display = 'none';
    }
  });

  let msg = document.getElementById('noResultsMessage');
  if (count === 0) {
    if (!msg) {
      msg = document.createElement('div');
      msg.id = 'noResultsMessage';
      msg.style.cssText = 'grid-column:1/-1; text-align:center; padding:3rem; color:var(--text3);';
      msg.innerHTML = `<h3>No agents match "${query}"</h3>`;
      if (grid) grid.appendChild(msg);
    }
  } else if (msg) {
    msg.remove();
  }
}

// ─── EXPORTS ──────────────────────────────────
window.acceptCookies = acceptCookies;
window.closeCookieBanner = closeCookieBanner;
window.openAgent = openAgent;
window.selectPlan = selectPlan;
window.checkPro = checkPro;
window.closeModal = closeModal;
window.handleLogin = handleLogin;
window.handleOAuth = handleOAuth;
window.handleForgotPassword = handleForgotPassword;
window.logout = logout;
window.runAgent = runAgent;
window.filterAgents = filterAgents;
window.openLoginModal = openLoginModal;
window.initPaystackPayment = initPaystackPayment;
window.copyOutput = () => { navigator.clipboard.writeText(state.output); showToast('Copied'); };
window.downloadOutput = (fmt) => showToast(`Downloading as ${fmt}...`);
