# NexuzAI Deployment Guide

Complete step-by-step guide to deploy NexuzAI to production.

---

## 📋 Prerequisites

- GitHub account (repository: `AFRIKA2036/NexuzAi`)
- Supabase account
- Vercel account
- Paystack account (for payments in Ghana/GHS)
- OpenRouter account (for AI models)
- Domain name (optional but recommended)

---

## 1️⃣ Supabase Setup

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Organization: Select or create
3. Project name: `nexuzai` (or your preference)
4. Database password: **Save this!** You'll need it for `SUPABASE_DB_PASSWORD`
5. Region: Choose closest to your users
6. Wait for project to be ready (~2 minutes)

### 1.2 Get Project Credentials

Go to **Settings → API**:

| Setting | Value | Used As |
|---------|-------|---------|
| Project URL | `https://<ref>.supabase.co` | `SUPABASE_URL` |
| `anon` public key | `eyJ...` | `SUPABASE_ANON_KEY` |
| `service_role` secret key | `eyJ...` | `SUPABASE_SERVICE_ROLE_KEY` |

Go to **Settings → API → JWT Settings**:
- **JWT Secret**: Copy this → `SUPABASE_JWT_SECRET`

### 1.3 Run Database Migrations

**Option A: Via Supabase Dashboard (Recommended for first time)**
1. Go to **SQL Editor** → New Query
2. Copy contents of `supabase/schema.sql` and run
3. Verify tables created: `profiles`, `teams`, `team_members`, `generations`, `exports`, `usage_daily`

**Option B: Via CLI (for CI/CD)**
```bash
# Local machine
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
npx supabase db push
```

### 1.4 Configure Edge Function Secrets

Go to **Edge Functions → Secrets** (or use CLI):

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | From OpenRouter dashboard |
| `PAYSTACK_SECRET_KEY` | `sk_live_...` or `sk_test_...` | From Paystack dashboard |
| `SUPABASE_JWT_SECRET` | (from 1.2) | For JWT verification |
| `SUPABASE_SERVICE_ROLE_KEY` | (from 1.2) | Admin operations |
| `APP_URL` | `https://your-app.vercel.app` | CORS origin |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app,http://localhost:3000` | CORS origins |
| `OPENROUTER_MODEL_FALLBACKS` | `nvidia/nemotron-3-super-120b-a12b:free,openai/gpt-4o-mini` | Comma-separated |
| `FREE_DAILY_LIMIT` | `20` | Free tier daily requests |

**Via CLI:**
```bash
npx supabase secrets set OPENROUTER_API_KEY=sk-or-v1-... \
  PAYSTACK_SECRET_KEY=sk_live_... \
  SUPABASE_JWT_SECRET=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  APP_URL=https://your-app.vercel.app \
  ALLOWED_ORIGINS="https://your-app.vercel.app,http://localhost:3000" \
  OPENROUTER_MODEL_FALLBACKS="nvidia/nemotron-3-super-120b-a12b:free,openai/gpt-4o-mini" \
  FREE_DAILY_LIMIT=20
```

### 1.5 Deploy Edge Functions

```bash
# Deploy all functions
npx supabase functions deploy \
  ai-generate \
  admin-dashboard \
  paystack-initialize \
  paystack-verify \
  paystack-webhook \
  --project-ref <YOUR_PROJECT_REF> \
  --no-verify-jwt \
  --use-api

# Deploy protected functions (require auth)
npx supabase functions deploy \
  admin-dashboard \
  paystack-initialize \
  paystack-verify \
  --project-ref <YOUR_PROJECT_REF> \
  --use-api
```

---

## 2️⃣ Paystack Setup

### 2.1 Create Paystack Account

1. Sign up at [paystack.com](https://paystack.com)
2. Complete business verification (required for live mode)
3. Go to **Settings → API Keys & Webhooks**

### 2.2 Get API Keys

| Key | Value | Used As |
|-----|-------|---------|
| Public Key | `pk_live_...` or `pk_test_...` | `PAYSTACK_PUBLIC_KEY` (frontend) |
| Secret Key | `sk_live_...` or `sk_test_...` | `PAYSTACK_SECRET_KEY` (Edge Functions) |

### 2.3 Configure Webhook

1. Go to **Settings → API Keys & Webhooks → Webhook URL**
2. Add URL: `https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/paystack-webhook`
3. Select events: `charge.success`, `subscription.create`, `subscription.enable`, `subscription.disable`
4. Save

### 2.4 Create Plans (Optional - for subscriptions)

1. Go to **Products → Plans → Create Plan**
2. Create two plans:
   - **Pro**: ₵105.86/month (10586 kobo) → Plan code: `pro_monthly`
   - **Team**: ₵341.09/month (34109 kobo) → Plan code: `team_monthly`
3. Note the plan codes for webhook mapping

---

## 3️⃣ OpenRouter Setup

### 3.1 Create Account & Get API Key

1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Go to **Keys → Create Key**
3. Name: `NexuzAI Production`
4. Copy key → `OPENROUTER_API_KEY` (set in Supabase secrets, step 1.4)

### 3.2 Configure Models

Recommended free models for fallback chain:
```
nvidia/nemotron-3-super-120b-a12b:free
meta-llama/llama-3.1-8b-instruct:free
google/gemma-2-9b-it:free
microsoft/phi-3-medium-128k-instruct:free
```

Set as `OPENROUTER_MODEL_FALLBACKS` in Supabase secrets (comma-separated).

---

## 4️⃣ Vercel Deployment

### 4.1 Import Repository

1. Go to [vercel.com](https://vercel.com) → Add New Project
2. Import `AFRIKA2036/NexuzAi`
3. Framework Preset: **Other** (static site)
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Install Command: `npm ci`

### 4.2 Configure Environment Variables

Go to **Settings → Environment Variables** and add:

| Name | Value | Environment |
|------|-------|-------------|
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Production, Preview, Development |
| `SUPABASE_ANON_KEY` | `eyJ...` | Production, Preview, Development |
| `AI_FUNCTION_URL` | `https://<ref>.supabase.co/functions/v1/ai-generate` | Production, Preview, Development |
| `PAYSTACK_PUBLIC_KEY` | `pk_live_...` | Production, Preview |

### 4.3 Deploy

Click **Deploy**. Vercel will:
1. Run `npm ci`
2. Run `npm run build` (injects env vars into `dist/js/supabase-config.js`)
3. Deploy static files to CDN

### 4.4 Custom Domain (Optional)

1. Go to **Settings → Domains**
2. Add your domain (e.g., `nexuzai.com`)
3. Configure DNS records as instructed
4. SSL auto-provisions

---

## 5️⃣ GitHub Secrets (for CI/CD)

Go to **Repository → Settings → Secrets and variables → Actions** and add:

| Secret Name | Value | Description |
|-------------|-------|-------------|
| `SUPABASE_ACCESS_TOKEN` | `sbp_...` | From Supabase Dashboard → Access Tokens |
| `SUPABASE_DB_PASSWORD` | (from 1.1) | Database password for migrations |
| `SUPABASE_PROJECT_ID` | `<ref>` | Already in workflow (onanhpeqttqdruruemwr) |

### 5.1 Create Supabase Access Token

1. Go to [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
2. Generate token → name: `GitHub Actions CI/CD`
3. Copy token → `SUPABASE_ACCESS_TOKEN`

---

## 6️⃣ Local Development Setup

### 6.1 Clone & Install

```bash
git clone https://github.com/AFRIKA2036/NexuzAi.git
cd NexuzAi
npm ci
```

### 6.2 Create `.env` (from `.env.example`)

```bash
cp .env.example .env
# Edit .env with your local/test credentials
```

### 6.3 Start Local Proxy (for local LLM mode)

```bash
# Option A: Python directly (requires llama-cpp-python + model file)
cd server
pip install -r requirements.txt
python local_server.py

# Option B: Docker (recommended)
docker-compose up --build
```

### 6.4 Start Frontend Dev Server

```bash
# Using any static server
npx serve dist
# or
python -m http.server 3000 -d dist
```

Open `http://localhost:3000`

---

## 7️⃣ Admin Dashboard Access

### 7.1 Promote User to Admin

After first user signs up, promote them via Supabase Dashboard:

1. Go to **Authentication → Users**
2. Find user → click → **Metadata**
3. Add: `{"is_admin": true}` to `app_metadata`
4. Save

### 7.2 Access Admin Dashboard

1. Go to `https://your-app.vercel.app/admin/`
2. Sign in with admin account
3. Dashboard loads with metrics

### 7.3 CLI Alternative (if configured)

```bash
# Promote user via Supabase CLI
supabase functions invoke admin-promote \
  --body '{"email": "admin@example.com"}' \
  --project-ref <YOUR_PROJECT_REF>
```

---

## 8️⃣ Post-Deployment Verification

### 8.1 Smoke Test Checklist

- [ ] Homepage loads at `https://your-app.vercel.app`
- [ ] Supabase config injected (check browser console: `window.NEXUZ_SUPABASE_CONFIG`)
- [ ] Sign up new account → verify email → login works
- [ ] Free agent (Resume/Email/Notes) generates output
- [ ] Pricing page shows plans
- [ ] Paystack payment flow: Pro → redirect → verify → plan updates
- [ ] Admin dashboard accessible at `/admin/` with admin account
- [ ] Team Hub: create team, invite member, share generation

### 8.2 Health Checks

```bash
# Local proxy health
curl http://localhost:8000/health

# Edge Function health (ai-generate)
curl -X POST https://<ref>.supabase.co/functions/v1/ai-generate \
  -H "Authorization: Bearer <anon_key>" \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"email","messages":[{"role":"user","content":"test"}]}'
```

---

## 9️⃣ Monitoring & Maintenance

### 9.1 Logs

- **Edge Functions**: Supabase Dashboard → Edge Functions → Logs
- **Database**: Supabase Dashboard → Logs → Postgres
- **Frontend**: Vercel Dashboard → Functions → Logs
- **Paystack**: Paystack Dashboard → Transactions

### 9.2 Recommended: Logflare / Axiom

For production, connect Supabase logs to [Logflare](https://logflare.app) or [Axiom](https://axiom.co):

1. Create account
2. Add Supabase source
3. Get ingest endpoint + API key
4. Set as `LOGFLARE_API_KEY` / `AXIOM_TOKEN` in Supabase secrets

### 9.3 Database Backups

Supabase automatically backs up daily. For point-in-time recovery:
- Go to **Database → Backups**
- Configure retention (7 days free, 30 days Pro)

### 9.4 Updating

```bash
# Push to main → triggers CI/CD
git add .
git commit -m "feat: description"
git push origin main
```

GitHub Actions will:
1. Run tests
2. Build frontend
3. Deploy Edge Functions
4. Push migrations (if `SUPABASE_DB_PASSWORD` set)

---

## 🔐 Security Checklist

- [ ] All secrets in Supabase Vault / GitHub Secrets / Vercel Env (never in code)
- [ ] `SUPABASE_JWT_SECRET` rotated periodically
- [ ] Paystack webhook signature verified (already implemented)
- [ ] CORS origins restricted to your domains
- [ ] CSP headers configured (in `vercel.json` and Edge Functions)
- [ ] Rate limiting active (daily usage + IP-based on local proxy)
- [ ] Admin access limited to trusted emails
- [ ] HTTPS enforced (Vercel + Supabase auto-HTTPS)

---

## 🆘 Troubleshooting

### Edge Function Timeout (30s limit on Hobby plan)

If generations fail with timeout:
1. Upgrade Supabase to Pro (60s limit)
2. Or implement async pattern (return job ID, poll for result)
3. Or reduce `max_tokens` in request

### Migration Fails in CI

```bash
# Check migration status locally
npx supabase migration list --project-ref <ref>

# Repair if needed
npx supabase migration repair --project-ref <ref>
```

### Paystack Webhook Not Firing

1. Verify webhook URL in Paystack dashboard
2. Check Supabase Edge Function logs for `paystack-webhook`
3. Ensure `PAYSTACK_SECRET_KEY` matches in Supabase secrets
4. Test with Paystack "Send Test Event" button

### CORS Errors

1. Check `ALLOWED_ORIGINS` in Supabase secrets includes your Vercel URL
2. Verify `APP_URL` matches
3. Check browser console for exact origin being sent

---

## 📞 Support

- Supabase Discord: [discord.supabase.com](https://discord.supabase.com)
- Paystack Support: [paystack.com/support](https://paystack.com/support)
- OpenRouter Discord: [discord.gg/openrouter](https://discord.gg/openrouter)
- Vercel Support: [vercel.com/support](https://vercel.com/support)

---

**Last Updated**: June 2025
**Version**: 1.0.0