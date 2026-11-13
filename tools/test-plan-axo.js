// 분해 액소(maker/3d/plan/core/axo.js) 순수 계산 시험 + 화면 연결 정적 점검 — 수치는 손으로 계산한 값으로 단언한다.
// 실행: node tools/test-plan-axo.js. 화면(캔버스 그림·슬라이더·재생)은 브라우저로 따로 본다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = path.join(__dirname, '..', 'maker/3d/plan');
const rd = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);
const imp = (f) => import(pathToFileURL(path.join(DIR, f)).href);
const { fakeCanvas, fakeDom } = require('./plan-fake-canvas.js');
// 가림 순서 점검 — 면마다 표본 점을 찍어, 그 화면 점에 마지막으로 칠해지는 면이 실제로 가장 가까운(그 점에서 가장 높은) 면이 아니면 틀린 화소다. 그런 표본 수를 센다(붙인 장면)
const inside = (pt, poly) => { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) r = !r; } return r; };
const zAt = (F, pt) => { if (F.side === 'top') return F.z; const [p, q] = F.pts, t = (pt[0] - p[0]) / (q[0] - p[0]); return F.z + (p[1] + (q[1] - p[1]) * t - pt[1]); };   // 그 화면 점에서 면의 높이(옆면은 아랫변에서 잰다)
const samples = (F) => { const n = F.pts.length, c = [0, 1].map((k) => F.pts.reduce((a, p) => a + p[k], 0) / n); return [c, ...F.pts.flatMap((p) => [0.5, 0.9].map((t) => [c[0] + (p[0] - c[0]) * t, c[1] + (p[1] - c[1]) * t]))]; };
function misordered(faces) {
  let bad = 0;
  for (const F of faces) for (const pt of samples(F)) { let last = null, top = -Infinity; for (const G of faces) if (inside(pt, G.pts)) { last = G; top = Math.max(top, zAt(G, pt)); } if (last && zAt(last, pt) < top - 1) bad++; }
  return bad;
}

(async () => {
  const [X, B, S, M, A] = await Promise.all(['core/axo.js', 'core/mesh3d.js', 'core/store.js', 'core/model.js', 'core/analysis.js'].map(imp));

  /* ===== 0. 정적: 순수 모듈 · 화면 연결 ===== */
  { const src = rd('core/axo.js'), code = src.replace(/\/\/.*$/gm, '');
    assert.ok(/^\/\/ \S/.test(src), 'axo.js 맨 위 한 줄 역할 주석');
    assert.ok(!/\b(document|window|navigator|globalThis)\s*[.\[]|requestAnimationFrame|innerHTML|Math\.random|Date\.now|new Date|from 'three'/.test(code), 'axo.js 는 DOM·three·난수·시계를 쓰지 않는다(순수)');
    const app = rd('app.js'), v2 = rd('view2d.js'), tools = rd('tools.js');
    assert.ok(/shadow: '그림자', axo: '액소' \}/.test(app), '분석 종류에 액소');
    assert.ok(/type: 'range', id: 'plAxoS', min: '0', max: '1'/.test(app) && /h\('label', \{ for: 'plAxoS', text: '벌리기' \}\)/.test(app) && /rgA\.setAttribute\('aria-valuetext'/.test(app), '벌리기 슬라이더: label 연결 · 읽는 값');
    assert.ok(/const axoB = calm\.matches \? null : /.test(app) && /onclick: \(\) => \(playRaf \? stopPlay\(\) : startAxo\(paintAxo\)\)/.test(app), '움직임 줄이기 설정이면 재생 단추가 없다 · 같은 단추로 멈춘다');
    assert.ok(!/axo/.test((app.match(/const savePrefs = [^\n]*/) || [''])[0]), '벌림 값은 환경설정에 남기지 않는다');
    assert.ok(/export function drawAxo\(ctx, C, sc, px\)/.test(v2) && /st\.analysis === 'axo' && view\.axo/.test(v2) && /zoneColors\(C\)/.test(v2), '캔버스: 액소는 같은 캔버스에 그린다 · 존 색은 한 곳에서');
    assert.ok(!/3D/.test(app.split('\n').filter((l) => /액소|벌리기/.test(l)).join('\n').replace(/\/\/.*$/gm, '')), "새 문구에 '3D' 낱말이 없다");
    assert.ok(/state\.analysis === 'axo'\) \{ pan = px;/.test(tools) && /state\.analysis === 'axo'\) return false;/.test(tools), '액소 보기: 캔버스를 끌면 화면만 움직이고 도형은 집히지 않는다');
    /* 화면 연결(app.js · tools.js)을 글자로 고정한다 — 실제 그림은 아래 가짜 캔버스 시험과 브라우저로 본다 */
    const has = (src, lit, msg) => assert.ok(src.includes(lit), msg + ' — ' + lit);
    has(app, "if (mode === 'axo') { tools.setTool('select'); sel.clear(); syncDraw(); }", '액소로 들어가면 고르기 도구로 · 도구 줄 표시도 맞춘다(검토 지적)');
    has(app, "if (state.analysis === 'axo' && name !== 'select') setAnalysis(null);", '액소에서 그리기 도구를 고르면 평면으로');
    has(app, "REFIT = new Set(['shadow', 'axo'])", '액소를 드나들 때 화면을 다시 맞춘다'); has(app, "if (view.axo) { const f = curFloor(store.doc), a = axoOf(f, 1).box; return { ...a, y1: Math.max(a.y1, axoOf(f, 0).box.y1) }; }", '맞춤 범위는 다 벌린 장면 + 붙인 장면의 아랫단');
    has(app, 'MESH.set(f, (m = buildMesh(store.doc, store.doc.floors.indexOf(f))))', '지금 층의 조각'); has(app, 'return axoScene(meshOf(f), { spread, zoneOf: (id) => z.get(id) });', '존 색을 넘긴다');
    has(app, "view.axo = on && m === 'axo' && f.rooms.length ? axoOf(f, state.axo.spread) : null;", '액소 보기일 때만 장면을 넣는다'); has(app, 'axo: { spread: 1 } };', '처음은 다 벌린 채');
    has(app, 'const k = Math.min(1, (ts - t0) / AXO_MS);\n    state.axo = { spread: k * k * (3 - 2 * k) }; syncRoutes(); paint(); view.requestDraw();\n    if (k >= 1) { playRaf = 0; playUi(); } else playRaf = requestAnimationFrame(step);', '재생: 0 → 1 로 부드럽게 가서 멈춘다');
    has(app, "ctl.hidden = !SUNNY.has(m) && !ax; timeBox.hidden = m === 'section' || ax;", '액소에서는 벌리기 칸만'); has(app, "state.mode === '2d' && onCanvas && state.analysis !== 'axo') { e.preventDefault();", '액소에서 전체 고르기는 쉰다');
    has(tools, "if (t) { if (!inScope) return false; ui.setTool(t); return true; }\n    if (state.analysis === 'axo') return false;", '액소에서도 도구 단축키는 듣고(평면으로 돌아간다) 그 밖의 캔버스 글쇠는 쉰다');
    has(tools, "if (state.analysis === 'axo') return { ...d, floors: d.floors.map((f, i) => (i === d.cur ? { ...f, walls: [], rooms: [], columns: [], openings: [], guides: [], items: [] } : f)) };", '액소에서는 아무것도 집히지 않는다');
    has(v2, "if (AX) return drawAxo(ctx, C, AX, px);", '액소면 평면 대신 장면을 그린다'); }

  /* ===== 1. 투영 ===== */
  assert.deepStrictEqual(X.axoPt([0, 0], 0), [0, 0]);
  { const p = X.axoPt([1000, 0], 0); near(p[0], 866.0254, 1e-3); near(p[1], 500, 1e-9); const q = X.axoPt([0, 1000]); near(q[0], -866.0254, 1e-3, '+y 는 화면 왼쪽 아래'); near(q[1], 500, 1e-9); near(X.axoPt([0, 0], 1000)[1], -1000, 1e-9, '높이는 화면 위로'); }

  /* ===== 2. 방 하나(4 × 3 m) + 문 + 창 + 가전: 층 벌리기 ===== */
  const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000] });
  s.exec({ type: 'addOpening', wall: 'W3', at: 0.5, kind: 'door' }); s.exec({ type: 'addOpening', wall: 'W2', at: 0.5, kind: 'window' });
  s.exec({ type: 'addItem', kind: 'appliance', category: 'refrigerator', brand: 'samsung', model: 'T', c: [600, 600], size: [900, 700], heightMm: 1800 });
  const mesh = B.buildMesh(s.doc), H = mesh.height, f = M.curFloor(s.doc), zone = (id) => A.zoneOf(f.rooms.find((r) => r.id === id));
  const s0 = X.axoScene(mesh, { spread: 0, zoneOf: zone }), s1 = X.axoScene(mesh, { spread: 1, zoneOf: zone });
  assert.strictEqual(H, 2300); assert.strictEqual(s0.faces.length, s1.faces.length, '벌려도 면 수는 같다'); assert.ok(s0.faces.length > 20);
  const minY = (sc, kinds) => Math.min(...sc.faces.filter((x) => kinds.includes(x.kind)).flatMap((x) => x.pts.map((p) => p[1])));
  near(minY(s0, ['wall']) - minY(s1, ['wall']), H * X.AXO.gap, 1e-6, '벽은 한 칸'); near(minY(s0, ['appliance']) - minY(s1, ['appliance']), 2 * H * X.AXO.gap, 1e-6, '기기는 두 칸');
  near(s0.ceil[0][0][1] - s1.ceil[0][0][1], 3 * H * X.AXO.gap, 1e-6, '천장선은 세 칸'); assert.deepStrictEqual(s0.floors, s1.floors, '바닥은 그대로');
  near(s0.ceil[0][0][1], s0.floors[0].pts[0][1] - H, 1e-6, '붙이면 천장선은 바닥 위 천장 높이');
  assert.deepStrictEqual(s1.floors.map((r) => [r.id, r.zone]), [['R1', A.zoneOf(f.rooms[0])]], 'zoneOf 값이 바닥에 실린다');
  for (const sc of [s0, s1]) { for (const pts of [...sc.floors.map((r) => r.pts), ...sc.faces.map((x) => x.pts), ...sc.ceil]) for (const p of pts) assert.ok(p[0] >= sc.box.x0 && p[0] <= sc.box.x1 && p[1] >= sc.box.y0 && p[1] <= sc.box.y1, 'box 가 모든 점을 담는다'); }
  assert.ok(s1.box.y0 < s0.box.y0 && s1.box.y1 <= s0.box.y1 && s1.box.x0 === s0.box.x0 && s1.box.x1 === s0.box.x1, '벌리면 위로만 늘어난다(좌우는 그대로)');
  for (const sc of [s0, s1]) for (let i = 1; i < sc.faces.length; i++) assert.ok(sc.faces[i - 1].d <= sc.faces[i].d, '면은 먼 것부터');
  near(X.axoScene(mesh, { spread: 0.5 }).ceil[0][0][1], (s0.ceil[0][0][1] + s1.ceil[0][0][1]) / 2, 1e-6, '벌림은 비례');
  assert.deepStrictEqual(X.axoScene(mesh, { zoneOf: zone }), s0, '벌림 기본값은 0(붙음)'); assert.deepStrictEqual([X.AXO.gap, X.AXO.seg], [1.2, 1000], '층 간격 1.2배 · 조각 1 m');
  for (const sc of [s0, s1]) { const all = [...sc.floors.map((r) => r.pts), ...sc.faces.map((x) => x.pts), ...sc.ceil].flat(), ext = (k, fn) => fn(...all.map((p) => p[k]));
    assert.deepStrictEqual(sc.box, { x0: ext(0, Math.min), y0: ext(1, Math.min), x1: ext(0, Math.max), y1: ext(1, Math.max) }, 'box 는 꼭 맞는다(화면 맞춤이 이 값을 쓴다)'); }
  { const t = new S.Store(); t.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000] }); t.exec({ type: 'addItem', kind: 'appliance', category: 'refrigerator', brand: 'samsung', model: 'T', c: [600, 600], size: [900, 700], heightMm: 2600 });
    const m = B.buildMesh(t.doc), sc = X.axoScene(m, { spread: 1 }); assert.deepStrictEqual([m.height, m.bounds.z1], [2300, 2600], '층고와 카메라 상자 높이는 따로');
    near(sc.ceil[0][0][1], sc.floors[0].pts[0][1] - 2300 - 3 * 2300 * 1.2, 1e-6, '층고보다 큰 가전이 있어도 천장선·층 간격은 층고로 잡는다'); }
  { const tpl = JSON.parse(rd('data/templates.json')).templates, d3 = tpl.find((t) => t.id === 'three-b').doc, m3 = B.buildMesh(d3), sc = X.axoScene(m3, { spread: 0 });   // 방 여럿
    assert.strictEqual(sc.floors.length, 7); assert.strictEqual(sc.ceil.length, 7, '천장선은 방마다');
    sc.ceil.forEach((pts, i) => pts.forEach((p, j) => { near(p[0], sc.floors[i].pts[j][0], 1e-9); near(p[1], sc.floors[i].pts[j][1] - m3.height, 1e-9, '천장선 = 바닥 윤곽 + 층고'); }));
    /* 가림 순서: 템플릿 10종 모두 덮여서 틀리는 표본이 없다 */
    for (const t of tpl) assert.strictEqual(misordered(X.axoScene(B.buildMesh(t.doc)).faces), 0, t.id + ' 가림 순서');
    /* 그리기(view2d.js drawAxo · 액소 보기일 때의 draw): 가짜 캔버스에 돌려 부른 것을 센다 */
    fakeDom(); const V = await imp('view2d.js'), cv = fakeCanvas(), f3 = M.curFloor(d3), zc = { public: '--c-accent', private: '--c-up', service: '--c-control' };
    const scz = X.axoScene(m3, { spread: 1, zoneOf: (id) => A.zoneOf(f3.rooms.find((r) => r.id === id)) }), none = { has: () => false, size: 0, ids: [] };
    let st = { analysis: 'axo', showGrid: true, showLabels: true, unit: 'mm' };
    const v = V.createView2D(cv, { store: { doc: d3 }, getState: () => st, getSel: () => none, offscreen: true }), n = (k) => cv.log.filter((x) => x[0] === k);
    v.renderTo(500, 400, 2, { axo: scz, bounds: scz.box });
    assert.strictEqual(n('fill').length, scz.floors.length + scz.faces.length, '바닥 + 면을 모두 칠한다'); assert.strictEqual(n('stroke').length, scz.floors.length + scz.faces.length + scz.ceil.length, '천장선까지 긋는다');
    assert.deepStrictEqual(n('fill').slice(0, 7).map((x) => x[2]), scz.floors.map((r) => zc[r.zone]), '바닥은 존 색'); assert.ok(new Set(scz.floors.map((r) => r.zone)).size > 1);
    assert.strictEqual(n('fillText').length, 0, '액소에는 글씨·격자가 없다'); assert.ok(n('setLineDash').some((x) => x[1][0].length === 2), '천장선은 점선');
    const [a, , , , e, g] = n('setTransform').at(-1)[1]; for (const [x, y] of [[scz.box.x0, scz.box.y0], [scz.box.x1, scz.box.y1]]) assert.ok(a * x + e >= 0 && a * x + e <= cv.width && a * y + g >= 0 && a * y + g <= cv.height, '장면 전체가 화면 안');
    cv.log.length = 0; st = { ...st, analysis: null }; v.renderTo(500, 400, 2, { axo: scz, bounds: scz.box }); assert.ok(n('fillText').length > 0, '평면 보기에서는 액소 장면이 있어도 평면을 그린다'); }

  /* ===== 3. 개구부 · 긴 벽 분할 ===== */
  { const door = mesh.walls.filter((w) => w.id === 'W3'), win = mesh.walls.filter((w) => w.id === 'W2');
    assert.deepStrictEqual(door.map((w) => w.part).sort(), ['full', 'full', 'lintel'], '문 자리: 양옆 벽 + 상인방'); assert.deepStrictEqual(win.map((w) => w.part).sort(), ['full', 'full', 'lintel', 'sill'], '창 자리: 창대 + 상인방');
    const only = (id) => X.axoScene({ ...mesh, walls: mesh.walls.filter((w) => w.id === id), items: [] }).faces;
    const sides = only('W3').filter((x) => x.side !== 'top'); assert.ok(sides.length >= 5, '4 m 벽 옆면은 조각으로 나뉜다: ' + sides.length);
    for (const x of sides) assert.ok(Math.hypot(x.pts[1][0] - x.pts[0][0], x.pts[1][1] - x.pts[0][1]) <= X.AXO.seg + 1e-6, '조각은 seg 이하');
    assert.strictEqual(only('W1').filter((x) => x.side !== 'top').length, 5, '개구부 없는 4.15 m 벽의 긴 옆면 4조각 + 끝면');
    for (const x of mesh.walls.flatMap((w) => only(w.id)).filter((x) => x.side === 'top')) { const ys = x.pts.map((p) => p[1]); assert.ok(2 * (Math.max(...ys) - Math.min(...ys)) <= X.AXO.seg + 1e-6, '윗면은 d 띠(seg) 조각으로'); }
    /* 조각 하나씩: 높이(z0~z1)가 투영에 그대로 — 통벽 2300 · 상인방 · 창대 · 가전 1800 */
    const pieces = [...mesh.walls, ...mesh.items]; assert.deepStrictEqual([...new Set(pieces.map((p) => `${p.z0}-${p.z1}`))].sort(), ['0-1800', '0-2300', '0-900', '2100-2300'], '시험 조각의 높이 종류');
    for (const p of pieces) { const one = X.axoScene({ walls: p.kind === 'appliance' ? [] : [p], items: p.kind === 'appliance' ? [p] : [], floors: [], height: 2300 }).faces, ys = one.flatMap((x) => x.pts.map((q) => q[1])), h = p.poly.map((q) => (q[0] + q[1]) / 2);
      near(Math.max(...ys), Math.max(...h) - p.z0, 1e-6, '아랫단은 z0'); near(Math.min(...ys), Math.min(...h) - p.z1, 1e-6, '윗단은 z1');
      for (const x of one) if (x.side === 'top') { assert.strictEqual(x.z, p.z1); for (const q of x.pts) assert.ok(q[1] <= Math.max(...h) - p.z1 + 1e-6 && q[1] >= Math.min(...h) - p.z1 - 1e-6, '윗면은 z1 높이에'); } else { assert.strictEqual(x.z, p.z0); near(x.pts[0][1] - x.pts[3][1], p.z1 - p.z0, 1e-6, '옆면 높이 = z1 − z0'); near(x.pts[1][1] - x.pts[2][1], p.z1 - p.z0, 1e-6); } }
    /* 벽 속 끝면: 문·창 옆 통벽에 맞닿은 상인방·창대 끝면은 그리지 않는다(문틀 쪽 통벽 끝면은 남는다) */
    const cnt = (id) => X.axoScene({ ...mesh, walls: mesh.walls.filter((w) => w.id === id), items: [] }).faces.filter((x) => x.side !== 'top').length, alone = (id) => mesh.walls.filter((w) => w.id === id).reduce((a, w) => a + X.axoScene({ walls: [w], items: [], floors: [], height: 2300 }).faces.filter((x) => x.side !== 'top').length, 0);
    assert.strictEqual(alone('W3') - cnt('W3'), 1, '문 상인방: 보이는 쪽 끝면 하나가 빠진다'); assert.strictEqual(alone('W2') - cnt('W2'), 2, '창: 상인방·창대 끝면 둘이 빠진다');
    const jamb = X.axoScene({ ...mesh, walls: mesh.walls.filter((w) => w.id === 'W2'), items: [] }).faces.filter((x) => x.side !== 'top' && x.z === 900); assert.strictEqual(jamb.length, 1, '창 옆 통벽 끝면은 창대 위부터'); near(jamb[0].pts[0][1] - jamb[0].pts[3][1], 1200, 1e-6, '상인방 아래까지(900~2100)'); }

  /* ===== 3-1. 가림 순서(검토 재현): 긴 방 + 칸막이 — 칸막이 옆면이 앞벽 윗면을 덮지 않는다 ===== */
  { const t = new S.Store(); t.exec({ type: 'addRoomRect', a: [0, 0], b: [10000, 3000] }); t.exec({ type: 'addWall', a: [7000, 0], b: [7000, 3000] });
    const fs2 = X.axoScene(B.buildMesh(t.doc)).faces; assert.strictEqual(misordered(fs2), 0, '긴 벽 + 칸막이');
    assert.ok(misordered(fs2.slice().reverse()) > 0, '점검 자체가 틀린 순서를 잡는다');
    assert.strictEqual(misordered(X.axoScene(mesh).faces), 0, '방 하나 + 문 · 창 · 가전'); }

  /* ===== 3-2. 이음매: 서로 파고든 벽 속의 옆면은 없다 — 남은 옆면 조각은 어느 벽 조각 속에도 있지 않다 ===== */
  { const tpl = JSON.parse(rd('data/templates.json')).templates, m3 = B.buildMesh(tpl.find((t) => t.id === 'three-b').doc), sc = X.axoScene(m3), inv = (p, z) => { const d = 2 * (p[1] + z), e = p[0] / X.AXO.cos; return [(d + e) / 2, (d - e) / 2]; };
    let n = 0; for (const x of sc.faces) if (x.side !== 'top') { const a = inv(x.pts[0], x.z), b = inv(x.pts[1], x.z), L = Math.hypot(b[0] - a[0], b[1] - a[1]), o = [(a[0] + b[0]) / 2 - (b[1] - a[1]) / L, (a[1] + b[1]) / 2 + (b[0] - a[0]) / L], zm = x.z + (x.pts[0][1] - x.pts[3][1]) / 2;   // 면 한가운데에서 1 mm 밖(시계방향 고리의 바깥)
      const mir = [a[0] + b[0] - o[0], a[1] + b[1] - o[1]], inWall = (q) => m3.walls.some((w) => w.z0 < zm && w.z1 > zm && inside(q, w.poly));
      n++; assert.ok(!(inWall(o) && inWall(mir)), '옆면의 양쪽이 다 벽 속이면 묻힌 면이다'); }
    assert.ok(n > 100); }

  /* ===== 4. 뒷면 제거 · 정렬(사각 기둥 둘) ===== */
  { const col = (c) => ({ id: 'C', poly: [[c - 150, c - 150], [c + 150, c - 150], [c + 150, c + 150], [c - 150, c + 150]], z0: 0, z1: 2300, kind: 'column', part: 'column' });
    const one = X.axoScene({ walls: [col(300)], items: [], floors: [], height: 2300 });
    assert.deepStrictEqual(one.faces.map((x) => x.side).sort(), ['l', 'r', 'top'], '기둥: 윗면 + 보이는 옆면 둘'); assert.ok(one.faces.every((x) => x.kind === 'column'));
    const front = (sc) => sc.faces.filter((x) => x.side !== 'top').every((x) => x.d > 600 && Math.min(...x.pts.map((p) => p[1])) > -2300 - 1e-9 && Math.max(...x.pts.map((p) => p[1])) > 0);   // 기둥 중심(d = 600)보다 앞 · 화면 아래쪽
    assert.ok(front(one), '보이는 옆면은 앞쪽(+x · +y) 둘이다(뒷면이 아니다)');
    const l = one.faces.find((x) => x.side === 'l'), r = one.faces.find((x) => x.side === 'r'); assert.ok(Math.max(...l.pts.map((p) => p[0])) <= 1e-9 && Math.min(...r.pts.map((p) => p[0])) >= -1e-9, '왼쪽 면은 화면 왼쪽, 오른쪽 면은 오른쪽');
    const rev = X.axoScene({ walls: [{ ...col(300), poly: col(300).poly.slice().reverse() }], items: [], floors: [], height: 2300 }); assert.deepStrictEqual(rev.faces.map((x) => x.side).sort(), ['l', 'r', 'top'], '고리 방향이 반대여도 같다'); assert.ok(front(rev), '고리 방향이 반대여도 앞면을 고른다');
    const two = X.axoScene({ walls: [col(3300), col(300)], items: [], floors: [], height: 2300 });
    assert.deepStrictEqual(two.faces.map((x) => x.d < 1000), [true, true, true, false, false, false], '뒤(−x−y) 기둥의 세 면이 먼저, 앞 기둥이 나중');
    assert.deepStrictEqual(X.axoScene({ walls: [], items: [], floors: [] }), { floors: [], faces: [], ceil: [], box: null }, '빈 층'); }

  console.log('test-plan-axo: OK');
})().catch((e) => { console.error(e); process.exit(1); });
