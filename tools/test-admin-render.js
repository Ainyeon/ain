// 관리자 화면 렌더 회귀 검사 — 실행: node tools/test-admin-render.js
// 실제 계정·브라우저·네트워크를 쓰지 않는다. admin/board/index.html의 인라인 스크립트를
// 합성 DOM/Supabase 스텁 위에서 실행해, 실제로 실행되는 render가
// 상태·사유·답변·작성자 조회 UI를 만들고 이벤트까지 연결하는지 확인한다.
// (문법 검사만으로는 통과하던 함수 중복 오류를 잡기 위한 검사)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'admin', 'board', 'index.html'), 'utf8');

// 같은 스코프에 같은 이름의 실행 함수가 두 번 선언되면 뒤가 앞을 덮는다
for (const name of ['render', 'renderMembers']) {
  const n = (html.match(new RegExp('async function ' + name + '\\s*\\(', 'g')) || []).length;
  assert.strictEqual(n, 1, name + '() 선언이 ' + n + '개 — 하나여야 함');
}

const src = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

// ── 합성 DOM ──
const listeners = [];
function makeEl(attrs) {
  const el = {
    _html: '', dataset: attrs || {}, value: '', hidden: false,
    addEventListener: (t, f) => listeners.push({ el, t, f }),
    querySelector: () => makeEl(), querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {} }
  };
  Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: (v) => { el._html = v; } });
  return el;
}
const panel = makeEl();
// panel.innerHTML에서 data-* 속성을 뽑아 요소를 흉내낸다 (실제 파싱 대신 최소 재현)
panel.querySelectorAll = (sel) => {
  const attr = sel.replace(/[\[\]]/g, '').split('=')[0];
  const re = new RegExp(attr + '="([^"]+)"', 'g');
  const out = []; let m;
  while ((m = re.exec(panel._html))) {
    const key = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out.push(makeEl({ [key]: m[1] }));
  }
  return out;
};
panel.querySelector = (sel) => {
  const m = sel.match(/\[([a-z-]+)="([^"]+)"\]/);
  return m && panel._html.includes(m[1] + '="' + m[2] + '"') ? makeEl({}) : null;
};

const byId = { panel };
['tabMod', 'tabMembers', 'fltReached', 'memSearch', 'memQ'].forEach((id) => { byId[id] = makeEl(); });

const rows = [
  { id: 1, board_type: 'proposal', title: '지역 필터에 시·군·구를', status: 'building',
    status_reason: null, admin_answer: '작업 중입니다', is_anonymous: false, created_at: '2026-09-01T00:00:00Z' },
  { id: 2, board_type: 'proposal', title: '익명 제안', status: 'held',
    status_reason: '자료 확인 중', admin_answer: null, is_anonymous: true, created_at: '2026-09-02T00:00:00Z' },
  { id: 3, board_type: 'free', title: '자유글', status: 'open', created_at: '2026-09-03T00:00:00Z' }
];

const rpcCalls = [];
function table(name) {
  const q = {
    select: () => q, order: () => q, limit: () => q, ilike: () => q, eq: () => q,
    delete: () => q,
    then: (res) => res({ data: name === 'votes' ? [{ post_id: 1, vote: 'up' }]
      : name === 'reports' ? [{ target_type: 'post', target_id: 1, reason: '스팸·광고' }]
      : name === 'comments' ? [] : [], error: null })
  };
  return q;
}
const client = {
  from: table,
  rpc: (fn, args) => { rpcCalls.push([fn, args]); return Promise.resolve({ data: [{ nickname: 'ㅇㅇ', role: 'member', post_count: 3 }], error: null }); }
};

const handlers = {};
const ctx = {
  console, Promise, Object, Number, Boolean, String, Array, JSON, Math, Date, RegExp, Set, Map,
  escT: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  alert: () => {}, confirm: () => true, prompt: () => '1',
  ainAuth: { getClient: () => client, init: () => {} },
  ainCommunity: {
    getMyProfile: async () => ({ user: { id: 'admin-user' }, profile: { role: 'admin', nickname: '운영자' } }),
    readPosts: async () => ({ rows, mode: 'view' }),
    authorBadge: (p) => '<span>' + (p && p.nickname || '') + '</span>',
    postHref: (p) => '/board/proposal/?id=' + p.id,
    boardName: () => '제안'
  },
  document: {
    getElementById: (id) => byId[id] || (byId[id] = makeEl()),
    querySelectorAll: () => []
  },
  addEventListener: (t, f) => { handlers[t] = f; }
};
ctx.window = ctx;
vm.runInNewContext(src, ctx, { filename: 'admin/board/index.html' });

(async () => {
  await handlers['DOMContentLoaded']();
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const out = panel._html;
  // 실제로 실행된 render가 새 UI를 만들었는가
  assert.ok(out.includes('data-state-form="1"'), '상태·답변 저장 form이 없음');
  assert.ok(out.includes('data-reason="2"'), '상태 이유 입력이 없음');
  assert.ok(out.includes('data-answer="1"'), '운영자 답변 입력이 없음');
  assert.ok(out.includes('data-who="1"'), '작성자 확인 버튼이 없음');
  assert.ok(out.includes('작업 중입니다'), '기존 운영자 답변이 채워지지 않음');
  assert.ok(out.includes('자료 확인 중'), '기존 상태 이유가 채워지지 않음');
  assert.ok(out.includes('익명'), '익명 제안 표시가 없음');
  // 상태 6종이 선택지에 있는가
  for (const v of ['open', 'adopted', 'building', 'shipped', 'held', 'declined']) {
    assert.ok(out.includes('value="' + v + '"'), '상태 ' + v + ' 선택지 없음');
  }
  // 자유글은 제안 상태 관리에 섞이지 않는다
  assert.ok(!out.includes('data-state-form="3"'), '자유글이 제안 상태 관리에 섞임');
  // 접근성: 이유·답변 입력에 이름이 있는가
  assert.ok(out.includes('for="sr1"') && out.includes('id="sr1"'), '상태 이유 입력에 label 없음');
  assert.ok(out.includes('for="sa1"') && out.includes('id="sa1"'), '운영자 답변 입력에 label 없음');
  // 이벤트가 실제로 연결됐는가
  const bound = (attr) => listeners.filter((l) => Object.keys(l.el.dataset).length && l.t).length;
  assert.ok(listeners.some((l) => l.t === 'submit' && l.el.dataset.stateForm), '상태 저장 submit 미연결');
  assert.ok(listeners.some((l) => l.t === 'click' && l.el.dataset.who), '작성자 확인 click 미연결');
  void bound;

  // 반복 작성 판정은 서버(작성자 기준)에서 온다 — 화면에서 근사하지 않는다
  assert.ok(rpcCalls.some(([fn]) => fn === 'admin_repeat_flags'), '반복 작성 RPC 미호출');

  // 상태·답변 저장: 값이 그대로 RPC로 간다
  const form = listeners.find((l) => l.t === 'submit' && l.el.dataset.stateForm);
  assert.ok(form, '상태 저장 form 미연결');
  const vals = { status: 'building', reason: '', answer: '작업 중입니다' };
  panel.querySelector = (sel) => {
    if (sel.includes('data-status')) return { value: vals.status };
    if (sel.includes('data-reason')) return { value: vals.reason };
    if (sel.includes('data-answer')) return { value: vals.answer };
    return null;
  };
  await form.f({ preventDefault() {} });
  const saved = rpcCalls.find(([fn]) => fn === 'admin_set_post_state');
  assert.ok(saved, '상태 저장 RPC 미호출');
  assert.strictEqual(saved[1].p_status, 'building');
  assert.strictEqual(saved[1].p_answer, '작업 중입니다');

  // 보류·안 함인데 이유가 비면 RPC를 부르지 않는다 (서버 제약과 같은 규칙을 화면에서도 먼저 막는다)
  // (저장 성공 시 render()가 다시 돌며 admin_repeat_flags를 부르므로 총 호출 수가 아니라
  //  상태 저장 RPC 호출 수만 센다)
  const saves = () => rpcCalls.filter(([fn]) => fn === 'admin_set_post_state').length;
  const before = saves();
  vals.status = 'held'; vals.reason = '';
  await form.f({ preventDefault() {} });
  assert.strictEqual(saves(), before, '이유 없는 보류가 저장 요청으로 나갔다');
  // 이유를 적으면 나간다
  vals.reason = '자료 확인 중';
  await form.f({ preventDefault() {} });
  assert.strictEqual(saves(), before + 1, '이유를 적은 보류가 저장되지 않았다');

  // 작성자 확인은 목적을 붙여 호출한다 (기록이 남는 경로)
  const who = listeners.find((l) => l.t === 'click' && l.el.dataset.who);
  await who.f();
  const lookup = rpcCalls.find(([fn]) => fn === 'admin_post_author');
  assert.ok(lookup && ['duplicate', 'abuse'].includes(lookup[1].p_purpose), '작성자 조회 목적 누락');

  console.log('admin-render OK — render 1개 / 상태6종·이유·답변·작성자조회 렌더·이벤트·RPC 인자');
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
