// 플래너 코어(maker/3d/plan/core: model·geom·history·store·export·mesh3d) 순수 로직 시험 — 수치는 손으로 계산한 값으로 단언한다.
// 실행: node tools/test-plan-core.js (Node 22.7+, ESM 자동 인식). 변이 시험용으로 PLAN_CORE_DIR 로 다른 사본을 가리킬 수 있다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = process.env.PLAN_CORE_DIR || path.join(__dirname, '..', 'maker/3d/plan/core');
const FILES = ['model', 'geom', 'history', 'store', 'export', 'mesh3d'];
const J = (x) => JSON.stringify(x);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);
const nearPt = (a, b, eps = 1e-6, msg) => { near(a[0], b[0], eps, msg); near(a[1], b[1], eps, msg); };
const ko = (m) => /[가-힣]/.test(m);
const throwsKo = (fn, re, msg) => { let err; try { fn(); } catch (e) { err = e; } assert.ok(err, (msg || '') + ' — throw 해야 한다'); assert.ok(ko(err.message), (msg || '') + ' — 한국어 메시지: ' + err.message); if (re) assert.ok(re.test(err.message), (msg || '') + ' — 메시지 ' + err.message); return err; };

(async () => {
  const [M, G, H, S, X, MESH] = await Promise.all(FILES.map((f) => import(pathToFileURL(path.join(DIR, f + '.js')).href)));
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'maker/3d/view/apartment.json'), 'utf8')).data.space;
  const cf = M.curFloor;
  const wallsOf = (doc, r) => r.wallIds.map((i) => cf(doc).walls.find((w) => w.id === i));
  const badRooms = (doc) => cf(doc).rooms.filter((r) => G.roomInnerPoly(wallsOf(doc, r), r.poly).some((p, i) => Math.hypot(p[0] - r.poly[i][0], p[1] - r.poly[i][1]) > 1e-3)).map((r) => r.id); // 방 다각형과 벽이 어긋난 방

  /* ===== 0. 정적 점검: DOM 없음, 계약 이름 그대로 ===== */
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(DIR, f + '.js'), 'utf8');
    assert.ok(/^\/\/ \S/.test(src), f + '.js 맨 위 한 줄 역할 주석');
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\b(document|window|navigator|globalThis)\s*[.\[]|\b(localStorage|sessionStorage|requestAnimationFrame)\b|innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new Function|Math\.random|Date\.now|new Date/.test(code), f + '.js 는 DOM·난수·시계를 쓰지 않는다(순수)');
  }
  const API = { model: ['createDoc', 'cloneDoc', 'newId', 'curFloor', 'validateDoc'], geom: ['dist', 'wallLen', 'wallOutline', 'polyArea', 'polyCentroid', 'pointInPoly', 'segSegIntersect', 'projectOnSeg', 'arcFrom3', 'snapPoint', 'hitTest', 'bounds', 'roomAreaM2', 'netWallLen'], export: ['toDocJSON', 'fromDocJSON', 'toSpaceJSON'], mesh3d: ['buildMesh'] };
  const mods = { model: M, geom: G, export: X, mesh3d: MESH };
  for (const [m, names] of Object.entries(API)) for (const n of names) assert.strictEqual(typeof mods[m][n], 'function', `${m}.${n}`);
  assert.strictEqual(typeof H.History, 'function'); assert.strictEqual(typeof S.Store, 'function');
  assert.deepStrictEqual({ ...M.DEFAULTS }, { wallT: 150, doorW: 900, doorH: 2100, winW: 1200, winH: 1200, winSill: 900, colW: 300, snapMm: 50, gridMinor: 100, gridMajor: 1000 }, 'DEFAULTS');

  /* ===== 1. model ===== */
  const d0 = M.createDoc();
  assert.deepStrictEqual([d0.v, d0.unit, d0.cur, d0.underlay, d0.floors.length], [1, 'mm', 0, null, 1]);
  assert.deepStrictEqual(d0.floors[0], { id: 'F1', name: 'Floor 1', heightMm: 2300, slabMm: 0, walls: [], rooms: [], columns: [], openings: [], guides: [], items: [], finish: { wall: '', floor: '' } });
  assert.strictEqual(M.createDoc('내 집').title, '내 집');
  assert.deepStrictEqual(M.validateDoc(d0), []);
  const cl = M.cloneDoc(d0); cl.floors[0].walls.push({}); assert.strictEqual(d0.floors[0].walls.length, 0, 'cloneDoc 은 깊은 복사');
  { // newId: 번호는 늘 증가, 지워도 다시 쓰지 않고, 낡은 seq 도 실제 id 보다 앞서지 않는다
    const d = M.createDoc();
    assert.deepStrictEqual(['W', 'W', 'R', 'W'].map((k) => M.newId(d, k)), ['W1', 'W2', 'R1', 'W3']);
    d.floors[0].walls.push({ id: 'W3' }); d.floors[0].walls.length = 0; // 지워도 seq 가 기억
    assert.strictEqual(M.newId(d, 'W'), 'W4');
    const stale = M.createDoc(); stale.seq.W = 0; stale.floors[0].walls.push({ id: 'W7' });
    assert.strictEqual(M.newId(stale, 'W'), 'W8', 'seq 가 낡아도 충돌하지 않는다');
    assert.strictEqual(M.newId(M.createDoc(), 'F'), 'F2');
  }
  { // validateDoc: 깨뜨릴 때마다 한국어 문제가 나온다
    const base = (await (async () => { const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000] }); s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' }); s.exec({ type: 'addColumn', kind: 'rect', c: [100, 100] }); s.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'lg', c: [2500, 2000], size: [1000, 500] }); s.exec({ type: 'addGuide', a: [0, 0], b: [100, 0] }); return M.cloneDoc(s.doc); })());
    assert.deepStrictEqual(M.validateDoc(base), []);
    const brk = (label, mut, re) => { const d = M.cloneDoc(base); mut(d, d.floors[0]); const p = M.validateDoc(d); assert.ok(p.length, label + ' — 문제가 잡혀야 한다'); assert.ok(p.every(ko), label + ' — 한국어: ' + p); if (re) assert.ok(p.some((m) => re.test(m)), label + ' — ' + p); };
    brk('v', (d) => { d.v = 2; }, /버전/); brk('unit', (d) => { d.unit = 'cm'; }, /mm/); brk('title', (d) => { d.title = 5; }, /제목/);
    brk('floors 없음', (d) => { d.floors = []; }, /층/); brk('cur', (d) => { d.cur = 3; }, /현재 층/); brk('cur 소수', (d) => { d.cur = 0.5; });
    brk('heightMm', (d, f) => { f.heightMm = 0; }, /높이/); brk('slab', (d, f) => { f.slabMm = -1; }, /슬래브/); brk('finish', (d, f) => { f.finish = null; }, /마감/); brk('배열 없음', (d, f) => { delete f.walls; }, /목록/);
    brk('벽 두께 음수', (d, f) => { f.walls[0].t = -150; }, /두께/); brk('벽 두께 0', (d, f) => { f.walls[0].t = 0; }, /두께/); brk('벽 길이 0', (d, f) => { f.walls[0].b = [...f.walls[0].a]; }, /길이/);
    brk('벽 종류', (d, f) => { f.walls[0].kind = 'x'; }, /종류/); brk('벽 좌표 NaN', (d, f) => { f.walls[0].a = [NaN, 0]; }, /좌표/); brk('id 중복', (d, f) => { f.walls[1].id = f.walls[0].id; }, /중복/); brk('floor/wall id 중복', (d, f) => { f.walls[0].id = 'F1'; }, /중복/);
    brk('방이 없는 벽', (d, f) => { f.rooms[0].wallIds.push('W99'); }, /없는 벽/); brk('방 점 2개', (d, f) => { f.rooms[0].poly = [[0, 0], [1, 1]]; }, /3개/); brk('방 넓이 0', (d, f) => { f.rooms[0].poly = [[0, 0], [1, 0], [2, 0]]; }, /넓이/);
    brk('개구부 at', (d, f) => { f.openings[0].at = 1.5; }, /0~1/); brk('개구부 벽', (d, f) => { f.openings[0].wall = 'W99'; }, /벽/); brk('개구부 폭', (d, f) => { f.openings[0].width = -1; }, /폭/); brk('개구부 종류', (d, f) => { f.openings[0].type = 'x'; }, /종류/);
    brk('기둥 종류', (d, f) => { f.columns[0].kind = 'tri'; }, /기둥/); brk('기둥 크기', (d, f) => { f.columns[0].w = 0; }, /크기/);
    brk('제품 형식', (d, f) => { f.items[0].model = '5way'; }, /형식/); brk('제품 브랜드', (d, f) => { f.items[0].brand = 'x'; }, /브랜드/); brk('용량 음수', (d, f) => { f.items[0].capacityKw = -1; }, /용량/); brk('제품 크기', (d, f) => { f.items[0].size = [0, 5]; }, /크기/);
    brk('보조선', (d, f) => { f.guides[0].b = null; }, /보조선/); brk('밑그림', (d) => { d.underlay = { name: 'a' }; }, /밑그림/);
    assert.ok(M.validateDoc(null).length && M.validateDoc([]).length && M.validateDoc('x').length);
  }

  /* ===== 2. geom ===== */
  assert.strictEqual(G.dist([0, 0], [3, 4]), 5);
  { // 호: 반원
    const A = G.arcFrom3([0, 0], [1000, 0], 500);
    nearPt(A.c, [500, 0], 1e-6); near(A.r, 500, 1e-6); near(A.len, Math.PI * 500, 1e-6); near(Math.abs(A.sweep), Math.PI, 1e-9); nearPt(A.mid, [500, 500]);
    const B = G.arcFrom3([0, 0], [1000, 0], -500); nearPt(B.mid, [500, -500]); assert.ok(Math.sign(A.sweep) === -Math.sign(B.sweep), '처짐 부호가 호 방향을 뒤집는다');
    // 일반: 현 1000, 처짐 100 → r = (500²+100²)/(2·100) = 1300, 중심은 처짐 반대쪽 (500, -1200)
    const C = G.arcFrom3([0, 0], [1000, 0], 100);
    near(C.r, 1300, 1e-6); nearPt(C.c, [500, -1200], 1e-6); near(C.len, 2 * 1300 * Math.asin(500 / 1300), 1e-6);
    // 큰 호(처짐 > 반지름): 중심각 > 180°
    const D = G.arcFrom3([0, 0], [1000, 0], 1500);
    near(D.r, (500 ** 2 + 1500 ** 2) / 3000, 1e-6); assert.ok(Math.abs(D.sweep) > Math.PI);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) near(G.dist(G.wallPointAt({ a: [0, 0], b: [1000, 0], bulge: 1500 }, u).p, D.c), D.r, 1e-6, '호 위의 점');
    nearPt(G.wallPointAt({ a: [0, 0], b: [1000, 0], bulge: 1500 }, 0.5).p, D.mid, 1e-6); nearPt(G.wallPointAt({ a: [0, 0], b: [1000, 0], bulge: 500 }, 1).p, [1000, 0], 1e-6);
    assert.strictEqual(G.arcFrom3([0, 0], [1000, 0], 0), null); assert.strictEqual(G.arcFrom3([0, 0], [0, 0], 5), null);
    assert.strictEqual(G.wallLen({ a: [0, 0], b: [3000, 4000], bulge: 0 }), 5000); near(G.wallLen({ a: [0, 0], b: [1000, 0], bulge: 500 }), Math.PI * 500, 1e-6);
  }
  { // 면적·무게중심·포함
    const R = [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], Lsh = [[0, 0], [6000, 0], [6000, 2000], [2000, 2000], [2000, 6000], [0, 6000]];
    assert.strictEqual(G.polyArea(R), 20e6); assert.strictEqual(G.polyArea([...R].reverse()), 20e6); assert.ok(G.signedArea(R) > 0, '화면에서 시계방향이면 +'); assert.ok(G.signedArea([...R].reverse()) < 0);
    assert.strictEqual(G.polyArea(Lsh), 20e6); assert.strictEqual(G.polyArea([[0, 0], [4000, 0], [0, 3000]]), 6e6);
    nearPt(G.polyCentroid(R), [2500, 2000]); nearPt(G.polyCentroid(Lsh), [2200, 2200], 1e-6); nearPt(G.polyCentroid([[0, 0], [10, 0], [20, 0]]), [10, 0]);
    assert.ok(G.pointInPoly(R, [2500, 2000]) && !G.pointInPoly(R, [5001, 2000]) && !G.pointInPoly(R, [-1, 2000]));
    assert.ok(!G.pointInPoly(Lsh, [4000, 4000]), 'ㄱ 모양 오목한 자리는 밖') && assert.ok(G.pointInPoly(Lsh, [1000, 5000]) && G.pointInPoly(Lsh, [5000, 1000]));
    // 바깥으로 d 만큼: 직교 다각형은 A + P·d + (볼록-오목)·d²  → ㄱ: 20e6 + 24000·100 + (5-1)·100²
    near(G.polyArea(G.offsetPoly(R, 75)), 5150 * 4150, 1e-3); near(G.polyArea(G.offsetPoly(R, -100)), 4800 * 3800, 1e-3);
    near(G.polyArea(G.offsetPoly(Lsh, 100)), 20e6 + 24000 * 100 + 4 * 1e4, 1e-3); near(G.polyArea(G.offsetPoly([...Lsh].reverse(), 100)), 20e6 + 24000 * 100 + 4 * 1e4, 1e-3, '반시계 입력도 바깥으로');
    near(G.polyArea(G.offsetPoly(R, [100, 0, 0, 0])), 5000 * 4100, 1e-3); // 변마다 다른 거리
  }
  { // 교차·투영
    const X1 = G.segSegIntersect([0, 0], [10, 10], [0, 10], [10, 0]); nearPt(X1.p, [5, 5]); near(X1.t, 0.5, 1e-9); near(X1.u, 0.5, 1e-9);
    assert.strictEqual(G.segSegIntersect([0, 0], [1, 0], [0, 1], [1, 1]), null, '평행'); assert.strictEqual(G.segSegIntersect([0, 0], [1, 1], [2, 0], [3, -5]), null, '안 닿음');
    near(G.segSegIntersect([0, 0], [10, 0], [10, -5], [10, 5]).t, 1, 1e-9, '끝점 접촉');
    const P1 = G.projectOnSeg([5, 3], [0, 0], [10, 0]); nearPt(P1.p, [5, 0]); near(P1.t, 0.5, 1e-9); near(P1.d, 3, 1e-9);
    const P2 = G.projectOnSeg([-4, 3], [0, 0], [10, 0]); nearPt(P2.p, [0, 0]); assert.strictEqual(P2.t, 0); near(P2.d, 5, 1e-9); assert.strictEqual(G.projectOnSeg([12, 0], [0, 0], [10, 0]).t, 1);
    assert.strictEqual(G.projectOnSeg([1, 1], [2, 2], [2, 2]).t, 0, '길이 0 선분');
  }
  { // 벽 외곽
    const w = { a: [0, 0], b: [4000, 0], t: 150, kind: 'inner', bulge: 0 }, o = G.wallOutline(w);
    assert.strictEqual(o.length, 4); near(G.polyArea(o), 4000 * 150, 1e-6); assert.ok(G.signedArea(o) > 0, '외곽은 시계방향');
    assert.deepStrictEqual(o.map((p) => p.map((v) => Math.round(v))).sort(), [[0, -75], [0, 75], [4000, -75], [4000, 75]].sort());
    const arc = { a: [0, 0], b: [1000, 0], t: 100, kind: 'inner', bulge: 500 }, ao = G.wallOutline(arc); // 반원 띠: π(550²-450²)/2
    near(G.polyArea(ao) / (Math.PI * 50000), 1, 0.002, '곡선벽 외곽 면적'); assert.ok(ao.length > 30, '호를 선분으로 근사');
    // ㄱ 모서리: 안쪽·바깥 꼭짓점이 마이터로 맞는다
    const w1 = { id: 'A', a: [0, 0], b: [1000, 0], t: 100, kind: 'inner', bulge: 0 }, w2 = { id: 'B', a: [1000, 0], b: [1000, 1000], t: 100, kind: 'inner', bulge: 0 };
    const o1 = G.wallOutline(w1, [w1, w2]).map((p) => p.map((v) => Math.round(v)));
    assert.deepStrictEqual(o1, [[0, -50], [1050, -50], [950, 50], [0, 50]], '안쪽 (950,50) 바깥 (1050,-50)');
    assert.deepStrictEqual(G.wallOutline(w2, [w1, w2]).map((p) => p.map((v) => Math.round(v))), [[1050, -50], [1050, 1000], [950, 1000], [950, 50]]);
    assert.deepStrictEqual(G.wallOutline(w1).map((p) => p.map(Math.round)), [[0, -50], [1000, -50], [1000, 50], [0, 50]], 'walls 를 안 주면 접합 없음');
    // 한 직선으로 이어진 두 벽은 그대로 맞닿는다
    const c1 = { id: 'C', a: [0, 0], b: [1000, 0], t: 100, kind: 'inner', bulge: 0 }, c2 = { id: 'D', a: [1000, 0], b: [2000, 0], t: 100, kind: 'inner', bulge: 0 };
    assert.deepStrictEqual(G.wallOutline(c1, [c1, c2]).map((p) => p.map(Math.round)), [[0, -50], [1000, -50], [1000, 50], [0, 50]]);
    // 네 벽이 한 점에서 만나면 끝을 t/2 늘려 모서리 빈틈을 메운다
    const cross = [[1000, 0], [0, 1000], [-1000, 0], [0, -1000]].map((b, i) => ({ id: 'X' + i, a: [0, 0], b, t: 100, kind: 'inner', bulge: 0 }));
    for (const x of G.wallOutlines(cross)) { near(G.polyArea(x), 1050 * 100, 1e-6, '십자 벽'); }
    // 방 하나(5000×4000, 두께 150)의 벽 네 개 외곽 합 = 바깥 5300×4300 − 안쪽 5000×4000 (모서리 틈·겹침 없음)
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000] });
    near(G.wallOutlines(cf(s.doc).walls).reduce((a, p) => a + G.polyArea(p), 0), 5300 * 4300 - 5000 * 4000, 1e-3, '벽 외곽 면적 합');
    const W = cf(s.doc).walls, rd = (o) => o.map((p) => p.map(Math.round));
    assert.deepStrictEqual(rd(G.wallOutline(W[0], W)), [[-150, -150], [5150, -150], [5000, 0], [0, 0]], '위 벽: 바깥 모서리 (-150,-150), 안쪽 (0,0)');
    assert.deepStrictEqual(rd(G.wallOutline(W[0])), [[-75, -150], [5075, -150], [5075, 0], [-75, 0]], 'walls 를 안 주면 접합 없이 곧은 끝');
  }
  { // 방 면적: 5000×4000 = 20㎡, 실면적+내외벽(두께 150) = 5300×4300 = 22.79㎡
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000] }); const r = cf(s.doc).rooms[0];
    near(G.roomAreaM2(s.doc, r), 20, 1e-9); near(G.roomAreaM2(s.doc, r, { withWalls: false }), 20, 1e-9); near(G.roomAreaM2(s.doc, r, { withWalls: true }), 22.79, 1e-9);
    s.exec({ type: 'update', id: 'W1', patch: { t: 300 } }); // 위 벽만 300: 중심선은 그대로, 안쪽 면이 75 안으로 → 방 5000×3925
    const r2 = cf(s.doc).rooms[0]; near(G.roomAreaM2(s.doc, r2), 5 * 3.925, 1e-9, '벽이 두꺼워지면 방이 줄어든다');
    near(G.roomAreaM2(s.doc, r2, { withWalls: true }), (5000 + 150 + 150) * (3925 + 300 + 150) / 1e6, 1e-9, '변마다 그 벽 두께');
    const s2 = new S.Store(); s2.exec({ type: 'addRoomPoly', poly: [[0, 0], [6000, 0], [6000, 2000], [2000, 2000], [2000, 6000], [0, 6000]] });
    near(G.roomAreaM2(s2.doc, cf(s2.doc).rooms[0]), 20, 1e-9); near(G.roomAreaM2(s2.doc, cf(s2.doc).rooms[0], { withWalls: true }), 20 + (24000 * 150 + 4 * 150 * 150) / 1e6, 1e-9, 'ㄱ 방 + 벽');
  }
  { // 현재 층 벽 길이
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000] });
    near(G.grossWallLen(s.doc), 2 * (5150 + 4150), 1e-6); near(G.netWallLen(s.doc), 18600, 1e-6);
    s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' }); s.exec({ type: 'addOpening', wall: 'W2', at: 0.5, kind: 'window' });
    near(G.netWallLen(s.doc), 18600 - 900 - 1200, 1e-6, '개구부 폭만큼 뺀다');
    s.exec({ type: 'addFloor' }); assert.strictEqual(G.netWallLen(s.doc), 0, '층마다 따로');
  }

  /* ===== 3. 스냅 · 선택 판정 · 경계 ===== */
  function fixture() { // 거실 R1(0..5000×0..4000, W1 위·W2 오른쪽·W3 아래·W4 왼쪽) + ㄱ 방 R2 + 자유 벽·곡선벽·기둥·개구부·보조선·에어컨
    const s = new S.Store();
    s.exec({ type: 'rename', title: '시험 도면' });
    s.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000], name: '거실' });
    s.exec({ type: 'addRoomPoly', poly: [[6000, 0], [9000, 0], [9000, 1000], [7000, 1000], [7000, 3000], [6000, 3000]], name: '서재' });
    s.exec({ type: 'addWall', a: [0, 6000], b: [3000, 6000], kind: 'exterior' }); // W11
    s.exec({ type: 'addWall', a: [4000, 6000], b: [6000, 6000], bulge: 300 }); // W12
    s.exec({ type: 'addColumn', kind: 'rect', c: [4500, 3500], w: 300, d: 400, rot: 30 }); s.exec({ type: 'addColumn', kind: 'round', c: [1000, 3500], w: 400 });
    s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'window' }); s.exec({ type: 'addOpening', wall: 'W4', at: 0.5, kind: 'door' }); s.exec({ type: 'addOpening', wall: 'W11', at: 0.5, kind: 'open' });
    s.exec({ type: 'addGuide', a: [0, 8000], b: [3000, 8000] });
    s.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'samsung', c: [2500, 1500], rot: 90, capacityKw: 5.2, code: 'AJ052', size: [1001, 500] });
    s.exec({ type: 'addItem', kind: 'ac', model: '4way', brand: 'lg', c: [8000, 500], rot: 15, size: [840, 840] });
    return s;
  }
  {
    const s = fixture(), d = s.doc;
    assert.strictEqual(M.validateDoc(d).length, 0);
    const sn = (p, o = {}) => G.snapPoint(d, p, { tolMm: 100, ...o });
    let r = sn([-70, -60]); assert.strictEqual(r.kind, 'end'); nearPt(r.p, [-75, -75]); assert.ok(['W1', 'W4'].includes(r.ref));
    r = sn([2520, -60]); assert.strictEqual(r.kind, 'mid'); nearPt(r.p, [2500, -75]); assert.strictEqual(r.ref, 'W1');
    r = sn([2030, 80], { tolMm: 10, from: [0, 0], ortho: true }); assert.deepStrictEqual([r.kind, r.p], ['ortho', [2050, 0]], '직교: 시작점 y 고정, x 는 격자');
    r = sn([30, 2200], { tolMm: 10, from: [0, 0], ortho: true }); assert.deepStrictEqual([r.kind, r.p], ['ortho', [0, 2200]]);
    r = sn([-75 + 60, -75 + 60], { from: [-75, 2000], ortho: true }); assert.strictEqual(r.kind, 'end', '끝점이 직교보다 우선'); // (-15,-15) 는 W1 끝점(-75,-75)에서 85 — tol 100 안
    r = sn([2500 + 30, -75 + 30], { from: [100, 100], ortho: true }); assert.strictEqual(r.kind, 'mid', '중점이 직교보다 우선');
    r = sn([1234, 3321], { tolMm: 10 }); assert.deepStrictEqual([r.kind, r.p], ['grid', [1250, 3300]]);
    r = sn([1234, 3321], { tolMm: 10, gridMm: 100 }); assert.deepStrictEqual(r.p, [1200, 3300]);
    r = sn([1234, 3321], { tolMm: 10, gridMm: 0 }); assert.deepStrictEqual([r.kind, r.p], ['none', [1234, 3321]]);
    r = sn([-20, -9990], { tolMm: 10 }); assert.strictEqual(r.p[0] + 0, 0, '-0 을 내지 않는다'); assert.ok(!Object.is(r.p[0], -0));
    assert.notStrictEqual(sn([-75 + 101, -75], { tolMm: 100 }).kind, 'end', '허용 거리 밖은 끝점 아님'); assert.strictEqual(sn([-75 + 100, -75], { tolMm: 100 }).kind, 'end', '정확히 경계는 안');
    assert.strictEqual(sn([3010, 8010], { tolMm: 50 }).kind, 'end', '보조선 끝점'); nearPt(sn([1510, 8020], { tolMm: 50 }).p, [1500, 8000]);
    const curved = cf(d).walls.find((w) => w.id === 'W12'), mid = G.wallPointAt(curved, 0.5).p; nearPt(sn([mid[0] + 5, mid[1] + 5], { tolMm: 30 }).p, mid, 1e-6, '곡선벽 중점은 호의 점');
    assert.deepStrictEqual(G.snapPoint(d, [10, 10], { tolMm: 5 }).p, [0, 0], '기본 격자 50mm 가 아니라 10 → 0');
    { // 짧은 벽: 끝점·중점이 모두 허용 안일 때 중점이 더 가까워도 끝점이 이긴다
      const sh = new S.Store(); sh.exec({ type: 'addWall', a: [10000, 0], b: [10100, 0] });
      const q = G.snapPoint(sh.doc, [10040, 5], { tolMm: 100 }); assert.deepStrictEqual([q.kind, q.p], ['end', [10000, 0]]);
      assert.deepStrictEqual(G.snapPoint(sh.doc, [10060, 5], { tolMm: 100 }).p, [10100, 0]); assert.strictEqual(G.snapPoint(sh.doc, [10055, 5], { tolMm: 100 }).kind, 'end', '둘 다 안이면 가까운 끝점');
      assert.deepStrictEqual(G.snapPoint(sh.doc, [10050, 5], { tolMm: 40 }).kind, 'mid', '끝점이 허용 밖이면 중점');
    }

    const ht = (p, tol = 0) => G.hitTest(d, p, tol);
    assert.deepStrictEqual(ht([2500, 2800]), { kind: 'room', id: 'R1' }); assert.deepStrictEqual(ht([6500, 500]), { kind: 'room', id: 'R2' });
    assert.deepStrictEqual(ht([500, -75]), { kind: 'wall', id: 'W1' }, '벽 위'); assert.deepStrictEqual(ht([500, -75 + 74]), { kind: 'wall', id: 'W1' }); assert.strictEqual(ht([500, -75 - 76]), null, '두께 밖');
    assert.deepStrictEqual(ht([500, -75 - 140], 50), null); assert.deepStrictEqual(ht([500, -75 - 140], 70), { kind: 'wall', id: 'W1' }, '허용 거리 안이면 벽');
    assert.deepStrictEqual(ht([2500, -75]), { kind: 'opening', id: 'O1' }, '창 위'); assert.deepStrictEqual(ht([2500 + 700, -75]), { kind: 'wall', id: 'W1' }, '창 옆은 벽');
    assert.deepStrictEqual(ht([4500, 3500]), { kind: 'column', id: 'C1' }); assert.deepStrictEqual(ht([1000 + 190, 3500]), { kind: 'column', id: 'C2' }); assert.deepStrictEqual(ht([1000 + 190, 3500 + 190]), { kind: 'room', id: 'R1' }, '원 밖 모서리');
    assert.deepStrictEqual(ht([2500, 1500]), { kind: 'item', id: 'I1' }, '에어컨이 방보다 우선'); // I1: 1001×500, rot 90 → 세로로 긴 모양
    assert.deepStrictEqual(ht([2500, 1500 + 480]), { kind: 'item', id: 'I1' }); assert.deepStrictEqual(ht([2500 + 270, 1500]), { kind: 'room', id: 'R1' }, '짧은 변 방향 밖');
    assert.deepStrictEqual(ht([1500, 8000]), { kind: 'guide', id: 'G1' }, '보조선은 허용 거리 0 에선 선 위만'); assert.strictEqual(ht([1500, 8040]), null); assert.deepStrictEqual(ht([1500, 8040], 50), { kind: 'guide', id: 'G1' });
    assert.strictEqual(ht([20000, 20000]), null);
    assert.deepStrictEqual(G.hitTest(d, [4500, 3500 - 100], 0), { kind: 'column', id: 'C1' }, '회전한 사각 기둥 안');
    const nw = G.nearestWall(d, [2000, -60], 20); assert.strictEqual(nw.wall.id, 'W1'); near(nw.at, (2000 + 75) / 5150, 1e-9); assert.strictEqual(G.nearestWall(d, [2000, 2000], 20), null);

    const b = G.bounds(d); assert.ok(b.x0 === -150 && b.y0 === -150 && b.y1 === 8000 && b.x1 === 9150, J(b)); // 벽 바깥 면까지
    assert.strictEqual(G.bounds(M.createDoc()), null);
    const only = new S.Store(); only.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000] }); assert.deepStrictEqual(G.bounds(only.doc), { x0: -150, y0: -150, x1: 5150, y1: 4150 });
  }

  /* ===== 4. history ===== */
  {
    const h = new H.History(3);
    assert.ok(!h.canUndo && !h.canRedo && h.undo() === null && h.redo() === null);
    const base = h.top; h.push('a'); h.push('b'); assert.ok(h.canUndo && !h.canRedo && h.top === 'b');
    assert.strictEqual(h.undo(), 'b'); assert.ok(h.canRedo && h.top === 'a'); assert.strictEqual(h.redo(), 'b');
    h.undo(); h.push('c'); assert.ok(!h.canRedo, '새 작업이 다시 실행 꼬리를 버린다'); assert.deepStrictEqual(h.stack, ['a', 'c']);
    h.push('d'); h.push('e'); assert.deepStrictEqual(h.stack, ['c', 'd', 'e'], '한도(3) 넘으면 가장 오래된 것부터'); h.undo(); h.undo(); h.undo(); assert.ok(!h.canUndo && h.top !== base, '잘린 뒤 처음 상태는 다른 표식');
    h.clear(); assert.ok(!h.canUndo && !h.canRedo);
  }

  /* ===== 5. store: 명령 하나하나 ===== */
  { // 방 만들기
    const s = new S.Store();
    assert.deepStrictEqual(s.exec({ type: 'addRoomRect', a: [5000, 4000], b: [0, 0] }), ['R1', 'W1', 'W2', 'W3', 'W4'], '모서리 순서와 무관하게 [방 id, 벽 id…]');
    const f = cf(s.doc), r = f.rooms[0];
    assert.deepStrictEqual(r, { id: 'R1', name: '방 1', poly: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], wallIds: ['W1', 'W2', 'W3', 'W4'] });
    assert.deepStrictEqual(f.walls.map((w) => [w.a, w.b]), [[[-75, -75], [5075, -75]], [[5075, -75], [5075, 4075]], [[5075, 4075], [-75, 4075]], [[-75, 4075], [-75, -75]]], '벽 중심선은 안쪽 면에서 t/2 바깥');
    assert.ok(f.walls.every((w) => w.t === 150 && w.kind === 'inner' && w.bulge === 0));
    assert.ok(G.signedArea(r.poly) > 0, '방 다각형은 시계방향');
    s.exec({ type: 'addRoomPoly', poly: [[0, 5000], [0, 7000], [3000, 7000], [3000, 5000], [0, 5000]] }); // 반시계 + 닫는 점 반복
    const r2 = cf(s.doc).rooms[1]; assert.strictEqual(r2.poly.length, 4); assert.ok(G.signedArea(r2.poly) > 0); assert.strictEqual(r2.name, '방 2');
    assert.deepStrictEqual(G.roomInnerPoly(r2.wallIds.map((i) => cf(s.doc).walls.find((w) => w.id === i)), r2.poly), r2.poly, '벽에서 다시 구한 방이 같다');
    const before = s.doc;
    throwsKo(() => s.exec({ type: 'addRoomPoly', poly: [[0, 0], [4000, 4000], [4000, 0], [0, 4000]] }), /겹칩/, '나비 모양');
    throwsKo(() => s.exec({ type: 'addRoomRect', a: [0, 0], b: [0, 4000] }), /점이 3개|넓이/, '폭 0'); throwsKo(() => s.exec({ type: 'addRoomPoly', poly: [[0, 0], [1000, 0]] }), /3개/); throwsKo(() => s.exec({ type: 'addRoomRect', a: [0, 0] }), /점/);
    assert.strictEqual(s.doc, before, '실패한 명령은 문서를 건드리지 않는다');
  }
  { // 벽·기둥·개구부·보조선·제품
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000] });
    assert.deepStrictEqual(s.exec({ type: 'addWall', a: [0, 5000], b: [1000, 5000] }), ['W5']); assert.deepStrictEqual(cf(s.doc).walls[4], { id: 'W5', a: [0, 5000], b: [1000, 5000], t: 150, kind: 'inner', bulge: 0 });
    throwsKo(() => s.exec({ type: 'addWall', a: [0, 0], b: [0, 0] }), /짧/); throwsKo(() => s.exec({ type: 'addWall', a: [0] }), /점/); throwsKo(() => s.exec({ type: 'addWall', a: [0, 0], b: [100, 0], t: -5 }), /두께/);
    s.exec({ type: 'addColumn', kind: 'round', c: [10, 10] }); s.exec({ type: 'addColumn', kind: 'rect', c: [20, 20], w: 500, d: 200, rot: 45 });
    assert.deepStrictEqual(cf(s.doc).columns, [{ id: 'C1', kind: 'round', c: [10, 10], w: 300, d: 300, rot: 0 }, { id: 'C2', kind: 'rect', c: [20, 20], w: 500, d: 200, rot: 45 }]);
    throwsKo(() => s.exec({ type: 'addColumn', kind: 'tri', c: [0, 0] }), /기둥/);
    s.exec({ type: 'addOpening', wall: 'W1', at: 0.25, kind: 'door' }); s.exec({ type: 'addOpening', wall: 'W1', at: 0.75, kind: 'window' }); s.exec({ type: 'addOpening', wall: 'W2', at: 0.5, kind: 'open' });
    assert.deepStrictEqual(cf(s.doc).openings.map((o) => [o.type, o.width, o.height, o.sill]), [['door', 900, 2100, 0], ['window', 1200, 1200, 900], ['open', 900, 2100, 0]], '종류별 기본 크기');
    s.exec({ type: 'addOpening', wall: 'W3', at: 0, kind: 'door' }); near(cf(s.doc).openings[3].at, 450 / 5150, 1e-12, '벽 끝에 붙이면 벽 안으로 당겨진다');
    s.exec({ type: 'addOpening', wall: 'W3', at: 5, kind: 'window' }); near(cf(s.doc).openings[4].at, 1 - 600 / 5150, 1e-12);
    throwsKo(() => s.exec({ type: 'addOpening', wall: 'W1', at: 0.26, kind: 'window' }), /이미/, '겹침'); throwsKo(() => s.exec({ type: 'addOpening', wall: 'W9', at: 0.5, kind: 'door' }), /벽/); throwsKo(() => s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door', width: 9000 }), /벽보다/); throwsKo(() => s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'gate' }), /종류/);
    s.exec({ type: 'addGuide', a: [0, 0], b: [10, 0] }); throwsKo(() => s.exec({ type: 'addGuide', a: [0, 0], b: [0, 0] }), /보조선/);
    s.exec({ type: 'addItem', kind: 'ac', model: 'mini4way', brand: 'lg', c: [1, 2], size: [570, 570] });
    assert.deepStrictEqual(cf(s.doc).items[0], { id: 'I1', kind: 'ac', model: 'mini4way', brand: 'lg', c: [1, 2], rot: 0, capacityKw: null, code: '', size: [570, 570] });
    throwsKo(() => s.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'lg', c: [0, 0] }), /크기/, '크기를 지어내지 않는다'); throwsKo(() => s.exec({ type: 'addItem', kind: 'ac', model: 'x', brand: 'lg', c: [0, 0], size: [1, 1] }), /형식/); throwsKo(() => s.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'x', c: [0, 0], size: [1, 1] }), /브랜드/);
    throwsKo(() => s.exec({ type: 'nope' }), /알 수 없는/); throwsKo(() => s.exec(null), /알 수 없는/);
  }
  { // 삭제 연쇄
    const s = fixture(), n0 = (col) => cf(s.doc)[col].length;
    assert.deepStrictEqual(s.exec({ type: 'remove', ids: ['Z9'] }), [], '없는 id 는 조용히 무시'); const u0 = s.canUndo;
    const got = s.exec({ type: 'remove', ids: ['W4'] }); // 벽 하나 → 그 벽의 문, 그 벽이 든 방(R1)이 지워지고 나머지 벽은 남는다
    assert.deepStrictEqual(got.sort(), ['O2', 'R1', 'W4']); assert.ok(!cf(s.doc).rooms.some((r) => r.id === 'R1') && ['W1', 'W2', 'W3'].every((i) => cf(s.doc).walls.some((w) => w.id === i)) && !cf(s.doc).openings.some((o) => o.id === 'O2'));
    s.undo();
    const g2 = s.exec({ type: 'remove', ids: ['R1'] }); // 방 → 그 방의 벽 넷과 창까지
    assert.deepStrictEqual(g2.sort(), ['O1', 'O2', 'R1', 'W1', 'W2', 'W3', 'W4']); assert.strictEqual(n0('rooms'), 1); assert.ok(cf(s.doc).walls.every((w) => !['W1', 'W2', 'W3', 'W4'].includes(w.id)));
    s.exec({ type: 'remove', ids: ['O3', 'C1', 'G1', 'I1'] }); assert.ok(!cf(s.doc).openings.some((o) => o.id === 'O3') && cf(s.doc).columns.length === 1 && !cf(s.doc).guides.length && cf(s.doc).items.length === 1);
    s.exec({ type: 'remove', ids: ['W11'] }); assert.ok(!cf(s.doc).walls.some((w) => w.id === 'W11') && cf(s.doc).openings.length === 0 && cf(s.doc).rooms.length === 1, '자유 벽을 지우면 방은 그대로');
    throwsKo(() => s.exec({ type: 'remove' }), /id/);
  }
  { // update
    const s = fixture(); const r1 = () => cf(s.doc).rooms.find((r) => r.id === 'R1');
    s.exec({ type: 'update', id: 'R1', patch: { name: '안방' } }); assert.strictEqual(r1().name, '안방');
    const u = s.canUndo; assert.deepStrictEqual(s.exec({ type: 'update', id: 'R1', patch: { name: '안방' } }), [], '같은 값이면 변화 없음'); const dd = s.doc; s.exec({ type: 'update', id: 'R1', patch: { name: '안방' } }); assert.strictEqual(s.doc, dd);
    s.exec({ type: 'update', id: 'W3', patch: { b: [-75, 3875] } }); // 아래 벽 끝점을 200 올린다 → 방 아래·왼쪽 모서리가 따라온다
    assert.ok(Math.abs(G.polyArea(r1().poly) - 5000 * 4000) > 1, '방이 벽을 따라 다시 맞춰진다');
    s.undo(); s.exec({ type: 'update', id: 'W1', patch: { t: 300 } }); assert.deepStrictEqual(r1().poly, [[0, 75], [5000, 75], [5000, 4000], [0, 4000]], '위 벽 두께 300 → 안쪽 면 75');
    s.exec({ type: 'update', id: 'W1', patch: { kind: 'exterior' } }); assert.deepStrictEqual(r1().poly, [[0, 75], [5000, 75], [5000, 4000], [0, 4000]], '두께·좌표가 안 바뀌면 방을 다시 계산하지 않는다');
    s.exec({ type: 'update', id: 'O1', patch: { at: 0.99 } }); near(cf(s.doc).openings[0].at, 1 - 600 / 5150, 1e-12, '개구부 수정도 벽 안으로');
    s.exec({ type: 'update', id: 'I1', patch: { capacityKw: 7.2, code: 'X' } }); assert.strictEqual(cf(s.doc).items[0].capacityKw, 7.2);
    const keep = s.doc;
    throwsKo(() => s.exec({ type: 'update', id: 'W2', patch: { t: -5 } }), /두께/); throwsKo(() => s.exec({ type: 'update', id: 'W2', patch: { id: 'W99' } }), /수정/); throwsKo(() => s.exec({ type: 'update', id: 'Q1', patch: { t: 1 } }), /찾을 수 없/); throwsKo(() => s.exec({ type: 'update', id: 'W2' }), /수정/);
    throwsKo(() => s.exec({ type: 'update', id: 'I1', patch: { size: [0, 0] } }), /크기/);
    assert.strictEqual(s.doc, keep, '실패한 수정은 문서를 안 바꾼다');
    const aliased = [10, 20]; s.exec({ type: 'update', id: 'G1', patch: { a: aliased } }); aliased[0] = 999; assert.strictEqual(cf(s.doc).guides[0].a[0], 10, '명령 인자와 문서는 서로 별개(복사)');
  }
  { // move
    const s = fixture(), w = (id) => cf(s.doc).walls.find((x) => x.id === id), room = (id) => cf(s.doc).rooms.find((x) => x.id === id);
    s.exec({ type: 'move', ids: ['R2'], dx: 100, dy: -200 });
    assert.deepStrictEqual(room('R2').poly[0], [6100, -200]); assert.deepStrictEqual(w('W5').a, [5925 + 100, -75 - 200]); assert.deepStrictEqual(room('R1').poly[0], [0, 0], '다른 방은 그대로');
    assert.deepStrictEqual(G.roomInnerPoly(room('R2').wallIds.map(w), room('R2').poly), room('R2').poly, '방과 벽이 함께 움직여 서로 맞는다');
    s.exec({ type: 'move', ids: ['W1'], dx: 0, dy: -50 }); assert.deepStrictEqual(w('W1').a, [-75, -125]); assert.strictEqual(room('R1').poly[0][1], -50, '벽만 움직이면 방이 따라 맞춰진다 (안쪽 면 -125+75)');
    s.exec({ type: 'move', ids: ['I1', 'C1', 'G1'], dx: 10, dy: 10 }); assert.deepStrictEqual(cf(s.doc).items[0].c, [2510, 1510]); assert.deepStrictEqual(cf(s.doc).columns[0].c, [4510, 3510]); assert.deepStrictEqual(cf(s.doc).guides[0].b, [3010, 8010]);
    assert.deepStrictEqual(s.exec({ type: 'move', ids: ['I1'], dx: 0, dy: 0 }), [], '0 이동은 변화 없음'); assert.deepStrictEqual(s.exec({ type: 'move', ids: ['Z1'], dx: 5, dy: 5 }), []);
    assert.strictEqual(w('W12').a[0], 4000, '건드리지 않은 벽'); throwsKo(() => s.exec({ type: 'move', ids: ['I1'], dx: 'a', dy: 1 }), /거리/);
  }
  { // 문 경첩 쪽(hinge)·열리는 쪽(swing): update 로 바꾸고, 잘못된 값은 거절하며, 거울 반전은 경첩 쪽도 뒤집는다(두 번이면 그대로)
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000] });
    const [door] = s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' }), [win] = s.exec({ type: 'addOpening', wall: 'W3', at: 0.5, kind: 'window' }), op = (id) => cf(s.doc).openings.find((o) => o.id === id);
    assert.ok(!('hinge' in op(door)) && !('swing' in op(door)), '기본은 키가 없다(a · +법선)');
    s.exec({ type: 'update', id: door, patch: { hinge: 'b' } }); assert.strictEqual(op(door).hinge, 'b'); s.exec({ type: 'update', id: door, patch: { swing: -1 } }); assert.strictEqual(op(door).swing, -1);
    assert.deepStrictEqual(M.validateDoc(s.doc), []); s.undo(); s.undo(); assert.ok(!('hinge' in op(door)) && !('swing' in op(door)), '되돌리기');
    for (const patch of [{ hinge: 'c' }, { hinge: 1 }, { swing: 0 }, { swing: 'x' }, { swing: 2 }]) { const d = M.cloneDoc(s.doc); Object.assign(cf(d).openings.find((o) => o.id === door), patch); assert.ok(M.validateDoc(d).some((m) => /경첩|열리는 쪽/.test(m)), '거절: ' + JSON.stringify(patch)); }
    const orig = JSON.stringify(s.doc); s.exec({ type: 'mirror', axis: 'x' }); assert.strictEqual(op(door).hinge, 'b', '반전하면 경첩이 반대 문틀로'); assert.ok(!('hinge' in op(win)), '창에는 경첩이 생기지 않는다');
    s.exec({ type: 'mirror', axis: 'x' }); assert.strictEqual(JSON.stringify(s.doc), orig, '두 번 반전하면 그대로(기본 a 는 키 없음)');
    s.exec({ type: 'update', id: door, patch: { hinge: 'b', swing: -1 } }); s.exec({ type: 'mirror', axis: 'y' }); assert.deepStrictEqual([op(door).hinge, op(door).swing], [undefined, -1], 'b → a(키 없음) · 열리는 쪽은 그대로');
  }
  { // mirror · rotate
    const s = fixture(), orig = J(s.doc), b0 = G.bounds(s.doc), sx = b0.x0 + b0.x1, sy = b0.y0 + b0.y1;
    s.exec({ type: 'mirror', axis: 'x' }); const f = cf(s.doc);
    assert.deepStrictEqual([f.walls[0].a, f.walls[0].b], [[sx - 5075, -75], [sx - -75, -75]], 'x → 경계 상자 중심 기준 뒤집힘 + 벽 a↔b 교환(문 열림 방향 유지)'); assert.deepStrictEqual(G.bounds(s.doc), b0, '경계 상자는 그대로');
    assert.ok(f.rooms.every((r) => G.signedArea(r.poly) > 0), '반전 뒤에도 방 다각형은 시계방향');
    assert.deepStrictEqual(f.rooms[0].wallIds, ['W3', 'W2', 'W1', 'W4'], '변 i ↔ wallIds[i] 를 지키려 벽 순서도 바뀐다');
    assert.deepStrictEqual(f.rooms.map((r) => G.roomInnerPoly(r.wallIds.map((i) => f.walls.find((w) => w.id === i)), r.poly)), f.rooms.map((r) => r.poly), '반전한 방 모두: 변 i 의 벽이 실제 그 변 옆에 있다');
    { const w12 = cf(JSON.parse(orig)).walls.find((w) => w.id === 'W12'), m12 = f.walls.find((w) => w.id === 'W12'); // 곡선벽은 호 중점이 거울상 자리에 있다(a↔b 를 바꾸면 처짐 부호는 그대로)
      assert.strictEqual(m12.bulge, 300); nearPt(G.wallPointAt(m12, 0.5).p, [sx - G.wallPointAt(w12, 0.5).p[0], G.wallPointAt(w12, 0.5).p[1]], 1e-6, '곡선벽 호 중점 = 거울상'); }
    assert.strictEqual(f.items[0].rot, 180 - 90); assert.strictEqual(f.items[1].rot, 165); assert.strictEqual(f.columns[0].rot, 150);
    assert.deepStrictEqual(f.openings[0], cf(M.cloneDoc(JSON.parse(orig))).openings[0], '개구부는 벽 기준이라 그대로');
    s.exec({ type: 'update', id: 'W1', patch: { t: 300 } }); // 반전 뒤에 벽을 고쳐도 방이 올바른 쪽으로 줄어든다
    near(G.polyArea(cf(s.doc).rooms[0].poly), 5000 * 3925, 1e-6); s.undo();
    s.exec({ type: 'mirror', axis: 'x' }); assert.strictEqual(J(s.doc), orig, '좌우 반전 두 번 = 원래');
    s.exec({ type: 'mirror', axis: 'y' }); assert.deepStrictEqual(cf(s.doc).walls[0].a, [5075, sy - -75], 'y 반전: 벽 a↔b 교환'); assert.strictEqual(cf(s.doc).items[0].rot, -90); assert.deepStrictEqual(G.bounds(s.doc), b0);
    s.exec({ type: 'mirror', axis: 'y' }); assert.strictEqual(J(s.doc), orig, '상하 반전 두 번 = 원래');
    // 회전: 시계방향 90°
    const cx = (b0.x0 + b0.x1) / 2, cy = (b0.y0 + b0.y1) / 2; s.exec({ type: 'rotate', deg: 90 });
    assert.deepStrictEqual(cf(s.doc).walls[0].a, [cx + cy + 75, cy - cx - 75], '(x,y) → (cx+cy-y, cy-cx+x)'); assert.strictEqual(cf(s.doc).items[0].rot, 180); assert.strictEqual(cf(s.doc).walls.find((w) => w.id === 'W12').bulge, 300, '회전은 처짐 방향을 안 바꾼다');
    const b1 = G.bounds(s.doc); near(b1.x1 - b1.x0, b0.y1 - b0.y0, 1e-9); near(b1.y1 - b1.y0, b0.x1 - b0.x0, 1e-9); near((b1.x0 + b1.x1) / 2, cx, 1e-9); near((b1.y0 + b1.y1) / 2, cy, 1e-9);
    assert.ok(cf(s.doc).rooms.every((r) => G.signedArea(r.poly) > 0)); near(G.polyArea(cf(s.doc).rooms[0].poly), 20e6, 1e-3);
    s.exec({ type: 'rotate', deg: -90 }); assert.strictEqual(J(s.doc), orig, '시계 → 반시계 = 원래');
    for (let i = 0; i < 4; i++) s.exec({ type: 'rotate', deg: 90 }); assert.deepStrictEqual(cf(s.doc).walls.map((w) => [w.a, w.b]), cf(JSON.parse(orig)).walls.map((w) => [w.a, w.b]), '90° 네 번 = 한 바퀴');
    throwsKo(() => s.exec({ type: 'rotate', deg: 45 }), /90/); throwsKo(() => s.exec({ type: 'mirror', axis: 'z' }), /axis/);
    const empty = new S.Store(); assert.deepStrictEqual(empty.exec({ type: 'mirror', axis: 'x' }), [], '빈 층은 변화 없음');
  }
  { // 층·밑그림·제목·불러오기
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [3000, 3000] });
    s.exec({ type: 'setFloor', patch: { heightMm: 2400, slabMm: 200, name: '1층', finish: { wall: '화이트' } } }); s.exec({ type: 'setFloor', patch: { finish: { floor: '강마루' } } });
    assert.deepStrictEqual([cf(s.doc).heightMm, cf(s.doc).slabMm, cf(s.doc).name, cf(s.doc).finish], [2400, 200, '1층', { wall: '화이트', floor: '강마루' }], '마감은 합쳐진다');
    throwsKo(() => s.exec({ type: 'setFloor', patch: { heightMm: 0 } }), /높이/); throwsKo(() => s.exec({ type: 'setFloor', patch: { slabMm: -1 } }), /슬래브/); throwsKo(() => s.exec({ type: 'setFloor' }), /층 설정/);
    assert.deepStrictEqual(s.exec({ type: 'setFloor', patch: { heightMm: 2400 } }), []);
    assert.deepStrictEqual(s.exec({ type: 'addFloor' }), ['F2']); assert.strictEqual(s.doc.cur, 1); assert.deepStrictEqual([cf(s.doc).id, cf(s.doc).name, cf(s.doc).heightMm, cf(s.doc).slabMm, cf(s.doc).walls.length], ['F2', 'Floor 2', 2400, 200, 0], '새 층은 비어 있고 높이는 이어받는다');
    s.exec({ type: 'addWall', a: [0, 0], b: [1000, 0] }); assert.strictEqual(cf(s.doc).walls[0].id, 'W5', '벽 번호는 문서 전체에서 이어진다'); assert.strictEqual(s.doc.floors[0].walls.length, 4, '다른 층은 안 건드린다');
    const u = s.canUndo; assert.deepStrictEqual(s.exec({ type: 'setCur', index: 0 }), ['F1']); assert.strictEqual(s.doc.cur, 0); assert.ok(s.canUndo === u, 'setCur 은 undo 단계가 아니다');
    s.markSaved(); s.exec({ type: 'setCur', index: 1 }); assert.ok(!s.dirty, '층 보기를 바꿔도 저장할 변경이 아니다');
    throwsKo(() => s.exec({ type: 'setCur', index: 2 }), /없는 층/); throwsKo(() => s.exec({ type: 'setCur', index: 0.5 }), /없는 층/); assert.deepStrictEqual(s.exec({ type: 'setCur', index: 1 }), []);
    s.exec({ type: 'setUnderlay', underlay: { name: 'p.png', src: 'data:image/png;base64,AAAA', mmPerPx: 2.5 } }); assert.deepStrictEqual(s.doc.underlay, { name: 'p.png', src: 'data:image/png;base64,AAAA', x: 0, y: 0, mmPerPx: 2.5, rot: 0, opacity: 0.5 });
    throwsKo(() => s.exec({ type: 'setUnderlay', underlay: { name: 'p', src: 'x', mmPerPx: 0 } }), /밑그림/); throwsKo(() => s.exec({ type: 'setUnderlay', underlay: { name: 'p', src: 'x', mmPerPx: 1, opacity: 3 } }), /밑그림/);
    s.exec({ type: 'setUnderlay', underlay: null }); assert.strictEqual(s.doc.underlay, null); assert.deepStrictEqual(s.exec({ type: 'setUnderlay', underlay: null }), []);
    s.exec({ type: 'rename', title: '우리 집' }); assert.strictEqual(s.doc.title, '우리 집'); throwsKo(() => s.exec({ type: 'rename', title: 5 }), /제목/);
    const other = fixture().doc; s.exec({ type: 'load', doc: other }); assert.strictEqual(J(s.doc), J(M.fixSeq(other))); throwsKo(() => s.exec({ type: 'load', doc: { v: 2 } }), /읽지 못/);
    s.undo(); assert.strictEqual(s.doc.title, '우리 집', 'load 도 undo 된다');
  }

  /* ===== 6. store: undo/redo 전수 · 묶음 · 이벤트 · 저장 상태 ===== */
  {
    const s = new S.Store(), snaps = [J(s.doc)], undoable = [];
    const steps = [
      { type: 'rename', title: '전수' }, { type: 'setFloor', patch: { heightMm: 2500, slabMm: 150, name: 'A', finish: { wall: 'w', floor: 'f' } } },
      { type: 'addRoomRect', a: [0, 0], b: [5000, 4000], name: '거실' }, { type: 'addRoomPoly', poly: [[6000, 0], [9000, 0], [9000, 1000], [7000, 1000], [7000, 3000], [6000, 3000]] },
      { type: 'addWall', a: [0, 6000], b: [3000, 6000], bulge: -200, kind: 'exterior' }, { type: 'addColumn', kind: 'rect', c: [4500, 3500], w: 300, d: 400, rot: 30 }, { type: 'addColumn', kind: 'round', c: [1000, 3500] },
      { type: 'addOpening', wall: 'W1', at: 0.5, kind: 'window' }, { type: 'addOpening', wall: 'W4', at: 0.5, kind: 'door' }, { type: 'addOpening', wall: 'W11', at: 0.5, kind: 'open' },
      { type: 'addGuide', a: [0, 8000], b: [3000, 8000] }, { type: 'addItem', kind: 'ac', model: '1way', brand: 'samsung', c: [2500, 1500], rot: 90, capacityKw: 5.2, code: 'AJ052', size: [1001, 500] },
      { type: 'update', id: 'W2', patch: { t: 200, kind: 'exterior' } }, { type: 'update', id: 'O1', patch: { at: 0.3, sill: 1000 } }, { type: 'update', id: 'R2', patch: { name: '서재' } },
      { type: 'move', ids: ['R2'], dx: 500, dy: 500 }, { type: 'move', ids: ['W3', 'I1', 'C1', 'G1'], dx: -10, dy: 20 },
      { type: 'mirror', axis: 'x' }, { type: 'mirror', axis: 'y' }, { type: 'rotate', deg: 90 }, { type: 'rotate', deg: -90 },
      { type: 'setUnderlay', underlay: { name: 'u.png', src: 'data:,x', mmPerPx: 3, x: 5, y: 6, rot: 7, opacity: 0.4 } }, { type: 'setUnderlay', underlay: null },
      { type: 'remove', ids: ['O3', 'C2', 'G1', 'I1'] }, { type: 'remove', ids: ['W4'] }, { type: 'remove', ids: ['R2'] },
      { type: 'addFloor' }, { type: 'addRoomRect', a: [0, 0], b: [2000, 2000] }, { type: 'setFloor', patch: { name: 'B' } },
      { type: 'load', doc: fixture().doc },
    ];
    const seen = new Set(steps.map((x) => x.type)); for (const t of ['addWall', 'addRoomRect', 'addRoomPoly', 'addColumn', 'addOpening', 'addGuide', 'addItem', 'remove', 'update', 'move', 'mirror', 'rotate', 'setFloor', 'addFloor', 'setUnderlay', 'rename', 'load']) assert.ok(seen.has(t), '전수 목록에 ' + t);
    for (const st of steps) {
      const before = J(s.doc), jb = s.doc;
      s.exec(st); const after = J(s.doc);
      assert.notStrictEqual(after, before, st.type + ' 은 문서를 바꿔야 한다'); assert.strictEqual(J(jb), before, st.type + ' 가 이전 문서를 제자리 수정하면 안 된다');
      snaps.push(after); undoable.push(st.type);
    }
    assert.strictEqual(snaps.length, steps.length + 1);
    for (let i = steps.length; i > 0; i--) { assert.ok(s.undo(), 'undo ' + steps[i - 1].type); assert.strictEqual(J(s.doc), snaps[i - 1], 'undo 가 ' + steps[i - 1].type + ' 을 정확히 되돌린다'); }
    assert.ok(!s.canUndo && !s.undo()); assert.strictEqual(J(s.doc), snaps[0]);
    for (let i = 1; i <= steps.length; i++) { assert.ok(s.redo()); assert.strictEqual(J(s.doc), snaps[i], 'redo ' + steps[i - 1].type); }
    assert.ok(!s.canRedo && !s.redo());
    for (let i = steps.length; i > 0; i--) s.undo();
    s.exec({ type: 'rename', title: '새 갈래' }); assert.ok(!s.canRedo, '되돌린 뒤 새 작업은 다시 실행을 지운다');
  }
  { // 무작위 명령열(실패하는 명령 포함) — 실패는 문서 불변, 끝까지 undo/redo 가 정확하고 문서는 늘 유효
    let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296, ri = (n) => Math.floor(rnd() * n), pick = (a) => a[ri(a.length)];
    const s = new S.Store(), log = []; let applied = 0, rejected = 0; // log = undo 단계마다 {명령 직전, 직후} 문서
    const ids = () => { const f = cf(s.doc); return ['walls', 'rooms', 'columns', 'openings', 'guides', 'items'].flatMap((c) => f[c].map((e) => e.id)).concat(['Z9']); };
    const pt = () => [ri(20) * 500, ri(20) * 500], wallIds = () => cf(s.doc).walls.map((w) => w.id).concat(['W99']);
    const gen = () => pick([
      () => ({ type: 'addRoomRect', a: pt(), b: pt() }), () => ({ type: 'addWall', a: pt(), b: pt(), bulge: pick([0, 0, 200, -300]) }), () => ({ type: 'addColumn', kind: pick(['rect', 'round']), c: pt() }),
      () => ({ type: 'addOpening', wall: pick(wallIds()), at: rnd(), kind: pick(['door', 'window', 'open']) }), () => ({ type: 'addGuide', a: pt(), b: pt() }),
      () => ({ type: 'addItem', kind: 'ac', model: pick(M.MODELS), brand: pick(M.BRANDS), c: pt(), rot: pick([0, 90, 33]), size: [800, 800] }),
      () => ({ type: 'remove', ids: [pick(ids()), pick(ids())] }), () => ({ type: 'move', ids: [pick(ids()), pick(ids())], dx: ri(5) * 50, dy: ri(3) * 50 }),
      () => ({ type: 'update', id: pick(ids()), patch: pick([{ t: 100 + ri(4) * 50 }, { name: 'n' + ri(9) }, { rot: ri(4) * 90 }, { at: rnd() }, { b: pt() }]) }),
      () => ({ type: 'mirror', axis: pick(['x', 'y']) }), () => ({ type: 'rotate', deg: pick([90, -90]) }), () => ({ type: 'addFloor' }), () => ({ type: 'setCur', index: ri(3) }),
      () => ({ type: 'setFloor', patch: { heightMm: 2000 + ri(5) * 100 } }), () => ({ type: 'addRoomPoly', poly: [pt(), pt(), pt(), pt()] }),
    ])();
    for (let i = 0; i < 400; i++) {
      const cmd = gen(), before = s.doc, jb = J(before);
      try { s.exec(cmd); } catch (e) { assert.ok(ko(e.message), '한국어 오류: ' + e.message); assert.strictEqual(s.doc, before, '실패 명령은 문서를 안 바꾼다'); rejected++; continue; }
      assert.strictEqual(J(before), jb, '이전 문서 불변'); assert.deepStrictEqual(M.validateDoc(s.doc), [], J(cmd)); applied++;
      if (cmd.type !== 'setCur' && s.doc !== before) log.push({ pre: jb, post: J(s.doc) }); // 문서가 바뀐 undo 단계만(setCur 은 단계가 아니다)
    }
    assert.ok(applied > 150 && rejected > 20, `무작위 명령열이 성공·실패를 모두 겪는다 (${applied}/${rejected})`);
    // undo 한도(200) 안에서 확인 — 층 보기(setCur)가 끼어 있어도 명령 직전 문서로 정확히 돌아간다
    const steps = Math.min(200, log.length);
    for (let i = 0; i < steps; i++) { assert.ok(s.undo()); assert.strictEqual(J(s.doc), log[log.length - 1 - i].pre, 'undo #' + i); }
    for (let i = steps - 1; i >= 0; i--) { assert.ok(s.redo()); assert.strictEqual(J(s.doc), log[log.length - 1 - i].post, 'redo #' + i); }
  }
  { // 불변 공유·얼림
    const s = fixture(), d1 = s.doc; s.exec({ type: 'addGuide', a: [0, 0], b: [50, 0] }); const d2 = s.doc;
    assert.strictEqual(d2.floors[0].walls[0], d1.floors[0].walls[0], '바뀌지 않은 요소 객체는 이전 문서와 공유(메모리 절약)'); assert.notStrictEqual(d2.floors[0].guides, d1.floors[0].guides);
    assert.ok(Object.isFrozen(d2) && Object.isFrozen(d2.floors[0].walls[0]) && Object.isFrozen(d2.floors[0].walls[0].a));
    assert.throws(() => { d2.floors[0].walls[0].t = 1; }, TypeError, '문서를 직접 고치면 즉시 오류'); assert.throws(() => d2.floors[0].walls.push({}), TypeError);
    const copy = M.cloneDoc(d2); copy.floors[0].walls[0].t = 7; assert.strictEqual(d2.floors[0].walls[0].t, 150, 'cloneDoc 은 얼지 않은 복사본');
    const src = M.createDoc(); const st = new S.Store(src); src.title = '밖에서 바꿈'; assert.notStrictEqual(st.doc.title, '밖에서 바꿈', '생성자는 넘겨받은 문서를 복사한다');
  }
  { // begin/commit/cancel
    const s = new S.Store(), jEmpty = J(s.doc); s.exec({ type: 'addRoomRect', a: [0, 0], b: [3000, 3000] }); const j0 = J(s.doc);
    s.begin('끝점 끌기'); for (let i = 1; i <= 5; i++) s.exec({ type: 'move', ids: ['W1'], dx: 10, dy: 0 });
    assert.ok(s.dirty && !s.canUndo && !s.undo(), '묶음 중엔 undo 못 한다'); s.commit();
    assert.strictEqual(cf(s.doc).walls[0].a[0], -75 + 50); assert.ok(s.undo()); assert.strictEqual(J(s.doc), j0, '드래그 한 번 = undo 한 번'); assert.ok(s.undo() && !s.canUndo && J(s.doc) === jEmpty, '그다음 undo 는 방 만들기 — 드래그 중간 단계가 쌓이지 않았다'); assert.ok(s.redo() && s.redo() && !s.canRedo);
    s.undo(); s.begin(); s.begin(); s.exec({ type: 'addGuide', a: [0, 0], b: [10, 0] }); s.commit(); assert.ok(!s.canUndo, '안쪽 commit 은 아직 닫지 않는다'); s.commit(); assert.ok(s.canUndo);
    s.undo(); const j1 = J(s.doc); s.begin(); s.exec({ type: 'move', ids: ['R1'], dx: 99, dy: 0 }); s.cancel(); assert.strictEqual(J(s.doc), j1, 'cancel 은 begin 때로'); assert.ok(!s.canUndo || s.canRedo !== undefined);
    const n = s.canRedo; s.begin(); s.commit(); assert.strictEqual(s.canRedo, n, '아무 변화 없는 묶음은 단계를 만들지 않는다');
    s.commit(); s.cancel();
  }
  { // 구독·저장 상태·replace·한도
    const s = new S.Store(), ev = [], off = s.subscribe((e) => ev.push(e));
    s.exec({ type: 'addRoomRect', a: [0, 0], b: [1000, 1000] }); s.exec({ type: 'addWall', a: [0, 0], b: [0, 500] }); s.undo(); s.redo(); s.begin(); s.exec({ type: 'move', ids: ['W5'], dx: 1, dy: 1 }); s.commit(); s.cancel();
    assert.deepStrictEqual(ev.map((e) => e.type), ['addRoomRect', 'addWall', 'undo', 'redo', 'move', 'commit']); assert.deepStrictEqual(ev[0].ids, ['R1', 'W1', 'W2', 'W3', 'W4']); assert.deepStrictEqual(ev[1].ids, ['W5']);
    const bad = s.subscribe(() => { throw new Error('구독자 오류'); }), origErr = console.error; console.error = () => {}; s.exec({ type: 'addGuide', a: [0, 0], b: [5, 0] }); console.error = origErr; bad(); assert.ok(cf(s.doc).guides.length === 1, '구독자가 던져도 저장소는 정상');
    off(); const n = ev.length; s.exec({ type: 'addGuide', a: [0, 0], b: [9, 0] }); assert.strictEqual(ev.length, n, 'unsubscribe');
    const t = new S.Store(); assert.ok(!t.dirty); t.exec({ type: 'addGuide', a: [0, 0], b: [10, 0] }); assert.ok(t.dirty); t.markSaved(); assert.ok(!t.dirty); t.exec({ type: 'addGuide', a: [0, 0], b: [20, 0] }); assert.ok(t.dirty); t.undo(); assert.ok(!t.dirty, '저장한 상태로 되돌리면 깨끗'); t.undo(); assert.ok(t.dirty); t.redo(); assert.ok(!t.dirty);
    t.undo(); t.exec({ type: 'addGuide', a: [0, 0], b: [30, 0] }); t.redo(); t.undo(); t.markSaved(); t.redo(); assert.ok(!t.canRedo);
    t.replace(fixture().doc); assert.ok(!t.dirty && !t.canUndo && !t.canRedo); assert.strictEqual(cf(t.doc).rooms.length, 2); assert.ok(t.subscribe, '');
    const rep = []; t.subscribe((e) => rep.push(e.type)); t.replace(M.createDoc('x')); assert.deepStrictEqual(rep, ['replace']);
    const keep = t.doc; throwsKo(() => t.replace({ v: 2 }), null, 'replace 검증'); assert.strictEqual(t.doc, keep); throwsKo(() => new S.Store({ v: 1 }), null, '생성자 검증');
    const lim = new S.Store(); lim.markSaved(); for (let i = 0; i < 205; i++) lim.exec({ type: 'addGuide', a: [i, 0], b: [i + 1000, 0] });
    let k = 0; while (lim.undo()) k++; assert.strictEqual(k, 200, 'undo 한도 200'); assert.strictEqual(cf(lim.doc).guides.length, 5); assert.ok(lim.dirty, '처음 상태로 돌아갈 수 없으면 저장된 상태와 다르다');
  }

  /* ===== 7. export ===== */
  const rich = fixture().doc;
  { // 문서 JSON 왕복과 깨진 입력
    assert.deepStrictEqual(X.fromDocJSON(X.toDocJSON(rich)), rich); assert.strictEqual(typeof X.toDocJSON(rich), 'string');
    const parsed = JSON.parse(X.toDocJSON(rich)); delete parsed.seq; const fixed = X.fromDocJSON(J(parsed)); assert.deepStrictEqual(fixed.seq, rich.seq, 'seq 가 없으면 id 에서 복구');
    const withUnder = M.cloneDoc(rich); delete withUnder.underlay; assert.strictEqual(X.fromDocJSON(J(withUnder)).underlay, null);
    const bad = (label, str, re) => { const e = throwsKo(() => X.fromDocJSON(str), /^도면 파일을 읽지 못했습니다$/, label); assert.ok(Array.isArray(e.problems) && e.problems.length && e.problems.every(ko), label + ' problems'); if (re) assert.ok(e.problems.some((m) => re.test(m)), label + ' ' + e.problems); };
    const mut = (fn) => { const d = JSON.parse(X.toDocJSON(rich)); fn(d); return J(d); };
    bad('빈 문자열', '', /JSON/); bad('쓰레기', 'abc{', /JSON/); bad('null', 'null'); bad('배열', '[]'); bad('빈 객체', '{}', /버전/); bad('숫자', '5');
    bad('다른 v', mut((d) => { d.v = 2; }), /버전/); bad('음수 두께', mut((d) => { d.floors[0].walls[0].t = -150; }), /두께/); bad('중복 id', mut((d) => { d.floors[0].walls[1].id = 'W1'; }), /중복/);
    bad('없는 벽 참조', mut((d) => { d.floors[0].openings[0].wall = 'W77'; }), /벽/); bad('좌표 null', mut((d) => { d.floors[0].walls[0].a = [null, 0]; }), /좌표/);
  }
  { // 엔진 공간 JSON: apartment.json 의 data.space 와 같은 키·타입
    const NULLOK = new Set(['ac_units[].rule_check.light_edge_gap_min_mm', 'outdoor_unit.position', 'outdoor_unit.size_mm']); // 값이 없으면 null(뷰어는 position 이 있으면 실외기 상자를 그린다)
    const cmp = (a, b, p) => {
      if (b === null && NULLOK.has(p)) return;
      if (Array.isArray(a)) { assert.ok(Array.isArray(b), p + ' 배열'); if (a.length && b.length) cmp(a[0], b[0], p + '[]'); return; }
      if (a && typeof a === 'object') { assert.ok(b && typeof b === 'object' && !Array.isArray(b), p + ' 객체'); assert.deepStrictEqual(Object.keys(b), Object.keys(a), p + ' 키 집합·순서'); for (const k of Object.keys(a)) cmp(a[k], b[k], p ? p + '.' + k : k); return; }
      if (a === null || (b === null && NULLOK.has(p))) return;
      assert.strictEqual(typeof b, typeof a, p + ' 타입');
    };
    const sp = X.toSpaceJSON(rich, 0); cmp(sample, sp, '');
    const six = [...JSON.stringify(sp).matchAll(/"(?:polygon|center|a|b|at|size_mm|interior_rect)":(\[[\d.,\-\[\]]*\])/g)].map((m) => JSON.parse(m[1]).flat(2)).flat(); assert.ok(six.length > 20 && six.every(Number.isInteger), '좌표·치수는 정수 mm');
    assert.strictEqual(sp.space_type, 'apartment'); assert.strictEqual(sp.input_kind, 'plan_editor'); assert.strictEqual(sp.title, '시험 도면'); assert.strictEqual(X.toSpaceJSON(rich, 0, { spaceType: 'cafe' }).space_type, 'cafe');
    assert.deepStrictEqual(sp.capacity_options_kw, sample.capacity_options_kw); assert.deepStrictEqual(sp.ac_rules, sample.ac_rules); assert.deepStrictEqual(sp.load_rule, { m2_per_pyeong: 3.3058, basis: '' }); assert.deepStrictEqual(sp.ceiling, { height_mm: 2300, void_mm: 300, grid: { module_x_mm: 600, module_y_mm: 600, origins: {} }, lights: [], basis: '' });
    assert.deepStrictEqual([sp.outdoor_unit.display_only, sp.outdoor_unit.sets, sp.outdoor_unit.position], [true, [], null]); assert.deepStrictEqual([sp.sources, sp.piping, sp.piping_branches, sp.views], [[], [], [], []]);
    assert.strictEqual(JSON.stringify(sp), JSON.stringify(JSON.parse(JSON.stringify(sp))), 'JSON 직렬화 가능(undefined·NaN 없음)');
    // 방 하나·창 하나·에어컨 하나 — 값
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000], name: '거실' }); s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'window' });
    s.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'samsung', c: [2500, 2000], rot: 90, capacityKw: 4, code: 'AJ040', size: [1000, 500] });
    const one = X.toSpaceJSON(s.doc);
    assert.deepStrictEqual(one.rooms, [{ id: 'R1', name_ko: '거실', polygon: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], area_m2: 20, ceiling_mm: 2300, floor_finish: '', finished_ceiling: true, basis: '' }]);
    assert.deepStrictEqual(one.walls[0], { id: 'W1', a: [-75, -75], b: [5075, -75], thickness: 150, exterior: false, kind: 'interior', basis: '' }); assert.strictEqual(one.walls.length, 4);
    assert.deepStrictEqual(one.openings, [{ id: 'O1', wall: 'W1', at: [2500, -75], width: 1200, sill: 900, room: 'R1', height: 1200, type: 'window', basis: '' }]);
    assert.deepStrictEqual(one.ac_units, [{ id: 'I1', zone: 'Z_R1', room: 'R1', model: '1way', size_mm: [1000, 500, 35], ceiling_opening_mm: [1000, 500], body_h_mm: 140, capacity_kw: 4, model_code: 'AJ040', center: [2500, 2000], rotation_deg: 90, mount_z_mm: 2300, locked: null, basis: '', rule_check: { wall_center_min_mm: 2000, wall_edge_min_mm: 1500, light_edge_gap_min_mm: null, grid_err_mm: [], grid_align: '' } }], '벽 면까지 2000, 회전한 제품 모서리까지 1500');
    assert.deepStrictEqual(one.zones, [{ id: 'Z_R1', room: 'R1', kind: 'room', name_ko: '거실', polygon: one.rooms[0].polygon, area_m2: 20, load_area_from: ['Z_R1'], load_multiplier: [], research_count: [], load_basis: '', research_row: '' }]);
    assert.deepStrictEqual(one.envelope, { interior_rect: [0, 0, 5000, 4000], area_m2: 20, target_pyeong: 6.05, tolerance_pyeong: 0.5, area_basis: '', all_rooms_m2: 20 }); assert.deepStrictEqual(one.labels, [{ text: '거실', at: [2500, 2000] }]);
    s.exec({ type: 'update', id: 'I1', patch: { model: 'mini4way', rot: -90 } }); assert.strictEqual(X.toSpaceJSON(s.doc).ac_units[0].model, 'mini_4way', '엔진 이름'); assert.strictEqual(X.toSpaceJSON(s.doc).ac_units[0].rotation_deg, 270, '회전은 0~359');
    s.exec({ type: 'update', id: 'W1', patch: { kind: 'exterior' } }); assert.deepStrictEqual([X.toSpaceJSON(s.doc).walls[0].exterior, X.toSpaceJSON(s.doc).walls[0].kind], [true, 'exterior']);
    s.exec({ type: 'addFloor' }); s.exec({ type: 'setFloor', patch: { heightMm: 2700 } }); s.exec({ type: 'addRoomRect', a: [0, 0], b: [3000, 3000] });
    assert.strictEqual(X.toSpaceJSON(s.doc, 0).ceiling.height_mm, 2300); assert.strictEqual(X.toSpaceJSON(s.doc, 1).ceiling.height_mm, 2700); assert.strictEqual(X.toSpaceJSON(s.doc, 1).rooms[0].ceiling_mm, 2700); assert.strictEqual(X.toSpaceJSON(s.doc).rooms.length, 1, '기본은 현재 층'); assert.strictEqual(X.toSpaceJSON(s.doc, 0).rooms.length, 1);
    assert.throws(() => X.toSpaceJSON(s.doc, 5), /층을 찾을 수 없습니다/);
    const empty = X.toSpaceJSON(M.createDoc()); cmp(sample, empty, ''); assert.deepStrictEqual(empty.envelope.interior_rect, [0, 0, 0, 0]);
    const cu = new S.Store(); cu.exec({ type: 'addWall', a: [0, 0], b: [1000, 0], bulge: 400 }); cu.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' });
    assert.deepStrictEqual([X.toSpaceJSON(cu.doc).walls[0].a, X.toSpaceJSON(cu.doc).walls[0].b, X.toSpaceJSON(cu.doc).openings[0].at], [[0, 0], [1000, 0], [500, 0]], '곡선벽은 현으로 내보내고 개구부도 현 위');
  }

  /* ===== 8. mesh3d ===== */
  {
    const vol = (m) => m.walls.reduce((a, p) => a + G.polyArea(p.poly) * (p.z1 - p.z0), 0);
    const xr = (p) => [Math.min(...p.poly.map((q) => q[0])), Math.max(...p.poly.map((q) => q[0]))].map(Math.round);
    const wallDoc = (...ops) => { const s = new S.Store(); s.exec({ type: 'addWall', a: [0, 0], b: [4000, 0] }); for (const o of ops) s.exec({ type: 'addOpening', wall: 'W1', ...o }); return s.doc; };
    let m = MESH.buildMesh(wallDoc());
    assert.strictEqual(m.walls.length, 1); assert.deepStrictEqual([m.walls[0].z0, m.walls[0].z1, m.walls[0].part, m.walls[0].kind, m.walls[0].id], [0, 2300, 'full', 'inner', 'W1']); near(vol(m), 4000 * 150 * 2300, 1e-3);
    m = MESH.buildMesh(wallDoc({ at: 0.5, kind: 'door' })); // 문: 왼쪽 벽 + 문 위 상인방 + 오른쪽 벽
    const door = m.walls.map((p) => ({ x: xr(p), z: [p.z0, p.z1], part: p.part })).sort((a, b) => a.x[0] - b.x[0] || a.z[0] - b.z[0]);
    assert.deepStrictEqual(door, [{ x: [0, 1550], z: [0, 2300], part: 'full' }, { x: [1550, 2450], z: [2100, 2300], part: 'lintel' }, { x: [2450, 4000], z: [0, 2300], part: 'full' }]);
    near(vol(m), 4000 * 150 * 2300 - 900 * 150 * 2100, 1e-3, '문 부피');
    m = MESH.buildMesh(wallDoc({ at: 0.25, kind: 'window' })); // 창: 좌 / 창 아래 하단 벽 / 상인방 / 우
    const win = m.walls.map((p) => ({ x: xr(p), z: [p.z0, p.z1], part: p.part })).sort((a, b) => a.x[0] - b.x[0] || a.z[0] - b.z[0]);
    assert.deepStrictEqual(win, [{ x: [0, 400], z: [0, 2300], part: 'full' }, { x: [400, 1600], z: [0, 900], part: 'sill' }, { x: [400, 1600], z: [2100, 2300], part: 'lintel' }, { x: [1600, 4000], z: [0, 2300], part: 'full' }]);
    near(vol(m), 4000 * 150 * 2300 - 1200 * 150 * 1200, 1e-3, '창 부피');
    m = MESH.buildMesh(wallDoc({ at: 0.15, kind: 'door' }, { at: 0.6, kind: 'window' }, { at: 0.9, kind: 'open', width: 600, height: 2000 })); assert.strictEqual(m.walls.length, 3 + 4 - 1 + 2, '문·창·개방 조각 수'); near(vol(m), 4000 * 150 * 2300 - 900 * 150 * 2100 - 1200 * 150 * 1200 - 600 * 150 * 2000, 1e-3);
    assert.deepStrictEqual(m.openings.map((o) => [o.id, o.type, o.width, o.z0, o.z1, o.thickness, Math.round(o.angle)]), [['O1', 'door', 900, 0, 2100, 150, 0], ['O2', 'window', 1200, 900, 2100, 150, 0], ['O3', 'open', 600, 0, 2000, 150, 0]]);
    nearPt(m.openings[1].c, [2400, 0]); near(G.polyArea(m.openings[1].poly), 1200 * 150, 1e-6);
    { // 겹친 개구부(문서에 직접 넣음): 두 사각의 합집합만큼만 빈다
      const d = M.cloneDoc(wallDoc()), f = d.floors[0];
      f.openings.push({ id: 'O1', wall: 'W1', at: 0.375, width: 1000, height: 1200, sill: 900, type: 'window' }, { id: 'O2', wall: 'W1', at: 0.5, width: 1000, height: 1200, sill: 0, type: 'window' }); // x[1000,2000]·z[900,2100] ∪ x[1500,2500]·z[0,1200]
      assert.deepStrictEqual(M.validateDoc(d), []); near(vol(MESH.buildMesh(d)), (4000 * 2300 - (1000 * 1200 + 1000 * 1200 - 500 * 300)) * 150, 1e-3, '합집합');
      const n = M.cloneDoc(wallDoc()); n.floors[0].openings.push({ id: 'O1', wall: 'W1', at: 0.375, width: 2000, height: 2100, sill: 0, type: 'door' }, { id: 'O2', wall: 'W1', at: 0.375, width: 1000, height: 300, sill: 900, type: 'window' }); // 큰 문 안에 작은 창
      near(vol(MESH.buildMesh(n)), (4000 * 2300 - 2000 * 2100) * 150, 1e-3, '안에 든 개구부는 바깥 개구부에 흡수');
    }
    { // 방: 모서리 접합까지 포함한 총 부피, 기둥·바닥·에어컨·경계
      const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000] }); s.exec({ type: 'setFloor', patch: { slabMm: 180, finish: { floor: '강마루' } } });
      s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' }); s.exec({ type: 'addOpening', wall: 'W2', at: 0.5, kind: 'window' });
      s.exec({ type: 'addColumn', kind: 'rect', c: [500, 500], w: 300, d: 300 }); s.exec({ type: 'addColumn', kind: 'round', c: [4500, 3500], w: 400 });
      s.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'lg', c: [2500, 2000], rot: 90, size: [1000, 500], capacityKw: 4, code: 'Q' });
      const mm = MESH.buildMesh(s.doc), body = mm.walls.filter((p) => p.kind !== 'column'), cols = mm.walls.filter((p) => p.kind === 'column');
      near(body.reduce((a, p) => a + G.polyArea(p.poly) * (p.z1 - p.z0), 0), (5300 * 4300 - 5000 * 4000) * 2300 - 900 * 150 * 2100 - 1200 * 150 * 1200, 1e-2, '벽 부피(모서리 접합 포함)');
      assert.strictEqual(body.filter((p) => p.part === 'lintel').length, 2, '문·창 위 상인방'); assert.strictEqual(body.filter((p) => p.part === 'sill').length, 1, '창 아래 하단 벽');
      assert.deepStrictEqual(cols.map((p) => [p.id, p.part, p.z0, p.z1]), [['C1', 'column', 0, 2300], ['C2', 'column', 0, 2300]]); near(G.polyArea(cols[0].poly), 90000, 1e-6); near(G.polyArea(cols[1].poly), 12 * 200 * 200 * Math.sin(Math.PI / 12), 1e-6);
      assert.deepStrictEqual(mm.floors, [{ id: 'R1', name: '방 1', poly: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], z: 0, thickness: 180, finish: '강마루' }]);
      assert.strictEqual(mm.items.length, 1); const it = mm.items[0]; assert.deepStrictEqual([it.id, it.model, it.z0, it.z1, it.mountZ, it.bodyH, it.size, it.c], ['I1', '1way', 2265, 2300, 2300, 140, [1000, 500], [2500, 2000]]); near(G.polyArea(it.poly), 500000, 1e-6); nearPt(it.poly[0], [2500 + 250, 2000 - 500], 1e-6, '회전 90°');
      assert.deepStrictEqual(mm.bounds, { x0: -150, y0: -150, x1: 5150, y1: 4150, z0: 0, z1: 2300 }); assert.strictEqual(MESH.buildMesh(M.createDoc()).bounds, null);
      assert.deepStrictEqual(MESH.buildMesh(M.createDoc()), { walls: [], openings: [], floors: [], items: [], bounds: null });
      const vert = mm.openings.find((o) => o.id === 'O2'); assert.strictEqual(Math.round(vert.angle), 90, '세로 벽의 개구부 방향'); nearPt(vert.c, [5075, 2000]);
      s.exec({ type: 'addFloor' }); assert.strictEqual(MESH.buildMesh(s.doc).walls.length, 0); assert.ok(MESH.buildMesh(s.doc, 0).walls.length > 4); assert.throws(() => MESH.buildMesh(s.doc, 9), /층을 찾을 수 없습니다/);
    }
    { // 곡선벽 + 문: 조각 셋, 부피 ≈ 호길이·두께·높이 − 문
      const s = new S.Store(); s.exec({ type: 'addWall', a: [0, 0], b: [3000, 0], bulge: 800, t: 120 }); s.exec({ type: 'addOpening', wall: 'W1', at: 0.4, kind: 'door' });
      const mm = MESH.buildMesh(s.doc), L = G.wallLen(cf(s.doc).walls[0]); assert.strictEqual(mm.walls.length, 3);
      near(mm.walls.reduce((a, p) => a + G.polyArea(p.poly) * (p.z1 - p.z0), 0) / ((L * 120 * 2300) - 900 * 120 * 2100), 1, 0.01, '곡선벽 부피');
      const o = mm.openings[0], A = G.arcFrom3([0, 0], [3000, 0], 800); nearPt(o.c, G.wallPointAt(cf(s.doc).walls[0], 0.4).p, 1e-6); near(G.dist(o.c, A.c), A.r, 1e-6);
    }
  }

  /* ===== 8b. 리뷰 확정 결함 회귀(#1 #2 #5 #7 #13 #14 #15 #16) ===== */
  const TPL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'maker/3d/plan/data/templates.json'), 'utf8')).templates;
  function sharedDoc() { // 방 A(왼쪽)·B(오른쪽)가 가운데 벽 W2 를 같이 쓴다. B 의 왼쪽 변은 W2 와 방향이 반대다. W2 문 O1, A 위 창 O2, B 오른쪽 문 O3
    const d = M.createDoc('공유 벽'), f = d.floors[0], w = (id, a, b) => f.walls.push({ id, a, b, t: 150, kind: 'inner', bulge: 0 });
    w('W1', [0, 0], [3000, 0]); w('W2', [3000, 0], [3000, 4000]); w('W3', [3000, 4000], [0, 4000]); w('W4', [0, 4000], [0, 0]); w('W5', [3000, 0], [6000, 0]); w('W6', [6000, 0], [6000, 4000]); w('W7', [6000, 4000], [3000, 4000]);
    f.rooms.push({ id: 'R1', name: '방 A', poly: [[75, 75], [2925, 75], [2925, 3925], [75, 3925]], wallIds: ['W1', 'W2', 'W3', 'W4'] }, { id: 'R2', name: '방 B', poly: [[3075, 75], [5925, 75], [5925, 3925], [3075, 3925]], wallIds: ['W5', 'W6', 'W7', 'W2'] });
    f.openings.push({ id: 'O1', wall: 'W2', at: 0.5, width: 900, height: 2100, sill: 0, type: 'door' }, { id: 'O2', wall: 'W1', at: 0.5, width: 1200, height: 1200, sill: 900, type: 'window' }, { id: 'O3', wall: 'W6', at: 0.5, width: 900, height: 2100, sill: 0, type: 'door' });
    return new S.Store(d);
  }
  { const s = sharedDoc(); assert.deepStrictEqual(M.validateDoc(s.doc), []); assert.deepStrictEqual(badRooms(s.doc), [], '시험 문서: 두 방 모두 벽과 맞다'); }
  { // #1 벽 길이가 바뀌면 개구부를 새 길이에 다시 맞추고, 못 들어가면 거절한다
    const room = () => { const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [1000, 1000], b: [5000, 4000] }); return s; }; // W1: (925,925)→(5075,925) 길이 4150
    const s = room(); s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' }); const keep = s.doc, op = () => cf(s.doc).openings[0];
    throwsKo(() => s.exec({ type: 'update', id: 'W1', patch: { b: [1200, 925] } }), /개구부/, '문 900 이 새 길이 275 보다 길다'); assert.strictEqual(s.doc, keep, '거절하면 문서를 건드리지 않는다');
    throwsKo(() => s.exec({ type: 'update', id: 'W1', patch: { b: [1824, 925] } }), /개구부/, '길이 899 < 900'); s.exec({ type: 'update', id: 'W1', patch: { b: [1825, 925] } }); assert.strictEqual(op().at, 0.5, '길이 900 = 문 폭이면 들어간다');
    s.undo(); s.exec({ type: 'update', id: 'W1', patch: { b: [2925, 925] } }); assert.strictEqual(op(), keep.floors[0].openings[0], '들어가면 개구부 객체를 그대로 둔다(길이 2000)');
    const s2 = room(); s2.exec({ type: 'addOpening', wall: 'W1', at: 0.12, kind: 'door' }); s2.exec({ type: 'update', id: 'W1', patch: { b: [1925, 925] } }); near(cf(s2.doc).openings[0].at, 450 / 1000, 1e-12, '비율 0.12 는 벽 안으로 당겨진다');
    assert.deepStrictEqual(M.validateDoc(s2.doc), []); s2.undo(); assert.strictEqual(cf(s2.doc).openings[0].at, 0.12, 'undo 하면 개구부도 돌아온다');
    const s3 = room(); s3.exec({ type: 'addOpening', wall: 'W1', at: 0.2, kind: 'door' }); s3.exec({ type: 'addOpening', wall: 'W1', at: 0.8, kind: 'door' }); // 4150: 중심 830·3320, 간격 2490
    const k3 = s3.doc; throwsKo(() => s3.exec({ type: 'update', id: 'W1', patch: { b: [2425, 925] } }), /겹/, '길이 1500: 0.3·0.7 로 당겨 중심 간격 600 < 900'); assert.strictEqual(s3.doc, k3);
    s3.exec({ type: 'update', id: 'W1', patch: { b: [3425, 925] } }); assert.deepStrictEqual(cf(s3.doc).openings.map((o) => o.at), [0.2, 0.8], '길이 2500: 간격 1500 ≥ 900 이라 그대로');
    const s4 = new S.Store(); s4.exec({ type: 'addWall', a: [0, 0], b: [800, 0], bulge: 400 }); s4.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' }); // 반원 호 길이 1257
    const k4 = s4.doc; throwsKo(() => s4.exec({ type: 'update', id: 'W1', patch: { bulge: 0 } }), /개구부/, '곡선을 펴면 길이 800 < 900'); assert.strictEqual(s4.doc, k4); s4.exec({ type: 'update', id: 'W1', patch: { bulge: 300 } }); assert.deepStrictEqual(M.validateDoc(s4.doc), []); throwsKo(() => s4.exec({ type: 'update', id: 'W1', patch: { bulge: 100 } }), /개구부/, '처짐 100 은 호 길이 833 < 900');
    const s5 = room(); s5.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' }); s5.exec({ type: 'update', id: 'W1', patch: { t: 300 } }); assert.strictEqual(cf(s5.doc).openings[0].at, 0.5, '두께만 바꾸면 개구부는 그대로');
  }
  { // #2 벽을 직접 옮기면 끝점이 맞닿은 벽의 끝점이 따라와 모서리가 닫혀 있다(1mm 이내)
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [1000, 1000], b: [5000, 4000] }); s.exec({ type: 'addOpening', wall: 'W2', at: 0.5, kind: 'window' });
    const before = s.doc, w = (id) => cf(s.doc).walls.find((x) => x.id === id);
    const ids = s.exec({ type: 'move', ids: ['W1'], dx: 0, dy: -500 });
    assert.deepStrictEqual([w('W1').a, w('W1').b, w('W2').a, w('W4').b], [[925, 425], [5075, 425], [5075, 425], [925, 425]], '위 벽과 양옆 벽 끝점이 같이 움직였다');
    assert.deepStrictEqual([w('W2').b, w('W4').a], [[5075, 4075], [-75 + 1000, 4075]].map((p, i) => (i ? [925, 4075] : p)), '반대쪽 끝점은 그대로'); assert.deepStrictEqual(cf(s.doc).rooms[0].poly, [[1000, 500], [5000, 500], [5000, 4000], [1000, 4000]]);
    assert.deepStrictEqual(ids.sort(), ['R1'].concat(['W1', 'W2', 'W4']).filter((i) => i !== 'R1').sort(), '바뀐 벽 id'); assert.strictEqual(w('W3'), before.floors[0].walls[2], '닿지 않은 벽은 객체 그대로');
    near(G.roomAreaM2(s.doc, cf(s.doc).rooms[0]), 14, 1e-9); assert.deepStrictEqual(badRooms(s.doc), []); assert.deepStrictEqual(M.validateDoc(s.doc), []);
    near(cf(s.doc).openings[0].at, 0.5, 1e-12, '늘어난 벽의 개구부는 비율을 지킨다'); s.undo(); assert.strictEqual(J(s.doc), J(before), 'undo 한 번에 원상');
    // 방향키처럼 조금씩 여러 번 옮겨도 모서리가 안 벌어진다
    for (let i = 0; i < 6; i++) s.exec({ type: 'move', ids: ['W1'], dx: 50, dy: -100 }); assert.deepStrictEqual([w('W2').a, w('W4').b], [[5075 + 300, 925 - 600], [925 + 300, 925 - 600]], '6번 옮긴 뒤에도 같은 점'); s.undo(); s.undo(); s.undo(); s.undo(); s.undo(); s.undo();
    // 1mm 안은 따라오고 밖은 아니다. 직접 고른 벽끼리는 통째로 옮겨 서로 어긋나지 않는다
    const t = new S.Store(); t.exec({ type: 'addWall', a: [0, 0], b: [1000, 0] }); t.exec({ type: 'addWall', a: [1000.9, 0], b: [1000, 1000] }); t.exec({ type: 'addWall', a: [1002, 0], b: [3000, 0] });
    t.exec({ type: 'move', ids: ['W1'], dx: 0, dy: 100 }); const tw = (id) => cf(t.doc).walls.find((x) => x.id === id); assert.deepStrictEqual([tw('W2').a, tw('W2').b, tw('W3').a], [[1000.9, 100], [1000, 1000], [1002, 0]], '0.9mm 는 따라오고 2mm 는 아니다');
    t.exec({ type: 'move', ids: ['W1', 'W2'], dx: 10, dy: 0 }); assert.deepStrictEqual([tw('W1').b, tw('W2').a, tw('W2').b], [[1010, 100], [1010.9, 100], [1010, 1000]], '직접 고른 벽은 통째로');
    // 따라오는 벽이 줄어 0 을 지나 반대로 접히는 이동은 거절한다
    const v = new S.Store(); v.exec({ type: 'addWall', a: [0, 0], b: [1000, 0] }); v.exec({ type: 'addWall', a: [1000, 0], b: [1000, 500] }); const kv = v.doc;
    throwsKo(() => v.exec({ type: 'move', ids: ['W2'], dx: -1500, dy: 0 }), /뒤집/, '가로벽이 -500 까지 접힌다'); throwsKo(() => v.exec({ type: 'move', ids: ['W2'], dx: -1000, dy: 0 }), /뒤집/, '길이 0 까지 접힌다'); assert.strictEqual(v.doc, kv);
    v.exec({ type: 'move', ids: ['W2'], dx: -900, dy: 0 }); assert.deepStrictEqual(cf(v.doc).walls[0].b, [100, 0], '접히기 직전까지는 된다'); v.exec({ type: 'move', ids: ['W2'], dx: 2000, dy: 0 }); assert.deepStrictEqual(cf(v.doc).walls[0].b, [2100, 0], '늘리는 쪽은 얼마든지');
    // 따라오는 벽에 개구부가 안 들어가면 명령 전체를 거절한다
    const u = new S.Store(); u.exec({ type: 'addRoomRect', a: [1000, 1000], b: [5000, 4000] }); u.exec({ type: 'addOpening', wall: 'W2', at: 0.5, kind: 'window' }); const ku = u.doc; // W2 길이 3150, 창 1200
    throwsKo(() => u.exec({ type: 'move', ids: ['W1'], dx: 0, dy: 2500 }), /개구부/, 'W2 가 650 으로 줄어 창 1200 이 못 들어간다'); assert.strictEqual(u.doc, ku, '거절하면 문서 그대로'); u.exec({ type: 'move', ids: ['W1'], dx: 0, dy: 1500 }); assert.deepStrictEqual(M.validateDoc(u.doc), []);
  }
  { // #15 방을 옮기면 이웃과 공유한 벽은 복제해 그 방만 갖고 가고, 이웃 방과 벽은 그대로다
    const s = sharedDoc(), before = s.doc, f0 = cf(before), w = (id) => cf(s.doc).walls.find((x) => x.id === id), room = (id) => cf(s.doc).rooms.find((x) => x.id === id);
    const out = s.exec({ type: 'move', ids: ['R2'], dx: 200, dy: -1500 }), f = cf(s.doc);
    assert.deepStrictEqual(M.validateDoc(s.doc), []); assert.deepStrictEqual(badRooms(s.doc), [], '두 방 모두 벽과 맞는다');
    assert.strictEqual(room('R1'), f0.rooms[0], '이웃 방은 객체 그대로'); for (const i of ['W1', 'W2', 'W3', 'W4']) assert.strictEqual(w(i), f0.walls.find((x) => x.id === i), `이웃 방의 벽 ${i} 는 그대로(연결된 벽도 안 늘어난다)`);
    assert.deepStrictEqual(room('R2').poly, [[3275, -1425], [6125, -1425], [6125, 2425], [3275, 2425]], '옮긴 방 다각형'); const nid = room('R2').wallIds[3]; assert.strictEqual(nid, 'W8', '공유 벽 W2 는 복제본(새 id)으로 바뀐다'); assert.deepStrictEqual(room('R2').wallIds, ['W5', 'W6', 'W7', 'W8']);
    assert.deepStrictEqual([w('W8').a, w('W8').b], [[3200, -1500], [3200, 2500]], '복제본은 옮긴 위치'); assert.deepStrictEqual([w('W5').a, w('W6').b], [[3200, -1500], [6200, 2500]]); assert.strictEqual(f.walls.length, f0.walls.length + 1);
    assert.deepStrictEqual(f.openings.filter((o) => o.wall === 'W2').map((o) => o.id), ['O1'], '개구부는 원래 벽에 남는다'); assert.ok(!f.openings.some((o) => o.wall === 'W8')); assert.deepStrictEqual(f.openings.filter((o) => o.wall === 'W6').map((o) => o.id), ['O3'], '옮긴 방만 쓰던 벽의 개구부는 같이 간다');
    assert.deepStrictEqual(out.sort(), ['R2', 'W5', 'W6', 'W7', 'W8'], '바뀐 id 에 복제본 포함'); near(G.roomAreaM2(s.doc, room('R2')), 2.85 * 3.85, 1e-9);
    s.undo(); assert.strictEqual(J(s.doc), J(before), 'undo 한 번에 원상'); s.redo(); s.undo();
    // 방 둘을 같이 옮기면 공유 벽은 복제 없이 한 번만 간다
    s.exec({ type: 'move', ids: ['R1', 'R2'], dx: 100, dy: 100 }); assert.strictEqual(cf(s.doc).walls.length, f0.walls.length); assert.deepStrictEqual(w('W2').a, [3100, 100]); assert.deepStrictEqual(badRooms(s.doc), []); s.undo();
    // 옮긴 방을 지워도 이웃 방은 멀쩡하다
    s.exec({ type: 'move', ids: ['R2'], dx: 0, dy: -1500 }); s.exec({ type: 'remove', ids: ['R2'] }); assert.deepStrictEqual(M.validateDoc(s.doc), []); assert.deepStrictEqual(badRooms(s.doc), []); assert.ok(cf(s.doc).walls.some((x) => x.id === 'W2') && cf(s.doc).openings.some((o) => o.id === 'O1'), '이웃 방의 공유 벽·문은 남는다'); assert.ok(!cf(s.doc).walls.some((x) => x.id === 'W8'), '복제본은 방과 함께 지워진다');
    // 벽을 직접 고르면 공유 벽도 그 자리에서 움직이고 이웃 방이 늘어나 따라간다
    const t = sharedDoc(); t.exec({ type: 'move', ids: ['W2'], dx: 300, dy: 0 }); assert.deepStrictEqual(badRooms(t.doc), []); assert.deepStrictEqual(cf(t.doc).rooms.map((r) => r.poly[1][0] + '/' + r.poly[0][0]), ['3225/75', '5925/3375'], 'A 는 늘고 B 는 줄어든다'); assert.strictEqual(cf(t.doc).walls.length, 7);
  }
  for (const t of TPL) { // 모든 템플릿의 모든 방을 옮겨 본다 — 이웃 방은 그대로, 옮긴 방은 평행이동 그대로, 방과 벽은 계속 맞는다
    assert.deepStrictEqual(badRooms(new S.Store(t.doc).doc), [], `${t.id} 방이 벽과 맞는다`);
    for (const r0 of cf(new S.Store(t.doc).doc).rooms) {
      const s = new S.Store(t.doc), base = s.doc, f0 = cf(base), r = f0.rooms.find((q) => q.id === r0.id), shared = r.wallIds.filter((i) => f0.rooms.some((q) => q.id !== r.id && q.wallIds.includes(i)));
      s.exec({ type: 'move', ids: [r.id], dx: 130, dy: -70 }); const f = cf(s.doc), m = f.rooms.find((q) => q.id === r.id), tag = `${t.id} ${r.name}`;
      assert.deepStrictEqual(M.validateDoc(s.doc), [], tag); assert.deepStrictEqual(badRooms(s.doc), [], `${tag}: 이동 뒤 방과 벽이 맞는다`);
      assert.deepStrictEqual(m.poly, r.poly.map((p) => [p[0] + 130, p[1] - 70]), `${tag}: 평행이동`); assert.strictEqual(f.walls.length, f0.walls.length + shared.length, `${tag}: 공유 벽만 복제`);
      for (const q of f0.rooms) if (q.id !== r.id) { assert.strictEqual(f.rooms.find((x) => x.id === q.id), q, `${tag}: 이웃 ${q.name} 방 그대로`); for (const i of q.wallIds) assert.strictEqual(f.walls.find((x) => x.id === i), f0.walls.find((x) => x.id === i), `${tag}: 이웃 벽 ${i} 그대로`); }
      assert.deepStrictEqual(f.openings, f0.openings, `${tag}: 개구부는 원래 벽에 남는다`); s.undo(); assert.strictEqual(J(s.doc), J(base), `${tag}: undo`);
    }
  }
  { // #16 방을 지우면 그 방만 쓰던 벽과 그 개구부만 지운다 — 남은 방이 쓰는 공유 벽과 개구부는 남는다
    const s = sharedDoc(), before = s.doc; const got = s.exec({ type: 'remove', ids: ['R2'] }), f = cf(s.doc);
    assert.deepStrictEqual(got.sort(), ['O3', 'R2', 'W5', 'W6', 'W7'], 'B 만 쓰던 벽 W5 W6 W7 과 O3'); assert.ok(f.walls.some((w) => w.id === 'W2') && f.openings.some((o) => o.id === 'O1'), '공유 벽 W2 와 문 O1 은 남는다'); assert.deepStrictEqual(f.openings.map((o) => o.id), ['O1', 'O2']);
    assert.deepStrictEqual(M.validateDoc(s.doc), []); assert.deepStrictEqual(badRooms(s.doc), []); s.undo(); assert.strictEqual(J(s.doc), J(before));
    const t = sharedDoc(); t.exec({ type: 'remove', ids: ['R1'] }); assert.deepStrictEqual(cf(t.doc).openings.map((o) => o.id), ['O1', 'O3'], 'A 를 지우면 W1 의 창 O2 만 간다'); t.exec({ type: 'remove', ids: ['R2'] }); assert.strictEqual(cf(t.doc).walls.length, 0); assert.strictEqual(cf(t.doc).openings.length, 0, '마지막 방까지 지우면 공유 벽도 개구부도 간다');
    for (const tp of TPL) for (const r of cf(new S.Store(tp.doc).doc).rooms) { // 템플릿 전수: 지워진 벽 = 그 방만 쓰던 벽, 개구부 = 지워진 벽의 것
      const st = new S.Store(tp.doc), f0 = cf(st.doc), alone = f0.walls.filter((w) => r.wallIds.includes(w.id) && !f0.rooms.some((q) => q.id !== r.id && q.wallIds.includes(w.id))).map((w) => w.id).sort();
      st.exec({ type: 'remove', ids: [r.id] }); const f1 = cf(st.doc);
      assert.deepStrictEqual(f0.walls.filter((w) => !f1.walls.some((x) => x.id === w.id)).map((w) => w.id).sort(), alone, `${tp.id} ${r.name}: 지워진 벽`);
      assert.deepStrictEqual(f1.openings.map((o) => o.id), f0.openings.filter((o) => !alone.includes(o.wall)).map((o) => o.id), `${tp.id} ${r.name}: 남은 벽의 개구부는 남는다`);
    }
  }
  { // #14 곡선벽이 방 경계에 있으면 면적·바닥이 호를 따른다
    const seg = (c, h) => { const r = (c * c / 4 + h * h) / (2 * h), th = Math.asin(c / 2 / r); return (r * r * (th - Math.sin(th) * Math.cos(th))) / 1e6; }; // 현 c·처짐 h 인 호 조각 넓이(㎡) — 4000/1000: r=2500, θ=asin(0.8)
    near(seg(4000, 1000), 2.795595, 1e-6, '손계산: 6.25e6×(0.9272952−0.48)');
    const room = () => { const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000] }); return s; }, area = (s, o) => G.roomAreaM2(s.doc, cf(s.doc).rooms[0], o);
    const s = room(); near(area(s), 12, 1e-9); // W1 은 위 벽 (-75,-75)→(4075,-75), 처짐 + 는 a→b 의 오른쪽 = 아래(방 안쪽)
    s.exec({ type: 'update', id: 'W1', patch: { bulge: 1000 } }); near(area(s), 12 - seg(4000, 1000), 0.01, '안쪽으로 볼록: 12 − 2.7956'); assert.ok(area(s) > 12 - seg(4000, 1000), '호에 내접한 다각형이라 이상값보다 아주 조금 크다');
    near(area(s, { withWalls: true }), 14.19 - seg(4300, 1000), 0.01, '실면적+내외벽: 바깥 면 4300×3300 에서 호 조각'); const poly = MESH.buildMesh(s.doc).floors[0].poly; near(G.polyArea(poly) / 1e6, area(s), 1e-9, '3D 바닥 = 면적 다각형'); assert.ok(poly.length > 20);
    { const A = G.arcFrom3([0, 0], [4000, 0], 1000), arc = poly.filter((p) => p[1] > 0 && p[1] < 3000 && p[0] > 0 && p[0] < 4000); assert.ok(arc.length > 15 && arc.every((p) => Math.abs(G.dist(p, A.c) - 2500) < 1e-6), '호 위의 점: 중심 (2000,−1500) 반지름 2500'); nearPt(A.c, [2000, -1500]); }
    assert.notStrictEqual(G.hitTest(s.doc, [2000, 500], 0)?.kind, 'room', '안쪽으로 파인 호 밖은 방이 아니다'); assert.deepStrictEqual(G.hitTest(s.doc, [2000, 2000], 0), { kind: 'room', id: 'R1' });
    s.exec({ type: 'update', id: 'W1', patch: { bulge: -1000 } }); near(area(s), 12 + seg(4000, 1000), 0.01, '바깥으로 볼록: 12 + 2.7956'); near(area(s, { withWalls: true }), 14.19 + seg(4300, 1000), 0.01);
    assert.deepStrictEqual(G.hitTest(s.doc, [2000, -500], 0), { kind: 'room', id: 'R1' }, '바깥으로 부푼 호 안은 방'); near(G.polyArea(MESH.buildMesh(s.doc).floors[0].poly) / 1e6, area(s), 1e-9);
    s.exec({ type: 'update', id: 'W1', patch: { bulge: 0 } }); near(area(s), 12, 1e-9); assert.strictEqual(MESH.buildMesh(s.doc).floors[0].poly.length, 4, '직선이면 네 점 그대로');
    assert.strictEqual(X.toSpaceJSON(s.doc).rooms[0].area_m2, 12);
    // 방 변과 벽 방향이 반대인 쪽: 가운데 벽 W2(A 의 오른쪽 변과 같은 방향, B 의 왼쪽 변과 반대)가 A 쪽으로 볼록하면 A 는 줄고 B 는 같은 만큼 는다
    const sh = sharedDoc(), a0 = G.roomAreaM2(sh.doc, cf(sh.doc).rooms[0]), b0 = G.roomAreaM2(sh.doc, cf(sh.doc).rooms[1]); sh.exec({ type: 'update', id: 'W2', patch: { bulge: 500 } });
    const da = G.roomAreaM2(sh.doc, cf(sh.doc).rooms[0]) - a0, db = G.roomAreaM2(sh.doc, cf(sh.doc).rooms[1]) - b0; near(da, -seg(3850, 500), 0.01, 'A: 오른쪽 변 → 처짐 +500 은 서쪽(안쪽)'); near(db, seg(3850, 500), 0.01, 'B: 같은 벽을 반대 방향에서 보면 바깥쪽 볼록'); near(da + db, 0, 1e-9, '합은 그대로');
    sh.exec({ type: 'update', id: 'W2', patch: { bulge: -500 } }); near(G.roomAreaM2(sh.doc, cf(sh.doc).rooms[0]) - a0, seg(3850, 500), 0.01); near(G.roomAreaM2(sh.doc, cf(sh.doc).rooms[1]) - b0, -seg(3850, 500), 0.01);
    // 곡선벽이 방 경계가 아니면(자유 벽) 방은 그대로
    const fr = room(); fr.exec({ type: 'addWall', a: [0, 5000], b: [3000, 5000], bulge: 800 }); near(area(fr), 12, 1e-9);
  }
  { // #5 좌우·상하 반전, 회전 뒤에도 문 열림 방향(벽 +법선)이 방 안쪽이다
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [1000, 1000], b: [5000, 4000] });
    for (const [wid, at] of [['W1', 0.3], ['W2', 0.7], ['W3', 0.35], ['W4', 0.5]]) s.exec({ type: 'addOpening', wall: wid, at, kind: 'door' }); s.exec({ type: 'addOpening', wall: 'W1', at: 0.8, kind: 'window' });
    const orig = J(s.doc), doors = (doc) => cf(doc).openings.filter((o) => o.type === 'door');
    const tip = (doc, o) => { const w = cf(doc).walls.find((x) => x.id === o.wall), { p, tan } = G.wallPointAt(w, o.at), n = [-tan[1], tan[0]]; return [p[0] + n[0] * 300, p[1] + n[1] * 300]; }; // view2d 가 문짝을 여는 쪽 = a→b 의 +법선
    const inside = (doc) => doors(doc).every((o) => G.pointInPoly(cf(doc).rooms[0].poly, tip(doc, o))), center = (doc, o) => G.wallPointAt(cf(doc).walls.find((x) => x.id === o.wall), o.at).p;
    assert.ok(inside(s.doc), '처음엔 모두 방 안쪽');
    const b0 = G.bounds(s.doc), sx = b0.x0 + b0.x1, sy = b0.y0 + b0.y1, c0 = cf(s.doc).openings.map((o) => center(s.doc, o));
    s.exec({ type: 'mirror', axis: 'x' }); assert.ok(inside(s.doc), '좌우 반전 뒤에도 방 안쪽'); cf(s.doc).openings.forEach((o, i) => nearPt(center(s.doc, o), [sx - c0[i][0], c0[i][1]], 1e-6, `개구부 ${o.id} 는 거울상 자리`)); assert.deepStrictEqual(cf(s.doc).openings.map((o) => o.at), [0.7, 0.3, 0.65, 0.5, 0.2], 'at → 1 − at');
    s.exec({ type: 'mirror', axis: 'x' }); assert.strictEqual(J(s.doc), orig, '좌우 반전 두 번 = 원래 문서(0.3 같은 값도 그대로)');
    s.exec({ type: 'mirror', axis: 'y' }); assert.ok(inside(s.doc), '상하 반전 뒤에도 방 안쪽'); cf(s.doc).openings.forEach((o, i) => nearPt(center(s.doc, o), [c0[i][0], sy - c0[i][1]], 1e-6)); s.exec({ type: 'mirror', axis: 'y' }); assert.strictEqual(J(s.doc), orig, '상하 반전 두 번 = 원래');
    s.exec({ type: 'mirror', axis: 'x' }); s.exec({ type: 'rotate', deg: 90 }); assert.ok(inside(s.doc), '반전 + 회전 뒤에도'); s.exec({ type: 'rotate', deg: -90 }); s.exec({ type: 'mirror', axis: 'x' }); assert.strictEqual(J(s.doc), orig);
    for (const deg of [90, -90, 90]) { s.exec({ type: 'rotate', deg }); assert.ok(inside(s.doc), `회전 ${deg} 뒤에도 방 안쪽`); } assert.deepStrictEqual(cf(s.doc).openings.map((o) => o.at), [0.3, 0.7, 0.35, 0.5, 0.8], '회전은 개구부 비율을 안 바꾼다');
    // 곡선벽 + 문도 반전 뒤 같은 자리·같은 쪽: 호 위의 문 중심이 거울상이다
    const cv = new S.Store(); cv.exec({ type: 'addWall', a: [0, 0], b: [3000, 0], bulge: 600 }); cv.exec({ type: 'addOpening', wall: 'W1', at: 0.3, kind: 'door' }); const cp = center(cv.doc, cf(cv.doc).openings[0]); cv.exec({ type: 'mirror', axis: 'x' });
    nearPt(center(cv.doc, cf(cv.doc).openings[0]), [3000 - cp[0], cp[1]], 1e-6, '곡선벽 위 문 중심'); assert.strictEqual(cf(cv.doc).walls[0].bulge, 600);
    // 템플릿 전수: 반전·회전 뒤 모든 문이 열리던 방 쪽(같은 방)으로 열린다
    for (const t of TPL) { const st = new S.Store(t.doc), roomOf = (doc, o, p) => cf(doc).rooms.find((r) => r.wallIds.includes(o.wall) && G.pointInPoly(r.poly, p))?.id ?? null;
      const sides = (doc) => doors(doc).map((o) => roomOf(doc, o, tip(doc, o))), s0 = sides(st.doc);
      for (const cmd of [{ type: 'mirror', axis: 'x' }, { type: 'mirror', axis: 'y' }, { type: 'rotate', deg: 90 }]) { st.exec(cmd); assert.deepStrictEqual(sides(st.doc), s0, `${t.id} ${cmd.type}: 문마다 열리는 방이 그대로`); } }
  }
  { // #7 보조선 길이 0 은 update·validateDoc 에서도 거절(addGuide 와 같은 기준 1mm)
    const s = new S.Store(); s.exec({ type: 'addGuide', a: [1000, 1000], b: [4000, 1000] }); const keep = s.doc;
    throwsKo(() => s.exec({ type: 'update', id: 'G1', patch: { b: [1000, 1000] } }), /보조선.*1mm/, '반대 끝에 끌어다 놓기'); throwsKo(() => s.exec({ type: 'update', id: 'G1', patch: { b: [1000.5, 1000] } }), /보조선/, '0.5mm'); assert.strictEqual(s.doc, keep);
    s.exec({ type: 'update', id: 'G1', patch: { b: [1001, 1000] } }); assert.deepStrictEqual(M.validateDoc(s.doc), [], '1mm 는 허용'); throwsKo(() => s.exec({ type: 'addGuide', a: [0, 0], b: [0.9, 0] }), /보조선/);
    const d = M.cloneDoc(s.doc); d.floors[0].guides[0].b = [...d.floors[0].guides[0].a]; const p = M.validateDoc(d); assert.ok(p.some((m) => /보조선 길이/.test(m)) && p.every(ko), p.join()); throwsKo(() => X.fromDocJSON(J(d)), /읽지 못/);
  }
  { // #13 seq 는 유한한 정수만, 좌표·치수는 ±10km 이내만
    const base = JSON.parse(X.toDocJSON(fixture().doc)), str = (fn) => { const d = M.cloneDoc(base); fn(d); return J(d); };
    const bad = (label, str_, re) => { const e = throwsKo(() => X.fromDocJSON(str_), /^도면 파일을 읽지 못했습니다$/, label); assert.ok(e.problems.every(ko) && e.problems.some((m) => re.test(m)), label + ' ' + e.problems); };
    bad('seq 무한대', J(base).replace('"W":12', '"W":1e999'), /seq|카운터/); assert.strictEqual(JSON.parse(J(base).replace('"W":12', '"W":1e999')).seq.W, Infinity, '시험 입력은 정말 Infinity');
    bad('seq 1e21', str((d) => { d.seq.W = 1e21; }), /카운터/); bad('seq 소수', str((d) => { d.seq.R = 1.5; }), /카운터/); bad('seq 음수', str((d) => { d.seq.O = -1; }), /카운터/); bad('seq 문자열', str((d) => { d.seq.I = '7'; }), /카운터/); bad('seq null', str((d) => { d.seq.G = null; }), /카운터/); bad('seq 배열', str((d) => { d.seq = [1]; }), /카운터/); bad('seq 숫자', str((d) => { d.seq = 5; }), /카운터/);
    assert.ok(X.fromDocJSON(str((d) => { delete d.seq; })).seq.W >= 12, 'seq 가 없으면 id 에서 복구'); assert.ok(X.fromDocJSON(str((d) => { d.seq = { W: 0 }; })).seq.W >= 12, '낡은 seq 는 id 로 끌어올린다'); assert.ok(X.fromDocJSON(str((d) => { d.seq = null; })).seq.W >= 12);
    assert.deepStrictEqual(M.validateDoc(Object.assign(M.cloneDoc(base), { seq: { W: Number.MAX_SAFE_INTEGER } })), [], '안전 정수 끝값은 형식으로는 맞다'); assert.ok(M.validateDoc(Object.assign(M.cloneDoc(base), { seq: { W: 2 ** 53 } })).length);
    { const d = M.cloneDoc(base); d.seq.W = Infinity; assert.strictEqual(M.newId(d, 'W'), 'W13', 'newId 도 망가진 카운터를 실제 id 로 대체'); const e = M.cloneDoc(base); e.seq.W = 1e21; assert.strictEqual(M.fixSeq(e).seq.W, 12); }
    const E = 1e7; bad('좌표 1e200', str((d) => { d.floors[0].walls[0].a = [1e200, 0]; }), /좌표/); bad('좌표 10km 초과', str((d) => { d.floors[0].walls[0].b = [E + 1, 0]; }), /좌표/); bad('좌표 -10km 초과', str((d) => { d.floors[0].walls[0].a = [0, -E - 1]; }), /좌표/);
    X.fromDocJSON(str((d) => { d.floors[0].walls[0].b = [E, 0]; })); X.fromDocJSON(str((d) => { d.floors[0].walls[0].a = [-E, 0]; })); // 정확히 10km 는 허용
    bad('방 점', str((d) => { d.floors[0].rooms[0].poly[0] = [E + 1, 0]; }), /방 모양/); bad('기둥', str((d) => { d.floors[0].columns[0].c = [E + 1, 0]; }), /기둥/); bad('기둥 크기', str((d) => { d.floors[0].columns[0].w = 1e300; }), /기둥 크기/); bad('보조선', str((d) => { d.floors[0].guides[0].b = [1e300, 0]; }), /보조선/);
    bad('제품 위치', str((d) => { d.floors[0].items[0].c = [0, 1e300]; }), /제품/); bad('제품 크기', str((d) => { d.floors[0].items[0].size = [1e300, 5]; }), /제품 크기/); bad('벽 두께', str((d) => { d.floors[0].walls[0].t = 1e300; }), /두께/); bad('처짐', str((d) => { d.floors[0].walls[0].bulge = 1e300; }), /처짐/);
    bad('개구부 폭', str((d) => { d.floors[0].openings[0].width = 1e300; }), /개구부/); bad('층 높이', str((d) => { d.floors[0].heightMm = 1e300; }), /층 높이/); bad('밑그림 위치', str((d) => { d.underlay = { name: 'a', src: 'data:,x', x: 1e300, y: 0, mmPerPx: 1, rot: 0, opacity: 1 }; }), /밑그림/);
    const st = fixture(); throwsKo(() => st.exec({ type: 'update', id: 'W1', patch: { b: [1e200, 0] } }), /10km/, '명령으로도 못 넣는다'); throwsKo(() => st.exec({ type: 'addWall', a: [0, 0], b: [1e8, 0] }), /10km/); throwsKo(() => st.exec({ type: 'move', ids: ['I1'], dx: 1e8, dy: 0 }), /10km/);
  }

  /* ===== 9. 규모: 요소 1만 개에서도 명령이 느려지지 않는다(무른 기준) ===== */
  {
    const d = M.createDoc(), f = d.floors[0];
    for (let i = 0; i < 10000; i++) f.walls.push({ id: 'W' + (i + 1), a: [i * 10, 0], b: [i * 10 + 5, 100], t: 150, kind: 'inner', bulge: 0 });
    const s = new S.Store(d), best = (fn, n = 5) => { let m = Infinity; for (let k = 0; k < n; k++) { const t = process.hrtime.bigint(); fn(); m = Math.min(m, Number(process.hrtime.bigint() - t) / 1e6); } return m; };   // 컴퓨터가 바쁠 때 흔들리지 않게 여러 번 재서 가장 빠른 값
    const ms = best(() => { for (let i = 0; i < 10; i++) s.exec({ type: 'move', ids: ['W1'], dx: 1, dy: 0 }); }) / 10; assert.ok(ms < 100, `1만 벽에서 명령 한 번 ${ms.toFixed(1)}ms`);
    const ms2 = best(() => G.wallOutlines(cf(s.doc).walls), 3); assert.ok(ms2 < 500, `1만 벽 외곽 ${ms2.toFixed(1)}ms`);
    assert.ok(MESH.buildMesh(s.doc).walls.length === 10000);
  }

  console.log('test-plan-core: OK');
})().catch((e) => { console.error(e); process.exit(1); });
