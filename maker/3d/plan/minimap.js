// 미니맵 — 층 전체와 지금 보이는 범위를 작게 그리고, 누르거나 끌면 화면이 그 자리로 옮겨 간다. import 해도 DOM 을 건드리지 않는다
import { curFloor } from './core/model.js';
import { bounds } from './core/geom.js';
import { floorCache, viewRect, readTheme } from './view2d.js';

export function createMinimap(canvas, { store, view }) {
  const ctx = canvas.getContext('2d');
  let raf = 0, dpr = 1, W = 1, H = 1, C = readTheme(), frozen = null, down = false;
  const region = () => { // 그림 전체 + 보이는 범위를 모두 담는 영역(끄는 동안은 고정)
    if (frozen) return frozen;
    const v = viewRect(view.vp), b = bounds(store.doc), r = b ? { x0: Math.min(b.x0, v.x0), y0: Math.min(b.y0, v.y0), x1: Math.max(b.x1, v.x1), y1: Math.max(b.y1, v.y1) } : v;
    const px = (r.x1 - r.x0) * 0.06, py = (r.y1 - r.y0) * 0.06;
    return { x0: r.x0 - px, y0: r.y0 - py, x1: r.x1 + px, y1: r.y1 + py };
  };
  const fitOf = (r) => { const k = Math.min(W / (r.x1 - r.x0), H / (r.y1 - r.y0)); return { k, ox: (W - (r.x1 - r.x0) * k) / 2 - r.x0 * k, oy: (H - (r.y1 - r.y0) * k) / 2 - r.y0 * k }; };
  function resize() { dpr = window.devicePixelRatio || 1; W = Math.max(1, canvas.clientWidth); H = Math.max(1, canvas.clientHeight); canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); C = readTheme(); schedule(); }
  function schedule() { if (!raf) raf = requestAnimationFrame(draw); }
  function draw() {
    raf = 0;
    const f = curFloor(store.doc), fc = floorCache(f), r = region(), m = fitOf(r), v = viewRect(view.vp);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * m.k, 0, 0, dpr * m.k, dpr * m.ox, dpr * m.oy);
    ctx.fillStyle = C.accentBg; for (const e of fc.rooms) { ctx.beginPath(); e.el.poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.fill(); }
    ctx.fillStyle = C.sub; for (const e of fc.walls) for (const poly of e.polys) { ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.fill(); }
    ctx.fillStyle = C.accent; for (const e of fc.items) ctx.fillRect(e.el.c[0] - 150, e.el.c[1] - 150, 300, 300);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = v.x0 * m.k + m.ox, y = v.y0 * m.k + m.oy, w = (v.x1 - v.x0) * m.k, h = (v.y1 - v.y0) * m.k; // 보이는 범위
    ctx.globalAlpha = 0.12; ctx.fillStyle = C.accent; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }
  const at = (e) => { const b = canvas.getBoundingClientRect(), m = fitOf(region()); return [(e.clientX - b.left - m.ox) / m.k, (e.clientY - b.top - m.oy) / m.k]; };
  canvas.addEventListener('pointerdown', (e) => { down = true; frozen = region(); canvas.setPointerCapture(e.pointerId); view.centerOn(at(e)); });
  canvas.addEventListener('pointermove', (e) => { if (down) view.centerOn(at(e)); });
  const stop = () => { down = false; frozen = null; schedule(); };
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
  new ResizeObserver(resize).observe(canvas);
  return { draw: schedule, resize };
}
