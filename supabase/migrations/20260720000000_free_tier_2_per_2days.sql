-- Free tier: change from 20 per day to 2 generations per rolling 2-day window, per account.
-- Replaces consume_daily_usage with consume_window_usage.

-- Drop the old function so the new signature can be created cleanly.
drop function if exists public.consume_daily_usage(integer);

create or replace function public.consume_window_usage(p_limit integer default 2, p_window_days integer default 2)
returns table(allowed boolean, request_count integer, plan public.plan_type)
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_plan public.plan_type;
  v_window_start date := current_date - (p_window_days - 1);
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

  -- Sum usage across the rolling window for this account (per user_id).
  select coalesce(sum(usage_daily.request_count), 0)
  into v_count
  from public.usage_daily
  where usage_daily.user_id = v_user
    and usage_daily.usage_date >= v_window_start;

  if v_count >= p_limit then
    return query select false, v_count, v_plan;
    return;
  end if;

  -- Record/increment today's usage.
  insert into public.usage_daily (user_id, usage_date, request_count)
  values (v_user, current_date, 1)
  on conflict (user_id, usage_date) do update
    set request_count = public.usage_daily.request_count + 1,
        updated_at = now();

  return query select true, v_count + 1, v_plan;
end;
$$;

revoke all on function public.consume_window_usage(integer, integer) from public;
grant execute on function public.consume_window_usage(integer, integer) to authenticated;
