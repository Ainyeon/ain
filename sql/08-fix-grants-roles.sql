-- Step 8: 투표 권한 버그픽스 + 역할(role) 시스템 + 닉네임 제약 확인
-- Supabase SQL Editor에서 수동 실행. 멱등(여러 번 실행 안전).
--
-- ═══ 버그 원인 (확정 진단) ═══
-- 증상: authenticated 투표 시 "permission denied for table votes" (42501)
-- 원인: 07에서 votes에 컬럼 단위 UPDATE(vote)만 부여했는데, supabase-js upsert는
--       INSERT ... ON CONFLICT DO UPDATE SET post_id=, user_id=, vote= 로
--       페이로드 전 컬럼을 SET 함 → post_id/user_id UPDATE 권한 부재 → 테이블 레벨 거부.
--       (RLS 거부가 아님 — RLS면 "row-level security policy" 문구가 뜸)
-- 진단에 쓴 쿼리 (재사용용):
--   select table_name, grantee, string_agg(privilege_type, ',')
--   from information_schema.role_table_grants
--   where table_schema='public'
--     and table_name in ('profiles','posts','comments','votes','reports')
--     and grantee in ('anon','authenticated')
--   group by 1,2 order by 1,2;
--   select grantee, privilege_type, column_name
--   from information_schema.role_column_grants
--   where table_schema='public' and table_name='votes' and grantee='authenticated';

-- ════════════════════════════════════════
-- [A] votes GRANT 수정 — upsert 경로 복구
-- ════════════════════════════════════════
-- 테이블 레벨 INSERT/UPDATE 부여 (행 보호는 RLS가 담당: user_id = auth.uid() 강제)
grant select, insert, update, delete on public.votes to authenticated;
-- anon은 계속 차단 (v_board_teaser만 접근)
revoke all on public.votes from anon;

-- 참고: profiles/posts/comments/reports는 컬럼 GRANT 그대로 둔다 — 정상 동작 확인됨
-- (글쓰기·온보딩·신고 작동). 특히 profiles/posts를 테이블 레벨 UPDATE로 넓히면
-- is_admin·role·status 자기변경 차단이 무너지므로 좁게 유지하는 것이 맞다.
-- upsert를 쓰는 테이블은 votes뿐이라 이 문제는 votes에만 존재했다.

-- ════════════════════════════════════════
-- [B] 역할 시스템 — role ('admin'|'manager'|'member')
-- ════════════════════════════════════════
alter table public.profiles add column if not exists role text not null default 'member';
do $$ begin
  alter table public.profiles add constraint profiles_role_check
    check (role in ('admin','manager','member'));
exception when duplicate_object then null; end $$;

-- 기존 is_admin=true → role='admin' 마이그레이션 (is_admin 컬럼은 호환용 유지, 코드는 role만 사용)
update public.profiles set role = 'admin' where is_admin = true and role <> 'admin';

-- role은 본인 UPDATE 컬럼 GRANT(nickname,field,region,updated_at)에 없음 → 자기승격 불가 (07 구조 그대로)

-- 관리자 판별을 role 기준으로 재정의 (기존 정책·RPC가 이 함수를 참조하므로 함수만 교체하면 전체 반영)
create or replace function public.is_admin_user()
returns boolean language sql security definer set search_path = public stable as
$$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false) $$;

-- 매니저 지정 RPC — admin만 실행 가능. manager/member 상호 전환만 허용
-- (admin 승격·강등은 사고 방지 위해 SQL 수동으로만)
create or replace function public.admin_set_role(p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin_user() then
    raise exception 'admin only';
  end if;
  if p_role not in ('manager','member') then
    raise exception 'only manager/member via RPC';
  end if;
  if (select role from public.profiles where id = p_user_id) = 'admin' then
    raise exception 'cannot change admin role via RPC';
  end if;
  update public.profiles set role = p_role, updated_at = now() where id = p_user_id;
end;
$$;
revoke all on function public.admin_set_role(uuid, text) from public, anon;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ════════════════════════════════════════
-- [C] 닉네임 제약 확인 (07에서 이미 걸었음 — 멱등 재확인)
-- ════════════════════════════════════════
do $$ begin
  alter table public.profiles add constraint profiles_nickname_format
    check (nickname is null or nickname ~ '^[가-힣A-Za-z0-9]{2,12}$');
exception when duplicate_object then null; end $$;

-- 기존 닉네임 규칙 위반 검사 (있으면 수동 판단):
-- select id, nickname from public.profiles
-- where nickname is not null and nickname !~ '^[가-힣A-Za-z0-9]{2,12}$';

-- ════════════════════════════════════════
-- 실행 후 확인
-- ════════════════════════════════════════
-- 1) 투표 upsert 경로:
--    select grantee, privilege_type from information_schema.role_table_grants
--    where table_name='votes' and grantee in ('anon','authenticated');
--    기대: authenticated에 SELECT,INSERT,UPDATE,DELETE / anon 없음
-- 2) role 마이그레이션:
--    select nickname, role, is_admin from public.profiles;
