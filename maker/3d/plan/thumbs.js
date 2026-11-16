// 가구 썸네일 — 우리 3D 모형(core/mesh3d.js furnitureParts)을 비스듬히 찍은 그림. WebGL 문맥 하나를 돌려 쓰고, 같은 모양·크기·색은 한 번만 찍는다.
// WebGL 을 못 쓰면(그래픽 가속 꺼짐) 그림 없이 둔다 — 카드는 글자만으로도 쓸 수 있다
import * as THREE from '../view/lib/three-0.160.0/three.module.min.js';
import { createDoc } from './core/model.js';
import { buildMesh } from './core/mesh3d.js';
import { meshData, geometryOf, FURN_ROLES } from './view3d.js';

const W = 240, H = 180, cache = new Map(), queue = [];
let renderer = null, dead = false, busy = false, colors = null;

function setup() {
  if (renderer || dead) return !!renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    if (!renderer.getContext()) throw new Error('webgl');
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); renderer.setClearColor(0x000000, 0);
  } catch { renderer?.dispose?.(); renderer = null; dead = true; }
  return !!renderer;
}

// 조각 하나(기하·재질 이름)를 장면에 — 윤곽선을 함께 그려 흰 면도 바탕과 갈린다
function put(scene, made, g, r, at = [0, 0, 0]) {
  const mt = new THREE.MeshStandardMaterial({ color: colors?.get(`furn-${r}`) || 0x9a968e, roughness: r === 'screen' ? 0.3 : 0.9, metalness: r === 'metal' || r === 'steel' ? 0.4 : 0 });
  const eg = new THREE.EdgesGeometry(g, 30), lm = new THREE.LineBasicMaterial({ color: 0x55534e, transparent: true, opacity: 0.55 });
  const a = new THREE.Mesh(g, mt), b = new THREE.LineSegments(eg, lm); a.position.set(...at); b.position.set(...at);
  made.push(g, mt, eg, lm); scene.add(a, b);
}
// m = 카탈로그 행 {shape, widthMm, depthMm, heightMm, tone}. 돌려주는 값: PNG 주소(못 찍으면 null)
function shoot(m) {
  const doc = createDoc(), f = doc.floors[doc.cur];
  f.items.push({ id: 'I1', kind: 'furniture', shape: m.shape, name: 't', c: [0, 0], rot: 0, size: [m.widthMm, m.depthMm], heightMm: m.heightMm, ...(m.tone ? { tone: m.tone } : {}) });
  const data = meshData(buildMesh(doc, doc.cur)), scene = new THREE.Scene(), made = [];
  for (const r of FURN_ROLES) { const sd = data.furn[r]; if (sd.idx.length) put(scene, made, geometryOf(sd), r); }
  return snap(scene, made, Math.max(m.widthMm, m.depthMm, m.heightMm) * 0.001, m.heightMm * 0.0005);
}
// 시스템에어컨 판넬 — 아랫면(토출구·흡입 그릴)이 위를 보게 눕혀 찍는다. 토출구 자리는 형식(1Way·2Way·4Way·미니 4Way·360)대로, 크기는 판넬 제원 가로·깊이
function shootAc(m) {
  const scene = new THREE.Scene(), made = [], w = m.w * 0.001, d = m.d * 0.001, T = 0.04, box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  put(scene, made, box(w, T, d), 'top', [0, T / 2, 0]);
  const slot = (x, z, cx, cz) => put(scene, made, box(x, 0.004, z), 'screen', [cx, T + 0.002, cz]), grille = (x, z, cx = 0, cz = 0) => put(scene, made, box(x, 0.003, z), 'gray', [cx, T + 0.0015, cz]);
  if (m.type === '1way') { slot(w * 0.86, d * 0.14, 0, -d * 0.24); grille(w * 0.86, d * 0.42, 0, d * 0.12); }
  else if (m.type === '2way') { slot(w * 0.84, d * 0.12, 0, -d * 0.32); slot(w * 0.84, d * 0.12, 0, d * 0.32); grille(w * 0.8, d * 0.3); }
  else if (m.type === '360') { const r = Math.min(w, d) * 0.42, cyl = (rr, hh) => new THREE.CylinderGeometry(rr, rr, hh, 48);
    put(scene, made, cyl(r, 0.004), 'screen', [0, T + 0.002, 0]); put(scene, made, cyl(r * 0.84, 0.006), 'top', [0, T + 0.003, 0]); put(scene, made, cyl(r * 0.55, 0.008), 'gray', [0, T + 0.004, 0]); }
  else { grille(w * 0.5, d * 0.5); for (const sg of [1, -1]) { slot(w * 0.6, d * 0.07, 0, sg * d * 0.36); slot(w * 0.07, d * 0.6, sg * w * 0.36, 0); } }   // 4Way·미니 4Way
  return snap(scene, made, Math.max(w, d) * 0.8, T / 2);
}
function snap(scene, made, s, cy) {
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-2, 4, 3);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9), new THREE.HemisphereLight(0xffffff, 0x8a857b, 0.6), sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100), half = s * 0.7, a = W / H;
  Object.assign(cam, { left: -half * a, right: half * a, top: half, bottom: -half });
  cam.position.set(s * 1.6, cy + s * 1.3, s * 2.0); cam.lookAt(0, cy, 0); cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  for (const o of made) o.dispose();
  return url;
}

function pump() {
  if (busy) return; busy = true;
  const step = () => {
    const job = queue.shift();
    if (!job) { busy = false; return; }
    let url = cache.get(job.key);
    if (url === undefined) { try { url = job.ac ? shootAc(job.m) : shoot(job.m); } catch { url = null; } cache.set(job.key, url); }
    if (url) job.img.src = url;
    setTimeout(step, 16);   // 한 장씩 — 화면이 멈추지 않게(rAF 는 숨은 탭에서 멈춘다)
  };
  setTimeout(step, 0);
}

// 카드에 넣을 <img>(찍기 전엔 빈 칸). WebGL 을 못 쓰면 null. getColors() → Map(id → 색) 을 처음 한 번 부른다
function thumb(m, key, ac, getColors) {
  if (typeof document === 'undefined' || !setup()) return null;
  const img = document.createElement('img');
  img.className = 'pl-thumb'; img.alt = ''; img.width = W; img.height = H; img.decoding = 'async';
  const hit = cache.get(key);
  if (hit) { img.src = hit; return img; }
  if (hit === null) return img;
  const go = () => { queue.push({ img, m, key, ac }); pump(); };
  Promise.resolve(colors || getColors?.()).then((c) => { colors = c || colors; go(); }, go);
  return img;
}
export const furnitureThumb = (m, getColors) => thumb(m, `f|${m.shape}|${m.widthMm}|${m.depthMm}|${m.heightMm}|${m.tone || ''}`, false, getColors);
// m = {type: '1way'…, w, d}(판넬 가로·깊이 mm)
export const acThumb = (m, getColors) => thumb(m, `a|${m.type}|${m.w}|${m.d}`, true, getColors);
