// admin/js/admin.js

const config = window.NEXUZ_SUPABASE_CONFIG;
const sb = supabase.createClient(config.url, config.anonKey);

const overlay = document.getElementById('login-overlay');
const authStatus = document.getElementById('auth-status');
const authForm = document.getElementById('auth-form');
const portalTitle = document.getElementById('portal-title');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authTimer = document.getElementById('auth-timer');
const timerSeconds = document.getElementById('timer-seconds');
const sidebar = document.getElementById('sidebar');

let cooldownInterval = null;

async function checkAdmin() {
    try {
        const { data: { session }, error } = await sb.auth.getSession();
        
        // If already logged in, check admin status immediately
        if (session) {
            const isAdmin = session.user.app_metadata?.is_admin;
            if (isAdmin) {
                overlay.style.display = 'none';
                initDashboard();
                return;
            } else {
                authStatus.innerText = "ACCESS DENIED: Non-Admin Account.";
                authStatus.style.color = "#ef4444";
                authSubmitBtn.innerText = "Try Different Account";
                authForm.onsubmit = async (e) => {
                    e.preventDefault();
                    await sb.auth.signOut();
                    window.location.reload();
                };
                return;
            }
        }
    } catch (err) {
        console.error(err);
    }
}

function startCooldown(seconds) {
    if (cooldownInterval) clearInterval(cooldownInterval);
    authTimer.style.display = 'block';
    authSubmitBtn.disabled = true;
    let remaining = seconds;
    
    timerSeconds.innerText = remaining;
    
    cooldownInterval = setInterval(() => {
        remaining--;
        timerSeconds.innerText = remaining;
        if (remaining <= 0) {
            clearInterval(cooldownInterval);
            authTimer.style.display = 'none';
            authSubmitBtn.disabled = false;
            authSubmitBtn.innerText = "Resend Access Link";
        }
    }, 1000);
}

authForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    
    authSubmitBtn.disabled = true;
    authSubmitBtn.innerText = 'Transmitting Link...';
    
    try {
        const { error } = await sb.auth.signInWithOtp({
            email: email,
            options: {
                emailRedirectTo: window.location.href
            }
        });
        
        if (error) {
            // Check for rate limit error
            if (error.message.includes('seconds')) {
                const seconds = parseInt(error.message.match(/\d+/)[0]);
                authStatus.innerText = "Security cooldown active.";
                authStatus.style.color = "#f0a84a";
                startCooldown(seconds);
                return;
            }
            throw error;
        }
        
        authStatus.innerText = "Link Transmitted! Check your email to enter the Nexuz.";
        authStatus.style.color = "#4af0c8";
        authSubmitBtn.innerText = "Link Sent";
        startCooldown(60); // Standard 60s cooldown for next try
        
    } catch (err) {
        authStatus.innerText = "ERROR: " + err.message;
        authStatus.style.color = "#ef4444";
        authSubmitBtn.disabled = false;
        authSubmitBtn.innerText = "Resend Link";
    }
};

function initDashboard() {
    loadDashboard();
    
    document.getElementById('refresh-btn').onclick = loadDashboard;
    
    if (menuToggle) {
        menuToggle.onclick = () => {
            sidebar.classList.toggle('open');
        };
    }

    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 1024 && 
            !sidebar.contains(e.target) && 
            e.target !== menuToggle) {
            sidebar.classList.remove('open');
        }
    });
}

async function loadDashboard() {
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.disabled = true;
    refreshBtn.innerText = 'Syncing...';

    try {
        const [usersRes, gensRes, activeRes] = await Promise.all([
            sb.from('profiles').select('*', { count: 'exact', head: true }),
            sb.from('generations').select('*', { count: 'exact', head: true }),
            sb.from('usage_daily')
                .select('user_id', { count: 'exact', head: true })
                .eq('usage_date', new Date().toISOString().split('T')[0])
        ]);
        
        document.getElementById('total-users').innerText = usersRes.count || 0;
        document.getElementById('total-gens').innerText = gensRes.count || 0;
        document.getElementById('active-today').innerText = activeRes.count || 0;

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const { data: growthData } = await sb.from('profiles').select('created_at').gte('created_at', sevenDaysAgo.toISOString());

        if (growthData) renderGrowthChart(growthData);

        const { data: recentGens } = await sb
            .from('generations')
            .select('created_at, agent_id, prompt, profiles(email)')
            .order('created_at', { ascending: false })
            .limit(10);

        const tbody = document.querySelector('#activity-table tbody');
        tbody.innerHTML = recentGens?.map(gen => `
            <tr>
                <td><span style="font-weight: 600; color: var(--primary);">${gen.profiles?.email || 'Unknown'}</span></td>
                <td><code style="background: rgba(37,99,235,0.1); color: #fff; padding: 0.2rem 0.5rem; border-radius: 6px; border: 1px solid rgba(37,99,235,0.2); font-family: 'DM Mono';">${gen.agent_id}</code></td>
                <td>${gen.prompt.substring(0, 60)}...</td>
                <td style="color: #64748b; font-size: 0.8rem;">${new Date(gen.created_at).toLocaleString()}</td>
            </tr>
        `).join('') || '<tr><td colspan="4" style="text-align: center; padding: 4rem;">Signal Lost: No recent activity.</td></tr>';
        
    } catch (err) {
        console.error(err);
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerText = 'Update Stream';
    }
}

function renderGrowthChart(data) {
    const ctx = document.getElementById('signupChart').getContext('2d');
    const counts = {};
    data.forEach(row => {
        const date = new Date(row.created_at).toLocaleDateString();
        counts[date] = (counts[date] || 0) + 1;
    });

    const labels = [];
    const values = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateLabel = d.toLocaleDateString();
        labels.push(dateLabel);
        values.push(counts[dateLabel] || 0);
    }

    if (growthChart) growthChart.destroy();

    growthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Signups',
                data: values,
                borderColor: '#2563eb',
                borderWidth: 4,
                pointRadius: 6,
                pointBackgroundColor: '#2563eb',
                tension: 0.4,
                fill: true,
                backgroundColor: (context) => {
                    const chart = context.chart;
                    const {ctx, chartArea} = chart;
                    if (!chartArea) return null;
                    const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
                    gradient.addColorStop(0, 'transparent');
                    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.2)');
                    return gradient;
                }
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

document.getElementById('logout-btn').onclick = async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.reload();
};

checkAdmin();
