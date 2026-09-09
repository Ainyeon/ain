// 관심 저장 → 다시 찾기 경로 검사 — 실행: node tools/test-saved-return.js
// 실제 계정·브라우저·네트워크를 쓰지 않는다.
//
// 지키는 것 (SPEC §2 / A2): 저장한 단지를 "다시 찾을" 수 있어야 한다.
// 내 활동 링크가 저장한 target_id를 버리면, 전국에서 저장한 단지는
// 수도권 기본 목록에 없어 영영 못 찾는다 — 화면은 정상으로 보여 알아채기 어렵다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ── 1) 내 활동 링크가 저장한 id를 담는가 (me/index.html의 실제 SAVE_KINDS를 잘라 평가) ──
const meHtml = fs.readFileSync(path.join(ROOT, 'me', 'index.html'), 'utf8');
const kindsSrc = meHtml.slice(meHtml.indexOf('    const SAVE_KINDS = {'), meHtml.indexOf('    const rowEl'));
const SAVE_KINDS = new Function(kindsSrc + '; return SAVE_KINDS;')();

const SAVED_ID = '4242';                       // 합성 NATION 단지의 저장 id
const href = SAVE_KINDS.complex.href(SAVED_ID);
assert.ok(href.includes(SAVED_ID), '저장한 단지 링크가 target_id를 버림: ' + href);
assert.ok(href.startsWith('/area/'), '기존 내 지역 페이지를 재사용해야 함: ' + href);
assert.strictEqual(SAVE_KINDS.edu.href('IDOEDU-C217'), '/edu/?id=IDOEDU-C217');

// ── 2) 목적지가 그 id로 좁혀 조회하는가 (area.js를 실제로 실행) ──
const complexParam = new URL('http://x' + href).searchParams.get('complex');
assert.strictEqual(complexParam, SAVED_ID);

const calls = [];
// 서버에 실제로 있는 행 (is_public은 서버가 들고 있고 응답에는 실리지 않는다)
const ROW = {
  id: Number(SAVED_ID), complex_name_ad: '합성 전국 단지', complex_name_raw: '합성 전국 단지',
  sido: '경남', sigungu: '창원시', stage: 'D-90 ~ D-31',
  expected_move_in: '2027-03-01'
};
let rowIsPublic = true;   // 공개 대상에서 빠지면 false

// 가짜 서버 — 요청한 필터를 실제로 적용하고, 선택한 열만 돌려준다.
// 프론트가 응답을 받은 뒤 거르는 방식이면 이 검사를 통과하지 못한다.
function query(table) {
  const rec = { table, filters: [] };
  calls.push(rec);
  const rows = () => {
    if (table !== 'move_in_complexes') return [];
    const server = Object.assign({}, ROW, { is_public: rowIsPublic });
    const ok = rec.filters.every(([k, v]) => String(server[k]) === String(v));
    if (!ok) return [];
    const keys = (rec.cols || '').split(',').map((c) => c.trim()).filter(Boolean);
    const out = {};
    keys.forEach((k) => { out[k] = server[k]; });
    return [out];
  };
  const q = {
    select(cols) { rec.cols = cols; return q; },
    eq(k, v) { rec.filters.push([k, v]); return q; },
    gte(k, v) { rec.filters.push([k, v]); return q; },
    order: () => q, in: () => q, delete: () => q, insert: () => q,
    limit: () => Promise.resolve({ data: rows(), error: null }),
    then: (res) => Promise.resolve({ data: [], error: null }).then(res)
  };
  return q;
}

function runArea(search, session) {
  const panel = { innerHTML: '', querySelectorAll: () => [], addEventListener() {} };
  const handlers = {};
  const ctx = {
    console, Promise, Object, Map, Set, Array, String, Number, Boolean, JSON, Date, RegExp, URLSearchParams,
    escT: (v) => String(v == null ? '' : v),
    location: { search, pathname: '/area/', origin: 'http://x' },
    history: { replaceState() {} },
    fetch: async () => ({ json: async () => ({ items: [], checked_at: '' }) }),
    setTimeout, clearTimeout,
    document: {
      getElementById: (id) => (id === 'areaPanel' ? panel : {
        innerHTML: '', textContent: '', value: '', addEventListener() {},
        querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} }
      }),
      querySelectorAll: () => []
    },
    addEventListener: (t, f) => { handlers[t] = f; },
    ainAuth: { getSession: async () => session, getClient: () => ({ from: (t) => query(t) }) },
    ainCommunity: {
      loadSaves: async () => (session ? new Map([['complex:' + SAVED_ID, {}]]) : null),
      savesReady: () => true, saveKey: (t, i) => t + ':' + i, loginWithKakao() {}
    }
  };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'area', 'area.js'), 'utf8'), ctx, { filename: 'area/area.js' });
  return { panel, boot: handlers['DOMContentLoaded'] };
}

const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  // 회원: 저장한 id로 좁혀 조회하고, 지역·공개·날짜 기본 필터로 탈락시키지 않는다
  calls.length = 0;
  let a = runArea('?complex=' + SAVED_ID, { user: { id: 'u1' } });
  await a.boot();
  for (let i = 0; i < 8; i++) await tick();

  const cq = calls.find((c) => c.table === 'move_in_complexes');
  assert.ok(cq, 'move_in_complexes를 조회하지 않음');
  // 공개 조건은 서버에서 걸어야 한다 — 비공개 단지명을 응답으로 받아 오면 안 된다
  assert.deepStrictEqual(cq.filters, [['id', SAVED_ID], ['is_public', true]],
    '저장 id + 공개 조건만 있어야 함(지역·날짜 필터 금지): ' + JSON.stringify(cq.filters));
  // 응답에 is_public을 실어 프론트에서 거르는 방식이 아니어야 한다
  assert.ok(!/is_public/.test(cq.cols || ''), 'is_public을 응답으로 받아 프론트에서 거르고 있음');
  assert.ok(a.panel.innerHTML.includes('합성 전국 단지'), '저장한 단지가 표시되지 않음');
  assert.ok(a.panel.innerHTML.includes('경남 창원시'));
  assert.ok(a.panel.innerHTML.includes('입주 예정 단지 전체 보기'), '전체 목록 복귀 링크 없음');

  // 비회원: 단지명을 노출하지 않고 로그인 안내 (검색부는 로그인 복귀에 보존됨)
  a = runArea('?complex=' + SAVED_ID, null);
  await a.boot();
  for (let i = 0; i < 8; i++) await tick();
  assert.ok(!a.panel.innerHTML.includes('합성 전국 단지'), '비회원에게 단지명이 노출됨');
  assert.ok(a.panel.innerHTML.includes('회원에게 공개'), '로그인 안내가 없음');

  // 공개 대상에서 빠진 단지: 서버가 0행을 주고, 단지명은 응답에 실리지 않는다
  rowIsPublic = false;
  calls.length = 0;
  a = runArea('?complex=' + SAVED_ID, { user: { id: 'u1' } });
  await a.boot();
  for (let i = 0; i < 8; i++) await tick();
  assert.ok(a.panel.innerHTML.includes('더 이상 볼 수 없습니다'), '사라진 단지 안내가 없음');
  assert.ok(!a.panel.innerHTML.includes('합성 전국 단지'), '비공개 단지명이 화면에 남음');
  assert.ok(a.panel.innerHTML.includes('data-save="complex|' + SAVED_ID + '"'), '저장 해제 수단이 없음');
  rowIsPublic = true;

  console.log('saved-return OK — 저장 id 보존 · id+공개조건만 서버 조회 · 비회원/비공개 단지명 비노출 · 0행 안내와 해제');
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
