// 서비스워커 핸들러 동작 검사 — 실행: node tools/test-sw-logic.js
// sw.js 를 가짜 caches·fetch 위에서 그대로 실행해 "무엇을 가로채고 무엇을 저장하는가"를 고정한다.
// sw.js 의 보호 규칙(회원 전용 응답은 기기에 남기지 않는다)은 주석뿐이라 실행으로 고정할 장치가 없었다.
// 실제 브라우저·네트워크를 쓰지 않는다. Node 의 Request/Response 를 쓰므로 의존성이 없다.
//
// 확인하는 것:
//   1. 가로채기 행렬: 공개 REST(DATA_ALLOW 전부)·같은 출처 정적 자산·jsdelivr·내비게이션만 가로챈다.
//      회원 전용 뷰/표·rpc·/auth/v1·storage·POST·타 출처(공개 REST 경로여도 호스트가 다르면)는 respondWith 를 부르지 않는다.
//   2. 공개 데이터: 성공(ok) 응답만 URL 키로 저장하고(Authorization 헤더는 키에 안 들어간다), 오프라인이면 직전 성공본을 돌려준다.
//      ok 가 아닌 응답이 직전 성공본을 덮어쓰지 않는다.
//   3. install: SHELL 전부를 cache:'reload' 로 받아 SHELL 캐시에 넣고 skipWaiting 한다(HTTP 캐시 경유 시 구버전이 박제된다).
//   4. activate: VERSION 으로 시작하지 않는 캐시를 지우고 새 캐시는 남긴다, clients.claim 한다.
//   5. 내비게이션: 성공하면 SHELL 캐시에 저장, 오프라인이면 같은 주소(쿼리 달라도)의 저장본을 돌려준다.
//   6. 정적 자산: ok 응답만 저장한다(404 를 저장하지 않는다), 오프라인이면 저장본.
// 일부러 고정하지 않는 것(알려진 약점이라 고쳐질 수 있다): 내비게이션이 404 응답을 캐시에 넣는 것, 상위 503 을 그대로 통과시키는 것,
//   네트워크가 멈췄을 때의 동작, 정적 자산을 저장본 먼저 내보내는 것, SHELL 한 건 실패 시 설치 전체가 거부되는 것.
// 한계: 실제 Cache API 세부(opaqueredirect·Vary·쿼터)와 브라우저의 SW 설치·업그레이드는 가짜 caches 로 재현되지 않는다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const BASE = 'https://ainyeon.com';
const str = (name) => (src.match(new RegExp("const " + name + " = '([^']*)'")) || [])[1];
const VERSION = str('VERSION'), DATA_HOST = str('DATA_HOST');
assert.ok(VERSION && DATA_HOST, 'sw.js 에서 VERSION/DATA_HOST 를 찾지 못했다');
const SHELL_CACHE = VERSION + '-shell', DATA_CACHE = VERSION + '-data';
const allow = [...(src.match(/const DATA_ALLOW = \[([^\]]*)\]/) || [, ''])[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert.ok(allow.length >= 1, 'sw.js 에서 DATA_ALLOW 를 찾지 못했다');
const shell = [];
for (const line of ((src.match(/const SHELL = \[([\s\S]*?)\n\];/) || [])[1] || '').split('\n')) {
  const m = line.match(/^\s*(['"])(.+?)\1\s*,?\s*(?:\/\/.*)?$/); if (m) shell.push(m[2]);
}
assert.ok(shell.length > 10, 'SHELL 을 읽지 못했다: ' + shell.length);

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };   // 타이머 없이 저장 약속을 끝낸다
const hrefOf = (r) => new URL(typeof r === 'string' ? r : r.url, BASE).href;
// 상대 주소('/edu/')도 받는 Request (브라우저의 서비스워커 안에서는 되는 일)
class Req extends Request { constructor(u, i) { super(typeof u === 'string' ? new URL(u, BASE).href : u, i); } }

function makeEnv() {
  const store = new Map();                                   // 캐시 이름 -> Map(href -> Response)
  const env = { store, handlers: {}, netCalls: [], net: async () => new Response('', { status: 200 }), skipped: false, claimed: false };
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      return {
        put: async (r, res) => { m.set(hrefOf(r), res); },
        addAll: async (rs) => { for (const r of rs) { const res = await fetchFn(r); if (!res.ok) throw new Error('addAll ' + hrefOf(r) + ' ' + res.status); m.set(hrefOf(r), res); } }
      };
    },
    async keys() { return [...store.keys()]; },
    async delete(name) { return store.delete(name); },
    async match(r, opt) {
      opt = opt || {}; const cut = (u) => (opt.ignoreSearch ? u.split('?')[0] : u); const want = cut(hrefOf(r));
      for (const [name, m] of store) { if (opt.cacheName && name !== opt.cacheName) continue; for (const [k, v] of m) if (cut(k) === want) return v.clone(); }
      return undefined;
    }
  };
  const fetchFn = (r) => { env.netCalls.push(r); return env.net(r); };
  const self = { addEventListener: (t, f) => { env.handlers[t] = f; }, skipWaiting: () => { env.skipped = true; }, clients: { claim: async () => { env.claimed = true; } } };
  new Function('self', 'caches', 'fetch', 'location', 'Request', 'Response', 'URL', src)(self, caches, fetchFn, new URL(BASE + '/'), Req, Response, URL);
  env.fetchEvent = (url, init, mode) => {
    const req = new Req(url, init);
    if (mode) Object.defineProperty(req, 'mode', { value: mode });
    const ev = { request: req, intercepted: false, respondWith(p) { ev.intercepted = true; ev.p = Promise.resolve(p); }, waitUntil() {} };
    env.handlers.fetch(ev);
    return ev;
  };
  return env;
}
const cached = (env, cacheName, url) => { const m = env.store.get(cacheName); return m && m.get(hrefOf(url)); };

(async () => {
  const H = 'https://' + DATA_HOST;

  // ── 1. 가로채기 행렬 (200 을 돌려주는 네트워크)
  {
    const e = makeEnv(); e.net = async () => new Response('[]', { status: 200 });
    const not = [
      ['GET 회원 전용 뷰 v_posts', H + '/rest/v1/v_posts?select=*'], ['GET 회원 전용 표 saved_items', H + '/rest/v1/saved_items'],
      ['GET 회원 전용 표 notice_complexes', H + '/rest/v1/notice_complexes'], ['GET 업무 표 work_jobs', H + '/rest/v1/work_jobs?select=*'],
      ['GET rpc get_card', H + '/rest/v1/rpc/get_card'], ['GET rpc studio_status', H + '/rest/v1/rpc/studio_status'],
      ['GET /auth/v1/user', H + '/auth/v1/user'], ['GET storage 서명 주소', H + '/storage/v1/object/sign/studio/x'],
      ['GET 타 출처 스크립트', 'https://t1.kakaocdn.net/kakao_js_sdk/x.js'],
      ['GET 타 호스트의 공개 REST 경로', 'https://other.example/rest/v1/prices?select=*']
    ];
    for (const [name, url] of not) assert.ok(!e.fetchEvent(url).intercepted, name + ' 을(를) 가로챘다 — 회원 전용·인증·타 출처 응답은 건드리면 안 된다');
    assert.ok(!e.fetchEvent(H + '/rest/v1/prices', { method: 'POST', body: '{}' }).intercepted, 'POST 를 가로챘다');
    assert.strictEqual(e.netCalls.length, 0, '가로채지 않을 요청에서 네트워크를 불렀다');
    assert.strictEqual(e.store.size, 0, '가로채지 않을 요청이 캐시를 만들었다');
    const yes = [...allow.map((t) => ['공개 REST ' + t, H + '/rest/v1/' + t + '?select=*']),
      ['같은 출처 정적 자산', BASE + '/assets/css/components.css?v=1'], ['jsdelivr 스크립트', 'https://cdn.jsdelivr.net/npm/x.js']];
    for (const [name, url] of yes) assert.ok(e.fetchEvent(url).intercepted, name + ' 을(를) 가로채지 않았다');
    assert.ok(e.fetchEvent(BASE + '/edu/', {}, 'navigate').intercepted, '내비게이션을 가로채지 않았다');
  }

  // ── 2. 공개 데이터: ok 만 URL 키로 저장, 오프라인이면 직전 성공본, ok 아닌 응답이 덮어쓰지 않는다
  {
    const e = makeEnv(); const url = H + '/rest/v1/prices?select=*';
    e.net = async () => new Response('[{"a":1}]', { status: 200 });
    let ev = e.fetchEvent(url, { headers: { authorization: 'Bearer user-token', apikey: 'k' } }); await ev.p; await flush();
    const saved = cached(e, DATA_CACHE, url);
    assert.ok(saved, '성공한 공개 데이터를 DATA 캐시에 저장하지 않았다');
    assert.strictEqual(await saved.clone().text(), '[{"a":1}]');
    e.net = async () => new Response('down', { status: 503 });
    ev = e.fetchEvent(url); await ev.p; await flush();
    assert.strictEqual(await cached(e, DATA_CACHE, url).clone().text(), '[{"a":1}]', 'ok 가 아닌 응답이 직전 성공본을 덮어썼다');
    e.net = async () => { throw new TypeError('offline'); };
    ev = e.fetchEvent(url, { headers: { authorization: 'Bearer another-user' } });          // 다른 Authorization 이어도 같은 URL 키
    assert.strictEqual(await (await ev.p).text(), '[{"a":1}]', '오프라인에서 직전 성공본을 돌려주지 않았다');
  }

  // ── 3. install: SHELL 전부를 cache:'reload' 로
  {
    const e = makeEnv(); let ins;
    await e.handlers.install({ waitUntil: (p) => { ins = p; } }); await ins;
    const m = e.store.get(SHELL_CACHE);
    assert.ok(m, 'install 이 SHELL 캐시를 만들지 않았다');
    for (const u of shell) assert.ok(m.has(hrefOf(u)), 'install 이 SHELL 항목을 저장하지 않았다: ' + u);
    assert.strictEqual(e.netCalls.length, shell.length, 'install 이 받은 개수가 SHELL 과 다르다');
    for (const r of e.netCalls) assert.strictEqual(r.cache, 'reload', 'install 이 ' + hrefOf(r) + ' 를 cache:reload 로 받지 않았다 — HTTP 캐시를 경유하면 구버전이 박제된다');
    assert.ok(e.skipped, 'install 뒤 skipWaiting 을 부르지 않았다');
  }

  // ── 4. activate: VERSION 으로 시작하지 않는 캐시만 지운다
  {
    const e = makeEnv();
    for (const n of ['ain-v1-shell', SHELL_CACHE, 'ain-v1-data', DATA_CACHE, 'other-cache']) e.store.set(n, new Map());
    let act; await e.handlers.activate({ waitUntil: (p) => { act = p; } }); await act;
    assert.deepStrictEqual([...e.store.keys()].sort(), [DATA_CACHE, SHELL_CACHE].sort(), 'activate 뒤 남은 캐시가 현재 VERSION 의 두 개가 아니다');
    assert.ok(e.claimed, 'activate 가 clients.claim 을 부르지 않았다');
  }

  // ── 5. 내비게이션: 성공하면 저장, 오프라인이면 같은 주소(쿼리 달라도)의 저장본
  {
    const e = makeEnv(); e.net = async () => new Response('EDU-PAGE', { status: 200 });
    let ev = e.fetchEvent(BASE + '/edu/', {}, 'navigate'); assert.strictEqual(await (await ev.p).text(), 'EDU-PAGE'); await flush();
    assert.ok(cached(e, SHELL_CACHE, BASE + '/edu/'), '성공한 내비게이션을 SHELL 캐시에 저장하지 않았다');
    e.net = async () => { throw new TypeError('offline'); };
    ev = e.fetchEvent(BASE + '/edu/', {}, 'navigate'); assert.strictEqual(await (await ev.p).text(), 'EDU-PAGE', '오프라인에서 저장된 페이지를 돌려주지 않았다');
    ev = e.fetchEvent(BASE + '/edu/?x=1', {}, 'navigate'); assert.strictEqual(await (await ev.p).text(), 'EDU-PAGE', '오프라인에서 쿼리가 달라진 주소가 저장본으로 가지 않았다');
  }

  // ── 6. 정적 자산: ok 만 저장, 오프라인이면 저장본
  {
    const e = makeEnv(); const css = BASE + '/assets/css/x.css?v=1', gone = BASE + '/assets/css/gone.css?v=1';
    e.net = async () => new Response('BODY', { status: 200 });
    let ev = e.fetchEvent(css); assert.strictEqual(await (await ev.p).text(), 'BODY'); await flush();
    assert.ok(cached(e, SHELL_CACHE, css), '정적 자산 성공 응답을 저장하지 않았다');
    e.net = async () => new Response('nope', { status: 404 });
    ev = e.fetchEvent(gone); assert.strictEqual((await ev.p).status, 404); await flush();
    assert.ok(!cached(e, SHELL_CACHE, gone), '정적 자산의 404 응답을 캐시에 저장했다');
    e.net = async () => { throw new TypeError('offline'); };
    ev = e.fetchEvent(css); assert.strictEqual(await (await ev.p).text(), 'BODY', '오프라인에서 저장된 정적 자산을 돌려주지 않았다');
  }

  console.log('sw-logic OK — 가로채기 행렬(' + (allow.length + 2) + '종 가로챔·타 호스트/회원 전용/rpc/auth/POST 제외) · 공개 데이터 ok 만 저장 · install reload · activate 정리 · 내비게이션·정적 폴백');
})().catch((e) => { console.error(e.message); process.exit(1); });
