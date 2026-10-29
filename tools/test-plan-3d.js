// 플래너 3D(maker/3d/plan/view3d.js) 순수 부분 시험 — buildMesh 결과 → 정점 자료(벽 구멍·에어컨 높이·면 방향)와 보기별 카메라 사양(화면 맞춤·방향)을 손으로 계산한 값으로 단언한다.
// 그리기 결과(픽셀)는 node 에서 못 보므로 단독 하네스 페이지에서 사람이 보고, 5번은 가짜 DOM·WebGL 로 createView3D 의 상태 전이(카메라 맞춤·흐림 복구·컨텍스트 복원)를 실제 코드로 돌린다. 변이 시험용으로 PLAN_3D_FILE 로 다른 사본(같은 폴더)을 가리킬 수 있다.
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
  assert.deepStrictEqual(Object.keys(v0).sort(), ['destroy', 'hide', 'isEmpty', 'resize', 'setFloorAlpha', 'setView', 'setWallAlpha', 'show', 'stats', 'zoom']);
  assert.strictEqual(typeof V.needsRefit, 'function');
  assert.strictEqual(v0.isEmpty(), true, '방이 없는 문서의 isEmpty()'); assert.strictEqual(V.createView3D(cont, st).isEmpty(), false, '방이 있으면 isEmpty() 는 false');
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

  /* ===== 4-1. needsRefit: 다른 모형일 때만 카메라를 다시 맞춘다 ===== */
  const d2 = (cur) => ({ cur });
  assert.strictEqual(V.needsRefit(0, d2(1), 'setCur'), true, '현재 층이 바뀌면 맞춘다(층 선택·층 추가·되돌리기)');
  assert.strictEqual(V.needsRefit(1, d2(0), 'undo'), true);
  assert.strictEqual(V.needsRefit(0, d2(0), 'replace'), true, '불러오기·새로 만들기는 층 번호가 같아도 다른 모형');
  for (const t of ['addRoomRect', 'moveItem', 'commit', 'cancel', 'undo', 'redo', 'setFloor']) assert.strictEqual(V.needsRefit(0, d2(0), t), false, `같은 층의 ${t} 는 카메라를 그대로 둔다`);

  /* ===== 5. 가짜 DOM·WebGL 로 실제 createView3D 상태 전이 ===== */
  const real = { st: globalThis.setTimeout, ct: globalThis.clearTimeout, raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  let clock = 0, tid = 0; const timers = new Map();
  globalThis.setTimeout = (fn, ms = 0) => { timers.set(++tid, { at: clock + ms, fn }); return tid; };
  globalThis.clearTimeout = (id) => { timers.delete(id); };
  const tick = (ms) => { const end = clock + ms; for (;;) { let b = null; for (const [id, t] of timers) if (t.at <= end && (!b || t.at < b[1].at)) b = [id, t]; if (!b) break; timers.delete(b[0]); clock = b[1].at; b[1].fn(); } clock = end; };
  let rafQ = []; globalThis.requestAnimationFrame = (fn) => { rafQ.push(fn); return rafQ.length; }; globalThis.cancelAnimationFrame = () => { rafQ = []; };
  const frames = () => { for (let i = 0; i < 3; i++) { const q = rafQ; rafQ = []; q.forEach((f) => f(performance.now() + 1e6)); } }; // 한 프레임이면 트윈이 끝난다
  class WebGL2RenderingContext {} globalThis.WebGL2RenderingContext = WebGL2RenderingContext;
  const consts = new Map();
  const fakeGL = (log) => { const gl = new Proxy(new WebGL2RenderingContext(), { get(t, k) { // 어떤 호출이든 받는 WebGL2 흉내 — three 가 묻는 값만 돌려준다
    if (k in t || typeof k !== 'string') return t[k];
    if (/^[A-Z][A-Z0-9_]+$/.test(k)) { if (!consts.has(k)) consts.set(k, consts.size + 1); return consts.get(k); }
    switch (k) {
      case 'getContextAttributes': return () => ({ alpha: true, depth: true, stencil: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false });
      case 'getParameter': return (q) => (q === gl.VERSION ? 'WebGL 2.0' : q === gl.SHADING_LANGUAGE_VERSION ? 'WebGL GLSL ES 3.00' : 16);
      case 'getExtension': return (n) => (n === 'WEBGL_lose_context' ? { loseContext() {}, restoreContext() {} } : null);
      case 'getShaderPrecisionFormat': return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
      case 'getProgramParameter': case 'getShaderParameter': return (a, q) => (q === gl.LINK_STATUS || q === gl.COMPILE_STATUS ? true : 0);
      case 'getProgramInfoLog': case 'getShaderInfoLog': case 'getShaderSource': return () => '';
      case 'isContextLost': return () => false;
      case 'getError': return () => 0;
      case 'checkFramebufferStatus': return () => gl.FRAMEBUFFER_COMPLETE;
      case 'clearColor': return (...a) => { log.clear.push(a); };
      case 'drawElements': case 'drawArrays': return () => { log.draws++; };
      default: return () => ({});
    }
  } }); return gl; };
  const gllog = { clear: [], draws: 0 };
  const mkCanvas = () => ({ style: {}, width: 300, height: 150, attrs: {}, on: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { (this.on[t] ??= []).push(f); }, removeEventListener() {}, getContext() { return (this.gl ??= fakeGL(gllog)); }, remove() {}, getRootNode: () => globalThis.document, fire(t, e = {}) { (this.on[t] || []).forEach((f) => f({ preventDefault() {}, ...e })); } });
  globalThis.self = { requestAnimationFrame: () => 0, cancelAnimationFrame() {} }; // three 의 애니메이션 루프가 쓴다(destroy 의 dispose)
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { documentElement: {}, hidden: false, createElement: mkCanvas, addEventListener() {}, removeEventListener() {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' }); // 토큰 CSS 없음 — FALLBACK 색을 쓴다
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  let lastCam = null; const before0 = THREE.Scene.prototype.onBeforeRender; // render() 가 장면마다 부르는 갈고리로 마지막에 그린 카메라를 잡는다
  THREE.Scene.prototype.onBeforeRender = function (r, sc, cam) { lastCam = cam; };
  try {
    const mkStore = () => { // 1층 4×3 m · 2층 6×5 m(멀리 x=30 m) · 3층은 빈 층으로 나중에
      const s = new Store();
      s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000], name: '1층' });
      s.exec({ type: 'addFloor' }); s.exec({ type: 'addRoomRect', a: [30000, 0], b: [36000, 5000], name: '2층' }); s.exec({ type: 'setCur', index: 0 });
      return s;
    };
    const mkView = (s, o = {}) => { const c = { hidden: true, clientWidth: 800, clientHeight: 600, children: [], appendChild(x) { this.children.push(x); } }; const v = V.createView3D(c, s, { view: 'iso', ...o }); return { v, c, cv: () => c.children[0] }; };
    const settle = () => { tick(500); frames(); };
    const specFor = (s, view = 'iso') => V.cameraFor(view, buildMesh(s.doc, s.doc.cur).bounds, 800 / 600);
    const isFit = (s, msg, view) => { const sp = specFor(s, view); nearV(lastCam.position.toArray(), sp.pos, 1e-6, msg + ' 위치'); near(lastCam.zoom, 1, 1e-9, msg + ' 확대 1배'); if (sp.type === 'ortho') near(lastCam.top, sp.halfH, 1e-6, msg + ' 화면 크기'); };

    /* 21. 보는 중에 층·문서가 바뀌면 새 모형에 맞춘다 */
    { const s = mkStore(); let empties = 0; const { v } = mkView(s, { onEmpty: () => empties++ });
      assert.deepStrictEqual(v.show(), { ok: true }); settle(); isFit(s, '처음 1층');
      v.zoom(2); frames(); near(lastCam.zoom, 2, 1e-9, '사용자가 확대했다');
      s.exec({ type: 'addColumn', kind: 'round', c: [2000, 1500] }); settle(); near(lastCam.zoom, 2, 1e-9, '같은 층 편집은 카메라를 그대로 둔다');
      s.exec({ type: 'setCur', index: 1 }); settle(); isFit(s, '2층으로 이동(사용자가 만진 뒤에도)');
      s.exec({ type: 'setCur', index: 0 }); settle(); isFit(s, '1층으로 복귀');
      const doc1 = JSON.parse(JSON.stringify(s.doc)); v.zoom(2); frames(); s.replace(doc1); settle(); isFit(s, '같은 층 번호의 문서 교체(불러오기)');
      assert.strictEqual(empties, 0); assert.strictEqual(v.isEmpty(), false);
      s.exec({ type: 'addFloor' }); settle(); // 층 추가 = 방 없는 새 층
      assert.strictEqual(v.isEmpty(), true, '빈 새 층'); assert.strictEqual(empties, 1, 'onEmpty 가 한 번 불린다');
      s.exec({ type: 'setFloor', patch: { heightMm: 2500 } }); settle(); assert.strictEqual(empties, 1, '빈 채로 이어지는 변경에서는 다시 부르지 않는다');
      s.exec({ type: 'setCur', index: 1 }); settle(); isFit(s, '빈 층에서 방 있는 층으로'); assert.strictEqual(v.isEmpty(), false); assert.strictEqual(empties, 1);
      s.replace(new Store().doc); settle(); assert.strictEqual(empties, 2, '새로 만들기 → 방이 없으니 다시 알린다'); // createDoc 기본 문서는 방이 없다
      assert.deepStrictEqual(v.show(), { ok: false, reason: 'rooms' }, '빈 문서는 다시 열 수 없다');
      v.destroy(); }
    { const s = mkStore(); const { v } = mkView(s, { onEmpty() { throw new Error('앱 쪽 오류'); } }); // onEmpty 가 던져도 뷰는 멀쩡하다
      v.show(); settle(); const err = console.error; console.error = () => {}; try { s.replace(new Store().doc); settle(); } finally { console.error = err; }
      assert.strictEqual(v.isEmpty(), true); v.destroy(); }
    { const s = mkStore(), { v } = mkView(s); // 숨겨 둔 동안 층이 바뀌면 다시 열 때 맞춘다
      v.show(); settle(); v.hide(); s.exec({ type: 'setCur', index: 1 }); tick(500); assert.deepStrictEqual(v.show(), { ok: true }); settle(); isFit(s, '숨긴 동안 바뀐 층'); v.destroy(); }

    /* 22. 보기 전환 연타: 어떤 순서에서도 마지막엔 보이고(opacity 1) 마지막 보기의 투영이다 */
    { const s = mkStore(), { v, cv } = mkView(s); v.show(); settle();
      v.setView('free'); v.setView('iso'); assert.strictEqual(cv().style.opacity, '1', '직교→원근을 누르자마자 직교로 되돌리면 바로 보인다');
      settle(); assert.strictEqual(cv().style.opacity, '1'); assert.ok(lastCam.isOrthographicCamera);
      v.setView('free'); tick(30); assert.strictEqual(cv().style.opacity, '0', '흐려지는 중'); tick(100); assert.strictEqual(cv().style.opacity, '1', '100ms 뒤 원근으로 바뀌며 보인다');
      let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
      for (let t = 0; t < 300; t++) {
        const seq = Array.from({ length: 2 + rnd(5) }, () => ['plan', 'iso', 'free'][rnd(3)]), gaps = seq.map(() => [0, 10, 50, 99, 100, 101, 150, 400][rnd(8)]);
        seq.forEach((n, i) => { v.setView(n); tick(gaps[i]); }); settle();
        assert.strictEqual(cv().style.opacity, '1', `연타 ${seq} / ${gaps} 뒤 opacity`);
        assert.strictEqual(!!lastCam.isOrthographicCamera, V.VIEWS[seq.at(-1)].type === 'ortho', `연타 ${seq} 뒤 투영`);
      }
      v.destroy(); }

    /* 23. WebGL 컨텍스트 복원 뒤 배경색을 테마색으로 다시 입히고 곧바로 한 번 그린다 */
    { const s = mkStore(), { v, cv } = mkView(s); v.show(); settle();
      const bg = new THREE.Color('#F3F2EF').getRGB({}, THREE.SRGBColorSpace), lastClear = () => gllog.clear.at(-1);
      nearV(lastClear().slice(0, 3), [bg.r, bg.g, bg.b], 1 / 255, '손실 전 배경은 테마색'); assert.strictEqual(lastClear()[3], 1);
      const d0 = gllog.draws, log0 = console.log; console.log = () => {}; // three 가 손실·복원을 console.log 로 알린다
      try { cv().fire('webglcontextlost'); cv().fire('webglcontextrestored'); } finally { console.log = log0; }
      assert.ok(gllog.draws > d0, '복원 직후 한 번 그린다');
      nearV(lastClear().slice(0, 3), [bg.r, bg.g, bg.b], 1 / 255, '복원 뒤 배경이 검정이 아니라 테마색'); assert.strictEqual(lastClear()[3], 1);
      v.destroy(); }

    /* 24. 가전(kind:'appliance')이 든 문서: 다시 지어도 지오메트리가 새지 않고, 가전을 지우면 그 조각이 내려간다 */
    { const s = mkStore(), FR = { type: 'addItem', kind: 'appliance', category: 'refrigerator', brand: 'samsung', model: 'RM90H64P2W', name: '냉장고', size: [912, 683], heightMm: 1853 };
      s.exec({ ...FR, c: [1000, 1000] }); s.exec({ ...FR, c: [2500, 1000], category: 'tv', model: 'TV1', size: [1437, 302], heightMm: 890 }); s.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'samsung', c: [2000, 2000], size: [1198, 500] });
      const { v } = mkView(s); assert.deepStrictEqual(v.show(), { ok: true }); settle();
      const g0 = v.stats().geometries; assert.strictEqual(g0, 4, '벽·바닥·에어컨·가전 지오메트리 넷');
      for (let i = 0; i < 6; i++) { s.exec({ ...FR, c: [3000 + i * 10, 1500] }); settle(); s.undo(); settle(); s.exec({ type: 'move', ids: ['I1'], dx: 10, dy: 0 }); settle(); }
      assert.strictEqual(v.stats().geometries, g0, '가전을 놓고 지우고 옮겨도 지오메트리 수가 그대로(누수 0)'); assert.strictEqual(v.stats().textures, 0);
      assert.ok(v.stats().rebuilds >= 18, '다시 지었다');
      s.exec({ type: 'remove', ids: ['I1', 'I2'] }); settle(); assert.strictEqual(v.stats().geometries, g0 - 1, '가전이 모두 없어지면 그 지오메트리는 내려간다');
      s.undo(); settle(); assert.strictEqual(v.stats().geometries, g0, '되돌리면 다시 올라온다');
      v.hide(); s.exec({ ...FR, c: [4500, 2500] }); tick(500); const r0 = v.stats().rebuilds; frames(); assert.strictEqual(v.stats().rebuilds, r0, '숨기는 동안은 다시 짓지 않는다(렌더 중지)'); v.show(); settle(); assert.strictEqual(v.stats().geometries, g0, '다시 열 때 한 번 반영');
      v.destroy(); }
  } finally { THREE.Scene.prototype.onBeforeRender = before0; delete globalThis.self; Object.assign(globalThis, { setTimeout: real.st, clearTimeout: real.ct, requestAnimationFrame: real.raf, cancelAnimationFrame: real.caf }); }
  console.log('test-plan-3d: OK');
})().catch((e) => { console.error(e); process.exit(1); });
