# HANDOFF — 모바일 퍼스트 재구축 (feature/mobile-rebuild)

2026-07-04 새벽 작업분. **main 미접촉 · 배포 안 됨 · SQL 실행 없음 · OAuth 설정 무변경.**

## ① 생성·수정 파일 + 역할

**신규**
| 파일 | 역할 |
|---|---|
| `docs/PRD-mobile.md` | 모바일 UX 원칙 + DoD (달성 현황 체크 반영) |
| `prices/index.html` | 시세 탭 페이지 — v_ticker_metals 요약 (전기동·알루미늄·냉매 준비중) |
| `me/index.html` | 내정보 탭 페이지 — 세션 표시·로그아웃·빠른 이동. **기존 ainAuth 배선 재사용만, OAuth 무변경** |
| `manifest.json` | PWA 매니페스트 (standalone, ko, 아이콘 3종) |
| `assets/icon-192.png` `icon-512.png` `icon-maskable-512.png` | 앱 아이콘 (브랜드 그라디언트, Pillow 생성) |
| `sw.js` | 서비스워커 — 셸 프리캐시 + 공개 REST GET(뷰 6종 화이트리스트) 최신 1회분 캐시. `/auth/v1` 절대 미캐시 |
| `assets/fonts/PretendardVariable.subset.woff2` | KS X 1001 2,350자 + 라틴 서브셋 → wght 400–900 인스턴스. **2,057KB → 320KB** |
| `HANDOFF.md` | 이 문서 |

**수정**
| 파일 | 변경 |
|---|---|
| `assets/css/ain.css` | 탭바 컴포넌트 · 모바일 에르고노믹스(44px 타겟·16px 본문·그레인 off·리빌 blur 4px·히어로 모션 단축) · 설치 배너 · WCAG AA 대비 보정 · 서브셋 폰트 참조 |
| `assets/js/ain-common.js` | 탭바 주입(5탭, 현재 탭 하이라이트) · SW 등록 · 설치 프롬프트(beforeinstallprompt, 닫기 기억) |
| `index.html` | preconnect·font preload·manifest 링크 |
| `briefing/ calendar/ news/` | 위 + canonical/og:url/og:image 완비 · 스크립트 defer 전환(+부트 DOMContentLoaded 래핑) · 모바일 오버라이드 · 대비 색 보정 |
| `prices/ me/` | (신규지만) 동일 규격 적용 |

## ② 실행한 것 · 테스트 결과

- 검증 도구: Playwright(375px/1440px 지오메트리·오프라인) + Lighthouse 12 (모바일 프리셋, Chrome for Testing)
- **375px 6페이지 전수**: 가로 스크롤 0 · 탭바 5개(활성 표시 정확) · 터치 타겟 위반 0건 · 본문 16px
- **오프라인**: SW 워밍업 후 비행기모드 → 브리핑 5섹션 + 시세 실값 캐시본 렌더 ✅
- **데스크톱 1440px**: 탭바 숨김·기존 렌더 무회귀 ✅
- **Lighthouse (gzip 정적 서버 = 프로덕션 근사, 콜드 캐시)**:

| 페이지 | Perf | A11y | BP | SEO |
|---|---|---|---|---|
| / (홈) | **91** | 100 | 100 | 100 |
| /me/ | 95 | 100 | 100 | 100 |
| /prices/ | 88 | 100 | 100 | 100 |
| /calendar/ | 82 | 100 | 100 | 100 |
| /briefing/ | 75 | 100 | 100 | 100 |
| /news/ | 71 | 100 | 100 | 100 |

- Perf 개선 이력(홈): 72 → 81(폰트 preload+모션 단축) → 90(폰트 320KB 인스턴스+preconnect) → 91
- 주의: 로컬 무압축 python 서버 측정은 이보다 5~10점 낮게 나옴. 실배포(GitHub Pages CDN·HTTP/2)에서 재측정 권장

## ③ 완료 / 미완 / 주의 + 아침 수동 작업

**미완 1건 — 데이터 페이지 Perf 90 미달 (71~88)**
원인은 코드가 아니라 구조: 이 페이지들의 LCP 요소가 *Supabase REST 응답 후* 그려지는 콘텐츠라, 콜드 캐시 모의 4G에서 LCP 2.7~3.8s가 하한입니다. 프론트 레버(defer·preconnect·폰트·모션)는 소진했습니다. 90+로 가는 실질 경로는 ①파이프라인이 정적 JSON/HTML 스냅샷을 레포에 커밋(파이프라인 수정이라 금지 범위—아침 판단) ②프리렌더 도입 중 택1입니다. 재방문은 SW 캐시로 즉시 페인트라 체감은 훨씬 좋습니다.

**주의사항**
- SW 캐시 무효화: 배포 후 갱신이 안 보이면 `sw.js`의 `VERSION`(`ain-v1`)을 올려야 즉시 반영. 롤백 시에도 동일
- SW는 localhost/HTTPS에서만 동작 — 머지·배포 후에야 실기기 검증 가능
- 폰트가 KS X 1001 2,350자 서브셋이라 희귀 한자·옛한글은 시스템 폰트로 폴백 (단지명 등 일반 텍스트는 커버)
- Kakao 로그인: `/me/`는 기존 ainAuth 함수 호출만 함. redirect 대상에 `https://ainyeon.com/me/`가 포함되는지는 Supabase 허용 목록(`/**`)이 커버 — 배포 후 1회 확인 권장

**아침에 수동으로 할 것 (순서)**
1. `feature/mobile-rebuild` 브랜치 리뷰 → 로컬 확인 원하면: `npx serve -l 8899` 후 375px로 훑기
2. **머지**: `git checkout main && git merge feature/mobile-rebuild` → push (= 배포)
3. 배포 후 실기기(폰) 확인: 탭바 동작 · 홈화면 설치 프롬프트 · 비행기모드 브리핑
4. 카톡 공유 미리보기 확인 (og.png·제목) — 캐시 갱신은 카카오 디버거에서
5. `/me/`에서 카카오 로그인·로그아웃 1회 (OAuth 검증)
6. Lighthouse를 실배포 URL로 재측정 → 데이터 페이지 90+ 필요하면 "정적 스냅샷" 건 지시
