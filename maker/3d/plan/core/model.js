// 도면 문서 모델 — 문서 생성·복제·id 발급·검증 (순수 로직, DOM 없음). 단위 mm, x→오른쪽·y→아래
export const DEFAULTS = Object.freeze({ wallT: 150, doorW: 900, doorH: 2100, winW: 1200, winH: 1200, winSill: 900, colW: 300, snapMm: 50, gridMinor: 100, gridMajor: 1000 });
export const MODELS = ['1way', '2way', '4way', '360', 'mini4way'];
export const BRANDS = ['samsung', 'lg'];
export const AC_PANEL_MM = 35, AC_BODY_MM = 140; // 엔진 공간 JSON 규약(size_mm[2], body_h_mm)
export const PREFIX = { walls: 'W', rooms: 'R', columns: 'C', openings: 'O', guides: 'G', items: 'I' };
export const COLS = Object.keys(PREFIX);
const FLOOR_H = 2300;
const KIND = { walls: ['inner', 'exterior'], openings: ['door', 'window', 'open'], columns: ['rect', 'round'] };

export const cloneDoc = (doc) => structuredClone(doc);
export const curFloor = (doc) => doc.floors[doc.cur];

// 접두 k(W,R,C,O,G,I,F)의 가장 큰 번호 — 삭제해도 번호를 다시 쓰지 않도록 seq 와 함께 본다
function maxNum(doc, k) {
  let m = 0;
  const see = (id) => { const x = typeof id === 'string' && id[0] === k && /^\d+$/.test(id.slice(1)) ? +id.slice(1) : 0; if (x > m) m = x; };
  if (k === 'F') doc.floors.forEach((f) => see(f.id));
  else { const col = COLS.find((c) => PREFIX[c] === k); for (const f of doc.floors) for (const e of f[col] || []) see(e.id); }
  return m;
}
const seqOf = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0); // 유한한 안전 정수만 카운터로 쓴다(Infinity·1e21 은 id 를 매번 같게 만든다)
export function newId(doc, k) {
  const s = (doc.seq ??= {});
  s[k] = Math.max(seqOf(s[k]), maxNum(doc, k)) + 1;
  return k + s[k];
}
export function fixSeq(doc) { // 불러온 문서의 seq 를 실제 id 에 맞춘다(번호 충돌 방지)
  const s = { ...doc.seq };
  for (const k of ['F', ...Object.values(PREFIX)]) s[k] = Math.max(seqOf(s[k]), maxNum(doc, k));
  return { ...doc, seq: s };
}

export function makeFloor(doc, heightMm = FLOOR_H, slabMm = 0) {
  const id = newId(doc, 'F');
  return { id, name: 'Floor ' + id.slice(1), heightMm, slabMm, walls: [], rooms: [], columns: [], openings: [], guides: [], items: [], finish: { wall: '', floor: '' } };
}
export function createDoc(title = '새 도면') {
  const doc = { v: 1, unit: 'mm', title, floors: [], cur: 0, underlay: null, seq: { W: 0, R: 0, C: 0, O: 0, G: 0, I: 0, F: 0 } };
  doc.floors.push(makeFloor(doc));
  return doc;
}

export const COORD_MAX = 1e7; // 좌표·치수 상한(mm) = 10km. 이보다 큰 값은 화면 배율·격자 계산이 끝나지 않는다
const num = Number.isFinite;
const co = (v) => num(v) && Math.abs(v) <= COORD_MAX;       // 좌표·처짐: 부호 있는 값
const len = (v) => num(v) && v > 0 && v <= COORD_MAX;        // 길이·크기: 0 보다 크다
const nonneg = (v) => num(v) && v >= 0 && v <= COORD_MAX;
const pt = (p) => Array.isArray(p) && p.length === 2 && p.every(co);
const areaOf = (poly) => { let s = 0; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; s += p[0] * q[1] - q[0] * p[1]; }); return Math.abs(s / 2); };

// 요소 하나의 문제 한 줄(없으면 ''). f = 그 요소가 속한 층
const CHECK = {
  walls: (w) => !pt(w.a) || !pt(w.b) ? '벽의 끝점 좌표가 올바르지 않습니다 (±10km 이내의 숫자)'
    : Math.hypot(w.a[0] - w.b[0], w.a[1] - w.b[1]) < 0.5 ? '벽 길이가 0 입니다'
    : !len(w.t) ? '벽 두께는 0 보다 크고 10km 이하여야 합니다'
    : !KIND.walls.includes(w.kind) ? '벽 종류는 inner 또는 exterior 입니다'
    : !co(w.bulge) ? '곡선벽 처짐 값이 올바르지 않습니다 (±10km 이내의 숫자)' : '',
  rooms: (r, f) => !Array.isArray(r.poly) || r.poly.length < 3 || !r.poly.every(pt) ? '방 모양은 점 3개 이상, 좌표는 ±10km 이내여야 합니다'
    : areaOf(r.poly) < 1 ? '방의 넓이가 0 입니다'
    : typeof r.name !== 'string' ? '방 이름이 문자열이 아닙니다'
    : !Array.isArray(r.wallIds) || r.wallIds.some((i) => !f.walls.some((w) => w.id === i)) ? '방이 없는 벽을 가리킵니다' : '',
  columns: (c) => !KIND.columns.includes(c.kind) ? '기둥 종류는 rect 또는 round 입니다'
    : !pt(c.c) ? '기둥 위치가 올바르지 않습니다 (±10km 이내의 숫자)'
    : !(len(c.w) && (c.kind === 'round' || len(c.d))) ? '기둥 크기는 0 보다 크고 10km 이하여야 합니다'
    : !num(c.rot) ? '기둥 회전값이 숫자가 아닙니다' : '',
  openings: (o, f) => {
    const w = f.walls.find((x) => x.id === o.wall);
    return !w ? '개구부가 없는 벽을 가리킵니다'
      : !KIND.openings.includes(o.type) ? '개구부 종류는 door·window·open 입니다'
      : !(num(o.at) && o.at >= 0 && o.at <= 1) ? '개구부 위치(at)는 0~1 입니다'
      : !(len(o.width) && len(o.height) && nonneg(o.sill)) ? '개구부 폭·높이는 0 보다, 바닥 높이는 0 이상이어야 합니다 (10km 이하)' : '';
  },
  guides: (g) => !pt(g.a) || !pt(g.b) ? '보조선 좌표가 올바르지 않습니다 (±10km 이내의 숫자)'
    : Math.hypot(g.a[0] - g.b[0], g.a[1] - g.b[1]) < 1 ? '보조선 길이는 1mm 이상이어야 합니다' : '', // addGuide 와 같은 기준
  items: (i) => i.kind !== 'ac' ? '제품 종류는 ac 입니다'
    : !MODELS.includes(i.model) ? '에어컨 형식이 올바르지 않습니다'
    : !BRANDS.includes(i.brand) ? '브랜드는 samsung 또는 lg 입니다'
    : !pt(i.c) || !num(i.rot) ? '제품 위치·회전이 올바르지 않습니다 (±10km 이내의 숫자)'
    : !(i.capacityKw === null || (num(i.capacityKw) && i.capacityKw > 0)) ? '냉방 용량이 올바르지 않습니다'
    : typeof i.code !== 'string' ? '모델명이 문자열이 아닙니다'
    : !(Array.isArray(i.size) && i.size.length === 2 && i.size.every(len)) ? '제품 크기(가로·세로)는 0 보다 크고 10km 이하여야 합니다' : '',
};

export function validateDoc(doc) {
  const P = [], bad = (m) => P.push(m);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['도면 데이터가 올바른 형식이 아닙니다'];
  if (doc.v !== 1) bad(`지원하지 않는 도면 버전입니다 (v=${doc.v})`);
  if (doc.unit !== 'mm') bad('도면 단위는 mm 만 지원합니다');
  if (typeof doc.title !== 'string') bad('도면 제목이 문자열이 아닙니다');
  if (!Array.isArray(doc.floors) || !doc.floors.length) return [...P, '층이 하나도 없습니다'];
  if (!Number.isInteger(doc.cur) || doc.cur < 0 || doc.cur >= doc.floors.length) bad('현재 층 번호가 범위를 벗어났습니다');
  const u = doc.underlay;
  if (u != null && !(typeof u.name === 'string' && typeof u.src === 'string' && co(u.x) && co(u.y) && len(u.mmPerPx) && num(u.rot) && num(u.opacity) && u.opacity >= 0 && u.opacity <= 1)) bad('밑그림 정보가 올바르지 않습니다');
  if (doc.seq != null && (typeof doc.seq !== 'object' || Array.isArray(doc.seq) || Object.values(doc.seq).some((v) => !(Number.isSafeInteger(v) && v >= 0)))) bad('번호 카운터(seq)는 0 이상의 유한한 정수여야 합니다');
  const seen = new Set(), uid = (id, who) => { if (typeof id !== 'string' || !id) bad(`${who}의 id 가 없습니다`); else if (seen.has(id)) bad(`id ${id} 가 중복되었습니다`); else seen.add(id); };
  for (const f of doc.floors) {
    if (!f || typeof f !== 'object') { bad('층 정보가 올바르지 않습니다'); continue; }
    uid(f.id, '층');
    if (!len(f.heightMm)) bad(`${f.id} 층 높이는 0 보다 크고 10km 이하여야 합니다`);
    if (!nonneg(f.slabMm)) bad(`${f.id} 슬래브 두께는 0 이상 10km 이하여야 합니다`);
    if (typeof f.name !== 'string') bad(`${f.id} 층 이름이 문자열이 아닙니다`);
    if (!f.finish || typeof f.finish.wall !== 'string' || typeof f.finish.floor !== 'string') bad(`${f.id} 마감 정보가 올바르지 않습니다`);
    if (COLS.some((c) => !Array.isArray(f[c]))) { bad(`${f.id} 요소 목록이 없습니다`); continue; }
    for (const c of COLS) for (const e of f[c]) {
      uid(e?.id, `${f.id} 의 ${c}`);
      const m = e && CHECK[c](e, f);
      if (m !== '') bad(`${e?.id ?? c}: ${m ?? '요소가 비어 있습니다'}`);
    }
  }
  return P;
}
