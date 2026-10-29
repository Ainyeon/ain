// 3D 스튜디오 예시 모형(/maker/3d/view/) — 뷰어 내보내기와 장면 자료가 사이트 규칙을 지키는지.
// 뷰어 원본은 엔진(hvac-space-3d/assets/commercial3d/web/src.html)이고 여기 파일은 export_site.py 생성물이다(손으로 고치지 않는다).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const page = read('maker/3d/index.html'), sw = read('sw.js');
for (const m of page.matchAll(/\/maker\/3d\/studio\.(?:css|js)\?v=\d+/g)) assert.ok(sw.includes("'" + m[0] + "'"), 'sw SHELL 에 ' + m[0]);
assert.ok(!/\.innerHTML\s*[+=]|insertAdjacentHTML\(/.test(read('maker/3d/studio.js')), 'studio.js 는 textContent 만');

const view = read('maker/3d/view/index.html');
assert.ok(/Content-Security-Policy[^>]*script-src 'self';/.test(view), '뷰어 문서 CSP');
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(view), '뷰어 문서에 인라인 스크립트 없음');
for (const f of ['index.html', 'viewer.js', 'viewer.css', 'mode.js']) assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(read('maker/3d/view/' + f)), f + ': 외부 주소 없음');
const lib = read('maker/3d/view/viewer.js').match(/from '\.\/(lib\/three-[\d.]+)\/three\.module\.min\.js'/);
assert.ok(lib, 'three 는 같은 출처 lib/ 에서');
for (const f of ['three.module.min.js', 'OrbitControls.js']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'maker/3d/view', lib[1], f)), lib[1] + '/' + f);
assert.ok(/from '\.\/three\.module\.min\.js'/.test(read('maker/3d/view/' + lib[1] + '/OrbitControls.js')), 'OrbitControls 는 같은 폴더의 three 를');

const sceneText = read('maker/3d/view/apartment.json'), scene = JSON.parse(sceneText);
assert.ok(scene.data && scene.checks, '장면 = {data, checks}');
assert.ok(!/\/Users|[\w-]+\.(?:json|py|md|csv|png|jpe?g|pdf|dwg|dxf|txt|html)\b/i.test(sceneText), '장면에 로컬 경로·파일 이름 없음');
// 공개 예시에는 작업 메모·내부 도구 이름·제조사 모델 코드를 싣지 않는다(export_site.py --scene 이 비운다)
assert.ok(!/대표|macOS|hvac-|home3d|내부 자료|조합 미확인|M-Q\d|RPUQ|LATS|DVM/.test(sceneText), '장면에 작업 메모·모델 코드 없음');
const keys = Object.keys(scene.data);
assert.ok(keys.length && keys.every((k) => scene.checks[k] && scene.data[k].ac_units.length && scene.data[k].rooms.length), '장면마다 실·실내기·검사 결과');
for (const k of keys) assert.ok(scene.checks[k].counts.PASS > 0 && scene.checks[k].counts.FAIL === 0, k + ' 검사 통과·FAIL 0');
// 내보낸 뷰어는 늘 embed(단독 화면의 목록·검사·출처 시트는 공개 주소에 두지 않는다)
assert.ok(/^document\.documentElement\.classList\.add\('embed'\)/.test(read('maker/3d/view/mode.js')), 'mode.js 는 늘 embed');

// 내 작업 장면은 부모가 말로 넘긴다(scene=@host) — 뷰어는 같은 출처 부모의 말만 듣는다
const vjs = read('maker/3d/view/viewer.js');
assert.ok(vjs.includes("e.origin === location.origin && e.source === parent") && vjs.includes("e.origin !== location.origin || e.source !== parent"), '뷰어 메시지 수신에 출처 확인');

// 큰 판 + 번호 줄(2026-10-06) — 끊긴 id · 없는 그림 · 토큰 밖 색 · 스크롤 갇힘이 돌아오지 않게
const js = read('maker/3d/studio.js'), css = read('maker/3d/studio.css').replace(/\/\*[\s\S]*?\*\//g, '');
for (const m of js.matchAll(/\$\('(st\w+)'\)/g)) assert.ok(page.includes('id="' + m[1] + '"'), 'index.html 에 #' + m[1]);
for (const m of js.matchAll(/'((?:\/maker\/3d\/)?\w+\.webp)'/g)) assert.ok(fs.existsSync(path.join(__dirname, '..', m[1].startsWith('/') ? m[1] : 'maker/3d/demo/' + m[1])), '그림 ' + m[1]);
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css.replace(/#st\w+/g, '')) && !/gradient/.test(css), 'studio.css 는 토큰만(날 색·그라디언트 없음)');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
const sel = (re) => rules.filter(([, body]) => re.test(body)).map(([s]) => s);
assert.deepStrictEqual(sel(/touch-action:\s*(?!auto|manipulation|pan-y\b)/), ['.st-canvas canvas + canvas'], '손가락을 잡는 곳(touch-action)은 칠 캔버스 한 장만');
assert.deepStrictEqual(sel(/overscroll-behavior(?:-y|-block)?:\s*[^;}]*\b(?:contain|none)/), ['.st-dlg-in'], '세로 스크롤을 가두는 곳은 창 안뿐');
assert.ok(rules.length > 80 && [...js.matchAll(/\$\('(st\w+)'\)/g)].length > 40, '위 단언들이 빈 채로 통과하지 않는다');
assert.ok(!/replaceState\(null/.test(js), '기록 상태를 null 로 덮지 않는다(뒤로가기가 넣기 + 파일 비움이 된다)');
assert.ok(js.indexOf('if (x === prev) return') > 0 && js.indexOf('if (x === prev) return') < js.indexOf('++S.tok'), '같은 것을 다시 올릴 때 토큰을 올리지 않는다(열리던 내 도면 층이 지워진다)');
assert.ok(!/redirectTo:[^\n]*#/.test(js), '로그인 뒤 돌아올 주소에 조각(#)을 싣지 않는다(토큰 자리)');
assert.ok(!/redirectTo:[^\n]*\?/.test(js), '로그인 뒤 돌아올 주소에 쿼리도 싣지 않는다(허용 주소 목록과 글자까지 맞아야 한다) — 표시는 저장소로');
assert.ok(vjs.includes("touchAction = 'pan-y'") && vjs.includes('enableZoom: false, enablePan: false'), '뷰어: 세로 밀기·휠은 페이지로');
assert.strictEqual((page.replace(/#[0-9A-F]{6}/gi, '').match(/3D/g) || []).length, 3, "화면 글의 '3D' 는 title·og:title·h1 뿐");

// 공동 브랜드(파트너) · 임베드 — 설정 파일이 런타임 검증(studio.js partner())을 통과하고, 알림은 허용한 사이트에만 간다
assert.ok(sw.includes("'/maker/3d/partner-boot.js?v=1'") && page.includes('/maker/3d/partner-boot.js?v=1'), 'partner-boot.js 는 페이지와 sw SHELL 에 같은 주소로');
assert.ok(/data-partner/.test(read('maker/3d/partner-boot.js')) && !/innerHTML|eval\(/.test(read('maker/3d/partner-boot.js')), 'partner-boot.js 는 속성만 건다');
assert.ok(!/postMessage\([^)]*,\s*['"]\*['"]\s*\)/.test(js), "임베드 알림을 '*' 로 보내지 않는다(허용한 사이트에만)");
assert.ok(/html\[data-partner\] \.tnav/.test(css) && /html\[data-embed\] \.page-head/.test(css), '파트너·임베드 화면은 에인연 메뉴를 가린다');
const lum = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
const partners = fs.readdirSync(path.join(__dirname, '..', 'maker/3d/partners')).filter((f) => f.endsWith('.json'));
assert.ok(partners.length >= 1, '파트너 설정이 하나는 있다');
for (const f of partners) {
  const c = JSON.parse(read('maker/3d/partners/' + f)), id = f.replace(/\.json$/, '');
  assert.ok(/^[a-z0-9-]{1,32}$/.test(id), id + ': 이름은 소문자·숫자·-');
  assert.ok(typeof c.name === 'string' && c.name.length > 0 && c.name.length <= 20, id + ': name');
  assert.ok(/^\/maker\/3d\/partners\/[a-z0-9-]+\.svg$/.test(c.logo) && fs.existsSync(path.join(__dirname, '..', c.logo.slice(1))), id + ': logo 파일');
  assert.ok(!/<script|onload=|href="http/i.test(read(c.logo.slice(1))), id + ': 로고는 그림만(스크립트·바깥 주소 없음)');
  assert.ok(/^https:\/\//.test(c.home), id + ': home 은 https');
  for (const k of ['accent', 'accentBg', 'accentLine']) assert.ok(/^#[0-9a-f]{6}$/i.test(c[k]), id + ': ' + k);
  assert.ok(cr(c.accent, '#ffffff') >= 4.5 && cr(c.accent, c.accentBg) >= 4.5, id + ': 강조색 글자 대비 4.5 이상');
  assert.ok(Array.isArray(c.hosts) && c.hosts.every((o) => /^https:\/\/[a-z0-9.-]+$/.test(o)), id + ': hosts 는 https 출처만(경로 없음)');
  assert.ok((c.hide || []).every((k) => k === 'tools'), id + ': hide 는 tools 만');
}
// 물량표 CSV — 엑셀 한글(BOM) · 수식으로 읽힐 글자 방어
assert.ok(js.includes("'\\ufeff'") && /\^\(\[=\+@\]\|-\\D\)/.test(js), 'CSV 는 BOM 을 붙이고 = + @ - 로 시작하는 글자를 막는다');

// 사용법 창(2026-10-29) — 첫 방문 안내는 처음 온 방문에만, 임베드·주소·로그인 왕복은 건드리지 않는다
assert.ok(/id="stHelp"/.test(page) && /<dialog[^>]*id="stTour"/.test(page) && /id="stTourX"/.test(page) && /id="stTourGo"/.test(page), '사용법 단추·창이 있다');
{
  const i = js.indexOf('function tourOnce');
  const fn = js.slice(i, js.indexOf('openSheet(', i));          // 자동으로 열기 직전까지
  const i0 = js.indexOf('openSheet(', i);
  assert.ok(i > 0 && /data-embed/.test(fn) && /\bhash\b/.test(fn) && /\bback\b/.test(fn) && fn.includes('TOUR_KEY'), 'tourOnce: 임베드·주소(조각)·로그인 왕복이면 자동으로 열지 않고, 한 번 열면 기록한다');
  assert.ok(/else tourOnce\(hash, back\);\s*tell\('ready'\)/.test(js), '다른 갈래(작업·예시·도구)가 없을 때만 첫 방문 안내를 부른다');
  assert.ok(/openSheet\(\$\('stTour'\), false\)/.test(fn + js.slice(i0, i0 + 120)), '자동으로 여는 창은 기록을 쌓지 않는다(조작 없는 pushState 는 뒤로가기에서 건너뛴다)');
  assert.ok(/history\.state && history\.state\.sheet/.test(js), '창을 닫을 때 기록을 걷는 것은 현재 기록이 창이 쌓은 것일 때만');
  assert.ok(js.includes("'maker_guide_studio_v1'"), '저장 이름은 다른 도구와 같은 규칙(maker_guide_<도구>_v1)');
}
assert.ok(rules.some(([s, b]) => /html\[data-partner\] \.st-wiz \.action-bar/.test(s) && /html\[data-embed\] \.st-wiz \.action-bar/.test(s) && /bottom:/.test(b)), '파트너·임베드 폰: 만들기 바는 탭바 자리(70px)가 아니라 바닥에 붙는다');
assert.ok(/html\[data-embed\] \.page-head > div:first-child/.test(css) && !/html\[data-embed\] \.page-head\s*[,{]/.test(css), '임베드는 제목만 가리고 [사용법]은 남긴다');

console.log('test-studio-live: OK');
