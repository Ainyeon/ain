// 자산 버전 일관성 검사 — 실행: node tools/test-asset-versions.js
// CLAUDE.md 배포 전 체크 6번(sw.js 캐시 버전 · 자산 ?v=)의 "일관성" 부분을 기계로 확인한다.
// 네트워크·브라우저를 쓰지 않는다. (파일 내용이 바뀌었는데 ?v=·VERSION 을 올렸는지는 여기서 알 수 없다.)
//
// 확인하는 것:
//   1. 페이지가 참조하는 로컬 js/css 는 전부 ?v=숫자 가 붙고, 가리키는 파일이 실제로 있다(대소문자까지 — Pages 는 구분한다).
//   2. 같은 자산 경로는 모든 페이지에서 같은 ?v= 로 참조된다 (한 페이지만 구버전이면 구·신 스크립트가 섞인다).
//   3. sw.js SHELL 의 ?v= 자산은 페이지가 실제로 요청하는 URL과 글자 그대로 같다
//      (다르면 프리캐시가 다른 키로 저장돼 재방문 첫 로드에 구 스크립트가 섞인다 — sw.js 주석 참고).
//   4. SHELL 의 로컬 경로는 모두 저장소에 있고 Jekyll 이 내보내는 경로다 (하나라도 404 면 cache.addAll 이 거부돼 SW 설치가 통째로 실패한다).
//   5. maker-core.js 의 ASSET_V 는 SHELL 의 maker JSON ?v= 와 같다 (maker-core 가 그 URL을 직접 요청한다).
//   6. 외부(CDN) 스크립트는 정확한 버전(@2 같은 부동 태그 금지) + integrity(sha384 등) + crossorigin 이 있다.
//      supabase-js 는 모든 페이지·CSP·sw.js SHELL 이 같은 URL·같은 해시를 쓴다. 해시가 라이브 파일과 맞는지는 여기서 알 수 없다(네트워크 안 씀).
//   7. 이 검사가 "배포 안 됨"으로 건너뛰는 폴더(ROOT_SKIP)와 개발 시안(maker/moodboard.html)은 _config.yml exclude 에 실제로 있다
//      (없으면 이 검사가 못 보는 파일이 Jekyll 에 의해 사이트로 나간다).
//
// 일부러 보지 않는 것: 업무(/work/)·시공 카드(/c/) 자산은 SHELL 에 넣지 않는 것이 설계라 SHELL 대조 대상이 아니다(1·2번만 본다).
//   내보낸 3D 뷰어(maker/3d/view/)는 내용 해시(?v=453e5a9c)로 버전을 매기므로 숫자 버전 규칙에서 뺀다(같은 경로는 같은 해시여야 한다).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// 대소문자까지 맞는 실제 경로인가 (macOS 는 구분하지 않지만 GitHub Pages 는 구분한다)
function existsExact(rel) {
  let dir = root;
  for (const part of rel.split('/').filter(Boolean)) {
    if (!fs.readdirSync(dir).includes(part)) return false;
    dir = path.join(dir, part);
  }
  return true;
}

// 배포되는 HTML 만 훑는다. 최상위의 비배포 폴더와 _·. 로 시작하는 폴더(Jekyll 이 내보내지 않음)는 뺀다.
// ROOT_SKIP 은 _config.yml exclude 와 같아야 한다(아래 6번이 확인) — 어긋나면 건너뛴 폴더가 그대로 배포된다.
const ROOT_SKIP = new Set(['legacy', 'docs', 'tools', 'supabase', 'sql', 'node_modules']);
function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (/^[._]/.test(e.name) || (dir === '' && ROOT_SKIP.has(e.name))) continue;
      out.push(...htmlFiles(rel));
    } else if (e.name.endsWith('.html')) out.push(rel);
  }
  return out;
}
const pages = htmlFiles('');

// 페이지가 요청하는 로컬 js/css/mjs: 루트 기준 경로 -> Map(?뒤 값 -> 쓰는 페이지들)
const refs = new Map();
const RE = /(?:src|href)\s*=\s*(["'])([^"'#]+?\.(?:js|css|mjs))(\?[^"']*)?\1/gi;
for (const f of pages) {
  const html = read(f).replace(/<!--[\s\S]*?-->/g, '');          // 주석 속 예전 참조는 요청이 아니다
  for (let m; (m = RE.exec(html)); ) {
    const raw = m[2];
    if (/^(https?:)?\/\//i.test(raw)) continue;                   // 외부(CDN) 스크립트는 여기서 보지 않는다
    const abs = raw.startsWith('/') ? raw : '/' + path.posix.normalize(path.posix.join(path.posix.dirname(f), raw));
    const q = m[3] || '';
    if (!refs.has(abs)) refs.set(abs, new Map());
    const byQ = refs.get(abs);
    if (!byQ.has(q)) byQ.set(q, []);
    byQ.get(q).push(f);
  }
}
assert.ok(refs.size > 10, '페이지에서 로컬 자산을 거의 못 찾았다(검사가 헛돈다): ' + refs.size);

const where = (fs_) => fs_[0] + (fs_.length > 1 ? ' 외 ' + (fs_.length - 1) : '');
const HASHED = /^\/maker\/3d\/view\//;                            // 내보낸 뷰어: ?v=내용해시
for (const [p, byQ] of refs) {
  // 1. ?v= 형식과 파일 존재
  for (const [q, fs_] of byQ) {
    const ok = HASHED.test(p) ? /^\?v=[0-9a-f]{6,}$/.test(q) : /^\?v=[0-9]+$/.test(q);
    assert.ok(ok, p + ' 참조의 버전 쿼리가 규칙에 맞지 않는다("' + q + '", ' + where(fs_) + ') — ?v=숫자 여야 한다');
  }
  assert.ok(existsExact(p.slice(1)), p + ' 가 저장소에 없다(대소문자 포함) — ' + where([...byQ.values()][0]));
  // 2. 같은 경로 = 같은 버전
  assert.strictEqual(byQ.size, 1,
    p + ' 가 페이지마다 다른 ?v= 로 참조된다: ' + [...byQ].map(([q, fs_]) => q + ' ← ' + where(fs_)).join(' / '));
}

// sw.js SHELL — 한 줄에 한 항목('…' 또는 "…"), 줄 끝 주석은 무시
const sw = read('sw.js');
const shellSrc = (sw.match(/const SHELL = \[([\s\S]*?)\n\];/) || [])[1];
assert.ok(shellSrc, 'sw.js 에서 SHELL 배열을 찾지 못했다');
const shell = [];
for (const line of shellSrc.split('\n')) {
  const m = line.match(/^\s*(['"])(.+?)\1\s*,?\s*(?:\/\/.*)?$/);
  if (m) shell.push(m[2]);
  else assert.ok(/^\s*(\/\/.*)?$/.test(line), 'SHELL 줄을 해석하지 못했다: ' + line.trim());
}
assert.ok(shell.length > 10, 'SHELL 항목이 너무 적다: ' + shell.length);

// 3. SHELL 의 ?v= 자산 = 페이지가 요청하는 URL
let compared = 0;
for (const u of shell) {
  const m = u.match(/^(\/[^?]+)(\?v=[0-9]+)$/);
  if (!m || !refs.has(m[1])) continue;
  const used = [...refs.get(m[1]).keys()][0];
  assert.strictEqual(m[2], used, 'SHELL ' + u + ' 와 페이지가 요청하는 ' + m[1] + used + ' 가 다르다');
  compared++;
}
assert.ok(compared > 10, 'SHELL 과 페이지를 대조한 항목이 너무 적다: ' + compared);

// 4. SHELL 의 로컬 경로가 저장소에 있고(대소문자 포함) Jekyll 이 내보내는 경로다
// exclude 목록은 줄 단위로 읽는다. 항목 사이에 주석·빈 줄이 있으면 거기서 끊긴다(_config.yml 머리말 참고).
const exclude = new Set(((read('_config.yml').match(/^exclude:[ \t]*\n((?:[ \t]+-[^\n]*\n?)+)/m) || [])[1] || '')
  .split('\n').map((l) => (l.match(/^\s+-\s+(\S+)/) || [])[1]).filter(Boolean));
for (const u of shell) {
  if (!u.startsWith('/')) continue;
  const p = u.split('?')[0].replace(/^\//, '');
  const file = p === '' ? 'index.html' : p.endsWith('/') ? p + 'index.html' : p;
  assert.ok(existsExact(file), 'SHELL 에 있는 ' + u + ' 가 저장소에 없다 (' + file + ')');
  const top = file.split('/')[0];
  assert.ok(!exclude.has(top) && !/^[._]/.test(top), 'SHELL 에 있는 ' + u + ' 는 Jekyll 이 내보내지 않는 경로다(_config.yml exclude / _·. 폴더)');
}

// 5. maker-core ASSET_V = SHELL 의 maker JSON ?v=
const assetV = (read('maker/maker-core.js').match(/const ASSET_V = '([0-9]+)'/) || [])[1];
assert.ok(assetV, 'maker-core.js 에서 ASSET_V 를 찾지 못했다');
const makerJson = shell.filter((u) => /^\/maker\/[a-z]+\.json\?v=/.test(u));
assert.ok(makerJson.length >= 3, 'SHELL 에 maker JSON 이 3개 미만이다');
for (const u of makerJson) assert.ok(u.endsWith('?v=' + assetV), u + ' 가 maker-core ASSET_V(' + assetV + ')와 다르다');

// 6. 외부 CDN 스크립트 고정. 배포 대상 = _config.yml exclude 와 _·. 폴더를 뺀 전부다.
//    위의 htmlFiles() 는 legacy/ 를 건너뛰지만 legacy/ 는 exclude 에 없어 실제로 배포되므로, 여기서는 그 목록을 쓰지 않고 따로 훑는다.
// (섹션 4 의 exclude 정규식은 첫 항목만 잡으므로 쓰지 않고, exclude: 블록의 "- 이름" 줄을 전부 읽는다.)
const cfgExclude = new Set([...(((read('_config.yml').split(/^exclude:[^\n]*\n/m)[1] || '').split(/^(?=\S)/m)[0]).matchAll(/^\s+-\s+(\S+)/gm))].map((m) => m[1]));
assert.ok(cfgExclude.has('docs') && cfgExclude.has('tools') && cfgExclude.has('sql'), '_config.yml exclude 를 읽지 못했다: ' + [...cfgExclude]);
function deployedHtml(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (/^[._]/.test(e.name) || (dir === '' && cfgExclude.has(e.name))) continue;
    const rel = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...deployedHtml(rel));
    else if (e.name.endsWith('.html')) out.push(rel);
  }
  return out;
}
// supabase.js(npm 에 실린 원본 파일)만 허용한다. jsDelivr 의 supabase.min.js 는 원본 앞에 머리말을 붙여 즉석에서 만드는 파일이라
// jsDelivr 자신이 SRI 를 쓰지 말라고 안내한다(원본과 unpkg 에서 바이트가 같은 supabase.js 는 해시가 안정적이다).
const SUPA = /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@(\d+\.\d+\.\d+)\/dist\/umd\/supabase\.js$/;
const deployed = deployedHtml('');
const supaTags = [];
for (const f of deployed) {
  const html = read(f).replace(/<!--[\s\S]*?-->/g, '');
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!src || !/^(https?:)?\/\//i.test(src)) continue;
    assert.ok(/@\d+\.\d+\.\d+(?:[-+][\w.]+)?\//.test(src), f + ': 외부 스크립트가 정확한 버전이 아니다(@2 같은 부동 태그 금지): ' + src);
    const integrity = (tag.match(/\bintegrity\s*=\s*["'](sha(?:256|384|512)-[A-Za-z0-9+/]+=*)["']/i) || [])[1];
    assert.ok(integrity, f + ': 외부 스크립트에 integrity(SRI)가 없다: ' + src);
    assert.ok(/\bcrossorigin\b/i.test(tag), f + ': integrity 가 있는 외부 스크립트에 crossorigin 이 없다(없으면 브라우저가 SRI 를 검사하지 못한다): ' + src);
    if (/supabase-js/.test(src)) supaTags.push({ f, src, integrity });
  }
}
assert.ok(supaTags.length >= 15, 'supabase-js 태그를 거의 못 찾았다(검사가 헛돈다): ' + supaTags.length);
const supaUrls = new Set(supaTags.map((t) => t.src));
const supaSri = new Set(supaTags.map((t) => t.integrity));
assert.ok(supaUrls.size === 1 && SUPA.test([...supaUrls][0]), 'supabase-js 는 모든 페이지가 같은 고정 URL(.../supabase-js@x.y.z/dist/umd/supabase.js)을 써야 한다: ' + [...supaUrls].join(' , '));
assert.strictEqual(supaSri.size, 1, 'supabase-js 의 integrity 가 페이지마다 다르다: ' + [...supaSri].join(' , '));
const supaVer = [...supaUrls][0].match(SUPA)[1];
// sw.js SHELL 의 CDN URL 도 같은 주소여야 한다(다르면 프리캐시가 다른 키로 저장된다). 부동 태그도 남기지 않는다.
const shellCdn = shell.filter((u) => /^https?:\/\//.test(u));
assert.ok(shellCdn.every((u) => /@\d+\.\d+\.\d+\//.test(u)), 'sw.js SHELL 에 부동 CDN 주소가 있다: ' + shellCdn.join(' , '));
assert.ok(shellCdn.includes([...supaUrls][0]), 'sw.js SHELL 의 supabase-js 주소가 페이지가 요청하는 ' + [...supaUrls][0] + ' 와 다르다');
// CSP 가 허용하는 supabase-js 버전 경로도 같아야 한다(다르면 해당 페이지에서 스크립트가 막힌다).
for (const f of deployed) {
  const csp = (read(f).match(/<meta[^>]*Content-Security-Policy[^>]*>/i) || [''])[0];
  for (const m of csp.matchAll(/supabase-js@([^/\s'"]+)\//g)) assert.strictEqual(m[1], supaVer, f + ': CSP 의 supabase-js 버전(' + m[1] + ')이 태그의 ' + supaVer + ' 와 다르다');
}

// 7. 비배포 가정 = _config.yml exclude (ROOT_SKIP 의 legacy/ 가 exclude 에 없어 /legacy/ 로 배포된 적이 있다)
const NOT_DEPLOYED = [...ROOT_SKIP, 'maker/moodboard.html'];
for (const p of NOT_DEPLOYED) assert.ok(exclude.has(p), p + ' 는 비배포로 가정하는데 _config.yml exclude 에 없다 — Jekyll 이 사이트로 내보낸다');

console.log('asset-versions OK — 자산 ' + refs.size + '개 경로 · 페이지 ' + pages.length + '개 · SHELL ' + shell.length + '개(대조 ' + compared + ') · ASSET_V ' + assetV + ' · CDN supabase-js@' + supaVer + ' ' + supaTags.length + '쪽 SRI');
