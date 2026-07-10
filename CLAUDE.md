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
- govt_programs → 원본 anon grant **회수됨** (2026-07-09 실측 401 — 기록상 "예정"이었으나 07-04 psql
  세션에서 이미 실행돼 있었음). anon 접근은 v_stat_gov(집계) + v_gov_list(리스트, supabase/11) 경유만.
  v_gov_list = definer 뷰, SELECT만 grant (신규 뷰에 디폴트로 붙는 쓰기권한은 회수 완료). 파이프라인 무영향

## 배포 규약
- Code는 push까지만 수행하고 종료. 배포 완료 폴링(block=true) 대기 금지
- 배포 확인은 박민혁이 직접 새로고침. 코드 후속작업 필요할 때만 Code 대기
- Pages 빌드가 5분+ building/행이면 `gh api -X POST repos/Ainyeon/ain/pages/builds` 재빌드 1회 후 보고

## 배포 전 회귀 체크 (P1 회귀 사고 이후 강제 — 2026-07-10)
"새로 만든 것" 검증만으론 부족하다. 기존 기능 보존을 아래 목록으로 확인한 뒤에만 push:
1. **전 라우트 200 + 렌더**: `/` `/calendar/` `/prices/` `/gov/` `/news/` `/maker/`
   `/maker/notice/` `/maker/compare/` `/board/free/` `/board/proposal/` `/me/` — 390px·1280px 각각
2. **콘솔 에러 0** (해당 페이지 신규 발생분 기준)
3. **구 기능 목록 통과**: 메이커 캔버스 실렌더(#cv 크기>0) · 게시판 게이트/티저 렌더 ·
   입주 게이팅(비로그인 잠금 카드) · 시세 실데이터
4. **룩 혼재 push 금지**: 전 라우트가 design-tokens/components만 소비하는지
   `grep -rln "assets/css/ain.css" --include="*.html" .` 로 확인 (legacy/ 제외 0이어야 함)
5. **로그인 필요 기능**(글 작성·삭제, 단지명 열람)은 무인 검증 불가 — 종료 요약에 사각으로 명시
6. sw.js 캐시 버전 범프 확인 (정적 CSS 변경 시 ?v= 쿼리도 함께)

## 현재 상태
- 완료: auth.js, 4개 페이지 인증 UI
- 완료: 03~06 SQL 전부 실행 (2026-07-02) — 게이팅 전체 완성, REST+익명 브라우저 검증 통과
- 완료: 02(profiles+트리거)·07(커뮤니티) SQL 실행 (2026-07-04, psql) — ※ 02는 기록과 달리
  미실행 상태였음이 07 적용 중 발견되어 이날 백필과 함께 적용됨. 원본 5테이블 anon 401 검증
- 완료: 캘린더·브리핑 티저 UI (move_in_teaser 기반, 단지명 잠금, total_count 노출)
- 참고: 티저 total_count(561)는 전체 추적 단지 기준 — 캘린더 전문(73)과 집계 기준 다름
- 완료: 메이커 v2+v3 main 배포 (2026-07-05) — 허브 + /maker/notice/(고객 안내문) + /maker/compare/(홍보 카드),
  그라데이션 대표색·배경 슬라이더·크기 12종+직접입력·탭 선택 조절·레이아웃 6종. sw ain-v6
- ⚠️ 미실행: sql/10-fields-expand.sql (profiles_field_check 확장) — 온보딩이 신규 업종 22종을 노출 중이라
  실행 전까지 신규 업종(보일러 등 15종) 선택 시 프로필 저장이 제약 위반으로 실패. 실행엔 사용자 명시 승인 필요
- 완료: 전면 개편 P1 (2026-07-10) — 디자인 토큰 체계(design-tokens.css+components.css, 웜그레이+딥블루 #2D4A9E),
  홈=브리핑 대시보드 승격, /briefing/→/ 리다이렉트(구 URL 보존), /gov/ 신설(v_gov_list 실데이터),
  이모지 전수 제거(라인 SVG 대체), 로고 이원화(symbol.svg+모노 파비콘+PWA 아이콘), sw ain-v7.
  구 홈(오브 히어로)·구 브리핑은 git 히스토리에만 존재. calendar/news/prices는 네비·배선만 신규(풀 리스킨 = 후속)
