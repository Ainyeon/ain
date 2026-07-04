# HANDOFF — 커뮤니티 (feature/community)

2026-07-04 작업분. **main 미접촉 · 배포 없음 · SQL 미실행(파일만) · service_role 미사용 · OAuth 무변경.**

## ① 파일 목록 + 역할

**SQL (실행은 수동 — 아래 ③ 순서)**
| 파일 | 역할 |
|---|---|
| `sql/07-community.sql` | profiles **ALTER**(nickname unique 2~12자·field·region·business_id 씨앗·is_admin) + posts/comments/votes/reports + RLS + 티저 뷰. 멱등·롤백 포함 |

설계 특이점 (지시서와 다르게 처리한 부분·이유):
- **profiles는 CREATE가 아니라 ALTER** — 02_auth_profiles.sql로 이미 존재 + 가입 트리거가 행을 자동 생성. 온보딩 게이트 조건도 "행 없음"이 아니라 **"nickname 미설정"**
- **is_admin·business_id 자기승격 차단**: 컬럼 단위 GRANT로 본인 UPDATE에서도 두 컬럼 제외
- **posts.status 변경은 RPC(`admin_set_post_status`)로만** — status를 UPDATE 컬럼 GRANT에서 제외해 작성자 우회 불가, RPC 내부에서 is_admin 검사
- 티저 뷰 `v_board_teaser`: definer, 글 수+최신 제목 5건 (본문·작성자 미포함), anon GRANT

**프론트 (신규)**
| 파일 | 역할 |
|---|---|
| `assets/js/ain-community.js` | 프로필 게이트(requireMember→온보딩 리다이렉트)·작성자 뱃지("닉네임 · 분야뱃지")·timeAgo·신고·티저 fetch. 분야 라벨은 presets.json 9종 체계와 동일 |
| `onboard/index.html` | 온보딩 1화면 — 닉네임 실시간 중복체크(350ms 디바운스)+형식 검사, 분야 필수, 지역 선택 → 저장 후 `?next=` 복귀. /me/ 수정 진입도 이 화면 재사용(프리필) |
| `board/board.css` | 게시판 3페이지 공통 스타일 |
| `board/free/` + `board-free.js` | 자유게시판 — 목록(최신순)·글쓰기·상세(?id=)·댓글·본인 삭제·신고 |
| `board/proposal/` + `board-proposal.js` | 제안·투표 — 찬반(1인 1표 **upsert onConflict post_id,user_id** → 변경 가능), 찬성률 바, 상태 뱃지 4종, 채택 규칙 상단 고정(`THRESHOLD_COUNT=20, THRESHOLD_RATE=0.7` 상수 분리), 임계 도달 하이라이트, 찬성순/최신순 토글 |
| `admin/board/` | 관리자 전용(is_admin 게이트) — 신고 많은 순+삭제, 제안 상태 변경 드롭다운(RPC), 임계 도달 필터 |

**프론트 (수정)**: `index.html`(게시판 진입 밴드), `briefing/`(하단 CTA 4버튼), `me/`(커뮤니티 프로필 표시+수정 진입+빠른 이동에 게시판 2종), `assets/css/ain.css`(커뮤니티 토큰). 탭바는 5개 유지(게시판 미추가 — 지시 준수).

## ② 실행·테스트 결과

- 구문: 신규 JS 3본 + 인라인 3본 `node --check` 전부 통과
- **SQL 미실행 상태 폴백 (핵심)**: 현재 DB 그대로 5페이지 검증 — 비로그인은 티저 게이트("게시글 0개"+로그인 CTA+규칙 배너), onboard/admin/me는 각각 게이트 메시지. **죽는 페이지 0.** 로그인 상태의 테이블 없음 에러는 `infraError` → "게시판 준비 중" 폴백 (코드 경로 확인)
- 375px: 5페이지 가로 스크롤 0 · 소형 터치 타겟 0건 · 탭바 정상
- 투표 중복 = 변경: `votes.upsert(..., { onConflict: 'post_id,user_id' })` — 코드 레벨 확인 (SQL의 UNIQUE와 쌍)
- Lighthouse (gzip 서버): **/board/free/ P95·A11y100 · /board/proposal/ P90·A11y100 · /onboard/ P96·A11y100**
  - BP 96(게시판 2종)은 티저 뷰 미생성 404 콘솔 에러 때문 — SQL 실행 후 자동 해소
  - /onboard/ SEO 63은 noindex 페이지라 무의미 (의도)

## ③ 완료 / 미완 / 막힘 + 수동 작업 (순서대로)

**미완/보류**: 시드 글(콜드스타트 대비 3~5개)은 어드바이저가 목록 뽑아주기로 — SQL 실행 후 제안 게시판에서 직접 작성 권장(작성자 뱃지가 자연스럽게 달리도록).

**수동 순서**
1. `sql/07-community.sql` 검토 → Supabase SQL Editor에서 **전체 실행** (멱등이라 재실행 안전)
2. 파일 맨 아래 [관리자 세팅] 주석 해제 → 본인 계정 is_admin UPDATE 1줄 실행 (이메일 템플릿 넣어둠)
3. 실행 후 확인 쿼리(파일 내 주석): anon posts 직접 read → permission denied / v_board_teaser → 성공
4. 로컬(또는 배포 후) 실테스트: 카카오 로그인 → **온보딩 강제 진입 확인** → 닉네임·분야 저장 → 자유게시판 글 1개 → 제안 글 1개 → 투표 1회(변경도) → 신고 1회 → `/admin/board/`에서 신고 목록·상태 변경 확인
5. 이상 없으면 머지·배포 → 실기기 재검증 + 시드 글 3~5개 등록 후 공개
