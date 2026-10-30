// 플래너 '가전' 통합 시험 — data/appliance-catalog.json(raw 수집 파일 24개와 전수 대조 — 이중 등재·세트 상품 거르기 포함) · core(kind:'appliance' 검증·되돌리기·반전·회전·hitTest·3D 상자·엔진 JSON 미포함) ·
// 배치 도구(placeItem 가전 경로) · 견적 집계/CSV(손으로 센 값) · 패널 순수 함수(필터·검색·정렬·분류별 개수) · 3D 정점 자료.
// 실행: node tools/test-plan-appliance.js   변이 시험용: PLAN_DIR(plan 폴더 사본)·APPLIANCE_SPECS_DIR(raw 가 든 appliance-specs 폴더) 환경변수
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PLAN = process.env.PLAN_DIR || path.join(__dirname, '..', 'maker/3d/plan');
const SPECS = process.env.APPLIANCE_SPECS_DIR || path.join(os.homedir(), 'repos/personal/hvac3d-lab/appliance-specs');
const imp = (p) => import(pathToFileURL(path.join(PLAN, p)).href);
const read = (p) => fs.readFileSync(path.join(PLAN, p), 'utf8');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);
const KO = /[가-힣]/;
const throwsKo = (fn, re, msg) => assert.throws(fn, (e) => KO.test(e.message) && (!re || re.test(e.message)), msg);

// 독립 CSV 파서(RFC4180 모양) — 견적 CSV 를 칸으로 되돌려 단언한다
function parseCsv(text) {
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

(async () => {
  const [Mo, S, G, X, MESH, E, P, T, V2, L, V3] = await Promise.all([imp('core/model.js'), imp('core/store.js'), imp('core/geom.js'), imp('core/export.js'), imp('core/mesh3d.js'), imp('estimate.js'), imp('panels.js'), imp('tools.js'), imp('view2d.js'), imp('library.js'), imp('view3d.js')]);
  const { Store } = S, { createDoc, validateDoc, curFloor, APPLIANCE_CATEGORIES, APPLIANCE_LABEL, BRANDS } = Mo;

  /* ===== 0. 정적 점검 ===== */
  const SPEC_CATS = ['refrigerator', 'kimchi', 'washer', 'dryer', 'washtower', 'dishwasher', 'styler', 'airpurifier', 'aircon', 'tv', 'cooking', 'water'];
  assert.deepStrictEqual(APPLIANCE_CATEGORIES, SPEC_CATS, '가전 분류 12가지와 순서');
  assert.deepStrictEqual(APPLIANCE_LABEL, { refrigerator: '냉장고', kimchi: '김치냉장고', washer: '세탁기', dryer: '건조기', washtower: '워시타워·워시콤보', dishwasher: '식기세척기', styler: '의류관리기', airpurifier: '공기청정기', aircon: '에어컨', tv: 'TV', cooking: '조리가전', water: '정수기' });
  const code = (f) => read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/target: '_blank', rel: 'noopener noreferrer'/.test(code('panels.js')), '출처 링크는 새 창 + noopener noreferrer');
  assert.ok(/const APP_PAGE = 200;/.test(code('panels.js')), '가전 목록은 한 번에 200개');
  assert.ok(/aria-disabled/.test(code('panels.js')) && /pl-more/.test(code('panels.js')), '놓을 수 없는 카드 aria-disabled · 더 보기');
  assert.ok(/role: 'tabpanel'/.test(code('panels.js')) && /'제품 종류'/.test(code('panels.js')), '두 칸 전환은 tablist');
  assert.ok(/APPLIANCE_LABEL/.test(code('view2d.js')), '2D 는 분류 이름표를 쓴다');
  const css = read('panels.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of ['.pl-seg', '.pl-more', '.pl-src', '.pl-app', '.pl-why']) assert.ok(css.includes(sel), 'panels.css 에 ' + sel);

  /* ===== 1. 카탈로그 ===== */
  const catText = read('data/appliance-catalog.json');
  assert.ok(/^\{\n  "meta"/.test(catText), 'meta 가 파일 맨 앞');
  const cat = JSON.parse(catText), items = cat.items, M = cat.meta;
  const ROW_KEYS = ['id', 'brand', 'category', 'model', 'modelCodes', 'name', 'series', 'capacityText', 'widthMm', 'heightMm', 'depthMm', 'dimsRaw', 'extraDims', 'weightText', 'url', 'collectedAt', 'discontinued', 'discontinuedBasis', 'placeable', 'whyNot'];
  const AX = [['widthMm', '가로'], ['heightMm', '높이'], ['depthMm', '깊이']];
  const okNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 50 && v <= 5000;
  const isSet = (name) => name.replace(/\([^)]*\)/g, '').includes('+') || /\(\s*\d+\s*,\s*\d+\s*\+\s*\d+\s*㎡\s*\)/.test(name);   // 세트 상품 = 괄호 밖 '+' 또는 큐브 공기청정기 2대 조합 표기 '(합계, 모듈+모듈㎡)' (그 밖의 괄호 안 '+' 는 사양 표기: LCD+다이얼)
  const SET_WHY = '세트 상품이라 공식 치수가 본체 한 대분만 적혀 있어 놓지 않습니다 · 구성품을 따로 놓아 주세요';
  const wantPlaceable = (r) => AX.every(([k]) => okNum(r[k])) && !isSet(r.name);
  const RAW_ROWS = 2028, DEDUP_PAIRS = 19, ROWS = RAW_ROWS - DEDUP_PAIRS;   // 이중 등재 19쌍(삼성 세탁기·워시타워)을 걸러낸 행 수
  assert.strictEqual(items.length, ROWS, '행 수 합계(raw 를 새로 받으면 의도한 변경인지 보고 고친다)');
  assert.strictEqual(M.counts.rows, items.length); assert.strictEqual(M.counts.rawRows, RAW_ROWS);
  const byCat = Object.fromEntries(SPEC_CATS.map((c) => [c, items.filter((r) => r.category === c).length]));
  assert.strictEqual(Object.values(byCat).reduce((a, b) => a + b, 0), ROWS, '분류별 행 수 합');
  for (const c of SPEC_CATS) { assert.ok(byCat[c] > 0, c + ' 행 있음'); assert.strictEqual(M.counts.byCategory[c].total, byCat[c], c + ' meta 개수'); for (const b of BRANDS) assert.strictEqual(M.counts.byCategory[c][b], items.filter((r) => r.category === c && r.brand === b).length, `${c} ${b}`); }
  assert.deepStrictEqual(M.categories.map((c) => c.id), SPEC_CATS, 'meta 분류 순서');
  for (const c of M.categories) { assert.strictEqual(c.short, APPLIANCE_LABEL[c.id], c.id + ' 짧은 이름이 코드와 같다'); assert.ok(c.name.startsWith(c.short), c.id); }
  assert.strictEqual(M.categories.find((c) => c.id === 'aircon').name, '에어컨(스탠드·벽걸이·창문형·이동식)');
  assert.strictEqual(M.categories.find((c) => c.id === 'washtower').name, '워시타워·워시콤보');
  assert.strictEqual(M.collectedAt, '2026-10-30'); assert.deepStrictEqual(M.sourceSites, { samsung: 'https://www.samsung.com/sec/', lg: 'https://www.lge.co.kr/' });
  const ids = items.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'id 유일');
  let np = 0;
  for (const r of items) {
    assert.deepStrictEqual(Object.keys(r), ROW_KEYS, r.id + ' 칸 구성·순서(notes 는 뺐다)');
    assert.strictEqual(r.id, `${r.brand}-${r.category}-${r.model}`, '안정 id');
    assert.ok(BRANDS.includes(r.brand) && SPEC_CATS.includes(r.category), r.id);
    for (const [k] of AX) assert.ok(r[k] === null || (typeof r[k] === 'number' && Number.isFinite(r[k])), `${r.id} ${k} 숫자 또는 null`);
    assert.strictEqual(r.placeable, wantPlaceable(r), `${r.id} placeable 규칙(가로·높이·깊이 모두 유한한 양수이고 50~5000)`);
    if (r.placeable) assert.strictEqual(r.whyNot, null, r.id + ' 놓을 수 있으면 whyNot 없음');
    else if (AX.every(([k]) => okNum(r[k]))) { np++; assert.ok(isSet(r.name), r.id + ' 치수가 되는데 못 놓는 행은 세트 상품뿐'); assert.strictEqual(r.whyNot, SET_WHY, r.id + ' 세트 상품 이유 문구'); }
    else {
      np++;
      assert.ok(typeof r.whyNot === 'string' && KO.test(r.whyNot) && !/\n/.test(r.whyNot), `${r.id} whyNot 한국어 한 줄`);
      const nulls = AX.filter(([k]) => r[k] === null).map(([, n]) => n);
      if (nulls.length) for (const n of nulls) assert.ok(r.whyNot.includes(n) || r.whyNot.includes('치수 미확인'), `${r.id} whyNot 이 비어 있는 축(${n})을 말한다`);
      else for (const [k, n] of AX) if (!okNum(r[k])) assert.ok(r.whyNot.includes(`${n} ${r[k]} mm`) && r.whyNot.includes('50~5000'), `${r.id} whyNot 이 범위 밖 값을 그대로 말한다`);
      if (r.dimsRaw === null) assert.ok(r.whyNot.startsWith('치수 미확인'), r.id);
    }
    assert.ok(/^https:\/\/(www\.samsung\.com|www\.lge\.co\.kr|www\.lge\.com)\//.test(r.url), `${r.id} 출처는 삼성·LG 공식 도메인`);
    assert.ok((r.brand === 'samsung') === /samsung\.com/.test(r.url), `${r.id} 브랜드와 출처 도메인이 맞다`);
    assert.strictEqual(r.collectedAt, M.collectedAt); assert.ok(r.discontinued === true || r.discontinued === false || r.discontinued === null, r.id + ' discontinued 는 true/false/null');
    assert.ok(r.discontinuedBasis === null || (typeof r.discontinuedBasis === 'string' && r.discontinuedBasis.length > 0), r.id + ' discontinuedBasis 는 글자 또는 null');
    if (r.discontinued === null) assert.ok(/판정 불가/.test(r.discontinuedBasis), r.id + ' 단종 판정 불가 이유가 행에 있다');
    if (r.brand === 'lg') assert.strictEqual(r.discontinuedBasis, null, r.id + ' LG raw 에는 행별 기준 칸이 없다');
    else assert.ok(typeof r.discontinuedBasis === 'string', r.id + ' 삼성 행은 단종 기준을 적는다');
    if (r.brand === 'lg') assert.ok(typeof r.discontinued === 'boolean', r.id + ' LG 는 판정 불가 없음'); assert.ok(Array.isArray(r.modelCodes) && (r.modelCodes.includes(r.model) || r.modelCodes.some((c) => r.model.startsWith(c + '.'))), r.id + ' 모델 코드 목록에 대표 모델이 있다(같은 코드의 판매 접미 구분 .BKOR 은 코드 + 점)');
    assert.ok(Array.isArray(r.extraDims) && typeof r.name === 'string' && r.name.length > 0 && typeof r.model === 'string' && r.model.length > 0, r.id);
  }
  assert.strictEqual(M.counts.placeable + M.counts.notPlaceable, items.length); assert.strictEqual(M.counts.notPlaceable, np); assert.strictEqual(M.counts.placeable, items.filter((r) => r.placeable).length);
  assert.ok(np > 0 && np < items.length * 0.2, `놓을 수 없는 행 ${np}`);
  { const sets = items.filter((r) => isSet(r.name));                      // 세트 상품 규칙: 이름 기준 한 가지, 치수 이유가 있으면 그것이 먼저
    assert.ok(sets.length > 0 && sets.every((r) => !r.placeable), '괄호 밖 + 가 있는 행은 모두 놓을 수 없다');
    assert.ok(items.every((r) => isSet(r.name) || r.placeable === AX.every(([k]) => okNum(r[k]))), '세트가 아닌 행은 이 규칙으로 바뀌지 않는다(치수 규칙 그대로)');
    assert.ok(items.some((r) => r.name.includes('+') && !isSet(r.name) && r.placeable && /LCD\+다이얼/.test(r.name)), '괄호 안 + (LCD+다이얼) 는 사양 표기라 놓을 수 있다');
    const cubes = items.filter((r) => r.category === 'airpurifier' && /\(\s*\d+\s*,\s*\d+\s*\+\s*\d+\s*㎡\s*\)/.test(r.name));
    assert.ok(cubes.length >= 15 && cubes.every((r) => !r.placeable && r.whyNot === SET_WHY), '큐브 공기청정기 2대 조합(106·123·94㎡ 등)은 한 대분 치수라 놓지 않는다: ' + cubes.length + '행');
    assert.ok(items.some((r) => r.category === 'airpurifier' && /큐브/.test(r.name) && !/\+/.test(r.name) && r.placeable), '큐브 단품(한 대)은 놓을 수 있다');
    for (const m of ['FH25GSGX', 'FH25ESEF', 'FH11EAX']) assert.ok(items.some((r) => r.model === m && r.category === 'washtower' && r.whyNot === SET_WHY), '워시콤보 세트 ' + m);
    assert.ok(['RG19ENX-AKOR2', 'RG20VNF', 'RD20GNG-KG'].every((m) => items.some((r) => r.model === m && r.category === 'dryer' && r.whyNot === SET_WHY)), '건조기 세트 · 스태킹키트');
    assert.strictEqual(M.sets.rows, sets.length); assert.deepStrictEqual(M.sets.byCategory, Object.fromEntries(SPEC_CATS.filter((c) => sets.some((r) => r.category === c)).map((c) => [c, sets.filter((r) => r.category === c).length])));
    assert.strictEqual(M.counts.notPlaceableBy['세트 상품'], items.filter((r) => r.whyNot === SET_WHY).length); }
  assert.ok(items.some((r) => !r.placeable && /후면핸들/.test(r.whyNot)) && items.some((r) => !r.placeable && r.whyNot.startsWith('치수 미확인')), '후면핸들 포함·미포함 / 치수 미확인 이유');
  { const dc = (b, v) => items.filter((r) => (!b || r.brand === b) && r.discontinued === v).length;   // 단종 true/false/null 브랜드별
    for (const [b, k] of [['samsung', 'samsung'], ['lg', 'lg'], [null, 'total']]) assert.deepStrictEqual(M.counts.discontinued[k], { true: dc(b, true), false: dc(b, false), null: dc(b, null) }, '단종 수 ' + k);
    assert.ok(/상품 정보 확인만 가능/.test(M.discontinuedBasis.samsung) && /판정 불가/.test(M.discontinuedBasis.samsung), '삼성 단종 기준 표기');
    assert.ok(/단종 제품입니다/.test(M.discontinuedBasis.lg) && /색상 옵션 한 곳만/.test(M.discontinuedBasis.lg), 'LG 단종 기준 표기');
    assert.ok(M.counts.discontinued.samsung.null > 0 && M.counts.discontinued.lg.null === 0, '삼성에만 판정 불가가 있다'); }
  // meta: 파일별 수치·한계
  assert.strictEqual(Object.keys(M.files).length, 24, '파일 24개');
  for (const b of BRANDS) for (const c of SPEC_CATS) {
    const f = M.files[`${b}-${c}.json`];
    assert.ok(f, `${b}-${c} meta`); assert.strictEqual(f.rowsInCatalog, items.filter((r) => r.brand === b && r.category === c).length, `${b}-${c} 카탈로그 행 수`); assert.ok(f.rowsInCatalog <= f.rows && f.rows <= M.rowCap.perFile, `${b}-${c} 행 수는 raw 이하·상한 이하`);
    assert.ok(/^[0-9a-f]{64}$/.test(f.sha256) && f.collectedAt === M.collectedAt && Number.isInteger(f.skipped) && Number.isInteger(f.verifyLog), `${b}-${c} 형식`);
    assert.ok(typeof f.coverage === 'string' && f.coverage.length > 50 && typeof f.labelConvention === 'string' && f.labelConvention.length > 50, `${b}-${c} 한계(coverage·labelConvention)를 옮겼다`);
  }
  assert.ok(Array.isArray(M.limits) && M.limits.length >= 6 && M.limits.some((l) => /후면핸들/.test(l)) && M.limits.some((l) => /스탠드 포함/.test(l)) && M.limits.some((l) => /번들/.test(l)), '한계 요약(번들·후면핸들·TV 스탠드)');
  assert.ok(/각각 50~5000 mm/.test(M.placeable) && /widthMm=가로, heightMm=세로\(높이\), depthMm=깊이/.test(M.dims));
  assert.ok(catText.length < 2.0e6, `카탈로그 크기 ${catText.length}`);
  assert.ok(/각각 50~5000 mm/.test(M.placeable) && /세트 상품이 아니면 true/.test(M.placeable), 'placeable 설명에 세트 상품');

  // 1-a. raw 수집 파일 24개와 전수 대조 (독립 구현: 파이썬 생성기와 다른 코드)
  let rawChecked = false;
  const rawDir = path.join(SPECS, 'raw');
  if (fs.existsSync(path.join(rawDir, 'samsung-refrigerator.json'))) {
    rawChecked = true;
    const BRAND_OF = { 삼성전자: 'samsung', samsung: 'samsung', LG전자: 'lg', lg: 'lg' }; let want = []; const capSkips = {};
    for (const c of SPEC_CATS) for (const b of BRANDS) {
      const fname = `${b}-${c}.json`, buf = fs.readFileSync(path.join(rawDir, fname)), raw = JSON.parse(buf.toString('utf8'));
      assert.strictEqual(crypto.createHash('sha256').update(buf).digest('hex'), M.files[fname].sha256, `${fname} 이 카탈로그를 만든 뒤 바뀌었다 — python3 tools/build-appliance-catalog.py 를 다시 돌린다`);
      assert.strictEqual(BRAND_OF[raw.brand], b, fname + ' brand'); assert.strictEqual(raw.category, c);
      assert.strictEqual(M.files[fname].rows, raw.items.length); assert.strictEqual(M.files[fname].skipped, raw.skipped.length); assert.strictEqual(M.files[fname].verifyLog, raw.verifyLog.length);
      capSkips[fname] = raw.skipped.filter((x) => x.reason.includes('상한')).length; assert.strictEqual(M.files[fname].skippedByRowCap, capSkips[fname], fname + ' 상한 때문에 뺀 수');
      assert.strictEqual(M.files[fname].coverage, raw.meta.coverage, fname + ' coverage 원문 그대로'); assert.strictEqual(M.files[fname].labelConvention, raw.meta.labelConvention, fname + ' labelConvention 원문 그대로');
      for (const k of Object.keys(raw.meta)) if (!['method', 'installTexts'].includes(k)) assert.deepStrictEqual(M.files[fname][k], raw.meta[k], `${fname} meta.${k}`);
      for (const it of raw.items) want.push({ b, c, it });
    }
    assert.strictEqual(want.length, RAW_ROWS, 'raw 행 수 합계(걸러내기 전)');
    // 이중 등재: 같은 (브랜드, 모델, 주소) 가 여러 분류에 있으면 워시타워·워시콤보 분류만 남는다(독립 구현)
    { const grp = new Map(); for (const w of want) { const k = [w.b, w.it.model, w.it.url].join('|'); (grp.get(k) || grp.set(k, []).get(k)).push(w); }
      const drop = new Set(), pairs = [];
      for (const g of grp.values()) if (g.length > 1) {
        assert.deepStrictEqual(g.map((w) => w.c).sort(), ['washer', 'washtower'], '이중 등재는 세탁기·워시타워 두 분류뿐: ' + g[0].it.model);
        const gone = g.find((w) => w.c === 'washer'); drop.add(gone); pairs.push({ brand: gone.b, model: gone.it.model, kept: 'washtower', dropped: ['washer'] });
      }
      want = want.filter((w) => !drop.has(w));
      const diffUrl = new Map(); for (const w of want) { const k = w.b + '|' + w.it.model; diffUrl.set(k, (diffUrl.get(k) || 0) + 1); }
      assert.deepStrictEqual([...diffUrl.values()].filter((n) => n > 1), [], '걸러낸 뒤 같은 (브랜드, 모델) 이 둘 이상 남지 않는다(주소가 다른 경우도 지금 raw 에는 없다)');
      assert.strictEqual(pairs.length, DEDUP_PAIRS, '이중 등재 19쌍');
      assert.deepStrictEqual(M.dedup.list, pairs, 'meta.dedup 목록 = 독립 계산(세탁기 쪽 raw 순서)');
      assert.deepStrictEqual([M.dedup.pairs, M.dedup.keptCategory, M.dedup.droppedCategory, M.dedup.sameModelDifferentUrl, M.dedup.priority], [19, { washtower: 19 }, { washer: 19 }, [], ['washtower', 'washer']], 'meta.dedup 요약');
      assert.ok(/워시타워·워시콤보 분류를 세탁기 분류보다 우선/.test(M.dedup.rule));
      for (const p of pairs) { assert.ok(items.some((r) => r.id === `${p.brand}-washtower-${p.model}`), p.model + ' 워시타워 쪽이 남는다'); assert.ok(!items.some((r) => r.id === `${p.brand}-washer-${p.model}`), p.model + ' 세탁기 쪽은 없다'); } }
    assert.deepStrictEqual(M.rowCap, { perFile: 250, reached: Object.entries(M.files).filter(([, f]) => f.rows === 250).map(([file, f]) => ({ file, rows: f.rows })), skippedByCap: Object.entries(capSkips).filter(([, n]) => n > 0).map(([file, skipped]) => ({ file, skipped })) }, 'meta.rowCap = 파일별 수치');
    assert.deepStrictEqual(M.rowCap.reached.map((x) => x.file).sort(), ['lg-aircon.json', 'samsung-refrigerator.json', 'samsung-tv.json'], '상한 250 에 닿은 파일 셋');
    assert.strictEqual(items.length, want.length, '걸러낸 raw 행 수 = 카탈로그 행 수');
    assert.deepStrictEqual(ids, want.map(({ b, c, it }) => `${b}-${c}-${it.model}`), '행 순서·구성(분류 순서 → 삼성·LG → raw 순서, 이중 등재 걸러냄)');
    items.forEach((r, i) => {
      const { b, c, it } = want[i];
      assert.strictEqual(r.brand, b); assert.strictEqual(r.category, c);
      for (const k of ['model', 'name', 'series', 'capacityText', 'dimsRaw', 'weightText', 'url', 'collectedAt', 'discontinued']) assert.strictEqual(r[k], it[k], `${r.id} ${k} 가 raw 와 같다`);
      assert.strictEqual(r.discontinuedBasis, it.discontinuedBasis ?? null, r.id + ' discontinuedBasis 가 raw 와 같다(없으면 null)');
      for (const k of ['widthMm', 'heightMm', 'depthMm']) assert.strictEqual(r[k], it[k], `${r.id} ${k} 가 raw 와 같다(채우거나 바꾼 값 없음)`);
      assert.deepStrictEqual(r.modelCodes, it.modelCodes, r.id + ' modelCodes'); assert.deepStrictEqual(r.extraDims, it.extraDims, r.id + ' extraDims');
      assert.ok(!('notes' in r), r.id + ' notes 전문은 뺀다');
    });
  } else console.warn(`SKIP raw 폴더가 없어 전수 대조를 건너뜀: ${rawDir}`);

  // 1-b. 놓을 수 있는 행은 전부 core 가 받고, 놓을 수 없는 행은 놓을 값이 없다
  const big = new Store(createDoc()); big.exec({ type: 'addRoomRect', a: [0, 0], b: [20000, 20000] });
  let accepted = 0;
  for (const r of items) {
    const o = P.applianceOpts(r);
    if (!r.placeable) { assert.strictEqual(o, null, r.id + ' 놓을 수 없으면 payload 없음'); continue; }
    assert.deepStrictEqual(o, { kind: 'appliance', category: r.category, brand: r.brand, model: r.model, name: r.name, code: r.model, size: [r.widthMm, r.depthMm], heightMm: r.heightMm, url: r.url }, r.id + ' payload = 가로·깊이 / 높이 / 출처');
    big.exec({ type: 'addItem', c: [1000, 1000], ...o }); accepted++;
  }
  assert.strictEqual(accepted, M.counts.placeable); assert.strictEqual(curFloor(big.doc).items.length, accepted, '놓을 수 있는 행 전부 addItem 이 받는다');
  assert.deepStrictEqual(validateDoc(big.doc), []);
  const sample = items.find((r) => r.id === 'samsung-refrigerator-RM90H64P2W'); // 예: 삼성 냉장고 가로 912 · 깊이 683 · 높이 1853 (원문 그대로)
  assert.deepStrictEqual([sample.widthMm, sample.depthMm, sample.heightMm, sample.placeable], [912, 683, 1853, true]);

  /* ===== 2. core: kind:'appliance' ===== */
  const FR = { kind: 'appliance', category: 'refrigerator', brand: 'samsung', model: 'RM90H64P2W', name: '냉장고 시험', size: [912, 683], heightMm: 1853, url: 'https://www.samsung.com/sec/x/' };
  const mk = () => { const s = new Store(createDoc('가전 시험')); s.exec({ type: 'addRoomRect', a: [0, 0], b: [6000, 5000], name: '거실' }); return s; };
  const st = mk(), fl = () => curFloor(st.doc);
  assert.deepStrictEqual(st.exec({ type: 'addItem', c: [1500, 1500], ...FR }), ['I1']);
  assert.deepStrictEqual(fl().items[0], { id: 'I1', kind: 'appliance', category: 'refrigerator', brand: 'samsung', model: 'RM90H64P2W', name: '냉장고 시험', c: [1500, 1500], rot: 0, size: [912, 683], heightMm: 1853, code: 'RM90H64P2W', url: 'https://www.samsung.com/sec/x/' });
  assert.deepStrictEqual(validateDoc(st.doc), []);
  // 제원 없이는 놓지 않는다 / 잘못된 값은 한국어로 거절
  const bad = (patch, re, msg) => throwsKo(() => mk().exec({ type: 'addItem', c: [1500, 1500], ...FR, ...patch }), re, msg);
  bad({ size: undefined }, /크기/, '크기 없이'); bad({ heightMm: undefined }, /높이/, '높이 없이'); bad({ size: [912] }, /크기/); bad({ size: [0, 683] }, /크기/); bad({ heightMm: 0 }, /높이/); bad({ heightMm: NaN }, /높이/);
  bad({ size: [49, 683] }, /50~5000/, '가로 49'); bad({ size: [912, 5001] }, /50~5000/, '깊이 5001'); bad({ heightMm: 49 }, /50~4000/, '높이 49'); bad({ heightMm: 4001 }, /50~4000/, '높이 4001');
  bad({ category: 'sofa' }, /분류/); bad({ category: undefined }, /분류/); bad({ brand: 'x' }, /브랜드/); bad({ model: '' }, /모델/); bad({ url: 'http://www.samsung.com/x' }, /https/); bad({ url: 'javascript:alert(1)' }, /https/); bad({ url: 5 }, /https/);
  throwsKo(() => mk().exec({ type: 'addItem', kind: 'appliance', category: 'tv', brand: 'lg', model: 'X', size: [900, 100], heightMm: 600 }), /위치/, '위치 없이');
  { const s = mk();                                                       // 경계값은 받는다
    s.exec({ type: 'addItem', c: [1000, 1000], ...FR, size: [50, 5000], heightMm: 50 }); s.exec({ type: 'addItem', c: [2000, 1000], ...FR, size: [5000, 50], heightMm: 4000 });
    assert.deepStrictEqual(curFloor(s.doc).items.map((i) => [i.size, i.heightMm]), [[[50, 5000], 50], [[5000, 50], 4000]]);
    const t = mk(); t.exec({ type: 'addItem', c: [1000, 1000], kind: 'appliance', category: 'tv', brand: 'lg', model: 'M1', size: [1000, 100], heightMm: 700 });
    assert.deepStrictEqual([curFloor(t.doc).items[0].name, curFloor(t.doc).items[0].code, 'url' in curFloor(t.doc).items[0]], ['', 'M1', false], '이름·출처는 선택, 코드는 모델명'); }
  // 하위 호환: 시스템에어컨만 있는 문서
  { const s = mk(); s.exec({ type: 'addItem', kind: 'ac', model: '4way', brand: 'lg', c: [3000, 2000], size: [950, 950], capacityKw: 6, code: 'TNW0600B2U' });
    assert.deepStrictEqual(validateDoc(s.doc), []); assert.deepStrictEqual(curFloor(s.doc).items[0], { id: 'I1', kind: 'ac', model: '4way', brand: 'lg', c: [3000, 2000], rot: 0, capacityKw: 6, code: 'TNW0600B2U', size: [950, 950] }); }
  // validateDoc / update 가 가전을 검사한다
  const mutate = (fn) => { const d = JSON.parse(JSON.stringify(st.doc)); fn(curFloor(d).items[0]); return validateDoc(d); };
  assert.ok(mutate((i) => { i.size = [10, 10]; }).some((m) => /가전 크기/.test(m)), 'validateDoc 크기'); assert.ok(mutate((i) => { delete i.heightMm; }).some((m) => /가전 높이/.test(m)), 'validateDoc 높이');
  assert.ok(mutate((i) => { i.category = 'x'; }).some((m) => /분류/.test(m))); assert.ok(mutate((i) => { i.brand = 'x'; }).some((m) => /브랜드/.test(m))); assert.ok(mutate((i) => { i.kind = 'light'; }).some((m) => /제품 종류/.test(m)));
  assert.ok(mutate((i) => { i.url = 'javascript:alert(1)'; }).some((m) => /https/.test(m)), '불러온 도면 파일의 위험한 주소를 거른다'); assert.ok(mutate((i) => { i.rot = 'a'; }).length > 0); assert.ok(mutate((i) => { i.c = [0, 1e300]; }).length > 0);
  assert.throws(() => X.fromDocJSON(JSON.stringify(JSON.parse(JSON.stringify(st.doc), (k, v) => (k === 'heightMm' ? 0 : v)))), /도면 파일을 읽지 못했습니다/);
  throwsKo(() => st.exec({ type: 'update', id: 'I1', patch: { size: [10, 10] } }), /가전 크기/); throwsKo(() => st.exec({ type: 'update', id: 'I1', patch: { heightMm: 9999 } }), /가전 높이/);
  throwsKo(() => st.exec({ type: 'update', id: 'I1', patch: { kind: 'ac' } }), /형식/, '가전을 에어컨으로 바꿔치기 못 한다');
  assert.deepStrictEqual(fl().items[0].size, [912, 683], '거절된 update 는 문서를 건드리지 않는다');
  assert.deepStrictEqual(st.exec({ type: 'update', id: 'I1', patch: { rot: 90 } }), ['I1']); assert.strictEqual(fl().items[0].rot, 90);
  // 되돌리기·다시 실행
  assert.strictEqual(st.undo(), true); assert.strictEqual(fl().items[0].rot, 0); assert.strictEqual(st.undo(), true); assert.strictEqual(fl().items.length, 0, '놓기 되돌리기');
  assert.strictEqual(st.redo(), true); assert.strictEqual(fl().items.length, 1); assert.strictEqual(st.redo(), true); assert.strictEqual(fl().items[0].rot, 90, '다시 실행'); st.exec({ type: 'update', id: 'I1', patch: { rot: 0 } });
  // 이동·회전·반전 (방 안쪽 0~6000 × 0~5000, 벽 두께 150 → 경계 상자 -150~6150 × -150~5150)
  st.exec({ type: 'move', ids: ['I1'], dx: 100, dy: -50 }); assert.deepStrictEqual(fl().items[0].c, [1600, 1450], '이동'); st.exec({ type: 'move', ids: ['I1'], dx: -100, dy: 50 });
  { const b = G.bounds(st.doc); assert.deepStrictEqual([b.x0, b.y0, b.x1, b.y1], [-150, -150, 6150, 5150], '경계 상자(가전은 안쪽)'); }
  st.exec({ type: 'rotate', deg: 90 }); assert.deepStrictEqual([fl().items[0].c, fl().items[0].rot], [[4000, 1000], 90], '시계 회전: 위치와 각도'); st.exec({ type: 'rotate', deg: -90 }); assert.deepStrictEqual([fl().items[0].c, fl().items[0].rot], [[1500, 1500], 0], '반시계로 되돌림');
  st.exec({ type: 'mirror', axis: 'x' }); assert.deepStrictEqual([fl().items[0].c, fl().items[0].rot], [[4500, 1500], 180], '좌우 반전'); st.exec({ type: 'mirror', axis: 'x' }); assert.deepStrictEqual([fl().items[0].c, fl().items[0].rot], [[1500, 1500], 0], '다시 반전하면 제자리');
  st.exec({ type: 'mirror', axis: 'y' }); assert.deepStrictEqual([fl().items[0].c, fl().items[0].rot], [[1500, 3500], 0], '상하 반전'); st.exec({ type: 'mirror', axis: 'y' });
  assert.deepStrictEqual(validateDoc(st.doc), []);
  // hitTest: 가로 912 × 깊이 683 상자, 회전 반영. 제품이 방보다 먼저 잡힌다
  assert.deepStrictEqual(G.hitTest(st.doc, [1500 + 450, 1500], 0), { kind: 'item', id: 'I1' }, '가로 끝 안'); assert.strictEqual(G.hitTest(st.doc, [1500 + 460, 1500], 0).kind, 'room', '가로 끝 밖(456 넘음)');
  assert.deepStrictEqual(G.hitTest(st.doc, [1500, 1500 + 340], 0), { kind: 'item', id: 'I1' }, '깊이 끝 안'); assert.strictEqual(G.hitTest(st.doc, [1500, 1500 + 345], 0).kind, 'room', '깊이 끝 밖(341.5 넘음)');
  st.exec({ type: 'update', id: 'I1', patch: { rot: 90 } });
  assert.strictEqual(G.hitTest(st.doc, [1500 + 400, 1500], 0).kind, 'room', '90° 돌리면 가로 쪽이 줄어든다'); assert.deepStrictEqual(G.hitTest(st.doc, [1500, 1500 + 450], 0), { kind: 'item', id: 'I1' }, '90° 돌리면 세로 쪽이 늘어난다');
  st.exec({ type: 'update', id: 'I1', patch: { rot: 0 } });
  // 3D 조각: 바닥(z0=0)에서 heightMm 까지의 상자
  { const m = MESH.buildMesh(st.doc), it = m.items[0], xs = it.poly.map((p) => p[0]), ys = it.poly.map((p) => p[1]);
    assert.deepStrictEqual([it.kind, it.z0, it.z1, it.heightMm, it.category, it.model], ['appliance', 0, 1853, 1853, 'refrigerator', 'RM90H64P2W']); assert.ok(!('mountZ' in it) && !('bodyH' in it), '천장 매다는 값이 없다');
    near(Math.min(...xs), 1044, 1e-9, '가로 912 → 1044~1956'); near(Math.max(...xs), 1956, 1e-9); near(Math.min(...ys), 1158.5, 1e-9, '깊이 683 → 1158.5~1841.5'); near(Math.max(...ys), 1841.5, 1e-9);
    st.exec({ type: 'update', id: 'I1', patch: { rot: 90 } }); const r = MESH.buildMesh(st.doc).items[0].poly, rx = r.map((p) => p[0]), ry = r.map((p) => p[1]);
    near(Math.max(...rx) - Math.min(...rx), 683, 1e-6, '90° 돌리면 가로폭이 깊이가 된다'); near(Math.max(...ry) - Math.min(...ry), 912, 1e-6); st.exec({ type: 'update', id: 'I1', patch: { rot: 0 } });
    assert.strictEqual(m.bounds.z1, 2300, '층고가 더 크면 층고'); const tall = mk(); tall.exec({ type: 'addItem', c: [1500, 1500], ...FR, heightMm: 3500 }); assert.strictEqual(MESH.buildMesh(tall.doc).bounds.z1, 3500, '층고보다 큰 가전은 상자를 높인다'); }
  // 에어컨과 섞인 문서: 3D 조각·엔진 JSON·목록 수치
  const mixed = mk();
  mixed.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'samsung', c: [3000, 2000], size: [1198, 500], capacityKw: 3.2, code: 'AC032CN1PBH1' });
  const spaceBefore = JSON.parse(JSON.stringify(X.toSpaceJSON(mixed.doc, 0)));
  mixed.exec({ type: 'addItem', c: [1500, 1500], ...FR }); mixed.exec({ type: 'addItem', c: [4500, 1500], kind: 'appliance', category: 'tv', brand: 'lg', model: 'OLED65C6', name: 'TV', size: [1441, 263], heightMm: 865 });
  { const m = MESH.buildMesh(mixed.doc); assert.deepStrictEqual(m.items.map((i) => [i.id, i.kind, i.z0, i.z1]), [['I1', 'ac', 2265, 2300], ['I2', 'appliance', 0, 1853], ['I3', 'appliance', 0, 865]], '에어컨은 천장 아래, 가전은 바닥에서'); assert.strictEqual(m.items[0].mountZ, 2300); }
  const spaceAfter = X.toSpaceJSON(mixed.doc, 0);
  assert.deepStrictEqual(spaceAfter, spaceBefore, '엔진 공간 JSON 은 가전을 더해도 그대로다(스키마에 없다)');
  assert.strictEqual(spaceAfter.ac_units.length, 1); assert.strictEqual(spaceAfter.ac_units[0].model_code, 'AC032CN1PBH1');
  assert.ok(!/RM90H64P2W|OLED65C6|appliance|refrigerator/.test(JSON.stringify(spaceAfter)), '엔진 JSON 에 가전이 없다');
  // 문서 JSON 왕복·목록 수치
  assert.deepStrictEqual(X.fromDocJSON(X.toDocJSON(mixed.doc)).floors, JSON.parse(JSON.stringify(mixed.doc.floors)), '문서 JSON 왕복');
  assert.deepStrictEqual(L.summarize(mixed.doc), { floors: 1, rooms: 1, areaM2: 30, ac: 1 }, '목록의 에어컨 수는 가전을 세지 않는다');
  { const b = new Store(mixed.doc); b.exec({ type: 'remove', ids: ['I2'] }); assert.deepStrictEqual(curFloor(b.doc).items.map((i) => i.id), ['I1', 'I3'], '삭제'); b.undo(); assert.strictEqual(curFloor(b.doc).items.length, 3, '삭제 되돌리기'); }
  // 방을 지우면 가전은 남는다(기존 ac 와 같은 길)
  { const b = new Store(mixed.doc); b.exec({ type: 'remove', ids: ['R1'] }); assert.strictEqual(curFloor(b.doc).items.length, 3); }

  /* ===== 3. 배치 도구: placeItem 가전 경로 (가짜 캔버스, px → mm 는 ×10, 스냅 50mm) ===== */
  const mkTools = (over = {}) => {
    const store = mk(), vp0 = { scale: 0.1, ox: 0, oy: 0, w: 800, h: 600 }, state = { locked: false, multi: false, touch: false, ...over }, log = { toasts: [], said: [] };
    const view = { vp: vp0, hover: null, underlayTemp: null, toMm: (p) => V2.toMm(vp0, p), toPx: (p) => V2.toPx(vp0, p), requestDraw() {}, panBy() {}, set() {} };
    let tools; const sel = new T.Selection();
    const ui = { toast: (m) => log.toasts.push(m), say: (m) => log.said.push(m), cursor() {}, hint() {}, setTool: (n, o) => tools.setTool(n, o), renameRoom() {}, calibrated() {} };
    tools = T.createTools({ store, view, sel, ui, state });
    const canvas = { l: {}, addEventListener(t, f) { (this.l[t] ||= []).push(f); }, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {}, focus() {} };
    tools.attach(canvas);
    const fire = (type, x, y) => (canvas.l[type] || []).forEach((f) => f({ type, pointerId: 1, pointerType: 'mouse', button: 0, shiftKey: false, clientX: x, clientY: y, preventDefault() {} }));
    return { store, tools, state, log, flr: () => curFloor(store.doc), tap(x, y) { fire('pointerdown', x, y); fire('pointerup', x, y); } };
  };
  { const t = mkTools(), o = P.applianceOpts(sample);
    assert.strictEqual(t.tools.setTool('placeItem', o), true); t.tap(200, 200);
    assert.deepStrictEqual(t.flr().items[0], { id: 'I1', kind: 'appliance', category: 'refrigerator', brand: 'samsung', model: 'RM90H64P2W', name: sample.name, c: [2000, 2000], rot: 0, size: [912, 683], heightMm: 1853, code: 'RM90H64P2W', url: sample.url }, '카드 payload 가 그대로 놓인다(공식 제원의 크기·높이)');
    assert.deepStrictEqual(t.log.said, ['RM90H64P2W 을 놓았습니다']);
    t.tap(200, 200); t.tap(200, 200); assert.strictEqual(t.flr().items.length, 1, '같은 자리 연타는 한 대');
    t.tap(300, 200); assert.strictEqual(t.flr().items.length, 2, '다른 자리는 놓인다'); assert.strictEqual(t.tools.tool, 'placeItem', '놓은 뒤에도 도구가 이어진다(ESC 로 끝낸다)');
    t.tap(900, 200); assert.strictEqual(t.flr().items.length, 2, '방 밖은 놓이지 않는다'); assert.strictEqual(t.log.toasts.at(-1), '방 안에서 놓아 주세요');
    t.tools.escape(); assert.strictEqual(t.tools.tool, 'select', 'ESC 로 끝');
    t.store.undo(); assert.strictEqual(t.flr().items.length, 1, '놓기 되돌리기'); }
  { const t = mkTools(), o = P.applianceOpts(sample);                    // 회전: 옵션 rot 와 [ ] 키
    t.tools.setTool('placeItem', { ...o, rot: 90 }); t.tap(200, 200); assert.strictEqual(t.flr().items[0].rot, 90);
    globalThis.document = { body: {} };
    try { t.tools.setTool('placeItem', o); assert.strictEqual(t.tools.key({ key: ']', code: 'BracketRight', target: {} }), true); t.tap(300, 200); t.tools.key({ key: ']', code: 'BracketRight', target: {} }); t.tap(400, 200); t.tools.key({ key: '[', code: 'BracketLeft', target: {} }); t.tap(500, 200); }
    finally { delete globalThis.document; }
    assert.deepStrictEqual(t.flr().items.map((i) => i.rot), [90, 90, 180, 90], '] 는 +90, [ 는 -90'); }
  { const t = mkTools(); t.tools.setTool('placeItem', { kind: 'appliance', category: 'refrigerator', brand: 'samsung', model: 'X1', size: undefined, heightMm: 1000 }); t.tap(200, 200);   // 제원이 없으면 core 가 거절하고 알린다
    assert.strictEqual(t.flr().items.length, 0); assert.ok(KO.test(t.log.toasts.at(-1)) && /크기/.test(t.log.toasts.at(-1)), '제원 없는 가전은 놓지 않는다'); }
  { const t = mkTools({ locked: true }); assert.strictEqual(t.tools.setTool('placeItem', P.applianceOpts(sample)), false, '잠금이면 배치 도구를 못 연다'); assert.ok(t.log.toasts.length === 1); }
  { const t = mkTools(); t.tools.setTool('placeItem', { model: '1way', brand: 'samsung', code: 'AC032', capacityKw: 3.2, size: [1198, 500] }); t.tap(200, 200); assert.strictEqual(t.flr().items[0].kind, 'ac', 'kind 없는 payload 는 기존 시스템에어컨 길'); }

  /* ===== 4. 2D: 상자는 치수 그대로 ===== */
  { const fc = V2.floorCache(curFloor(mixed.doc)), a = fc.items.find((e) => e.el.id === 'I2'), xs = a.poly.map((p) => p[0]), ys = a.poly.map((p) => p[1]);
    near(Math.max(...xs) - Math.min(...xs), 912, 1e-9, '2D 가로'); near(Math.max(...ys) - Math.min(...ys), 683, 1e-9, '2D 깊이'); assert.deepStrictEqual(a.box.map((v) => +v.toFixed(3)), [1044, 1158.5, 1956, 1841.5]);
    const room = fc.rooms[0]; assert.ok(a.box[0] >= room.box[0] && a.box[2] <= room.box[2], '상자는 방 안'); }

  /* ===== 5. 견적: 가전 구역 (손으로 센 도면) ===== */
  const d0 = new Store(createDoc('견적 시험'));
  d0.exec({ type: 'addRoomRect', a: [0, 0], b: [6000, 5000], name: '거실' });
  d0.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'samsung', c: [3000, 2500], size: [1198, 500], capacityKw: 3.2, code: 'AC032CN1PBH1' });
  const app = (c, o) => d0.exec({ type: 'addItem', kind: 'appliance', c, ...o });
  const FRI = { category: 'refrigerator', brand: 'samsung', model: 'RM90H64P2W', name: 'Bespoke 4도어', size: [912, 683], heightMm: 1853 };
  const WSH = { category: 'washer', brand: 'lg', model: 'T25WX', name: '트롬 25kg', size: [700, 900], heightMm: 990 };
  app([1000, 1000], FRI); app([2000, 1000], FRI); app([3000, 1000], WSH);
  d0.exec({ type: 'addFloor' }); d0.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000], name: '다락' });
  app([1000, 1000], FRI); app([2500, 1000], { category: 'tv', brand: 'samsung', model: 'KMR65RH95AFXKR', name: '=HYPERLINK("x")', size: [1437.1, 302], heightMm: 890 });
  app([1000, 2000], { ...FRI, size: [912, 923] });                         // 같은 모델·다른 깊이는 따로 센다
  const est = E.buildEstimate(d0.doc), shape = (g) => [g.floor, g.category, g.brand, g.model, g.dims, g.count];
  assert.deepStrictEqual(est.floors[0].appliances.map(shape), [['Floor 1', 'refrigerator', 'samsung', 'RM90H64P2W', '912×683×1853', 2], ['Floor 1', 'washer', 'lg', 'T25WX', '700×900×990', 1]], '1층: 분류 순서(냉장고 → 세탁기), 같은 모델·치수는 묶는다');
  assert.deepStrictEqual(est.floors[1].appliances.map(shape), [['Floor 2', 'refrigerator', 'samsung', 'RM90H64P2W', '912×683×1853', 1], ['Floor 2', 'refrigerator', 'samsung', 'RM90H64P2W', '912×923×1853', 1], ['Floor 2', 'tv', 'samsung', 'KMR65RH95AFXKR', '1437.1×302×890', 1]], '2층: 치수가 다르면 따로, TV 는 소수 그대로');
  assert.strictEqual(est.appliances.length, 5, '층별 행 합'); assert.strictEqual(est.totals.applianceCount, 6, '가전 수량 1층 2+1, 2층 1+1+1');
  assert.strictEqual(est.totals.acCount, 1, '시스템에어컨 수량에 가전이 섞이지 않는다'); assert.strictEqual(est.totals.kwSum, 3.2); assert.strictEqual(est.totals.kwUnknown, 0); assert.deepStrictEqual(est.floors[0].ac.map((g) => [g.code, g.count, g.kwSum]), [['AC032CN1PBH1', 1, 3.2]]);
  assert.strictEqual(E.buildEstimate(createDoc()).totals.applianceCount, 0); assert.deepStrictEqual(E.buildEstimate(createDoc()).appliances, []);
  const csvRows = parseCsv(E.toCsv(est)), at = (h) => csvRows.findIndex((r) => r.length === 1 && r[0] === h), a1 = at('가전');
  assert.ok(a1 > at('에어컨') && a1 < at('방'), '가전 구역은 에어컨 다음');
  assert.deepStrictEqual(csvRows[a1 + 1], ['층', '분류', '브랜드', '모델명', '제품명', '가로×깊이×높이 mm', '수량']);
  assert.deepStrictEqual(csvRows.slice(a1 + 2, a1 + 7), [
    ['Floor 1', '냉장고', '삼성', 'RM90H64P2W', 'Bespoke 4도어', '912×683×1853', '2'], ['Floor 1', '세탁기', 'LG', 'T25WX', '트롬 25kg', '700×900×990', '1'],
    ['Floor 2', '냉장고', '삼성', 'RM90H64P2W', 'Bespoke 4도어', '912×683×1853', '1'], ['Floor 2', '냉장고', '삼성', 'RM90H64P2W', 'Bespoke 4도어', '912×923×1853', '1'],
    ['Floor 2', 'TV', '삼성', 'KMR65RH95AFXKR', '\'=HYPERLINK("x")', '1437.1×302×890', '1']], '가전 행(식으로 읽힐 제품명은 앞에 \' 를 붙인다)');
  assert.deepStrictEqual(csvRows[a1 + 7], ['합계', '', '', '', '', '', '6']);
  const ac0 = at('에어컨'); assert.deepStrictEqual(csvRows.slice(ac0 + 2, ac0 + 4), [['Floor 1', '삼성', 'AC032CN1PBH1', '1Way', '3.2', '1', '3.2'], ['합계', '', '', '', '', '1', '3.2']], '에어컨 구역은 가전 없이 그대로');
  for (const r of csvRows) for (const c of r) assert.ok(!/^[=+@]/.test(c), '식으로 읽힐 칸 없음: ' + c);

  /* ===== 6. 패널 순수 함수: 필터·검색·정렬·개수 ===== */
  const cnt = (f) => items.filter(f).length;
  assert.strictEqual(P.filterAppliances(items).length, ROWS);
  for (const c of SPEC_CATS) assert.deepStrictEqual(P.filterAppliances(items, { category: c }).map((r) => r.id), items.filter((r) => r.category === c).map((r) => r.id), c + ' 분류 필터');
  assert.strictEqual(P.filterAppliances(items, { brand: 'lg' }).length, cnt((r) => r.brand === 'lg')); assert.strictEqual(P.filterAppliances(items, { brand: 'samsung', category: 'tv' }).length, cnt((r) => r.brand === 'samsung' && r.category === 'tv'));
  assert.ok(P.filterAppliances(items, { brand: 'lg' }).every((r) => r.brand === 'lg') && P.filterAppliances(items, { category: 'dryer' }).every((r) => r.category === 'dryer'));
  assert.deepStrictEqual(P.filterAppliances(items, { query: 'rm90h64p2w' }).map((r) => r.id), ['samsung-refrigerator-RM90H64P2W'], '모델명 · 대소문자 무시');
  assert.deepStrictEqual(P.filterAppliances(items, { query: ' RM 90H 64P2W ' }).map((r) => r.id), ['samsung-refrigerator-RM90H64P2W'], '공백 무시');
  { const r = items.find((x) => x.modelCodes.length > 1), other = r.modelCodes.find((c) => c !== r.model);
    assert.ok(P.filterAppliances(items, { query: other.toLowerCase() }).some((x) => x.id === r.id), '모델 코드(묶인 다른 코드)로도 찾는다 ' + other);
    const w = sample.name.split(' ').slice(0, 3).join('  ').toUpperCase(); assert.ok(P.filterAppliances(items, { query: w }).some((x) => x.id === sample.id), '제품명 · 공백 여럿·대소문자 무시');
    assert.ok(P.filterAppliances(items, { query: 'bespokeai패밀리허브4도어' }).some((x) => x.id === sample.id), '제품명 공백을 빼고도'); }
  assert.strictEqual(P.filterAppliances(items, { query: '없는모델zzz' }).length, 0);
  assert.ok(!P.filterAppliances(items, { query: sample.url.slice(-12) }).length, '주소는 검색 대상이 아니다');
  assert.ok(!P.filterAppliances(items, { query: sample.capacityText.slice(0, 8) + 'ℓℓ' }).length);
  assert.deepStrictEqual(P.filterAppliances(items, { category: 'refrigerator', brand: 'samsung', query: 'rm90h64' }).map((r) => r.id).every((i) => i.startsWith('samsung-refrigerator-RM90H64')), true, '조건 겹치기');
  assert.strictEqual(P.filterAppliances(items, { category: 'tv', query: 'rm90h64p2w' }).length, 0, '분류와 검색이 함께 걸린다');
  assert.deepStrictEqual(P.filterAppliances(items, { ids: new Set([ids[0], ids[7]]) }).map((r) => r.id), [ids[0], ids[7]], '즐겨찾기 id 만');
  const cc = P.categoryCounts(items);
  assert.strictEqual(cc.all, ROWS); for (const c of SPEC_CATS) assert.strictEqual(cc[c], byCat[c], c + ' 분류별 개수'); assert.strictEqual(SPEC_CATS.reduce((s, c) => s + cc[c], 0), cc.all);
  { const lg = P.categoryCounts(items, { brand: 'lg' }); assert.strictEqual(lg.all, 976); assert.strictEqual(lg.refrigerator, 72); assert.strictEqual(lg.dryer, 20, '브랜드 칩은 분류 개수에 반영된다');
    const q = P.categoryCounts(items, { query: 'rm90h64p2w' }); assert.strictEqual(q.all, 1); assert.strictEqual(q.refrigerator, 1); assert.strictEqual(q.tv, 0, '검색은 분류 개수에 반영된다');
    const f = P.categoryCounts(items, { ids: new Set([ids[0]]) }); assert.strictEqual(f.all, 1); assert.strictEqual(f[items[0].category], 1); }
  // 정렬
  const shuffled = items.slice().reverse(), before = items.map((r) => r.id).join();
  const nm = P.sortAppliances(shuffled, 'name');
  for (let i = 1; i < nm.length; i++) assert.ok(nm[i - 1].name.localeCompare(nm[i].name, 'ko', { numeric: true }) <= 0, '이름순');
  assert.strictEqual(shuffled[0].id, items.at(-1).id, '입력을 바꾸지 않는다'); assert.strictEqual(items.map((r) => r.id).join(), before);
  assert.deepStrictEqual(P.sortAppliances(items, 'name').map((r) => r.id), nm.map((r) => r.id), '같은 이름이어도 입력 순서와 무관하게 같은 순서');
  for (const [id, k] of [['width', 'widthMm'], ['height', 'heightMm']]) {
    const s = P.sortAppliances(shuffled, id), firstNull = s.findIndex((r) => r[k] === null);
    assert.ok(firstNull > 0 && s.slice(firstNull).every((r) => r[k] === null), `${k} 미확인은 맨 뒤`); for (let i = 1; i < firstNull; i++) assert.ok(s[i - 1][k] >= s[i][k], `${k} 큰 순`);
    assert.strictEqual(s[0][k], Math.max(...items.filter((r) => r[k] !== null).map((r) => r[k])), `${k} 가장 큰 값이 맨 앞`); assert.strictEqual(s.length, items.length);
  }
  assert.strictEqual(P.sortAppliances(items, 'width')[0].widthMm, 2570.4); assert.strictEqual(P.sortAppliances(items, 'height')[0].heightMm, 2118);
  assert.deepStrictEqual(P.sortAppliances(items, 'nope').map((r) => r.id), nm.map((r) => r.id), '모르는 정렬은 이름순');
  assert.deepStrictEqual(P.APP_SORTS.map((s) => s.label), ['이름순', '가로 큰 순', '높이 큰 순']);
  // 표시 글자
  assert.strictEqual(P.dimLine(912, 923, 1853), '가로 912 · 깊이 923 · 높이 1,853 mm'); assert.strictEqual(P.dimLine(912, null, 1853), '가로 912 · 깊이 미확인 · 높이 1,853 mm'); assert.strictEqual(P.fmtApplianceDims(sample), '가로 912 · 깊이 683 · 높이 1,853 mm');
  assert.strictEqual(P.fmtApplianceDims({ widthMm: 1437.1, depthMm: 302, heightMm: 890 }), '가로 1,437.1 · 깊이 302 · 높이 890 mm', '소수 그대로');

  // 바닥글: meta 의 수집일·행 상한·상한에 닿은 파일에서 만든다
  assert.strictEqual(P.applianceFoot(M), '삼성·LG 공식 페이지에서 모은 2026-10-30 기준 목록 · 브랜드·분류마다 최대 250행까지 모았습니다 · 상한 때문에 뺀 모델이 있는 분류: 삼성 냉장고, 삼성 TV · 상한 250행에 닿은 분류: LG 에어컨');
  { const meta = (reached, cut) => ({ collectedAt: '2027-01-02', files: M.files, rowCap: { perFile: 100, reached: reached.map((file) => ({ file, rows: 100 })), skippedByCap: cut.map((file) => ({ file, skipped: 3 })) } });
    assert.strictEqual(P.applianceFoot(meta([], [])), '삼성·LG 공식 페이지에서 모은 2027-01-02 기준 목록 · 브랜드·분류마다 최대 100행까지 모았습니다', '상한에 닿은 파일이 없으면 상한 수치만 말한다');
    assert.strictEqual(P.applianceFoot(meta(['lg-tv.json'], [])), '삼성·LG 공식 페이지에서 모은 2027-01-02 기준 목록 · 브랜드·분류마다 최대 100행까지 모았습니다 · 상한 100행에 닿은 분류: LG TV');
    assert.ok(P.applianceFoot(meta(['lg-tv.json', 'samsung-dryer.json'], ['lg-tv.json'])).endsWith('상한 때문에 뺀 모델이 있는 분류: LG TV · 상한 100행에 닿은 분류: 삼성 건조기'), '뺀 모델이 있으면 닿음에서 겹쳐 세지 않는다'); }
  // 화면 코드(DOM 은 브라우저에서 본다): 목록에 없는 모델 안내 · 공식 사이트 링크 둘 · 불러오기 실패 낭독 · 다시 시도 뒤 초점
  { const pj = code('panels.js');
    assert.ok(/목록에 없는 모델입니다 · 삼성\/LG 공식 페이지에서 크기를 확인해 주세요/.test(pj) && /officialLinks\(d\.meta\)/.test(pj) && /meta\.sourceSites\[b\]/.test(pj), '검색 0건: 안내 문구 + 공식 사이트 링크');
    assert.ok(/st\.tab === 'lib' && st\.q\.trim\(\)/.test(pj), '안내는 가전 라이브러리 탭의 검색 결과가 0 일 때');
    assert.ok(/role: 'alert'/.test(pj) && /failNote\('목록을 불러오지 못했습니다'/.test(pj) && /failNote\('템플릿을 불러오지 못했습니다'/.test(pj), '불러오기 실패는 role=alert 로 낭독');
    const n = (re) => (pj.match(re) || []).length;
    assert.strictEqual(n(/, \(\) => start\(true\)\)/g), 2, '다시 시도 단추(제품·템플릿)는 retry 표시를 달아 다시 불러온다');
    assert.strictEqual(n(/if \(retry\) refocus\(body\)/g), 4, '다시 시도가 끝나면(성공·다시 실패, 제품·템플릿) 초점을 옮긴다');
    assert.ok(/\.pl-card-main/.test(pj.slice(pj.indexOf('const refocus'))), '초점은 첫 카드로'); }

  /* ===== 7. 3D 정점 자료: 가전은 밑면 없는 상자, 에어컨 조각과 섞이지 않는다 ===== */
  { const D = V3.meshData(MESH.buildMesh(mixed.doc)), none = V3.meshData(MESH.buildMesh((() => { const s = mk(); s.exec({ type: 'addItem', kind: 'ac', model: '1way', brand: 'samsung', c: [3000, 2000], size: [1198, 500] }); return s.doc; })()));
    assert.strictEqual(D.appliance.pos.length / 3, 2 * (16 + 4), '가전 한 대 = 옆 16 + 윗 4 (밑면 없음)'); assert.strictEqual(D.appliance.idx.length / 3, 2 * (8 + 2));
    assert.strictEqual(D.ac.pos.length, none.ac.pos.length, '에어컨 조각은 가전 때문에 달라지지 않는다');
    const b = V3.soupBounds(D.appliance); near(b.min[1], 0, 1e-6, '바닥에서'); near(b.max[1], 1.853, 1e-5, '가장 높은 곳 = 냉장고 1853 mm'); near(b.min[0], 1.044, 1e-5); near(b.max[0], 4.5 + 0.7205, 1e-4, 'TV 오른쪽 끝(4500 + 1441/2)');
    const only = V3.meshData(MESH.buildMesh(mk().doc)); assert.strictEqual(only.appliance.idx.length, 0, '가전이 없으면 빈 자료'); }

  console.log(`test-plan-appliance: OK (카탈로그 ${items.length}행${rawChecked ? ' raw 24개 전수 대조' : ' raw 대조 건너뜀'} · 놓을 수 있는 ${M.counts.placeable} / 없는 ${np} · core·도구·견적·패널·3D)`);
})().catch((e) => { console.error(e); process.exit(1); });
