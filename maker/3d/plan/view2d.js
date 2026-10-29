// 2D 캔버스 — 화면(px)↔도면(mm) 변환·팬줌(순수 함수)과 격자·밑그림·벽·방·개구부·기둥·제품 그리기(필요할 때만 rAF). import 해도 DOM 을 건드리지 않는다
import { curFloor } from './core/model.js';
import { jointsOf, wallSlice, wallLen, wallPointAt, wallPoints, polyCentroid, polyArea, rectPoly, circlePoly, roomAreaM2 } from './core/geom.js';
import { findLabelSpot, swingPoly } from './labels.js';

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
export function fitVP(vp, b, padPx = 56) { // 경계 상자 b 가 화면에 꽉 차게. 비었으면 처음 화면
  if (!b) return newVP(vp.w, vp.h);
  const bw = Math.max(b.x1 - b.x0, 500), bh = Math.max(b.y1 - b.y0, 500), pad = Math.min(padPx, vp.w / 4, vp.h / 4);
  const k = clamp(Math.min((vp.w - 2 * pad) / bw, (vp.h - 2 * pad) / bh), SCALE.min, SCALE.max);
  return { ...vp, scale: k, ox: vp.w / 2 - ((b.x0 + b.x1) / 2) * k, oy: vp.h / 2 - ((b.y0 + b.y1) / 2) * k };
}
const GRID = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
export function gridSteps(scale, minPx = 9) { // 가는 격자(기본 100mm)와 굵은 격자(10배, 기본 1000mm)
  const minor = GRID.find((s) => s * scale >= minPx) ?? GRID.at(-1);
  return { minor, major: minor * 10 };
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
      const L = wallLen(w), cuts = ops.map((o) => [Math.max(0, o.at - o.width / 2 / L), Math.min(1, o.at + o.width / 2 / L)]).sort((a, b) => a[0] - b[0]), polys = [];
      let u = 0;
      for (const [c0, c1] of cuts) { if ((c0 - u) * L >= 0.5) polys.push(wallSlice(w, u, c0, ends)); u = Math.max(u, c1); }
      if ((1 - u) * L >= 0.5) polys.push(wallSlice(w, u, 1, ends));
      const outline = polys.length ? polys : [wallSlice(w, 0, 1, ends)];
      return { kind: 'wall', el: w, polys, outline, box: boxOf(outline.flat()) };
    });
    by.set(w.id, e); return e;
  });
  const rooms = f.rooms.map((r) => { const e = memo(r, '', () => ({ kind: 'room', el: r, outline: [r.poly], box: boxOf(r.poly), c: polyCentroid(r.poly), net: polyArea(r.poly) / 1e6 })); by.set(r.id, e); return e; });
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
export function readTheme() { // 캔버스 색은 토큰(CSS 변수)에서 읽는다
  const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim(), bs = getComputedStyle(document.body);
  return { bg: g('--c-surface-sub'), surface: g('--c-surface'), ink: g('--c-ink'), sub: g('--c-ink-sub'), faint: g('--c-ink-faint'), line: g('--c-line'), strong: g('--c-line-strong'), control: g('--c-control'), accent: g('--c-accent'), accentBg: g('--c-accent-bg'), accentLine: g('--c-accent-line'), up: g('--c-up'), font: bs.fontFamily, fs3: parseFloat(g('--fs-3')) || 13, fs4: parseFloat(g('--fs-4')) || 11.5, fw: g('--fw-semi') || '600', r1: parseFloat(g('--r-1')) || 6 };
}

/* ---------- 캔버스 뷰 ---------- */
export function createView2D(canvas, { store, getState, getSel }) {
  const ctx = canvas.getContext('2d');
  let vp = newVP(), dpr = 1, raf = 0, C = readTheme();
  const imgs = new Map(), view = { hover: null, overlay: null, onChange: null, underlayTemp: null, drawCount: 0 };
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
      for (let x = Math.ceil(-vp.ox / vp.scale / step) * step; x * vp.scale + vp.ox <= vp.w; x += step) { const X = Math.round(x * vp.scale + vp.ox) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, vp.h); }
      for (let y = Math.ceil(-vp.oy / vp.scale / step) * step; y * vp.scale + vp.oy <= vp.h; y += step) { const Y = Math.round(y * vp.scale + vp.oy) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(vp.w, Y); }
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
    if (o.type === 'door') { // 경첩은 a 쪽 문틀, 문짝은 벽의 +법선 쪽으로 90° 열린 모양
      const hg = at(-W, 0), tip = at(-W, o.width);
      ctx.lineWidth = px * 1.5; ctx.beginPath(); ctx.moveTo(hg[0], hg[1]); ctx.lineTo(tip[0], tip[1]); ctx.stroke();
      ctx.lineWidth = px; ctx.beginPath(); ctx.arc(hg[0], hg[1], o.width, Math.atan2(n[1], n[0]), Math.atan2(tan[1], tan[0]), true); ctx.stroke();
    }
  }
  function wallLabel(e, st) { // 선택한 벽의 길이 라벨 — 벽 한가운데 옆
    const { p, tan } = wallPointAt(e.el, 0.5), q = toPx(vp, p), nx = -tan[1], ny = tan[0];
    drawPill(ctx, C, fmtLen(wallLen(e.el), st.unit), q[0] + nx * (e.el.t * vp.scale / 2 + 14), q[1] + ny * (e.el.t * vp.scale / 2 + 14), { color: C.accent });
  }

  function draw() {
    raf = 0; view.drawCount++;
    const st = getState(), doc = store.doc, f = curFloor(doc), fc = floorCache(f), sel = getSel(), s = vp.scale, px = 1 / s, R = viewRect(vp, 40);
    const vis = (b) => b[2] >= R.x0 && b[0] <= R.x1 && b[3] >= R.y0 && b[1] <= R.y1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, vp.w, vp.h);
    if (st.showGrid) grid();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * vp.ox, dpr * vp.oy);
    ctx.lineJoin = 'round';
    const u0 = doc.underlay; // 밑그림
    if (u0) {
      const u = view.underlayTemp ? { ...u0, ...view.underlayTemp } : u0, im = underlayImg(u0);
      if (im) { ctx.save(); ctx.globalAlpha = u.opacity; ctx.translate(u.x, u.y); ctx.rotate((u.rot * Math.PI) / 180); ctx.scale(u.mmPerPx, u.mmPerPx); ctx.drawImage(im, 0, 0); ctx.restore(); }
    }
    if (doc.cur > 0) { // 아래층은 흐리게
      const g = floorCache(doc.floors[doc.cur - 1]);
      ctx.globalAlpha = 0.3; ctx.fillStyle = C.faint;
      for (const e of g.walls) if (vis(e.box)) for (const poly of e.polys) { path(poly); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = st.floorAlpha; ctx.fillStyle = C.accentBg; // 방 바닥
    for (const e of fc.rooms) if (vis(e.box)) { path(e.el.poly); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.faint; ctx.lineWidth = px; ctx.setLineDash([6 * px, 4 * px]); // 보조선
    for (const e of fc.guides) if (vis(e.box)) { path(e.el.a ? [e.el.a, e.el.b] : [], false); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.globalAlpha = st.wallAlpha; // 벽: 내벽은 보조 잉크, 외벽은 잉크
    for (const kind of ['inner', 'exterior']) {
      ctx.fillStyle = kind === 'exterior' ? C.ink : C.sub;
      for (const e of fc.walls) if (e.el.kind === kind && vis(e.box)) for (const poly of e.polys) { path(poly); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    for (const e of fc.ops) if (vis(e.box)) openingSymbol(e, C.ink, px);
    for (const e of fc.cols) if (vis(e.box)) { path(e.poly); ctx.fillStyle = C.sub; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = px; ctx.stroke(); }
    for (const e of fc.items) if (vis(e.box)) { // 에어컨: 판넬 테두리 + 가운데 X
      const poly = e.poly; path(poly); ctx.fillStyle = C.surface; ctx.fill(); ctx.strokeStyle = C.accent; ctx.lineWidth = px * 1.5; ctx.stroke();
      ctx.lineWidth = px; ctx.strokeStyle = C.accentLine; path([poly[0], poly[2]], false); ctx.stroke(); path([poly[1], poly[3]], false); ctx.stroke();
    }
    const hl = (ids, color, wpx) => { // 선택·가리킨 것 윤곽
      ctx.strokeStyle = color; ctx.lineWidth = wpx * px;
      for (const id of ids) { const e = fc.by.get(id); if (e && vis(e.box)) for (const o of e.outline) { path(o, e.kind !== 'guide'); ctx.stroke(); } }
    };
    if (view.hover && !sel.has(view.hover.id)) hl([view.hover.id], view.hover.danger ? C.up : C.accent, 1.5);
    if (sel.size) hl(sel.ids, C.accent, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 여기부터 화면 좌표
    if (st.showLabels) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const many = fc.rooms.reduce((n, e) => n + (vis(e.box) ? 1 : 0), 0) > 60, taken = [];   // 방이 아주 많으면 자리 찾기는 건너뛰고 중심에 쓴다 · taken: 이미 글씨를 쓴 자리(제품 모델명이 피한다)
      for (const e of fc.rooms) {
        if (!vis(e.box)) continue;
        const w = (e.box[2] - e.box[0]) * s, h = (e.box[3] - e.box[1]) * s; if (w < 56 || h < 30) continue;
        const area = fmtArea(st.areaGross ? roomAreaM2(doc, e.el, { withWalls: true }) : e.net, st.unit);
        ctx.font = `${C.fw} ${C.fs3}px ${C.font}`; const nw = ctx.measureText(e.el.name).width; ctx.font = `${C.fs4}px ${C.font}`; const aw = ctx.measureText(area).width;
        const lw = Math.max(nw, aw), lh = C.fs3 + C.fs4 + 8;   // 이름 + 면적 두 줄 상자
        let sp = many ? { x: e.c[0], y: e.c[1] } : spotOf(fc, `${e.el.id}|${s.toFixed(4)}|${Math.round(lw)}`, { poly: e.el.poly, center: e.c, w: lw / s, h: lh / s, avoid: avoidOf(fc), step: 8 / s, pad: 3 / s }) || { x: e.c[0], y: e.c[1] }, nameOnly = false;
        if (sp.blocked) { const one = spotOf(fc, `${e.el.id}|${s.toFixed(4)}|${Math.round(nw)}|n`, { poly: e.el.poly, center: e.c, w: nw / s, h: (C.fs3 + 4) / s, avoid: avoidOf(fc), step: 6 / s, pad: 3 / s }); if (one && !one.blocked) { sp = one; nameOnly = true; } }   // 두 줄이 안 들어가면 이름만이라도 비켜서
        const q = toPx(vp, [sp.x, sp.y]), hx = (lw + 6) / 2 / s, hy = (nameOnly ? C.fs3 + 4 : lh) / 2 / s, rect = [[sp.x - hx, sp.y - hy], [sp.x + hx, sp.y - hy], [sp.x + hx, sp.y + hy], [sp.x - hx, sp.y + hy]];
        taken.push({ poly: rect, box: [sp.x - hx, sp.y - hy, sp.x + hx, sp.y + hy] });
        ctx.fillStyle = C.ink; ctx.font = `${C.fw} ${C.fs3}px ${C.font}`; ctx.fillText(e.el.name, q[0], nameOnly ? q[1] : q[1] - C.fs4 * 0.7);
        if (!nameOnly) { ctx.fillStyle = C.sub; ctx.font = `${C.fs4}px ${C.font}`; ctx.fillText(area, q[0], q[1] + C.fs3 * 0.8); }
      }
      ctx.font = `${C.fs4}px ${C.font}`; ctx.fillStyle = C.sub;
      const avoidCode = swingsOf(fc).concat(taken);          // 문 호 + 방 이름·면적 글씨 — 이 프레임에서만 쓰므로 캐시하지 않는다(중심이 비어 있으면 바로 끝난다)
      for (const e of fc.items) {
        if (!vis(e.box) || (e.box[2] - e.box[0]) * s < 44) continue;
        const code = e.el.code || e.el.model.toUpperCase(), cw = ctx.measureText(code).width;
        const sp = many ? { x: e.el.c[0], y: e.el.c[1] } : findLabelSpot({ center: e.el.c, w: cw / s, h: C.fs4 / s, avoid: avoidCode, step: 6 / s, pad: 2 / s, maxRadius: Math.hypot(e.box[2] - e.box[0], e.box[3] - e.box[1]) / 2 + cw / s });
        if (sp.blocked) continue;                           // 피할 자리가 없으면 겹쳐 쓰지 않고 생략한다(모델명은 제품 패널·물량표에 있다)
        const q = toPx(vp, [sp.x, sp.y]); ctx.fillText(code, q[0], q[1]);
      }
    }
    for (const id of sel.ids) { const e = fc.by.get(id); if (!e || !vis(e.box)) continue; if (e.kind === 'wall') wallLabel(e, st); else if (e.kind === 'guide') { const q = toPx(vp, [(e.el.a[0] + e.el.b[0]) / 2, (e.el.a[1] + e.el.b[1]) / 2]); drawPill(ctx, C, fmtLen(Math.hypot(e.el.a[0] - e.el.b[0], e.el.a[1] - e.el.b[1]), st.unit), q[0], q[1] - 14, { color: C.accent }); } }
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
    fit(b) { set(fitVP(vp, b)); }, centerOn(p) { set({ ...vp, ox: vp.w / 2 - p[0] * vp.scale, oy: vp.h / 2 - p[1] * vp.scale }); },
    toMm: (s) => toMm(vp, s), toPx: (p) => toPx(vp, p),
    entry: (id) => floorCache(curFloor(store.doc)).by.get(id) || null,
  });
}
