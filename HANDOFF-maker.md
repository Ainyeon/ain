# HANDOFF — 템플릿 메이커 베타 (feature/template-maker)

2026-07-04 작업분. **main 미접촉 · 배포 없음 · SQL 없음 · OAuth 무변경.**

## ① 파일 목록 + 역할

**신규**
| 파일 | 역할 |
|---|---|
| `maker/index.html` | /maker/ 페이지 — 템플릿 탭(T1·T2 활성, T3·T4 SOON), 입력 폼, 라이브 미리보기, 하단 고정 액션바(공유/PNG 저장/계정 저장 비활성+툴팁) |
| `maker/maker.js` | 렌더 엔진 — 캔버스 내부 해상도 1080 고정(기기 무관 동일 산출물), `document.fonts.load+ready` 대기, 사진 클라이언트 리사이즈(긴 변 1600px, OffscreenCanvas), navigator.share 파일 공유(미지원 시 다운로드 폴백), localStorage 임시저장·복원 |
| `maker/presets.json` | 업종 프리셋 8종 + 기타(직접입력) — **업종 추가 = JSON 블록 1개 추가** |
| `tools/og-render/og.html` | OG 1200×630 조판 (?v=a/b/c 시안 3종) |
| `tools/og-render/hero-compare.html` | 홈 히어로 카피 비교 조판 |
| `tools/og-render/README.md` | 재생성 명령 (헤드리스 크롬 한 줄) |
| `assets/og/draft-a.png` `draft-b.png` `draft-c.png` | **OG 시안 3종 — 아침 선택용. og.png 미교체 상태** |
| `docs/hero-copy-compare.png` | 현재 히어로 vs 제안 카피 나란히 비교 (판단용, 반영 안 함) |

**수정**
| 파일 | 변경 |
|---|---|
| `index.html` | "템플릿 메이커 열기" → `/maker/` 연결 · 문구 일반화("시공 후 고객 안내문 — 전 업종 프리셋", 계정 저장 → 임시저장 기준) |
| `sw.js` | 프리캐시에 /maker/ 3파일 추가 + `VERSION ain-v2` (머지 배포 시 기존 사용자 캐시 자동 무효화) |

## ② 실행·테스트 결과

| 완료 기준 | 결과 |
|---|---|
| 375px 가로 스크롤 0 | ✅ scrollX 고정 0 |
| 업종 선택→입력→미리보기 | ✅ 프리셋 9종 로드, 타일·욕실로 T1 실렌더 확인 (입력 즉시 반영) |
| PC/폰 내보내기 픽셀 동일 | ✅ 같은 상태를 1440/375 뷰포트에서 렌더 → **SHA-256 해시 완전 일치** |
| T2 5MB 사진 2장 | ✅ **8MB급 2장**으로 검증 — 리사이즈 후 정상 합성(BEFORE/AFTER 슬롯 색 검증), 1080/1350 토글 동작 |
| 네트워크 전송 0건 | ✅ 업로드~렌더 전 과정에서 **비-GET 요청 0건** (요청 로거로 확증) |
| PNG 산출 | ✅ toBlob PNG 시그니처·71KB 정상, 공유 API 존재 시 파일 공유·아니면 다운로드 폴백 |
| 임시저장 | ✅ 입력→localStorage 저장→리로드 복원 확인 (사진은 제외 — 의도) |
| 액션바/탭바 충돌 | ✅ 액션바 하단이 탭바 상단 위 (겹침 0), 버튼 48px |
| Lighthouse /maker/ (gzip 서버) | ✅ **Perf 95 · A11y 100 · BP 100 · SEO 100** |

## ③ 완료 / 미완 / 주의 + 아침 수동 작업

**미완(의도된 범위 제외)**: T3 명함·T4 홍보 이미지(SOON 표기만), 계정 저장(비활성 버튼 + "곧 제공" 안내 — P4).

**주의사항**
- **지시서 경로 불일치 1건**: OG 스펙의 `/assets/og/og-main.png`는 실제 배선(`/assets/og.png`)과 다릅니다. "배선 무변경 + 파일만 교체" 원칙에 따라 **선택된 시안을 `assets/og.png`에 복사**하는 게 맞습니다 (README에 명시).
- 공유 시트의 실제 카톡 직행은 실기기(iOS/안드로이드)에서만 검증 가능 — 헤드리스에선 API 존재+폴백 경로만 확인함.
- 사진은 임시저장에 포함되지 않음 (localStorage 용량 한계, 리로드 시 재선택 필요 — 베타 트레이드오프).
- T1 본문은 블록당 4항목까지 표시 (1527px 세로 예산). 프리셋은 전부 3항목 이하라 현재 잘림 없음.

**아침 수동 작업 (순서)**
1. **OG 시안 선택**: `assets/og/draft-a.png`(좌측 정렬) / `draft-b.png`(중앙) / `draft-c.png`(카피 대형+하단 브랜드) 중 택1 → "X안으로 og 교체" 지시하면 `assets/og.png` 교체 커밋까지 처리
2. **히어로 카피 판단**: `docs/hero-copy-compare.png` 보고 홈 반영 여부 결정 (현재 미반영)
3. 브랜치 리뷰 → **머지·push = 배포** (`git checkout main && git merge feature/template-maker`)
4. 실기기(폰)에서: /maker/ 진입 → 안내문 만들기 → **공유 → 카톡 전송** 1회 (완료 기준의 실전 검증)
5. T2에 실제 시공 사진으로 전후 카드 1장 만들어 당근/인스타 업로드 규격 확인
