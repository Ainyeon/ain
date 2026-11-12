// 일조·단면·그림자 — 태양 위치(진태양시), 외벽 창이 바닥에 만드는 햇빛 자리, 남북 단면, 땅 그림자 (순수 로직, DOM 없음). 단위 mm·도
// 좌표: x 오른쪽 · y 아래 · z 위. north = 도면 위쪽(−y)이 가리키는 방위(북 0°, 시계방향). 방위 A 의 평면 단위벡터 = [sin(A−north), −cos(A−north)] → 남쪽 = [sin north, cos north]
// 가정: 평지 · 앞 건물 없음 · 다른 벽과 발코니의 그늘 없음 · 천장 높이는 층 높이 · 시각은 진태양시(정오에 해가 정남 또는 정북)
import { signedArea, polyArea, polyCentroid, pointInPoly, dist, wallPoints, wallPointAt, wallLen, wallOutlines, roomOutlineWithArcs, rectPoly, circlePoly } from './geom.js';
import { route } from './analysis.js';

const RAD = Math.PI / 180;
export const CITIES = [['서울', 37.57], ['부산', 35.18], ['대구', 35.87], ['인천', 37.46], ['광주', 35.16], ['대전', 36.35], ['울산', 35.54], ['세종', 36.48], ['제주', 33.5]]; // 시청 위도(소수 둘째 자리)
export const DAYS = { winter: { label: '동지', decl: -23.44 }, equinox: { label: '춘추분', decl: 0 }, summer: { label: '하지', decl: 23.44 } }; // decl = 태양 적위
const COMPASS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/* ---------- 태양 ---------- */
// 해 쪽 단위벡터(x, y = 도면 평면, z = 위)와 고도·방위각(북 0°, 시계방향). 시간각 = 15° × (시 − 12)
export function sunAt(lat, decl, hour, north = 0) {
  const p = lat * RAD, d = decl * RAD, h = (hour - 12) * 15 * RAD, n = north * RAD;
  const E = -Math.cos(d) * Math.sin(h), N = Math.cos(p) * Math.sin(d) - Math.sin(p) * Math.cos(d) * Math.cos(h), U = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h);
  return { x: E * Math.cos(n) - N * Math.sin(n), y: -E * Math.sin(n) - N * Math.cos(n), z: U, alt: Math.asin(Math.max(-1, Math.min(1, U))) / RAD, az: (Math.atan2(E, N) / RAD + 360) % 360 };
}
export function dayRange(lat, decl) { // [해 뜸, 해 짐] (시). 위도 ±66° 안에서는 늘 뜨고 진다
  const h = Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat * RAD) * Math.tan(decl * RAD)))) / RAD / 15;
  return [12 - h, 12 + h];
}
// 해가 떠 있는 동안(분, 10분 단위로 안쪽) · 그 범위로 접은 시각 — 날·위도를 바꿔 낮이 줄면 고른 시각도 따라 들어온다
export const daySpanMin = (lat, decl) => { const [a, b] = dayRange(lat, decl); return [Math.ceil(a * 6 + 1e-9) * 10, Math.floor(b * 6 - 1e-9) * 10]; };
export const clampDayMin = (t, lat, decl) => { const [a, b] = daySpanMin(lat, decl); return Math.min(b, Math.max(a, t)); };

/* ---------- 외벽 창 · 햇빛 자리 ---------- */
// 볼록 다각형 clip 으로 subject(오목해도 된다)를 자른다(서덜랜드–호지먼)
export function clipConvex(subject, clip) {
  const s = signedArea(clip) >= 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length], side = (p) => s * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])), src = out;
    out = [];
    src.forEach((p, k) => {
      const q = src[(k + 1) % src.length], dp = side(p), dq = side(q);
      if (dp >= 0) out.push(p);
      if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    });
  }
  return out;
}
const PROBE = 20, WINS = new WeakMap(); // 문서가 불변이라 층 객체가 같으면 창 목록도 같다
// 외벽 창: 창(type window) 한쪽은 방 안이고 반대쪽은 어느 방(벽 두께만큼 넓힌 외곽)에도 들지 않는다. 벽의 kind 는 보지 않는다(방 도구로 그린 벽은 모두 inner)
// { id, room, poly(방 안쪽 면), c(창 중심, 벽 중심선 위), a, b(창 양 끝), out(바깥 법선), w(폭), z0(창 아랫단), z1(윗단 — 천장까지) }
// ponytail: 곡선벽의 창은 그 점의 접선으로 편 직선으로, 유리면은 벽 중심선으로 본다(창턱·문설주 그늘 없음)
export function extWindows(f) {
  let out = WINS.get(f);
  if (out) return out;
  const W = new Map(f.walls.map((w) => [w.id, w])), inner = f.rooms.map((r) => roomOutlineWithArcs(r, W)), outer = f.rooms.map((r) => roomOutlineWithArcs(r, W, { withWalls: true }));
  out = [];
  for (const o of f.openings) {
    const w = W.get(o.wall), z1 = Math.min(o.sill + o.height, f.heightMm);
    if (!w || o.type !== 'window' || !(z1 > o.sill)) continue;
    const { p, tan } = wallPointAt(w, o.at), n = [-tan[1], tan[0]], probe = (s) => [p[0] + s * n[0] * (w.t / 2 + PROBE), p[1] + s * n[1] * (w.t / 2 + PROBE)], h = o.width / 2;
    for (const s of [1, -1]) {
      const i = inner.findIndex((poly) => pointInPoly(poly, probe(s)));
      if (i < 0 || outer.some((poly) => pointInPoly(poly, probe(-s)))) continue;
      out.push({ id: o.id, room: f.rooms[i], poly: inner[i], c: p, a: [p[0] - tan[0] * h, p[1] - tan[1] * h], b: [p[0] + tan[0] * h, p[1] + tan[1] * h], out: [-s * n[0], -s * n[1]], w: o.width, z0: o.sill, z1 });
      break;
    }
  }
  WINS.set(f, out);
  return out;
}
const MIN_PATCH = 1; // mm² — 이보다 작은 자리는 계산 잡음으로 본다
// 창 하나의 햇빛 자리: 창(폭 × [z0, z1])을 해 방향으로 바닥에 내린 평행사변형을 그 방으로 자른 다각형. 해가 졌거나 창 뒤쪽이면 []
// ponytail: 오목한 방은 방 밖(벽 너머)을 지나 다시 들어온 빛도 자리로 친다 — 벽 그늘을 보려면 벽마다 가려야 한다
export function sunPatch(win, s) {
  if (!(s.z > 1e-6) || !(s.x * win.out[0] + s.y * win.out[1] > 1e-9)) return [];
  const at = (p, z) => [p[0] - (s.x * z) / s.z, p[1] - (s.y * z) / s.z];
  const poly = clipConvex(win.poly, [at(win.a, win.z0), at(win.b, win.z0), at(win.b, win.z1), at(win.a, win.z1)]);
  return poly.length >= 3 && polyArea(poly) > MIN_PATCH ? poly : [];
}
// 그릴 자리 목록: hours(시) 마다 창마다 [{ t, room(id), poly }]
export function sunPatches(f, site, decl, hours) {
  const out = [];
  for (const t of hours) { const s = sunAt(site.lat, decl, t, site.north); for (const w of extWindows(f)) { const poly = sunPatch(w, s); if (poly.length) out.push({ t, room: w.room.id, poly }); } }
  return out;
}
// 방별 직사광 시간(분): 하루를 stepMin 간격으로 훑어 그 방 바닥에 햇빛 자리가 있는 표본 수 × stepMin. windows = 그 방의 외벽 창 수
export function sunHours(f, site, decl, stepMin = 10) {
  const wins = extWindows(f), rows = f.rooms.map((r) => ({ id: r.id, name: r.name, min: 0, windows: wins.filter((w) => w.room === r).length }));
  for (let m = 0; m < 1440; m += stepMin) {
    const s = sunAt(site.lat, decl, m / 60, site.north), lit = new Set();
    if (s.z > 0) for (const w of wins) if (!lit.has(w.room.id) && sunPatch(w, s).length) lit.add(w.room.id);
    for (const r of rows) if (lit.has(r.id)) r.min += stepMin;
  }
  return rows;
}

/* ---------- 단면: 남북으로 자른다 ---------- */
// 자르는 선 = 기준 창 중심(c)을 지나는 남북 선. 기준 창 = (roomId 방의) 해 쪽(북반구 남향, ±45°) 외벽 창 중 가장 큰 것. 없으면 그 방(없으면 가장 큰 방)의 무게중심을 지난다
// u = c 에서 남쪽으로 잰 거리. { ok, room, c, a(북 끝), b(남 끝), u0, u1, H, cuts:[{ u, t(잘린 두께), gap:null|{ z0, z1, type } }], rooms:[{ id, name, u0, u1 }],
//   ref:null|{ id, z0, z1, inward(방 안쪽이 u 의 +1/−1) }, winter·summer:{ alt(정오 고도), depth(창에서 안쪽으로 햇빛이 닿는 거리, 안 들면 0) }, roomDepth(창 벽 중심선 → 맞은편 벽 면), vent(맞통풍) }
// 정오의 해는 자른 면 안에 있으므로 깊이 = 창 윗단 높이 ÷ tan(정오 고도)
export function section(f, site, roomId = null) {
  if (!f.rooms.length) return { ok: false };
  // snap: sin 180° 같은 값의 부동소수 잡음(1e-16)을 지운다 — 90° 단위 방위에서 좌표가 딱 떨어진다
  const n = site.north * RAD, snap = (v) => Math.round(v * 1e12) / 1e12 + 0, dS = [snap(Math.sin(n)), snap(Math.cos(n))], W = new Map(f.walls.map((w) => [w.id, w])), wins = extWindows(f), H = f.heightMm;
  const south = (v) => v[0] * dS[0] + v[1] * dS[1], sunward = site.lat >= 0 ? 1 : -1;
  const ref = wins.filter((w) => (!roomId || w.room.id === roomId) && sunward * south(w.out) >= Math.SQRT1_2).sort((a, b) => b.w * (b.z1 - b.z0) - a.w * (a.z1 - a.z0))[0] ?? null;
  const room = ref ? ref.room : f.rooms.find((r) => r.id === roomId) ?? [...f.rooms].sort((a, b) => polyArea(b.poly) - polyArea(a.poly))[0];
  const c = ref ? ref.c : polyCentroid(roomOutlineWithArcs(room, W));
  const side = (p) => (p[0] - c[0]) * dS[1] - (p[1] - c[1]) * dS[0], along = (p) => south([p[0] - c[0], p[1] - c[1]]);
  const cross = (p, q) => { const a = side(p), b = side(q); if ((a > 0) === (b > 0)) return null; const t = a / (a - b); return { u: along(p) + (along(q) - along(p)) * t, t }; }; // 반열림 판정 — 꼭짓점을 지나도 한 번만 센다
  const cuts = [], rooms = [];
  for (const w of f.walls) {
    const pts = wallPoints(w), L = wallLen(w);
    let acc = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1], l = dist(p, q), x = cross(p, q), k = l ? Math.abs(side(q) - side(p)) / l : 0; // k = sin(벽과 자른 선의 각)
      if (x && k >= 0.2) { // 자른 선과 거의 나란한 벽은 뺀다
        const s = acc + x.t * l, o = f.openings.find((e) => e.wall === w.id && Math.abs(s - e.at * L) <= e.width / 2);
        cuts.push({ u: x.u, t: w.t / k, gap: o ? { z0: o.sill, z1: Math.min(o.sill + o.height, H), type: o.type } : null });
      }
      acc += l;
    }
  }
  for (const r of f.rooms) {
    const poly = roomOutlineWithArcs(r, W), us = [];
    poly.forEach((p, i) => { const x = cross(p, poly[(i + 1) % poly.length]); if (x) us.push(x.u); });
    us.sort((a, b) => a - b);
    for (let i = 0; i + 1 < us.length; i += 2) rooms.push({ id: r.id, name: r.name, u0: us[i], u1: us[i + 1] });
  }
  const ends = [...cuts.flatMap((x) => [x.u - x.t / 2, x.u + x.t / 2]), ...rooms.flatMap((r) => [r.u0, r.u1])];
  if (!ends.length) return { ok: false };
  const u0 = Math.min(...ends) - 600, u1 = Math.max(...ends) + 600, at = (u) => [c[0] + dS[0] * u, c[1] + dS[1] * u];
  const inward = ref ? (south(ref.out) > 0 ? -1 : 1) : 0, own = ref ? rooms.filter((r) => r.id === ref.room.id && (r.u0 + r.u1) * inward > 0).sort((a, b) => Math.abs(a.u0 + a.u1) - Math.abs(b.u0 + b.u1))[0] : null;
  const noon = (decl) => { // 정오: 고도 = 90 − |위도 − 적위|, 위도 > 적위면 해가 남쪽
    const d = site.lat - decl, alt = 90 - Math.abs(d), faces = ref && alt > 0 && (d > 0 ? 1 : -1) * south(ref.out) > 0;
    return { alt, depth: faces ? ref.z1 / Math.tan(alt * RAD) : 0 };
  };
  const ids = new Set(rooms.map((r) => r.id)), ws = wins.filter((w) => ids.has(w.room.id));
  // 맞통풍: 자른 선이 지나는 방들에서 서로 마주 보는 외벽 창 둘이 같은 방이거나 문·개방으로 이어진다
  const vent = ws.some((a, i) => ws.slice(i + 1).some((b) => a.out[0] * b.out[0] + a.out[1] * b.out[1] < -0.5 && (a.room === b.room || route(f, a.room.id, b.room.id).ok)));
  return { ok: true, room: { id: room.id, name: room.name }, c, a: at(u0), b: at(u1), u0, u1, H, cuts, rooms, ref: ref && { id: ref.id, z0: ref.z0, z1: ref.z1, inward }, winter: noon(DAYS.winter.decl), summer: noon(DAYS.summer.decl), roomDepth: own ? Math.max(Math.abs(own.u0), Math.abs(own.u1)) : 0, vent };
}

/* ---------- 그림자: 바닥 외곽을 높이 H 로 세워 땅에 내린다 ---------- */
const cw = (p) => (signedArea(p) >= 0 ? p : [...p].reverse());
// 바닥 조각(벽 두께까지 넓힌 방 · 벽 · 기둥). 모두 같은 방향으로 맞춘다 — 한 경로에 넣고 nonzero 로 칠하면 합집합이 된다
export function footprint(f) {
  const W = new Map(f.walls.map((w) => [w.id, w]));
  return [...f.rooms.map((r) => roomOutlineWithArcs(r, W, { withWalls: true })), ...wallOutlines(f.walls), ...f.columns.map((c) => (c.kind === 'round' ? circlePoly(c.c, c.w / 2) : rectPoly(c.c, c.w, c.d, c.rot)))].filter((p) => polyArea(p) > 1).map(cw);
}
// 조각을 v 만큼 쓸고 간 자리 = 조각 + 옮긴 조각 + 변마다 쓸린 평행사변형(모두 같은 방향). 오목한 외곽도 합집합 계산 없이 맞다
export function shadowPolys(polys, v) {
  const mv = (p) => [p[0] + v[0], p[1] + v[1]], out = [];
  for (const P of polys) { out.push(P, P.map(mv)); P.forEach((p, i) => { const q = P[(i + 1) % P.length]; out.push(cw([p, q, mv(q), mv(p)])); }); }
  return out;
}
// 높이 hMm 의 그림자: v = 땅에서 옮겨 가는 벡터, lenMm = hMm ÷ tan(고도). 해가 졌으면 null
export function shadowAt(site, decl, hour, hMm) {
  const s = sunAt(site.lat, decl, hour, site.north);
  return s.z > 1e-6 ? { v: [(-s.x * hMm) / s.z, (-s.y * hMm) / s.z], lenMm: hMm / Math.tan(s.alt * RAD), alt: s.alt, az: s.az } : null;
}
export function polysBox(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const P of polys) for (const p of P) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return x0 <= x1 ? { x0, y0, x1, y1 } : null;
}
