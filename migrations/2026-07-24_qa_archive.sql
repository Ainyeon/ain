-- ═══════════════════════════════════════════════════════════════
-- 2026-07-24_qa_archive.sql — /qa 정적 아카이브 데이터 계약 (rev.2 — RLS 기반)
-- ⚠️ 실행 금지 — 파일 출력만. 박민혁 검토 후 Supabase SQL Editor에서 수동 실행.
-- ⚠️ 실행 전 qa_items 실제 테이블명 확인 — 적재 테이블명이 다르면 [A]는 건너뛰고
--    이하 qa_items를 실제 테이블명으로 치환한다. 뷰 이름(v_qa_published)과
--    뷰 컬럼명은 빌드 스크립트가 참조하므로 바꾸지 않는다.
-- 멱등(여러 번 실행 안전).
--
-- rev.2 변경 (리뷰 반영): SECURITY DEFINER 뷰 폐기 → security_invoker 뷰 + RLS.
--   definer 뷰는 원본 RLS를 우회해 방어선이 뷰 WHERE절 하나였다.
--   이 구조는 ① RLS 정책(published=true)  ② 공개 컬럼 한정 grant  가 원본을
--   직접 지키므로, 뷰 정의를 잘못 고쳐도 미발행 행이 노출되지 않는다 (실제 이중 방어).
--   기존 사이트의 "게이팅 최종 방어선 = RLS" 원칙과도 일치.
--
-- 목적: 오픈채팅 마이닝 Q&A 클러스터의 발행 게이트(published) + 공개 뷰.
--   · 빌드(tools/qa-build)는 v_qa_published 뷰만 anon 키로 읽는다.
--   · /qa 페이지 자체는 정적 HTML 전면 공개 (회원 게이팅 없음 — GEO/AI 검색 목적).
--
-- 롤백:
--   drop view if exists public.v_qa_published;
--   drop policy if exists qa_items_public_read on public.qa_items;
--   revoke all on public.qa_items from anon, authenticated;
--   -- (published 컬럼을 새로 추가한 경우에만) alter table public.qa_items drop column if exists published;
-- ═══════════════════════════════════════════════════════════════

-- ════════════════════════════════════════
-- [A] 테이블 — 이미 적재돼 있으면 create는 스킵되고 [B]가 컬럼을 보강한다
-- ════════════════════════════════════════
create table if not exists public.qa_items (
  id             bigint generated always as identity primary key,
  slug           text not null unique,          -- URL: /qa/{slug}/ (에러코드 제외)
  category       text not null,                 -- 'install' | 'maintenance' | 'price' | 'error-code' | ...
  category_label text,                          -- 화면 표기 (예: '설치·시공'). null이면 category 그대로
  error_code     text,                          -- category='error-code'만: 코드 원문 (예: 'CH05') — URL·h1에 노출
  error_title    text,                          -- 에러코드 서브클러스터 제목 (예: 'LG 시스템에어컨 통신 이상')
  question       text not null,
  answer         text not null,                 -- 원문 그대로. price_flag=true면 금액 단정 서술 금지(빌드가 검증)
  price_flag     boolean not null default false,
  published      boolean not null default false,-- 발행 게이트 — 검수 완료분만 수동 true (1차 15개)
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ════════════════════════════════════════
-- [B] 기존 적재 테이블 보강 — published 게이트 필수, 기본값 false
-- ════════════════════════════════════════
alter table public.qa_items add column if not exists published  boolean not null default false;
alter table public.qa_items add column if not exists price_flag boolean not null default false;
alter table public.qa_items add column if not exists sort_order integer not null default 0;

-- slug URL 안전 제약 (소문자·숫자·하이픈만 — 빌드도 동일 규칙으로 재검증)
do $$ begin
  alter table public.qa_items add constraint qa_items_slug_check
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
exception when duplicate_object then null; end $$;

-- ════════════════════════════════════════
-- [C] RLS — 1차(최종) 방어선: 미발행 행은 역할 무관 원본에서 차단
-- ════════════════════════════════════════
alter table public.qa_items enable row level security;

drop policy if exists qa_items_public_read on public.qa_items;
create policy qa_items_public_read on public.qa_items
  for select to anon, authenticated
  using (published = true);
-- INSERT/UPDATE/DELETE 정책 없음 → 쓰기는 service_role(파이프라인)만 가능

-- 컬럼 한정 grant — 2차 방어선.
-- ⚠️ 지시 d("원본 테이블 직접 권한 미부여")를 문자 그대로 하면 동작 불가:
--    security_invoker 뷰는 호출자(anon) 권한으로 원본을 읽으므로, 테이블에
--    SELECT가 전혀 없으면 뷰 조회가 permission denied가 된다.
--    대신 "전체 grant"가 아니라 공개 컬럼 + published(뷰 WHERE 평가용)로 한정 —
--    id·created_at 등 비공개 컬럼은 anon이 직접 쿼리해도 읽을 수 없다.
revoke all on public.qa_items from anon, authenticated, public;
grant select (slug, category, category_label, error_code, error_title,
              question, answer, price_flag, published, sort_order, updated_at)
  on public.qa_items to anon, authenticated;

-- ════════════════════════════════════════
-- [D] 공개 뷰 — security_invoker: 호출자 권한으로 실행 → RLS 우회 없음.
--     뷰 WHERE가 뚫려도(정의 실수 등) [C]의 RLS가 미발행 행을 막는다.
-- ════════════════════════════════════════
create or replace view public.v_qa_published
with (security_invoker = on) as
select
    slug,
    category,
    category_label,
    error_code,
    error_title,
    question,
    answer,
    price_flag,
    sort_order,
    updated_at
from public.qa_items
where published = true;

-- ⚠️ 디폴트 프리빌리지가 신규 뷰에 ALL을 부여함 — ALL 회수 후 SELECT만 재부여.
revoke all on public.v_qa_published from anon, authenticated, public;
grant select on public.v_qa_published to anon, authenticated;

-- ════════════════════════════════════════
-- 실행 후 확인
-- ════════════════════════════════════════
-- ① 린터: security_definer_view ERROR가 안 떠야 정상 (invoker 뷰)
-- ② 권한 (뷰=SELECT만, 테이블=컬럼 한정 SELECT만):
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name in ('qa_items','v_qa_published') and grantee in ('anon','authenticated');
-- select grantee, column_name from information_schema.role_column_grants
--  where table_name = 'qa_items' and grantee = 'anon';
-- ③ RLS 실측 (anon 키 REST로):
--    /rest/v1/qa_items?select=slug          → published=true 행만 나와야 함
--    /rest/v1/qa_items?select=id            → 42501 (컬럼 미허용)
--    /rest/v1/v_qa_published?select=slug    → published=true 행만
