// 플래너 왼쪽 패널(템플릿·제품·마감재·설계형 라이브러리·리소스 관리) — DOM 을 직접 만들어 container 에 넣는다(innerHTML 없음). 검색·정렬·배치 크기 같은 순수 함수는 export 해서 node 로 시험한다.
import { curFloor } from './core/model.js';
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

// 즐겨찾기 — localStorage('ain-plan-fav-<kind>') 에 id 배열. 저장소가 막혀 있어도 이번 화면 동안은 동작한다(저장 실패는 toggle 이 false 를 돌려준다)
export function createFavs(kind, storage = typeof localStorage === 'undefined' ? null : localStorage) {
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
// 스타일시트가 붙기 전 한 프레임 맨몸으로 보이지 않게 숨겼다가 불러오면 보인다
const revealWhenStyled = (root, isGone) => { root.style.visibility = 'hidden'; ensureStyles().then(() => { if (!isGone()) root.style.visibility = ''; }); };

/* ---------- 제품·마감재가 함께 쓰는 목록 판 ----------
   cfg: name, title, favKind, tabs[{id,label}], load(), chips(data)→[{id,label}], entries(data)→[], filter(entries,{chip,query,ids}), sorts?, card(entry)→{main}, cols(1|2), searchLabel,
   placed(data, ctx, api)→{node, refresh?} (마지막 탭), refresh?(grid, ctx)(문서가 바뀔 때 카드 표시만 고친다), foot?(data)→text, emptyFav, emptyNone */
function browsePanel(container, ctx, cfg) {
  const st = { tab: 'lib', chip: 'all', q: '', sort: cfg.sorts ? cfg.sorts[0].id : '' };
  const favs = createFavs(cfg.favKind);
  let data = null, view = null, placedView = null, gone = false;
  const toast = (m) => ctx.toast && ctx.toast(m);
  const root = h('section', { class: 'pl-root', 'data-panel': cfg.name }, h('header', { class: 'pl-head' }, h('h2', { class: 'pl-title' }, cfg.title)));
  const tabsApi = tablist(`${cfg.title} 목록`, cfg.tabs, st.tab, (id) => { st.tab = id; show(); }, 'pl-tabs');
  const body = h('div', { class: 'pl-body', role: 'tabpanel' });
  root.append(tabsApi.el, body);
  container.replaceChildren(root);
  revealWhenStyled(root, () => gone);
  body.id = uid('pl-p');
  tabsApi.tabs.forEach((t) => t.setAttribute('aria-controls', body.id));

  const status = (node) => body.replaceChildren(node);
  const fail = () => status(emptyNote('목록을 불러오지 못했습니다 ', h('button', { type: 'button', class: 'pl-link', onclick: start }, '다시 시도')));
  function start() {
    status(h('p', { class: 'pl-empty', role: 'status' }, '불러오는 중'));
    cfg.load().then((d) => { if (gone) return; data = d; show(); }, () => { if (!gone) fail(); });
  }

  function show() {
    if (!data) return;
    if (cfg.countTab) tabsApi.setLabel(cfg.tabs[cfg.tabs.length - 1].id, cfg.countTab(data, ctx));
    tabsApi.select(st.tab);
    body.setAttribute('aria-labelledby', tabsApi.tabs.find((t) => t.dataset.id === st.tab).id);
    view = placedView = null;
    if (st.tab === cfg.tabs[cfg.tabs.length - 1].id && cfg.placed) { placedView = cfg.placed(data, ctx, { toast }); status(placedView.node); return; }
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
    const count = h('p', { class: 'pl-count', 'aria-live': 'polite' });
    const hint = h('p', { class: 'pl-hint' }, cfg.hint);
    const grid = h('ul', { class: 'pl-grid pl-grid--' + cfg.cols, 'aria-label': cfg.title });
    const foot = cfg.foot && h('p', { class: 'pl-foot' }, cfg.foot(data));
    const refreshTab = roving(grid, '.pl-card-main');
    const toggleFav = (id, btn) => {
      const saved = favs.toggle(id);
      if (!saved) toast('즐겨찾기를 저장하지 못했습니다 · 이번 화면에서만 유지됩니다');
      if (st.tab === 'fav') { const mains = [...grid.querySelectorAll('.pl-card-main')], i = mains.findIndex((m) => m.dataset.id === id); update(); const next = [...grid.querySelectorAll('.pl-card-main')]; (next[Math.min(i, next.length - 1)] || search).focus(); }
      else btn.setAttribute('aria-pressed', favs.has(id));
    };
    grid.addEventListener('keydown', (e) => { // F = 즐겨찾기(카드에 초점이 있을 때만)
      const main = e.target.closest('.pl-card-main');
      if (!main || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'f' && e.key !== 'F')) return;
      e.preventDefault(); e.stopPropagation();
      toggleFav(main.dataset.id, main.parentElement.querySelector('.pl-fav'));
    });
    function update() {
      const ids = st.tab === 'fav' ? favs.all() : null;
      let list = cfg.filter(entries, { chip: st.chip, query: st.q, ids });
      if (cfg.sorts) list = cfg.sort(list, st.sort);
      count.textContent = `${list.length}개`;
      grid.replaceChildren(...list.map((en) => {
        const c = cfg.card(en, ctx, { toast }), id = en.id;
        const fav = h('button', { type: 'button', class: 'pl-fav', 'aria-pressed': favs.has(id), 'aria-label': `${c.name} 즐겨찾기`, tabindex: '-1', 'aria-keyshortcuts': 'F', onclick: (e) => toggleFav(id, e.currentTarget) }, '즐겨찾기');
        c.main.classList.add('pl-card-main'); c.main.dataset.id = id;
        return h('li', { class: 'pl-card' }, c.main, fav);
      }));
      if (!list.length) grid.append(h('li', { class: 'pl-empty-row' }, emptyNote(st.tab === 'fav' && !favs.all().size && !st.q && st.chip === 'all' ? cfg.emptyFav : cfg.emptyNone)));
      refreshTab();
      if (cfg.refresh) cfg.refresh(grid, ctx);
    }
    view = { update, grid };
    update();
    return h('div', { class: 'pl-browse' }, h('div', { class: 'pl-tools' }, search, sort), chips.el, hint, count, grid, foot);
  }

  const unsub = ctx.store.subscribe(() => {
    if (gone || !data) return;
    if (cfg.countTab) tabsApi.setLabel(cfg.tabs[cfg.tabs.length - 1].id, cfg.countTab(data, ctx));
    if (placedView && placedView.refresh) placedView.refresh();
    if (view && cfg.refresh) cfg.refresh(view.grid, ctx);
  });
  start();
  return { destroy() { gone = true; unsub(); root.remove(); } };
}

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

function placedProducts(data, ctx) {
  const node = h('div', { class: 'pl-browse' }), list = h('ul', { class: 'pl-list', 'aria-label': '배치된 제품' }), head = h('p', { class: 'pl-count' });
  node.append(head, list);
  const render = () => {
    const f = curFloor(ctx.store.doc), items = f.items;
    head.textContent = `${f.name} · ${items.length}대`;
    list.replaceChildren(...items.map((i) => h('li', { class: 'pl-row' },
      h('span', { class: 'pl-row-main' }, h('span', { class: 'pl-prod-code' }, i.code || '모델명 미확인'), h('span', { class: 'pl-row-sub' }, [BRAND_LABEL[i.brand], MODEL_LABEL[i.model], i.capacityKw === null ? '냉방 미확인' : `냉방 ${i.capacityKw} kW`, roomNameAt(f, i.c)].filter(Boolean).join(' · '))),
      h('button', { type: 'button', class: 'pl-btn', 'aria-label': `${i.code || '모델명 미확인'} ${i.id} 삭제`, onclick: () => ctx.store.exec({ type: 'remove', ids: [i.id] }) }, '삭제'))));
    if (!items.length) list.append(h('li', { class: 'pl-empty-row' }, emptyNote('아직 놓은 에어컨이 없습니다')));
  };
  render();
  return { node, refresh: render };
}

function productsPanel(container, ctx) {
  return browsePanel(container, ctx, {
    name: 'products', title: '제품', favKind: 'ac', cols: 1,
    tabs: [{ id: 'lib', label: '에어컨 라이브러리' }, { id: 'fav', label: '즐겨찾기' }, { id: 'placed', label: '배치된 제품' }],
    load: loadCatalog, entries: (d) => d.models, chipLabel: '에어컨 형식',
    chips: () => MODEL_ORDER.map((id) => ({ id, label: MODEL_LABEL[id] })),
    filter: (e, o) => filterModels(e, { type: o.chip, query: o.query, ids: o.ids }), sorts: MODEL_SORTS, sort: sortModels,
    searchLabel: '모델명·시리즈 검색', hint: '방향키로 고르고 Enter 로 놓습니다 · F 즐겨찾기',
    card: productCard, placed: placedProducts, countTab: (d, c) => `배치된 제품 ${curFloor(c.store.doc).items.length}`,
    emptyFav: '즐겨찾기한 에어컨이 없습니다', emptyNone: '찾는 에어컨이 없습니다',
    foot: (d) => `제원은 제조사 웹 카탈로그를 옮긴 값입니다 · 수집 ${d.meta.readme.checked} · 빈 칸은 미확인`,
  });
}

/* ---------- 마감재 ---------- */
function finishCard(f, ctx, api) {
  const name = `${TARGET_LABEL[f.target]} ${f.name}`;
  const sw = h('span', { class: 'pl-sw', 'aria-hidden': 'true' });
  sw.style.background = f.sw; // 색 견본은 자료(finishes.json)의 값
  const main = h('button', { type: 'button', class: 'pl-fin', 'aria-label': `${name} 적용`, 'data-target': f.target,
    onclick: () => { ctx.store.exec({ type: 'setFloor', patch: { finish: { [f.target]: f.id } } }); api.toast(`${curFloor(ctx.store.doc).name} ${TARGET_LABEL[f.target]} 마감 · ${f.name}`); } },
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
        h('button', { type: 'button', class: 'pl-btn', 'aria-label': `${TARGET_LABEL[t]} 마감 해제`, onclick: () => ctx.store.exec({ type: 'setFloor', patch: { finish: { [t]: '' } } }) }, '해제'));
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

  function start() {
    body.replaceChildren(h('p', { class: 'pl-empty', role: 'status' }, '불러오는 중'));
    loadTemplates().then((d) => { if (gone) return; data = d; build(); }, () => { if (!gone) body.replaceChildren(emptyNote('템플릿을 불러오지 못했습니다 ', h('button', { type: 'button', class: 'pl-link', onclick: start }, '다시 시도'))); });
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

// name: 'templates'|'products'|'materials'|'library'|'resources', ctx: {store, setTool(name,opts), toast(msg), openDialog(title,node), openTemplate?(id)}
export function mountPanel(name, container, ctx) {
  const make = PANELS[name];
  if (!make) throw new Error(`알 수 없는 패널입니다: ${name}`);
  return make(container, ctx);
}
