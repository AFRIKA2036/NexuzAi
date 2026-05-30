// admin/js/admin.js

const config = window.NEXUZ_SUPABASE_CONFIG;
const sb = supabase.createClient(config.url, config.anonKey);

const overlay = document.getElementById('login-overlay');
const authStatus = document.getElementById('auth-status');
const loginBtn = document.getElementById('login-btn');
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menu-toggle');

let growthChart = null;

async function checkAdmin() {
    try {
        const { data: { session }, error } = await sb.auth.getSession();
        
        if (error || !session) {
            showLogin();
            return;
        }

        const isAdmin = session.user.app_metadata?.is_admin;
        
        if (isAdmin) {
            overlay.style.display = 'none';
            initDashboard();
        } else {
            authStatus.innerText = "Access Denied: You do not have administrator privileges.";
            authStatus.style.color = "#ef4444";
            loginBtn.innerText = "Switch Account";
            loginBtn.style.display = 'block';
            loginBtn.onclick = async () => {
                await sb.auth.signOut();
                window.location.href = '../index.html';
            };
        }
    } catch (err) {
        authStatus.innerText = "Error verifying admin status.";
        console.error(err);
    }
}

function showLogin() {
    authStatus.innerText = "Please login to access the admin panel.";
    loginBtn.style.display = 'block';
    loginBtn.onclick = () => {
        window.location.href = '../index.html'; 
    };
}

function initDashboard() {
    loadDashboard();
    
    // Setup listeners
    document.getElementById('refresh-btn').onclick = loadDashboard;
    
    menuToggle.onclick = () => {
        sidebar.classList.toggle('open');
    };

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && 
            !sidebar.contains(e.target) && 
            e.target !== menuToggle) {
            sidebar.classList.remove('open');
        }
    });
}

async function loadDashboard() {
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.disabled = true;
    refreshBtn.innerText = 'Refreshing...';

    try {
        // 1. Fetch Basic Stats
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

        // 2. Fetch Growth Data (Last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const { data: growthData } = await sb
            .from('profiles')
            .select('created_at')
            .gte('created_at', sevenDaysAgo.toISOString());

        if (growthData) {
            renderGrowthChart(growthData);
        }

        // 3. Fetch Recent Activity
        const { data: recentGens, error: activityError } = await sb
            .from('generations')
            .select('created_at, agent_id, prompt, profiles(email)')
            .order('created_at', { ascending: false })
            .limit(10);

        const tbody = document.querySelector('#activity-table tbody');
        if (activityError) {
            tbody.innerHTML = `<tr><td colspan="4" style="color: red; text-align: center;">Error loading activity: ${activityError.message}</td></tr>`;
        } else {
            tbody.innerHTML = recentGens?.map(gen => `
                <tr>
                    <td><span style="font-weight: 600;">${gen.profiles?.email || 'Unknown'}</span></td>
                    <td><code style="background: #f1f5f9; padding: 0.2rem 0.4rem; border-radius: 4px;">${gen.agent_id}</code></td>
                    <td title="${gen.prompt.replace(/"/g, '&quot;')}">${gen.prompt.substring(0, 50)}${gen.prompt.length > 50 ? '...' : ''}</td>
                    <td style="color: #64748b; font-size: 0.875rem;">${new Date(gen.created_at).toLocaleString()}</td>
                </tr>
            `).join('') || '<tr><td colspan="4" style="text-align: center; padding: 2rem;">No recent activity</td></tr>';
        }
    } catch (err) {
        console.error("Dashboard load error:", err);
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerText = 'Refresh Data';
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

    if (growthChart) {
        growthChart.destroy();
    }

    growthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'New Signups',
                data: values,
                borderColor: '#2563eb',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                backgroundColor: 'rgba(37, 99, 235, 0.05)',
                pointBackgroundColor: '#2563eb',
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    ticks: { stepSize: 1, color: '#64748b' },
                    grid: { color: '#f1f5f9' }
                },
                x: {
                    ticks: { color: '#64748b' },
                    grid: { display: false }
                }
            }
        }
    });
}

document.getElementById('logout-btn').onclick = async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = '../index.html';
};

checkAdmin();
