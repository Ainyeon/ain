// 평면 문서 → 3D 조각 데이터(three 없이 순수 데이터) — 개구부로 나뉜 벽·기둥·바닥·에어컨·경계. 단위 mm, 다각형은 [x,y] 평면 좌표(시계방향), 높이 z 는 바닥=0
import { AC_PANEL_MM, AC_BODY_MM } from './model.js';
import { jointsOf, wallLen, wallSlice, wallPointAt, rectPoly, circlePoly, bounds, roomOutlineWithArcs } from './geom.js';

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
    items: f.items.map((i) => ({ id: i.id, kind: i.kind, model: i.model, brand: i.brand, code: i.code, capacityKw: i.capacityKw, c: i.c, rot: i.rot, size: i.size, poly: rectPoly(i.c, i.size[0], i.size[1], i.rot), z0: H - AC_PANEL_MM, z1: H, mountZ: H, bodyH: AC_BODY_MM })),
    bounds: b && { ...b, z0: 0, z1: H },
  };
}
