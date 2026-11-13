// 도면 분석 — 존(공용·개인·서비스) 추정과 면적표, 벽 비율(포셰), 방 사이 걸음 거리(격자 A*) (순수 로직, DOM 없음). 단위 mm
import { ZONES, curFloor } from './model.js';
import { dist, wallLen, wallPoints, wallPointAt, wallPieces, nearestOnWall, jointsOf, projectOnSeg, pointInPoly, polyArea, polyCentroid, rectPoly, circlePoly, roomOutlineWithArcs, roomAreaM2 } from './geom.js';

const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
const boxOf = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
};

/* ---------- 존 ---------- */
export const ZONE_LABEL = { public: '공용', private: '개인', service: '서비스' };
const ZONE_WORDS = { public: ['거실', '주방', '식당', '현관', '복도'], private: ['침실', '안방', '방', '서재', '드레스룸'], service: ['욕실', '화장실', '다용도실', '발코니', '베란다', '창고', '실외기실'] };
// 이름에서 가장 뒤에서 끝나는 낱말이 그 방의 본체다('안방 욕실' = 서비스). 끝이 같으면 긴 낱말('주방'은 '방'이 아니다). 모르면 공용
export function guessZone(name) {
  let best = 'public', end = -1, len = 0;
  for (const z of ZONES) for (const w of ZONE_WORDS[z]) {
    const i = String(name).lastIndexOf(w), e = i + w.length;
    if (i >= 0 && (e > end || (e === end && w.length > len))) { best = z; end = e; len = w.length; }
  }
  return best;
}
export const zoneOf = (room) => (ZONES.includes(room.zone) ? room.zone : guessZone(room.name));
// 존별 면적표. 면적은 견적 물량표와 같이 방마다 소수 둘째 자리로 맺어 더한다(합계가 서로 같다)
export function zoneTable(doc, f = curFloor(doc)) {
  const rows = ZONES.map((zone) => ({ zone, label: ZONE_LABEL[zone], names: [], areaM2: 0, pct: 0 }));
  for (const r of f.rooms) { const row = rows[ZONES.indexOf(zoneOf(r))]; row.names.push(r.name); row.areaM2 = r2(row.areaM2 + r2(roomAreaM2(doc, r))); }
  const totalM2 = r2(rows.reduce((s, x) => s + x.areaM2, 0));
  for (const x of rows) x.pct = totalM2 > 0 ? r1((x.areaM2 / totalM2) * 100) : 0;
  return { rows, totalM2 };
}

/* ---------- 포셰: 벽·기둥 면적 ÷ 바닥(실면적) ---------- */
// 다각형들의 합집합 넓이(mm²). 가로줄마다 다각형이 덮는 구간을 합쳐 더한다 — 겹친 곳은 한 번만 센다
// ponytail: 줄 간격은 1 mm, 높이가 MAX_LINES mm 를 넘는 도면만 간격을 키운다(그만큼 어림)
const MAX_LINES = 20000;
function unionArea(polys) {
  const P = polys.map((p) => ({ p, b: boxOf(p) })).sort((a, b) => a.b[1] - b.b[1]);
  if (!P.length) return 0;
  const y0 = P[0].b[1], y1 = Math.max(...P.map((e) => e.b[3])), n = Math.min(MAX_LINES, Math.max(1, Math.ceil(y1 - y0))), step = (y1 - y0) / n;
  let sum = 0, next = 0, act = [];
  for (let j = 0; j < n; j++) {
    const y = y0 + (j + 0.5) * step, iv = [];
    while (next < P.length && P[next].b[1] <= y) act.push(P[next++]);
    act = act.filter((e) => e.b[3] > y);
    for (const { p } of act) {
      const xs = [];
      for (let i = 0, k = p.length - 1; i < p.length; k = i++) { const a = p[i], b = p[k]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])); }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) iv.push([xs[i], xs[i + 1]]);
    }
    iv.sort((a, b) => a[0] - b[0]);
    let end = -Infinity;
    for (const [a, b] of iv) if (b > end) { sum += b - Math.max(a, end); end = b; }
  }
  return sum * step;
}
// 벽 = 화면에 그리는 벽 조각(개구부를 비우고 모서리를 맞춘 외곽)과 기둥의 합집합. 겹친 벽(따로 그린 이웃 방의 두 겹 벽)·벽에 묻힌 기둥은 한 번만 센다
export function poche(doc, f = curFloor(doc)) {
  const J = jointsOf(f.walls), ops = new Map();
  for (const o of f.openings) { if (!ops.has(o.wall)) ops.set(o.wall, []); ops.get(o.wall).push(o); }
  const polys = f.walls.flatMap((w) => wallPieces(w, ops.get(w.id) || [], J(w)));
  for (const c of f.columns) polys.push(c.kind === 'round' ? circlePoly(c.c, c.w / 2, 72) : rectPoly(c.c, c.w, c.d, c.rot));
  const wallM2 = r2(unionArea(polys) / 1e6), floorM2 = r2(f.rooms.reduce((s, r) => s + r2(roomAreaM2(doc, r)), 0));
  return { wallM2, floorM2, pct: floorM2 > 0 ? r1((wallM2 / floorM2) * 100) : null };
}

/* ---------- 동선: 격자 A* ---------- */
// cell: 칸 크기(칸이 maxCells 를 넘으면 cellMax 로 한 번 키우고, 그래도 넘으면 계산하지 않는다) · body: 사람 반폭 · stride: 보폭
export const NAV = Object.freeze({ cell: 100, cellMax: 200, body: 200, maxCells: 250000, stride: 650 });
const PASS = new Set(['door', 'open']); // 지나갈 수 있는 개구부 — 창은 막힌다
const GRIDS = new WeakMap(); // 문서가 불변이라 층 객체가 같으면 격자도 같다
function scan(g, [a, b, c, d], pad, fn) { // 상자(+pad) 안의 격자점마다 fn(칸 번호, 점)
  const i0 = Math.max(0, Math.floor((a - pad - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.ceil((c + pad - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((b - pad - g.y0) / g.cell)), j1 = Math.min(g.ny - 1, Math.ceil((d + pad - g.y0) / g.cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * g.nx + i, [g.x0 + i * g.cell, g.y0 + j * g.cell]);
}
function buildGrid(f) {
  const W = new Map(f.walls.map((w) => [w.id, w])), body = NAV.body;
  const inner = f.rooms.map((r) => roomOutlineWithArcs(r, W)), outer = f.rooms.map((r) => roomOutlineWithArcs(r, W, { withWalls: true }));
  if (!outer.length) return { ok: false, reason: 'none' };
  const [x0, y0, x1, y1] = boxOf(outer.flat()); // 방 외곽만 — 멀리 떨어진 보조선·제품이 격자를 키우지 않는다
  let cell = NAV.cell, nx, ny;
  for (;;) {
    nx = Math.ceil((x1 - x0) / cell) + 1; ny = Math.ceil((y1 - y0) / cell) + 1;
    if (nx * ny <= NAV.maxCells) break;
    if (cell >= NAV.cellMax) return { ok: false, reason: 'big' };
    cell = NAV.cellMax; // 벽 띠(두께 + 2 × body ≥ 400)가 칸 둘 이상이라 이 크기까지는 벽이 새지 않는다
  }
  const free = new Uint8Array(nx * ny), g = { ok: true, cell, x0, y0, nx, ny, free, inner, ids: f.rooms.map((r) => r.id), paths: new Map() };
  // 1) 걸을 수 있는 곳 = 벽 두께만큼 넓힌 방 외곽의 합. 공유 벽의 문턱이 열리고, 집 밖은 막히고, 벽 없이 맞닿은 방은 이어진다
  for (const poly of outer) scan(g, boxOf(poly), 0, (k, p) => { if (!free[k] && pointInPoly(poly, p)) free[k] = 1; });
  // 2) 벽 띠(두께/2 + body)는 막힘. 그 벽의 문·개방 구간만 남긴다(곡선벽은 wallPoints 가 선분으로 풀어 준다)
  // 문은 그 문 자리에서 몸통이 겹치거나 맞닿은 다른 벽도 연다 — 방 도구로 따로 그린 이웃 방은 경계 벽이 두 겹이고, 중심선이 같으면 둘째 벽에는 문을 달 수 없다
  // (문 양 끝이 모두 그 벽에 닿을 때만: 떨어진 벽·문을 가로지르는 벽은 그대로 막는다)
  const ops = new Map(), cut = (w, s, h) => { if (!ops.has(w.id)) ops.set(w.id, []); ops.get(w.id).push([s, h]); };
  for (const o of f.openings) {
    const v = W.get(o.wall);
    if (!v || !PASS.has(o.type) || o.width < 2 * body) continue;
    const L = wallLen(v), [mid, e0, e1] = [0, -1, 1].map((k) => wallPointAt(v, Math.min(1, Math.max(0, o.at + (k * o.width) / 2 / L))).p);
    for (const w of f.walls) if (w === v || [e0, e1].every((p) => nearestOnWall(w, p).d < (v.t + w.t) / 2 + 1)) cut(w, nearestOnWall(w, mid).s, o.width / 2 - body);
  }
  for (const w of f.walls) {
    const pts = wallPoints(w), band = w.t / 2 + body, acc = [0];
    for (let k = 0; k + 1 < pts.length; k++) acc.push(acc[k] + dist(pts[k], pts[k + 1]));
    const gaps = (ops.get(w.id) || []).map(([s, h]) => [s, Math.max(h, cell * 0.71)]); // 0.71칸 하한: 문 중심축이 지나는 칸은 격자 정렬과 무관하게 열린다
    scan(g, boxOf(pts), band, (k, p) => {
      if (!free[k]) return;
      let bd = Infinity, bs = 0;
      for (let i = 0; i + 1 < pts.length; i++) { const q = projectOnSeg(p, pts[i], pts[i + 1]); if (q.d < bd) { bd = q.d; bs = acc[i] + q.t * (acc[i + 1] - acc[i]); } }
      if (bd <= band && !gaps.some(([s, h]) => Math.abs(bs - s) <= h)) free[k] = 0;
    });
  }
  // 3) 기둥(+ body)
  for (const c of f.columns) {
    const R = c.w / 2 + body, poly = c.kind === 'round' ? null : rectPoly(c.c, c.w + 2 * body, c.d + 2 * body, c.rot);
    scan(g, poly ? boxOf(poly) : [c.c[0] - R, c.c[1] - R, c.c[0] + R, c.c[1] + R], 0, (k, p) => { if (poly ? pointInPoly(poly, p) : dist(p, c.c) <= R) free[k] = 0; });
  }
  return g;
}
function seat(g, poly) { // 방의 출발·도착 칸 = 방 안의 열린 칸 중 무게중심에 가장 가까운 칸(ㄱ자 방·기둥 위 중심에도 된다). 없으면 -1
  const c = polyCentroid(poly);
  let best = -1, bd = Infinity;
  scan(g, boxOf(poly), 0, (k, p) => { if (!g.free[k]) return; const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < bd && pointInPoly(poly, p)) { bd = d; best = k; } });
  return best;
}
function walk(g, a, b) { // 칸 a → b. 8방향 A*(대각선은 양옆 칸이 모두 열렸을 때만) 뒤 보이는 데까지 줄을 당겨 꺾은선으로
  const { nx, ny, free, cell } = g, N = nx * ny, cost = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const bi = b % nx, bj = (b / nx) | 0, est = (k) => { const dx = Math.abs((k % nx) - bi), dy = Math.abs(((k / nx) | 0) - bj); return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); };
  const heap = [];
  const push = (k, v) => { let i = heap.push([v, k]) - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; for (let i = 0; ;) { let m = i; const l = 2 * i + 1, r = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
    return top;
  };
  cost[a] = 0; push(a, est(a));
  while (heap.length) {
    const k = pop()[1];
    if (done[k]) continue;
    done[k] = 1;
    if (k === b) break;
    const i = k % nx, j = (k / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj, n = jj * nx + ii;
      if ((!di && !dj) || ii < 0 || jj < 0 || ii >= nx || jj >= ny || !free[n] || done[n] || (di && dj && (!free[j * nx + ii] || !free[jj * nx + i]))) continue;
      const c = cost[k] + (di && dj ? Math.SQRT2 : 1);
      if (c < cost[n]) { cost[n] = c; prev[n] = k; push(n, c + est(n)); }
    }
  }
  if (!done[b]) return { ok: false, reason: 'none' };
  const cells = [];
  for (let k = b; k >= 0; k = prev[k]) cells.push(k);
  cells.reverse();
  const P = (k) => [g.x0 + (k % nx) * cell, g.y0 + ((k / nx) | 0) * cell];
  const see = (p, q) => { // 두 점 사이를 칸의 1/4 간격으로 찍어 막힌 칸이 없으면 보인다
    const n = Math.ceil(dist(p, q) / (cell / 4));
    for (let s = 1; s < n; s++) if (!free[Math.round((p[1] + ((q[1] - p[1]) * s) / n - g.y0) / cell) * nx + Math.round((p[0] + ((q[0] - p[0]) * s) / n - g.x0) / cell)]) return false;
    return true;
  };
  // ponytail: 앞에서부터 한 번만 당긴다(칸 수에 비례). 모서리에서 최단보다 조금 길 수 있다 — 더 줄이려면 가시성 그래프
  const pts = [P(cells[0])];
  for (let k = 2, from = 0; k < cells.length; k++) if (!see(P(cells[from]), P(cells[k]))) { from = k - 1; pts.push(P(cells[from])); }
  if (cells.length > 1) pts.push(P(b));
  let lenMm = 0;
  for (let k = 0; k + 1 < pts.length; k++) lenMm += dist(pts[k], pts[k + 1]);
  return { ok: true, pts, lenMm, steps: Math.ceil(lenMm / NAV.stride) };
}
// 두 방 사이 걸음 거리(방 중심 → 방 중심). 벽·기둥을 못 지나고 문·개방 개구부와 벽 없는 방 경계로만 지난다
// { ok: true, pts(mm 꺾은선), lenMm, steps } | { ok: false, reason: 'none'(길 없음) | 'big'(도면이 너무 큼) | 'room'(없는 방) }
export function route(f, fromId, toId) {
  let g = GRIDS.get(f);
  if (!g) GRIDS.set(f, (g = buildGrid(f)));
  if (!g.ok) return { ok: false, reason: g.reason };
  const ia = g.ids.indexOf(fromId), ib = g.ids.indexOf(toId), key = fromId + '|' + toId;
  if (ia < 0 || ib < 0) return { ok: false, reason: 'room' };
  if (!g.paths.has(key)) { const a = seat(g, g.inner[ia]), b = seat(g, g.inner[ib]); g.paths.set(key, a < 0 || b < 0 ? { ok: false, reason: 'none' } : walk(g, a, b)); }
  return g.paths.get(key);
}
// 기본 동선: 현관→주방, 현관→안방, 작은 방→욕실. 방 이름으로 찾고(여럿이면 이름이 짧은 것), 없거나 같은 방이면 그 줄은 없다.
// 그 방에 딸린 다른 방('안방 욕실'·'주방 발코니'·'현관 창고')은 그 방이 아니다: 이름으로 본 구분이 찾는 방과 다르면 뺀다('안방 2'·'주방·식당'은 맞다)
// '작은방'이라는 이름이 없으면 개인 존 방(안방·드레스룸 제외) 중 가장 작은 방
export function defaultPairs(f) {
  const pick = (re, zone) => f.rooms.filter((r) => re.test(r.name) && guessZone(r.name) === zone).sort((a, b) => a.name.length - b.name.length)[0];
  const hall = pick(/현관/, 'public'), bath = pick(/욕실|화장실/, 'service');
  const small = pick(/작은\s*방/, 'private') ?? f.rooms.filter((r) => zoneOf(r) === 'private' && !/안방|드레스룸/.test(r.name)).sort((a, b) => polyArea(a.poly) - polyArea(b.poly))[0];
  return [[hall, pick(/주방/, 'public')], [hall, pick(/안방/, 'private')], [small, bath]].filter(([a, b]) => a && b && a !== b).map(([a, b]) => [a.id, b.id]);
}
// 화면에 낼 동선 목록: 기본 + 사용자가 더한 쌍(extra = [[fromId, toId]…], 이 층에 없는 방·겹치는 쌍은 뺀다)
export function routesFor(f, extra = []) {
  const name = new Map(f.rooms.map((r) => [r.id, r.name])), seen = new Set();
  return [...defaultPairs(f).map((p) => [...p, false]), ...extra.map((p) => [...p, true])]
    .filter(([a, b]) => name.has(a) && name.has(b) && !seen.has(a + '|' + b) && seen.add(a + '|' + b))
    .map(([from, to, custom]) => ({ from, to, fromName: name.get(from), toName: name.get(to), custom, ...route(f, from, to) }));
}
