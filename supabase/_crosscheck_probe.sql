-- 크로스첵 DB 실측용 — 읽기 전용 SELECT (실행 승인 대기, 파일로만 출력)
-- Supabase SQL Editor에서 개별 실행. 결과로 매트릭스 ❓ 최종 확정.

-- [A-1] 정부사업: "13"이 진짜인가 — v_stat_gov.active_count 재현
select count(*) as active_count
from public.govt_programs
where status = 'active'
  and (application_end_date is null or application_end_date >= current_date);

-- [A-1b] status 분포 (13이 stale인지 판정)
select status, count(*) from public.govt_programs group by status order by 2 desc;

-- [A-1c] 페이지 body가 보여주는 "최근접 1건" + 나머지 (리스트로 뿌릴 후보 + source_url 존재 확인)
select program_name, host_org, application_end_date,
       (application_end_date - current_date) as d_day,
       source_url            -- ← 이미 저장됨. 페이지에 안 뜨는 건 v_stat_gov 경유라서
from public.govt_programs
where status = 'active'
  and (application_end_date is null or application_end_date >= current_date)
order by application_end_date asc nulls last
limit 20;

-- [A-2] 자재시세: 최신 copper/aluminium 존재 여부 (슬랙/페이지 소스)
select item_id, name, display_price, collected_at, status
from public.prices
where item_id in ('copper','aluminium')
order by collected_at desc
limit 10;

-- [A-3] 냉매: prices에 copper/alu 외 id 있나 (없으면 collector 부재 = L1 재확인)
select item_id, count(*) from public.prices group by item_id order by 2 desc;

-- [A-5] 뉴스: 최신 window 건수
select count(*) filter (where status='active') as active_news,
       max(collected_at) as latest
from public.news_items;

-- 참고: 채용/구인구직 테이블은 스키마에 없음(워크넷 blocked) — SELECT 대상 없음
