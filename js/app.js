// ══════════════════════════════════════════════
//  NexusAI - Main Application Logic
// ══════════════════════════════════════════════

// ─── STATE ────────────────────────────────────
const state = {
  user: JSON.parse(localStorage.getItem('nexus_user') || 'null'),
  plan: localStorage.getItem('nexus_plan') || 'free',
  currentAgent: null,
  currentPlanSelection: 'pro',
  authMode: 'signin',
  output: ''
};

// ─── API CONFIG ───────────────────────────────
const CONFIG = {
  useLocal: false, // Default: use Cloud Mode (Supabase edge function)
  localProxyUrl: 'http://localhost:8000/v1/chat/completions',
  cloudProxyUrl: '', // Set by supabase-config.js via supabase-service.js
  get proxyUrl() { return this.useLocal ? this.localProxyUrl : (this.cloudProxyUrl || this.localProxyUrl); },
  healthUrl: 'http://localhost:8000/health',
  model: 'deepseek/deepseek-v4-flash:free' // Use a single free model as requested
};
window.CONFIG = CONFIG;

function isLocalProxyUrl(url) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url || '');
}

// ─── INIT ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await initSupabase();
  updateNavForAuth();
  addLocalToggle();
  await autoDetectMode(); // Auto-pick local vs cloud based on server availability
  checkServerHealth();
  setInterval(checkServerHealth, 30000); // Check health every 30s
// ... (rest of the listeners)

  // Hamburger menu
  document.getElementById('hamburger').addEventListener('click', () => {
    const links = document.querySelector('.nav-links');
    links.style.display = links.style.display === 'flex' ? 'none' : 'flex';
    links.style.flexDirection = 'column';
    links.style.position = 'absolute';
    links.style.top = '60px';
    links.style.right = '1rem';
    links.style.background = 'var(--bg3)';
    links.style.padding = '1rem';
    links.style.borderRadius = 'var(--radius)';
    links.style.border = '1px solid var(--border)';
  });

  // Login button
  document.getElementById('loginBtn').addEventListener('click', (e) => {
    e.preventDefault();
    if (state.user) {
      logout();
    } else {
      openLoginModal();
    }
  });

  // Card formatting
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
});

function addLocalToggle() {
  const navLinks = document.querySelector('.nav-links');
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

  document.getElementById('localToggle').addEventListener('change', (e) => {
    CONFIG.useLocal = e.target.checked;
    localStorage.setItem('nexus_use_local', CONFIG.useLocal);
    showToast(CONFIG.useLocal ? '✦ Switched to Offline Mode' : '✦ Switched to Cloud Mode');
  });
}

async function checkServerHealth() {
  const dot = document.getElementById('serverStatus');
  if (!dot) return;
  try {
    const res = await fetch(CONFIG.healthUrl, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      dot.style.background = data.mode === 'local' ? '#4af0c8' : '#f0a84a';
      dot.title = `Server Online (${data.mode} mode)`;
      return true;
    } else {
      dot.style.background = '#ff6b6b';
      dot.title = 'Server Error';
      return false;
    }
  } catch (e) {
    dot.style.background = '#ff6b6b';
    dot.title = 'Server Offline';
    return false;
  }
}

async function autoDetectMode() {
  // If user has a saved preference, respect it
  const saved = localStorage.getItem('nexus_use_local');
  if (saved !== null) {
    CONFIG.useLocal = saved === 'true';
    const toggle = document.getElementById('localToggle');
    if (toggle) toggle.checked = CONFIG.useLocal;
    return;
  }

  // Otherwise auto-detect: prefer local server if it's running
  try {
    const res = await fetch(CONFIG.healthUrl, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      CONFIG.useLocal = true;
      const toggle = document.getElementById('localToggle');
      if (toggle) toggle.checked = true;
      showToast('\u2726 Local server detected \u2014 using Offline Mode');
      return;
    }
  } catch (_) { /* server not running */ }
// Local server not available — use cloud if configured
  const hasCloud = Boolean(CONFIG.cloudProxyUrl);
  if (hasCloud) {
    CONFIG.useLocal = false;
    const toggle = document.getElementById('localToggle');
    if (toggle) toggle.checked = false;
    showToast('✦ Using Cloud Mode (Supabase)');
  } else {
    // Fallback: Default to local proxy but know it might fail (will show demo offer)
    CONFIG.useLocal = true;
    const toggle = document.getElementById('localToggle');
    if (toggle) toggle.checked = true;
  }
}

// ─── AUTH ──────────────────────────────────────
function updateNavForAuth() {
  const btn = document.getElementById('loginBtn');
  if (state.user) {
    btn.textContent = `Logout (${state.user.email.split('@')[0]})`;
  } else {
    btn.textContent = 'Login';
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPass').value;

  if (email && pass) {
    if (window.supabaseState?.ready) {
      try {
        await supabaseLogin(email, pass, state.authMode);
        closeLoginModal();
        showToast(state.authMode === 'signup' ? `Account created for ${state.user.name}!` : `Welcome back, ${state.user.name}!`);
      } catch (err) {
        showToast(`Login failed: ${err.message}`);
      }
      return;
    }

    state.user = { email, name: email.split('@')[0] };
    localStorage.setItem('nexus_user', JSON.stringify(state.user));
    closeLoginModal();
    updateNavForAuth();
    showToast(`Welcome back, ${state.user.name}! ✓`);
  }
}

async function handleOAuth(provider) {
  if (!window.supabaseState?.ready) {
    showToast('Social sign-in needs Supabase configuration');
    return;
  }

  try {
    await supabaseOAuth(provider);
  } catch (err) {
    showToast(`Sign-in failed: ${err.message}`);
  }
}

async function logout() {
  if (window.supabaseState?.ready) await supabaseLogout();
  state.user = null;
  state.plan = 'free';
  localStorage.removeItem('nexus_user');
  localStorage.removeItem('nexus_plan');
  updateNavForAuth();
  showToast('Logged out successfully');
}

// ─── AGENT MODAL ──────────────────────────────
function openAgent(agentId) {
  const agent = AGENTS[agentId];
  if (!agent) return;

  if (!state.user) {
    state.currentAgent = agentId;
    openLoginModal('signup');
    showToast('Create a free account to generate with an agent');
    return;
  }

  if (agent.tier === 'pro' && state.plan !== 'pro' && state.plan !== 'team') {
    checkPro(agentId);
    return;
  }

  state.currentAgent = agentId;
  document.getElementById('modalIcon').textContent = agent.icon;
  document.getElementById('modalTitle').textContent = agent.title;
  document.getElementById('modalDesc').textContent = agent.desc;

  const body = document.getElementById('modalBody');
  body.innerHTML = buildForm(agent);

  document.getElementById('modalOutput').style.display = 'none';
  document.getElementById('agentModal').classList.add('active');
}

function buildForm(agent) {
  let html = '<div class="loading-bar" id="loadingBar"></div>';

  agent.fields.forEach(field => {
    html += `<label>${field.label}</label>`;
    if (field.type === 'textarea') {
      html += `<textarea id="field_${field.id}" placeholder="${field.placeholder}" rows="${field.rows || 4}"></textarea>`;
    } else if (field.type === 'select') {
      html += `<select id="field_${field.id}">`;
      field.options.forEach(opt => { html += `<option value="${opt}">${opt}</option>`; });
      html += `</select>`;
    } else if (field.type === 'file') {
      html += `<div class="file-input-wrapper">
                <input type="file" id="field_${field.id}" accept="${field.accept || '*'}" onchange="handleFileSelected(this, '${field.id}')" />
                <div id="file_label_${field.id}" class="file-name-display">No file chosen</div>
              </div>`;
    } else {
      html += `<input type="text" id="field_${field.id}" placeholder="${field.placeholder}" />`;
    }
  });

  html += `<button class="modal-submit" id="agentSubmitBtn" onclick="runAgent()">
    ✦ Generate with AI
  </button>`;

  return html;
}

// ─── FILE HANDLING ───────────────────────────
const fileStore = {};

function getFileKind(file) {
  const name = (file?.name || '').toLowerCase();
  const type = (file?.type || '').toLowerCase();

  if (type === 'text/plain' || name.endsWith('.txt')) return 'text';
  if (name.endsWith('.docx') || type.includes('wordprocessingml') || type.includes('word')) return 'docx';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  return 'binary';
}

function getFileReadMode(file) {
  return getFileKind(file) === 'text' ? 'text' : 'arrayBuffer';
}

async function extractFileText(file, payload, deps = {}) {
  const kind = getFileKind(file);

  if (kind === 'text') return String(payload || '');

  if (kind === 'docx') {
    const mammothLib = deps.mammoth || window.mammoth;
    if (!mammothLib?.extractRawText) throw new Error('Word parser is not available');
    const result = await mammothLib.extractRawText({ arrayBuffer: payload });
    return result.value || '';
  }

  if (kind === 'pdf') {
    const pdfLib = deps.pdfjsLib || window.pdfjsLib;
    if (!pdfLib?.getDocument) throw new Error('PDF parser is not available');
    if (pdfLib.GlobalWorkerOptions) {
      pdfLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const loadingTask = pdfLib.getDocument({ data: new Uint8Array(payload) });
    const pdf = await loadingTask.promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `${pageText}\n`;
    }

    return fullText;
  }

  if (typeof payload === 'string') return payload;
  return new TextDecoder().decode(payload);
}

function getParsedFileLabel(file) {
  const kind = getFileKind(file);
  if (kind === 'docx') return `${file.name} (Word)`;
  if (kind === 'pdf') return `${file.name} (PDF)`;
  return file.name;
}

function handleFileSelected(input, fieldId) {
  const file = input.files[0];
  const label = document.getElementById(`file_label_${fieldId}`);
  if (file) {
    label.textContent = `⟳ Reading ${file.name}...`;
    label.classList.add('active');
    
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        fileStore[fieldId] = await extractFileText(file, e.target.result);
        label.textContent = getParsedFileLabel(file);
        if (getFileKind(file) === 'docx') showToast("Word document parsed successfully!");
        if (getFileKind(file) === 'pdf') showToast("PDF content extracted successfully!");
        return;
      } catch (err) {
        console.error("File parsing error:", err);
        label.textContent = "Error parsing file";
        showToast("Could not read file content. Try pasting text.");
        return;
      }
      try {
        if (file.type === "text/plain" || file.name.endsWith('.txt')) {
          fileStore[fieldId] = e.target.result;
          label.textContent = `✓ ${file.name}`;
        } 
        else if (file.name.endsWith('.docx') || file.type.includes('word')) {
          const result = await mammoth.extractRawText({ arrayBuffer: e.target.result });
          fileStore[fieldId] = result.value;
          label.textContent = `✓ ${file.name} (Word)`;
          showToast("✓ Word document parsed successfully!");
        } 
        else if (file.type === "application/pdf" || file.name.endsWith('.pdf')) {
          const pdfData = new Uint8Array(e.target.result);
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          
          const loadingTask = pdfjsLib.getDocument({ data: pdfData });
          const pdf = await loadingTask.promise;
          let fullText = "";
          
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(" ");
            fullText += pageText + "\n";
          }
          
          fileStore[fieldId] = fullText;
          label.textContent = `✓ ${file.name} (PDF)`;
          showToast("✓ PDF content extracted successfully!");
        } 
        else {
          fileStore[fieldId] = e.target.result;
          label.textContent = `✓ ${file.name}`;
        }
      } catch (err) {
        console.error("File parsing error:", err);
        label.textContent = "⚠ Error parsing file";
        showToast("⚠ Could not read file content. Try pasting text.");
      }
    };
    
    if (getFileReadMode(file) === 'text') {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  } else {
    label.textContent = "No file chosen";
    label.classList.remove('active');
    delete fileStore[fieldId];
  }
}

async function runAgent() {
  const agent = AGENTS[state.currentAgent];
  if (!agent) return;

  if (!state.user) {
    closeModal();
    openLoginModal('signup');
    showToast('Create a free account to generate with an agent');
    return;
  }

  const fields = {};
  agent.fields.forEach(field => {
    if (field.type === 'file') {
      fields[field.id] = fileStore[field.id] || "";
    } else {
      const el = document.getElementById(`field_${field.id}`);
      if (el) fields[field.id] = el.value.trim();
    }
  });

  console.log("Fields collected:", fields);

  const primaryField = Object.values(fields).find(v => v && v.length > 0);
  if (!primaryField) {
    showToast('⚠ Please fill in the required fields or upload a file');
    return;
  }

  // Show loading
  const submitBtn = document.getElementById('agentSubmitBtn');
  const loadingBar = document.getElementById('loadingBar');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span>⟳ Initializing... <span id="progressPercent">0%</span></span>';
  loadingBar.classList.add('active');
  loadingBar.style.width = '0%';

  let progress = 0;
  const progressInterval = setInterval(() => {
    if (progress < 35) {
      progress += Math.random() * 15; // Fast at beginning
    } else if (progress < 85) {
      progress += Math.random() * 2; // Slow down in middle
    } else if (progress < 98) {
      progress += 0.1; // Very slow at the end
    }
    const displayProgress = Math.min(Math.floor(progress), 99);
    loadingBar.style.width = `${displayProgress}%`;
    const percentEl = document.getElementById('progressPercent');
    if (percentEl) percentEl.textContent = `${displayProgress}%`;
    submitBtn.style.background = `linear-gradient(90deg, var(--accent) ${displayProgress}%, var(--bg3) ${displayProgress}%)`;
    submitBtn.style.color = '#fff';
    submitBtn.style.border = '1px solid var(--accent)';
  }, 150);

  try {
    const userPrompt = agent.buildPrompt(fields);
    console.log("Built Prompt:", userPrompt);
    
    const outputDiv = document.getElementById('modalOutput');
    const outputContent = document.getElementById('outputContent');
    outputDiv.style.display = 'block';
    outputContent.innerHTML = '<span style="color:var(--text3);font-style:italic">✦ Connecting to Nexus Neural Link...</span>';
    // Scroll the modal's scroll body into view
    const scrollBody = document.querySelector('.modal-scroll-body');
    if (scrollBody) {
      setTimeout(() => scrollBody.scrollTop = scrollBody.scrollHeight, 100);
    }

    const result = await callAIAPI(agent.systemPrompt, userPrompt, (currentText) => {
      // Update UI incrementally
      outputContent.innerHTML = formatAIResponse(currentText);
      state.output = currentText; // Update state as we go
    });
    
    console.log("Final Result:", result);
    state.output = result;
    clearInterval(progressInterval);
    loadingBar.style.width = '100%';
    const percentEl = document.getElementById('progressPercent');
    if (percentEl) percentEl.textContent = '100%';
    submitBtn.style.background = `linear-gradient(90deg, var(--accent) 100%, var(--bg3) 100%)`;
    
    saveGenerationRecord(state.currentAgent, userPrompt, result);
    showToast('✓ Generation complete!');
  } catch (err) {
    clearInterval(progressInterval);
    loadingBar.style.width = '0%';
    console.error("Agent Error:", err);

    const errorMsg = err.message || "Unknown Connection Error";
    const outputContent = document.getElementById('outputContent');

    // Determine error type and show the right message
    const isNetworkErr = err.message?.includes("Failed to fetch") || err.message?.includes("NetworkError") || err.message?.includes("Load failed");
    const isCorsErr = err.message?.includes("CORS") || err.message?.includes("blocked");
    const isUsingCloud = !CONFIG.useLocal && window.NEXUS_SUPABASE_CONFIG?.aiFunctionUrl;

    if (isNetworkErr && CONFIG.useLocal) {
      // Local proxy not running
      showToast('✦ Local server not reachable. Enable Cloud Mode or start the server.');
      outputContent.innerHTML = `<div class="error-box" style="color:#f0a84a;padding:1.25rem;border:1px solid rgba(240,168,74,0.2);border-radius:8px;background:rgba(240,168,74,0.05)">
        <strong>⚠ Local Server Offline</strong><br><br>
        The local proxy at <code style="color:var(--accent);font-size:0.85em">${CONFIG.proxyUrl}</code> is not reachable.<br><br>
        <strong>Quick Fix:</strong> Toggle <em>Offline Mode</em> off in the nav bar to switch to Cloud Mode, or start the server:
        <pre style="margin-top:0.75rem;font-size:0.8em;opacity:0.8">python server/local_server.py</pre>
        <button class="btn-ghost" style="margin-top:1rem;width:100%;border-color:rgba(240,168,74,0.3)" onclick="showDemoOutput()">See Demo Output Instead →</button>
      </div>`;
    } else if (isNetworkErr && isUsingCloud) {
      // Cloud CORS or network error
      showToast('⚠ Cloud connection failed. Check your Supabase edge function.');
      outputContent.innerHTML = `<div class="error-box" style="color:#ff6b6b;padding:1.25rem;border:1px solid rgba(255,107,107,0.2);border-radius:8px;background:rgba(255,107,107,0.05)">
        <strong>⚠ Cloud API Connection Failed</strong><br><br>
        Could not reach the AI generation service. This is usually a CORS or deployment issue with the Supabase edge function.<br><br>
        <button class="btn-ghost" style="margin-top:1rem;width:100%;border-color:rgba(255,107,107,0.3)" onclick="showDemoOutput()">See Demo Output Instead →</button>
      </div>`;
    } else if (errorMsg.includes('Upgrade to Pro')) {
      showToast('✨ Free tier limit reached');
      outputContent.innerHTML = `<div class="error-box" style="color:#f0a84a;padding:1.25rem;border:1px solid rgba(240,168,74,0.2);border-radius:8px;background:rgba(240,168,74,0.05)">
        <strong>✨ Free Tier Limit Reached</strong><br><br>
        You have completed your 2 free tasks. Please subscribe to a Pro plan to continue generating unlimited tasks.<br><br>
        <button class="modal-submit" style="margin-top:1rem;width:100%" onclick="openPaymentModal('pro')">Upgrade to Pro →</button>
      </div>`;
    } else {
      // Other errors (401, 429, 500, etc.)
      showToast(`⚠ ${errorMsg}`);
      outputContent.innerHTML = `<div class="error-box" style="color:#ff6b6b;padding:1.25rem;border:1px solid rgba(255,107,107,0.2);border-radius:8px;background:rgba(255,107,107,0.05)">
        <strong>⚠ Generation Failed</strong><br><br>
        ${escapeHtml(errorMsg)}
        <button class="btn-ghost" style="margin-top:1rem;width:100%;border-color:rgba(255,107,107,0.3)" onclick="showDemoOutput()">See Demo Output Instead →</button>
      </div>`;
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '✦ Generate with AI';
    submitBtn.style.background = '';
    submitBtn.style.color = '';
    submitBtn.style.border = '';
    setTimeout(() => {
      loadingBar.classList.remove('active');
      loadingBar.style.width = '0%';
    }, 1000);
  }
}

// ─── HELPERS ───────────────────────────────────
function formatAIResponse(text) {
  let formatted = escapeHtml(text || '');

  formatted = formatted
    .replace(/&lt;thought&gt;([\s\S]*?)&lt;\/thought&gt;/g, '<div class="thought-block">$1</div>')
    .replace(/&lt;thought&gt;([\s\S]*?)$/g, '<div class="thought-block">$1</div>');

  formatted = formatted
    .replace(/^([A-Z][A-Z0-9\s/&().,:-]{5,})$/gm, '<div class="output-heading">$1</div>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<div class="output-heading">$1</div>')
    .replace(/^\s*(?:[-*]|\u2022)\s+(.+)$/gm, '<div class="output-bullet">- $1</div>')
    .replace(/^\s*(\d+\.)\s+(.+)$/gm, '<div class="output-bullet">$1 $2</div>')
    .replace(/^\s*[=]{4,}\s*$/gm, '<div class="output-rule"></div>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  return formatted;
}

// ─── API CALL ──────────────────────────────────
async function callAIAPI(systemPrompt, userPrompt, onChunk) {
  const accessToken = await getSupabaseAccessToken();
  const isLocalProxy = isLocalProxyUrl(CONFIG.proxyUrl);
  const headers = {
    'Content-Type': 'application/json'
  };

  if (isLocalProxy) {
    // Local server uses X-User-Email auth (insecure-dev mode) — don't send JWT
    // X-Use-Local: true means use local llama.cpp inference, false means use OpenRouter
    headers['X-Use-Local'] = CONFIG.useLocal.toString();
    headers['X-User-Email'] = state.user ? state.user.email : 'null';
    headers['X-User-Plan'] = state.plan;
  } else {
    // Cloud (Supabase edge function) uses JWT Bearer auth
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(CONFIG.proxyUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent_id: state.currentAgent,
      model: AGENTS[state.currentAgent]?.fallbacks || CONFIG.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 4096,
      temperature: 1.0,
      stream: true
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: `Server error: ${response.status}` }));
    throw new Error(errorData.detail || errorData.error || `Server error: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || data.output || '';
    if (onChunk) onChunk(content);
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let lineBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    lineBuffer += decoder.decode(value, { stream: true });
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop(); // Keep the last (potentially incomplete) line
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine === '' || trimmedLine === 'data: [DONE]') continue;
      
      if (trimmedLine.startsWith('data: ')) {
        const dataStr = trimmedLine.slice(6);
        try {
          const data = JSON.parse(dataStr);
          
          // Handle Error in Stream
          if (data.error) {
            const errMsg = data.error.message || "Unknown Provider Error";
            fullContent += `\n\n[ERROR] ${errMsg}`;
            if (onChunk) onChunk(fullContent);
            return fullContent;
          }

          const content = data.choices[0]?.delta?.content || data.choices[0]?.text || '';
          fullContent += content;
          if (onChunk) onChunk(fullContent);
        } catch (e) {
          console.warn("Could not parse stream chunk:", dataStr);
        }
      }
    }
  }
  return fullContent;
}

// ─── DEMO OUTPUT ──────────────────────────────
function showDemoOutput(agentId) {
  const id = agentId || state.currentAgent;
  const agent = AGENTS[id] || { title: 'Agent' };
  const demos = {
    resume: `══════════════════════════════
JOHN DOE
Software Engineer
john.doe@email.com | LinkedIn: /in/johndoe | GitHub: /johndoe
══════════════════════════════

PROFESSIONAL SUMMARY
─────────────────────────────
Results-driven Software Engineer with 5+ years building scalable web applications. Specialized in React, Node.js, and cloud infrastructure. Delivered products used by 2M+ users with 99.9% uptime.

EXPERIENCE
─────────────────────────────
SENIOR SOFTWARE ENGINEER — Tech Corp                    2022–Present
• Led migration of monolith to microservices, reducing latency by 40%
• Mentored team of 4 junior engineers; improved team velocity by 25%
• Architected real-time data pipeline processing 1M+ events/day

SOFTWARE ENGINEER — StartupXYZ                         2019–2022
• Built core product features serving 500K+ users
• Reduced API response time by 60% through caching optimization
• Collaborated with product team to ship 3 major feature releases

SKILLS
─────────────────────────────
Languages: JavaScript, TypeScript, Python, Go
Frontend: React, Next.js, Vue.js, TailwindCSS
Backend: Node.js, Express, FastAPI, GraphQL
Cloud: AWS, GCP, Docker, Kubernetes, CI/CD

EDUCATION
─────────────────────────────
BSc Computer Science — University of Technology       2015–2019
Dean's List | Thesis: Distributed Systems Optimization

══════════════════════════════
[Generated by NexusAI Resume Writer]
To use real AI generation, add your Anthropic API key in js/app.js`,

    email: `Subject: Following Up on My Application — Marketing Manager Role

Dear Hiring Manager,

I hope this message finds you well. I'm reaching out to follow up on my application for the Marketing Manager position submitted last week.

Having spent the past two days researching [Company]'s recent campaigns and growth trajectory, I'm even more excited about the opportunity to contribute to your team. My background in digital marketing and brand strategy aligns closely with the direction you're heading.

I would welcome the chance to discuss how my experience could add value. Please let me know if you need any additional information from my end.

Thank you for your time and consideration.

Best regards,
[Your Name]

—
[Generated by NexusAI Email Drafter]
Add your Anthropic API key in js/app.js for real AI generation`,

    notes: `📚 STUDY NOTES
Subject: Machine Learning Fundamentals
Format: Structured Notes with Headings

═══════════════════════════════
1. CORE CONCEPTS
═══════════════════════════════
Definition: ML is a subset of AI where systems learn from data without explicit programming.

Types:
• Supervised Learning — labeled data → predict output
• Unsupervised Learning — unlabeled data → find patterns
• Reinforcement Learning — reward-based learning

═══════════════════════════════
2. KEY ALGORITHMS
═══════════════════════════════
• Linear Regression — continuous output prediction
• Logistic Regression — binary classification
• Decision Trees — rule-based splitting
• Neural Networks — layered non-linear learning

═══════════════════════════════
3. IMPORTANT TERMS
═══════════════════════════════
• Overfitting — model memorizes training data
• Underfitting — model too simple
• Bias-Variance Tradeoff — balance between complexity
• Cross-validation — evaluating model generalization

═══════════════════════════════
⚡ KEY TAKEAWAYS FOR EXAM
═══════════════════════════════
1. Always split data: train/validation/test
2. Feature scaling matters for distance-based models
3. More data > more complex model
4. Check for data leakage before evaluating

[Generated by NexusAI Study Notes Converter]`
  };

  const demo = demos[id] || `✦ DEMO OUTPUT — ${agent.title}\n\nThis is a placeholder response.\n\nTo get real AI-powered results, configure your Supabase project or start the local server.\n\n[NexusAI — AI Agent Hub]`;

  state.output = demo;
  const outputDiv = document.getElementById('modalOutput');
  const outputContent = document.getElementById('outputContent');
  
  if (outputContent) {
    outputContent.innerHTML = formatAIResponse(demo);
  }
  
  outputDiv.style.display = 'block';
  outputDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  showToast('✓ Showing demo output');
}

// ─── OUTPUT ACTIONS ───────────────────────────
function copyOutput() {
  navigator.clipboard.writeText(state.output).then(() => {
    showToast('✓ Copied to clipboard!');
  });
}

function downloadOutput(format) {
  // Pro Enforcement
  const proFormats = ['html', 'pdf', 'docx'];
  if (proFormats.includes(format) && state.plan === 'free') {
    showToast(`✨ Upgrade to Pro to download as ${format.toUpperCase()}!`);
    setTimeout(() => openPaymentModal('pro'), 1000);
    return;
  }

  const agent = AGENTS[state.currentAgent] || { title: 'AI Output', icon: '' };
  const filename = `nexusai-${state.currentAgent || 'output'}-${Date.now()}`;
  const exportDoc = buildExportDocument(agent, state.output);

  if (format === 'txt') {
    const blob = new Blob([exportDoc.plainText], { type: 'text/plain' });
    downloadBlob(blob, `${filename}.txt`);
  } 
  else if (format === 'html') {
    exportHtml(exportDoc, `${filename}.html`);
    showToast(`âœ“ Exported as ${format.toUpperCase()}`);
    return;
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${agent.title} — NexusAI</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 60px auto; padding: 0 2rem; color: #1a1a2e; line-height: 1.7; }
    h1 { color: #0d6efd; border-bottom: 2px solid #0d6efd; padding-bottom: 0.5rem; }
    pre { background: #f8f9fa; padding: 2rem; border-radius: 8px; white-space: pre-wrap; font-size: 0.9rem; border: 1px solid #ddd; }
    .footer { margin-top: 3rem; color: #999; font-size: 0.8rem; text-align: center; }
  </style>
</head>
<body>
  <h1>${agent.icon} ${agent.title}</h1>
  <pre>${escapeHtml(state.output)}</pre>
  <div class="footer">Generated by NexusAI • ${new Date().toLocaleDateString()}</div>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    downloadBlob(blob, `${filename}.html`);
  }
  else if (format === 'pdf') {
    exportPdf(exportDoc, `${filename}.pdf`);
    showToast(`âœ“ Exported as ${format.toUpperCase()}`);
    return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text(`${agent.icon} ${agent.title}`, 20, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated by NexusAI • ${new Date().toLocaleDateString()}`, 20, 30);
    
    doc.setFontSize(11);
    doc.setTextColor(0);
    const splitText = doc.splitTextToSize(state.output, 170);
    doc.text(splitText, 20, 45);
    
    doc.save(`${filename}.pdf`);
  }
  else if (format === 'docx') {
    exportDocx(exportDoc, `${filename}.docx`);
    showToast(`âœ“ Exported as ${format.toUpperCase()}`);
    return;
    const doc = new docx.Document({
        sections: [{
            properties: {},
            children: [
                new docx.Paragraph({
                    children: [
                        new docx.TextRun({
                            text: `${agent.title}`,
                            bold: true,
                            size: 32,
                        }),
                    ],
                }),
                new docx.Paragraph({
                    children: [
                        new docx.TextRun({
                            text: `Generated by NexusAI • ${new Date().toLocaleDateString()}`,
                            italics: true,
                            color: "666666",
                        }),
                    ],
                }),
                new docx.Paragraph({
                    children: [
                        new docx.TextRun({
                            text: state.output,
                        }),
                    ],
                    spacing: {
                        before: 400,
                    },
                }),
            ],
        }],
    });

    docx.Packer.toBlob(doc).then(blob => {
        downloadBlob(blob, `${filename}.docx`);
    });
  }

  showToast(`✓ Exported as ${format.toUpperCase()}`);
}

function buildExportDocument(agent, rawOutput) {
  const cleaned = stripThoughts(rawOutput || '').trim();
  const lines = cleaned.split(/\r?\n/);
  const blocks = [];
  let currentList = null;

  function flushList() {
    if (currentList) {
      blocks.push(currentList);
      currentList = null;
    }
  }

  lines.forEach((line) => {
    const text = line.trim();
    if (!text) {
      flushList();
      return;
    }

    if (/^[=\-_]{4,}$/.test(text)) {
      flushList();
      blocks.push({ type: 'rule' });
      return;
    }

    const bullet = text.match(/^(?:[-*]|\u2022)\s+(.+)$/);
    const numbered = text.match(/^(\d+)\.\s+(.+)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!currentList || currentList.ordered !== ordered) {
        flushList();
        currentList = { type: 'list', ordered, items: [] };
      }
      currentList.items.push(bullet ? bullet[1] : numbered[2]);
      return;
    }

    flushList();
    blocks.push(isLikelyHeading(text)
      ? { type: 'heading', text: normalizeHeading(text) }
      : { type: 'paragraph', text });
  });

  flushList();

  return {
    title: agent.title || 'AI Output',
    date: new Date().toLocaleDateString(),
    blocks,
    html: blocksToHtml(blocks),
    plainText: `${agent.title || 'AI Output'}\nGenerated by NexusAI - ${new Date().toLocaleDateString()}\n\n${cleaned}`
  };
}

function stripThoughts(text) {
  return text.replace(/<thought>[\s\S]*?<\/thought>/g, '').replace(/<thought>[\s\S]*$/g, '');
}

function isLikelyHeading(text) {
  if (/^#{1,3}\s+/.test(text)) return true;
  if (text.length > 80 || /[.!?]$/.test(text)) return false;
  return /^[A-Z0-9\s/&().,:-]{5,}$/.test(text) || /^[A-Z][A-Za-z0-9\s/&().,:-]{3,}:$/.test(text);
}

function normalizeHeading(text) {
  return text.replace(/^#{1,3}\s+/, '').replace(/:$/, '');
}

function blocksToHtml(blocks) {
  return blocks.map((block) => {
    if (block.type === 'heading') return `<h2>${escapeHtml(block.text)}</h2>`;
    if (block.type === 'rule') return '<hr>';
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map(item => `<li>${inlineFormat(item)}</li>`).join('')}</${tag}>`;
    }
    return `<p>${inlineFormat(block.text)}</p>`;
  }).join('\n');
}

function inlineFormat(text) {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function exportHtml(exportDoc, filename) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(exportDoc.title)} - NexusAI</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #f3f6fb; color: #172033; font-family: Inter, "Segoe UI", Arial, sans-serif; line-height: 1.65; }
    .page { max-width: 820px; margin: 40px auto; background: #fff; padding: 48px 56px; border: 1px solid #dbe3ef; border-radius: 10px; box-shadow: 0 18px 45px rgba(28, 42, 68, 0.08); }
    .kicker { color: #5d6f8f; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
    h1 { color: #111827; font-size: 34px; margin: 8px 0 4px; line-height: 1.15; }
    .meta { color: #65758f; font-size: 13px; margin-bottom: 28px; padding-bottom: 18px; border-bottom: 2px solid #e5edf7; }
    h2 { color: #16335f; font-size: 18px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #dbe3ef; }
    p { margin: 0 0 12px; }
    ul, ol { margin: 0 0 14px 22px; padding: 0; }
    li { margin-bottom: 6px; }
    hr { border: 0; border-top: 1px solid #dbe3ef; margin: 22px 0; }
    .footer { margin-top: 34px; padding-top: 14px; border-top: 1px solid #e5edf7; color: #7b879b; font-size: 12px; text-align: center; }
    @media print { body { background: #fff; } .page { margin: 0; border: 0; box-shadow: none; } }
  </style>
</head>
<body>
  <main class="page">
    <div class="kicker">Generated by NexusAI</div>
    <h1>${escapeHtml(exportDoc.title)}</h1>
    <div class="meta">${escapeHtml(exportDoc.date)}</div>
    ${exportDoc.html}
    <div class="footer">Ready-to-use export from NexusAI</div>
  </main>
</body>
</html>`;
  downloadBlob(new Blob([html], { type: 'text/html' }), filename);
}

function exportPdf(exportDoc, filename) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 54;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - margin * 2;
  let y = 58;

  function ensureSpace(height) {
    if (y + height > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function wrapped(text, size, lineHeight, color, bold = false) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach((line) => {
      ensureSpace(lineHeight);
      doc.text(line, margin, y);
      y += lineHeight;
    });
  }

  doc.setFillColor(245, 248, 252);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(32, 32, pageWidth - 64, pageHeight - 64, 8, 8, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(92, 111, 143);
  doc.text('GENERATED BY NEXUSAI', margin, y);
  y += 25;

  wrapped(exportDoc.title, 24, 30, [17, 24, 39], true);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(101, 117, 143);
  doc.text(exportDoc.date, margin, y);
  y += 20;
  doc.setDrawColor(224, 231, 241);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  exportDoc.blocks.forEach((block) => {
    if (block.type === 'heading') {
      ensureSpace(34);
      y += 8;
      wrapped(block.text, 14, 18, [22, 51, 95], true);
      doc.setDrawColor(224, 231, 241);
      doc.line(margin, y - 4, pageWidth - margin, y - 4);
      y += 8;
    } else if (block.type === 'rule') {
      ensureSpace(18);
      doc.setDrawColor(224, 231, 241);
      doc.line(margin, y, pageWidth - margin, y);
      y += 18;
    } else if (block.type === 'list') {
      block.items.forEach((item, index) => {
        const marker = block.ordered ? `${index + 1}.` : '-';
        const itemLines = doc.splitTextToSize(item.replace(/\*\*/g, ''), maxWidth - 24);
        itemLines.forEach((line, lineIndex) => {
          ensureSpace(16);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10.5);
          doc.setTextColor(32, 43, 64);
          doc.text(lineIndex === 0 ? marker : '', margin, y);
          doc.text(line, margin + 24, y);
          y += 16;
        });
        y += 3;
      });
      y += 5;
    } else {
      wrapped(block.text.replace(/\*\*/g, ''), 10.5, 16, [32, 43, 64]);
      y += 7;
    }
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(130, 141, 160);
    doc.text(`NexusAI - Page ${i} of ${pageCount}`, margin, pageHeight - 28);
  }

  doc.save(filename);
}

function exportDocx(exportDoc, filename) {
  const children = [
    new docx.Paragraph({
      children: [new docx.TextRun({ text: 'Generated by NexusAI', bold: true, color: '5D6F8F', size: 20 })],
      spacing: { after: 120 }
    }),
    new docx.Paragraph({
      children: [new docx.TextRun({ text: exportDoc.title, bold: true, size: 40, color: '111827' })],
      spacing: { after: 120 }
    }),
    new docx.Paragraph({
      children: [new docx.TextRun({ text: exportDoc.date, italics: true, color: '65758F', size: 20 })],
      border: { bottom: { color: 'E5EDF7', space: 1, style: 'single', size: 8 } },
      spacing: { after: 280 }
    })
  ];

  exportDoc.blocks.forEach((block) => {
    if (block.type === 'heading') {
      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: block.text, bold: true, color: '16335F', size: 26 })],
        spacing: { before: 240, after: 100 },
        border: { bottom: { color: 'DBE3EF', space: 1, style: 'single', size: 4 } }
      }));
    } else if (block.type === 'rule') {
      children.push(new docx.Paragraph({
        border: { bottom: { color: 'DBE3EF', space: 1, style: 'single', size: 6 } },
        spacing: { before: 120, after: 120 }
      }));
    } else if (block.type === 'list') {
      block.items.forEach((item, index) => {
        children.push(new docx.Paragraph({
          children: [new docx.TextRun({ text: `${block.ordered ? `${index + 1}.` : '-'} ${item.replace(/\*\*/g, '')}`, size: 22, color: '202B40' })],
          indent: { left: 360 },
          spacing: { after: 80 }
        }));
      });
    } else {
      children.push(new docx.Paragraph({
        children: [new docx.TextRun({ text: block.text.replace(/\*\*/g, ''), size: 22, color: '202B40' })],
        spacing: { after: 140 }
      }));
    }
  });

  const doc = new docx.Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 }
        }
      },
      children
    }]
  });

  docx.Packer.toBlob(doc).then(blob => downloadBlob(blob, filename));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── MODAL CONTROLS ───────────────────────────
function closeModal() {
  document.getElementById('agentModal').classList.remove('active');
  state.currentAgent = null;
}

function closePaymentModal() {
  document.getElementById('paymentModal').classList.remove('active');
}

function closeLoginModal() {
  document.getElementById('loginModal').classList.remove('active');
}

function openLoginModal(mode = 'signin') {
  const signup = mode === 'signup';
  state.authMode = mode;
  document.getElementById('authTitle').textContent = signup ? 'Create Your Account' : 'Welcome Back';
  document.getElementById('authDesc').textContent = signup ? 'Start using NexusAI for free' : 'Sign in to NexusAI';
  document.getElementById('authSubmitBtn').textContent = signup ? 'Create Free Account' : 'Sign In';
  document.getElementById('authSwitchText').textContent = signup ? 'Already have an account?' : "Don't have an account?";

  const switchLink = document.querySelector('#authSwitchText + a');
  if (switchLink) {
    switchLink.textContent = signup ? 'Sign in' : 'Sign up free';
    switchLink.onclick = (event) => {
      event.preventDefault();
      openLoginModal(signup ? 'signin' : 'signup');
    };
  }

  document.getElementById('loginModal').classList.add('active');
}

// Close modals on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  }
});

// ─── PRO GATE ──────────────────────────────────
function checkPro(agentId) {
  if (state.plan === 'pro' || state.plan === 'team') {
    openAgent(agentId);
    return;
  }
  openPaymentModal('pro');
}

// ─── PAYMENT MODAL ────────────────────────────
function selectPlan(planId) {
  if (planId === 'free') {
    if (!state.user) {
      showToast('✓ Free plan activated!');
      openLoginModal('signup');
      showToast('Create a free account to get started');
    } else {
      showToast('✓ You are on the free plan!');
    }
    return;
  }
  openPaymentModal(planId);
}

function openPaymentModal(planId) {
  const plans = {
    pro: { name: 'Pro Plan', price: '$9/month', amount: 9 },
    team: { name: 'Team Plan', price: '$29/month', amount: 29 }
  };

  state.currentPlanSelection = planId;
  document.getElementById('paymentTitle').textContent = `Upgrade to ${plans[planId]?.name || 'Pro'}`;
  document.getElementById('paymentDesc').textContent = 'Unlock all AI agents and features';

  document.getElementById('paymentSummary').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span>✦ ${plans[planId]?.name}</span>
      <strong style="color:var(--accent)">${plans[planId]?.price}</strong>
    </div>
    <div style="margin-top:0.5rem;font-size:0.75rem;color:var(--text3)">All features unlocked · Cancel anytime · Secure payment</div>
  `;

  // Build plan selection
  const plansHtml = Object.entries(plans).map(([id, p]) => `
    <div class="plan-option ${id === planId ? 'selected' : ''}" onclick="selectPaymentPlan('${id}', this)">
      <div class="plan-radio"></div>
      <div class="plan-info">
        <div class="plan-name">${p.name}</div>
        <div class="plan-price">${p.price}</div>
      </div>
    </div>
  `).join('');

  document.getElementById('paymentPlans').innerHTML = plansHtml;
  document.getElementById('paymentModal').classList.add('active');
}

function selectPaymentPlan(planId, el) {
  state.currentPlanSelection = planId;
  document.querySelectorAll('.plan-option').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
}

function processPayment(e) {
  e.preventDefault();

  if (window.supabaseState?.ready) {
    showToast('Billing is not enabled yet. Your plan stays synced from Supabase.');
    return;
  }

  const name = document.getElementById('payName').value;
  const email = document.getElementById('payEmail').value;
  const card = document.getElementById('payCard').value;
  const expiry = document.getElementById('payExpiry').value;
  const cvv = document.getElementById('payCvv').value;

  if (!name || !email || !card || !expiry || !cvv) {
    showToast('⚠ Please fill in all payment fields');
    return;
  }

  const btn = document.getElementById('paySubmitBtn');
  btn.disabled = true;
  document.getElementById('payBtnText').textContent = '⟳ Processing...';

  // Simulate payment processing (2 seconds)
  setTimeout(() => {
    state.plan = state.currentPlanSelection;
    localStorage.setItem('nexus_plan', state.plan);

    if (!state.user) {
      state.user = { email, name: name.split(' ')[0] };
      localStorage.setItem('nexus_user', JSON.stringify(state.user));
      updateNavForAuth();
    }

    closePaymentModal();
    updateProBadges();

    const planNames = { pro: 'Pro', team: 'Team' };
    showToast(`🎉 Welcome to ${planNames[state.plan]} plan, ${name.split(' ')[0]}!`);

    btn.disabled = false;
    document.getElementById('payBtnText').textContent = 'Complete Payment';

    // Confetti effect
    triggerConfetti();
  }, 2000);
}

function updateProBadges() {
  if (state.plan === 'pro' || state.plan === 'team') {
    document.querySelectorAll('.card-btn.pro-locked').forEach(btn => {
      btn.classList.remove('pro-locked');
    });
    document.querySelectorAll('.card-badge.pro').forEach(badge => {
      badge.textContent = 'UNLOCKED';
      badge.style.background = 'rgba(74, 240, 200, 0.1)';
      badge.style.color = 'var(--accent)';
    });
  }
}

// ─── CONFETTI ─────────────────────────────────
function triggerConfetti() {
  const colors = ['#4af0c8', '#638cff', '#f0a84a', '#ff6b6b', '#fff'];
  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; z-index:9999; pointer-events:none;
      width:${Math.random() * 8 + 4}px; height:${Math.random() * 8 + 4}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      left:${Math.random() * 100}vw; top:-10px;
      animation: confettiFall ${Math.random() * 2 + 1.5}s ease forwards;
      animation-delay:${Math.random() * 0.5}s;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  const style = document.createElement('style');
  style.textContent = `@keyframes confettiFall { to { transform: translateY(110vh) rotate(720deg); opacity: 0; } }`;
  document.head.appendChild(style);
  setTimeout(() => style.remove(), 4000);
}

// ─── TOAST ────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── ON LOAD: Update badge state & apply branding ──────────────
window.addEventListener('load', () => {
  if (state.plan === 'pro' || state.plan === 'team') {
    updateProBadges();
  }
  applyCustomBranding();
});

// ══════════════════════════════════════════════
//  NexusAI - Team Plan Extension Logic
// ══════════════════════════════════════════════

// Extend state with Team plan structures
state.teamMembers = JSON.parse(localStorage.getItem('nexus_team_members')) || [
  { id: 1, name: 'Alice Smith', email: 'alice@company.com', role: 'admin', joined: '2026-01-15' },
  { id: 2, name: 'Bob Johnson', email: 'bob@company.com', role: 'member', joined: '2026-02-10' },
  { id: 3, name: 'Charlie Brown', email: 'charlie@company.com', role: 'viewer', joined: '2026-03-01' }
];

state.teamDocuments = JSON.parse(localStorage.getItem('nexus_team_docs')) || [
  { id: 1, name: 'Marketing Campaign Proposal.docx', creator: 'alice@company.com', size: '24 KB', date: '2026-05-10', content: 'Marketing Campaign Proposal\nGenerated by NexusAI Event Planner\n\n1. Target Audience: Young professionals aged 22-35...\n2. Budget allocation: 40% social media ads, 30% influencer marketing...\n' },
  { id: 2, name: 'Q2 Tech Strategy Notes.pdf', creator: 'bob@company.com', size: '158 KB', date: '2026-05-15', content: 'Q2 Tech Strategy Notes\nGenerated by NexusAI Study Note Converter\n\nKey pillars:\n- Microservices architecture migration\n- AI Agent Integration via Developer API\n- Scaling storage solutions...\n' }
];

state.teamTickets = JSON.parse(localStorage.getItem('nexus_team_tickets')) || [
  { id: 1, subject: 'Payment Issue via invoice', desc: 'Can we get an invoice payment setup for the annual subscription?', urgency: 'medium', status: 'resolved', date: '2026-04-20' }
];

state.teamApiKeys = JSON.parse(localStorage.getItem('nexus_team_apikeys')) || [
  { id: 1, name: 'Production Backend', key: 'nx_live_8f0a2k9...a31', created: '2026-05-01' }
];

state.customBranding = JSON.parse(localStorage.getItem('nexus_custom_branding')) || {
  brandName: 'NexusAI',
  brandIcon: '⬡',
  accentColor: '#4af0c8'
};

// --- ROUTING & NAVIGATION ---
function showHomeView() {
  document.querySelector('.hero').style.display = 'flex';
  document.getElementById('agents').style.display = 'block';
  document.getElementById('pricing').style.display = 'block';
  document.getElementById('teamHub').style.display = 'none';
  const tabLink = document.getElementById('teamHubLink');
  if (tabLink) tabLink.classList.remove('active');
}

function showTeamHubView() {
  document.querySelector('.hero').style.display = 'none';
  document.getElementById('agents').style.display = 'none';
  document.getElementById('pricing').style.display = 'none';
  document.getElementById('teamHub').style.display = 'block';
  const tabLink = document.getElementById('teamHubLink');
  if (tabLink) tabLink.classList.add('active');
  
  initTeamHub();
}

function handleRouting() {
  const hash = window.location.hash;
  if (hash === '#team-hub') {
    showTeamHubView();
  } else {
    showHomeView();
    // Scroll if needed
    if (hash === '#agents') {
      const el = document.getElementById('agents');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    } else if (hash === '#pricing') {
      const el = document.getElementById('pricing');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  }
}

window.addEventListener('hashchange', handleRouting);
window.addEventListener('load', () => {
  // Register click handler on Logo
  const brand = document.querySelector('.nav-brand');
  if (brand) {
    brand.style.cursor = 'pointer';
    brand.addEventListener('click', () => {
      window.location.hash = '';
    });
  }
  handleRouting();
});

// --- TAB SWITCHER ---
function switchTeamTab(tabId) {
  // Update active tab buttons
  document.querySelectorAll('.team-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const btn = document.getElementById(`btn_tab_${tabId}`);
  if (btn) btn.classList.add('active');

  // Update active panels
  document.querySelectorAll('.team-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  const panel = document.getElementById(`panel_${tabId}`);
  if (panel) panel.classList.add('active');
}

// --- INIT DATA ---
function initTeamHub() {
  renderSeats();
  renderWorkspace();
  renderAnalytics();
  renderBrandingInputs();
  renderApiKeys();
  renderTickets();
}

// --- MEMBER SEATS ---
function renderSeats() {
  const tbody = document.getElementById('membersTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';
  state.teamMembers.forEach(member => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="member-info">
          <div class="member-avatar">${member.name.split(' ').map(n => n[0]).join('')}</div>
          <div>
            <div class="member-name">${member.name}</div>
            <div style="font-size:0.75rem; color:var(--text3);">${member.email}</div>
          </div>
        </div>
      </td>
      <td><span class="badge ${member.role}">${member.role}</span></td>
      <td>${member.joined}</td>
      <td style="text-align: right;">
        <button class="btn-danger" onclick="removeTeamMember(${member.id})">Remove</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const countEl = document.getElementById('activeSeatsCount');
  if (countEl) countEl.textContent = `${state.teamMembers.length} / 10`;

  // Warning check
  const warning = document.getElementById('seatWarning');
  if (warning) {
    if (state.teamMembers.length >= 10) {
      warning.classList.add('show');
    } else {
      warning.classList.remove('show');
    }
  }
}

function addTeamMember(e) {
  e.preventDefault();
  if (state.teamMembers.length >= 10) {
    showToast('⚠ Seat limit reached! Your plan supports up to 10 seats.');
    return;
  }

  const email = document.getElementById('newMemberEmail').value.trim();
  const role = document.getElementById('newMemberRole').value;
  if (!email) return;

  const name = email.split('@')[0].split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const newMember = {
    id: Date.now(),
    name,
    email,
    role,
    joined: new Date().toISOString().split('T')[0]
  };

  state.teamMembers.push(newMember);
  localStorage.setItem('nexus_team_members', JSON.stringify(state.teamMembers));
  renderSeats();
  renderAnalytics();
  showToast(`✓ Added ${name} to team seats.`);
  document.getElementById('newMemberEmail').value = '';
}

// Remove member function
function removeTeamMember(id) {
  state.teamMembers = state.teamMembers.filter(m => m.id !== id);
  localStorage.setItem('nexus_team_members', JSON.stringify(state.teamMembers));
  renderSeats();
  renderAnalytics();
  showToast('✓ Member seat removed.');
}

// --- SHARED WORKSPACE ---
function renderWorkspace() {
  const tbody = document.getElementById('workspaceTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';
  state.teamDocuments.forEach(doc => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:1.25rem;">📄</span>
          <div style="font-weight:600; color:var(--text);">${doc.name}</div>
        </div>
      </td>
      <td>${doc.creator}</td>
      <td>${doc.size}</td>
      <td>${doc.date}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn-secondary" onclick="viewSharedDoc(${doc.id})" style="margin-right:0.4rem;">View</button>
        <button class="btn-secondary" onclick="downloadSharedDoc(${doc.id})" style="margin-right:0.4rem;">Download</button>
        <button class="btn-danger" onclick="removeSharedDoc(${doc.id})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const countEl = document.getElementById('workspaceDocCount');
  if (countEl) countEl.textContent = `${state.teamDocuments.length} Documents Shared`;
}

function shareToTeamWorkspace() {
  if (!state.output) {
    showToast('⚠ No output generated to share!');
    return;
  }

  const agent = AGENTS[state.currentAgent] || { title: 'AI Output' };
  const email = state.user?.email || 'admin@company.com';
  const sizeKb = Math.ceil(state.output.length / 1024);

  const newDoc = {
    id: Date.now(),
    name: `Team-${agent.title.replace(/\s+/g, '-')}-${Date.now().toString().slice(-4)}.txt`,
    creator: email,
    size: `${sizeKb} KB`,
    date: new Date().toISOString().split('T')[0],
    content: state.output
  };

  state.teamDocuments.push(newDoc);
  localStorage.setItem('nexus_team_docs', JSON.stringify(state.teamDocuments));
  showToast('🎉 Document shared to team workspace!');
  renderWorkspace();
}

function viewSharedDoc(id) {
  const doc = state.teamDocuments.find(d => d.id === id);
  if (!doc) return;

  // Render a preview modal
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.id = 'tempDocModal';
  modal.innerHTML = `
    <div class="modal-box" style="max-width: 600px;">
      <div class="modal-header-wrap">
        <button class="modal-close" onclick="document.getElementById('tempDocModal').remove()">✕</button>
        <div class="modal-header">
          <span class="modal-icon">📄</span>
          <div>
            <h3>${doc.name}</h3>
            <p>Shared by ${doc.creator} on ${doc.date}</p>
          </div>
        </div>
      </div>
      <div class="modal-scroll-body" style="padding: 1.5rem 2rem;">
        <pre style="white-space: pre-wrap; font-family: var(--font-mono); font-size:0.85rem; color:var(--text2); line-height: 1.6; background:var(--surface2); padding: 1.25rem; border-radius: var(--radius-sm); border:1px solid var(--border); overflow-y:auto; max-height: 350px;">${escapeHtml(doc.content)}</pre>
        <div style="margin-top:1.5rem; display:flex; justify-content:flex-end;">
          <button class="btn-primary" onclick="document.getElementById('tempDocModal').remove()">Close Preview</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function downloadSharedDoc(id) {
  const doc = state.teamDocuments.find(d => d.id === id);
  if (!doc) return;
  const blob = new Blob([doc.content], { type: 'text/plain' });
  downloadBlob(blob, doc.name);
  showToast('✓ File downloaded successfully.');
}

function removeSharedDoc(id) {
  state.teamDocuments = state.teamDocuments.filter(d => d.id !== id);
  localStorage.setItem('nexus_team_docs', JSON.stringify(state.teamDocuments));
  renderWorkspace();
  showToast('✓ Document deleted from team workspace.');
}

// --- USAGE ANALYTICS ---
function renderAnalytics() {
  const totalReqEl = document.getElementById('totalTeamRequests');
  if (totalReqEl) {
    totalReqEl.textContent = state.teamDocuments.length * 15 + 142;
  }

  // Requests by Agent Progress Bars
  const list = document.getElementById('analyticsProgressList');
  if (list) {
    list.innerHTML = '';
    const stats = [
      { name: 'Resume Writer', count: 48, percentage: 80 },
      { name: 'Trip Planner', count: 24, percentage: 40 },
      { name: 'Contract Explainer', count: 18, percentage: 30 },
      { name: 'Email Drafter', count: 12, percentage: 20 }
    ];

    stats.forEach(s => {
      const div = document.createElement('div');
      div.className = 'progress-item';
      div.innerHTML = `
        <div class="progress-info">
          <span class="progress-label">${s.name}</span>
          <span class="progress-value">${s.count} requests</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${s.percentage}%"></div>
        </div>
      `;
      list.appendChild(div);
    });
  }

  // Recent Activity Log
  const tbody = document.getElementById('activityTableBody');
  if (tbody) {
    tbody.innerHTML = '';
    const logs = [
      { user: 'alice@company.com', agent: 'Resume Writer', action: 'Exported PDF', time: '10 mins ago' },
      { user: 'bob@company.com', agent: 'Trip Planner', action: 'Generated Itinerary', time: '1 hour ago' },
      { user: 'charlie@company.com', agent: 'Contract Explainer', action: 'Viewed Analysis', time: '3 hours ago' }
    ];

    logs.forEach(l => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${l.user.split('@')[0]}</strong></td>
        <td>${l.agent}</td>
        <td><span style="color:var(--accent); font-weight:500;">${l.action}</span></td>
        <td style="color:var(--text3); font-size:0.8rem;">${l.time}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

// --- CUSTOM BRANDING ---
function renderBrandingInputs() {
  const branding = state.customBranding;
  if (!branding) return;

  const colorInput = document.getElementById('brandColorInput');
  if (colorInput) colorInput.value = branding.accentColor;
  
  const colorText = document.getElementById('brandColorText');
  if (colorText) colorText.textContent = branding.accentColor;

  const nameInput = document.getElementById('brandNameInput');
  if (nameInput) nameInput.value = branding.brandName;

  const iconSelect = document.getElementById('brandIconSelect');
  if (iconSelect) iconSelect.value = branding.brandIcon;

  // Sync previews
  const previewName = document.getElementById('previewBrandName');
  if (previewName) previewName.textContent = branding.brandName;
  const previewIcon = document.getElementById('previewBrandIcon');
  if (previewIcon) previewIcon.textContent = branding.brandIcon;
  
  // Attach live color listener
  if (colorInput) {
    colorInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (colorText) colorText.textContent = val;
      const previewIcon = document.getElementById('previewBrandIcon');
      if (previewIcon) previewIcon.style.color = val;
    });
  }
}

function saveCustomBranding(e) {
  e.preventDefault();
  const brandName = document.getElementById('brandNameInput').value.trim();
  const brandIcon = document.getElementById('brandIconSelect').value;
  const accentColor = document.getElementById('brandColorInput').value;

  state.customBranding = { brandName, brandIcon, accentColor };
  localStorage.setItem('nexus_custom_branding', JSON.stringify(state.customBranding));
  
  applyCustomBranding();
  showToast('🎉 Custom branding changes saved successfully!');
}

function resetCustomBranding() {
  state.customBranding = {
    brandName: 'NexusAI',
    brandIcon: '⬡',
    accentColor: '#4af0c8'
  };
  localStorage.setItem('nexus_custom_branding', JSON.stringify(state.customBranding));
  applyCustomBranding();
  renderBrandingInputs();
  showToast('✓ Branding reset to defaults.');
}

function applyCustomBranding() {
  const branding = state.customBranding;
  if (!branding) return;

  // Write colors to css variable
  document.documentElement.style.setProperty('--accent', branding.accentColor);
  document.documentElement.style.setProperty('--glow', `color-mix(in srgb, ${branding.accentColor} 15%, transparent)`);
  
  // Update brand names
  document.querySelectorAll('.brand-name').forEach(el => {
    el.textContent = branding.brandName;
  });

  // Update brand icons
  document.querySelectorAll('.brand-icon').forEach(el => {
    el.textContent = branding.brandIcon;
  });

  const label = document.getElementById('teamBrandLabel');
  if (label) label.textContent = `${branding.brandName} Team`;

  // Update sidebar branding header if elements exist
  const sidebarIcon = document.getElementById('teamBrandIcon');
  if (sidebarIcon) sidebarIcon.textContent = branding.brandIcon;
}

// --- DEVELOPER API ---
function renderApiKeys() {
  const tbody = document.getElementById('apiKeysTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';
  state.teamApiKeys.forEach(k => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${k.name}</strong></td>
      <td><code style="font-family:var(--font-mono); color:var(--accent2);">${k.key}</code></td>
      <td>${k.created}</td>
      <td style="text-align: right;">
        <button class="btn-danger" onclick="revokeApiKey(${k.id})">Revoke</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function generateApiKey() {
  const name = prompt('Enter a name for this API Key (e.g. staging_server):');
  if (name === null) return;
  const keyName = name.trim() || `key-${Date.now().toString().slice(-4)}`;

  const randomHex = Array.from({length: 16}, () => Math.floor(Math.random()*16).toString(16)).join('');
  const keyToken = `nx_live_${randomHex}`;

  const newKey = {
    id: Date.now(),
    name: keyName,
    key: keyToken,
    created: new Date().toISOString().split('T')[0]
  };

  state.teamApiKeys.push(newKey);
  localStorage.setItem('nexus_team_apikeys', JSON.stringify(state.teamApiKeys));
  renderApiKeys();
  showToast(`✓ Generated API Key "${keyName}".`);

  // Update code block example
  const block = document.getElementById('apiCodeBlock');
  if (block) {
    block.textContent = `curl http://localhost:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${keyToken}" \\
  -d '{
    "model": "deepseek/deepseek-v4-flash:free",
    "messages": [
      {"role": "system", "content": "You are a professional assistant."},
      {"role": "user", "content": "Write a professional email follow-up."}
    ],
    "stream": true
  }'`;
  }
}

function revokeApiKey(id) {
  state.teamApiKeys = state.teamApiKeys.filter(k => k.id !== id);
  localStorage.setItem('nexus_team_apikeys', JSON.stringify(state.teamApiKeys));
  renderApiKeys();
  showToast('✓ API Key revoked successfully.');
}

function copyApiCode() {
  const block = document.getElementById('apiCodeBlock');
  if (!block) return;
  navigator.clipboard.writeText(block.textContent).then(() => {
    showToast('✓ Code snippet copied to clipboard!');
  });
}

// --- PRIORITY SUPPORT ---
function renderTickets() {
  const history = document.getElementById('ticketsHistoryList');
  if (!history) return;

  history.innerHTML = '';
  if (state.teamTickets.length === 0) {
    history.innerHTML = `<div style="text-align:center; color:var(--text3); font-size:0.9rem; padding:2rem 0;">No support tickets submitted yet.</div>`;
    return;
  }

  state.teamTickets.forEach(t => {
    const item = document.createElement('div');
    item.className = 'ticket-item';
    item.innerHTML = `
      <div class="ticket-header">
        <span class="ticket-title">${t.subject}</span>
        <span class="ticket-status ${t.status}">${t.status}</span>
      </div>
      <p class="ticket-desc" style="margin-bottom:0.5rem;">${t.desc}</p>
      <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:var(--text3); font-family:var(--font-mono);">
        <span>Urgency: <strong style="color:var(--text); text-transform:uppercase;">${t.urgency}</strong></span>
        <span>${t.date}</span>
      </div>
    `;
    history.appendChild(item);
  });
}

function submitSupportTicket(e) {
  e.preventDefault();
  const subject = document.getElementById('ticketSubject').value.trim();
  const desc = document.getElementById('ticketDesc').value.trim();
  const urgency = document.getElementById('ticketUrgency').value;

  if (!subject || !desc) return;

  const newTicket = {
    id: Date.now(),
    subject,
    desc,
    urgency,
    status: 'pending',
    date: new Date().toISOString().split('T')[0]
  };

  state.teamTickets.unshift(newTicket);
  localStorage.setItem('nexus_team_tickets', JSON.stringify(state.teamTickets));
  renderTickets();
  showToast('✓ Support ticket submitted successfully!');

  document.getElementById('ticketSubject').value = '';
  document.getElementById('ticketDesc').value = '';

  // Simulate auto-resolution reply from support team after 15 seconds (for verify/demo)
  setTimeout(() => {
    const t = state.teamTickets.find(tick => tick.id === newTicket.id);
    if (t) {
      t.status = 'resolved';
      localStorage.setItem('nexus_team_tickets', JSON.stringify(state.teamTickets));
      renderTickets();
      showToast(`💬 Priority Support: Ticket "${subject.substring(0, 15)}..." was marked as Resolved.`);
    }
  }, 15000);
}
