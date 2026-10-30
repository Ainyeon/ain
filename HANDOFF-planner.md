# HANDOFF — 도면 그리기 · 내 프로젝트 · 도면 검색 (스튜디오 앱)

브랜치 `feat/studio-ask`(워크트리 `~/repos/personal/ain-site-tour-wt`). **push·PR 은 2026-10-30 '올려' 승인으로 진행(PR 까지만). 병합·배포는 따로 승인 받는다.**
기준: 에인연 = Archisketch 식 흐름. REA 로 본 화면에서 색·치수·모션은 수치만, 구조는 동작만 참고했다. 도구 패널의 구역·행 이름과 단축키는 REA 관찰에서 본 기능 이름과 같은 글자(기능 어휘)이고, 코드·이미지·아이콘·화면 문장은 가져오지 않았다(캡처에는 개인정보가 있어 저장소에 없다).

## ① 무엇이 어디에 있나

| 경로 | 내용 |
|---|---|
| `maker/3d/ask.js` · `studio.js` | 말로 시키기(규칙 기반 한국어 명령 해석). 되돌릴 수 없는 [만들기]는 자동 클릭하지 않고 초점만 |
| `maker/3d/app/` | 앱 셸(글자 사이드바 · 폰 하단 탭) |
| `maker/3d/projects/` | 내 프로젝트(카드·북마크·휴지통·썸네일). 저장 형식은 `plan/library.js` |
| `maker/3d/plan/` | 도면 그리기: 2D 편집(벽·방·기둥·문/창, 문 경첩·열리는 쪽) · 3D · 템플릿 · 마감재 · 제품(시스템에어컨 + 가전 2,009행) · 견적 · 되돌리기 |
| `maker/3d/maps/` | 도면 검색: OpenStreetMap 타일 + 주소 검색 + 단지 핀(`data/complexes.json`, 지금 빈 배열) |
| `tools/build-*.py·js` | 카탈로그 생성기(`--check` 로 원본과 같은지 확인). 가전 원본은 `~/repos/personal/hvac3d-lab/appliance-specs/raw` |

## ② 검증하는 법

```
for f in tools/test-plan-*.js tools/test-projects*.js tools/test-maps.js tools/test-studio-ask.js tools/test-studio-live.js; do node $f || echo FAIL $f; done
python3 tools/build-appliance-catalog.py --check; python3 tools/build-ac-catalog.py --check; node tools/build-plan-templates.js --check
```
화면은 임시 폴더에 `npm i playwright axe-core` 후 Chrome(`channel:'chrome'`)·WebKit(`npx playwright install webkit`)으로 본다. axe 는 **화면 밖 요소를 검사하지 않으니** 긴 목록은 세로가 큰 창으로 돌릴 것. 앱 안 브라우저 창은 외부 이미지를 못 받아 지도 타일이 안 보인다.
확인한 것: Chrome · Firefox 156 · WebKit(iPhone 14·iPad 에뮬레이션) · axe(WCAG 2.1 AA) 0건. **못 한 것:** 진짜 Safari 앱·iOS 시뮬레이터(전체 Xcode 필요) · 스크린리더 실음성 · 실제 휴대폰.

## ③ 남은 결정·사용자 작업

| 항목 | 필요한 것 |
|---|---|
| 단지 자료 | `maps/data/complexes.json`(`{v:1, complexes:[…]}`, 형식은 `maps.js` readComplexes). 공공데이터 키 또는 직접 입력. OSM 에서 긁어 담으면 ODbL(출처·동일조건) 의무가 생긴다. **이미 찾아 본 것:** `~/repos/personal/ain-automation/output/raw_complexes.csv`(입주레이더, 9,519행)는 단지명·시도·모집공고일뿐 좌표·주소·타입이 없고, 단지명은 회원 전용 정책(`supabase/06_close_complexes.sql`)이라 공개 정적 JSON 에 쓰지 않았다 |
| 지도 제공자 | 지금은 OSM 개발용 기본값. 대량·상업 사용은 자체 타일 서버나 유료 제공자 권장, 화면 위치가 외부로 나가는 점 개인정보 안내 필요. 교체는 `maps.js` 의 `BASEMAP` 한 곳 |
| iOS 시뮬레이터 | App Store 에서 Xcode 설치 후 `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (비밀번호가 필요해 대신 못 한다) |
| 삼성 단종 248행 | **결정(대표 10-30 '단종은 됐어, 있는 것만'):** 판정하지 않는다. 가전 목록의 기본을 '판매 중으로 확인된 것(discontinued=false) 941개'로 두고, 단종 표시(820)와 삼성닷컴 판매 페이지 없는 248행은 [단종·미확인 포함]을 눌러야 보인다(삭제 없음, 즐겨찾기 탭은 필터를 적용하지 않는다) |
| 올리기 | **예상 비용 산출 완료(추가 0원)** — 호스팅은 GitHub Pages(ainyeon.com)라 추가 요금이 없고, `.github/workflows` 가 없어 PR 이 자동 실행·과금을 일으키지 않는다. 전송량은 플래너 첫 로드가 gzip ≈0.25MB(+ 기존 three.js), 가전 탭을 처음 열 때만 +0.13MB 라 Pages 소프트 한도(월 100GB)로 10만 회 넘게 받는다. 유료 호출 없음(플래너는 브라우저 저장만, 맵스는 OSM 무료, 로그인은 기존 Supabase). 남은 건 비용이 아니라 병합 시점 판단(OSM 정책·위치 개인정보 안내). 승인되면 PR 까지만 만들고 병합은 따로 |

## ④ 올리기 전 체크리스트

- 캐시: `plan/index.html` 진입점은 `app.js?v=1`·`plan.css?v=2` 라 하위 모듈(`core/*.js`·`panels.js` 등)에는 `?v=` 가 없다. 그래서 `sw.js` 의 `FRESH_APP`(맵스·플래너·내 프로젝트·앱 셸의 json/js/css)을 **네트워크 우선**으로 두었다 — 새로 올린 뒤 재방문 첫 로드에 새 진입 파일과 옛 하위 모듈이 섞이지 않는다(`test-maps.js` 가 지킨다). 올릴 때 진입 파일의 `?v=` 는 올린다.
- `sw.js` SHELL: 새 페이지(`/maker/3d/plan/ · projects/ · maps/`)를 넣을지 정한다. **가전 카탈로그(1.7MB)는 넣지 않는다**(가전 탭을 처음 열 때만 받는다). SHELL 의 `?v=` 는 페이지가 요청하는 글자와 같아야 한다. VERSION(`ain-v35`)은 이번에 올리지 않았다 — 옛 캐시를 비우려면 배포 때 올린다.
- 맵스 CSP 는 `img-src` 에 타일 서버, `connect-src` 에 주소 검색 서버만 연다(`test-maps.js` 가 지킨다). 제공자를 바꾸면 둘 다 같이 바꾼다.
- 엔진 뷰어(`maker/3d/view/viewer.js`)는 `toSpaceJSON` 결과를 그대로 못 띄운다(실외기·검사 필요) — 도면 → 3D 뷰어 연결은 아직 안 했다.
- 병합 전 결정: 지도 타일·내 위치로 위치가 OSM 에 전달된다는 점을 맵스 화면에 한 줄 고지했다(`#mpPrivacy`). 사이트 개인정보처리방침(`_dev/legal/privacy`)은 아직 초안이라 위탁·외부 전송 항목에 OSM 을 넣을지 정한다. OSM 타일은 대량·상업 사용에 제한이 있다.

## ⑤ 올리기 전 독립 검토(2026-10-30)

`origin/main...HEAD` 전체를 비밀·보안·정확성·접근성·배포 준비 5관점으로 읽기 전용 검토하고 발견마다 반박 검증했다(33건 중 확정 26, 반박 7). 확정 26건은 모두 고쳤고 별도 검증자가 같은 재현으로 확인했다. 주요 수정: 키보드만으로 그리기·요소 고르기(캔버스 키보드 커서, `[` `]` 순회) · 지도 이동 중 타일이 멈추던 것 · 타일 실패 재요청 폭주 · 도면 불러오기 제곱 시간(3.4MB 에 약 14초 → 70ms) · 말로 시키기 '안방' 오판 · 맵스 '도면 직접 그리기'가 마지막 도면을 열던 것 · 서비스워커 낡은 자료.
알려진 한계: 폭 300px 이하에서 위 바가 5px 넘침 · 한 글자 도구 글쇠는 캔버스·도구 패널에 초점이 있을 때만 동작 · 견적 표 상자가 Tab 정지점이 됨 · 생성기 기본 경로(`tools/build-*-catalog.py`)는 개발자 로컬 폴더를 가리킨다(사이트로 나가는 JSON 에는 경로가 없다).

## ⑥ 폰 사용성(2026-10-30, 대표가 폰으로 써 보고 '너무 어렵다')
선택 도구에서 **한 손가락으로 빈 곳을 끌면 화면이 움직인다**(전에는 두 손가락뿐이었다, 가볍게 누르면 선택 해제, 범위 선택은 [그룹화] 를 켠 뒤). 폰의 위쪽 안내 카드를 한 줄 막대로 줄였다(190px → 54px, [끝내기] 는 같은 줄). 안내 문구가 손가락 기준으로 말한다. 아직 안 한 것: 손가락에 가려지는 점 찍기(돋보기·오프셋 커서), 아래 시트·떠 있는 단추 정리, 폰에서 도구를 고른 뒤 시트가 닫히는 흐름 개선 — 대표가 어느 동작이 가장 어려웠는지 알려 주면 그것부터. 아키스케치 에디터를 폰 폭으로 읽으려 했으나 관찰용 Chrome 의 에디터 탭 둘이 로그인 화면으로 넘어가 확인하지 못했다(원인 불명).
