// PWA 계약 검사 — 실행: node tools/test-pwa-contract.js
// test-asset-versions.js 는 HTML 의 js/css 참조와 SHELL 의 ?v= 만 맞춘다. manifest·아이콘·sw.js 상수·SHELL 완전성은 읽지 않는다.
// 네트워크·브라우저를 쓰지 않는다. 파일을 읽기만 한다.
//
// 확인하는 것:
//   1. 페이지가 링크한 모든 manifest: JSON, name/short_name, start_url ∈ scope, start_url 대상 존재,
//      아이콘 파일 존재 + PNG 이고 실제 크기 = 선언 크기, 192·512·maskable 아이콘 있음.
//   2. sw.js 상수: VERSION 형식, 캐시 이름이 VERSION 으로 시작(activate 가 새 캐시를 지우지 않음),
//      DATA_HOST = auth.js 의 supabase 호스트, DATA_ALLOW 는 공개 읽기 전용 목록 안(회원 전용 응답이 기기에 남지 않게).
//   3. SHELL 완전성: SHELL 에 든 페이지가 요청하는 로컬 js/css 는 전부 SHELL 에 있다(오프라인 셸이 스크립트 없이 뜨지 않게),
//      SHELL 의 js/css ?v= 항목은 어느 페이지가 실제로 요청한다(죽은 항목 없음), 정적 fetch('/assets/…') 대상도 SHELL 에 있다.
// 일부러 고정하지 않는 것: VERSION 숫자(work 자산 ?v= 와 같아야 한다는 건 test-work-contract.js 가 본다), theme_color 값,
//   supabase-js 의 @2 문자열(고정 버전으로 옮길 수 있다), 알려진 약점(404 셸 캐시·설치 실패)의 현재 동작.
// 정책 고정: DATA_ALLOW 공개 목록(아래 PUBLIC_DATA)은 정당하게 늘릴 때 이 파일도 함께 고친다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const exists = (rel) => fs.existsSync(path.join(root, rel));

// 배포되는 HTML (test-asset-versions.js 와 같은 기준)
const ROOT_SKIP = new Set(['legacy', 'docs', 'tools', 'supabase', 'sql', 'node_modules']);
function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!/^[._]/.test(e.name) && !(dir === '' && ROOT_SKIP.has(e.name))) out.push(...htmlFiles(rel)); }
    else if (e.name.endsWith('.html')) out.push(rel);
  }
  return out;
}
const pages = htmlFiles('');

const sw = read('sw.js');
const constant = (name) => { const m = sw.match(new RegExp('const ' + name + ' = (\\S[^;\\n]*);')); assert.ok(m, 'sw.js 에서 ' + name + ' 를 찾지 못했다'); return m[1].trim(); };
const quoted = (expr) => { const m = expr.match(/^'([^']*)'$/); assert.ok(m, 'sw.js 상수가 문자열 리터럴이 아니다: ' + expr); return m[1]; };
const shellSrc = (sw.match(/const SHELL = \[([\s\S]*?)\n\];/) || [])[1];
assert.ok(shellSrc, 'sw.js 에서 SHELL 배열을 찾지 못했다');
const shell = [];
for (const line of shellSrc.split('\n')) {
  const m = line.match(/^\s*(['"])(.+?)\1\s*,?\s*(?:\/\/.*)?$/);
  if (m) shell.push(m[2]); else assert.ok(/^\s*(\/\/.*)?$/.test(line), 'SHELL 줄을 해석하지 못했다: ' + line.trim());
}
const shellSet = new Set(shell);
assert.ok(shell.length > 10, 'SHELL 항목이 너무 적다: ' + shell.length);

// ── 1. manifest + 아이콘
const manifests = new Map();                                      // href -> 링크한 페이지들
for (const f of pages) {
  const m = strip(read(f)).match(/<link[^>]+rel=["']manifest["'][^>]*>/i);
  const href = m && (m[0].match(/href=["']([^"']+)["']/) || [])[1];
  if (!href) continue;
  if (!manifests.has(href)) manifests.set(href, []);
  manifests.get(href).push(f);
}
assert.ok(manifests.size >= 1, '페이지가 링크한 manifest 가 없다(검사가 헛돈다)');
const PNG_SIG = '89504e470d0a1a0a';
for (const [href, linkedBy] of manifests) {
  assert.ok(href.startsWith('/') && exists(href.slice(1)), href + ' 가 저장소에 없다 (' + linkedBy[0] + ' 가 링크)');
  let man; try { man = JSON.parse(read(href.slice(1))); } catch (e) { assert.fail(href + ' 가 올바른 JSON 이 아니다: ' + e.message); }
  assert.ok(man.name && man.short_name, href + ': name/short_name 이 없다');
  if (man.scope) assert.ok(man.start_url.startsWith(man.scope), href + ': start_url(' + man.start_url + ')이 scope(' + man.scope + ') 밖이다');
  const startPath = man.start_url.split('?')[0].replace(/^\//, '');
  assert.ok(exists(startPath === '' ? 'index.html' : startPath.endsWith('/') ? startPath + 'index.html' : startPath), href + ': start_url 대상이 없다 (' + man.start_url + ')');
  const sizes = new Set(); let maskable = false;
  assert.ok(Array.isArray(man.icons) && man.icons.length, href + ': 아이콘이 없다');
  for (const ic of man.icons) {
    assert.ok(ic.src && ic.src.startsWith('/') && exists(ic.src.slice(1)), href + ': 아이콘 파일이 없다 ' + ic.src);
    const b = fs.readFileSync(path.join(root, ic.src.slice(1)));
    assert.strictEqual(b.slice(0, 8).toString('hex'), PNG_SIG, ic.src + ' 가 PNG 가 아니다');
    const actual = b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
    assert.ok(String(ic.sizes).split(' ').includes(actual), ic.src + ' 실제 크기 ' + actual + ' 가 선언(' + ic.sizes + ')과 다르다');
    sizes.add(actual); if (/maskable/.test(ic.purpose || '')) maskable = true;
  }
  assert.ok(sizes.has('192x192') && sizes.has('512x512'), href + ': 192x192 와 512x512 아이콘이 모두 필요하다 (현재 ' + [...sizes].join(', ') + ')');
  assert.ok(maskable, href + ': maskable 아이콘이 없다');
}

// ── 2. sw.js 상수
const VERSION = quoted(constant('VERSION'));
assert.ok(/^ain-v\d+$/.test(VERSION), 'VERSION 형식이 ain-v숫자 가 아니다: ' + VERSION);
assert.ok(/^VERSION \+ '-shell'$/.test(constant('SHELL_CACHE')) && /^VERSION \+ '-data'$/.test(constant('DATA_CACHE')),
  '캐시 이름은 VERSION 으로 시작해야 한다 — activate 가 "VERSION 으로 시작하지 않는 캐시"를 지워서, 다르면 새 캐시를 스스로 지운다');
const authUrl = (read('auth.js').match(/const SUPABASE_URL = '([^']+)'/) || [])[1];
assert.ok(authUrl, 'auth.js 에서 SUPABASE_URL 을 찾지 못했다');
assert.strictEqual('https://' + quoted(constant('DATA_HOST')), authUrl, 'sw.js DATA_HOST 가 auth.js 의 supabase 호스트와 다르다 — 공개 데이터 오프라인 캐시가 조용히 꺼진다');
assert.strictEqual(quoted(constant('DATA_PATH')), '/rest/v1/', 'DATA_PATH 가 /rest/v1/ 이 아니다');
const allow = [...(sw.match(/const DATA_ALLOW = \[([^\]]*)\]/) || [, ''])[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
assert.ok(allow.length >= 1, 'sw.js 에서 DATA_ALLOW 를 찾지 못했다');
const PUBLIC_DATA = ['v_ticker_metals', 'v_stat_movein', 'v_stat_gov', 'v_gov_list', 'move_in_teaser', 'news_items', 'prices'];   // anon 이 읽는 공개 뷰·표
for (const t of allow) assert.ok(PUBLIC_DATA.includes(t), 'DATA_ALLOW 에 공개 읽기 목록에 없는 ' + t + ' 가 있다 — 회원 전용 응답이 기기에 남으면 로그아웃 뒤에도 보인다. 정당하게 공개라면 이 테스트의 PUBLIC_DATA 도 고칠 것');

// ── 3. SHELL 완전성
const RE = /(?:src|href)\s*=\s*(["'])([^"'#]+?\.(?:js|css|mjs))(\?[^"']*)?\1/gi;
const absOf = (page, raw, q) => (raw.startsWith('/') ? raw : '/' + path.posix.normalize(path.posix.join(path.posix.dirname(page), raw))) + (q || '');
const pageOf = (u) => (u === '/' ? 'index.html' : u.slice(1) + 'index.html');
const shellPages = shell.filter((u) => u.endsWith('/'));
assert.ok(shellPages.length >= 5, 'SHELL 에 든 페이지가 너무 적다: ' + shellPages.length);
for (const u of shellPages) {
  assert.ok(exists(pageOf(u)), 'SHELL 페이지 ' + u + ' 의 HTML 이 없다');
  const html = strip(read(pageOf(u)));
  for (let m; (m = RE.exec(html)); ) {
    if (/^(https?:)?\/\//i.test(m[2])) continue;                       // 외부 스크립트(CDN)는 아래 3-2 로 따로
    const a = absOf(pageOf(u), m[2], m[3]);
    assert.ok(shellSet.has(a), 'SHELL 페이지 ' + u + ' 가 요청하는 ' + a + ' 가 SHELL 에 없다 — 오프라인에서 그 페이지가 스크립트·스타일 없이 뜬다');
  }
}
// 3-2 SHELL 의 js/css ?v= 항목은 어느 페이지가 실제로 요청한다
const used = new Set();
for (const f of pages) for (let m, html = strip(read(f)); (m = RE.exec(html)); ) if (!/^(https?:)?\/\//i.test(m[2])) used.add(absOf(f, m[2], m[3]));
const dead = shell.filter((u) => /\.(js|css)\?v=\d+$/.test(u) && !used.has(u));
assert.deepStrictEqual(dead, [], 'SHELL 에 있지만 어느 페이지도 요청하지 않는 항목(옛 파일이 프리캐시에 남음): ' + dead.join(' '));
// 3-3 앱 JS 가 정적으로 fetch 하는 /assets/ 파일은 SHELL 에 있다 (업무·내보낸 뷰어는 설계상 SHELL 밖)
const jsFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    const r = d ? d + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!/^[._]/.test(e.name) && !(d === '' && (ROOT_SKIP.has(e.name) || e.name === 'work')) && r !== 'maker/3d/view') walk(r); }
    else if (e.name.endsWith('.js') && r !== 'sw.js') jsFiles.push(r);
  }
})('');
for (const f of jsFiles) for (const m of read(f).matchAll(/fetch\(\s*'(\/assets\/[^'?]+)'/g)) {
  assert.ok(shellSet.has(m[1]), f + ' 가 정적으로 fetch 하는 ' + m[1] + ' 가 SHELL 에 없다 — 오프라인에서 그 화면이 비어 보인다');
}

console.log('pwa-contract OK — manifest ' + manifests.size + '개(아이콘 실크기·scope) · VERSION ' + VERSION + ' · DATA_HOST=auth.js · DATA_ALLOW ' + allow.length + '종(공개만) · SHELL 페이지 ' + shellPages.length + '개 완전');
