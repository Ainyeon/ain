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
assert.ok(sw.includes("'/maker/3d/partner-boot.js?v=2'") && page.includes('/maker/3d/partner-boot.js?v=2'), 'partner-boot.js 는 페이지와 sw SHELL 에 같은 주소로');
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
  assert.ok(cr(c.accentLine, '#5C5850') >= 4.5, id + ': 비활성 [만들기](accentLine 면 + 보조 글자색) 대비 4.5 이상');
  assert.ok(Array.isArray(c.hosts) && c.hosts.every((o) => /^https:\/\/[a-z0-9.-]+$/.test(o)), id + ': hosts 는 https 출처만(경로 없음)');
  assert.ok((c.hide || []).every((k) => k === 'tools'), id + ': hide 는 tools 만');
}
// 물량표 CSV — 엑셀 한글(BOM) · 수식으로 읽힐 글자 방어
assert.ok(js.includes("'\\ufeff'") && /\^\(\[=\+@\]\|-\\D\)/.test(js), 'CSV 는 BOM 을 붙이고 = + @ - 로 시작하는 글자를 막는다');

// 사용법 창(2026-10-29) — 첫 방문 안내는 처음 온 방문에만, 임베드·주소·로그인 왕복은 건드리지 않는다
assert.ok(/id="stHelp"/.test(page) && /<dialog[^>]*id="stTour"/.test(page) && /id="stTourX"/.test(page) && /id="stTourPrev"/.test(page) && /id="stTourNext"/.test(page), '사용법 단추·창이 있다');
{
  const tour = page.slice(page.indexOf('id="stTour"'), page.indexOf('</dialog>', page.indexOf('id="stTour"')));
  const ps = (tour.match(/class="st-tour-p"/g) || []).length;
  assert.ok(ps === 3 && (tour.match(/<span class="st-tour-dots/g) || []).length === 1 && (tour.match(/<span(?: class="on")?><\/span>/g) || []).length === ps, '사용법은 단계 셋 · 점 셋(단계는 셋 이하)');
  assert.ok(/<\/div>\s*<\/div>\s*<div class="st-tour-foot">/.test(tour), '[이전][다음]은 스크롤 영역(.st-dlg-in) 밖에 둔다(낮은 화면에서도 보인다)');
  assert.ok(!/role="group"/.test(tour) && (tour.match(/class="st-vh">3단계 중 \d단계/g) || []).length === ps, '단계 위치는 눈에 안 보이는 글로 읽힌다');
  const ts = js.slice(js.indexOf('function tourStep'), js.indexOf('function openTour'));
  assert.ok(ts.indexOf('.focus(') > 0 && ts.indexOf('.focus(') < ts.indexOf('prev.hidden'), '[이전]을 숨기기 전에 초점을 옮긴다');
  for (const m of tour.matchAll(/<img src="([^"]+)"([^>]*)>/g)) assert.ok(fs.existsSync(path.join(__dirname, '..', m[1].slice(1))) && /width="\d+" height="\d+"/.test(m[2]), '사용법 그림: 있는 파일 · 크기 속성 ' + m[1]);
}
{
  const i = js.indexOf('function tourOnce');
  const end = js.indexOf('async function myJobs', i);
  const whole = js.slice(i, end);                               // tourOnce 전체
  const fn = js.slice(i, js.indexOf('openTour(', i));            // 자동으로 열기 직전까지
  assert.ok(i > 0 && /data-embed/.test(fn) && /\bhash\b/.test(fn) && /\bback\b/.test(fn) && fn.includes('TOUR_KEY'), 'tourOnce: 임베드·주소(조각)·로그인 왕복이면 자동으로 열지 않고, 한 번 열면 기록한다');
  assert.ok(/else tourOnce\(hash, back\);\s*tell\('ready'\)/.test(js), '다른 갈래(작업·예시·도구)가 없을 때만 첫 방문 안내를 부른다');
  assert.ok(/openTour\(false\)/.test(whole) && /function openTour\(push\)[^\n]*openSheet\(\$\('stTour'\), push\)/.test(js), '자동으로 여는 창은 기록을 쌓지 않는다(조작 없는 pushState 는 뒤로가기에서 건너뛴다)');
  assert.ok(/history\.state && history\.state\.sheet/.test(js), '창을 닫을 때 기록을 걷는 것은 현재 기록이 창이 쌓은 것일 때만');
  assert.ok(js.includes("'maker_guide_studio_v1'"), '저장 이름은 다른 도구와 같은 규칙(maker_guide_<도구>_v1)');
}
assert.ok(rules.some(([s, b]) => /html\[data-partner\] \.st-wiz \.action-bar/.test(s) && /html\[data-embed\] \.st-wiz \.action-bar/.test(s) && /bottom:/.test(b)), '파트너·임베드 폰: 만들기 바는 탭바 자리(70px)가 아니라 바닥에 붙는다');
assert.ok(/html\[data-embed\] \.page-head > div:first-child/.test(css) && !/html\[data-embed\] \.page-head\s*[,{]/.test(css), '임베드는 제목만 가리고 [사용법]은 남긴다');

// 다듬기(2026-10-29) — 움직임 토큰 · 눌림 · 흐름 · 주소 유지가 돌아오지 않게
{
  const raw = read('maker/3d/studio.css');
  assert.ok(/--t-fast:\s*100ms/.test(raw) && /--t-base:\s*200ms/.test(raw) && /--t-slow:\s*350ms/.test(raw) && /--ease:\s*cubic-bezier/.test(raw), '움직임 토큰(--t-fast·--t-base·--t-slow·--ease)이 있다');
  {
    const bare = css.replace(/animation:\s*st-run[^;]*;/g, '').split('\n').filter((l) => /transition|animation/.test(l)).join('\n').replace(/calc\(var\(--i, 0\) \* 30ms\)/g, '');
    assert.ok(!/(?<![\w.-])\d*\.?\d+m?s\b/.test(bare.replace(/:root[^}]*}/g, '')), 'studio.css 전환·애니메이션 시간은 토큰으로(숫자 리터럴 금지 — 무한 쓸기 1.6s 와 번호 줄 지연 30ms 만 예외)');
  }
  assert.ok(!/still\(\) \? 0 : 200|\}, 400\)/.test(js), 'studio.js 타이머는 CSS 토큰을 따라간다(200·400 리터럴 금지)');
  assert.ok(/\.st-th\.kept\s*\{/.test(css) && /\.st-steps\.stop li\[data-s=now\]::after/.test(css) && /::backdrop/.test(css) && /\.st-live-box\[aria-busy=true\]::after/.test(css), '번호 줄 유지·멈춘 막대·창 뒷막·큰 판 로딩 신호 규칙');
  assert.ok(/:active/.test(css) && /-webkit-tap-highlight-color/.test(css), '눌림(:active) 반응이 있다');
  assert.ok(!/늦어질 수 있음/.test(js) && !/' — ' \+ e\.message/.test(js) && !/\(완료\) 3D 스튜디오/.test(js), '얼버무린 문구·영어 원문 노출·고정 제목 문자열이 없다');
  assert.ok(/const keepQ = /.test(js) && (js.match(/keepQ\(\)/g) || []).length >= 4, '다시 쓰는 주소에 파트너·임베드 표시를 남긴다(새로고침에서 호스트 얼굴이 사라지지 않게)');
  assert.ok(/S\.sending/.test(js) && /beforeunload[^\n]*S\.busy \|\| S\.sending/.test(js), '올리는 중(만들기·사진 손질)에는 떠날 때 경고');
  assert.ok(/ain-pt-/.test(read('maker/3d/partner-boot.js')) && /#\[0-9a-f\]\{6\}/i.test(read('maker/3d/partner-boot.js')), '색 캐시는 검증된 #rrggbb 셋만 읽는다');
  assert.ok(/const lostLogin = /.test(js) && /42501/.test(js) && /lostLogin\(r\.error\)/.test(js), '로그인 풀림은 서버가 실제로 내는 거절(42501)로 알아본다 — login_required 문자열만 기다리지 않는다');
  assert.ok(/setItem\('ain-job'/.test(js.slice(js.indexOf('async function login'), js.indexOf('async function login') + 1400)) && !/setItem\('ain-job'/.test(js.slice(js.indexOf('function runView'), js.indexOf('function runView') + 900)), '작업 번호는 로그인 단추를 누른 때 저장한다(화면을 열 때 쓰면 끝난 작업·오래 걸린 작업에서 어긋난다)');
  assert.ok(js.indexOf("s.get('p')))) resume()") > 0 && js.indexOf("s.get('p')))) resume()") < js.indexOf('else if (back && S.session && savedJob)'), '맡겨 둔 도면 복원이 저장된 작업 번호보다 먼저');
  assert.ok(/S\.toolJob/.test(js) && /사진 다시 고르기/.test(js) && /내 작업 보기/.test(js), '실패 뒤 단추는 도면·사진 손질·내 작업을 가려서 보낸다');
  assert.ok(/const off = \(bad\)/.test(js) && /removeProperty\(k\)/.test(js) && /removeItem\('ain-pt-'/.test(js), '파트너 검증이 실패하면 먼저 건 캐시 색과 캐시를 걷는다');
  assert.ok(/S\.bt = setTimeout/.test(js) && /T\.wait/.test(js), '큰 판 로딩 신호의 대기는 타이머로(동작 줄이기에서도 번쩍이지 않게)');
  assert.ok(/closest\('#_ain_in'\)/.test(js) && /keepQ\(\)/.test(js.slice(js.indexOf("closest('#_ain_in')") - 200, js.indexOf("closest('#_ain_in')") + 300)), '파트너·임베드 주소의 헤더 로그인은 허용된 돌아올 주소(스튜디오 로그인)로 보낸다');
  const wiz = page.slice(page.indexOf('id="stIn"'), page.indexOf('</section>', page.indexOf('id="stIn"')));
  assert.ok(/id="stDropF"/.test(wiz) && /id="stFileF"/.test(wiz) && /st-fold-in/.test(wiz), '드롭 칸·파일 줄은 접히는 칸 안에');
}

// 말로 시키기(2026-10-29) — ask.js 는 페이지와 sw SHELL 에 같은 주소로, 카드는 임베드에서 숨긴다
assert.ok(page.includes('/maker/3d/ask.js?v=1') && sw.includes("'/maker/3d/ask.js?v=1'") && /id="stAskForm"/.test(page), 'ask.js 와 말로 시키기 카드');
assert.ok(/html\[data-embed\] \.st-ask\s*\{\s*display:\s*none/.test(css), '임베드(호스트 화면 안)에서는 말로 시키기 카드를 숨긴다');

console.log('test-studio-live: OK');
