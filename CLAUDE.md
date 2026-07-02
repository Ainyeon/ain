# CLAUDE.md — ain-site

## 프로젝트
에인연(AIN): HVAC 업계 정보 허브. GitHub Pages 정적 사이트 (빌드 없음, 순수 HTML/JS).

## 스택
- Supabase: https://oqgoibbhnidsveueifet.supabase.co (카카오 OAuth 연동 완료)
- 인증 모듈: auth.js (ainAuth.init / getSession / 'ain:auth' 이벤트)
- SQL 파일: supabase/*.sql (실행은 Supabase SQL Editor에서 수동)

## 절대 규칙
- service_role 키를 어떤 파일에도 쓰지 않는다
- 게이팅의 최종 방어선은 RLS. 프론트 숨김은 UX용
- RLS/GRANT 변경 SQL은 실행하지 말고 파일로만 출력 (사용자가 검토 후 실행)
- 파이프라인(상위 레포 GitHub Actions, service_role 사용)을 깨뜨리는 변경 금지

## 데이터 접근 구조
- briefing → move_in_complexes 직접 조회 (anon 공개 유지 = 미리보기 역할)
- calendar → public_move_in_calendar 뷰 (authenticated 전용 게이팅)
- news, prices → anon 공개

## 현재 상태
- 완료: auth.js, 4개 페이지 인증 UI, profiles 테이블+트리거, 캘린더 게이팅 UI
- 완료: 03_rls_gating.sql + 04_views.sql(security_invoker) 실행 (2026-07-02, anon 401 REST 검증 통과)
- 남은 검증: 브라우저 실전 테스트 (시크릿 창 게이트 UI / 카카오 로그인 데이터 로드)
