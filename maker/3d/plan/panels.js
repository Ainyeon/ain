// 플래너 왼쪽 패널(템플릿·제품(시스템에어컨·가전)·마감재·설계형 라이브러리·리소스 관리) — DOM 을 직접 만들어 container 에 넣는다(innerHTML 없음). 검색·정렬·배치 크기 같은 순수 함수는 export 해서 node 로 시험한다.
import { curFloor, APPLIANCE_CATEGORIES, APPLIANCE_LABEL } from './core/model.js';
import { pointInPoly } from './core/geom.js';

export const MODEL_LABEL = { '1way': '1Way', '2way': '2Way', '4way': '4Way', '360': '360', mini4way: '미니 4Way' };
export const BRAND_LABEL = { samsung: '삼성', lg: 'LG' };
export const MODEL_ORDER = ['1way', '2way', '4way', 'mini4way', '360']; // 객체 키는 숫자 모양('360')이 앞으로 오므로 칩 순서는 따로 둔다
const TARGET_LABEL = { wall: '벽', floor: '바닥' };

/* ---------- 순수 함수 ---------- */
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');
export const fmtDims = (a) => (a ? a.join('×') : '');

// 놓을 때 쓰는 평면 크기 [가로, 세로] — 판넬이 있으면 판넬, 없으면 본체(원문 치수 그대로). 둘 다 비면 null(놓을 수 없다)
export function placement(m) {
  const d = m.panelMm || m.bodyMm;
  return d ? { size: [d[0], d[2]], from: m.panelMm ? 'panel' : 'body' } : null;
}
export function placeOpts(m) { // ctx.setTool('placeItem', …) 에 넘기는 값
  const p = placement(m);
  return p && { model: m.type, brand: m.brand, code: m.code, capacityKw: m.coolingKw, size: p.size };
}
export const kwText = (m) => (m.coolingKw !== null ? `${m.coolingKw} kW` : m.cooling_kw ?? '미확인'); // W 표기 원문은 환산하지 않고 그대로

export function filterModels(models, { type = 'all', query = '', ids = null } = {}) {
  const q = norm(query);
  return models.filter((m) => (type === 'all' || m.type === type) && (!ids || ids.has(m.id)) && (!q || norm([m.code, m.series, m.brandName, BRAND_LABEL[m.brand], MODEL_LABEL[m.type]].join(' ')).includes(q)));
}
const byCode = (a, b) => a.code.localeCompare(b.code, 'ko', { numeric: true });
export const MODEL_SORTS = [
  { id: 'name', label: '이름순', cmp: byCode },
  { id: 'kwAsc', label: '용량 낮은순', cmp: (a, b) => (a.coolingKw ?? Infinity) - (b.coolingKw ?? Infinity) || byCode(a, b) || 0 },
  { id: 'kwDesc', label: '용량 높은순', cmp: (a, b) => (b.coolingKw ?? -Infinity) - (a.coolingKw ?? -Infinity) || byCode(a, b) || 0 },
];
export function sortModels(models, id = 'name') { const s = MODEL_SORTS.find((x) => x.id === id) || MODEL_SORTS[0]; return models.slice().sort((a, b) => { const d = s.cmp(a, b); return Number.isNaN(d) ? byCode(a, b) : d; }); }

export function filterFinishes(list, { chip = 'all', query = '', ids = null } = {}) {
  const q = norm(query);
  return list.filter((f) => (chip === 'all' || f.chip === chip) && (!ids || ids.has(f.id)) && (!q || norm(f.name + TARGET_LABEL[f.target]).includes(q)));
}
export function filterTemplates(list, { size = 'all', layout = 'all' } = {}) { return list.filter((t) => (size === 'all' || t.size === size) && (layout === 'all' || t.layout === layout)); }

/* ---------- 가전 (순수) — data/appliance-catalog.json 의 행 ---------- */
const hay = new WeakMap(); // 행마다 검색용 글자(모델명·모델 코드들·제품명, 공백·대소문자 없앰)를 한 번만 만든다
const hayOf = (m) => { let v = hay.get(m); if (v === undefined) hay.set(m, (v = norm([m.model, ...(m.modelCodes || []), m.name].join(' ')))); return v; };
export function filterAppliances(items, { category = 'all', brand = 'all', query = '', ids = null } = {}) {
  const q = norm(query);
  return items.filter((m) => (category === 'all' || m.category === category) && (brand === 'all' || m.brand === brand) && (!ids || ids.has(m.id)) && (!q || hayOf(m).includes(q)));
}
// 분류 칩에 적는 개수 — 분류 말고 나머지 조건(브랜드·검색·즐겨찾기)을 적용한 결과의 분류별 수. all = 합계
export function categoryCounts(items, { brand = 'all', query = '', ids = null } = {}) {
  const out = { all: 0 };
  for (const c of APPLIANCE_CATEGORIES) out[c] = 0;
  for (const m of filterAppliances(items, { brand, query, ids })) { out.all++; if (m.category in out) out[m.category]++; }
  return out;
}
const byName = (a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }) || a.model.localeCompare(b.model, 'ko', { numeric: true }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const dimDesc = (k) => (a, b) => (a[k] === null) - (b[k] === null) || (b[k] ?? 0) - (a[k] ?? 0) || byName(a, b); // 큰 순, 미확인(null)은 맨 뒤
export const APP_SORTS = [{ id: 'name', label: '이름순', cmp: byName }, { id: 'width', label: '가로 큰 순', cmp: dimDesc('widthMm') }, { id: 'height', label: '높이 큰 순', cmp: dimDesc('heightMm') }];
export function sortAppliances(items, id = 'name') { const s = APP_SORTS.find((x) => x.id === id) || APP_SORTS[0]; return items.slice().sort(s.cmp); }
const mmText = (v) => (v === null || v === undefined ? '미확인' : v.toLocaleString('ko-KR'));
export const dimLine = (w, d, h) => `가로 ${mmText(w)} · 깊이 ${mmText(d)} · 높이 ${mmText(h)} mm`;
export const fmtApplianceDims = (m) => dimLine(m.widthMm, m.depthMm, m.heightMm);
// 가전 목록 바닥글 — meta 의 수집일·행 상한·상한에 닿은 파일에서 만든다(상한 때문에 뺀 모델이 skipped 에 적힌 파일과, 상한 행 수에 닿은 파일을 나눠 말한다)
export function applianceFoot(meta) {
  const cap = meta.rowCap, label = (file) => `${BRAND_LABEL[meta.files[file].brand]} ${APPLIANCE_LABEL[meta.files[file].category]}`;
  const cut = cap.skippedByCap.map((x) => label(x.file)), hit = cap.reached.filter((x) => !cut.includes(label(x.file))).map((x) => label(x.file));
  return [`삼성·LG 공식 페이지에서 모은 ${meta.collectedAt} 기준 목록`, `브랜드·분류마다 최대 ${cap.perFile}행까지 모았습니다`,
    cut.length > 0 && `상한 때문에 뺀 모델이 있는 분류: ${cut.join(', ')}`, hit.length > 0 && `상한 ${cap.perFile}행에 닿은 분류: ${hit.join(', ')}`].filter(Boolean).join(' · ');
}
// ctx.setTool('placeItem', …) 에 넘기는 값 — 놓을 수 없는 행은 null. 크기는 가로·깊이, 높이는 따로(공식 제원 그대로)
export function applianceOpts(m) {
  return m.placeable ? { kind: 'appliance', category: m.category, brand: m.brand, model: m.model, name: m.name, code: m.model, size: [m.widthMm, m.depthMm], heightMm: m.heightMm, url: m.url } : null;
}

// 즐겨찾기 — localStorage('ain-plan-fav-<kind>') 에 id 배열. 저장소가 막혀 있어도 이번 화면 동안은 동작한다(저장 실패는 toggle 이 false 를 돌려준다)
const browserStorage = () => { try { return localStorage; } catch (e) { return null; } }; // 접근하는 것만으로 SecurityError 를 던지는 브라우저(제3자 iframe·쿠키 차단)도 있다
export function createFavs(kind, storage = browserStorage()) {
  const key = 'ain-plan-fav-' + kind;
  let set = new Set();
  try { const a = JSON.parse(storage.getItem(key) || '[]'); if (Array.isArray(a)) set = new Set(a.filter((x) => typeof x === 'string')); } catch (e) { /* 저장소 없음·깨진 값은 빈 목록 */ }
  return {
    has: (id) => set.has(id),
    all: () => new Set(set),
    toggle(id) { // 저장까지 됐으면 true
      if (!set.delete(id)) set.add(id);
      try { storage.setItem(key, JSON.stringify([...set])); return true; } catch (e) { return false; }
    },
  };
}

/* ---------- 자료 불러오기 ---------- */
const cache = new Map();
function loadData(name) {
  if (!cache.has(name)) cache.set(name, fetch(new URL(`./data/${name}.json`, import.meta.url)).then((r) => { if (!r.ok) throw new Error(`${name} ${r.status}`); return r.json(); }).catch((e) => { cache.delete(name); throw e; }));
  return cache.get(name);
}
export const loadCatalog = () => loadData('ac-catalog');
export const loadApplianceCatalog = () => loadData('appliance-catalog'); // [가전] 을 처음 열 때만 불러온다(1MB 쯤)
export const loadFinishes = () => loadData('finishes');
export const loadTemplates = () => loadData('templates');

/* ---------- DOM 도우미 ---------- */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
let uidN = 0;
const uid = (p) => `${p}${++uidN}`;

// 같은 폴더의 panels.css 를 한 번만 붙인다(B 의 index.html 이 이미 붙였으면 그것을 쓴다). 반환: 불러오기가 끝나면 풀리는 Promise
let stylesP = null;
export function ensureStyles() {
  if (stylesP) return stylesP;
  const href = new URL('./panels.css', import.meta.url).href;
  let link = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => l.href === href);
  if (!link) { link = h('link', { rel: 'stylesheet', href }); document.head.append(link); }
  stylesP = link.sheet ? Promise.resolve() : new Promise((ok) => { link.addEventListener('load', ok, { once: true }); link.addEventListener('error', ok, { once: true }); });
  return stylesP;
}

// 탭 줄(role=tablist) — 좌우·Home·End 로 옮기면 바로 고른다. items [{id,label}]. 반환 {el, select(id), setLabel(id,text)}
function tablist(label, items, current, onPick, cls) {
  const el = h('div', { class: cls, role: 'tablist', 'aria-label': label });
  const tabs = items.map((it) => h('button', { type: 'button', role: 'tab', class: cls + '-tab', id: uid('pl-t'), 'data-id': it.id, onclick: () => pick(it.id) }, it.label));
  const mark = (id) => tabs.forEach((t) => { const on = t.dataset.id === id; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
  const pick = (id) => { mark(id); onPick(id, tabs.find((t) => t.dataset.id === id)); };
  el.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(e.target.closest('[role=tab]')), n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (i < 0 || n === undefined) return;
    e.preventDefault(); e.stopPropagation();
    const t = tabs[(n + tabs.length) % tabs.length];
    t.focus(); pick(t.dataset.id);
  });
  el.append(...tabs);
  mark(current);
  return { el, tabs, select: mark, setLabel: (id, text) => { const t = tabs.find((x) => x.dataset.id === id); if (t) t.textContent = text; } };
}

// 카드 목록의 한 칸만 Tab 으로 닿게 하고(roving tabindex) 방향키·Home·End 로 옮긴다. 반환 refresh() — 목록을 다시 그린 뒤 부른다
function roving(box, sel) {
  const items = () => [...box.querySelectorAll(sel)];
  const stop = (cur) => items().forEach((el) => { el.tabIndex = el === cur ? 0 : -1; });
  box.addEventListener('focusin', (e) => { const t = e.target.closest(sel); if (t) stop(t); });
  box.addEventListener('keydown', (e) => {
    const t = e.target.closest(sel);
    if (!t || e.ctrlKey || e.metaKey || e.altKey) return;
    const list = items(), i = list.indexOf(t), tops = list.map((el) => Math.round(el.getBoundingClientRect().top)), cols = tops.filter((v) => v === tops[0]).length || 1;
    const n = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: list.length - 1 }[e.key];
    if (i < 0 || n === undefined) return;
    e.preventDefault(); e.stopPropagation();
    list[Math.max(0, Math.min(list.length - 1, n))].focus();
  });
  return () => { const l = items(); if (l.length) stop(l[0]); };
}

const emptyNote = (text, ...more) => h('p', { class: 'pl-empty' }, text, ...more);
// 불러오기 실패 안내 — role=alert 로 낭독된다. 다시 시도가 끝나면 초점이 body 로 사라지지 않게 첫 카드(없으면 다시 시도 단추·선택된 칩)로 옮긴다(그 사이 사용자가 초점을 다른 곳에 뒀으면 건드리지 않는다)
const failNote = (text, retry) => h('p', { class: 'pl-empty', role: 'alert' }, text + ' ', h('button', { type: 'button', class: 'pl-link', onclick: retry }, '다시 시도'));
const refocus = (box) => {
  const a = document.activeElement;
  if (a && a !== document.body) return;
  const t = box.querySelector('.pl-card-main') || box.querySelector('.pl-link') || box.querySelector('[role=tab][aria-selected="true"]');
  if (t) t.focus({ preventScroll: true });
};
// 스타일시트가 붙기 전 한 프레임 맨몸으로 보이지 않게 숨겼다가 불러오면 보인다
const revealWhenStyled = (root, isGone) => { root.style.visibility = 'hidden'; ensureStyles().then(() => { if (!isGone()) root.style.visibility = ''; }); };

/* ---------- 제품·마감재가 함께 쓰는 목록 판 ----------
   cfg: name, title, favKind, tabs[{id,label}], load(), chips(data)→[{id,label}], entries(data)→[], filter(entries,{chip,chip2,query,ids}), sorts?, sort?(list,id), card(entry)→{main,name,extra?}, cols(1|2), searchLabel,
   placed(data, ctx, api)→{node, refresh?} (마지막 탭, 자료를 못 불러와도 열린다), refresh?(grid, ctx)(문서가 바뀔 때 카드 표시만 고친다), foot?(data)→text, emptyFav, emptyNone(글자 또는 (data, st)→글자·노드 배열),
   둘째 칩 줄: chip2Label·chips2(data)→[…] (있으면 filter 의 chip2 로 넘어간다) · chipCounts?(entries,{chip2,query,ids})→{칩 id: 개수}(첫 칩 줄 글자에 개수를 적는다)
   limit?: 한 번에 그리는 카드 수(넘으면 '더 보기') · countText?(total, shown) · embedded: 제품 판 안에 들어가는 판(제목 줄이 없다) */
function browsePanel(container, ctx, cfg) {
  const st = { tab: 'lib', chip: 'all', chip2: 'all', q: '', sort: cfg.sorts ? cfg.sorts[0].id : '' };
  const favs = createFavs(cfg.favKind), lastTab = cfg.tabs[cfg.tabs.length - 1].id, page = cfg.limit || Infinity;
  let data = null, phase = 'loading', view = null, placedView = null, gone = false;
  const toast = (m) => ctx.toast && ctx.toast(m);
  const root = h('section', { class: 'pl-root' + (cfg.embedded ? ' pl-root--in' : ''), [cfg.embedded ? 'data-sub' : 'data-panel']: cfg.name }, cfg.embedded ? null : h('header', { class: 'pl-head' }, h('h2', { class: 'pl-title' }, cfg.title)));
  const tabsApi = tablist(`${cfg.title} 목록`, cfg.tabs, st.tab, (id) => { st.tab = id; show(); }, 'pl-tabs');
  const body = h('div', { class: 'pl-body', role: 'tabpanel' });
  root.append(tabsApi.el, body);
  container.replaceChildren(root);
  revealWhenStyled(root, () => gone);
  body.id = uid('pl-p');
  tabsApi.tabs.forEach((t) => t.setAttribute('aria-controls', body.id));
  if (cfg.countTab) tabsApi.setLabel(lastTab, cfg.countTab(null, ctx));

  const status = (node) => body.replaceChildren(node);
  const loadingNote = () => h('p', { class: 'pl-empty', role: 'status' }, '불러오는 중');
  const fail = () => status(failNote('목록을 불러오지 못했습니다', () => start(true)));
  function start(retry) {
    phase = 'loading';
    if (st.tab !== lastTab) status(loadingNote());
    cfg.load().then((d) => { if (gone) return; data = d; phase = 'ready'; show(); if (retry) refocus(body); }, () => { if (gone) return; phase = 'fail'; if (st.tab !== lastTab) { fail(); if (retry) refocus(body); } });
  }

  function show() {
    tabsApi.select(st.tab);
    body.setAttribute('aria-labelledby', tabsApi.tabs.find((t) => t.dataset.id === st.tab).id);
    if (cfg.countTab) tabsApi.setLabel(lastTab, cfg.countTab(data, ctx));
    view = placedView = null;
    if (st.tab === lastTab && cfg.placed) { placedView = cfg.placed(data, ctx, { toast }); status(placedView.node); return; }
    if (!data) { if (phase === 'fail') fail(); else status(loadingNote()); return; }
    body.replaceChildren(browse());
  }

  function browse() {
    const entries = cfg.entries(data);
    const chipItems = [{ id: 'all', label: '전체' }, ...cfg.chips(data)];
    if (!chipItems.some((c) => c.id === st.chip)) st.chip = 'all';
    const search = h('input', { type: 'search', class: 'pl-search', placeholder: cfg.searchLabel, 'aria-label': cfg.searchLabel, autocomplete: 'off', spellcheck: 'false' });
    search.value = st.q;
    search.addEventListener('input', () => { st.q = search.value; update(); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !search.value) return; e.stopPropagation(); if (e.key === 'Escape') { search.value = ''; st.q = ''; update(); } }); // 입력칸에서는 전역 단축키가 먹지 않게 막고, 빈 칸의 ESC 만 위로 보낸다
    const sort = cfg.sorts && h('select', { class: 'pl-sort', 'aria-label': '정렬' }, cfg.sorts.map((s) => h('option', { value: s.id }, s.label)));
    if (sort) { sort.value = st.sort; sort.addEventListener('change', () => { st.sort = sort.value; update(); }); sort.addEventListener('keydown', (e) => e.stopPropagation()); }
    const chips = tablist(cfg.chipLabel, chipItems, st.chip, (id) => { st.chip = id; update(); }, 'pl-chips');
    const chips2 = cfg.chips2 && tablist(cfg.chip2Label, [{ id: 'all', label: '전체' }, ...cfg.chips2(data)], st.chip2, (id) => { st.chip2 = id; update(); }, 'pl-chips');
    const count = h('p', { class: 'pl-count', 'aria-live': 'polite' });
    const hint = h('p', { class: 'pl-hint' }, cfg.hint);
    const grid = h('ul', { class: 'pl-grid pl-grid--' + cfg.cols, 'aria-label': cfg.title });
    const moreBtn = h('button', { type: 'button', class: 'pl-more', onclick: showMore });
    const foot = cfg.foot && h('p', { class: 'pl-foot' }, cfg.foot(data));
    const refreshTab = roving(grid, '.pl-card-main');
    let list = [], shown = 0;
    const toggleFav = (id, btn) => {
      const saved = favs.toggle(id);
      if (!saved) toast('즐겨찾기를 저장하지 못했습니다 · 이번 화면에서만 유지됩니다');
      if (st.tab === 'fav') { const mains = [...grid.querySelectorAll('.pl-card-main')], i = mains.findIndex((m) => m.dataset.id === id); update(); const next = [...grid.querySelectorAll('.pl-card-main')]; (next[Math.min(i, next.length - 1)] || search).focus(); }
      else btn.setAttribute('aria-pressed', favs.has(id));
    };
    grid.addEventListener('keydown', (e) => { // F = 즐겨찾기, O = 공식 페이지 열기(카드에 초점이 있을 때만). 한글 자판에서도 되도록 글쇠 위치(code)로 본다
      const main = e.target.closest('.pl-card-main');
      if (!main || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyF' || e.key === 'f' || e.key === 'F') { e.preventDefault(); e.stopPropagation(); toggleFav(main.dataset.id, main.parentElement.querySelector('.pl-fav')); }
      else if (e.code === 'KeyO' || e.key === 'o' || e.key === 'O') { const a = main.parentElement.querySelector('.pl-src'); if (a) { e.preventDefault(); e.stopPropagation(); a.click(); } }
    });
    function cardOf(en) {
      const c = cfg.card(en, ctx, { toast }), id = en.id;
      const fav = h('button', { type: 'button', class: 'pl-fav', 'aria-pressed': favs.has(id), 'aria-label': `${c.name} 즐겨찾기`, tabindex: '-1', 'aria-keyshortcuts': 'F', onclick: (e) => toggleFav(id, e.currentTarget) }, '즐겨찾기');
      c.main.classList.add('pl-card-main'); c.main.dataset.id = id;
      return h('li', { class: 'pl-card' }, c.main, fav, c.extra);
    }
    function syncMore() {
      const left = list.length - shown;
      moreBtn.hidden = left <= 0; moreBtn.textContent = `더 보기 (${Math.min(page, left).toLocaleString('ko-KR')}개)`;
      count.textContent = cfg.countText ? cfg.countText(list.length, shown) : `${list.length}개`;
    }
    function update() { // 조건이 바뀌었다 — 처음 한 쪽부터 다시 그린다
      const ids = st.tab === 'fav' ? favs.all() : null;
      list = cfg.filter(entries, { chip: st.chip, chip2: st.chip2, query: st.q, ids });
      if (cfg.sorts) list = cfg.sort(list, st.sort);
      shown = Math.min(list.length, page);
      if (cfg.chipCounts) { const n = cfg.chipCounts(entries, { chip2: st.chip2, query: st.q, ids }); for (const c of chipItems) chips.setLabel(c.id, `${c.label} ${(n[c.id] ?? 0).toLocaleString('ko-KR')}`); }
      grid.replaceChildren(...list.slice(0, shown).map(cardOf));
      if (!list.length) {
        const none = st.tab === 'fav' && !favs.all().size && !st.q && st.chip === 'all' && st.chip2 === 'all' ? cfg.emptyFav : typeof cfg.emptyNone === 'function' ? cfg.emptyNone(data, st) : cfg.emptyNone;
        grid.append(h('li', { class: 'pl-empty-row' }, emptyNote(...[].concat(none))));
      }
      syncMore(); refreshTab();
      if (cfg.refresh) cfg.refresh(grid, ctx);
    }
    function showMore() { // 앞의 카드는 그대로 두고 다음 쪽만 덧붙인다 — 스크롤 자리가 그대로이고, 초점은 새로 붙은 첫 카드로
      const from = shown; shown = Math.min(list.length, shown + page);
      const added = list.slice(from, shown).map(cardOf);
      grid.append(...added);
      syncMore(); refreshTab();
      if (cfg.refresh) cfg.refresh(grid, ctx);
      const first = added[0] && added[0].querySelector('.pl-card-main');
      if (first) first.focus({ preventScroll: true });
    }
    view = { update, grid };
    update();
    const group = (title, el) => h('div', { class: 'pl-fgroup' }, h('span', { class: 'pl-flabel' }, title), el);
    return h('div', { class: 'pl-browse' }, h('div', { class: 'pl-filters' }, h('div', { class: 'pl-tools' }, search, sort), chips2 ? [group(cfg.chipLabel, chips.el), group(cfg.chip2Label, chips2.el)] : chips.el, hint, count), grid, moreBtn, foot);
  }

  const unsub = ctx.store.subscribe(() => {
    if (gone) return;
    if (cfg.countTab) tabsApi.setLabel(lastTab, cfg.countTab(data, ctx));
    if (placedView && placedView.refresh) placedView.refresh();
    if (view && cfg.refresh) cfg.refresh(view.grid, ctx);
  });
  start();
  return { destroy() { gone = true; unsub(); root.remove(); } };
}

/* ---------- 문서 명령: 잠금을 지키는 ctx.exec 로만 (없으면 store.exec) ---------- */
const exec = (ctx, cmd) => (ctx.exec ? ctx.exec(cmd) : ctx.store.exec(cmd));
export const removeItem = (ctx, id) => exec(ctx, { type: 'remove', ids: [id] });
export const applyFinish = (ctx, f) => exec(ctx, { type: 'setFloor', patch: { finish: { [f.target]: f.id } } });
export const clearFinish = (ctx, target) => exec(ctx, { type: 'setFloor', patch: { finish: { [target]: '' } } });

/* ---------- 제품(에어컨) ---------- */
const roomNameAt = (f, p) => f.rooms.find((r) => pointInPoly(r.poly, p))?.name ?? '';

function productCard(m, ctx, api) {
  const pl = placement(m), dims = [m.panelMm && `판넬 ${fmtDims(m.panelMm)}`, m.bodyMm && `본체 ${fmtDims(m.bodyMm)}`].filter(Boolean);
  const name = `${BRAND_LABEL[m.brand]} ${m.code}`;
  const main = h('button', { type: 'button', class: 'pl-prod', 'aria-disabled': pl ? null : 'true', 'aria-label': `${name}, ${MODEL_LABEL[m.type]}, 냉방 ${kwText(m)}, ${pl ? '캔버스에 놓기' : '치수 미확인이라 놓을 수 없음'}`,
    onclick: () => {
      if (!pl) { api.toast(`${m.code} · 제원표에 치수가 없어 놓을 수 없습니다`); return; }
      ctx.setTool('placeItem', placeOpts(m));
      api.toast(`${m.code} · 캔버스를 눌러 놓으세요`);
    } },
    h('span', { class: 'pl-prod-type' }, `${BRAND_LABEL[m.brand]} · ${MODEL_LABEL[m.type]}`),
    h('span', { class: 'pl-prod-row' }, h('span', { class: 'pl-prod-code' }, m.code), h('span', { class: 'pl-prod-kw' }, kwText(m))),
    h('span', { class: 'pl-prod-series' }, m.series ?? ''),
    h('span', { class: 'pl-prod-dim' }, dims.length ? dims.join(' · ') : '치수 미확인'),
    m.currentUncertain && h('span', { class: 'pl-flag' }, '현행 불확실'),
    !pl && h('span', { class: 'pl-flag' }, '놓을 수 없음'));
  return { main, name };
}

// 배치된 제품 탭 — 시스템에어컨과 가전을 구역으로 나눠 보이고, 삭제는 잠금을 지키는 ctx.exec 로
function placedProducts(data, ctx) {
  const node = h('div', { class: 'pl-browse' }), head = h('p', { class: 'pl-count' });
  const sec = (title) => h('h3', { class: 'pl-sec' }, title);
  const acHead = sec(''), acList = h('ul', { class: 'pl-list', 'aria-label': '배치된 시스템에어컨' }), appHead = sec(''), appList = h('ul', { class: 'pl-list', 'aria-label': '배치된 가전' });
  node.append(head, acHead, acList, appHead, appList);
  const row = (i, main, ...subs) => h('li', { class: 'pl-row' },
    h('span', { class: 'pl-row-main' }, h('span', { class: 'pl-prod-code' }, main), subs.map((t) => h('span', { class: 'pl-row-sub' }, t))),
    h('button', { type: 'button', class: 'pl-btn', 'aria-label': `${main} ${i.id} 삭제`, onclick: () => removeItem(ctx, i.id) }, '삭제'));
  const render = () => {
    const f = curFloor(ctx.store.doc), acs = f.items.filter((i) => i.kind === 'ac'), apps = f.items.filter((i) => i.kind === 'appliance');
    head.textContent = `${f.name} · ${f.items.length}대`;
    acHead.textContent = `시스템에어컨 ${acs.length}대`; appHead.textContent = `가전 ${apps.length}대`;
    acList.replaceChildren(...acs.map((i) => row(i, i.code || '모델명 미확인', [BRAND_LABEL[i.brand], MODEL_LABEL[i.model], i.capacityKw === null ? '냉방 미확인' : `냉방 ${i.capacityKw} kW`, roomNameAt(f, i.c)].filter(Boolean).join(' · '))));
    if (!acs.length) acList.append(h('li', { class: 'pl-empty-row' }, emptyNote('아직 놓은 에어컨이 없습니다')));
    appList.replaceChildren(...apps.map((i) => row(i, i.code || i.model, [BRAND_LABEL[i.brand], APPLIANCE_LABEL[i.category], roomNameAt(f, i.c)].filter(Boolean).join(' · '), dimLine(i.size[0], i.size[1], i.heightMm))));
    if (!apps.length) appList.append(h('li', { class: 'pl-empty-row' }, emptyNote('아직 놓은 가전이 없습니다')));
  };
  render();
  return { node, refresh: render };
}

const countItems = (c) => curFloor(c.store.doc).items.length;
function systemAcPanel(host, ctx) {
  return browsePanel(host, ctx, {
    name: 'ac', embedded: true, title: '제품', favKind: 'ac', cols: 1,
    tabs: [{ id: 'lib', label: '에어컨 라이브러리' }, { id: 'fav', label: '즐겨찾기' }, { id: 'placed', label: '배치된 제품' }],
    load: loadCatalog, entries: (d) => d.models, chipLabel: '에어컨 형식',
    chips: () => MODEL_ORDER.map((id) => ({ id, label: MODEL_LABEL[id] })),
    filter: (e, o) => filterModels(e, { type: o.chip, query: o.query, ids: o.ids }), sorts: MODEL_SORTS, sort: sortModels,
    searchLabel: '모델명·시리즈 검색', hint: '방향키로 고르고 Enter 로 놓습니다 · F 즐겨찾기',
    card: productCard, placed: placedProducts, countTab: (d, c) => `배치된 제품 ${countItems(c)}`,
    emptyFav: '즐겨찾기한 에어컨이 없습니다', emptyNone: '찾는 에어컨이 없습니다',
    foot: (d) => `제원은 제조사 웹 카탈로그를 옮긴 값입니다 · 수집 ${d.meta.readme.checked} · 빈 칸은 미확인`,
  });
}

/* ---------- 제품(가전) ---------- */
const APP_PAGE = 200; // 한 번에 그리는 카드 수 — 1,295개를 한꺼번에 그리지 않는다
const isHttps = (u) => typeof u === 'string' && /^https:\/\/\S+$/.test(u);
function applianceCard(m, ctx, api) {
  const opts = applianceOpts(m), cat = APPLIANCE_LABEL[m.category] ?? m.category, dims = fmtApplianceDims(m), name = `${BRAND_LABEL[m.brand]} ${m.model}`;
  const main = h('button', { type: 'button', class: 'pl-prod pl-app', 'aria-disabled': opts ? null : 'true',
    'aria-label': [name, cat, m.name, dims, m.capacityText, m.discontinued && '단종 표시', opts ? '캔버스에 놓기' : `놓을 수 없음, ${m.whyNot}`].filter(Boolean).join(', '),
    onclick: () => {
      if (!opts) { api.toast(`${m.model} · ${m.whyNot}`); return; } // 눌러도 알림만
      ctx.setTool('placeItem', opts);
      api.toast(`${m.model} · 캔버스를 눌러 놓으세요`);
    } },
    h('span', { class: 'pl-prod-type' }, `${BRAND_LABEL[m.brand]} · ${cat}`),
    h('span', { class: 'pl-prod-row' }, h('span', { class: 'pl-prod-code' }, m.model)),
    h('span', { class: 'pl-prod-series pl-app-name', title: m.name }, m.name),
    h('span', { class: 'pl-prod-dim' }, dims),
    m.capacityText && h('span', { class: 'pl-prod-dim pl-app-cap', title: m.capacityText }, m.capacityText),
    m.discontinued && h('span', { class: 'pl-flag' }, '단종 표시'),
    !opts && h('span', { class: 'pl-why' }, m.whyNot));
  const src = isHttps(m.url) && h('a', { class: 'pl-src', href: m.url, target: '_blank', rel: 'noopener noreferrer', tabindex: '-1', 'aria-label': `${m.model} 공식 페이지 (새 창)`, 'aria-keyshortcuts': 'O' }, '공식 페이지');
  return { main, name, extra: src };
}
// 목록에 없는 모델을 찾을 때 가는 브랜드 공식 사이트 링크 둘(새 창)
const officialLinks = (meta) => h('span', { class: 'pl-links' }, Object.entries(BRAND_LABEL).filter(([b]) => isHttps(meta.sourceSites[b]))
  .map(([b, label]) => h('a', { class: 'pl-link', href: meta.sourceSites[b], target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${label} 공식 사이트 (새 창)` }, `${label} 공식 사이트`)));
function appliancesPanel(host, ctx) {
  return browsePanel(host, ctx, {
    name: 'app', embedded: true, title: '가전', favKind: 'appliance', cols: 1, limit: APP_PAGE,
    tabs: [{ id: 'lib', label: '가전 라이브러리' }, { id: 'fav', label: '즐겨찾기' }, { id: 'placed', label: '배치된 제품' }],
    load: loadApplianceCatalog, entries: (d) => d.items,
    chipLabel: '분류', chips: (d) => d.meta.categories.map((c) => ({ id: c.id, label: c.short })), chipCounts: (e, o) => categoryCounts(e, { brand: o.chip2, query: o.query, ids: o.ids }),
    chip2Label: '브랜드', chips2: () => [{ id: 'samsung', label: BRAND_LABEL.samsung }, { id: 'lg', label: BRAND_LABEL.lg }],
    filter: (e, o) => filterAppliances(e, { category: o.chip, brand: o.chip2, query: o.query, ids: o.ids }), sorts: APP_SORTS, sort: sortAppliances,
    searchLabel: '모델명·제품명 검색', hint: '방향키로 고르고 Enter 로 놓습니다 · F 즐겨찾기 · O 공식 페이지',
    card: applianceCard, placed: placedProducts, countTab: (d, c) => `배치된 제품 ${countItems(c)}`,
    countText: (total, shown) => (shown < total ? `${total.toLocaleString('ko-KR')}개 중 ${shown.toLocaleString('ko-KR')}개 표시` : `${total.toLocaleString('ko-KR')}개`),
    emptyFav: '즐겨찾기한 가전이 없습니다',
    emptyNone: (d, st) => (st.tab === 'lib' && st.q.trim() ? ['목록에 없는 모델입니다 · 삼성/LG 공식 페이지에서 크기를 확인해 주세요', officialLinks(d.meta)] : '찾는 가전이 없습니다'),
    foot: (d) => applianceFoot(d.meta),
  });
}

// 제품 판: 맨 위 두 칸 전환 [시스템에어컨] [가전]. 시스템에어컨은 바로 열고, 가전은 처음 누를 때 만든다(카탈로그도 그때 불러온다)
function productsPanel(container, ctx) {
  const root = h('section', { class: 'pl-root', 'data-panel': 'products' }, h('header', { class: 'pl-head' }, h('h2', { class: 'pl-title' }, '제품')));
  const hosts = { ac: h('div', { class: 'pl-host', role: 'tabpanel' }), app: h('div', { class: 'pl-host', role: 'tabpanel', hidden: true }) };
  const seg = tablist('제품 종류', [{ id: 'ac', label: '시스템에어컨' }, { id: 'app', label: '가전' }], 'ac', (id) => pick(id), 'pl-seg');
  for (const t of seg.tabs) { const host = hosts[t.dataset.id]; host.id = uid('pl-h'); host.setAttribute('aria-labelledby', t.id); t.setAttribute('aria-controls', host.id); }
  root.append(seg.el, hosts.ac, hosts.app);
  container.replaceChildren(root);
  let gone = false;
  revealWhenStyled(root, () => gone);
  const subs = { ac: systemAcPanel(hosts.ac, ctx), app: null };
  function pick(id) {
    if (id === 'app' && !subs.app) subs.app = appliancesPanel(hosts.app, ctx);
    hosts.ac.hidden = id !== 'ac'; hosts.app.hidden = id !== 'app';
  }
  return { destroy() { gone = true; for (const sp of Object.values(subs)) if (sp) sp.destroy(); root.remove(); } };
}

/* ---------- 마감재 ---------- */
function finishCard(f, ctx, api) {
  const name = `${TARGET_LABEL[f.target]} ${f.name}`;
  const sw = h('span', { class: 'pl-sw', 'aria-hidden': 'true' });
  sw.style.background = f.sw; // 색 견본은 자료(finishes.json)의 값
  const main = h('button', { type: 'button', class: 'pl-fin', 'aria-label': `${name} 적용`, 'data-target': f.target,
    onclick: () => { if (applyFinish(ctx, f)) api.toast(`${curFloor(ctx.store.doc).name} ${TARGET_LABEL[f.target]} 마감 · ${f.name}`); } },
    sw, h('span', { class: 'pl-fin-name' }, f.name), h('span', { class: 'pl-fin-sub' }, TARGET_LABEL[f.target], h('span', { class: 'pl-on' }, '적용 중')));
  return { main, name };
}
function markApplied(grid, ctx) {
  const fin = curFloor(ctx.store.doc).finish;
  for (const b of grid.querySelectorAll('.pl-fin')) { const on = fin[b.dataset.target] === b.dataset.id; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); }
}
function placedFinishes(data, ctx) {
  const node = h('div', { class: 'pl-browse' }), by = new Map(data.finishes.map((f) => [f.id, f])), list = h('ul', { class: 'pl-list', 'aria-label': '배치된 마감재' }), head = h('p', { class: 'pl-count' });
  node.append(head, list);
  const render = () => {
    const f = curFloor(ctx.store.doc), rows = ['wall', 'floor'].filter((t) => f.finish[t]);
    head.textContent = `${f.name} · ${rows.length}개`;
    list.replaceChildren(...rows.map((t) => {
      const fi = by.get(f.finish[t]), sw = h('span', { class: 'pl-sw pl-sw--s', 'aria-hidden': 'true' });
      if (fi) sw.style.background = fi.sw;
      return h('li', { class: 'pl-row' }, sw, h('span', { class: 'pl-row-main' }, h('span', { class: 'pl-prod-code' }, fi ? fi.name : f.finish[t]), h('span', { class: 'pl-row-sub' }, TARGET_LABEL[t])),
        h('button', { type: 'button', class: 'pl-btn', 'aria-label': `${TARGET_LABEL[t]} 마감 해제`, onclick: () => clearFinish(ctx, t) }, '해제'));
    }));
    if (!rows.length) list.append(h('li', { class: 'pl-empty-row' }, emptyNote('아직 지정한 마감재가 없습니다')));
  };
  render();
  return { node, refresh: render };
}
function materialsPanel(container, ctx) {
  return browsePanel(container, ctx, {
    name: 'materials', title: '마감재', favKind: 'finish', cols: 2,
    tabs: [{ id: 'lib', label: '마감재' }, { id: 'fav', label: '즐겨찾기' }, { id: 'placed', label: '배치된 마감재' }],
    load: loadFinishes, entries: (d) => d.finishes, chipLabel: '마감 분류', chips: (d) => d.chips.map((c) => ({ id: c.id, label: c.name })),
    filter: (e, o) => filterFinishes(e, { chip: o.chip, query: o.query, ids: o.ids }),
    searchLabel: '마감재 이름 검색', hint: '누르면 현재 층 벽·바닥에 적용됩니다 · F 즐겨찾기',
    card: finishCard, refresh: markApplied, placed: placedFinishes,
    emptyFav: '즐겨찾기한 마감재가 없습니다', emptyNone: '찾는 마감재가 없습니다',
  });
}

/* ---------- 템플릿 ---------- */
function planThumb(doc) { // 방·벽·개구부를 1px 선 평면 그림으로(토큰 색은 CSS 클래스가 입힌다)
  const f = doc.floors[0], xs = f.walls.flatMap((w) => [w.a[0], w.b[0]]), ys = f.walls.flatMap((w) => [w.a[1], w.b[1]]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), pad = 400;
  const svg = sv('svg', { class: 'pl-thumb', viewBox: `${x0 - pad} ${y0 - pad} ${Math.max(...xs) - x0 + 2 * pad} ${Math.max(...ys) - y0 + 2 * pad}`, 'aria-hidden': 'true', focusable: 'false' });
  for (const r of f.rooms) svg.append(sv('polygon', { class: 'pl-th-room', points: r.poly.map((p) => p.join(',')).join(' ') }));
  for (const w of f.walls) svg.append(sv('line', { class: 'pl-th-wall', x1: w.a[0], y1: w.a[1], x2: w.b[0], y2: w.b[1], 'stroke-width': w.t }));
  for (const o of f.openings) {
    const w = f.walls.find((x) => x.id === o.wall), L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L], c = [w.a[0] + (w.b[0] - w.a[0]) * o.at, w.a[1] + (w.b[1] - w.a[1]) * o.at], hw = o.width / 2;
    svg.append(sv('line', { class: o.type === 'window' ? 'pl-th-win' : 'pl-th-gap', x1: c[0] - u[0] * hw, y1: c[1] - u[1] * hw, x2: c[0] + u[0] * hw, y2: c[1] + u[1] * hw, 'stroke-width': o.type === 'window' ? w.t / 2 : w.t * 1.2 }));
  }
  return svg;
}
const startTemplate = (id) => { const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('template', id); location.assign(u); };

function templatesPanel(container, ctx) {
  const st = { size: 'all', layout: 'all' };
  let data = null, gone = false;
  const root = h('section', { class: 'pl-root', 'data-panel': 'templates' }, h('header', { class: 'pl-head' }, h('h2', { class: 'pl-title' }, '템플릿')));
  const body = h('div', { class: 'pl-body' });
  root.append(body);
  container.replaceChildren(root);
  revealWhenStyled(root, () => gone);

  function start(retry) {
    body.replaceChildren(h('p', { class: 'pl-empty', role: 'status' }, '불러오는 중'));
    loadTemplates().then((d) => { if (gone) return; data = d; build(); if (retry) refocus(body); }, () => { if (!gone) { body.replaceChildren(failNote('템플릿을 불러오지 못했습니다', () => start(true))); if (retry) refocus(body); } });
  }
  function build() {
    const count = h('p', { class: 'pl-count', 'aria-live': 'polite' }), list = h('ul', { class: 'pl-list pl-list--tpl', 'aria-label': '템플릿' });
    const refreshTab = roving(list, '.pl-card-main');
    const group = (title, items, key) => h('div', { class: 'pl-fgroup' }, h('span', { class: 'pl-flabel' }, title), tablist(`${title} 필터`, [{ id: 'all', label: '전체' }, ...items.map((i) => ({ id: i.id, label: i.name }))], st[key], (id) => { st[key] = id; update(); }, 'pl-chips').el);
    function update() {
      const l = filterTemplates(data.templates, st);
      count.textContent = `${l.length}개`;
      list.replaceChildren(...l.map((t) => h('li', { class: 'pl-card pl-card--tpl' },
        h('button', { type: 'button', class: 'pl-card-main pl-tpl', 'data-id': t.id, 'aria-label': `${t.name}, 실면적 ${t.areaM2.toFixed(2)}제곱미터, 이 템플릿으로 새 도면 시작`, onclick: () => (ctx.openTemplate || startTemplate)(t.id) },
          planThumb(t.doc), h('span', { class: 'pl-tpl-name' }, t.name), h('span', { class: 'pl-tags' }, t.tags.map((x) => h('span', { class: 'pl-tag' }, x))), h('span', { class: 'pl-tpl-area' }, `${t.areaM2.toFixed(2)}㎡`)))));
      if (!l.length) list.append(h('li', { class: 'pl-empty-row' }, emptyNote('조건에 맞는 템플릿이 없습니다')));
      refreshTab();
    }
    body.replaceChildren(h('div', { class: 'pl-browse' }, group('평형', data.filters.size, 'size'), group('형태', data.filters.layout, 'layout'), h('p', { class: 'pl-hint' }, '예시 평면(실제 세대 아님) · 평형은 실면적 기준'), count, list));
    update();
  }
  start();
  return { destroy() { gone = true; root.remove(); } };
}

/* ---------- 설계형 라이브러리·리소스 관리: 비어 있다 ---------- */
function emptyPanel(name, title) {
  return (container) => {
    const root = h('section', { class: 'pl-root', 'data-panel': name }, h('header', { class: 'pl-head' }, h('h2', { class: 'pl-title' }, title)), h('div', { class: 'pl-body' }, emptyNote('아직 없습니다')));
    container.replaceChildren(root);
    let gone = false;
    revealWhenStyled(root, () => gone);
    return { destroy() { gone = true; root.remove(); } };
  };
}

const PANELS = { templates: templatesPanel, products: productsPanel, materials: materialsPanel, library: emptyPanel('library', '설계형 라이브러리'), resources: emptyPanel('resources', '리소스 관리') };

// name: 'templates'|'products'|'materials'|'library'|'resources', ctx: {store, exec?(cmd)(잠금을 지키는 문서 명령), setTool(name,opts), toast(msg), openDialog(title,node), openTemplate?(id)}
export function mountPanel(name, container, ctx) {
  const make = PANELS[name];
  if (!make) throw new Error(`알 수 없는 패널입니다: ${name}`);
  return make(container, ctx);
}
