// 플래너 '가구' 시험 — data/furniture-catalog.json(id·분류·치수 범위·상표 없음) · core(kind:'furniture' 검증·왕복 저장·크기 고치기·되돌리기·옛 문서) · 모형 조각이 치수 상자 안 · 3D 정점 · 견적 · 엔진 JSON 미포함 · 배치 도구 · 화면 코드 정적 점검.
// 실행: node tools/test-plan-furniture.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PLAN = process.env.PLAN_DIR || path.join(__dirname, '..', 'maker/3d/plan');
const imp = (p) => import(pathToFileURL(path.join(PLAN, p)).href);
const read = (p) => fs.readFileSync(path.join(PLAN, p), 'utf8');

(async () => {
  const [Mo, S, X, MESH, E, P, T, V3, AX] = await Promise.all(['core/model.js', 'core/store.js', 'core/export.js', 'core/mesh3d.js', 'estimate.js', 'panels.js', 'tools.js', 'view3d.js', 'core/axo.js'].map(imp));
  const { Store } = S, { createDoc, validateDoc, curFloor, FURNITURE_SHAPES, APPLIANCE_LIMITS: LIM } = Mo;
  const CAT = JSON.parse(read('data/furniture-catalog.json')), items = CAT.items;

  /* 1. 목록 */
  assert.ok(items.length >= 40, '가구 40행 이상');
  assert.strictEqual(new Set(items.map((m) => m.id)).size, items.length, 'id 유일');
  assert.strictEqual(new Set(items.map((m) => m.name)).size, items.length, '이름 유일');
  const types = CAT.meta.types.map((t) => t.id), places = CAT.meta.places.map((t) => t.id);
  assert.deepStrictEqual(places, ['office', 'home']);
  for (const m of items) {
    assert.ok(types.includes(m.type) && places.includes(m.place) && FURNITURE_SHAPES.includes(m.shape), `${m.id} 분류·모양`);
    assert.ok([m.widthMm, m.depthMm].every((v) => Number.isInteger(v) && v >= LIM.footMin && v <= LIM.footMax) && Number.isInteger(m.heightMm) && m.heightMm >= LIM.heightMin && m.heightMm <= LIM.heightMax, `${m.id} 치수 범위`);
    assert.deepStrictEqual(Object.keys(m), ['id', 'place', 'type', 'shape', 'name', 'widthMm', 'depthMm', 'heightMm'], `${m.id} 칸`);
  }
  for (const t of types) assert.ok(items.some((m) => m.type === t), `종류 ${t} 에 행이 있다`);
  for (const sh of FURNITURE_SHAPES) assert.ok(items.some((m) => m.shape === sh), `모양 ${sh} 를 쓰는 행이 있다`);
  for (const need of ['책상', '의자', '회의 테이블', '캐비닛', '책장', '파티션', '소파']) assert.ok(items.some((m) => m.place === 'office' && m.name.includes(need)), `사무실 ${need}`);
  const raw = read('data/furniture-catalog.json');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(|https?:/i.test(raw), '목록에 색·주소 없음');
  assert.ok(!/삼성|samsung|\bLG\b|이케아|ikea|한샘|퍼시스|시디즈|일룸|데스커|리바트/i.test(raw), '목록에 상표 없음');

  /* 2. 문서 모델 — 모든 행 놓기, 왕복 저장, 고치기 */
  const room = { type: 'addRoomRect', a: [0, 0], b: [6850, 4350] };
  const st = new Store(createDoc('가구'));
  st.exec(room);
  items.forEach((m, k) => st.exec({ type: 'addItem', ...P.furnitureOpts(m), c: [100 + k * 10, 200], rot: (k % 4) * 90 }));
  const fl = () => curFloor(st.doc);
  assert.strictEqual(fl().items.length, items.length, '모든 행이 놓인다');
  assert.deepStrictEqual(validateDoc(st.doc), []);
  const back = X.fromDocJSON(X.toDocJSON(st.doc));
  assert.deepStrictEqual(back.floors[0].items, fl().items, '문서 JSON 왕복');
  const id = fl().items[0].id, get = () => fl().items.find((i) => i.id === id);
  st.exec({ type: 'update', id, patch: { size: [1500, 750], heightMm: 740, name: '내 책상', rot: 45 } });
  assert.deepStrictEqual([get().size, get().heightMm, get().name, get().rot], [[1500, 750], 740, '내 책상', 45], '가로·깊이·높이·이름·회전 고치기');
  st.undo(); assert.strictEqual(get().name, items[0].name, '되돌리기');
  const ko = (fn) => assert.throws(fn, (e) => /[가-힣]/.test(e.message));
  ko(() => st.exec({ type: 'update', id, patch: { size: [1, 700] } })); ko(() => st.exec({ type: 'update', id, patch: { heightMm: 9999 } }));
  ko(() => st.exec({ type: 'update', id, patch: { name: '' } })); ko(() => st.exec({ type: 'update', id, patch: { shape: 'ufo' } }));
  ko(() => st.exec({ type: 'addItem', kind: 'furniture', shape: 'box', name: '상자', c: [10, 10] }));
  assert.deepStrictEqual(get().size, [items[0].widthMm, items[0].depthMm], '거절된 값은 남지 않는다');
  // 옛 문서(가구 없음): 에어컨·가전만 든 문서와 템플릿이 그대로 열린다
  const old = new Store(createDoc('옛'));
  old.exec(room);
  old.exec({ type: 'addItem', kind: 'ac', model: '4way', brand: 'lg', c: [1000, 1000], size: [950, 950] });
  old.exec({ type: 'addItem', kind: 'appliance', category: 'tv', brand: 'lg', model: 'X1', name: 'TV', c: [2000, 1000], size: [1200, 60], heightMm: 700 });
  const oldJson = X.toDocJSON(old.doc);
  assert.deepStrictEqual(validateDoc(X.fromDocJSON(oldJson)), []); assert.ok(!oldJson.includes('furniture'));
  for (const t of JSON.parse(read('data/templates.json')).templates) if (t.doc) { assert.deepStrictEqual(validateDoc(t.doc), [], `템플릿 ${t.id}`); MESH.buildMesh(t.doc, 0); }
  assert.ok(validateDoc({ ...old.doc, floors: [{ ...old.doc.floors[0], items: [{ id: 'I9', kind: 'desk' }] }] }).some((m) => /ac·appliance·furniture/.test(m)), '모르는 종류는 거절');

  /* 3. 모형 — 조각은 치수 상자 안, 크기를 바꾸면 따라온다 */
  for (const sh of FURNITURE_SHAPES) for (const [w, d, h] of [[1400, 700, 720], [300, 50, 10], [5000, 5000, 4000]]) {
    const parts = MESH.furnitureParts(sh, w, d, h);
    assert.ok(parts.length >= 1, sh);
    for (const [x0, y0, x1, y1, z0, z1] of parts) assert.ok(x0 >= -w / 2 - 1e-6 && x1 <= w / 2 + 1e-6 && y0 >= -d / 2 - 1e-6 && y1 <= d / 2 + 1e-6 && z0 >= 0 && z1 <= h + 1e-6 && x1 > x0 && y1 > y0 && z1 > z0, `${sh} ${w}×${d}×${h} 조각이 상자 안`);
    assert.ok(Math.abs(Math.max(...parts.map((p) => p[5])) - h) < 1e-6, `${sh} 꼭대기 = 높이`);
  }
  assert.ok(MESH.furnitureParts('table', 1400, 700, 720).length === 5 && MESH.furnitureParts('ldesk', 1600, 1400, 720).length === 7, '책상: 상판 + 다리');
  const mesh = MESH.buildMesh(st.doc, 0);
  for (const i of mesh.items) {
    const xs = i.poly.map((p) => p[0]), ys = i.poly.map((p) => p[1]);
    assert.ok(i.kind === 'furniture' && i.z0 === 0 && i.z1 === i.heightMm && i.parts.length >= 1);
    for (const p of i.parts) for (const q of p.poly) assert.ok(q[0] >= Math.min(...xs) - 1e-6 && q[0] <= Math.max(...xs) + 1e-6 && q[1] >= Math.min(...ys) - 1e-6 && q[1] <= Math.max(...ys) + 1e-6, `${i.name} 돌려도 조각이 평면 상자 안`);
  }
  const md = V3.meshData(mesh);
  assert.ok(md.furniture.idx.length > 0 && md.ac.idx.length === 0 && md.appliance.idx.length === 0, '가구 정점은 가구 묶음에만');
  let zmax = -Infinity; for (let k = 2; k < md.furniture.pos.length; k += 3) zmax = Math.max(zmax, md.furniture.pos[k]);
  assert.ok(zmax > 0, '정점 높이');
  const om = V3.meshData(MESH.buildMesh(old.doc, 0));
  assert.ok(om.furniture.idx.length === 0 && om.ac.idx.length > 0 && om.appliance.idx.length > 0, '옛 문서의 3D 는 그대로');
  assert.ok(AX.axoScene(mesh).faces.some((f) => f.kind === 'appliance') && !AX.axoScene(mesh).faces.some((f) => f.kind === 'ac'), '액소: 가구는 바닥 상자');

  /* 4. 견적 · 내보내기 */
  const s2 = new Store(createDoc('사무실'));
  s2.exec(room);
  const desk = items.find((m) => m.id === 'desk-1400'), chair = items.find((m) => m.id === 'office-chair');
  [[1000, 1000], [3000, 1000], [5000, 1000]].forEach((c) => s2.exec({ type: 'addItem', ...P.furnitureOpts(desk), c }));
  [[1000, 2000], [3000, 2000]].forEach((c) => s2.exec({ type: 'addItem', ...P.furnitureOpts(chair), c }));
  const est = E.buildEstimate(s2.doc), csv = E.toCsv(est);
  assert.deepStrictEqual(est.furniture.map((g) => [g.name, g.dims, g.count]), [['책상 1400', '1400×700×720', 3], ['사무 의자', '600×600×950', 2]]);
  assert.strictEqual(est.totals.furnitureCount, 5); assert.strictEqual(est.totals.acCount, 0); assert.strictEqual(est.totals.applianceCount, 0);
  assert.ok(csv.includes('가구\r\n층,이름,가로×깊이×높이 mm,수량\r\nFloor 1,책상 1400,1400×700×720,3\r\n'));
  assert.ok(!E.toCsv(E.buildEstimate(old.doc)).includes('가구'), '가구 없는 문서의 CSV 에 가구 구역 없음');
  assert.strictEqual(X.toSpaceJSON(s2.doc).ac_units?.length ?? 0, 0, '엔진 공간 JSON 에 가구 없음'); assert.ok(!JSON.stringify(X.toSpaceJSON(s2.doc)).includes('furniture'));

  /* 5. 패널 순수 함수 */
  assert.strictEqual(P.filterFurniture(items, { place: 'office' }).length, items.filter((m) => m.place === 'office').length);
  assert.ok(P.filterFurniture(items, { type: 'desk', place: 'office' }).every((m) => m.type === 'desk' && m.place === 'office'));
  assert.deepStrictEqual(P.filterFurniture(items, { query: '책상 14' }).map((m) => m.id), ['desk-1400']);
  assert.deepStrictEqual(P.filterFurniture(items, { ids: new Set(['bed-q']) }).map((m) => m.id), ['bed-q']);
  assert.deepStrictEqual(P.furnitureOpts(desk), { kind: 'furniture', shape: 'table', name: '책상 1400', size: [1400, 700], heightMm: 720 });
  assert.strictEqual(T.describeEl(s2.doc, curFloor(s2.doc).items[0].id), '가구 책상 1400');

  /* 6. 화면 코드 정적 점검 */
  for (const f of ['app.js', 'panels.js', 'tools.js', 'view2d.js', 'view3d.js', 'estimate.js', 'minimap.js', 'core/mesh3d.js', 'core/model.js', 'core/store.js']) {
    const src = read(f).replace(/^const FALLBACK = .*$/m, '');   // view3d 의 시험용 토큰 대체값 한 줄(원래 있던 것)은 뺀다
    assert.ok(!/\.innerHTML\s*[+=]|\.outerHTML\s*=|insertAdjacentHTML\(/.test(src), `${f} innerHTML 없음`);
    assert.ok(!/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(/.test(src), `${f} 색 리터럴 없음`);
  }
  const pj = read('panels.js'), aj = read('app.js');
  assert.ok(/id: 'furn', label: '가구'/.test(pj) && /loadData\('furniture-catalog'\)/.test(pj) && /아직 놓은 가구가 없습니다/.test(pj), '가구 칸');
  assert.ok(/text: '같은 것 놓기'/.test(aj) && /e\.code === 'KeyD'/.test(aj) && /add\(num\('가로'[^\n]*add\(num\('깊이'[^\n]*add\(num\('높이'/.test(aj), '속성: 크기 세 칸 · 같은 것 놓기');
  assert.ok(!/3D/.test(pj.slice(pj.indexOf('제품(가구)'), pj.indexOf('제품 판: 맨 위 세 칸'))), '가구 판 문구에 3D 없음');
  console.log(`test-plan-furniture: 통과 (가구 ${items.length}행)`);
})().catch((e) => { console.error(e); process.exit(1); });
