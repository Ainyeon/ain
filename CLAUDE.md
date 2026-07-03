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

## 데이터 접근 구조 (게이팅 정책: 단지명 = 회원 전용, 시세·뉴스 = 공개)
- 비로그인 입주 정보 → move_in_teaser 뷰만 (지역+입주월+단계, 단지명 없음, definer 권한)
- briefing/calendar 로그인 → move_in_complexes / public_move_in_calendar (authenticated 전용)
- news, prices → anon 공개 (SEO 유입 자산)
- 메인 티커·카드 → 집계 전용 뷰 3개 (09_public_views.sql): v_ticker_metals(invoker, prices 공개라서)
  / v_stat_movein·v_stat_gov(definer — 원본 anon 차단 상태에서 집계 숫자만 노출)
- govt_programs → 원본 anon grant 회수 예정 (뷰 전환·배포 확인 후 09의 REVOKE 섹션 실행).
  anon 접근은 v_stat_gov 경유만. 파이프라인(service_role)은 무영향

## 배포 규약
- Code는 push까지만 수행하고 종료. 배포 완료 폴링(block=true) 대기 금지
- 배포 확인은 박민혁이 직접 새로고침. 코드 후속작업 필요할 때만 Code 대기
- Pages 빌드가 5분+ building/행이면 `gh api -X POST repos/Ainyeon/ain/pages/builds` 재빌드 1회 후 보고

## 현재 상태
- 완료: auth.js, 4개 페이지 인증 UI, profiles 테이블+트리거
- 완료: 03~06 SQL 전부 실행 (2026-07-02) — 게이팅 전체 완성, REST+익명 브라우저 검증 통과
- 완료: 캘린더·브리핑 티저 UI (move_in_teaser 기반, 단지명 잠금, total_count 노출)
- 참고: 티저 total_count(561)는 전체 추적 단지 기준 — 캘린더 전문(73)과 집계 기준 다름
