// 도면 저장소 — 명령(exec)으로만 문서를 바꾸고, 바뀐 부분만 새로 만든 불변 문서를 undo 스택에 쌓는다 (순수 로직, DOM 없음)
import { DEFAULTS, PREFIX, COLS, MODELS, BRANDS, createDoc, cloneDoc, curFloor, newId, fixSeq, makeFloor, validateDoc } from './model.js';
import { dist, polyArea, signedArea, offsetPoly, roomInnerPoly, segSegIntersect, wallLen, bounds, pointInPoly } from './geom.js';
import { History } from './history.js';

const fail = (m) => { throw new Error(m); };
const ok = (c, m) => { if (!c) fail(m); };
const isPt = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const P2 = (p) => [p[0], p[1]];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function deepFreeze(o) { // 이미 얼린 하위는 건너뛴다(공유된 옛 부분은 다시 훑지 않는다)
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
// 명령이 바꿀 층·배열만 얕게 복사한 초안 — 요소 객체는 절대 제자리 수정하지 않고 새로 만들어 끼운다
function draft(doc) {
  const f = { ...curFloor(doc), finish: { ...curFloor(doc).finish } };
  for (const k of COLS) f[k] = f[k].slice();
  const floors = doc.floors.slice(); floors[doc.cur] = f;
  return { ...doc, floors, seq: { ...doc.seq } };
}
const put = (d, f, col, el) => { const id = newId(d, PREFIX[col]); f[col].push({ id, ...el }); return id; };

function selfCrossing(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (segSegIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
  }
  return false;
}
// 방 하나 = 벽 n개 + Room. 방 다각형은 안쪽 면, 벽 중심선은 그보다 t/2 바깥(엔진 JSON 규약)
function addRoom(d, f, pts, name) {
  ok(Array.isArray(pts) && pts.every(isPt), '방 모양(점 목록)이 필요합니다');
  const poly = pts.map(P2).filter((p, i, a) => dist(p, a[(i + a.length - 1) % a.length]) >= 1); // 겹치는 연속 점·닫는 점 제거
  ok(poly.length >= 3, '방은 점이 3개 이상이어야 합니다');
  ok(!selfCrossing(poly), '방 모양이 스스로 겹칩니다');
  ok(polyArea(poly) >= 1, '방의 넓이가 0 입니다');
  if (signedArea(poly) < 0) poly.reverse();
  const t = DEFAULTS.wallT, ring = offsetPoly(poly, t / 2), rid = newId(d, 'R');
  const wallIds = ring.map((a, i) => put(d, f, 'walls', { a, b: ring[(i + 1) % ring.length], t, kind: 'inner', bulge: 0 }));
  f.rooms.push({ id: rid, name: name || `방 ${rid.slice(1)}`, poly, wallIds });
  return [rid, ...wallIds];
}
// 벽이 바뀐 방은 벽에서 안쪽 면 다각형을 다시 구한다. skip = 이미 벽과 함께 옮겨 맞는 방 id 집합
function syncRooms(f, wallIds, skip = null) {
  const hit = new Set(wallIds);
  let byId = null;
  f.rooms = f.rooms.map((r) => {
    if (skip?.has(r.id) || r.wallIds.length !== r.poly.length || !r.wallIds.some((i) => hit.has(i))) return r;
    byId ??= new Map(f.walls.map((w) => [w.id, w]));
    const W = r.wallIds.map((i) => byId.get(i));
    return W.every(Boolean) ? { ...r, poly: roomInnerPoly(W, r.poly) } : r;
  });
}
// 개구부가 벽 안에 들어오게 at 을 맞추고, 같은 벽의 다른 개구부와 겹치면 거절
function fitOpening(f, o) {
  const w = f.walls.find((x) => x.id === o.wall);
  if (!w) return;
  const L = wallLen(w);
  ok(Number.isFinite(o.at) && o.width <= L, '개구부가 벽보다 깁니다');
  o.at = clamp(o.at, o.width / 2 / L, 1 - o.width / 2 / L);
  for (const q of f.openings) if (q.wall === o.wall && q.id !== o.id && Math.abs(q.at - o.at) * L < (q.width + o.width) / 2 - 0.5) fail('같은 자리에 이미 개구부가 있습니다');
}
// 벽 길이가 바뀐 뒤 그 벽의 개구부를 새 길이에 다시 맞춘다 — 벽 위 비율(at)은 두고 벽 안으로 당긴다. 폭이 벽보다 길거나 서로 겹치면 거절
function refitOpenings(f, wallId) {
  const w = f.walls.find((x) => x.id === wallId), ops = f.openings.filter((o) => o.wall === wallId), L = w && wallLen(w);
  if (!ops.length || !(L > 0)) return; // 길이 0·깨진 좌표는 validateDoc 이 자기 말로 거절한다
  const fit = ops.map((o) => { ok(o.width <= L, '벽이 짧아져 개구부(문·창)가 들어가지 않습니다'); const at = clamp(o.at, o.width / 2 / L, 1 - o.width / 2 / L); return at === o.at ? o : { ...o, at }; });
  fit.forEach((o, i) => { for (const q of fit.slice(i + 1)) ok(Math.abs(q.at - o.at) * L >= (q.width + o.width) / 2 - 0.5, '벽이 짧아져 개구부끼리 겹칩니다'); });
  const by = new Map(fit.map((o) => [o.id, o]));
  f.openings = f.openings.map((o) => by.get(o.id) ?? o);
}
const allIds = (f) => COLS.flatMap((c) => f[c].map((e) => e.id));
const mapPts = (e, fn) => { // 좌표를 가진 요소의 새 객체(점만 변환)
  const r = { ...e };
  for (const k of ['a', 'b', 'c']) if (r[k]) r[k] = fn(r[k]);
  if (r.poly) r.poly = r.poly.map(fn);
  return r;
};
// 반전(flip)은 방향이 뒤집혀 문 호가 열리는 쪽(a→b 의 +법선)이 방 밖으로 바뀐다 → 벽 a↔b 를 바꾸고 개구부 at 을 1-at 로 두어 방 안쪽을 지킨다
// (처짐은 거울상으로 쪽이 바뀌고 a↔b 로 한 번 더 바뀌어 부호 그대로). 15자리로 맺어 0.3 같은 값이 두 번 반전하면 그대로 돌아온다
const flipAt = (at) => +(1 - at).toPrecision(15);
function transformFloor(f, fn, rotFn, flip) { // 현재 층 전체 변환(mirror·rotate)
  for (const col of ['walls', 'rooms', 'columns', 'guides', 'items']) f[col] = f[col].map((e) => {
    const r = mapPts(e, fn);
    if (col === 'walls' && flip) [r.a, r.b] = [r.b, r.a];
    if (col === 'rooms' && flip) { r.poly = r.poly.reverse(); r.wallIds = e.wallIds.map((_, j, a) => a[(2 * a.length - 2 - j) % a.length]); } // 시계방향 유지, 변 j ↔ wallIds[j]: 뒤집힌 점 r_j=q_(n-1-j) 의 변 j 는 옛 변 n-2-j
    if ((col === 'columns' || col === 'items') && rotFn) r.rot = rotFn(e.rot);
    return r;
  });
  if (flip) f.openings = f.openings.map((o) => ({ ...o, at: flipAt(o.at) }));
}

const CMD = {
  addWall(d, f, c) {
    ok(isPt(c.a) && isPt(c.b), '벽의 시작점과 끝점이 필요합니다');
    ok(dist(c.a, c.b) >= 1, '벽 길이가 너무 짧습니다');
    return [put(d, f, 'walls', { a: P2(c.a), b: P2(c.b), t: c.t ?? DEFAULTS.wallT, kind: c.kind ?? 'inner', bulge: c.bulge ?? 0 })];
  },
  addRoomRect(d, f, c) {
    ok(isPt(c.a) && isPt(c.b), '방의 두 모서리 점이 필요합니다');
    const [x0, x1] = [Math.min(c.a[0], c.b[0]), Math.max(c.a[0], c.b[0])], [y0, y1] = [Math.min(c.a[1], c.b[1]), Math.max(c.a[1], c.b[1])];
    return addRoom(d, f, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], c.name);
  },
  addRoomPoly: (d, f, c) => addRoom(d, f, c.poly, c.name),
  addColumn(d, f, c) {
    ok(c.kind === 'rect' || c.kind === 'round', '기둥 종류는 rect 또는 round 입니다');
    ok(isPt(c.c), '기둥 위치가 필요합니다');
    const w = c.w ?? DEFAULTS.colW;
    return [put(d, f, 'columns', { kind: c.kind, c: P2(c.c), w, d: c.kind === 'round' ? w : c.d ?? w, rot: c.rot ?? 0 })];
  },
  addOpening(d, f, c) { // 개구부 종류는 cmd.type 과 겹치므로 kind(또는 openingType)로 받는다
    const w = f.walls.find((x) => x.id === c.wall), kind = c.kind ?? c.openingType, win = kind === 'window';
    ok(w, '개구부를 붙일 벽을 찾을 수 없습니다');
    ok(['door', 'window', 'open'].includes(kind), '개구부 종류(kind)는 door·window·open 입니다');
    const o = { wall: w.id, at: c.at, width: c.width ?? (win ? DEFAULTS.winW : DEFAULTS.doorW), height: c.height ?? (win ? DEFAULTS.winH : DEFAULTS.doorH), sill: c.sill ?? (win ? DEFAULTS.winSill : 0), type: kind };
    fitOpening(f, o);
    return [put(d, f, 'openings', o)];
  },
  addGuide(d, f, c) {
    ok(isPt(c.a) && isPt(c.b) && dist(c.a, c.b) >= 1, '보조선의 두 점이 필요합니다');
    return [put(d, f, 'guides', { a: P2(c.a), b: P2(c.b) })];
  },
  addItem(d, f, c) {
    ok(c.kind === 'ac' && MODELS.includes(c.model) && BRANDS.includes(c.brand), '제품 종류·형식·브랜드가 올바르지 않습니다');
    ok(isPt(c.c), '제품 위치가 필요합니다');
    ok(Array.isArray(c.size) && c.size.length === 2 && c.size.every((v) => Number.isFinite(v) && v > 0), '제품 크기(가로·세로)가 필요합니다');
    return [put(d, f, 'items', { kind: 'ac', model: c.model, brand: c.brand, c: P2(c.c), rot: c.rot ?? 0, capacityKw: c.capacityKw ?? null, code: c.code ?? '', size: [c.size[0], c.size[1]] })];
  },
  remove(d, f, c) {
    ok(Array.isArray(c.ids), '지울 id 목록이 필요합니다');
    const ids = new Set(c.ids), wallDel = new Set(), roomDel = new Set(), out = [];
    for (const r of f.rooms) if (ids.has(r.id)) { roomDel.add(r.id); r.wallIds.forEach((i) => wallDel.add(i)); } // 방을 지우면 그 방의 벽도
    for (const w of f.walls) if (ids.has(w.id)) wallDel.add(w.id);
    for (const r of f.rooms) if (r.wallIds.some((i) => wallDel.has(i)) && (ids.has(r.id) || r.wallIds.some((i) => ids.has(i)))) roomDel.add(r.id); // 벽을 지우면 그 방도(나머지 벽은 둔다)
    const keep = (col, del) => { const k = f[col].filter((e) => { const gone = del(e); if (gone) out.push(e.id); return !gone; }); f[col] = k; };
    keep('rooms', (r) => roomDel.has(r.id));
    const gone = new Set(); // 실제로 지워진 벽 — 남은 방이 쓰는 공유 벽과 그 개구부는 남긴다
    keep('walls', (w) => { const g = wallDel.has(w.id) && !f.rooms.some((r) => r.wallIds.includes(w.id)); if (g) gone.add(w.id); return g; });
    keep('openings', (o) => ids.has(o.id) || gone.has(o.wall));
    for (const col of ['columns', 'guides', 'items']) keep(col, (e) => ids.has(e.id));
    return out.length ? out : null;
  },
  update(d, f, c) {
    ok(c.patch && typeof c.patch === 'object' && !('id' in c.patch), '수정할 내용이 올바르지 않습니다');
    for (const col of COLS) {
      const i = f[col].findIndex((e) => e.id === c.id);
      if (i < 0) continue;
      const e = { ...f[col][i], ...c.patch };
      if (same(e, f[col][i])) return null;
      if (col === 'openings') fitOpening(f, e);
      const old = f[col][i], geo = col === 'walls' && ['a', 'b', 't', 'bulge'].some((k) => !same(e[k], old[k]));
      f[col][i] = e;
      if (geo) {
        if (['a', 'b', 'bulge'].some((k) => !same(e[k], old[k]))) refitOpenings(f, c.id); // 길이가 바뀌면 개구부도 새 길이에 맞춘다
        syncRooms(f, [c.id]);
      }
      return [c.id];
    }
    return fail(`요소를 찾을 수 없습니다: ${c.id}`);
  },
  // 벽 id 를 직접 주면 그 벽의 끝점과 맞닿은(1mm 이내) 다른 벽의 끝점이 따라와 모서리가 닫혀 있다(늘어남).
  // 방 id 를 주면 그 방의 벽을 옮기되 이웃 방과 공유한 벽은 복제해(개구부는 원래 벽에 남는다) 그 방만 갖고 가고, 이웃 방·연결된 벽은 그대로다.
  move(d, f, c) {
    ok(Array.isArray(c.ids) && Number.isFinite(c.dx) && Number.isFinite(c.dy), '이동할 id 와 거리가 필요합니다');
    if (!c.dx && !c.dy) return null;
    const ids = new Set(c.ids), mv = (p) => [p[0] + c.dx, p[1] + c.dy], out = [], ownW = f.walls.filter((w) => ids.has(w.id)), own = new Set(ownW.map((w) => w.id));
    const moving = f.rooms.filter((r) => ids.has(r.id)), stay = new Set(f.rooms.flatMap((r) => (ids.has(r.id) ? [] : r.wallIds)));
    const clone = new Map(), inPlace = new Set(own);
    for (const r of moving) for (const i of r.wallIds) { if (own.has(i) || !stay.has(i)) inPlace.add(i); else if (!clone.has(i)) clone.set(i, newId(d, 'W')); }
    const src = new Map(clone.size ? f.walls.filter((w) => clone.has(w.id)).map((w) => [w.id, w]) : []);
    const ends = new Map(), cell = (p, dx, dy) => `${Math.floor(p[0]) + dx},${Math.floor(p[1]) + dy}`; // 직접 고른 벽의 끝점을 1mm 칸에 담아 맞닿은 끝점을 빨리 찾는다
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const w of ownW) for (const p of [w.a, w.b]) { const k = cell(p, 0, 0); (ends.get(k) ?? ends.set(k, []).get(k)).push(p); box[0] = Math.min(box[0], p[0] - 1); box[1] = Math.min(box[1], p[1] - 1); box[2] = Math.max(box[2], p[0] + 1); box[3] = Math.max(box[3], p[1] + 1); }
    const joined = (p) => { if (p[0] < box[0] || p[0] > box[2] || p[1] < box[1] || p[1] > box[3]) return false; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) if (ends.get(cell(p, x, y))?.some((q) => dist(p, q) < 1)) return true; return false; };
    const stretched = [];
    f.walls = f.walls.map((w) => {
      if (inPlace.has(w.id)) return out.push(w.id), mapPts(w, mv);
      const fa = joined(w.a), fb = joined(w.b);
      if (!fa && !fb) return w;
      out.push(w.id); stretched.push(w.id);
      const n = { ...w, a: fa ? mv(w.a) : w.a, b: fb ? mv(w.b) : w.b };
      ok((n.b[0] - n.a[0]) * (w.b[0] - w.a[0]) + (n.b[1] - n.a[1]) * (w.b[1] - w.a[1]) > 0, '맞닿은 벽이 뒤집히도록 옮길 수 없습니다'); // 늘어나는 벽이 0 을 지나 반대로 접히면 방이 뒤집힌다
      return n;
    });
    for (const [from, id] of clone) { out.push(id); f.walls.push({ ...mapPts(src.get(from), mv), id }); }
    f.rooms = f.rooms.map((r) => (ids.has(r.id) ? (out.push(r.id), { ...mapPts(r, mv), wallIds: r.wallIds.map((i) => clone.get(i) ?? i) }) : r));
    for (const i of stretched) refitOpenings(f, i);
    syncRooms(f, [...inPlace, ...stretched], ids); // 옮긴 방은 벽과 함께 움직여 맞고, 벽만 움직인(늘어난) 쪽 방은 다시 맞춘다
    for (const col of ['columns', 'guides', 'items']) f[col] = f[col].map((e) => (ids.has(e.id) ? (out.push(e.id), mapPts(e, mv)) : e));
    return out.length ? out : null;
  },
  mirror(d, f, c) { // axis 'x' = 좌우 반전(x 를 뒤집는다), 'y' = 상하 반전. 경계 상자 중심 기준
    ok(c.axis === 'x' || c.axis === 'y', 'axis 는 x 또는 y 입니다');
    const b = bounds(d, f);
    if (!b) return null;
    const k = c.axis === 'x' ? 0 : 1, S = k ? b.y0 + b.y1 : b.x0 + b.x1;
    transformFloor(f, (p) => (k ? [p[0], S - p[1]] : [S - p[0], p[1]]), (r) => (k ? -r : 180 - r) || 0, true);
    return allIds(f);
  },
  rotate(d, f, c) { // deg 90 = 시계방향(화면 기준), -90 = 반시계. 경계 상자 중심 기준
    ok(c.deg === 90 || c.deg === -90, 'deg 는 90 또는 -90 입니다');
    const b = bounds(d, f);
    if (!b) return null;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    transformFloor(f, c.deg === 90 ? (p) => [cx + cy - p[1], cy - cx + p[0]] : (p) => [cx - cy + p[1], cy + cx - p[0]], (r) => r + c.deg, false);
    return allIds(f);
  },
  setFloor(d, f, c) {
    ok(c.patch && typeof c.patch === 'object', '층 설정 값이 필요합니다');
    const { heightMm = f.heightMm, slabMm = f.slabMm, name = f.name, finish } = c.patch, fin = { ...f.finish, ...finish };
    if (heightMm === f.heightMm && slabMm === f.slabMm && name === f.name && same(fin, f.finish)) return null;
    Object.assign(f, { heightMm, slabMm, name, finish: fin });
    return [f.id];
  },
  addFloor(d, f) {
    const nf = makeFloor(d, f.heightMm, f.slabMm);
    d.floors.push(nf); d.cur = d.floors.length - 1;
    return [nf.id];
  },
  setCur(d, f, c) {
    ok(Number.isInteger(c.index) && c.index >= 0 && c.index < d.floors.length, '없는 층입니다');
    if (c.index === d.cur) return null;
    d.cur = c.index;
    return [d.floors[c.index].id];
  },
  setUnderlay(d, f, c) {
    const u = c.underlay;
    if (u === null) { if (d.underlay === null) return null; d.underlay = null; return []; }
    ok(u && typeof u.src === 'string' && typeof u.name === 'string' && u.mmPerPx > 0, '밑그림은 이름·이미지·축척(mmPerPx)이 필요합니다');
    d.underlay = { name: u.name, src: u.src, x: u.x ?? 0, y: u.y ?? 0, mmPerPx: u.mmPerPx, rot: u.rot ?? 0, opacity: u.opacity ?? 0.5 };
    return [];
  },
  rename(d, f, c) {
    ok(typeof c.title === 'string', '제목은 글자여야 합니다');
    if (c.title === d.title) return null;
    d.title = c.title;
    return [];
  },
  load(d, f, c) {
    const bad = validateDoc(c.doc);
    ok(!bad.length, '도면 파일을 읽지 못했습니다');
    Object.assign(d, fixSeq(c.doc));
    return [];
  },
};
const NO_UNDO = new Set(['setCur']); // 보기 상태 — undo 단계도 저장할 변경도 아니다

// 순수 함수: 문서에 명령 하나를 적용해 {doc(얼린 새 문서), ids} 를 돌려준다. 바뀐 게 없으면 null, 잘못된 명령은 한국어 메시지로 throw
export function applyCmd(doc, cmd) {
  const h = CMD[cmd?.type];
  if (!h) fail(`알 수 없는 명령입니다: ${cmd?.type}`);
  const d = draft(doc), ids = h(d, curFloor(d), JSON.parse(JSON.stringify(cmd)));
  if (!ids) return null;
  const bad = validateDoc(d);
  if (bad.length) fail(bad[0]);
  return { doc: deepFreeze(d), ids };
}

export class Store {
  #doc; #hist = new History(200); #subs = new Set(); #saved; #grp = null;
  constructor(doc = createDoc()) { this.#reset(doc); }
  #reset(doc) {
    const bad = validateDoc(doc);
    if (bad.length) fail(bad[0]);
    this.#doc = deepFreeze(fixSeq(cloneDoc(doc)));
    this.#hist.clear(); this.#saved = this.#hist.top; this.#grp = null;
  }
  #emit(e) { for (const fn of [...this.#subs]) { try { fn(e); } catch (err) { console.error(err); } } }
  get doc() { return this.#doc; } // 읽기 전용(얼려 있다) — 고치려면 exec, 복사본이 필요하면 cloneDoc
  get canUndo() { return !this.#grp && this.#hist.canUndo; }
  get canRedo() { return !this.#grp && this.#hist.canRedo; }
  get dirty() { return this.#hist.top !== this.#saved || (!!this.#grp && this.#doc !== this.#grp.base); }
  markSaved() { this.#saved = this.#hist.top; }
  subscribe(fn) { this.#subs.add(fn); return () => this.#subs.delete(fn); }
  exec(cmd) { // 바뀐 id 목록(추가면 새 id) 반환, 잘못된 명령이면 문서 그대로 두고 throw
    const r = applyCmd(this.#doc, cmd);
    if (!r) return [];
    const before = this.#doc;
    this.#doc = r.doc;
    if (!NO_UNDO.has(cmd.type) && !this.#grp) this.#hist.push({ label: cmd.type, before, after: r.doc });
    this.#emit({ type: cmd.type, ids: r.ids });
    return r.ids;
  }
  begin(label = '편집') { // 드래그 한 번을 undo 한 번으로 — begin 과 commit 사이의 exec 는 한 단계가 된다
    if (this.#grp) this.#grp.depth++;
    else this.#grp = { label, base: this.#doc, depth: 1 };
  }
  commit() {
    const g = this.#grp;
    if (!g || --g.depth) return;
    this.#grp = null;
    if (this.#doc !== g.base) this.#hist.push({ label: g.label, before: g.base, after: this.#doc });
    this.#emit({ type: 'commit' });
  }
  cancel() { // begin 이후 변경을 버린다(ESC)
    if (!this.#grp) return;
    this.#doc = this.#grp.base; this.#grp = null;
    this.#emit({ type: 'cancel' });
  }
  undo() {
    if (this.#grp) return false;
    const e = this.#hist.undo();
    if (!e) return false;
    this.#doc = e.before; this.#emit({ type: 'undo' });
    return true;
  }
  redo() {
    if (this.#grp) return false;
    const e = this.#hist.redo();
    if (!e) return false;
    this.#doc = e.after; this.#emit({ type: 'redo' });
    return true;
  }
  replace(doc) { this.#reset(doc); this.#emit({ type: 'replace' }); } // 불러오기 — undo 를 비운다
}
