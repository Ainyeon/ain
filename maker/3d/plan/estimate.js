// 견적 물량표 — 현재 문서의 에어컨(모델·kW·수량)·가전(분류·모델·치수·수량)·방 면적·벽 길이·개구부 수를 표로 보이고 CSV 로 내려받는다(가격 없음, 없는 값은 '미확인'). 집계(buildEstimate)와 CSV(toCsv)는 DOM 없이 node 로 시험한다.
import { grossWallLen, netWallLen, roomAreaM2 } from './core/geom.js';
import { APPLIANCE_CATEGORIES, APPLIANCE_LABEL } from './core/model.js';
import { h, ensureStyles, MODEL_LABEL, BRAND_LABEL } from './panels.js';

const UNKNOWN = '미확인';
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000; // kW 합의 부동소수 잡음 정리(원문 값은 소수 둘째 자리까지)
const f2 = (v) => r2(v).toFixed(2); // 길이(m)·면적(㎡)은 소수 둘째 자리로 맞춰 적는다
const m = (mm) => f2(mm / 1000);
// 가전 치수 글자 — 가로×깊이×높이(mm). 문서에 있는 숫자 그대로(반올림·환산 없음)
export const applianceDims = (it) => `${it.size[0]}×${it.size[1]}×${it.heightMm}`;

// 문서 → 집계. 방 면적은 안쪽 면 실면적을 방마다 소수 둘째 자리로 맺은 값(toSpaceJSON 의 area_m2 와 같다), 층 합은 그 값들의 합
export function buildEstimate(doc) {
  const floors = doc.floors.map((f, i) => {
    const view = { ...doc, cur: i }, groups = new Map();
    const apps = new Map();
    for (const it of f.items) {
      if (it.kind === 'appliance') { // 가전은 에어컨 합계 kW 에 섞지 않는다 — 분류·브랜드·모델·치수가 같은 것끼리 묶는다
        const k = [it.category, it.brand, it.model, applianceDims(it)].join('|'), g = apps.get(k);
        if (g) g.count++;
        else apps.set(k, { floor: f.name, category: it.category, brand: it.brand, model: it.model, name: it.name, dims: applianceDims(it), count: 1 });
        continue;
      }
      const k = [it.brand, it.code, it.model, it.capacityKw].join('|'), g = groups.get(k);
      if (g) g.count++;
      else groups.set(k, { floor: f.name, brand: it.brand, code: it.code, type: it.model, capacityKw: it.capacityKw, count: 1 });
    }
    const appliances = [...apps.values()].sort((a, b) => APPLIANCE_CATEGORIES.indexOf(a.category) - APPLIANCE_CATEGORIES.indexOf(b.category) || a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model, 'ko', { numeric: true }) || a.dims.localeCompare(b.dims));
    const ac = [...groups.values()].sort((a, b) => a.brand.localeCompare(b.brand) || a.code.localeCompare(b.code, 'ko', { numeric: true }) || a.type.localeCompare(b.type) || (a.capacityKw ?? 0) - (b.capacityKw ?? 0))
      .map((g) => ({ ...g, kwSum: g.capacityKw === null ? null : r3(g.capacityKw * g.count) }));
    const rooms = f.rooms.map((r) => ({ floor: f.name, name: r.name, areaM2: r2(roomAreaM2(view, r)) }));
    const op = { door: 0, window: 0, open: 0 };
    for (const o of f.openings) op[o.type]++;
    return { id: f.id, name: f.name, ac, appliances, rooms, areaM2: r2(rooms.reduce((s, r) => s + r.areaM2, 0)), walls: f.walls.length, grossMm: grossWallLen(view), netMm: netWallLen(view), openings: { ...op, total: f.openings.length } };
  });
  const ac = floors.flatMap((f) => f.ac), appliances = floors.flatMap((f) => f.appliances), known = ac.filter((g) => g.capacityKw !== null);
  const sum = (k) => floors.reduce((s, f) => s + f[k], 0);
  return {
    title: doc.title, floors, ac, appliances,
    totals: {
      acCount: ac.reduce((s, g) => s + g.count, 0), applianceCount: appliances.reduce((s, g) => s + g.count, 0), kwSum: r3(known.reduce((s, g) => s + g.kwSum, 0)), kwUnknown: ac.filter((g) => g.capacityKw === null).reduce((s, g) => s + g.count, 0),
      rooms: floors.reduce((s, f) => s + f.rooms.length, 0), areaM2: r2(sum('areaM2')), walls: sum('walls'), grossMm: sum('grossMm'), netMm: sum('netMm'),
      openings: floors.reduce((s, f) => s + f.openings.total, 0),
    },
  };
}

// CSV 한 칸 — 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 따옴표는 둘로. 글자 칸이 = + - @ 탭으로 시작하면 엑셀이 식으로 읽지 않게 앞에 ' 를 붙인다(숫자는 그대로)
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const csvLine = (cells) => cells.map(csvCell).join(',');

const acRow = (g) => [g.floor, BRAND_LABEL[g.brand] ?? g.brand, g.code || UNKNOWN, MODEL_LABEL[g.type] ?? g.type, g.capacityKw === null ? UNKNOWN : g.capacityKw, g.count, g.kwSum === null ? UNKNOWN : g.kwSum];
const AC_HEAD = ['층', '브랜드', '모델명', '형식', '냉방 kW', '수량', '합계 kW'];
const APP_HEAD = ['층', '분류', '브랜드', '모델명', '제품명', '가로×깊이×높이 mm', '수량'];
const noName = (r) => r.filter((_, i) => i !== 4); // 화면 표는 좁아서 제품명 칸을 뺀다(CSV 에는 있다)
const appRow = (g) => [g.floor, APPLIANCE_LABEL[g.category] ?? g.category, BRAND_LABEL[g.brand] ?? g.brand, g.model, g.name || UNKNOWN, g.dims, g.count];
const ROOM_HEAD = ['층', '방', '실면적 ㎡'];
const WALL_HEAD = ['층', '벽 수', '벽 총 길이 m', '개구부 제외 길이 m', '문', '창', '개방', '개구부 합'];
const wallRow = (f) => [f.name, f.walls, m(f.grossMm), m(f.netMm), f.openings.door, f.openings.window, f.openings.open, f.openings.total];
const kwTotal = (t) => (t.kwUnknown && t.kwSum === 0 ? UNKNOWN : t.kwSum); // 확인된 kW 가 하나도 없으면 0 이 아니라 미확인
const wallFoot = (est) => ['합계', est.totals.walls, m(est.totals.grossMm), m(est.totals.netMm), ...['door', 'window', 'open', 'total'].map((k) => est.floors.reduce((s, f) => s + f.openings[k], 0))];
const kwNote = (t) => `kW 를 확인할 수 없는 ${t.kwUnknown}대는 합계 kW 에 들어가지 않습니다`;

export function toCsv(est) {
  const t = est.totals, rows = [
    ['도면', est.title], [],
    ['에어컨'], AC_HEAD, ...est.ac.map(acRow), ['합계', '', '', '', '', t.acCount, kwTotal(t)], ...(t.kwUnknown ? [['비고', kwNote(t)]] : []), [],
    ['가전'], APP_HEAD, ...est.appliances.map(appRow), ['합계', '', '', '', '', '', t.applianceCount], [],
    ['방'], ROOM_HEAD, ...est.floors.flatMap((f) => f.rooms.map((r) => [r.floor, r.name, f2(r.areaM2)])), ['합계', '', f2(t.areaM2)], [],
    ['벽·개구부'], WALL_HEAD, ...est.floors.map(wallRow), wallFoot(est),
  ];
  return rows.map(csvLine).join('\r\n') + '\r\n';
}

// 파일 이름 — 운영체제가 못 쓰는 글자와 제어 문자는 '-', 앞뒤 공백·점은 걷고 60자까지
export function csvFileName(title) {
  const t = String(title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().replace(/^\.+|\.+$/g, '').slice(0, 60).trim();
  return `ain-물량-${t || '도면'}.csv`;
}

export function downloadCsv(est) {
  const url = URL.createObjectURL(new Blob(['﻿' + toCsv(est)], { type: 'text/csv;charset=utf-8' })); // BOM — 엑셀이 한글을 깨뜨리지 않게
  const a = h('a', { href: url, download: csvFileName(est.title) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url));
}

/* ---------- 화면 ---------- */
const td = (v, cls) => h('td', { class: cls }, String(v));
function table(caption, head, rows, foot, numFrom) {
  const cls = (i) => (i >= numFrom ? 'num' : '');
  return h('div', { class: 'pl-est-wrap', tabindex: '0', role: 'region', 'aria-label': caption }, h('table', {}, h('caption', { class: 'pl-vh' }, caption),   // 폰 폭에서 가로로 넘치는 표는 키보드로 밀 수 있어야 한다 — WebKit 은 넘치는 상자를 스스로 초점 대상으로 치지 않는다
    h('thead', {}, h('tr', {}, head.map((c, i) => h('th', { scope: 'col', class: cls(i) }, c)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c, i) => td(c, cls(i)))))),
    h('tfoot', {}, h('tr', {}, foot.map((c, i) => (i === 0 ? h('th', { scope: 'row' }, c) : td(c, cls(i))))))));
}

export function renderEstimate(est) {
  const t = est.totals, sec = (title, ...kids) => h('section', { class: 'pl-est-sec' }, h('h3', {}, title), ...kids);
  const sum = [['에어컨', `${t.acCount}대`], ['냉방 합계', t.kwUnknown && t.kwSum === 0 ? UNKNOWN : `${t.kwSum} kW`], ['가전', `${t.applianceCount}대`], ['방', `${t.rooms}개`], ['실면적', `${f2(t.areaM2)} ㎡`], ['벽 총 길이', `${m(t.grossMm)} m`], ['개구부', `${t.openings}개`]];
  return h('div', { class: 'pl-est' },
    h('dl', { class: 'pl-est-sum' }, sum.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
    sec('에어컨', est.ac.length ? table('에어컨 모델별 수량', AC_HEAD, est.ac.map(acRow), ['합계', '', '', '', '', t.acCount, kwTotal(t)], 4) : h('p', { class: 'pl-est-none' }, '놓은 에어컨이 없습니다'), t.kwUnknown ? h('p', { class: 'pl-est-note' }, kwNote(t)) : null),
    sec('가전', est.appliances.length ? table('가전 분류·모델별 수량', noName(APP_HEAD), est.appliances.map((g) => noName(appRow(g))), ['합계', '', '', '', '', t.applianceCount], 5) : h('p', { class: 'pl-est-none' }, '놓은 가전이 없습니다')),
    sec('방 면적 (실면적)', est.floors.some((f) => f.rooms.length) ? table('방별 실면적', ROOM_HEAD, est.floors.flatMap((f) => f.rooms.map((r) => [r.floor, r.name, f2(r.areaM2)])), ['합계', '', f2(t.areaM2)], 2) : h('p', { class: 'pl-est-none' }, '방이 없습니다')),
    sec('벽·개구부', table('층별 벽 길이와 개구부 수', WALL_HEAD, est.floors.map(wallRow), wallFoot(est), 1)),
    h('div', { class: 'pl-est-act' }, h('button', { type: 'button', class: 'pl-est-dl', onclick: () => downloadCsv(est) }, 'CSV 내려받기')));
}

// 대화창으로 연다 — ctx.openDialog(title, node). 현재 문서를 그 순간 집계한 표다
export function openEstimate(ctx) {
  ensureStyles();
  const est = buildEstimate(ctx.store.doc);
  ctx.openDialog('견적 물량표', renderEstimate(est));
  return est;
}
