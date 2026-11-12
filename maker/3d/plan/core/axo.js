// 분해 액소 — buildMesh(core/mesh3d.js) 조각을 30° 직각 투영하고 층(바닥 · 벽 · 기기 · 천장선)을 위로 벌린다. 순수 계산(DOM·three 없음). 단위 mm, 화면 y 는 아래
import { signedArea } from './geom.js';

export const AXO = Object.freeze({ cos: Math.cos(Math.PI / 6), sin: 0.5, seg: 1000, gap: 1.2 });   // seg: 옆면을 자르는 길이(정렬 보정) · gap: 층 사이 간격(천장 높이의 배수)
export const axoPt = (p, z = 0) => [(p[0] - p[1]) * AXO.cos, (p[0] + p[1]) * AXO.sin - z];   // 보는 쪽은 +x+y(화면 아래), 높이 z 는 화면 위로

// mesh = buildMesh() 결과 → { floors:[{ id, zone, pts }], faces:[{ kind, side, d, pts }], ceil:[pts…], box }
// spread 0(붙음)~1: 바닥은 그대로, 벽은 1칸, 기기는 2칸, 천장선은 3칸 올린다(1칸 = 천장 높이 × gap × spread). faces 는 먼 것부터(그리는 순서)
export function axoScene(mesh, { spread = 0, zoneOf = () => null } = {}) {
  const H = mesh.bounds ? mesh.bounds.z1 : 0, lift = (k) => k * spread * H * AXO.gap, faces = [];
  const prism = (poly, z0, z1, kind, up) => { // 윗면 + 보이는 옆면(바깥 법선이 보는 쪽을 향한 것)
    const s = Math.sign(signedArea(poly)) || 1, n = poly.length;
    faces.push({ kind, side: 'top', d: poly.reduce((a, p) => a + p[0] + p[1], 0) / n, z: z1, pts: poly.map((p) => axoPt(p, z1 + up)) });
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], nx = s * (b[1] - a[1]), ny = -s * (b[0] - a[0]);
      if (nx + ny <= 1e-9) continue;
      const m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / AXO.seg)), at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      for (let j = 0; j < m; j++) { const p = at(j / m), q = at((j + 1) / m); faces.push({ kind, side: ny > nx ? 'l' : 'r', d: (p[0] + p[1] + q[0] + q[1]) / 2, z: z0, pts: [axoPt(p, z0 + up), axoPt(q, z0 + up), axoPt(q, z1 + up), axoPt(p, z1 + up)] }); }
    }
  };
  for (const w of mesh.walls) prism(w.poly, w.z0, w.z1, w.kind === 'column' ? 'column' : 'wall', lift(1));
  for (const i of mesh.items) prism(i.poly, i.z0, i.z1, i.kind === 'appliance' ? 'appliance' : 'ac', lift(2));
  faces.sort((a, b) => a.d - b.d || a.z - b.z);   // ponytail: 면 중심 정렬(긴 옆면은 잘라 보정). 겹침이 보이면 BSP 로
  const floors = mesh.floors.map((r) => ({ id: r.id, zone: zoneOf(r.id), pts: r.poly.map((p) => axoPt(p, 0)) }));
  const ceil = mesh.floors.map((r) => r.poly.map((p) => axoPt(p, H + lift(3))));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of [...floors.map((r) => r.pts), ...faces.map((f) => f.pts), ...ceil]) for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return { floors, faces, ceil, box: x0 <= x1 ? { x0, y0, x1, y1 } : null };
}
