// 분해 액소 — buildMesh(core/mesh3d.js) 조각을 30° 직각 투영하고 층(바닥 · 벽 · 기기 · 천장선)을 위로 벌린다. 순수 계산(DOM·three 없음). 단위 mm, 화면 y 는 아래
import { signedArea, pointInPoly, segSegIntersect } from './geom.js';

export const AXO = Object.freeze({ cos: Math.cos(Math.PI / 6), sin: 0.5, seg: 1000, gap: 1.2 });   // seg: 옆면을 자르는 길이(정렬 보정) · gap: 층 사이 간격(천장 높이의 배수)
export const axoPt = (p, z = 0) => [(p[0] - p[1]) * AXO.cos, (p[0] + p[1]) * AXO.sin - z];   // 보는 쪽은 +x+y(화면 아래), 높이 z 는 화면 위로

const cut = (poly, k, c) => { // 볼록·오목 다각형에서 k·(x+y) ≥ c 인 쪽만 남긴다
  const f = (p) => k * (p[0] + p[1]) - c, out = [];
  poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length], fa = f(a), fb = f(b); if (fa >= 0) out.push(a); if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } });
  return out;
};

// mesh = buildMesh() 결과 → { floors:[{ id, zone, pts }], faces:[{ kind, side, d, z, pts }], ceil:[pts…], box }
// spread 0(붙음)~1: 바닥은 그대로, 벽은 1칸, 기기는 2칸, 천장선은 3칸 올린다(1칸 = 천장 높이 × gap × spread). faces 는 먼 것부터(그리는 순서)
// 가림 순서: 화면의 같은 점에서 깊이 차는 d(= x + y) 차의 1.5배다 — d 로 줄 세우면 맞다. 면이 크면 d 하나로 못 재므로 윗면은 d 띠(seg)로, 옆면은 길이(seg)로 자른다
// 벽은 이음매에서 서로 파고든다 — 다른 벽 조각 속에 묻힌 옆면 구간(맞닿은 끝면 포함)은 그리지 않는다. 안 그러면 묻힌 면이 앞의 면을 덮는다
export function axoScene(mesh, { spread = 0, zoneOf = () => null } = {}) {
  const H = mesh.height || 0, lift = (k) => k * spread * H * AXO.gap, faces = [];
  const box = new Map(mesh.walls.map((w) => [w, [Math.min(...w.poly.map((p) => p[0])), Math.min(...w.poly.map((p) => p[1])), Math.max(...w.poly.map((p) => p[0])), Math.max(...w.poly.map((p) => p[1]))]]));
  const prism = (o, kind, up) => { // 윗면 + 보이는 옆면(바깥 법선이 보는 쪽을 향한 것)
    const { poly, z0, z1 } = o, s = Math.sign(signedArea(poly)) || 1, n = poly.length, ds = poly.map((p) => p[0] + p[1]);
    for (let i = Math.floor(Math.min(...ds) / AXO.seg); i * AXO.seg < Math.max(...ds); i++) {
      const band = cut(cut(poly, 1, i * AXO.seg), -1, -(i + 1) * AXO.seg);
      if (band.length > 2) faces.push({ kind, side: 'top', d: band.reduce((a, p) => a + p[0] + p[1], 0) / band.length, z: z1, pts: band.map((p) => axoPt(p, z1 + up)) });
    }
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], nx = s * (b[1] - a[1]), ny = -s * (b[0] - a[0]);
      if (nx + ny <= 1e-9) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ts = [0, 1];
      const over = mesh.walls.filter((q) => { const c = box.get(q); return q !== o && q.z0 < z1 && q.z1 > z0 && c[0] <= Math.max(a[0], b[0]) + 1 && c[2] >= Math.min(a[0], b[0]) - 1 && c[1] <= Math.max(a[1], b[1]) + 1 && c[3] >= Math.min(a[1], b[1]) - 1; });
      for (const q of over) q.poly.forEach((c, k) => { const x = segSegIntersect(a, b, c, q.poly[(k + 1) % q.poly.length]); if (x) ts.push(x.t); });
      ts.sort((x, y) => x - y);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k], t1 = ts[k + 1], mid = at((t0 + t1) / 2), out = [mid[0] + (s * (b[1] - a[1])) / L, mid[1] - (s * (b[0] - a[0])) / L];   // 구간 한가운데에서 1 mm 밖
        if ((t1 - t0) * L < 0.5) continue;
        const m = Math.ceil(((t1 - t0) * L) / AXO.seg), open = []; let z = z0;   // open: 묻히지 않은 높이 구간(창 옆 통벽 끝면은 창대와 상인방 사이만 남는다)
        for (const q of over.filter((q) => pointInPoly(q.poly, out)).sort((p, q) => p.z0 - q.z0)) { if (q.z0 > z) open.push([z, q.z0]); z = Math.max(z, q.z1); }
        if (z < z1) open.push([z, z1]);
        for (const [za, zb] of open) for (let j = 0; j < m; j++) { const p = at(t0 + ((t1 - t0) * j) / m), q = at(t0 + ((t1 - t0) * (j + 1)) / m); faces.push({ kind, side: ny > nx ? 'l' : 'r', d: (p[0] + p[1] + q[0] + q[1]) / 2, z: za, pts: [axoPt(p, za + up), axoPt(q, za + up), axoPt(q, zb + up), axoPt(p, zb + up)] }); }
      }
    }
  };
  for (const w of mesh.walls) prism(w, w.kind === 'column' ? 'column' : 'wall', lift(1));
  for (const i of mesh.items) prism(i, i.kind === 'appliance' ? 'appliance' : 'ac', lift(2));
  faces.sort((a, b) => a.d - b.d);   // 같은 d 끼리는 화면에서 겹치지 않는다(겹치면 높이도 같다) — 둘째 기준이 필요 없다. ponytail: 조각 중심 정렬 — 기기가 벽을 뚫고 지나는 것까지 맞추려면 BSP 로
  const floors = mesh.floors.map((r) => ({ id: r.id, zone: zoneOf(r.id), pts: r.poly.map((p) => axoPt(p, 0)) }));
  const ceil = mesh.floors.map((r) => r.poly.map((p) => axoPt(p, H + lift(3))));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of [...floors.map((r) => r.pts), ...faces.map((f) => f.pts), ...ceil]) for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return { floors, faces, ceil, box: x0 <= x1 ? { x0, y0, x1, y1 } : null };
}
