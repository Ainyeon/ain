// A3 도면판(maker/3d/plan/core/sheet.js: 칸 배치·축척·표제란) 순수 계산 시험 + 화면 연결 정적 점검.
// 실행: node tools/test-plan-sheet.js. 그림(칸·표제란·PNG·인쇄)은 브라우저로 따로 본다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = path.join(__dirname, '..', 'maker/3d/plan');
const rd = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const imp = (f) => import(pathToFileURL(path.join(DIR, f)).href);
const { fakeDom } = require('./plan-fake-canvas.js');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);
const noComment = (s) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

(async () => {
  const [K, G, M] = await Promise.all(['core/sheet.js', 'core/geom.js', 'core/model.js'].map(imp));
  const TPL = JSON.parse(rd('data/templates.json')).templates, tpl = (id) => TPL.find((t) => t.id === id).doc;

  /* ===== 0. 정적 ===== */
  { const core = rd('core/sheet.js'), sh = rd('sheet.js'), app = rd('app.js'), v2 = rd('view2d.js'), css = rd('plan.css');
    assert.ok(/^\/\/ \S/.test(core) && /^\/\/ \S/.test(sh), '맨 위 한 줄 역할 주석');
    assert.ok(!/\b(document|window|navigator)\s*[.\[]|Math\.random|Date\.now|new Date|\bDate\b/.test(noComment(core)), 'core/sheet.js 는 DOM·시계를 쓰지 않는다(날짜는 인자)');
    assert.ok(/import \{ createView2D, readTheme, drawSection \} from '\.\/view2d\.js'/.test(sh) && /v\.renderTo\(/.test(sh) && /drawSection\(off, C, c\.section, LW,/.test(sh), '칸은 view2d 의 그리기를 다시 돌린다');
    assert.ok(!/wallPieces|roomOutlineWithArcs|openingSymbol|sunPatches|axoScene/.test(noComment(sh)), 'sheet.js 는 도면을 직접 그리지 않는다(복사 없음)');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(sh + core), 'innerHTML 을 쓰지 않는다');
    assert.ok(/window\.print\(\)/.test(sh) && /cv\.toBlob\(/.test(sh) && /afterprint/.test(sh) && /text: 'PNG 저장'/.test(sh) && /text: '인쇄·PDF'/.test(sh), 'PNG 저장 · 인쇄');
    assert.ok(/import\('\.\/sheet\.js'\)/.test(app) && /text: '도면판', onclick: openSheet/.test(app) && /date: new Date\(\)\.toLocaleDateString\('ko-KR'\)/.test(app), '분석 칸의 [도면판] · 날짜는 app 이 넘긴다');
    assert.ok(/offscreen = false/.test(v2) && /if \(!offscreen\) \{\n\s+canvas\.addEventListener\('wheel'[\s\S]*?new ResizeObserver\(resize\)\.observe\(canvas\);\n  \}/.test(v2), '화면 밖 뷰는 휠·크기 관찰을 달지 않는다');
    const mine = css.slice(css.indexOf('/* 도면판'));
    assert.ok(/@page \{ size: A3 landscape; margin: 0; \}/.test(mine) && /@media print \{/.test(mine) && /body\.printing > :not\(\.ed-sheet\) \{ display: none !important; \}/.test(mine) && /\.ed-sheet-cv \{ width: 420mm; height: 297mm;/.test(mine), '인쇄 전용 CSS: A3 가로 · 도면판만');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|gradient|999px|\d+m?s\b/.test(mine), '새 CSS 는 토큰만');
    assert.ok(!/3D/.test(noComment(sh) + noComment(core)), "문구에 '3D' 낱말이 없다");
    /* 창 크기 · 인쇄 규칙 */
    assert.ok(/\.ed-sheet-cv \{ display: block; max-width: 100%; max-height: calc\(100dvh - [^;]+\);/.test(mine), '미리보기는 화면 높이로도 줄인다(단추 줄이 창 안에 남는다)');
    assert.ok(/body\.printing dialog\.ed-sheet \{ position: absolute; inset: 0; width: 420mm;/.test(mine) && /body\.printing dialog\.ed-sheet::backdrop \{ display: none; \}/.test(mine) && /body\.printing \.ed-sheet \.ed-dlg-h, body\.printing \.ed-sheet-act \{ display: none; \}/.test(mine) && /body\.printing \.ed-sheet-cv \{ width: 420mm; height: 297mm; max-width: none; max-height: none;/.test(mine), '인쇄: 창 틀·단추·배경 없이 420 × 297 mm');
    /* app.js openSheet: 여덟 칸 · 표제란 값은 문서에서 */
    const os = app.slice(app.indexOf('async function openSheet()'), app.indexOf('let playRaf'));
    assert.ok(/if \(!f\.rooms\.length\) return toast\('방이 없습니다', 'err'\);/.test(os), '빈 도면은 막는다');
    assert.ok(/const cells = \[plan\(null\), plan\('poche'\), plan\('zone'\), plan\('route', \{ routes: routesFor\(f, state\.routes\) \}\), plan\('sun', \{ ana: anaView\(f, 'sun'\) \}\), \{ label: ANA\.section, section: sec\.ok \? sec : null, note: '자를 벽이 없습니다' \},\n\s+plan\('shadow', \{ ana: shade, bounds: withShade\(b, polysBox\(shade\.shade\.flatMap\(\(x\) => x\.polys\)\)\) \}\), \{ label: ANA\.axo, m: 'axo', axo, bounds: axo\.box \}\];/.test(os), '평면·포셰·존·동선·일조·단면·그림자·액소 여덟 칸, 칸마다 제 자료');
    assert.ok(/plan = \(m, more\) => \(\{ label: m \? ANA\[m\] : '평면', m, bounds: b, scaled: true, \.\.\.more \}\)/.test(os) && /areaM2: floorAreaM2\(d, f, state\.areaGross\), north: site\.north, lat: site\.lat,/.test(os) && /title: d\.title,/.test(os), '표제란: 도면 이름 · 면적 · 방위 · 위도는 문서 값'); }

  /* ===== 1. 배치: 8칸 4 × 2 + 표제란 ===== */
  { const L = K.sheetLayout(8), S = K.SHEET, all = [...L.cells, L.title];
    assert.deepStrictEqual([S.w, S.h], [420, 297], 'A3 가로'); assert.strictEqual(L.cells.length, 8);
    for (const r of all) assert.ok(r.x >= S.margin - 1e-9 && r.y >= S.margin - 1e-9 && r.x + r.w <= S.w - S.margin + 1e-9 && r.y + r.h <= S.h - S.margin + 1e-9 && r.w > 0 && r.h > 0, '여백 안');
    all.forEach((a, i) => all.slice(i + 1).forEach((b) => assert.ok(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9, '겹치지 않는다')));
    assert.deepStrictEqual([L.cells[0].w, L.cells[0].h], [97, 124.5], '칸 97 × 124.5 mm'); assert.deepStrictEqual([L.cells[4].x, L.cells[4].y, L.cells[3].x], [10, 138.5, 313]);
    assert.deepStrictEqual(L.title, { x: 10, y: 267, w: 400, h: 20 }); assert.strictEqual(K.sheetLayout(7).cells.length, 7); assert.strictEqual(K.sheetLayout(1).cells[0].w, 400);
    for (let n = 1; n <= 9; n++) { const A = [...K.sheetLayout(n).cells, K.sheetLayout(n).title];   // 칸 수가 열 수의 배수가 아니어도
      for (const r of A) assert.ok(r.x >= S.margin - 1e-9 && r.y >= S.margin - 1e-9 && r.x + r.w <= S.w - S.margin + 1e-9 && r.y + r.h <= S.h - S.margin + 1e-9 && r.w > 0 && r.h > 0, n + '칸: 여백 안');
      A.forEach((a, i) => A.slice(i + 1).forEach((b) => assert.ok(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9, n + '칸: 겹치지 않는다'))); }
    assert.deepStrictEqual([K.sheetLayout(7).cells[6].y, K.sheetLayout(7).cells[0].h], [138.5, 124.5], '7칸은 두 줄'); near(K.sheetLayout(9).cells[8].y, 10 + 2 * (245 / 3 + 4), 1e-9, '9칸은 세 줄'); }

  /* ===== 2. 축척 ===== */
  { const box = (w, h) => ({ x0: 0, y0: 0, x1: w, y1: h });
    assert.strictEqual(K.sheetScale(box(8900, 5000), 89, 108.5), 100, '8.9 m ÷ 89 mm = 1:100'); assert.strictEqual(K.sheetScale(box(8901, 5000), 89, 108.5), 150, '조금만 넘어도 다음 축척');
    assert.strictEqual(K.sheetScale(box(1000, 21701), 89, 108.5), 250, '세로가 정한다'); assert.strictEqual(K.sheetScale(box(100, 100), 89, 108.5), 20, '가장 큰 축척 1:20'); assert.strictEqual(K.sheetScale(box(600000, 100), 89, 108.5), 7000, '표 밖은 1000 단위로');
    for (const t of TPL) { const b = G.bounds(t.doc), r = K.sheetScale(b, 89, 108.5); assert.ok((b.x1 - b.x0) / r <= 89 && (b.y1 - b.y0) / r <= 108.5 && r >= 50 && r <= 300, t.id + ' 1:' + r); }
    assert.strictEqual(K.sheetScale(G.bounds(tpl('three-b')), 89, 108.5), 150, '쓰리룸 1:150');
    const R = [20, 25, 30, 40, 50, 60, 75, 100, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1500, 2000, 2500, 5000];   // 쓰는 축척 전부
    R.forEach((r, i) => { assert.strictEqual(K.sheetScale(box(r * 89, 10), 89, 108.5), r, '꼭 맞으면 1:' + r); if (R[i + 1]) assert.strictEqual(K.sheetScale(box(r * 89 + 1, 10), 89, 108.5), R[i + 1], '1:' + r + ' 다음은 1:' + R[i + 1]); });
    assert.strictEqual(K.sheetScale(box(0, 0), 89, 108.5), 20, '점 하나뿐인 도면도 1:20'); }

  /* ===== 3. 표제란 ===== */
  { const s = M.siteOf(tpl('three-b')), rows = K.titleRows({ title: '쓰리룸', areaM2: 72.434, north: s.north, lat: s.lat, date: '2026. 11. 13.', ratio: 150 });
    assert.deepStrictEqual(rows, [['도면', '쓰리룸'], ['면적', '72.43 ㎡'], ['방위', '위쪽 남 · 180°'], ['지역', '서울 · 위도 37.57°'], ['축척', '1:150 · A3'], ['날짜', '2026. 11. 13.']]);
    assert.deepStrictEqual(K.titleRows({ title: 'x', areaM2: 1, north: 0, lat: 36, date: 'D', ratio: 50 }).slice(2, 4), [['방위', '위쪽 북 · 0°'], ['지역', '위도 36°']], '표에 없는 위도는 숫자만'); }

  /* ===== 4. 그리기(sheet.js buildSheet · view2d.js renderTo): 가짜 캔버스에 그대로 돌려, 적힌 축척 = 그린 축척 · 칸마다 제 그림 · 표제란을 본다 ===== */
  { const dom = fakeDom(), [SH, A, U, X, B] = await Promise.all(['sheet.js', 'core/analysis.js', 'core/sun.js', 'core/axo.js', 'core/mesh3d.js'].map(imp));
    const doc = tpl('three-b'), f = M.curFloor(doc), site = M.siteOf(doc), b = G.bounds(doc), axo = X.axoScene(B.buildMesh(doc), { spread: 0.6 }), sec = U.section(f, site, null), far = { ...b, x1: b.x1 + 30000 };
    const plan = (m, label, more) => ({ label, m, bounds: b, scaled: true, ...more });   // app.js openSheet 가 넘기는 모양 그대로
    const cells = [plan(null, '평면'), plan('poche', '포셰'), plan('zone', '존'), plan('route', '동선', { routes: A.routesFor(f, []) }), plan('sun', '일조', { ana: { north: site.north, sun: U.sunPatches(f, site, -23.44, [12]).map((p) => ({ poly: p.poly, now: false, text: '12' })), shade: [], cut: null } }),
      { label: '단면', section: sec.ok ? sec : null, note: '자를 벽이 없습니다' }, plan('shadow', '그림자', { ana: { north: site.north, sun: [], shade: [], cut: null }, bounds: far }), { label: '액소', m: 'axo', axo, bounds: axo.box }];
    const state = { analysis: 'zone', showGrid: true, showLabels: false, unit: 'mm' }, opts = { store: { doc }, state, cells, name: 'a.png', info: { title: '쓰리룸', areaM2: 72.434, north: site.north, lat: site.lat, date: '2026. 11. 13.' } };
    const cv = SH.buildSheet(opts), [main, off] = dom.canvases, L = K.sheetLayout(8), k = SH.SHEET_PX / 420, of = (log, name) => log.filter((x) => x[0] === name), texts = (log) => of(log, 'fillText').map((x) => x[1][0]);
    assert.strictEqual(cv, main); assert.deepStrictEqual([SH.SHEET_PX, cv.width, cv.height], [2480, 2480, 1754], 'A3 가로 150dpi');
    assert.ok(sec.ok && of(off.log, 'size').length >= 9, '칸마다 화면 밖 캔버스를 다시 그린다');
    const draws = []; for (const x of off.log) { if (x[0] === 'size') draws.push([]); else draws.at(-1).push(x); }   // 그림 한 장씩(칸 순서) — 마지막은 메모리를 비우는 빈 장
    const img = of(main.log, 'drawImage'); assert.strictEqual(img.length, 8, '여덟 칸을 모두 옮겨 그린다');
    const ratios = [150, 150, 150, 150, 150, 0, 500, 0];   // 그림자 칸은 그림자 범위까지 넣느라 축척이 다르다 · 단면·액소는 축척 없음
    cells.forEach((c, i) => { const r = L.cells[i], bx = Math.round(r.x * k), by = Math.round((r.y + K.SHEET.cap) * k), bw = Math.round(r.w * k), bh = Math.round((r.h - K.SHEET.cap) * k), d = draws[i];
      if ('section' in c) { assert.ok(img[i][1][1] >= bx && img[i][1][2] >= by && img[i][1][1] + img[i][1][3] <= bx + bw + 1e-6 && img[i][1][2] + img[i][1][4] <= by + bh + 1e-6, '단면은 칸 안에'); return; }
      assert.deepStrictEqual(img[i][1].slice(1), [bx, by, bw, bh], c.label + ' 칸 자리');
      const tf = of(d, 'setTransform'), [a, , , , e, g] = tf.find((x) => x[1][0] !== tf[0][1][0])[1], W = bw, H = bh;   // 첫 변환은 화면 px, 그다음이 도면(mm) → 화면 밖 캔버스 px
      if (ratios[i]) { near(a, k / ratios[i], (k / ratios[i]) * 0.002, c.label + ' 적힌 축척 1:' + ratios[i] + ' 대로 그린다'); near(a * (c.bounds.x0 + c.bounds.x1) / 2 + e, W / 2, 1, '도면 가운데가 칸 가운데'); near(a * (c.bounds.y0 + c.bounds.y1) / 2 + g, H / 2, 1.5); }
      else for (const [x, y] of [[c.bounds.x0, c.bounds.y0], [c.bounds.x1, c.bounds.y1]]) assert.ok(a * x + e >= 0 && a * x + e <= W && a * y + g >= 0 && a * y + g <= H + 1, '축척 없는 칸은 범위에 맞춘다'); });
    const lab = texts(main.log); assert.deepStrictEqual(lab.filter((t) => cells.some((c) => c.label === t)), cells.map((c) => c.label), '칸 이름 여덟');
    assert.deepStrictEqual(lab.filter((t) => /^1:\d+$/.test(t)), ['1:150', '1:150', '1:150', '1:150', '1:150', '1:500'], '칸마다 축척 표기');
    for (const t of ['쓰리룸', '72.43 ㎡', '위쪽 남 · 180°', '서울 · 위도 37.57°', '1:150 · A3', '2026. 11. 13.']) assert.ok(lab.includes(t), '표제란: ' + t);
    /* 칸마다 제 분석 보기 — 바깥 state(존 보기·격자 켬·글씨 끔)에 끌려가지 않는다 */
    const T = draws.map(texts), fills = draws.map((d) => of(d, 'fill').length);
    assert.ok(T[0].includes('거실') && !T[0].some((t) => /공용/.test(t)), '평면: 방 이름(존 표기 없음)'); assert.strictEqual(T[1].length, 0, '포셰: 글씨 없음'); assert.ok(T[2].some((t) => /^공용 · /.test(t)), '존: 존 표기');
    assert.ok(T[3].some((t) => /^1 · [\d.]+ m$/.test(t)) && !T[3].includes('거실'), '동선: 번호·거리만 — 방 글씨와 겹치지 않게 방 글씨는 뺀다'); assert.ok(T[4].includes('12') && !T[4].includes('거실'), '일조: 시각만(방 글씨 없음)');
    assert.ok(T[5].some((t) => / m$/.test(t)), '단면: 치수'); assert.ok(T[6].includes('N'), '그림자: 방위표'); assert.strictEqual(T[7].length, 0); assert.strictEqual(fills[7], axo.floors.length + axo.faces.length, '액소: 장면을 그린다');
    /* 축척 없는 도면(칸이 단면·액소뿐)도 표제란은 1:100 */
    dom.canvases.length = 0; SH.buildSheet({ ...opts, cells: cells.slice(7) }); assert.ok(texts(dom.canvases[0].log).includes('1:100 · A3'));
    /* 창: PNG 저장 · 인쇄 · 브라우저 인쇄(Ctrl+P) */
    const h = (tag, attrs, kids) => ({ tag, attrs, kids }), saved = [], toasts = []; let dlg;
    const openDialog = (title, nodes, o) => (dlg = { title, nodes, o, el: { classList: { add: (c) => (dlg.cls = c) } } });
    SH.openSheet({ h, openDialog, download: (n, bl) => saved.push([n, !!bl]), toast: (t) => toasts.push(t) }, opts);
    const [pr, sv] = dlg.nodes[1].kids, pv = dlg.nodes[0]; assert.deepStrictEqual([dlg.title, dlg.cls, pr.attrs.text, sv.attrs.text, pv.attrs.role], ['도면판', 'ed-sheet', '인쇄·PDF', 'PNG 저장', 'img']);
    sv.attrs.onclick(); assert.deepStrictEqual([saved, pv.blobType], [[['a.png', true]], 'image/png'], 'PNG 로 저장한다');
    assert.ok(!dom.body.has('printing')); dom.fire('beforeprint'); assert.ok(dom.body.has('printing'), '창이 떠 있으면 브라우저 인쇄도 도면판만'); dom.fire('afterprint'); assert.ok(!dom.body.has('printing'), '인쇄가 끝나면 화면으로');
    pr.attrs.onclick(); assert.ok(dom.printed() === 1 && dom.body.has('printing'), '[인쇄·PDF]'); dom.fire('afterprint'); assert.ok(!dom.body.has('printing'));
    dom.fire('beforeprint'); dlg.o.onclose(); assert.ok(!dom.body.has('printing') && dom.listeners('beforeprint') === 0 && dom.listeners('afterprint') === 0 && pv.width === 0, '창을 닫으면 인쇄 표시·듣는 것·캔버스를 치운다'); }

  console.log('test-plan-sheet: OK');
})().catch((e) => { console.error(e); process.exit(1); });
