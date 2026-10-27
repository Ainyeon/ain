// 적대적 입력 렌더 검사 — 실행: node tools/test-escape-contract.js
// 다른 렌더 테스트는 escT 를 항등 함수(escT: v => String(v))로 대신 끼워서, 화면 코드에서 escT 를 지워도 통과한다.
// 여기서는 ain-common.js 의 진짜 escT 와 진짜 ain-community.js 를 쓰고, 회원·수집 데이터에 날 태그를 넣어
// 게시판·제안·관리자·교육·입주정보 화면이 그것을 글자로 보여 주는지(날 태그가 새지 않는지)를 본다.
// 실제 계정·브라우저·네트워크를 쓰지 않는다. 각 화면 스크립트를 격리 VM 에서 그대로 실행한다.
//
// 일부러 하지 않는 것: status 에 적대 값을 넣지 않는다 — 상태 라벨은 DB CHECK 제약이 값을 막는다는 전제라
//   board-proposal.js 의 폴백 `(STATUS_LABELS[s] || s)` 는 이스케이프하지 않는다(현재 도달 불가).
//   education.json 의 내용에 기대는 단언은 없다(적대 행이 화면에 새는지만 본다).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// 진짜 escT: ain-common.js 의 한 줄 정의를 잘라 쓴다(복사본을 두지 않는다)
const COMMON = read('assets', 'js', 'ain-common.js');
const escLine = COMMON.match(/const escT=.*;/);
if (!escLine) throw new Error('ain-common.js 에서 escT 한 줄 정의를 찾지 못했다 — 정의를 옮겼다면 이 테스트의 추출 줄을 고칠 것');
const escT = new Function(escLine[0] + ';return escT;')();
const sourceUrlKey = new Function('URL', COMMON.slice(COMMON.indexOf('function sourceUrlKey'), COMMON.indexOf('  window.escT')) + '; return sourceUrlKey;')(URL);

const X = '"><img src=x onerror=alert(1)>';
const Y = "'><svg onload=alert(1)>";
const leaked = (html) => /<img src=x onerror|<svg onload|<script/i.test(html);
const shown = (html) => html.includes('&lt;img src=x onerror=alert(1)&gt;');
const context = (html) => (html.match(/.{40}(<img src=x onerror|<svg onload|<script).{20}/i) || [''])[0];
const settle = async () => { for (let i = 0; i < 14; i++) await new Promise((r) => setImmediate(r)); };
function check(name, html, extraRaw) {
  assert.ok(html.length > 100, name + ': 화면이 비었다');
  assert.ok(!leaked(html), name + ': 날 태그가 새어 나왔다 → ' + context(html));
  assert.ok(shown(html), name + ': 입력이 글자로 보이지 않는다(이스케이프 흔적 없음)');
  for (const raw of extraRaw || []) assert.ok(!html.includes(raw), name + ': 속성 값에 날 따옴표가 새었다 → ' + raw);
  console.log('ok -', name);
}

// ── 0. 진짜 escT 단위 — 속성 안에서도 안전하려면 따옴표 둘 다 바꿔야 한다 ──
assert.strictEqual(escT('<&>"\''), '&lt;&amp;&gt;&quot;&#39;', 'escT 가 5개 문자를 모두 바꾸지 않는다');
assert.ok(!/[<>"']/.test(escT(X + Y)), 'escT 결과에 날 < > " \' 가 남았다');

const el = (extra) => Object.assign({ innerHTML: '', textContent: '', value: '', hidden: false, checked: false, dataset: {},
  addEventListener() {}, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} }, focus() {}, getAttribute: () => '' }, extra || {});
const BASE = { console: { log() {}, warn() {}, error() {} }, Promise, Object, Map, Set, Array, String, Number, Boolean, JSON, Date, RegExp, Math, Intl,
  URLSearchParams, URL, encodeURIComponent, setImmediate, setTimeout, sourceUrlKey, escT, alert() {}, confirm: () => true };
const query = (rows) => { const q = { select: () => q, order: () => q, limit: () => q, in: () => q, or: () => q, eq: () => q, gte: () => q, delete: () => q,
  then: (res) => Promise.resolve(res({ data: rows, error: null })) }; return q; };

// 진짜 ain-community.js 를 올리고 읽기·게이트만 바꾼다(authorBadge·maskContacts 같은 렌더 보조는 진짜를 쓴다)
function loadCommunity(ctx, over) {
  vm.runInNewContext(read('assets', 'js', 'ain-community.js'), ctx, { filename: 'ain-community.js' });
  Object.assign(ctx.ainCommunity, over);
}

// ── 1. 자유게시판·제안 ──
function board(file, { search, rows, cmts }) {
  const panel = el(); const handlers = {};
  const ctx = Object.assign({}, BASE, {
    sessionStorage: { getItem: () => '1', setItem() {} },
    location: { href: 'http://x/', pathname: '/board/free/', search: search || '', origin: 'http://x', reload() {} },
    document: { getElementById: (id) => (id === 'panel' ? panel : el()), querySelectorAll: () => [] },
    addEventListener: (t, f) => { handlers[t] = f; },
    ainAuth: { getClient: () => ({ from: (n) => query(n === 'comments' ? (cmts || []) : []), rpc: () => Promise.resolve({ data: null, error: null }) }) }
  });
  ctx.window = ctx;
  loadCommunity(ctx, { readPosts: async () => ({ rows, mode: 'view' }),
    requireMember: async () => ({ user: { id: 'u1' }, profile: { nickname: 'me' } }), anonymousReady: () => true });
  vm.runInNewContext(read(...file), ctx, { filename: file.join('/') });
  return { panel, boot: () => handlers['DOMContentLoaded']() };
}
const post = (over) => Object.assign({ id: 5, board_type: 'free', title: X, body: X + Y, status: 'open',
  status_reason: X, admin_answer: X, admin_answered_at: null, created_at: '2026-09-10T00:00:00Z', view_count: 1,
  is_anonymous: false, review_kind: 'review', review_done_month: '2026-01', review_cost: 1, review_subsidy: null,
  closed_at: null, is_mine: true, author: { nickname: X, field: 'tile', role: 'member' } }, over || {});
const cmt = { id: 9, body: X, created_at: '2026-09-10T00:00:00Z', author_id: 'u2', author: { nickname: Y, field: 'tile', role: 'member' } };

// ── 2. 관리자 — 회원이 쓴 제목·댓글·닉네임이 운영자 화면으로 들어가는 가장 위험한 싱크 ──
function admin() {
  const html = read('admin', 'board', 'index.html');
  const src = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const panel = el(); const handlers = {};
  const rows = [{ id: 1, board_type: 'proposal', title: X, status: 'held', status_reason: X, admin_answer: X, is_anonymous: false, created_at: '2026-09-01T00:00:00Z' }];
  const table = (n) => query(n === 'reports' ? [{ target_type: 'post', target_id: 1 }, { target_type: 'comment', target_id: 2 }]
    : n === 'comments' ? [{ id: 2, post_id: 1, body: X, author: { nickname: X } }] : []);
  const ctx = Object.assign({}, BASE, { prompt: () => '1', sessionStorage: { getItem: () => '1', setItem() {} },
    ainAuth: { getClient: () => ({ from: table, rpc: () => Promise.resolve({ data: [], error: null }) }), init() {} },
    document: { getElementById: (id) => (id === 'panel' ? panel : el()), querySelectorAll: () => [] },
    addEventListener: (t, f) => { handlers[t] = f; }, location: { pathname: '/admin/board/', search: '' } });
  ctx.window = ctx;
  loadCommunity(ctx, { getMyProfile: async () => ({ user: { id: 'a' }, profile: { role: 'admin', nickname: 'A' } }), readPosts: async () => ({ rows, mode: 'view' }) });
  vm.runInNewContext(src, ctx, { filename: 'admin/board/index.html' });
  return { panel, boot: () => handlers['DOMContentLoaded']() };
}

// ── 3. 교육 — 원장은 그대로 두고 적대 수집 행 1개와 적대 후기 1개를 더한다 ──
const LEDGER = JSON.parse(read('assets', 'data', 'education.json'));
const EDU_ROW = { notice_id: 'AUTO-X-1', org: X, record_type: '모집회차', title: X, detail_url: 'https://ex.test/a"b?x=1',
  list_url: 'https://ex.test/l"x', posted_raw: X, region_code: X, apply_end_at: '2099-12-11T18:00:00+09:00', status: 'active', parse_status: 'ok',
  parse_note: X, checked_at: X, verified_by: X,
  fields: { course_class: X, schedule_raw: X, apply_end_raw: X, cost_raw: X, capacity_raw: X, target_raw: X, region_raw: X, work_codes: [X],
    conflicts: [{ kind: 'date', text: X }],
    images: [{ url: 'https://cdn.test/a"onerror="alert(1).jpg', alt: X, use: { state: 'allowed', verified_at: X } }] } };
function edu(search, reviews) {
  const panel = el(); const handlers = {}; const els = {};
  const ctx = Object.assign({}, BASE, {
    sessionStorage: { getItem: () => '1', setItem() {} },
    location: { href: 'http://x/edu/' + search, pathname: '/edu/', search, origin: 'http://x' }, history: { replaceState() {} },
    fetch: async () => ({ json: async () => JSON.parse(JSON.stringify(LEDGER)) }),
    document: { getElementById: (id) => (id === 'eduPanel' ? panel : (els[id] || (els[id] = el()))), querySelectorAll: () => [] },
    addEventListener: (t, f) => { handlers[t] = f; },
    ainAuth: { getClient: () => ({ from: () => query([EDU_ROW]), rpc: () => Promise.resolve({ data: null, error: null }) }),
      getSession: async () => (reviews ? { user: { id: 'u1' } } : null) },
    ainEduLogic: require(path.join(ROOT, 'edu', 'edu-logic.js'))
  });
  ctx.window = ctx;
  loadCommunity(ctx, { readPosts: async () => ({ rows: reviews || [], mode: 'view' }), savesReady: () => false, loadSaves: async () => null });
  vm.runInNewContext(read('edu', 'edu.js'), ctx, { filename: 'edu/edu.js' });
  return { panel, boot: () => handlers['DOMContentLoaded']() };
}

// ── 4. 입주정보 ──
const NOTICE = { id: 'n"1', title: X, region_raw: X, host: X, households: X, posted_raw: X, apply_end_raw: X, move_in_raw: X, event_raw: X, status_label: X,
  after_deadline_raw: X, requirements: [{ label: X, count: 1, lines: [X] }], unknowns: X, scope_note: X, url: 'https://ex.test/"x', url_image: 'https://ex.test/i"x', deadline_passed: false };
const RECRUIT = { notice_id: 'AUTO-R"1', org: X, record_type: '모집회차', title: X, detail_url: 'https://ex.test/r"x', posted_raw: X, region_code: X, apply_end_at: null, status: 'active',
  parse_status: 'partial', parse_note: X, checked_at: X, verified_by: X, fields: { apply_end_raw: X, target_raw: X, conflicts: [{ text: X }] } };
const COMPLEX = { id: 7, complex_name_raw: X, complex_name_ad: X, sido: X, sigungu: X, stage: X, expected_move_in: '2099-12-01' };
function area(search, session) {
  const panel = el(); const handlers = {}; const els = {};
  const table = (n) => query({ v_recruit_list: [RECRUIT], move_in_complexes: [COMPLEX], v_stat_movein: [{ tracking_count: 3 }],
    notice_complexes: [{ notice_id: 'n"1', complex_name: X }],
    move_in_teaser: [{ region: 'METRO', sido: X, sigungu: X, move_in_month: X, stage: X, total_count: 1 }] }[n] || []);
  const ctx = Object.assign({}, BASE, { confirm: () => false,
    location: { href: 'http://x/area/' + search, pathname: '/area/', search, origin: 'http://x' }, history: { replaceState() {} },
    fetch: async () => ({ json: async () => ({ items: [NOTICE], checked_at: X }) }),
    document: { getElementById: (id) => (id === 'areaPanel' ? panel : (els[id] || (els[id] = el()))), querySelectorAll: () => [], activeElement: null },
    addEventListener: (t, f) => { handlers[t] = f; },
    ainAuth: { getClient: () => ({ from: table }), getSession: async () => session },
    ainCommunity: { savesReady: () => true, saveKey: (t, i) => t + ':' + i, loadSaves: async () => new Map(), loginWithKakao() {} } });
  ctx.window = ctx;
  vm.runInNewContext(read('area', 'area.js'), ctx, { filename: 'area/area.js' });
  return { panel, boot: () => handlers['DOMContentLoaded']() };
}

(async () => {
  const S = { user: { id: 'u1' } };
  const REVIEW = post({ id: 8, ref_type: 'edu', ref_id: LEDGER.items[0].id, board_type: 'free', status: 'open' });
  const cases = [
    ['자유게시판 목록(제목·닉네임·과정 ref)', () => board(['board', 'board-free.js'], { search: '?ref=edu:' + encodeURIComponent(X), rows: [post()] })],
    ['자유게시판 상세(제목·본문·수정폼·댓글)', () => board(['board', 'board-free.js'], { search: '?id=5', rows: [post()], cmts: [cmt] })],
    ['제안 목록', () => board(['board', 'board-proposal.js'], { rows: [post({ board_type: 'proposal' })] })],
    ['제안 상세(상태 이유·운영자 답변·의견)', () => board(['board', 'board-proposal.js'], { search: '?id=5', rows: [post({ board_type: 'proposal' })], cmts: [cmt] })],
    ['관리자 글·신고·댓글 목록', admin],
    ['교육 목록', () => edu('')],
    ['교육 상세(자동 수집 딥링크)', () => edu('?id=AUTO-X-1'), ['ex.test/a"b', 'ex.test/l"x', 'cdn.test/a"onerror="alert(1)']],
    ['교육 상세(과정 후기 목록: 제목·작성자)', () => edu('?id=' + encodeURIComponent(LEDGER.items[0].id), [REVIEW])],
    ['입주 단지(회원)', () => area('', S)],
    ['입주 단지(비회원 티저)', () => area('?region=NATION', null)],
    ['저장 단지 딥링크(회원)', () => area('?complex=7', S)],
    ['모집 공고(회원)', () => area('?tab=notice', S), ['ex.test/"x', 'ex.test/i"x', 'ex.test/r"x']]
  ];
  for (const [name, make, raw] of cases) {
    const w = make();
    await w.boot(); await settle();
    check(name, w.panel.innerHTML, raw);
  }
  console.log('escape-contract OK — 진짜 escT 로 ' + cases.length + '개 화면에 적대 입력을 넣어도 날 태그·속성 탈출이 없다');
})().catch((e) => { console.error(e.message); process.exit(1); });
