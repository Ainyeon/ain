-- ═══════════════════════════════════════════════════════════════════════
-- 16_jobs_board.sql — 회원 직접 등록 구인·구직
-- 적용: 검토·검증 후 운영에 적용한다(2026-09-26부터 사용자 위임으로 Claude가 Supabase MCP로 적용, 전후 점검).
--
-- 왜 새 테이블이 아닌가: 등록·수정·삭제·신고·익명 보호·운영자 조회가 이미 posts 에 있다.
--   board_type 을 늘리면 v_posts·RLS·연락처 가림 트리거·신고가 그대로 따라온다.
--   review_kind 는 후기/팁 전용이므로 구인·구직 글은 review_kind 를 null 로 둔다
--   (posts_review_fields_check 가 비용·국비·수료월을 null 로 강제한다 — 그대로 맞는다).
--
-- 고용24 API 인증 대기와 무관하게 동작한다. 회원 등록은 별개 경로다.
--
-- 롤백:
--   alter table public.posts drop constraint posts_board_type_check;
--   alter table public.posts add constraint posts_board_type_check
--     check (board_type in ('free','proposal'));        -- ⚠️ job_* 글이 남아 있으면 실패한다
--   create or replace view public.v_board_teaser as
--     select board_type, title, status, created_at, count(*) over ()::int as total_count
--     from public.posts order by created_at desc limit 5;
--   (closed_at 컬럼과 v_posts 의 closed_at 열은 남겨 두어도 무해하다)
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ── [A] 게시판 종류 확장 ────────────────────────────────────────────
alter table public.posts drop constraint if exists posts_board_type_check;
alter table public.posts add constraint posts_board_type_check
  check (board_type in ('free', 'proposal', 'job_offer', 'job_seek'));

-- ── [B] 마감 표시 ───────────────────────────────────────────────────
-- 구인·구직은 채워지면 끝난다. status 는 제안 상태 전용이고 회원이 바꿀 수 없으므로
-- 작성자가 직접 닫을 수 있는 열을 따로 둔다. 글을 지우지 않고 기록으로 남긴다.
alter table public.posts add column if not exists closed_at timestamptz;
alter table public.posts drop constraint if exists posts_closed_at_check;
alter table public.posts add constraint posts_closed_at_check
  check (closed_at is null or board_type in ('job_offer', 'job_seek'));

-- 구인·구직 글에는 후기 항목·교육 연결을 붙이지 않는다(교육 후기 집계에 섞임 방지). posts 0행이라 바로 건다.
alter table public.posts drop constraint if exists posts_job_plain_check;
alter table public.posts add constraint posts_job_plain_check
  check (board_type not in ('job_offer', 'job_seek') or (review_kind is null and ref_type is null));

grant select (closed_at) on public.posts to authenticated;
grant update (closed_at) on public.posts to authenticated;   -- RLS 의 본인 글 정책이 범위를 정한다

-- ── [C] 읽기 뷰에 열 추가 ───────────────────────────────────────────
-- 뷰에 있어도 프런트 공통 SELECT(POST_COLS)에서 빠지면 화면에 오지 않는다 (계약 검사 있음).
create or replace view public.v_posts as
select
    p.id, p.board_type, p.title, p.body, p.status, p.status_reason,
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
where auth.uid() is not null;   -- 15_launch 와 동일한 회원 제한

revoke all on public.v_posts from anon, authenticated, public;
grant select on public.v_posts to authenticated;

-- ── [D] 비회원 티저는 게시판 글만 ──────────────────────────────────
-- 홈의 '게시판' 스트립이 구인·구직 제목을 게시판 글로 보여 주면 안 된다.
-- 07 정의에 board_type 조건만 더한다 (본문·작성자는 여전히 나가지 않는다).
create or replace view public.v_board_teaser as
select board_type, title, status, created_at,
       count(*) over ()::int as total_count
from public.posts
where board_type in ('free', 'proposal')
order by created_at desc
limit 5;

revoke all on public.v_board_teaser from anon, authenticated, public;
grant select on public.v_board_teaser to anon, authenticated;

-- ── [E] 적용 확인: 하나라도 어긋나면 전체 롤백 ──────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'posts_board_type_check'
                  and pg_get_constraintdef(oid) like '%job_seek%') then
    raise exception 'board_type 확장 실패';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_job_plain_check') then
    raise exception '구인·구직 후기 차단 제약 없음';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'v_posts' and column_name = 'closed_at') then
    raise exception 'v_posts.closed_at 없음';
  end if;
  if has_table_privilege('anon', 'public.v_posts', 'SELECT') then raise exception 'v_posts가 anon에 열림'; end if;
  if has_table_privilege('anon', 'public.v_board_teaser', 'INSERT') or has_table_privilege('authenticated', 'public.v_board_teaser', 'UPDATE') then
    raise exception 'v_board_teaser 쓰기 권한 잔존';
  end if;
  if has_column_privilege('anon', 'public.posts', 'closed_at', 'UPDATE') then raise exception 'closed_at이 anon에 열림'; end if;
end $$;

commit;
