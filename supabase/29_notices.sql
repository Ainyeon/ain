-- ═══════════════════════════════════════════════════════════════════════
-- 29_notices.sql — 알림 목록(스튜디오 위 바의 종 단추). 26_web_push.sql 다음에 적용. 재실행 안전.
--
-- 흐름: 댓글·공감·입주 알림이 push_enqueue 를 지날 때 notices 에 한 줄 남긴다(기기 구독과 상관없이).
--       푸시 대기 줄(push_outbox)은 지금처럼 구독한 회원에게만 쌓인다.
-- 공개 범위: 회원은 자기 알림만 읽는다(RLS). 쓰기는 함수만 — 읽음 표시는 notices_seen().
-- 시험: node tools/test-web-push-sql.mjs (26 다음 29 를 올려 함께 본다)
--
-- 롤백:
--   drop function if exists public.notices_seen(bigint);
--   drop table if exists public.notices;
--   그리고 26_web_push.sql 의 push_enqueue 를 다시 적용
-- ═══════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.notices (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('comment', 'vote', 'movein')),
  title      text not null check (char_length(title) <= 80),
  body       text not null check (char_length(body) <= 200),
  url        text not null check (url ~ '^/'),
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists idx_notices_user on public.notices (user_id, id desc);
alter table public.notices enable row level security;
revoke all on public.notices from anon, authenticated, public;
grant select on public.notices to authenticated;
drop policy if exists "own notices" on public.notices;
create policy "own notices" on public.notices for select to authenticated using (user_id = auth.uid());

-- 26 의 push_enqueue + 알림 목록 한 줄(시험 알림은 목록에 넣지 않는다)
create or replace function public.push_enqueue(p_user uuid, p_kind text, p_title text, p_body text, p_url text, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  if p_kind <> 'test' then
    insert into public.notices (user_id, kind, title, body, url, dedupe_key)
    values (p_user, p_kind, left(p_title, 80), left(coalesce(p_body, ''), 200), p_url, p_dedupe)
    on conflict (dedupe_key) do nothing;
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = p_user) then return; end if;
  insert into public.push_outbox (user_id, kind, title, body, url, dedupe_key)
  values (p_user, p_kind, left(p_title, 80), left(coalesce(p_body, ''), 200), p_url, p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;
revoke all on function public.push_enqueue(uuid, text, text, text, text, text) from public, anon, authenticated;

-- 읽음 표시: 내 알림 중 p_upto 이하를 읽음으로. 남은 안 읽은 수를 돌려준다
create or replace function public.notices_seen(p_upto bigint)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'login'; end if;
  update public.notices set seen_at = now() where user_id = auth.uid() and id <= p_upto and seen_at is null;
  select count(*) into n from public.notices where user_id = auth.uid() and seen_at is null;
  return n;
end $$;
revoke all on function public.notices_seen(bigint) from public, anon;
grant execute on function public.notices_seen(bigint) to authenticated;

-- 단언: 비회원은 못 읽고 못 쓴다
do $$
begin
  if has_table_privilege('anon', 'public.notices', 'SELECT')
     or has_table_privilege('authenticated', 'public.notices', 'INSERT')
     or has_table_privilege('authenticated', 'public.notices', 'UPDATE')
     or has_function_privilege('anon', 'public.notices_seen(bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.push_enqueue(uuid,text,text,text,text,text)', 'EXECUTE') then
    raise exception '알림 목록이 열림';
  end if;
end $$;

commit;
