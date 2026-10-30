// 맵스(도면 검색) — 단지 분포 지도 · 검색 · 핀 · 상세 · 타입 선택. 위쪽은 순수 함수(검색·투영·라벨 배치·히트·형식 검사: node 로 테스트), 아래 boot() 가 DOM 을 붙인다.
// 바탕 지도: 웹 메르카토르 캔버스. 기본은 OpenStreetMap 래스터 타일(키·비용 없음, BASEMAP) — 개발 단계 기본값이다. 서비스에 올릴 때는 제공자 약관(타일 사용 정책·사용량)을 보고 BASEMAP 한 곳만 바꾼다(null 이면 경위선 격자만 그린다).
// 주소 검색(Nominatim)은 입력창에서 사용자가 직접 누를 때만 한 번 부른다(글자마다 부르지 않는다). 단지 자료는 data/complexes.json.

const TILE = 256, MIN_Z = 3, MAX_Z = 19, LAT_MAX = 85.0511287798;
export const DEFAULT_VIEW = { lat: 36.5, lng: 127.8, zoom: 7 };   // 자료가 없을 때 처음 보는 곳(한반도 전체)
export const PIN = { r: 12, head: 22, h: 34 };                    // 핀: 끝점(x,y) 기준 머리 중심 y-22, 반지름 12, 전체 높이 34
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── 투영(웹 메르카토르, 줌 z 에서 세계 크기 256·2^z px) ──────────────────────
const wx = (lng, z) => (lng + 180) / 360 * TILE * 2 ** z;
const wy = (lat, z) => { const s = Math.sin(clamp(lat, -LAT_MAX, LAT_MAX) * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z; };
const fromWorld = (X, Y, z) => { const W = TILE * 2 ** z; return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * Y / W))) * 180 / Math.PI, lng: X / W * 360 - 180 }; };

// view = {lat, lng(화면 가운데), zoom(소수 가능), w, h(캔버스 css px)} → 화면 좌표. 위도가 클수록 위(y 작음).
export function project(lat, lng, v) { return { x: v.w / 2 + wx(lng, v.zoom) - wx(v.lng, v.zoom), y: v.h / 2 + wy(lat, v.zoom) - wy(v.lat, v.zoom) }; }
export function unproject(x, y, v) { return fromWorld(wx(v.lng, v.zoom) + x - v.w / 2, wy(v.lat, v.zoom) + y - v.h / 2, v.zoom); }
export function panBy(v, dx, dy) { const c = unproject(v.w / 2 - dx, v.h / 2 - dy, v); return { ...v, lat: clamp(c.lat, -LAT_MAX, LAT_MAX), lng: clamp(c.lng, -180, 180) }; }
export function zoomAt(v, zoom, px, py) {           // 화면 (px,py) 아래 좌표가 그대로 있게 배율만 바꾼다
  const p = unproject(px, py, v), n = { ...v, zoom: clamp(zoom, MIN_Z, MAX_Z) }, q = project(p.lat, p.lng, n);
  return panBy(n, px - q.x, py - q.y);
}
// inset = 카드·시트가 가린 가장자리 {l,t,r,b}(px). 가리지 않은 영역의 가운데에 (lat,lng)가 오게 한다.
export function centerOn(v, lat, lng, zoom, inset = {}) {
  const i = { l: 0, t: 0, r: 0, b: 0, ...inset }, z = clamp(zoom, MIN_Z, MAX_Z);
  const c = fromWorld(wx(lng, z) - (i.l - i.r) / 2, wy(lat, z) - (i.t - i.b) / 2, z);
  return { w: v.w, h: v.h, lat: c.lat, lng: c.lng, zoom: z };
}
export function fitView(pts, w, h, inset = {}, margin = 40) {   // 점들이 가리지 않은 영역 안에 들어오는 배율·가운데. 줌 상한 16
  const i = { l: 0, t: 0, r: 0, b: 0, ...inset };
  if (!pts.length) return centerOn({ w, h }, DEFAULT_VIEW.lat, DEFAULT_VIEW.lng, DEFAULT_VIEW.zoom, i);
  let la0 = 90, la1 = -90, ln0 = 180, ln1 = -180;
  for (const p of pts) { la0 = Math.min(la0, p.lat); la1 = Math.max(la1, p.lat); ln0 = Math.min(ln0, p.lng); ln1 = Math.max(ln1, p.lng); }
  const aw = Math.max(1, w - i.l - i.r - 2 * margin), ah = Math.max(1, h - i.t - i.b - 2 * margin);
  const sx = (ln1 - ln0) / 360 * TILE, sy = wy(la0, 0) - wy(la1, 0);   // 줌 0 에서의 폭·높이
  const z = Math.min(sx > 0 ? Math.log2(aw / sx) : 20, sy > 0 ? Math.log2(ah / sy) : 20, 16);
  return centerOn({ w, h }, fromWorld(0, (wy(la0, 0) + wy(la1, 0)) / 2, 0).lat, (ln0 + ln1) / 2, z, i);
}

// ── 바탕 지도(래스터 타일) · 주소 검색 ───────────────────────────────────────
export const BASEMAP = Object.freeze({ tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZ: 19, geocode: 'https://nominatim.openstreetmap.org/search', credit: '© OpenStreetMap 기여자', creditUrl: 'https://www.openstreetmap.org/copyright' });
export const tileUrl = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
// 화면에 보이는 타일. 타일 줌 z = 반올림한 줌, 화면 크기 s = 256·2^(줌-z). [{z,x,y,sx,sy,s}] — (sx,sy) 는 타일 왼쪽 위의 화면 좌표(css px). 세계 가장자리 밖은 뺀다.
export function visibleTiles(v, maxZ = 19) {
  const z = clamp(Math.round(v.zoom), 0, maxZ), s = TILE * 2 ** (v.zoom - z), n = 2 ** z, x0 = wx(v.lng, v.zoom) - v.w / 2, y0 = wy(v.lat, v.zoom) - v.h / 2, out = [];
  for (let ty = Math.max(0, Math.floor(y0 / s)); ty <= Math.min(n - 1, Math.floor((y0 + v.h) / s)); ty++)
    for (let tx = Math.max(0, Math.floor(x0 / s)); tx <= Math.min(n - 1, Math.floor((x0 + v.w) / s)); tx++) out.push({ z, x: tx, y: ty, sx: tx * s - x0, sy: ty * s - y0, s });
  return out;
}
// 주소 검색 주소(Nominatim): 한국 안, 최대 5건, 한국어. 검색어는 앞뒤 공백을 떼고 80자까지.
export const placesUrl = (base, q) => base + '?format=jsonv2&limit=5&countrycodes=kr&accept-language=ko&q=' + encodeURIComponent(String(q).trim().slice(0, 80));
// Nominatim 응답 → [{name, lat, lng}] (최대 5). 모양이 다르거나 좌표가 범위 밖인 항목은 뺀다.
export function readPlaces(json) {
  if (!Array.isArray(json)) return [];
  const out = [];
  for (const it of json) {
    if (!it || typeof it !== 'object') continue;
    const lat = Number(it.lat), lng = Number(it.lon), name = typeof it.display_name === 'string' ? it.display_name.trim().slice(0, 120) : '';
    if (name && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) out.push({ name, lat, lng });
    if (out.length === 5) break;
  }
  return out;
}

// 두 좌표 사이 거리(km, 구면). 근처 단지 = 반경 km 안, 가까운 순.
export const distKm = (lat1, lng1, lat2, lng2) => { const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2; return 12742 * Math.asin(Math.min(1, Math.sqrt(a))); };
export const nearComplexes = (list, lat, lng, km) => list.map((c) => [distKm(lat, lng, c.lat, c.lng), c]).filter((x) => x[0] <= km).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

// ── 축척 막대 · 경위선 격자 ─────────────────────────────────────────────────
export const metersPerPx = (lat, zoom) => 156543.03392804097 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
export function niceLen(maxM) { const p = 10 ** Math.floor(Math.log10(maxM)); return [5, 2, 1].map((k) => k * p).find((m) => m <= maxM); }   // 1·2·5 × 10^n 중 maxM 이하 최대
export const fmtLen = (m) => (m >= 1000 ? m / 1000 + ' km' : m + ' m');
const STEPS = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0005, 0.0002, 0.0001];
export function gridStep(zoom, minPx = 80) { const ppd = TILE * 2 ** zoom / 360; return [...STEPS].reverse().find((s) => s * ppd >= minPx) || STEPS[0]; }   // 경도 1줄 간격이 minPx 이상인 가장 촘촘한 도 단위
export const fmtDeg = (v, step, pos, neg) => Math.abs(v).toFixed(Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))) + '°' + (v >= 0 ? pos : neg);

// ── 핀 · 라벨 ─────────────────────────────────────────────────────────────
export const pinBox = (x, y, k = 1) => [x - PIN.r * k, y - PIN.h * k, x + PIN.r * k, y];
// items [{id,x,y}] (그린 순서 — 뒤가 위). 점 (x,y) 가까이 눌렀을 때 가장 가까운 핀 머리의 id, 없으면 null.
export function hitPin(items, x, y, tol = 4) {
  let best = null, bd = Infinity;
  for (const it of items) {
    const b = pinBox(it.x, it.y, 1.2);
    if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
    const d = (x - it.x) ** 2 + (y - (it.y - PIN.head)) ** 2;
    if (d <= bd) { bd = d; best = it.id; }   // 같으면 위에 그린 것
  }
  return best;
}
// 라벨 자리 잡기. items [{id,x,y,w,h,k?}] 우선순위 순(앞이 먼저 자리를 잡는다). 아래→위→오른쪽→왼쪽 순으로 시도하고
// 다른 라벨·다른 핀과 겹치면 그 자리를 버린다. 모두 겹치면 라벨을 숨긴다(결과에 없음). 반환 Map id → {x,y}(라벨 왼쪽 위).
// ponytail: 라벨은 우선순위 앞 max(120)개까지만 — 넘치면 숨김. 더 필요하면 클러스터링.
export function layoutLabels(items, { max = 120, gap = 3 } = {}) {
  const out = new Map(), grid = new Map(), cell = 64;
  const keys = (b) => { const r = []; for (let i = Math.floor(b[0] / cell); i <= Math.floor(b[2] / cell); i++) for (let j = Math.floor(b[1] / cell); j <= Math.floor(b[3] / cell); j++) r.push(i + ',' + j); return r; };
  const add = (b) => { for (const k of keys(b)) { let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(b); } };
  const hit = (b) => keys(b).some((k) => (grid.get(k) || []).some((o) => o[0] < b[2] && b[0] < o[2] && o[1] < b[3] && b[1] < o[3]));
  for (const it of items) add(pinBox(it.x, it.y, it.k || 1));   // 자기 핀은 기본 자리(끝점 아래·위·옆)와 닿지 않으니 따로 빼지 않는다
  for (const it of items.slice(0, max)) {
    const k = it.k || 1, r = PIN.r * k, mid = it.y - PIN.head * k - it.h / 2;
    for (const [x, y] of [[it.x - it.w / 2, it.y + gap], [it.x - it.w / 2, it.y - PIN.h * k - gap - it.h], [it.x + r + gap, mid], [it.x - r - gap - it.w, mid]]) {
      const b = [x - 1, y - 1, x + it.w + 1, y + it.h + 1];
      if (!hit(b)) { add(b); out.set(it.id, { x, y }); break; }
    }
  }
  return out;
}

// ── 검색 ─────────────────────────────────────────────────────────────────
const norm = (s) => String(s == null ? '' : s).normalize('NFC').toLowerCase().replace(/\s+/g, '');
// 이름·주소 부분 일치(공백·대소문자 무시). 순서: 이름 앞부분 > 이름 > 주소 > 이름+주소 > 낱말 모두 포함. 같은 순위는 자료 순서. 빈 검색어 = 전부.
export function search(list, query) {
  const q = norm(query);
  if (!q) return list.slice();
  const toks = String(query).normalize('NFC').toLowerCase().split(/\s+/).filter(Boolean), out = [];
  list.forEach((c, i) => {
    const n = norm(c.name), a = norm(c.addr), na = n + a;
    const r = n.startsWith(q) ? 0 : n.includes(q) ? 1 : a.includes(q) ? 2 : na.includes(q) ? 3 : toks.every((t) => na.includes(t)) ? 4 : -1;
    if (r >= 0) out.push([r, i, c]);
  });
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
}

// ── 자료 · 링크 ───────────────────────────────────────────────────────────
function checkComplex(c) {
  const s = (v) => typeof v === 'string' && v.trim() !== '', num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!c || typeof c !== 'object') return '항목이 객체가 아닙니다';
  if (!s(c.id) || !s(c.name)) return 'id·name 이 필요합니다';
  if (typeof c.addr !== 'string') return 'addr 이 필요합니다';
  if (!num(c.lat) || !num(c.lng) || Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) return 'lat·lng 범위가 맞지 않습니다';
  if (!Array.isArray(c.types)) return 'types 배열이 필요합니다';
  const seen = new Set();
  for (const t of c.types) {
    if (!t || !s(t.id) || !s(t.name) || seen.has(t.id)) return 'types: id·name 이 필요하고 id 는 유일해야 합니다';
    seen.add(t.id);
    if (!num(t.areaM2) || t.areaM2 <= 0 || !Number.isInteger(t.rooms) || t.rooms < 0) return 'types: areaM2 는 0 보다 큰 수, rooms 는 0 이상 정수여야 합니다';
    if (t.templateId != null && !s(t.templateId)) return 'types: templateId 는 문자열이어야 합니다';
  }
  return '';
}
// complexes.json → {list, problems}. 맞지 않는 항목은 빼고 problems 에 이유를 남긴다(한 곳이 틀려도 나머지는 쓴다).
export function readComplexes(data) {
  const list = [], problems = [], ids = new Set();
  if (!data || data.v !== 1 || !Array.isArray(data.complexes)) return { list, problems: ['형식이 {v:1, complexes:[…]} 가 아닙니다'] };
  data.complexes.forEach((c, i) => {
    const bad = checkComplex(c);
    if (bad) problems.push('#' + i + ' ' + bad);
    else if (ids.has(c.id)) problems.push('#' + i + ' id 중복: ' + c.id);
    else { ids.add(c.id); list.push(c); }
  });
  return { list, problems };
}
// 플래너로 가는 주소. kind: 'draw'(빈 도면) · 'trace'(밑그림 업로드로 시작) · 'template'(id). ctx = 현재 주소의 ?…, 공동 브랜드(partner)·임베드(embed)는 이어 붙인다.
export function planUrl(kind, ctx = '', id = '') {
  const p = new URLSearchParams(), c = new URLSearchParams(ctx);
  if (kind === 'trace') p.set('underlay', '1');
  if (kind === 'template') p.set('template', id);
  for (const k of ['partner', 'embed']) if (c.get(k)) p.set(k, c.get(k));
  const s = p.toString();
  return '../plan/' + (s ? '?' + s : '');
}
const fmtArea = (a) => String(Math.round(a * 100) / 100);
export const typeMeta = (t) => fmtArea(t.areaM2) + '㎡ · 방 ' + t.rooms;
// 단지 상세의 타입 줄. 예시 평면(templateId)이 있는 타입만 href 가 있다.
export const typeLinks = (c, ctx = '') => c.types.map((t) => ({ id: t.id, name: t.name, meta: typeMeta(t), href: t.templateId ? planUrl('template', ctx, t.templateId) : null }));

// ═══ 화면 ═══════════════════════════════════════════════════════════════
function boot() {
  const $ = (id) => document.getElementById(id), root = document.documentElement, qs = location.search;
  const el = Object.fromEntries(['map', 'cv', 'card', 'q', 'clr', 'count', 'list', 'detail', 'empty', 'choices', 'choicesH', 'toast', 'locate', 'handle', 'dName', 'dAddr', 'types', 'back', 'zin', 'zout', 'geo', 'geoGo', 'places', 'credit'].map((k) => [k, $('mp' + k[0].toUpperCase() + k.slice(1))]));
  const ctx = el.cv.getContext('2d'), reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const tok = (n) => getComputedStyle(root).getPropertyValue(n).trim(), px = (n) => parseFloat(tok(n)) || 0;
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const k in props || {}) { const v = props[k]; if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v); }
    e.append(...kids.filter(Boolean));
    return e;
  };

  let list = [], byId = new Map(), results = [], match = null, q = '', sel = null, act = -1, hover = null, me = null, loadErr = false, places = [], place = null, geoBusy = false, geoCtl = null, moving = false;
  const tiles = new Map();   // 타일 캐시 '줌/x/y' → {img, ok}. 300개를 넘으면 오래된 100개를 버린다
  let view = { ...DEFAULT_VIEW, w: 1, h: 1 }, inset = { l: 0, t: 0, r: 0, b: 0 }, dpr = 1, anim = 0, raf = 0, fitTimer = 0, toastTimer = 0;
  const schedule = () => { raf = raf || requestAnimationFrame(draw); };
  const vc = () => ({ x: inset.l + (view.w - inset.l - inset.r) / 2, y: inset.t + (view.h - inset.t - inset.b) / 2 });   // 카드가 가리지 않은 영역의 가운데
  const planLinks = () => document.querySelectorAll('[data-kind]').forEach((a) => { a.setAttribute('href', planUrl(a.dataset.kind, qs)); });
  const showMsg = (m) => { el.toast.textContent = m; el.toast.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('on'), 5000); };

  // ── 움직임 ──
  function flyTo(t, ms = px('--t-slow')) {
    cancelAnimationFrame(anim);
    const a = { ...view }, t0 = performance.now();
    if (reduce.matches || !ms) { view = { ...view, lat: t.lat, lng: t.lng, zoom: t.zoom }; schedule(); return; }
    moving = true;   // 날아가는 동안에는 새 타일을 받지 않는다(도착한 뒤 한 번에)
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 4 * k ** 3 : 1 - (2 - 2 * k) ** 3 / 2;   // easeInOutCubic(= --ease 와 같은 결)
      view = { ...view, lat: a.lat + (t.lat - a.lat) * e, lng: a.lng + (t.lng - a.lng) * e, zoom: a.zoom + (t.zoom - a.zoom) * e };
      if (k >= 1) moving = false;
      draw();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  const padPin = () => ({ ...inset, t: inset.t + PIN.h, b: inset.b + 28 });   // 맞출 때는 핀 머리(위)와 라벨(아래) 자리까지 비운다
  const fitAll = (jump) => { const t = fitView(list, view.w, view.h, padPin()); if (jump) { view = { ...view, ...t }; schedule(); } else flyTo(t); };
  const zoomBy = (d) => { const c = vc(); flyTo(zoomAt(view, Math.round(view.zoom) + d, c.x, c.y)); };

  // ── 그리기 ──
  let font = '', fcache = new Map();
  function visiblePins() {   // 화면 안 핀을 그리는 순서(뒤가 위)로
    const out = [];
    for (const c of list) {
      const p = project(c.lat, c.lng, view);
      if (p.x < -40 || p.x > view.w + 40 || p.y < -50 || p.y > view.h + 40) continue;
      out.push({ id: c.id, c, x: p.x, y: p.y, rank: match && !match.has(c.id) ? 0 : c.id === sel ? 3 : c.id === hover ? 2 : 1 });
    }
    return out.sort((a, b) => a.rank - b.rank || a.y - b.y);
  }
  // 바탕 지도 타일. 아직 못 받은 타일은 받아 둔 한 단계 위 타일의 한 칸을 늘려 임시로 보여 준다.
  function tileFor(t) {
    const k = t.z + '/' + t.x + '/' + t.y;
    let e = tiles.get(k);
    if (!e && !moving) {
      if (tiles.size > 300) for (const key of [...tiles.keys()].slice(0, 100)) tiles.delete(key);
      const img = new Image(); e = { img, ok: false }; tiles.set(k, e);
      img.decoding = 'async'; img.onload = () => { e.ok = true; schedule(); }; img.onerror = () => { tiles.delete(k); };
      img.src = tileUrl(BASEMAP.tiles, t.z, t.x, t.y);
    }
    return e && e.ok ? e : null;
  }
  function drawTiles() {
    for (const t of visibleTiles(view, BASEMAP.maxZ)) {
      const e = tileFor(t);
      const x = Math.floor(t.sx), y = Math.floor(t.sy), d = Math.ceil(t.s) + 1;   // 정수 칸 + 1px 겹침 — 타일 사이 실선(이음새)을 막는다
      if (e) { ctx.drawImage(e.img, x, y, d, d); continue; }
      const par = t.z > 0 && tiles.get((t.z - 1) + '/' + (t.x >> 1) + '/' + (t.y >> 1));
      if (par && par.ok) ctx.drawImage(par.img, (t.x & 1) * TILE / 2, (t.y & 1) * TILE / 2, TILE / 2, TILE / 2, x, y, d, d);
    }
  }
  function draw() {
    raf = 0;
    const { w, h: ht } = view, C = Object.fromEntries(['bg', 'line', 'line-strong', 'ink', 'ink-faint', 'surface', 'accent'].map((n) => [n, tok('--c-' + n)]));
    const fs = px('--fs-4'), r1 = px('--r-1'), fam = tok('--font-sans');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, ht);
    if (BASEMAP) drawTiles();
    // 경위선 격자 + 눈금 글(바탕 지도가 있으면 지도가 대신한다)
    const step = gridStep(view.zoom), nw = unproject(0, 0, view), se = unproject(w, ht, view);
    const dec = (v, pos, neg) => fmtDeg(v, step, pos, neg);
    ctx.lineWidth = 1; ctx.strokeStyle = C['line-strong']; ctx.fillStyle = C['ink-faint']; ctx.font = fs + 'px ' + fam; ctx.textBaseline = 'alphabetic';
    const sbY = ht - inset.b - 34;   // 축척 막대 자리(격자 글과 겹치지 않게 비운다)
    for (let g = Math.ceil(nw.lng / step); !BASEMAP && g * step <= se.lng; g++) {
      const x = Math.round(project(view.lat, g * step, view).x) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ht); ctx.stroke();
      ctx.textAlign = 'left'; ctx.fillText(dec(g * step, 'E', 'W'), x + 4, ht - inset.b - 8);
    }
    for (let g = Math.ceil(se.lat / step); !BASEMAP && g * step <= nw.lat; g++) {
      const y = Math.round(project(g * step, view.lng, view).y) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      if (y - 4 < sbY - 8 - fs - 4 || y - 4 - fs > sbY + 6) { ctx.textAlign = 'left'; ctx.fillText(dec(g * step, 'N', 'S'), inset.l + 8, y - 4); }
    }
    // 축척 막대
    const mpp = metersPerPx(view.lat, view.zoom), L = niceLen(mpp * 120), bw = L / mpp, bx = inset.l + 12;
    if (BASEMAP) { ctx.globalAlpha = 0.85; ctx.fillStyle = C.surface; ctx.fillRect(bx - 6, sbY - 6 - fs - 8, bw + 12, fs + 20); ctx.globalAlpha = 1; }   // 지도 위에서도 읽히게 바탕
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx, sbY - 4); ctx.lineTo(bx, sbY); ctx.lineTo(bx + bw, sbY); ctx.lineTo(bx + bw, sbY - 4); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.fillText(fmtLen(L), bx, sbY - 8);
    // 내 위치
    if (me) {
      const p = project(me.lat, me.lng, view), ar = me.acc / mpp;
      if (ar > 8 && ar < 4000) { ctx.globalAlpha = 0.14; ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(p.x, p.y, ar, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = C.accent; ctx.strokeStyle = C.surface; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    // 핀
    const pins = visiblePins();
    const drawPin = (x, y, k, fill, alpha) => {
      const r = PIN.r * k, cy = y - PIN.head * k;
      ctx.globalAlpha = alpha; ctx.beginPath(); ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 3 * k, y - 6 * k, x - r, cy + 11 * k, x - r, cy); ctx.arc(x, cy, r, Math.PI, 0); ctx.bezierCurveTo(x + r, cy + 11 * k, x + 3 * k, y - 6 * k, x, y); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.surface; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, cy, 4 * k, 0, 2 * Math.PI); ctx.fillStyle = C.surface; ctx.fill(); ctx.globalAlpha = 1;
    };
    const K = [1, 1, 1.12, 1.25];
    for (const p of pins) drawPin(p.x, p.y, K[p.rank], p.rank === 3 ? C.ink : C.accent, p.rank === 0 ? 0.3 : 1);
    if (place) { const p = project(place.lat, place.lng, view); drawPin(p.x, p.y, 1.12, C.ink, 1); }   // 주소 검색으로 찾은 자리
    // 라벨 — 선택 > 가리킴 > 나머지, 겹치면 숨김
    if (fam + fs !== font) { font = fam + fs; fcache = new Map(); }
    ctx.font = fs + 'px ' + fam;
    const lab = (c) => {
      let o = fcache.get(c.id);
      if (!o) { let t = c.name; if (ctx.measureText(t).width > 112) { let n = t.length; while (n > 1 && ctx.measureText(t.slice(0, n) + '…').width > 112) n--; t = t.slice(0, n) + '…'; } o = { t, w: Math.ceil(ctx.measureText(t).width) + 12 }; fcache.set(c.id, o); }
      return o;
    };
    const lh = Math.ceil(fs + 8), order = pins.filter((p) => p.rank > 0).sort((a, b) => b.rank - a.rank || b.y - a.y);
    const lay = layoutLabels(order.map((p) => ({ id: p.id, x: p.x, y: p.y, w: lab(p.c).w, h: lh, k: K[p.rank] })));
    for (const p of order) {
      const at = lay.get(p.id); if (!at) continue;
      const o = lab(p.c), on = p.rank === 3;
      ctx.beginPath(); (ctx.roundRect || ctx.rect).call(ctx, at.x, at.y, o.w, lh, r1);
      ctx.fillStyle = on ? C.ink : C.surface; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = on ? C.ink : C['line-strong']; ctx.stroke();
      ctx.fillStyle = on ? C.surface : C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(o.t, at.x + 6, at.y + lh / 2 + 0.5);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ── 크기 ──
  function measure() {   // 카드·시트가 지도를 가린 만큼(inset). 카드가 가로를 다 채우면 아래 시트, 아니면 왼쪽 카드
    const r = el.map.getBoundingClientRect(), a = el.card.getBoundingClientRect(), gap = px('--sp-2');
    inset = a.width >= r.width - 2 ? { l: 0, t: 0, r: 0, b: r.bottom - a.top + gap } : { l: a.right - r.left + gap, t: 0, r: 0, b: 0 };
    el.credit.style.bottom = Math.max(px('--sp-1'), inset.b) + 'px';   // 폰: 아래 시트 위로 올린다(저작권 표기는 항상 보여야 한다)
  }
  function resize() {
    const r = el.map.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    view = { ...view, w: Math.max(1, r.width), h: Math.max(1, r.height) };
    el.cv.width = Math.round(view.w * dpr); el.cv.height = Math.round(view.h * dpr);
    measure(); schedule();
  }
  new ResizeObserver(resize).observe(el.map); new ResizeObserver(resize).observe(el.card);

  // ── 지도 조작: 끌기 · 두 손가락 · 휠 · 더블클릭 · 키 ──
  const rel = (e) => { const r = el.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const ptrs = new Map(); let g = null;
  const hoverAt = (p) => { const id = hitPin(visiblePins(), p.x, p.y); el.cv.classList.toggle('hit', !!id); if (id !== hover) { hover = id; markHover(); schedule(); } };
  el.cv.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(anim); el.cv.setPointerCapture(e.pointerId);
    const p = rel(e); ptrs.set(e.pointerId, p); g = g || { moved: false, x: p.x, y: p.y, pd: 0, mx: 0, my: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; g.moved = true; g.pd = Math.hypot(a.x - b.x, a.y - b.y); g.mx = (a.x + b.x) / 2; g.my = (a.y + b.y) / 2; }
  });
  el.cv.addEventListener('pointermove', (e) => {
    const p = rel(e), prev = ptrs.get(e.pointerId);
    if (!prev) { if (e.pointerType === 'mouse') hoverAt(p); return; }
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (g.pd) { view = zoomAt(view, view.zoom + Math.log2(d / g.pd), mx, my); view = panBy(view, mx - g.mx, my - g.my); }
      g.pd = d; g.mx = mx; g.my = my; schedule();
    } else if (ptrs.size === 1) {
      if (!g.moved && Math.hypot(p.x - g.x, p.y - g.y) < 5) return;   // 5px 안쪽은 누르기
      g.moved = true; el.cv.classList.add('drag'); view = panBy(view, p.x - prev.x, p.y - prev.y); schedule();
    }
  });
  const up = (e) => {
    if (!ptrs.delete(e.pointerId)) return;
    if (!ptrs.size) { if (g && !g.moved && e.type === 'pointerup') { const id = hitPin(visiblePins(), g.x, g.y); if (id) select(id); } g = null; el.cv.classList.remove('drag'); }
    else if (ptrs.size === 1) g.pd = 0;   // 두 손가락 끝 — 남은 손가락으로 이어서 옮긴다(누르기로 치지 않음: moved 유지)
  };
  el.cv.addEventListener('pointerup', up); el.cv.addEventListener('pointercancel', up);
  el.cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptrs.size) { el.cv.classList.remove('hit'); if (hover) { hover = null; markHover(); schedule(); } } });
  el.cv.addEventListener('wheel', (e) => {
    e.preventDefault(); cancelAnimationFrame(anim);
    const p = rel(e), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    view = zoomAt(view, view.zoom - dy * (e.ctrlKey ? 0.01 : 0.003), p.x, p.y); schedule();   // ctrl+휠 = 트랙패드 핀치(변화량이 작아 배로)
  }, { passive: false });
  el.cv.addEventListener('dblclick', (e) => { const p = rel(e); flyTo(zoomAt(view, Math.round(view.zoom) + 1, p.x, p.y)); });
  el.map.addEventListener('keydown', (e) => {
    if (e.target !== el.map || e.metaKey || e.ctrlKey || e.altKey) return;
    const s = e.shiftKey ? 240 : 80, d = { ArrowLeft: [s, 0], ArrowRight: [-s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] }[e.key];
    if (d) { e.preventDefault(); cancelAnimationFrame(anim); view = panBy(view, d[0], d[1]); schedule(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(-1); }
    else if (e.key === 'Home' || e.key === '0') { e.preventDefault(); fitAll(); }
  });
  el.zin.addEventListener('click', () => zoomBy(1)); el.zout.addEventListener('click', () => zoomBy(-1));
  if (navigator.geolocation) {
    el.locate.hidden = false;   // 내 위치는 브라우저에 위치 기능이 있을 때만 단추를 둔다
    el.locate.addEventListener('click', () => {
      el.locate.setAttribute('aria-busy', 'true');
      navigator.geolocation.getCurrentPosition((pos) => {
        el.locate.removeAttribute('aria-busy');
        me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy || 0 };
        flyTo(centerOn(view, me.lat, me.lng, Math.max(view.zoom, 14), inset));
      }, (err) => {
        el.locate.removeAttribute('aria-busy');
        showMsg(err.code === 1 ? '위치 권한이 꺼져 있습니다. 브라우저 설정에서 이 사이트의 위치를 허용해 주세요.' : '현재 위치를 확인하지 못했습니다. 잠시 뒤 다시 눌러 주세요.');
      }, { timeout: 10000, maximumAge: 60000 });
    });
  }

  // ── 카드: 검색 · 목록 · 상세 ──
  const setOpen = (o) => { el.card.dataset.open = o; el.handle.setAttribute('aria-expanded', String(o)); el.handle.setAttribute('aria-label', o ? '목록 접기' : '목록 펼치기'); };
  el.handle.addEventListener('click', () => setOpen(el.card.dataset.open !== 'true'));
  const sync = () => { try { const u = new URL(location.href); q ? u.searchParams.set('q', q) : u.searchParams.delete('q'); sel ? u.searchParams.set('c', sel) : u.searchParams.delete('c'); history.replaceState(null, '', u); } catch (e) { /* file:// 등 */ } };
  const markHover = () => el.list.querySelectorAll('li').forEach((li) => li.classList.toggle('hov', li.dataset.id === hover));
  function setAct(i) {
    act = i;
    el.list.querySelectorAll('li').forEach((li, j) => { li.setAttribute('aria-selected', String(j === i)); li.classList.toggle('act', j === i); });
    if (i >= 0) { const li = el.list.children[i]; el.q.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); hover = results[i].id; } else { el.q.removeAttribute('aria-activedescendant'); hover = null; }
    markHover(); schedule();
  }
  const CAP = 200;   // 목록은 200줄까지만 만든다(그 이상은 검색어를 더 쓰게). ponytail: 가상 스크롤은 단지가 수천 곳이 되면.
  function renderList() {
    el.list.replaceChildren(...results.slice(0, CAP).map((c, i) => h('li', { role: 'option', id: 'mpo' + i, 'aria-selected': 'false', 'data-id': c.id, onclick: () => select(c.id), onmouseenter: () => { hover = c.id; markHover(); schedule(); }, onmouseleave: () => { hover = act >= 0 ? results[act].id : null; markHover(); schedule(); } },
      h('span', { class: 'mp-on', text: c.name }), h('span', { class: 'mp-ot', text: '타입 ' + c.types.length }), h('span', { class: 'mp-oa', text: c.addr }))));
    act = -1; el.q.removeAttribute('aria-activedescendant');
  }
  function render() {
    const c = sel && byId.get(sel), hasList = !c && results.length > 0;
    el.card.dataset.mode = c ? 'detail' : 'list';
    el.detail.hidden = !c; el.list.hidden = !hasList; el.empty.hidden = !!c || hasList; el.choices.hidden = hasList; el.choicesH.hidden = !c;
    el.q.setAttribute('aria-expanded', String(hasList)); el.clr.hidden = !el.q.value;
    el.count.hidden = !!c;
    const geoOn = !c && !hasList && !!q.trim() && !!(BASEMAP && BASEMAP.geocode);   // 단지 검색 결과가 없을 때만 주소 검색을 권한다
    el.geo.hidden = !geoOn;
    if (geoOn) { el.geoGo.textContent = '‘' + q.trim().slice(0, 30) + '’ 주소로 지도에서 찾기'; el.geoGo.disabled = geoBusy; }
    el.count.textContent = loadErr ? '단지 목록을 불러오지 못했습니다.' : place ? (results.length ? '이 위치 근처 단지 ' + results.length + '곳' : '이 위치 근처에 등록된 단지가 없습니다.') : !list.length ? '등록된 단지가 아직 없습니다.' : !q.trim() ? '단지 ' + list.length + '곳' : results.length ? '검색 결과 ' + results.length + '곳' + (results.length > CAP ? ' 중 ' + CAP + '곳 표시' : '') : '‘' + q.trim().slice(0, 30) + '’ 검색 결과가 없습니다.';
    if (c) {
      el.dName.textContent = c.name; el.dAddr.textContent = c.addr;
      const ts = typeLinks(c, qs);
      el.types.replaceChildren(...(ts.length ? ts.map((t) => h('li', null, t.href ? h('a', { class: 'mp-type', href: t.href }, h('span', { class: 'mp-tn', text: t.name }), h('span', { class: 'mp-tm', text: t.meta })) : h('div', { class: 'mp-type off' }, h('span', { class: 'mp-tn', text: t.name }), h('span', { class: 'mp-tm', text: t.meta + ' · 예시 평면 없음' })))) : [h('li', { class: 'mp-none', text: '등록된 타입이 없습니다.' })]));
      setOpen(true);
    }
    schedule();
  }
  function select(id, opt = {}) {
    const c = byId.get(id); if (!c) return;
    sel = id; hover = null; render(); sync(); measure();   // 상세로 바뀌며 카드 높이가 달라졌으니 가린 만큼을 다시 잰다
    const t = centerOn(view, c.lat, c.lng, Math.max(view.zoom, 15), inset);
    if (opt.jump) { view = { ...view, ...t }; schedule(); } else flyTo(t);
    el.dName.focus({ preventScroll: true });
  }
  function back() { sel = null; render(); sync(); el.q.focus(); }
  function renderPlaces() {
    el.places.hidden = !places.length;
    el.places.replaceChildren(...places.map((p) => h('li', null, h('button', { type: 'button', class: 'mp-place', 'aria-pressed': String(p === place), onclick: () => pickPlace(p) }, p.name))));
  }
  function pickPlace(p) {   // 주소 검색 결과 하나로 지도를 옮긴다. 반경 2km 안 단지가 있으면 목록으로 보여 준다
    place = p; results = nearComplexes(list, p.lat, p.lng, 2); match = results.length ? new Set(results.map((c) => c.id)) : null;
    renderList(); renderPlaces(); render(); measure();
    flyTo(centerOn(view, p.lat, p.lng, 16, inset));
  }
  async function geoSearch() {   // 사용자가 누를 때 한 번만(글자마다 부르지 않는다)
    const text = q.trim(); if (!text || geoBusy || !BASEMAP || !BASEMAP.geocode) return;
    geoBusy = true; el.geoGo.disabled = true; el.geoGo.setAttribute('aria-busy', 'true');
    geoCtl = new AbortController(); const to = setTimeout(() => geoCtl.abort(), 8000);
    try {
      const r = await fetch(placesUrl(BASEMAP.geocode, text), { signal: geoCtl.signal });
      if (!r.ok) throw new Error(String(r.status));
      const found = readPlaces(await r.json());
      if (q.trim() !== text) return;   // 기다리는 사이 검색어가 바뀌었다
      places = found; renderPlaces();
      if (found.length) pickPlace(found[0]); else showMsg('주소를 찾지 못했습니다. 동·도로명까지 적어 주세요.');
    } catch (e) { showMsg('주소 검색에 연결하지 못했습니다. 잠시 뒤 다시 눌러 주세요.'); }
    finally { clearTimeout(to); geoBusy = false; el.geoGo.removeAttribute('aria-busy'); render(); }
  }
  function onQuery() {
    if (place || places.length) { place = null; places = []; renderPlaces(); }
    q = el.q.value; sel = null; results = search(list, q); match = q.trim() ? new Set(results.map((c) => c.id)) : null;
    renderList(); render(); sync(); setOpen(true);
    clearTimeout(fitTimer);
    if (match && results.length) fitTimer = setTimeout(() => flyTo(fitView(results, view.w, view.h, padPin())), px('--t-wait'));
  }
  el.q.addEventListener('input', onQuery);
  el.q.addEventListener('focus', () => setOpen(true));
  el.q.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;   // 한글 조합 중 Enter·화살표는 글자 확정용
    const n = results.length;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n && !sel) { e.preventDefault(); setAct(clamp(act < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : act + (e.key === 'ArrowDown' ? 1 : -1), 0, Math.min(n, CAP) - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const c = results[act >= 0 ? act : q.trim() ? 0 : -1]; if (c && !sel) select(c.id); else if (!c && !sel && q.trim()) geoSearch(); }
  });
  el.geoGo.addEventListener('click', geoSearch);
  el.clr.addEventListener('click', () => { el.q.value = ''; onQuery(); el.q.focus(); });
  el.back.addEventListener('click', back);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sel) { e.preventDefault(); back(); }
      else if (document.activeElement === el.q) { if (el.q.value) { el.q.value = ''; onQuery(); } else el.q.blur(); }
    } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); el.q.focus(); }   // 단축키는 입력칸에서는 막는다
  });

  // ── 시작 ──
  if (BASEMAP) { el.credit.textContent = BASEMAP.credit; el.credit.href = BASEMAP.creditUrl; el.credit.hidden = false; }
  planLinks(); resize();
  fetch('data/complexes.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((d) => {
    const r = readComplexes(d);
    if (r.problems.length) console.warn('complexes.json: ' + r.problems.join(' / '));
    list = r.list.sort((a, b) => a.name.localeCompare(b.name, 'ko')); byId = new Map(list.map((c) => [c.id, c]));
  }).catch(() => { loadErr = true; }).then(() => {
    const u = new URLSearchParams(qs); el.q.value = (u.get('q') || '').slice(0, 60); q = el.q.value;
    results = search(list, q); match = q.trim() ? new Set(results.map((c) => c.id)) : null;
    renderList(); render();
    const c = byId.get(u.get('c') || '');
    if (c) select(c.id, { jump: true }); else fitAll(true);
    if (matchMedia('(pointer: fine)').matches && !c) el.q.focus({ preventScroll: true });
  });
}

if (typeof document !== 'undefined' && document.getElementById('mpMap')) boot();
