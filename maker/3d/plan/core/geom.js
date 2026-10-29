// 도면 기하 — 거리·호·벽 외곽(두께·접합)·면적·스냅·선택 판정 (순수 로직, DOM 없음). 단위 mm, y 아래, 시계방향 = 넓이 +
import { DEFAULTS, curFloor } from './model.js';

const RAD = Math.PI / 180, ARC_STEP = Math.PI / 36; // 호는 5° 선분으로 근사
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cr = (a, b) => a[0] * b[1] - a[1] * b[0];
const len2 = (v) => Math.hypot(v[0], v[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ---------- 다각형 ---------- */
export function signedArea(poly) {
  let s = 0;
  poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; });
  return s / 2; // 신발끈 공식. 화면(y 아래)에서 시계방향이면 +
}
export const polyArea = (poly) => Math.abs(signedArea(poly));
export function polyCentroid(poly) {
  const A = signedArea(poly);
  if (Math.abs(A) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  let x = 0, y = 0;
  poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length], k = cr(p, q); x += (p[0] + q[0]) * k; y += (p[1] + q[1]) * k; });
  return [x / (6 * A), y / (6 * A)];
}
export function pointInPoly(poly, p) {
  let in_ = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) in_ = !in_;
  }
  return in_;
}
export function segSegIntersect(a, b, c, d) { // 끝점 접촉 포함. 평행·일직선이면 null
  const r = sub(b, a), s = sub(d, c), den = cr(r, s);
  if (Math.abs(den) < 1e-9 * len2(r) * len2(s)) return null;
  const q = sub(c, a), t = cr(q, s) / den, u = cr(q, r) / den, e = 1e-9;
  return t < -e || t > 1 + e || u < -e || u > 1 + e ? null : { p: [a[0] + r[0] * t, a[1] + r[1] * t], t, u };
}
export function projectOnSeg(p, a, b) {
  const r = sub(b, a), L2 = r[0] * r[0] + r[1] * r[1];
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * r[0] + (p[1] - a[1]) * r[1]) / L2)) : 0;
  const q = [a[0] + r[0] * t, a[1] + r[1] * t];
  return { p: q, t, d: dist(p, q) };
}
const r6 = (v) => Math.round(v * 1e6) / 1e6; // 부동소수 잡음(4999.999999999)을 µm 에서 정리
const lineX = (p1, d1, p2, d2) => { // 두 직선의 교점(평행이면 null)
  const den = cr(d1, d2);
  if (Math.abs(den) < 1e-9 * len2(d1) * len2(d2)) return null;
  const t = cr(sub(p2, p1), d2) / den;
  return [r6(p1[0] + d1[0] * t), r6(p1[1] + d1[1] * t)];
};
const onLine = (q, p, d) => { const L2 = d[0] * d[0] + d[1] * d[1], t = L2 ? ((q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1]) / L2 : 0; return [r6(p[0] + d[0] * t), r6(p[1] + d[1] * t)]; }; // q 를 직선 위로 내린 점
// 변마다 dists[i] 만큼 바깥으로 민 다각형(꺾임은 마이터). 시계방향·반시계 어느 쪽이든 '바깥'으로 민다
export function offsetPoly(poly, dists) {
  const n = poly.length, o = signedArea(poly) >= 0 ? 1 : -1;
  const lines = poly.map((p, i) => {
    const e = sub(poly[(i + 1) % n], p), L = len2(e) || 1, d = Array.isArray(dists) ? dists[i] : dists;
    return { p: [p[0] + ((o * e[1]) / L) * d, p[1] - ((o * e[0]) / L) * d], d: e };
  });
  return poly.map((_, i) => { const A = lines[(i + n - 1) % n], B = lines[i]; return lineX(A.p, A.d, B.p, B.d) ?? B.p; });
}
// 방의 벽 목록(변 순서)과 옛 다각형으로 안쪽 면 다각형을 다시 구한다 — 벽이 움직인 뒤 방을 맞출 때
export function roomInnerPoly(W, old) {
  const n = W.length;
  const lines = W.map((w, i) => {
    const e = sub(w.b, w.a), L = len2(e) || 1, oe = sub(old[(i + 1) % n], old[i]);
    let nn = [-e[1] / L, e[0] / L];
    if (nn[0] * -oe[1] + nn[1] * oe[0] < 0) nn = [-nn[0], -nn[1]]; // 옛 변의 안쪽과 같은 쪽
    return { p: [w.a[0] + (nn[0] * w.t) / 2, w.a[1] + (nn[1] * w.t) / 2], d: e };
  });
  // 이웃한 두 벽이 한 직선이면 꼭짓점은 옛 꼭짓점을 새 벽 선 위로 내린 점(벽이 방 변과 반대 방향이어도 맞다)
  return lines.map((B, i) => { const A = lines[(i + n - 1) % n]; return lineX(A.p, A.d, B.p, B.d) ?? onLine(old[i], B.p, B.d); });
}
export function rectPoly(c, w, d, rotDeg = 0) { // 중심 c, 가로 w, 세로 d, 회전 → 시계방향 네 점
  const t = rotDeg * RAD, co = Math.cos(t), si = Math.sin(t);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => [c[0] + x * co - y * si, c[1] + x * si + y * co]);
}
export const circlePoly = (c, r, n = 24) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);

/* ---------- 벽·호 ---------- */
// 곡선벽: bulge = 현의 중점에서 호 정점까지 거리(처짐), 부호 + = 진행 방향(a→b)의 오른쪽(화면 기준). 직선(|bulge|≈0)이면 null
export function arcFrom3(a, b, bulge) {
  const L = dist(a, b);
  if (!(L > 1e-6) || !(Math.abs(bulge) > 1e-6)) return null;
  const s = Math.abs(bulge), k = Math.sign(bulge), h = 2 * Math.atan((2 * s) / L); // h = 반 중심각
  const r = L / (2 * Math.sin(h)), nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
  const mid = [(a[0] + b[0]) / 2 + nx * bulge, (a[1] + b[1]) / 2 + ny * bulge];
  const c = [mid[0] - nx * k * r, mid[1] - ny * k * r];
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const sweep = 2 * h * (cr(sub(a, c), sub(mid, c)) >= 0 ? 1 : -1); // 호는 a→mid→b 로 지난다
  return { c, r, a0, a1: a0 + sweep, sweep, len: r * 2 * h, mid };
}
export const wallLen = (w) => arcFrom3(w.a, w.b, w.bulge || 0)?.len ?? dist(w.a, w.b);
export function wallPointAt(w, u) { // 벽 길이의 u(0..1) 지점의 점과 진행 방향 단위벡터
  const A = arcFrom3(w.a, w.b, w.bulge || 0);
  if (!A) { const L = dist(w.a, w.b) || 1; return { p: [w.a[0] + (w.b[0] - w.a[0]) * u, w.a[1] + (w.b[1] - w.a[1]) * u], tan: [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L] }; }
  const g = A.a0 + A.sweep * u, sg = Math.sign(A.sweep);
  return { p: [A.c[0] + A.r * Math.cos(g), A.c[1] + A.r * Math.sin(g)], tan: [-Math.sin(g) * sg, Math.cos(g) * sg] };
}
export function wallPoints(w, u0 = 0, u1 = 1) { // 중심선 꺾은선(곡선벽은 호를 선분으로)
  const A = arcFrom3(w.a, w.b, w.bulge || 0), n = A ? Math.max(1, Math.ceil((Math.abs(A.sweep) * (u1 - u0)) / ARC_STEP)) : 1;
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = u0 + ((u1 - u0) * i) / n;
    return u === 0 ? [...w.a] : u === 1 ? [...w.b] : wallPointAt(w, u).p;
  });
}
function sides(pts, h) { // 꺾은선 양쪽 변(neg=-법선, pos=+법선). 꺾임은 마이터
  const nor = (i) => { const e = sub(pts[i + 1], pts[i]), L = len2(e) || 1; return [-e[1] / L, e[0] / L]; };
  const neg = [], pos = [];
  pts.forEach((p, i) => {
    let n = nor(Math.min(i, pts.length - 2)), k = 1;
    if (i > 0 && i < pts.length - 1) {
      const m = nor(i - 1), s = [n[0] + m[0], n[1] + m[1]], L = len2(s);
      if (L > 1e-9) { n = [s[0] / L, s[1] / L]; k = 1 / Math.max(0.2, n[0] * m[0] + n[1] * m[1]); }
    }
    neg.push([p[0] - n[0] * h * k, p[1] - n[1] * h * k]); pos.push([p[0] + n[0] * h * k, p[1] + n[1] * h * k]);
  });
  return { neg, pos };
}
// 벽 끝점 접합: walls 안에서 같은 점(1mm 이내)에서 만나는 벽을 찾아 모서리를 정한다.
// 벽 둘이 꺾여 만나면 마이터, 셋 이상이 모이면 끝을 t/2 늘려 빈틈을 메운다, 그 밖(한 직선·홀로)은 그대로.
export function jointsOf(walls) {
  const key = (p) => Math.round(p[0]) + ',' + Math.round(p[1]), at = new Map();
  const put = (p, w, end) => { const k = key(p); if (!at.has(k)) at.set(k, []); at.get(k).push({ w, end }); };
  for (const w of walls) { put(w.a, w, 'a'); put(w.b, w, 'b'); }
  const dirs = (w, end) => { const tf = wallPointAt(w, end === 'a' ? 0 : 1).tan; return { n: [-tf[1], tf[0]], dIn: end === 'a' ? tf : [-tf[0], -tf[1]] }; }; // 법선·끝점에서 벽 안쪽을 향한 방향
  const endOf = (w, end) => {
    const P = end === 'a' ? w.a : w.b, others = (at.get(key(P)) || []).filter((o) => o.w !== w), h = w.t / 2, A = dirs(w, end);
    if (!others.length) return null;
    const mk = (o) => ({ neg: [o[0] - A.n[0] * h, o[1] - A.n[1] * h], pos: [o[0] + A.n[0] * h, o[1] + A.n[1] * h] });
    if (others.length > 1) { const ext = [P[0] - A.dIn[0] * h, P[1] - A.dIn[1] * h]; return mk(ext); }
    const v = others[0].w, B = dirs(v, others[0].end), hv = v.t / 2;
    if (Math.abs(cr(A.dIn, B.dIn)) < 1e-3) return null; // 거의 한 직선 — 맞닿기만
    const s = Math.sign(A.n[0] * B.dIn[0] + A.n[1] * B.dIn[1]) || 1, t = Math.sign(B.n[0] * A.dIn[0] + B.n[1] * A.dIn[1]) || 1;
    const lw = (q) => [P[0] + A.n[0] * h * q, P[1] + A.n[1] * h * q], lv = (q) => [P[0] + B.n[0] * hv * q, P[1] + B.n[1] * hv * q];
    const inner = lineX(lw(s), A.dIn, lv(t), B.dIn), outer = lineX(lw(-s), A.dIn, lv(-t), B.dIn);
    if (!inner || !outer || dist(outer, P) > 3 * (h + hv)) return null; // 예각이 너무 뾰족하면 맞닿기만
    return s > 0 ? { pos: inner, neg: outer } : { pos: outer, neg: inner };
  };
  return (w) => ({ a: endOf(w, 'a'), b: endOf(w, 'b') });
}
// 벽의 u0..u1 구간 외곽(시계방향 다각형). ends = jointsOf(walls)(w) — 있으면 벽 처음·끝 구간에 접합 모서리를 쓴다
export function wallSlice(w, u0 = 0, u1 = 1, ends = null) {
  const { neg, pos } = sides(wallPoints(w, u0, u1), w.t / 2);
  if (ends?.a && u0 === 0) { neg[0] = ends.a.neg; pos[0] = ends.a.pos; }
  if (ends?.b && u1 === 1) { neg[neg.length - 1] = ends.b.neg; pos[pos.length - 1] = ends.b.pos; }
  return [...neg, ...pos.reverse()];
}
// walls(같은 층 벽 배열)를 주면 끝점 접합 모서리까지 반영. 많은 벽은 wallOutlines 로 한 번에
export const wallOutline = (w, walls = null) => wallSlice(w, 0, 1, walls && jointsOf(walls)(w));
export function wallOutlines(walls) { const J = jointsOf(walls); return walls.map((w) => wallSlice(w, 0, 1, J(w))); }

function nearestOnPath(pts, p) {
  let best = null, acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const q = projectOnSeg(p, pts[i], pts[i + 1]), l = dist(pts[i], pts[i + 1]);
    if (!best || q.d < best.d) best = { p: q.p, d: q.d, s: acc + q.t * l };
    acc += l;
  }
  return { ...best, len: acc };
}
export const nearestOnWall = (w, p) => { const n = nearestOnPath(wallPoints(w), p); return { ...n, at: n.len ? n.s / n.len : 0 }; };
// 개구부를 붙일 벽 찾기: 중심선까지 t/2+tolMm 안이면 {wall, at, d, p}
export function nearestWall(doc, p, tolMm = 0) {
  let best = null;
  for (const w of curFloor(doc).walls) { const n = nearestOnWall(w, p); if (n.d <= w.t / 2 + tolMm && (!best || n.d < best.d)) best = { wall: w, at: n.at, d: n.d, p: n.p }; }
  return best;
}

/* ---------- 문서 질의 ---------- */
export function snapPoint(doc, p, { gridMm = DEFAULTS.snapMm, tolMm = 100, from, ortho } = {}) { // 끝점 > 중점 > 직교 > 격자 > 없음
  const f = curFloor(doc), ends = [], mids = [];
  for (const w of f.walls) { ends.push([w.a, w.id], [w.b, w.id]); mids.push([wallPointAt(w, 0.5).p, w.id]); }
  for (const g of f.guides) { ends.push([g.a, g.id], [g.b, g.id]); mids.push([[(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2], g.id]); }
  const near = (list) => { let b = null, bd = tolMm; for (const [q, id] of list) { const d = dist(p, q); if (d <= bd) { bd = d; b = [q, id]; } } return b; };
  let h = near(ends);
  if (h) return { p: [...h[0]], kind: 'end', ref: h[1] };
  if ((h = near(mids))) return { p: [...h[0]], kind: 'mid', ref: h[1] };
  const g = (v) => (gridMm ? Math.round(v / gridMm) * gridMm + 0 : v);
  if (ortho && from) return Math.abs(p[0] - from[0]) >= Math.abs(p[1] - from[1]) ? { p: [g(p[0]), from[1]], kind: 'ortho' } : { p: [from[0], g(p[1])], kind: 'ortho' };
  return gridMm ? { p: [g(p[0]), g(p[1])], kind: 'grid' } : { p: [...p], kind: 'none' };
}
// 클릭 판정. 겹치면 제품 > 개구부 > 기둥 > 벽 > 보조선 > 방 순, 같은 종류는 가까운 것
export function hitTest(doc, p, tolMm = 0) {
  const f = curFloor(doc), W = new Map(f.walls.map((w) => [w.id, w]));
  const best = (arr, dFn) => { let r = null, bd = Infinity; for (const e of arr) { const d = dFn(e); if (d !== null && d < bd) { bd = d; r = e; } } return r; };
  const inRect = (e, w, h) => {
    const t = (e.rot || 0) * RAD, dx = p[0] - e.c[0], dy = p[1] - e.c[1];
    return Math.abs(dx * Math.cos(t) + dy * Math.sin(t)) <= w / 2 + tolMm && Math.abs(-dx * Math.sin(t) + dy * Math.cos(t)) <= h / 2 + tolMm ? Math.hypot(dx, dy) : null;
  };
  const found = [
    ['item', f.items, (i) => inRect(i, i.size[0], i.size[1])],
    ['opening', f.openings, (o) => { const w = W.get(o.wall); if (!w) return null; const n = nearestOnWall(w, p); return n.d <= w.t / 2 + tolMm && Math.abs(n.s - o.at * n.len) <= o.width / 2 + tolMm ? n.d : null; }],
    ['column', f.columns, (c) => (c.kind === 'round' ? (dist(p, c.c) <= c.w / 2 + tolMm ? dist(p, c.c) : null) : inRect(c, c.w, c.d))],
    ['wall', f.walls, (w) => { const n = nearestOnWall(w, p); return n.d <= w.t / 2 + tolMm ? n.d : null; }],
    ['guide', f.guides, (g) => { const d = projectOnSeg(p, g.a, g.b).d; return d <= tolMm ? d : null; }],
    ['room', f.rooms, (r) => (pointInPoly(roomOutlineWithArcs(r, W), p) ? polyArea(r.poly) : null)], // 곡선벽이면 호 안쪽까지
  ];
  for (const [kind, arr, d] of found) { const e = best(arr, d); if (e) return { kind, id: e.id }; }
  return null;
}
// 층의 경계 상자(벽 외곽·방·기둥·제품·보조선), 비었으면 null
export function bounds(doc, floor = curFloor(doc)) {
  const pts = [];
  for (const w of floor.walls) pts.push(...wallSlice(w));
  for (const r of floor.rooms) pts.push(...r.poly);
  for (const c of floor.columns) pts.push(...(c.kind === 'round' ? circlePoly(c.c, c.w / 2) : rectPoly(c.c, c.w, c.d, c.rot)));
  for (const i of floor.items) pts.push(...rectPoly(i.c, i.size[0], i.size[1], i.rot));
  for (const g of floor.guides) pts.push(g.a, g.b);
  if (!pts.length) return null;
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
// 방 경계 다각형 — 방 변(room.poly[i]→[i+1])의 벽이 곡선이면 그 변을 같은 현·같은 처짐의 호 위 점들로 바꾼다(호 꼭짓점이 벽 면과 맞는다).
// 벽 방향(a→b)이 방 변과 반대이면 처짐 부호를 뒤집는다. 곡선벽이 없으면 room.poly 그대로. withWalls = 바깥 벽 면(벽 두께만큼 민 다각형) 기준
// walls = 같은 층 벽 배열 또는 id→벽 Map
export function roomOutlineWithArcs(room, walls, { withWalls = false } = {}) {
  const n = room.poly.length, get = Array.isArray(walls) ? (id) => walls.find((w) => w.id === id) : (id) => walls.get(id);
  const ws = room.wallIds.length === n ? room.wallIds.map(get) : [];
  const base = withWalls ? offsetPoly(room.poly, room.poly.map((_, i) => ws[i]?.t ?? DEFAULTS.wallT)) : room.poly;
  if (!ws.some((w) => w && Math.abs(w.bulge || 0) > 1e-6)) return base;
  const out = [];
  base.forEach((p, i) => {
    out.push(p);
    const w = ws[i];
    if (!w || !(Math.abs(w.bulge || 0) > 1e-6)) return;
    const e = sub(room.poly[(i + 1) % n], room.poly[i]), rev = (w.b[0] - w.a[0]) * e[0] + (w.b[1] - w.a[1]) * e[1] < 0;
    out.push(...wallPoints({ a: p, b: base[(i + 1) % n], bulge: rev ? -w.bulge : w.bulge }).slice(1, -1));
  });
  return out;
}
// 방 면적(㎡). 실면적 = 안쪽 면 다각형(곡선벽은 호를 따른다), withWalls(실면적+내외벽) = 바깥 벽 면까지(벽 두께 전부) 넓힌 다각형
export function roomAreaM2(doc, room, { withWalls = false } = {}) {
  const f = doc.floors.find((x) => x.rooms.some((r) => r.id === room.id)) ?? curFloor(doc);
  return polyArea(roomOutlineWithArcs(room, f.walls, { withWalls })) / 1e6;
}
export const grossWallLen = (doc) => curFloor(doc).walls.reduce((s, w) => s + wallLen(w), 0);
// 현재 층 벽 길이 합에서 개구부 폭을 뺀 값(mm)
export function netWallLen(doc) {
  const f = curFloor(doc);
  return f.walls.reduce((s, w) => s + Math.max(0, wallLen(w) - f.openings.filter((o) => o.wall === w.id).reduce((t, o) => t + o.width, 0)), 0);
}
