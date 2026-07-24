-- ═══════════════════════════════════════════════════════════════
-- 2026-07-24_qa_archive.sql — /qa 정적 아카이브 데이터 계약
-- ⚠️ 실행 금지 — 파일 출력만. 박민혁 검토 후 Supabase SQL Editor에서 수동 실행.
-- 멱등(여러 번 실행 안전).
--
-- 목적: 오픈채팅 마이닝 Q&A 클러스터의 발행 게이트(published) + 공개 뷰.
--   · 빌드(tools/qa-build)는 v_qa_published 뷰만 anon 키로 읽는다.
--   · published=false 항목은 뷰 정의 단계에서 차단 — 빌드가 아니라 DB가 최종 방어선.
--   · /qa 페이지 자체는 정적 HTML 전면 공개 (회원 게이팅 없음 — GEO/AI 검색 목적).
--
-- ⚠️ 적재 테이블명이 qa_items가 아니면: [A]는 건너뛰고 [B]~[D]의
--    qa_items를 실제 테이블명으로 치환해서 실행한다. 뷰 이름(v_qa_published)과
--    뷰 컬럼명은 빌드 스크립트가 참조하므로 바꾸지 않는다.
--
-- 롤백:
--   drop view if exists public.v_qa_published;
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
-- [C] 원본 차단 — 사이트 접근은 뷰 경유만 (v_gov_list와 동일 패턴)
-- ════════════════════════════════════════
alter table public.qa_items enable row level security;
revoke all on public.qa_items from anon, authenticated, public;

-- ════════════════════════════════════════
-- [D] 공개 뷰 — definer, published=true만 노출
-- ════════════════════════════════════════
create or replace view public.v_qa_published as
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

-- ⚠️ 디폴트 프리빌리지가 신규 뷰에 ALL을 부여함 — 단순 단일테이블 뷰는 자동
--    업데이터블이라 definer 경유 원본 쓰기 위험. ALL 회수 후 SELECT만 재부여.
revoke all on public.v_qa_published from anon, authenticated, public;
grant select on public.v_qa_published to anon, authenticated;

-- 실행 후 확인 (SELECT만 남아있어야 정상):
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_name in ('qa_items','v_qa_published') and grantee in ('anon','authenticated');
