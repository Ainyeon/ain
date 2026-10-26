// auth.js 동작 계약 검사 — 실행: node tools/test-auth-js.js
// 모든 페이지가 쓰는 로그인 진입점인데 auth.js 를 읽는 테스트가 없었다(test-auth-race.js 는 edu·area 만 올리고 auth 는 가짜).
// 실제 auth.js 를 격리 VM 에서 가짜 document·supabase-js 위에 그대로 실행해 확인한다. 실제 계정·브라우저·네트워크를 쓰지 않는다.
//
// 확인하는 것:
//   1. 없는 컨테이너 id 면 init 이 null 을 돌려주고 아무것도 하지 않는다.
//   2. 비로그인이면 로그인 버튼이 그려지고, 누르면 카카오 OAuth 가 현재 화면(origin+path+query, hash 제외)으로 돌아오게 부탁한다.
//   3. 로그인이면 표시 이름이 HTML 로 해석되지 않는다(따옴표·꺾쇠 포함). 이름 링크는 /me/, 로그아웃 버튼은 signOut 을 부른다.
//   4. 인증 상태가 바뀌면 화면을 다시 그리고 window 로 'ain:auth' 이벤트(detail.session)를 낸다.
//   5. getClient 는 하나만 만들고(createClient 1회), getSession 은 그 세션을 돌려준다.
// 일부러 고정하지 않는 것: 버튼 한글 문구(카피는 바뀐다 — id·class 로만 본다), createClient 옵션(flowType 을 나중에 바꿀 수 있다), 키 값.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

// auth.js 한 벌을 새 VM 에 올린다. session 은 getSession 이 돌려줄 값.
function boot(session, loc) {
  const els = {}; const rec = { oauth: [], signOut: 0, created: [], cb: null, events: [], styles: 0 };
  const mk = (id) => els[id] || (els[id] = { id, innerHTML: '', listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } });
  const document = {
    createElement: () => ({}), head: { appendChild() { rec.styles++; } },
    getElementById: (id) => (['slot', '_ain_in', '_ain_out'].includes(id) ? mk(id) : null)
  };
  const client = { auth: {
    getSession: () => Promise.resolve({ data: { session } }),
    onAuthStateChange(cb) { rec.cb = cb; },
    signOut() { rec.signOut++; },
    signInWithOAuth(o) { rec.oauth.push(o); return Promise.resolve(); }
  } };
  const window = { location: loc || { origin: 'https://ainyeon.com', pathname: '/edu/', search: '?id=3', hash: '#frag' }, dispatchEvent(e) { rec.events.push(e); } };
  const ctx = { document, window, String, Promise,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    supabase: { createClient: (url, key) => { rec.created.push({ url, keyType: typeof key }); return client; } } };
  vm.runInNewContext(src, ctx, { filename: 'auth.js' });
  return { api: window.ainAuth, els, rec, window };
}

(async () => {
  // 1. 없는 컨테이너
  {
    const a = boot(null);
    assert.strictEqual(a.api.init('no-such-id'), null, '없는 컨테이너인데 null 이 아니다');
    assert.strictEqual(a.rec.created.length, 0, '없는 컨테이너인데 클라이언트를 만들었다');
  }

  // 2. 비로그인: 로그인 버튼 → OAuth redirectTo
  {
    const a = boot(null);
    a.api.init('slot'); await tick();
    const html = a.els.slot.innerHTML;
    assert.ok(/id="_ain_in"/.test(html) && /class="ain-auth-login"/.test(html), '비로그인 화면에 로그인 버튼이 없다');
    assert.ok(!/id="_ain_out"/.test(html), '비로그인 화면에 로그아웃 버튼이 있다');
    a.els._ain_in.listeners.click();
    assert.strictEqual(a.rec.oauth.length, 1, '로그인 버튼이 OAuth 를 한 번 부르지 않았다');
    assert.strictEqual(a.rec.oauth[0].provider, 'kakao');
    assert.strictEqual(a.rec.oauth[0].options.redirectTo, 'https://ainyeon.com/edu/?id=3',
      '로그인 뒤 돌아올 주소는 origin+path+query(hash 제외)여야 한다');
    // 로그인 진입점(ainAuth.login)도 같은 주소
    await a.api.login();
    assert.strictEqual(a.rec.oauth[1].options.redirectTo, 'https://ainyeon.com/edu/?id=3');
  }

  // 3. 로그인: 이름 이스케이프, 링크, 로그아웃
  for (const [label, name] of [['꺾쇠', '<img src=x onerror=alert(1)>'], ['따옴표 탈출', '" onmouseover=alert(1) x="'], ['작은따옴표', "'><svg onload=alert(1)>"]]) {
    const a = boot({ user: { user_metadata: { full_name: name } } });
    a.api.init('slot'); await tick();
    const html = a.els.slot.innerHTML;
    assert.ok(!/<img|<svg|<script/i.test(html), label + ': 표시 이름이 HTML 로 해석됐다 → ' + html.slice(0, 120));
    assert.ok(!/"\s*onmouseover=/.test(html), label + ': 표시 이름이 속성을 탈출했다');
    assert.ok(/&(lt|quot|#39);/.test(html), label + ': 표시 이름이 글자로 이스케이프되지 않았다');
    assert.ok(/class="ain-auth-name"[^>]*href="\/me\/"|href="\/me\/"[^>]*class="ain-auth-name"/.test(html), label + ': 이름이 /me/ 링크가 아니다');
    assert.ok(/id="_ain_out"/.test(html) && !/id="_ain_in"/.test(html), label + ': 로그인 화면은 로그아웃 버튼만 있어야 한다');
  }
  {
    const a = boot({ user: { user_metadata: {} } });                      // 이름이 하나도 없어도 깨지지 않는다
    a.api.init('slot'); await tick();
    assert.ok(/class="ain-auth-name"/.test(a.els.slot.innerHTML), '이름 메타데이터가 없으면 화면이 깨진다');
    a.els._ain_out.listeners.click();
    assert.strictEqual(a.rec.signOut, 1, '로그아웃 버튼이 signOut 을 한 번 부르지 않았다');
  }

  // 4. 인증 상태 변화 → 다시 그리기 + 'ain:auth'
  {
    const a = boot(null);
    a.api.init('slot'); await tick();
    assert.ok(a.rec.cb, 'onAuthStateChange 에 등록하지 않았다');
    const s = { user: { user_metadata: { name: '홍길동' } } };
    a.rec.cb('SIGNED_IN', s);
    assert.ok(/id="_ain_out"/.test(a.els.slot.innerHTML), '로그인 뒤 화면을 다시 그리지 않았다');
    assert.strictEqual(a.rec.events.length, 1);
    assert.strictEqual(a.rec.events[0].type, 'ain:auth', "이벤트 이름이 'ain:auth' 가 아니다");
    assert.strictEqual(a.rec.events[0].detail.session, s, '이벤트가 세션을 싣지 않았다');
    a.rec.cb('SIGNED_OUT', null);
    assert.ok(/id="_ain_in"/.test(a.els.slot.innerHTML), '로그아웃 뒤 로그인 버튼으로 돌아가지 않았다');
    assert.strictEqual(a.rec.events[1].detail.session, null);
  }

  // 5. 클라이언트는 하나, getSession 은 그 세션
  {
    const s = { user: { id: 'u1', user_metadata: {} } };
    const a = boot(s);
    const c1 = a.api.getClient(), c2 = a.api.getClient();
    a.api.init('slot');
    assert.strictEqual(c1, c2, 'getClient 가 매번 다른 클라이언트를 만든다');
    assert.strictEqual(a.rec.created.length, 1, 'createClient 가 한 번이 아니다: ' + a.rec.created.length);
    assert.ok(/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(a.rec.created[0].url), '클라이언트 주소가 supabase 프로젝트 주소가 아니다');
    assert.strictEqual(a.rec.created[0].keyType, 'string', '클라이언트 키가 문자열이 아니다');
    assert.strictEqual(await a.api.getSession(), s, 'getSession 이 세션을 돌려주지 않는다');
  }

  console.log('auth-js OK — 비로그인 버튼·OAuth 복귀 주소(hash 제외) · 이름 이스케이프 · 로그아웃 · ain:auth · 클라이언트 단일');
})().catch((e) => { console.error(e.message); process.exit(1); });
