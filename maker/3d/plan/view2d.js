// 2D 캔버스 — 화면(px)↔도면(mm) 변환·팬줌(순수 함수)과 격자·밑그림·벽·방·개구부·기둥·제품(시스템에어컨·가전) 그리기(필요할 때만 rAF). import 해도 DOM 을 건드리지 않는다
import { curFloor, APPLIANCE_LABEL } from './core/model.js';
import { roomOutlineWithArcs, jointsOf, wallSlice, wallPieces, wallLen, wallPointAt, wallPoints, polyCentroid, polyArea, rectPoly, circlePoly, roomAreaM2 } from './core/geom.js';
import { findLabelSpot, swingPoly, swingSigns, rectInsidePoly } from './labels.js';
import { zoneOf, ZONE_LABEL } from './core/analysis.js';

/* ---------- 순수: 화면 변환 (scale = px/mm 하나) ---------- */
export const SCALE = Object.freeze({ min: 0.004, max: 2, start: 0.1 });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const newVP = (w = 800, h = 600) => ({ scale: SCALE.start, ox: w / 2 - 4000 * SCALE.start, oy: h / 2 - 3000 * SCALE.start, w, h });
export const toPx = (vp, p) => [p[0] * vp.scale + vp.ox, p[1] * vp.scale + vp.oy];
export const toMm = (vp, s) => [(s[0] - vp.ox) / vp.scale, (s[1] - vp.oy) / vp.scale];
export function zoomAt(vp, s, f) { // s(화면 px) 아래의 도면 점을 그대로 둔 채 배율만 곱한다
  const k = clamp(vp.scale * f, SCALE.min, SCALE.max), r = k / vp.scale;
  return { ...vp, scale: k, ox: s[0] - (s[0] - vp.ox) * r, oy: s[1] - (s[1] - vp.oy) * r };
}
export const panBy = (vp, dx, dy) => ({ ...vp, ox: vp.ox + dx, oy: vp.oy + dy });
export function viewRect(vp, padPx = 0) { // 보이는 도면 범위(mm)
  const [x0, y0] = toMm(vp, [-padPx, -padPx]), [x1, y1] = toMm(vp, [vp.w + padPx, vp.h + padPx]);
  return { x0, y0, x1, y1 };
}
// keep: b 가 최소 배율에도 다 안 들어갈 때 화면에 남길 상자(그림자 보기의 도면) — 보이는 창을 그쪽으로 민다. b 가 다 들어가면 쓰지 않는다
export function fitVP(vp, b, padPx = 56, insetR = 0, keep = null) { // 경계 상자 b 가 화면에 꽉 차게. 비었으면 처음 화면. insetR: 오른쪽에 떠 있는 단추 묶음 폭(px) — 그만큼 오른쪽을 더 비운다
  if (!b) return newVP(vp.w, vp.h);
  const bw = Math.max(b.x1 - b.x0, 500), bh = Math.max(b.y1 - b.y0, 500), pad = Math.min(padPx, vp.w / 4, vp.h / 4), padR = Math.max(pad, Math.min(insetR, vp.w / 3));
  const raw = Math.min((vp.w - pad - padR) / bw, (vp.h - 2 * pad) / bh), k = clamp(raw, SCALE.min, SCALE.max);
  let cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  if (keep && raw < SCALE.min) { const hw = (vp.w - pad - padR) / 2 / k, hh = (vp.h - 2 * pad) / 2 / k; cx = Math.min(keep.x0 + hw, Math.max(keep.x1 - hw, cx)); cy = Math.min(keep.y0 + hh, Math.max(keep.y1 - hh, cy)); }
  return { ...vp, scale: k, ox: pad + (vp.w - pad - padR) / 2 - cx * k, oy: vp.h / 2 - cy * k };
}
// 선분 p→q 의 끝 p 를 상자 [x0, y0, x1, y1] 안으로 선을 따라 당긴다(끝 글자가 안내 막대·눈금자에 겹치지 않게). 반 가까이(0.45)까지만
export function pullIn(p, q, [x0, y0, x1, y1]) {
  let t = 0;
  for (const [a, b, lo, hi] of [[p[0], q[0], x0, x1], [p[1], q[1], y0, y1]]) if (a !== b) t = Math.max(t, (clamp(a, lo, hi) - a) / (b - a));
  t = Math.min(t, 0.45);
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
}
const GRID = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
export function gridSteps(scale, minPx = 9) { // 가는 격자(기본 100mm)와 굵은 격자(10배, 기본 1000mm)
  const minor = GRID.find((s) => s * scale >= minPx) ?? GRID.at(-1);
  return { minor, major: minor * 10 };
}
// 화면 안에 들어오는 격자선의 화면 좌표(px). 반복 횟수를 화면 칸 수로 세므로 좌표가 극단적으로 커서 step 을 더해도 값이 안 변하는 경우에도 끝난다
export function gridLines(origin, size, scale, step) {
  const i0 = Math.ceil(-origin / scale / step), n = Math.min(Math.floor(size / (scale * step)) + 2, 4000), out = [];
  for (let k = 0, prev; k < n; k++) { const p = (i0 + k) * step * scale + origin; if (!(p <= size) || p === prev) break; out.push(Math.round(p) + 0.5); prev = p; }
  return out;
}
export const snapStep = (scale) => [50, 100, 500, 1000, 5000, 10000].find((s) => s * scale >= 4) ?? 10000; // 스냅 격자(기본 50mm)
export function niceLen(mmTarget) { // 눈금자용 보기 좋은 길이(1·2·5 × 10^n)
  const e = 10 ** Math.floor(Math.log10(Math.max(mmTarget, 1))), m = mmTarget / e;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
}
export function fmtLen(mm, unit = 'mm') {
  if (unit === 'ft') { const inch = Math.round(Math.abs(mm) / 25.4), ft = Math.floor(inch / 12); return (mm < 0 ? '-' : '') + (ft ? `${ft}′ ` : '') + `${inch % 12}″`; }
  return Math.round(mm).toLocaleString('ko-KR') + ' mm';
}
export function fmtArea(m2, unit = 'mm') {
  const v = unit === 'ft' ? m2 * 10.7639 : m2;
  return v.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + (unit === 'ft' ? ' ft²' : ' m²');
}
// 층의 방 면적 합(m²). withWalls 면 방을 둘러싼 벽의 면적(길이 × 두께)을 벽마다 한 번만 더한다 — 이웃 방이 같이 쓰는 벽을 두 번 세지 않는다
export function floorAreaM2(doc, f, withWalls = false) {
  const net = f.rooms.reduce((s, r) => s + roomAreaM2(doc, r), 0);
  if (!withWalls) return net;
  const used = new Set(f.rooms.flatMap((r) => r.wallIds));
  return net + f.walls.reduce((s, w) => s + (used.has(w.id) ? (wallLen(w) * w.t) / 1e6 : 0), 0);
}
export const angleDeg = (a, b) => (((Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180) / Math.PI) + 360) % 360; // 오른쪽 0°, 위쪽 90°(화면 기준)

/* ---------- 층 캐시: 불변 문서라 층 객체가 그대로면 계산도 그대로, 요소 객체가 그대로면 그 요소의 그림 자료도 그대로 ---------- */
const CACHE = new WeakMap(), ENT = new WeakMap();
const boxOf = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
};
const memo = (el, key, make) => { const m = ENT.get(el); if (m && m.key === key) return m.e; const e = make(); ENT.set(el, { key, e }); return e; }; // 끌어서 옮기는 동안 안 바뀐 요소는 다시 계산하지 않는다
function build(f) {
  const J = jointsOf(f.walls), byWall = new Map(), by = new Map(), wallById = new Map(f.walls.map((w) => [w.id, w]));
  for (const o of f.openings) { if (!byWall.has(o.wall)) byWall.set(o.wall, []); byWall.get(o.wall).push(o); }
  const walls = f.walls.map((w) => { // 개구부 구간을 비운 조각들. 끝 접합과 개구부가 같으면 지난 조각을 그대로 쓴다
    const ends = J(w), ops = byWall.get(w.id) || [], key = (ends.a || ends.b ? JSON.stringify(ends) : '') + '|' + ops.map((o) => o.at + ':' + o.width).join(',');
    const e = memo(w, key, () => {
      const polys = wallPieces(w, ops, ends);
      const outline = polys.length ? polys : [wallSlice(w, 0, 1, ends)];
      return { kind: 'wall', el: w, polys, outline, box: boxOf(outline.flat()) };
    });
    by.set(w.id, e); return e;
  });
  const rooms = f.rooms.map((r) => { // 방 바닥은 벽의 곡선(호)을 따른다 — 벽이 바뀌면 다시 만든다
    const e = memo(r, r.wallIds.map((id) => { const w = wallById.get(id); return w ? `${w.bulge}|${w.a}|${w.b}` : '-'; }).join(';'), () => { const poly = roomOutlineWithArcs(r, f.walls); return { kind: 'room', el: r, poly, outline: [poly], box: boxOf(poly), c: polyCentroid(poly), net: polyArea(poly) / 1e6 }; });
    by.set(r.id, e); return e; });
  const cols = f.columns.map((c) => { const e = memo(c, '', () => { const poly = c.kind === 'round' ? circlePoly(c.c, c.w / 2, 24) : rectPoly(c.c, c.w, c.d, c.rot); return { kind: 'column', el: c, poly, outline: [poly], box: boxOf(poly) }; }); by.set(c.id, e); return e; });
  const items = f.items.map((i) => { const e = memo(i, '', () => { const poly = rectPoly(i.c, i.size[0], i.size[1], i.rot); return { kind: 'item', el: i, poly, outline: [poly], box: boxOf(poly) }; }); by.set(i.id, e); return e; });
  const guides = f.guides.map((g) => { const e = memo(g, '', () => ({ kind: 'guide', el: g, outline: [[g.a, g.b]], box: boxOf([g.a, g.b]) })); by.set(g.id, e); return e; });
  const ops = [];
  for (const o of f.openings) {
    const w = wallById.get(o.wall); if (!w) continue;
    const e = memo(o, w, () => { // 개구부 그림은 그 벽 객체가 그대로일 때만 재사용
      const { p, tan } = wallPointAt(w, o.at), n = [-tan[1], tan[0]], W = o.width / 2, T = w.t / 2 + 40;
      const poly = [[p[0] - tan[0] * W - n[0] * T, p[1] - tan[1] * W - n[1] * T], [p[0] + tan[0] * W - n[0] * T, p[1] + tan[1] * W - n[1] * T], [p[0] + tan[0] * W + n[0] * T, p[1] + tan[1] * W + n[1] * T], [p[0] - tan[0] * W + n[0] * T, p[1] - tan[1] * W + n[1] * T]];
      return { kind: 'opening', el: o, w, p, tan, n, outline: [poly], box: boxOf([[p[0] - o.width - w.t, p[1] - o.width - w.t], [p[0] + o.width + w.t, p[1] + o.width + w.t]]) };
    });
    ops.push(e); by.set(o.id, e);
  }
  return { walls, rooms, cols, items, guides, ops, by };
}
export function floorCache(f) { let c = CACHE.get(f); if (!c) CACHE.set(f, (c = build(f))); return c; }
/* 글씨 자리 — 문이 열리는 호·기둥·제품을 피한다(labels.js). 층 캐시에 붙여 두므로 문서가 바뀌면 같이 버려지고, 같은 배율에서는 다시 계산하지 않는다 */
function swingsOf(fc) { return fc.swings || (fc.swings = fc.ops.filter((o) => o.el.type === 'door').map((o) => { const poly = swingPoly(o); return { poly, box: boxOf(poly) }; })); }
function avoidOf(fc) { return fc.avoid || (fc.avoid = swingsOf(fc).concat(fc.cols.map((c) => ({ poly: c.poly, box: c.box })), fc.items.map((i) => ({ poly: i.poly, box: i.box })))); }
function spotOf(fc, key, args) { const m = fc.spots || (fc.spots = new Map()); let v = m.get(key); if (!v) { if (m.size > 3000) m.clear(); m.set(key, (v = args ? findLabelSpot(args) : null)); } return v; }

/* ---------- 그리기 보조 ---------- */
export function drawPill(ctx, C, text, x, y, { color } = {}) { // 라벨 알약 — 중심 (x, y)
  ctx.save();
  ctx.font = `${C.fw} ${C.fs4}px ${C.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 10, h = C.fs4 + 8;
  ctx.fillStyle = C.surface; ctx.strokeStyle = color || C.line; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(Math.round(x - w / 2) + 0.5, Math.round(y - h / 2) + 0.5, w, h, C.r1); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color || C.ink; ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}
export function drawCrosshair(ctx, C, x, y, r = 10) { // 키보드 커서 십자 — 어떤 바탕에서도 보이게 밝은 선 위에 강조색 선을 한 번 더 긋는다
  ctx.save(); ctx.lineCap = 'round';
  for (const [color, w] of [[C.surface, 4], [C.accent, 2]]) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); }
  ctx.restore();
}
export function readTheme() { // 캔버스 색은 토큰(CSS 변수)에서 읽는다
  const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim(), bs = getComputedStyle(document.body);
  return { bg: g('--c-surface-sub'), surface: g('--c-surface'), ink: g('--c-ink'), sub: g('--c-ink-sub'), faint: g('--c-ink-faint'), line: g('--c-line'), strong: g('--c-line-strong'), control: g('--c-control'), accent: g('--c-accent'), accentBg: g('--c-accent-bg'), accentLine: g('--c-accent-line'), up: g('--c-up'), font: bs.fontFamily, fs3: parseFloat(g('--fs-3')) || 13, fs4: parseFloat(g('--fs-4')) || 11.5, fw: g('--fw-semi') || '600', r1: parseFloat(g('--r-1')) || 6 };
}

const zoneColors = (C) => ({ public: C.accent, private: C.up, service: C.control });   // 존 색(평면의 존 보기 · 액소 바닥)
// 분해 액소 — sc = core/axo.js axoScene() 의 결과. ctx 는 mm→화면 변환이 걸린 채로 받는다(px = 화면 1px 의 mm). 바닥(존 색) → 벽·기기 면(먼 것부터) → 천장선(점선)
export function drawAxo(ctx, C, sc, px) {
  const path = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); }, ZC = zoneColors(C);
  ctx.lineJoin = 'round'; ctx.lineWidth = px; ctx.setLineDash([]);
  for (const r of sc.floors) { path(r.pts); ctx.globalAlpha = 0.2; ctx.fillStyle = ZC[r.zone] || C.accentBg; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = C.sub; ctx.stroke(); }
  ctx.strokeStyle = C.ink;
  for (const f of sc.faces) { path(f.pts); ctx.fillStyle = f.kind === 'ac' ? C.accent : f.kind === 'appliance' ? C.control : f.side === 'top' ? C.surface : f.side === 'l' ? C.line : C.strong; ctx.fill(); ctx.stroke(); }
  ctx.strokeStyle = C.sub; ctx.setLineDash([6 * px, 4 * px]);
  for (const pts of sc.ceil) { path(pts); ctx.stroke(); }
  ctx.setLineDash([]);
}

/* ---------- 캔버스 뷰 ---------- */
export function createView2D(canvas, { store, getState, getSel }) {
  const ctx = canvas.getContext('2d');
  let vp = newVP(), dpr = 1, raf = 0, C = readTheme();
  const imgs = new Map(), view = { hover: null, overlay: null, onChange: null, underlayTemp: null, drawCount: 0, routes: [], ana: null, axo: null };   // routes: 동선 보기에서 그릴 경로 · ana: 일조·단면·그림자 보기에서 그릴 것 { north, shade:[{ polys, tip, text }], sun:[{ poly, text, now }], cut:null|[북 끝, 남 끝] } · axo: 액소 보기에서 그릴 장면(core/axo.js) (모두 app.js 가 넣는다, 계산은 core/sun.js)
  const changed = () => { requestDraw(); if (view.onChange) view.onChange(vp); };
  const set = (next) => { vp = next; changed(); };
  function requestDraw() { if (!raf) raf = requestAnimationFrame(draw); }
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth)), h = Math.max(1, Math.round(canvas.clientHeight));
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    vp = { ...vp, w, h }; C = readTheme(); changed();
  }
  function underlayImg(u) {
    let e = imgs.get(u.src);
    if (!e) {
      e = { im: new Image(), ok: false }; e.im.onload = () => { e.ok = true; requestDraw(); }; e.im.src = u.src; imgs.set(u.src, e);
      if (imgs.size > 3) imgs.delete(imgs.keys().next().value);
    }
    return e.ok ? e.im : null;
  }

  function path(poly, close = true) { ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (close) ctx.closePath(); }
  function grid() {
    const { minor, major } = gridSteps(vp.scale), line = (step, color) => {
      ctx.strokeStyle = color; ctx.beginPath();
      for (const X of gridLines(vp.ox, vp.w, vp.scale, step)) { ctx.moveTo(X, 0); ctx.lineTo(X, vp.h); }
      for (const Y of gridLines(vp.oy, vp.h, vp.scale, step)) { ctx.moveTo(0, Y); ctx.lineTo(vp.w, Y); }
      ctx.stroke();
    };
    ctx.lineWidth = 1; ctx.globalAlpha = 0.55; line(minor, C.line); ctx.globalAlpha = 1; line(major, C.strong);
  }
  function openingSymbol(e, color, px) {
    const { el: o, w, p, tan, n } = e, W = o.width / 2, T = w.t / 2, at = (a, b) => [p[0] + tan[0] * a + n[0] * b, p[1] + tan[1] * a + n[1] * b];
    ctx.strokeStyle = color; ctx.lineWidth = px; ctx.beginPath();
    for (const s of [-W, W]) { const a = at(s, -T), b = at(s, T); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } // 문틀·창틀
    if (o.type === 'window') for (const t of [-T, 0, T]) { const a = at(-W, t), b = at(W, t); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    if (o.type === 'door') { // 경첩 문틀(기본 a 쪽)에서 문짝이 열린 쪽(기본 +법선)으로 90° 열린 모양
      const { hs, sg } = swingSigns(o), hg = at(hs * W, 0), tip = at(hs * W, sg * o.width), t = [-hs * tan[0], -hs * tan[1]];
      ctx.lineWidth = px * 1.5; ctx.beginPath(); ctx.moveTo(hg[0], hg[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
      ctx.lineWidth = px; ctx.beginPath(); ctx.arc(hg[0], hg[1], o.width, Math.atan2(sg * n[1], sg * n[0]), Math.atan2(t[1], t[0]), hs * sg === -1); ctx.stroke();  // 닫힌 문짝→열린 문짝의 돌아가는 방향은 (경첩, 열림) 부호 곱이 −1 일 때 원래 방향
    }
  }
  function wallLabel(e, st) { // 선택한 벽의 길이 라벨 — 벽 한가운데 옆
    const { p, tan } = wallPointAt(e.el, 0.5), q = toPx(vp, p), nx = -tan[1], ny = tan[0];
    drawPill(ctx, C, fmtLen(wallLen(e.el), st.unit), q[0] + nx * (e.el.t * vp.scale / 2 + 14), q[1] + ny * (e.el.t * vp.scale / 2 + 14), { color: C.accent });
  }

  // 가전 글씨: 분류 이름(굵게)을 상자 가운데에 — 상자 안에 들어갈 때만. 그 아래 모델 코드는 상자 안에서 문 호·방 글씨·분류 이름을 피한 자리에 — 안 들어가면 생략한다(작은 제품은 글씨 없음)
  function applianceLabels(e, avoid, many) {
    const s = vp.scale, [cx, cy] = e.el.c, name = APPLIANCE_LABEL[e.el.category] ?? e.el.category, taken = [];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${C.fw} ${C.fs3}px ${C.font}`;
    const nw = ctx.measureText(name).width, hx = (nw + 6) / 2 / s, hy = (C.fs3 + 4) / 2 / s, r = [cx - hx, cy - hy, cx + hx, cy + hy];
    if (!rectInsidePoly(e.poly, r)) return;
    const q = toPx(vp, [cx, cy]);
    ctx.fillStyle = C.ink; ctx.fillText(name, q[0], q[1]);
    taken.push({ poly: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], box: r });
    const code = e.el.code || e.el.model;
    ctx.font = `${C.fs4}px ${C.font}`;
    const cw = ctx.measureText(code).width, sp = many ? { x: cx, y: cy + (C.fs3 + C.fs4) / 2 / s } : findLabelSpot({ poly: e.poly, center: [cx, cy + (C.fs3 + C.fs4 - 2) / 2 / s], w: cw / s, h: C.fs4 / s, avoid: avoid.concat(taken), step: 5 / s, pad: 2 / s, maxRadius: Math.hypot(e.box[2] - e.box[0], e.box[3] - e.box[1]) / 2 });
    if (sp.blocked) return;
    const p = toPx(vp, [sp.x, sp.y]);
    ctx.fillStyle = C.sub; ctx.fillText(code, p[0], p[1]);
  }

  function draw() {
    raf = 0; view.drawCount++;
    const st = getState(), doc = store.doc, f = curFloor(doc), fc = floorCache(f), sel = getSel(), s = vp.scale, px = 1 / s, R = viewRect(vp, 40);
    const vis = (b) => b[2] >= R.x0 && b[0] <= R.x1 && b[3] >= R.y0 && b[1] <= R.y1;
    const P = st.analysis === 'poche', Z = st.analysis === 'zone', ZC = zoneColors(C);   // 분석 보기 — 포셰: 벽·기둥만 진하게, 존: 방을 구분 색으로
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, vp.w, vp.h);
    const AX = st.analysis === 'axo' && view.axo;   // 액소: 평면 대신 투영한 장면만(격자·글씨·선택 표시·눈금자 없음). 끌기·확대는 그대로
    if (st.showGrid && !P && !AX) grid();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * vp.ox, dpr * vp.oy);
    ctx.lineJoin = 'round';
    if (AX) return drawAxo(ctx, C, AX, px);
    const u0 = doc.underlay; // 밑그림
    if (u0 && !P) {
      const u = view.underlayTemp ? { ...u0, ...view.underlayTemp } : u0, im = underlayImg(u0);
      if (im) { ctx.save(); ctx.globalAlpha = u.opacity; ctx.translate(u.x, u.y); ctx.rotate((u.rot * Math.PI) / 180); ctx.scale(u.mmPerPx, u.mmPerPx); ctx.drawImage(im, 0, 0); ctx.restore(); }
    }
    if (doc.cur > 0 && !P) { // 아래층은 흐리게
      const g = floorCache(doc.floors[doc.cur - 1]);
      ctx.globalAlpha = 0.3; ctx.fillStyle = C.faint;
      for (const e of g.walls) if (vis(e.box)) for (const poly of e.polys) { path(poly); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    const AN = view.ana;
    if (AN) { // 땅 그림자: 시각마다 조각을 한 경로에 모아 한 번에 칠한다(nonzero = 합집합). 시각끼리 겹친 곳은 더 진하다
      ctx.fillStyle = C.ink; ctx.globalAlpha = 0.16;
      for (const sh of AN.shade) { ctx.beginPath(); for (const poly of sh.polys) { poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); } ctx.fill('nonzero'); }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = Z ? 0.2 : st.floorAlpha; ctx.fillStyle = C.accentBg; // 방 바닥
    if (!P) for (const e of fc.rooms) if (vis(e.box)) { if (Z) ctx.fillStyle = ZC[zoneOf(e.el)]; path(e.poly); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.faint; ctx.lineWidth = px; ctx.setLineDash([6 * px, 4 * px]); // 보조선
    if (!P) for (const e of fc.guides) if (vis(e.box)) { path(e.el.a ? [e.el.a, e.el.b] : [], false); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.globalAlpha = P ? 1 : st.wallAlpha; // 벽: 내벽은 보조 잉크, 외벽은 잉크
    for (const kind of ['inner', 'exterior']) {
      ctx.fillStyle = kind === 'exterior' || P ? C.ink : C.sub;
      for (const e of fc.walls) if (e.el.kind === kind && vis(e.box)) for (const poly of e.polys) { path(poly); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    if (!P) for (const e of fc.ops) if (vis(e.box)) openingSymbol(e, C.ink, px);
    for (const e of fc.cols) if (vis(e.box)) { path(e.poly); ctx.fillStyle = P ? C.ink : C.sub; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = px; ctx.stroke(); }
    if (!P) for (const e of fc.items) if (vis(e.box) && e.el.kind === 'appliance') { // 가전: 연한 면 + 가는 실선 테두리(에어컨의 판넬 테두리 + X 와 구분). 에어컨이 위에 겹쳐 보이도록 먼저 그린다
      path(e.poly); ctx.globalAlpha = 0.6; ctx.fillStyle = C.line; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = C.sub; ctx.lineWidth = px; ctx.stroke();
    }
    if (!P) for (const e of fc.items) if (vis(e.box) && e.el.kind !== 'appliance') { // 에어컨: 판넬 테두리 + 가운데 X
      const poly = e.poly; path(poly); ctx.fillStyle = C.surface; ctx.fill(); ctx.strokeStyle = C.accent; ctx.lineWidth = px * 1.5; ctx.stroke();
      ctx.lineWidth = px; ctx.strokeStyle = C.accentLine; path([poly[0], poly[2]], false); ctx.stroke(); path([poly[1], poly[3]], false); ctx.stroke();
    }
    if (AN) for (const e of AN.sun) { path(e.poly); ctx.globalAlpha = e.now ? 0.4 : 0.14; ctx.fillStyle = C.up; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = C.up; ctx.lineWidth = (e.now ? 2 : 1) * px; ctx.stroke(); } // 햇빛 자리: 매시 자리는 옅게 겹치고 한 시각은 진하게
    const hl = (ids, color, wpx) => { // 선택·가리킨 것 윤곽
      ctx.strokeStyle = color; ctx.lineWidth = wpx * px;
      for (const id of ids) { const e = fc.by.get(id); if (e && vis(e.box)) for (const o of e.outline) { path(o, e.kind !== 'guide'); ctx.stroke(); } }
    };
    if (view.hover && !sel.has(view.hover.id)) hl([view.hover.id], view.hover.danger ? C.up : C.accent, 1.5);
    if (sel.size) hl(sel.ids, C.accent, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 여기부터 화면 좌표
    if ((st.showLabels || Z) && !P) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const many = fc.rooms.reduce((n, e) => n + (vis(e.box) ? 1 : 0), 0) > 60, taken = [];   // 방이 아주 많으면 자리 찾기는 건너뛰고 중심에 쓴다 · taken: 이미 글씨를 쓴 자리(제품 모델명이 피한다)
      for (const e of fc.rooms) {
        if (!vis(e.box)) continue;
        const w = (e.box[2] - e.box[0]) * s, h = (e.box[3] - e.box[1]) * s; if (w < 56 || h < 30) continue;
        const area = (Z ? ZONE_LABEL[zoneOf(e.el)] + ' · ' : '') + fmtArea(st.areaGross ? roomAreaM2(doc, e.el, { withWalls: true }) : e.net, st.unit);   // 존 보기: 색만으로 구분하지 않게 구분 이름을 같이 쓴다
        ctx.font = `${C.fw} ${C.fs3}px ${C.font}`; const nw = ctx.measureText(e.el.name).width; ctx.font = `${C.fs4}px ${C.font}`; const aw = ctx.measureText(area).width;
        const lw = Math.max(nw, aw), lh = C.fs3 + C.fs4 + 8;   // 이름 + 면적 두 줄 상자
        let sp = many ? { x: e.c[0], y: e.c[1] } : spotOf(fc, `${e.el.id}|${s.toFixed(4)}|${Math.round(lw)}`, { poly: e.poly, center: e.c, w: lw / s, h: lh / s, avoid: avoidOf(fc), step: 8 / s, pad: 3 / s }) || { x: e.c[0], y: e.c[1] }, nameOnly = false;
        if (sp.blocked) { const one = spotOf(fc, `${e.el.id}|${s.toFixed(4)}|${Math.round(nw)}|n`, { poly: e.poly, center: e.c, w: nw / s, h: (C.fs3 + 4) / s, avoid: avoidOf(fc), step: 6 / s, pad: 3 / s }); if (one && !one.blocked) { sp = one; nameOnly = true; } }   // 두 줄이 안 들어가면 이름만이라도 비켜서
        const q = toPx(vp, [sp.x, sp.y]), hx = (lw + 6) / 2 / s, hy = (nameOnly ? C.fs3 + 4 : lh) / 2 / s, rect = [[sp.x - hx, sp.y - hy], [sp.x + hx, sp.y - hy], [sp.x + hx, sp.y + hy], [sp.x - hx, sp.y + hy]];
        taken.push({ poly: rect, box: [sp.x - hx, sp.y - hy, sp.x + hx, sp.y + hy] });
        ctx.fillStyle = C.ink; ctx.font = `${C.fw} ${C.fs3}px ${C.font}`; ctx.fillText(e.el.name, q[0], nameOnly ? q[1] : q[1] - C.fs4 * 0.7);
        if (!nameOnly) { ctx.fillStyle = Z ? C.ink : C.sub; ctx.font = `${C.fs4}px ${C.font}`; ctx.fillText(area, q[0], q[1] + C.fs3 * 0.8); }
      }
      ctx.font = `${C.fs4}px ${C.font}`; ctx.fillStyle = C.sub;
      const avoidCode = swingsOf(fc).concat(taken);          // 문 호 + 방 이름·면적 글씨 — 이 프레임에서만 쓰므로 캐시하지 않는다(중심이 비어 있으면 바로 끝난다)
      for (const e of fc.items) {
        if (!vis(e.box)) continue;
        if (e.el.kind === 'appliance') { applianceLabels(e, avoidCode, many); continue; }
        if ((e.box[2] - e.box[0]) * s < 44) continue;
        ctx.font = `${C.fs4}px ${C.font}`; ctx.fillStyle = C.sub;   // 가전 글씨가 바꿔 둔 글꼴·색을 되돌린다
        const code = e.el.code || e.el.model.toUpperCase(), cw = ctx.measureText(code).width;
        const sp = many ? { x: e.el.c[0], y: e.el.c[1] } : findLabelSpot({ center: e.el.c, w: cw / s, h: C.fs4 / s, avoid: avoidCode, step: 6 / s, pad: 2 / s, maxRadius: Math.hypot(e.box[2] - e.box[0], e.box[3] - e.box[1]) / 2 + cw / s });
        if (sp.blocked) continue;                           // 피할 자리가 없으면 겹쳐 쓰지 않고 생략한다(모델명은 제품 패널·물량표에 있다)
        const q = toPx(vp, [sp.x, sp.y]); ctx.fillText(code, q[0], q[1]);
      }
    }
    for (const id of sel.ids) { const e = fc.by.get(id); if (!e || !vis(e.box)) continue; if (e.kind === 'wall') wallLabel(e, st); else if (e.kind === 'guide') { const q = toPx(vp, [(e.el.a[0] + e.el.b[0]) / 2, (e.el.a[1] + e.el.b[1]) / 2]); drawPill(ctx, C, fmtLen(Math.hypot(e.el.a[0] - e.el.b[0], e.el.a[1] - e.el.b[1]), st.unit), q[0], q[1] - 14, { color: C.accent }); } }
    if (st.analysis === 'route') view.routes.forEach((r, n) => { // 동선: 밝은 선 위에 강조색 선(어떤 바탕에서도 보인다) + 양 끝 점 + 가운데에 번호·거리(번호는 표와 같다)
      if (!r.ok) return;
      const q = r.pts.map((p) => toPx(vp, p));
      ctx.lineCap = ctx.lineJoin = 'round';
      for (const [color, w] of [[C.surface, 6], [C.accent, 3]]) { ctx.strokeStyle = color; ctx.lineWidth = w; path(q, false); ctx.stroke(); }
      for (const p of [q[0], q[q.length - 1]]) { ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, 2 * Math.PI); ctx.fillStyle = C.accent; ctx.fill(); ctx.strokeStyle = C.surface; ctx.lineWidth = 2; ctx.stroke(); }
      let half = r.lenMm / 2, m = q[0];
      for (let i = 0; i + 1 < r.pts.length; i++) { const a = r.pts[i], b = r.pts[i + 1], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (half <= d && d > 0) { m = toPx(vp, [a[0] + ((b[0] - a[0]) * half) / d, a[1] + ((b[1] - a[1]) * half) / d]); break; } half -= d; }
      drawPill(ctx, C, `${n + 1} · ${(r.lenMm / 1000).toFixed(1)} m`, m[0], m[1], { color: C.accent });
    });
    if (AN) { // 일조·단면·그림자: 글자(색만으로 구분하지 않는다) · 자른 선 · 방위표
      ctx.font = `${C.fw} ${C.fs4}px ${C.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const safe = [24, (view.insetTop ? view.insetTop() : 0) + 16, vp.w - 24, vp.h - (vp.w >= 560 ? 48 : 16)];   // 가장자리 글자가 설 수 있는 범위: 위는 안내 막대 아래, 아래는 눈금자 위
      for (const e of AN.sun) { // 자리 가운데에 시각 — 매시 자리는 들어갈 만큼 클 때만
        const b = boxOf(e.poly), q = toPx(vp, polyCentroid(e.poly));
        if (e.now) drawPill(ctx, C, e.text, q[0], q[1], { color: C.up });
        else if (Math.min(b[2] - b[0], b[3] - b[1]) * s >= 18) { ctx.strokeStyle = C.surface; ctx.lineWidth = 3; ctx.strokeText(e.text, q[0], q[1]); ctx.fillStyle = C.ink; ctx.fillText(e.text, q[0], q[1]); }
      }
      for (const sh of AN.shade) { const q = toPx(vp, sh.tip); drawPill(ctx, C, sh.text, clamp(q[0], 48, vp.w - 48), clamp(q[1], safe[1], safe[3])); }   // 그림자 끝이 화면 밖이면 가장자리에
      if (AN.cut) {
        const q = AN.cut.map((p) => toPx(vp, p));
        for (const [color, w, dash] of [[C.surface, 6, []], [C.accent, 2, [10, 4, 2, 4]]]) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash); path(q, false); ctx.stroke(); }
        ctx.setLineDash([]);
        const n = pullIn(q[0], q[1], safe), z = pullIn(q[1], q[0], safe);
        drawPill(ctx, C, '북', n[0], n[1], { color: C.accent }); drawPill(ctx, C, '남', z[0], z[1], { color: C.accent });
      }
      const cx = 36, cy = 108, r = 16, t = (AN.north * Math.PI) / 180, d = [-Math.sin(t), -Math.cos(t)], tip = [cx + d[0] * 11, cy + d[1] * 11], at = (k, w) => [tip[0] - d[0] * k - d[1] * w, tip[1] - d[1] * k + d[0] * w];   // 방위표: 원 + 북쪽 화살(선) + N
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fillStyle = C.surface; ctx.fill(); ctx.strokeStyle = C.control; ctx.lineWidth = 1; ctx.stroke();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx - d[0] * 11, cy - d[1] * 11); ctx.lineTo(tip[0], tip[1]); ctx.moveTo(...at(7, 5)); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(...at(7, -5)); ctx.stroke();
      ctx.strokeStyle = C.surface; ctx.lineWidth = 3; ctx.strokeText('N', cx + d[0] * (r + 9), cy + d[1] * (r + 9)); ctx.fillStyle = C.ink; ctx.fillText('N', cx + d[0] * (r + 9), cy + d[1] * (r + 9));
    }
    if (vp.w >= 560) { // 눈금자
      const len = niceLen(120 / s), x1 = vp.w / 2 + (len * s) / 2, x0 = x1 - len * s, y = vp.h - 16;
      ctx.strokeStyle = C.sub; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x0) + 0.5, y - 4); ctx.lineTo(Math.round(x0) + 0.5, y); ctx.lineTo(Math.round(x1) + 0.5, y); ctx.lineTo(Math.round(x1) + 0.5, y - 4); ctx.stroke();
      ctx.fillStyle = C.sub; ctx.font = `${C.fs4}px ${C.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(fmtLen(len, st.unit), vp.w / 2, y - 3);
    }
    if (view.overlay) view.overlay({ ctx, vp, C, st, toPx: (p) => toPx(vp, p), fmt: (mm) => fmtLen(mm, st.unit) });
  }

  canvas.addEventListener('wheel', (e) => { // 휠 = 커서 기준 확대·축소
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    set(zoomAt(vp, [e.clientX - r.left, e.clientY - r.top], Math.exp(-e.deltaY * k * (e.ctrlKey ? 0.01 : 0.0016))));
  }, { passive: false });
  new ResizeObserver(resize).observe(canvas);

  Object.defineProperties(view, { vp: { get: () => vp }, theme: { get: () => C } }); // 읽을 때마다 지금 값(Object.assign 은 getter 를 값으로 굳혀 버린다)
  return Object.assign(view, {
    resize, requestDraw, set,
    refreshTheme() { C = readTheme(); requestDraw(); },
    zoomAt: (s, f) => set(zoomAt(vp, s, f)), zoomCenter: (f) => set(zoomAt(vp, [vp.w / 2, vp.h / 2], f)), panBy: (dx, dy) => set(panBy(vp, dx, dy)),
    fit(b) { set(fitVP(vp, b, undefined, view.insetRight ? view.insetRight() : 0, b && b.keep)); }, centerOn(p) { set({ ...vp, ox: vp.w / 2 - p[0] * vp.scale, oy: vp.h / 2 - p[1] * vp.scale }); },
    toMm: (s) => toMm(vp, s), toPx: (p) => toPx(vp, p),
    entry: (id) => floorCache(curFloor(store.doc)).by.get(id) || null,
  });
}

/* ---------- 단면 그림(분석 칸의 작은 캔버스) — sec = core/sun.js section() 의 결과 ---------- */
// 왼쪽이 북, 오른쪽이 남. 가로·세로 같은 배율. 잘린 벽은 채우고 개구부 자리는 비운다(창은 가는 두 줄). 정오 햇빛은 기준 창 윗단에서 안쪽 바닥으로 — 동지 실선, 하지 점선(색만으로 구분하지 않는다)
export function drawSection(canvas, C, sec) {
  const dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(canvas.clientWidth)), pad = 8, top = C.fs4 + 12, rows = sec.ref ? 2 : 0;
  const k = (w - 2 * pad) / (sec.u1 - sec.u0), h = Math.round(top + sec.H * k + 8 + rows * (C.fs4 + 6) + 4), X = (u) => pad + (u - sec.u0) * k, Y = (z) => top + (sec.H - z) * k;
  canvas.style.height = h + 'px'; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.dataset.w = String(w);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.font = `${C.fw} ${C.fs4}px ${C.font}`; ctx.textBaseline = 'middle'; ctx.fillStyle = C.sub;
  ctx.textAlign = 'left'; ctx.fillText('북', pad, top / 2); ctx.textAlign = 'right'; ctx.fillText('남', w - pad, top / 2);
  ctx.strokeStyle = C.control; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, Math.round(Y(0)) + 0.5); ctx.lineTo(w - pad, Math.round(Y(0)) + 0.5); ctx.stroke();   // 땅
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.textAlign = 'center';
  for (const r of sec.rooms) { // 방: 바닥·천장 선과 이름
    ctx.beginPath(); ctx.moveTo(X(r.u0), Y(0)); ctx.lineTo(X(r.u1), Y(0)); ctx.moveTo(X(r.u0), Y(sec.H)); ctx.lineTo(X(r.u1), Y(sec.H)); ctx.stroke();
    if (ctx.measureText(r.name).width + 6 <= (r.u1 - r.u0) * k) { ctx.fillStyle = C.sub; ctx.fillText(r.name, X((r.u0 + r.u1) / 2), Y(sec.H / 2)); }
  }
  ctx.fillStyle = C.ink;
  for (const c of sec.cuts) {
    const x = X(c.u - c.t / 2), tw = Math.max(1.5, c.t * k), bar = (z0, z1) => { if (z1 > z0) ctx.fillRect(x, Y(z1), tw, (z1 - z0) * k); };
    if (!c.gap) { bar(0, sec.H); continue; }
    bar(0, c.gap.z0); bar(c.gap.z1, sec.H);
    if (c.gap.type === 'window') { ctx.lineWidth = 1; ctx.beginPath(); for (const dx of [tw / 2 - 1, tw / 2 + 1]) { ctx.moveTo(x + dx, Y(c.gap.z0)); ctx.lineTo(x + dx, Y(c.gap.z1)); } ctx.stroke(); }
  }
  if (!sec.ref) return;
  [['동지', sec.winter, []], ['하지', sec.summer, [4, 3]]].forEach(([name, day, dash], i) => {
    const y = Y(0) + 8 + (i + 0.5) * (C.fs4 + 6);
    ctx.strokeStyle = C.up; ctx.lineWidth = 1.5; ctx.setLineDash(dash);
    if (day.depth > 0) { // 맞은편 벽에 먼저 닿으면 거기서 끊는다
      const d = sec.roomDepth > 0 ? Math.min(day.depth, sec.roomDepth) : day.depth;
      ctx.beginPath(); ctx.moveTo(X(0), Y(sec.ref.z1)); ctx.lineTo(X(sec.ref.inward * d), Y(sec.ref.z1 * (1 - d / day.depth))); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(pad + 22, y); ctx.stroke(); ctx.setLineDash([]);   // 범례: 선 모양 + 글자
    ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.fillText(`${name} ${day.depth > 0 ? (day.depth / 1000).toFixed(2) + ' m' : '들지 않음'}`, pad + 28, y);
  });
}
