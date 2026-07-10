-- ═══════════════════════════════════════════════════════════════
-- 11_v_gov_list.sql — 정부사업 공개 리스트 뷰
-- 목적: govt_programs 원본 anon grant 회수(2026-07-04) 이후
--       사이트 /gov/ 리스트 데이터 공급. v_stat_gov(09)와 동일한
--       definer 뷰 패턴 — 원본 차단 유지, 뷰 경유만 노출.
-- 범위: CREATE VIEW + GRANT 추가만. 기존 객체 무변경.
-- 상태: 2026-07-09 실행 완료(세션 한정 승인, psycopg2/SUPABASE_DB_URL).
-- ⚠️ 12_summary_column.sql 적용 전 정의다. 12 적용 후에는 summary를 NULL 예약석으로 되돌리므로 재실행 금지.
--
-- 롤백(원복 1줄):
--   drop view if exists public.v_gov_list;
-- ═══════════════════════════════════════════════════════════════

-- ⚠️ 타임존: DB current_date는 UTC — §2 규칙대로 KST 기준일로 비교한다.
--    (UTC 기준이면 KST 00~09시에 전일 마감건이 리스트에 잔존)
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
    null::text as summary,   -- P2 예약: Haiku 3줄 구조화 요약(지원대상/내용/기한)
    last_updated
from public.govt_programs
where status = 'active'
  and (application_end_date is null
       or application_end_date >= (now() at time zone 'Asia/Seoul')::date);

-- ⚠️ 디폴트 프리빌리지가 신규 뷰에 ALL(INSERT/UPDATE/DELETE 포함)을 부여함.
--    단순 단일테이블 뷰 = 자동 업데이터블 → definer 경유 원본 쓰기 가능 위험.
--    반드시 ALL 회수 후 SELECT만 재부여 (2026-07-09 실행분에 포함됨).
revoke all on public.v_gov_list from anon, authenticated, public;
grant select on public.v_gov_list to anon, authenticated;
