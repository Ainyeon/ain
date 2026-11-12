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
    assert.ok(/state\.analysis === 'axo'\) \{ pan = px;/.test(tools) && /state\.analysis === 'axo'\) return false;/.test(tools), '액소 보기: 캔버스를 끌면 화면만 움직이고 도형은 집히지 않는다'); }

  /* ===== 1. 투영 ===== */
  assert.deepStrictEqual(X.axoPt([0, 0], 0), [0, 0]);
  { const p = X.axoPt([1000, 0], 0); near(p[0], 866.0254, 1e-3); near(p[1], 500, 1e-9); const q = X.axoPt([0, 1000]); near(q[0], -866.0254, 1e-3, '+y 는 화면 왼쪽 아래'); near(q[1], 500, 1e-9); near(X.axoPt([0, 0], 1000)[1], -1000, 1e-9, '높이는 화면 위로'); }

  /* ===== 2. 방 하나(4 × 3 m) + 문 + 창 + 가전: 층 벌리기 ===== */
  const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000] });
  s.exec({ type: 'addOpening', wall: 'W3', at: 0.5, kind: 'door' }); s.exec({ type: 'addOpening', wall: 'W2', at: 0.5, kind: 'window' });
  s.exec({ type: 'addItem', kind: 'appliance', category: 'refrigerator', brand: 'samsung', model: 'T', c: [600, 600], size: [900, 700], heightMm: 1800 });
  const mesh = B.buildMesh(s.doc), H = mesh.bounds.z1, f = M.curFloor(s.doc), zone = (id) => A.zoneOf(f.rooms.find((r) => r.id === id));
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

  /* ===== 3. 개구부 · 긴 벽 분할 ===== */
  { const door = mesh.walls.filter((w) => w.id === 'W3'), win = mesh.walls.filter((w) => w.id === 'W2');
    assert.deepStrictEqual(door.map((w) => w.part).sort(), ['full', 'full', 'lintel'], '문 자리: 양옆 벽 + 상인방'); assert.deepStrictEqual(win.map((w) => w.part).sort(), ['full', 'full', 'lintel', 'sill'], '창 자리: 창대 + 상인방');
    const only = (id) => X.axoScene({ ...mesh, walls: mesh.walls.filter((w) => w.id === id), items: [] }).faces;
    const sides = only('W3').filter((x) => x.side !== 'top'); assert.ok(sides.length >= 5, '4 m 벽 옆면은 조각으로 나뉜다: ' + sides.length);
    for (const x of sides) assert.ok(Math.hypot(x.pts[1][0] - x.pts[0][0], x.pts[1][1] - x.pts[0][1]) <= X.AXO.seg + 1e-6, '조각은 seg 이하');
    assert.strictEqual(only('W3').filter((x) => x.side === 'top').length, 3); assert.strictEqual(only('W2').filter((x) => x.side === 'top').length, 4); }

  /* ===== 4. 뒷면 제거 · 정렬(사각 기둥 둘) ===== */
  { const col = (c) => ({ id: 'C', poly: [[c - 150, c - 150], [c + 150, c - 150], [c + 150, c + 150], [c - 150, c + 150]], z0: 0, z1: 2300, kind: 'column', part: 'column' });
    const one = X.axoScene({ walls: [col(0)], items: [], floors: [], bounds: { z1: 2300 } });
    assert.deepStrictEqual(one.faces.map((x) => x.side).sort(), ['l', 'r', 'top'], '기둥: 윗면 + 보이는 옆면 둘'); assert.ok(one.faces.every((x) => x.kind === 'column'));
    const l = one.faces.find((x) => x.side === 'l'), r = one.faces.find((x) => x.side === 'r'); assert.ok(Math.max(...l.pts.map((p) => p[0])) <= 1e-9 && Math.min(...r.pts.map((p) => p[0])) >= -1e-9, '왼쪽 면은 화면 왼쪽, 오른쪽 면은 오른쪽');
    const rev = X.axoScene({ walls: [{ ...col(0), poly: col(0).poly.slice().reverse() }], items: [], floors: [], bounds: { z1: 2300 } }); assert.deepStrictEqual(rev.faces.map((x) => x.side).sort(), ['l', 'r', 'top'], '고리 방향이 반대여도 같다');
    const two = X.axoScene({ walls: [col(3000), col(0)], items: [], floors: [], bounds: { z1: 2300 } });
    assert.deepStrictEqual(two.faces.map((x) => x.d < 1000), [true, true, true, false, false, false], '뒤(−x−y) 기둥의 세 면이 먼저, 앞 기둥이 나중');
    assert.deepStrictEqual(X.axoScene({ walls: [], items: [], floors: [], bounds: null }), { floors: [], faces: [], ceil: [], box: null }, '빈 층'); }

  console.log('test-plan-axo: OK');
})().catch((e) => { console.error(e); process.exit(1); });
