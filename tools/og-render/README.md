# OG 이미지 렌더 도구

`og.html`을 1200×630으로 조판하고 헤드리스 크롬으로 캡처한다. 문구·배치 수정 후 아래 한 줄로 재생성.

```bash
# 레포 루트에서 (로컬 서버로 서빙 — 폰트 상대경로 로드 때문에 권장)
python3 -m http.server 8788 &
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for V in a b c; do
  "$CHROME" --headless=new --disable-gpu \
    --screenshot="assets/og/draft-$V.png" \
    --window-size=1200,630 --hide-scrollbars --virtual-time-budget=5000 \
    "http://localhost:8788/tools/og-render/og.html?v=$V"
done
```

- `?v=a` 좌측 정렬 + 오브 우측 / `?v=b` 중앙 정렬 / `?v=c` 카피 상단 대형 + 하단 브랜드 라인
- `--virtual-time-budget=5000` 이 폰트 로드 완료를 보장한다 (Pretendard 서브셋, font-display:block)
- 시안 확정 후: 선택본을 `assets/og.png` 로 복사 (메타태그가 바라보는 실제 경로. 지시서의 /assets/og/og-main.png는 현 배선과 다름 — HANDOFF 참고)
- `hero-compare.html` 은 홈 히어로 카피 비교용 (1200×900, docs/hero-copy-compare.png)

## og-card.html — 현행 OG 카드 (assets/og-card-v2.png)

메타태그가 실제로 바라보는 카드. 1200×630 단일 레이아웃, 전 요소가 안전영역(상하좌우 60px)
+ 중앙 630×630 정사각 안쪽 (카톡은 가로/정사각 크롭을 둘 다 쓴다 — 세로 카드는 잘린다).

```bash
# 레포 루트에서
python3 -m http.server 8791 & CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# ① 레이아웃 자가검증 — OK 면 통과, OVERFLOW 면 안전영역/정사각 이탈
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=6000 \
  --window-size=1200,630 --dump-dom "http://localhost:8791/tools/og-render/og-card.html" \
  | grep -o 'data-check="[^"]*"'
# ② 렌더
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=6000 \
  --window-size=1200,630 --screenshot=assets/og-card-v2.png \
  "http://localhost:8791/tools/og-render/og-card.html"
# ③ 정사각 크롭 시뮬 (카톡 썸네일)
sips --cropToHeightWidth 630 630 /tmp/sim.png
```

문구·배치를 고치면 ①이 OK 인지 먼저 확인하고 ②를 돌린다.
**파일명을 바꾸면** 전 페이지 og:image + sw.js SHELL 목록을 함께 갱신 (카톡·당근 캐시 우회).
