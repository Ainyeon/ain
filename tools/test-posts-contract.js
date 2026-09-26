// readPosts 선택 열 계약 검사 — 실행: node tools/test-posts-contract.js
// 실제 계정·브라우저·네트워크를 쓰지 않는다.
//
// 왜 필요한가: v_posts에 열이 있어도 ain-community.js의 POST_COLS에서 빠지면
// PostgREST가 그 열을 내려보내지 않는다. 그러면 후기가 일반 글로 취급되고
// 교육 상세의 후기 건수가 늘 0이 된다 — 화면만 보면 "후기가 없다"로 읽혀 알아채기 어렵다.
//
// 검사 방식: POST_COLS를 복제해 비교하지 않는다. 가짜 클라이언트가 PostgREST처럼
// **요청한 열만 남겨서** 돌려주고, 그 결과에서 후기 메타가 살아 있는지 본다.
// 열이 빠지면 그 필드가 undefined가 되어 실패한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// v_posts가 실제로 내보내는 열. 뷰는 15에서 만들고 16(구인·구직)에서 열이 하나 늘어난다 —
// 마지막 정의를 기준으로 읽는다.
const sql15 = fs.readFileSync(path.join(ROOT, 'supabase', '15_launch.sql'), 'utf8');
const sql16 = fs.readFileSync(path.join(ROOT, 'supabase', '16_jobs_board.sql'), 'utf8');
const sql = sql16.includes('view public.v_posts as') ? sql16 : sql15;
const head = sql.indexOf('view public.v_posts as');
const viewBody = sql.slice(head, sql.indexOf('from public.posts p', head));
const VIEW_COLS = new Set(
  [...viewBody.matchAll(/(?:^|\s)(?:p\.)?([a-z_]+)(?:\s*$|,)/gm)].map((m) => m[1])
    .concat([...viewBody.matchAll(/as\s+([a-z_]+)/g)].map((m) => m[1]))
);

// 한 행이 통째로 있는 상태 — PostgREST가 요청한 열만 골라 준다고 가정한다
const FULL_ROW = {
  id: 7, board_type: 'free', title: '타일 기초 수강 후기', body: '도움 됐습니다',
  status: 'open', status_reason: null, admin_answer: null, admin_answered_at: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', view_count: 3,
  is_anonymous: false, ref_type: 'edu', ref_id: 'IDOEDU-C217',
  review_kind: 'review', review_cost: 22500, review_subsidy: 'card', review_done_month: '2026-08',
  is_mine: true, author_nick: 'ㅇㅇ', author_field: 'tile', author_role: 'member',
  closed_at: null
};

let requested = null;
function fakeQuery() {
  const q = {
    select(cols) { requested = cols; return q; },
    eq: () => q, or: () => q, order: () => q, limit: () => q,
    then: (res) => {
      const keys = requested.split(',').map((c) => c.trim()).filter(Boolean);
      // PostgREST처럼 요청한 열만 남긴다
      const row = {};
      keys.forEach((k) => { row[k] = FULL_ROW[k]; });
      return Promise.resolve(res({ data: [row], error: null }));
    }
  };
  return q;
}

const ctx = {
  console, Promise, Object, Map, Set, Array, String, Number, Boolean, JSON, Date, RegExp,
  escT: (v) => String(v == null ? '' : v),
  location: { href: 'http://x/', pathname: '/', search: '', origin: 'http://x' },
  ainAuth: {
    getClient: () => ({ from: () => fakeQuery(), auth: { signInWithOAuth: () => {} } }),
    getSession: async () => ({ user: { id: 'u1' } })
  }
};
ctx.window = ctx;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'ain-community.js'), 'utf8'),
  ctx, { filename: 'assets/js/ain-community.js' });

(async () => {
  const r = await ctx.ainCommunity.readPosts((q) => q.eq('board_type', 'free').limit(1), 'u1');
  assert.strictEqual(r.mode, 'view');
  const row = r.rows[0];

  // 요청한 열이 v_posts에 실제로 있는 열이어야 한다 (오타·존재하지 않는 열 방지)
  requested.split(',').map((c) => c.trim()).forEach((c) => {
    assert.ok(VIEW_COLS.has(c), 'v_posts에 없는 열을 요청함: ' + c);
  });

  // 후기 메타가 선택 결과에 살아 있어야 한다 — 하나라도 빠지면 undefined가 된다
  assert.strictEqual(row.review_kind, 'review', 'review_kind가 선택에서 빠짐 → 후기가 일반 글로 취급됨');
  assert.strictEqual(row.review_cost, 22500, 'review_cost가 선택에서 빠짐');
  assert.strictEqual(row.review_subsidy, 'card', 'review_subsidy가 선택에서 빠짐');
  assert.strictEqual(row.review_done_month, '2026-08', 'review_done_month가 선택에서 빠짐 → 수료 시점 필터가 무력화됨');

  // 익명·소유·연결 열도 함께 (v_posts 경유의 존재 이유)
  assert.strictEqual(row.is_mine, true);
  assert.strictEqual(row.is_anonymous, false);
  assert.strictEqual(row.ref_id, 'IDOEDU-C217');
  assert.strictEqual(row.author_nick, 'ㅇㅇ');
  // author_id는 절대 요청하지 않는다 (익명 보호)
  assert.ok(!requested.includes('author_id'), 'author_id를 요청하면 익명 보호가 깨진다');
  // 구인·구직 마감 표시도 같은 계약이다 — 빠지면 마감된 글이 열려 있는 것처럼 보인다
  assert.ok(Object.hasOwn(row, 'closed_at'), 'closed_at이 선택에서 빠짐 → 마감 표시가 화면에 오지 않음');

  // 실제 소비처가 이 행을 후기로 인식하는지 (edu 상세의 집계 조건과 같은 식)
  assert.strictEqual(row.review_kind === 'review', true, '교육 상세 후기 집계 조건 불일치');

  // ── SQL 이 아직 적용되지 않은 순간 ── 선택 열이 없으면 그 열만 빼고 계속 읽어야 한다.
  //    legacy 로 내려가면 author_id 조인이 필요해져 게시판 전체가 막힌다(15_launch 가 회수함).
  await missingColumnFallbackCheck();

  // ── 실제 상세 렌더까지 흘려 보낸다 ──
  // 키 존재만 보면 국비 유형 매핑이 어느 스코프에 있는지 같은 문제를 놓친다.
  // board-free.js를 그대로 실행해 화면 문자열에 후기 사실이 찍히는지 확인한다.
  await renderDetailCheck();
  console.log('posts-contract OK — 선택 열이 v_posts와 일치, 후기 메타가 상세 렌더까지 도달');
})().catch((e) => { console.error(e.message); process.exitCode = 1; });

async function missingColumnFallbackCheck() {
  let asked = [];
  const q = {
    select(cols) { asked.push(cols); return q; },
    eq: () => q, or: () => q, order: () => q, limit: () => q,
    then: (res) => {
      const cols = asked[asked.length - 1];
      if (cols.includes('closed_at')) {
        return Promise.resolve(res({
          data: null,
          error: { code: '42703', message: 'column v_posts.closed_at does not exist' }
        }));
      }
      const row = {};
      cols.split(',').map((c) => c.trim()).forEach((k) => { row[k] = FULL_ROW[k]; });
      return Promise.resolve(res({ data: [row], error: null }));
    }
  };
  const c2 = {
    console: { log() {}, warn() {}, error() {} },
    Promise, Object, Map, Set, Array, String, Number, Boolean, JSON, Date, RegExp,
    escT: (v) => String(v == null ? '' : v),
    location: { href: 'http://x/', pathname: '/', search: '', origin: 'http://x' },
    ainAuth: { getClient: () => ({ from: () => q }), getSession: async () => ({ user: { id: 'u1' } }) }
  };
  c2.window = c2;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets', 'js', 'ain-community.js'), 'utf8'),
    c2, { filename: 'assets/js/ain-community.js' });

  const r = await c2.ainCommunity.readPosts((qq) => qq.eq('board_type', 'free').limit(1), 'u1');
  assert.strictEqual(r.mode, 'view', '선택 열 부재로 legacy까지 내려가면 게시판이 막힌다');
  assert.ok(!r.error, '선택 열 부재가 에러로 남으면 안 됨: ' + JSON.stringify(r.error || {}));
  assert.strictEqual(r.rows.length, 1, '재시도로 글을 읽어 와야 함');
  assert.strictEqual(r.rows[0].title, FULL_ROW.title);
  assert.strictEqual(asked.length, 2, '한 번만 다시 시도해야 함 (무한 재시도 금지)');
  assert.ok(!asked[1].includes('closed_at'), '재시도 때 없는 열을 또 요청함');

  // 같은 세션에서 다음 조회는 이미 뺀 목록으로 한 번에 끝나야 한다
  const r2 = await c2.ainCommunity.readPosts((qq) => qq.limit(1), 'u1');
  assert.strictEqual(asked.length, 3, '이후 조회에서 다시 붙이면 매번 실패-재시도가 된다');
  assert.ok(!r2.error);
}

async function renderDetailCheck() {
  const panel = { innerHTML: '', querySelectorAll: () => [], addEventListener() {} };
  const els = {};
  const el = (id) => (els[id] || (els[id] = {
    innerHTML: '', textContent: '', value: '', hidden: false, checked: false,
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
    classList: { add() {}, remove() {}, toggle() {} }, focus() {}
  }));

  const q2 = (table) => {
    const q = {
      select: () => q, eq: () => q, or: () => q, order: () => q, limit: () => q,
      in: () => q, insert: () => q, update: () => q, delete: () => q, upsert: () => q,
      maybeSingle: () => q,
      then: (res) => {
        if (table === 'v_posts') {
          const keys = requested.split(',').map((c) => c.trim());
          const row = {}; keys.forEach((k) => { row[k] = FULL_ROW[k]; });
          return Promise.resolve(res({ data: [row], error: null }));
        }
        return Promise.resolve(res({ data: [], error: null }));
      }
    };
    const origSelect = q.select;
    q.select = (cols) => { if (table === 'v_posts') requested = cols; return origSelect(cols); };
    return q;
  };

  const handlers = {};
  const bctx = {
    console, Promise, Object, Map, Set, Array, String, Number, Boolean, JSON, Date, RegExp,
    escT: (v) => String(v == null ? '' : v),
    alert: () => {}, confirm: () => true, sessionStorage: { getItem: () => '1', setItem() {} },
    location: { href: 'http://x/board/free/?id=7', pathname: '/board/free/', search: '?id=7', origin: 'http://x', reload() {} },
    URLSearchParams,
    document: {
      getElementById: (id) => (id === 'panel' ? panel : el(id)),
      querySelectorAll: () => []
    },
    addEventListener: (t, f) => { handlers[t] = f; },
    ainAuth: { getClient: () => ({ from: (t) => q2(t), rpc: () => Promise.resolve({ data: null, error: null }) }) },
    ainCommunity: Object.assign({}, ctx.ainCommunity, {
      requireMember: async () => ({ user: { id: 'u1' }, profile: { nickname: 'ㅇㅇ', role: 'member' } })
    })
  };
  bctx.window = bctx;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'board', 'board-free.js'), 'utf8'),
    bctx, { filename: 'board/board-free.js' });

  await handlers['DOMContentLoaded']();
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));

  const html = panel.innerHTML;
  assert.ok(html.includes('타일 기초 수강 후기'), '상세가 렌더되지 않음: ' + html.slice(0, 120));
  // 국비 유형이 코드가 아니라 사람이 읽는 이름으로 나와야 한다 (공용 매핑 사용 확인)
  assert.ok(html.includes('국민내일배움카드'), '국비 유형 표기가 없음 — 매핑을 못 찾았거나 열이 안 내려옴');
  assert.ok(!html.includes('>card<'), '국비 유형이 코드 그대로 노출됨');
  // 금액과 수료 시점도 사실 그대로
  assert.ok(html.includes('22,500원'), '지출 금액이 표시되지 않음');
  assert.ok(html.includes('2026.08 수료'), '수료 시점이 표시되지 않음');
  // 연결된 교육 과정 링크
  assert.ok(html.includes('/edu/?id=IDOEDU-C217'), '교육 과정 연결 링크가 없음');
}
