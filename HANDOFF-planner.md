# HANDOFF — 도면 그리기 · 내 프로젝트 · 도면 검색 (스튜디오 앱)

브랜치 `feat/studio-ask`(워크트리 `~/repos/personal/ain-site-tour-wt`). **로컬 커밋만 — main 미병합, push·PR·배포 없음**(비용 확인 뒤 올리기로 한 결정).
기준: 에인연 = Archisketch 식 흐름. REA 로 본 화면의 구조·동작만 옮겼고 문구·코드·이미지·아이콘은 가져오지 않았다(캡처에는 개인정보가 있어 저장소에 없다).

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
| 단지 자료 | `maps/data/complexes.json`(`{v:1, complexes:[…]}`, 형식은 `maps.js` readComplexes). 공공데이터 키 또는 직접 입력. OSM 에서 긁어 담으면 ODbL(출처·동일조건) 의무가 생긴다 |
| 지도 제공자 | 지금은 OSM 개발용 기본값. 대량·상업 사용은 자체 타일 서버나 유료 제공자 권장, 화면 위치가 외부로 나가는 점 개인정보 안내 필요. 교체는 `maps.js` 의 `BASEMAP` 한 곳 |
| iOS 시뮬레이터 | App Store 에서 Xcode 설치 후 `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` (비밀번호가 필요해 대신 못 한다) |
| 삼성 단종 248행 | 삼성닷컴 판매 페이지가 없고 지원 페이지만 있는 모델(냉장고 133·공기청정기 101 등). 크롤링 없이는 판정 불가 → 지금은 '단종 표시' 없이 둠(배치엔 영향 없음) |
| 올리기 | 예상 비용을 먼저 보고한 뒤 승인 |

## ④ 올리기 전 체크리스트

- `plan/index.html` 진입점이 `app.js?v=1` — 올릴 때 `?v=` 를 올려 캐시를 깬다(브라우저 캐시가 옛 모듈을 쥔다).
- `sw.js` SHELL: 새 페이지(`/maker/3d/plan/ · projects/ · maps/`)를 넣을지 정한다. **가전 카탈로그(1.7MB)는 넣지 않는다**(가전 탭을 처음 열 때만 받는다). `?v=` 는 페이지가 요청하는 글자와 같아야 하고 VERSION 을 올린다.
- 맵스 CSP 는 `img-src` 에 타일 서버, `connect-src` 에 주소 검색 서버만 연다(`test-maps.js` 가 지킨다). 제공자를 바꾸면 둘 다 같이 바꾼다.
- 엔진 뷰어(`maker/3d/view/viewer.js`)는 `toSpaceJSON` 결과를 그대로 못 띄운다(실외기·검사 필요) — 도면 → 3D 뷰어 연결은 아직 안 했다.
