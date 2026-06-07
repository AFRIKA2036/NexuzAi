# ⬡ NexuzAI — AI Agent Hub

A futuristic, portable web application featuring 8 specialized AI agents powered by the Anthropic Claude API.

---

## 🚀 Quick Start

1. **Download** the project folder
2. **Open** `index.html` in any modern browser
3. The app runs immediately in **demo mode** (no setup needed)

---

## 🤖 AI Agents Included

| Agent | Tier | Description |
|---|---|---|
| 📄 Resume Writer | FREE | ATS-friendly resume from your CV + job description |
| ✉️ Email Drafter | FREE | Professional emails for any situation |
| 📚 Study Note Converter | FREE | Transform text into structured study notes |
| 💼 Cover Letter Writer | FREE | Tailored cover letters for job applications |
| 📋 Contract Explainer | PRO | Plain-English breakdown of legal documents |
| ✈️ Trip Planner | PRO | Full day-by-day travel itineraries |
| 🎉 Event Planner | PRO | Complete event planning with checklist & budget |
| 🔍 LinkedIn Optimizer | PRO | Profile rewrite for maximum recruiter visibility |

---

## 💳 Pricing Plans

| Plan | Price | Features |
|---|---|---|
| **Starter** | Free | 4 free agents, 20 requests/day |
| **Pro** | $9/month | All 8 agents, unlimited requests, PDF/DOCX export |
| **Team** | $29/month | Everything in Pro, 10 seats, admin dashboard |

---

## 🚀 New: Gemma 4 Offline Mode (May 2026)

NexuzAI now supports **fully offline inference** using Google's **Gemma 4 31B IT** model.

### Setup Instructions

1. **Start the Local Server:**
   ```bash
   python server/local_server.py
   ```
   This starts a local API at `http://localhost:8000` that mimics the Gemma 4 Agentic Engine.

2. **Download the Model (Optional):**
   If you have a GGUF runner (like LM Studio or llama.cpp), you can download the full 18GB model:
   ```bash
   python server/download_model.py
   ```

3. **Enable Offline Mode:**
   Open NexuzAI in your browser and toggle the **"Offline Mode"** switch in the navigation bar.

---

## 🔑 Enabling Real AI (Optional)

Do not put AI provider keys in browser JavaScript. The browser should only contain the Supabase project URL, Supabase anon public key, and the deployed AI function URL in `js/supabase-config.js`.

Use one of the server-side paths:

- Supabase Edge Function: store `OPENROUTER_API_KEY`, `APP_URL`, and `ALLOWED_ORIGINS` with `supabase secrets set`.
- Local FastAPI proxy: store provider and Supabase secrets in an uncommitted `server/.env` file.
- CI/CD: store deploy-time values in GitHub Actions Secrets or the hosting platform secret manager.

## 💳 Payment Integration (Paystack)

NexuzAI uses **Paystack** for secure payments, supporting both **Cards** and **Mobile Money** (MTN, Vodafone, Airteltigo).

To enable payments:
1. Create a [Paystack](https://paystack.com) account.
2. Add your **Public Key** to `js/supabase-config.js`.
3. Set your **Secret Key** in Supabase Edge Functions:
   ```bash
   supabase secrets set PAYSTACK_SECRET_KEY=sk_live_...
   ```
4. Deploy the payment functions:
   ```bash
   supabase functions deploy paystack-initialize --project-ref YOUR_PROJECT_REF
   supabase functions deploy paystack-verify --project-ref YOUR_PROJECT_REF
   ```
   If you use Paystack webhooks, deploy the webhook without JWT verification:
   ```bash
   supabase functions deploy paystack-webhook --no-verify-jwt --project-ref YOUR_PROJECT_REF
   ```

> ⚠️ **Security Note**: For production use, move the API call to a backend server to keep your API key private. Never expose API keys in client-side code for public-facing apps.

---

## 🛡️ Backend API Proxy (Production)

Production AI generation should go through `supabase/functions/ai-generate`. Configure exact CORS origins before deploy:

```bash
supabase secrets set APP_URL=https://your-app.example
supabase secrets set ALLOWED_ORIGINS=https://your-app.example
supabase secrets set OPENROUTER_API_KEY=your-provider-key
supabase functions deploy ai-generate --project-ref YOUR_PROJECT_REF
```

The browser config can omit `aiFunctionUrl`; when Supabase is configured, the app derives it as
`<SUPABASE_URL>/functions/v1/ai-generate`. To override the task-generation model pool, set a
comma-separated `OPENROUTER_MODEL_FALLBACKS` secret or local environment variable.

The local FastAPI proxy in `server/local_server.py` is for development and private offline mode. It requires Supabase JWT auth by default and uses the Supabase usage RPC when configured:

```text
LOCAL_PROXY_REQUIRE_AUTH=true
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ALLOWED_ORIGINS=http://127.0.0.1:5600
```

## Admin Dashboard

The admin dashboard uses Supabase Auth plus the `admin-dashboard` Edge Function
so service-role access stays server-side.

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key --project-ref YOUR_PROJECT_REF
supabase functions deploy admin-dashboard --project-ref YOUR_PROJECT_REF
```

Give an Auth user admin access from Supabase SQL Editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
where email = 'admin@nexuzai.io';
```

Then sign in at `/admin/index.html` with that user's email and password. Magic
link login is still available as a fallback.

---

## 📁 Project Structure

```
ai-agents-app/
├── index.html          # Main HTML
├── README.md           # This file
├── css/
│   └── style.css       # All styles (futuristic dark theme)
└── js/
    ├── agents.js       # Agent definitions & prompts
    └── app.js          # App logic, API calls, payment
```

---

## 🎨 Tech Stack

- **
** — no frameworks, no build step
- **Google Fonts** — Syne, DM Mono, Instrument Sans
- **Anthropic Claude API** — AI generation backbone
- **LocalStorage** — session persistence (no backend required)

---

## 🌐 Deployment

Works on any static hosting:
- **Locally**: Just open `index.html`
- **GitHub Pages**: Push to repo → enable Pages
- **Netlify**: Drag & drop the folder
- **Vercel**: Import from GitHub

---

---

## 📬 Contact

For support, inquiries, or more information:
- **Email:** [oheneamoabeng2035@gmail.com](mailto:oheneamoabeng2035@gmail.com)
- **WhatsApp:** [+233-540-556-225](https://wa.me/233540556225) / [+233-200-802-850](https://wa.me/233200802850)

Built with ❤️ using NexuzAI
