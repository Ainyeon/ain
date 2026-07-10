-- ═══════════════════════════════════════════════════════════════
-- 14_hook_column.sql — P3a: 훅(후킹 카피) 컬럼 + 뷰 노출(hook·first_seen_date)
-- 상태: 미실행·사용자 승인 대기 (2026-07-10 main 병합 기록)
-- 범위: ADD COLUMN 3개 + CREATE OR REPLACE VIEW
--       (기존 컬럼 순서·타입 유지, hook·first_seen_date는 끝에 append — 호환 규칙 준수.
--        first_seen_date는 NEW 배지 전역 기준 'KST 당일 수집' 판정용)
--
-- 롤백:
--   ① 뷰 원복: 아래 뷰 정의에서 hook, first_seen_date 두 줄 제거 후 실행
--     (단, CREATE OR REPLACE는 컬럼 제거 불가 — drop view 후 12번 뷰 정의로 재생성
--      + grant select on public.v_gov_list to anon, authenticated; 재부여)
--   ② alter table public.govt_programs
--        drop column if exists hook,
--        drop column if exists hook_model,
--        drop column if exists hooked_at;
-- ═══════════════════════════════════════════════════════════════

alter table public.govt_programs
    add column if not exists hook text,           -- Haiku 후킹 카피 1줄 (수치·마감 미포함 — 카드가 원문 결정론 렌더)
    add column if not exists hook_model text,
    add column if not exists hooked_at timestamptz;

create or replace view public.v_gov_list as
select
    program_name,
    host_org,
    support_target,
    support_summary,
    application_start_date,
    application_end_date,
    application_period_text,
    (application_end_date - (now() at time zone 'Asia/Seoul')::date)::int as d_day,  -- null = 상시
    region,
    source_url,
    summary,
    last_updated,
    hook,              -- P3a: 카드 훅 (NULL이면 카드에서 사업명 폴백)
    first_seen_date    -- P3a: NEW 배지 판정 (재수집에도 불변 — last_updated와 달리 최초 수집일)
from public.govt_programs
where status = 'active'
  and (application_end_date is null
       or application_end_date >= (now() at time zone 'Asia/Seoul')::date);

-- grant 불변 확인 (SELECT만 남아있어야 정상):
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'v_gov_list' and grantee in ('anon','authenticated');
