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

// m = 카탈로그 행 {shape, widthMm, depthMm, heightMm, tone}. 돌려주는 값: PNG 주소(못 찍으면 null)
function shoot(m) {
  const doc = createDoc(), f = doc.floors[doc.cur];
  f.items.push({ id: 'I1', kind: 'furniture', shape: m.shape, name: 't', c: [0, 0], rot: 0, size: [m.widthMm, m.depthMm], heightMm: m.heightMm, ...(m.tone ? { tone: m.tone } : {}) });
  const data = meshData(buildMesh(doc, doc.cur)), scene = new THREE.Scene(), made = [];
  for (const r of FURN_ROLES) {
    const sd = data.furn[r]; if (!sd.idx.length) continue;
    const g = geometryOf(sd), mt = new THREE.MeshStandardMaterial({ color: colors?.get(`furn-${r}`) || 0x9a968e, roughness: r === 'screen' ? 0.3 : 0.9, metalness: r === 'metal' || r === 'steel' ? 0.4 : 0 });
    const eg = new THREE.EdgesGeometry(g, 30), lm = new THREE.LineBasicMaterial({ color: 0x55534e, transparent: true, opacity: 0.55 });   // 윤곽선 — 흰 상판도 바탕과 갈린다
    made.push(g, mt, eg, lm); scene.add(new THREE.Mesh(g, mt), new THREE.LineSegments(eg, lm));
  }
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-2, 4, 3);
  scene.add(new THREE.AmbientLight(0xffffff, 0.9), new THREE.HemisphereLight(0xffffff, 0x8a857b, 0.6), sun);
  const s = Math.max(m.widthMm, m.depthMm, m.heightMm) * 0.001, cy = m.heightMm * 0.0005;   // m 단위, 가운데 높이
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
    if (url === undefined) { try { url = shoot(job.m); } catch { url = null; } cache.set(job.key, url); }
    if (url) job.img.src = url;
    setTimeout(step, 16);   // 한 장씩 — 화면이 멈추지 않게(rAF 는 숨은 탭에서 멈춘다)
  };
  setTimeout(step, 0);
}

// 카드에 넣을 <img>(찍기 전엔 빈 칸). WebGL 을 못 쓰면 null. getColors() → Map(id → 색) 을 처음 한 번 부른다
export function furnitureThumb(m, getColors) {
  if (typeof document === 'undefined' || !setup()) return null;
  const img = document.createElement('img');
  img.className = 'pl-thumb'; img.alt = ''; img.width = W; img.height = H; img.decoding = 'async';
  const key = `${m.shape}|${m.widthMm}|${m.depthMm}|${m.heightMm}|${m.tone || ''}`, hit = cache.get(key);
  if (hit) { img.src = hit; return img; }
  if (hit === null) return img;
  Promise.resolve(colors || getColors?.()).then((c) => { colors = c || colors; queue.push({ img, m, key }); pump(); }, () => { queue.push({ img, m, key }); pump(); });
  return img;
}
