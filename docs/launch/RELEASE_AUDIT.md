# 첫 출시 완료 증거 대조

2026-09-09 · 브랜치 `codex/ain-launch` (기준 `main` dae7498) · 개인 정본 /Users/minhyeok/repos/personal/ain
대조 대상: `CODE_IMPLEMENTATION_SPEC.md` 의 A1~A8 · 고침 ①~⑩ · B1~B10 · §10 · §2

**운영 SQL·배포·push·커밋·파이프라인 실행·계정 변경은 없습니다.**

## 증거 등급

| 표기 | 뜻 |
|---|---|
| **로컬 검증** | 이 저장소의 검사나 로컬 브라우저에서 실제로 확인함 |
| **합성 검증** | PGlite 0.5.8 / PostgreSQL 18.3 인메모리에서 확인함. 운영은 17.6이라 같은 환경이 아님 |
| **운영 미적용** | 코드·SQL은 있으나 운영 DB에 적용하지 않음. 지금 상태에서는 동작하지 않음 |
| **실기기 미검증** | 실제 카카오 계정·기기가 있어야만 확인 가능 |

**합성 SQL 51/51 통과를 "API·로그인 동작이 다 된다"로 읽으면 안 됩니다.** 그 51개는
SQL 층위(권한·제약·RLS·트리거·RPC)와 조회 열 계약만 확인한 것이고, PostgREST 응답 형태·
카카오 세션·브라우저 저장·두 기기 동기화는 그 안에 없습니다.
(검사 번호는 항목이 늘 때 밀리므로 아래에서는 번호 대신 검사 이름·범위로 씁니다.)

---

## 1. 이번 감사에서 나온 코드 미충족

읽기 전용 감사 중 발견했고, 사용자 지시로 **결함 2건 수정 + 중복 매핑 1건 정리**만 했습니다
(그 외 코드는 손대지 않음). (a)·(c)가 결함 수정, (b)는 중복 정리입니다.

### (a) 후기 열이 조회에서 빠짐 — 수정함
- **경로**: `assets/js/ain-community.js` `POST_COLS` → `readPosts()` → `v_posts` select
- **증상**: `v_posts`에 `review_kind/review_cost/review_subsidy/review_done_month`가 있어도
  `POST_COLS`에서 빠져 PostgREST가 내려보내지 않음. 결과적으로 모든 글이 일반 글로 취급되고
  교육 상세의 후기 건수가 늘 0, 목록의 수료 시점 배지도 사라짐. 화면상으로는 "후기가 없다"로만 보임
- **재현**: `node tools/test-posts-contract.js` — `POST_COLS`에서 네 열을 지우면
  `review_kind가 선택에서 빠짐 → 후기가 일반 글로 취급됨`으로 실패.
  검수자 쪽도 실제 `POST_COLS` 문자열로 합성 `v_posts`를 조회하는 계약 검사를 추가해
  같은 결함을 재현했고, 수정 후 51/51로 통과했습니다
- **수정**: `POST_COLS`에 네 열 추가. 계약 검사 `tools/test-posts-contract.js` 신설
  (POST_COLS를 복제해 비교하지 않고, 가짜 클라이언트가 **요청한 열만 남겨** 돌려주는 방식)
- **SQL 변경 없음** — 해시 그대로

### (b) 국비 유형 매핑 3중 사본 — 정리함 (결함 아님)
- **경로**: `board/board-free.js` `reviewFields()`(작성 폼)와 `renderDetail()`(상세),
  `edu/edu.js` `detailHtml()` 세 곳에 같은 매핑이 각각 있었음
- **정정**: 검수 지적은 "상세에서 ReferenceError"였으나, 실제 파일에는 `renderDetail()` 안에
  같은 이름의 지역 매핑이 따로 있어 **오류는 나지 않았습니다.** 오류 주장은 철회하고
  중복 매핑 정리로만 기록합니다
- **수정**: `ainCommunity.SUBSIDY_LABELS` / `subsidyLabel()` 한 곳으로 올리고 세 사본 제거
- **근거**: `tools/test-posts-contract.js`가 합성 후기(`card` / 22,500원 / 2026-08)를
  **실제 `renderDetail`까지 흘려 보내** 화면 문자열에 `국민내일배움카드` · `22,500원` ·
  `2026.08 수료`가 찍히는지 확인. 매핑을 못 찾게 만들면 실패

### (c) 저장한 단지로 다시 찾기 경로 — 수정함
- **경로**: `me/index.html` `SAVE_KINDS.complex.href` → `/area/`
- **증상**: 저장한 `target_id`를 버리고 `/area/`만 열어, 전국에서 저장한 단지는
  수도권 기본 목록(첫 60건)에 없어 다시 찾지 못함. §2의 "다시 찾기"가 성립하지 않음
- **수정**: `/area/?complex=<id>` 로 id를 넘기고, `area/area.js`에 `focusComplexHtml()` 추가.
  서버 쿼리는 `.eq('id', id).eq('is_public', true)` **둘뿐** — 지역·날짜 기본 필터를 태우지 않고,
  공개 대상에서 빠진 단지는 **이름 자체를 응답으로 받지 않습니다**(프론트에서 거르지 않음).
  0행이면 사유 안내와 저장 해제 수단을 줍니다. 비회원에게는 단지명을 보여 주지 않습니다.
  기존 페이지·저장 구조를 그대로 씁니다
- **재현/검증**: `node tools/test-saved-return.js` — 가짜 서버가 요청 필터를 실제로 적용하고
  선택한 열만 돌려줍니다. 링크에서 id를 빼거나, 공개 조건을 프론트 필터로 되돌리면 실패합니다
- **공고 링크**(`/area/?tab=notice`)는 `target_id`를 쓰지 않지만 현재 공고가 1건이라
  탭 조회로 도달합니다. 새 기능으로 넓히지 않았습니다

### 고치지 않고 기록만 하는 것
- `assets/js/ain-community.js:154` 의 legacy 폴백(`posts` + `author:profiles`)은
  **SQL15 적용 후 영구히 쓸 수 없습니다**(author_id SELECT 회수). 설계상 의도이며,
  적용 전 단계에서만 쓰이는 경로입니다. 폴백 판정은 `missingRelation()`이 하고
  권한 오류(42501)는 폴백으로 넘기지 않습니다

---

## 2. A1~A8

| # | 결과 | 파일·함수 | 검사 |
|---|---|---|---|
| A1 교육 목록·필터·카드 | **로컬 검증** | `edu/index.html`, `edu/edu.js`(`render`/`cardHtml`/`detailHtml`), `edu/edu-logic.js`(`groupSections`/`matches`/`sectionOf`/`isExpired`/`isStale`), 데이터 `assets/data/education.json` ← `tools/build-edu-json.py` | `build-edu-json.py`(계수 assert), `test-edu-logic.js`. 브라우저 390/1280에서 카드 14개·섹션 6·2·6 확인 |
| A2 관심 저장 | **코드 완료 · 운영 미적용** | `ainCommunity.loadSaves/addSave/removeSave/savesReady`, `saveBtn()`(edu·area), `me/index.html` 관심 저장 패널, 복귀 경로 `/area/?complex=<id>` → `area/area.js` `focusComplexHtml()`(서버에서 `id`+`is_public`만) | 격리·해제·세션 전환 후 유지는 **합성 검증**(저장 계정 격리 / 타 계정 조회·위조·삭제 차단 / 역할·세션 전환 후 유지 / 해제 유지). 다시 찾기 경로는 `test-saved-return.js`(회귀 주입 실패 확인). **저장 자체는 SQL15 미적용이라 동작 안 함** |
| A3 내 활동 | **코드 완료 · 운영 미적용** | `me/index.html` `renderSaved`/`renderMine`, `ainCommunity.readMyPosts`(서버에서 본인 글만) | 로그아웃 경합은 `test-auth-race.js`. 목록 내용은 로그인 필요 |
| A4 도구 허브 연결 | **로컬 검증** | 메뉴 5개(`ain-common.js` TABS), 홈 진입 카드 `index.html` `.ways` | 브라우저에서 `/maker/` 도달 확인 |
| A5 모집 공고 요약 | **로컬 검증(공개분)** | `assets/data/notices.json`, `area/area.js` `noticeHtml()` | 브라우저 렌더 확인. 단지명은 공개 파일에 없음 → 회원 조회는 운영 미적용 |
| A6 교육 후기 | **코드 완료 · 운영 미적용** | 입력 `board/board-free.js` `reviewFields()`(금액 step=1·국비·수료월, 전부 선택), 서버 필터 `sinceMonth()`+`.or(...)`, 표시 `renderDetail` `reviewFacts`, 교육 상세 `edu/edu.js` `detailHtml` + `#rSince` | `test-posts-contract.js`(열 보존→상세 렌더), `test-edu-logic.js`(월 경계·윤년). 경계는 **합성 검증**(금액·국비 미기재 허용 / 같은 기관 다른 회차 추가 / 음수 금액·잘못된 월 거부 / 일반 글의 후기 금액 거부) |
| A7 교육 제보 | **로컬 검증(진입) · 운영 미적용(작성)** | `edu/edu.js` `?form=edu_tip` → `board/board-free.js` `FORM_PRESETS.edu_tip`(`review_kind='tip'`) | 진입 링크 확인. 작성은 로그인 필요 |
| A8 익명 | **합성 검증 · 운영 미적용** | `supabase/15_launch.sql` [B] `revoke select on posts` + 컬럼 GRANT + `v_posts`, [C] `admin_post_author`+`admin_author_lookups`, 프론트 `readPosts`/`authorBadgeOf`/`anonymousReady` | 합성 검증(익명 제안 작성 / 본인 소유 표시하되 신원 가림 / `author_id` 직접 조회·조인 차단 / 타 회원 수정·삭제 차단 / 운영자 조회 제한과 감사). `test-posts-contract.js`가 `author_id`를 요청하지 않음을 확인 |

---

## 3. 고침 ①~⑩

| # | 결과 | 근거 위치 |
|---|---|---|
| ① 제안 작성창 hidden | **로컬 검증** | `board/board.css:20` `.write-form[hidden]{display:none}` |
| ② 채택 규칙 문구 | **로컬 검증** | `board/board-proposal.js:24` 배너 문구, 상태 6종(`STATUS_LABELS`). 브라우저에서 새 문구 확인 |
| ③ 공고 중복 | **로컬 검증(표시단)** | `ain-common.js` `govDedupKey`/`dedupGov` → `index.html:395`, `gov/index.html:154`. `/gov/` 실데이터 3행→2행, 카운트 2건. **수집단(다른 레포)은 고치지 않았고 중복이 왜 생기는지도 확인하지 않았습니다** |
| ④ 날짜 필드 분리 | **로컬 검증** | `tools/build-edu-json.py` `posted_raw`/`apply_start_raw`/`apply_end_raw`/`apply_end_at`/`checked_at`, `edu-logic.js` `isExpired`·`isStale` |
| ⑤ 안내문 기본값 | **로컬 검증** | `maker/copy.json`(A/S 22개 + 기술 조건 49줄 제거), `maker/notice/notice.js` `SECTION_HINTS`. localStorage 비운 새 상태에서 빈 칸·안내 확인, 저장 초안은 보존 확인 |
| ⑥ 뉴스 SOURCE | **로컬 검증(표시단)** | `ain-common.js` `fillNewsSource` → `news/index.html:144`. `/news/` 30건 잔여 0, REST 원본 60건에 규칙 적용 잔여 0. 발생 지점은 수집단 `scripts/collect_news.py:376` 프롬프트로 특정(B8). **수집단은 고치지 않았습니다** |
| ⑦ 회원 공종 | **실측 확인(기존 재사용)** | `profiles_field_check` 24개 id 이미 적용. 새 열 없음. `ainCommunity.FIELD_LABELS`/`FIELD_LEGACY` |
| ⑧ 집계 분모 | **로컬 검증** | `index.html:290` `DENOM_NOTE`(2곳 출력), `area/area.js:16` |
| ⑨ 월 단위 D-day | **로컬 검증** | `index.html` `isMonthOnly`/`moveInBadge`, `area/area.js` `ddayHtml`/`moveInLabel`, `calendar/index.html` 티저 문구 — 세 호출부 |
| ⑩ 모바일 스크롤 | **로컬 검증** | `maker/maker.css:24` `.preview-col{order:-1}`. 390px에서 preview top 260 < form top 782 |

---

## 4. B1~B10 (구현 전 확인 항목)

| # | 확인 결과 |
|---|---|
| B1 저장 위치·권한·스키마 | 확인 후 신규 `saved_items`로 결정. 본인 행 RLS, `unique(user_id,target_type,target_id)`. **합성 검증**, 운영 미적용 |
| B2 `profile.field` 값·제약 | 실측으로 24개 id 확장 상태 확인 → **새 열 추가 없이 재사용** |
| B3 가입 → 공종 저장 → 재로그인 유지 | **실기기 미검증.** 온보딩 코드(`onboard/index.html`)는 기존 그대로 두었고 실제 세션 왕복은 확인 못 함 |
| B4 신고 기존 유무 | 기존 `reports` 테이블·`ainCommunity.report()` 존재 확인 → 재사용. 사유만 §10의 4종으로 교체 |
| B5 비회원 노출 현황 | `v_board_teaser`(제목·상태·시각, 본문·작성자 없음)만 anon 공개. 목록 열람 가능·본문 회원 전용 유지 |
| B6 캘린더 수집 항목·분모 | 분모 정의 확정(공개 + 입주예정일 오늘 이후 + 단지명 중복 제거). 수집 주기도 **원격 원문으로 확인** — `move_in_radar.yml` `cron "0 21 * * *"`(06:00 KST, METRO+NATION), 최근 2회 실행 성공. 데이터도 갱신 중(`move_in_complexes` 1,502행, 최신 2026-09-08 23:09 UTC = 오늘 08:09 KST). 근거 `AUTOMATION_LIVE_READONLY.json` · `DATA_FRESHNESS_READONLY.json`. **이 저장소에는 수집 코드가 없으므로 로직 자체는 대조하지 않았습니다** |
| B7 중복 판정 키 | 실측으로 `호스트+경로+pblancId` 확정. 제목만으로는 병합하지 않음 |
| B8 뉴스 SOURCE 발생 지점 | **수집단에서 특정됨.** 실행 커밋 `5073ce24`의 `scripts/collect_news.py` 376행 프롬프트가 `SOURCE에 따르면` 표기를 그대로 요구하고, 554행이 `status active`, 702~706행이 신규 URL만 저장. 즉 자리표시자는 요약 생성 시점에 들어갑니다. **수집단은 고치지 않았고**(다른 레포) 이 저장소는 표시단 치환만 합니다 |
| B9 실기기 저장·공유 | **실기기 미검증** |
| B10 공고 요약·출처 표기 | 요약 + 원문 URL + 첨부 근거로 확정. 담당자 연락처·QR는 옮기지 않음 |

---

## 5. §10 익명·신고·제보 / §2 계정 저장

| 항목 | 결과 | 근거 |
|---|---|---|
| 익명 — API 응답에 작성자 없음 | **합성 검증 · 운영 미적용** | 합성 검증(`author_id` 직접 select·프로필 조인 모두 차단). `POST_COLS`에 `author_id` 없음 |
| 익명 — 운영자만 제한 조회 | **합성 검증 · 운영 미적용** | 합성 검증(회원의 운영자 RPC 사용 차단 / 운영자 조회 동작과 감사 기록). 목적(`duplicate`/`abuse`) 필수, `admin_author_lookups`에 기록 |
| 익명 — 본인 수정·삭제 | **합성 검증 · 운영 미적용** | 합성 검증(본인 익명 글 수정 / 타 회원 수정·삭제 차단 / 5표 이상 제안 본인 삭제). 프론트 `#editPost`/`#delPost`(자유·제안) |
| 신고 사유 4종 | **로컬 검증(코드)** | `REPORT_REASONS = ['광고','개인정보 노출','욕설·비방','사실과 다름']` |
| 반복 작성 플래그 | **합성 검증 · 운영 미적용** | `admin_repeat_flags`(작성자 기준, `post_id`+플래그만). 합성 검증(회원의 반복 플래그 조회 차단 / 판정이 주제가 아닌 작성자 기준) |
| 개인 연락처만 가림 | **합성 검증 · 운영 미적용** | 서버 `mask_contacts`+트리거(합성 검증 — 신규 글·댓글 원문에서 연락처 가림과 공식 URL 보존), 화면 이중 방어 `maskContacts`(`test-common-js.js`). 공식 링크 보존 확인. **완전 탐지 아님** |
| 이해관계 표시·운영자 배지 | **로컬 검증(코드)** | 제보 폼 안내 문구, `role-badge`(기존) |
| §2 계정 저장 — 저장/해제 | **합성 검증 · 운영 미적용** | 합성 검증(저장 계정 귀속 / 본인 해제 유지) |
| §2 — 재로그인 후 유지 | **합성 검증(역할·세션 전환) · 실기기 미검증** | 합성 검증(역할·세션 전환 후 저장 유지)은 DB 수준만 확인. 실제 카카오 재로그인은 미검증 |
| §2 — **다른 기기에서 다시 찾기** | **실기기 미검증** | 계정 저장 구조상 성립하지만 두 기기로 확인해야 완료 |

---

## 6. 배포 순서와 구버전 영향

### 6.1 순서: **프론트 먼저, SQL15 나중**
- **프론트 먼저 배포(SQL 전)** — 안전합니다. `readPosts`가 `v_posts` 부재를 감지해
  기존 `posts`+`profiles` 경로로 내려갑니다. 저장 버튼은 비활성, 익명 선택지는 표시되지 않습니다
- **SQL15 먼저 적용(프론트 전)** — **게시판이 깨집니다.** dae7498 프론트는
  `posts.author_id`를 조인해 읽는데 SQL15가 그 SELECT를 회수합니다
- 되돌릴 때도 같은 이유로 "프론트만 옛 버전으로" 가 성립하지 않습니다(`15_launch.sql` [롤백] 절)

### 6.2 구버전 SW·브라우저가 남을 때

**확인한 것 (로컬 정적 검사)**
- 자산 참조가 전부 `?v=25`이고 SW `ain-v25`의 SHELL과 글자 그대로 일치합니다.
  구버전(`v=24` 이하) 참조는 0건
- SHELL 40개가 로컬 서버에서 모두 200으로 응답합니다

**확인하지 못한 것**
- **SW 업그레이드 자체를 실행해 보지 못했습니다.** 로컬 미리보기 브라우저가 SW 등록을 막아
  (`Failed to register a ServiceWorker … An unknown error occurred when fetching the script`)
  설치·활성화·구 캐시 삭제·오프라인 폴백을 한 번도 돌리지 않았습니다
- 따라서 아래는 코드를 읽고 세운 예상이며 **보장이 아닙니다**
  - 새 HTML이 `?v=25`만 요청하므로 구 캐시의 `?v=24` 항목은 히트하지 않을 것 →
    구 함수가 새 페이지에 섞이지 않을 것
  - `install`의 `addAll`은 하나라도 실패하면 설치가 중단되고 구 SW가 남습니다.
    SHELL 40개는 **로컬에서만** 200을 확인했으므로 **배포 후 실제 도메인에서 다시 확인해야 합니다**
  - SW 없이 HTTP 캐시만 있는 브라우저는 옛 HTML을 잠시 볼 수 있고, 그 HTML은 `?v=24` 세트를
    가리키므로 통째로 이전 상태가 될 것
- **배포 후 첫 확인 항목**: 실기기에서 새로고침 → `ain-v25` 활성 여부, 구 캐시 삭제 여부,
  콘솔 신규 오류 유무

### 6.3 SQL 적용 전 확인할 기존 데이터 조건
1. `posts` / `comments` 행 수 — 길이 제약을 다시 거는 구간이 있어, 기존 행이 새 제약을
   위반하면 트랜잭션 전체가 실패합니다. 검수자 실측 기준 **2026-09-09 현재 posts=0, comments=0**이라
   위반 가능성이 없으나, **적용 직전에 다시 세어야 합니다**
   - `select count(*) from public.posts;` / `public.comments`
   - 행이 생겼다면: `select count(*) from public.posts where title !~ '[^[:space:]]' or char_length(title) > 80;` (0이어야 함)
2. `posts.status`에 `open/adopted/building/shipped` 외 값이 없을 것
3. `saved_items` / `notice_complexes` / `v_posts` 이름이 비어 있을 것(신규 생성 대상)
4. 전체가 한 트랜잭션(`begin`…`commit`)이라 중간 실패 시 부분 적용은 남지 않습니다

### 6.4 실제 카카오 계정과 두 기기가 있어야만 확인되는 것
- 로그인 왕복과 `redirectTo` 복귀(쿼리 보존 포함): 교육 상세 `?id=`, 게시판 `?ref=`/`?form=`/`?since=`, `/area/?complex=`
- 글 작성·수정·삭제, 댓글, 투표, 익명 작성과 운영자 작성자 조회
- 관심 저장·해제 → **재로그인 후 유지** → **다른 기기에서 다시 찾기** (§2의 네 요건 중 뒤 둘)
- 온보딩 공종 저장 후 재로그인 유지 (B3)
- 메이커 저장·공유·카톡 전송 (B9)
- PostgREST 실제 응답 형태(컬럼 GRANT 거부가 REST에서 어떤 오류로 오는지)
- 서비스워커 설치·갱신·오프라인 폴백

---

## 7. 실행한 검사

```bash
python3 tools/build-edu-json.py     # 원장 → JSON + 계수 assert
node tools/test-edu-logic.js        # 섹션·필터·마감 경과·수료 시점 경계(윤년 포함)
node tools/test-common-js.js        # SOURCE 치환 · 공고 중복 · 연락처 가림
node tools/test-posts-contract.js   # 선택 열 계약 + 후기 상세 렌더
node tools/test-saved-return.js     # 저장 → 다시 찾기 경로 (서버 공개 조건·0행 처리 포함)
node tools/test-admin-render.js     # 관리자 렌더·이벤트·RPC 인자
node tools/test-auth-race.js        # 로그아웃 경합
```
전부 통과. 새 검사 2개(`test-posts-contract.js`·`test-saved-return.js`)는
회귀를 주입해 실패하는 것까지 확인했습니다.

검수자 재현본: `check-auth-race.cjs` PASS,
`check-admin-ui.cjs`는 이름 기준으로 바꿔 돌리면 PASS(인덱스 가정만 어긋남).

합성 SQL: 해시 `c6987420176a932ddce96855451e967c9fe4ecb5f4b73da38703cbac6b3ba44a` 로 **51/51 통과**
(실제 `POST_COLS` 문자열로 합성 `v_posts`를 조회하는 계약 검사 포함).
**이번 프론트 수정은 SQL을 바꾸지 않았으므로 해시 그대로입니다.**

라우트 15개 200, 자산 `?v=25` 정합(구버전 잔재 0), SHELL 누락 0.

---

## 8. 참고한 실측 자료 (이 저장소 밖)

| 자료 | 쓴 곳 |
|---|---|
| `/tmp/ain-pg-verification.YJvwkM/result.json` | 합성 SQL 51/51 (해시 `c6987420…`) |
| `/tmp/ain-launch-20260909.8y9g7lku/AUTOMATION_LIVE_READONLY.json` | B6 수집 스케줄·최근 2회 성공 |
| `/tmp/ain-launch-20260909.8y9g7lku/DATA_FRESHNESS_READONLY.json` | B6 데이터 갱신 시각·행 수 |
| 실행 커밋 `5073ce24`의 `scripts/collect_news.py` | B8 SOURCE 발생 지점 |
| 운영 읽기 전용 확인 (posts=0 / comments=0) | §6.3 적용 전 조건 |

모두 다른 저장소·운영 자료를 **읽기만** 한 결과이며, 이 저장소에서 재현하지 않았습니다.

---

## 9. 한 줄 요약

교육·내 지역·도구·커뮤니티·내 활동의 **화면과 로직은 로컬에서 확인**했고,
저장·익명·후기·연락처 정리·반복 작성은 **SQL 층위까지만 확인**했으며 운영에는 적용하지 않았습니다.
**로그인이 필요한 동작과 두 기기 확인은 아직 아무것도 검증되지 않았습니다.**
