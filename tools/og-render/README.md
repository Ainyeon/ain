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
