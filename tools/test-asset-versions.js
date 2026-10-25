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
const exclude = new Set([...((read('_config.yml').match(/^exclude:\s*\n((?:\s+-\s+\S+\s*\n?)+)/m) || [])[1] || '').matchAll(/-\s+(\S+)/g)].map((m) => m[1]));
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

console.log('asset-versions OK — 자산 ' + refs.size + '개 경로 · 페이지 ' + pages.length + '개 · SHELL ' + shell.length + '개(대조 ' + compared + ') · ASSET_V ' + assetV);
