// 구인·구직 게시판 검사 — 실행: node tools/test-jobs-board.js
// board-free.js를 격리 VM에서 board_type만 바꿔 실행한다. 계정·네트워크를 쓰지 않는다.
//
// 확인하는 것:
//   1. 구인 글 등록이 board_type=job_offer 로 나가고 review_kind를 붙이지 않는다.
//      (DB 제약이 review/tip만 받으므로 kind를 붙이면 등록이 통째로 거부된다)
//   2. 목록 조회가 job_offer만 걸러 온다 — 자유게시판 글이 섞이지 않는다.
//   3. 후기 전용 UI(수료 시점 필터·금액 입력)가 구인·구직에는 나오지 않는다.
//   4. 마감된 글이 목록·상세에 마감으로 표시된다.
//   5. 본인 글에만 마감 버튼이 있고, 누르면 closed_at만 바뀐다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'board', 'board-free.js'), 'utf8');

function makeRow(over) {
  return Object.assign({
    id: 11, board_type: 'job_offer', title: '타일 기공 구합니다', body: '서울 · 타일 · 조건 협의',
    status: 'open', status_reason: null, admin_answer: null, admin_answered_at: null,
    created_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-10T00:00:00Z', view_count: 2,
    is_anonymous: false, ref_type: null, ref_id: null,
    review_kind: null, review_cost: null, review_subsidy: null, review_done_month: null,
    closed_at: null, is_mine: true, author_nick: 'ㅇㅇ', author_field: 'tile', author_role: 'member'
  }, over);
}

function run({ boardType, search, rows, mine }) {
  const calls = { filters: [], inserted: null, updated: null };
  const panel = { innerHTML: '', querySelectorAll: () => [], addEventListener() {} };
  const els = {};
  const el = (id) => (els[id] || (els[id] = {
    innerHTML: '', textContent: '', value: '', hidden: false, checked: false,
    addEventListener(t, f) { this['on' + t] = f; }, querySelectorAll: () => [],
    classList: { add() {}, remove() {} }, focus() {}
  }));
  const handlers = {};

  const table = (name) => {
    const q = {
      select: () => q, order: () => q, limit: () => q, in: () => q, or: () => q,
      eq(col, val) { calls.filters.push([name, col, val]); return q; },
      insert(row) { calls.inserted = row; return q; },
      update(row) { calls.updated = row; return q; },
      delete: () => q, upsert: () => q, maybeSingle: () => q,
      then: (res) => Promise.resolve(res({
        data: name === 'v_posts' ? (rows || []) : [], error: null
      }))
    };
    return q;
  };

  const community = {
    readPosts: async (build, myId) => {
      const r = await build(table('v_posts').select('cols'), 'view');
      return { rows: (rows || []).map((x) => Object.assign({}, x, { is_mine: mine !== false })), mode: 'view' };
    },
    anonymousReady: () => true, isStaff: () => false,
    authorBadge: () => '작성자', authorBadgeOf: () => '작성자',
    authorSelect: () => 'nickname,field,role', timeAgo: () => '방금',
    maskContacts: (t) => t, subsidyLabel: () => null, report() {},
    SUBSIDY_LABELS: { none: '국비 없이 자비' }, loginWithKakao() {},
    requireMember: async () => ({ user: { id: 'u1' }, profile: { nickname: 'ㅇㅇ' } }),
    fetchTeaser: async () => []
  };

  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Promise, Object, Map, Set, Array, String, Number, Boolean, JSON, Date, RegExp,
    URLSearchParams, encodeURIComponent, setImmediate,
    escT: (v) => String(v == null ? '' : v),
    alert: () => {}, confirm: () => true,
    sessionStorage: { getItem: () => '1', setItem() {} },
    location: { href: 'http://x/edu/jobs/' + (search || ''), pathname: '/edu/jobs/',
                search: search || '', origin: 'http://x', reload() {} },
    document: { getElementById: (id) => (id === 'panel' ? panel : el(id)), querySelectorAll: () => [] },
    addEventListener: (t, f) => { handlers[t] = f; },
    ainAuth: { getClient: () => ({ from: table, rpc: () => Promise.resolve({ data: null, error: null }) }) },
    ainCommunity: community,
    AIN_BOARD: boardType ? { type: boardType } : undefined
  };
  ctx.window = ctx;
  vm.runInNewContext(SRC, ctx, { filename: 'board/board-free.js' });
  return { panel, el, calls, boot: () => handlers['DOMContentLoaded']() };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

(async () => {
  // 2·3. 목록 — job_offer만 걸러 오고 후기 UI는 없다
  {
    const a = run({ boardType: 'job_offer', rows: [makeRow()] });
    await a.boot(); await settle();
    const boardFilter = a.calls.filters.find((f) => f[1] === 'board_type');
    assert.deepStrictEqual(boardFilter, ['v_posts', 'board_type', 'job_offer'],
      '목록이 board_type=job_offer로 걸러지지 않았다: ' + JSON.stringify(a.calls.filters));
    assert.ok(a.panel.innerHTML.includes('타일 기공 구합니다'), '구인 글이 목록에 없다');
    assert.ok(!a.panel.innerHTML.includes('수료 시점'), '후기 전용 필터가 구인 목록에 나왔다');
    assert.ok(a.panel.innerHTML.includes('지역·공종'), '무엇을 적어야 하는지 안내가 없다');
  }

  // 구직도 같은 코드로
  {
    const b = run({ boardType: 'job_seek', rows: [] });
    await b.boot(); await settle();
    assert.deepStrictEqual(b.calls.filters.find((f) => f[1] === 'board_type'),
      ['v_posts', 'board_type', 'job_seek']);
    assert.ok(b.panel.innerHTML.includes('등록된 구직 글이 없습니다.'), '구직 빈 목록 문구가 아니다');
  }

  // 자유게시판은 그대로
  {
    const c = run({ rows: [] });
    await c.boot(); await settle();
    assert.deepStrictEqual(c.calls.filters.find((f) => f[1] === 'board_type'),
      ['v_posts', 'board_type', 'free'], 'AIN_BOARD 없으면 자유게시판이어야 한다');
    assert.ok(c.panel.innerHTML.includes('등록된 글이 없습니다.'));
  }

  // 1. 등록 — review_kind를 붙이지 않는다
  {
    const d = run({ boardType: 'job_offer', search: '?form=job_offer', rows: [] });
    await d.boot(); await settle();
    d.el('wTitle').value = '타일 기공 구합니다';
    d.el('wBody').value = '서울 중랑 · 타일 · 3개월';
    const form = d.el('writeForm');
    await form.onsubmit({ preventDefault() {} });
    await settle();
    const row = d.calls.inserted;
    assert.ok(row, '등록 요청이 나가지 않았다');
    assert.strictEqual(row.board_type, 'job_offer');
    assert.ok(!('review_kind' in row),
      'review_kind를 붙이면 DB 제약(review/tip)에 걸려 등록이 거부된다: ' + JSON.stringify(row));
    assert.ok(!('review_cost' in row) && !('review_done_month' in row), '후기 필드가 섞였다');
    assert.strictEqual(row.is_anonymous, false);
  }

  // 4. 마감 표시
  {
    const e = run({ boardType: 'job_offer', rows: [makeRow({ closed_at: '2026-09-10T01:00:00Z' })] });
    await e.boot(); await settle();
    assert.ok(e.panel.innerHTML.includes('마감'), '마감된 구인 글에 마감 표시가 없다');
  }

  // 5. 상세 — 본인 글에만 마감 버튼, 누르면 closed_at만 바뀐다
  {
    const f = run({ boardType: 'job_offer', search: '?id=11', rows: [makeRow()] });
    await f.boot(); await settle();
    assert.ok(f.panel.innerHTML.includes('id="closePost"'), '본인 구인 글에 마감 버튼이 없다');
    await f.el('closePost').onclick();
    await settle();
    assert.ok(f.calls.updated && f.calls.updated.closed_at, '마감 요청이 closed_at을 설정하지 않았다');
    assert.deepStrictEqual(Object.keys(f.calls.updated), ['closed_at'],
      '마감이 다른 열까지 건드렸다: ' + JSON.stringify(f.calls.updated));
  }
  {
    const g = run({ boardType: 'job_offer', search: '?id=11', rows: [makeRow()], mine: false });
    await g.boot(); await settle();
    assert.ok(!g.panel.innerHTML.includes('id="closePost"'), '남의 글에 마감 버튼이 나왔다');
    assert.ok(g.panel.innerHTML.includes('id="repPost"'), '남의 글에 신고 버튼이 없다');
  }
  // 자유게시판 글에는 마감 버튼이 없다
  {
    const h = run({ search: '?id=11', rows: [makeRow({ board_type: 'free', title: '질문' })] });
    await h.boot(); await settle();
    assert.ok(!h.panel.innerHTML.includes('id="closePost"'), '자유게시판 글에 마감 버튼이 나왔다');
  }

  console.log('jobs-board OK — board_type 분리 · review_kind 미부착 · 마감 표시/권한');
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
