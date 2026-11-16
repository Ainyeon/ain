// 평면 문서 → 3D 조각 데이터(three 없이 순수 데이터) — 개구부로 나뉜 벽·기둥·바닥·제품(시스템에어컨·가전)·경계. 단위 mm, 다각형은 [x,y] 평면 좌표(시계방향), 높이 z 는 바닥=0
import { AC_PANEL_MM, AC_BODY_MM } from './model.js';
import { jointsOf, wallLen, wallSlice, wallPointAt, rectPoly, circlePoly, bounds, roomOutlineWithArcs } from './geom.js';

// 가구 모형 — 상자 조합. 가구 중심이 원점인 [x0,y0,x1,y1,z0,z1,재질] 목록(−y = 뒤(등판·머리판 쪽), z 0 = 바닥). 모든 조각은 가로 w·깊이 d·높이 h 상자 안에 있다
// 재질(색은 3D 보기가 정한다): top 상판(흰색) · body 몸체(흰색) · metal 철재 · seat 의자 천 · fabric 파티션 천 · wood 나무 · soft 소파·러그 천 · leaf 잎 · pot 화분 · screen 모니터
export function furnitureParts(shape, w, d, h) {
  const X = w / 2, Y = d / 2, t = Math.min(30, h / 2), m = (role, list) => list.map((p) => [...p, role]);
  const L = Math.min(50, w / 4, d / 4), g = Math.min(40, w / 8, d / 8), leg = (x, y, top = h) => [x - L / 2, y - L / 2, x + L / 2, y + L / 2, 0, top - t], in_ = (v) => v - Math.sign(v) * (g + L / 2);   // 다리: 모서리에서 조금 안쪽
  if (shape === 'table') return [...m('top', [[-X, -Y, X, Y, h - t, h]]), ...m('metal', [[-X, -Y], [X, -Y], [X, Y], [-X, Y]].map(([x, y]) => leg(in_(x), in_(y))))];
  if (shape === 'ldesk') { const D = Math.min(700, w / 2, d / 2); return [...m('top', [[-X, -Y, X, -Y + D, h - t, h], [-X, -Y + D, -X + D, Y, h - t, h]]), ...m('metal', [[-X, -Y], [X, -Y], [X, -Y + D], [-X + D, Y], [-X, Y]].map(([x, y]) => leg(x === -X + D ? x - g - L / 2 : in_(x), y === -Y + D ? y - g - L / 2 : in_(y))))]; }   // 뒤 가로판 + 왼쪽 세로판, 다리는 모두 상판 밑
  if (shape === 'workdesk') { // 업무 책상: 앉는 쪽 −y, 앞(+y) 가장자리에 파티션·모니터. h 는 파티션 꼭대기(900 이하면 파티션 없는 책상)
    const T = h > 900 ? Math.min(720, h - 180) : h, E = Math.min(25, w / 10), out = [...m('top', [[-X, -Y, X, Y, T - t, T], [-X, -Y, -X + E, Y, 0, T - t], [X - E, -Y, X, Y, 0, T - t]])];
    if (h > 900) {
      out.push(...m('fabric', [[-X, Y - Math.min(30, d / 10), X, Y, T, h - 20]]), ...m('metal', [[-X, Y - Math.min(30, d / 10), X, Y, h - 20, h]]));
      if (w >= 800 && d >= 500) { const S = Math.min(310, X - 60); out.push(...m('metal', [[-110, Y - 240, 110, Y - 100, T, T + 10], [-20, Y - 190, 20, Y - 150, T + 10, T + 160]]), ...m('screen', [[-S, Y - 210, S, Y - 185, T + 140, Math.min(T + 480, h - 40)]]), ...m('body', [[-220, -Y + 160, 220, -Y + 300, T, T + 15]])); }
    }
    return out;
  }
  if (shape === 'chair') { const s = Math.min(450, h * 0.55), B = Math.min(60, d / 4), P = Math.min(25, w / 8, d / 8); return [...m('seat', [[-X * 0.9, -Y * 0.8, X * 0.9, Y * 0.9, s * 0.86, s]]), ...m('metal', [[-X * 0.9, -P, X * 0.9, P, 0, s * 0.11], [-P, -Y * 0.9, P, Y * 0.9, 0, s * 0.11], [-P, -P, P, P, s * 0.11, s * 0.86], [-P, -Y, P, -Y + B, s, s + (h - s) * 0.2]]), ...m('seat', [[-X * 0.8, -Y, X * 0.8, -Y + B, s + (h - s) * 0.2, h]])]; }   // 좌판 윗면 450(낮은 의자는 높이의 55%) · 다리 십자 · 등판은 마지막
  if (shape === 'stool' && h > 150 && w > 100 && d > 100) { const P = Math.min(25, w / 8, d / 8); return [...m('metal', [[-X * 0.9, -P, X * 0.9, P, 0, 30], [-P, -Y * 0.9, P, Y * 0.9, 0, 30], [-P, -P, P, P, 30, h - 50], [-X * 0.7, -P / 2, X * 0.7, P / 2, h * 0.35, h * 0.35 + 20]]), ...m('seat', [[-X, -Y, X, Y, h - 50, h]])]; }
  if (shape === 'bed') { const B = Math.min(80, d / 8); return [...m('wood', [[-X, -Y + B, X, Y, 0, h * 0.25], [-X, -Y, X, -Y + B, 0, h]]), ...m('top', [[-X, -Y + B, X, Y, h * 0.25, h * 0.5]])]; }
  if (shape === 'sofa') { const B = Math.min(200, d / 3), A = Math.min(150, w / 6); return m('soft', [[-X, -Y, X, Y, 0, h / 2], [-X, -Y, X, -Y + B, h / 2, h], [-X, -Y + B, -X + A, Y, h / 2, h * 0.7], [X - A, -Y + B, X, Y, h / 2, h * 0.7]]); }
  if (shape === 'shelf') {
    const T = Math.min(20, w / 8, d / 8, h / 8), n = Math.max(2, Math.round(h / 350)), gap = (h - T) / n, bw = Math.min(250, (w - 2 * T) / 3), bh = Math.min(240, gap - T - 30);
    const books = bh > 40 && d > 120 && w > 160 ? Array.from({ length: n }, (_, k) => { const z = k * gap + T, x0 = k % 2 ? -X + T + 30 : X - T - 30 - bw; return [x0, -Y + T + 20, x0 + bw, Y - 20, z, z + bh]; }) : [];   // 칸마다 물건 한 덩어리(좌우 번갈아)
    return [...m('body', [[-X, -Y, -X + T, Y, 0, h], [X - T, -Y, X, Y, 0, h], [-X + T, -Y, X - T, -Y + T, 0, h]]), ...m('wood', Array.from({ length: n + 1 }, (_, k) => { const z = k * gap; return [-X + T, -Y + T, X - T, Y, z, z + T]; })), ...m('fabric', books)];
  }
  if (shape === 'plant') return [...m('pot', [[-X * 0.55, -Y * 0.55, X * 0.55, Y * 0.55, 0, h * 0.28]]), ...m('leaf', [[-X * 0.75, -Y * 0.75, X * 0.75, Y * 0.75, h * 0.28, h * 0.55], [-X, -Y, X, Y, h * 0.5, h * 0.8], [-X * 0.55, -Y * 0.55, X * 0.55, Y * 0.55, h * 0.78, h]])];
  if (shape === 'panel' && w > 120 && h > 200) return [...m('metal', [[-X, -Y, -X + 30, Y, 0, h], [X - 30, -Y, X, Y, 0, h], [-X + 30, -Y, X - 30, Y, h - 25, h]]), ...m('fabric', [[-X + 30, -Y * 0.6, X - 30, Y * 0.6, 60, h - 25]])];
  return m(shape === 'rug' ? 'soft' : shape === 'panel' ? 'fabric' : 'body', [[-X, -Y, X, Y, 0, h]]);   // box · rug · 좁은 panel
}
// 모양마다 주 재질 — 가구의 tone(색)이 이 재질을 바꾼다
export const FURNITURE_MAIN = { table: 'top', ldesk: 'top', workdesk: 'top', chair: 'seat', stool: 'seat', sofa: 'soft', bed: 'wood', shelf: 'wood', box: 'body', panel: 'fabric', rug: 'soft', plant: 'leaf' };
function furnitureItem(i) { // 전체 상자(poly·z0·z1, 가전과 같다) + 조각(parts)
  const [w, d] = i.size, r = (i.rot * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const parts = furnitureParts(i.shape, w, d, i.heightMm).map(([x0, y0, x1, y1, z0, z1, r0]) => { const role = i.tone && r0 === FURNITURE_MAIN[i.shape] ? i.tone : r0; const x = (x0 + x1) / 2, y = (y0 + y1) / 2; return { poly: rectPoly([i.c[0] + x * co - y * si, i.c[1] + x * si + y * co], x1 - x0, y1 - y0, i.rot), z0, z1, role }; });
  return { id: i.id, kind: i.kind, shape: i.shape, name: i.name, c: i.c, rot: i.rot, size: i.size, heightMm: i.heightMm, poly: rectPoly(i.c, w, d, i.rot), z0: 0, z1: i.heightMm, parts };
}

// walls 의 조각: {id, poly, z0, z1, kind:'inner'|'exterior'|'column', part:'full'|'sill'(창 아래·문 옆 낮은 벽)|'lintel'(상인방)|'column'}
// 개구부는 길이(u)로 구간을 나눠 구간마다 개구부가 비운 높이 띠를 빼고 남은 높이를 조각으로 만든다(겹친 개구부도 맞다)
export function buildMesh(doc, floorIndex = doc.cur) {
  const f = doc.floors[floorIndex];
  if (!f) throw new Error('층을 찾을 수 없습니다');
  const H = f.heightMm, J = jointsOf(f.walls), walls = [], openings = [];
  for (const w of f.walls) {
    const L = wallLen(w), ends = J(w), ops = f.openings.filter((o) => o.wall === w.id);
    const cut = (o) => ({ u0: Math.max(0, o.at - o.width / 2 / L), u1: Math.min(1, o.at + o.width / 2 / L), z0: Math.max(0, o.sill), z1: Math.min(H, o.sill + o.height) });
    const cuts = ops.map(cut).filter((c) => c.u1 > c.u0 && c.z1 > c.z0);
    const us = [...new Set([0, 1, ...cuts.flatMap((c) => [c.u0, c.u1])])].sort((a, b) => a - b), pieces = [];
    for (let i = 0; i + 1 < us.length; i++) {
      const [ua, ub] = [us[i], us[i + 1]], mid = (ua + ub) / 2;
      if ((ub - ua) * L < 0.5) continue;
      let z = 0;
      const segs = [];
      for (const c of cuts.filter((c) => c.u0 <= mid && mid <= c.u1).sort((p, q) => p.z0 - q.z0)) { if (c.z0 > z) segs.push([z, c.z0]); z = Math.max(z, c.z1); }
      if (z < H) segs.push([z, H]);
      for (const [z0, z1] of segs) {
        const prev = pieces.find((p) => p.z0 === z0 && p.z1 === z1 && p.u1 === ua); // 높이가 같은 이웃 구간은 한 조각으로
        if (prev) prev.u1 = ub; else pieces.push({ u0: ua, u1: ub, z0, z1 });
      }
    }
    for (const p of pieces) walls.push({ id: w.id, poly: wallSlice(w, p.u0, p.u1, ends), z0: p.z0, z1: p.z1, kind: w.kind, part: p.z0 > 0 ? 'lintel' : p.z1 < H ? 'sill' : 'full' });
    for (const o of ops) { // 개구부 자리: 문·창 틀을 그릴 때 쓴다(벽 구멍은 위에서 이미 비웠다)
      const c = cut(o), at = wallPointAt(w, Math.min(1, Math.max(0, o.at)));
      openings.push({ id: o.id, wall: w.id, type: o.type, c: at.p, angle: (Math.atan2(at.tan[1], at.tan[0]) * 180) / Math.PI, width: o.width, thickness: w.t, z0: o.sill, z1: o.sill + o.height, poly: wallSlice(w, c.u0, c.u1) });
    }
  }
  for (const c of f.columns) walls.push({ id: c.id, poly: c.kind === 'round' ? circlePoly(c.c, c.w / 2) : rectPoly(c.c, c.w, c.d, c.rot), z0: 0, z1: H, kind: 'column', part: 'column' });
  const b = bounds(doc, f), byId = new Map(f.walls.map((w) => [w.id, w]));
  return {
    walls, openings,
    floors: f.rooms.map((r) => ({ id: r.id, name: r.name, poly: roomOutlineWithArcs(r, byId), z: 0, thickness: f.slabMm, finish: f.finish.floor })),
    items: f.items.map((i) => (i.kind === 'furniture' ? furnitureItem(i) : i.kind === 'appliance' // 가전: 바닥(z0=0)에서 제품 높이까지의 상자. 시스템에어컨: 천장 아래 판넬(z0~z1)과 천장 속 본체(mountZ~+bodyH)
      ? { id: i.id, kind: i.kind, category: i.category, brand: i.brand, model: i.model, name: i.name, code: i.code, c: i.c, rot: i.rot, size: i.size, heightMm: i.heightMm, poly: rectPoly(i.c, i.size[0], i.size[1], i.rot), z0: 0, z1: i.heightMm }
      : { id: i.id, kind: i.kind, model: i.model, brand: i.brand, code: i.code, capacityKw: i.capacityKw, c: i.c, rot: i.rot, size: i.size, poly: rectPoly(i.c, i.size[0], i.size[1], i.rot), z0: H - AC_PANEL_MM, z1: H, mountZ: H, bodyH: AC_BODY_MM })),
    height: H, // 층고(천장 높이) — bounds.z1 은 키 큰 가전까지 담는 카메라 상자라 다르다
    bounds: b && { ...b, z0: 0, z1: Math.max(H, ...f.items.map((i) => i.heightMm ?? 0)) }, // 층고보다 큰 가전이 있으면 카메라 상자도 그만큼 높인다
  };
}
