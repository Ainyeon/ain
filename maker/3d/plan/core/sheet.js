// A3 도면판 — 칸 배치·축척·표제란 글자(순수 계산, 종이 mm). 그리기는 sheet.js
import { CITIES, compass } from './sun.js';

export const SHEET = Object.freeze({ w: 420, h: 297, margin: 10, gap: 4, title: 20, cap: 7, cols: 4 });   // A3 가로 · title: 표제란 높이 · cap: 칸 이름 줄 높이
// n 칸을 cols 열 격자로, 표제란은 아래 띠 → { cells:[{ x, y, w, h }], title:{ x, y, w, h } }
export function sheetLayout(n, S = SHEET) {
  const cols = Math.max(1, Math.min(S.cols, n)), rows = Math.max(1, Math.ceil(n / cols)), W = S.w - 2 * S.margin, H = S.h - 2 * S.margin - S.title - S.gap;
  const cw = (W - (cols - 1) * S.gap) / cols, ch = (H - (rows - 1) * S.gap) / rows;
  return { cells: Array.from({ length: n }, (_, i) => ({ x: S.margin + (i % cols) * (cw + S.gap), y: S.margin + Math.floor(i / cols) * (ch + S.gap), w: cw, h: ch })), title: { x: S.margin, y: S.h - S.margin - S.title, w: W, h: S.title } };
}
const RATIOS = [20, 25, 30, 40, 50, 60, 75, 100, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1500, 2000, 2500, 5000];
// 도면 범위 b(mm)가 종이 w × h(mm)에 들어가는 가장 큰 축척의 분모(1:n 의 n). 표에 없을 만큼 크면 1000 단위로 올린다
export function sheetScale(b, w, h) {
  const need = Math.max((b.x1 - b.x0) / w, (b.y1 - b.y0) / h);
  return RATIOS.find((r) => r >= need) ?? Math.ceil(need / 1000) * 1000;
}
// 표제란 [이름, 값] — 날짜는 부르는 쪽이 넘긴 글자 그대로(여기서 시계를 읽지 않는다)
export function titleRows({ title, areaM2, north, lat, date, ratio }) {
  const city = CITIES.find(([, v]) => v === lat);
  return [['도면', title], ['면적', `${areaM2.toFixed(2)} ㎡`], ['방위', `위쪽 ${compass(north)} · ${north}°`], ['지역', city ? `${city[0]} · 위도 ${lat}°` : `위도 ${lat}°`], ['축척', `1:${ratio} · A3`], ['날짜', date]];
}
