// 2D 도면 편집기 — 화면 조립·저장/불러오기/내보내기·층과 상세 설정·선택 속성·밑그림·패널(panels.js)·3D(view3d.js) 연결·키보드. 그리기는 view2d.js, 도구는 tools.js, 미니맵은 minimap.js
import { createDoc, curFloor, COLS, APPLIANCE_LABEL, DEFAULTS, ZONES, SITE, siteOf } from './core/model.js';
import { Store } from './core/store.js';
import { toDocJSON, fromDocJSON } from './core/export.js';
import { roomAreaM2, bounds, wallLen, dist } from './core/geom.js';
import { ZONE_LABEL, zoneOf, zoneTable, poche, routesFor } from './core/analysis.js';
import { CITIES, DAYS, compass, sunAt, dayRange, daySpanMin, clampDayMin, extWindows, sunPatches, sunHours, section, footprint, shadowPolys, shadowAt, polysBox } from './core/sun.js';
import { buildMesh } from './core/mesh3d.js';
import { axoScene } from './core/axo.js';
import { createLibrary } from './library.js';
import { createView2D, fmtLen, fmtArea, readTheme, floorAreaM2, drawSection } from './view2d.js';
import { createTools, Selection, TOOL_ROWS, OPENING_NAMES, findEl } from './tools.js';
import { createMinimap } from './minimap.js';

const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, kids = []) { // 작은 DOM 헬퍼 — 글은 textContent 로만 넣는다
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(kids)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

/* ---------- 저장소·환경설정 ---------- */
const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };
let storage, kept = true;
try { storage = window.localStorage; storage.getItem('ain-plan-docs'); } catch (e) { storage = memory(); kept = false; } // 저장소를 못 쓰는 브라우저(사생활 보호 창)는 이 창 안에서만
const lib = createLibrary(storage), UI_KEY = 'ain-plan-ui';
const prefs = (() => { try { return JSON.parse(storage.getItem(UI_KEY)) || {}; } catch (e) { return {}; } })();
const a01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);
const state = { locked: false, multi: false, showGrid: prefs.showGrid !== false, showLabels: prefs.showLabels !== false, unit: prefs.unit === 'ft' ? 'ft' : 'mm', wallAlpha: a01(prefs.wallAlpha), floorAlpha: a01(prefs.floorAlpha), areaGross: !!prefs.areaGross, mode: '2d', analysis: null, routes: [], sun: { day: 'winter', t: null, stories: 1, storyMm: 2800, cut: null }, axo: { spread: 1 } };   // analysis: 분석 보기(ANA 의 키, 꺼짐 null) · routes: 사용자가 더한 동선 [[출발 방 id, 도착 방 id]…] · sun: 일조·단면·그림자 보기 상태(day 날 · t 한 시각(분, null = 하루를 겹쳐 본다) · stories × storyMm 그림자 높이 · cut 자를 방) — · axo: 액소 보기의 벌림(0 붙음 ~ 1) — 모두 이 창에서만(저장하지 않는다). 방위·위도는 문서(doc.site)
const savePrefs = () => { try { storage.setItem(UI_KEY, JSON.stringify({ unit: state.unit, showGrid: state.showGrid, showLabels: state.showLabels, wallAlpha: state.wallAlpha, floorAlpha: state.floorAlpha, areaGross: state.areaGross })); } catch (e) { /* 환경설정은 못 남겨도 된다 */ } };
const narrow = matchMedia('(max-width: 768px)'), mid = matchMedia('(max-width: 1023px)'), coarse = matchMedia('(pointer: coarse)'), calm = matchMedia('(prefers-reduced-motion: reduce)');   // mid: 중간 폭(태블릿 세로 등)에서는 오른쪽 패널을 접어 두어 캔버스를 넓힌다
state.touch = narrow.matches || coarse.matches; // 키보드가 없는 화면 — 도구 안내문이 키 대신 누르는 동작을 말하고 [끝내기] 단추가 보인다
const NO_STORE = '이 브라우저는 저장소를 막고 있어 저장되지 않습니다 · 도면 내보내기(.json)로 보관하세요';
const PANEL_TITLES = { templates: '템플릿', draw: '도면 그리기', products: '제품', materials: '마감재', library: '설계형 라이브러리', resources: '리소스 관리' };

let store, view, tools, sel, mini, v3 = null, curId = null, savedAt = null, leaving = false, openingType = 'door', endBtn = null;

/* ---------- 알림·창 ---------- */
function toast(msg, kind = '') {
  const box = $('plToast'), t = h('div', { class: 'ed-toast' + (kind === 'err' ? ' err' : ''), text: msg });
  for (const old of [...box.children]) if (old.textContent === msg) old.remove(); // 같은 알림은 겹쳐 쌓지 않는다
  box.append(t); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3500);
}
const say = (msg) => { const l = $('plLive'); l.textContent = ''; requestAnimationFrame(() => { l.textContent = msg; }); };
function openDialog(title, node, { onclose, small = false } = {}) { // 모달 창 — 닫으면 onclose. small = 묻는 창(좁게), 아니면 표가 들어올 수 있는 넓은 창
  const dlg = h('dialog', { class: 'ed-dlg' + (small ? ' sm' : ''), 'aria-label': title }, [
    h('div', { class: 'ed-dlg-h' }, [h('h2', { text: title }), h('button', { type: 'button', class: 'ed-x', 'aria-label': '닫기', text: '×', onclick: () => dlg.close() })]),
    h('div', { class: 'ed-dlg-b' }, node)]);
  dlg.addEventListener('close', () => { dlg.remove(); if (onclose) onclose(); });
  document.body.append(dlg); dlg.showModal();
  return { close: () => dlg.close(), el: dlg };
}
function choose(title, message, buttons) { // 단추 고르기 → 고른 value, 그냥 닫으면 null
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const d = openDialog(title, [message ? h('p', { text: message }) : null, h('div', { class: 'row' }, buttons.map((b) => h('button', { type: 'button', class: 'ed-b' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), text: b.label, onclick: () => { fin(b.value); d.close(); } })))], { onclose: () => fin(null), small: true });
    (d.el.querySelector('.primary') || d.el.querySelector('.row .ed-b')).focus();
  });
}
function ask({ title, label, value = '', unit = '', type = 'text', min }) { // 값 하나 묻기 → 글자, 취소면 null
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const input = h('input', { type, value, min, autocomplete: 'off', maxlength: type === 'text' ? '60' : null, inputmode: type === 'number' ? 'decimal' : null, 'aria-label': label });
    const ok = () => { if (input.value.trim() === '') return input.focus(); fin(input.value.trim()); d.close(); };
    const d = openDialog(title, [h('label', { class: 'ed-f' }, [h('span', { text: label }), h('span', { class: 'in' }, [input, unit ? h('em', { text: unit }) : null])]), h('div', { class: 'row' }, [h('button', { type: 'button', class: 'ed-b', text: '취소', onclick: () => d.close() }), h('button', { type: 'button', class: 'ed-b primary', text: '확인', onclick: ok })])], { onclose: () => fin(null), small: true });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    input.focus(); input.select();
  });
}
const okRow = () => h('div', { class: 'row' }, [h('button', { type: 'button', class: 'ed-b primary', text: '확인', onclick: (ev) => ev.target.closest('dialog').close() })]);
const errDialog = (title, what, e) => openDialog(title, [h('p', { text: `${what}${e && e.message ? ' · ' + e.message : ''}` }), okRow()], { small: true });
function download(name, blob) {
  const url = URL.createObjectURL(blob), a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const safe = (s) => String(s || '도면').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);

/* ---------- 문서 명령(잠금 반영) ---------- */
function run(cmd) {
  if (state.locked && cmd.type !== 'setCur' && cmd.type !== 'rename') { toast('잠금 상태입니다 · 잠금을 풀어 주세요', 'err'); return null; }
  try { return store.exec(cmd); } catch (e) { toast(e.message, 'err'); return null; }
}
const hasContent = (d) => !!d.underlay || d.floors.some((f) => COLS.some((c) => f[c].length));
const unsaved = () => store.dirty || (curId === null && hasContent(store.doc));

/* ---------- 도구·패널 연결(tools.js 가 부르는 ui) ---------- */
const ui = {
  toast, say,
  cursor: (c) => { $('plCanvas').style.cursor = c; },
  hint: (name, text) => { $('plHintName').textContent = name; $('plHintText').textContent = text; if (endBtn) endBtn.hidden = !(state.touch && tools && tools.tool !== 'select'); },
  setTool(name, o) {
    if (state.mode === '3d') exit3d();
    if (state.analysis === 'axo' && name !== 'select') setAnalysis(null);   // 액소 보기에서 도구를 고르면 평면으로 돌아가 그린다
    const was = tools.tool, wasType = openingType;
    if (!tools.setTool(name, o || {})) return false;
    if (name === 'opening') openingType = (o && o.type) || openingType;
    syncDraw(); if (narrow.matches) setPanel(false);
    if (name !== was || openingType !== wasType) say(`${$('plHintName').textContent} 도구 · ${$('plHintText').textContent}`); // 도구가 바뀌면 이름과 쓰는 법을 읽는다
    return true;
  },
  async renameRoom(id) {
    const r = findEl(store.doc, id); if (!r) return;
    const v = await ask({ title: '방 이름', label: '이름', value: r.el.name });
    if (v) run({ type: 'update', id, patch: { name: v } });
  },
  async calibrated(a, p) { // 밑그림 위 두 점 → 실제 길이를 묻고 축척 맞춤(첫 점을 고정)
    const u = store.doc.underlay, d = dist(a, p);
    if (!u) return;
    const v = await ask({ title: '밑그림 축척', label: '두 점 사이의 실제 길이', unit: 'mm', type: 'number', min: 1 });
    const L = Number(v);
    if (!(L > 0)) return;
    const k = L / d;
    if (run({ type: 'setUnderlay', underlay: { ...u, mmPerPx: u.mmPerPx * k, x: a[0] + (u.x - a[0]) * k, y: a[1] + (u.y - a[1]) * k } })) { toast('축척을 맞췄습니다'); ui.setTool('select'); view.fit(bounds(store.doc) || undefined); }
  },
};

/* ---------- 저장·불러오기 ---------- */
function setUrl(set) { // 주소의 문서 관련 키(doc·new·template·underlay)만 바꾸고 파트너 같은 나머지는 남긴다
  const q = new URLSearchParams(location.search); for (const k of ['doc', 'new', 'template', 'underlay']) q.delete(k);
  for (const [k, v] of Object.entries(set)) q.set(k, v);
  history.replaceState(null, '', '?' + q);
}
function save() {
  if (!kept) { toast(NO_STORE, 'err'); return false; } // 이 창 안에서만 쓰는 임시 저장소에는 저장한 것으로 치지 않는다 — 저장 안 됨·나가기 경고가 그대로 남는다
  try {
    const m = lib.savePlan(store.doc, curId ? { id: curId } : {});
    curId = m.id; savedAt = m.updated; store.markSaved();
    setUrl({ doc: curId });
    toast('저장했습니다'); schedule(); return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}
async function confirmDiscard(what) { // 저장 안 한 변경이 있을 때 → true 면 계속
  if (!unsaved()) return true;
  const v = await choose('저장하지 않은 변경이 있습니다', `${what} 저장하지 않은 변경은 사라집니다.`, [{ label: '취소', value: 'cancel' }, { label: '저장 안 하고 계속', value: 'drop', danger: true }, { label: '저장하고 계속', value: 'save', primary: true }]);
  if (v === 'save') return save();
  return v === 'drop';
}
function replaceDoc(doc, id, updated = null) {
  stopPlay(); store.replace(doc); curId = id; savedAt = updated; state.routes = []; state.sun = { ...state.sun, t: null, cut: null }; sel.clear(); tools.setTool('select');
  view.resize(); view.fit(fitBounds()); schedule();
}
async function newDoc() {
  if (!(await confirmDiscard('새로 만들면'))) return;
  replaceDoc(createDoc(), null); setUrl({ new: 1 });
}
async function openTemplate(id) { // 템플릿 카드 — 저장 안 한 변경은 다른 시작 경로와 같은 확인창을 거친다
  if (!(await confirmDiscard('템플릿으로 시작하면'))) return;
  try { replaceDoc(await loadTemplate(id), null); } catch (e) { return toast(e.message, 'err'); }
  setUrl({ template: id }); if (narrow.matches) { setPanel(false); toCanvas(); }
}
async function importFile(file) {
  if (file.size > 25e6) return toast('파일이 너무 큽니다 · 25MB 이하만 불러옵니다', 'err');
  let doc;
  try { doc = fromDocJSON(await file.text()); } catch (e) { return openDialog('도면 파일을 읽지 못했습니다', [h('p', { text: '아래 문제를 고친 파일을 다시 선택해 주세요.' }), h('ul', {}, (e.problems || [e.message]).slice(0, 6).map((m) => h('li', { text: m }))), okRow()], { small: true }); }
  if (!(await confirmDiscard('불러오면'))) return;
  replaceDoc(doc, null); setUrl({ new: 1 }); toast(`‘${doc.title}’ 도면을 불러왔습니다`);
}
async function exitEditor() {
  if (!(await confirmDiscard('나가면'))) return;
  leaving = true; location.assign('/maker/3d/projects/');
}
async function loadTemplate(id) { // data/templates.json(담당 C) — 배열 또는 {templates:[…]}, 항목은 Doc 이거나 {id, name, doc}
  const res = await fetch(new URL('data/templates.json', location.href));
  if (!res.ok) throw new Error('템플릿 목록(data/templates.json)을 열지 못했습니다');
  const j = await res.json(), list = Array.isArray(j) ? j : j.templates || j.items || [], t = list.find((x) => x && x.id === id);
  if (!t) throw new Error(`템플릿 ‘${id}’ 를 찾을 수 없습니다`);
  const doc = fromDocJSON(JSON.stringify(t.doc || t));
  if (!doc.title || doc.title === '새 도면') doc.title = t.name || t.title || doc.title;
  return doc;
}
async function initialDoc() {
  const q = new URLSearchParams(location.search), out = { doc: null, id: null, at: null, notice: '' };
  try {
    if (q.get('doc')) {
      const raw = lib.getPlan(q.get('doc'));
      if (raw) { out.doc = fromDocJSON(JSON.stringify(raw)); out.id = q.get('doc'); out.at = (lib.getMeta(out.id) || {}).updated || null; } else out.notice = '저장된 도면을 찾지 못해 새 도면으로 엽니다';
    } else if (q.get('template')) out.doc = await loadTemplate(q.get('template'));
    else if (!q.get('new') && !q.get('underlay')) { const last = lib.lastPlanId(); if (last) { const raw = lib.getPlan(last); if (raw) { out.doc = fromDocJSON(JSON.stringify(raw)); out.id = last; out.at = (lib.getMeta(last) || {}).updated || null; } } }
  } catch (e) { out.doc = null; out.id = null; out.notice = e.message; }
  if (!out.doc) out.doc = createDoc();
  return out;
}

/* ---------- 밑그림 ---------- */
function pickImage() { const f = $('plFileImg'); f.value = ''; f.click(); }
async function readImage(file) { // 긴 변 2400px 이하 JPEG 로 줄여 저장 공간을 아낀다
  if (!/^image\//.test(file.type)) throw new Error('이미지 파일(PNG·JPG 등)을 선택해 주세요');
  if (file.size > 30e6) throw new Error('이미지가 너무 큽니다 · 30MB 이하만 올립니다');
  const url = URL.createObjectURL(file), im = new Image();
  try { im.src = url; await im.decode(); } catch (e) { throw new Error('이미지를 읽지 못했습니다'); } finally { URL.revokeObjectURL(url); }
  const k = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
  const g = c.getContext('2d'); g.fillStyle = readTheme().surface; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
  return { src: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
}
async function placeUnderlay(file) {
  let img; try { img = await readImage(file); } catch (e) { return toast(e.message, 'err'); }
  const vp = view.vp, mmPerPx = (vp.w / vp.scale) * 0.7 / img.w, c = view.toMm([vp.w / 2, vp.h / 2]);
  if (run({ type: 'setUnderlay', underlay: { name: file.name.slice(0, 80), src: img.src, x: c[0] - (img.w * mmPerPx) / 2, y: c[1] - (img.h * mmPerPx) / 2, mmPerPx, rot: 0, opacity: 0.6 } })) { toast('밑그림을 올렸습니다 · 길이를 아는 두 점으로 축척을 맞추세요'); ui.setTool('calibrate'); }
}
async function underlayStart() { // ?underlay=1 — 올리기부터 시작
  const v = await choose('밑그림으로 시작', '도면 이미지를 올린 뒤 길이를 아는 두 점으로 축척을 맞추고, 그 위에 벽과 방을 그립니다.', [{ label: '나중에', value: 'later' }, { label: '이미지 선택', value: 'pick', primary: true }]);
  if (v === 'pick') pickImage();
}

/* ---------- 화면 갱신 ---------- */
let rf = 0;
const schedule = () => { if (!rf) rf = requestAnimationFrame(() => { rf = 0; refresh(); }); };
const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; }; // 낭독 영역(status·output)은 글자가 바뀔 때만 쓴다 — 같은 글자를 다시 쓰면 낭독기가 다시 읽는다
const setVal = (el, v) => { if (document.activeElement !== el && el.value !== String(v)) el.value = String(v); };
function refresh() {
  const d = store.doc, f = curFloor(d);
  $('plUndo').disabled = !store.canUndo; $('plRedo').disabled = !store.canRedo;
  setVal($('plTitle'), d.title); document.title = `${d.title} | 도면 그리기 · 3D 스튜디오`;
  const dirty = unsaved(), ss = $('plSaveState');
  ss.dataset.s = dirty || !kept ? 'dirty' : 'saved';
  setText(ss, !kept ? NO_STORE : dirty ? '저장 안 됨' : savedAt ? `저장됨 · ${new Date(savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '저장 이력 없음');
  const fs = $('plFloorSel'), names = JSON.stringify(d.floors.map((x) => x.name));
  if (fs.dataset.k !== names) { fs.replaceChildren(...d.floors.map((x, i) => h('option', { value: String(i), text: x.name }))); fs.dataset.k = names; }
  fs.value = String(d.cur); setVal($('plFloorName'), f.name); setVal($('plFloorH'), f.heightMm); setVal($('plSlab'), f.slabMm);
  setText($('plArea'), fmtArea(floorAreaM2(d, f, state.areaGross), state.unit));
  $('plAreaNet').setAttribute('aria-pressed', String(!state.areaGross)); $('plAreaGross').setAttribute('aria-pressed', String(state.areaGross));
  setVal($('plWallA'), Math.round(state.wallAlpha * 100)); setVal($('plWallAn'), Math.round(state.wallAlpha * 100));
  setVal($('plFloorA'), Math.round(state.floorAlpha * 100)); setVal($('plFloorAn'), Math.round(state.floorAlpha * 100));
  for (const [id, on] of [['plLabels', state.showLabels], ['plGrid', state.showGrid], ['plAnal', !!state.analysis], ['plLock', state.locked], ['plUnitMm', state.unit === 'mm'], ['plUnitFt', state.unit === 'ft'], ['plMode2d', state.mode === '2d'], ['plMode3d', state.mode === '3d']]) $(id).setAttribute('aria-pressed', String(on));
  $('plApp').classList.toggle('ana', !!state.analysis && state.mode === '2d');   // 폰: 분석 시트만큼 캔버스를 줄인다(plan.css)
  underlayUI(d); syncRoutes(); for (const f2 of propFields) f2.sync();
  view.requestDraw(); mini.draw();
}

/* 선택한 요소의 속성 — 값은 그 자리에서 고치고(명령 한 번 = 실행 취소 한 번), 선택이 바뀔 때만 다시 만든다 */
let propFields = [];
function propsBuild() {
  const box = $('plProps'), ids = [...sel.ids]; propFields = []; stopPlay();   // 칸을 다시 만들면 재생 단추도 사라진다
  const first = ids.length === 1 ? findEl(store.doc, ids[0]) : null;
  if (!ids.length || (ids.length === 1 && !first)) { if (state.analysis && state.mode === '2d') return analysisBuild(box); box.hidden = true; box.replaceChildren(); return; }   // 고른 것이 없으면 분석 표가 이 칸을 쓴다
  box.hidden = false;
  const kids = [h('h2', { id: 'plPropsH', text: '선택' })], KO = { walls: '벽', rooms: '방', columns: '기둥', openings: '개구부', guides: '보조선', items: '에어컨' };
  const add = (fld) => { propFields.push(fld); kids.push(fld.el); };
  if (first) {
    const id = first.id, cur = () => (findEl(store.doc, id) || {}).el, up = (patch) => run({ type: 'update', id, patch });
    const num = (label, unit, get, set, { min, step = 10 } = {}) => {
      const input = h('input', { type: 'number', step, min, inputmode: 'decimal', 'aria-label': label });
      const show = () => { const e = cur(); if (e) input.value = String(Math.round(get(e) * 100) / 100); }; // 칸을 문서 값으로 — 거절된 값이 칸에 남지 않게 한다
      const sync = () => { if (document.activeElement !== input) show(); };
      input.addEventListener('change', () => { const v = Number(input.value); if (input.value === '' || !Number.isFinite(v) || (min != null && v < min)) toast(`${label} 값이 올바르지 않습니다`, 'err'); else set(v); show(); });
      return { el: h('label', { class: 'ed-f' }, [h('span', { text: label }), h('span', { class: 'in' }, [input, unit ? h('em', { text: unit }) : null])]), sync };
    };
    const txt = (label, get, set) => {
      const input = h('input', { type: 'text', maxlength: '40', autocomplete: 'off', 'aria-label': label });
      const show = () => { const e = cur(); if (e) input.value = get(e); };
      const sync = () => { if (document.activeElement !== input) show(); };
      input.addEventListener('change', () => { const v = input.value.trim(); if (!v) toast(`${label} 을 비울 수 없습니다`, 'err'); else set(v); show(); });
      return { el: h('label', { class: 'ed-f' }, [h('span', { text: label }), h('span', { class: 'in' }, [input])]), sync };
    };
    const pick = (label, opts, get, set) => {
      const s = h('select', { 'aria-label': label }, opts.map(([v, t]) => h('option', { value: v, text: t })));
      const sync = () => { const e = cur(); if (e) s.value = get(e); };
      s.addEventListener('change', () => { set(s.value); sync(); });
      return { el: h('label', { class: 'ed-f' }, [h('span', { text: label }), s]), sync };
    };
    const ro = (label, get) => { const o = h('output', { class: 'ed-out' }); return { el: h('div', { class: 'ed-f' }, [h('span', { text: label }), o]), sync() { const e = cur(); if (e) setText(o, get(e)); } }; };
    const isApp = first.col === 'items' && first.el.kind === 'appliance';
    kids.push(h('p', { class: 'ed-note', text: `${isApp ? '가전' : KO[first.col]} · ${id}` }));
    if (first.col === 'walls') { add(ro('길이', (e) => fmtLen(wallLen(e), state.unit))); add(num('두께', 'mm', (e) => e.t, (v) => up({ t: v }), { min: 10 })); add(pick('종류', [['inner', '내벽'], ['exterior', '외벽']], (e) => e.kind, (v) => up({ kind: v }))); add(num('곡선 처짐', 'mm', (e) => e.bulge, (v) => up({ bulge: v }))); }
    else if (first.col === 'rooms') { add(txt('이름', (e) => e.name, (v) => up({ name: v }))); add(ro('실면적', (e) => fmtArea(roomAreaM2(store.doc, e), state.unit))); add(pick('구분', ZONES.map((z) => [z, ZONE_LABEL[z]]), (e) => zoneOf(e), (v) => up({ zone: v }))); }
    else if (first.col === 'columns') { const rect = first.el.kind === 'rect'; add(num(rect ? '가로' : '지름', 'mm', (e) => e.w, (v) => up(rect ? { w: v } : { w: v, d: v }), { min: 10 })); if (rect) add(num('세로', 'mm', (e) => e.d, (v) => up({ d: v }), { min: 10 })); add(num('회전', '°', (e) => e.rot, (v) => up({ rot: v }), { step: 15 })); }
    else if (first.col === 'openings') { add(pick('종류', Object.entries(OPENING_NAMES), (e) => e.type, (v) => setOpeningType(cur, up, v))); add(num('폭', 'mm', (e) => e.width, (v) => up({ width: v }), { min: 100 })); add(num('높이', 'mm', (e) => e.height, (v) => up({ height: v }), { min: 100 })); add(num('바닥에서', 'mm', (e) => e.sill, (v) => up({ sill: v }), { min: 0 })); add(ro('경첩', (e) => (e.type === 'door' ? HINGE_NAME[e.hinge === 'b' ? 'b' : 'a'] : '없음'))); add(ro('열리는 쪽', (e) => (e.type === 'door' ? SWING_NAME[e.swing === -1 ? -1 : 1] : '없음'))); add(doorSwingRow(cur, up)); }
    else if (isApp) { // 가전: 크기는 공식 제원 값이라 고치지 않는다(읽기 전용), 돌리기만
      add(ro('분류', (e) => APPLIANCE_LABEL[e.category] ?? e.category)); add(ro('모델', (e) => e.code || e.model)); add(ro('제품명', (e) => e.name || '미확인'));
      add(ro('크기', (e) => `가로 ${e.size[0].toLocaleString('ko-KR')} · 깊이 ${e.size[1].toLocaleString('ko-KR')} · 높이 ${e.heightMm.toLocaleString('ko-KR')} mm`)); add(num('회전', '°', (e) => e.rot, (v) => up({ rot: v }), { step: 90 }));
    } else if (first.col === 'items') { add(ro('모델', (e) => e.code || e.model.toUpperCase())); add(ro('냉방 용량', (e) => (e.capacityKw ? `${e.capacityKw} kW` : '미확인'))); add(num('회전', '°', (e) => e.rot, (v) => up({ rot: v }), { step: 90 })); }
    else if (first.col === 'guides') add(ro('길이', (e) => fmtLen(dist(e.a, e.b), state.unit)));
  } else kids.push(h('p', { class: 'ed-note', text: `${ids.length}개를 골랐습니다` }));
  kids.push(h('div', { class: 'ed-btns' }, [h('button', { type: 'button', class: 'ed-b', text: ids.length > 1 ? '선택한 것 지우기' : '지우기', onclick: delSel })]));
  box.replaceChildren(...kids); propFields.forEach((f2) => f2.sync());
}
// 개구부 종류를 바꾸면 폭·높이·바닥 높이도 새 종류의 기본값으로 — 이전 종류의 기본값 그대로인 칸만(사용자가 고친 값은 둔다). 문·개방은 같은 기본값
const openDefaults = (t) => (t === 'window' ? { width: DEFAULTS.winW, height: DEFAULTS.winH, sill: DEFAULTS.winSill } : { width: DEFAULTS.doorW, height: DEFAULTS.doorH, sill: 0 });
function openingTypePatch(e, type) {
  const from = openDefaults(e.type), to = openDefaults(type), patch = { type };
  for (const k of ['width', 'height', 'sill']) if (e[k] === from[k]) patch[k] = to[k];
  return patch;
}
function setOpeningType(cur, up, type) {
  const e = cur(); if (!e || e.type === type) return;
  if (up(openingTypePatch(e, type))) { const n = cur(); say(`종류를 ${OPENING_NAMES[type]}으로 바꿨습니다 · 폭 ${n.width} · 높이 ${n.height} · 바닥에서 ${n.sill} mm`); }
}
// 문 여닫이: 경첩을 반대 문틀로 · 열리는 쪽을 반대편으로 — 문이 아닌 개구부에서는 눌리지 않는다. 결과는 읽기 행(경첩·열리는 쪽)과 낭독으로 알린다. 오른쪽·왼쪽은 벽을 시작점에서 끝점으로 볼 때(swing 1 = +법선 = 오른쪽)
const HINGE_NAME = { a: '시작점 쪽', b: '끝점 쪽' }, SWING_NAME = { 1: '시작→끝 기준 오른쪽', [-1]: '시작→끝 기준 왼쪽' };
function doorSwingRow(cur, up) {
  const bt = (text, patch, said) => h('button', { type: 'button', class: 'ed-b', text, onclick: () => { const e = cur(); if (!e) return; const p = patch(e); if (up(p)) say(said(p)); } });
  const b1 = bt('경첩 반대쪽으로', (e) => ({ hinge: e.hinge === 'b' ? 'a' : 'b' }), (p) => `경첩을 ${HINGE_NAME[p.hinge]}으로 옮겼습니다`), b2 = bt('반대편으로 열기', (e) => ({ swing: e.swing === -1 ? 1 : -1 }), (p) => `열리는 쪽을 ${SWING_NAME[p.swing]}으로 바꿨습니다`);
  return { el: h('div', { class: 'ed-btns' }, [b1, b2]), sync() { const e = cur(); b1.disabled = b2.disabled = !e || e.type !== 'door'; } };
}

/* 분석 보기(포셰·존·동선) — 계산은 core/analysis.js, 그림은 view2d.js. 표는 속성 칸에 두고 문서·종류·동선 목록이 바뀔 때만 다시 만든다 */
const ANA = { poche: '포셰', zone: '존', route: '동선', sun: '일조', section: '단면', shadow: '그림자', axo: '액소' }, SUNNY = new Set(['sun', 'section', 'shadow']), REFIT = new Set(['shadow', 'axo']);   // REFIT: 평면과 범위가 다른 보기 — 드나들 때 화면을 다시 맞춘다
const f2 = (v) => v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), f1 = (v) => v.toFixed(1);
const tbl = (caption, head, rows, foot) => h('table', { class: 'ed-tbl' }, [h('caption', { class: 'ed-vh', text: caption }),
  h('thead', {}, h('tr', {}, head.map(([t, num]) => h('th', { scope: 'col', class: num ? 'num' : null }, t)))), h('tbody', {}, rows), foot ? h('tfoot', {}, foot) : null]);
const numTd = (t) => h('td', { class: 'num', text: t });
function setAnalysis(mode) {
  const was = state.analysis; state.analysis = mode; stopPlay();
  if (mode === 'axo') { tools.setTool('select'); sel.clear(); }   // 액소: 캔버스에서는 화면만 움직인다(tools.js)
  if (mode && !was) { if (narrow.matches) setPanel(false); else setSide(true); }   // 폰: 도구 시트가 표 시트를 덮지 않게 · 중간 폭: 접힌 오른쪽 칸을 편다
  if (!mode !== !was) propsBuild();   // 종류만 바꿀 때는 칸을 다시 만들지 않는다(누른 단추의 초점이 남는다)
  schedule(); say(mode ? `${ANA[mode]} 보기` : '분석 보기를 껐습니다');
  if (!mode && was && document.activeElement !== $('plAnal')) $('plAnal').focus({ preventScroll: true });   // 칸 안의 [끝내기] 가 사라지므로 초점은 켜는 단추로
  if (mode === 'axo' || was === 'axo') tools.hint();
  if (REFIT.has(mode) || REFIT.has(was)) { refresh(); view.resize(); view.fit(fitBounds()); }   // 그림자·액소까지 화면에 넣고, 나오면 원래 범위로(폰은 시트만큼 캔버스 크기가 바뀐 뒤에 맞춘다)
}
/* 일조·단면·그림자 — 계산은 core/sun.js. 시각은 진태양시(분) */
const SUN_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16], SHADE_HOURS = [9, 12, 15], PLAY_MS = 12000;   // 겹쳐 그리는 시각 · 재생 한 번(해 뜸 → 해 짐) 길이
const hm = (min) => { const m = Math.round(min); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const sunSpan = () => daySpanMin(siteOf(store.doc).lat, DAYS[state.sun.day].decl);   // 해가 떠 있는 동안(10분 단위로 안쪽)
function anaView(f, m) { // 캔버스에 그릴 것(view2d.js 의 view.ana)
  const site = siteOf(store.doc), S = state.sun, decl = DAYS[S.day].decl, now = S.t !== null, out = { north: site.north, sun: [], shade: [], cut: null };
  if (m === 'sun') out.sun = sunPatches(f, site, decl, now ? [S.t / 60] : SUN_HOURS).map((p) => ({ poly: p.poly, now, text: now ? hm(S.t) : String(p.t) }));
  else if (m === 'shadow') {
    const foot = footprint(f), b = polysBox(foot);
    if (b) for (const t of now ? [S.t / 60] : SHADE_HOURS) { const sh = shadowAt(site, decl, t, S.stories * S.storyMm); if (sh) out.shade.push({ polys: shadowPolys(foot, sh.v), tip: [(b.x0 + b.x1) / 2 + sh.v[0], (b.y0 + b.y1) / 2 + sh.v[1]], text: `${now ? hm(S.t) : t + '시'} · ${f2(sh.lenMm / 1000)} m` }); }
  } else { const sec = section(f, site, S.cut); if (sec.ok) out.cut = [sec.a, sec.b]; }
  return out;
}
const MESH = new WeakMap(), meshOf = (f) => { let m = MESH.get(f); if (!m) MESH.set(f, (m = buildMesh(store.doc, store.doc.floors.indexOf(f)))); return m; };   // 층 객체가 그대로면 조각도 그대로(불변 문서) — 벌리기·재생 중에는 투영만 다시 한다
const axoOf = (f, spread) => { const z = new Map(f.rooms.map((r) => [r.id, zoneOf(r)])); return axoScene(meshOf(f), { spread, zoneOf: (id) => z.get(id) }); };
const syncRoutes = () => { // 표가 안 보일 때(무언가 고른 동안)도 그림은 문서를 따라간다
  const on = state.mode === '2d', m = state.analysis, f = curFloor(store.doc), S = state.sun;
  if (S.t !== null) { const t = clampDayMin(S.t, siteOf(store.doc).lat, DAYS[S.day].decl); if (t !== S.t) state.sun = { ...S, t }; }   // 날·위도가 바뀌어(되돌리기·불러오기 포함) 낮이 줄면 고른 시각을 새 범위로
  view.routes = on && m === 'route' ? routesFor(f, state.routes) : [];
  view.ana = on && SUNNY.has(m) ? anaView(f, m) : null;
  view.axo = on && m === 'axo' && f.rooms.length ? axoOf(f, state.axo.spread) : null;
};
// 도면 범위 b 에 그림자 범위 s 를 더한다. keep: 그림자가 최소 배율에도 다 안 들어가면 도면(둘레에 제 크기만큼 여유)은 화면에 남긴다
function withShade(b, s) {
  if (!b || !s) return b;
  const g = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  return { x0: Math.min(b.x0, s.x0), y0: Math.min(b.y0, s.y0), x1: Math.max(b.x1, s.x1), y1: Math.max(b.y1, s.y1), keep: { x0: b.x0 - g, y0: b.y0 - g, x1: b.x1 + g, y1: b.y1 + g } };
}
function fitBounds() { // 보기 맞춤 범위 — 그림자 보기에서는 그림자까지, 액소 보기에서는 다 벌린 장면(재생 중에 화면이 흔들리지 않는다)
  syncRoutes();
  if (view.axo) { const f = curFloor(store.doc), a = axoOf(f, 1).box; return { ...a, y1: Math.max(a.y1, axoOf(f, 0).box.y1) }; }   // 붙였을 때의 아랫단(바깥벽 밑)까지
  return withShade(bounds(store.doc), view.ana && polysBox(view.ana.shade.flatMap((x) => x.polys)));
}
async function openSheet() { // 도면판: 평면과 분석 보기 일곱을 A3 가로 한 장에 — 지금 날·시각·동선·자를 방 설정 그대로. 그리기는 sheet.js
  const d = store.doc, f = curFloor(d), site = siteOf(d);
  if (!f.rooms.length) return toast('방이 없습니다', 'err');
  const b = bounds(d), sec = section(f, site, state.sun.cut), shade = anaView(f, 'shadow'), axo = axoOf(f, 0.6), plan = (m, more) => ({ label: m ? ANA[m] : '평면', m, bounds: b, scaled: true, ...more });
  const cells = [plan(null), plan('poche'), plan('zone'), plan('route', { routes: routesFor(f, state.routes) }), plan('sun', { ana: anaView(f, 'sun') }), { label: ANA.section, section: sec.ok ? sec : null, note: '자를 벽이 없습니다' },
    plan('shadow', { ana: shade, bounds: withShade(b, polysBox(shade.shade.flatMap((x) => x.polys))) }), { label: ANA.axo, m: 'axo', axo, bounds: axo.box }];
  try { (await import('./sheet.js')).openSheet({ h, openDialog, download, toast }, { store, state, cells, name: `ain-도면판-${safe(d.title)}.png`, info: { title: d.title, areaM2: floorAreaM2(d, f, state.areaGross), north: site.north, lat: site.lat, date: new Date().toLocaleDateString('ko-KR') } }); } catch (e) { errDialog('도면판을 열지 못했습니다', 'sheet.js 를 불러오거나 실행하지 못했습니다', e); }
}
let playRaf = 0, playUi = () => {};   // 하루 타임랩스 — playUi: 지금 떠 있는 분석 칸의 단추 글자 맞춤
function stopPlay() { if (!playRaf) return; cancelAnimationFrame(playRaf); playRaf = 0; playUi(); }
function startPlay(paint) { // 지금 시각(끝이면 해 뜸)부터 해 짐까지. 프레임마다 그림과 시각 글자만 고친다(표는 그대로)
  const [a, b] = sunSpan(), from = state.sun.t !== null && state.sun.t < b - 1 ? Math.max(a, state.sun.t) : a;
  let t0 = null;
  const step = (ts) => {
    t0 ??= ts;
    const t = Math.min(b, from + ((ts - t0) / PLAY_MS) * (b - a));
    state.sun = { ...state.sun, t }; syncRoutes(); paint(); view.requestDraw();
    if (t >= b) { playRaf = 0; playUi(); } else playRaf = requestAnimationFrame(step);
  };
  playRaf = requestAnimationFrame(step); playUi();
}
const AXO_MS = 2400;   // 액소 재생 한 번(붙음 → 다 벌림) 길이
function startAxo(paint) { // 벌림 0 → 1. 프레임마다 투영과 슬라이더 값만 고친다
  let t0 = null;
  const step = (ts) => {
    t0 ??= ts;
    const k = Math.min(1, (ts - t0) / AXO_MS);
    state.axo = { spread: k * k * (3 - 2 * k) }; syncRoutes(); paint(); view.requestDraw();
    if (k >= 1) { playRaf = 0; playUi(); } else playRaf = requestAnimationFrame(step);
  };
  playRaf = requestAnimationFrame(step); playUi();
}
function analysisBuild(box) {
  const body = h('div', { class: 'ed-ana' }), tabs = Object.entries(ANA).map(([m, t]) => h('button', { type: 'button', class: 'ed-sb', 'data-m': m, text: t, 'aria-pressed': 'false', onclick: () => setAnalysis(m) }));
  let key = [], focusAdd = false;
  const addRoute = (from, to) => {
    if (from === to) return toast('출발과 도착이 같습니다', 'err');
    const r = routesFor(curFloor(store.doc), [...state.routes, [from, to]]);
    if (r.length === view.routes.length) return toast('이미 있는 동선입니다', 'err');
    const n = r[r.length - 1]; state.routes = [...state.routes, [from, to]]; focusAdd = true; schedule();
    say(`${n.fromName} → ${n.toName} · ${n.ok ? `${f1(n.lenMm / 1000)} m · ${n.steps}걸음` : '길이 없습니다'}`);
  };
  const fill = {
    poche(d, f) {
      const p = poche(d, f);
      return [tbl('벽과 바닥 면적', [['항목'], ['값', 1]], [['벽 비율', `${f1(p.pct ?? 0)} %`], ['벽', `${f2(p.wallM2)} ㎡`], ['바닥', `${f2(p.floorM2)} ㎡`]].map(([k, v]) => h('tr', {}, [h('th', { scope: 'row', text: k }), numTd(v)])))];
    },
    zone(d, f) {
      const z = zoneTable(d, f);
      return [tbl('존별 면적', [['구분'], ['면적 ㎡', 1], ['비율 %', 1]], z.rows.map((r) => h('tr', {}, [h('th', { scope: 'row' }, [h('span', { class: 'ed-zsw', 'data-z': r.zone, 'aria-hidden': 'true' }), r.label, r.names.length ? h('small', { text: r.names.join(', ') }) : null]), numTd(f2(r.areaM2)), numTd(f1(r.pct))])),
        h('tr', {}, [h('th', { scope: 'row', text: '합계' }), numTd(f2(z.totalM2)), numTd('100.0')]))];
    },
    route(d, f) {
      const R = view.routes, opts = () => f.rooms.map((r) => h('option', { value: r.id, text: r.name }));
      const from = h('select', { 'aria-label': '출발' }, opts()), to = h('select', { 'aria-label': '도착' }, opts()); to.selectedIndex = 1;
      const add = h('button', { type: 'button', class: 'ed-b', text: '추가', onclick: () => addRoute(from.value, to.value) });
      if (focusAdd) { focusAdd = false; requestAnimationFrame(() => add.focus({ preventScroll: true })); }
      const row = (r, i) => h('tr', {}, [numTd(String(i + 1)), h('th', { scope: 'row', text: `${r.fromName} → ${r.toName}` }),
        ...(r.ok ? [numTd(`${f1(r.lenMm / 1000)} m`), numTd(String(r.steps))] : [h('td', { colspan: '2', text: r.reason === 'big' ? '도면이 너무 큽니다' : '길이 없습니다' })]),
        h('td', {}, r.custom ? h('button', { type: 'button', class: 'ed-b', text: '지우기', 'aria-label': `${r.fromName} → ${r.toName} 지우기`, onclick: () => { state.routes = state.routes.filter(([a, b]) => a !== r.from || b !== r.to); focusAdd = true; schedule(); say('지웠습니다'); } }) : null)]);
      return [R.length ? tbl('방 사이 걸음 거리', [['번호', 1], ['구간'], ['거리', 1], ['걸음', 1], [h('span', { class: 'ed-vh', text: '지우기' })]], R.map(row)) : null,
        f.rooms.length > 1 ? h('div', { class: 'ed-ana-add' }, [h('label', { class: 'ed-f' }, [h('span', { text: '출발' }), from]), h('label', { class: 'ed-f' }, [h('span', { text: '도착' }), to]), add]) : h('p', { class: 'ed-note', text: '방이 둘 이상 필요합니다' })];
    },
  };
  // 일조·단면·그림자 조작 — 표(body)는 문서가 바뀔 때마다 다시 만들므로 조작은 그 밖에 한 번만 만들고 값만 맞춘다(초점이 남는다)
  const setSun = (patch, fit) => { stopPlay(); state.sun = { ...state.sun, ...patch }; if (fit && state.analysis === 'shadow') view.fit(fitBounds()); schedule(); };
  const numF = (label, unit, attrs, get, set) => { // 숫자 칸: 범위 밖 값은 거절하고 칸을 지금 값으로 되돌린다
    const input = h('input', { type: 'number', inputmode: 'decimal', 'aria-label': label, ...attrs }), show = () => { input.value = String(get()); };
    input.addEventListener('change', () => { const v = Number(input.value); if (input.value === '' || !Number.isFinite(v) || v < attrs.min || v > attrs.max) toast(`${label} 값이 올바르지 않습니다`, 'err'); else set(v); show(); });
    return { el: h('label', { class: 'ed-f' }, [h('span', { text: label }), h('span', { class: 'in' }, [input, h('em', { text: unit })])]), sync: () => { if (document.activeElement !== input) show(); } };
  };
  const site = () => siteOf(store.doc);
  const rg = h('input', { type: 'range', id: 'plSunT', step: '10' }), clock = h('span', { class: 'ed-out' }), nowP = h('p', { class: 'ed-note' });
  rg.addEventListener('input', () => setSun({ t: Number(rg.value) }));
  const playB = calm.matches ? null : h('button', { type: 'button', class: 'ed-b', text: '재생', onclick: () => (playRaf ? stopPlay() : startPlay(paint)) });   // 움직임 줄이기 설정이면 재생 없이 슬라이더만
  const dayB = h('button', { type: 'button', class: 'ed-b', text: '하루', 'aria-pressed': 'true', onclick: () => setSun({ t: null }) });
  const days = Object.entries(DAYS).map(([k, v]) => h('button', { type: 'button', class: 'ed-sb', 'data-d': k, text: v.label, 'aria-pressed': 'false', onclick: () => setSun({ day: k }, true) }));
  const timeBox = h('div', { class: 'ed-ana-ctl' }, [h('div', { class: 'ed-f' }, [h('label', { for: 'plSunT', text: '시각' }), h('div', { class: 'ed-rg' }, [rg, clock])]), nowP, h('div', { class: 'ed-btns' }, [playB, dayB]), h('div', { class: 'ed-seg wide', role: 'group', 'aria-label': '날' }, days)]);
  const stories = numF('층수', '층', { min: 1, max: 60, step: 1 }, () => state.sun.stories, (v) => setSun({ stories: Math.round(v) }, true)), storyMm = numF('층당 높이', 'mm', { min: 2000, max: 6000, step: 100 }, () => state.sun.storyMm, (v) => setSun({ storyMm: v }, true));
  const shadeBox = h('div', { class: 'ed-ana-two' }, [stories.el, storyMm.el]);
  const cutSel = h('select', { 'aria-label': '자를 방' }), cutBox = h('label', { class: 'ed-f' }, [h('span', { text: '자를 방' }), cutSel]);
  cutSel.addEventListener('change', () => setSun({ cut: cutSel.value || null }));
  const citySel = h('select', { 'aria-label': '지역' }, [...CITIES.map(([n]) => h('option', { value: n, text: n })), h('option', { value: '', text: '직접 입력' })]);
  const lat = numF('위도', '°', { min: -SITE.latMax, max: SITE.latMax, step: 0.01 }, () => site().lat, (v) => run({ type: 'setSite', patch: { lat: v } })), north = numF('위쪽 방위', '°', { min: 0, max: 359, step: 1 }, () => site().north, (v) => run({ type: 'setSite', patch: { north: v } }));
  citySel.addEventListener('change', () => { const c = CITIES.find(([n]) => n === citySel.value); if (c) run({ type: 'setSite', patch: { lat: c[1] } }); });
  const setSum = h('summary'), setBox = h('details', { class: 'ed-ana-set' }, [setSum, h('label', { class: 'ed-f' }, [h('span', { text: '지역' }), citySel]), h('div', { class: 'ed-ana-two' }, [lat.el, north.el])]);
  const rgA = h('input', { type: 'range', id: 'plAxoS', min: '0', max: '1', step: '0.05' }), outA = h('span', { class: 'ed-out' });   // 액소: 벌리기 슬라이더 + 재생
  const paintAxo = () => { const p = Math.round(state.axo.spread * 100); if (document.activeElement !== rgA || playRaf) rgA.value = String(state.axo.spread); rgA.setAttribute('aria-valuetext', `${p} %`); outA.textContent = `${p} %`; };
  rgA.addEventListener('input', () => { stopPlay(); state.axo = { spread: Number(rgA.value) }; schedule(); });
  const axoB = calm.matches ? null : h('button', { type: 'button', class: 'ed-b', text: '재생', onclick: () => (playRaf ? stopPlay() : startAxo(paintAxo)) });
  const axoBox = h('div', { class: 'ed-ana-ctl' }, [h('div', { class: 'ed-f' }, [h('label', { for: 'plAxoS', text: '벌리기' }), h('div', { class: 'ed-rg' }, [rgA, outA])]), axoB ? h('div', { class: 'ed-btns' }, [axoB]) : null]);
  const ctl = h('div', { class: 'ed-ana-ctl' }, [timeBox, shadeBox, cutBox, setBox, axoBox]);
  const paint = () => { // 시각에 따라 바뀌는 글자 — 재생 중에도 이것만 고친다
    const s = site(), S = state.sun, t = S.t ?? 720, p = sunAt(s.lat, DAYS[S.day].decl, t / 60, s.north), sh = state.analysis === 'shadow' && p.z > 1e-6 ? ` · ${f2((S.stories * S.storyMm) / Math.tan((p.alt * Math.PI) / 180) / 1000)} m` : '';
    if (document.activeElement !== rg || playRaf) rg.value = String(Math.round(t / 10) * 10);
    rg.setAttribute('aria-valuetext', `${Math.floor(Math.round(t) / 60)}시 ${Math.round(t) % 60}분`);
    clock.textContent = hm(t); nowP.textContent = `고도 ${f1(p.alt)}° · ${compass(p.az)} ${Math.round(p.az)}°${sh}`;
  };
  playUi = () => { for (const b of [playB, axoB]) if (b) b.textContent = playRaf ? '멈춤' : '재생'; dayB.setAttribute('aria-pressed', String(state.sun.t === null)); };
  const ctlSync = (m, f) => {
    const s = site(), S = state.sun, [a, b] = sunSpan(), city = CITIES.find(([, v]) => v === s.lat);
    const ax = m === 'axo';
    ctl.hidden = !SUNNY.has(m) && !ax; timeBox.hidden = m === 'section' || ax; shadeBox.hidden = m !== 'shadow'; cutBox.hidden = m !== 'section'; setBox.hidden = ax; axoBox.hidden = !ax; paintAxo();
    rg.min = String(a); rg.max = String(b);
    for (const d of days) d.setAttribute('aria-pressed', String(d.dataset.d === S.day));
    const rooms = JSON.stringify(f.rooms.map((r) => [r.id, r.name]));
    if (cutSel.dataset.k !== rooms) { cutSel.dataset.k = rooms; cutSel.replaceChildren(h('option', { value: '', text: '자동' }), ...f.rooms.map((r) => h('option', { value: r.id, text: r.name }))); }
    cutSel.value = f.rooms.some((r) => r.id === S.cut) ? S.cut : '';
    if (document.activeElement !== citySel) citySel.value = city ? city[0] : '';
    setSum.textContent = `${city ? city[0] + ' ' : '위도 '}${s.lat}° · 위쪽 ${compass(s.north)}`;
    for (const x of [stories, storyMm, lat, north]) x.sync();
    paint(); playUi();
  };
  const kv = (caption, rows) => tbl(caption, [['항목'], ['값', 1]], rows.map(([k, v]) => h('tr', {}, [h('th', { scope: 'row', text: k }), h('td', { class: 'val', text: v })])));
  const dur = (min) => (min ? `${Math.floor(min / 60) ? Math.floor(min / 60) + '시간 ' : ''}${min % 60 ? (min % 60) + '분' : ''}`.trim() : '없음'), mm = (v) => `${Math.round(v).toLocaleString('ko-KR')} mm`;
  let secCv = null, secData = null;   // 단면 그림: 칸에 놓이거나 칸 폭이 바뀌면 그린다
  const secRO = new ResizeObserver(() => requestAnimationFrame(() => { if (secCv && secCv.clientWidth && secCv.dataset.w !== String(Math.round(secCv.clientWidth))) drawSection(secCv, view.theme, secData); }));   // 그리면 캔버스 높이가 바뀐다 — 관찰 도중에 바꾸지 않게 다음 프레임에
  Object.assign(fill, {
    sun(d, f) {
      const s = site(), decl = DAYS[state.sun.day].decl, [a, b] = dayRange(s.lat, decl);
      return [extWindows(f).length ? tbl('방별 직사광 시간', [['방'], ['창', 1], ['직사광', 1]], sunHours(f, s, decl).map((r) => h('tr', {}, [h('th', { scope: 'row', text: r.name }), numTd(String(r.windows)), numTd(dur(r.min))]))) : h('p', { class: 'ed-note', text: '외벽 창이 없습니다' }),
        kv('태양과 가정', [['정오 고도', `${f1(sunAt(s.lat, decl, 12).alt)}°`], ['해 뜸·짐', `${hm(a * 60)} · ${hm(b * 60)}`], ['시각 기준', '진태양시'], ['직사광 기준', '바닥에 닿는 햇빛 · 10분 간격'], ['가정', '평지 · 앞 건물 없음 · 천장 높이는 층 높이']])];
    },
    section(d, f) {
      const sec = section(f, site(), state.sun.cut);
      if (!sec.ok) return [h('p', { class: 'ed-note', text: '자를 벽이 없습니다' })];
      const day = (x) => `고도 ${f1(x.alt)}° · ${x.depth > 0 ? f2(x.depth / 1000) + ' m' : '들지 않음'}`, vent = sec.vent ? '됨' : '안 됨';
      secRO.disconnect(); secData = sec; secCv = h('canvas', { class: 'ed-sec-cv', role: 'img', 'aria-label': `단면 · ${sec.room.name} · 동지 ${sec.ref ? day(sec.winter) : '창 없음'} · 하지 ${sec.ref ? day(sec.summer) : '창 없음'} · 맞통풍 ${vent}` });
      secRO.observe(secCv);
      return [secCv, sec.ref ? null : h('p', { class: 'ed-note', text: '남향 창이 없습니다' }),
        kv('단면과 햇빛 깊이', [['자른 방', sec.room.name], ...(sec.ref ? [['창 윗단', mm(sec.ref.z1)], ['동지 정오', day(sec.winter)], ['하지 정오', day(sec.summer)], ['방 깊이', `${f2(sec.roomDepth / 1000)} m`]] : []), ['천장 높이', mm(sec.H)], ['맞통풍', vent]])];
    },
    shadow(d, f) {
      const s = site(), S = state.sun, H = S.stories * S.storyMm;
      return [tbl('시각별 그림자 길이', [['시각'], ['고도', 1], ['길이', 1]], SHADE_HOURS.map((t) => { const sh = shadowAt(s, DAYS[S.day].decl, t, H); return h('tr', {}, [h('th', { scope: 'row', text: `${t}시` }), ...(sh ? [numTd(`${f1(sh.alt)}°`), numTd(`${f2(sh.lenMm / 1000)} m`)] : [h('td', { colspan: '2', text: '해 없음' })])]); })),
        kv('높이와 가정', [['높이', `${f2(H / 1000)} m`], ['시각 기준', '진태양시'], ['가정', '평지 · 앞 건물 없음']])];
    },
  });
  fill.axo = (d, f) => [kv('층 구성', [['바닥', `방 ${f.rooms.length}개`], ['벽', `${f.walls.length}개`], ['문·창', `${f.openings.length}개`], ['기기', `${f.items.length}대`], ['천장 높이', mm(f.heightMm)]])];
  const sync = () => {
    const d = store.doc, f = curFloor(d), m = state.analysis, s = siteOf(d), S = state.sun, next = [f, m, state.routes, s.north, s.lat, S.day, S.stories, S.storyMm, S.cut];
    if (!m) return;
    ctlSync(m, f);
    if (next.every((v, i) => v === key[i])) return;
    key = next;
    for (const b of tabs) b.setAttribute('aria-pressed', String(b.dataset.m === m));
    body.replaceChildren(...(f.rooms.length ? fill[m](d, f) : [h('p', { class: 'ed-note', text: '방이 없습니다' })]).filter(Boolean));
  };
  propFields = [{ sync }]; box.hidden = false;
  box.replaceChildren(h('div', { class: 'ed-sec-h' }, [h('h2', { id: 'plPropsH', text: '분석' }), h('div', { class: 'ed-btns' }, [h('button', { type: 'button', class: 'ed-b', text: '도면판', onclick: openSheet }), h('button', { type: 'button', class: 'ed-b', text: '끝내기', 'aria-label': '분석 끝내기', onclick: () => setAnalysis(null) })])]),
    h('div', { class: 'ed-seg wide', role: 'group', 'aria-label': '분석 종류' }, tabs), ctl, body);
  syncRoutes(); sync();
}
function delSel() { if (sel.size && run({ type: 'remove', ids: [...sel.ids] })) { sel.prune(store.doc); say('지웠습니다'); } }

function underlayUI(d) { // 밑그림이 있을 때만: 투명도·축척·이동·지우기
  const box = $('plUnder'), u = d.underlay, key = u ? u.name : '';
  box.hidden = !u;
  if (!u) { box.dataset.k = ''; return; }
  if (box.dataset.k !== key) {
    box.dataset.k = key;
    const rg = h('input', { type: 'range', id: 'plUnderA', min: '0', max: '100', step: '5', 'aria-label': '밑그림 투명도' });
    rg.addEventListener('input', () => { view.underlayTemp = { opacity: rg.value / 100 }; view.requestDraw(); });
    rg.addEventListener('change', () => { const cu = store.doc.underlay; view.underlayTemp = null; if (cu) run({ type: 'setUnderlay', underlay: { ...cu, opacity: rg.value / 100 } }); });
    box.replaceChildren(h('h2', { id: 'plUnderH', text: '밑그림' }), h('p', { class: 'ed-note', text: key }), h('div', { class: 'ed-f' }, [h('label', { for: 'plUnderA', text: '진하기' }), rg]),
      h('div', { class: 'ed-btns' }, [h('button', { type: 'button', class: 'ed-b', text: '축척 다시 맞추기', onclick: () => ui.setTool('calibrate') }), h('button', { type: 'button', class: 'ed-b', text: '위치 옮기기', onclick: () => ui.setTool('moveUnderlay') }), h('button', { type: 'button', class: 'ed-b', text: '지우기', onclick: () => run({ type: 'setUnderlay', underlay: null }) })]));
  }
  const rg = $('plUnderA'); if (rg && document.activeElement !== rg) rg.value = String(Math.round(u.opacity * 100));
}

/* ---------- 왼쪽: 줄·패널 ---------- */
let panelName = null, panelHandle = null, panelTok = 0, panelsMod = null, drawRows = null, panelOpen = true;
const getPanels = () => (panelsMod ||= import('./panels.js').catch((e) => { panelsMod = null; throw e; }));
const focusSheet = () => requestAnimationFrame(() => requestAnimationFrame(() => $('plPanel').focus({ preventScroll: true }))); // 시트가 보이기 시작한 뒤에(visibility 전환이 시작되는 프레임까지는 숨은 상태라 초점이 안 간다)
const toCanvas = () => $('plCanvas').focus({ preventScroll: true }); // 패널에서 도구를 고르면 초점이 캔버스로 — 키보드로 바로 그리기·놓기를 이어 가고, 단추에 초점이 안 가는 브라우저에서도 단축키가 이어진다
const ctx = { get store() { return store; }, exec: run, setTool: (n, o) => { const ok = ui.setTool(n, o); if (ok) toCanvas(); return ok; }, toast, openDialog, openTemplate }; // exec = 잠금을 지키는 문서 명령 — 패널은 store.exec 를 직접 부르지 않는다
function setPanel(open) {
  if (open && narrow.matches) setSide(false); // 폰: 시트와 서랍은 하나만 연다
  panelOpen = open; $('plApp').classList.toggle('no-panel', !open);
  const rb = $('plRail').querySelector(`[data-panel="${panelName}"]`); if (!open && rb && $('plPanel').contains(document.activeElement)) rb.focus({ preventScroll: true }); // 시트가 접히면 안에 있던 초점은 그 판을 연 줄 단추로(도구·템플릿을 고른 때는 곧 캔버스로 다시 옮긴다)
  const b = $('plPanelToggle'); b.textContent = open ? '‹' : '›'; b.setAttribute('aria-expanded', String(open)); b.setAttribute('aria-label', open ? '왼쪽 패널 접기' : '왼쪽 패널 펴기');
}
function setSide(open) {
  if (open && narrow.matches) setPanel(false);
  $('plApp').classList.toggle('no-side', !open);
  if (!open && $('plSide').contains(document.activeElement)) $('plSideToggle').focus({ preventScroll: true }); // 서랍이 접히면 안에 있던 초점은 서랍 단추로
  const b = $('plSideToggle'); b.textContent = open ? '›' : '‹'; b.setAttribute('aria-expanded', String(open)); b.setAttribute('aria-label', open ? '오른쪽 패널 접기' : '오른쪽 패널 펴기');
}
function syncDraw() {
  if (!drawRows) return;
  for (const [id, el] of drawRows.rows) el.setAttribute('aria-pressed', String(id === 'multi' ? state.multi : id === tools.tool));
  for (const el of drawRows.sub) el.setAttribute('aria-pressed', String(tools.tool === 'opening' && openingType === el.dataset.type));
}
function mountDraw(body) {
  const rows = new Map(), sub = [], mk = (r) => {
    const key = r.key ? h('kbd', { class: 'ed-k', text: r.key }) : null;
    if (r.href) return [h('a', { class: 'ed-row link', href: r.href, text: r.label })];
    if (r.action) return [h('button', { type: 'button', class: 'ed-row', onclick: () => rowAction(r.action) }, [h('span', { text: r.label })])];
    const b = h('button', { type: 'button', class: 'ed-row', 'data-tool': r.id, 'aria-pressed': 'false', onclick: () => rowTool(r.id) }, [h('span', { text: r.label }), key]);
    if (r.id !== 'underlay') rows.set(r.id, b);
    if (r.id !== 'opening') return [b];
    const seg = h('div', { class: 'ed-sub', role: 'group', 'aria-label': '개구부 종류' }, Object.entries(OPENING_NAMES).map(([type, label]) => { const s = h('button', { type: 'button', class: 'ed-sb', 'data-type': type, text: label, 'aria-pressed': 'false', onclick: () => { if (ui.setTool('opening', { type })) toCanvas(); } }); sub.push(s); return s; }));
    return [b, seg];
  };
  body.replaceChildren(...TOOL_ROWS.flatMap((g) => [h('h3', { class: 'ed-sh', text: g.group }), ...g.rows.flatMap(mk)]));
  drawRows = { rows, sub }; syncDraw();
  return { destroy() { drawRows = null; } };
}
function rowTool(id) {
  if (id === 'underlay') return pickImage();
  if (id === 'multi') { state.multi = !state.multi; syncDraw(); tools.hint(); return say(state.multi ? '여러 개 고르기를 켰습니다' : '여러 개 고르기를 껐습니다'); }
  if (ui.setTool(id, id === 'opening' ? { type: openingType } : {})) toCanvas();
}
function rowAction(a) {
  if (a === 'underlay') return pickImage();
  const c = { 'mirror-x': { type: 'mirror', axis: 'x' }, 'mirror-y': { type: 'mirror', axis: 'y' }, 'rot-ccw': { type: 'rotate', deg: -90 }, 'rot-cw': { type: 'rotate', deg: 90 } }[a];
  if (run(c)) { view.fit(fitBounds()); say('현재 층 전체를 바꿨습니다'); }
}
async function openPanel(name) {
  const tok = ++panelTok, body = $('plPanelBody');
  if (panelHandle && panelHandle.destroy) panelHandle.destroy();
  panelHandle = null; drawRows = null; panelName = name; body.replaceChildren();
  $('plPanelTitle').textContent = PANEL_TITLES[name];
  for (const b of $('plRail').children) { const on = b.dataset.panel === name; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }
  $('plPanel').toggleAttribute('data-own', name !== 'draw'); // draw 는 이 편집기가 제목 줄을 그린다, 나머지 패널(panels.js)은 자기 제목 줄을 가진다
  if (name === 'draw') { panelHandle = mountDraw(body); return; }
  body.append(h('p', { class: 'ed-note', text: '불러오는 중' }));
  try {
    const m = await getPanels(); if (tok !== panelTok) return;
    body.replaceChildren(); panelHandle = m.mountPanel(name, body, ctx) || null;
  } catch (e) {
    if (tok !== panelTok) return;
    body.replaceChildren(h('p', { class: 'ed-note err', text: `패널 파일(panels.js)을 불러오지 못했습니다 · ${e.message}` }), h('button', { type: 'button', class: 'ed-b', text: '다시 시도', onclick: () => openPanel(name) }));
  }
}

/* ---------- 3D (view3d.js) ---------- */
let finishMap = null, v3Plain = false, entering3d = false; // v3Plain = 3D 화면을 마감재 색 없이 만들었다
async function finishColors() { // 마감재 id → 색(panels.js 의 자료). 못 읽으면 저장해 두지 않는다 — 다음 3D 진입에서 다시 읽는다
  if (!finishMap) { try { finishMap = new Map(((await (await getPanels()).loadFinishes()).finishes || []).map((x) => [x.id, x.sw])); } catch (e) { /* 이번에는 기본 색 */ } }
  return finishMap;
}
async function enter3d(which = 'iso') {
  if (!curFloor(store.doc).rooms.length) return openDialog('방이 하나 이상 필요합니다', [h('p', { text: '방을 만들어 주세요.' }), okRow()], { small: true });
  if (entering3d) return; // 여는 중에 또 누르면 3D 화면(캔버스·WebGL)을 하나 더 만들지 않는다
  entering3d = true;
  let r; $('plView3d').hidden = false; // 크기를 재야 하니 만들기 전에 보인다
  try {
    const sw = await finishColors();
    if (v3 && v3Plain && sw) { v3.destroy(); v3 = null; } // 처음 열 때 못 읽은 마감재 색을 이제 읽었으면 다시 만든다
    if (!v3) {
      const m = await import('./view3d.js');
      const v = m.createView3D($('plView3d'), store, { view: which, wallAlpha: state.wallAlpha, floorAlpha: state.floorAlpha, finishColor: (kind, id) => finishMap && finishMap.get(id), onEmpty: () => { exit3d(); openDialog('방이 하나 이상 필요합니다', [h('p', { text: '방을 만들어 주세요.' }), okRow()], { small: true }); } });   // 보는 중에 층을 바꾸거나 새로 만들어 방이 없어지면 빈 화면으로 두지 않는다
      if (v && v.ok === false) r = v; else { v3 = v; v3Plain = !sw; }
    }
    if (v3) r = v3.show();
  } catch (e) { $('plView3d').hidden = true; return errDialog('3D 화면을 열지 못했습니다', 'view3d.js 를 불러오거나 실행하지 못했습니다', e); } finally { entering3d = false; }
  if (r && r.ok === false) {
    $('plView3d').hidden = true;
    return r.reason === 'rooms' ? openDialog('방이 하나 이상 필요합니다', [h('p', { text: '방을 만들어 주세요.' }), okRow()], { small: true }) : errDialog('3D 화면을 열지 못했습니다', r.reason === 'webgl' ? '이 브라우저는 WebGL 을 쓸 수 없습니다' : `사유 ${r.reason}`);
  }
  state.mode = '3d'; $('plApp').classList.add('is3d'); $('plViews').hidden = false;
  v3.setWallAlpha(state.wallAlpha); v3.setFloorAlpha(state.floorAlpha); set3dView(which); v3.resize && v3.resize();
  sel.clear(); propsBuild(); schedule();
  $('plView3d').focus({ preventScroll: true });   // Safari 는 단추를 눌러도 초점이 단추로 안 가 2·3·4 보기 글쇠가 안 먹었다 — 3D 화면으로 초점을 옮긴다
}
function set3dView(which) { if (!v3) return; v3.setView(which); for (const b of $('plViews').querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === which)); }
function exit3d() {
  if (state.mode !== '3d') return;
  if (v3) v3.hide(); $('plView3d').hidden = true; $('plViews').hidden = true; $('plApp').classList.remove('is3d'); state.mode = '2d';
  propsBuild(); view.resize(); schedule();
  if (!document.querySelector('dialog[open]')) $('plCanvas').focus({ preventScroll: true });   // 3D 화면이 숨겨지며 초점이 사라지지 않게(Safari 에서는 단추 초점도 없다). 대화상자가 열려 있으면 건드리지 않는다
}

/* ---------- 배선 ---------- */
const doUndo = () => { if (store.undo()) { sel.prune(store.doc); say('실행을 취소했습니다'); } };
const doRedo = () => { if (store.redo()) { sel.prune(store.doc); say('다시 실행했습니다'); } };
function setLocked(on) { state.locked = on; $('plApp').classList.toggle('locked', on); if (on) tools.setTool('select'); tools.hint(); schedule(); say(on ? '잠금: 그림을 고칠 수 없습니다' : '잠금을 풀었습니다'); }
function wire() {
  $('plUndo').onclick = doUndo; $('plRedo').onclick = doRedo;
  const title = $('plTitle');
  title.addEventListener('change', () => { const v = title.value.trim(); if (!v) { title.value = store.doc.title; return toast('제목을 비울 수 없습니다', 'err'); } run({ type: 'rename', title: v }); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });
  const menu = $('plMenu'), closeMenu = () => { menu.classList.remove('open'); $('plMore').setAttribute('aria-expanded', 'false'); };
  $('plMore').onclick = () => { const on = menu.classList.toggle('open'); $('plMore').setAttribute('aria-expanded', String(on)); };
  document.addEventListener('pointerdown', (e) => { if (menu.classList.contains('open') && !menu.contains(e.target) && e.target !== $('plMore')) closeMenu(); });
  menu.addEventListener('click', (e) => { if (e.target.closest('button')) { closeMenu(); if ($('plMore').offsetParent !== null) $('plMore').focus({ preventScroll: true }); } }, true);   // capture — 항목이 창(showModal)을 열기 전에 메뉴를 닫고 초점을 [메뉴]에 둬야 창이 닫힐 때 초점이 [메뉴]로 돌아온다
  $('plRename').onclick = async () => { const v = await ask({ title: '도면 이름', label: '이름', value: store.doc.title }); if (v) run({ type: 'rename', title: v }); };
  $('plEstimate').onclick = async () => { try { (await import('./estimate.js')).openEstimate(ctx); } catch (e) { errDialog('견적 물량표를 열지 못했습니다', 'estimate.js 를 불러오거나 실행하지 못했습니다', e); } };
  $('plExport').onclick = () => { download(`ain-도면-${safe(store.doc.title)}.json`, new Blob([toDocJSON(store.doc)], { type: 'application/json' })); toast('도면 파일을 내려받았습니다'); };
  $('plImport').onclick = () => { const f = $('plFileJson'); f.value = ''; f.click(); };
  $('plFileJson').onchange = (e) => { const f = e.target.files[0]; if (f) importFile(f); };
  $('plFileImg').onchange = (e) => { const f = e.target.files[0]; if (f) placeUnderlay(f); };
  $('plNew').onclick = newDoc; $('plSave').onclick = save; $('plExit').onclick = exitEditor; $('plExitMenu').onclick = exitEditor;
  $('plLogo').addEventListener('click', (e) => { if (unsaved()) { e.preventDefault(); exitEditor(); } });

  $('plRail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-panel]'); if (!b) return;
    if (b.dataset.panel === panelName && panelOpen) { if (narrow.matches) setPanel(false); return; }
    setPanel(true); if (b.dataset.panel !== panelName) openPanel(b.dataset.panel);
    if (narrow.matches) focusSheet(); // 폰의 시트는 DOM 에서 줄 뒤라 Tab 으로는 줄 단추를 다 지나야 닿는다 — 열면 초점을 시트로
  });
  $('plPanelClose').onclick = () => setPanel(false);
  $('plPanelToggle').onclick = () => setPanel(!panelOpen);
  $('plSideToggle').onclick = () => setSide($('plApp').classList.contains('no-side')); $('plSideClose').onclick = () => setSide(false);

  $('plMode2d').onclick = exit3d; $('plMode3d').onclick = () => enter3d('iso');
  $('plViews').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) set3dView(b.dataset.view); });
  const flag = (id, key) => { $(id).onclick = () => { state[key] = !state[key]; savePrefs(); schedule(); }; };
  flag('plLabels', 'showLabels'); flag('plGrid', 'showGrid');
  $('plAnal').onclick = () => setAnalysis(state.analysis ? null : 'poche');
  $('plLock').onclick = () => setLocked(!state.locked);
  $('plSnap').onclick = () => { view.requestDraw(); requestAnimationFrame(() => $('plCanvas').toBlob((b) => (b ? download(`ain-도면-${safe(store.doc.title)}.png`, b) : toast('이미지를 만들지 못했습니다', 'err')))); };
  $('plZoomIn').onclick = () => view.zoomCenter(1.25); $('plZoomOut').onclick = () => view.zoomCenter(0.8); $('plFit').onclick = () => view.fit(fitBounds());
  for (const [id, u] of [['plUnitMm', 'mm'], ['plUnitFt', 'ft']]) $(id).onclick = () => { state.unit = u; savePrefs(); schedule(); };

  $('plFloorSel').onchange = (e) => run({ type: 'setCur', index: Number(e.target.value) });
  $('plFloorAdd').onclick = () => { if (run({ type: 'addFloor' })) say('층을 추가했습니다'); };
  const intField = (id, key, min, max, label) => { const el = $(id); el.addEventListener('change', () => { const v = Number(el.value); if (el.value === '' || !Number.isFinite(v) || v < min || v > max) toast(`${label}은 ${min}~${max} mm 사이여야 합니다`, 'err'); else run({ type: 'setFloor', patch: { [key]: v } }); el.value = String(curFloor(store.doc)[key]); schedule(); }); }; // 거절된 값은 칸에 남기지 않고 문서 값으로
  intField('plFloorH', 'heightMm', 100, 20000, '층 높이'); intField('plSlab', 'slabMm', 0, 2000, '슬래브 두께');
  const nm = $('plFloorName'); nm.addEventListener('change', () => { const v = nm.value.trim(); if (!v) toast('층 이름을 비울 수 없습니다', 'err'); else run({ type: 'setFloor', patch: { name: v } }); nm.value = curFloor(store.doc).name; schedule(); });
  $('plAreaNet').onclick = () => { state.areaGross = false; savePrefs(); schedule(); }; $('plAreaGross').onclick = () => { state.areaGross = true; savePrefs(); schedule(); };
  const alpha = (rangeId, numId, key, apply) => { for (const id of [rangeId, numId]) $(id).addEventListener('input', (e) => { const v = Number(e.target.value); if (e.target.value === '' || !Number.isFinite(v)) return; state[key] = a01(v / 100); if (v > 100 || v < 0) e.target.value = String(Math.round(state[key] * 100)); apply(state[key]); savePrefs(); schedule(); }); };
  alpha('plWallA', 'plWallAn', 'wallAlpha', (a) => v3 && v3.setWallAlpha(a)); alpha('plFloorA', 'plFloorAn', 'floorAlpha', (a) => v3 && v3.setFloorAlpha(a));

  endBtn = h('button', { type: 'button', class: 'ed-b', id: 'plEndTool', text: '끝내기', hidden: true, onclick: () => ui.setTool('select') }); // 폰: 도구를 연 동안 안내 줄 옆에 보이는 선택 도구 복귀 단추
  endBtn.style.pointerEvents = 'auto'; $('plHint').append(endBtn);
  const onMode = () => { // 창 폭·입력 방식이 바뀌면(회전) 폰 상태를 정리한다 — 폰: 시트·서랍 닫기, 데스크톱: 둘 다 펴기
    state.touch = narrow.matches || coarse.matches; setPanel(!narrow.matches); setSide(!mid.matches); tools.hint();
  };
  narrow.addEventListener('change', onMode); mid.addEventListener('change', onMode); coarse.addEventListener('change', () => { state.touch = narrow.matches || coarse.matches; tools.hint(); });
  window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => { tools.setShift(false); tools.setSpace(false); });
  window.addEventListener('resize', () => { view.refreshTheme(); if (v3 && state.mode === '3d' && v3.resize) v3.resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlay(); });
  calm.addEventListener('change', () => { stopPlay(); propsBuild(); });   // 움직임 줄이기를 켜면 재생 단추를 거둔다
  new ResizeObserver(() => { if (v3 && state.mode === '3d' && v3.resize) v3.resize(); }).observe($('plView3d'));
  window.addEventListener('beforeunload', (e) => { if (!leaving && unsaved()) { e.preventDefault(); e.returnValue = ''; } });
}
// 한 글자 단축키(도구 글쇠·[ ]·+ −·3D 보기 2 3 4)는 그것이 속한 곳에 초점이 있을 때만 듣는다 — 다른 단추·창에서 쓴 글자가 도구를 바꾸지 않게(WCAG 2.1.4)
const scoped = (t) => !!(t && t.closest && t.closest(state.mode === '3d' ? '#plView3d, #plViews, #plMode3d, #plPanel' : panelName === 'draw' ? '#plCanvas, #plPanel' : '#plCanvas'));
const typing = (t) => !!t && t.nodeType === 1 && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !(t.type === 'range' || t.type === 'checkbox'));
function onKey(e) {
  if (document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey, onCanvas = e.target === document.body || e.target.id === 'plCanvas';
  if (mod && e.code === 'KeyS') { // 입력칸에 쓰던 값은 칸을 벗어나야(change) 문서에 들어간다 — 먼저 벗어나게 한 뒤 저장하고 칸으로 돌아온다
    e.preventDefault(); const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur();
    save(); if (a && a !== document.body && a.focus) a.focus({ preventScroll: true }); return;
  }
  if (typing(e.target)) return;
  if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
  if (mod && e.code === 'KeyY') { e.preventDefault(); doRedo(); return; }
  if (mod && e.code === 'KeyA' && state.mode === '2d' && onCanvas && state.analysis !== 'axo') { e.preventDefault(); const f = curFloor(store.doc); sel.set(COLS.flatMap((c) => f[c].map((x) => x.id))); return; }
  if (e.key === 'Shift') tools.setShift(true);
  if (e.code === 'Escape' && $('plMenu').classList.contains('open')) { $('plMenu').classList.remove('open'); $('plMore').setAttribute('aria-expanded', 'false'); $('plMore').focus({ preventScroll: true }); return; }
  if (state.mode === '3d') { // 3D: 2·3·4 = 보기, ESC = 2D 로, 도구 글쇠 = 2D 로 돌아가 그 도구
    const v = { Digit2: 'plan', Digit3: 'iso', Digit4: 'free', Numpad2: 'plan', Numpad3: 'iso', Numpad4: 'free' }[e.code];
    if (v && scoped(e.target)) { set3dView(v); e.preventDefault(); } else if (e.code === 'Escape') exit3d(); else if (e.code.startsWith('Key') && tools.key(e, scoped(e.target))) e.preventDefault();
    return;
  }
  if (e.code === 'Space' && onCanvas) { e.preventDefault(); if (!tools.key(e)) tools.setSpace(true); return; } // 키보드 커서가 보이면 Space 는 누르기, 아니면 화면 끌기
  if (!mod && (e.code === 'Equal' || e.code === 'NumpadAdd') && scoped(e.target)) { e.preventDefault(); view.zoomCenter(1.25); return; }
  if (!mod && (e.code === 'Minus' || e.code === 'NumpadSubtract') && scoped(e.target)) { e.preventDefault(); view.zoomCenter(0.8); return; }
  if (tools.key(e, scoped(e.target))) e.preventDefault();
}
function onKeyUp(e) { if (e.key === 'Shift') tools.setShift(false); if (e.code === 'Space') tools.setSpace(false); }

/* ---------- 시작 ---------- */
async function boot() {
  const init = await initialDoc();
  try { store = new Store(init.doc); } catch (e) { store = new Store(createDoc()); init.notice = e.message; init.id = null; }
  curId = init.id; savedAt = init.at;
  sel = new Selection(() => { propsBuild(); if (view) view.requestDraw(); });
  const canvas = $('plCanvas');
  view = createView2D(canvas, { store, getState: () => state, getSel: () => sel });
  view.insetRight = () => { // 폰: 화면 조절 단추가 캔버스 오른쪽에 세로로 붙는다(폭 < 높이) — 맞춤이 그 뒤로 도면을 숨기지 않게 그만큼 비운다. 데스크톱은 아래 가로 막대라 0
    const c = canvas.getBoundingClientRect(), z = document.querySelector('.ed-ctl.r')?.getBoundingClientRect();
    return z && z.width > 0 && z.height > z.width && z.left > c.left + c.width * 0.6 ? Math.max(0, c.right - z.left + 8) : 0;
  };
  view.insetTop = () => Math.max(0, $('plHint').getBoundingClientRect().bottom - canvas.getBoundingClientRect().top);   // 도구 안내 막대가 캔버스 위쪽을 덮는 높이 — 가장자리 글자가 그 뒤에 숨지 않게
  tools = createTools({ store, view, sel, ui, state });
  view.overlay = (g) => tools.overlay(g); tools.attach(canvas);
  mini = createMinimap($('plMini'), { store, view }); view.onChange = (vp) => { mini.draw(); canvas.dataset.scale = vp.scale.toFixed(4); }; // data-scale = px/mm (화면 확인용 표시)
  store.subscribe(() => { sel.prune(store.doc); schedule(); });
  wire();
  const appEl = $('plApp'); appEl.style.transition = 'none'; // 시작할 때의 패널 접힘은 애니메이션 없이 — 애니메이션 도중의 캔버스 폭으로 맞추면 평면이 작게 맞춰진다
  if (narrow.matches) setPanel(false);
  if (mid.matches) setSide(false); // 폰 + 중간 폭: 오른쪽 패널은 접어서 시작
  openPanel('draw'); tools.setTool('select');
  view.resize(); view.fit(fitBounds()); refresh();
  requestAnimationFrame(() => requestAnimationFrame(() => { appEl.style.transition = ''; }));
  // 처음 맞춤은 캔버스 크기가 확정되기 전에 계산될 수 있다(패널 접힘·템플릿 불러오기 도중) — 사용자가 화면을 만지기 전까지는 크기가 바뀔 때마다 다시 맞춘다
  let touched = false; const touch = () => { touched = true; };
  for (const ev of ['pointerdown', 'wheel', 'keydown']) canvas.addEventListener(ev, touch, { once: true, passive: true });
  new ResizeObserver(() => { if (!touched && state.mode === '2d') { view.resize(); view.fit(fitBounds()); } }).observe(canvas);
  if (!kept) { toast(NO_STORE, 'err'); $('plSaveState').title = NO_STORE; } // 상태 칸이 좁아 잘려 보여도 전체 문구는 마우스를 올리면 나온다
  if (init.notice) toast(init.notice, 'err');
  if (new URLSearchParams(location.search).get('underlay')) underlayStart();
}
boot().catch((e) => { document.body.append(h('p', { class: 'ed-note err', text: `도면 편집기를 시작하지 못했습니다 · ${e.message}` })); throw e; });
