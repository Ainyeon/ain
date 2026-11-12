// 분석 보기(maker/3d/plan/core/analysis.js: 존·포셰·동선) 순수 계산 시험 + 화면 연결 정적 점검 — 수치는 손으로 계산한 값으로 단언한다.
// 실행: node tools/test-plan-analysis.js. 화면(캔버스 그림·표·폰 시트)은 브라우저로 따로 본다.
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
  const [A, M, G, S, X, E] = await Promise.all(['core/analysis.js', 'core/model.js', 'core/geom.js', 'core/store.js', 'core/export.js', 'estimate.js'].map(imp));
  const TPL = JSON.parse(rd('data/templates.json')).templates, tpl = (id) => TPL.find((t) => t.id === id).doc, cf = M.curFloor;

  /* ===== 0. 정적: 순수 모듈 · 화면 연결 ===== */
  { const src = rd('core/analysis.js'), code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(/^\/\/ \S/.test(src), 'analysis.js 맨 위 한 줄 역할 주석');
    assert.ok(!/\b(document|window|navigator|globalThis)\s*[.\[]|\b(localStorage|sessionStorage|requestAnimationFrame)\b|innerHTML|\beval\s*\(|new Function|Math\.random|Date\.now|new Date/.test(code), 'analysis.js 는 DOM·난수·시계를 쓰지 않는다(순수)');
    const html = rd('index.html'), app = rd('app.js'), css = rd('plan.css'), v2 = rd('view2d.js');
    assert.ok(/<button type="button" class="ed-sb" id="plAnal" aria-pressed="false"[^>]*>분석<\/button>/.test(html), '[분석] 글자 단추(aria-pressed)');
    assert.ok(/<div class="ed-seg only2d"[^>]*>(?:\s*<button[^>]*>[^<]*<\/button>)*\s*<button[^>]*id="plAnal"/.test(html), '[분석] 은 2D 표시 묶음 안');
    assert.ok(/add\(pick\('구분', ZONES\.map\(\(z\) => \[z, ZONE_LABEL\[z\]\]\), \(e\) => zoneOf\(e\), \(v\) => up\(\{ zone: v \}\)\)\)/.test(app), '방 속성의 구분 선택 = update 명령(잠금·되돌리기·검증을 그대로 탄다)');
    assert.ok(/\['plAnal', !!state\.analysis\]/.test(app) && /'aria-pressed': 'false', onclick: \(\) => setAnalysis\(m\)/.test(app), '켜짐 상태는 aria-pressed 로');
    for (const t of ['길이 없습니다', '도면이 너무 큽니다', '방이 없습니다', '출발과 도착이 같습니다']) assert.ok(app.includes(`'${t}'`), '문구: ' + t);
    assert.ok(/h\('table', \{ class: 'ed-tbl' \}/.test(app) && /h\('caption'/.test(app) && /scope: 'col'/.test(app) && /scope: 'row'/.test(app), '표는 진짜 table(caption·th scope)');
    assert.ok(/'ed-zsw', 'data-z': r\.zone, 'aria-hidden': 'true' \}\), r\.label/.test(app), '존 표: 색 견본 옆에 구분 이름을 글자로');
    assert.ok(/ZONE_LABEL\[zoneOf\(e\.el\)\] \+ ' · '/.test(v2), '존 보기 캔버스 라벨에도 구분 이름');
    assert.ok(!/analysis|routes/.test((app.match(/const savePrefs = [^\n]*/) || [''])[0]), '분석 보기 상태는 환경설정에 남기지 않는다');
    for (const z of ['private', 'service']) assert.ok(new RegExp(`\\.ed-zsw\\[data-z="${z}"\\] \\{[^}]*var\\(--c-`).test(css), '존 견본 색은 토큰: ' + z);
    assert.ok(/\.ed-props > \.ed-btns, \.ed-props > \.ed-sec-h, \.ed-props > \.ed-seg, \.ed-props > \.ed-ana \{ grid-column: 1 \/ -1; \}/.test(css), '폰: 분석 표는 속성 시트 두 칸을 다 쓴다');
    const phone = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('@media (max-width: 359px)')), mb = (phone.match(/\.ed-app\.ana \.ed-stage \{ margin-bottom: (\d+dvh); \}/) || [])[1];
    assert.ok(mb && phone.includes(`.ed-app.ana .ed-props { height: ${mb}; max-height: none; }`), '폰: 분석 시트 높이만큼 캔버스를 줄인다(도면·캔버스 단추가 시트에 가리지 않는다)'); assert.ok(!css.replace(phone, '').includes('.ed-app.ana'), '넓은 화면은 그대로');
    assert.ok(/classList\.toggle\('ana', !!state\.analysis && state\.mode === '2d'\)/.test(app), '분석 보기(2D)일 때만 캔버스를 줄인다');
    const tl = rd('tools.js'); assert.ok(!/hitTest\(doc\(\)|idsInRect\(doc\(\)|allIds\(fl\(\)\)/.test(tl) && /state\.analysis !== 'poche' \? d : \{ \.\.\.d,[^\n]*openings: \[\], guides: \[\], items: \[\]/.test(tl), '포셰 보기: 집기·범위 선택·훑기는 보이는 것만(동작은 test-plan-keyboard)'); }

  /* ===== 1. 존 추정 ===== */
  const Z = { public: ['거실', '주방', '식당', '현관', '복도', '거실·주방', '주방·식당', '현관·다용도', '원룸', '가사실', ''], private: ['침실', '안방', '방', '방 3', '서재', '드레스룸', '작은방', '침실 2'], service: ['욕실', '화장실', '다용도실', '발코니', '베란다', '창고', '실외기실', '욕실 2', '욕실·세탁', '안방 욕실', '거실 발코니'] };
  for (const [z, names] of Object.entries(Z)) for (const n of names) assert.strictEqual(A.guessZone(n), z, `'${n}' = ${z}`);
  assert.deepStrictEqual(M.ZONES, ['public', 'private', 'service']); assert.deepStrictEqual(Object.keys(A.ZONE_LABEL), M.ZONES);
  assert.strictEqual(A.zoneOf({ name: '거실', zone: 'service' }), 'service', '저장된 구분이 먼저'); assert.strictEqual(A.zoneOf({ name: '거실' }), 'public'); assert.strictEqual(A.zoneOf({ name: '거실', zone: 'x' }), 'public', '틀린 값이면 추정값');

  /* ===== 2. room.zone 저장 · 검증 · 되돌리기 · 옛 문서 ===== */
  { const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000], name: '거실' }); s.exec({ type: 'addRoomRect', a: [5000, 0], b: [9000, 3000], name: '욕실' });
    const room = () => cf(s.doc).rooms[0];
    assert.ok(!('zone' in room()), '새 방에는 zone 키가 없다(추정값을 쓴다)');
    assert.deepStrictEqual(s.exec({ type: 'update', id: 'R1', patch: { zone: 'service' } }), ['R1']); assert.strictEqual(A.zoneOf(room()), 'service');
    assert.deepStrictEqual(s.exec({ type: 'update', id: 'R1', patch: { zone: 'service' } }), [], '같은 값은 이력에 남지 않는다');
    for (const bad of ['x', 1, null]) { let err; try { s.exec({ type: 'update', id: 'R1', patch: { zone: bad } }); } catch (e) { err = e; } assert.ok(err && /방 구분/.test(err.message), '틀린 구분은 한국어로 거절: ' + bad); assert.strictEqual(room().zone, 'service', '거절되면 문서 그대로'); }
    assert.strictEqual(cf(X.fromDocJSON(X.toDocJSON(s.doc))).rooms[0].zone, 'service', '내보내기·불러오기 왕복');
    s.exec({ type: 'mirror', axis: 'x' }); s.exec({ type: 'rotate', deg: 90 }); s.exec({ type: 'move', ids: ['R1'], dx: 100, dy: 0 }); assert.strictEqual(room().zone, 'service', '반전·회전·이동 뒤에도 남는다');
    s.undo(); s.undo(); s.undo(); s.undo(); assert.ok(!('zone' in room()), '되돌리면 키가 없다'); s.redo(); assert.strictEqual(room().zone, 'service', '다시 실행');
    // 존 표: 4×3 m 방 둘(거실 → 서비스로 바꿈, 욕실) → 서비스 24.00
    const t = A.zoneTable(s.doc); assert.deepStrictEqual(t.rows.map((r) => [r.zone, r.areaM2, r.pct, r.names]), [['public', 0, 0, []], ['private', 0, 0, []], ['service', 24, 100, ['거실', '욕실']]]); assert.strictEqual(t.totalM2, 24);
    s.undo(); const u = A.zoneTable(s.doc); assert.deepStrictEqual(u.rows.map((r) => [r.label, r.areaM2, r.pct]), [['공용', 12, 50], ['개인', 0, 0], ['서비스', 12, 50]], '추정값: 거실 = 공용, 욕실 = 서비스');
    assert.deepStrictEqual(A.zoneTable(M.createDoc()), { rows: M.ZONES.map((zone) => ({ zone, label: A.ZONE_LABEL[zone], names: [], areaM2: 0, pct: 0 })), totalM2: 0 }, '방이 없어도 세 줄'); }
  for (const t of TPL) { // 옛 문서(zone 없음)는 그대로 열리고, 존 표 합계는 견적 물량표의 실면적과 같다
    assert.deepStrictEqual(M.validateDoc(t.doc), [], t.id + ' 검증'); assert.ok(cf(t.doc).rooms.every((r) => !('zone' in r)));
    const z = A.zoneTable(t.doc); assert.strictEqual(z.totalM2, E.buildEstimate(t.doc).floors[0].areaM2, t.id + ' 합계 = 견적 실면적'); near(z.rows.reduce((s, r) => s + r.pct, 0), 100, 0.11, t.id + ' 비율 합'); }

  /* ===== 3. 포셰: 벽 비율 ===== */
  { const s = new S.Store(); assert.deepStrictEqual(A.poche(s.doc), { wallM2: 0, floorM2: 0, pct: null }, '방이 없으면 비율 없음');
    s.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000] });
    // 손계산: 바깥 5300×4300 − 안 5000×4000 = 2.79 ㎡, 2.79 ÷ 20 = 13.95 %
    assert.deepStrictEqual(A.poche(s.doc), { wallM2: 2.79, floorM2: 20, pct: 14 });
    s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'door' }); near(A.poche(s.doc).wallM2, 2.79 - 0.9 * 0.15, 0.0051, '문 900 만큼 빠진다');
    s.exec({ type: 'addColumn', kind: 'rect', c: [1000, 1000] }); near(A.poche(s.doc).wallM2, 2.79 - 0.135 + 0.09, 0.0051, '사각 기둥 300×300');
    s.exec({ type: 'addColumn', kind: 'round', c: [3000, 1000] }); near(A.poche(s.doc).wallM2, 2.79 - 0.135 + 0.09 + Math.PI * 0.15 ** 2, 0.0051, '원형 기둥 지름 300'); }
  { // 방 도구로 따로 그린 이웃 방(벽이 두 겹): 겹친 벽은 한 번만 센다. 손계산 = 바깥 6450×3300 − 방 2×9 = 3.285 ㎡ (겹친 만큼 두 번 세면 3.78)
    const two = (x) => { const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [3000, 3000] }); s.exec({ type: 'addRoomRect', a: [x, 0], b: [x + 3000, 3000] }); return s; };
    const s = two(3150); near(A.poche(s.doc).wallM2, 3.285, 0.0051, '중심선이 같은 두 겹 벽'); assert.strictEqual(A.poche(s.doc).floorM2, 18);
    near(A.poche(two(3300).doc).wallM2, 3.78, 0.0051, '등을 맞댄 벽(겹치지 않음)은 둘 다 센다'); near(A.poche(two(5000).doc).wallM2, 3.78, 0.0051, '떨어진 방');
    s.exec({ type: 'addColumn', kind: 'rect', c: [3075, 1500], w: 150, d: 600 }); near(A.poche(s.doc).wallM2, 3.285, 0.0051, '벽에 묻힌 기둥은 더하지 않는다');
    const t = new S.Store(); t.exec({ type: 'addRoomRect', a: [0, 0], b: [5000, 4000] }); t.exec({ type: 'addWall', a: [2500, -75], b: [2500, 4075], t: 100 });   // 벽 중간에 붙은 두께 다른 벽: 2.79 + 안쪽 4000×100
    near(A.poche(t.doc).wallM2, 2.79 + 0.4, 0.0051, '벽 중간에 붙은 벽은 겹친 끝을 빼고 센다');
    const big = M.createDoc(); big.floors[0].walls.push({ id: 'W1', a: [0, 0], b: [0, 90000], t: 200, kind: 'inner', bulge: 0 }); near(A.poche(big).wallM2, 18, 0.011, '높이 90 m: 줄 간격을 키워도 맞다'); }
  for (const id of ['studio-a', 'three-a', 'apt-a']) { // 손계산: 바깥 사각형 − 방 − 개구부 자리. 벽 셋이 모인 곳의 겹침을 빼지 않으면 어긋난다(studio-a 3.64)
    const d = tpl(id), f = cf(d), b = G.bounds(d), W = new Map(f.walls.map((w) => [w.id, w]));
    const hand = ((b.x1 - b.x0) * (b.y1 - b.y0)) / 1e6 - f.rooms.reduce((s, r) => s + G.roomAreaM2(d, r), 0) - f.openings.reduce((s, o) => s + o.width * W.get(o.wall).t, 0) / 1e6;
    near(A.poche(d).wallM2, hand, 0.011, id + ' 벽 면적 = 바깥 − 방 − 개구부'); }
  assert.strictEqual(A.poche(tpl('studio-a')).wallM2, 3.48); assert.strictEqual(A.poche(tpl('studio-a')).pct, 12.4, '3.48 ÷ 28.05');

  /* ===== 4. 동선 ===== */
  // 손으로 만든 층: 방 A(0~3000) · B(3150~6150), 높이 3000, 사이에 벽 W1(x=3075, 두께 150). 방 중심 사이 직선거리 3150
  const AB = (wall, openings = [], columns = [], gap = 150) => {
    const d = M.createDoc(), f = d.floors[0];
    f.rooms.push({ id: 'R1', name: 'A', poly: [[0, 0], [3000, 0], [3000, 3000], [0, 3000]], wallIds: [] }, { id: 'R2', name: 'B', poly: [[3000 + gap, 0], [6000 + gap, 0], [6000 + gap, 3000], [3000 + gap, 3000]], wallIds: [] });
    if (wall) f.walls.push({ id: 'W1', a: [3075, -75], b: [3075, 3075], t: 150, kind: 'inner', bulge: 0, ...wall });
    openings.forEach((o, i) => f.openings.push({ id: 'O' + (i + 1), wall: 'W1', at: 0.5, width: 900, height: 2100, sill: 0, type: 'door', ...o }));
    columns.forEach((c, i) => f.columns.push({ id: 'C' + (i + 1), kind: 'rect', w: 600, d: 600, rot: 0, ...c }));
    assert.deepStrictEqual(M.validateDoc(d), [], '시험 문서가 올바르다');
    return S.deepFreeze(d).floors[0];
  };
  const go = (f) => A.route(f, 'R1', 'R2'), len = (r) => { let s = 0; for (let i = 0; i + 1 < r.pts.length; i++) s += Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]); return s; };
  { const r = go(AB({}, [{}])); // 벽 한가운데 문
    assert.ok(r.ok && r.pts.length === 2, '가운데 문은 곧게 지난다'); near(r.lenMm, 3150, 101, '방 중심 → 방 중심'); near(len(r), r.lenMm, 1e-6, '길이 = 꺾은선 길이'); assert.strictEqual(r.steps, Math.ceil(r.lenMm / 650), '걸음 = 올림(길이 ÷ 650)'); assert.strictEqual(r.steps, 5);
    assert.deepStrictEqual(go(AB({})), { ok: false, reason: 'none' }, '문이 없으면 길이 없다');
    assert.deepStrictEqual(go(AB({}, [{ type: 'window' }])), { ok: false, reason: 'none' }, '창으로는 못 지난다');
    assert.ok(go(AB({}, [{ type: 'open' }])).ok, '개방은 지난다');
    assert.ok(go(AB({}, [{ width: 700 }])).ok, '폭 700 문'); assert.ok(go(AB({}, [{ width: 400 }])).ok, '폭 400(사람 폭)'); assert.ok(!go(AB({}, [{ width: 399 }])).ok, '사람 폭보다 좁으면 못 지난다');
    const side = go(AB({}, [{ at: 0.2 }])); // 문을 벽 끝 쪽으로(y≈555) — 중심(1500)에서 문으로 꺾어 가야 한다
    assert.ok(side.ok && side.lenMm > r.lenMm + 400, `문이 옆에 있으면 돌아간다: ${side.lenMm}`); assert.ok(side.pts.some((p) => Math.abs(p[0] - 3075) < 300 && Math.abs(p[1] - 555) <= 250), '경로가 실제로 문 구간을 지난다');
    assert.ok(side.pts.every((p) => p.every((v) => (v + 150) % 100 === 0)) && side.pts.some((p) => p.some((v) => (v + 150) % 200 !== 0)), '보통 도면은 100 mm 칸(격자 원점 = 방 외곽 −150)'); assert.strictEqual(A.NAV.cell, 100);
    assert.ok(go(AB(null, [], [], 0)).ok && go(AB(null, [], [], 0)).pts.length === 2, '벽 없이 맞닿은 방은 이어진다'); near(go(AB(null, [], [], 0)).lenMm, 3000, 101);
    assert.ok(go(AB(null)).ok, '벽 없이 150 벌어진 방도 이어진다'); assert.ok(!go(AB(null, [], [], 1000)).ok, '1 m 떨어진 방은 길이 없다(집 밖으로 나가지 않는다)');
    assert.ok(!go(AB({ t: 10 })).ok, '얇은 벽도 막는다'); assert.ok(!go(AB({ a: [2500, -75], b: [3650, 3075], t: 10 })).ok, '비스듬한 얇은 벽도 새지 않는다');
    // 곡선벽(처짐 800): 전체가 막고, 문은 호 위(정점 x = 3075 ± 800)에 열린다 — 현(직선)으로 다루면 문 자리가 어긋나 실패한다
    assert.deepStrictEqual(go(AB({ bulge: 800 })), { ok: false, reason: 'none' }, '곡선벽도 막는다');
    const arcF = AB({ bulge: 800 }, [{}]), mid = G.wallPointAt(arcF.walls[0], 0.5).p, arc = go(arcF);
    near(Math.abs(mid[0] - 3075), 800, 1e-6); assert.ok(arc.ok, '곡선벽의 문은 지난다');
    assert.ok(arc.pts.some((p, i) => i + 1 < arc.pts.length && G.projectOnSeg(mid, p, arc.pts[i + 1]).d < 450), '경로가 호 정점의 문을 지난다');
    // 호를 따라 재는지: 처짐 1400, 폭 500 문을 호 길이의 0.15 지점에 — 현(직선)으로 막거나 문 자리를 현에 내려 재면 다른 곳이 열린다
    { const f = AB({ bulge: 1400 }, [{ at: 0.15, width: 500 }]), w = f.walls[0], L = G.wallLen(w), door = G.wallPointAt(w, 0.15).p, r = go(f); assert.ok(r.ok, '호 끝 쪽 문');
      assert.ok(r.pts.some((p, i) => i + 1 < r.pts.length && G.projectOnSeg(door, p, r.pts[i + 1]).d < 150), '경로가 호 위의 문 자리를 지난다');
      const cross = []; for (let i = 0; i + 1 < r.pts.length; i++) { const a = r.pts[i], b = r.pts[i + 1], n = Math.ceil(G.dist(a, b) / 20); for (let k = 0; k <= n; k++) { const q = G.nearestOnWall(w, [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); if (q.d < 40) cross.push(q.at); } }
      assert.ok(cross.length > 0 && cross.every((at) => Math.abs(at - 0.15) * L <= 250), `호를 넘는 곳은 문 구간뿐이다: ${cross.map((v) => v.toFixed(3))}`); }
    // 기둥 600 이 직선 위에 있으면 돌아간다
    const col = go(AB(null, [], [{ c: [3000, 1500] }], 0)); assert.ok(col.ok && col.lenMm > 3200 && col.pts.length > 2, `기둥을 돌아간다: ${col.lenMm}`);
    assert.ok(col.pts.every((p) => Math.max(Math.abs(p[0] - 3000), Math.abs(p[1] - 1500)) >= 300 + A.NAV.body - 1), '기둥에서 사람 반폭만큼 떨어진다');
    // 원형 기둥(지름 600)도 막고, 사각 기둥보다 덜 돌아간다(모서리가 없다). 기둥 회전: 200×2900 기둥은 세우면(0°) 길을 다 막고 눕히면(90°) 돌아간다
    const rnd = go(AB(null, [], [{ kind: 'round', c: [3000, 1500] }], 0)); assert.ok(rnd.ok && rnd.pts.length > 2 && rnd.lenMm > 3100 && rnd.lenMm < col.lenMm, `원형 기둥을 돌아간다: ${rnd.lenMm} < ${col.lenMm}`);
    assert.ok(rnd.pts.every((p) => G.dist(p, [3000, 1500]) >= 300 + A.NAV.body - 1), '원형 기둥에서 사람 반폭만큼 떨어진다');
    const bar = (rot) => go(AB(null, [], [{ c: [3000, 1500], w: 200, d: 2900, rot }], 0)); assert.deepStrictEqual(bar(0), { ok: false, reason: 'none' }, '세운 기둥이 길을 막는다'); assert.ok(bar(90).ok && bar(90).lenMm > 3500, `눕힌 기둥은 돌아간다: ${bar(90).lenMm}`);
    // 출발·도착은 방 안: ㄱ자 방은 무게중심(1357, 1357)이 방 밖(이웃 방 안)에 놓인다
    { const d = M.createDoc(), f = d.floors[0], ell = [[0, 0], [4000, 0], [4000, 1000], [1000, 1000], [1000, 4000], [0, 4000]];
      f.rooms.push({ id: 'R1', name: 'A', poly: ell, wallIds: [] }, { id: 'R2', name: 'B', poly: [[1000, 1000], [4000, 1000], [4000, 4000], [1000, 4000]], wallIds: [] }); assert.deepStrictEqual(M.validateDoc(d), []);
      assert.ok(!G.pointInPoly(ell, G.polyCentroid(ell)), '시험 전제: 무게중심이 방 밖'); const r = go(f), back = A.route(f, 'R2', 'R1');
      assert.ok(r.ok && G.pointInPoly(ell, r.pts[0]) && G.pointInPoly(f.rooms[1].poly, r.pts.at(-1)), 'ㄱ자 방의 출발점은 방 안'); assert.ok(G.pointInPoly(ell, back.pts.at(-1)), 'ㄱ자 방의 도착점도 방 안'); }
    // 대각선은 양옆 칸이 모두 열렸을 때만: 모서리만 맞닿은 두 방(열린 칸이 대각으로만 이웃)은 이어지지 않는다
    { const d = M.createDoc(), f = d.floors[0], sq = (a, b) => [[a, a], [b, a], [b, b], [a, b]];
      f.rooms.push({ id: 'R1', name: 'A', poly: sq(0, 1950), wallIds: [] }, { id: 'R2', name: 'B', poly: sq(2250, 4250), wallIds: [] }); assert.deepStrictEqual(M.validateDoc(d), []);
      assert.deepStrictEqual(go(f), { ok: false, reason: 'none' }, '벽 모서리를 대각으로 스쳐 지나지 않는다'); f.rooms[1].poly = sq(2150, 4150); assert.ok(go(d.floors[0] = { ...f }).ok, '한 칸이라도 겹치면 지난다'); }
    // 방향이 다르면 다른 경로: 되돌아오는 길은 도착 방에서 출발한다(캐시가 쌍을 순서 없이 묶지 않는다)
    { const f = AB({}, [{ at: 0.2 }]), ab = go(f), ba = A.route(f, 'R2', 'R1'); assert.ok(ba.ok && G.pointInPoly(f.rooms[1].poly, ba.pts[0]) && G.pointInPoly(f.rooms[0].poly, ba.pts.at(-1)), 'B→A 는 B 에서 출발');
      assert.deepStrictEqual([ba.pts[0], ba.pts.at(-1)], [ab.pts.at(-1), ab.pts[0]]); near(ba.lenMm, ab.lenMm, 150); }
    assert.deepStrictEqual(A.route(AB({}), 'R1', 'R9'), { ok: false, reason: 'room' }, '없는 방'); const same = A.route(AB({}), 'R1', 'R1'); assert.deepStrictEqual([same.ok, same.lenMm, same.steps, same.pts.length], [true, 0, 0, 1], '같은 방은 0');
    const f = AB({}, [{}]); assert.strictEqual(go(f), go(f), '같은 층 객체면 계산을 다시 하지 않는다'); assert.deepStrictEqual(go(AB({}, [{}])), go(f), '같은 입력이면 같은 결과'); }
  { // 문서 명령(방 도구)으로 따로 그린 두 방은 경계 벽이 두 겹이다 — 문은 한쪽 벽(W2)에만 달 수 있고, 그 문이 겹치거나 맞닿은 벽(W8)도 연다
    const two = (x, o = {}) => { const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [3000, 3000], name: '현관' }); s.exec({ type: 'addRoomRect', a: [x, 0], b: [x + 3000, 3000], name: '주방' }); if (o) s.exec({ type: 'addOpening', wall: 'W2', at: 0.5, kind: 'door', ...o }); return s; };
    const s0 = two(3150, null); assert.deepStrictEqual(A.defaultPairs(cf(s0.doc)), [['R1', 'R2']]); assert.strictEqual(A.routesFor(cf(s0.doc))[0].reason, 'none', '문이 없으면 길이 없다');
    assert.strictEqual(G.nearestWall(s0.doc, [3075, 1500], 50).wall.id, 'W2', '중심선이 같은 둘째 벽(W8)은 화면에서 집을 수 없다');
    const s = two(3150), r = A.routesFor(cf(s.doc))[0]; assert.deepStrictEqual([r.ok, r.fromName, r.toName, r.custom, r.steps], [true, '현관', '주방', false, 5], '한쪽 벽의 문으로 지난다'); near(r.lenMm, 3150, 101); assert.ok(Object.isFrozen(cf(s.doc)), '얼린 문서를 바꾸지 않는다');
    for (const x of [3000, 3075, 3300]) assert.ok(A.routesFor(cf(two(x).doc))[0].ok, `벽이 반쯤 겹치거나 맞닿아도 지난다: ${x}`);
    assert.ok(A.routesFor(cf(two(3150, { at: 0.2 }).doc))[0].pts.some((p) => Math.abs(p[0] - 3075) < 300 && Math.abs(p[1] - 555) <= 250), '겹친 벽도 문 자리만 열린다');
    assert.ok(!A.routesFor(cf(two(3400).doc))[0].ok, '벽 사이가 100 벌어지면 다른 벽은 열리지 않는다'); assert.ok(!A.routesFor(cf(two(3150, { kind: 'window' }).doc))[0].ok, '창은 겹친 벽도 열지 않는다');
    s.exec({ type: 'addWall', a: [2500, 1500], b: [3650, 1500], t: 100 }); assert.ok(!A.routesFor(cf(s.doc))[0].ok, '문을 가로지르는 벽은 그대로 막는다'); }
  { // 문 한가운데에 붙은 칸막이(W2)는 문이 열지 않는다: 위 방(R2) → 아래 방(R3)은 문 위쪽으로 나가 R1 에서 칸막이 끝을 돌아 문 아래쪽으로 들어온다
    const d = M.createDoc(), f = d.floors[0], rc = (id, x0, y0, x1, y1) => ({ id, name: id, poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], wallIds: [] });
    f.rooms.push(rc('R1', 0, 0, 3000, 3000), rc('R2', 3150, 0, 6150, 1425), rc('R3', 3150, 1575, 6150, 3000));
    f.walls.push({ id: 'W1', a: [3075, -75], b: [3075, 3075], t: 150, kind: 'inner', bulge: 0 }, { id: 'W2', a: [3075, 1500], b: [6225, 1500], t: 150, kind: 'inner', bulge: 0 });
    f.openings.push({ id: 'O1', wall: 'W1', at: 0.5, width: 1500, height: 2100, sill: 0, type: 'door' }); assert.deepStrictEqual(M.validateDoc(d), []);
    const r = A.route(f, 'R2', 'R3'); assert.ok(r.ok && r.pts.some((p) => p[0] < 2900), `칸막이를 뚫지 않고 R1 로 돌아간다: ${r.ok && r.pts.map((p) => p[0])}`); }
  { // 칸 수 상한: 60 m 는 200 mm 칸으로 계산하고, 200 m 는 계산하지 않는다. 벽이 많아도 멈추지 않는다
    const big = (k) => { const d = M.createDoc(), f = d.floors[0]; f.rooms.push({ id: 'R1', name: 'A', poly: [[0, 0], [k / 2, 0], [k / 2, k], [0, k]], wallIds: [] }, { id: 'R2', name: 'B', poly: [[k / 2, 0], [k, 0], [k, k], [k / 2, k]], wallIds: [] }); return d.floors[0]; };
    let t0 = process.hrtime.bigint(); const r60 = go(big(60000)); let ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(r60.ok && r60.pts.every((p) => (p[0] + 150) % 200 === 0 && (p[1] + 150) % 200 === 0), '60 m: 200 mm 칸(격자 원점 = 방 외곽 −150)'); near(r60.lenMm, 30000, 201); assert.ok(ms < 2000, `60 m 도면 ${ms.toFixed(0)}ms`);
    t0 = process.hrtime.bigint(); assert.deepStrictEqual(go(big(200000)), { ok: false, reason: 'big' }); assert.deepStrictEqual(go(big(1e7)), { ok: false, reason: 'big' }); ms = Number(process.hrtime.bigint() - t0) / 1e6; assert.ok(ms < 200, `큰 도면은 바로 포기한다 ${ms.toFixed(0)}ms`);
    const many = big(20000); for (let i = 0; i < 2000; i++) many.walls.push({ id: 'W' + i, a: [(i % 50) * 400 + 100, Math.floor(i / 50) * 400 + 100], b: [(i % 50) * 400 + 300, Math.floor(i / 50) * 400 + 100], t: 100, kind: 'inner', bulge: 0 });
    t0 = process.hrtime.bigint(); go(many); ms = Number(process.hrtime.bigint() - t0) / 1e6; assert.ok(ms < 2000, `벽 2,000개 ${ms.toFixed(0)}ms`);
    assert.deepStrictEqual(A.route(M.createDoc().floors[0], 'R1', 'R2'), { ok: false, reason: 'none' }, '빈 층'); }

  /* ===== 5. 기본 동선 · 템플릿 전수 ===== */
  const names = (d) => A.routesFor(cf(d)).map((r) => `${r.fromName}→${r.toName}`);
  assert.deepStrictEqual(names(tpl('three-b')), ['현관→주방', '현관→안방', '침실 2→욕실'], '현관·주방·안방이 있으면 세 줄(작은방 이름이 없으면 가장 작은 침실)');
  assert.deepStrictEqual(names(tpl('two-a')), ['현관→거실·주방', '작은방→욕실'], '안방이 없으면 그 줄은 없다 · 작은방은 이름으로');
  assert.deepStrictEqual(names(tpl('studio-a')), [], "'현관·주방' 한 방이면 현관→주방 줄이 없다(개인 존 방도 없다)");
  assert.deepStrictEqual(names(tpl('apt-a')).at(-1), '침실 1→욕실', "'욕실'과 '욕실 2'가 있으면 이름이 짧은 '욕실'");
  assert.deepStrictEqual(A.defaultPairs(M.createDoc().floors[0]), []);
  { // 이름 갈래: '화장실'·띄어 쓴 '작은 방' / 딸린 방('안방 욕실'·'주방 발코니'·'현관 창고')은 그 방이 아니다 — 해당 방이 없으면 줄이 없다
    const by = (list) => { const s = new S.Store(); list.forEach((n, i) => { const [name, w = 3000] = [].concat(n); s.exec({ type: 'addRoomRect', a: [i * 5000, 0], b: [i * 5000 + w, 3000], name }); }); return names(s.doc); };
    assert.deepStrictEqual(by(['현관', '주방', '안방', ['작은 방', 2500], ['침실', 2000], '화장실']), ['현관→주방', '현관→안방', '작은 방→화장실'], "'작은 방'(더 작은 침실이 있어도 이름이 먼저) · '화장실'");
    assert.deepStrictEqual(by(['현관', '침실 1', '안방 욕실', '주방']), ['현관→주방', '침실 1→안방 욕실'], "'안방 욕실'은 안방이 아니다(욕실로는 맞다)");
    assert.deepStrictEqual(by(['현관', '안방', '주방 발코니']), ['현관→안방'], "'주방 발코니'는 주방이 아니다");
    assert.deepStrictEqual(by(['현관 창고', '주방', '안방']), [], "'현관 창고'는 현관이 아니다");
    assert.deepStrictEqual(by(['현관', '주방 식당', '안방 2', '안방욕실']), ['현관→주방 식당', '현관→안방 2'], "'주방 식당'·'안방 2'는 맞다(개인 존의 다른 방이 없으면 셋째 줄도 없다)");
    assert.deepStrictEqual(by(['현관', '안방욕실']), [], "붙여 쓴 '안방욕실'도 안방이 아니다"); }
  { const f = cf(tpl('three-b')), ex = A.routesFor(f, [['R1', 'R2'], ['R1', 'R2'], ['R1', 'ZZ'], A.defaultPairs(f)[0]]);
    assert.deepStrictEqual(ex.map((r) => r.custom), [false, false, false, true], '더한 동선: 겹치는 쌍·없는 방은 빼고 뒤에 붙는다'); }
  for (const t of TPL) { // 템플릿 10개: 모든 방 쌍이 이어지고, 경로는 벽 두께만큼 넓힌 방 외곽 밖(집 밖)으로 나가지 않는다
    const f = cf(t.doc), outer = f.rooms.map((r) => G.roomOutlineWithArcs(r, f.walls, { withWalls: true }));
    for (const a of f.rooms) for (const b of f.rooms) { if (a.id >= b.id) continue; const r = A.route(f, a.id, b.id);
      assert.ok(r.ok, `${t.id} ${a.name}→${b.name}`); assert.ok(r.lenMm >= G.dist(r.pts[0], r.pts.at(-1)) - 1e-6);
      assert.ok(r.pts.every((p) => outer.some((poly) => G.pointInPoly(poly, p))), `${t.id} ${a.name}→${b.name} 집 안`); }
    assert.ok(A.routesFor(f).every((r) => r.ok), t.id + ' 기본 동선'); }
  { // 문을 창으로 바꾸면 그 방만 끊긴다(studio-a 욕실 문 O4)
    const d = M.cloneDoc(tpl('studio-a')), f = d.floors[0], id = (n) => f.rooms.find((r) => r.name === n).id, bath = id('욕실'), room = id('원룸'), hall = id('현관·주방');
    const before = A.route(tpl('studio-a').floors[0], room, bath); assert.ok(before.ok && before.steps === Math.ceil(before.lenMm / 650));
    const doors = f.openings.filter((o) => o.type !== 'window' && f.rooms.find((r) => r.id === bath).wallIds.includes(o.wall)); assert.strictEqual(doors.length, 1, '욕실 문은 하나'); doors[0].type = 'window';
    assert.deepStrictEqual(A.route(f, room, bath), { ok: false, reason: 'none' }); assert.ok(A.route(f, room, hall).ok, '다른 방은 그대로'); }

  console.log('test-plan-analysis: OK');
})().catch((e) => { console.error(e); process.exit(1); });
