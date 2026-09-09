// 로그아웃 경합 회귀 검사 — 실행: node tools/test-auth-race.js
// 실제 계정·브라우저·네트워크를 쓰지 않는다. edu.js / area.js를 격리 VM에서 실행해,
// 로그아웃 뒤 늦게 끝난 이전 회원 요청이 회원 상태를 되살리지 못하는지 확인한다.
// (원 재현: /tmp/ain-launch-20260909.8y9g7lku/check-auth-race.cjs)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const tick = () => new Promise((r) => setImmediate(r));
const ROOT = path.join(__dirname, '..');

function makeCtx(extra) {
  const el = { innerHTML: '', textContent: '', value: '', hidden: false, classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => null };
  const ctx = Object.assign({
    console, URLSearchParams, Intl, Date, Map, Set, Promise, JSON, Math, Object, Array, Number, String, RegExp,
    location: { search: '', pathname: '/', origin: 'http://x' },
    history: { replaceState() {} },
    fetch: async () => ({ json: async () => ({ items: [], counts: {}, checked_at: '' }) }),
    escT: (v) => String(v == null ? '' : v),
    document: { getElementById: () => el, querySelectorAll: () => [] },
    setTimeout, clearTimeout
  }, extra);
  ctx.window = ctx;
  return ctx;
}

function load(file, ctx, expose) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\}\)\(\);\s*$/, 'globalThis.__state = () => (' + expose + ');\n})();');
  vm.runInNewContext(src, ctx, { filename: file });
  return () => ctx.__state();
}

(async () => {
  // ── edu.js ── 로그아웃 뒤 늦게 끝난 readPosts가 refCounts를 되살리면 안 된다
  let finishOld;
  const oldRequest = new Promise((r) => { finishOld = r; });
  let loggedIn = true;
  const handlers = {};
  const eduCtx = makeCtx({
    addEventListener: (t, f) => { handlers[t] = f; },
    ainEduLogic: {},
    ainAuth: { getSession: async () => (loggedIn ? { user: { id: 'u1' } } : null) },
    ainCommunity: {
      loadSaves: async () => (loggedIn ? new Map() : null),
      readPosts: () => oldRequest
    }
  });
  const eduState = load('edu/edu.js', eduCtx, '{refCounts, saves}');

  handlers['ain:auth']({ detail: { session: { user: { id: 'u1' } } } });
  await tick();
  loggedIn = false;
  handlers['ain:auth']({ detail: { session: null } });
  await tick();
  assert.strictEqual(eduState().refCounts, null, '로그아웃 즉시 refCounts가 비어야 한다');
  assert.strictEqual(eduState().saves, null, '로그아웃 즉시 saves가 비어야 한다');

  finishOld({ mode: 'view', rows: [{ ref_id: 'EDU-1', board_type: 'free' }] });
  await tick(); await tick();
  assert.strictEqual(eduState().refCounts, null, '로그아웃 뒤 옛 응답이 refCounts를 되살리면 안 된다');
  assert.strictEqual(eduState().saves, null, '로그아웃 뒤 옛 응답이 saves를 되살리면 안 된다');

  // ── area.js ── 같은 경로: 늦게 끝난 단지명 조회가 비회원 화면에 값을 되살리면 안 된다
  let finishNames;
  const namesRequest = new Promise((r) => { finishNames = r; });
  const aHandlers = {};
  let aLoggedIn = true;
  // 공고 단지명 조회만 늦게 끝나게 하고, 나머지 쿼리는 즉시 빈 결과로 답한다
  const empty = Promise.resolve({ data: [], error: null });
  const q = {
    select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => empty,
    in: () => namesRequest,
    then: (res) => empty.then(res)
  };
  const areaCtx = makeCtx({
    addEventListener: (t, f) => { aHandlers[t] = f; },
    ainAuth: { getSession: async () => (aLoggedIn ? { user: { id: 'u1' } } : null) },
    ainCommunity: {
      loadSaves: async () => (aLoggedIn ? new Map() : null),
      savesReady: () => true, saveKey: (t, i) => t + ':' + i
    }
  });
  areaCtx.ainAuth.getClient = () => ({ from: () => q });
  const areaState = load('area/area.js', areaCtx, '{noticeNames, saves}');

  aHandlers['ain:auth']({ detail: { session: { user: { id: 'u1' } } } });
  await tick();
  aLoggedIn = false;
  aHandlers['ain:auth']({ detail: { session: null } });
  await tick();
  assert.strictEqual(areaState().noticeNames, 'anon', '로그아웃 즉시 단지명 상태가 비회원으로 돌아가야 한다');

  finishNames({ data: [{ notice_id: 'N1', complex_name: '어느 단지' }], error: null });
  await tick(); await tick();
  assert.strictEqual(areaState().noticeNames, 'anon', '로그아웃 뒤 옛 응답이 단지명을 되살리면 안 된다');
  assert.strictEqual(areaState().saves, null);

  // ── area render 세대 ── 늦게 끝난 단지 조회가 최신 화면을 덮지 않는다
  //    (noticeNames loader와는 다른 요청 경로다)
  let finishComplex;
  const complexRequest = new Promise((r) => { finishComplex = r; });
  const rHandlers = {};
  let rLoggedIn = true;
  let firstComplexCall = true;
  const rq = {
    select: () => rq, eq: () => rq, gte: () => rq, order: () => rq,
    in: () => Promise.resolve({ data: [], error: null }),
    limit: () => {
      if (firstComplexCall) { firstComplexCall = false; return complexRequest; }   // 회원 조회를 늦춘다
      return Promise.resolve({ data: [], error: null });
    },
    then: (res) => Promise.resolve({ data: [], error: null }).then(res)
  };
  const panelEl = { innerHTML: '', querySelectorAll: () => [], addEventListener() {} };
  const rCtx = makeCtx({
    addEventListener: (t, f) => { rHandlers[t] = f; },
    document: {
      getElementById: (id) => (id === 'areaPanel' ? panelEl
        : { innerHTML: '', textContent: '', value: '', addEventListener() {},
            querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} } }),
      querySelectorAll: () => []
    },
    ainAuth: { getSession: async () => (rLoggedIn ? { user: { id: 'u1' } } : null), getClient: () => ({ from: () => rq }) },
    ainCommunity: {
      loadSaves: async () => (rLoggedIn ? new Map() : null),
      savesReady: () => true, saveKey: (t, i) => t + ':' + i
    }
  });
  load('area/area.js', rCtx, '{noticeNames}');

  rHandlers['ain:auth']({ detail: { session: { user: { id: 'u1' } } } });
  await tick();
  rLoggedIn = false;
  rHandlers['ain:auth']({ detail: { session: null } });
  await tick(); await tick();
  const afterLogout = panelEl.innerHTML;
  // 로그인 시절 단지 조회가 이제야 끝난다
  finishComplex({ data: [{ id: 1, complex_name_ad: '회원만 보이는 단지', sido: '경기', sigungu: '수원시',
    stage: 'D-30 ~ 입주', expected_move_in: '2026-10-01' }], error: null });
  await tick(); await tick();
  assert.ok(!panelEl.innerHTML.includes('회원만 보이는 단지'),
    '로그아웃 뒤 옛 회원 단지 조회가 화면을 덮으면 안 된다');
  assert.strictEqual(panelEl.innerHTML, afterLogout, '늦은 응답이 최신 렌더 결과를 바꾸면 안 된다');

  console.log('auth-race OK — edu/area 상태 복원 차단 + area 렌더 세대 가드');
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
