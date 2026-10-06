import * as THREE from './lib/three-0.160.0/three.module.min.js';
import { OrbitControls } from './lib/three-0.160.0/OrbitControls.js';

// 값이 박혀 있으면(build.py index.html) 그것, 없으면 ?scene=<이름> 으로 같은 폴더의 <이름>.json(build.py scene.json = {data, checks})
// — 다른 사이트에 뷰어 파일은 그대로 두고 장면만 자료로 얹을 때. 못 받으면 ready 가 안 나가 부모의 대신 그림이 남는다
const Q = new URLSearchParams(location.search);
const INLINE = /*@DATA@*/null;
const BUNDLE = INLINE ? { data: INLINE, checks: /*@CHECKS@*/null } : await loadBundle(Q.get('scene') || '');
const DATA = BUNDLE.data, CHECKS = BUNDLE.checks;
async function loadBundle(name) {
  if (!/^[a-z0-9_-]{1,40}$/.test(name)) throw new Error('scene name'); // 이름만 — 주소·경로를 받지 않는다
  const r = await fetch(`${name}.json?v=${encodeURIComponent(Q.get('v') || '')}`);
  if (!r.ok) throw new Error(`scene ${r.status}`);
  return r.json();
}
const KEYS = Object.keys(DATA);

/* ============ helpers ============ */
const DEG = Math.PI / 180;
const mm = v => v / 1000;
// plan (x east, y north, z up, mm) -> three (x, y up, -z north, m) — same as home3d
const V = (x, y, z = 0) => new THREE.Vector3(x / 1000, z / 1000, -y / 1000);
// 꺾은선 관: 꼭짓점마다 표본(등간격 표본은 짧은 다리의 모서리를 깎는다) + 30° 넘게 꺾인 곳에 이음 구
class PolyCurve extends THREE.Curve {
  constructor(pts) { super(); this.p = pts; }
  getPoint(t, o = new THREE.Vector3()) { const n = this.p.length - 1, x = Math.min(t * n, n - 1e-6), i = Math.floor(x); return o.copy(this.p[i]).lerp(this.p[i + 1], x - i); }
  getUtoTmapping(u) { return u; }
}
function tube(pts, r, mat, grp) {
  const v = [];
  for (const q of pts) { const w = V(...q); if (!v.length || v[v.length - 1].distanceTo(w) > 1e-4) v.push(w); }
  if (v.length < 2) return;
  // 꺾인 꼭짓점 앞뒤에 점을 하나씩 더 넣어 링이 구간에 수직으로 서게 한다(안 넣으면 짧은 내림관이 쐐기처럼 납작해진다)
  const w = [v[0]];
  for (let i = 1; i < v.length - 1; i++) {
    const da = v[i].clone().sub(v[i - 1]), db = v[i + 1].clone().sub(v[i]), la = da.length(), lb = db.length();
    if (da.clone().normalize().dot(db.clone().normalize()) < .87) {
      w.push(v[i].clone().addScaledVector(da, -Math.min(r / 2, la / 3) / la), v[i], v[i].clone().addScaledVector(db, Math.min(r / 2, lb / 3) / lb));
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat); s.position.copy(v[i]); grp.add(s);
    } else w.push(v[i]);
  }
  w.push(v[v.length - 1]);
  grp.add(new THREE.Mesh(new THREE.TubeGeometry(new PolyCurve(w), w.length - 1, r, 8, false), mat));
}
const bbox = poly => {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
const inBox = (p, poly) => { const [x0, y0, x1, y1] = bbox(poly); return p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1; };
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n0 = v => Number(v).toLocaleString('ko-KR');
const n1 = v => Number(v).toFixed(1);
const n2 = v => Number(v).toFixed(2);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const short = s => s.replace(/\(.*\)/, '');

const KIND_KO = { apartment: '아파트', residential: '주거', office: '사무실', cafe: '카페', retail: '매장', clinic: '병원', dental: '치과', hospital: '병원', salon: '미용실', academy: '학원', restaurant: '음식점', gym: '헬스장', bakery: '베이커리', pharmacy: '약국' };
const kindKo = t => KIND_KO[t] || '공간'; // 모르는 space_type 이면 내부 id 를 화면에 노출하지 않는다
// 화면에 보이는 평수 = 세대(공간) 전체. 부하 산정용 target_pyeong 이 냉방 대상만일 때는 unit_pyeong 을 따로 둔다
const pyShow = P => P.envelope.unit_pyeong ?? P.envelope.target_pyeong;
const pyLabel = P => (P.envelope.unit_pyeong != null ? '' : '냉방 ') + pyShow(P);   // 세대 평형이 없으면 냉방 대상 실 합(평형과 헷갈리지 않게)
const MODEL_KO = { '4way': '4Way', mini_4way: '미니 4Way', '1way': '1Way' };
// 평형은 1Way 라인업 표(capacity.md, check_commercial.py LINEUP_1WAY_PYEONG)에 있는 kW 만. 그 밖은 kW 만. JSON pyeong 은 보지 않는다
const PY_1WAY = { 7.2: 18, 6.0: 15, 5.2: 13, 4.0: 10, 3.2: 8, 2.3: 6, 2.0: 5 };
const pyOf = u => u.model.startsWith('1way') ? PY_1WAY[u.capacity_kw] : undefined;
const cap = u => `${pyOf(u) ? pyOf(u) + '평형 · ' : ''}${n1(u.capacity_kw)}kW`;
const VIEW_KO = { wide_diagonal: '대각 와이드', wide_reverse: '역샷', medium: '미디엄', hero: '설득용 와이드', ac_closeup: '당긴 구도', auto: '실내기 쪽' };
// short name_ko prefix ("역샷 - …", "인서트 - …") tells two views of the same kind apart; long prefixes fall back to the kind
const viewKo = v => { const h = v.name_ko.split(' - ')[0]; return h.length <= 4 ? h : (VIEW_KO[v.kind] || v.kind); };
const SEAT_KO = { desk: '데스크', meeting: '회의', pantry: '탕비', cafe: '카페' };
const LV_KO = { PASS: '통과', WARN: '주의', INFO: '참고', FAIL: '실패' };
const PALETTE = { office: { wall: 0xEDEFEF }, cafe: { wall: 0xE9E3D9 }, default: { wall: 0xECEDEC } }; // visual choice by space_type, not plan data

const state = { mode: 'house', zone: null, view: 0, unit: null, pipes: true, grid: true, air: false, k: 0, tanP: 0, hover: null, autoCollapsed: false };
// ---- embed: 부모(히어로)가 덮는 영역·요청 렌더 ----
const EMBED = document.documentElement.classList.contains('embed');
let inset = { l: 0, r: 0, t: 0, b: 0 }, frameQueued = false, readySent = false;
// embed 는 멈춰 있을 때 그리지 않는다: 위에 backdrop-filter 유리가 얹혀 매 프레임 그리면 GPU 가 계속 돈다
function invalidate() { if (EMBED && !frameQueued) { frameQueued = true; requestAnimationFrame(tick); } }
const post = m => { if (EMBED && parent !== window) parent.postMessage({ ns: 'bd3d', viewer: 'commercial', ...m }, '*'); };
let S = null; // active space
const spaces = {};

/* ============ renderer / scene ============ */
const stage = $('stage');
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 1500);
const controls = new OrbitControls(camera, canvas);

// 2026-10-02 대표 '휴대폰에서 3D 위 스크롤이 안 내려감·첫 탭이 안 먹음' — 사이트 안(embed)에서는 세로 스와이프는 페이지로,
// 가로 드래그만 회전. OrbitControls 가 생성자에서 touch-action:none 을 인라인으로 박으므로 바로 뒤에 덮어쓴다.
// 터치 중에는 위아래 각을 잠가 가로 회전만(놓으면 모드별 범위로 되돌린다)
let polarSaved = null; // 터치 중 잠근 위아래 범위 — configControls 가 그동안 새 범위를 넣으면 여기로 받는다
if (EMBED) {
  canvas.style.touchAction = 'pan-y';
  document.documentElement.style.overscrollBehavior = 'auto';
  let dampSaved = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch' || polarSaved) return;
    polarSaved = [controls.minPolarAngle, controls.maxPolarAngle];
    // 감쇠를 켠 채 잠그면 잠긴 세로 몫이 쌓였다가 놓는 순간 적용돼 모형이 기울었다(10-02 검토) — 터치 동안 감쇠를 끈다
    dampSaved = controls.enableDamping; controls.enableDamping = false;
    controls.minPolarAngle = controls.maxPolarAngle = controls.getPolarAngle();
  }, true);
  const polarUnlock = () => {
    if (!polarSaved) return;
    controls.update();
    [controls.minPolarAngle, controls.maxPolarAngle] = polarSaved; polarSaved = null;
    controls.enableDamping = dampSaved;
  };
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, polarUnlock, true);
}
controls.enableDamping = !reduced.matches;
controls.dampingFactor = 0.08;
const CUT = 1000; // cutaway height in the overview (visual choice, not a plan value)

/* ============ textures ============ */
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function canvasTex(size, draw, repeatM) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / repeatM, 1 / repeatM);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  return t;
}
const carpetTex = canvasTex(512, (x, S) => { // 4 carpet tiles, quarter-turned pile
  const r = rng(7), h = S / 2;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    x.fillStyle = `hsl(204 6% ${58 + r() * 3}%)`; x.fillRect(i * h, j * h, h, h);
    x.globalAlpha = .09; x.fillStyle = '#1d2a30';
    for (let k = 0; k < 60; k++) (i + j) % 2 ? x.fillRect(i * h, j * h + r() * h, h, 1) : x.fillRect(i * h + r() * h, j * h, 1, h);
    x.globalAlpha = 1;
  }
  x.fillStyle = 'rgba(20,30,35,.25)'; x.fillRect(0, 0, S, 1); x.fillRect(0, h, S, 1); x.fillRect(0, 0, 1, S); x.fillRect(h, 0, 1, S);
}, 1.0);
const woodTex = canvasTex(1024, (x, S) => {
  const r = rng(11), rows = 8, rh = S / rows;
  for (let i = 0; i < rows; i++) {
    let px = -r() * S * .5;
    while (px < S) {
      const len = S * (.38 + r() * .42);
      x.fillStyle = `hsl(${31 + r() * 5} ${20 + r() * 6}% ${60 + r() * 7}%)`;
      x.fillRect(px, i * rh, len, rh);
      for (let g = 0; g < 16; g++) {
        x.globalAlpha = .05 + r() * .06;
        x.fillStyle = r() < .6 ? '#5b4631' : '#fff8ee';
        x.fillRect(px, i * rh + r() * rh, len, 1 + r() * 2);
      }
      x.globalAlpha = 1;
      x.fillStyle = 'rgba(70,52,36,.35)'; x.fillRect(px, i * rh, 2, rh);
      px += len;
    }
    x.fillStyle = 'rgba(70,52,36,.28)'; x.fillRect(0, i * rh, S, 2);
  }
}, 1.6);
const concreteTex = canvasTex(512, (x, S) => { // 600 tiles, polished-concrete tone
  const r = rng(3), h = S / 2;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    x.fillStyle = `hsl(30 4% ${70 + r() * 4}%)`; x.fillRect(i * h, j * h, h, h);
  }
  for (let k = 0; k < 2600; k++) { x.globalAlpha = .06 + r() * .08; x.fillStyle = r() < .5 ? '#6f6a64' : '#fbfaf7'; x.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
  x.globalAlpha = 1;
  x.fillStyle = '#a19c95'; x.fillRect(0, 0, S, 2); x.fillRect(0, h - 1, S, 2); x.fillRect(0, 0, 2, S); x.fillRect(h - 1, 0, 2, S);
}, 1.2);
const grilleTex = canvasTex(256, (x, S) => {
  x.fillStyle = '#eef0f1'; x.fillRect(0, 0, S, S);
  x.fillStyle = '#c3c9cd';
  for (let i = 0; i < S; i += 8) { x.fillRect(i, 0, 2, S); x.fillRect(0, i, S, 2); }
}, 1);
grilleTex.repeat.set(1, 1);

/* ============ materials ============ */
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .9, ...o });
const mat = {
  wall: std(0xEDEFEF),
  wallHi: std(0xEDEFEF, { transparent: true, opacity: .08, depthWrite: false }),
  mullion: std(0x3D454A, { roughness: .45, transparent: true, opacity: .1, depthWrite: false }),
  glass: new THREE.MeshStandardMaterial({ color: 0xCFE2EA, roughness: .05, transparent: true, opacity: .14, depthWrite: false, side: THREE.DoubleSide }),
  carpet: std(0xffffff, { map: carpetTex, roughness: 1 }),
  wood: std(0xffffff, { map: woodTex, roughness: .62 }),
  concrete: std(0xffffff, { map: concreteTex, roughness: .5 }),
  ceil: std(0xECF1F4, { transparent: true, opacity: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }),
  grid: new THREE.LineBasicMaterial({ color: 0x5E6D73, transparent: true, opacity: .5 }),
  led: new THREE.MeshStandardMaterial({ color: 0xFFFBF0, emissive: 0xFFF3DE, emissiveIntensity: 1.8, roughness: .4 }),
  shade: std(0x2F3538, { roughness: .45, side: THREE.DoubleSide }),
  cord: new THREE.LineBasicMaterial({ color: 0x2F3538 }),
  base: std(0xC9D1D6, { roughness: 1 }),
  acBody: std(0xCDD3D6, { roughness: .7 }),
  panelWhite: std(0xF7F8F8, { roughness: .5, emissive: 0xffffff, emissiveIntensity: .08 }),
  blade: std(0xD7DCDF, { roughness: .35 }),
  slot: std(0x7F8A90, { roughness: .6 }),
  grille: std(0xffffff, { map: grilleTex, roughness: .6 }),
  patch: new THREE.MeshBasicMaterial({ color: 0xBFE9F2, transparent: true, opacity: .6, depthWrite: false, side: THREE.DoubleSide }),
  patchEdge: new THREE.LineBasicMaterial({ color: 0x004E64, transparent: true, opacity: .9 }),
  arrow: new THREE.MeshBasicMaterial({ color: 0x004E64, transparent: true, opacity: .75, depthWrite: false, side: THREE.DoubleSide }),
  hover: new THREE.MeshBasicMaterial({ color: 0x3C9DB3, transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide }),
  pick: new THREE.LineBasicMaterial({ color: 0x004E64, transparent: true, opacity: .9, depthTest: false }),
  door: std(0xB9AD9C, { roughness: .6 }),
};
const GRID_OVER = new THREE.Color(0x5E6D73), GRID_ROOM = new THREE.Color(0xC2C7C9);
const FURN_BASE = {
  top: std(0xF1F1EE, { roughness: .5 }), leg: std(0x8A9398, { roughness: .4, metalness: .3 }),
  screen: std(0xAFC2C8, { roughness: .9 }), monitor: std(0x1D2226, { roughness: .35 }),
  chair: std(0x394247, { roughness: .8 }), cab: std(0xE8E9E6, { roughness: .6 }), stone: std(0xD6D7D3, { roughness: .4 }),
  sofa: std(0x71828A), appliance: std(0xD3D6D7, { roughness: .35, metalness: .2 }), front: std(0xE8E9E6, { roughness: .6 }),
  bench: std(0x71828A), metal: std(0xB7BCBF, { roughness: .3, metalness: .6 }),
};
const FURN_CAFE = {
  top: std(0xA67E5B, { roughness: .55 }), leg: std(0x2A2E30, { roughness: .4, metalness: .4 }),
  chair: std(0x7A5A40, { roughness: .6 }), cab: std(0xEAE5DC, { roughness: .6 }), stone: std(0xE3E1DC, { roughness: .3 }),
  front: std(0x96714F, { roughness: .6 }), bench: std(0x3F5F66, { roughness: .9 }),
};

/* ============ geometry builders ============ */
function shapeOf(poly, flip = false) {
  const s = new THREE.Shape();
  poly.forEach(([x, y], i) => s[i ? 'lineTo' : 'moveTo'](mm(x), flip ? -mm(y) : mm(y)));
  return s;
}
function box(sx, sy, sz, material, pos, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  m.position.copy(pos); m.castShadow = shadow; m.receiveShadow = true;
  return m;
}
function roundRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function plate(w, h, t, r) { // hangs below local y=0
  const g = new THREE.ExtrudeGeometry(roundRect(w, h, r), { depth: t, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(Math.PI / 2);
  return g;
}
// 4Way (home3d build4Way): square plate + 4 edge blades + centre grille; overview patch gets 4 discharge arrows
function build4Way(u) {
  const S4 = mm(u.size_mm[0]), T = mm(u.size_mm[2]);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(plate(S4, S4, T, .03), mat.panelWhite));
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.Group(); arm.rotation.y = k * Math.PI / 2; g.add(arm);
    arm.add(box(S4 * .62, .004, .06, mat.slot, new THREE.Vector3(0, -T - .002, S4 / 2 - S4 * .115), false));
    const bl = box(S4 * .6, .003, .045, mat.blade, new THREE.Vector3(0, -T - .006, S4 / 2 - S4 * .115), false); bl.rotation.x = .3; arm.add(bl);
  }
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(S4 * .46, S4 * .46), mat.grille); gr.rotation.x = Math.PI / 2; gr.position.y = -T - .001; g.add(gr);
  const op = u.ceiling_opening_mm || u.size_mm, oS = mm(op[0]), bh = mm(u.body_h_mm); // 타공 치수가 없으면 판넬 외곽(검사기가 빈 값을 FAIL 로 잡는다)
  g.add(box(oS, bh, oS, mat.acBody, new THREE.Vector3(0, bh / 2 + .002, 0), false));
  const pad = .24, pg = new THREE.ShapeGeometry(roundRect(S4 + pad, S4 + pad, .05)); pg.rotateX(-Math.PI / 2);
  const patch = new THREE.Mesh(pg, mat.patch); patch.position.y = bh + .01; patch.renderOrder = 3;
  const pts = roundRect(S4 + pad, S4 + pad, .05).getPoints(6).map(p => new THREE.Vector3(p.x, bh + .012, p.y));
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat.patchEdge);
  const parts = [patch, edge];
  for (let k = 0; k < 4; k++) {
    const a = new THREE.Shape(), L0 = S4 / 2 + .16, L1 = L0 + .5;
    a.moveTo(-.07, L0); a.lineTo(.07, L0); a.lineTo(.07, L1 - .14); a.lineTo(.17, L1 - .14); a.lineTo(0, L1); a.lineTo(-.17, L1 - .14); a.lineTo(-.07, L1 - .14);
    const ag = new THREE.ShapeGeometry(a); ag.rotateX(-Math.PI / 2); ag.rotateY(k * Math.PI / 2);
    const arrow = new THREE.Mesh(ag, mat.arrow); arrow.position.y = bh + .014; arrow.renderOrder = 3; parts.push(arrow);
  }
  for (const o of parts) { o.userData.patch = true; g.add(o); }
  return g;
}

// 1Way (home3d build1Way 의 절차적 판): 직사각 판넬 + 토출 쪽 좁은 타공 플랩 + 반대쪽 곡면 블레이드.
// 로컬 -z 가 토출 방향 (placeAC 에서 rotation_deg - 90 으로 맞춘다)
function build1Way(u) {
  const L = mm(u.size_mm[0]), D = mm(u.size_mm[1]), T = mm(u.size_mm[2]);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(plate(L, D, T, .02), mat.panelWhite));
  // 토출 쪽(-z) 좁은 평면 타공 띠
  const fw = L * .86, fd = D * .30;
  g.add(box(fw, .004, fd, mat.slot, new THREE.Vector3(0, -T - .002, -D / 2 + fd / 2 + D * .06), false));
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(fw * .98, fd * .8), mat.grille);
  grille.rotation.x = Math.PI / 2; grille.position.set(0, -T - .005, -D / 2 + fd / 2 + D * .06);
  g.add(grille);
  // 반대쪽(+z) 곡면 블레이드: 가운데가 살짝 처진 가는 선 여러 줄
  const z0 = D * .02, z1 = D * .30, x0 = -L * .43, x1 = L * .43;
  for (let i = 0; i < 9; i++) {
    const z = lerp(z0, z1, i / 8), y = -T - .0012;
    const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x0, y, z), new THREE.Vector3(0, y - .005, z), new THREE.Vector3(x1, y, z));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 10, .0013, 4, false), mat.blade));
  }
  const op = u.ceiling_opening_mm || u.size_mm, oL = mm(op[0]), oD = mm(op[1]), bh = mm(u.body_h_mm);
  g.add(box(oL, bh, oD, mat.acBody, new THREE.Vector3(0, bh / 2 + .002, 0), false));
  // 전체 보기용 바닥 패치 + 토출 방향 화살표 1개
  const pad = .24, rr = roundRect(L + pad, D + pad, .05);
  const pg = new THREE.ShapeGeometry(rr); pg.rotateX(-Math.PI / 2);
  const patch = new THREE.Mesh(pg, mat.patch); patch.position.y = bh + .01; patch.renderOrder = 3;
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(rr.getPoints(6).map(q => new THREE.Vector3(q.x, bh + .012, q.y))), mat.patchEdge);
  const a = new THREE.Shape(), A0 = D / 2 + .16, A1 = A0 + .5;
  a.moveTo(-.07, A0); a.lineTo(.07, A0); a.lineTo(.07, A1 - .14); a.lineTo(.17, A1 - .14); a.lineTo(0, A1); a.lineTo(-.17, A1 - .14); a.lineTo(-.07, A1 - .14);
  const ag = new THREE.ShapeGeometry(a); ag.rotateX(-Math.PI / 2);   // shape +y -> local -z = 토출 쪽(타공 띠와 같은 쪽). rotateY 를 붙이면 반대로 그려진다
  const arrow = new THREE.Mesh(ag, mat.arrow); arrow.position.y = bh + .014; arrow.renderOrder = 3;
  for (const o of [patch, edge, arrow]) { o.userData.patch = true; g.add(o); }
  return g;
}

/* ============ one space ============ */
function buildSpace(key) {
  const P = DATA[key], C = CHECKS[key];
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const g = {};
  for (const k of ['floor', 'walls', 'win', 'ceil', 'grid', 'ac', 'pipes', 'furn', 'air']) { g[k] = new THREE.Group(); root.add(g[k]); }
  const H_CEIL = P.ceiling.height_mm, H_WALL = H_CEIL + P.ceiling.void_mm;
  const [ix0, iy0, ix1, iy1] = P.envelope.interior_rect;
  const center = V((ix0 + ix1) / 2, (iy0 + iy1) / 2, 0);
  const units = P.ac_units;
  const unitsByZone = {};
  units.forEach(u => (unitsByZone[u.zone] ??= []).push(u));

  // 뷰어 전용 진입 시점: 자기 실에 자기를 보여 주는 시점이 없는 실내기마다(서비스 초안은 주 실에만 시점이 있어 다른 방 실내기를 눌러도 거실로 갔다).
  // JSON·검사기 7절·렌더 카메라와 무관 — 메모리의 P.views 에만 붙는다.
  // ponytail: 구역 꼭짓점을 무게중심 쪽으로 600mm 당긴 점 중 실내기에서 가장 먼 곳 — ㄱ자(오목) 구역은 벽 밖일 수 있다. 그런 도면이 오면 점-다각형 검사 추가
  P.views ??= [];
  for (const u of units) {
    if (P.views.some(v => v.room === u.room && (v.must_show === 'all' || v.must_show.includes(u.id)))) continue;
    const z = P.zones.find(q => q.id === u.zone);
    if (!z) continue;
    const cx = sum(z.polygon, p => p[0]) / z.polygon.length, cy = sum(z.polygon, p => p[1]) / z.polygon.length;
    const far = p => Math.hypot(p[0] - u.center[0], p[1] - u.center[1]);
    const cam = z.polygon.map(([x, y]) => { const d = Math.hypot(cx - x, cy - y) || 1; return [x + (cx - x) / d * 600, y + (cy - y) / d * 600]; }).sort((a, b) => far(b) - far(a))[0];
    P.views.push({ id: 'auto_' + u.id, room: u.room, kind: 'auto', name_ko: `${short(z.name_ko)} 실내기 쪽`, camera: [cam[0], cam[1], 1500], target: [u.center[0], u.center[1]],
      fov_deg: 80, aspect: '16:9', focal_mm_ff36: 21.5, must_show: [u.id],
      lens_shift_y: +Math.min(.15, .6 * (u.mount_z_mm - 1500) / (far(cam) || 1) / (2 * Math.tan(40 * DEG))).toFixed(3) }); // 수평 카메라 + 위로 렌즈 시프트(실내기 쪽으로 올려다보는 각의 0.6배)
  }

  // unit display names from the zone layout table: row 0 = window side, columns west -> east
  const names = {};
  for (const z of P.zones) {
    const L = z.ac_layout; if (!L) continue;
    L.units.forEach((row, ri) => row.forEach((id, ci) => {
      const rn = L.rows > 1 ? (ri === 0 ? '창측' : ri === L.rows - 1 ? '안쪽' : `${ri + 1}열`) : '';
      const cn = L.cols > 1 ? (ci === 0 ? '서' : ci === L.cols - 1 ? '동' : `${ci + 1}번`) : '';
      names[id] = [rn, cn].filter(Boolean).join(' ') || short(z.name_ko);
    }));
  }
  units.forEach(u => (names[u.id] ??= short(P.zones.find(z => z.id === u.zone)?.name_ko || u.id)));

  /* 바람 닿는 범위(도달 반경 — ac_rules.throw_radius_mm, 조사값): 1Way 토출 방향 ±60° 부채꼴, 그 밖은 원. 실 다각형을 볼록한 부채꼴로 잘라(서덜랜드-호지먼) 벽 너머로 안 번지게, 안쪽 55% 는 한 겹 더 */
  {
    const RT = P.ac_rules?.throw_radius_mm || 5000;
    const airMat = new THREE.MeshBasicMaterial({ color: 0x1E88E5, transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide });
    const clipPoly = (subj, cl) => {
      let out = subj;
      for (let i = 0; i < cl.length && out.length; i++) {
        const a = cl[i], b = cl[(i + 1) % cl.length], inp = out, side = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        out = [];
        for (let j = 0; j < inp.length; j++) {
          const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
          if (sp >= 0) out.push(p);
          if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
        }
      }
      return out;
    };
    for (const u of units) {
      const rm = P.rooms.find(r => r.id === u.room); if (!rm) continue;
      for (const [R, y] of [[RT, 6], [RT * .55, 9]]) {
        const [cx, cy] = u.center, n = 32, fan = [];
        if (u.model.startsWith('1way')) { fan.push([cx, cy]); for (let i = 0; i <= n; i++) { const a = (u.rotation_deg - 60 + 120 * i / n) * DEG; fan.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); } }
        else for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; fan.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
        const poly = clipPoly(rm.polygon, fan);
        if (poly.length < 3) continue;
        const geo = new THREE.ShapeGeometry(shapeOf(poly)); geo.rotateX(-Math.PI / 2); geo.translate(0, mm(y), 0);
        g.air.add(new THREE.Mesh(geo, airMat));
      }
    }
  }

  /* floors */
  const floorMat = f => /카펫/.test(f) ? mat.carpet : /데코|마루/.test(f) ? mat.wood : mat.concrete;
  for (const r of P.rooms) {
    const fg = new THREE.ShapeGeometry(shapeOf(r.polygon)); fg.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(fg, floorMat(r.floor_finish)); m.receiveShadow = true;
    g.floor.add(m);
  }
  { // slab edge + shadow catcher
    const pad = 250, poly = [[ix0 - pad, iy0 - pad], [ix1 + pad, iy0 - pad], [ix1 + pad, iy1 + pad], [ix0 - pad, iy1 + pad]];
    const eg = new THREE.ExtrudeGeometry(shapeOf(poly), { depth: .22, bevelEnabled: false }); eg.rotateX(-Math.PI / 2); eg.translate(0, -.225, 0);
    g.floor.add(new THREE.Mesh(eg, mat.base));
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.ShadowMaterial({ opacity: .16 }));
    catcher.rotation.x = -Math.PI / 2; catcher.position.copy(center).setY(-.23); catcher.receiveShadow = true;
    root.add(catcher);
  }
  // zone overlays: pick targets (raycast ignores visibility) + hover tint
  const pickMeshes = [], hoverMeshes = {};
  for (const z of P.zones) {
    const zg = new THREE.ShapeGeometry(shapeOf(z.polygon)); zg.rotateX(-Math.PI / 2);
    const h = new THREE.Mesh(zg, mat.hover); h.position.y = .006; h.visible = false; h.renderOrder = 2; h.userData.zone = z.id;
    g.floor.add(h); hoverMeshes[z.id] = h; pickMeshes.push(h);
  }

  /* walls with openings, split at the cutaway height */
  const opsByWall = {};
  P.openings.forEach(o => (opsByWall[o.wall] ??= []).push(o));
  const wallPiece = (w, s0, s1, z0, z1) => {
    if (s1 - s0 < 1 || z1 - z0 < 1) return;
    const hz = w.a[1] === w.b[1];
    for (const [za, zb] of [[z0, Math.min(z1, CUT)], [Math.max(z0, CUT), z1]]) {
      if (zb - za < 1) continue;
      const len = mm(s1 - s0), t = mm(w.thickness), c = (s0 + s1) / 2;
      const pos = hz ? V(c, w.a[1], (za + zb) / 2) : V(w.a[0], c, (za + zb) / 2);
      g.walls.add(box(hz ? len : t, mm(zb - za), hz ? t : len, za >= CUT ? mat.wallHi : mat.wall, pos, za < CUT)); // ghosted upper walls cast no shadow over the plan
    }
  };
  // glazing in wall-local coordinates: x along the wall, y up from z0
  const glazing = (w, a, b, z0, height, o) => {
    const hz = w.a[1] === w.b[1], c = (a + b) / 2;
    const grp = new THREE.Group();
    grp.position.copy(hz ? V(c, w.a[1], z0) : V(w.a[0], c, z0));
    if (!hz) grp.rotation.y = Math.PI / 2;
    const W = mm(b - a), H = mm(height), f = .05, d = .08;
    const bar = (sx, sy, x, y) => grp.add(box(sx, sy, d, mat.mullion, new THREE.Vector3(x, y, 0), false));
    if (o?.type === 'door') {
      grp.add(box(W - .02, H - .01, .045, mat.door, new THREE.Vector3(0, H / 2, 0)));
    } else {
      bar(W, f, 0, f / 2); bar(W, f, 0, H - f / 2); bar(f, H, -W / 2 + f / 2, H / 2); bar(f, H, W / 2 - f / 2, H / 2);
      const step = o?.mullion_mm;
      if (step) for (let s = step; s < b - a - 1; s += step) bar(.05, H, -W / 2 + mm(s), H / 2);
      const gl = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * f, H - 2 * f), mat.glass); gl.position.y = H / 2; grp.add(gl);
    }
    g.win.add(grp);
    return { grp, bar, W, H };
  };
  for (const w of P.walls) {
    const hz = w.a[1] === w.b[1];
    const ends = hz ? [w.a[0], w.b[0]] : [w.a[1], w.b[1]];
    const ops = (opsByWall[w.id] || []).map(o => ({ o, c: hz ? o.at[0] : o.at[1] })).sort((p, q) => p.c - q.c);
    if (w.kind === 'glass_partition') { // glass up to the finished ceiling, door frames inside it
      const s0 = Math.min(...ends), s1 = Math.max(...ends);
      const { bar } = glazing(w, s0, s1, 0, H_CEIL, null);
      for (const { o, c } of ops) {
        const x = mm(c - (s0 + s1) / 2), dw = mm(o.width), dh = mm(o.height);
        bar(.05, dh, x - dw / 2, dh / 2); bar(.05, dh, x + dw / 2, dh / 2); bar(dw, .05, x, dh);
      }
      continue;
    }
    const s0 = Math.min(...ends) - w.thickness / 2, s1 = Math.max(...ends) + w.thickness / 2;
    let cur = s0;
    for (const { o, c } of ops) {
      const a = c - o.width / 2, b = c + o.width / 2;
      wallPiece(w, cur, a, 0, H_WALL);
      if (o.sill > 0) wallPiece(w, a, b, 0, o.sill);
      wallPiece(w, a, b, o.sill + o.height, H_WALL);
      glazing(w, a, b, o.sill, o.height, o);
      cur = b;
    }
    wallPiece(w, cur, s1, 0, H_WALL);
  }

  /* finished ceiling (room views), M-bar grid + lights (both modes) */
  for (const r of P.rooms) {
    const cg = new THREE.ShapeGeometry(shapeOf(r.polygon, true)); cg.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(cg, mat.ceil); m.position.y = mm(r.ceiling_mm); m.receiveShadow = true;
    g.ceil.add(m);
  }
  {
    const G = P.ceiling.grid, pts = [];
    for (const r of P.rooms) {
      const o = G.origins[r.id]; if (!o) continue;
      const [x0, y0, x1, y1] = bbox(r.polygon), z = r.ceiling_mm - 2;
      for (let x = o[0] + Math.ceil((x0 - o[0]) / G.module_x_mm) * G.module_x_mm; x < x1; x += G.module_x_mm) if (x > x0) pts.push(V(x, y0, z), V(x, y1, z));
      for (let y = o[1] + Math.ceil((y0 - o[1]) / G.module_y_mm) * G.module_y_mm; y < y1; y += G.module_y_mm) if (y > y0) pts.push(V(x0, y, z), V(x1, y, z));
    }
    g.grid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat.grid));
  }
  for (const L of P.ceiling.lights) {
    if (L.type === 'line_led') {
      const along = L.a[1] === L.b[1], len = Math.abs(along ? L.b[0] - L.a[0] : L.b[1] - L.a[1]);
      g.grid.add(box(along ? mm(len) : mm(L.width_mm), .014, along ? mm(L.width_mm) : mm(len), mat.led,
        V((L.a[0] + L.b[0]) / 2, (L.a[1] + L.b[1]) / 2, L.z_mm - 8), false));
    } else if (L.type === 'pendant') {
      const s = L.size_mm[0], zb = L.z_mm - L.drop_mm, hs = s * .6;
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(mm(s * .16), mm(s / 2), mm(hs), 28, 1, true), mat.shade);
      shade.position.copy(V(L.center[0], L.center[1], zb + hs / 2)); shade.castShadow = true; g.grid.add(shade);
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(mm(s * .44), 28), mat.led); bulb.rotation.x = Math.PI / 2;
      bulb.position.copy(V(L.center[0], L.center[1], zb + 12)); g.grid.add(bulb);
      g.grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(L.center[0], L.center[1], L.z_mm), V(L.center[0], L.center[1], zb + hs)]), mat.cord));
    } else if (L.center && L.size_mm) { // 서비스 초안: {kind: '원형 직부등', center, size_mm} — type 이 없어 안 그려졌다
      const d = new THREE.Mesh(new THREE.CylinderGeometry(mm(L.size_mm[0] / 2), mm(L.size_mm[0] / 2), .014, 28), mat.led); // 줄등 상자와 같은 두께 — 위에서도 보인다
      d.position.copy(V(L.center[0], L.center[1], (L.z_mm ?? H_CEIL) - 8)); g.grid.add(d);
    }
  }

  /* indoor units */
  const patchObjs = [], unitPick = [], unitHover = {}, unitMark = {};
  for (const u of units) {
    const oneWay = u.model === '1way';
    const ug = oneWay ? build1Way(u) : build4Way(u);
    ug.position.copy(V(u.center[0], u.center[1], u.mount_z_mm));
    // 4Way: 배관 쪽 방향(판넬은 대칭) / 1Way: 토출 방향, 로컬 -z 가 토출이라 -90
    ug.rotation.y = (oneWay ? u.rotation_deg - 90 : u.rotation_deg) * DEG;
    g.ac.add(ug);
    ug.traverse(o => o.userData.patch && patchObjs.push(o));
    // click target on the panel face: "에어컨을 누르면 그 에어컨 시점" (raycast ignores visibility, like the zone overlays)
    const swapLD = u.model === '1way' && ((u.rotation_deg % 180) + 180) % 180 === 0; // 1Way: 긴 변은 토출과 직교 (check_commercial.panel 과 같은 규약)
    const PW = swapLD ? u.size_mm[1] : u.size_mm[0], PD = swapLD ? u.size_mm[0] : u.size_mm[1];
    const pk = new THREE.PlaneGeometry(mm(PW + 120), mm(PD + 120)); pk.rotateX(-Math.PI / 2);
    // (판넬은 축 정렬이라 size_mm 가 곧 x·y 범위다 - check_commercial.panel() 과 같은 규약)
    const h = new THREE.Mesh(pk, mat.hover);
    h.position.copy(V(u.center[0], u.center[1], u.mount_z_mm - 45));
    h.visible = false; h.renderOrder = 3; h.userData.unit = u.id;
    g.ac.add(h); unitPick.push(h); unitHover[u.id] = h;
    // 방 안에서 '지금 이 실내기' 를 가리키는 링 (여러 대가 한 컷에 잡히는 와이드에서 필요)
    // 판넬을 가리지 않게 테두리만 (여러 대가 한 컷에 들어오는 와이드로 떨어질 때 '이 대'를 가리킨다)
    const rr0 = roundRect(mm(PW) + .16, mm(PD) + .16, .06);
    const rm = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(rr0.getPoints(8).map(q => new THREE.Vector3(q.x, 0, q.y))), mat.pick);
    rm.position.copy(V(u.center[0], u.center[1], u.mount_z_mm - 40));
    rm.visible = false; rm.renderOrder = 4;
    g.ac.add(rm); unitMark[u.id] = rm;
  }

  /* refrigerant piping (in the ceiling void) — 굵기는 규격의 가스관 지름(15.88 이상 굵게), 규격이 없으면 kind */
  const PIPE = { refrigerant_main: [0x1F6F82, .022], refrigerant_branch: [0x2E7F91, .014], refrigerant: [0x2E7F91, .016] };
  const gasR = p => { const m = /가스 Ø([\d.]+)/.exec(p.spec || ''); return m ? (+m[1] >= 15.8 ? .022 : .014) : null; };
  const pmat = {};
  for (const p of P.piping) {
    const [color, r] = PIPE[p.kind] || PIPE.refrigerant;
    tube(p.polyline, gasR(p) || r, pmat[color] ||= new THREE.MeshStandardMaterial({ color, roughness: .5, emissive: color, emissiveIntensity: .25 }), g.pipes);
  }
  // 분지관(Y 분기관): 도면 블록 도형 그대로 — 주관 축(입구~직진)과 가지 팔을 몸통 굵기(50mm)로. 도형이 없는 옛 JSON 은 갈라지는 점에 작은 구
  const brMat = new THREE.MeshStandardMaterial({ color: 0xC8892F, roughness: .45, emissive: 0xC8892F, emissiveIntensity: .2 });
  for (const b of P.piping_branches || []) {
    if (b.axis && b.arm) {
      tube(b.axis, .025, brMat, g.pipes); tube(b.arm, .025, brMat, g.pipes);
      const s = new THREE.Mesh(new THREE.SphereGeometry(.025, 12, 8), brMat); s.position.copy(V(...b.arm[0])); g.pipes.add(s);
    } else {
      const m = new THREE.Mesh(new THREE.SphereGeometry(.03, 12, 8), brMat); m.position.copy(V(...(b.node || b.at))); g.pipes.add(m);
    }
  }

  /* furniture from furniture_hint (sizes/seats from json; chair and monitor shapes are drawing detail) */
  const F = { ...FURN_BASE, ...(P.space_type === 'cafe' ? FURN_CAFE : {}) };
  // 도면 사물(설계 도면 선택 2 — objects 가 있을 때만): 도면 외곽을 종류별 가정 높이만큼 올린 덩어리
  const objBody = std(0xB9B2A6, { roughness: .7 }), objStone = std(0xA3A8A6, { roughness: .45 });   // 벽(0xEDEFEF)과 갈리게
  const OBJ_MAT = { 소파: F.sofa, 침대: F.sofa, 의자: F.chair, 책상: objBody, 테이블: objBody, 식탁: objBody, 냉장고: F.appliance, 세탁기: F.appliance,
    TV: F.monitor, 변기: objStone, 세면대: objStone, 욕조: objStone, 샤워: objStone, 싱크대: objStone, 조리대: objStone,
    레인지: F.appliance, 식기세척기: F.appliance, 건조기: F.appliance, 의류관리기: F.appliance, 자판기: F.appliance };
  const objMeshes = [];
  for (const o of P.objects || []) {
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(o.footprint.map(q => new THREE.Vector2(mm(q[0]), mm(q[1])))), { depth: mm(o.height_mm), bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);                                      // 도면 (x, y) → 세계 (x, 높이, -y) = V 규약
    const m = new THREE.Mesh(geo, OBJ_MAT[o.kind] || objBody); m.castShadow = true; m.receiveShadow = true;
    g.furn.add(m); objMeshes.push(m);
  }
  // 실사 렌더와 같은 가구·연출 소품(render_space.py --glb → <공간>.glb): http 로 열었고 파일이 있으면 덩어리 대신. 없으면 덩어리 그대로
  if (objMeshes.length && location.protocol.startsWith('http'))
    import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().load(`${encodeURIComponent(key)}.glb`, gl => {
      objMeshes.forEach(m => g.furn.remove(m));
      gl.scene.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      g.furn.add(gl.scene);
    }, undefined, () => {})).catch(() => {});
  const add = (cx, cy, z0, sx, sy, sz, m, shadow = true) => g.furn.add(box(mm(sx), mm(sz), mm(sy), m, V(cx, cy, z0 + sz / 2), shadow));
  const cyl = (x, y, z0, r0, h, m) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(mm(r0), mm(r0), mm(h), 20), m); c.position.copy(V(x, y, z0 + h / 2)); c.castShadow = true; g.furn.add(c); };
  const chair = (x, y, face) => { // face: direction the sitter looks (deg, 0 = +x east)
    const dx = Math.round(Math.cos(face * DEG)), dy = Math.round(Math.sin(face * DEG));
    add(x, y, 420, 460, 460, 50, F.chair);
    add(x - dx * 205, y - dy * 205, 470, dx ? 50 : 440, dx ? 440 : 50, 400, F.chair);
    cyl(x, y, 0, 28, 420, F.leg);
  };
  const stool = (x, y) => { cyl(x, y, 720, 170, 40, F.chair); cyl(x, y, 0, 22, 720, F.leg); };
  const table = (cx, cy, sx, sy, h) => {
    add(cx, cy, h - 30, sx, sy, 30, F.top);
    for (const i of [-1, 1]) for (const j of [-1, 1]) add(cx + i * (sx / 2 - 50), cy + j * (sy / 2 - 50), 0, 40, 40, h - 30, F.leg, false);
  };
  for (const f of P.furniture_hint || []) {   // 주거 설계 도면 등 가구 힌트가 없는 공간
    const [sx, sy, sz] = f.size, [cx, cy] = f.center, z0 = f.z0 || 0, n = f.name_ko, seats = f.seats || 0;
    if (/데스크 섬/.test(n)) {
      const per = seats / 2, pitch = sy / per;
      table(cx, cy, sx, sy, sz);
      add(cx, cy, sz, 24, sy, 360, F.screen);
      for (let i = 0; i < per; i++) for (const s of [-1, 1]) {
        const y = cy - sy / 2 + pitch * (i + .5);
        add(cx + s * sx * .2, y, sz + 110, 30, 560, 330, F.monitor);
        add(cx + s * sx * .2, y, sz, 180, 180, 110, F.leg, false);
        chair(cx + s * (sx / 2 + 330), y, s > 0 ? 180 : 0);
      }
    } else if (/팀장석/.test(n)) {
      table(cx, cy, sx, sy, sz);
      add(cx, cy - sy * .22, sz + 110, 560, 30, 330, F.monitor);
      chair(cx, cy + sy / 2 + 330, 270);
    } else if (/회의 테이블|공용 대형 테이블|4인 테이블|테이블 2인/.test(n)) {
      table(cx, cy, sx, sy, sz);
      const alongY = sy >= sx, ends = /회의/.test(n) ? 2 : 0, per = (seats - ends) / 2;
      if (seats <= 2) { chair(cx, cy - sy / 2 - 300, 90); chair(cx, cy + sy / 2 + 300, 270); }
      else {
        const L = alongY ? sy : sx;
        for (let i = 0; i < per; i++) for (const s of [-1, 1]) {
          const t = -L / 2 + L / per * (i + .5);
          alongY ? chair(cx + s * (sx / 2 + 300), cy + t, s > 0 ? 180 : 0) : chair(cx + t, cy + s * (sy / 2 + 300), s > 0 ? 270 : 90);
        }
        if (ends) for (const s of [-1, 1]) alongY ? chair(cx, cy + s * (sy / 2 + 300), s > 0 ? 270 : 90) : chair(cx + s * (sx / 2 + 300), cy, s > 0 ? 180 : 0);
      }
    } else if (/바테이블/.test(n)) {
      add(cx, cy, sz - 40, sx, sy, 40, F.top);
      for (const t of [-.45, 0, .45]) add(cx + t * sx, cy, 0, 50, sy * .5, sz - 40, F.leg, false);
      for (let i = 0; i < seats; i++) stool(cx - sx / 2 + sx / seats * (i + .5), cy + sy / 2 + 260);
    } else if (/벤치/.test(n)) {
      const tables = seats / 2, pitch = sy / tables, x0 = cx - sx / 2;
      add(x0 + 240, cy, 0, 480, sy, 440, F.bench);
      add(x0 + 50, cy, 440, 100, sy, 480, F.bench);
      for (let i = 0; i < tables; i++) {
        const y = cy - sy / 2 + pitch * (i + .5), tx = x0 + 480 + 80 + 300;
        table(tx, y, 600, 600, sz);
        chair(tx + 300 + 290, y, 180);
      }
    } else if (/2인 테이블/.test(n)) {
      const tables = seats / 2, pitch = sy / tables;
      for (let i = 0; i < tables; i++) {
        const y = cy - sy / 2 + pitch * (i + .5);
        table(cx, y, 600, 600, sz);
        chair(cx, y - 580, 90); chair(cx, y + 580, 270);
      }
    } else if (/소파/.test(n)) {
      add(cx, cy, z0, sx, sy, 420, F.sofa);
      add(cx, cy + sy / 2 - 120, z0, sx, 220, sz, F.sofa);   // 등받이 바깥면을 좌면에서 10mm 들여놓는다(z-fighting)
    } else if (/카운터/.test(n)) {
      add(cx, cy, z0, sx, sy, sz - 30, F.front);             // 상판 밑면과 면을 공유하지 않게 10mm 물린다
      add(cx, cy, z0 + sz - 40, sx + 40, sy + 40, 40, F.stone);
    } else if (/머신/.test(n)) {
      add(cx, cy, z0, sx, sy, sz, F.metal);
    } else if (/쇼케이스/.test(n)) {
      add(cx, cy, z0, sx, sy, sz * .55, F.front);
      add(cx, cy, z0 + sz * .55, sx, sy, sz * .45, mat.glass, false);
    } else if (/선반/.test(n)) {
      for (let i = 0; i < 3; i++) add(cx, cy, z0 + i * (sz - 30) / 2, sx, sy, 30, F.top);
    } else if (/냉장고|복합기/.test(n)) {
      add(cx, cy, z0, sx, sy, sz, F.appliance);
    } else if (/TV/.test(n)) {
      add(cx, cy, z0, sx, sy, sz, F.monitor);
    } else {
      add(cx, cy, z0, sx, sy, sz, F.cab);
    }
  }

  // invisible slab: blocks the sun in room views
  const slab = new THREE.Mesh(new THREE.BoxGeometry(mm(ix1 - ix0) + 1, .2, mm(iy1 - iy0) + 1),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  slab.position.copy(center).setY(mm(H_WALL) + .1); slab.castShadow = true; slab.visible = false;
  root.add(slab);

  /* labels */
  const labels = [];
  const zoneKw = z => { const us = unitsByZone[z.id] || []; return us.length ? `${modelSummary(us)} · ${n1(sum(us, u => u.capacity_kw))}kW` : '전용 실내기 없음'; };
  for (const z of P.zones) {
    // L자 구역은 외접 사각형 중심이 구역 밖일 수 있다 → label_at(구역 안 한 점, 도면 추출기가 준다)을 먼저 쓴다
    const [x0, y0, x1, y1] = bbox(z.polygon), [cx, zy] = z.label_at || [(x0 + x1) / 2, (y0 + y1) / 2];
    // a unit in the centre column would sit on the label once the ceiling height projects: move the label sideways
    const zx = !z.label_at && (unitsByZone[z.id] || []).some(u => Math.abs(u.center[0] - cx) < 800) ? x0 + (x1 - x0) * .25 : cx;
    const el = document.createElement('div');
    el.className = 'lbl'; el.hidden = true;
    el.innerHTML = `<b>${esc(short(z.name_ko))}</b><span class="num">${n2(z.area_m2)}㎡</span><span class="kw">${esc(zoneKw(z))}</span>`;
    el.addEventListener('click', () => goZone(z.id));
    el.addEventListener('pointerenter', () => setHover(z.id));
    el.addEventListener('pointerleave', () => setHover(null));
    $('labels').appendChild(el);
    labels.push({ el, v: V(zx, zy, 300), id: z.id, pri: (unitsByZone[z.id] ? 1e4 : 0) + z.area_m2 }); // declutter rank: zones with units first, then bigger area
  }
  for (const u of units) { // every unit is its own entry point
    const el = document.createElement('div');
    el.className = 'lbl minor ac'; el.hidden = true;
    el.textContent = cap(u);
    el.title = `${names[u.id] || u.id} 시점으로 들어가기`;
    el.addEventListener('click', () => goUnit(u.id));
    el.addEventListener('pointerenter', () => setHover(u.id));
    el.addEventListener('pointerleave', () => setHover(null));
    $('labels').appendChild(el);
    labels.push({ el, v: V(u.center[0], u.center[1] - u.size_mm[1] / 2 - 1000, u.mount_z_mm + 20), id: u.id, zone: u.zone, pri: -1 }); // shown only while its zone is hovered
  }
  { // outdoor unit: a box where the json puts it (position/size_mm/rotation_deg), else only a label at the pipe entry
    const OU = P.outdoor_unit, port = OU.sets[0].port;
    let at = V(port[0], port[1], port[2]);
    if (OU.position) {
      const [w, d, h] = OU.size_mm, [x, y, z0 = 0] = OU.position, og = new THREE.Group();
      og.add(box(mm(w), mm(h), mm(d), mat.acBody, new THREE.Vector3(0, mm(h) / 2, 0)));
      const fan = new THREE.Mesh(new THREE.CircleGeometry(mm(Math.min(w, h)) * .38, 40), mat.grille);
      fan.position.set(0, mm(h) / 2, -mm(d) / 2 - .002); fan.rotation.y = Math.PI; og.add(fan); // front = local -z
      og.position.copy(V(x, y, z0));
      og.rotation.y = ((OU.rotation_deg ?? 270) - 90) * DEG; // same rule as 1Way: rotation_deg = front (discharge) direction
      g.ac.add(og);
      at = V(x, y, z0 + h + 200);
    }
    const el = document.createElement('div');
    el.className = 'lbl minor'; el.hidden = !OU.position;
    const kw = OU.sets.map(s => s.capacity_kw).filter(k => k != null);
    el.textContent = ['실외기', OU.model_code, kw.length ? kw.join(' + ') + 'kW' : ''].filter(Boolean).join(' ');
    $('labels').appendChild(el);
    labels.push({ el, v: at, pri: OU.position ? 5e3 : 0 });
  }

  const PAD = 500; // walls + slab edge outside the interior rect
  const boxPts = [0, 1].flatMap(i => [0, 1].flatMap(j => [0, 1].map(k => V(i ? ix1 + PAD : ix0 - PAD, j ? iy1 + PAD : iy0 - PAD, k * H_WALL))));
  const unitsById = Object.fromEntries(units.map(u => [u.id, u]));
  const s = { key, P, C, root, g, center, boxPts, pickMeshes, hoverMeshes, labels, patchObjs, slab, units, unitsByZone, unitsById,
              unitPick, unitHover, unitMark, allPick: [...unitPick, ...pickMeshes], names, H_CEIL, size: [ix1 - ix0, iy1 - iy0] };
  g.pipes.visible = state.pipes; g.grid.visible = state.grid; g.air.visible = state.air;
  return s;
}
function modelSummary(us) {
  const by = {};
  us.forEach(u => { by[u.model] = (by[u.model] || 0) + 1; });
  return Object.entries(by).map(([m, c]) => `${MODEL_KO[m] || m} ${c}대`).join(' + ');
}

/* ============ sky + distant towers (room views) ============ */
const skyGeo = new THREE.SphereGeometry(600, 32, 16);
const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
const skyGroup = new THREE.Group(); scene.add(skyGroup);
skyGroup.add(new THREE.Mesh(skyGeo, skyMat));
{
  const p = skyGeo.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color();
  const T = new THREE.Color(0x8DB6D0), Hz = new THREE.Color(0xD9E6EC), B = new THREE.Color(0xBFC3C2);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 600;
    y >= 0 ? c.copy(Hz).lerp(T, Math.pow(y, .6)) : c.copy(Hz).lerp(B, Math.min(1, -y * 4));
    c.toArray(cols, i * 3);
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}
const towerMat = new THREE.MeshLambertMaterial({ color: 0xD3DBDF, transparent: true, opacity: 0 });
{
  const r = rng(29);
  for (let i = 0; i < 40; i++) {
    const ang = r() * Math.PI * 2, dist = 120 + r() * 260, w = 16 + r() * 12, d = 11 + r() * 6, h = 45 + r() * 70;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), towerMat);
    m.position.set(Math.cos(ang) * dist, h / 2 - 30, Math.sin(ang) * dist);
    m.rotation.y = Math.round(r() * 2) * Math.PI / 2 + (r() - .5) * .3;
    skyGroup.add(m);
  }
}
scene.fog = new THREE.Fog(0xD6E2E8, 90, 520);

/* ============ light (home3d "day") ============ */
const hemi = new THREE.HemisphereLight(0xE2EDF2, 0xC4B09A, .95);
const amb = new THREE.AmbientLight(0xffffff, .18);
const sun = new THREE.DirectionalLight(0xFFF3E0, 3.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
const fill = new THREE.DirectionalLight(0xFFF6EA, 0);
const HEMI_GROUND = new THREE.Color(0xC4B09A), HEMI_GROUND_ROOM = new THREE.Color(0xBFC3C2);
scene.add(hemi, amb, sun, sun.target, fill);
function placeSun() {
  const a = 190 * DEG, e = 40 * DEG; // az from north clockwise, elevation (home3d day)
  const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
  sun.position.copy(S.center).addScaledVector(dir, 50);
  sun.target.position.copy(S.center);
  const half = Math.max(...S.size) / 2000 + 3;
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 5, far: 110 });
  sun.shadow.camera.updateProjectionMatrix();
  fill.position.copy(S.center).add(new THREE.Vector3(.45, .3, 1).multiplyScalar(30));
  skyGroup.position.copy(S.center);
}
function lightForBlend() {
  const k = state.k;
  hemi.intensity = .95 * lerp(1, 2.1, k); amb.intensity = .18 * lerp(1, 2.8, k);
  hemi.groundColor.lerpColors(HEMI_GROUND, HEMI_GROUND_ROOM, k); // no warm floor bounce on a white office ceiling
  fill.intensity = k * 1.1;
  renderer.toneMappingExposure = lerp(1, 1.1, k);
}

/* ============ checks text ============ */
function nice(msg) {
  const P = S.P;
  const zn = Object.fromEntries(P.zones.map(z => [z.id, short(z.name_ko)]));
  const vk = Object.fromEntries(P.views.map(v => [v.id, viewKo(v)]));
  const dict = { ...SEAT_KO, ...VIEW_KO };
  return msg
    .replace(/^([a-z_]+)(?:→([a-z_]+))?:/, (m, a, b) => zn[a] || vk[a] ? `${zn[a] || vk[a]}${b ? ' → ' + (zn[b] || b) : ''}:` : m)
    .replace(/\(([\d.]+평), ([a-z_+]+)\)/, (m, a, b) => `(${a}, ${b.split('+').map(id => zn[id] || id).join('+')})`)
    .replace(/\(AC_\w+\)/g, '').replace(/\bAC_\w+\b/g, id => S.names[id] ? `${S.names[id]} 실내기` : id).replace(/shift_y/g, '렌즈 시프트')
    .replace(/\{([^}]*)\}/g, (_, s) => '(' + s.replace(/'(\w+)'/g, (m2, w) => dict[w] || w) + ')')
    .replace(/\bmini_4way\b/g, '미니 4Way').replace(/\b4way\b/g, '4Way').replace(/\b1way\b/g, '1Way')
    .replace(/'/g, '').replace(/\brule_check\s*/g, '').replace(/must_show/g, '필수 표시').replace(/\bref_(\w+)/g, '배관');
}
const srcLinks = txt => esc(txt).replace(/\b([MRH]\d{1,2})\b/g, '<a href="#src-$1" data-src="$1">$1</a>');
const checkList = arr => arr.length ? `<ul class="checks">${arr.map(([, lvl, msg]) =>
  `<li class="${lvl.toLowerCase()}"><span class="badge">${LV_KO[lvl]}</span><span>${esc(nice(msg))}</span></li>`).join('')}</ul>` : '<p class="basis">해당 항목 없음</p>';
const tallyHtml = c => ['PASS', 'WARN', 'INFO', 'FAIL'].map(l => `<span class="${l.toLowerCase()}">${LV_KO[l]} <b class="num">${c[l]}</b></span>`).join('');

/* ============ UI: tabs ============ */
const tabsEl = $('tabs');
tabsEl.innerHTML = KEYS.map(k => `<button type="button" role="tab" id="tab-${k}" data-space="${k}" aria-controls="stage" aria-selected="false" tabindex="-1">${kindKo(DATA[k].space_type)} ${DATA[k].envelope.unit_pyeong != null ? '' : '냉방 '}<span class="num">${pyShow(DATA[k])}</span>평</button>`).join('');
const tabBtns = [...tabsEl.querySelectorAll('[role="tab"]')];
tabBtns.forEach(b => b.addEventListener('click', () => setSpace(b.dataset.space)));
tabsEl.addEventListener('keydown', e => {
  const i = KEYS.indexOf(S.key), n = KEYS.length;
  const j = { ArrowRight: (i + 1) % n, ArrowDown: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
  if (j == null) return;
  e.preventDefault(); setSpace(KEYS[j]); tabBtns[j].focus();
});

/* ============ UI: list ============ */
function renderList() {
  const P = S.P, [ix0, iy0, ix1, iy1] = P.envelope.interior_rect, m2py = P.load_rule.m2_per_pyeong;
  const hasGrid = Object.keys(P.ceiling.grid?.origins || {}).length > 0;  // 주거 평천장은 격자 없음
  const area = P.envelope.unit_area_m2 ?? P.envelope.area_m2 ?? (ix1 - ix0) * (iy1 - iy0) / 1e6; // 세대 전체 > 실 면적 합 > 안목 사각형
  const seatType = P.seat_target?.seat_type;   // 좌석 목표가 없는 공간(주거)은 좌석 칸을 뺀다
  const seatsBy = {};
  (P.furniture_hint || []).forEach(f => { if (f.seats) seatsBy[f.seat_type] = (seatsBy[f.seat_type] || 0) + f.seats; });
  const others = Object.entries(seatsBy).filter(([t]) => t !== seatType).map(([t, c]) => `${SEAT_KO[t] || t} ${c}`).join(' · ');
  $('listGrabT').textContent = `${kindKo(P.space_type)} ${pyLabel(P)}평 공간 정보`;
  $('facts').innerHTML = [
    ['면적(안목)', `${n2(area)}<small> ㎡</small><span class="sub2">${n2(area / m2py)}평</span>`],
    ...(seatType ? [[`좌석${seatType === 'desk' ? ' (데스크)' : ''}`, `${seatsBy[seatType] || 0}<small> 석</small>${others ? `<span class="sub2">${esc(others)}</span>` : ''}`]] : []),
    ['실내기', `${S.units.length}<small> 대</small><span class="sub2">${esc(modelSummary(S.units))}</span>`],
    ['용량 합', `${n1(sum(S.units, u => u.capacity_kw))}<small> kW</small>`],
  ].map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('');
  $('zoneList').innerHTML = P.zones.map(z => {
    const us = S.unitsByZone[z.id] || [];
    return `<li><button type="button" class="room-btn${us.length ? '' : ' none'}" data-zone="${z.id}" aria-current="false"${viewFor(z) < 0 ? ' disabled' : ''}>
      <span class="n">${esc(short(z.name_ko))}</span><span class="a">${n2(z.area_m2)}㎡</span>
      <span class="u">${us.length ? `${esc(modelSummary(us))} · ${n1(sum(us, u => u.capacity_kw))}kW` : '전용 실내기 없음'}</span></button>
      ${us.length ? `<ul class="units">${us.map(u => `<li><button type="button" class="unit-btn" data-unit="${u.id}" aria-current="false">
        <span class="n">${esc(S.names[u.id] || u.id)}</span>
        <span class="u">${cap(u)}</span></button></li>`).join('')}</ul>` : ''}</li>`;
  }).join('');
  $('zoneList').querySelectorAll('.room-btn').forEach(b => {
    b.addEventListener('click', () => goZone(b.dataset.zone));
    b.addEventListener('pointerenter', () => setHover(b.dataset.zone));
    b.addEventListener('pointerleave', () => setHover(null));
  });
  $('zoneList').querySelectorAll('.unit-btn').forEach(b => {
    b.addEventListener('click', () => goUnit(b.dataset.unit));
    b.addEventListener('pointerenter', () => setHover(b.dataset.unit));
    b.addEventListener('pointerleave', () => setHover(null));
  });
  $('tally').innerHTML = tallyHtml(S.C.counts);
  $('warnList').innerHTML = S.C.lines.filter(l => l[1] === 'WARN' || l[1] === 'FAIL').map(([, lvl, msg]) =>
    `<li class="${lvl.toLowerCase()}"><span class="badge">${LV_KO[lvl]}</span><span>${esc(nice(msg))}</span></li>`).join('');
  const OU = P.outdoor_unit;
  $('ouLine').textContent = `실외기: ${OU.location_ko} · ${OU.sets.map(s => `${s.type} ${s.capacity_kw}kW`).join(', ')}`;
  $('title').textContent = `${kindKo(P.space_type)} ${pyLabel(P)}평 시스템에어컨 배치`;
  $('eyebrow').textContent = `${P.source_drawing ? '설계 도면' : P.input_kind === 'arch_drawing' ? '건축 도면(실내기 자동 제안)' : '참고 평면'} · 시스템에어컨 배치`;
  document.title = $('title').textContent;
  canvas.setAttribute('aria-label', `천장을 걷어낸 ${kindKo(P.space_type)} ${pyLabel(P)}평 3D 모형. 천장형 ${modelSummary(S.units)}, ${hasGrid ? '라인 조명과 텍스 천장 격자, ' : ''}천장 속 냉매배관이 보입니다.`);
}
function bindGrab(sheet, grab) {
  grab.addEventListener('click', () => {
    const c = sheet.toggleAttribute('data-collapsed');
    grab.setAttribute('aria-expanded', String(!c));
    requestAnimationFrame(() => {
      applyViewport();
      if (tween) return;
      if (state.mode === 'room') { const p = viewPose(state.view); camera.fov = p.fov; updProj(); } else flyTo(housePose(), 0); // refit the model to the new free area
    });
  });
}
bindGrab($('listSheet'), $('listGrab'));
bindGrab($('detailSheet'), $('detailGrab'));

/* ============ UI: detail ============ */
function viewFor(z) {
  const views = S.P.views;
  const within = views.findIndex(v => v.room === z.room && inBox(v.camera, z.polygon));
  if (within >= 0) return within;
  const ids = (S.unitsByZone[z.id] || []).map(u => u.id);
  const byUnits = ids.length ? views.findIndex(v => v.must_show === 'all' || ids.every(i => v.must_show.includes(i))) : -1;
  if (byUnits >= 0) return byUnits;
  return views.findIndex(v => v.room === z.room); // 없으면 -1 — 다른 실의 시점 0 으로 보내지 않는다(goZone 이 멈춘다)
}
function renderDetail(zoneId, viewIdx, unitId) {
  const P = S.P, z = P.zones.find(q => q.id === zoneId), v = P.views[viewIdx];
  const hasGrid = Object.keys(P.ceiling.grid?.origins || {}).length > 0;  // 주거 평천장은 격자 없음
  const us = S.unitsByZone[zoneId] || [], ids = us.map(u => u.id), m2py = P.load_rule.m2_per_pyeong;
  const seats = (P.furniture_hint || []).filter(f => f.zone === zoneId && f.seats);
  const nSeats = sum(seats, f => f.seats);
  const lines = S.C.lines;
  const zoneRe = new RegExp(`^(${zoneId}(:|→)|[a-z_]+→${zoneId}:)`);
  const zoneLines = lines.filter(l => !l[3] && (zoneRe.test(l[2]) || ids.some(id => l[2].startsWith(id + ':'))));
  const unitLines = lines.filter(l => ids.includes(l[3]));
  const viewLines = lines.filter(l => l[3] === v.id);
  $('detailGrabT').textContent = short(z.name_ko);

  const inUnit = unitId && S.unitsById[unitId];
  let html = `<div class="d-head">
      <p class="eyebrow">${inUnit ? `${esc(short(z.name_ko))} · 에어컨 시점` : `전체 공간 시점 ${viewIdx + 1}`} · ${esc(viewKo(v))}</p>
      <h2>${inUnit ? `${esc(S.names[unitId] || unitId)} <span class="cap">${cap(inUnit)}</span>` : esc(short(z.name_ko))}</h2>
      <p class="view">${esc(nice(v.name_ko))}</p>
      ${inUnit && inUnit.exploded_url ? `<a class="exploded" href="${esc(inUnit.exploded_url)}" target="_blank" rel="noopener">이 에어컨 분해해서 보기 →</a>` : ''}
      <div class="seg views" role="group" aria-label="시점 선택">${P.views.map((q, i) => [q, i]).filter(([q]) => q.room === z.room)
        .map(([q, i]) => `<button type="button" data-view="${i}" aria-pressed="${i === viewIdx}">${q.kind === 'ac_closeup'
          ? `${esc(S.names[q.must_show[0]] || q.must_show[0])} <span class="k">당긴 구도</span>`
          : `시점 ${i + 1} <span class="k">${esc(viewKo(q))}</span>`}</button>`).join('')}</div>
    </div>
    <dl class="facts">
      <div><dt>면적</dt><dd>${n2(z.area_m2)}<small> ㎡</small><span class="sub2">${n2(z.area_m2 / m2py)}평</span></dd></div>
      <div><dt>좌석</dt><dd>${nSeats}<small> 석</small><span class="sub2">${seats.length ? esc([...new Set(seats.map(f => SEAT_KO[f.seat_type] || f.seat_type))].join(' · ')) : '좌석 없음'}</span></dd></div>
      <div><dt>4Way 대수</dt><dd>${us.length}<small> 대</small><span class="sub2">${us.length ? esc(modelSummary(us)) : '전용 실내기 없음'}</span></dd></div>
      <div><dt>용량 합</dt><dd>${us.length ? `${n1(sum(us, u => u.capacity_kw))}<small> kW</small>` : '-'}</dd></div>
    </dl>
    ${z.ac_reason ? `<p class="note">${srcLinks(z.ac_reason)}</p>` : ''}
    ${z.note ? `<p class="note">${esc(z.note)}</p>` : ''}
    ${z.load_basis ? `<p class="basis">용량 산정: ${srcLinks(z.load_basis)}</p>` : ''}`;

  if (us.length) {
    const u0 = us[0], rc = u => u.rule_check;
    const models = [...new Set(us.map(u => u.model))];
    html += `<section class="unit" aria-label="실내기">
      <h3><span>천장형 ${esc(modelSummary(us))}</span><span class="num">${n1(sum(us, u => u.capacity_kw))}<small> kW</small></span></h3>
      <div class="tbl-wrap"><table class="pipes"><thead><tr><th>실내기</th><th class="r">용량</th><th class="r">판넬 끝~벽</th><th class="r">조명까지</th></tr></thead><tbody>
        ${us.map(u => `<tr><td>${esc(S.names[u.id])}</td><td class="num">${cap(u)}</td><td class="num">${n0(rc(u).wall_edge_min_mm)} mm</td><td class="num">${n0(rc(u).light_edge_gap_min_mm)} mm</td></tr>`).join('')}
      </tbody></table></div>
      <dl class="dims">
        ${models.map(m => { const u = us.find(q => q.model === m); return `<dt>${esc(MODEL_KO[m] || m)}</dt><dd>판넬 ${u.size_mm.map(n0).join(' × ')} · 타공 ${(u.ceiling_opening_mm || []).map(n0).join(' × ') || '미확인'} · 본체 ${n0(u.body_h_mm)} mm</dd>`; }).join('')}
        <dt>설치 높이</dt><dd>천장 ${n0(u0.mount_z_mm)} mm · 천장 속 ${n0(P.ceiling.void_mm)} mm</dd>
        ${hasGrid ? `<dt>격자 정렬</dt><dd class="txt">${esc([...new Set(us.map(u => rc(u).grid_align))].join(' / '))} · 오차 ${esc([...new Set(us.map(u => rc(u).grid_err_mm.join(', ')))].join(' / '))} mm</dd>` : ''}
        <dt>중심 좌표</dt><dd>${us.map(u => `(${n0(u.center[0])}, ${n0(u.center[1])})`).join(' ')}</dd>
      </dl>
      <p class="basis">근거 ${srcLinks(u0.basis)}</p>
    </section>`;
    // 실외기 → 분지관 → 실내기 경로: 끝 구간에서 from 을 거슬러 올라간다(도면 배관 나무). from 이 없는 옛 JSON 은 주관 1줄
    const byId = Object.fromEntries(P.piping.map(p => [p.id, p])), BR = P.piping_branches || [];
    const brNo = pt => BR.findIndex(b => { const q = b.node || b.at; return Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 5; }) + 1;
    const segName = p => {
      const a = byId[p.from] ? (brNo(p.polyline[0]) ? `분지관 ${brNo(p.polyline[0])}` : '주관') : '실외기';   // from 이 배관이 아니면(실외기 세트 — 다배관) 실외기에서
      const b = p.to ? (S.names[p.to] || p.to) : (brNo(p.polyline[p.polyline.length - 1]) ? `분지관 ${brNo(p.polyline[p.polyline.length - 1])}` : '주관');
      return `${a} → ${b}`;
    };
    const rows = [];
    for (const leaf of P.piping.filter(p => ids.includes(p.to))) {
      const route = [];
      for (let q = leaf; q && !route.includes(q); q = byId[q.from]) route.unshift(q);
      for (const q of route) if (!rows.includes(q)) rows.push(q);
    }
    const L = (p, vert) => {   // 평면 길이(도면과 같은 값) / 수직 길이(입상·내림 — 높이 가정)
      let s = 0;
      for (let i = 1; i < p.polyline.length; i++) { const a = p.polyline[i - 1], b = p.polyline[i]; s += vert ? Math.abs(b[2] - a[2]) : Math.hypot(b[0] - a[0], b[1] - a[1]); }
      return s / 1000;
    };
    const r1 = v => Math.round(v * 10) / 10;           // 표에 보이는 값끼리 더해 합계가 행 합과 같게
    const vert = r1(sum(rows, p => L(p, true)));
    if (rows.length) html += `<section class="unit" aria-label="배관"><p class="sub">천장 속 냉매배관${P.outdoor_unit?.piping_type === 'multi' ? `(다배관 — 실내기마다 포트에서 따로, 이 실외기 다발 ${P.piping.filter(q => q.bundle && q.bundle === rows.find(p => p.bundle)?.bundle).length}가닥)` : BR.length ? `(단배관) · 분지관 ${[...new Set(BR.map(b => b.model_code).filter(Boolean))].join(', ')} ${BR.length}개` : ''}</p>
      <div class="tbl-wrap"><table class="pipes"><thead><tr><th>구간</th><th>규격</th><th class="r">길이</th></tr></thead><tbody>
        ${rows.map(p => `<tr><td>${esc(segName(p))}</td><td>${esc(p.spec || '')}</td><td class="num">${n1(r1(L(p)))} m</td></tr>`).join('')}
        ${vert > 0 ? `<tr><td>수직(높이 가정)</td><td></td><td class="num">${n1(vert)} m</td></tr>` : ''}
        ${rows.length > 1 || vert > 0 ? `<tr><td>합계</td><td></td><td class="num">${n1(sum(rows, p => r1(L(p))) + vert)} m</td></tr>` : ''}
      </tbody></table></div></section>`;
  }
  html += `<section class="unit" aria-label="규칙 검사">
      <p class="sub">구역 규칙 검사</p>${checkList(zoneLines)}
      ${unitLines.length ? `<p class="sub">실내기 설치 규칙</p>${us.map(u => { const ls = unitLines.filter(l => l[3] === u.id), bad = ls.filter(l => l[1] === 'WARN' || l[1] === 'FAIL').length;
        return `<details class="ulines"><summary>${esc(S.names[u.id])} · ${LV_KO.PASS} ${ls.filter(l => l[1] === 'PASS').length}${bad ? ` · ${LV_KO.WARN} ${bad}` : ''}</summary>${checkList(ls)}</details>`; }).join('')}` : ''}
      <p class="sub">시점 ${viewIdx + 1} 구도</p>
      <p class="basis">${v.fov_deg}° · FF ${v.focal_mm_ff36}mm · 카메라 높이 ${n0(v.camera[2])} mm · 렌즈 시프트 ${v.lens_shift_y}</p>
      ${checkList(viewLines)}
    </section>
    <button type="button" class="btn primary" id="detailHome" style="justify-self:start">전체 보기로 돌아가기</button>`;
  const body = $('detailBody');
  body.innerHTML = html;
  body.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => goZone(zoneId, Number(b.dataset.view))));
  $('detailHome').addEventListener('click', goHome);
}

/* ============ notes ============ */
function renderNotes() {
  const P = S.P;
  $('notesT').textContent = `${kindKo(P.space_type)} ${pyLabel(P)}평 · ${P.source_drawing ? '설계 도면' : P.input_kind === 'arch_drawing' ? '건축 도면' : '일반형 참고 평면'}·수치 출처`;
  const c = S.C.counts;
  $('notesMeta').textContent = `출처 ${P.sources.length} · 가정 ${P.assumptions.length} · 확인 필요 ${P.decisions_pending.length} · 검사 통과 ${c.PASS} 주의 ${c.WARN} 참고 ${c.INFO} 실패 ${c.FAIL}`;
  $('notesLeft').innerHTML = `
    <h3>이 평면은</h3>
    <p>${esc(P.title)}</p>
    <p>${srcLinks(P.generic_note)}</p>
    <p>${srcLinks(P.envelope.basis)}</p>
    <p>면적: ${esc(P.envelope.area_basis)}</p>
    <p>천장: ${esc(P.ceiling.finish)} · ${srcLinks(P.ceiling.grid.basis)} · ${srcLinks(P.ceiling.basis)}</p>
    <p>실내기 규칙: ${srcLinks(P.ac_rules.basis)}</p>
    <p>용량 산정: ${srcLinks(P.load_rule.method || P.load_rule.basis)} · ${srcLinks(P.load_total.research_row)}</p>
    <p>실외기: ${esc(P.outdoor_unit.location_ko)} · ${srcLinks(P.outdoor_unit.basis)}</p>
    <p>배수: ${srcLinks(P.drain_note)}</p>
    ${(P.ceiling_alternatives || []).map(a => `<p>천장 대안: ${srcLinks(a.note)}</p>`).join('')}
    <h3>확인 필요</h3>
    <ul>${P.decisions_pending.map(d => `<li>${srcLinks(d)}</li>`).join('')}</ul>
    <h3>가정·추정</h3>
    <ul>${P.assumptions.map(d => `<li>${srcLinks(d)}</li>`).join('')}</ul>
    <h3>규칙 검사 구성</h3>
    <ul>${S.C.sections.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
  $('srcList').innerHTML = P.sources.map(s => {
    const web = /^https?:\/\//.test(s.url);
    const href = web ? s.url.split(' ; ')[0] : '';
    return `<li id="src-${esc(s.id)}"><span class="sid">${esc(s.id)}</span><span>${web
      ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`
      : `${esc(s.title)}<span class="internal">내부 자료</span>`}</span></li>`;
  }).join('');
}
document.addEventListener('click', e => { if (e.target.closest('a[data-src]')) $('notes').open = true; });

/* ============ state / camera ============ */
let tween = null;
const NARROW = matchMedia('(max-width: 760px)');
const narrow = () => NARROW.matches;
// label sizes change at the breakpoint (.num/.kw/.minor hidden) and when the display=swap web font lands: re-measure in tick
const remeasure = () => Object.values(spaces).forEach(s => s.labels.forEach(l => { l.sz = null; }));
NARROW.addEventListener('change', remeasure);
document.fonts.addEventListener('loadingdone', remeasure);

// level camera + vertical lens shift (json camera_mode): shift the frustum by tan(pitch)
function updProj() {
  camera.updateProjectionMatrix();
  if (state.tanP) {
    const e = camera.projectionMatrix.elements;
    e[9] += state.tanP * e[5];
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
}
function occlusion() {
  const w = stage.clientWidth, h = stage.clientHeight, list = $('listSheet'), det = $('detailSheet');
  // embed: 시트를 CSS 로 숨겨도 hidden 속성은 syncUI 가 계속 푼다 -> offsetLeft 0 을 '열림'으로 읽어 방 시점이 반 화면 밀린다
  if (EMBED) return state.mode === 'house' ? { w, h, a: inset.l, b: inset.r, top: inset.t, bot: inset.b } : { w, h, a: 0, b: 0, top: 0, bot: 0 };
  const open = el => !el.hidden && !el.hasAttribute('data-collapsed');
  let a = 0, b = 0, top = 0, bot = 0;
  if (state.mode === 'house' || narrow()) top = document.querySelector('.topbar').offsetHeight;
  if (narrow()) {
    const sheet = state.mode === 'house' ? list : det;
    if (!sheet.hidden) bot = Math.min(sheet.getBoundingClientRect().height, h * .5) + 8;
  } else {
    if (open(list)) a = list.offsetLeft + list.offsetWidth;
    if (open(det)) b = w - det.offsetLeft;
  }
  return { w, h, a, b, top, bot };
}
function applyViewport() {
  const { w, h, a, b, top, bot } = occlusion();
  if (!w || !h) return; // 숨은 칸(0x0): 종횡비가 NaN 이 되면 컨트롤이 그 뒤로 변화를 못 알린다. 보이면 ResizeObserver 가 다시 부른다
  renderer.setSize(w, h, false);
  const W2 = w + Math.abs(a - b), H2 = h + Math.abs(top - bot);
  camera.aspect = W2 / H2;
  if (W2 !== w || H2 !== h) camera.setViewOffset(W2, H2, b > a ? b - a : 0, bot > top ? bot - top : 0, w, h); else camera.clearViewOffset();
  updProj();
  invalidate(); // setSize 가 드로잉 버퍼를 비운다
}
// fit the space's bounding box into the free area; try south, east and diagonal and keep the closest
function housePose() {
  const { w, h, a, b, top, bot } = occlusion();
  const fov = 30, tgt = S.center.clone().setY(.9);
  const cam = camera.clone(); cam.fov = fov; cam.updateProjectionMatrix();
  const availX = Math.max(160, w - a - b - 56), availY = Math.max(160, h - top - bot - 32);
  let best = null;
  // 도면에서 만든 공간은 도면과 같은 방향(북쪽이 화면 위)으로만 본다 — 90° 돌아간 첫 화면을 '방향이 틀렸다'로 읽는다
  for (const d of S.P.source_drawing ? [[.2, 1.12, 1]] : [[.2, 1.12, 1], [1, 1.12, .2], [.8, 1.2, .8], [-.8, 1.2, .8]]) {
    const dir = new THREE.Vector3(...d).normalize();
    let dist = 30;
    for (let it = 0; it < 4; it++) {
      cam.position.copy(tgt).addScaledVector(dir, dist); cam.lookAt(tgt); cam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of S.boxPts) {
        const v = c.clone().project(cam);
        x0 = Math.min(x0, v.x * w / 2); x1 = Math.max(x1, v.x * w / 2); y0 = Math.min(y0, v.y * h / 2); y1 = Math.max(y1, v.y * h / 2);
      }
      dist *= Math.max((x1 - x0) / availX, (y1 - y0) / availY);
    }
    if (!best || dist < best.dist * .9) best = { dist, dir }; // prefer earlier (south) unless clearly closer
  }
  return { pos: tgt.clone().addScaledVector(best.dir, best.dist), tgt, fov, tanP: 0, kind: 'house' };
}
function viewPose(i) {
  const v = S.P.views[i];
  const { w, h, a, b, top, bot } = occlusion();
  const freeW = Math.max(160, w - a - b), freeH = Math.max(160, h - top - bot), H2 = h + Math.abs(top - bot);
  const hf = v.fov_deg * DEG, [aw, ah] = v.aspect.split(':').map(Number);
  const v169 = 2 * Math.atan(Math.tan(hf / 2) / (aw / ah));
  const band = clamp(2 * Math.atan(Math.tan(hf / 2) / (freeW / freeH)), v169, (narrow() ? 104 : 84) * DEG);
  const full = 2 * Math.atan(Math.tan(band / 2) * H2 / freeH) / DEG;
  return {
    pos: V(...v.camera),
    tgt: V(v.target[0], v.target[1], v.camera[2]), // level camera
    tanP: v.lens_shift_y * 2 * Math.tan(hf / 2),     // shift_y = tan(pitch)·lens/36
    fov: Math.min(full, 150), kind: 'room',
  };
}
function configControls(kind, pose) {
  controls.enabled = true;
  const damp = controls.enableDamping; controls.enableDamping = false; controls.update(); controls.enableDamping = damp; // 끌다 놓은 관성 찌꺼기를 비운다(감쇠를 끄면 한 번에 적용하고 0 이 된다)
  camera.position.copy(pose.pos); // 그 한 번으로 틀어진 자리를 되돌린다. 방향은 아래 target + update 가 다시 잡는다
  if (kind === 'room') {
    Object.assign(controls, { enablePan: false, enableZoom: false, rotateSpeed: -.32, minDistance: 0, maxDistance: Infinity, minPolarAngle: .35, maxPolarAngle: 2.8 });
    const dir = pose.tgt.clone().sub(pose.pos).normalize();
    controls.target.copy(pose.pos).addScaledVector(dir, .01);
  } else {
    Object.assign(controls, { enablePan: true, enableZoom: true, rotateSpeed: .55, minDistance: 6, maxDistance: 110, minPolarAngle: .1, maxPolarAngle: 1.36 });
    controls.target.copy(pose.tgt);
  }
  if (EMBED) Object.assign(controls, { enableZoom: false, enablePan: false }); // 히어로 위 휠은 페이지 스크롤 (스크롤 하이재킹 금지)
  controls.update();
  if (polarSaved) { polarSaved = [controls.minPolarAngle, controls.maxPolarAngle]; controls.minPolarAngle = controls.maxPolarAngle = controls.getPolarAngle(); } // 터치 중 모드가 바뀌면 새 범위를 받아 두고, 방금 맞춘 각으로 다시 잠근다(맞추기 전에 잠그면 묵은 각이라 도착 자세가 꺾였다)
}
// 카메라 전환 — 2026-09-17 대표 '빠르다, 멀미 난다'(원인은 속도가 아니라 화면이 휙 도는 것) → 지키는 것 셋:
//  ① 자세는 방위·앙각 둘로만 정한다. 과녁 점을 lookAt 하면 카메라가 과녁 위를 지나는 순간 방위가 뒤집혀 화면이 시선축 둘레로 초당 수백° 돈다
//     (시선 '방향'만 재면 100°/s 로 보여 놓친다 — 10-06 검토).
//  ② 전체↔방: 천장 아래에서는 방 시점의 수직선 위에만 있는다 — 위에서 곧게 내려앉고 곧게 올라간다. 뒤에서 수평으로 들어가면 뒷벽을 뚫는 순간 화면이 벽으로 찬다
//     (천장은 아랫면만 그려 위에서 지날 때는 안 보인다).
//  ③ 전체↔방: 천장 위에서는 늘 집 안의 한 점을 본다(모형이 화면 밖으로 안 나간다) — 과녁 점 둘레의 방위·앙각·거리를 보간한다.
//     방에서 바깥벽 쪽이나 위를 보고 있었으면 뜨기 전에 제자리에서 집 안쪽·수평으로 돌린다(그 시간 몫이 hold).
// 방→방은 ②③ 밖이다(09-17 에 고른 대로 직선 + 살짝 넘기 + 시선 각 보간): 예시 평면에서 천장 아래 수평 이동 0.7~2.1m, 벽 위쪽(2.1~2.5m 높이)을
// 비치는 상태로 지난다. 곧게 떴다 내려앉는 식으로 바꾸려면 한 컷 비교부터.
// 시간은 그리지 않고 경로만 240점 계산해 자세 최고 각속도가 rate 를 넘지 않게 늘린다.
const CAM = { house: [2200, 4400], room: [1400, 2400], rate: 120, lift: [3.5, 8], reach: 4 }; // ms 범위 · °/s · 방 시점 위로 뜨는 높이 m(거리의 1/4, 이 범위 안) · 방에서 나갈 때 과녁 거리 m
const easeCam = t => (1 - Math.cos(Math.PI * t)) / 2; // sine in-out: 최고 속도가 평균의 π/2 배(3차 in-out 은 3배)
const sstep = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const azel = d => [Math.atan2(d.x, d.z), Math.asin(clamp(d.y, -1, 1))];
const dirOf = (az, el, o = new THREE.Vector3()) => o.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const flight = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 }, lookPt = new THREE.Vector3();
let arrived = 'house'; // 마지막으로 도착한 곳 — 멈춰 있을 때는 이것으로, 비행 중에는 카메라 자리(inside)로 방 안인지 본다
// 천장 아래 + 실내 사각형 안 = 방 안. 섞임 값 k 로 판정하면 방→방 비행 중(천장을 비치게 하느라 k 가 내려간다) 전체에서 온 것으로 잘못 읽는다
const inRect = (x, z, pad = 0) => { const [x0, y0, x1, y1] = S.P.envelope.interior_rect; return x > mm(x0) + pad && x < mm(x1) - pad && -z > mm(y0) + pad && -z < mm(y1) - pad; };
const inside = p => p.y < mm(S.P.ceiling.height_mm) && inRect(p.x, p.z);
function flyTo(pose, kTo) {
  const toRoom = kTo > .5, fromIn = tween ? inside(camera.position) : arrived === 'room'; // 멈춰 있을 때 자리로 보면 바짝 당겨 낮게 본 전체 보기도 '방 안'이 된다
  const p0 = camera.position.clone(), d0 = camera.getWorldDirection(new THREE.Vector3());
  const d1 = pose.tgt.clone().sub(pose.pos).normalize();
  const [az0, el0] = azel(d0), [az1, el1] = azel(d1);
  const moved = p0.distanceTo(pose.pos) > .01;
  if (fromIn && toRoom && !moved && d0.angleTo(d1) < .01 && Math.abs(state.k - kTo) < .01) { tween = null; configControls('room', pose); invalidate(); return; } // 이미 그 자리·그 방향: 헛비행(천장만 비쳤다 돌아옴) 없이 끝
  const tw = { t0: performance.now(), dur: 0, f0: camera.fov, s0: state.tanP, k0: state.k, pose, kTo, dip: fromIn && toRoom && moved };
  if (fromIn && toRoom) { // 방→방: 직선 + 살짝 넘기 + 시선 각 보간
    Object.assign(tw, { mode: 'line', p0, az0, daz: wrap(az1 - az0), el0, el1, arc: Math.min(3, p0.distanceTo(pose.pos) * .25) });
  } else {
    // 과녁 점 둘레 자세 {L 과녁, az, el, d 거리}. 시작 쪽은 지금 자세에서 만든다(묵은 controls.target 을 쓰지 않는다 — 비행 중에 다시 눌러도 이어진다)
    const flat = fromIn || el0 >= -.09; // 방 안이거나 수평 이상을 보는 중: 눈높이 reach 앞이 과녁. 위아래 각(tilt)과 집 밖을 향한 방위(turn)는 제자리에서 푼다
    let azS = az0, reach = CAM.reach;
    if (flat) { // reach 앞 점이 실내 사각형(0.3m 안쪽)에 드는 가장 가까운 방위
      const ok = az => inRect(p0.x + Math.sin(az) * reach, p0.z + Math.cos(az) * reach, .3);
      let k = 0; while (k <= 180 && !ok(az0 + k * DEG) && !ok(az0 - k * DEG)) k++;
      if (k > 180) { azS = Math.atan2(S.center.x - p0.x, S.center.z - p0.z); reach = Math.max(.5, Math.min(reach, Math.hypot(S.center.x - p0.x, S.center.z - p0.z))); } // 좁은 집: 가운데 쪽
      else azS = ok(az0 + k * DEG) ? az0 + k * DEG : az0 - k * DEG;
    }
    const lift = clamp(p0.distanceTo(pose.pos) * .25, ...CAM.lift);
    const over = (vp, az, r) => ({ L: dirOf(az, 0).multiplyScalar(r).add(vp), az, el: -Math.atan2(lift, r), d: Math.hypot(lift, r) }); // 방 시점 vp 바로 위 lift 높이에서, 시점 높이의 r 앞을 내려다보는 자세
    const here = () => flat ? { L: dirOf(azS, 0).multiplyScalar(reach).add(p0), az: azS, el: 0, d: reach }
      : (d => ({ L: p0.clone().addScaledVector(d0, d), az: az0, el: el0, d }))(clamp((p0.y - .9) / Math.sin(-el0), 2, 60)); // 내려다보는 중: 시선이 바닥 높이와 만나는 점
    const home = () => ({ L: pose.tgt, az: az1, el: el1, d: pose.pos.distanceTo(pose.tgt) });
    const out = fromIn && !toRoom;
    const [a, b] = toRoom ? [here(), over(pose.pos, az1, Math.max(.5, Math.hypot(pose.tgt.x - pose.pos.x, pose.tgt.z - pose.pos.z)))] : [out ? over(p0, azS, reach) : here(), home()];
    // 올려다본 각과 집 밖을 향한 방위는 뜨기 전에 제자리에서 푼다(hold) — 그대로 뜨면 한동안 빈 하늘·집 밖만 보인다. 내려다본 각은 뜨면서 풀린다
    const tilt = flat ? el0 : 0, turn = flat ? wrap(az0 - azS) : 0, need = Math.hypot(Math.max(0, tilt), turn) / DEG * 1.5 / CAM.rate * 1000, level = need > 1 ? Math.max(300, need) : 0; // 몇 도짜리도 0.3초는 들여 까딱하지 않게
    Object.assign(tw, { mode: toRoom ? 'in' : out ? 'out' : 'air', a, b, daz: wrap(b.az - a.az), lift: toRoom || out ? lift : 0, tilt, turn, hold: level / (level + CAM.house[0]) });
  }
  if (!reduced.matches) {
    const N = 240, o = { pos: new THREE.Vector3() };
    let peak = 0; // 한 칸(시간의 1/N)에 자세가 도는 최대 각 — 방위는 수직축, 앙각은 수평축 둘레라 둘이 직각이다
    tweenAt(tw, 0, o);
    for (let i = 1, y = o.yaw, q = o.pitch; i <= N; i++) { tweenAt(tw, i / N, o); peak = Math.max(peak, Math.hypot(wrap(o.yaw - y), o.pitch - q)); y = o.yaw; q = o.pitch; }
    tw.dur = clamp(peak * N / DEG / CAM.rate * 1000, ...(tw.mode === 'line' ? CAM.room : CAM.house));
  }
  tween = tw;
  controls.enabled = false;
  invalidate();
}
function tweenAt(tw, t, o) { // 진행 t(0..1) → o.pos 자리 · o.yaw/o.pitch 자세(rad). 반환은 섞임·화각에 쓰는 진행률
  if (tw.mode === 'line') {
    const e = easeCam(t);
    o.pos.lerpVectors(tw.p0, tw.pose.pos, e); o.pos.y += Math.sin(Math.PI * t) * tw.arc;
    o.yaw = tw.az0 + tw.daz * e; o.pitch = lerp(tw.el0, tw.el1, e);
    return e;
  }
  // in: 앞 75% 에 과녁 둘레로 돌아 방 시점 위에 서고, 뒤 50% 에 곧게 내려앉는다(겹치는 25% 는 아직 천장 위). out 은 그 거울, air 는 둘레 보간만
  const s = clamp((t - tw.hold) / (1 - tw.hold), 0, 1); // 고개 내리는 몫을 뺀 비행 진행
  const u = tw.mode === 'in' ? sstep(s / .75) : tw.mode === 'out' ? sstep((s - .25) / .75) : sstep(s);
  const c = tw.mode === 'in' ? sstep((s - .5) / .5) : tw.mode === 'out' ? 1 - sstep(s / .5) : 0;
  const { a, b } = tw, az = a.az + tw.daz * u, el = lerp(a.el, b.el, u), d = lerp(a.d, b.d, u);
  lookPt.lerpVectors(a.L, b.L, u);
  dirOf(az, el, o.pos).multiplyScalar(-d).add(lookPt); o.pos.y -= tw.lift * c;
  const hk = tw.hold ? 1 - sstep(t / tw.hold) : 0; // 제자리에서 푸는 몫
  o.yaw = az + tw.turn * hk;
  o.pitch = Math.atan2(lookPt.y - o.pos.y, d * Math.cos(el)) + tw.tilt * (tw.tilt > 0 ? hk : 1 - sstep(s / .35)); // 과녁을 보는 앙각 + 보던 위아래 각(올려다본 각은 뜨기 전에, 내려다본 각은 뜨면서 풀린다)
  return sstep(s);
}
function syncUI() {
  const inRoom = state.mode !== 'house';
  $('btnHome').hidden = !inRoom;
  $('btnPipes').hidden = inRoom; // pipes sit above the finished ceiling: nothing to toggle in a room view
  $('detailSheet').hidden = !inRoom;
  stage.classList.toggle('in-room', inRoom);
  $('listSheet').hidden = narrow() && inRoom;
  $('hint').textContent = inRoom ? '드래그로 둘러보기 · Esc 전체 보기' : '천장 에어컨을 누르면 그 에어컨 시점으로 · 바닥을 누르면 그 구역으로 · 드래그 회전 · 휠 확대';
  document.querySelectorAll('#zoneList .room-btn').forEach(b => b.setAttribute('aria-current', String(b.dataset.zone === state.zone)));
  document.querySelectorAll('#zoneList .unit-btn').forEach(b => b.setAttribute('aria-current', String(b.dataset.unit === state.unit)));
  tabBtns.forEach(b => { const on = b.dataset.space === S.key; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  stage.setAttribute('aria-labelledby', `tab-${S.key}`);
}
function markUnit(id) {
  for (const s of Object.values(spaces)) for (const [uid, m] of Object.entries(s.unitMark || {})) m.visible = s === S && uid === id;
}
function goUnit(id) { // "에어컨을 누르면 그 에어컨 시점으로": the unit's own ac_closeup, else any view that must show it
  const u = S.unitsById[id];
  if (!u) return;
  const shows = v => v.must_show !== 'all' && v.must_show.includes(id);
  const vi = S.P.views.findIndex(v => v.kind === 'ac_closeup' && shows(v));
  const alt = vi >= 0 ? vi : S.P.views.findIndex(shows);
  goZone(u.zone, alt >= 0 ? alt : undefined, id);
}
function goZone(id, viewIdx, unitId) {
  const z = S.P.zones.find(q => q.id === id);
  if (!z) return;
  viewIdx ??= viewFor(z);
  if (!S.P.views[viewIdx]) return; // 실내기도 시점도 없는 실(욕실 등) — 갈 자리가 없다
  const list = $('listSheet');
  if (!narrow() && !list.hasAttribute('data-collapsed')) { list.setAttribute('data-collapsed', ''); $('listGrab').setAttribute('aria-expanded', 'false'); state.autoCollapsed = true; }
  state.mode = 'room'; state.zone = id; state.view = viewIdx; state.unit = unitId || null;
  setHover(null);
  syncUI();
  renderDetail(id, viewIdx, state.unit);
  markUnit(state.unit && S.P.views[viewIdx]?.kind !== 'ac_closeup' ? state.unit : null);
  applyViewport();
  flyTo(viewPose(viewIdx), 1);
  if (EMBED) {
    const u = unitId && S.unitsById[unitId], us = S.unitsByZone[id] || [];
    post({ type: 'enter', id: unitId || id,
      title: u ? entryName(u) : short(z.name_ko),
      sub: u ? `${MODEL_KO[u.model] || u.model} ${cap(u)}` : (us.length ? `${modelSummary(us)} · ${n1(sum(us, q => q.capacity_kw))}kW` : '전용 실내기 없음') });
  }
}
function goHome() {
  if (state.mode === 'house' && !tween) return;
  state.mode = 'house'; state.zone = null; state.unit = null; markUnit(null);
  if (state.autoCollapsed) { $('listSheet').removeAttribute('data-collapsed'); $('listGrab').setAttribute('aria-expanded', 'true'); state.autoCollapsed = false; }
  syncUI(); applyViewport();
  flyTo(housePose(), 0);
  if (EMBED) post({ type: 'home' }); else $('listGrab').focus({ preventScroll: true });
}
function setSpace(key) {
  if (!DATA[key] || S?.key === key) return;
  if (S) { S.root.visible = false; S.labels.forEach(l => { l.el.hidden = true; }); setHover(null); markUnit(null); }
  S = spaces[key] ??= buildSpace(key);
  S.root.visible = true;
  S.labels.forEach(l => { l.el.hidden = false; });
  const pal = PALETTE[DATA[key].space_type] || PALETTE.default;
  mat.wall.color.setHex(pal.wall); mat.wallHi.color.setHex(pal.wall);
  placeSun();
  tween = null; arrived = 'house'; state.mode = 'house'; state.zone = null; state.view = 0; state.tanP = 0;
  if (state.autoCollapsed) { $('listSheet').removeAttribute('data-collapsed'); $('listGrab').setAttribute('aria-expanded', 'true'); state.autoCollapsed = false; }
  renderList(); renderNotes();
  syncUI(); setBlend(0); applyViewport();
  const p = housePose();
  camera.position.copy(p.pos); camera.fov = p.fov; updProj();
  configControls('house', p);
  try { history.replaceState(null, '', '#' + key); } catch { /* sandboxed */ }
  if (readySent) post({ type: 'space', key, entries: entries() });
}
// 히어로 목록: 실내기 단위. 한 구역에 여러 대면 배치 이름(창측 서…), 한 대면 구역 이름
function entryName(u) { return (S.unitsByZone[u.zone] || []).length > 1 ? (S.names[u.id] || u.id) : short(S.P.zones.find(z => z.id === u.zone)?.name_ko || u.id); }
function entries() {
  return S.units.map(u => ({ id: u.id, zone: u.zone, name: entryName(u), sub: `${MODEL_KO[u.model] || u.model} ${cap(u)}` }));
}
function setBlend(k) {
  state.k = k;
  const solid = k > .999;
  for (const [m, base] of [[mat.wallHi, .08], [mat.mullion, .1]]) {
    m.opacity = lerp(base, 1, k);
    if (m.transparent === solid) { m.transparent = !solid; m.depthWrite = solid; m.needsUpdate = true; }
  }
  mat.ceil.opacity = k;
  if (mat.ceil.transparent === solid) { mat.ceil.transparent = !solid; mat.ceil.needsUpdate = true; }
  S.g.ceil.visible = k > .01;
  mat.grid.opacity = lerp(.32, .95, k); mat.grid.color.lerpColors(GRID_OVER, GRID_ROOM, k);
  mat.patch.opacity = .6 * (1 - k); mat.patchEdge.opacity = .9 * (1 - k); mat.arrow.opacity = .75 * (1 - k);
  S.patchObjs.forEach(o => { o.visible = k < .99; });
  skyMat.opacity = k; towerMat.opacity = k;
  // embed: 전체 보기 쪽으로 가는 전환(복귀)에선 원경을 끈다 — 당겨 나오는 동안 빌딩이 히어로 전체에 기둥처럼 떠다닌다
  skyGroup.visible = k > .01 && !(EMBED && state.mode === 'house');
  S.slab.visible = k > .5;
  $('labels').classList.toggle('off', k > .02 || state.mode !== 'house');
  lightForBlend();
}

/* ============ interaction ============ */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointer = null, down = null;
function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const d = ray.intersectObjects(S.allPick, false)[0]?.object.userData; // units sit above the floor, so they win on distance
  return d ? (d.unit || d.zone || null) : null;
}
function setHover(id) {
  const z = id && S?.P.zones.find(q => q.id === id);
  if (z && viewFor(z) < 0) id = null; // 갈 시점이 없는 구역(욕실 등)은 강조·손 모양을 켜지 않는다
  if (state.hover === id) return;
  state.hover = id;
  for (const s of Object.values(spaces)) {
    for (const [zid, m] of Object.entries(s.hoverMeshes)) m.visible = s === S && zid === id && state.mode === 'house';
    for (const [uid, m] of Object.entries(s.unitHover)) m.visible = s === S && uid === id && state.mode === 'house';
  }
  S?.labels.forEach(l => l.el.classList.toggle('is-hover', l.id != null && l.id === id));
  document.querySelectorAll('#zoneList .room-btn, #zoneList .unit-btn').forEach(b => b.classList.toggle('is-hover', (b.dataset.zone || b.dataset.unit) === id));
  canvas.style.cursor = id ? 'pointer' : '';
  invalidate();
}
canvas.addEventListener('pointermove', e => { pointer = e; if (EMBED && state.mode === 'house' && !tween && !e.buttons) setHover(pick(e)); });
canvas.addEventListener('pointerleave', () => { pointer = null; if (state.mode === 'house') setHover(null); });
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', e => {
  if (!down || state.mode !== 'house' || (tween && !tween.intro)) return; // 인트로 중 탭도 받는다(10-02)
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  if (moved < (e.pointerType === 'touch' ? 12 : 6) && performance.now() - down.t < (e.pointerType === 'touch' ? 900 : 600)) /* 손가락 떨림 5~15px 로 탭이 버려지던 것 */ { const id = pick(e); if (id) (S.unitsById[id] ? goUnit(id) : goZone(id)); }
  down = null;
});
$('btnHome').addEventListener('click', goHome);
$('btnPipes').addEventListener('click', () => {
  state.pipes = !state.pipes; Object.values(spaces).forEach(s => { s.g.pipes.visible = state.pipes; });
  $('btnPipes').setAttribute('aria-pressed', String(state.pipes));
});
$('btnAir').addEventListener('click', () => {
  state.air = !state.air; Object.values(spaces).forEach(s => { s.g.air.visible = state.air; });
  $('btnAir').setAttribute('aria-pressed', String(state.air));
});
$('btnGrid').addEventListener('click', () => {
  state.grid = !state.grid; Object.values(spaces).forEach(s => { s.g.grid.visible = state.grid; });
  $('btnGrid').setAttribute('aria-pressed', String(state.grid));
});
addEventListener('keydown', e => { if (e.key === 'Escape' && state.mode !== 'house') goHome(); });

let lastW = 0;
new ResizeObserver(() => {
  if (!S || !stage.clientWidth) return; // 부모가 칸을 숨긴 동안(폭 0)은 건드리지 않는다
  applyViewport();
  const w = stage.clientWidth;
  if (w !== lastW) {
    lastW = w; syncUI();
    if (tween) return;
    const pose = state.mode === 'house' ? housePose() : viewPose(state.view);
    camera.position.copy(pose.pos); camera.fov = pose.fov; state.tanP = pose.tanP; updProj();
    configControls(state.mode, pose);
  }
}).observe(stage);

/* ============ loop ============ */
const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
const northG = $('northG');
function tick(now, manual) {
  let moving = false;
  if (tween) {
    const t = tween.dur ? clamp((now - tween.t0) / tween.dur, 0, 1) : 1, e = tweenAt(tween, t, flight);
    camera.position.copy(flight.pos); camera.rotation.set(flight.pitch, flight.yaw + Math.PI, 0, 'YXZ'); // 카메라는 -Z 를 본다
    camera.fov = lerp(tween.f0, tween.pose.fov, e); state.tanP = lerp(tween.s0, tween.pose.tanP, e); updProj();
    setBlend(clamp(lerp(tween.k0, tween.kTo, e) - (tween.dip ? .75 * Math.sin(Math.PI * t) : 0), 0, 1));
    if (t >= 1) {
      const p = tween.pose.kind === 'room' ? viewPose(state.view) : housePose(); // 비행 중에 칸 크기가 바뀌었으면 지금 크기의 자세로(안 바뀌었으면 같은 값)
      tween = null; arrived = p.kind;
      camera.fov = p.fov; state.tanP = p.tanP; updProj();
      setBlend(p.kind === 'room' ? 1 : 0); configControls(p.kind, p);
    }
  } else {
    moving = controls.update(); // 댐핑 꼬리가 남아 있으면 true
    if (state.mode === 'house' && pointer && !pointer.buttons) setHover(pick(pointer));
  }
  if (state.k < .02) {
    // declutter: hovered zone (its label + unit chips) first, then zones with units, then bigger area. A zone label that does
    // not fit drops to its name, then hides; unit chips show only for the hovered zone. The side list keeps every zone/unit.
    // ponytail: greedy O(n²) per frame (~0.02ms at 54 labels); bucket grid if a plan ever has hundreds of labels
    const w = stage.clientWidth, h = stage.clientHeight, hz = S.unitsById[state.hover]?.zone ?? state.hover, taken = [];
    const act = l => l.id === hz || l.zone === hz;
    const fits = (x, y, [hw, hh]) => hw > 0 && !taken.some(r => Math.abs(r[0] - x) < r[2] + hw + 2 && Math.abs(r[1] - y) < r[3] + hh + 2);
    S.labels.sort((a, b) => act(b) - act(a) || b.pri - a.pri);
    for (const l of S.labels) {
      tmp.copy(l.v).project(camera);
      const el = l.el, size = on => (el.classList.toggle('name', on), [el.offsetWidth / 2, el.offsetHeight / 2]);
      l.sz ||= [size(true), size(false)]; // [name only, full] half sizes; cleared by remeasure()
      const hw = l.sz[1][0]; // keep labels (e.g. the outdoor-unit tag outside the walls) inside the stage
      const x = clamp((tmp.x + 1) / 2 * w, hw + 8, w - hw - 8), y = (1 - tmp.y) / 2 * h;
      const a = hw > 0 && act(l), full = a || (!l.zone && fits(x, y, l.sz[1])), name = !full && !l.zone && fits(x, y, l.sz[0]);
      if (full || name) taken.push([x, y, ...l.sz[full ? 1 : 0]]);
      el.classList.toggle('name', name);
      el.classList.toggle('cull', !full && !name);
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`;
    }
  }
  camera.getWorldDirection(fwd); fwd.y = 0;
  if (fwd.lengthSq() > 1e-8) { // 정수리에서 내려다보면 수평 성분이 0 -> normalize 가 NaN 이 되어 나침반 transform 이 깨진다
    fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    northG.setAttribute('transform', `rotate(${(Math.atan2(-right.z, -fwd.z) / DEG).toFixed(1)})`);
  }
  renderer.render(scene, camera);
  if (!EMBED) { if (!manual) requestAnimationFrame(tick); return; }
  frameQueued = false;
  if (tween || moving) invalidate();
  if (!readySent) { readySent = true; post({ type: 'ready', key: S.key, entries: entries() }); }
}
if (matchMedia('(max-width: 1100px)').matches) { // phones/tablets: start with the list folded
  $('listSheet').setAttribute('data-collapsed', ''); $('listGrab').setAttribute('aria-expanded', 'false');
}
setSpace(KEYS.includes(location.hash.slice(1)) ? location.hash.slice(1) : KEYS[0]);
addEventListener('hashchange', () => setSpace(location.hash.slice(1))); // typed #cafe / back button: setSpace ignores unknown keys
if (EMBED) {
  controls.addEventListener('change', invalidate);
  invalidate();
  // 모형 위에 파일을 떨어뜨리면 이 문서가 그 파일로 넘어가 버린다 — 막고, 같은 출처 부모가 있으면 넘긴다(올리기 칸이 있는 페이지용)
  addEventListener('dragover', e => e.preventDefault());
  const hand = f => { if (f && parent !== window) parent.postMessage({ ns: 'bd3d', viewer: 'commercial', type: 'drop', file: f }, location.origin); };
  addEventListener('drop', e => { e.preventDefault(); hand(e.dataTransfer?.files?.[0]); });
  addEventListener('paste', e => hand(e.clipboardData?.files?.[0])); // 모형을 누른 뒤에는 초점이 이 문서에 있어 부모가 붙여넣기를 못 받는다
  addEventListener('message', e => {
    const m = e.data;
    if (e.source !== parent || !m || m.ns !== 'bd3d') return;
    if (m.type === 'space' && KEYS.includes(m.key)) setSpace(m.key);
    else if (m.type === 'home') goHome();
    else if (m.type === 'goZone') goZone(m.id);
    else if (m.type === 'goUnit') {
      const key = KEYS.find(k => DATA[k].ac_units.some(u => u.id === m.id));
      if (key) { setSpace(key); goUnit(m.id); }
    } else if (m.type === 'inset') {
      const num = v => Math.max(0, Number(v) || 0);
      inset = { l: num(m.l), r: num(m.r), t: num(m.t), b: num(m.b) };
      applyViewport();
      if (state.mode === 'house' && !tween) {
        const p = housePose();
        camera.position.copy(p.pos); camera.fov = p.fov; state.tanP = p.tanP; updProj();
        configControls('house', p);
      }
    }
  });
} else requestAnimationFrame(tick);
window.__c3d = { goZone, goUnit, goHome, setSpace, state, get S() { return S; }, camera, controls, renderer, get tween() { return tween; }, step: now => tick(now, true) }; // step: 화면 없이 전환을 시간값으로 한 걸음씩(자세 각속도·경로 검사)
