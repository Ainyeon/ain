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
  assert.ok(/const ctx = \{ get store\(\) \{ return store; \}, exec: run, setTool: [^\n]*, toast, openDialog, openTemplate \};/.test(app), 'ctx = {store, exec(잠금을 지키는 run), setTool, toast, openDialog, openTemplate}');
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

  /* ===== 10. 도구 상태기계: 가짜 캔버스로 포인터를 흘려 본다 (px → mm 는 ×10, 스냅 50mm) ===== */
  const mkTools = (over = {}) => {
    const store = new Store(Mo.createDoc()), vp0 = { scale: 0.1, ox: 0, oy: 0, w: 800, h: 600 }, state = { locked: false, multi: false, touch: false, ...over }, log = { toasts: [], hint: null };
    const view = { vp: vp0, hover: null, underlayTemp: null, toMm: (p) => M.toMm(vp0, p), toPx: (p) => M.toPx(vp0, p), requestDraw() {}, panBy() {}, set() {} };
    let tools;
    const ui = { toast: (m) => log.toasts.push(m), say() {}, cursor() {}, hint: (n, t) => { log.hint = [n, t]; }, setTool: (n, o) => tools.setTool(n, o), renameRoom() {}, calibrated() {} };
    tools = T.createTools({ store, view, sel: new T.Selection(), ui, state });
    const canvas = { l: {}, addEventListener(t, f) { (this.l[t] ||= []).push(f); }, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {}, focus() {} };
    tools.attach(canvas);
    const fire = (type, x, y, o = {}) => (canvas.l[type] || []).forEach((f) => f({ type, pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: false, clientX: x, clientY: y, preventDefault() {}, ...o }));
    return { store, tools, state, log, fire, flr: () => Mo.curFloor(store.doc), tap(x, y, o) { fire('pointerdown', x, y, o); fire('pointerup', x, y, o); }, drag(x0, y0, x1, y1, o) { fire('pointerdown', x0, y0, o); fire('pointermove', x1, y1, o); fire('pointerup', x1, y1, o); } };
  };
  const stub = { model: '1way', brand: 'samsung', code: 'AC023CN1DBC1', capacityKw: 2.3, size: [1200, 500] };

  // 같은 자리 더블클릭 — 제품·기둥이 한 번만 놓인다(견적 수량이 부풀지 않게). 다른 자리·같은 자리 되돌린 뒤 다시는 놓인다
  { const t = mkTools(); t.store.exec({ type: 'addRoomRect', a: [0, 0], b: [6000, 5000] });
    t.tools.setTool('placeItem', stub); t.tap(200, 200); t.tap(200, 200); t.tap(200, 200);
    assert.strictEqual(t.flr().items.length, 1, '같은 자리 연타는 제품 한 대'); assert.deepStrictEqual(t.log.toasts, [], '막은 자리에 알림을 띄우지 않는다');
    t.tap(300, 200); assert.strictEqual(t.flr().items.length, 2, '다른 자리는 놓인다');
    t.store.undo(); t.tap(300, 200); assert.strictEqual(t.flr().items.length, 2, '되돌린 자리에는 다시 놓인다');
    for (const kind of ['colRect', 'colRound']) { const u = mkTools(); u.tools.setTool(kind); u.tap(200, 200); u.tap(200, 200); assert.strictEqual(u.flr().columns.length, 1, kind + ' 연타는 기둥 하나'); u.tap(400, 200); assert.strictEqual(u.flr().columns.length, 2, kind + ' 다른 자리'); } }

  // 벽 그리는 중 실행 취소·다시 실행 — 이어 그리기 상태가 문서와 맞는다
  { const t = mkTools(); t.tools.setTool('wall'); t.tap(100, 100); t.tap(400, 100); t.tap(400, 300);
    assert.strictEqual(t.flr().walls.length, 2); assert.strictEqual(t.tools.op.n, 2);
    t.store.undo(); assert.deepStrictEqual([t.tools.op.a, t.tools.op.n], [[4000, 1000], 1], '되돌린 벽의 끝점이 아니라 남은 벽의 끝점에서 이어진다');
    t.tap(100, 300); const w = t.flr().walls; assert.deepStrictEqual([w.length, w[1].a, w[1].b], [2, [4000, 1000], [1000, 3000]], '다음 벽은 직전 벽에 이어진다');
    t.store.undo(); t.store.undo(); assert.deepStrictEqual([t.tools.op.a, t.tools.op.n], [[1000, 1000], 0], '벽을 모두 되돌리면 첫 점을 막 누른 상태');
    t.tap(400, 100); t.tap(100, 100); assert.deepStrictEqual([t.flr().walls.length, t.tools.op !== null], [2, true], '벽이 둘뿐이면 첫 점으로 돌아와도 닫히지 않고 이어진다');
    const r = mkTools(); r.tools.setTool('wall'); r.tap(100, 100); r.tap(400, 100); r.store.undo(); r.store.redo();
    assert.deepStrictEqual([r.tools.op.a, r.tools.op.n], [[4000, 1000], 1], '다시 실행하면 그 벽의 끝점');
    const s = mkTools(); s.tools.setTool('wall'); s.tap(100, 100); s.tap(400, 100); s.tap(400, 300); s.tap(100, 300); s.store.undo(); s.store.undo(); s.store.redo();
    assert.deepStrictEqual([s.tools.op.a, s.tools.op.n], [[4000, 3000], 2], '여러 단계 되돌리고 다시 실행'); }

  // 펜·손가락으로 끌어 그리기 — 마우스와 같이 누른 자리에서 시작한다
  for (const pt of ['mouse', 'pen', 'touch']) {
    { const t = mkTools(); t.tools.setTool('room'); t.drag(100, 100, 400, 300, { pointerType: pt });
      assert.deepStrictEqual([t.flr().rooms.length, t.tools.op], [1, null], pt + ' 끌기로 방'); assert.deepStrictEqual(t.flr().rooms[0].poly[0], [1000, 1000], pt + ' 방은 누른 자리에서'); }
    { const t = mkTools(); t.tools.setTool('wall'); t.drag(100, 100, 400, 100, { pointerType: pt }); assert.deepStrictEqual([t.flr().walls.length, t.flr().walls[0].a, t.flr().walls[0].b], [1, [1000, 1000], [4000, 1000]], pt + ' 끌기로 벽'); }
    { const t = mkTools(); t.tools.setTool('guide'); t.drag(100, 100, 400, 100, { pointerType: pt }); assert.strictEqual(t.flr().guides.length, 1, pt + ' 끌기로 보조선'); }
  }
  { const t = mkTools(); t.tools.setTool('room'); t.tap(100, 100, { pointerType: 'touch' }); assert.strictEqual(t.tools.op.mode, 'rect', '손가락으로 살짝 누르면 모서리 하나 찍기'); t.tap(400, 300, { pointerType: 'touch' }); assert.strictEqual(t.flr().rooms.length, 1, '두 번 눌러도 방'); }

  // 안내문: 키보드 화면은 키를, 폰·태블릿(state.touch)은 키 없이 누르는 동작과 [끝내기] 단추를 말한다
  { const KEYS = /ESC|Esc|Shift|Delete|Enter|\[ \]|더블클릭/, hints = {};
    for (const touch of [true, false]) {
      const t = mkTools({ touch }), seen = hints[touch] = [], grab = () => seen.push(t.log.hint[1]);
      t.store.exec({ type: 'addRoomRect', a: [0, 0], b: [6000, 5000] });
      t.tools.setTool('select'); grab(); t.tap(300, 250); grab(); // 방 하나 고른 뒤의 안내
      for (const name of ['wall', 'arc', 'room', 'delete', 'colRect', 'colRound', 'opening', 'guide', 'measure', 'placeItem', 'calibrate', 'moveUnderlay']) {
        t.tools.setTool(name, name === 'placeItem' ? stub : {}); grab(); t.tap(100, 100); grab(); t.tap(400, 100); grab(); t.tap(400, 300); grab();
        t.tools.setTool(name, name === 'placeItem' ? stub : {}); t.tap(100, 100, { shiftKey: true }); grab(); // 방은 Shift 로 다각형
      }
      assert.ok(seen.every((x) => typeof x === 'string' && x), '안내문이 비지 않는다');
    }
    assert.deepStrictEqual(hints[true].filter((x) => KEYS.test(x)), [], '폰 안내문은 폰에 없는 키(ESC·Shift·Delete·Enter·[ ])를 말하지 않는다');
    for (const word of ['ESC', 'Shift', 'Delete', 'Enter', '[ ]']) assert.ok(hints[false].some((x) => x.includes(word)), '키보드 안내문에는 ' + word + ' 가 남는다');
    assert.ok(hints[true].some((x) => x.includes('[끝내기]')), '폰 안내문은 [끝내기] 단추를 가리킨다');
    const live = mkTools(); live.tools.setTool('wall'); live.tap(100, 100); assert.ok(/ESC/.test(live.log.hint[1])); live.state.touch = true; live.tools.hint(); assert.ok(!/ESC/.test(live.log.hint[1]), 'touch 가 바뀌면 안내문이 바로 바뀐다'); }

  /* ===== 11. 격자선: 좌표가 극단적이어도 끝난다 · 층 면적 합: 공유 벽을 한 번만 ===== */
  { const old = (origin, size, scale, step) => { const o = []; for (let x = Math.ceil(-origin / scale / step) * step; x * scale + origin <= size; x += step) o.push(Math.round(x * scale + origin) + 0.5); return o; };
    for (const [origin, size, scale, step] of [[100, 800, 0.1, 100], [-2450, 1280, 0.35, 500], [37.5, 390, 0.004, 5000], [0, 600, 2, 100]]) assert.deepStrictEqual(M.gridLines(origin, size, scale, step), old(origin, size, scale, step), `격자선 ${origin},${size},${scale},${step}`);
    // 끝나지 않는 회귀는 시험이 매달리지 않게 따로 띄운 프로세스에서 시간 제한을 걸어 본다
    const probe = `import { gridLines } from ${JSON.stringify(pathToFileURL(path.join(DIR, 'view2d.js')).href)}; for (const o of [-1.18e201, 1e200, -1e300, Infinity, -Infinity, NaN]) for (const st of [100, 5000, 50000]) { const l = gridLines(o, 800, 0.004, st); if (!(l.length < 4000 && l.every(Number.isFinite))) throw new Error('격자선 ' + o + ' ' + st + ' ' + l.length); }`;
    const r = require('child_process').spawnSync(process.execPath, ['--input-type=module', '-e', probe], { timeout: 15000, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `극단 좌표(1e200 등)에서도 격자선 계산이 끝나야 한다 ${r.error ? r.error.code : ''} ${r.stderr}`); }
  { const tpl = JSON.parse(fs.readFileSync(path.join(DIR, 'data/templates.json'), 'utf8')).templates, apt = tpl.find((t) => t.id === 'apt-a').doc, af = Mo.curFloor(apt);
    near(M.floorAreaM2(apt, af), 82.4625, 1e-9, '실면적 = 방 면적 합');
    // 손계산: apt-a 의 방을 둘러싼 벽 26개(길이 합 74.2 m) × 두께 150 mm = 11.13 m² → 82.4625 + 11.13 = 93.5925. 방마다 더하던 98.9025 는 내벽을 두 번 센 값
    near(M.floorAreaM2(apt, af, true), 93.5925, 1e-9, 'apt-a 실면적+내외벽'); assert.strictEqual(M.fmtArea(M.floorAreaM2(apt, af, true)), '93.6 m²');
    assert.ok(af.rooms.some((r) => af.rooms.some((q) => q !== r && q.wallIds.some((i) => r.wallIds.includes(i)))), 'apt-a 에는 이웃 방이 같이 쓰는 벽이 있다');
    for (const t of tpl) { const f = Mo.curFloor(t.doc), b = G.bounds(t.doc), box = ((b.x1 - b.x0) * (b.y1 - b.y0)) / 1e6, net = M.floorAreaM2(t.doc, f), gross = M.floorAreaM2(t.doc, f, true);
      const walls = new Set(f.rooms.flatMap((r) => r.wallIds)); let wa = 0; for (const w of f.walls) if (walls.has(w.id)) wa += (G.wallLen(w) * w.t) / 1e6;
      near(gross - net, wa, 1e-9, t.id + ' 벽 면적은 벽마다 한 번'); assert.ok(gross > net && gross <= box * 1.005, `${t.id} 실면적+내외벽 ${gross.toFixed(2)} 은 바깥 경계 ${box.toFixed(2)} 를 넘지 않는다`); } }

  /* ===== 12. app.js 약속(DOM 이 있어야 돌아서 코드 모양으로 지킨다 — 화면 동작은 playwright 로 따로 본다) ===== */
  { const code = app, has = (re, m) => assert.ok(re.test(code), '코드: ' + m);
    has(/mod && e\.code === 'KeyS'\) \{[^}]*a\.blur\(\);\s*save\(\);/, 'Ctrl+S — 포커스된 입력칸을 먼저 벗어나 미확정 값을 문서에 넣고 저장');
    has(/function save\(\) \{\s*if \(!kept\) \{ toast\(NO_STORE, 'err'\); return false; \}/, '저장소가 막혀 있으면 저장한 것으로 치지 않는다');
    has(/setText\(ss, !kept \? NO_STORE :/, '저장 상태에 막힌 저장소 안내를 계속 보인다'); has(/ss\.dataset\.s = dirty \|\| !kept/, '막힌 저장소는 저장됨 표시를 하지 않는다');
    assert.ok(/이 브라우저는 저장소를 막고 있어 저장되지 않습니다 · 도면 내보내기\(\.json\)로 보관하세요/.test(rd('app.js')), '막힌 저장소 안내 문구');
    has(/const setText = \(el, t\) => \{ if \(el\.textContent !== t\) el\.textContent = t; \}/, '낭독 영역은 글자가 바뀔 때만 쓴다'); has(/setText\(\$\('plArea'\)/, '면적 output'); has(/setText\(o, get\(e\)\)/, '선택 속성 output');
    assert.ok(!/(ss|\$\('plArea'\))\.textContent =/.test(code), '저장 상태·면적을 textContent 로 곧바로 쓰지 않는다');
    has(/floorAreaM2\(d, f, state\.areaGross\)/, '층 면적 합은 floorAreaM2 로');
    has(/toast\(`\$\{label\} 값이 올바르지 않습니다`, 'err'\); else set\(v\); show\(\);/, '속성 숫자 칸 — 거절돼도 칸을 문서 값으로'); has(/toast\(`\$\{label\} 을 비울 수 없습니다`, 'err'\); else set\(v\); show\(\);/, '속성 글자 칸');
    has(/el\.value = String\(curFloor\(store\.doc\)\[key\]\)/, '층 높이·슬래브 칸'); has(/nm\.value = curFloor\(store\.doc\)\.name/, '층 이름 칸');
    has(/let finishMap = null, v3Plain = false, entering3d = false;/, '3D 진입 상태'); assert.ok(!/finishMap = new Map\(\)\; \}/.test(code) && !/catch \(e\) \{ finishMap = new Map\(\)/.test(code), '마감재 목록을 못 읽었을 때 빈 목록을 저장해 두지 않는다');
    has(/if \(entering3d\) return;\s*entering3d = true;/, '3D 여는 중 가드'); has(/finally \{ entering3d = false; \}/, '가드는 끝나면 풀린다'); has(/finishColor: \(kind, id\) => finishMap && finishMap\.get\(id\)/, '3D 가 읽는 마감재 색은 지금의 목록');
    has(/if \(v3 && v3Plain && sw\) \{ v3\.destroy\(\); v3 = null; \}/, '색 없이 만든 3D 는 목록을 읽은 뒤 다시 만든다');
    has(/function setPanel\(open\) \{\s*if \(open && narrow\.matches\) setSide\(false\);/, '폰: 시트를 열면 서랍을 닫는다'); has(/function setSide\(open\) \{\s*if \(open && narrow\.matches\) setPanel\(false\);/, '폰: 서랍을 열면 시트를 닫는다');
    has(/narrow\.addEventListener\('change', onMode\); mid\.addEventListener\('change', onMode\)/, '창 폭이 바뀌면(회전·확대) 패널 상태를 정리'); has(/setPanel\(!narrow\.matches\); setSide\(!mid\.matches\)/, '폰: 시트 닫음 · 1023px 이하: 오른쪽 패널 접음 · 데스크톱: 둘 다 연다'); has(/if \(narrow\.matches\) setPanel\(false\);\s*if \(mid\.matches\) setSide\(false\);/, '시작할 때도 같은 규칙');
    has(/state\.touch = narrow\.matches \|\| coarse\.matches;/, '폰·터치 화면 판정'); has(/class: 'ed-b', id: 'plEndTool', text: '끝내기'[^\n]*ui\.setTool\('select'\)/, '[끝내기] 단추 = 선택 도구로'); has(/endBtn\.hidden = !\(state\.touch && tools && tools\.tool !== 'select'\)/, '[끝내기] 단추는 터치 화면에서 도구를 연 동안만');
    has(/async function openTemplate\(id\) \{[^}]*await confirmDiscard\('템플릿으로 시작하면'\)/, '템플릿 시작도 저장 안 한 변경 확인창을 거친다'); }

  console.log('test-plan-ui: OK');
})().catch((e) => { console.error(e); process.exit(1); });
