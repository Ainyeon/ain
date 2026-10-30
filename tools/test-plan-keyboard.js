// 2D 편집기 키보드 조작(WCAG 2.1.1 키보드 · 2.1.4 한 글자 단축키) 시험 — maker/3d/plan/{tools.js, view2d.js, app.js, index.html}.
// 순수 계산(커서 이동·스냅·범위·요소 훑기 순서·낭독 글)과, 가짜 캔버스로 키를 흘려 마우스와 같은 결과가 나오는지 본다. 실제 화면은 브라우저(playwright)로 따로 본다.
// 실행: node tools/test-plan-keyboard.js. 변이 시험용으로 PLAN_KB_DIR 로 다른 사본을 가리킬 수 있다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = process.env.PLAN_KB_DIR || path.join(__dirname, '..', 'maker/3d/plan');
const rd = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const imp = (f) => import(pathToFileURL(path.join(DIR, f)).href);

(async () => {
  const T = await imp('tools.js'), M = await imp('view2d.js'), Mo = await imp('core/model.js'), { Store } = await imp('core/store.js');
  const VP = { scale: 0.1, ox: 0, oy: 0, w: 800, h: 600 }; // 화면 가운데 = (4000, 3000) mm, 스냅 50 mm

  /* ===== 1. 순수 계산 ===== */
  // 방향키 = 스냅 한 칸, Shift = 10칸, 칸에서 벗어난 자리는 가까운 칸에 맞춘 뒤 간다
  assert.deepStrictEqual(T.kbMove([4000, 3000], 'ArrowRight', false, 50), [4050, 3000]);
  assert.deepStrictEqual(T.kbMove([4000, 3000], 'ArrowLeft', false, 50), [3950, 3000]);
  assert.deepStrictEqual(T.kbMove([4000, 3000], 'ArrowUp', false, 50), [4000, 2950]);
  assert.deepStrictEqual(T.kbMove([4000, 3000], 'ArrowDown', true, 50), [4000, 3500], 'Shift = 10칸');
  assert.deepStrictEqual(T.kbMove([4010, 3020], 'ArrowLeft', false, 50), [3950, 3000], '칸 밖의 자리는 가까운 칸에 맞춘 뒤 이동');
  assert.deepStrictEqual(T.kbMove([4000, 3000], 'ArrowRight', true, 1000), [14000, 3000], '배율에 따라 바뀌는 칸 크기를 따른다');
  assert.ok(Object.is(T.kbMove([-10, 0], 'ArrowDown', false, 50)[0], 0), '-0 이 아니라 0');
  assert.deepStrictEqual(T.kbMove([Mo.COORD_MAX, 0], 'ArrowRight', true, 50), [Mo.COORD_MAX, 0], '도면 좌표 상한(+)을 넘지 않는다');
  assert.deepStrictEqual(T.kbMove([0, -Mo.COORD_MAX], 'ArrowUp', false, 50), [0, -Mo.COORD_MAX], '도면 좌표 상한(−)');
  assert.strictEqual(T.kbMove([0, 0], 'Enter', false, 50), null, '방향키가 아니면 null');
  assert.deepStrictEqual(Object.keys(T.KB_DIRS), ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
  assert.deepStrictEqual([...T.KB_TOOLS].sort(), ['arc', 'calibrate', 'colRect', 'colRound', 'delete', 'guide', 'measure', 'opening', 'placeItem', 'room', 'wall'], '키보드 커서로 점을 찍는 도구');

  // 처음 자리: 마지막 포인터가 화면 안이면 거기(스냅), 없거나 밖이거나 가장자리 여백이면 가운데
  assert.deepStrictEqual(T.kbStart(VP, null, 50), [4000, 3000], '포인터가 없으면 보이는 영역 가운데');
  assert.deepStrictEqual(T.kbStart(VP, [1234, 567], 50), [1250, 550], '마지막 포인터 자리(스냅)');
  assert.deepStrictEqual(T.kbStart(VP, [-500, 100], 50), [4000, 3000], '화면 밖이면 가운데');
  assert.deepStrictEqual(T.kbStart(VP, [200, 100], 50), [4000, 3000], '가장자리 여백(24px) 안이면 가운데');
  assert.deepStrictEqual(T.kbStart({ ...VP, ox: 100, oy: 50 }, null, 50), [3000, 2500], '화면을 옮겼으면 옮긴 화면의 가운데');

  // 범위: 가장자리 여백 밖으로 나가면 화면을 밀어 안으로 넣는다
  assert.deepStrictEqual(T.kbScroll(VP, [4000, 3000]), [0, 0]);
  assert.deepStrictEqual(T.kbScroll(VP, [50, 3000]), [19, 0], '왼쪽 여백 밖 → 오른쪽으로 19px');
  assert.deepStrictEqual(T.kbScroll(VP, [7950, 5950]), [-19, -19], '오른쪽 아래 여백 밖');
  assert.deepStrictEqual(T.kbScroll(VP, [4000, -1000]), [0, 124], '화면 위로 한참 벗어나면 그만큼');
  assert.deepStrictEqual(T.kbScroll({ ...VP, w: 40, h: 40 }, [0, 0]), [10, 10], '아주 작은 화면은 여백도 줄인다');

  // 요소를 훑는 순서: 처음/끝에서 돌아 나온다
  const ids = ['W1', 'W2', 'R1'];
  assert.deepStrictEqual([T.stepId(ids, null, 1), T.stepId(ids, null, -1), T.stepId(ids, 'R1', 1), T.stepId(ids, 'W1', -1), T.stepId(ids, 'W1', 1), T.stepId(ids, 'R1', -1), T.stepId(ids, 'nope', 1)], ['W1', 'R1', 'W1', 'R1', 'W2', 'W2', 'W1']);
  assert.strictEqual(T.stepId([], null, 1), null, '요소가 없으면 null'); assert.strictEqual(T.stepId(['A'], 'A', 1), 'A'); assert.strictEqual(T.stepId(['A'], 'A', -1), 'A');
  assert.strictEqual(T.kbText([1234.4, -50]), '1,234, -50 mm');

  // 낭독 글: 종류 + 이름 (+ 치수)
  const base = new Store(Mo.createDoc());
  base.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000], name: '거실' });
  base.exec({ type: 'addWall', a: [0, 5000], b: [3000, 5000], bulge: 400 }); base.exec({ type: 'addColumn', kind: 'round', c: [6000, 1000] }); base.exec({ type: 'addColumn', kind: 'rect', c: [6500, 1000] });
  base.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' }); base.exec({ type: 'addOpening', wall: 'W2', at: 0.5, kind: 'window' }); base.exec({ type: 'addGuide', a: [0, 6000], b: [2000, 6000] });
  base.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'samsung', c: [2000, 1500], rot: 0, capacityKw: 2.3, code: 'AC023CN1DBC1', size: [1200, 500] });
  const d0 = base.doc;
  assert.deepStrictEqual(['W1', 'R1', 'C1', 'C2', 'O1', 'O2', 'G1', 'I1'].map((i) => T.describeEl(d0, i)), ['벽 W1 · 4,150 mm', '방 거실', '원형 기둥 C1', '사각 기둥 C2', '문 O1', '창 O2', '보조선 G1 · 2,000 mm', '에어컨 AC023CN1DBC1']);
  assert.ok(/^곡선벽 W5 · /.test(T.describeEl(d0, 'W5')), '곡선벽'); assert.strictEqual(T.describeEl(d0, 'nope'), '', '없는 id');
  assert.deepStrictEqual(T.allIds(Mo.curFloor(d0)).map((i) => i[0]), ['W', 'W', 'W', 'W', 'W', 'R', 'C', 'C', 'O', 'O', 'G', 'I'], '훑는 순서 = 벽 · 방 · 기둥 · 개구부 · 보조선 · 제품');

  /* ===== 2. 가짜 캔버스로 키를 흘려 본다 (화면 800×600, 0.1 px/mm → 가운데 (4000, 3000), 스냅 50 mm) ===== */
  const mk = (over = {}, init = () => {}) => {
    let vp0 = { ...VP };
    const store = new Store(Mo.createDoc()), state = { locked: false, multi: false, touch: false, ...over }, log = { toasts: [], said: [], hint: null, pans: [], centers: [], draws: 0 };
    const sel = new T.Selection();
    const view = {
      get vp() { return vp0; }, hover: null, underlayTemp: null, toMm: (p) => M.toMm(vp0, p), toPx: (p) => M.toPx(vp0, p), requestDraw() { log.draws++; },
      panBy(dx, dy) { log.pans.push([dx, dy]); vp0 = M.panBy(vp0, dx, dy); }, set() {}, centerOn(p) { log.centers.push(p); vp0 = { ...vp0, ox: vp0.w / 2 - p[0] * vp0.scale, oy: vp0.h / 2 - p[1] * vp0.scale }; },
      entry: (id) => M.floorCache(Mo.curFloor(store.doc)).by.get(id) || null,
    };
    let tools;
    const ui = { toast: (m) => log.toasts.push(m), say: (m) => log.said.push(m), cursor() {}, hint: (n, t) => { log.hint = [n, t]; }, setTool: (n, o) => tools.setTool(n, o), renameRoom() {}, calibrated() {} };
    init(store);
    tools = T.createTools({ store, view, sel, ui, state });
    const canvas = { l: {}, addEventListener(t, f) { (this.l[t] ||= []).push(f); }, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {}, focus() {}, matches: () => true };
    tools.attach(canvas);
    const target = { id: 'plCanvas' };
    const k = (key, o = {}) => tools.key({ key, code: o.code || key, shiftKey: false, repeat: false, target, ...o }, o.inScope !== false);
    const fire = (type, x, y, o = {}) => (canvas.l[type] || []).forEach((f) => f({ type, pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: false, clientX: x, clientY: y, preventDefault() {}, ...o }));
    return {
      store, tools, state, sel, log, view, canvas, fire, k, flr: () => Mo.curFloor(store.doc),
      focus(visible = true) { canvas.matches = () => visible; fire('focus'); },
      enter: (o) => k('Enter', o), space: () => k(' ', { code: 'Space' }), right: (n = 1, big = false) => { for (let i = 0; i < n; i++) k('ArrowRight', { shiftKey: big }); }, down: (n = 1, big = false) => { for (let i = 0; i < n; i++) k('ArrowDown', { shiftKey: big }); },
      left: (n = 1, big = false) => { for (let i = 0; i < n; i++) k('ArrowLeft', { shiftKey: big }); }, up: (n = 1, big = false) => { for (let i = 0; i < n; i++) k('ArrowUp', { shiftKey: big }); },
      tap(x, y, o) { fire('pointerdown', x, y, o); fire('pointerup', x, y, o); },
    };
  };
  const stub = { model: '1way', brand: 'samsung', code: 'AC023CN1DBC1', capacityKw: 2.3, size: [1200, 500] };

  // A. 초점이 키보드로 오면 커서가 보이고, 마우스로 오면 보이지 않는다
  { const t = mk(); assert.strictEqual(t.tools.kb, null, '처음에는 커서 없음'); t.focus(false); assert.strictEqual(t.tools.kb, null, '마우스 초점은 커서를 띄우지 않는다');
    const u = mk(); u.focus(true); assert.deepStrictEqual(u.tools.kb, { mm: [4000, 3000] }, '키보드 초점 → 화면 가운데에 커서');
    u.fire('pointermove', 100, 100); assert.strictEqual(u.tools.kb, null, '마우스가 움직이면 커서는 물러난다');
    const v = mk(); v.fire('pointermove', 200, 100); v.focus(true); assert.deepStrictEqual(v.tools.kb, { mm: [2000, 1000] }, '마지막 포인터 자리에서 시작');
    const w = mk(); w.focus(true); w.fire('pointerdown', 300, 300); w.fire('pointerup', 300, 300); assert.strictEqual(w.tools.kb, null, '누르면(pointerdown) 커서는 물러난다'); }

  // B. 벽: Enter(시작) → 방향키 → Enter(끝) 로 벽이 생기고 실행 취소가 된다. 마우스로 같은 두 점을 누른 것과 문서가 같다
  { const t = mk(); t.tools.setTool('wall'); t.focus();
    t.enter(); assert.deepStrictEqual(t.tools.op && t.tools.op.a, [4000, 3000], '첫 Enter = 시작점'); assert.strictEqual(t.flr().walls.length, 0); assert.strictEqual(t.log.said.at(-1), '점을 찍었습니다 · 4,000, 3,000 mm', '시작점을 읽는다');
    t.right(2, true); assert.deepStrictEqual(t.tools.kb.mm, [5000, 3000]); t.enter();
    assert.deepStrictEqual(t.flr().walls.map((w) => [w.a, w.b]), [[[4000, 3000], [5000, 3000]]], '두 번째 Enter = 벽'); assert.strictEqual(t.log.said.at(-1), '벽을 추가했습니다 · 1,000 mm'); assert.ok(t.store.canUndo, '실행 취소가 켜진다');
    const m = mk(); m.tools.setTool('wall'); m.tap(400, 300); m.tap(500, 300); assert.deepStrictEqual(t.flr(), m.flr(), '키보드와 마우스의 문서가 같다');
    t.down(1, true); t.enter(); assert.strictEqual(t.flr().walls.length, 2, '이어 그리기'); assert.deepStrictEqual(t.flr().walls[1].a, [5000, 3000], '이전 벽의 끝에서 이어진다');
    t.k('Escape', { code: 'Escape' }); assert.strictEqual(t.tools.op, null, 'Esc = 이어 그리기 끝(기존 동작)'); assert.strictEqual(t.tools.tool, 'wall'); t.k('Escape', { code: 'Escape' }); assert.strictEqual(t.tools.tool, 'select', '한 번 더 Esc = 선택 도구');
    t.store.undo(); t.store.undo(); assert.strictEqual(t.flr().walls.length, 0, '실행 취소로 되돌린다'); }
  { const t = mk(); t.tools.setTool('wall'); t.focus(); t.enter(); t.enter(); assert.strictEqual(t.tools.op, null, '같은 자리를 또 누르면 끝(마우스 더블클릭과 같다)'); assert.strictEqual(t.log.said.at(-1), '그리기를 마쳤습니다'); }

  // C. 방: 두 번 누르기 = 마우스와 같은 방. Shift+Enter = 다각형, 첫 점에서 Enter 로 닫는다
  { const t = mk(); t.tools.setTool('room'); t.focus(); t.enter(); assert.strictEqual(t.tools.op.mode, 'rect'); t.right(2, true); t.down(2, true); t.enter();
    const m = mk(); m.tools.setTool('room'); m.tap(400, 300); m.tap(500, 400); assert.strictEqual(t.flr().rooms.length, 1); assert.deepStrictEqual(t.flr(), m.flr(), '방: 키보드와 마우스의 문서가 같다'); assert.strictEqual(t.log.said.at(-1), '방을 만들었습니다'); }
  { const t = mk(); t.tools.setTool('room'); t.focus(); t.enter({ shiftKey: true }); assert.strictEqual(t.tools.op.mode, 'poly'); t.right(2, true); t.enter(); t.down(2, true); t.enter(); t.left(2, true); t.enter(); assert.strictEqual(t.tools.op.pts.length, 4);
    t.up(2, true); t.enter(); assert.strictEqual(t.flr().rooms.length, 1, '첫 점 위에서 Enter 하면 닫힌다'); assert.strictEqual(t.tools.op, null);
    t.state.touch = false; t.tools.setTool('room'); t.enter({ shiftKey: true }); t.right(); t.enter(); t.right(); t.enter(); assert.ok(!/Enter 로도 닫습니다/.test(t.log.hint[1]), '커서로 그릴 때는 Enter 가 점을 찍으므로 "Enter 로도 닫습니다"를 말하지 않는다'); }

  // D. 기둥 · 보조선 · 측정 · 곡선벽
  for (const kind of ['colRect', 'colRound']) { const t = mk(); t.tools.setTool(kind); t.focus(); t.enter(); assert.deepStrictEqual(t.flr().columns.map((c) => c.c), [[4000, 3000]], kind);
    t.enter(); assert.strictEqual(t.flr().columns.length, 1, kind + ' 같은 자리 Enter 는 무시'); t.right(); t.k('Enter', { repeat: true }); assert.strictEqual(t.flr().columns.length, 1, kind + ' 키를 누르고 있어도 한 번'); t.enter(); assert.strictEqual(t.flr().columns.length, 2); assert.strictEqual(t.log.said.at(-1), '기둥을 놓았습니다'); }
  { const t = mk(); t.tools.setTool('guide'); t.focus(); t.enter(); t.right(4, true); t.enter(); const m = mk(); m.tools.setTool('guide'); m.tap(400, 300); m.tap(600, 300); assert.deepStrictEqual(t.flr().guides, m.flr().guides, '보조선'); }
  { const t = mk(); t.tools.setTool('measure'); t.focus(); t.enter(); t.right(2, true); t.enter(); assert.ok(t.tools.op.done); assert.strictEqual(t.log.said.at(-1), '거리 1,000 mm', '측정 결과를 읽는다'); assert.strictEqual(t.store.canUndo, false, '측정은 문서를 바꾸지 않는다'); }
  { const t = mk(); t.tools.setTool('arc'); t.focus(); t.enter(); t.right(4, true); t.enter(); assert.ok(t.tools.op.b); t.down(2, true); t.enter(); assert.deepStrictEqual(t.flr().walls.map((w) => w.bulge), [1000], '곡선벽: 시작·끝·처짐 세 번'); }

  // E. 제품 놓기: Enter 가 커서 자리에, 검증은 마우스와 같다 · ] [ 로 돌린다
  { const t = mk({}, (s) => s.exec({ type: 'addRoomRect', a: [0, 0], b: [6000, 5000] })); t.tools.setTool('placeItem', stub); t.focus();
    t.enter(); assert.deepStrictEqual(t.flr().items.map((i) => [i.c, i.rot]), [[[4000, 3000], 0]]); assert.strictEqual(t.log.said.at(-1), 'AC023CN1DBC1 을 놓았습니다');
    t.right(5, true); t.enter(); assert.strictEqual(t.flr().items.length, 1, '방 밖은 놓이지 않는다'); assert.strictEqual(t.log.toasts.at(-1), '방 안에서 놓아 주세요');
    t.left(3, true); t.k(']', { code: 'BracketRight' }); t.enter(); assert.deepStrictEqual(t.flr().items.map((i) => i.rot), [0, 90], '] = 90° 돌려 놓는다'); }

  // F. 개구부: 벽 위에서 Enter 하면 붙고 그 개구부가 고른 상태가 된다(속성 패널·경첩 단추가 만들어진다)
  { const t = mk({}, (s) => s.exec({ type: 'addRoomRect', a: [0, 0], b: [6000, 5000] })); t.tools.setTool('opening', { type: 'door' }); t.focus(); t.up(6, true); t.enter();
    assert.deepStrictEqual(t.flr().openings.map((o) => [o.wall, o.type]), [['W1', 'door']]); assert.deepStrictEqual([...t.sel.ids], ['O1'], '붙인 개구부가 선택된다'); assert.strictEqual(t.log.said.at(-1), '문을 붙였습니다'); }
  { const t = mk(); t.tools.setTool('opening'); t.focus(); t.enter(); assert.strictEqual(t.log.toasts.at(-1), '벽 위에서 누르세요', '벽이 없으면 마우스와 같은 안내'); }

  // G. 삭제: 커서 아래 요소를 지운다
  { const t = mk({}, (s) => s.exec({ type: 'addColumn', kind: 'rect', c: [4000, 3000] })); t.tools.setTool('delete'); t.focus(); t.enter(); assert.strictEqual(t.flr().columns.length, 0); assert.strictEqual(t.log.said.at(-1), '지웠습니다'); }

  // H. 고르기: Enter = 커서 자리의 요소, [ ] = 모든 요소를 차례로. 고른 것이 있으면 방향키는 그것을 옮긴다(기존)
  { const t = mk({}, (s) => s.replace(d0)); t.focus(); assert.strictEqual(t.tools.tool, 'select'); assert.deepStrictEqual(t.tools.kb.mm, [4000, 3000]);
    t.right(6, true); t.down(5, true); t.enter(); assert.strictEqual(t.sel.size, 0, '빈 곳에서 Enter = 고른 것 없음'); assert.strictEqual(t.log.said.at(-1), '고른 것이 없습니다');
    const all = T.allIds(t.flr()); t.sel.clear();
    const seen = []; for (let i = 0; i < all.length; i++) { t.k(']', { code: 'BracketRight' }); seen.push([...t.sel.ids][0]); }
    assert.deepStrictEqual(seen, all, '] 는 모든 요소를 벽 · 방 · 기둥 · 개구부 · 보조선 · 제품 순서로 한 번씩'); t.k(']', { code: 'BracketRight' }); assert.strictEqual([...t.sel.ids][0], all[0], '끝에서 처음으로 돌아 나온다');
    t.k('[', { code: 'BracketLeft' }); assert.strictEqual([...t.sel.ids][0], all.at(-1), '[ 는 거꾸로, 처음에서 끝으로');
    assert.strictEqual(t.log.said.at(-1), `${T.describeEl(t.store.doc, all.at(-1))} · ${all.length}/${all.length}`, '고른 요소 이름과 순서를 읽는다');
    t.sel.set(['O1']); assert.strictEqual(T.findEl(t.store.doc, [...t.sel.ids][0]).col, 'openings', '문을 고를 수 있다(경첩 단추가 있는 속성 패널)');
    t.sel.set(['G1']); const g1 = t.flr().guides[0].a; t.k('ArrowRight'); assert.deepStrictEqual(t.flr().guides[0].a, [g1[0] + 50, g1[1]], '고른 것이 있으면 방향키는 그것을 옮긴다(기존 동작)');
    t.k('Delete'); assert.strictEqual(t.flr().guides.length, 0, 'Delete 도 그대로'); }
  { const t = mk({}, (s) => s.replace(d0)); t.focus(); t.left(4); t.up(4); t.enter(); assert.deepStrictEqual([...t.sel.ids], ['R1'], '커서 자리의 요소를 고른다(기존 hitTest 허용 오차)'); assert.strictEqual(t.log.said.at(-1), '방 거실 선택'); }
  { const t = mk({}, (s) => s.exec({ type: 'addColumn', kind: 'rect', c: [90000, 90000] })); t.focus(); t.k(']', { code: 'BracketRight' }); assert.strictEqual(t.log.centers.length, 1, '화면 밖의 요소는 화면 가운데로 가져온다'); assert.ok(Math.abs(t.log.centers[0][0] - 90000) < 1e-6 && Math.abs(t.log.centers[0][1] - 90000) < 1e-6);
    assert.ok(Math.abs(t.tools.kb.mm[0] - 90000) < 1e-6, '커서도 그 요소로'); }
  { const t = mk(); t.focus(); t.k(']', { code: 'BracketRight' }); assert.strictEqual(t.log.said.at(-1), '고를 것이 없습니다', '요소가 없는 도면'); }
  { const t = mk({ locked: true }, (s) => s.replace(d0)); t.focus(); t.k(']', { code: 'BracketRight' }); assert.strictEqual(t.sel.size, 1, '잠금 상태에서도 고르기는 된다'); }

  // I. 화면 가장자리: 커서가 여백을 넘으면 화면이 따라온다
  { const t = mk(); t.tools.setTool('wall'); t.focus(); t.right(8, true); assert.deepStrictEqual(t.tools.kb.mm, [8000, 3000]); assert.ok(t.log.pans.length >= 1, '화면이 밀린다');
    const px = t.view.toPx(t.tools.kb.mm); assert.ok(px[0] >= 24 && px[0] <= 800 - 24, `커서는 화면 안: ${px}`); }
  { const t = mk(); t.tools.setTool('wall'); t.focus(); t.right(3, true); assert.strictEqual(t.log.pans.length, 0, '안에서 움직일 때는 화면이 그대로'); }

  // J. 낭독: 커서 이동은 모아서 한 번, 누르면 결과가 우선
  { const t = mk(); t.tools.setTool('wall'); t.focus(); t.right(3); t.down(2); await sleep(320);
    assert.deepStrictEqual(t.log.said, ['커서 4,150, 3,100 mm'], '여러 번 움직여도 마지막 자리를 한 번만 읽는다');
    t.right(); t.enter(); await sleep(320); assert.deepStrictEqual(t.log.said.slice(1), ['점을 찍었습니다 · 4,200, 3,100 mm'], '누르면 기다리던 커서 낭독이 결과를 덮지 않는다'); }
  { const t = mk({}, (s) => s.replace(d0)); t.tools.setTool('select'); t.focus(); t.left(4); t.up(4); await sleep(320); assert.ok(/ · 방 거실$/.test(t.log.said.at(-1)), '고르기 커서는 아래 요소 이름도 읽는다: ' + t.log.said.at(-1)); }

  // K. 마우스·옛 동작과 섞기: 커서가 안 보이는 첫 키는 커서부터, 진행 중인 작업이 있으면 Enter 는 예전처럼 마감
  { const t = mk(); t.tools.setTool('wall'); t.tap(400, 300); t.tap(500, 300); assert.strictEqual(t.flr().walls.length, 1); assert.ok(t.tools.op); assert.strictEqual(t.tools.kb, null);
    t.enter(); assert.strictEqual(t.tools.op, null, '커서가 없을 때 Enter = 이어 그리기 마감(기존)'); assert.strictEqual(t.flr().walls.length, 1);
    t.enter(); assert.deepStrictEqual(t.tools.kb && t.tools.kb.mm, [5000, 3000], '작업이 없으면 Enter 는 커서부터 보인다(마지막 포인터 자리에서, 바로 찍지 않는다)'); assert.strictEqual(t.flr().walls.length, 1, '아무것도 찍히지 않았다');
    assert.strictEqual(t.space(), true, '커서가 보이면 Space = 누르기'); assert.deepStrictEqual(t.tools.op && t.tools.op.a, [5000, 3000]); }
  { const t = mk(); t.tools.setTool('wall'); assert.strictEqual(t.space(), false, '커서가 없으면 Space 는 예전처럼 화면 끌기(처리 안 함)'); t.k('ArrowLeft'); assert.ok(t.tools.kb, '방향키도 커서부터'); assert.deepStrictEqual(t.tools.kb.mm, [4000, 3000], '처음 방향키는 커서를 보이기만 한다'); t.k('ArrowLeft'); assert.deepStrictEqual(t.tools.kb.mm, [3950, 3000]); }
  { const t = mk(); t.tools.setTool('wall'); t.focus(); const before = t.log.said.length; const body = { tagName: 'BODY' };
    assert.strictEqual(t.tools.key({ key: 'ArrowRight', code: 'ArrowRight', target: body, shiftKey: false }, true), false, '캔버스가 아닌 곳의 방향키는 커서를 움직이지 않는다'); assert.deepStrictEqual(t.tools.kb.mm, [4000, 3000]); }
  { const t = mk(); t.tools.setTool('wall'); t.focus(); t.state.locked = true; t.enter(); assert.ok(t.tools.op, '잠금은 도구를 못 여는 것으로 막고 이미 연 도구는 마우스와 같다'); }

  // L. 한 글자 단축키는 캔버스·도구 패널에 초점이 있을 때만 (WCAG 2.1.4)
  { const t = mk(); const other = { id: 'plGrid' };
    assert.strictEqual(t.tools.key({ key: 'd', code: 'KeyD', target: other }, false), false, '다른 단추에서 D 는 처리 안 함'); assert.strictEqual(t.tools.tool, 'select');
    assert.strictEqual(t.tools.key({ key: 'm', code: 'KeyM', target: other }, false), false); assert.strictEqual(t.tools.tool, 'select');
    assert.strictEqual(t.tools.key({ key: 'l', code: 'KeyL', target: { id: 'plCanvas' } }, true), true); assert.strictEqual(t.tools.tool, 'wall', '범위 안에서는 도구가 바뀐다');
    t.tools.setTool('placeItem', { ...stub }); assert.strictEqual(t.tools.key({ key: ']', code: 'BracketRight', target: other }, false), false, '범위 밖의 ] 는 돌리지 않는다');
    assert.strictEqual(t.tools.key({ key: 'Escape', code: 'Escape', target: other }, false), true, 'Esc 는 한 글자 단축키가 아니므로 어디서나'); assert.strictEqual(t.tools.tool, 'select'); }
  { const t = mk({}, (s) => s.replace(d0)); t.tools.setTool('select');
    assert.strictEqual(t.tools.key({ key: ']', code: 'BracketRight', target: { id: 'plSave' } }, true), false, '캔버스가 아니면 ] 로 고르지 않는다(도구 패널 초점에서도)'); assert.strictEqual(t.sel.size, 0); }

  // M. 안내문: 키보드 화면은 키보드 방법을, 터치 화면은 늘리지 않는다
  for (const name of ['wall', 'arc', 'room', 'delete', 'colRect', 'colRound', 'opening', 'guide', 'measure', 'placeItem', 'calibrate']) {
    const a = mk(), b = mk({ touch: true }); a.tools.setTool(name, name === 'placeItem' ? stub : {}); b.tools.setTool(name, name === 'placeItem' ? stub : {});
    assert.ok(a.log.hint[1].includes('방향키로 옮기고 Enter 로 누릅니다'), name + ' 키보드 안내'); assert.ok(!/방향키|Enter/.test(b.log.hint[1]), name + ' 터치 화면은 키보드 문구 없음'); }
  { const t = mk(); t.tools.setTool('select'); assert.ok(/방향키로 옮기고 Enter 로 고릅니다 · \[ \] 로 하나씩 훑습니다/.test(t.log.hint[1]));
    const u = mk({}, (s) => s.replace(d0)); u.tools.setTool('select'); u.sel.set(['W1']); u.tools.hint(); assert.ok(/\[ \] 로 다른 것을 고릅니다/.test(u.log.hint[1]), '고른 것이 있으면 다른 안내'); }

  // N. 커서 그림: 키보드 커서가 보일 때만 십자(토큰 색)와 좌표 알약
  { const mkG = () => { const styles = [], ctx = new Proxy({}, { get: (_, p) => (p === 'measureText' ? () => ({ width: 10 }) : () => {}), set: (_, p, v) => { if (p === 'strokeStyle') styles.push(v); return true; } });
      return { styles, g: { ctx, vp: VP, C: { surface: 'SURFACE', accent: 'ACCENT', ink: 'INK', line: 'LINE', fs4: 11, fw: '600', font: 'F', r1: 6 }, toPx: (p) => M.toPx(VP, p), fmt: (mm) => `${mm}mm` } }; };
    const t = mk(); t.tools.setTool('wall'); let r = mkG(); t.tools.overlay(r.g); assert.ok(!r.styles.includes('SURFACE'), '커서가 없으면 십자도 없다');
    t.focus(); r = mkG(); t.tools.overlay(r.g); assert.ok(r.styles.join().includes('SURFACE,ACCENT'), '십자는 밝은 선 위에 강조색(토큰) 선');
    t.canvas.l.blur.forEach((f) => f()); r = mkG(); t.tools.overlay(r.g); assert.ok(!r.styles.includes('SURFACE'), '초점이 나가면 십자도 사라진다');
    t.focus(); t.tools.setTool('moveUnderlay'); r = mkG(); t.tools.overlay(r.g); assert.ok(!r.styles.includes('SURFACE'), '점을 찍지 않는 도구에서는 십자 없음');
    t.tools.setTool('select'); r = mkG(); t.tools.overlay(r.g); assert.ok(r.styles.includes('SURFACE'), '고르기 도구도 커서가 보인다'); }
  { const t = mk({}, (s) => s.replace(d0)); t.tools.setTool('select'); t.focus(); t.sel.set(['W1']); const styles = []; const ctx = new Proxy({}, { get: (_, p) => (p === 'measureText' ? () => ({ width: 10 }) : () => {}), set: (_, p, v) => { if (p === 'strokeStyle') styles.push(v); return true; } });
    t.tools.overlay({ ctx, vp: VP, C: { surface: 'SURFACE', accent: 'ACCENT', ink: 'INK', line: 'LINE', fs4: 11, fw: '600', font: 'F', r1: 6 }, toPx: (p) => M.toPx(VP, p), fmt: (mm) => `${mm}mm` }); assert.ok(styles.includes('ACCENT') && !styles.includes('SURFACE'), '고른 것이 있으면 커서 십자를 그리지 않는다(핸들만)'); }

  /* ===== 3. 코드 약속(app.js · view2d.js · index.html · tools.js 모양) ===== */
  const app = strip(rd('app.js')), tl = strip(rd('tools.js')), v2 = strip(rd('view2d.js')), html = rd('index.html'), has = (src, re, m) => assert.ok(re.test(src), '코드: ' + m);
  has(app, /const scoped = \(t\) => !!\(t && t\.closest && t\.closest\(state\.mode === '3d' \?[^)]*#plView3d[^)]*: panelName === 'draw' \? '#plCanvas, #plPanel' : '#plCanvas'\)\);/, '한 글자 단축키의 범위 = 캔버스 · (도구 패널이 열려 있으면) 도구 패널 · 3D 에서는 3D 화면과 보기 단추');
  has(app, /tools\.key\(e, scoped\(e\.target\)\)/, '도구 글쇠는 범위를 넘겨 받는다'); has(app, /e\.code\.startsWith\('Key'\) && tools\.key\(e, scoped\(e\.target\)\)/, '3D 에서도');
  has(app, /\(e\.code === 'Equal' \|\| e\.code === 'NumpadAdd'\) && scoped\(e\.target\)/, '확대 글쇠'); has(app, /\(e\.code === 'Minus' \|\| e\.code === 'NumpadSubtract'\) && scoped\(e\.target\)/, '축소 글쇠'); has(app, /if \(v && scoped\(e\.target\)\) \{ set3dView\(v\)/, '3D 보기 2·3·4');
  has(app, /if \(!tools\.key\(e\)\) tools\.setSpace\(true\)/, '키보드 커서가 있으면 Space 는 누르기, 아니면 화면 끌기');
  has(app, /if \(name !== was \|\| openingType !== wasType\) say\(`\$\{\$\('plHintName'\)\.textContent\} 도구 · \$\{\$\('plHintText'\)\.textContent\}`\)/, '도구가 바뀌면 이름과 쓰는 법을 읽는다');
  has(app, /const toCanvas = \(\) => \$\('plCanvas'\)\.focus\(/, '도구를 고르면 초점이 캔버스로'); has(app, /setTool: \(n, o\) => \{ const ok = ui\.setTool\(n, o\); if \(ok\) toCanvas\(\); return ok; \}/, '제품 패널이 도구를 열 때도'); has(app, /if \(ui\.setTool\(id, id === 'opening' \? \{ type: openingType \} : \{\}\)\) toCanvas\(\);/, '패널 행'); has(app, /if \(ui\.setTool\('opening', \{ type \}\)\) toCanvas\(\);/, '개구부 종류 단추');
  has(tl, /function key\(e, inScope = true\)/, 'tools.key 는 범위를 받는다(없으면 예전처럼 모두 듣는다)'); has(tl, /if \(t\) \{ if \(!inScope\) return false; ui\.setTool\(t\); return true; \}/, '범위 밖의 도구 글쇠는 무시');
  has(tl, /canvas\.addEventListener\('focus'/, '캔버스 초점 → 키보드 커서'); has(tl, /canvas\.matches\(':focus-visible'\)/, '키보드로 온 초점만 커서를 띄운다');
  has(v2, /export function drawCrosshair\(ctx, C, x, y, r = 10\)/, '십자 그리기는 view2d.js(토큰 색 C)'); assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(v2.match(/export function drawCrosshair[\s\S]*?\n\}/)[0]), '십자에 색 리터럴 없음');
  assert.ok(/<canvas id="plCanvas" tabindex="0" role="application" aria-label="[^"]*방향키[^"]*Enter[^"]*"/.test(html), '캔버스 이름에 키보드 사용법'); assert.ok(/id="plView3d" hidden tabindex="-1"/.test(html), '3D 화면을 눌러도 초점이 그 안에 남아 2·3·4 가 계속 된다');
  for (const f of ['tools.js', 'view2d.js', 'app.js']) assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(strip(rd(f))), f + ': innerHTML 금지');

  console.log('test-plan-keyboard: OK');
})().catch((e) => { console.error(e); process.exit(1); });
