-- Step 10: 주력분야(field) 체계 확장 — maker/fields.json 마스터와 동기화
-- 상태: 미실행 (2026-07-10 CLAUDE.md 기준). 실행 전 신규 15종 프로필 저장은 제약 위반.
-- Supabase SQL Editor에서 수동 실행. 멱등.
-- 원칙: 기존 9종 id는 계속 유효 (기존 회원 데이터 무손상), 신규 세부 업종 id 추가 허용.
-- 표기 변환은 프론트 legacy_map(fields.json)이 담당: paper-floor→도배, tile-bath→타일.

alter table public.profiles drop constraint if exists profiles_field_check;
alter table public.profiles add constraint profiles_field_check
  check (field is null or field in (
    -- 기존 9종 (유지)
    'ac-install','ac-clean','panel-restore','interior','film-sheet','paper-floor','tile-bath','movein-clean','custom',
    -- 신규 세부 업종 (fields.json)
    'ac-system','duct-clean','boiler','vent',
    'paper','floor','tile','paint','carpentry','sash',
    'pipe','waterproof',
    'silicone','grout','mold'
  ));

-- 확인:
-- select field, count(*) from public.profiles group by 1;
