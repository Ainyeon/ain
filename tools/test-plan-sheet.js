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
    assert.ok(!/3D/.test(noComment(sh) + noComment(core)), "문구에 '3D' 낱말이 없다"); }

  /* ===== 1. 배치: 8칸 4 × 2 + 표제란 ===== */
  { const L = K.sheetLayout(8), S = K.SHEET, all = [...L.cells, L.title];
    assert.deepStrictEqual([S.w, S.h], [420, 297], 'A3 가로'); assert.strictEqual(L.cells.length, 8);
    for (const r of all) assert.ok(r.x >= S.margin - 1e-9 && r.y >= S.margin - 1e-9 && r.x + r.w <= S.w - S.margin + 1e-9 && r.y + r.h <= S.h - S.margin + 1e-9 && r.w > 0 && r.h > 0, '여백 안');
    all.forEach((a, i) => all.slice(i + 1).forEach((b) => assert.ok(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9, '겹치지 않는다')));
    assert.deepStrictEqual([L.cells[0].w, L.cells[0].h], [97, 124.5], '칸 97 × 124.5 mm'); assert.deepStrictEqual([L.cells[4].x, L.cells[4].y, L.cells[3].x], [10, 138.5, 313]);
    assert.deepStrictEqual(L.title, { x: 10, y: 267, w: 400, h: 20 }); assert.strictEqual(K.sheetLayout(7).cells.length, 7); assert.strictEqual(K.sheetLayout(1).cells[0].w, 400); }

  /* ===== 2. 축척 ===== */
  { const box = (w, h) => ({ x0: 0, y0: 0, x1: w, y1: h });
    assert.strictEqual(K.sheetScale(box(8900, 5000), 89, 108.5), 100, '8.9 m ÷ 89 mm = 1:100'); assert.strictEqual(K.sheetScale(box(8901, 5000), 89, 108.5), 150, '조금만 넘어도 다음 축척');
    assert.strictEqual(K.sheetScale(box(1000, 21701), 89, 108.5), 250, '세로가 정한다'); assert.strictEqual(K.sheetScale(box(100, 100), 89, 108.5), 20, '가장 큰 축척 1:20'); assert.strictEqual(K.sheetScale(box(600000, 100), 89, 108.5), 7000, '표 밖은 1000 단위로');
    for (const t of TPL) { const b = G.bounds(t.doc), r = K.sheetScale(b, 89, 108.5); assert.ok((b.x1 - b.x0) / r <= 89 && (b.y1 - b.y0) / r <= 108.5 && r >= 50 && r <= 300, t.id + ' 1:' + r); }
    assert.strictEqual(K.sheetScale(G.bounds(tpl('three-b')), 89, 108.5), 150, '쓰리룸 1:150'); }

  /* ===== 3. 표제란 ===== */
  { const s = M.siteOf(tpl('three-b')), rows = K.titleRows({ title: '쓰리룸', areaM2: 72.434, north: s.north, lat: s.lat, date: '2026. 11. 13.', ratio: 150 });
    assert.deepStrictEqual(rows, [['도면', '쓰리룸'], ['면적', '72.43 ㎡'], ['방위', '위쪽 남 · 180°'], ['지역', '서울 · 위도 37.57°'], ['축척', '1:150 · A3'], ['날짜', '2026. 11. 13.']]);
    assert.deepStrictEqual(K.titleRows({ title: 'x', areaM2: 1, north: 0, lat: 36, date: 'D', ratio: 50 }).slice(2, 4), [['방위', '위쪽 북 · 0°'], ['지역', '위도 36°']], '표에 없는 위도는 숫자만'); }

  console.log('test-plan-sheet: OK');
})().catch((e) => { console.error(e); process.exit(1); });
