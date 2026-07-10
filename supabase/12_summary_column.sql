-- ═══════════════════════════════════════════════════════════════
-- 12_summary_column.sql — P2: 정부사업 Haiku 요약 컬럼 + 뷰 실컬럼 전환
-- 상태: 프로덕션 적용 완료 (2026-07-10, 상위 파이프라인 백필 19건 완료 기록)
-- ⚠️ 14_hook_column.sql 적용 후에는 뷰의 hook·first_seen_date가 빠지므로 이 구버전을 재실행하지 않는다.
-- 범위: ADD COLUMN 3개 + CREATE OR REPLACE VIEW (컬럼명·순서·타입 동일
--       — null::text 캐스팅 → 실컬럼. grant는 replace 시 자동 유지)
--
-- 롤백:
--   ① 뷰 원복 (아래 뷰 정의에서 summary만 null::text as summary 로 교체 실행)
--   ② alter table public.govt_programs
--        drop column if exists summary,
--        drop column if exists summary_model,
--        drop column if exists summarized_at;
-- ═══════════════════════════════════════════════════════════════

alter table public.govt_programs
    add column if not exists summary text,          -- Haiku 3줄 구조 요약 (지원대상/지원내용/신청기한)
    add column if not exists summary_model text,    -- 생성 모델 기록 (예: claude-haiku-4-5-20251001)
    add column if not exists summarized_at timestamptz;

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
    summary,          -- P2: null::text 예약석 → 실컬럼 전환
    last_updated
from public.govt_programs
where status = 'active'
  and (application_end_date is null
       or application_end_date >= (now() at time zone 'Asia/Seoul')::date);

-- grant 불변 확인 (SELECT만 남아있어야 정상):
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name = 'v_gov_list' and grantee in ('anon','authenticated');
