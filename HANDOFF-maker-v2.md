# HANDOFF — maker-v2 (템플릿 메이커 재설계)

브랜치: `feature/maker-v2` (main 미병합). 무드보드 승인 편성 기준:
**T1-A 클리닉 미니멀 + T2-A 클린 스플릿 기본, T1-C 다크 프리미엄 스타일 토글.**

## ① 파일과 역할

### 신규
| 파일 | 역할 |
|---|---|
| `maker/maker-core.js` | 공통 엔진 — 승인 디자인 토큰(TOKENS), 캔버스 유틸(wrap/roundRect), 색 유틸(darken/idealTextOn), 폰트 로드 대기, fields/formats/copy 로더, 업종 검색 컴포넌트(mountFieldSearch), 공유/저장(+maker_uses 카운트), 사진 클라이언트 리사이즈(긴 변 1600, 무전송) |
| `maker/maker.css` | 허브·notice·compare 3페이지 공용 UI (폼 카드, 검색 드롭다운, 섹션 편집기, 사진 슬롯, 미리보기, 하단 액션 바) |
| `maker/notice/index.html` + `notice.js` | **T1 고객 안내문** — 업종 검색→copy.json 자동 채움, 섹션 제목·본문·순서·추가·삭제 전부 편집 가능, 모든 입력 100ms 디바운스 실시간 미리보기, 미니멀 화이트/다크 프리미엄 토글, 대표색(어두우면 텍스트 자동 반전), 규격 4종 |
| `maker/compare/index.html` + `compare.js` | **T2 전·중·후 비교** — '중' 슬롯 선택사항(비우면 2분할·채우면 3분할 자동), 정방형·가로형=열 분할 / 세로형=행 분할 자동, 브랜드 바 잉크/화이트 토글, 규격 5종 |
| `maker/fields.json` | 업종 마스터 (5개 대분류 22종 + legacy_map). 메이커·온보딩·게시판 뱃지 공유 |
| `maker/formats.json` | 규격 라이브러리 8종 (도구별 필터: notice 4종 / compare 5종) |
| `maker/copy.json` | 22개 업종 전체 기본 문구 (커버리지 누락 0 검증) |
| `sql/10-fields-expand.sql` | **미실행** — profiles_field_check 제약을 legacy 9종+신규 15종으로 확장 |
| `docs/maker-v2-samples/*.jpg` | 규격별 내보내기 샘플 10장 (T1 화이트/다크/정방형/A4, T2 2·3분할 정방형/스토리/밴드) |
| `maker/moodboard.html`, `docs/moodboard-preview.png` | 승인된 무드보드 (기록용) |

### 변경
| 파일 | 내용 |
|---|---|
| `maker/index.html` | 단일 에디터 → **허브 페이지**로 재작성 (T1/T2 카드 2장 + "N회 제작" 카운터 유지) |
| `sw.js` | VERSION `ain-v4` → **`ain-v5`**, SHELL에서 구 maker.js·presets.json 제거, 신규 경로 8개 추가 |
| `assets/js/ain-community.js` | FIELD_LABELS 9종 → fields.json 마스터 22종+legacy 2종(표기 전용), `FIELD_LEGACY` 노출 |
| `onboard/index.html` | 주력분야 select에서 legacy id 제외 (표시용으로만 유지) |

### 삭제
`maker/maker.js`, `maker/presets.json` (v1 에디터 — 허브+분리 페이지로 대체)

## ② 테스트 결과 (전부 통과)

- **T1 실시간 미리보기**: 본문 textarea 편집 → 캔버스 해시 변화 확인 (v1의 본문 미반영 버그 해소). 제목·추가·삭제·순서이동 전부 즉시 반영
- **T1 업종 검색**: '보일' → 보일러 매칭·문구 자동 채움, 미등록어 '어항청소' → "직접 입력으로 사용" 동작. 첫 방문 기본값 = 에어컨 설치
- **T2 중 슬롯**: 2장=2분할 → 중 추가=3분할 → 중 제거=2분할 복귀, 복귀 해시가 원본과 **완전 일치** (렌더 결정성 확증)
- **규격 토글 리플로우**: notice 1080×1527/1080×1080/2480×3508, compare 1080×1080/1080×1920/1200×900 즉시 전환
- **375px 가로 스크롤**: 허브·notice·compare 3페이지 모두 overflow 0
- **PC/폰 픽셀 동일**: 같은 상태를 375px·1280px 뷰포트에서 렌더 → 캔버스 해시 동일 (논리폭 1080 고정 조판 + setTransform 스케일)
- **Lighthouse** (gzip 서버, headless): 허브 Perf 96 / notice **91** / compare 96, A11y 3페이지 모두 **100**
- **콘솔 에러 0** (경고는 테스트 스크립트의 getImageData 힌트뿐)

## ③ 완료 / 미완 / 수동 순서

**완료**: goal [1]~[6] 전 항목 + 완료 기준 전부. 워터마크 "made with 에인연 · ainyeon.com" 절제 유지, 공유/저장 시 maker_uses 카운트 유지.

**미완(의도적)**: 없음.

**막힘**: 없음.

**수동 순서 (병합 전 필수)**:
1. `sql/10-fields-expand.sql`을 Supabase SQL Editor에서 실행.
   ⚠️ **이걸 먼저 실행해야 함** — 온보딩 select가 신규 22종을 노출하므로, 제약 확장 전에 병합하면 신규 업종(보일러 등) 선택 시 프로필 저장이 DB 제약 위반으로 실패함. (기존 회원 데이터는 legacy id 허용 유지로 무손상)
2. `feature/maker-v2` → main 병합 + push (sw.js ain-v5가 캐시 자동 갱신)
3. 폰에서 확인: /maker/ 허브 → 안내문(본문 수정 즉시 반영·다크 토글·A4 저장) → 비교(사진 3장·중 제거·스토리 규격) → 카톡 공유
