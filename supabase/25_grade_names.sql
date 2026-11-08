-- ═══════════════════════════════════════════════════════════════════════
-- 25_grade_names.sql — 회원 등급 이름을 현장 서열로 바꾼다 (24_member_grades.sql 다음에 실행).
-- 적용: 로컬 검증(node tools/test-member-grades-sql.mjs) 뒤 운영에 적용한다. 재실행 안전.
--
-- 결정(2026-11-08 사용자, A안): 새싹 → 막내 · 일꾼 → 기사 · 단골 → 반장 · 고수 → 명장.
--   조건·세는 법·공개 범위는 24 그대로. 이름만 바꾼다.
--   ⚠️ 이 파일 뒤에 24 를 다시 실행하면 이름이 예전으로 돌아간다 — 다시 만들 땐 24 → 25 순서로.
--
-- 롤백: 24_member_grades.sql 의 [A]·[B] 를 다시 실행(그 전에 grade_pin '명장' 을 '고수' 로 되돌린다).
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ── [A] 운영자가 정하는 등급: 고수 → 명장 ───────────────────────────
alter table public.profiles drop constraint if exists profiles_grade_pin_check;
update public.profiles set grade_pin = '명장' where grade_pin = '고수';
alter table public.profiles add constraint profiles_grade_pin_check check (grade_pin is null or grade_pin = '명장');

-- ── [B] 회원별 집계 — 24 [B] 와 같고 이름만 다르다 ──────────────────
-- 조회할 때마다 전체 글·댓글을 다시 센다. 글·댓글이 수만 건이 되어 게시판이 느려지면 하루 한 번 표로 굳힌다.
create or replace view public.v_member_grades as
select s.user_id, s.posts, s.comments, s.days,
       case when s.pin = '명장' then '명장'
            when (s.posts >= 10 or s.comments >= 30) and s.days >= 30 then '반장'
            when s.posts >= 1 or s.comments >= 3 then '기사'
            else '막내' end as grade
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

-- ── [C] 적용 확인 ──────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.v_member_grades', 'SELECT')
     or has_table_privilege('authenticated', 'public.v_member_grades', 'SELECT') then
    raise exception '회원별 집계 뷰가 열림';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'grade_pin', 'UPDATE') then raise exception '회원이 등급을 고칠 수 있음'; end if;
  if not has_table_privilege('anon', 'public.v_posts', 'SELECT') or not has_table_privilege('authenticated', 'public.v_my_grade', 'SELECT')
     or has_table_privilege('anon', 'public.v_my_grade', 'SELECT') then
    raise exception '등급을 읽는 뷰 권한이 바뀜';
  end if;
  if exists (select 1 from public.v_member_grades where grade not in ('막내', '기사', '반장', '명장')) then
    raise exception '예전 등급 이름이 남음';
  end if;
end $$;

commit;
