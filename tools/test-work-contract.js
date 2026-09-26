// 업무 데이터 계층 계약 검사 — node tools/test-work-contract.js
// 1) work-store.js가 쓰는 열 = supabase/17_work.sql의 insert/update 컬럼 GRANT (둘 중 하나만 바뀌면 운영에서 403)
// 2) 화면 코드가 외부·사용자 입력을 HTML로 해석하지 않는다 (innerHTML·insertAdjacentHTML·outerHTML 금지)
// 3) 새 페이지 ?v= 가 서로 같고, 시공 카드 링크는 # 뒤 토큰 형식
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const sql = read('supabase/17_work.sql');
function grantCols(kind, table) {
  const re = new RegExp('grant ' + kind + ' \\(([^)]*)\\)\\s*on public\\.' + table + ' to authenticated', 'm');
  const m = sql.match(re);
  assert.ok(m, kind + ' grant for ' + table);
  return m[1].split(',').map((s) => s.trim()).filter(Boolean).sort();
}
// work-store.js를 브라우저 없이 평가해 COLS만 꺼낸다
const ctx = { window: { ainWorkLogic: require('../work/work-logic.js') }, crypto: globalThis.crypto };
vm.runInNewContext(read('work/work-store.js'), ctx);
const COLS = ctx.window.ainWorkStore.COLS;
for (const t of ['work_profiles', 'work_customers', 'work_jobs']) {
  const mine = [...COLS[t]].sort();
  assert.deepStrictEqual(mine, grantCols('insert', t), t + ' insert 열 불일치');
  assert.deepStrictEqual(mine, grantCols('update', t), t + ' update 열 불일치');
}
assert.deepStrictEqual(grantCols('insert', 'work_photos'), ['job_id', 'kind', 'path']);
assert.ok(/insert\(\{ job_id: jobId, path, kind/.test(read('work/work-store.js')), '사진 행 insert는 허용 열만');
// 서버 전용 열을 클라이언트가 보내지 않는다
for (const t of Object.keys(COLS)) for (const c of ['user_id', 'card_token', 'created_at', 'id']) assert.ok(!COLS[t].includes(c), t + '.' + c);

// XSS: 업무·카드 화면은 textContent/createElement로만 그린다
for (const f of ['work/work.js', 'c/card.js', 'work/work-doc.js', 'work/work-store.js']) {
  const src = read(f);
  assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/.test(src), f + ': HTML 문자열 삽입 금지');
}
// 공개 카드 토큰은 # 뒤에 (서버 로그·SW 캐시·Referer에 안 남게), get_card는 POST(rpc 기본)
assert.ok(read('work/work.js').includes("'/c/#t='"), '카드 링크 형식');
assert.ok(!/get:\s*true/.test(read('c/card.js')), 'get_card는 GET으로 부르지 않는다');
assert.ok(/name="referrer" content="no-referrer"/.test(read('c/index.html')) && /noindex/.test(read('c/index.html')));
assert.ok(!/ain-common\.js/.test(read('c/index.html')), '고객용 카드 페이지에는 기술자용 탭바·SW를 싣지 않는다');
// CSP: 업무·카드 페이지에 인라인 스크립트 없음
for (const f of ['work/index.html', 'c/index.html']) {
  const html = read(f);
  assert.ok(/Content-Security-Policy/.test(html), f + ' CSP');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), f + ': 인라인 스크립트 금지');
}
// 새 자산 ?v= 통일, 서비스워커 버전
const v = [...read('work/index.html').matchAll(/\/work\/[\w.-]+\.(?:js|css)\?v=(\d+)/g)].map((m) => m[1]);
assert.ok(v.length >= 5 && v.every((x) => x === v[0]), 'work 자산 ?v= 통일: ' + v);
assert.ok(read('sw.js').includes("VERSION = 'ain-v" + v[0] + "'"), 'sw VERSION = ?v=');
assert.ok(!/work_|get_card|submit_card/.test(read('sw.js').match(/DATA_ALLOW = \[[^\]]*\]/)[0]), '회원 업무 데이터는 SW 캐시 금지');

console.log('test-work-contract: OK');
