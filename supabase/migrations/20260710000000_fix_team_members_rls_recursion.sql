-- Fix: infinite recursion in RLS policy for public.team_members
--
-- The previous "team members are readable by teammates" policy queried
-- public.team_members from inside its own USING clause, which Postgres
-- evaluates recursively -> error 42P17 "infinite recursion detected in
-- policy for relation team_members". Because public.profiles' SELECT policy
-- joins team_members, EVERY profile read 500'd, so the app could never
-- hydrate the logged-in user (state.user stayed null) and AI agents (which
-- require a hydrated user) never ran.
--
-- Standard Supabase fix: move the membership lookup into SECURITY DEFINER
-- functions that run with the definer's rights, bypassing RLS on the
-- referenced tables and breaking the recursion.

-- Helper: is the given user a member of the given team? (bypasses RLS)
create or replace function public.is_team_member(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = p_user_id
  );
$$;

-- Helper: is the given user the owner of the given team? (bypasses RLS)
create or replace function public.is_team_owner(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.teams
    where id = p_team_id and owner_id = p_user_id
  );
$$;

-- Helper: do two users share any team? (bypasses RLS) — used by profiles policy
create or replace function public.users_share_team(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members tm1
    join public.team_members tm2 on tm1.team_id = tm2.team_id
    where tm1.user_id = p_user_a and tm2.user_id = p_user_b
  );
$$;

grant execute on function public.is_team_member(uuid, uuid) to authenticated, anon;
grant execute on function public.is_team_owner(uuid, uuid) to authenticated, anon;
grant execute on function public.users_share_team(uuid, uuid) to authenticated, anon;

-- Rebuild team_members SELECT policy without self-recursion
drop policy if exists "team members are readable by teammates" on public.team_members;
create policy "team members are readable by teammates"
  on public.team_members for select
  using (
    user_id = auth.uid() or
    public.is_team_owner(team_id, auth.uid()) or
    public.is_team_member(team_id, auth.uid())
  );

-- Rebuild profiles teammate-visibility policy using the helper
drop policy if exists "profiles are readable by teammates" on public.profiles;
create policy "profiles are readable by teammates"
  on public.profiles for select
  using (
    auth.uid() = id or
    public.users_share_team(auth.uid(), id)
  );
