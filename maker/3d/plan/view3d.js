// 3D 보기 — 평면 문서(store)를 three 로 세워 평면·ISO·일반 세 시점으로 보여 준다. 벽·바닥·에어컨을 재질별 한 덩어리로 합쳐 만들고, 정점 자료·카메라 계산은 순수 함수로 export 해 node 에서 시험한다
import * as THREE from '../view/lib/three-0.160.0/three.module.min.js';
import { OrbitControls } from '../view/lib/three-0.160.0/OrbitControls.js';
import { buildMesh } from './core/mesh3d.js';
import { signedArea } from './core/geom.js';

const MM = 0.001, RAD = Math.PI / 180;      // mm → m, 도 → 라디안. three 좌표: x 오른쪽 · y 위 · z 아래쪽(평면의 y), 단위 m
const BODY_SCALE = 0.8;                      // 에어컨 본체(천장 속)는 판넬보다 한 겹 작다
const REBUILD_MS = 80;                       // store 변경이 몰릴 때(드래그) 한 번만 다시 짓는다
const FIT = 1.1;                             // 화면맞춤 여백
export const VIEWS = Object.freeze({
  plan: { type: 'ortho', az: 0, el: 89.9 },  // 위에서 직교 — 정확히 90° 면 시선이 up 과 겹쳐 방향이 깨지므로 0.1° 비킨다. 화면 위 = 평면 위(−y)
  iso: { type: 'ortho', az: 45, el: 45 },
  free: { type: 'persp', az: 35, el: 38, fov: 40 },
});

/* ---------- 순수 계산 1: buildMesh 결과 → 정점·인덱스 자료 ---------- */
const soup = () => ({ pos: [], idx: [] });
const fin = (s) => ({ pos: Float32Array.from(s.pos), idx: Uint32Array.from(s.idx) });

// 평평한 다각형 한 장(높이 y mm). up=true 면 위를, false 면 아래를 본다. 오목해도 된다
function addFace(out, poly, y, up) {
  const base = out.pos.length / 3;
  for (const p of poly) out.pos.push(p[0] * MM, y * MM, p[1] * MM);
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(poly.map((p) => new THREE.Vector2(p[0], p[1])), [])) {
    const u = [poly[b][0] - poly[a][0], poly[b][1] - poly[a][1]], v = [poly[c][0] - poly[a][0], poly[c][1] - poly[a][1]];
    const faceUp = u[1] * v[0] - u[0] * v[1] > 0; // (b−a)×(c−a) 의 y 성분(three z = 평면 y)
    out.idx.push(base + a, ...(faceUp === up ? [base + b, base + c] : [base + c, base + b]));
  }
}
// 기둥꼴: 옆면은 바깥을 본다(평면 시계방향으로 맞춘 뒤 A,D,C / A,C,B). bottom=false 면 바닥 면은 만들지 않는다(안 보인다)
function addPrism(out, poly, z0, z1, bottom) {
  const ring = signedArea(poly) >= 0 ? poly : poly.slice().reverse();
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length], k = out.pos.length / 3;
    out.pos.push(p[0] * MM, z0 * MM, p[1] * MM, q[0] * MM, z0 * MM, q[1] * MM, q[0] * MM, z1 * MM, q[1] * MM, p[0] * MM, z1 * MM, p[1] * MM);
    out.idx.push(k, k + 3, k + 2, k, k + 2, k + 1);
  });
  addFace(out, ring, z1, true);
  if (bottom) addFace(out, ring, z0, false);
}
// buildMesh(doc) 결과 → {walls, floors, ac} 각각 {pos:Float32Array(x,y,z 연속), idx:Uint32Array}. 벽은 개구부로 이미 나뉜 조각 그대로(구멍은 조각 사이의 빈틈)
export function meshData(mesh) {
  const W = soup(), F = soup(), A = soup();
  for (const w of mesh.walls) addPrism(W, w.poly, w.z0, w.z1, w.z0 > 0);          // 상인방 밑면만 보인다
  for (const f of mesh.floors) { if (f.thickness > 0) addPrism(F, f.poly, -f.thickness, 0, false); else addFace(F, f.poly, 0, true); }
  for (const i of mesh.items) { // 판넬은 천장면(mountZ) 아래로 얇게, 본체는 그 위(천장 속)로
    addPrism(A, i.poly, i.z0, i.z1, true);
    addPrism(A, i.poly.map((p) => [i.c[0] + (p[0] - i.c[0]) * BODY_SCALE, i.c[1] + (p[1] - i.c[1]) * BODY_SCALE]), i.mountZ, i.mountZ + i.bodyH, false);
  }
  return { walls: fin(W), floors: fin(F), ac: fin(A) };
}
export function soupBounds(s) { // 정점 자료의 경계 {min:[x,y,z], max:[x,y,z]}(m), 비었으면 null
  if (!s.pos.length) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < s.pos.length; i++) { const k = i % 3; if (s.pos[i] < min[k]) min[k] = s.pos[i]; if (s.pos[i] > max[k]) max[k] = s.pos[i]; }
  return { min, max };
}
export function geometryOf(s) { // 정점 자료 → BufferGeometry(면마다 정점이 따로라 평면 음영)
  const g = new THREE.BufferGeometry();
  if (!s.idx.length) return g;
  g.setAttribute('position', new THREE.BufferAttribute(s.pos, 3));
  g.setIndex(new THREE.BufferAttribute(s.idx, 1));
  g.computeVertexNormals();
  return g;
}

/* ---------- 순수 계산 2: 보기별 카메라 사양 ---------- */
const EMPTY = { x0: 0, y0: 0, x1: 4000, y1: 4000, z0: 0, z1: 2300 };
// bounds = buildMesh 의 bounds(mm, 평면 좌표 + z). 돌려주는 사양은 three 좌표(m): {type, pos, target, halfH(직교: 화면 높이의 반), fov(원근), near, far, dist, radius}
// 직교는 경계 상자 여덟 모서리가 화면에 다 들어오는 가장 작은 크기(+여백), 원근은 경계 구가 들어오는 거리
export function cameraFor(view, bounds, aspect = 1) {
  const V = VIEWS[view];
  if (!V) throw new Error('알 수 없는 보기입니다: ' + view);
  const b = bounds ?? EMPTY, a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const target = [((b.x0 + b.x1) / 2) * MM, ((b.z0 + b.z1) / 2) * MM, ((b.y0 + b.y1) / 2) * MM];
  const h = [((b.x1 - b.x0) / 2) * MM, ((b.z1 - b.z0) / 2) * MM, ((b.y1 - b.y0) / 2) * MM];
  const R = Math.hypot(...h) || 0.5, az = V.az * RAD, el = V.el * RAD;
  const d = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];   // 목표 → 카메라
  const r = [Math.cos(az), 0, -Math.sin(az)], u = [r[2] * d[1], -r[2] * d[0] + r[0] * d[2], -r[0] * d[1]]; // 화면 오른쪽·위
  const ext = (v) => Math.abs(v[0]) * h[0] + Math.abs(v[1]) * h[1] + Math.abs(v[2]) * h[2]; // 상자를 v 방향으로 잰 반폭
  const at = (dist) => target.map((t, i) => t + d[i] * dist);
  if (V.type === 'ortho') { const dist = R * 3; return { view, type: 'ortho', target, pos: at(dist), halfH: Math.max(ext(u), ext(r) / a) * FIT, dist, radius: R, near: dist * 0.1, far: dist * 3 }; }
  const half = Math.min((V.fov * RAD) / 2, Math.atan(Math.tan((V.fov * RAD) / 2) * a)), dist = (R / Math.sin(half)) * FIT;
  return { view, type: 'persp', target, pos: at(dist), fov: V.fov, dist, radius: R, near: 0.05, far: dist * 6 };
}
export function applyCameraSpec(cam, s, aspect = 1) { // 사양을 카메라에 그대로 입힌다(확대 1배로 되돌린다)
  cam.position.set(...s.pos); cam.up.set(0, 1, 0);
  if (s.type === 'ortho') { cam.top = s.halfH; cam.bottom = -s.halfH; cam.right = s.halfH * aspect; cam.left = -cam.right; } else { cam.fov = s.fov; cam.aspect = aspect; }
  cam.near = s.near; cam.far = s.far; cam.zoom = 1;
  cam.lookAt(...s.target); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}

/* ---------- 화면 쪽 ---------- */
const FALLBACK = { '--c-bg': '#F3F2EF', '--c-surface': '#FFFFFF', '--c-line-strong': '#D8D4CA', '--c-accent': '#2D4A9E' }; // 토큰 CSS 가 없는 곳(시험)용 — 실제 쓰는 값은 getComputedStyle 이 읽는다
const tok = (n) => { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || FALLBACK[n]; } catch { return FALLBACK[n]; } };
const tokMs = (n, d) => { const v = parseFloat(tok(n)); return v > 0 ? v : d; };
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // easeInOutCubic — --ease 와 같은 곡선
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 1));

// opts: { view:'iso', finishColor?(kind:'wall'|'floor', finishId)→css 색|falsy } — 마감재 id 를 색으로 바꾸는 함수는 마감재 데이터를 가진 쪽(패널)이 넘긴다
export function createView3D(container, store, opts = {}) {
  let view = VIEWS[opts.view] ? opts.view : 'iso', visible = false, dead = false, dirty = true, fitPending = true, rebuilds = 0, bounds = null;
  let renderer, canvas, controls, ro, raf = 0, inFrame = false, tw = null, fadeSeq = 0, fadeT = 0, fading = false, buildT = 0, moved = false, applied = null;
  const scene = new THREE.Scene();
  const mat = () => new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const mats = { wall: mat(), floor: mat(), ac: mat() };
  const meshes = Object.fromEntries(Object.entries(mats).map(([k, m]) => { const o = new THREE.Mesh(new THREE.BufferGeometry(), m); o.frustumCulled = false; o.visible = false; scene.add(o); return [k, o]; }));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-3, 6, 4);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2), sun); // 조명 둘 — 그림자 없음
  const persp = new THREE.PerspectiveCamera(VIEWS.free.fov, 1, 0.05, 100), ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  let camera = VIEWS[view].type === 'ortho' ? ortho : persp;

  const aspect = () => { const w = container.clientWidth, h = container.clientHeight; return w && h ? w / h : 1; };
  const draw = () => { if (renderer && container.clientWidth) renderer.render(scene, camera); };
  const requestRender = () => { if (!raf && visible && !dead && renderer && !document.hidden) raf = requestAnimationFrame(frame); };
  function frame(now) {
    raf = 0;
    if (!visible || dead || !container.clientWidth) return;
    inFrame = true;
    if (renderer.getPixelRatio() !== Math.min(window.devicePixelRatio || 1, 2)) resize(); // 배율 변화 알림을 놓쳤을 때의 안전망
    if (tw) stepTween(now);
    draw();
    inFrame = false;
    if (tw) requestRender();
  }

  /* 문서 → 장면 */
  function theme(f) {
    const pick = (kind, def) => { try { return opts.finishColor?.(kind, f?.finish?.[kind]) || def; } catch { return def; } };
    mats.wall.color.set(pick('wall', tok('--c-surface')));
    mats.floor.color.set(pick('floor', tok('--c-line-strong')));
    mats.ac.color.set(tok('--c-accent'));
    renderer?.setClearColor(new THREE.Color(tok('--c-bg')), 1);
  }
  function rebuild() {
    clearTimeout(buildT); buildT = 0;
    dirty = false; rebuilds++;
    const doc = store.doc, f = doc.floors[doc.cur], mesh = buildMesh(doc, doc.cur), data = meshData(mesh), key = { walls: 'wall', floors: 'floor', ac: 'ac' };
    for (const [k, mk] of Object.entries(key)) { const o = meshes[mk]; o.geometry.dispose(); o.geometry = geometryOf(data[k]); o.visible = data[k].idx.length > 0; }
    bounds = mesh.bounds; fitPending = true;
    theme(f);
    applyAlpha();
  }
  function applyAlpha() { // 반투명이면 깊이를 쓰지 않아야 뒤의 것이 비친다
    for (const [k, a] of [['wall', wallA], ['floor', floorA]]) { const m = mats[k]; m.transparent = a < 1; m.opacity = a; m.depthWrite = a >= 1; meshes[k].visible = a > 0 && meshes[k].geometry.index !== null; }
    requestRender();
  }
  let wallA = clamp01(opts.wallAlpha), floorA = clamp01(opts.floorAlpha);

  /* 카메라 */
  function limits(spec) {
    const free = spec.view === 'free';
    controls.enableRotate = free;
    controls.mouseButtons = { LEFT: free ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: free ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.minDistance = spec.type === 'persp' ? spec.dist * 0.1 : 0; controls.maxDistance = spec.type === 'persp' ? spec.dist * 4 : Infinity; // 직교의 거리는 확대와 무관하다
    controls.minZoom = 0.3; controls.maxZoom = 20;
  }
  function place(spec) { applyCameraSpec(camera, spec, aspect()); controls.target.set(...spec.target); controls.update(); }
  function go(name, instant) { // 보기를 바꾼다. 같은 투영끼리는 카메라가 날아가고, 직교↔원근은 화면이 흐려졌다 바뀐다
    const spec = cameraFor(name, bounds, aspect()), want = spec.type === 'ortho' ? ortho : persp, seq = ++fadeSeq;
    clearTimeout(fadeT); fading = false; tw = null; controls.enabled = true; limits(spec); applied = name; moved = false;
    const still = instant || reduced();
    if (want !== camera) {
      const swap = () => { if (seq !== fadeSeq || dead) return; fading = false; camera = want; controls.object = want; place(spec); canvas.style.opacity = '1'; requestRender(); };
      if (still) swap(); else { fading = true; canvas.style.opacity = '0'; fadeT = setTimeout(swap, tokMs('--t-fast', 100)); }
    } else if (still) { place(spec); requestRender(); }
    else {
      camera.near = spec.near; camera.far = spec.far;
      tw = { t0: performance.now(), dur: tokMs('--t-slow', 350), spec, from: { pos: camera.position.clone(), target: controls.target.clone(), size: camera.top, zoom: camera.zoom } };
      controls.enabled = false; requestRender();
    }
  }
  function stepTween(now) {
    const k = Math.min(1, Math.max(0, (now - tw.t0) / tw.dur)), e = ease(k), { spec, from } = tw;
    if (k >= 1) { tw = null; controls.enabled = true; place(spec); return; }
    camera.position.lerpVectors(from.pos, new THREE.Vector3(...spec.pos), e);
    controls.target.lerpVectors(from.target, new THREE.Vector3(...spec.target), e);
    camera.zoom = from.zoom + (1 - from.zoom) * e;
    if (spec.type === 'ortho') { camera.top = from.size + (spec.halfH - from.size) * e; camera.bottom = -camera.top; camera.right = camera.top * aspect(); camera.left = -camera.right; }
    camera.lookAt(controls.target); camera.updateProjectionMatrix(); controls.update();
  }

  /* 화면 만들기·크기 */
  function ensureGL() { // WebGL 을 처음 보일 때 만든다 — 못 만들면 false
    if (renderer) return true;
    try {
      canvas = document.createElement('canvas');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      if (!renderer.getContext()) throw new Error('webgl');
    } catch { renderer?.dispose(); renderer = canvas = null; return false; }
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', transition: 'opacity var(--t-fast) var(--ease)' });
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', '도면 입체 보기');
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', requestRender);
    container.appendChild(canvas);
    controls = new OrbitControls(camera, canvas);
    controls.zoomToCursor = true; controls.maxPolarAngle = Math.PI / 2 - 0.02;               // 바닥 밑으로 못 간다
    controls.addEventListener('change', () => { if (!inFrame) requestRender(); });
    controls.addEventListener('start', () => { moved = true; });
    ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    ro?.observe(container);
    window.addEventListener('resize', resize);   // 확대(Ctrl +/−)는 창 resize 로 온다
    watchDpr();                                  // 배율이 다른 모니터로 옮길 때는 창 크기가 그대로라 resize 가 오지 않는다
    document.addEventListener('visibilitychange', onVis);
    return true;
  }
  let mq = null;
  const onDpr = () => { resize(); watchDpr(); };
  function watchDpr() { try { mq?.removeEventListener('change', onDpr); mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`); mq.addEventListener('change', onDpr); } catch { mq = null; } }
  function resize() {
    if (!renderer || dead) return;
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return; // 숨겨져 있으면 다음 크기 알림에서
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false); // CSS 크기는 100% 가 맡는다. 크기를 바꾸면 그림이 지워지므로 곧바로 다시 그린다
    persp.aspect = w / h; persp.updateProjectionMatrix();
    ortho.right = ortho.top * (w / h); ortho.left = -ortho.right; ortho.updateProjectionMatrix();
    if (!moved && !tw && !fading && applied) place(cameraFor(applied, bounds, w / h)); // 손대지 않은 화면은 크기가 바뀌어도 모형이 다 보이게 다시 맞춘다(패널 접기·펼치기)
    draw();
  }
  const onVis = () => { if (!document.hidden) requestRender(); };
  const unsub = store.subscribe((e) => {
    if (e.type === 'rename' || e.type === 'setUnderlay') return;
    dirty = true;
    if (visible) { clearTimeout(buildT); buildT = setTimeout(() => { rebuild(); fitPending = false; requestRender(); }, REBUILD_MS); } // 보는 중의 변경은 카메라를 건드리지 않는다
  });

  /* 공개 */
  function show() {
    if (dead) return { ok: false, reason: 'destroyed' };
    const doc = store.doc;
    if (!doc.floors[doc.cur].rooms.length) return { ok: false, reason: 'rooms' };
    if (!ensureGL()) return { ok: false, reason: 'webgl' };
    container.hidden = false; visible = true;
    if (dirty) rebuild(); else theme(doc.floors[doc.cur]);
    resize();
    if (fitPending || applied !== view) { fitPending = false; go(view, true); }
    draw(); requestRender();
    return { ok: true };
  }
  function hide() {
    visible = false; clearTimeout(buildT); buildT = 0; if (raf) { cancelAnimationFrame(raf); raf = 0; } tw = null;
    if (controls) controls.enabled = true;
    container.hidden = true;
  }
  function setView(name) {
    if (!VIEWS[name] || dead) return false;
    view = name;
    if (visible && renderer) go(name, false);
    return true;
  }
  function zoom(f) { // 확대(>1)·축소(<1) — 단추용. 직교는 배율, 원근은 목표를 향해 다가간다
    if (!visible || !renderer || !(f > 0)) return;
    moved = true;
    if (camera === ortho) { camera.zoom = Math.min(controls.maxZoom, Math.max(controls.minZoom, camera.zoom * f)); camera.updateProjectionMatrix(); }
    else { const off = camera.position.clone().sub(controls.target), len = Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() / f)); camera.position.copy(controls.target).addScaledVector(off.normalize(), len); }
    controls.update(); requestRender();
  }
  function destroy() {
    if (dead) return;
    dead = true; visible = false;
    unsub(); ro?.disconnect();
    if (renderer) { window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis); mq?.removeEventListener('change', onDpr); }
    clearTimeout(buildT); clearTimeout(fadeT); if (raf) cancelAnimationFrame(raf);
    controls?.dispose();
    for (const o of Object.values(meshes)) o.geometry.dispose();
    for (const m of Object.values(mats)) m.dispose();
    if (renderer) { renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); } // 브라우저의 WebGL 문맥 수 제한(약 16)을 돌려준다
    renderer = canvas = controls = null;
  }
  return {
    show, hide, setView, zoom, resize, destroy,
    setWallAlpha(a) { wallA = clamp01(a); applyAlpha(); },
    setFloorAlpha(a) { floorA = clamp01(a); applyAlpha(); },
    stats: () => ({ view, rebuilds, visible, geometries: renderer?.info.memory.geometries ?? 0, textures: renderer?.info.memory.textures ?? 0, calls: renderer?.info.render.calls ?? 0, frames: renderer?.info.render.frame ?? 0, triangles: renderer?.info.render.triangles ?? 0, pixelRatio: renderer?.getPixelRatio() ?? 0 }),
  };
}
