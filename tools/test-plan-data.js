// 플래너 패널·데이터(maker/3d/plan: panels.js · estimate.js · data/ac-catalog.json · finishes.json · templates.json) 시험 — DOM 없는 부분 전부.
// 카탈로그는 제원 폴더 CSV 와 전수 대조(독립 CSV 파서), 템플릿은 core(validateDoc·toSpaceJSON·buildMesh)로, 견적은 손으로 센 값으로 단언한다.
// 실행: node tools/test-plan-data.js   변이 시험용: PLAN_DIR(plan 폴더 사본)·HVAC_SPECS_DIR(제원 폴더) 환경변수
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PLAN = process.env.PLAN_DIR || path.join(__dirname, '..', 'maker/3d/plan');
const SPECS = process.env.HVAC_SPECS_DIR || path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/Obsidian/Personal/reference/hvac-specs');
const imp = (p) => import(pathToFileURL(path.join(PLAN, p)).href);
const read = (p) => fs.readFileSync(path.join(PLAN, p), 'utf8');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b}`);

// 독립 CSV 파서(RFC4180) — 카탈로그 생성기(파이썬 csv)와 다른 구현으로 대조한다
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const r2 = (v) => Math.round(v * 100) / 100;

(async () => {
  const [P, E, M, G, X, S, MESH] = await Promise.all([imp('panels.js'), imp('estimate.js'), imp('core/model.js'), imp('core/geom.js'), imp('core/export.js'), imp('core/store.js'), imp('core/mesh3d.js')]);
  const { createDoc, validateDoc, MODELS, BRANDS, curFloor } = M;

  /* ===== 0. 정적 점검 ===== */
  for (const f of ['panels.js', 'estimate.js']) {
    const src = read(f), code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(/^\/\/ \S/.test(src), f + ' 맨 위 한 줄 역할 주석');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new Function|document\.write/.test(code), f + ' — innerHTML 류·eval 금지');
    assert.ok(!/\blocalStorage\b/.test(code.replace(/try \{ return localStorage; \} catch \(e\) \{ return null; \}/g, '')), f + ' — localStorage 는 createFavs 의 기본 저장소 한 곳(접근 오류를 잡는다)에서만');
  }
  assert.ok(/^\/\* \S/.test(read('panels.css')), 'panels.css 맨 위 한 줄 역할 주석');
  const css = read('panels.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'panels.css 에 hex 색 금지');
  assert.ok(!/\b(?:rgb|rgba|hsl|hsla)\(/.test(css), 'panels.css 에 rgb 리터럴 금지');
  assert.ok(!/gradient\(/.test(css), 'panels.css 에 그라디언트 금지');
  assert.ok(!/999px/.test(css), 'panels.css 에 999px 금지');
  assert.ok(!/(?:transition|animation)[^;{}]*\b\d+(?:\.\d+)?m?s\b/.test(css), 'panels.css 에 시간 리터럴 금지(토큰만)');
  assert.ok(/prefers-reduced-motion/.test(css), '동작 줄이기 존중');
  const vars = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
  const tokenSrc = fs.readFileSync(path.join(__dirname, '..', 'assets/css/design-tokens.css'), 'utf8') + read('../studio.css');
  for (const v of new Set(vars)) assert.ok(new RegExp(v + '\\s*:').test(tokenSrc), `panels.css 가 쓰는 ${v} 가 토큰 파일에 없다`);
  for (const f of ['finishes.json', 'ac-catalog.json', 'templates.json']) JSON.parse(read('data/' + f)); // 문법
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(read('data/ac-catalog.json') + read('data/templates.json')), 'hex 색은 finishes.json 에만');
  for (const [n, fn] of Object.entries({ mountPanel: P.mountPanel, openEstimate: E.openEstimate, buildEstimate: E.buildEstimate, toCsv: E.toCsv, loadTemplates: P.loadTemplates })) assert.strictEqual(typeof fn, 'function', n);

  /* ===== 1. 카탈로그 ===== */
  const cat = JSON.parse(read('data/ac-catalog.json'));
  assert.strictEqual(Object.keys(cat)[0], 'meta', 'meta 가 맨 위');
  assert.ok(/^\{\n  "meta"/.test(read('data/ac-catalog.json')), 'meta 가 파일 맨 앞');
  const models = cat.models;
  assert.strictEqual(cat.meta.counts.models, models.length);
  const ids = models.map((m) => m.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'id 유일');
  for (const k of ['source', 'readme', 'included', 'excluded', 'columns']) assert.ok(cat.meta[k], 'meta.' + k);
  assert.ok(cat.meta.readme.reliability.length >= 3 && cat.meta.readme.rules.length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(cat.meta.readme.checked), 'README 신뢰도·규칙·수집일이 meta 에');
  assert.ok(/실외기/.test(cat.meta.excluded) && /세트/.test(cat.meta.excluded), '제외 이유를 meta 에');
  for (const m of models) {
    assert.ok(MODELS.includes(m.type), m.id + ' type');
    assert.ok(BRANDS.includes(m.brand), m.id + ' brand');
    assert.strictEqual(m.id, `${m.brand}:${m.code}`);
    assert.ok(m.code && typeof m.code === 'string');
    for (const k of ['coolingKw', 'heatingKw']) assert.ok(m[k] === null || (Number.isFinite(m[k]) && m[k] > 0), m.id + ' ' + k);
    for (const k of ['bodyMm', 'panelMm']) assert.ok(m[k] === null || (m[k].length === 3 && m[k].every((v) => Number.isFinite(v) && v > 0)), m.id + ' ' + k);
    assert.strictEqual(typeof m.currentUncertain, 'boolean');
  }
  // 1-a. 제원 폴더 CSV 와 전수 대조
  const csvFiles = [['samsung', 'samsung.csv'], ['lg', 'lg.csv']];
  let csvChecked = false;
  if (fs.existsSync(path.join(SPECS, 'data', 'samsung.csv'))) {
    csvChecked = true;
    const want = [];
    for (const [brand, fname] of csvFiles) {
      const raw = fs.readFileSync(path.join(SPECS, 'data', fname));
      assert.strictEqual(crypto.createHash('sha256').update(raw).digest('hex'), cat.meta.source.sha256[fname], `${fname} 가 카탈로그를 만든 뒤 바뀌었다 — python3 tools/build-ac-catalog.py 를 다시 돌린다`);
      const [head, ...rows] = parseCsv(raw.toString('utf8'));
      for (const r of rows) {
        const o = Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']));
        assert.strictEqual(r.length, head.length, `${fname} ${o.model} 칸 수`);
        if (o.unit_type === '실내기' && ['1way', '2way', '4way', '360'].includes(o.form)) want.push({ brand, o });
      }
    }
    assert.strictEqual(models.length, want.length, '천장형 실내기 행 수');
    assert.deepStrictEqual(ids, want.map((w) => `${w.brand}:${w.o.model}`), '행 순서·구성');
    const num = (s) => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : null);
    const dims = (s) => { if (!s) return null; const a = s.replace(/\(.*?\)/g, '').replace(/mm/g, '').split('×').map((t) => t.replace(/[,\s]/g, '')); assert.ok(a.length === 3 && a.every((t) => /^\d+(\.\d+)?$/.test(t)), '치수 형식 ' + s); return a.map(Number); };
    const VERB = ['series', 'cooling_kw', 'heating_kw', 'pyeong', 'area_m2', 'hp', 'power_supply', 'power_cooling_w', 'power_heating_w', 'energy_grade', 'body_size_mm', 'panel_size_mm', 'weight_kg', 'refrigerant', 'pipe_liquid', 'pipe_gas', 'paired_outdoor', 'source_url', 'checked_date', 'note', 'verified'];
    models.forEach((m, i) => {
      const { brand, o } = want[i];
      assert.strictEqual(m.brand, brand); assert.strictEqual(m.code, o.model, m.id); assert.strictEqual(m.form, o.form, m.id); assert.strictEqual(m.brandName, o.brand === '' ? null : o.brand, m.id);
      for (const k of VERB) assert.strictEqual(m[k], o[k] === '' ? null : o[k], `${m.id} ${k}`); // 원문 그대로, 빈칸은 null — 채운 값 없음
      assert.strictEqual(m.coolingKw, num(o.cooling_kw), `${m.id} coolingKw`);
      assert.strictEqual(m.heatingKw, num(o.heating_kw), `${m.id} heatingKw`);
      assert.deepStrictEqual(m.bodyMm, dims(o.body_size_mm), `${m.id} bodyMm`);
      assert.deepStrictEqual(m.panelMm, dims(o.panel_size_mm), `${m.id} panelMm`);
      assert.strictEqual(m.type, o.form === '4way' && m.bodyMm && m.bodyMm[0] < 600 ? 'mini4way' : o.form, `${m.id} type`);
      assert.strictEqual(m.currentUncertain, o.note.includes('현행 불확실'), m.id);
      if (m.coolingKw === null) assert.ok(o.cooling_kw === '' || /W$/.test(o.cooling_kw), `${m.id} 숫자가 아닌 냉방 원문은 빈칸이거나 W 표기`);
    });
    // README 신뢰도·규칙 줄이 원문 그대로 meta 에
    const readme = fs.readFileSync(path.join(SPECS, 'README.md'), 'utf8');
    for (const line of [...cat.meta.readme.reliability, ...cat.meta.readme.rules]) assert.ok(readme.includes(line), 'README 에 없는 줄: ' + line.slice(0, 30));
  } else console.warn(`SKIP 제원 폴더가 없어 CSV 전수 대조를 건너뜀: ${SPECS}`);
  // 1-b. 구성 수치(이 자료 기준) — 형식별 개수가 바뀌면 의도한 변경인지 본다
  const count = (t) => models.filter((m) => m.type === t).length;
  assert.deepStrictEqual(cat.meta.counts.byType, { '1way': count('1way'), '2way': count('2way'), '4way': count('4way'), mini4way: count('mini4way'), '360': count('360') });
  // 1-c. 배치 값 — 놓을 수 있는 모델은 core 가 받는다
  let placeable = 0;
  for (const m of models) {
    const pl = P.placement(m), o = P.placeOpts(m);
    assert.strictEqual(pl === null, m.panelMm === null && m.bodyMm === null, m.id + ' 치수가 하나도 없을 때만 못 놓는다');
    if (!pl) { assert.strictEqual(o, null); continue; }
    placeable++;
    assert.deepStrictEqual(Object.keys(o).sort(), ['brand', 'capacityKw', 'code', 'model', 'size'], '계약의 placeItem 키');
    const d = m.panelMm || m.bodyMm;
    assert.deepStrictEqual(o.size, [d[0], d[2]], m.id + ' 크기 = 판넬(없으면 본체)의 가로×세로');
    assert.strictEqual(o.capacityKw, m.coolingKw); assert.strictEqual(o.model, m.type); assert.strictEqual(o.code, m.code);
  }
  const st = new S.Store(createDoc());
  st.exec({ type: 'addRoomRect', a: [0, 0], b: [20000, 20000] });
  for (const m of models) { const o = P.placeOpts(m); if (o) st.exec({ type: 'addItem', kind: 'ac', c: [1000, 1000], ...o }); }
  assert.strictEqual(curFloor(st.doc).items.length, placeable, '놓을 수 있는 모델을 전부 addItem 으로 받는다');
  assert.deepStrictEqual(validateDoc(st.doc), []);
  assert.ok(placeable > models.length * 0.7 && placeable < models.length, `놓을 수 있는 ${placeable}/${models.length}`);

  /* ===== 2. 검색·정렬·표시 ===== */
  const only = (arr, t) => arr.every((m) => m.type === t);
  assert.ok(only(P.filterModels(models, { type: '1way' }), '1way') && P.filterModels(models, { type: '1way' }).length === count('1way'));
  assert.strictEqual(P.filterModels(models, { type: 'mini4way' }).length, count('mini4way'));
  assert.strictEqual(P.filterModels(models, { query: 'ac060cn4pbh1' }).length, models.filter((m) => m.code.toLowerCase() === 'ac060cn4pbh1').length, '대소문자 무시');
  assert.ok(P.filterModels(models, { query: '무풍 4way' }).every((m) => /무풍/.test(m.series) && /4way/i.test(m.series.replace(/\s/g, ''))), '공백 무시');
  assert.ok(P.filterModels(models, { query: 'lg' }).length >= 90 && P.filterModels(models, { query: 'lg' }).every((m) => m.brand === 'lg' || /lg/i.test(m.series + m.code)), '브랜드 검색');
  assert.strictEqual(P.filterModels(models, { query: '없는모델명zzz' }).length, 0);
  assert.strictEqual(P.filterModels(models, { ids: new Set([ids[0], ids[5]]) }).length, 2, '즐겨찾기 id 만');
  const byName = P.sortModels(models, 'name');
  for (let i = 1; i < byName.length; i++) assert.ok(byName[i - 1].code.localeCompare(byName[i].code, 'ko', { numeric: true }) <= 0, '이름순');
  const asc = P.sortModels(models, 'kwAsc'), nn = asc.findIndex((m) => m.coolingKw === null);
  assert.ok(nn > 0 && asc.slice(nn).every((m) => m.coolingKw === null), 'kW 모르는 것은 맨 뒤');
  for (let i = 1; i < nn; i++) assert.ok(asc[i - 1].coolingKw <= asc[i].coolingKw);
  const desc = P.sortModels(models, 'kwDesc'), dNull = desc.findIndex((m) => m.coolingKw === null);
  for (let i = 1; i < dNull; i++) assert.ok(desc[i - 1].coolingKw >= desc[i].coolingKw);
  assert.strictEqual(desc.length, models.length);
  assert.strictEqual(P.kwText({ coolingKw: 7.2, cooling_kw: '7.20' }), '7.2 kW');
  assert.strictEqual(P.kwText({ coolingKw: null, cooling_kw: '4,000W' }), '4,000W', 'W 표기는 환산하지 않는다');
  assert.strictEqual(P.kwText({ coolingKw: null, cooling_kw: null }), '미확인');
  assert.strictEqual(P.fmtDims([950, 48, 950]), '950×48×950'); assert.strictEqual(P.fmtDims(null), '');
  assert.deepStrictEqual(P.MODEL_ORDER, ['1way', '2way', '4way', 'mini4way', '360']);

  // 즐겨찾기 저장소
  const fake = () => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = v; }, d }; };
  const s1 = fake(), f1 = P.createFavs('ac', s1);
  assert.strictEqual(f1.toggle('a'), true); f1.toggle('b'); assert.ok(f1.has('a') && f1.has('b'));
  assert.deepStrictEqual(JSON.parse(s1.d['ain-plan-fav-ac']), ['a', 'b']);
  assert.ok(P.createFavs('ac', s1).has('b'), '다시 열어도 남는다');
  f1.toggle('a'); assert.ok(!f1.has('a')); assert.deepStrictEqual(JSON.parse(s1.d['ain-plan-fav-ac']), ['b']);
  const bad = { getItem: () => '{깨짐', setItem: () => { throw new Error('quota'); } }, f2 = P.createFavs('ac', bad);
  assert.strictEqual(f2.all().size, 0, '깨진 값은 빈 목록'); assert.strictEqual(f2.toggle('z'), false, '저장 실패를 알린다'); assert.ok(f2.has('z'), '이번 화면에서는 유지');
  assert.strictEqual(P.createFavs('ac', null).toggle('q'), false, '저장소 없음');
  assert.deepStrictEqual([...P.createFavs('ac', { getItem: () => '[1,"x",null]', setItem() {} }).all()], ['x'], '문자열 id 만');

  // 접근하는 것만으로 SecurityError 를 던지는 저장소(제3자 iframe·쿠키 차단) — 기본 저장소로 즐겨찾기를 만들어도 터지지 않고 이번 화면에서는 동작한다
  { const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError: The operation is insecure.'); }, configurable: true });
    try { const f3 = P.createFavs('ac'); assert.strictEqual(f3.all().size, 0); assert.strictEqual(f3.toggle('a'), false, '저장은 못 한다고 알린다'); assert.ok(f3.has('a'), '이번 화면에서는 유지'); }
    finally { if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage; } }

  // 잠금: 제품 패널의 삭제·마감재 적용·해제는 store 에 곧바로 쓰지 않고 앱의 ctx.exec(잠금 검사)로만 간다
  { const cmds = [], boom = { exec() { throw new Error('store.exec 를 직접 불러서는 안 된다'); } };
    const ctx = { store: boom, exec: (c) => { cmds.push(c); return ctx.locked ? null : []; } };
    assert.deepStrictEqual(P.removeItem(ctx, 'I3'), []); assert.deepStrictEqual(P.applyFinish(ctx, { id: 'wall-wood-walnut', target: 'wall' }), []); assert.deepStrictEqual(P.clearFinish(ctx, 'floor'), []);
    assert.deepStrictEqual(cmds, [{ type: 'remove', ids: ['I3'] }, { type: 'setFloor', patch: { finish: { wall: 'wall-wood-walnut' } } }, { type: 'setFloor', patch: { finish: { floor: '' } } }]);
    ctx.locked = true; assert.strictEqual(P.removeItem(ctx, 'I3'), null, '잠금이면 앱이 거절한 결과(null)를 그대로 돌려준다'); assert.strictEqual(P.applyFinish(ctx, { id: 'x', target: 'floor' }), null);
    const real = new S.Store(createDoc()); real.exec({ type: 'setFloor', patch: { finish: { wall: 'wall-wood-walnut' } } });
    P.clearFinish({ store: real }, 'wall'); assert.strictEqual(curFloor(real.doc).finish.wall, '', 'ctx.exec 가 없으면 store.exec'); }
  assert.ok(!/ctx\.store\.exec/.test(read('panels.js').replace(/\/\/.*$/gm, '').replace(/ctx\.store\.exec\(cmd\)/, '')), 'panels.js 는 ctx.store.exec 를 곧바로 부르지 않는다(ctx.exec 를 거친다)');

  /* ===== 3. 마감재 ===== */
  const fin = JSON.parse(read('data/finishes.json')), chipIds = fin.chips.map((c) => c.id);
  assert.ok(fin.finishes.length >= 12);
  assert.strictEqual(new Set(fin.finishes.map((f) => f.id)).size, fin.finishes.length, '마감 id 유일');
  for (const f of fin.finishes) {
    assert.ok(['wall', 'floor'].includes(f.target), f.id); assert.ok(chipIds.includes(f.chip), f.id + ' chip'); assert.ok(/^#[0-9A-Fa-f]{6}$/.test(f.sw), f.id + ' sw'); assert.ok(f.name && f.id.startsWith(f.target + '-'), f.id);
    assert.ok(!/가격|원\b|₩|[0-9]+원|브랜드|제조|정품|특가|할인/.test(f.name), f.id + ' — 가짜 상품·가격 금지');
  }
  for (const t of ['wall', 'floor']) { const n = fin.finishes.filter((f) => f.target === t).map((f) => f.name); assert.strictEqual(new Set(n).size, n.length, t + ' 이름 유일'); assert.ok(n.length >= 4); }
  for (const c of chipIds) assert.ok(fin.finishes.some((f) => f.chip === c), c + ' 칩에 항목이 있다');
  assert.ok(fin.finishes.some((f) => f.chip === 'white') && fin.finishes.some((f) => f.chip === 'wood') && fin.finishes.some((f) => f.chip === 'gray') && fin.finishes.some((f) => f.chip === 'hardwood') && fin.finishes.some((f) => f.chip === 'tile'), '화이트·우드·그레이·강마루·타일');
  assert.strictEqual(P.filterFinishes(fin.finishes, { chip: 'tile' }).length, fin.finishes.filter((f) => f.chip === 'tile').length);
  assert.ok(P.filterFinishes(fin.finishes, { query: '바닥' }).every((f) => f.target === 'floor'), '이름+벽/바닥 글자로 검색');
  assert.strictEqual(P.filterFinishes(fin.finishes, { ids: new Set([fin.finishes[0].id]) }).length, 1);
  // 마감 지정은 core 명령으로 들어간다
  const sf = new S.Store(createDoc());
  sf.exec({ type: 'setFloor', patch: { finish: { wall: fin.finishes[0].id } } }); sf.exec({ type: 'setFloor', patch: { finish: { floor: 'floor-concrete' } } });
  assert.deepStrictEqual(curFloor(sf.doc).finish, { wall: fin.finishes[0].id, floor: 'floor-concrete' });
  sf.exec({ type: 'setFloor', patch: { finish: { wall: '' } } }); assert.deepStrictEqual(curFloor(sf.doc).finish, { wall: '', floor: 'floor-concrete' }, '해제');

  /* ===== 4. 템플릿 ===== */
  const T = JSON.parse(read('data/templates.json')), L = T.templates;
  assert.ok(L.length >= 8 && L.length <= 12, `템플릿 8~12개: ${L.length}`);
  assert.strictEqual(new Set(L.map((t) => t.id)).size, L.length, '템플릿 id 유일');
  assert.ok(/예시 평면\(실제 세대 아님\)/.test(T.meta.about));
  const sizeIds = T.filters.size.map((s) => s.id), layoutIds = T.filters.layout.map((s) => s.id);
  assert.deepStrictEqual(T.filters.size.map((s) => s.name), ['10평미만', '10평대', '20평대', '30평대', '40평이상']);
  const RANGE = { lt10: [0, 10], p10: [10, 20], p20: [20, 30], p30: [30, 40], ge40: [40, Infinity] };
  const M2P = X.toSpaceJSON(createDoc(), 0).load_rule.m2_per_pyeong;
  for (const t of L) {
    const f = t.doc.floors[0];
    assert.deepStrictEqual(validateDoc(t.doc), [], t.id + ' validateDoc');
    assert.strictEqual(t.doc.floors.length, 1); assert.strictEqual(t.doc.title, t.name); assert.strictEqual(t.doc.underlay, null);
    const sp = X.toSpaceJSON(t.doc, 0); // 변환 성공 + 면적 표기 = 계산값
    assert.strictEqual(sp.rooms.length, f.rooms.length, t.id);
    const sum = r2(f.rooms.reduce((s, r) => s + r2(G.roomAreaM2(t.doc, r)), 0));
    assert.strictEqual(t.areaM2, sum, t.id + ' areaM2 = 방 실면적(소수 둘째 자리) 합');
    assert.strictEqual(t.areaM2, sp.envelope.all_rooms_m2, t.id + ' = toSpaceJSON 합');
    assert.deepStrictEqual(t.rooms.map((r) => [r.name, r.areaM2]), sp.rooms.map((r) => [r.name_ko, r.area_m2]), t.id + ' 방별 표기');
    assert.strictEqual(t.pyeong, r2(t.areaM2 / M2P), t.id + ' 평'); assert.ok(sizeIds.includes(t.size) && layoutIds.includes(t.layout), t.id);
    assert.ok(t.pyeong >= RANGE[t.size][0] && t.pyeong < RANGE[t.size][1], `${t.id} 평 ${t.pyeong} 가 ${t.size} 구간 밖`);
    assert.deepStrictEqual(t.tags, [t.layout, T.filters.size.find((s) => s.id === t.size).name], t.id + ' 태그');
    assert.strictEqual(f.items.length, 0, '가짜 제품 없음'); assert.ok(f.rooms.length >= 3 && f.walls.length >= 8 && f.openings.length >= 4, t.id + ' 구성');
    for (const r of f.rooms) { assert.strictEqual(r.wallIds.length, r.poly.length, t.id + ' ' + r.name + ' 변 수'); assert.ok(r.name && !/\d{3,}\s*호/.test(r.name)); }
    const used = new Map(); for (const r of f.rooms) for (const w of r.wallIds) used.set(w, (used.get(w) || 0) + 1);
    for (const w of f.walls) assert.ok(used.has(w.id), `${t.id} ${w.id} 방에 속하지 않은 벽`);
    assert.ok(f.walls.filter((w) => w.kind === 'exterior').length >= 4 && f.walls.every((w) => (w.kind === 'exterior') === (used.get(w.id) === 1)), t.id + ' 외벽 = 한 방에만 속한 벽');
    // 겹치는 벽 없음: 같은 선 위에서 1mm 넘게 겹치면 안 된다
    for (let i = 0; i < f.walls.length; i++) for (let j = i + 1; j < f.walls.length; j++) {
      const a = f.walls[i], b = f.walls[j], d = [a.b[0] - a.a[0], a.b[1] - a.a[1]], L2 = Math.hypot(...d), u = [d[0] / L2, d[1] / L2];
      const off = (p) => Math.abs((p[0] - a.a[0]) * -u[1] + (p[1] - a.a[1]) * u[0]);
      if (off(b.a) > 1 || off(b.b) > 1) continue;
      const pa = [0, L2], pb = [b.a, b.b].map((p) => (p[0] - a.a[0]) * u[0] + (p[1] - a.a[1]) * u[1]).sort((x, y) => x - y);
      assert.ok(Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]) <= 1, `${t.id} ${a.id}/${b.id} 벽이 겹친다`);
    }
    const w = f.openings.map((o) => o.type); assert.ok(w.includes('door') && w.includes('window'), t.id + ' 문·창');
    // 다른 도구가 쓰는 길: JSON 왕복, Store 로 열기, 3D 조각, 명령 추가
    assert.deepStrictEqual(X.fromDocJSON(X.toDocJSON(t.doc)), M.fixSeq({ ...t.doc, underlay: null }), t.id + ' 왕복');
    const store = new S.Store(t.doc);
    store.exec({ type: 'addItem', kind: 'ac', model: '4way', brand: 'samsung', c: [f.rooms[0].poly[0][0] + 900, f.rooms[0].poly[0][1] + 900], size: [950, 950] });
    assert.deepStrictEqual(validateDoc(store.doc), [], t.id + ' 제품 추가 뒤');
    const mesh = MESH.buildMesh(t.doc, 0); assert.ok(mesh.walls.length >= f.walls.length && mesh.bounds, t.id + ' buildMesh');
    assert.ok(fs.existsSync(path.join(PLAN, 'data/templates.json')));
  }
  // 분포: 평형·형태 필터마다 하나 이상
  for (const s of sizeIds) assert.ok(L.some((t) => t.size === s), s + ' 평형 템플릿');
  for (const l of layoutIds) assert.ok(L.some((t) => t.layout === l), l + ' 형태 템플릿');
  assert.strictEqual(P.filterTemplates(L, { size: 'lt10' }).length, L.filter((t) => t.size === 'lt10').length);
  assert.strictEqual(P.filterTemplates(L, { size: 'p30', layout: '원룸' }).length, 0); assert.strictEqual(P.filterTemplates(L, {}).length, L.length);
  // 생성기와 같은 결과(손으로 고친 흔적·낡은 파일 방지) — PLAN_DIR 을 바꾼 변이 시험에서는 파일이 다르면 여기서 잡힌다
  const gen = require('./build-plan-templates.js');
  assert.strictEqual(read('data/templates.json'), gen.dump(await gen.build()), 'templates.json 이 생성기 결과와 다르다 — node tools/build-plan-templates.js');

  /* ===== 5. 견적 ===== */
  // 손으로 센 도면: 방 4000×3000(안쪽) → 벽 중심선 4150×3150 둘레 14.6m, 문 900·창 1200 → 개구부 제외 12.5m, 넓이 12.00㎡
  const d0 = new S.Store(createDoc('견적, "시험"\n둘째줄'));
  d0.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000], name: '거실' });
  const wl = curFloor(d0.doc).walls;
  d0.exec({ type: 'addOpening', wall: wl[0].id, at: 0.5, kind: 'door' }); d0.exec({ type: 'addOpening', wall: wl[1].id, at: 0.5, kind: 'window' });
  const add = (o) => d0.exec({ type: 'addItem', kind: 'ac', c: [1500, 1500], ...o });
  add({ model: '1way', brand: 'samsung', code: 'AC032CN1PBH1', capacityKw: 3.2, size: [1198, 500] }); add({ model: '1way', brand: 'samsung', code: 'AC032CN1PBH1', capacityKw: 3.2, size: [1198, 500] });
  add({ model: '1way', brand: 'samsung', code: 'AC032CN1PBH1', capacityKw: 3.2, size: [1198, 500] });
  add({ model: '4way', brand: 'lg', code: 'TNW0600B2U', capacityKw: 6, size: [950, 950] });
  add({ model: '360', brand: 'lg', code: 'RNW0720S2S', capacityKw: null, size: [1050, 1050] });
  add({ model: '360', brand: 'lg', code: '', capacityKw: 0.1, size: [1050, 1050] }); add({ model: '360', brand: 'lg', code: '', capacityKw: 0.2, size: [1050, 1050] }); // 0.1+0.2 의 부동소수 잡음
  d0.exec({ type: 'addFloor' });
  d0.exec({ type: 'addRoomRect', a: [0, 0], b: [2000, 2000], name: '다락' });
  d0.exec({ type: 'addOpening', wall: curFloor(d0.doc).walls[2].id, at: 0.5, kind: 'open', width: 800 });
  d0.exec({ type: 'addItem', kind: 'ac', model: 'mini4way', brand: 'samsung', c: [1000, 1000], capacityKw: 5.2, code: 'AC052CNNPBH1', size: [620, 620] });
  const est = E.buildEstimate(d0.doc), t0 = est.totals;
  assert.strictEqual(est.floors.length, 2);
  assert.strictEqual(t0.acCount, 8, '에어컨 수량 3+1+1+1+1+1'); assert.strictEqual(t0.kwSum, 21.1, '확인된 kW 합 9.6+6+0.1+0.2+5.2 (부동소수 잡음 없이)'); assert.strictEqual(t0.kwUnknown, 1, 'kW 미확인 1대');
  const f1r = est.floors[0];
  assert.deepStrictEqual(f1r.ac.map((g) => [g.brand, g.code, g.type, g.capacityKw, g.count, g.kwSum]), [
    ['lg', '', '360', 0.1, 1, 0.1], ['lg', '', '360', 0.2, 1, 0.2], ['lg', 'RNW0720S2S', '360', null, 1, null], ['lg', 'TNW0600B2U', '4way', 6, 1, 6], ['samsung', 'AC032CN1PBH1', '1way', 3.2, 3, 9.6]], '같은 모델·kW 묶음, 미확인은 null');
  assert.strictEqual(f1r.rooms.length, 1); assert.strictEqual(f1r.areaM2, 12); assert.strictEqual(f1r.walls, 4);
  assert.strictEqual(f1r.grossMm, 14600); assert.strictEqual(f1r.netMm, 12500, '개구부 제외');
  assert.deepStrictEqual(f1r.openings, { door: 1, window: 1, open: 0, total: 2 });
  assert.deepStrictEqual(est.floors[1].openings, { door: 0, window: 0, open: 1, total: 1 }); assert.strictEqual(est.floors[1].areaM2, 4);
  assert.strictEqual(est.floors[1].grossMm, 2 * (2150 + 2150)); assert.strictEqual(est.floors[1].netMm, 2 * (2150 + 2150) - 800);
  assert.strictEqual(t0.areaM2, 16); assert.strictEqual(t0.rooms, 2); assert.strictEqual(t0.walls, 8); assert.strictEqual(t0.openings, 3);
  assert.strictEqual(t0.grossMm, 14600 + 8600); assert.strictEqual(t0.netMm, 12500 + 7800);
  assert.strictEqual(E.buildEstimate(createDoc()).totals.acCount, 0); assert.deepStrictEqual(E.buildEstimate(createDoc()).floors[0].ac, []);
  assert.strictEqual(E.buildEstimate(new S.Store(createDoc()).doc).totals.kwSum, 0);
  // kW 가 하나도 없으면 합계는 0 이 아니라 미확인
  const dn = new S.Store(createDoc()); dn.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'lg', c: [0, 0], code: 'R-W0200C2C', capacityKw: null, size: [860, 450] });
  assert.ok(E.toCsv(E.buildEstimate(dn.doc)).includes('합계,,,,,1,미확인'));
  // CSV
  assert.deepStrictEqual(['', null, undefined, 0, 12, 1.5, 'a', 'a,b', 'a"b', 'a\nb', ' a', 'b ', '=1+1', '+1', '-1', '@x', '\tx', 'ok-1'].map(E.csvCell), ['', '', '', '0', '12', '1.5', 'a', '"a,b"', '"a""b"', '"a\nb"', '" a"', '"b "', "'=1+1", "'+1", "'-1", "'@x", "'\tx", 'ok-1']);
  assert.strictEqual(E.csvCell(-5), '-5', '숫자 음수는 그대로'); assert.strictEqual(E.csvLine(['x', 'y,z', 3]), 'x,"y,z",3');
  const csv = E.toCsv(est); assert.ok(csv.endsWith('\r\n') && !csv.startsWith('﻿'));
  const rows = parseCsv(csv);
  assert.deepStrictEqual(rows[0], ['도면', '견적, "시험"\n둘째줄'], '제목의 쉼표·따옴표·줄바꿈이 한 칸으로 돌아온다');
  const at = (h) => rows.findIndex((r) => r.length === 1 && r[0] === h);
  const a0 = at('에어컨'); assert.deepStrictEqual(rows[a0 + 1], ['층', '브랜드', '모델명', '형식', '냉방 kW', '수량', '합계 kW']);
  assert.deepStrictEqual(rows.slice(a0 + 2, a0 + 8), [
    ['Floor 1', 'LG', '미확인', '360', '0.1', '1', '0.1'], ['Floor 1', 'LG', '미확인', '360', '0.2', '1', '0.2'], ['Floor 1', 'LG', 'RNW0720S2S', '360', '미확인', '1', '미확인'],
    ['Floor 1', 'LG', 'TNW0600B2U', '4Way', '6', '1', '6'], ['Floor 1', '삼성', 'AC032CN1PBH1', '1Way', '3.2', '3', '9.6'], ['Floor 2', '삼성', 'AC052CNNPBH1', '미니 4Way', '5.2', '1', '5.2']]);
  assert.deepStrictEqual(rows[a0 + 8], ['합계', '', '', '', '', '8', '21.1']); assert.deepStrictEqual(rows[a0 + 9], ['비고', 'kW 를 확인할 수 없는 1대는 합계 kW 에 들어가지 않습니다']);
  const r0 = at('방'); assert.deepStrictEqual(rows.slice(r0 + 1, r0 + 6), [['층', '방', '실면적 ㎡'], ['Floor 1', '거실', '12.00'], ['Floor 2', '다락', '4.00'], ['합계', '', '16.00'], ['']]); // 빈 줄은 빈 칸 하나
  const w0 = at('벽·개구부'); assert.deepStrictEqual(rows.slice(w0 + 1), [['층', '벽 수', '벽 총 길이 m', '개구부 제외 길이 m', '문', '창', '개방', '개구부 합'], ['Floor 1', '4', '14.60', '12.50', '1', '1', '0', '2'], ['Floor 2', '4', '8.60', '7.80', '0', '0', '1', '1'], ['합계', '8', '23.20', '20.30', '1', '1', '1', '3']]);
  for (const r of rows) for (const c of r) assert.ok(!/^[=+@]/.test(c), '식으로 읽힐 칸 없음: ' + c);
  // 사용자 글이 식으로 시작하는 방 이름·제목
  const dx = new S.Store(createDoc('=HYPERLINK("x")')); dx.exec({ type: 'addRoomRect', a: [0, 0], b: [2000, 2000], name: '-침실, "A"' });
  const rx = parseCsv(E.toCsv(E.buildEstimate(dx.doc)));
  assert.deepStrictEqual(rx[0], ['도면', '\'=HYPERLINK("x")']); assert.ok(rx.some((r) => r[1] === '\'-침실, "A"'), '방 이름의 쉼표·따옴표·앞 기호');
  // 파일 이름
  assert.strictEqual(E.csvFileName('내 집'), 'ain-물량-내 집.csv'); assert.strictEqual(E.csvFileName(''), 'ain-물량-도면.csv'); assert.strictEqual(E.csvFileName('  ..  '), 'ain-물량-도면.csv'); assert.strictEqual(E.csvFileName(null), 'ain-물량-도면.csv');
  assert.strictEqual(E.csvFileName('a/b\\c:d*e?f"g<h>i|j\u0001k'), 'ain-물량-a-b-c-d-e-f-g-h-i-j-k.csv');
  assert.ok(E.csvFileName('가'.repeat(100)).length <= 'ain-물량-.csv'.length + 60); assert.ok(!/[\\/]/.test(E.csvFileName('../../etc/passwd')));
  assert.strictEqual(E.csvFileName('..hidden.'), 'ain-물량-hidden.csv');

  console.log(`test-plan-data: OK (카탈로그 ${models.length}개${csvChecked ? ' CSV 전수 대조' : ' CSV 대조 건너뜀'} · 마감 ${fin.finishes.length}개 · 템플릿 ${L.length}개 · 견적/CSV)`);
})().catch((e) => { console.error(e); process.exit(1); });
