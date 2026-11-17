-- 28_studio_agent.sql — 스튜디오 에이전트(AI 대화) 사용량 한도. supabase/functions/studio-agent 짝.
--
-- 한도: 회원 1명 하루 30번, 전체 하루 3달러(Claude API 비용 추정치). 날짜는 한국 시간.
-- 표는 아무도 직접 못 읽고 쓴다 — 에지 함수가 service_role 로 아래 두 함수만 부른다.
--  - 이 DB의 default ACL은 새 객체에 anon/authenticated 전체 권한을 준다 → 전부 revoke (17_work.sql 과 같음).

create table if not exists public.studio_agent_usage (
  day     date    not null,
  user_id uuid    not null references auth.users(id) on delete cascade,
  turns   integer not null default 0,
  usd     numeric(10, 4) not null default 0,
  primary key (day, user_id)
);
alter table public.studio_agent_usage enable row level security;
revoke all on public.studio_agent_usage from public, anon, authenticated;

-- 한 번 쓰기 전에 부른다 — 한도 안이면 횟수를 하나 올리고 남은 횟수를 돌려준다
create or replace function public.studio_agent_take(p_user uuid, p_user_max int default 30, p_day_usd numeric default 3)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := (now() at time zone 'Asia/Seoul')::date; v_turns int; v_usd numeric;
begin
  select coalesce(sum(usd), 0) into v_usd from public.studio_agent_usage where day = d;
  if v_usd >= p_day_usd then return jsonb_build_object('ok', false, 'why', 'limit_day'); end if;
  insert into public.studio_agent_usage (day, user_id, turns) values (d, p_user, 0) on conflict do nothing;
  select turns into v_turns from public.studio_agent_usage where day = d and user_id = p_user for update;
  if v_turns >= p_user_max then return jsonb_build_object('ok', false, 'why', 'limit_user'); end if;
  update public.studio_agent_usage set turns = turns + 1 where day = d and user_id = p_user;
  return jsonb_build_object('ok', true, 'left', p_user_max - v_turns - 1);
end $$;

-- 쓴 뒤 비용(달러 추정)을 더한다
create or replace function public.studio_agent_spend(p_user uuid, p_usd numeric) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.studio_agent_usage set usd = usd + greatest(p_usd, 0)
   where day = (now() at time zone 'Asia/Seoul')::date and user_id = p_user;
$$;

revoke all on function public.studio_agent_take(uuid, int, numeric) from public, anon, authenticated;
revoke all on function public.studio_agent_spend(uuid, numeric) from public, anon, authenticated;
grant execute on function public.studio_agent_take(uuid, int, numeric) to service_role;
grant execute on function public.studio_agent_spend(uuid, numeric) to service_role;
