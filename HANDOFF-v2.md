# HANDOFF — community-v2 (버그픽스 + 역할 + 메이커 개선)

2026-07-05 작업분, `feature/community-v2`. **main 미접촉 · 배포 없음 · SQL 파일 출력만(미실행) · 파이프라인 무접촉.**

## ① 파일 + 역할

| 파일 | 역할 |
|---|---|
| `sql/08-fix-grants-roles.sql` (신규) | **투표 버그픽스** + role 시스템 + 닉네임 제약 재확인. 멱등 |
| `assets/js/ain-community.js` | role 조회(+**컬럼 미존재 시 member 폴백** — 08 미실행에도 안 죽음), 운영자/매니저 뱃지 |
| `board/board-free.js` `board-proposal.js` | author 임베드에 role 동적 포함, 스태프 글 카드 좌측 액센트 |
| `admin/board/index.html` | **회원 관리 탭** 신규 — 닉네임 검색, 매니저↔회원 전환(RPC), admin 행 잠금 |
| `assets/css/ain.css` | 운영자(잉크 배경)·매니저(라인) 뱃지 + staff-accent — 절제 톤 |
| `maker/index.html` `maker.js` | 규격 시스템·전중후 3장·커스텀 업종·HEX 입력·placeholder 교체 (아래) |

## ② 핵심 내용 + 테스트 결과

**1. 투표 버그 — 원인 확정 (어드바이저 진단 적중, 기전까지 특정)**
`information_schema` 진단으로 확인: 07이 votes에 컬럼 단위 `UPDATE(vote)`만 부여했는데, supabase-js **upsert가 `ON CONFLICT DO UPDATE SET post_id=, user_id=, vote=`로 페이로드 전 컬럼을 SET** → post_id/user_id UPDATE 권한 부재로 테이블 레벨 42501. 수정: votes만 테이블 레벨 SELECT/INSERT/UPDATE/DELETE(행 보호는 RLS의 `user_id=auth.uid()`가 담당), anon은 계속 차단.
※ 지시서의 "profiles/posts/comments 테이블 레벨 재부여"는 **의도적으로 안 따름** — 그렇게 하면 is_admin·role·status 자기변경 차단이 무너집니다. 정상 동작 중인 컬럼 GRANT를 유지했고 upsert를 쓰는 테이블은 votes뿐이라 이 수정으로 충분합니다 (SQL 주석에 명기).

**2. 역할 시스템**: `role('admin'|'manager'|'member')` 추가 + is_admin→admin 마이그레이션(is_admin 컬럼은 호환 유지, 코드는 role만 사용). `is_admin_user()`를 role 기준으로 재정의 → 기존 정책·RPC 전부 자동 반영. 매니저 지정은 `admin_set_role` RPC(admin 전용, **manager/member 전환만** — admin 승격·강등은 SQL 수동, 사고 방지). role은 본인 UPDATE 컬럼 GRANT에 없어 자기승격 불가.

**3. 닉네임**: DB CHECK는 07에서 이미 적용(`^[가-힣A-Za-z0-9]{2,12}$` — 특수문자·공백·이모지 차단). 08에 멱등 재확인 + 기존 위반 검사 쿼리 주석 포함. 클라이언트 검증은 동일 정규식 유지.

**4. 메이커**: 
- 규격: T1 카톡 1527/정방형/**A4 2480×3508**/스토리 1920 · T2 정방형/세로/스토리 — 템플릿 패널 내 토글, 선택 즉시 미리보기 비율 변경. 논리폭 1080 조판→규격별 스케일(A4는 동일 조판 고해상도)
- T2 **전·중·후**: 시공중 슬롯 선택사항. 2장=기존 배치, 3장=자동 3분할(정방형 3열/세로형 3행), 라벨 한글화
- 커스텀 업종 자유 입력 → 헤더·제목에 반영(프리셋 없으면 범용 문구) · placeholder "에어컨 인테리어 연구소"/"수도권 전지역" · 스와치 제거→컬러피커+HEX 병행 · 어두운색 텍스트 자동 반전(기존 로직 유지)

**테스트 결과**
| 항목 | 결과 |
|---|---|
| T1 4규격 | ✅ 1080×1527 / 1080×1080 / 2480×3508 / 1080×1920 전부 렌더 (푸터 픽셀 확인) |
| T2 3규격 × 2장/3장 | ✅ 사이즈 정확, 3장 시 3분할 전환, 8MB 사진 리사이즈 |
| 네트워크 전송 | ✅ 업로드~렌더 전 과정 비-GET 0건 |
| PC/폰 픽셀 동일 | ✅ SHA-256 `1a965b4c9144d1a1` 완전 일치. ※처음 1회 불일치는 측정 스크립트가 디바운스 렌더를 안 기다린 레이스로 판명(리로드 3회 동일 해시로 확증). 내보내기 경로는 렌더 재실행 후 캡처라 레이스 없음 |
| 실시간 미리보기 | ✅ 전 입력 input 이벤트 + 60ms 디바운스 (기준 100ms 내) |
| 375px | ✅ 가로 스크롤 0 |
| SQL 미실행 폴백 | ✅ role 컬럼 없으면 member 처리(재시도 로직), 게시판 티저 정상 |
| Lighthouse /maker/ | ✅ **Perf 95 · A11y 100 · BP 100 · SEO 100** |

## ③ 완료/미완 + 수동 순서

**미완(실계정 필요)**: 매니저 지정 실테스트(두 번째 계정 필요 — 누나 계정), 투표 재테스트(실로그인).

**수동 순서**
1. `sql/08-fix-grants-roles.sql` 검토 → SQL Editor 실행 (또는 지난번처럼 psql 위임 — 명시 승인 문장으로)
2. 폰에서 **투표 + 변경 1회** (이번 배포의 원래 관문)
3. `/admin/board/` → 본인 role='admin' 반영 확인 (운영자 뱃지) → 회원 관리 탭에서 매니저 지정 테스트 (두 번째 계정 생기면)
4. `/maker/` 실시간 미리보기 + **전·중·후 3장** (판넬 복원 시공중 사진 최적) + A4 내보내기 1장
5. 통과 → 머지 승인 → 시드 5건 등록 → 공개 알림
