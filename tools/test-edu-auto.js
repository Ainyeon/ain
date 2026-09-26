// 교육 화면의 자동 수집 병합 검사 — 실행: node tools/test-edu-auto.js
// 실제 계정·브라우저·네트워크를 쓰지 않는다. edu.js를 격리 VM에서 그대로 실행한다.
//
// 확인하는 것:
//   1. v_edu_list가 없어도(운영 SQL 미적용) 원장만으로 화면이 뜬다 — 실패를 0건처럼 꾸미지 않는다.
//   2. 자동 수집 항목이 원장 항목과 같은 카드로 합쳐지고, '사람 검수 전'이 화면에 적힌다.
//   3. 같은 원문 주소는 두 번 실리지 않고, 사람이 검수한 원장 쪽이 남는다.
//   4. 원문 안 표기 충돌이 화면에 그대로 나온다.
//   5. 이용 근거가 기록된 이미지만 뜨고, 후보 상태(pending)는 뜨지 않는다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const LEDGER = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'data', 'education.json'), 'utf8'));

const AUTO_ROW = {
  notice_id: 'AUTO-KRRC-0123456789',
  org: '(사)한국냉매관리기술협회(KRRC)',
  record_type: '모집회차',
  title: '자동 수집 냉매회수 신규교육 추가 4차',
  detail_url: 'http://www.krrc.or.kr/web/?code=999&key=detail&sub=schedule&top=education',
  list_url: 'http://www.krrc.or.kr/web/?sub=schedule&top=education',
  posted_raw: '2026.09.01',
  region_code: '충남',
  apply_end_at: '2099-12-11T18:00:00+09:00',
  status: 'active',
  parse_status: 'ok',
  parse_note: null,
  checked_at: LEDGER.checked_at,
  verified_by: '자동 수집 (사람 검수 전)',
  fields: {
    course_class: '냉매회수 기술인력 신규교육',
    schedule_raw: '2026.12.16 ~ 2026.12.17',
    apply_end_raw: '~ 2026.12.11 18:00',
    cost_raw: '230,000원', capacity_raw: '30 명',
    target_raw: '냉매회수업 등록 기술인력',
    region_raw: '충남 논산시 연무읍 인재개발원',
    work_codes: ['hvac'], cost_level: 'self', target_level: 'condition',
    conflicts: [{ field: 'apply_period_raw', kind: 'date',
      text: '[날짜·일시 충돌] 접수 기간: 2026.08.20 09:00 / 2026.08.24 10:00' }],
    images: [
      { url: 'https://cdn.test/allowed.jpg', kind: 'body_image', alt: '실습 사진',
        use: { state: 'allowed', verified_at: '2026-09-10', verified_by: '사람 확인',
               display_rules: ['원본 비율·전체 유지 (크롭·가공 금지)'] } },
      { url: 'https://cdn.test/pending.jpg', kind: 'og_image', alt: '',
        use: { state: 'pending', reason: '이용 조건 확인 전' } }
    ]
  }
};

// 원장에 이미 있는 회차와 같은 원문 주소 — 중복으로 실리면 안 된다
const LEDGER_DUP = LEDGER.items.find((i) => /^http/.test(i.url));
// 원장 URL과 파라미터 순서만 다른 수집분 (KRRC 실측: 원장 ?top=…&code=113, 예전 수집기 ?code=113&key=…)
const LEDGER_KRRC = LEDGER.items.find((i) => /krrc\.or\.kr\/web\/\?top=education/.test(i.url));
const REORDERED = (() => {
  const u = new URL(LEDGER_KRRC.url);
  const q = [...u.searchParams].reverse();
  return u.origin + u.pathname + '?' + q.map(([k, v]) => k + '=' + v).join('&') + '&course=&state=';
})();
// ain-common.js 의 실제 비교 함수를 그대로 잘라 쓴다 (복사본을 두지 않는다)
const COMMON = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'ain-common.js'), 'utf8');
const sourceUrlKey = new Function('URL', COMMON.slice(COMMON.indexOf('function sourceUrlKey'),
  COMMON.indexOf('  window.escT')) + '; return sourceUrlKey;')(URL);
const AUTO_DUP = Object.assign({}, AUTO_ROW, {
  notice_id: 'AUTO-KRRC-9999999999',
  title: '중복이어야 하는 자동 수집분',
  detail_url: LEDGER_DUP.url.replace(/^http:/, 'https:')   // 스킴만 다르다
});

function run({ eduRows, error, search }) {
  search = search || '';
  const panel = { innerHTML: '', querySelectorAll: () => [], addEventListener() {} };
  const els = {};
  const el = (id) => (els[id] || (els[id] = {
    innerHTML: '', textContent: '', value: '', hidden: false,
    addEventListener() {}, querySelectorAll: () => [], classList: { add() {}, remove() {} }
  }));
  const handlers = {};

  const query = () => {
    const q = {
      select: () => q, eq: () => q, or: () => q, in: () => q,
      order: () => q, limit: () => q,
      then: (res) => Promise.resolve(res(error ? { data: null, error } : { data: eduRows, error: null }))
    };
    return q;
  };

  const logic = require(path.join(ROOT, 'edu', 'edu-logic.js'));
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    Promise, Object, Map, Set, Array, String, Number, Boolean, JSON, Date, RegExp, Intl,
    URLSearchParams, URL, encodeURIComponent, setTimeout, setImmediate, sourceUrlKey,
    escT: (v) => String(v == null ? '' : v),
    location: { href: 'http://x/edu/' + search, pathname: '/edu/', search: search, origin: 'http://x' },
    history: { replaceState() {} },
    fetch: async () => ({ json: async () => JSON.parse(JSON.stringify(LEDGER)) }),
    document: { getElementById: (id) => (id === 'eduPanel' ? panel : el(id)), querySelectorAll: () => [] },
    addEventListener: (t, f) => { handlers[t] = f; },
    ainAuth: { getClient: () => ({ from: () => query() }), getSession: async () => null },
    ainEduLogic: logic,
    ainCommunity: {
      savesReady: () => false, saveKey: (t, i) => t + ':' + i,
      loadSaves: async () => null, readPosts: async () => ({ rows: [], mode: 'view' }),
      subsidyLabel: () => null, maskContacts: (t) => t, authorBadgeOf: () => ''
    }
  };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'edu', 'edu.js'), 'utf8'), ctx,
    { filename: 'edu/edu.js' });
  return { panel, els, boot: () => handlers['DOMContentLoaded'](), el };
}

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r)); };

(async () => {
  // 1. 뷰가 없을 때 — 원장만으로 정상 렌더
  {
    const a = run({ error: { code: 'PGRST205', message: 'Could not find the table in the schema cache' } });
    await a.boot(); await settle();
    assert.ok(a.panel.innerHTML.length > 200, '뷰가 없을 때 화면이 비었다');
    assert.ok(!a.panel.innerHTML.includes('자동 수집'), '수집분이 없는데 자동 수집 표시가 나왔다');
    assert.strictEqual(a.el('statEdu').textContent, LEDGER.counts.education,
      '뷰가 없으면 원장 건수 그대로여야 한다');
  }

  // 2. 자동 수집분 병합
  {
    const b = run({ eduRows: [AUTO_ROW] });
    await b.boot(); await settle();
    const html = b.panel.innerHTML;
    assert.ok(html.includes('자동 수집 냉매회수 신규교육 추가 4차'), '자동 수집 항목이 목록에 없다');
    assert.ok(html.includes('자동 수집 · 사람 검수 전'), '사람 검수 전 표시가 없다');
    assert.strictEqual(b.el('statEdu').textContent, LEDGER.counts.education + 1,
      '집계가 자동 수집분을 반영하지 않았다');
    assert.strictEqual(b.el('statOrg').textContent, LEDGER.counts.orgs,
      '같은 기관이면 기관 수는 늘지 않아야 한다');
    // 마감 확정분은 '접수 마감일시 명시' 구역에 들어간다
    assert.ok(html.includes('접수 마감일시 명시'), '마감 확정 회차가 마감 구역에 없다');
  }

  // 3. 같은 원문 주소는 한 번만 — 사람이 검수한 원장 쪽이 남는다
  {
    const c = run({ eduRows: [AUTO_DUP] });
    await c.boot(); await settle();
    const html = c.panel.innerHTML;
    assert.ok(!html.includes('중복이어야 하는 자동 수집분'), '같은 원문 주소가 두 번 실렸다');
    assert.ok(html.includes(LEDGER_DUP.course), '원장 항목이 사라졌다');
    assert.strictEqual(c.el('statEdu').textContent, LEDGER.counts.education,
      '중복분이 집계에 더해졌다');
  }

  // 4·5. 상세 — 충돌 표시와 이미지 게이트
  {
    const f = run({ eduRows: [AUTO_ROW], search: '?id=' + encodeURIComponent(AUTO_ROW.notice_id) });
    await f.boot(); await settle();
    const html = f.panel.innerHTML;
    assert.ok(html.includes('자동 수집 냉매회수 신규교육 추가 4차'), '자동 수집 항목의 상세가 열리지 않았다');
    assert.ok(html.includes('날짜·일시 충돌'), '원문 표기 충돌이 상세에 없다');
    assert.ok(html.includes('사람이 원문을 검수하지 않았습니다'), '검수 전 안내가 상세에 없다');
    assert.ok(html.includes('https://cdn.test/allowed.jpg'), '이용 근거가 있는 사진이 표시되지 않았다');
    assert.ok(!html.includes('https://cdn.test/pending.jpg'), '조건 미확인 후보 이미지가 표시됐다');
    assert.ok(html.includes('출처: (사)한국냉매관리기술협회(KRRC)'), '사진 출처 표기가 없다');
    // 원문에 없는 값을 만들어 내지 않는다
    assert.ok(!html.includes('undefined'), '빈 값이 undefined로 새어 나왔다');
  }

  // 6. 모양이 어긋난 행 — 페이지가 멈추지 않고, http(s)가 아닌 원문 주소는 링크로 쓰지 않는다
  {
    const BAD = Object.assign({}, AUTO_ROW, {
      notice_id: 'AUTO-KRRC-bad0000000', title: '모양이 어긋난 자동 수집분',
      detail_url: 'javascript:alert(1)',
      fields: Object.assign({}, AUTO_ROW.fields, { work_codes: 'hvac', conflicts: {}, images: 'x' })
    });
    const g = run({ eduRows: [BAD], search: '?id=' + encodeURIComponent(BAD.notice_id) });
    await g.boot(); await settle();
    assert.ok(g.panel.innerHTML.includes('모양이 어긋난 자동 수집분'), 'jsonb 모양이 어긋난 행 때문에 화면이 멈췄다');
    assert.ok(!g.panel.innerHTML.includes('javascript:'), 'http(s)가 아닌 원문 주소가 href로 나갔다');
  }

  // 7. 파라미터 순서만 다른 같은 원문 — 원장 쪽만 남는다 (09-26 dry-run 감사: KRRC 4건 중복)
  {
    const DUP2 = Object.assign({}, AUTO_ROW, { notice_id: 'AUTO-KRRC-dup0000000', title: '순서만 다른 중복분',
      detail_url: REORDERED });
    const h = run({ eduRows: [DUP2] });
    await h.boot(); await settle();
    assert.ok(!h.panel.innerHTML.includes('순서만 다른 중복분'), '파라미터 순서만 다른 같은 원문이 두 번 실렸다');
    assert.strictEqual(h.el('statEdu').textContent, LEDGER.counts.education);
  }

  // 8. 개강일이 지난 회차(수집기 status=closed, 마감 표기 없음)는 '접수 마감 경과' 구역으로, 문구는 개강일 기준
  {
    const STARTED = Object.assign({}, AUTO_ROW, { notice_id: 'AUTO-IDO-0000000001', title: '개강 지난 타일 과정',
      detail_url: 'https://idoedu.kr/bbs/board.php?bo_table=yp_recruit01&wr_id=1', apply_end_at: null, status: 'closed',
      fields: Object.assign({}, AUTO_ROW.fields, { conflicts: [] }) });
    const k = run({ eduRows: [STARTED] });
    await k.boot(); await settle();
    const html = k.panel.innerHTML;
    const expired = html.slice(html.indexOf('접수 마감 경과'));
    assert.ok(html.includes('접수 마감 경과') && expired.includes('개강 지난 타일 과정'), '개강 지난 과정이 현재 모집처럼 보인다');
    assert.ok(expired.includes('<span class="edu-tag">접수 마감 경과</span>'), '목록 카드에 경과 표시가 없다');
    const k2 = run({ eduRows: [STARTED], search: '?id=' + encodeURIComponent(STARTED.notice_id) });
    await k2.boot(); await settle();
    assert.ok(k2.panel.innerHTML.includes('원문 개강일이 지남'), '상세가 개강일 경과를 알리지 않는다');
  }

  // 9. 상세를 아직 못 읽은 행 — '원문에 없음'이 아니라 '상세 미확인'. 자동 수집분은 홍보 문구 '없음'을 단정하지 않는다
  {
    const UNREAD = Object.assign({}, AUTO_ROW, { notice_id: 'AUTO-KRRC-unread0000', title: '상세 안 읽은 회차',
      detail_url: 'http://www.krrc.or.kr/web/?top=education&sub=schedule&key=detail&code=999999',
      fields: { work_codes: ['hvac'], detail_read: false, conflicts: [], images: [] } });
    const m = run({ eduRows: [UNREAD], search: '?id=' + encodeURIComponent(UNREAD.notice_id) });
    await m.boot(); await settle();
    const html = m.panel.innerHTML;
    assert.ok(html.includes('상세 미확인'), '안 읽은 상세를 모른다고 적지 않았다');
    assert.ok(!html.includes('원문에 금액 표기 없음'), '안 읽은 상세를 원문에 금액이 없다고 적었다');
    assert.ok(!html.includes('취업·수익 관련 주장이 없습니다'), '확인하지 않은 홍보 문구를 없다고 단정했다');
    assert.ok(html.includes('홍보 문구를 확인하지 않았습니다'));
  }

  console.log('edu-auto OK — 뷰 부재 폴백 · 병합 · 중복 제거 · 충돌 표시 · 이미지 게이트 · 모양 방어');
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
