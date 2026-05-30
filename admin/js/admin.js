// admin/js/admin.js

const config = window.NEXUZ_SUPABASE_CONFIG;
// Use a different name for the client to avoid shadowing the global 'supabase' library
const sb = supabase.createClient(config.url, config.anonKey);

const overlay = document.getElementById('login-overlay');
const authStatus = document.getElementById('auth-status');
const loginBtn = document.getElementById('login-btn');

async function checkAdmin() {
    const { data: { session }, error } = await sb.auth.getSession();
    
    if (error || !session) {
        showLogin();
        return;
    }

    // Check custom claim in JWT
    const isAdmin = session.user.app_metadata?.is_admin;
    
    if (isAdmin) {
        overlay.style.display = 'none';
        loadDashboard();
    } else {
        authStatus.innerText = "Access Denied: You are not an admin.";
        authStatus.style.color = "red";
    }
}

function showLogin() {
    authStatus.innerText = "Please login to continue.";
    loginBtn.style.display = 'block';
    loginBtn.onclick = () => {
        window.location.href = '../index.html'; 
    };
}

async function loadDashboard() {
    // 1. Fetch Stats
    const { count: userCount } = await sb.from('profiles').select('*', { count: 'exact', head: true });
    const { count: genCount } = await sb.from('generations').select('*', { count: 'exact', head: true });
    
    document.getElementById('total-users').innerText = userCount || 0;
    document.getElementById('total-gens').innerText = genCount || 0;

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
    const { data: recentGens } = await sb
        .from('generations')
        .select('created_at, agent_id, prompt, profiles(email)')
        .order('created_at', { ascending: false })
        .limit(10);

    const tbody = document.querySelector('#activity-table tbody');
    tbody.innerHTML = recentGens?.map(gen => `
        <tr>
            <td>${gen.profiles?.email || 'Unknown'}</td>
            <td>${gen.agent_id}</td>
            <td>${gen.prompt.substring(0, 50)}...</td>
            <td>${new Date(gen.created_at).toLocaleString()}</td>
        </tr>
    `).join('') || '<tr><td colspan="4">No recent activity</td></tr>';
}

function renderGrowthChart(data) {
    const ctx = document.getElementById('signupChart').getContext('2d');
    
    // Group by date
    const counts = {};
    data.forEach(row => {
        const date = new Date(row.created_at).toLocaleDateString();
        counts[date] = (counts[date] || 0) + 1;
    });

    // Ensure all last 7 days are represented
    const labels = [];
    const values = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateLabel = d.toLocaleDateString();
        labels.push(dateLabel);
        values.push(counts[dateLabel] || 0);
    }

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'New Signups',
                data: values,
                borderColor: '#2563eb',
                tension: 0.3,
                fill: true,
                backgroundColor: 'rgba(37, 99, 235, 0.1)'
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });
}

document.getElementById('logout-btn').onclick = async () => {
    await sb.auth.signOut();
    window.location.reload();
};

checkAdmin();
