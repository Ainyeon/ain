// 도면 썸네일 — 문서의 현재 층(벽·방·기둥·에어컨)을 작은 SVG 로 그린다. thumbData 는 DOM 없이 계산만(node 테스트), thumbSvg 가 SVG 요소를 만든다.
export function thumbData(doc) {
  const f = doc && Array.isArray(doc.floors) ? doc.floors[Math.min(Math.max(doc.cur | 0, 0), doc.floors.length - 1)] : null;
  if (!f || typeof f !== 'object') return null;
  const list = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);   // null·문자열 같은 깨진 항목은 건너뛴다 — 한 건이 목록 전체를 막지 않게
  const walls = list(f.walls).filter((w) => Array.isArray(w.a) && Array.isArray(w.b)), rooms = list(f.rooms).filter((r) => Array.isArray(r.poly));
  const cols = list(f.columns).filter((c) => Array.isArray(c.c)), acs = list(f.items).filter((i) => i.kind === 'ac' && Array.isArray(i.c));
  const pts = [];
  for (const w of walls) pts.push(w.a, w.b);
  for (const r of rooms) for (const p of r.poly) pts.push(p);
  for (const c of cols) pts.push(c.c);
  if (!pts.length || pts.some((p) => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = Math.max(x1 - x0, 1000), h = Math.max(y1 - y0, 1000), pad = Math.max(w, h) * 0.06;
  return {
    vb: [x0 - pad, y0 - pad, w + pad * 2, h + pad * 2],
    rooms: rooms.filter((r) => r.poly.length > 2).map((r) => r.poly.map((p) => p[0] + ',' + p[1]).join(' ')),
    walls: walls.map((k) => ({ x1: k.a[0], y1: k.a[1], x2: k.b[0], y2: k.b[1], t: Math.max(k.t || 150, 80) })),
    cols: cols.map((c) => ({ x: c.c[0], y: c.c[1], r: Math.max(c.w || 300, 150) / 2 })),
    acs: acs.map((i) => ({ x: i.c[0], y: i.c[1], w: (Array.isArray(i.size) && i.size[0]) || 900, d: (Array.isArray(i.size) && i.size[1]) || 500 })),
  };
}

export function thumbSvg(doc) {
  const d = thumbData(doc);
  const NS = 'http://www.w3.org/2000/svg', el = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = el('svg', { viewBox: d ? d.vb.map((v) => Math.round(v)).join(' ') : '0 0 4 3', class: 'th', 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid meet' });
  if (!d) return svg;
  for (const p of d.rooms) svg.append(el('polygon', { points: p, class: 'th-room' }));
  for (const k of d.walls) svg.append(el('line', { x1: k.x1, y1: k.y1, x2: k.x2, y2: k.y2, 'stroke-width': k.t, class: 'th-wall' }));
  for (const c of d.cols) svg.append(el('circle', { cx: c.x, cy: c.y, r: c.r, class: 'th-col' }));
  for (const a of d.acs) svg.append(el('rect', { x: a.x - a.w / 2, y: a.y - a.d / 2, width: a.w, height: a.d, class: 'th-ac' }));
  return svg;
}
