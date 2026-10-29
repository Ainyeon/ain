// 플래너 3D(maker/3d/plan/view3d.js) 순수 부분 시험 — buildMesh 결과 → 정점 자료(벽 구멍·에어컨 높이·면 방향)와 보기별 카메라 사양(화면 맞춤·방향)을 손으로 계산한 값으로 단언한다.
// WebGL 은 node 에서 못 돌리므로 그리기·dispose·크기 대응은 단독 하네스 페이지에서 사람이 본다. 변이 시험용으로 PLAN_3D_FILE 로 다른 사본(같은 폴더)을 가리킬 수 있다.
// 실행: node tools/test-plan-3d.js (Node 22.7+)
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', 'maker/3d/plan');
const FILE = process.env.PLAN_3D_FILE || path.join(ROOT, 'view3d.js');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);
const F32 = 1e-5; // 정점은 Float32 — 7 m 에서 ±5e-7
const nearV = (a, b, eps, msg) => a.forEach((v, i) => near(v, b[i], eps, msg));

(async () => {
  const V = await import(pathToFileURL(FILE).href);
  const THREE = await import(pathToFileURL(path.join(ROOT, '../view/lib/three-0.160.0/three.module.min.js')).href);
  const { Store } = await import(pathToFileURL(path.join(ROOT, 'core/store.js')).href);
  const { buildMesh } = await import(pathToFileURL(path.join(ROOT, 'core/mesh3d.js')).href);

  /* ===== 0. 정적 점검 ===== */
  const src = fs.readFileSync(FILE, 'utf8');
  assert.ok(/^\/\/ \S/.test(src), '맨 위 한 줄 역할 주석');
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new Function|Date\.now|Math\.random/.test(code), 'DOM 문자열 주입·eval·난수 없음');
  assert.ok(src.includes("'../view/lib/three-0.160.0/three.module.min.js'") && src.includes("'../view/lib/three-0.160.0/OrbitControls.js'"), 'three 는 저장소의 상대 경로로만');
  assert.ok(!/https?:\/\//.test(code), '외부 주소 없음');
  for (const n of ['createView3D', 'meshData', 'geometryOf', 'soupBounds', 'cameraFor', 'applyCameraSpec']) assert.strictEqual(typeof V[n], 'function', n);
  assert.deepStrictEqual(Object.keys(V.VIEWS), ['plan', 'iso', 'free']);

  /* ===== 1. 기둥꼴: 면 방향·정점 수·오목 다각형 ===== */
  const sq = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];       // 평면 시계방향(y 아래)
  const box = (poly, z0, z1) => V.meshData({ walls: [{ poly, z0, z1 }], floors: [], items: [] }).walls;
  const tris = (s) => { const o = []; for (let i = 0; i < s.idx.length; i += 3) o.push([0, 1, 2].map((k) => new THREE.Vector3(s.pos[s.idx[i + k] * 3], s.pos[s.idx[i + k] * 3 + 1], s.pos[s.idx[i + k] * 3 + 2]))); return o; };
  const normalOf = ([a, b, c]) => new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const centre = (s) => { const b = V.soupBounds(s); return new THREE.Vector3(...b.min.map((v, i) => (v + b.max[i]) / 2)); };
  const outward = (s) => { // 모든 삼각형의 법선이 상자 중심에서 바깥을 보는지(내려다본 면은 +y, 밑면은 −y)
    const c = centre(s);
    for (const t of tris(s)) { const n = normalOf(t), m = new THREE.Vector3().add(t[0]).add(t[1]).add(t[2]).multiplyScalar(1 / 3).sub(c); assert.ok(n.dot(m) > 1e-9, `바깥을 보지 않는 면 ${n.toArray()} @ ${m.toArray()}`); }
  };
  let b1 = box(sq, 0, 1000);
  assert.strictEqual(b1.pos.length / 3, 20, '바닥에 놓인 기둥: 옆 4×4 + 윗면 4 = 20 정점');
  assert.strictEqual(b1.idx.length / 3, 10, '삼각형 8 + 2');
  outward(b1);
  assert.ok(tris(b1).filter((t) => normalOf(t).y > 1e-9).length === 2, '윗면 삼각형 둘');
  assert.ok(tris(b1).every((t) => normalOf(t).y > -1e-9), '밑면 없음(z0=0)');
  b1 = box(sq, 800, 1000);                                       // 상인방처럼 떠 있으면 밑면도 있다
  assert.strictEqual(b1.pos.length / 3, 24); assert.strictEqual(b1.idx.length / 3, 12);
  outward(b1); assert.strictEqual(tris(b1).filter((t) => normalOf(t).y < -1e-9).length, 2, '밑면 삼각형 둘, 아래를 본다');
  outward(box([...sq].reverse(), 0, 1000));                      // 반시계 입력도 같은 방향으로 맞춘다
  const L = [[0, 0], [2000, 0], [2000, 1000], [1000, 1000], [1000, 2000], [0, 2000]]; // 오목(ㄱ자) 3㎡
  const lb = box(L, 0, 100), top = tris(lb).filter((t) => normalOf(t).y > 1e-9);
  near(top.reduce((s, t) => s + normalOf(t).y / 2, 0), 3, 1e-9, 'ㄱ자 윗면 삼각형 넓이 합 = 3 ㎡');
  assert.deepStrictEqual(V.soupBounds(lb).min, [0, 0, 0]); assert.deepStrictEqual(V.soupBounds(lb).max.map((v) => +v.toFixed(6)), [2, 0.1, 2]);
  assert.strictEqual(V.soupBounds({ pos: [], idx: [] }), null, '빈 자료의 경계는 null');
  assert.strictEqual(V.geometryOf({ pos: new Float32Array(0), idx: new Uint32Array(0) }).index, null, '빈 자료는 빈 지오메트리');

  /* ===== 2. 방 둘·창 하나·문 하나·에어컨 둘 문서 ===== */
  const st = new Store();
  st.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000], name: '방 A' });      // 벽 W1(북) W2(동) W3(남) W4(서) — 중심선이 안쪽 면에서 75mm 바깥
  st.exec({ type: 'addRoomRect', a: [4300, 0], b: [7300, 3000], name: '방 B' });
  st.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'window' });             // 폭 1200·높이 1200·바닥 900
  st.exec({ type: 'addOpening', wall: 'W3', at: 0.3, kind: 'door' });               // 폭 900·높이 2100
  st.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'samsung', c: [2000, 1500], rot: 0, size: [1260, 400] });
  st.exec({ type: 'addItem', kind: 'ac', model: '4way', brand: 'lg', c: [5800, 1500], rot: 0, size: [950, 950] });
  const doc = st.doc, mesh = buildMesh(doc), D = V.meshData(mesh), H = 2300;

  const wb = V.soupBounds(D.walls);
  nearV(wb.min, [-0.15, 0, -0.15], F32, '벽 최소(안쪽 면 0 에서 벽 두께 150 바깥)');
  nearV(wb.max, [7.45, 2.3, 3.15], F32, '벽 최대 — 높이는 층고 2.3 m');
  const walls = mesh.walls.filter((w) => w.kind !== 'column');
  assert.strictEqual(D.walls.pos.length / 3, mesh.walls.reduce((s, w) => s + w.poly.length * (5 + (w.z0 > 0 ? 1 : 0)), 0), '벽 정점 수 = Σ n×(옆 4 + 윗 1 [+ 밑 1])');
  assert.ok(D.walls.idx.every((i) => i < D.walls.pos.length / 3) && D.walls.idx.length % 3 === 0, '인덱스 범위');
  assert.ok(walls.length > 8, '창·문 때문에 벽이 8 조각보다 많다 ' + walls.length);

  const fb = V.soupBounds(D.floors);
  nearV(fb.min, [0, 0, 0], F32, '바닥은 안쪽 면 다각형, 높이 0'); nearV(fb.max, [7.3, 0, 3], F32, '바닥 끝');
  assert.strictEqual(D.floors.pos.length / 3, 8, '방 둘 × 사각형 4 (슬래브 0 이면 윗면만)');
  const st2 = new Store(doc); st2.exec({ type: 'setFloor', patch: { slabMm: 200 } });
  const fb2 = V.soupBounds(V.meshData(buildMesh(st2.doc)).floors);
  nearV(fb2.min, [0, -0.2, 0], F32, '슬래브 200 이면 바닥 밑으로 0.2 m'); near(fb2.max[1], 0, F32);

  const ab = V.soupBounds(D.ac);                                  // 천장 아래 매달린 판넬 H−35 ~ H, 본체는 그 위 H ~ H+140
  near(ab.min[1], (H - 35) / 1000, F32, '에어컨 가장 낮은 곳 = 천장고 − 35 mm'); near(ab.max[1], (H + 140) / 1000, F32, '본체 위 = 천장고 + 140 mm');
  nearV([ab.min[0], ab.min[2], ab.max[0], ab.max[2]], [1.37, 1.025, 6.275, 1.975], F32, '에어컨 둘의 바닥 투영 범위');
  assert.strictEqual(D.ac.pos.length / 3, 2 * (16 + 4 + 4 + 16 + 4), '에어컨 한 대 = 판넬(옆 16+윗 4+밑 4) + 본체(옆 16+윗 4)');
  const panelTop = tris(D.ac).filter((t) => normalOf(t).y > 1e-9 && Math.abs(t[0].y - H / 1000) < F32);
  assert.ok(panelTop.length >= 4, '판넬 윗면은 천장고에 놓인다');

  /* 구멍: 창·문 자리를 지나는 선분은 벽 조각을 하나도 지나지 않고, 막힌 자리는 앞뒤 두 면을 지난다 */
  const hits = (s, o, dir, len) => { // 선분이 지나는 삼각형 수 (모서리·대각선을 피하도록 살짝 비킨 선분을 쓴다)
    const ray = new THREE.Ray(new THREE.Vector3(...o), new THREE.Vector3(...dir).normalize()); let n = 0;
    for (const [a, b, c] of tris(s)) { const p = ray.intersectTriangle(a, b, c, false, new THREE.Vector3()); if (p && p.distanceTo(ray.origin) <= len) n++; }
    return n;
  };
  const eps = [1.37e-4, 2.11e-4];
  const win = mesh.openings.find((o) => o.type === 'window'), door = mesh.openings.find((o) => o.type === 'door');
  const across = (o, y) => [o.c[0] / 1000 + eps[0], y + eps[1], o.c[1] / 1000 - 0.4]; // 북·남 벽을 가로지르는 선분(평면 y 방향)
  nearV([win.c[0], win.c[1]], [2000, -75], 1e-6, '창 중심은 북쪽 벽 중심선 위'); near(door.c[1], 3075, 1e-6, '문은 남쪽 벽');
  assert.strictEqual(hits(D.walls, across(win, 1.5), [0, 0, 1], 0.8), 0, '창 한가운데(높이 1.5 m)는 뚫려 있다');
  assert.strictEqual(hits(D.walls, across(win, 0.5), [0, 0, 1], 0.8), 2, '창 아래 벽(0.5 m)은 막혀 앞뒤 두 면');
  assert.strictEqual(hits(D.walls, across(win, 2.2), [0, 0, 1], 0.8), 2, '창 위 상인방(2.2 m)은 막혀 있다');
  assert.strictEqual(hits(D.walls, across(door, 1.0), [0, 0, 1], 0.8), 0, '문 자리(높이 1.0 m)는 뚫려 있다');
  assert.strictEqual(hits(D.walls, across(door, 2.2), [0, 0, 1], 0.8), 2, '문 위 상인방(2.2 m)은 막혀 있다');
  assert.strictEqual(hits(D.walls, [0.5 + eps[0], 1.0 + eps[1], -0.5], [0, 0, 1], 0.8), 2, '창에서 떨어진 북쪽 벽은 그대로 막혀 있다');
  const topHit = new THREE.Ray(new THREE.Vector3(0.5 + eps[0], 3, -0.075 + eps[1]), new THREE.Vector3(0, -1, 0)); // 벽 위에서 내려 쏜다
  const ys = tris(D.walls).map(([a, b, c]) => topHit.intersectTriangle(a, b, c, false, new THREE.Vector3())).filter(Boolean).map((p) => p.y);
  assert.deepStrictEqual(ys.map((y) => +y.toFixed(6)), [2.3], '벽은 서 있다 — 위에서 내려다보면 2.3 m 윗면 하나');

  /* ===== 3. 카메라 사양 ===== */
  const B = mesh.bounds, corners = [];
  for (const x of [B.x0, B.x1]) for (const y of [B.y0, B.y1]) for (const z of [B.z0, B.z1]) corners.push(new THREE.Vector3(x / 1000, z / 1000, y / 1000));
  const camOf = (spec, aspect) => { const c = spec.type === 'ortho' ? new THREE.OrthographicCamera() : new THREE.PerspectiveCamera(); V.applyCameraSpec(c, spec, aspect); return c; };
  const ndc = (cam, p) => p.clone().project(cam);
  const SEE = (cam, p) => { const q = ndc(cam, p); return Math.max(Math.abs(q.x), Math.abs(q.y)); };
  for (const aspect of [0.5, 1, 16 / 9, 3]) for (const view of ['plan', 'iso', 'free']) {
    const spec = V.cameraFor(view, B, aspect), cam = camOf(spec, aspect);
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const p of corners) assert.ok(fr.containsPoint(p), `${view} aspect ${aspect}: 경계 상자 모서리가 화면 안에 있어야 한다`);
    if (spec.type === 'ortho') { const m = Math.max(...corners.map((p) => SEE(cam, p))); assert.ok(m <= 1 && m >= 0.85, `${view} aspect ${aspect}: 직교는 화면을 알맞게 채운다 (${m.toFixed(3)})`); }
    else assert.ok(Math.max(...corners.map((p) => SEE(cam, p))) >= 0.5, `${view} aspect ${aspect}: 원근은 너무 멀리 물러나지 않는다`);
  }
  const plan = V.cameraFor('plan', B, 1.6), pc = camOf(plan, 1.6), cx = (B.x0 + B.x1) / 2000, cz = (B.y0 + B.y1) / 2000;
  assert.strictEqual(plan.type, 'ortho');
  const dirOf = (c) => c.getWorldDirection(new THREE.Vector3());
  assert.ok(dirOf(pc).y < -0.9999, '평면 보기는 곧장 아래를 본다');
  nearV([plan.pos[0], plan.pos[2]], [cx, cz], 0.01 * plan.dist, '평면 카메라는 경계 상자 중심 바로 위');
  const sw = ndc(pc, new THREE.Vector3(B.x0 / 1000, 0, B.y0 / 1000)), ne = ndc(pc, new THREE.Vector3(B.x1 / 1000, 0, B.y1 / 1000));
  assert.ok(sw.x < ne.x - 0.5 && sw.y > ne.y + 0.5, '평면 보기: 평면의 왼쪽·위쪽(x0,y0)이 화면의 왼쪽·위쪽 — 2D 와 같은 방향');
  const iso = V.cameraFor('iso', B, 1), d = new THREE.Vector3(...iso.pos).sub(new THREE.Vector3(...iso.target)).normalize();
  assert.strictEqual(iso.type, 'ortho'); nearV(d.toArray(), [0.5, Math.SQRT1_2, 0.5], 1e-9, 'ISO 는 방위 45°·고도 45°');
  const ic = camOf(iso, 1);
  assert.ok(ndc(ic, new THREE.Vector3(cx, 2.3, cz)).y > ndc(ic, new THREE.Vector3(cx, 0, cz)).y, 'ISO: 높은 곳이 화면 위');
  const free = V.cameraFor('free', B, 1.6);
  assert.strictEqual(free.type, 'persp'); near(free.fov, 40, 0); assert.ok(free.near > 0 && free.far > free.dist + free.radius * 4, '원근 깊이 범위가 목표 너머 4 반지름 이상');
  assert.ok(V.cameraFor('plan', B, 0.5).halfH > V.cameraFor('plan', B, 3).halfH, '좁은 세로 화면일수록 더 멀리(가로가 안 잘리게)');
  const e0 = V.cameraFor('iso', null, 1);
  assert.ok([...e0.pos, ...e0.target, e0.halfH, e0.near, e0.far].every(Number.isFinite), '경계가 없어도(빈 문서) 유한한 값');
  assert.ok(V.cameraFor('iso', B, 0).halfH > 0 && Number.isFinite(V.cameraFor('iso', B, NaN).halfH), '비율이 0·NaN 이어도 1 로');
  assert.throws(() => V.cameraFor('top', B, 1), /알 수 없는 보기/);

  /* ===== 4. createView3D: 모양과 실패 경로(WebGL·DOM 없는 node) ===== */
  const cont = { hidden: true, clientWidth: 0, clientHeight: 0, appendChild() { throw new Error('만들어지면 안 된다'); } };
  const empty = new Store(), v0 = V.createView3D(cont, empty);
  assert.deepStrictEqual(Object.keys(v0).sort(), ['destroy', 'hide', 'resize', 'setFloorAlpha', 'setView', 'setWallAlpha', 'show', 'stats', 'zoom']);
  assert.deepStrictEqual(v0.show(), { ok: false, reason: 'rooms' }, '방이 없으면 show() 대신 이유를 돌려준다');
  assert.strictEqual(cont.hidden, true, '실패하면 컨테이너를 보이지 않는다');
  assert.strictEqual(v0.setView('plan'), true); assert.strictEqual(v0.setView('top'), false);
  v0.setWallAlpha(0.3); v0.setFloorAlpha(7); v0.resize(); v0.hide();
  assert.deepStrictEqual({ ...v0.stats(), view: 0 }, { view: 0, rebuilds: 0, visible: false, geometries: 0, textures: 0, calls: 0, frames: 0, triangles: 0, pixelRatio: 0 });
  const v1 = V.createView3D(cont, st);
  assert.deepStrictEqual(v1.show(), { ok: false, reason: 'webgl' }, 'WebGL 을 못 만들면 reason:webgl');
  assert.strictEqual(cont.hidden, true);
  const n0 = 1; st.exec({ type: 'addColumn', kind: 'round', c: [3000, 2500] }); v1.destroy(); v1.destroy();
  assert.deepStrictEqual(v1.show(), { ok: false, reason: 'destroyed' }, 'destroy 뒤엔 show 가 거절한다');
  assert.strictEqual(v1.setView('iso'), false); st.exec({ type: 'addColumn', kind: 'rect', c: [3200, 2500] }); // 구독이 끊겨 있어야 한다(던지지 않는다)
  void n0;
  console.log('test-plan-3d: OK');
})().catch((e) => { console.error(e); process.exit(1); });
