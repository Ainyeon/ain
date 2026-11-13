// A3 도면판 — 칸마다 view2d.js 의 그리기를 화면 밖 캔버스에 그대로 다시 돌려 한 장에 모으고 표제란을 쓴다 · 미리보기 창 · PNG 저장 · 인쇄. 배치·축척·표제란 글자는 core/sheet.js
import { createView2D, readTheme, drawSection } from './view2d.js';
import { SHEET, sheetLayout, sheetScale, titleRows } from './core/sheet.js';

export const SHEET_PX = 2480;   // A3 가로 150dpi(2480 × 1754)
const LW = 500, PAD = 4;   // 칸 하나의 논리 폭(px) — 글자 크기가 화면과 같은 비율로 나온다 · 칸 안쪽 여백(종이 mm)
// cells: [{ label, m(분석 종류, 평면은 null), bounds, scaled(축척을 맞춘다), routes, ana, axo } | { label, section(단면 자료, 없으면 null), note }] · info: 표제란 값(축척은 여기서 넣는다)
export function buildSheet({ store, state, cells, info }) {
  const k = SHEET_PX / SHEET.w, C = readTheme(), L = sheetLayout(cells.length), cv = document.createElement('canvas'), g = cv.getContext('2d');
  cv.width = SHEET_PX; cv.height = Math.round(SHEET.h * k);
  g.fillStyle = C.surface; g.fillRect(0, 0, cv.width, cv.height);
  const off = document.createElement('canvas'), none = { has: () => false, size: 0, ids: [] }, font = (mm, bold) => `${bold ? C.fw : 400} ${Math.round(mm * k)}px ${C.font}`;
  let st = state, ratio0 = 0;
  const v = createView2D(off, { store, getState: () => st, getSel: () => none, offscreen: true });
  g.textBaseline = 'middle'; g.lineWidth = Math.max(1, Math.round(0.2 * k));
  cells.forEach((c, i) => {
    const r = L.cells[i], bx = Math.round(r.x * k), by = Math.round((r.y + SHEET.cap) * k), bw = Math.round(r.w * k), bh = Math.round((r.h - SHEET.cap) * k);
    const ratio = c.scaled && c.bounds ? sheetScale(c.bounds, r.w - 2 * PAD, r.h - SHEET.cap - 2 * PAD) : 0; ratio0 ||= ratio;
    if ('section' in c) {
      if (c.section) { drawSection(off, C, c.section, LW, bw / LW); const s = Math.min(1, bh / off.height); g.drawImage(off, bx + (bw - off.width * s) / 2, by + (bh - off.height * s) / 2, off.width * s, off.height * s); }
      else { g.fillStyle = C.sub; g.font = font(3); g.textAlign = 'center'; g.fillText(c.note, bx + bw / 2, by + bh / 2); }
    } else {
      st = { ...state, analysis: c.m, showGrid: false, showLabels: c.m !== 'route' && c.m !== 'sun' };   // 동선·일조 칸은 방 글씨를 뺀다(작은 칸에서 번호·시각 글씨와 겹친다 — 방 이름은 평면 칸에)
      v.renderTo(LW, (LW * bh) / bw, bw / LW, { routes: c.routes, ana: c.ana, axo: c.axo, bounds: c.bounds, k: ratio ? LW / r.w / ratio : 0 });
      g.drawImage(off, bx, by, bw, bh);
    }
    g.fillStyle = C.ink; g.font = font(3.2, true); g.textAlign = 'left'; g.fillText(c.label, bx, (r.y + SHEET.cap / 2) * k);
    if (ratio) { g.fillStyle = C.sub; g.font = font(2.8); g.textAlign = 'right'; g.fillText(`1:${ratio}`, bx + bw, (r.y + SHEET.cap / 2) * k); }
    g.strokeStyle = C.control; g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  });
  const T = L.title, rows = titleRows({ ...info, ratio: ratio0 || 100 }), wide = 2, cw = T.w / (rows.length + wide - 1);   // 표제란: 첫 칸(도면 이름)은 두 칸 폭
  g.strokeStyle = C.ink; g.strokeRect(Math.round(T.x * k) + 0.5, Math.round(T.y * k) + 0.5, Math.round(T.w * k) - 1, Math.round(T.h * k) - 1);
  rows.forEach(([name, val], i) => {
    const x = T.x + (i ? i + wide - 1 : 0) * cw, w = (i ? 1 : wide) * cw;
    if (i) { g.strokeStyle = C.control; g.beginPath(); g.moveTo(Math.round(x * k) + 0.5, T.y * k); g.lineTo(Math.round(x * k) + 0.5, (T.y + T.h) * k); g.stroke(); }
    g.textAlign = 'left'; g.fillStyle = C.sub; g.font = font(2.6); g.fillText(name, (x + 3) * k, (T.y + 6) * k);
    g.fillStyle = C.ink; g.font = font(4, true); g.fillText(val, (x + 3) * k, (T.y + 13.5) * k, (w - 6) * k);
  });
  off.width = off.height = 0;   // 화면 밖 캔버스 메모리를 바로 돌려준다
  return cv;
}
// 미리보기 창 — [PNG 저장] [인쇄·PDF]. 인쇄는 plan.css 의 @page A3 가로 + body.printing 규칙이 도면판만 남긴다
export function openSheet({ h, openDialog, download, toast }, opts) { // h·openDialog·download·toast 는 app.js 의 것
  const cv = buildSheet(opts);
  cv.className = 'ed-sheet-cv'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `도면판 · ${opts.info.title} · ${opts.cells.map((c) => c.label).join(' · ')}`);
  const mark = () => document.body.classList.add('printing'), unmark = () => document.body.classList.remove('printing');   // 창이 떠 있는 동안은 브라우저 인쇄(Ctrl+P)도 도면판만 찍는다
  window.addEventListener('beforeprint', mark); window.addEventListener('afterprint', unmark);
  const print = () => { mark(); window.print(); };
  const save = () => cv.toBlob((b) => (b ? download(opts.name, b) : toast('이미지를 만들지 못했습니다', 'err')), 'image/png');
  const d = openDialog('도면판', [cv, h('div', { class: 'row ed-sheet-act' }, [h('button', { type: 'button', class: 'ed-b', text: '인쇄·PDF', onclick: print }), h('button', { type: 'button', class: 'ed-b primary', text: 'PNG 저장', onclick: save })])], { onclose: () => { window.removeEventListener('beforeprint', mark); window.removeEventListener('afterprint', unmark); unmark(); cv.width = cv.height = 0; } });
  d.el.classList.add('ed-sheet');
  return d;
}
