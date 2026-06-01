# Supabase Setup

This project now has a Supabase-ready path for real users, plans, generation history, and future file storage.

## 1. Do Not Commit Secrets

The browser can only contain:

- Supabase project URL
- Supabase anon public key

Never place these in `js/supabase-config.js`:

- database password
- `service_role` key
- Stripe secret key
- AI provider API keys
- local proxy `SUPABASE_JWT_SECRET`

If a secret was pasted into chat or committed somewhere, rotate it in Supabase.

Store server-side secrets in the hosting platform secret manager. For this project:

- Supabase Edge Functions: use `supabase secrets set OPENROUTER_API_KEY=... DEFAULT_AI_MODEL=... APP_URL=... ALLOWED_ORIGINS=...`
- Local/FastAPI proxy: use a local `.env` file that is never committed.
- CI/CD: use GitHub Actions Secrets for deploy-time values only.
- Supabase database-side secrets, when needed later, should use Supabase Vault.

## 2. Create Tables

Open Supabase Dashboard, then run:

```sql
-- Paste supabase/schema.sql into SQL Editor and run it.
```

This creates:

- `profiles`
- `generations`
- `exports`
- `usage_daily`
- private `exports` Storage bucket

It also enables row level security so users only read and write their own records.

## 3. Configure The App

Open `js/supabase-config.js` and fill:

```js
window.NEXUZ_SUPABASE_CONFIG = {
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  anonKey: 'YOUR_SUPABASE_ANON_PUBLIC_KEY',
  aiFunctionUrl: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/ai-generate'
};
```

The app will then:

- use Supabase email/password auth from the existing login modal
- support Google, GitHub, and Facebook sign-in after those providers are enabled
- create a profile row on signup
- load the user's plan from `profiles.plan`
- save generated outputs into `generations`
- send the Supabase JWT to the backend proxy as `Authorization: Bearer ...`

## 4. Enable Social Sign-In

In Supabase Dashboard, open **Authentication > Providers** and enable:

- Google
- GitHub
- Facebook

Each provider requires its own client ID and client secret from that provider's developer console.

Add your app URL under **Authentication > URL Configuration**:

```text
http://127.0.0.1:5600/index.html
```

For production, also add your deployed domain.

## 5. Backend Flow

Both backend paths should treat the browser as untrusted. The Supabase Edge Function already validates the Supabase JWT and enforces usage with the database RPC. The FastAPI local proxy now requires a verified Supabase JWT by default and falls back to insecure header mode only when `LOCAL_PROXY_REQUIRE_AUTH=false` is set for local development.

Recommended production flow:

1. Frontend signs in with Supabase Auth.
2. Frontend sends `Authorization: Bearer <supabase_access_token>` to the AI endpoint.
3. Backend validates the JWT against Supabase.
4. Backend reads `profiles.plan`.
5. Backend calls `consume_daily_usage`, which increments `usage_daily` atomically.
6. Backend calls the AI provider.
7. Backend stores the generation and optional export metadata.

The `consume_daily_usage` database function is important for concurrency. It prevents two simultaneous requests from the same free user from both reading the same old usage count and bypassing the daily limit.

## 6. Security And Load Readiness

The app should use Supabase Edge Functions for production AI generation, not the local FastAPI demo server.

Security controls now expected in production:

- Supabase JWT required for generation.
- `ALLOWED_ORIGINS` set to exact deployed origins; the Edge Function rejects requests when origins are missing or unlisted.
- User plan loaded server-side from `profiles`.
- Free usage limit enforced atomically in Postgres.
- AI provider key stored as an Edge Function secret.
- Browser never receives service-role keys or AI provider keys.
- Browser-supplied `X-User-Email` and `X-User-Plan` are not trusted when a Supabase JWT is present.
- Request body size, message count, prompt length, and agent IDs are validated before provider calls.
- Generation records are saved by the server path, not trusted from the browser.

Deploy the production AI function after setting its secrets:

```bash
supabase secrets set OPENROUTER_API_KEY=your-provider-key APP_URL=https://your-app.example ALLOWED_ORIGINS=https://your-app.example --project-ref YOUR_PROJECT_REF
supabase functions deploy ai-generate --project-ref YOUR_PROJECT_REF
```

FastAPI local proxy environment:

```text
LOCAL_PROXY_REQUIRE_AUTH=true
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENROUTER_API_KEY=your-provider-key
ALLOWED_ORIGINS=http://127.0.0.1:5600,https://your-app.example
```

Concurrency behavior:

- Supabase Auth handles concurrent sign-ins.
- Supabase Edge Functions scale horizontally.
- Postgres handles concurrent generation usage with the `consume_daily_usage` RPC.
- Each request has a `requestId` in function responses and logs for debugging.

## 7. Billing

Payments use Paystack hosted checkout. The browser should call Supabase Edge
Functions and should not receive the Paystack secret key.

Required secrets:

```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_... --project-ref YOUR_PROJECT_REF
```

Required deployments:

```bash
supabase functions deploy paystack-initialize --project-ref YOUR_PROJECT_REF
supabase functions deploy paystack-verify --project-ref YOUR_PROJECT_REF
```

Optional webhook deployment:

```bash
supabase functions deploy paystack-webhook --no-verify-jwt --project-ref YOUR_PROJECT_REF
```

If the button says it cannot send a request to the Edge Function, check that
`paystack-initialize` exists in Supabase Dashboard > Edge Functions for the same
project ref used in `js/supabase-config.js`.

## 8. Admin Dashboard

The admin UI at `/admin/index.html` signs in with Supabase Auth, then calls the
`admin-dashboard` Edge Function. The browser never reads admin tables directly
and never receives the service-role key.

Required secret:

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key --project-ref YOUR_PROJECT_REF
```

Deploy the function:

```bash
supabase functions deploy admin-dashboard --project-ref YOUR_PROJECT_REF
```

Mark an existing Supabase Auth user as an admin from the SQL Editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
where email = 'admin@nexuzai.io';
```

The admin function also accepts `app_metadata.role = "admin"` or an
`app_metadata.roles` array containing `"admin"`. After changing metadata, sign
out and sign in again so the browser receives a fresh JWT.
