// 2D 편집 도구 — 도구 표·단축키와 포인터 상태기계(선택·벽·곡선벽·방·삭제·기둥·개구부·보조선·측정·제품 놓기·밑그림 축척)와 키보드 커서(방향키로 옮기고 Enter 로 누른다). import 해도 DOM 을 건드리지 않는다
import { DEFAULTS, curFloor, COORD_MAX } from './core/model.js';
import { snapPoint, hitTest, dist, wallPointAt, wallPoints, wallLen, nearestWall, nearestOnWall, rectPoly, circlePoly, pointInPoly, polyCentroid, segSegIntersect } from './core/geom.js';
import { SCALE, toMm, toPx as vpPx, snapStep, drawPill, drawCrosshair, angleDeg, fmtArea } from './view2d.js';

export const PX = Object.freeze({ snap: 12, hit: 8, drag: 4, handle: 9 }); // 허용 거리(화면 px)
export const NAMES = { select: '선택', wall: '벽 그리기', arc: '곡선벽 그리기', room: '방 그리기', delete: '삭제', colRect: '사각 기둥 그리기', colRound: '원형 기둥 그리기', opening: '개구부 그리기', guide: '보조선 그리기', measure: '측정', placeItem: '제품 놓기', calibrate: '밑그림 축척 맞추기', moveUnderlay: '밑그림 이동' };
export const OPENING_NAMES = { door: '문', window: '창', open: '개방' };
// 도면 그리기 패널의 행 — 구역·행 이름과 단축키는 REA 관찰에서 본 기능 이름과 같은 글자다(기능 어휘). 색·치수·모션은 수치만 참고했다. key 가 없으면 단축키 없음
export const TOOL_ROWS = [
  { group: '특수 기능', rows: [{ id: 'underlay', label: '도면 이미지 업로드', action: 'underlay' }, { id: 'maps', label: '도면 검색', href: '../maps/' }] },
  { group: '방 만들기', rows: [{ id: 'wall', label: '벽 그리기', key: 'L' }, { id: 'arc', label: '곡선벽 그리기', key: 'A' }, { id: 'room', label: '방 그리기', key: 'F' }, { id: 'delete', label: '삭제', key: 'D' }] },
  { group: '구조물 그리기', rows: [{ id: 'colRect', label: '사각 기둥 그리기', key: 'R' }, { id: 'colRound', label: '원형 기둥 그리기', key: 'C' }, { id: 'opening', label: '개구부 그리기' }] },
  { group: '보조선 그리기', rows: [{ id: 'guide', label: '보조선 그리기', key: 'E' }, { id: 'measure', label: '측정', key: 'M' }] },
  { group: '도면 반전', rows: [{ action: 'mirror-x', label: '좌우 반전' }, { action: 'mirror-y', label: '상하 반전' }] },
  { group: '도면 회전', rows: [{ action: 'rot-ccw', label: '반시계 방향 회전' }, { action: 'rot-cw', label: '시계 방향 회전' }] },
  { group: '일반', rows: [{ id: 'select', label: '선택', key: 'ESC' }, { id: 'multi', label: '그룹화', key: 'Shift' }] },
];
export const SHORTCUTS = Object.freeze({ L: 'wall', A: 'arc', F: 'room', D: 'delete', R: 'colRect', C: 'colRound', E: 'guide', M: 'measure' }); // 키(e.code 의 Key 뒤 글자) → 도구. 한글 자판에서도 동작
const COLS = ['walls', 'rooms', 'columns', 'openings', 'guides', 'items'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const R10 = (v) => Math.round(v / 10) * 10;

/* ---------- 선택 ---------- */
export const allIds = (f) => COLS.flatMap((c) => f[c].map((e) => e.id));
export function findEl(doc, id) { const f = curFloor(doc); for (const col of COLS) { const el = f[col].find((e) => e.id === id); if (el) return { id, col, el }; } return null; }
export class Selection {
  constructor(onChange = () => {}) { this.ids = new Set(); this.onChange = onChange; }
  get size() { return this.ids.size; }
  has(id) { return this.ids.has(id); }
  set(list) { const n = new Set(list); if (n.size === this.ids.size && [...n].every((i) => this.ids.has(i))) return; this.ids = n; this.onChange(); }
  toggle(id) { const n = new Set(this.ids); if (n.has(id)) n.delete(id); else n.add(id); this.set([...n]); }
  clear() { this.set([]); }
  prune(doc) { const all = new Set(allIds(curFloor(doc))); this.set([...this.ids].filter((i) => all.has(i))); } // 지워졌거나 층이 바뀐 id 는 뺀다
}
// 사각형(a, b = 두 모서리 mm)에 걸리는 요소 — 벽·보조선은 선분이 닿으면, 방·기둥·제품·개구부는 중심이 안에 있으면
export function idsInRect(doc, a, b) {
  const f = curFloor(doc), x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const inR = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1, C = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const seg = (p, q) => inR(p) || inR(q) || C.some((c, i) => segSegIntersect(p, q, c, C[(i + 1) % 4]));
  const W = new Map(f.walls.map((w) => [w.id, w])), out = [];
  for (const w of f.walls) if (seg(w.a, w.b)) out.push(w.id);
  for (const r of f.rooms) if (inR(polyCentroid(r.poly))) out.push(r.id);
  for (const c of [...f.columns, ...f.items]) if (inR(c.c)) out.push(c.id);
  for (const o of f.openings) { const w = W.get(o.wall); if (w && inR(wallPointAt(w, o.at).p)) out.push(o.id); }
  for (const g of f.guides) if (seg(g.a, g.b)) out.push(g.id);
  return out;
}
// 끌어서 고칠 수 있는 점(핸들): 벽·보조선의 끝점, 곡선벽의 처짐 점
export function handlesOf(sel1) {
  if (!sel1) return [];
  if (sel1.col === 'walls') { const h = [{ k: 'a', p: sel1.el.a }, { k: 'b', p: sel1.el.b }]; if (sel1.el.bulge) h.push({ k: 'bulge', p: wallPointAt(sel1.el, 0.5).p }); return h; }
  if (sel1.col === 'guides') return [{ k: 'a', p: sel1.el.a }, { k: 'b', p: sel1.el.b }];
  return [];
}
export const bulgeOf = (a, b, p) => { const L = dist(a, b) || 1, n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return R10((p[0] - m[0]) * n[0] + (p[1] - m[1]) * n[1]); }; // arcFrom3 와 같은 부호(진행 방향 오른쪽 +)
const withoutIds = (doc, ex) => ({ ...doc, floors: doc.floors.map((f, i) => (i === doc.cur ? { ...f, walls: f.walls.filter((w) => !ex.has(w.id)), guides: f.guides.filter((g) => !ex.has(g.id)) } : f)) });

/* ---------- 키보드 커서: 순수 계산 (화면 vp = {scale, ox, oy, w, h}) ---------- */
export const KB = Object.freeze({ big: 10, margin: 24 }); // big = Shift+방향키로 가는 칸 수 · margin = 커서가 화면 가장자리에서 떨어져 있어야 하는 거리(px)
export const KB_DIRS = Object.freeze({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] });
export const KB_TOOLS = Object.freeze(['wall', 'arc', 'room', 'delete', 'colRect', 'colRound', 'opening', 'guide', 'measure', 'placeItem', 'calibrate']); // 키보드 커서로 점을 찍는 도구 — 고르기는 따로(Enter 로 커서 자리의 요소를 고른다)
const KB_SET = new Set(KB_TOOLS);
const snapTo = (p, s) => [Math.round(p[0] / s) * s + 0, Math.round(p[1] / s) * s + 0]; // + 0 : -0 을 0 으로
const coord = (v) => clamp(v, -COORD_MAX, COORD_MAX); // 도면 좌표 상한(core 가 거절하는 값)을 넘지 않게
export function kbMove(mm, key, big, step) { // 방향키 한 번 = 스냅 한 칸(Shift 면 10칸). 칸에서 벗어난 자리는 가까운 칸에 맞춘 뒤 간다
  const d = KB_DIRS[key]; if (!d) return null;
  const n = (big ? KB.big : 1) * step, [x, y] = snapTo(mm, step);
  return [coord(x + d[0] * n), coord(y + d[1] * n)];
}
export function kbStart(vp, last, step) { // 처음 커서 자리 — 마지막 포인터 자리가 화면 안이면 거기, 아니면 보이는 영역 가운데
  const m = KB.margin, q = last && vpPx(vp, last), inside = !!q && q[0] >= m && q[0] <= vp.w - m && q[1] >= m && q[1] <= vp.h - m;
  return snapTo(inside ? last : toMm(vp, [vp.w / 2, vp.h / 2]), step);
}
export function kbScroll(vp, mm) { // 커서가 가장자리 여백 밖이면 화면을 얼마나(px) 밀어야 안으로 들어오는가
  const q = vpPx(vp, mm), m = Math.min(KB.margin, vp.w / 4, vp.h / 4), f = (v, max) => (v < m ? m - v : v > max - m ? max - m - v : 0);
  return [f(q[0], vp.w) + 0, f(q[1], vp.h) + 0];
}
export const kbText = (mm) => `${Math.round(mm[0]).toLocaleString('ko-KR')}, ${Math.round(mm[1]).toLocaleString('ko-KR')} mm`;
export function stepId(ids, cur, dir) { // [ ] 로 요소를 하나씩 훑을 때 다음 id. 고른 것이 없으면 처음(] ) 또는 끝([ ), 끝에서는 반대쪽 끝으로 돈다
  if (!ids.length) return null;
  const i = ids.indexOf(cur);
  return i < 0 ? (dir > 0 ? ids[0] : ids[ids.length - 1]) : ids[(i + (dir > 0 ? 1 : -1) + ids.length) % ids.length];
}
export function describeEl(doc, id) { // 낭독용 이름 — "벽 W3 · 3,200 mm"
  const f = findEl(doc, id); if (!f) return '';
  const { col, el } = f, mm = (v) => `${Math.round(v).toLocaleString('ko-KR')} mm`;
  if (col === 'walls') return `${el.bulge ? '곡선벽' : '벽'} ${id} · ${mm(wallLen(el))}`;
  if (col === 'rooms') return `방 ${el.name}`;
  if (col === 'columns') return `${el.kind === 'round' ? '원형' : '사각'} 기둥 ${id}`;
  if (col === 'openings') return `${OPENING_NAMES[el.type] || '개구부'} ${id}`;
  if (col === 'guides') return `보조선 ${id} · ${mm(dist(el.a, el.b))}`;
  return `${el.kind === 'appliance' ? '가전' : '에어컨'} ${el.code || el.model}`;
}

/* ---------- 도구 상태기계 ---------- */
export function createTools({ store, view, sel, ui, state }) {
  let tool = 'select', opts = {}, op = null, drag = null, cur = null, dn = null, space = false, pan = null, gest = null, rot = 0;
  let tapPan = null, fingers = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; // tapPan = 손가락 한 개로 빈 곳을 끄는 중 {px, moved} · fingers = 마지막 포인터가 손가락(안내문이 손가락 기준으로 말한다)
  let kc = null, focused = false, lastMm = null, said = false, sayT = 0; // kc = 키보드 커서 {mm} · focused = 캔버스에 초점 · lastMm = 마지막 포인터 자리 · said = 이번 누르기에서 처리기가 낭독했는가 · sayT = 커서 낭독을 모으는 타이머
  const pts = new Map(), doc = () => store.doc, fl = () => curFloor(store.doc), vp = () => view.vp, T = (px) => px / vp().scale;
  const run = (cmd) => { try { return store.exec(cmd); } catch (err) { ui.toast(err.message, 'err'); return null; } };
  const say = (m) => { said = true; ui.say(m); };
  const hint = () => ui.hint(NAMES[tool] + (tool === 'opening' ? ` · ${OPENING_NAMES[opts.type || 'door']}` : ''), H[tool].hint() + kbTip());
  const redraw = () => { hint(); view.requestDraw(); };
  const single = () => (sel.size === 1 ? findEl(doc(), [...sel.ids][0]) : null);
  const snap = (c, from, ex) => snapPoint(ex ? withoutIds(doc(), ex) : doc(), c.mm, { gridMm: snapStep(vp().scale), tolMm: T(PX.snap), from, ortho: !!(from && c.shift) });
  const blankAt = (px) => { const one = single(); if (one && !state.locked && hitHandle(one, px)) return false; return !hitTest(doc(), view.toMm(px), T(PX.hit)); }; // 고른 것의 핸들이나 도형 위가 아닌 빈 곳
  const hitHandle = (one, px) => handlesOf(one).find((h) => { const q = view.toPx(h.p); return Math.hypot(q[0] - px[0], q[1] - px[1]) <= PX.handle; }) || null;
  const abort = () => { if (drag && drag.started) store.cancel(); drag = null; };
  const end = () => { op = null; redraw(); };
  const kb = (key, touch) => (state.touch ? touch : key); // 안내문 — 키보드가 없는 화면(폰·태블릿)은 키 대신 누르는 동작을 말한다

  /* ---------- 키보드 커서 — 포인터 대신 점을 가리킨다. 누르기는 마우스와 같은 down/up 처리기를 지나므로 스냅·검증·실행 취소가 그대로다 ---------- */
  const kbTip = () => (state.touch ? '' : tool === 'select' ? (sel.size ? ' · 방향키로도 옮깁니다 · [ ] 로 다른 것을 고릅니다' : ' · 방향키로 옮기고 Enter 로 고릅니다 · [ ] 로 하나씩 훑습니다') : KB_SET.has(tool) ? ' · 방향키로 옮기고 Enter 로 누릅니다 (Shift+방향키는 10칸)' : '');
  const kbStepMm = () => snapStep(vp().scale);
  const kbCtx = (mm, shift) => ({ e: null, px: view.toPx(mm), mm, shift: !!shift, dn, moved: false, isDrag: false });
  const kbTool = () => KB_SET.has(tool) || (tool === 'select' && !sel.size); // 방향키·Enter 가 커서를 움직이는 도구 — 고른 것이 있으면 방향키는 그것을 옮긴다
  const kbShown = () => !!kc && focused && kbTool();
  const kbUnder = () => (tool === 'select' || tool === 'delete' ? hitTest(doc(), kc.mm, T(PX.hit)) : null);
  function kbSayLater() { // 커서 낭독은 모았다가 한 번만 — 키를 누르고 있는 동안 계속 읽지 않는다
    clearTimeout(sayT);
    sayT = setTimeout(() => { if (!kc) return; const hit = kbUnder(); ui.say(`커서 ${kbText(kc.mm)}${hit ? ' · ' + describeEl(doc(), hit.id) : ''}`); }, 250);
  }
  function kbPlace(mm) { kc = { mm }; cur = kbCtx(mm, false); H[tool].move(cur); view.requestDraw(); } // 미리보기·가리키기는 마우스가 그 자리로 움직인 것과 같다
  function kbWake(speak) { if (!kc) kbPlace(kbStart(vp(), lastMm, kbStepMm())); else view.requestDraw(); if (speak) kbSayLater(); }
  function kbGo(mm) { const [dx, dy] = kbScroll(vp(), mm); if (dx || dy) view.panBy(dx, dy); kbPlace(mm); kbSayLater(); } // 화면 가장자리를 넘으면 화면이 따라온다
  function kbPress(shift) { // 누르기 = 같은 자리에서 pointerdown → pointerup. 끌기형 도구도 두 번 누르기로 끝나는 길이 있어 그 길을 그대로 쓴다
    clearTimeout(sayT); said = false;
    const before = op ? JSON.stringify(op) : '', d = kbCtx(kc.mm, shift);
    cur = d; dn = d; H[tool].down(d);
    const u = kbCtx(kc.mm, shift); u.dn = d; dn = null; cur = u; H[tool].up(u);
    view.requestDraw(); hint();
    if (said) return; // 처리기가 결과를 이미 읽었다
    if (tool === 'select') return ui.say(sel.size === 1 ? `${describeEl(doc(), [...sel.ids][0])} 선택` : sel.size ? `${sel.size}개를 골랐습니다` : '고른 것이 없습니다');
    if (op && JSON.stringify(op) !== before) ui.say(`점을 찍었습니다 · ${kbText(kc.mm)}`);
    else if (before && !op) ui.say('그리기를 마쳤습니다');
  }
  function stepSel(dir) { // [ ] — 모든 요소를 차례로 하나씩 고르고 이름을 읽는다. 속성 패널은 선택이 바뀌면 app 이 만든다
    const ids = allIds(fl());
    if (!ids.length) return ui.say('고를 것이 없습니다');
    const id = stepId(ids, sel.size === 1 ? [...sel.ids][0] : null, dir);
    sel.set([id]);
    const en = view.entry && view.entry(id), b = en && en.box;
    if (b) { const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; if (kbScroll(vp(), c).some(Boolean)) view.centerOn(c); if (kc) kbPlace(c); } // 화면 밖의 요소는 가운데로 가져오고 커서도 그 자리로
    hint(); ui.say(`${describeEl(doc(), id)} · ${ids.indexOf(id) + 1}/${ids.length}`);
  }
  function kbKey(e) { // 캔버스에 초점이 있을 때: 방향키 = 커서 이동, Enter·Space = 누르기. 먹었으면 true
    if (!kbTool()) return false;
    const k = e.key, arrow = !!KB_DIRS[k], space = e.code === 'Space';
    if (!arrow && k !== 'Enter' && !space) return false;
    if (!kc) { if (space || (k === 'Enter' && op)) return false; kbWake(true); return true; } // 커서가 안 보이면 첫 키는 커서부터 보인다 · 진행 중인 작업이 있으면 Enter 는 예전처럼 마감, Space 는 예전처럼 화면 끌기
    if (arrow) kbGo(kbMove(kc.mm, k, e.shiftKey, kbStepMm()));
    else if (!e.repeat) kbPress(e.shiftKey); // 누르고 있어도 한 번만
    return true;
  }
  const sameWall = (w, q) => !!w && dist(w.a, q.a) < 1 && dist(w.b, q.b) < 1;
  // 실행 취소·다시 실행이 문서를 바꾸면 이어 그리던 벽도 문서에 남은 벽까지만 인정한다 — 되돌린 벽의 끝점에서 이어 그리지 않는다
  store.subscribe((e) => {
    if (!op || !op.chain || (e.type !== 'undo' && e.type !== 'redo')) return;
    const have = new Map(fl().walls.map((w) => [w.id, w]));
    let m = 0; while (m < op.chain.length && sameWall(have.get(op.chain[m].id), op.chain[m])) m++;
    op.n = m; op.a = m ? op.chain[m - 1].b : op.first; redraw();
  });

  function mark(g, s) { // 스냅 표시: 끝점 네모 · 중점 세모 · 직교 십자 · 격자 점
    if (!s || s.kind === 'none') return;
    const { ctx, C, toPx } = g, q = toPx(s.p); ctx.save(); ctx.strokeStyle = C.accent; ctx.fillStyle = C.accent; ctx.lineWidth = 1.5;
    if (s.kind === 'end') ctx.strokeRect(q[0] - 5, q[1] - 5, 10, 10);
    else if (s.kind === 'mid') { ctx.beginPath(); ctx.moveTo(q[0], q[1] - 6); ctx.lineTo(q[0] + 6, q[1] + 5); ctx.lineTo(q[0] - 6, q[1] + 5); ctx.closePath(); ctx.stroke(); }
    else if (s.kind === 'ortho') { ctx.beginPath(); ctx.moveTo(q[0] - 6, q[1]); ctx.lineTo(q[0] + 6, q[1]); ctx.moveTo(q[0], q[1] - 6); ctx.lineTo(q[0], q[1] + 6); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(q[0], q[1], 2.5, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  const seg = (g, a, b, { dash, color, w = 1.5 } = {}) => { const { ctx, C, toPx } = g, p = toPx(a), q = toPx(b); ctx.save(); ctx.strokeStyle = color || C.accent; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.restore(); };
  function thick(g, a, b, t) { const { ctx, C, toPx } = g, p = toPx(a), q = toPx(b); ctx.save(); ctx.globalAlpha = 0.3; ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(2, t * vp().scale); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.restore(); seg(g, a, b); }
  const polyOverlay = (g, poly, { fill = true, bad = false } = {}) => { const { ctx, C, toPx } = g; ctx.save(); ctx.beginPath(); poly.forEach((p, i) => { const q = toPx(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); if (fill) { ctx.globalAlpha = 0.5; ctx.fillStyle = C.accentBg; ctx.fill(); ctx.globalAlpha = 1; } ctx.strokeStyle = bad ? C.up : C.accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore(); };
  const lenLabel = (g, a, b) => { const q = g.toPx([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); drawPill(g.ctx, g.C, `${g.fmt(dist(a, b))} · ${Math.round(angleDeg(a, b))}°`, q[0], q[1] - 16, { color: g.C.accent }); };

  /* 도구별 처리: down/move/up(포인터), hint(안내), overlay(미리보기) */
  const H = {
    select: {
      hint: () => (state.locked ? '잠금 상태입니다 · 고르기만 할 수 있습니다' : sel.size ? `끌어서 옮깁니다 · 끝점 핸들을 끌어 길이를 고칩니다 · ${kb('Delete 로 지웁니다', '오른쪽 패널의 [지우기]로 지웁니다')}` : state.multi ? '빈 곳을 끌어 한꺼번에 고르고, 도형을 눌러 더하거나 뺍니다' : fingers ? '도형을 눌러 고르고, 빈 곳을 끌면 화면이 움직입니다 · 두 손가락으로 확대·축소합니다' : '도형을 눌러 고르고, 빈 곳을 끌어 한꺼번에 고릅니다 · 방은 두 번 눌러 이름을 바꿉니다'),
      down(c) {
        const one = single(), multi = c.shift || state.multi;
        if (one && !state.locked) { const hd = hitHandle(one, c.px); if (hd) { const ex = new Set([one.id]), joined = []; if (one.col === 'walls' && hd.k !== 'bulge') for (const w of fl().walls) if (w.id !== one.id) for (const k of ['a', 'b']) if (dist(w[k], hd.p) < 1) { joined.push({ id: w.id, k }); ex.add(w.id); } drag = { kind: 'handle', one, k: hd.k, joined, ex, started: false, failed: false }; return; } }
        const hit = hitTest(doc(), c.mm, T(PX.hit));
        if (hit) {
          if (multi) { sel.toggle(hit.id); return; }
          if (!sel.has(hit.id)) sel.set([hit.id]);
          if (state.locked) return;
          drag = { kind: sel.size === 1 && hit.kind === 'opening' ? 'slide' : 'move', hit: hit.id, start: c.mm, applied: [0, 0], started: false };
        } else { if (!multi) sel.clear(); drag = { kind: 'marquee', a: c.mm, b: c.mm, add: multi }; }
      },
      move(c) {
        if (!drag) { // 가리키기
          const hit = hitTest(doc(), c.mm, T(PX.hit)), one = single(), hd = one && !state.locked ? hitHandle(one, c.px) : null;
          view.hover = hit && !hd ? { id: hit.id } : null;
          ui.cursor(hd ? 'crosshair' : hit ? (sel.has(hit.id) && !state.locked ? 'move' : 'pointer') : 'default'); return;
        }
        if (drag.kind === 'marquee') { drag.b = c.mm; return; }
        if (!drag.started) { if (!c.moved) return; store.begin(drag.kind === 'handle' ? '끝점 이동' : '이동'); drag.started = true; }
        const s = snapStep(vp().scale);
        if (drag.kind === 'move') {
          const dx = Math.round((c.mm[0] - drag.start[0]) / s) * s, dy = Math.round((c.mm[1] - drag.start[1]) / s) * s;
          if (dx !== drag.applied[0] || dy !== drag.applied[1]) { try { store.exec({ type: 'move', ids: [...sel.ids], dx: dx - drag.applied[0], dy: dy - drag.applied[1] }); drag.applied = [dx, dy]; } catch (err) { ui.toast(err.message, 'err'); } }
        } else if (drag.kind === 'slide') {
          const o = findEl(doc(), drag.hit), w = o && fl().walls.find((x) => x.id === o.el.wall); if (!w) return;
          const n = nearestOnWall(w, c.mm); try { store.exec({ type: 'update', id: o.id, patch: { at: clamp((Math.round(n.s / s) * s) / n.len, 0, 1) } }); } catch (err) { /* 겹치는 자리는 건너뛴다 */ }
        } else { // handle
          const one = drag.one, other = one.col === 'walls' || one.col === 'guides' ? one.el[drag.k === 'a' ? 'b' : 'a'] : null;
          try {
            if (drag.k === 'bulge') store.exec({ type: 'update', id: one.id, patch: { bulge: bulgeOf(one.el.a, one.el.b, c.mm) } });
            else { const p = snap(c, other, drag.ex).p; store.exec({ type: 'update', id: one.id, patch: { [drag.k]: p } }); for (const j of drag.joined) store.exec({ type: 'update', id: j.id, patch: { [j.k]: p } }); }
            drag.failed = false;
          } catch (err) { drag.failed = true; }
        }
      },
      up(c) {
        const d = drag; drag = null; if (!d) return;
        if (d.kind === 'marquee') { if (dist(d.a, d.b) * vp().scale >= PX.drag) { const ids = idsInRect(doc(), d.a, d.b); sel.set(d.add ? [...new Set([...sel.ids, ...ids])] : ids); } return; }
        if (d.started) { if (d.failed) { store.cancel(); ui.toast('그 자리에는 놓을 수 없습니다 · 원래대로 되돌렸습니다', 'err'); } else { store.commit(); say('이동했습니다'); } return; }
        if (d.kind === 'move' && sel.size > 1 && !c.shift && !state.multi) sel.set([d.hit]); // 눌렀다 뗐을 뿐이면 그것 하나로
      },
      dbl(c) { const hit = hitTest(doc(), c.mm, T(PX.hit)); if (hit && hit.kind === 'room') ui.renameRoom(hit.id); },
      overlay(g) {
        const { ctx, C, toPx } = g;
        if (drag && drag.kind === 'marquee') { const a = toPx(drag.a), b = toPx(drag.b); ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = C.accentBg; ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.globalAlpha = 1; ctx.strokeStyle = C.accent; ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeRect(a[0] + 0.5, a[1] + 0.5, b[0] - a[0], b[1] - a[1]); ctx.restore(); }
        const one = state.locked ? null : single();
        for (const h of handlesOf(one)) { const q = toPx(h.p); ctx.save(); ctx.fillStyle = C.surface; ctx.strokeStyle = C.accent; ctx.lineWidth = 2; if (h.k === 'bulge') { ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, 7); ctx.fill(); ctx.stroke(); } else { ctx.fillRect(q[0] - 5, q[1] - 5, 10, 10); ctx.strokeRect(q[0] - 5, q[1] - 5, 10, 10); } ctx.restore(); }
      },
    },
    wall: {
      hint: () => (op ? `끝점을 누르세요 · ${kb('더블클릭·ESC 로 끝냅니다 · Shift 를 누르면 직교', '같은 자리를 두 번 누르거나 [끝내기]를 누르면 끝납니다')}` : '시작점을 누르세요 · 끌어서 한 번에 그릴 수도 있습니다'),
      up(c) {
        if (!op && c.isDrag) { const a = snap(c.dn).p, b = snap(c, a).p; if (dist(a, b) >= 1) { const ids = run({ type: 'addWall', a, b }); if (ids) { op = { a: b, first: a, n: 1, chain: [{ id: ids[0], a, b }] }; say('벽을 추가했습니다'); } } return redraw(); } // 끌어서 한 번에
        const p = snap(c, op && op.a).p;
        if (!op) { op = { a: p, first: p, n: 0, chain: [] }; return redraw(); }
        if (dist(op.a, p) < 1) return end(); // 같은 자리를 또 누르면(더블클릭) 끝
        const ids = run({ type: 'addWall', a: op.a, b: p });
        if (!ids) return redraw();
        op.chain = [...op.chain.slice(0, op.n), { id: ids[0], a: op.a, b: p }]; op.n = op.chain.length; // 되돌린 뒤 이어 그리면 되돌린 벽의 기록은 버린다
        say(`벽을 추가했습니다 · ${Math.round(dist(op.a, p)).toLocaleString('ko-KR')} mm`);
        if (op.n >= 3 && dist(p, op.first) < 1) return end(); // 처음 점으로 돌아와 닫힘
        op.a = p; redraw();
      },
      overlay(g) { if (!cur) return; const s = snap(cur, op && op.a); if (op) { thick(g, op.a, s.p, DEFAULTS.wallT); lenLabel(g, op.a, s.p); } mark(g, s); },
    },
    arc: {
      hint: () => (!op ? '곡선벽의 시작점을 누르세요' : !op.b ? '끝점을 누르세요' : `처짐 점을 눌러 곡선을 정하세요 · ${kb('ESC 로 취소', '취소하려면 [끝내기]를 누르세요')}`),
      up(c) {
        if (op && op.b) { const bulge = bulgeOf(op.a, op.b, c.mm); if (!bulge) { ui.toast('처짐이 0 입니다 · 현에서 떨어진 곳을 누르세요', 'err'); return; } if (run({ type: 'addWall', a: op.a, b: op.b, bulge })) say('곡선벽을 추가했습니다'); return end(); }
        const p = snap(c, op && op.a).p;
        if (!op) op = { a: p }; else if (dist(op.a, p) < 1) return end(); else op.b = p;
        redraw();
      },
      overlay(g) {
        if (!cur) return;
        if (op && op.b) { const bu = bulgeOf(op.a, op.b, cur.mm), w = { a: op.a, b: op.b, bulge: bu, t: DEFAULTS.wallT }, ps = wallPoints(w); g.ctx.save(); g.ctx.globalAlpha = 0.3; g.ctx.strokeStyle = g.C.accent; g.ctx.lineWidth = Math.max(2, w.t * vp().scale); g.ctx.beginPath(); ps.forEach((p, i) => { const q = g.toPx(p); if (i) g.ctx.lineTo(q[0], q[1]); else g.ctx.moveTo(q[0], q[1]); }); g.ctx.stroke(); g.ctx.restore(); seg(g, op.a, op.b, { dash: [4, 3], w: 1 }); const m = g.toPx(wallPointAt(w, 0.5).p); drawPill(g.ctx, g.C, `처짐 ${g.fmt(Math.abs(bu))}`, m[0], m[1] - 16, { color: g.C.accent }); return; }
        const s = snap(cur, op && op.a); if (op) { seg(g, op.a, s.p, { dash: [4, 3] }); lenLabel(g, op.a, s.p); } mark(g, s);
      },
    },
    room: {
      hint: () => (!op ? `두 모서리를 끌어 방을 그립니다${kb(' · Shift 를 누르고 누르면 다각형', '')}` : op.mode === 'rect' ? `반대쪽 모서리를 누르세요 · ${kb('ESC 로 취소', '취소하려면 [끝내기]를 누르세요')}` : `점을 차례로 누르고, 첫 점을 눌러 닫습니다${kc ? '' : kb(' · Enter 로도 닫습니다', '')}`),
      up(c) {
        const last = op && op.mode === 'poly' ? op.pts.at(-1) : null;
        if (!op) {
          if (c.shift) { op = { mode: 'poly', pts: [snap(c.dn).p] }; return redraw(); }
          if (c.isDrag) { finishRect(snap(c.dn).p, snap(c).p); return redraw(); }
          op = { mode: 'rect', a: snap(c).p }; return redraw();
        }
        if (op.mode === 'rect') { finishRect(op.a, snap(c).p); op = null; return redraw(); }
        const first = view.toPx(op.pts[0]);
        if (op.pts.length >= 3 && Math.hypot(first[0] - c.px[0], first[1] - c.px[1]) <= PX.snap) return closePoly();
        const p = snap(c, last).p; if (dist(p, last) >= 1) op.pts.push(p); redraw();
      },
      overlay(g) {
        if (!cur) return;
        if (op && op.mode === 'rect') { const b = snap(cur).p, a = op.a; polyOverlay(g, [a, [b[0], a[1]], b, [a[0], b[1]]]); const q = g.toPx([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); drawPill(g.ctx, g.C, `${g.fmt(Math.abs(b[0] - a[0]))} × ${g.fmt(Math.abs(b[1] - a[1]))} · ${fmtArea((Math.abs(b[0] - a[0]) * Math.abs(b[1] - a[1])) / 1e6, g.st.unit)}`, q[0], q[1], { color: g.C.accent }); return mark(g, snap(cur)); }
        if (op) { const s = snap(cur, op.pts.at(-1)), all = [...op.pts, s.p]; g.ctx.save(); g.ctx.strokeStyle = g.C.accent; g.ctx.lineWidth = 1.5; g.ctx.beginPath(); all.forEach((p, i) => { const q = g.toPx(p); if (i) g.ctx.lineTo(q[0], q[1]); else g.ctx.moveTo(q[0], q[1]); }); g.ctx.stroke(); g.ctx.restore(); lenLabel(g, op.pts.at(-1), s.p); for (const p of op.pts) mark(g, { p, kind: 'end' }); return mark(g, s); }
        mark(g, snap(cur));
      },
    },
    delete: {
      hint: () => '지울 것을 누르세요 · 방을 지우면 방의 벽도 함께 지워집니다',
      move(c) { const hit = hitTest(doc(), c.mm, T(PX.hit)); view.hover = hit ? { id: hit.id, danger: true } : null; ui.cursor(hit ? 'pointer' : 'default'); },
      up(c) { const hit = hitTest(doc(), c.mm, T(PX.hit)); if (!hit) return; if (run({ type: 'remove', ids: [hit.id] })) { view.hover = null; sel.prune(doc()); say('지웠습니다'); } },
      overlay() {},
    },
    colRect: colTool('rect'),
    colRound: colTool('round'),
    opening: {
      hint: () => `벽에 갖다 대면 ${OPENING_NAMES[opts.type || 'door']}이 붙습니다 · 누르면 놓입니다`,
      move(c) { const o = openingCand(c.mm); ui.cursor(o ? 'copy' : 'default'); },
      up(c) { const o = openingCand(c.mm); if (!o) return ui.toast('벽 위에서 누르세요', 'err'); if (!o.ok) return ui.toast('벽이 개구부보다 짧습니다', 'err'); const ids = run({ type: 'addOpening', wall: o.wall.id, at: o.at, kind: opts.type || 'door' }); if (ids) { sel.set(ids); say(`${OPENING_NAMES[opts.type || 'door']}을 붙였습니다`); } },
      overlay(g) {
        if (!cur) return; const o = openingCand(cur.mm); if (!o) return;
        const { p, tan } = wallPointAt(o.wall, o.at), n = [-tan[1], tan[0]], W = o.width / 2, T2 = o.wall.t / 2 + 30;
        polyOverlay(g, [[p[0] - tan[0] * W - n[0] * T2, p[1] - tan[1] * W - n[1] * T2], [p[0] + tan[0] * W - n[0] * T2, p[1] + tan[1] * W - n[1] * T2], [p[0] + tan[0] * W + n[0] * T2, p[1] + tan[1] * W + n[1] * T2], [p[0] - tan[0] * W + n[0] * T2, p[1] - tan[1] * W + n[1] * T2]], { bad: !o.ok });
        const q = g.toPx(p); drawPill(g.ctx, g.C, g.fmt(o.width), q[0], q[1] - 18, { color: g.C.accent });
      },
    },
    guide: {
      hint: () => (op ? `끝점을 누르세요 · ${kb('ESC 로 취소', '취소하려면 [끝내기]를 누르세요')}` : '시작점을 누르세요 · 끌어서 그릴 수도 있습니다'),
      up(c) {
        if (!op && c.isDrag) { const a = snap(c.dn).p, b = snap(c, a).p; if (run({ type: 'addGuide', a, b })) say('보조선을 추가했습니다'); return redraw(); }
        const p = snap(c, op && op.a).p;
        if (!op) { op = { a: p }; return redraw(); }
        if (dist(op.a, p) < 1) return end();
        if (run({ type: 'addGuide', a: op.a, b: p })) say('보조선을 추가했습니다');
        end();
      },
      overlay(g) { if (!cur) return; const s = snap(cur, op && op.a); if (op) { seg(g, op.a, s.p, { dash: [6, 4] }); lenLabel(g, op.a, s.p); } mark(g, s); },
    },
    measure: {
      hint: () => (!op ? '재기 시작할 점을 누르세요 · 저장되지 않습니다' : op.done ? `다시 누르면 새로 잽니다 · ${kb('ESC 로 지웁니다', '[끝내기]를 누르면 지웁니다')}` : '끝점을 누르세요'),
      up(c) {
        const p = snap(c, op && !op.done ? op.a : null).p;
        if (!op || op.done) op = { a: p }; else if (dist(op.a, p) < 1) return end(); else { op.b = p; op.done = true; say(`거리 ${Math.round(dist(op.a, p)).toLocaleString('ko-KR')} mm`); }
        redraw();
      },
      overlay(g) {
        const b = op && (op.done ? op.b : cur && snap(cur, op.a).p);
        if (op && b) { seg(g, op.a, b); const m = g.toPx([(op.a[0] + b[0]) / 2, (op.a[1] + b[1]) / 2]); drawPill(g.ctx, g.C, `${g.fmt(dist(op.a, b))} · ${Math.round(angleDeg(op.a, b))}° · Δ ${g.fmt(Math.abs(b[0] - op.a[0]))}, ${g.fmt(Math.abs(b[1] - op.a[1]))}`, m[0], m[1] - 16, { color: g.C.accent }); mark(g, { p: op.a, kind: 'end' }); mark(g, { p: b, kind: 'end' }); }
        if (cur && !(op && op.done)) mark(g, snap(cur, op && op.a));
      },
    },
    placeItem: {
      hint: () => `방 안을 눌러 놓습니다 · ${kb('[ ] 로 90° 돌립니다 · ESC 로 끝냅니다', '놓은 뒤 오른쪽 패널의 [회전]으로 돌립니다 · 끝내려면 [끝내기]를 누르세요')}`,
      up(c) {
        const p = snap(c).p;
        if (!fl().rooms.some((r) => pointInPoly(r.poly, p))) return ui.toast('방 안에서 놓아 주세요', 'err');
        if (fl().items.some((i) => dist(i.c, p) < 1)) return; // 같은 자리에 또 누르면(더블클릭) 두 대가 겹쳐 놓이므로 무시
        const ids = run(opts.kind === 'appliance' // 가전: 패널이 공식 제원의 크기·높이를 실어 보낸다(없으면 core 가 거절한다). 그 밖은 시스템에어컨
          ? { type: 'addItem', kind: 'appliance', category: opts.category, brand: opts.brand, model: opts.model, name: opts.name || '', c: p, rot, size: opts.size, heightMm: opts.heightMm, code: opts.code || opts.model, url: opts.url }
          : { type: 'addItem', kind: 'ac', model: opts.model, brand: opts.brand, c: p, rot, capacityKw: opts.capacityKw ?? null, code: opts.code || '', size: opts.size });
        if (ids) say(`${opts.code || opts.model} 을 놓았습니다`);
      },
      overlay(g) {
        if (!cur || !opts.size) return; const p = snap(cur).p, ok = fl().rooms.some((r) => pointInPoly(r.poly, p));
        polyOverlay(g, rectPoly(p, opts.size[0], opts.size[1], rot), { bad: !ok });
        const q = g.toPx(p); drawPill(g.ctx, g.C, `${opts.code || opts.model.toUpperCase()}${rot % 180 ? ' · 90°' : ''}`, q[0], q[1] - Math.max(18, (opts.size[1] * vp().scale) / 2 + 14), { color: ok ? g.C.accent : g.C.up });
      },
    },
    calibrate: {
      hint: () => (!op ? '밑그림에서 실제 길이를 아는 두 점 중 첫 번째를 누르세요' : '두 번째 점을 누르세요 · 길이를 입력하면 축척이 맞춰집니다'),
      up(c) {
        const p = c.mm;
        if (!op) { op = { a: p }; return redraw(); }
        if (dist(op.a, p) * vp().scale < PX.drag) return;
        const a = op.a; op = null; redraw();
        ui.calibrated(a, p);
      },
      overlay(g) { if (!op) return; const b = cur ? cur.mm : op.a; seg(g, op.a, b); mark(g, { p: op.a, kind: 'end' }); if (cur) lenLabel(g, op.a, b); },
    },
    moveUnderlay: {
      hint: () => `밑그림을 끌어 옮깁니다 · ${kb('ESC 로 끝냅니다', '끝내려면 [끝내기]를 누르세요')}`,
      down(c) { const u = doc().underlay; if (u) drag = { kind: 'underlay', start: c.mm, x: u.x, y: u.y }; },
      move(c) { if (drag && drag.kind === 'underlay') { view.underlayTemp = { x: drag.x + c.mm[0] - drag.start[0], y: drag.y + c.mm[1] - drag.start[1] }; view.requestDraw(); } },
      up() { const d = drag, t = view.underlayTemp; drag = null; view.underlayTemp = null; if (d && t && (t.x !== d.x || t.y !== d.y)) run({ type: 'setUnderlay', underlay: { ...doc().underlay, x: t.x, y: t.y } }); view.requestDraw(); },
      overlay() {},
    },
  };
  for (const t of Object.values(H)) { t.down ||= () => {}; t.move ||= () => {}; t.up ||= () => {}; t.overlay ||= () => {}; }

  function colTool(kind) {
    return {
      hint: () => `${kind === 'rect' ? '사각' : '원형'} 기둥을 놓을 자리를 누르세요 · ${kb('ESC 로 끝냅니다', '끝내려면 [끝내기]를 누르세요')}`,
      up(c) { const p = snap(c).p; if (fl().columns.some((q) => dist(q.c, p) < 1)) return; if (run({ type: 'addColumn', kind, c: p })) say('기둥을 놓았습니다'); }, // 같은 자리에 또 누르면(더블클릭) 기둥이 겹치므로 무시
      overlay(g) { if (!cur) return; const s = snap(cur), W = DEFAULTS.colW; polyOverlay(g, kind === 'round' ? circlePoly(s.p, W / 2, 24) : rectPoly(s.p, W, W, 0)); mark(g, s); },
    };
  }
  function openingCand(mm) {
    const n = nearestWall(doc(), mm, T(PX.hit * 1.5)); if (!n) return null;
    const type = opts.type || 'door', width = type === 'window' ? DEFAULTS.winW : DEFAULTS.doorW, L = wallLen(n.wall), s = snapStep(vp().scale);
    return { wall: n.wall, width, ok: width <= L, at: clamp((Math.round((n.at * L) / s) * s) / L, Math.min(0.5, width / 2 / L), Math.max(0.5, 1 - width / 2 / L)) };
  }
  function finishRect(a, b) {
    if (Math.abs(a[0] - b[0]) < 300 || Math.abs(a[1] - b[1]) < 300) return ui.toast('방이 너무 작습니다 · 300 mm 이상으로 그려 주세요', 'err');
    if (run({ type: 'addRoomRect', a, b })) say('방을 만들었습니다');
  }
  function closePoly() {
    if (!op || op.pts.length < 3) return;
    const pts = op.pts; op = null;
    if (run({ type: 'addRoomPoly', poly: pts })) say('방을 만들었습니다');
    redraw();
  }

  /* ---------- 포인터 파이프라인: 팬(가운데 버튼·스페이스·두 손가락) → 도구 ---------- */
  function ctxOf(e, px) {
    const c = { e, px, mm: view.toMm(px), shift: e.shiftKey, dn, moved: false, isDrag: false };
    if (dn) { c.moved = Math.hypot(px[0] - dn.px[0], px[1] - dn.px[1]) > (e.pointerType === 'mouse' ? PX.drag : PX.drag * 2); c.isDrag = c.moved; } // moved = 끌기 시작(손가락은 더 멀리), isDrag = 끌어 그리기 — 마우스·펜·손가락 모두 누른 자리에서 시작한다
    return c;
  }
  function beginGesture() {
    abort(); dn = null; view.underlayTemp = null;
    const [a, b] = [...pts.values()];
    gest = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, c0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], vp0: vp() };
  }
  function moveGesture() {
    const [a, b] = [...pts.values()]; if (!b || !gest) return;
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], k = clamp(gest.vp0.scale * (Math.hypot(a[0] - b[0], a[1] - b[1]) / gest.d0), SCALE.min, SCALE.max), m = toMm(gest.vp0, gest.c0);
    view.set({ ...gest.vp0, scale: k, ox: c[0] - m[0] * k, oy: c[1] - m[1] * k });
  }
  function attach(canvas) {
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => {
      { const f = e.pointerType === 'touch'; if (f !== fingers) { fingers = f; hint(); } }
      const px = local(e); pts.set(e.pointerId, px); kc = null; lastMm = view.toMm(px); try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 포인터가 이미 끝났으면 무시 */ } canvas.focus({ preventScroll: true }); // 포인터를 쓰면 키보드 커서는 물러난다
      if (pts.size >= 2) { pan = null; tapPan = null; return beginGesture(); }
      if (e.pointerType === 'mouse' && e.button === 1) { e.preventDefault(); pan = px; return ui.cursor('grabbing'); }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (space) { pan = px; return ui.cursor('grabbing'); }
      if (e.pointerType === 'touch' && tool === 'select' && !state.multi && blankAt(px)) { pan = px; tapPan = { px, moved: false }; return; } // 손가락 한 개로 빈 곳을 끌면 화면이 움직인다(전에는 두 손가락뿐이었다). 가볍게 누르면 선택을 푼다. 여러 개 고르기는 [그룹화]
      dn = ctxOf(e, px); cur = dn; H[tool].down(dn); view.requestDraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      const px = local(e); if (pts.has(e.pointerId)) pts.set(e.pointerId, px); kc = null; lastMm = view.toMm(px);
      if (gest) return moveGesture();
      if (pan) { if (tapPan && !tapPan.moved) { if (Math.hypot(px[0] - tapPan.px[0], px[1] - tapPan.px[1]) <= PX.drag * 2) return; tapPan.moved = true; } view.panBy(px[0] - pan[0], px[1] - pan[1]); pan = px; return; }
      const c = ctxOf(e, px); cur = c; H[tool].move(c); view.requestDraw();
    });
    const up = (e) => {
      const px = local(e); pts.delete(e.pointerId);
      if (gest) { if (!pts.size) gest = null; return; }
      if (pan) { const tp = tapPan; pan = null; tapPan = null; if (tp && !tp.moved && e.type !== 'pointercancel') { sel.clear(); view.requestDraw(); } return ui.cursor(space ? 'grab' : 'default'); }
      if (!dn) return;
      const c = ctxOf(e, px); cur = c; const was = dn; dn = null; c.dn = was;
      if (e.type === 'pointercancel') { abort(); return view.requestDraw(); }
      H[tool].up(c); view.requestDraw(); hint();
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pts.size) { cur = null; view.hover = null; view.requestDraw(); } });
    canvas.addEventListener('dblclick', (e) => { if (H[tool].dbl) H[tool].dbl(ctxOf(e, local(e))); });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); escape(); }); // 오른쪽 단추 = ESC
    const byKeyboard = () => { try { return canvas.matches(':focus-visible'); } catch (err) { return false; } }; // 마우스로 초점을 준 것이 아니면 키보드 커서를 바로 보인다
    canvas.addEventListener('focus', () => { focused = true; if (byKeyboard()) kbWake(false); else view.requestDraw(); });
    canvas.addEventListener('blur', () => { focused = false; view.requestDraw(); });
  }

  /* ---------- 키 ---------- */
  function escape() {
    if (drag && drag.started) { store.cancel(); drag = null; return redraw(); }
    if (op) return end();
    if (tool !== 'select') return ui.setTool('select');
    sel.clear();
  }
  function key(e, inScope = true) { // 먹었으면 true. 입력칸 초점일 때는 app 이 이 함수를 부르지 않는다. inScope = 캔버스·도구 패널에 초점이 있다 — 한 글자 단축키(글쇠·[ ])는 그때만 듣는다(WCAG 2.1.4)
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const k = e.key, code = e.code || '', isCanvas = !!e.target && e.target.id === 'plCanvas', onCanvas = isCanvas || (typeof document !== 'undefined' && e.target === document.body);
    if (code === 'Escape') { escape(); return true; }
    const t = code.startsWith('Key') ? SHORTCUTS[code.slice(3)] : null;
    if (t) { if (!inScope) return false; ui.setTool(t); return true; }
    if ((k === '[' || k === ']') && inScope) {
      if (tool === 'placeItem') { rot = (rot + (k === ']' ? 90 : -90) + 360) % 360; redraw(); return true; }
      if (tool === 'select' && isCanvas) { stepSel(k === ']' ? 1 : -1); return true; }
    }
    if (!onCanvas) return false;
    if (isCanvas && kbKey(e)) return true;
    if (k === 'Enter') { if (tool === 'room' && op && op.mode === 'poly') closePoly(); else if (op) end(); return true; }
    if ((k === 'Delete' || k === 'Backspace') && tool === 'select') { if (state.locked) ui.toast('잠금 상태입니다', 'err'); else if (sel.size && run({ type: 'remove', ids: [...sel.ids] })) { sel.prune(doc()); say('지웠습니다'); } return true; }
    if (k.startsWith('Arrow') && sel.size && tool === 'select' && !state.locked) { const s = e.shiftKey ? 500 : snapStep(vp().scale); run({ type: 'move', ids: [...sel.ids], dx: k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, dy: k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0 }); return true; }
    return false;
  }
  function setSpace(on) { space = on; if (!pan) ui.cursor(on ? 'grab' : 'default'); }

  return {
    attach, key, escape, setSpace, hint: redraw,
    get tool() { return tool; }, get opts() { return opts; }, get op() { return op; },
    setShift(on) { if (cur) { cur.shift = on; view.requestDraw(); } }, // Shift 를 누르거나 뗐을 때 마우스가 안 움직여도 미리보기를 다시 그린다
    setTool(name, o = {}) {
      if (!NAMES[name]) return false;
      if (state.locked && name !== 'select') { ui.toast('잠금을 풀어야 쓸 수 있습니다', 'err'); return false; }
      abort(); op = null; tool = name; opts = o; rot = o.rot || 0; view.hover = null; view.underlayTemp = null;
      if (name !== 'select') sel.clear();
      ui.cursor(name === 'select' ? 'default' : 'crosshair'); redraw(); return true;
    },
    overlay(g) {
      H[tool].overlay(g);
      if (!kbShown()) return;
      const q = g.toPx(kc.mm); drawCrosshair(g.ctx, g.C, q[0], q[1]);
      drawPill(g.ctx, g.C, `${g.fmt(kc.mm[0])} · ${g.fmt(kc.mm[1])}`, q[0], q[1] > g.vp.h - 44 ? q[1] - 24 : q[1] + 24, { color: g.C.accent });
    },
    get kb() { return kc && { mm: [...kc.mm] }; },
    abort() { abort(); op = null; },
  };
}
