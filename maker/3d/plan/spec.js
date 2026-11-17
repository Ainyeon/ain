// 시방서 — 현재 문서의 층 마감(바닥·벽)·층 높이, 방, 놓은 제품(에어컨·가전·가구)의 사양을 한 장 문서로 보이고 A4 로 인쇄한다(가격 없음). 집계(buildSpec)는 DOM 없이 node 로 시험한다
import { APPLIANCE_LABEL, FURNITURE_TONES } from './core/model.js';
import { buildEstimate, applianceDims, table } from './estimate.js';
import { h, ensureStyles, loadFinishes, MODEL_LABEL, BRAND_LABEL } from './panels.js';

const NONE = '지정 안 함', UNKNOWN = '미확인';
const TONE = new Map(FURNITURE_TONES);
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

// fin = data/finishes.json(없으면 마감 이름 대신 id). 돌려주는 값은 화면·시험이 같이 쓴다
export function buildSpec(doc, fin = null) {
  const est = buildEstimate(doc), names = new Map((fin?.finishes || []).map((x) => [x.id, x.name]));
  const finName = (id) => (id ? names.get(id) || id : NONE);
  const floors = doc.floors.map((f) => ({ name: f.name, heightMm: f.heightMm, slabMm: f.slabMm, floor: finName(f.finish?.floor), wall: finName(f.finish?.wall) }));
  const furn = new Map();
  for (const f of doc.floors) for (const it of f.items) {
    if (it.kind !== 'furniture') continue;
    const tone = it.tone ? TONE.get(it.tone) || it.tone : '기본', k = [f.name, it.name, applianceDims(it), tone].join('|'), g = furn.get(k);
    if (g) g.count++; else furn.set(k, { floor: f.name, name: it.name, dims: applianceDims(it), tone, count: 1 });
  }
  return { title: doc.title, floors, rooms: est.floors.flatMap((f) => f.rooms), ac: est.ac, appliances: est.appliances, furniture: [...furn.values()], totals: est.totals };
}

export function renderSpec(sp, date = new Date().toLocaleDateString('ko-KR')) {
  const t = sp.totals, sec = (title, ...kids) => h('section', { class: 'pl-est-sec' }, h('h3', {}, title), ...kids);
  const none = (s) => h('p', { class: 'pl-est-none' }, s);
  return h('div', { class: 'pl-est pl-spec' },
    h('dl', { class: 'pl-est-sum' }, [['도면', sp.title], ['작성일', date], ['층', `${sp.floors.length}개`], ['방', `${t.rooms}개`], ['실면적', `${f2(t.areaM2)} ㎡`]].map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
    sec('1. 층·마감', table('층별 마감과 높이', ['층', '바닥 마감', '벽 마감', '층 높이 mm', '슬래브 mm'], sp.floors.map((f) => [f.name, f.floor, f.wall, f.heightMm, f.slabMm]), null, 3)),
    sec('2. 방', sp.rooms.length ? table('방별 실면적', ['층', '방', '실면적 ㎡'], sp.rooms.map((r) => [r.floor, r.name, f2(r.areaM2)]), ['합계', '', f2(t.areaM2)], 2) : none('방이 없습니다')),
    sec('3. 에어컨', sp.ac.length ? table('에어컨 사양', ['층', '브랜드', '모델명', '형식', '냉방 kW', '수량'], sp.ac.map((g) => [g.floor, BRAND_LABEL[g.brand] ?? g.brand, g.code || UNKNOWN, MODEL_LABEL[g.type] ?? g.type, g.capacityKw ?? UNKNOWN, g.count]), ['합계', '', '', '', '', t.acCount], 4) : none('놓은 에어컨이 없습니다')),
    sec('4. 가전', sp.appliances.length ? table('가전 사양', ['층', '분류', '브랜드', '모델명', '가로×깊이×높이 mm', '수량'], sp.appliances.map((g) => [g.floor, APPLIANCE_LABEL[g.category] ?? g.category, BRAND_LABEL[g.brand] ?? g.brand, g.model, g.dims, g.count]), ['합계', '', '', '', '', t.applianceCount], 5) : none('놓은 가전이 없습니다')),
    sec('5. 가구', sp.furniture.length ? table('가구 사양', ['층', '이름', '가로×깊이×높이 mm', '색', '수량'], sp.furniture.map((g) => [g.floor, g.name, g.dims, g.tone, g.count]), ['합계', '', '', '', t.furnitureCount], 4) : none('놓은 가구가 없습니다')));
}

// 창으로 연다 — ctx.openDialog. [인쇄·PDF] 는 plan.css 의 body.printing-spec 규칙이 시방서만 A4 로 남긴다
export async function openSpec(ctx) {
  ensureStyles();
  let fin = null; try { fin = await loadFinishes(); } catch { /* 마감 이름 대신 id */ }
  const doc = renderSpec(buildSpec(ctx.store.doc, fin));
  const page = h('style', {}, '@page { size: A4 portrait; margin: 14mm; }');   // 이름 붙인 @page 는 모달(맨 위 층)에 먹지 않아, 뒤에 오는 @page 로 A3 가로를 덮는다
  const mark = () => { document.body.classList.add('printing-spec'); document.head.append(page); }, unmark = () => { document.body.classList.remove('printing-spec'); page.remove(); };
  window.addEventListener('beforeprint', mark); window.addEventListener('afterprint', unmark);
  doc.append(h('div', { class: 'pl-est-act' }, h('button', { type: 'button', class: 'pl-est-dl', onclick: () => { mark(); window.print(); } }, '인쇄·PDF')));
  const d = ctx.openDialog('시방서', doc, { onclose: () => { window.removeEventListener('beforeprint', mark); window.removeEventListener('afterprint', unmark); unmark(); } });
  d.el.classList.add('ed-spec');
  return d;
}
