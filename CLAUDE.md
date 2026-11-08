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
- RLS/GRANT 변경 SQL은 먼저 파일로 출력한다. 운영 적용은 2026-09-26부터 사용자 위임으로 Claude가 Supabase MCP로 실행하되,
  로컬 검증(PGlite 등)·권한 단언 통과 → 적용 전 읽기 전용 점검 → 적용 → 적용 후 점검·보고 순서를 지킨다
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
   `/maker/notice/` `/maker/compare/` `/board/free/` `/board/proposal/` `/me/` `/edu/` `/edu/jobs/` `/edu/jobs/?kind=seek` `/area/`
   `/work/`(비로그인 안내) `/work/?demo=1`(오늘·일정·작업·고객·매출·설정) `/c/#demo` — 390px·1280px 각각
   (`_dev/` 아래 약관 초안은 Jekyll이 배포하지 않는 개발 전용. 요금제는 `/pricing/` — 운영자 로그인에서만 본문이 보이고
   비로그인·일반 회원은 "없는 페이지"여야 한다. 본문은 DB `admin_drafts`(19), 원본 `_private/pricing.html`은 커밋하지 않는다)
2. **콘솔 에러 0** (해당 페이지 신규 발생분 기준)
3. **구 기능 목록 통과**: 메이커 캔버스 실렌더(#cv 크기>0) · 게시판 게이트/티저 렌더 ·
   입주 게이팅(비로그인 잠금 카드) · 시세 실데이터 · 업무 데모 견적서/보고서 이미지 생성 · 카드 데모 문의 접수
   · `node tools/test-*.js` 전부 + `node tools/test-work-sql.mjs`·`test-open-board-sql.mjs`·`test-movein-weather-sql.mjs`·`test-member-grades-sql.mjs`·`test-web-push-sql.mjs`(PGlite) · `deno test -A supabase/functions/push-drain/drain_test.ts` · 약관을 채운 뒤 `node tools/check-legal.js`
   · (21 적용 후) 비로그인 `/board/free/`·`/board/proposal/` = 목록·본문·댓글이 보이고 쓰기·댓글·공감·투표 자리는 로그인 안내,
     입주 캘린더 글은 본문 잠김 · 구인·구직(`/edu/jobs/`)은 여전히 회원 전용
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
- 참고: 티저 total_count는 **전체 이력이 아니다** — move_in_teaser·v_stat_movein 실측 정의는
  `is_public = true AND expected_move_in >= CURRENT_DATE`를 complex_name_ad 기준으로 중복 제거한 수
  (2026-09-09 실측 567). 캘린더 전문(73)과 집계 기준이 다르며, 화면에는 이 분모를 함께 적는다
- 완료: 메이커 v2+v3 main 배포 (2026-07-05) — 허브 + /maker/notice/(고객 안내문) + /maker/compare/(홍보 카드),
  그라데이션 대표색·배경 슬라이더·크기 12종+직접입력·탭 선택 조절·레이아웃 6종. sw ain-v6
- 완료: sql/10-fields-expand.sql — 2026-09-09 읽기 전용 실측으로 profiles_field_check가 이미
  기존 9종 + 신규 15종(총 24개 id)으로 확장돼 있음을 확인. 이전 "미실행" 기록은 낡은 것이었다
- 완료: 전면 개편 P1 (2026-07-10) — 디자인 토큰 체계(design-tokens.css+components.css, 웜그레이+딥블루 #2D4A9E),
  홈=브리핑 대시보드 승격, /briefing/→/ 리다이렉트(구 URL 보존), /gov/ 신설(v_gov_list 실데이터),
  이모지 전수 제거(라인 SVG 대체), 로고 이원화(symbol.svg+모노 파비콘+PWA 아이콘), sw ain-v7.
  구 홈(오브 히어로)·구 브리핑은 git 히스토리에만 존재. calendar/news/prices는 네비·배선만 신규(풀 리스킨 = 후속)
- 완료: 첫 출시 (2026-09-09 배포) — /edu/ 교육 찾기, /area/ 내 지역, 홈 네 방향 진입,
  메뉴 5개(홈·교육·내 지역·도구·커뮤니티), 관심 저장·익명 글·교육 후기·제안 루프 확장,
  내 활동(/me/), **sw ain-v25 + 전 자산 ?v=25**. 상세는 docs/launch/IMPLEMENTATION.md
- 완료: supabase/15_launch.sql 운영 적용 (2026-09-09, migration version 20260909091041
  `ain_first_launch_saved_items_anonymous_community`) — saved_items · 익명 v_posts ·
  제안 상태 확장 · notice_complexes · 연락처 정리 트리거 · 반복 작성 RPC.
  단지명 시드 1건도 같은 날 적용(공개 repo 밖 파일).
  실제 로그인 계정의 관심 저장·내 활동 조회와 익명 선택지 노출을 확인
- 2026-09-26: 업무 관리 /work/ · 시공 카드 /c/ (feat/work-pro) + Codex 콘텐츠 자동화 인수(교육·일자리 묶기, 입주정보 개명,
  회원 구인·구직 /edu/jobs/, 교육 자동 수집 표시). 약관·처리방침 초안은 _dev/(미배포). 스펙 docs/work/SPEC.md.
  요금제는 시장 진입(모두의 창업 결과 발표 후) 전까지 운영자 전용: /pricing/ 는 빈 틀, 본문은 admin_drafts(slug=pricing,
  site_19_admin_drafts 적용 2026-09-26). 고칠 땐 _private/pricing.html 수정 → admin_drafts 갱신(md5 대조).
  _config.yml 로 docs·supabase·sql·tools·CLAUDE.md·HANDOFF*.md 는 사이트에 배포하지 않는다(저장소는 공개라 GitHub에선 보임).
  **운영 SQL 적용 완료(Claude, 사용자 위임)**: site_17_work · site_16_jobs_board · pipe_18_program_notices (apply_migration, 전후 점검).
  sw ain-v29, 전 자산 ?v=29(design-tokens ?v=11 유지), maker-core ASSET_V=29 (v29: 교육 표시 보정·운영자 전용 요금제).
  업무·카드 화면은 innerHTML 금지(test-work-contract.js가 검사). 베타 종료일은 SQL work_user_is_pro()와 work-logic.js PLAN.betaEnd 두 곳.
- 2026-09-28: 글래스(Clear Depth v2 — 위층만: .tnav ≥769 sticky · .tabbar · 메이커 .action-bar, blur ≤2면,
  @supports 불투명 폴백·투명도 줄이기·고대비·인쇄 대응) + 전체 검토 반영(정보·커뮤니티·도구). 토큰: --c-ink-faint #6E6A61,
  입력 테두리 --c-control. **sw ain-v30, 전 자산 ?v=30, design-tokens ?v=12**, maker-core ASSET_V=30.
  업무 문서(견적서·보고서) 색은 work-doc.js C0 고정 — 화면 토큰을 바꿔도 문서는 흰 종이
- 2026-11-08 (feat/open-board-daily-info, **운영 SQL 적용 완료**: site_21_open_board · site_22_price_history ·
  site_22b_price_history_backfill — 적용 후 anon REST로 공개·차단 확인, 캘린더 글 4건·시세 132/120일 확인,
  게시판 이용 규칙 공지(글 9) 게시): 자유게시판·제안 비회원 읽기(supabase/21 — v_posts anon,
  v_comments·v_post_stats 신설, 원본 posts·comments·votes 는 회원 전용 그대로) · 입주 캘린더 글 자동 게시
  (move_in_contents 트리거 → 자유게시판, 운영자 이름, 비회원은 본문 null) · 시세 날짜별 기록 price_history(22, 22b 백필) +
  /prices/ 구리 원화 kg값. **적용 순서: SQL 21·22·22b → 프런트 push** (프런트만 먼저 나가면 비회원 게시판이 "준비 중").
  sw VERSION 은 그대로(ain-v35, 배포 때 판단), ain-community·board-*.js 만 ?v=31. 공지 초안: docs/community/notice-drafts.md
- 2026-11-08 (feat/movein-detail-weather, **운영 SQL 적용 완료**: site_23_movein_detail_weather — 적용 후 anon REST로
  move_in_complexes 401·weather_daily 읽기 200·쓰기 401 확인): 입주 단지 청약홈 상세 칸(house_manage_no·supply_households=공급규모·
  builder·developer·house_types, 회원 전용 그대로) + 현장 날씨 weather_daily(기상청 단기예보, 시·도청 격자, anon 읽기).
  채우는 쪽은 ain-automation feat/applyhome-detail-weather(move_in_radar 상세 붙이기 하루 200곳 · collect_weather.py 05:40 KST).
  화면: 홈 '현장 날씨'(주의 기준 = 강수확률 60%↑·풍속 9m/s↑·최고 33℃↑·최저 -12℃↓, index.html 한 곳) · 홈 입주 줄에 분양 세대 ·
  /area/ 회원 카드에 분양·시공·주택형. area.js 만 ?v=31(sw SHELL 동일), VERSION 은 그대로 ain-v35.
  공급규모는 단지 총세대수가 아니다(조합원분 등 제외) — 화면에 '청약홈 공급규모'로 적는다
- 2026-11-08 (feat/member-grades, **운영 SQL 적용 완료**: site_24_member_grades — 적용 후 anon REST로 v_posts author_grade 200·
  v_member_grades·v_my_grade 401 확인): 회원 등급(무료, 카페식) 막내(가입)·기사(글 1 또는 댓글 3)·반장(글 10 또는 댓글 30, 가입 30일)·
  명장(운영자 지정 = profiles.grade_pin, 회원은 못 고침). 하루 글 3·댓글 10까지만 셈, 익명 글·입주 캘린더 자동 글 제외.
  남에게는 등급 이름만(v_posts·v_comments author_grade, 익명 글 null), 숫자는 본인만(v_my_grade, /me/ '회원 등급').
  등급으로 읽기를 막지 않는다. 등급 이름·조건 문구는 ain-community.js GRADES(계산은 SQL 24·25가 정본 — 바꿀 땐 둘 다).
  이름은 25_grade_names(site_25_grade_names, 사용자 A안: 새싹·일꾼·단골·고수 → 막내·기사·반장·명장). 24 를 다시 돌리면 이름이 되돌아간다.
  운영자·매니저는 등급 대신 역할 배지. components.css ?v=31(.grade-badge) · ain-community.js ?v=33, VERSION 은 ain-v35 그대로.
  명장 지정: update profiles set grade_pin = '명장' where id = …(운영 SQL, 사용자 결정 후)
- 2026-11-08 (feat/home-alive, 화면만 — DB 변경 없음): 홈 정리. 네 방향 카드·바로가기 패널 제거(위 탭·아래 탭바와 중복),
  1줄 게시판 스트립 → '현장 게시판' 칸을 히어로 바로 아래로(ain-community.js readPosts·readStats 재사용, 사람 글 최신 5개,
  입주 캘린더 자동 글은 한 줄로 묶음, 사람 글이 3개 미만이면 첫 글 권유 + '기사' 등급 안내). 히어로 숫자 0 은 숨김(setStat),
  집계 기준·날씨 기준 안내는 <details class="note"> '기준 보기'로 접음, 비회원 입주 자물쇠 줄 지역당 2개, 업무 관리 칸은 도구 위로,
  바로가기에서 빠진 길은 시세 스트립 '전체'(/prices/)·입주정보 '캘린더'(/calendar/)·게시판 칸 '제안·건의'로 대신.
  게시판 목록은 공감·댓글·조회가 0 이면 적지 않음. authorBadge: 운영자·매니저는 분야 뱃지 없이 역할 뱃지만, 닉네임이 역할 이름과 같으면 생략.
  ain-community.js ?v=34(홈도 이제 불러옴) · board-free/proposal.js ?v=32, VERSION 은 ain-v35 그대로
- 2026-11-08 (feat/web-push): 앱 출시 1단계 = 웹 푸시(사용자 결정: ① 웹 푸시 → ② 플레이스토어 → ③ 앱스토어, 앱인토스 보류).
  supabase/26_web_push.sql(push_subscriptions·push_outbox 둘 다 직접 접근 0, 회원은 save/delete_push_subscription 으로 자기 기기만,
  알려진 푸시 서비스 주소만) + 트리거(댓글 → 글쓴이, 공감·찬성 → 글마다 하루 1번) + pg_cron 'push-movein-daily' 09:00 KST
  (관심 단지 입주 30·7일, 월 단위는 30일만) + pg_net 으로 Edge Function push-drain 깨움(verify_jwt=false — 대기 줄만 보냄).
  VAPID 비밀키는 함수 비밀값에만, 공개키는 me/index.html VAPID_PUBLIC_KEY. 로그아웃(auth.js logout)은 이 기기 구독을 먼저 지운다.
  아이폰은 홈 화면에 추가한 PWA 에서만 켤 수 있다(iOS 16.4+). sw.js 에 push·notificationclick, auth.js ?v=31, VERSION 은 ain-v35 그대로
- 미검증(출시 후 남은 것): 새 카카오 인증 왕복, 다른 실제 기기, 모바일 이미지 저장·공유,
  서비스워커 업그레이드·오프라인. 자세한 것은 docs/launch/RELEASE_AUDIT.md §10
