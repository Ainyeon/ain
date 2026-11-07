-- ═══════════════════════════════════════════════════════════════════════
-- 21_open_board.sql — 자유게시판·제안 읽기 공개 + 입주 캘린더 글 자동 게시
-- 적용: 검토·로컬 검증(node tools/test-open-board-sql.mjs) 뒤 운영에 적용한다. 재실행 안전.
--
-- 결정(2026-11-08 사용자):
--   · 게시판은 공개로 열고 글쓴이를 가입으로 이끈다 — 자유게시판·제안은 비회원도 읽는다.
--     쓰기·댓글·공감·투표·신고는 그대로 회원만(posts·comments·votes 원본 RLS 는 손대지 않는다).
--   · 구인·구직은 연락처가 붙는 글이라 지금처럼 회원 전용.
--   · 매일 만드는 입주 캘린더 글(move_in_contents, calendar_metro/nation_YYYYMMDD)을 자유게시판에 올린다.
--     단지명이 들어 있으므로 '단지명 = 회원 전용' 정책을 따라 비회원에게는 제목만, 본문은 회원만.
--
-- 비회원에게 새로 나가는 것: 자유·제안 글의 제목·본문(입주 캘린더 본문 제외)·작성 닉네임/분야(익명 글 제외)·
--   운영자 답변·댓글 본문과 댓글 작성 닉네임/분야·공감/찬반/댓글 수. 연락처는 저장 때 가려진다(15 [G] 트리거).
--   조회수 올리기(increment_post_view)는 회원만 — 비회원 조회는 세지 않는다.
--
-- 롤백:
--   drop trigger if exists post_move_in_calendar on public.move_in_contents;
--   drop function if exists public.tg_post_move_in_calendar(), public.upsert_move_in_post(text, text, boolean, timestamptz);
--   delete from public.posts where ref_type = 'move_in';
--   drop view if exists public.v_post_stats, public.v_comments;
--   16_jobs_board.sql 의 [C] 를 다시 실행(v_posts 회원 전용 복귀) — 그 뒤 ref_type 제약을 edu·notice 로 되돌린다.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ── [A] 입주 캘린더 글 연결 표시 ────────────────────────────────────
alter table public.posts drop constraint if exists posts_ref_type_check;
alter table public.posts add constraint posts_ref_type_check
  check (ref_type is null or ref_type in ('edu', 'notice', 'move_in'));

-- ── [B] 글 읽기: 자유·제안은 비회원도 ───────────────────────────────
-- 열 이름·순서는 16 [C] 그대로(프런트 POST_COLS 계약). body 만 입주 캘린더 글일 때 비회원에게 비운다.
create or replace view public.v_posts as
select
    p.id, p.board_type, p.title,
    case when p.ref_type = 'move_in' and auth.uid() is null then null else p.body end as body,
    p.status, p.status_reason,
    p.admin_answer, p.admin_answered_at,
    p.created_at, p.updated_at, p.view_count, p.is_anonymous, p.ref_type, p.ref_id,
    p.review_kind, p.review_cost, p.review_subsidy, p.review_done_month,
    (p.author_id = auth.uid()) as is_mine,
    case when p.is_anonymous then null else pr.nickname end as author_nick,
    case when p.is_anonymous then null else pr.field    end as author_field,
    case when p.is_anonymous then null else pr.role     end as author_role,
    p.closed_at
from public.posts p
join public.profiles pr on pr.id = p.author_id
where auth.uid() is not null or p.board_type in ('free', 'proposal');

revoke all on public.v_posts from anon, authenticated, public;
grant select on public.v_posts to anon, authenticated;

-- ── [C] 댓글 읽기 ───────────────────────────────────────────────────
-- 작성자 id 는 내보내지 않는다(본인 표시는 is_mine). 회원은 지금처럼 모든 게시판의 댓글을 본다.
create or replace view public.v_comments as
select c.id, c.post_id, c.body, c.created_at,
       (c.author_id = auth.uid()) as is_mine,
       pr.nickname as author_nick, pr.field as author_field, pr.role as author_role
from public.comments c
join public.posts p on p.id = c.post_id
join public.profiles pr on pr.id = c.author_id
where auth.uid() is not null or p.board_type in ('free', 'proposal');

revoke all on public.v_comments from anon, authenticated, public;
grant select on public.v_comments to anon, authenticated;

-- ── [D] 공감·찬반·댓글 수 ───────────────────────────────────────────
-- 누가 눌렀는지는 내보내지 않는다. 내 표는 회원이 votes 에서 자기 행만 따로 읽는다.
create or replace view public.v_post_stats as
select p.id as post_id,
       (select count(*) from public.votes v where v.post_id = p.id and v.vote = 'up')::int   as up,
       (select count(*) from public.votes v where v.post_id = p.id and v.vote = 'down')::int as down,
       (select count(*) from public.comments c where c.post_id = p.id)::int                  as comments
from public.posts p
where auth.uid() is not null or p.board_type in ('free', 'proposal');

revoke all on public.v_post_stats from anon, authenticated, public;
grant select on public.v_post_stats to anon, authenticated;

-- ── [E] 입주 캘린더 글 자동 게시 ────────────────────────────────────
-- 파이프라인(ain-automation move_in_radar, 매일 06:00 KST)이 지역별 하루 한 행을 넣거나 고친다.
-- 넣을 때는 글을 만들고, 고칠 때는 같은 글 본문을 바꾼다(하루 한 글). 작성자는 운영자 계정(role=admin 중 가장 먼저 가입).
-- ⚠️ 어떤 이유로든 실패해도 수집을 막지 않는다 — 경고만 남기고 넘어간다.
create or replace function public.upsert_move_in_post(p_stage text, p_text text, p_public boolean, p_created timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_author uuid;
  v_kind   text := split_part(p_stage, '_', 2);
  v_day    date;
  v_title  text;
  v_body   text := p_text;
begin
  if p_stage !~ '^calendar_(nation|metro)_[0-9]{8}$' or not coalesce(p_public, false)
     or coalesce(btrim(p_text), '') = '' then
    return;
  end if;
  select id into v_author from public.profiles where role = 'admin' order by created_at, id limit 1;
  if v_author is null then return; end if;
  v_day   := to_date(split_part(p_stage, '_', 3), 'YYYYMMDD');
  v_title := '입주 캘린더 · ' || to_char(v_day, 'FMMM.FMDD') || ' ' || case v_kind when 'metro' then '수도권' else '전국' end;
  -- posts.body 는 4000자까지. 넘으면 줄 단위로 자르고 전체 목록 위치를 적는다.
  if char_length(v_body) > 3800 then
    v_body := regexp_replace(left(v_body, 3700), E'\n[^\n]*$', '')
           || E'\n…\n\n목록이 길어 여기까지만 싣습니다. 전체는 입주 캘린더(ainyeon.com/calendar/)에서 볼 수 있습니다.';
  end if;
  update public.posts set body = v_body, updated_at = now()
   where ref_type = 'move_in' and ref_id = p_stage and body is distinct from v_body;
  if not found and not exists (select 1 from public.posts where ref_type = 'move_in' and ref_id = p_stage) then
    insert into public.posts (board_type, author_id, title, body, ref_type, ref_id, created_at, updated_at)
    values ('free', v_author, v_title, v_body, 'move_in', p_stage,
            coalesce(p_created, now()), coalesce(p_created, now()));
  end if;
end $$;

create or replace function public.tg_post_move_in_calendar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.upsert_move_in_post(new.stage, new.content_text, new.is_public, new.created_at);
  exception when others then
    raise warning '입주 캘린더 글 게시 건너뜀(%): %', new.stage, sqlerrm;
  end;
  return new;
end $$;

revoke all on function public.upsert_move_in_post(text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.tg_post_move_in_calendar() from public, anon, authenticated;

drop trigger if exists post_move_in_calendar on public.move_in_contents;
create trigger post_move_in_calendar
  after insert or update of content_text, is_public on public.move_in_contents
  for each row execute function public.tg_post_move_in_calendar();

-- 빈 게시판으로 열지 않게 최근 3일치만 미리 올린다(이미 있으면 그대로).
do $$
declare r record;
begin
  for r in select stage, content_text, is_public, created_at from public.move_in_contents
            where stage ~ '^calendar_(nation|metro)_[0-9]{8}$'
              and to_date(split_part(stage, '_', 3), 'YYYYMMDD') >= (now() at time zone 'Asia/Seoul')::date - 2
            order by stage loop
    perform public.upsert_move_in_post(r.stage, r.content_text, r.is_public, r.created_at);
  end loop;
end $$;

-- ── [F] 적용 확인: 하나라도 어긋나면 전체 롤백 ──────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.posts', 'SELECT')
     or has_table_privilege('anon', 'public.comments', 'SELECT')
     or has_table_privilege('anon', 'public.votes', 'SELECT') then
    raise exception '원본 표가 anon 에 열림';
  end if;
  if not has_table_privilege('anon', 'public.v_posts', 'SELECT')
     or not has_table_privilege('anon', 'public.v_comments', 'SELECT')
     or not has_table_privilege('anon', 'public.v_post_stats', 'SELECT') then
    raise exception '읽기 뷰가 anon 에 안 열림';
  end if;
  if has_table_privilege('anon', 'public.v_posts', 'INSERT') or has_table_privilege('anon', 'public.v_posts', 'UPDATE')
     or has_table_privilege('anon', 'public.v_post_stats', 'DELETE') or has_table_privilege('authenticated', 'public.v_post_stats', 'UPDATE')
     or has_table_privilege('anon', 'public.v_comments', 'DELETE') or has_table_privilege('authenticated', 'public.v_comments', 'INSERT') then
    raise exception '읽기 뷰에 쓰기 권한 잔존';
  end if;
  if has_function_privilege('anon', 'public.upsert_move_in_post(text, text, boolean, timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.upsert_move_in_post(text, text, boolean, timestamptz)', 'EXECUTE') then
    raise exception '자동 게시 함수가 열림';
  end if;
  if has_function_privilege('anon', 'public.increment_post_view(bigint)', 'EXECUTE') then
    raise exception '비회원 조회수 올리기가 열림';
  end if;
end $$;

commit;
