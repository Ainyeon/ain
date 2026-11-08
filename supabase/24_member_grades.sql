-- ═══════════════════════════════════════════════════════════════════════
-- 24_member_grades.sql — 회원 등급(카페 등급처럼, 무료). 활동으로 저절로 오르고, 읽기를 막지 않는다.
-- 적용: 검토·로컬 검증(node tools/test-member-grades-sql.mjs) 뒤 운영에 적용한다. 재실행 안전.
--       프런트보다 먼저 적용한다(댓글 읽기가 author_grade 열을 요청한다).
--
-- 결정(2026-11-08 사용자): 유료가 아니라 카페 등급처럼 나눠 둔다. 유료 버전은 나중에 따로(subscriptions 와 섞지 않는다).
--   새싹 — 가입하면
--   일꾼 — 글 1개 또는 댓글 3개
--   단골 — 글 10개 또는 댓글 30개, 그리고 가입 30일
--   고수 — 운영자가 정한다(profiles.grade_pin = '고수')
-- 세는 법:
--   · 하루에 글은 3개, 댓글은 10개까지만 센다(한국 날짜 기준) — 도배로 오르지 않게.
--   · 익명 글은 세지 않는다 — 익명 글을 쓴 직후 등급이 바뀌면 누가 썼는지 짐작할 수 있다.
--   · 입주 캘린더 자동 게시(ref_type = 'move_in')는 세지 않는다. 지운 글·댓글은 빠진다(행이 없어지므로).
-- 공개 범위:
--   · 다른 사람에게는 등급 이름만 나간다(v_posts·v_comments 의 author_grade, 익명 글은 null).
--   · 글·댓글 수와 가입 일수는 본인만(v_my_grade). 회원별 집계 뷰 v_member_grades 는 누구에게도 열지 않는다.
--
-- 롤백:
--   drop view if exists public.v_my_grade;
--   21_open_board.sql 의 [B]·[C] 를 다시 실행하면 v_posts·v_comments 가 author_grade 없는 정의로 돌아간다
--   (열을 빼는 것이라 create or replace 가 안 된다 — drop view v_posts, v_comments 뒤 21 [B]·[C] 실행).
--   drop view if exists public.v_member_grades;
--   alter table public.profiles drop constraint if exists profiles_grade_pin_check, drop column if exists grade_pin;
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ── [A] 운영자가 정하는 등급 ─────────────────────────────────────────
-- 회원은 이 칸을 못 고친다: profiles 의 회원 UPDATE 권한은 nickname·field·region·updated_at 열에만 있다(실측 2026-11-08).
alter table public.profiles add column if not exists grade_pin text;
alter table public.profiles drop constraint if exists profiles_grade_pin_check;
alter table public.profiles add constraint profiles_grade_pin_check check (grade_pin is null or grade_pin = '고수');

-- ── [B] 회원별 집계(내부용) ─────────────────────────────────────────
-- 조회할 때마다 전체 글·댓글을 다시 센다. 글·댓글이 수만 건이 되어 게시판이 느려지면 하루 한 번 표로 굳힌다.
create or replace view public.v_member_grades as
select s.user_id, s.posts, s.comments, s.days,
       case when s.pin = '고수' then '고수'
            when (s.posts >= 10 or s.comments >= 30) and s.days >= 30 then '단골'
            when s.posts >= 1 or s.comments >= 3 then '일꾼'
            else '새싹' end as grade
from (
  select pr.id as user_id, pr.grade_pin as pin,
         coalesce(p.n, 0)::int as posts,
         coalesce(c.n, 0)::int as comments,
         ((now() at time zone 'Asia/Seoul')::date - (pr.created_at at time zone 'Asia/Seoul')::date)::int as days
  from public.profiles pr
  left join (
    select author_id, sum(n) as n from (
      select author_id, least(count(*), 3) as n from public.posts
       where not coalesce(is_anonymous, false) and ref_type is distinct from 'move_in'
       group by author_id, (created_at at time zone 'Asia/Seoul')::date) d
    group by author_id) p on p.author_id = pr.id
  left join (
    select author_id, sum(n) as n from (
      select author_id, least(count(*), 10) as n from public.comments
       group by author_id, (created_at at time zone 'Asia/Seoul')::date) d
    group by author_id) c on c.author_id = pr.id
) s;

revoke all on public.v_member_grades from anon, authenticated, public;

-- ── [C] 글·댓글 작성자 옆 등급 ───────────────────────────────────────
-- 21 [B]·[C] 정의 그대로 + 맨 끝에 author_grade 한 열(열 순서는 프런트 계약 — 끝에만 붙인다).
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
    p.closed_at,
    case when p.is_anonymous then null else g.grade     end as author_grade
from public.posts p
join public.profiles pr on pr.id = p.author_id
left join public.v_member_grades g on g.user_id = p.author_id
where auth.uid() is not null or p.board_type in ('free', 'proposal');

revoke all on public.v_posts from anon, authenticated, public;
grant select on public.v_posts to anon, authenticated;

create or replace view public.v_comments as
select c.id, c.post_id, c.body, c.created_at,
       (c.author_id = auth.uid()) as is_mine,
       pr.nickname as author_nick, pr.field as author_field, pr.role as author_role,
       g.grade as author_grade
from public.comments c
join public.posts p on p.id = c.post_id
join public.profiles pr on pr.id = c.author_id
left join public.v_member_grades g on g.user_id = c.author_id
where auth.uid() is not null or p.board_type in ('free', 'proposal');

revoke all on public.v_comments from anon, authenticated, public;
grant select on public.v_comments to anon, authenticated;

-- ── [D] 내 등급(본인만) ─────────────────────────────────────────────
create or replace view public.v_my_grade as
select grade, posts, comments, days from public.v_member_grades where user_id = auth.uid();

revoke all on public.v_my_grade from anon, authenticated, public;
grant select on public.v_my_grade to authenticated;

-- ── [E] 적용 확인: 하나라도 어긋나면 전체 롤백 ──────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.v_member_grades', 'SELECT')
     or has_table_privilege('authenticated', 'public.v_member_grades', 'SELECT') then
    raise exception '회원별 집계 뷰가 열림';
  end if;
  if has_table_privilege('anon', 'public.v_my_grade', 'SELECT') then raise exception '내 등급이 비회원에게 열림'; end if;
  if not has_table_privilege('authenticated', 'public.v_my_grade', 'SELECT') then raise exception '내 등급이 회원에게 안 열림'; end if;
  if has_column_privilege('authenticated', 'public.profiles', 'grade_pin', 'UPDATE') then raise exception '회원이 등급을 고칠 수 있음'; end if;
  if not has_table_privilege('anon', 'public.v_posts', 'SELECT') or not has_table_privilege('anon', 'public.v_comments', 'SELECT') then
    raise exception '읽기 뷰가 비회원에게 안 열림';
  end if;
  if has_table_privilege('anon', 'public.posts', 'SELECT') or has_table_privilege('anon', 'public.comments', 'SELECT') then
    raise exception '원본 표가 비회원에게 열림';
  end if;
  if has_table_privilege('authenticated', 'public.v_posts', 'INSERT') or has_table_privilege('authenticated', 'public.v_comments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.v_my_grade', 'DELETE') then
    raise exception '읽기 뷰에 쓰기 권한 잔존';
  end if;
end $$;

commit;
