// 평면도 글씨 자리 — 문이 열리는 호·기둥·제품 상자를 피해, 방 안에서 중심에 가장 가까운 빈 자리를 찾는다. 순수 계산(같은 단위의 좌표면 mm 든 px 든 된다): node 로 테스트한다.
const hit = (a, r) => a[0] <= r[2] && a[2] >= r[0] && a[1] <= r[3] && a[3] >= r[1];            // 상자끼리 겹침
const inPoly = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const ccw = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
const cross = (a, b, c, d) => { const d1 = ccw(a, b, c), d2 = ccw(a, b, d), d3 = ccw(c, d, a), d4 = ccw(c, d, b); return d1 * d2 < 0 && d3 * d4 < 0; };   // 선분 두 개가 서로 가로지름
const edges = (r) => { const c = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]; return c.map((p, i) => [p, c[(i + 1) % 4]]); };
export const boxOfPoly = (poly) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of poly) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };

// 글씨 상자 r=[x0,y0,x1,y1] 이 다각형과 겹치나(꼭짓점이 안에 · 상자 모서리가 다각형 안에 · 변이 가로지름)
export function polyHitsRect(poly, r) {
  for (const p of poly) if (p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]) return true;
  if (inPoly(poly, r[0], r[1]) || inPoly(poly, r[2], r[1]) || inPoly(poly, r[2], r[3]) || inPoly(poly, r[0], r[3])) return true;
  const re = edges(r);
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; for (const [c, d] of re) if (cross(a, b, c, d)) return true; }
  return false;
}
// 상자가 방 다각형 안에 온전히 들어가나(모서리가 모두 안에 있고 방 변이 상자를 가로지르지 않음 — 오목한 방 포함)
export function rectInsidePoly(poly, r) {
  if (!inPoly(poly, r[0], r[1]) || !inPoly(poly, r[2], r[1]) || !inPoly(poly, r[2], r[3]) || !inPoly(poly, r[0], r[3])) return false;
  const re = edges(r);
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; for (const [c, d] of re) if (cross(a, b, c, d)) return false; }
  return true;
}
// 문이 열리는 부채꼴: 경첩(벽 a 쪽 문틀)에서 반지름=문 폭, 벽 방향(tan)과 법선(n) 사이 90°. op = { p(문 중심), tan, n, el:{width} }
export function swingPoly(op, steps = 8) {
  const W = op.el.width / 2, r = op.el.width, hx = op.p[0] - op.tan[0] * W, hy = op.p[1] - op.tan[1] * W, pts = [[hx, hy]];
  for (let i = 0; i <= steps; i++) { const f = (i / steps) * (Math.PI / 2), c = Math.cos(f) * r, s = Math.sin(f) * r; pts.push([hx + op.tan[0] * c + op.n[0] * s, hy + op.tan[1] * c + op.n[1] * s]); }
  return pts;
}

// 글씨 상자(가로 w · 세로 h, 중심 center)를 놓을 자리. poly 가 있으면 방 안에 온전히, avoid=[{poly, box?}] 와는 겹치지 않게. 중심이 비어 있으면 그대로(moved:false).
export function findLabelSpot({ poly = null, center, w, h, avoid = [], step, pad = 2, maxRadius = 0, maxRings = 14 }) {
  const hw = w / 2 + pad, hh = h / 2 + pad, boxes = avoid.map((a) => a.box || boxOfPoly(a.poly));
  const ok = (x, y) => {
    const r = [x - hw, y - hh, x + hw, y + hh];
    if (poly && !rectInsidePoly(poly, r)) return false;
    for (let i = 0; i < avoid.length; i++) if (hit(boxes[i], r) && polyHitsRect(avoid[i].poly, r)) return false;
    return true;
  };
  const c = [center[0], center[1]];
  if (ok(c[0], c[1])) return { x: c[0], y: c[1], moved: false };
  const bb = poly ? boxOfPoly(poly) : null, R = maxRadius || (bb ? Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 2 : step * maxRings);
  const st = Math.max(step || 1, R / maxRings), cand = [];
  for (let i = -maxRings; i <= maxRings; i++) for (let j = -maxRings; j <= maxRings; j++) { if (!i && !j) continue; const dx = i * st, dy = j * st, d = Math.hypot(dx, dy); if (d <= R) cand.push([d, c[0] + dx, c[1] + dy]); }
  cand.sort((a, b) => a[0] - b[0]);
  for (const [, x, y] of cand) if (ok(x, y)) return { x, y, moved: true };
  return { x: c[0], y: c[1], moved: false, blocked: true };   // 어디에도 못 놓으면(아주 작은 방) 중심에 둔다
}
