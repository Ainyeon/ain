-- ═══════════════════════════════════════════════════════════════════════
-- 26_web_push.sql — 웹 푸시 알림 (앱 출시 1단계: 지금 웹 그대로 + 홈 화면 설치·알림)
-- 적용: 검토·로컬 검증(node tools/test-web-push-sql.mjs) 뒤 운영에 적용한다. 재실행 안전.
--       보내는 쪽은 Edge Function push-drain(supabase/functions/push-drain) — VAPID 키는 함수 비밀값에만 둔다.
--
-- 결정(2026-11-08 사용자): 앱은 ① 웹 푸시 → ② 플레이스토어 → ③ 앱스토어, 앱인토스 보류. 첫 알림은 둘 다:
--   · 내 글에 댓글·공감(제안은 찬성)이 달렸을 때 — 공감·찬성은 글마다 하루 한 번만
--   · 관심 저장한 단지의 입주가 30일·7일 남았을 때 — 월 단위 단지(예정일 1일)는 30일 전 한 번만
-- 흐름: 트리거·매일 작업이 push_outbox 에 한 줄 넣는다 → 넣은 문장마다 pg_net 이 push-drain 을 깨운다 →
--       함수가 push_claim 으로 대기 줄을 가져가 보내고 push_done 으로 결과를 적는다.
--       함수는 누가 불러도 '이미 대기 중인 것'만 보내므로 JWT 를 검사하지 않는다(verify_jwt=false).
-- 공개 범위: 두 표 모두 누구에게도 직접 열지 않는다. 회원은 save/delete_push_subscription 으로 자기 기기만 등록·삭제.
--   대기·결과 함수(push_claim·push_done)는 service_role 만. 구독 주소는 알려진 푸시 서비스만 받는다.
--
-- 롤백:
--   select cron.unschedule('push-movein-daily');
--   drop trigger if exists push_comment on public.comments; drop trigger if exists push_vote on public.votes;
--   drop table if exists public.push_outbox, public.push_subscriptions cascade;
--   drop function if exists public.push_enqueue(uuid,text,text,text,text,text), public.post_path(text,bigint),
--     public.tg_push_comment(), public.tg_push_vote(), public.push_movein_reminders(date), public.push_kick(),
--     public.tg_push_kick(), public.push_claim(int), public.push_done(bigint,text,text,text[],text[]),
--     public.save_push_subscription(text,text,text), public.delete_push_subscription(text);
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- pg_net: DB 에서 함수를 깨우는 HTTP 호출(비동기 — 실패해도 글·댓글 저장을 막지 않는다)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

-- ── [A] 기기 구독 ───────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  endpoint   text primary key check (char_length(endpoint) <= 1000),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null check (char_length(p256dh) between 40 and 200),
  auth       text not null check (char_length(auth) between 10 and 100),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated, public;

-- ── [B] 보낼 알림 줄 ────────────────────────────────────────────────
create table if not exists public.push_outbox (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('comment', 'vote', 'movein', 'test')),
  title      text not null check (char_length(title) <= 80),
  body       text not null check (char_length(body) <= 200),
  url        text not null check (url ~ '^/'),
  dedupe_key text unique,
  status     text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'nosub', 'failed')),
  tries      int  not null default 0,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  error      text
);
create index if not exists idx_push_outbox_pending on public.push_outbox (status, id);
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from anon, authenticated, public;

-- ── [C] 넣기 · 글 주소 ─────────────────────────────────────────────
-- 구독한 기기가 없는 회원에게는 쌓지 않는다. 같은 dedupe_key 는 한 번만.
create or replace function public.push_enqueue(p_user uuid, p_kind text, p_title text, p_body text, p_url text, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or not exists (select 1 from public.push_subscriptions where user_id = p_user) then return; end if;
  insert into public.push_outbox (user_id, kind, title, body, url, dedupe_key)
  values (p_user, p_kind, left(p_title, 80), left(coalesce(p_body, ''), 200), p_url, p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

-- ain-community.js postHref 와 같은 규칙
create or replace function public.post_path(p_board text, p_id bigint)
returns text language sql immutable set search_path = public as $$
  select case p_board when 'proposal'  then '/board/proposal/?id='
                      when 'job_offer' then '/edu/jobs/?kind=offer&id='
                      when 'job_seek'  then '/edu/jobs/?kind=seek&id='
                      else '/board/free/?id=' end || p_id
$$;

-- ── [D] 댓글·공감 알림 ──────────────────────────────────────────────
-- ⚠️ 어떤 이유로든 실패해도 댓글·공감 저장을 막지 않는다.
create or replace function public.tg_push_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_post record; v_nick text;
begin
  begin
    select id, author_id, board_type into v_post from public.posts where id = new.post_id;
    if v_post.author_id is not null and v_post.author_id <> new.author_id then
      select nickname into v_nick from public.profiles where id = new.author_id;
      perform public.push_enqueue(v_post.author_id, 'comment', '내 글에 댓글이 달렸어요',
        coalesce(v_nick, '회원') || ': ' || left(regexp_replace(new.body, '\s+', ' ', 'g'), 90),
        public.post_path(v_post.board_type, v_post.id), 'comment:' || new.id);
    end if;
  exception when others then
    raise warning '댓글 알림 건너뜀: %', sqlerrm;
  end;
  return new;
end $$;

create or replace function public.tg_push_vote()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_post record;
begin
  begin
    if new.vote = 'up' then
      select id, author_id, board_type, title into v_post from public.posts where id = new.post_id;
      if v_post.author_id is not null and v_post.author_id <> new.user_id then
        perform public.push_enqueue(v_post.author_id, 'vote',
          case when v_post.board_type = 'proposal' then '내 제안에 찬성이 늘었어요' else '내 글에 공감이 늘었어요' end,
          v_post.title, public.post_path(v_post.board_type, v_post.id),
          'vote:' || v_post.id || ':' || ((now() at time zone 'Asia/Seoul')::date));
      end if;
    end if;
  exception when others then
    raise warning '공감 알림 건너뜀: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists push_comment on public.comments;
create trigger push_comment after insert on public.comments for each row execute function public.tg_push_comment();
drop trigger if exists push_vote on public.votes;
create trigger push_vote after insert on public.votes for each row execute function public.tg_push_vote();

-- ── [E] 관심 단지 입주 알림(매일 09:00 KST) ─────────────────────────
-- 파이프라인이 월만 아는 단지는 예정일을 그 달 1일로 채운다 — 그런 단지는 '7일 남음'이 사실이 아니라 30일 전 한 번만.
create or replace function public.push_movein_reminders(p_today date default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_today date := coalesce(p_today, (now() at time zone 'Asia/Seoul')::date); v_n int := 0; r record;
begin
  for r in
    select s.user_id, c.id, coalesce(nullif(c.complex_name_ad, ''), c.complex_name_raw) as name, c.expected_move_in as d,
           (c.expected_move_in - v_today) as left_days, extract(day from c.expected_move_in) = 1 as month_only
      from public.saved_items s
      join public.move_in_complexes c on s.target_type = 'complex' and c.id::text = s.target_id
     where c.is_public and c.expected_move_in - v_today in (30, 7)
       and exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
  loop
    continue when r.month_only and r.left_days = 7;
    perform public.push_enqueue(r.user_id, 'movein',
      case when r.month_only then '관심 단지 입주가 다가와요' else '관심 단지 입주 D-' || r.left_days end,
      r.name || ' · ' || case when r.month_only then to_char(r.d, 'YYYY"년" FMMM"월"') || ' 입주 예정'
                              else to_char(r.d, 'FMMM"월" FMDD"일"') || ' 입주 예정' end,
      '/area/?complex=' || r.id, 'movein:' || r.id || ':' || r.user_id || ':' || r.left_days);
    v_n := v_n + 1;
  end loop;
  delete from public.push_outbox where created_at < now() - interval '30 days';
  return v_n;
end $$;

-- ── [F] 보내는 함수 깨우기 ──────────────────────────────────────────
create or replace function public.push_kick()
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  perform net.http_post(url := 'https://oqgoibbhnidsveueifet.supabase.co/functions/v1/push-drain',
                        body := '{}'::jsonb, params := '{}'::jsonb,
                        headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 5000);
exception when others then
  raise warning '알림 발송 깨우기 건너뜀: %', sqlerrm;
end $$;

create or replace function public.tg_push_kick()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.push_kick();
  return null;
end $$;
drop trigger if exists push_outbox_kick on public.push_outbox;
create trigger push_outbox_kick after insert on public.push_outbox for each statement execute function public.tg_push_kick();

-- ── [G] 보내는 함수가 쓰는 두 함수(service_role 만) ─────────────────
-- 대기 줄을 '보내는 중'으로 바꿔 가져간다. 10분 넘게 '보내는 중'인 줄은 세 번까지 다시 가져간다.
create or replace function public.push_claim(p_limit int default 50)
returns table (id bigint, user_id uuid, title text, body text, url text, subs jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with c as (
    update public.push_outbox o set status = 'sending', tries = o.tries + 1
     where o.id in (select x.id from public.push_outbox x
                     where x.status = 'pending' or (x.status = 'sending' and x.created_at < now() - interval '10 minutes' and x.tries < 3)
                     order by x.id limit greatest(1, least(p_limit, 200)) for update skip locked)
    returning o.id, o.user_id, o.title, o.body, o.url)
  select c.id, c.user_id, c.title, c.body, c.url,
         coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                     from public.push_subscriptions s where s.user_id = c.user_id), '[]'::jsonb)
    from c
   order by c.id;
end $$;

-- 결과 적기. gone = 푸시 서비스가 없앤 구독(404·410) → 지운다, ok = 이번에 받은 구독.
create or replace function public.push_done(p_id bigint, p_status text, p_error text, p_gone text[], p_ok text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.push_outbox
     set status = p_status, sent_at = case when p_status = 'sent' then now() end, error = left(p_error, 300)
   where id = p_id;
  delete from public.push_subscriptions where endpoint = any(coalesce(p_gone, '{}'));
  update public.push_subscriptions set last_ok_at = now() where endpoint = any(coalesce(p_ok, '{}'));
end $$;

-- ── [H] 회원이 자기 기기를 등록·삭제 ────────────────────────────────
-- 주소는 브라우저 푸시 서비스만(구글·모질라·애플·윈도). 같은 기기를 다른 계정이 다시 켜면 그 계정으로 옮긴다.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception '로그인이 필요합니다'; end if;
  if p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/' then
    raise exception '알 수 없는 알림 주소';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, v_uid, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
                                       created_at = now(), last_ok_at = null;
  -- 한 사람 기기는 최근 10대까지
  delete from public.push_subscriptions
   where user_id = v_uid
     and endpoint not in (select endpoint from public.push_subscriptions where user_id = v_uid order by created_at desc limit 10);
end $$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

-- ── [I] 권한 ───────────────────────────────────────────────────────
revoke all on function public.push_enqueue(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.tg_push_comment() from public, anon, authenticated;
revoke all on function public.tg_push_vote() from public, anon, authenticated;
revoke all on function public.push_movein_reminders(date) from public, anon, authenticated;
revoke all on function public.push_kick() from public, anon, authenticated;
revoke all on function public.tg_push_kick() from public, anon, authenticated;
revoke all on function public.push_claim(int) from public, anon, authenticated;
revoke all on function public.push_done(bigint, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.push_claim(int) to service_role;
grant execute on function public.push_done(bigint, text, text, text[], text[]) to service_role;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- ── [J] 매일 09:00 KST(00:00 UTC) — 입주 알림 넣고, 남은 대기 줄도 한 번 깨운다 ──
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'push-movein-daily';
    perform cron.schedule('push-movein-daily', '0 0 * * *',
      'select public.push_movein_reminders(); select public.push_kick();');
  end if;
end $$;

-- ── [K] 적용 확인 ──────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.push_subscriptions', 'SELECT') or has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT')
     or has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT')
     or has_table_privilege('anon', 'public.push_outbox', 'SELECT') or has_table_privilege('authenticated', 'public.push_outbox', 'SELECT')
     or has_table_privilege('authenticated', 'public.push_outbox', 'INSERT') then
    raise exception '알림 표가 열림';
  end if;
  if has_function_privilege('anon', 'public.save_push_subscription(text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.push_claim(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.push_claim(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.push_enqueue(uuid,text,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.push_movein_reminders(date)', 'EXECUTE') then
    raise exception '알림 함수가 열림';
  end if;
  if not has_function_privilege('authenticated', 'public.save_push_subscription(text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.push_claim(integer)', 'EXECUTE') then
    raise exception '알림 함수가 안 열림';
  end if;
end $$;

commit;
