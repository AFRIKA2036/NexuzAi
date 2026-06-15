# Self-Hosted Supabase on Fly.io — NexuzAI Switchover

Use this guide to move the database layer from hosted Supabase to a self-hosted
Supabase stack on Fly.io while keeping the current Vercel deployment intact.
This is the safest path: you only change the backend database plus Vercel
environment secrets. The app build and GitHub Actions remain untouched.

---

## 0) Safety Rules
- Do not delete the existing Supabase project until the new one passes tests.
- Switch over by URL only (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `AI_FUNCTION_URL`).
- This guide never rewrites GitHub Actions or pushes code that mutates data.

---

## 1) Create the Fly.io Supabase app
1. Make sure you have the Fly CLI installed and logged in.
2. From this repo directory, run:
   `fly launch`
3. In the wizard:
   - app name: `<your-name>-nexuz-supabase`
   - region: choose the region closest to your users
   - PostgreSQL: No for now
   - Dockerfile: Detect if one exists, otherwise No
   - Postgres: Do not add managed Postgres yet
   - Redis: No
4. After launch, create a persistent volume for Postgres:
   `fly volumes create supabase_data --size 40 --region <region>`

---

## 2) Prepare Docker Compose for Fly.io
- Save `fly-supabase/docker-compose.yml` in the repo for reference.
- You can run the self-hosted stack locally with:
  `docker compose -f fly-supabase/docker-compose.yml up -d`
- Do not bind it to `localhost:54321` when intending to expose it through Fly.io.

---

## 3) First deploy
`fly deploy`
Confirm the app is up:
`fly status`
`fly logs`

---

## 4) Create a database and export your existing data
1. Open your old Supabase dashboard.
2. Use the SQL Editor to run:
   `\copy profiles,teams,team_members,generations,exports,usage_daily TO 'export.csv' WITH CSV HEADER;`
3. If export size is large, export one table at a time instead of `\copy *`.

---

## 5) Import into Fly.io Supabase
- Get Postgres connection details:
  `fly ssh console -C "sh -c 'env | sort'"`
  `pgcli -U postgres fly_supabase_data`
- Import with:
  `psql "postgres://postgres:***@localhost:5432/fly_supabase_data" -f migration.sql`

If `migration.sql` does not exist yet, generate it with:
`pg_dump "postgres://<OLD_USER>:***@<OLD_HOST>:5432/postgres" \
  --data-only --inserts --no-owner \
  --table=profiles --table=teams --table=team_members \
  --table=generations --table=exports --table=usage_daily > migration.sql`

---

## 6) Get self-hosted Supabase credentials
From the Fly app logs or internal Supabase dashboard, collect:
- `SUPABASE_URL` — the public URL of your self-hosted Supabase
- `SUPABASE_ANON_KEY` — safe for client-side use
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only
- `SUPABASE_JWT_SECRET` — keep private

Store them in Fly secrets:
`fly secrets set SUPABASE_URL=https://<app-name>.fly.dev`
`fly secrets set SUPABASE_ANON_KEY=<key>`
`fly secrets set SUPABASE_SERVICE_ROLE_KEY=<key>`
`fly secrets set SUPABASE_JWT_SECRET=<secret>`

---

## 7) Vercel environment variable switchover
1. Go to Vercel → Project → Settings → Environment Variables.
2. Update these four values:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `AI_FUNCTION_URL`
   - `PAYSTACK_PUBLIC_KEY` only if your backend stayed the same
3. Redeploy in Vercel after saving secrets.

---

## 8) Edge Function / backup backend change
Option A: Deploy the app's Edge Functions to the new self-hosted Supabase.
Option B: Keep pointing `AI_FUNCTION_URL` to the old Edge Runtime if the
functions still work until migration is complete.

---

## 9) How to manage the database afterward
- Use the Supabase interface at `https://<app-name>.fly.dev` or install Postgres
tools and connect directly to Fly Postgres.
- Fly volumes survive restarts by default.
- To back up:
  `fly ssh console -C "pg_dump -U postgres fly_supabase_data" > backup.sql`
- To scale:
  `fly scale vm shared-cpu-1x --memory 2048`

---

## 10) Rollback
- If something breaks, restore the old Vercel env vars to the previous Supabase
  project and redeploy.
- Keep the old Supabase project frozen until the new stack is stable for a week.
