-- NexuzAI Supabase schema
-- Run this in Supabase SQL Editor after creating the project.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'plan_type') then
    create type public.plan_type as enum ('free', 'pro', 'team');
  end if;

  if not exists (select 1 from pg_type where typname = 'output_format') then
    create type public.output_format as enum ('text', 'html', 'pdf', 'docx');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  plan public.plan_type not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  paystack_customer_code text,
  paystack_last_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id text not null,
  prompt text not null,
  output text not null,
  output_format public.output_format not null default 'text',
  created_at timestamptz not null default now()
);

create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_id uuid references public.generations(id) on delete set null,
  agent_id text not null,
  format public.output_format not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  request_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.generations enable row level security;
alter table public.exports enable row level security;
alter table public.usage_daily enable row level security;

drop policy if exists "profiles are readable by owner" on public.profiles;
create policy "profiles are readable by owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles are insertable by owner" on public.profiles;
create policy "profiles are insertable by owner"
  on public.profiles for insert
  with check (auth.uid() = id and plan = 'free'::public.plan_type);

drop policy if exists "profiles are updateable by owner" on public.profiles;
create policy "profiles are updateable by owner"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke update (plan, stripe_customer_id, stripe_subscription_id) on public.profiles from authenticated;
grant update (email, full_name) on public.profiles to authenticated;

drop policy if exists "generations are owned by user" on public.generations;
create policy "generations are owned by user"
  on public.generations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "exports are owned by user" on public.exports;
create policy "exports are owned by user"
  on public.exports for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "usage is readable by owner" on public.usage_daily;
create policy "usage is readable by owner"
  on public.usage_daily for select
  using (auth.uid() = user_id);

drop policy if exists "export files are readable by owner" on storage.objects;
create policy "export files are readable by owner"
  on storage.objects for select
  using (bucket_id = 'exports' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "export files are writable by owner" on storage.objects;
create policy "export files are writable by owner"
  on storage.objects for insert
  with check (bucket_id = 'exports' and auth.uid()::text = (storage.foldername(name))[1]);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_updated_at();

drop trigger if exists usage_daily_touch_updated_at on public.usage_daily;
create trigger usage_daily_touch_updated_at
  before update on public.usage_daily
  for each row execute procedure public.touch_updated_at();

create or replace function public.consume_daily_usage(p_limit integer default 20)
returns table(allowed boolean, request_count integer, plan public.plan_type)
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_plan public.plan_type;
  v_count integer;
begin
  if v_user is null then
    return query select false, 0, 'free'::public.plan_type;
    return;
  end if;

  select profiles.plan
  into v_plan
  from public.profiles
  where profiles.id = v_user;

  v_plan := coalesce(v_plan, 'free'::public.plan_type);

  if v_plan in ('pro'::public.plan_type, 'team'::public.plan_type) then
    return query select true, 0, v_plan;
    return;
  end if;

  insert into public.usage_daily (user_id, usage_date, request_count)
  values (v_user, current_date, 1)
  on conflict (user_id, usage_date) do update
    set request_count = public.usage_daily.request_count + 1,
        updated_at = now()
    where public.usage_daily.request_count < p_limit
  returning public.usage_daily.request_count into v_count;

  if v_count is null then
    select usage_daily.request_count
    into v_count
    from public.usage_daily
    where usage_daily.user_id = v_user
      and usage_daily.usage_date = current_date;

    return query select false, coalesce(v_count, p_limit), v_plan;
    return;
  end if;

  return query select true, v_count, v_plan;
end;
$$;

revoke all on function public.consume_daily_usage(integer) from public;
grant execute on function public.consume_daily_usage(integer) to authenticated;
