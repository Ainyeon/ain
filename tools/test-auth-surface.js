// 인증 표면 정적 계약 검사 — 실행: node tools/test-auth-surface.js
// 로그인·세션을 둘러싼 "여러 파일이 같은 값을 약속하는" 곳을 코드로 묶는다. 앱 코드를 바꾸지 않고 읽기만 한다.
//
//   1. 게이트 키 결합: board/gate.js 가 localStorage 로 세션 유무를 보는 키는 auth.js 의 supabase 프로젝트 주소에서 정해진다.
//      둘이 어긋나면 로그인한 회원에게도 비회원 게이트가 먼저 그려진다(키를 하드코딩한 곳이 gate.js 하나뿐이다).
//   2. OAuth 복귀 주소: signInWithOAuth 를 부르는 모든 곳의 redirectTo 는 location.origin 으로 시작한다(다른 호스트로 안 감).
//   3. onboard 의 next 검증: 같은 사이트 주소만 따라가고(//evil.com · javascript: · 역슬래시/탭 우회 → '/'), 정상 경로는 막지 않는다.
//   4. 비밀값: 추적되는 파일에 service_role·비밀 키·토큰 모양이 없다. 실패 메시지에는 path:line 만 담고 일치한 값은 절대 싣지 않는다.
// 일부러 고정하지 않는 것: signInWithOAuth 호출 개수, createClient 옵션(flowType), 버튼 문구. 공개 키(sb_publishable_…)는 비밀이 아니다.
// 한계: 실제 카카오 OAuth 왕복, Supabase 대시보드의 Redirect allow-list·가입 허용 설정, 로그인 상태 동작은 이 검사로 알 수 없다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// 추적되는 파일만 본다(공개 레포에 올라가는 것). git 이 없으면 폴더를 훑되 비공개 폴더는 읽지 않는다.
function trackedFiles() {
  try { return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); }
  catch (e) {
    const out = [];
    (function walk(dir) {
      for (const d of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = dir ? dir + '/' + d.name : d.name;
        if (d.isDirectory()) { if (!/^(\.git|\.claude|\.playwright-mcp|node_modules|_private)$/.test(d.name)) walk(rel); }
        else out.push(rel);
      }
    })('');
    return out;
  }
}
const FILES = trackedFiles().filter((f) => !f.startsWith('_private/'));
assert.ok(FILES.length > 20, '검사할 파일을 거의 못 찾았다(검사가 헛돈다): ' + FILES.length);
const TEXT = /\.(js|mjs|html|css|json|md|sql|ya?ml|txt|svg|webmanifest)$/;
const APP = FILES.filter((f) => /\.(js|html)$/.test(f) && !/^(tools|legacy|docs|_dev)\//.test(f));

// ── 1. 게이트 키 = auth.js 의 프로젝트 ref
const authSrc = read('auth.js');
const refM = authSrc.match(/const SUPABASE_URL = 'https:\/\/([a-z0-9]+)\.supabase\.co'/);
assert.ok(refM, 'auth.js 에서 SUPABASE_URL 을 찾지 못했다');
const sessionKey = 'sb-' + refM[1] + '-auth-token';
const gateKeys = [...read('board/gate.js').matchAll(/localStorage\.getItem\('([^']+)'\)/g)].map((m) => m[1]);
assert.ok(gateKeys.length >= 1, 'board/gate.js 에서 localStorage 세션 키 조회를 찾지 못했다');
for (const k of gateKeys) assert.strictEqual(k, sessionKey, 'board/gate.js 의 세션 키(' + k + ')가 auth.js 프로젝트에서 정해지는 키(' + sessionKey + ')와 다르다');
// 저장소 어디에도 다른 프로젝트의 세션 키를 하드코딩하지 않는다
for (const f of APP) {
  for (const m of read(f).matchAll(/sb-[a-z0-9]+-auth-token/g)) {
    assert.strictEqual(m[0], sessionKey, f + ':' + lineOf(read(f), m.index) + ' 에 다른 세션 키가 있다');
  }
}

// ── 2. signInWithOAuth 의 redirectTo 는 모두 location.origin 으로 시작
let oauthSites = 0;
for (const f of APP) {
  const src = read(f);
  for (const m of src.matchAll(/signInWithOAuth\s*\(/g)) {
    const win = src.slice(m.index, m.index + 320);
    assert.ok(/redirectTo\s*:\s*(?:window\.)?location\.origin\b/.test(win),
      f + ':' + lineOf(src, m.index) + ' signInWithOAuth 의 redirectTo 가 location.origin 으로 시작하지 않는다');
    oauthSites++;
  }
}
assert.ok(oauthSites >= 1, 'signInWithOAuth 호출을 하나도 못 찾았다(검사가 헛돈다)');

// ── 3. onboard next 검증을 그 파일에서 잘라 그대로 실행
const onboard = read('onboard/index.html');
const nextM = onboard.match(/let next = '\/';\s*try \{([^\n]*)\} catch \(e\) \{\}/);
assert.ok(nextM, 'onboard/index.html 에서 next 검증 구간을 찾지 못했다 — 구조를 바꿨다면 이 테스트의 추출 줄을 고칠 것');
const ORIGIN = 'https://ainyeon.com';
const nextOf = (rawNext) => new Function('rawNext', 'location', "let next = '/'; try {" + nextM[1] + '} catch (e) {} return next;')(rawNext, { origin: ORIGIN });
for (const bad of ['//evil.com', '//evil.com/x', 'javascript:alert(1)', '/\\evil.com', '\\\\evil.com', 'https://evil.com/x', 'http://ainyeon.com.evil.com/', '/\t/evil.com', '\t//evil.com', ' //evil.com', 'data:text/html,x', 'ftp://ainyeon.com/']) {
  assert.strictEqual(nextOf(bad), '/', 'next=' + JSON.stringify(bad) + ' 를 같은 사이트 밖으로 따라간다 → ' + nextOf(bad));
}
for (const [good, want] of [['/me/', ORIGIN + '/me/'], ['/board/free/?id=5', ORIGIN + '/board/free/?id=5'], [ORIGIN + '/edu/', ORIGIN + '/edu/']]) {
  assert.strictEqual(nextOf(good), want, '정상 경로 ' + good + ' 를 막거나 바꿨다 → ' + nextOf(good));
}
// (빈 next 는 추출 구간 앞의 `|| '/'` 가 처리한다. 구간에 빈 문자열이 들어와도 같은 사이트 루트에 머문다)
assert.strictEqual(nextOf(''), ORIGIN + '/', '빈 next 가 같은 사이트 루트로 가지 않는다');

// ── 4. 비밀값 모양 (공개 키 sb_publishable_ 는 비밀이 아니라 패턴에 없다)
const SECRET = [
  ['sb_secret 키', /sb_secret_[A-Za-z0-9_-]{16,}/],
  ['Supabase 개인 토큰', /\bsbp_[0-9a-f]{20,}/],
  ['JWT 모양 토큰', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ['service_role 값 대입', /service_role['"]?\s*[:=]\s*['"][A-Za-z0-9._-]{20,}['"]/],
  ['GitHub 토큰', /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ['AWS 액세스 키', /\bAKIA[0-9A-Z]{16}\b/],
  ['개인 키 블록', /-----BEGIN [A-Z ]*PRIVATE KEY-----/]
];
const hits = [];
for (const f of FILES.filter((x) => TEXT.test(x))) {
  const src = read(f);
  for (const [label, re] of SECRET) {
    const m = re.exec(src);
    if (m) hits.push(f + ':' + lineOf(src, m.index) + ' (' + label + ')');        // 일치한 값은 싣지 않는다
  }
}
if (hits.length) throw new Error('비밀값 모양이 추적 파일에 있다(값은 출력하지 않음):\n - ' + hits.join('\n - '));

console.log('auth-surface OK — 게이트 키=' + sessionKey.replace(refM[1], '<ref>') + ' · signInWithOAuth ' + oauthSites + '곳 · onboard next 우회 12종 차단 · 비밀값 모양 0 (' + FILES.length + '개 파일)');
