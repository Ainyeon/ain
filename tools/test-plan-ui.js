// 2D 편집기(maker/3d/plan/{index.html, plan.css, app.js, view2d.js, tools.js, minimap.js}) 정적 점검 + 순수 계산 시험.
// 필수 id·단축키 표·innerHTML 금지·토큰만 쓰는 CSS·CSP·동적 import 이름·화면 변환 수식. 마우스·화면 동작은 브라우저(playwright)로 따로 본다.
// 실행: node tools/test-plan-ui.js. 변이 시험용으로 PLAN_UI_DIR 로 다른 사본을 가리킬 수 있다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = process.env.PLAN_UI_DIR || path.join(__dirname, '..', 'maker/3d/plan');
const ROOT = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1'); // 주석 제거(문자열 속 // 주소는 건드리지 않게 ': 앞은 남긴다)
const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= e, `${m || ''} ${a} ≠ ${b} (±${e})`);

(async () => {
  const FILES = ['index.html', 'plan.css', 'app.js', 'view2d.js', 'tools.js', 'minimap.js'];
  for (const f of FILES) assert.ok(fs.existsSync(path.join(DIR, f)), f + ' 가 있어야 한다');

  /* ===== 1. 파일 머리 주석(역할 한 줄) ===== */
  for (const f of ['app.js', 'view2d.js', 'tools.js', 'minimap.js']) assert.ok(/^\/\/ \S/.test(rd(f)), f + ' 맨 위 한 줄 역할 주석');
  assert.ok(/^\/\* \S/.test(rd('plan.css')), 'plan.css 맨 위 역할 주석');

  /* ===== 2. 필수 id (index.html) ===== */
  const html = rd('index.html');
  const IDS = ['plApp', 'plTop', 'plLogo', 'plUndo', 'plRedo', 'plTitle', 'plMenu', 'plEstimate', 'plExport', 'plImport', 'plNew', 'plMore', 'plSaveState', 'plSave', 'plExit',
    'plRail', 'plPanel', 'plPanelTitle', 'plPanelBody', 'plPanelToggle', 'plStage', 'plCanvas', 'plView3d', 'plHint', 'plHintName', 'plHintText', 'plMode2d', 'plMode3d', 'plViews', 'plV2', 'plV3', 'plV4',
    'plLabels', 'plGrid', 'plLock', 'plSnap', 'plZoomIn', 'plZoomOut', 'plFit', 'plUnitMm', 'plUnitFt',
    'plSide', 'plSideToggle', 'plMini', 'plFloorSel', 'plFloorAdd', 'plFloorName', 'plFloorH', 'plAreaNet', 'plAreaGross', 'plArea', 'plSlab', 'plWallA', 'plWallAn', 'plFloorA', 'plFloorAn', 'plUnder', 'plProps', 'plToast', 'plLive', 'plFileJson', 'plFileImg'];
  for (const id of IDS) assert.ok(new RegExp(`id="${id}"`).test(html), 'id ' + id);
  assert.strictEqual(new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])).size, [...html.matchAll(/ id="([^"]+)"/g)].length, 'id 중복 없음');
  // 왼쪽 줄: 패널 이름 여섯 개(panels.js 의 mountPanel 이름과 같다), 글자 이름
  const rail = [...html.matchAll(/<button[^>]*data-panel="(\w+)"[^>]*>([^<]+)<\/button>/g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(rail, [['templates', '템플릿'], ['draw', '도면 그리기'], ['products', '제품'], ['materials', '마감재'], ['library', '설계형 라이브러리'], ['resources', '리소스 관리']], '왼쪽 줄 여섯 칸');
  // 상단: 없는 기능(렌더샷·갤러리·시방서)을 단추로 두지 않는다. 있는 기능의 이름
  for (const t of ['견적 물량표', '도면 내보내기 (.json)', '도면 불러오기', '새로 만들기', '실행 취소', '다시 실행', '저장', '나가기']) assert.ok(html.includes('>' + t + '<'), '상단 이름 ' + t);
  for (const t of ['렌더샷', '갤러리', '시방서']) assert.ok(!html.includes(t), t + ' 단추를 만들지 않는다');
  // 모든 단추는 <button> 이고 type 이 있다. 이름 없는 단추 없음(글자 또는 aria-label)
  for (const m of html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)) { assert.ok(/type="button"/.test(m[1]), '단추 type: ' + m[0].slice(0, 60)); assert.ok(m[2].trim() || /aria-label="[^"]+"/.test(m[1]), '단추 이름: ' + m[0].slice(0, 60)); }
  // 3D 전환 단추 글자는 예외, 그 밖의 문구에 3D 를 자랑처럼 쓰지 않는다(제목·설명·안내)
  const visible = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '\n');
  assert.deepStrictEqual([...visible.matchAll(/^.*3D.*$/gm)].map((m) => m[0].trim()).filter((l) => !/^3D$/.test(l) && !/3D 스튜디오$/.test(l)), [], '3D 글자는 전환 단추와 제품 이름(3D 스튜디오)에만');
  assert.ok(/<meta name="viewport" content="[^"]*width=device-width/.test(html) && /<html lang="ko">/.test(html), '뷰포트·언어');
  assert.ok(/<a class="ed-skip" href="#plCanvas"/.test(html), '본문 건너뛰기 링크');
  assert.ok(/<canvas id="plCanvas" tabindex="0" role="application" aria-label="[^"]+"/.test(html), '캔버스 키보드 초점·이름');
  assert.ok(/id="plToast" role="status" aria-live="polite"/.test(html) && /id="plLive"[^>]*aria-live="polite"/.test(html), '알림 영역');

  /* ===== 3. CSP · 스크립트 · 외부 자원 ===== */
  const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  assert.ok(/script-src 'self'(;|$)/.test(csp) && !/script-src[^;]*unsafe/.test(csp), "script-src 'self' (인라인·외부 금지)");
  assert.ok(/style-src 'self' 'unsafe-inline'/.test(csp) && /img-src 'self' data: blob:/.test(csp) && /object-src 'none'/.test(csp), 'CSP 나머지');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[^<]/.test(html), '인라인 스크립트 없음');
  assert.ok(!/https?:\/\/(?!localhost)/.test(strip(html).replace(/<meta[^>]*>/g, '')), '외부 주소 없음');
  for (const m of html.matchAll(/(?:href|src)="(\/[^"?#]+)(?:\?[^"]*)?"/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1].slice(1))), '연결 파일 있음 ' + m[1]);

  /* ===== 4. DOM 안전: innerHTML 계열·eval 금지 (주석 뺀 코드에서) ===== */
  for (const f of ['app.js', 'view2d.js', 'tools.js', 'minimap.js']) {
    const code = strip(rd(f));
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|setTimeout\s*\(\s*['"`]/.test(code), f + ': innerHTML·eval 금지');
    assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(\s*['"`]https?:/.test(code), f + ': 외부 요청 금지');
  }
  // view2d.js·tools.js 가 import 해도 DOM 을 건드리지 않는지는 아래 6번에서 node 로 실제 import 해서 본다(document 가 없으면 바로 터진다)

  /* ===== 5. CSS: 토큰만 ===== */
  const cssRaw = rd('plan.css'), css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'hex 리터럴 없음');
  assert.ok(!/\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/.test(css), 'rgb/hsl 리터럴 없음');
  assert.ok(!/gradient/.test(css), '그라디언트 없음');
  assert.ok(!/999px/.test(css), '999px 없음');
  const noTokDef = css.split('\n').filter((l) => !/^:root \{ --t-fast/.test(l)).join('\n');
  assert.ok(!/\b\d+(\.\d+)?m?s\b(?![\w-])/.test(noTokDef.replace(/\d+ms/g, (m) => m)) || !/[:\s,(]\d+(\.\d+)?m?s[\s;,)]/.test(noTokDef), '시간 리터럴(ms) 없음 — 토큰 정의 한 줄만 예외');
  assert.ok(/^:root \{ --t-fast: 100ms; --t-base: 200ms; --t-slow: 350ms; --ease: /m.test(css), '시간 토큰 정의는 shell.css 와 같은 값');
  for (const m of css.matchAll(/font-size:\s*([^;}]+)/g)) assert.ok(/^var\(--fs-[1-4]\)$/.test(m[1].trim()), 'font-size 는 토큰: ' + m[1]);
  for (const m of css.matchAll(/(?<![\w-])border-radius:\s*([^;}]+)/g)) assert.ok(m[1].trim().split(/\s+/).every((v) => v === '0' || /^var\(--r-[123]\)$/.test(v)), 'border-radius 는 토큰: ' + m[1]);
  for (const m of css.matchAll(/(?<![\w-])box-shadow:\s*([^;}]+)/g)) assert.ok(/^(none|var\(--sh-[12]\)|inset 0 0 0 1px var\(--c-[a-z-]+\))$/.test(m[1].trim()), 'box-shadow 는 토큰: ' + m[1]);
  for (const m of css.matchAll(/(?<![\w-])(color|background|background-color|border-color|outline-color|fill|stroke|accent-color):\s*([^;}]+)/g)) assert.ok(!/^[a-z]+$/.test(m[2].trim()) || /^(transparent|none|inherit|currentColor|auto)$/.test(m[2].trim()), `${m[1]} 이름 색 금지: ${m[2]}`);
  // 쓰는 변수는 전부 정의돼 있다(design-tokens.css 또는 plan.css)
  const defined = new Set([...fs.readFileSync(path.join(ROOT, 'assets/css/design-tokens.css'), 'utf8').matchAll(/(--[\w-]+)\s*:/g), ...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const m of css.matchAll(/var\((--[\w-]+)/g)) assert.ok(defined.has(m[1]), '정의되지 않은 변수 ' + m[1]);
  assert.ok(/prefers-reduced-motion/.test(css), '동작 줄이기');
  assert.ok(/:focus-visible/.test(css), '초점 링');
  assert.ok(/@media \(max-width: 768px\)/.test(css) && /\.ed-panel\s*\{\s*position: fixed/.test(css.replace(/\n\s+/g, ' ').replace(/\s+/g, ' ')) || /position: fixed; z-index: 20; left: 0; right: 0; bottom: 56px/.test(css), '폰: 도구 패널은 아래 시트');
  assert.ok(/\.ed-app\.no-side \.ed-side \{ translate: 100% 0; visibility: hidden; \}/.test(css), '폰: 오른쪽 패널은 접힘');
  assert.ok(/\[hidden\] \{ display: none !important; \}/.test(css), 'hidden 속성 존중');
  assert.deepStrictEqual([...css.matchAll(/(?<![\w-])\.pl-[\w-]+/g)].map((m) => m[0]), ['.pl-head'], 'panels.css 의 pl- 클래스와 겹치지 않는다(이 편집기는 ed- 접두) — 폰 시트에서 판의 제목 줄을 감추는 한 곳만 예외');
  // 칸 크기: 위 56 · 줄 72 · 패널 280 · 오른쪽 268
  assert.ok(/--ed-top: 56px; --ed-rail: 72px; --ed-panel: 280px; --ed-side: 268px/.test(css), '캡처 치수');

  /* ===== 6. 코드 약속: 동적 import · 저장소 · 주소 · 키 ===== */
  const app = strip(rd('app.js'));
  for (const [what, re] of [['panels.js 동적 import', /import\('\.\/panels\.js'\)/], ['estimate.js 동적 import', /import\('\.\/estimate\.js'\)/], ['view3d.js 동적 import', /import\('\.\/view3d\.js'\)/], ['mountPanel 호출', /mountPanel\(name, body, ctx\)/], ['openEstimate 호출', /openEstimate\(ctx\)/], ['createView3D 호출', /createView3D\(\$\('plView3d'\), store/],
    ['라이브러리 import', /from '\.\/library\.js'/], ['저장', /lib\.savePlan\(/], ['?doc', /get\('doc'\)/], ['?new', /get\('new'\)/], ['?template', /get\('template'\)/], ['?underlay', /get\('underlay'\)/], ['마지막 문서', /lib\.lastPlanId\(\)/], ['나가기 주소', /\/maker\/3d\/projects\//],
    ['저장 안 한 변경 확인', /beforeunload/], ['Ctrl+S', /KeyS/], ['되돌리기 Z', /KeyZ/], ['다시 실행 Y', /KeyY/], ['글쇠 위치로 판정(한글 자판)', /e\.code/], ['잠금', /state\.locked/], ['3D 오류를 그대로 안내', /errDialog\('3D 화면을 열지 못했습니다'/], ['패널 오류를 그대로 안내', /패널 파일\(panels\.js\)을 불러오지 못했습니다 · \$\{e\.message\}/], ['빈 문서 3D 안내', /방이 하나 이상 필요합니다/], ['반전·회전 명령', /type: 'mirror', axis: 'x'[\s\S]*type: 'rotate', deg: -90/], ['밑그림 축척', /type: 'setUnderlay'/], ['저장 공간 오류는 알린다', /toast\(e\.message, 'err'\)/]]) assert.ok(re.test(app), '코드: ' + what);
  assert.ok(/code\.startsWith\('Key'\) \? SHORTCUTS\[code\.slice\(3\)\]/.test(strip(rd('tools.js'))) && !/SHORTCUTS\[[^\]]*toUpperCase/.test(strip(rd('tools.js'))), '도구 글쇠는 글쇠 위치(e.code)로 — 한글 자판에서도 L 이 L');
  assert.ok(/const ctx = \{ get store\(\) \{ return store; \}, setTool: [^\n]*, toast, openDialog \};/.test(app), 'ctx = {store, setTool, toast, openDialog}');
  assert.ok(!/localStorage\.(set|get)Item\(\s*['"]ain-plan-/.test(app), '문서 저장은 library.js 만 쓴다(키를 직접 만들지 않는다)');
  assert.ok(/'ain-plan-ui'/.test(app), '화면 환경설정 키는 따로');

  const M = await import(pathToFileURL(path.join(DIR, 'view2d.js')).href);   // node 에서 import — DOM 을 건드리지 않아야 한다
  const T = await import(pathToFileURL(path.join(DIR, 'tools.js')).href);
  const G = await import(pathToFileURL(path.join(DIR, 'core/geom.js')).href);
  const Mo = await import(pathToFileURL(path.join(DIR, 'core/model.js')).href);

  /* ===== 7. 단축키 표(캡처 그대로) ===== */
  const rows = T.TOOL_ROWS.flatMap((g) => g.rows.map((r) => ({ ...r, group: g.group })));
  const byId = Object.fromEntries(rows.filter((r) => r.id).map((r) => [r.id, r]));
  assert.deepStrictEqual(T.TOOL_ROWS.map((g) => g.group), ['특수 기능', '방 만들기', '구조물 그리기', '보조선 그리기', '도면 반전', '도면 회전', '일반'], '구역 순서');
  const KEYS = { wall: 'L', arc: 'A', room: 'F', delete: 'D', colRect: 'R', colRound: 'C', guide: 'E', measure: 'M', select: 'ESC', multi: 'Shift' };
  for (const [id, k] of Object.entries(KEYS)) assert.strictEqual(byId[id].key, k, `${id} 단축키`);
  assert.deepStrictEqual(rows.filter((r) => r.key).map((r) => r.key).sort(), Object.values(KEYS).sort(), '단축키가 붙은 행은 이 열 개뿐');
  assert.ok(!byId.opening.key && byId.opening.label === '개구부 그리기', '개구부는 단축키 없음');
  const LABELS = { underlay: '도면 이미지 업로드', maps: '도면 검색', wall: '벽 그리기', arc: '곡선벽 그리기', room: '방 그리기', delete: '삭제', colRect: '사각 기둥 그리기', colRound: '원형 기둥 그리기', guide: '보조선 그리기', measure: '측정', select: '선택', multi: '그룹화' };
  for (const [id, t] of Object.entries(LABELS)) assert.strictEqual(byId[id].label, t, id + ' 이름');
  assert.deepStrictEqual(rows.filter((r) => r.action && !r.id).map((r) => [r.action, r.label]), [['mirror-x', '좌우 반전'], ['mirror-y', '상하 반전'], ['rot-ccw', '반시계 방향 회전'], ['rot-cw', '시계 방향 회전']], '반전·회전 행');
  assert.strictEqual(byId.maps.href, '../maps/', '도면 검색 → 맵스');
  assert.deepStrictEqual({ ...T.SHORTCUTS }, { L: 'wall', A: 'arc', F: 'room', D: 'delete', R: 'colRect', C: 'colRound', E: 'guide', M: 'measure' }, '글쇠 → 도구');
  for (const id of ['wall', 'arc', 'room', 'delete', 'colRect', 'colRound', 'opening', 'guide', 'measure', 'select', 'placeItem', 'calibrate', 'moveUnderlay']) assert.ok(T.NAMES[id], '도구 이름 ' + id);
  assert.deepStrictEqual({ ...T.OPENING_NAMES }, { door: '문', window: '창', open: '개방' }, '개구부 3종');
  assert.ok(Object.isFrozen(T.SHORTCUTS) && Object.isFrozen(T.PX));

  /* ===== 8. 화면 변환 수식 ===== */
  const vp = { scale: 0.1, ox: 100, oy: 50, w: 800, h: 600 };
  near(M.toPx(vp, [1000, 2000])[0], 200, 1e-9, 'mm→px x'); near(M.toPx(vp, [1000, 2000])[1], 250, 1e-9, 'mm→px y');
  const q = M.toMm(vp, M.toPx(vp, [1234, -567])); near(q[0], 1234, 1e-9); near(q[1], -567, 1e-9);
  const z = M.zoomAt(vp, [300, 200], 2), before = M.toMm(vp, [300, 200]), after = M.toMm(z, [300, 200]);
  near(z.scale, 0.2, 1e-12, '확대 배율'); near(after[0], before[0], 1e-6, '커서 아래 점 고정 x'); near(after[1], before[1], 1e-6, '커서 아래 점 고정 y');
  assert.strictEqual(M.zoomAt(vp, [0, 0], 1e9).scale, M.SCALE.max, '배율 상한'); assert.strictEqual(M.zoomAt(vp, [0, 0], 1e-9).scale, M.SCALE.min, '배율 하한');
  const pn = M.panBy(vp, 15, -5); assert.deepStrictEqual([pn.ox, pn.oy, pn.scale], [115, 45, 0.1]);
  const fit = M.fitVP(vp, { x0: 0, y0: 0, x1: 8000, y1: 4000 }), a0 = M.toPx(fit, [0, 0]), a1 = M.toPx(fit, [8000, 4000]);
  assert.ok(a0[0] >= 0 && a0[1] >= 0 && a1[0] <= vp.w && a1[1] <= vp.h, '맞춤은 화면 안'); near((a0[0] + a1[0]) / 2, vp.w / 2, 1e-6, '맞춤 가운데'); near((a0[1] + a1[1]) / 2, vp.h / 2, 1e-6);
  assert.deepStrictEqual([fit.w, fit.h], [800, 600]); assert.deepStrictEqual(M.fitVP(vp, null).scale, M.SCALE.start, '빈 도면은 처음 화면');
  assert.deepStrictEqual(M.gridSteps(0.1), { minor: 100, major: 1000 }, '기본 격자 100/1000mm');
  assert.deepStrictEqual(M.gridSteps(0.01), { minor: 1000, major: 10000 }, '멀리서는 간격이 넓어진다');
  assert.deepStrictEqual(M.gridSteps(2), { minor: 100, major: 1000 }, '가까이서도 100/1000');
  assert.strictEqual(M.snapStep(0.1), 50, '기본 스냅 50mm'); assert.ok(M.snapStep(0.01) > 50 && M.snapStep(0.01) % 50 === 0, '멀리서는 스냅이 굵어진다');
  assert.deepStrictEqual([M.niceLen(120), M.niceLen(1300), M.niceLen(7000), M.niceLen(3)], [100, 1000, 5000, 2], '눈금자 길이');
  assert.strictEqual(M.fmtLen(3250), '3,250 mm'); assert.strictEqual(M.fmtLen(3250, 'ft'), '10′ 8″'); assert.strictEqual(M.fmtLen(254, 'ft'), '10″'); assert.strictEqual(M.fmtLen(300, 'ft'), '1′ 0″', '12인치는 1피트로 올린다'); assert.strictEqual(M.fmtLen(0, 'ft'), '0″');
  assert.strictEqual(M.fmtArea(12.34), '12.3 m²'); assert.strictEqual(M.fmtArea(10, 'ft'), '107.6 ft²'); assert.strictEqual(M.fmtArea(0), '0.0 m²');
  assert.deepStrictEqual([M.angleDeg([0, 0], [10, 0]), M.angleDeg([0, 0], [0, -10]), M.angleDeg([0, 0], [-10, 0]), M.angleDeg([0, 0], [0, 10])], [0, 90, 180, 270], '각도: 오른쪽 0° 위 90°');

  /* ===== 9. 도구 보조 계산: 처짐 부호·선택·핸들 ===== */
  const a = [0, 0], b = [4000, 0];
  assert.strictEqual(T.bulgeOf(a, b, [2000, 600]), 600, '진행 방향 오른쪽(아래) = +'); assert.strictEqual(T.bulgeOf(a, b, [2000, -600]), -600);
  const arc = G.arcFrom3(a, b, 600); near(arc.mid[1], 600, 1e-9, 'arcFrom3 꼭짓점이 bulgeOf 와 같은 쪽'); near(arc.mid[0], 2000, 1e-9);
  assert.strictEqual(T.bulgeOf([0, 0], [0, 4000], [-500, 2000]), 500, '아래로 향하는 벽의 오른쪽은 화면 왼쪽 → +');
  const doc = Mo.createDoc(), f = Mo.curFloor(doc);
  const { Store } = await import(pathToFileURL(path.join(DIR, 'core/store.js')).href);
  const st = new Store(doc); st.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000] }); st.exec({ type: 'addColumn', kind: 'rect', c: [6000, 1000] }); st.exec({ type: 'addGuide', a: [0, 5000], b: [3000, 5000] });
  st.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' });
  const d1 = st.doc, ff = Mo.curFloor(d1);
  const all = T.idsInRect(d1, [-500, -500], [7000, 6000]).sort();
  assert.deepStrictEqual(all, [...T.allIds(ff)].sort(), '전체를 덮는 사각형은 전부 고른다');
  assert.deepStrictEqual(T.idsInRect(d1, [5000, 0], [7000, 2000]), ['C1'], '기둥만');
  assert.deepStrictEqual(T.idsInRect(d1, [-300, 4500], [3500, 5500]), ['G1'], '보조선만');
  assert.ok(!T.idsInRect(d1, [20000, 20000], [21000, 21000]).length, '빈 곳은 아무것도 없다');
  const sel = new T.Selection(); let n = 0; sel.onChange = () => n++;
  sel.set(['W1', 'W2']); sel.set(['W2', 'W1']); assert.strictEqual(n, 1, '같은 선택은 알리지 않는다'); sel.toggle('W3'); assert.strictEqual(sel.size, 3); sel.toggle('W3'); assert.strictEqual(sel.size, 2);
  sel.set(['W1', 'ZZ']); sel.prune(d1); assert.deepStrictEqual([...sel.ids], ['W1'], '없는 id 는 뺀다');
  assert.deepStrictEqual(T.handlesOf(T.findEl(d1, 'W1')).map((h) => h.k), ['a', 'b'], '직선벽 핸들'); assert.deepStrictEqual(T.handlesOf({ col: 'walls', el: { ...ff.walls[0], bulge: 300 } }).map((h) => h.k), ['a', 'b', 'bulge'], '곡선벽 핸들');
  assert.deepStrictEqual(T.handlesOf(T.findEl(d1, 'C1')), [], '기둥은 끝점 핸들 없음'); assert.deepStrictEqual(T.handlesOf(null), []);
  assert.strictEqual(T.findEl(d1, 'O1').col, 'openings'); assert.strictEqual(T.findEl(d1, 'nope'), null);

  console.log('test-plan-ui: OK');
})().catch((e) => { console.error(e); process.exit(1); });
