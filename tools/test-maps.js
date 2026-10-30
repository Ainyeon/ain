// 맵스(maker/3d/maps/maps.js) 순수 함수 — 검색·투영·팬줌·라벨 배치·핀 선택·자료 검사·링크. DOM 은 쓰지 않는다(화면은 브라우저로 확인).
// 샘플 단지는 이 테스트 안에서만 만든다(저장소의 data/complexes.json 에는 가짜 단지를 두지 않는다).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const near = (a, b, e, msg) => assert.ok(Math.abs(a - b) <= e, (msg || '') + ' 기대 ' + b + ' 실제 ' + a);
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

(async () => {
  const M = await import('../maker/3d/maps/maps.js');
  const { project, unproject, panBy, zoomAt, centerOn, fitView, search, hitPin, pinBox, layoutLabels, readComplexes, planUrl, typeLinks, typeMeta, niceLen, fmtLen, gridStep, fmtDeg, metersPerPx, PIN, DEFAULT_VIEW } = M;

  // ── 샘플 3곳 ──
  const S = [
    { id: 's1', name: '샘플하늘마을', addr: '샘플시 가구 나로 12', lat: 37.5, lng: 127.0, types: [{ id: 't59', name: '59A', areaM2: 59.97, rooms: 3, templateId: 'ex-59a' }, { id: 't84', name: '84B', areaM2: 84, rooms: 4 }] },
    { id: 's2', name: '샘플푸른빌리지', addr: '샘플시 나구 다로 3', lat: 37.52, lng: 127.04, types: [{ id: 't1', name: '원룸', areaM2: 33.5, rooms: 1, templateId: 'ex 1/룸' }] },
    { id: 's3', name: 'Sample Park', addr: '테스트시 다구 Park-ro 7', lat: 35.1, lng: 129.0, types: [] },
  ];
  const ids = (a) => a.map((c) => c.id);

  // ── 저장소 자료 ──
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '../maker/3d/maps/data/complexes.json'), 'utf8'));
  assert.strictEqual(real.v, 1); assert.ok(typeof real.meta.note === 'string' && real.meta.note.length > 0);
  assert.ok(Array.isArray(real.complexes), 'complexes 는 배열');
  { const r = readComplexes(real); assert.deepStrictEqual(r.problems, [], '저장소 자료는 형식 검사를 통과'); assert.strictEqual(r.list.length, real.complexes.length); }
  assert.ok(!real.complexes.some((c) => /^샘플|^Sample/.test(c.name)), '가짜(샘플) 단지를 저장소 자료에 두지 않는다');

  // ── readComplexes: 좋은 자료는 그대로, 나쁜 항목만 뺀다 ──
  { const r = readComplexes({ v: 1, meta: {}, complexes: S }); assert.deepStrictEqual(ids(r.list), ['s1', 's2', 's3']); assert.deepStrictEqual(r.problems, []); }
  const bad = (mut) => { const c = JSON.parse(JSON.stringify(S[0])); mut(c); const r = readComplexes({ v: 1, complexes: [c, S[1]] }); assert.deepStrictEqual(ids(r.list), ['s2'], '나쁜 항목만 빠진다'); assert.strictEqual(r.problems.length, 1); };
  bad((c) => { c.lat = 91; }); bad((c) => { c.lng = '127'; }); bad((c) => { c.lat = NaN; }); bad((c) => { c.id = ''; }); bad((c) => { c.name = ' '; }); bad((c) => { delete c.addr; });
  bad((c) => { c.types = null; }); bad((c) => { c.types[0].areaM2 = 0; }); bad((c) => { c.types[0].rooms = 2.5; }); bad((c) => { c.types[1].id = c.types[0].id; }); bad((c) => { c.types[0].templateId = 5; });
  assert.strictEqual(readComplexes({ v: 2, complexes: [] }).problems.length, 1, 'v 가 다르면 형식 오류');
  assert.strictEqual(readComplexes(null).list.length, 0);
  assert.deepStrictEqual(ids(readComplexes({ v: 1, complexes: [S[0], S[0]] }).list), ['s1'], 'id 중복은 뒤엣것을 뺀다');

  // ── search ──
  assert.deepStrictEqual(ids(search(S, '')), ['s1', 's2', 's3'], '빈 검색어 = 전부(자료 순서)');
  assert.deepStrictEqual(ids(search(S, '   ')), ['s1', 's2', 's3']);
  assert.deepStrictEqual(ids(search(S, null)), ['s1', 's2', 's3']);
  assert.deepStrictEqual(ids(search(S, '하늘')), ['s1'], '이름 부분 일치');
  assert.deepStrictEqual(ids(search(S, '샘플 하늘')), ['s1'], '공백 무시');
  assert.deepStrictEqual(ids(search(S, '샘 플 하 늘 마 을')), ['s1'], '공백은 어디에 있어도 무시');
  assert.deepStrictEqual(ids(search(S, 'sample')), ['s3'], '대소문자 무시(소문자 입력)');
  assert.deepStrictEqual(ids(search(S, 'SAMPLE PARK')), ['s3'], '대소문자 무시(대문자·공백)');
  assert.deepStrictEqual(ids(search(S, '나로')), ['s1'], '주소 부분 일치');
  assert.deepStrictEqual(ids(search(S, '다로')), ['s2']);
  assert.deepStrictEqual(ids(search(S, 'park-ro')), ['s3'], '주소의 영문·기호');
  assert.deepStrictEqual(ids(search(S, '없는단지')), [], '0건');
  assert.deepStrictEqual(ids(search(S, '(')), [], '정규식 기호가 와도 죽지 않는다');
  assert.deepStrictEqual(ids(search(S, '하늘'.normalize('NFD'))), ['s1'], '풀어쓴(NFD) 한글 입력도 맞는다');
  assert.deepStrictEqual(ids(search(S, '샘플')), ['s1', 's2'], '이름 앞부분이 같은 것은 자료 순서');
  assert.deepStrictEqual(ids(search(S, '샘플시 가구')), ['s1'], '주소 안 낱말 둘');
  assert.deepStrictEqual(ids(search(S, '가구 하늘')), ['s1'], '낱말마다 이름·주소 어디든 있으면(순서 무관)');
  { // 순위: 이름 앞 > 이름 속 > 주소
    const L = [{ id: 'a', name: '큰숲 푸른', addr: '', types: [] }, { id: 'b', name: '푸른하늘', addr: '', types: [] }, { id: 'c', name: '하늘', addr: '푸른길 1', types: [] }, { id: 'd', name: '푸른', addr: '', types: [] }];
    assert.deepStrictEqual(ids(search(L, '푸른')), ['b', 'd', 'a', 'c'], '이름 앞부분(자료 순서) → 이름 속 → 주소');
  }
  { // 공백을 빼고 맞는 것(joined)이 낱말만 맞는 것보다 앞선다 — 낱말 규칙에 가려지지 않게 순위로 확인
    const L = [{ id: 'b', name: '하늘 샘플빌', addr: '', types: [] }, { id: 'a', name: '샘플하늘마을', addr: '', types: [] }];
    assert.deepStrictEqual(ids(search(L, '샘플 하늘')), ['a', 'b'], '공백을 무시하고 이어 붙여 맞는 이름이 먼저');
    const N = [{ id: 'x', name: '큰하늘', addr: '', types: [] }, { id: 'y', name: '하늘마을', addr: '', types: [] }];
    assert.deepStrictEqual(ids(search(N, '하늘'.normalize('NFD'))), ['y', 'x'], 'NFD 입력도 이름 앞부분 순위가 같다');
  }
  assert.ok(search(S, '').every((c, i) => c === S[i]) && search(S, '') !== S, '빈 검색어는 복사본을 돌려준다(원본 배열을 건드리지 않게)');

  // ── project / unproject ──
  const V = { lat: 37.5, lng: 127.0, zoom: 12, w: 800, h: 600 };
  { const p = project(V.lat, V.lng, V); near(p.x, 400, 1e-9); near(p.y, 300, 1e-9, '가운데는 캔버스 가운데'); }
  { const n = project(37.6, 127.0, V), e = project(37.5, 127.1, V); assert.ok(n.y < 300 && near(n.x, 400, 1e-9) === undefined, '북쪽은 위(y 작음)'); assert.ok(e.x > 400, '동쪽은 오른쪽'); near(e.y, 300, 1e-9); }
  near(project(37.5, 127.1, V).x - 400, 0.1 / 360 * 256 * 2 ** 12, 1e-9, '경도 0.1° = 256·2^z/360·0.1 px(정확한 값)');
  { const a = project(37.6, 127.1, V), b = project(37.6, 127.1, { ...V, zoom: 13 }); near((b.x - 400) / (a.x - 400), 2, 1e-9, '줌 +1 = 가운데로부터 2배'); near((b.y - 300) / (a.y - 300), 2, 1e-9); }
  near(project(0, 0, { lat: 0, lng: 0, zoom: 0, w: 256, h: 256 }).x, 128, 1e-9); near(project(85.0511287798, 0, { lat: 0, lng: 0, zoom: 0, w: 256, h: 256 }).y, 0, 1e-6, '메르카토르 위쪽 끝은 세계 지도 맨 위(256px 세계의 y=0)');
  for (const [la, ln] of [[37.5, 127], [35.1, 129.0], [33.4, 126.5], [38.2, 128.9], [37.5665, 126.978]]) { const p = project(la, ln, V), u = unproject(p.x, p.y, V); near(u.lat, la, 1e-9, '왕복 위도'); near(u.lng, ln, 1e-9, '왕복 경도'); }
  { const u = unproject(0, 0, V), d = unproject(800, 600, V); assert.ok(u.lat > 37.5 && u.lng < 127 && d.lat < 37.5 && d.lng > 127, '왼쪽 위가 북서, 오른쪽 아래가 남동'); }
  near(metersPerPx(0, 0), 156543.03392804097, 1e-6); near(metersPerPx(60, 10), metersPerPx(0, 10) / 2, 1e-6, '위도 60° 는 적도의 절반');

  // ── 팬·줌 ──
  { const p = panBy(V, 100, 50), c = project(V.lat, V.lng, p); near(c.x, 400 + 100, 1e-6, '오른쪽으로 100 끌면 옛 가운데가 100 오른쪽'); near(c.y, 300 + 50, 1e-6); assert.ok(p.lng < V.lng && p.lat > V.lat, '끌면 가운데 좌표는 반대로'); }
  { const q = panBy(panBy(V, 40, -30), -40, 30); near(q.lat, V.lat, 1e-9); near(q.lng, V.lng, 1e-9, '되돌리면 제자리'); }
  { const pt = { x: 600, y: 120 }, before = unproject(pt.x, pt.y, V), z = zoomAt(V, 14, pt.x, pt.y), after = project(before.lat, before.lng, z); near(after.x, pt.x, 1e-6, '커서 아래 좌표 고정(x)'); near(after.y, pt.y, 1e-6); assert.strictEqual(z.zoom, 14); }
  assert.strictEqual(zoomAt(V, 40, 10, 10).zoom, 19, '줌 상한 19'); assert.strictEqual(zoomAt(V, -5, 10, 10).zoom, 3, '줌 하한 3');
  { const z = zoomAt(V, 12.5, 400, 300); near(z.lat, V.lat, 1e-9); near(z.lng, V.lng, 1e-9, '가운데를 누르면 가운데 그대로'); }

  // ── centerOn / fitView ──
  { const ins = { l: 376, t: 0, r: 0, b: 0 }, c = centerOn(V, 37.52, 127.04, 15, ins), p = project(37.52, 127.04, c); near(p.x, 376 + (800 - 376) / 2, 1e-6, '카드가 가린 왼쪽을 뺀 가운데'); near(p.y, 300, 1e-6); }
  { const c = centerOn(V, 37.52, 127.04, 15, { b: 200 }), p = project(37.52, 127.04, c); near(p.y, (600 - 200) / 2, 1e-6, '시트가 가린 아래를 뺀 가운데'); }
  { const f = fitView(S.slice(0, 2), 800, 600, { l: 376 }, 40);
    for (const c of S.slice(0, 2)) { const p = project(c.lat, c.lng, f); assert.ok(p.x >= 376 + 40 - 1e-6 && p.x <= 800 - 40 + 1e-6 && p.y >= 40 - 1e-6 && p.y <= 560 + 1e-6, '두 단지가 가리지 않은 영역 안: ' + JSON.stringify(p)); }
    const wide = fitView(S, 800, 600, { l: 376 }, 40); assert.ok(wide.zoom < f.zoom, '더 넓게 퍼진 점들은 더 멀리서 본다');
    for (const c of S) { const p = project(c.lat, c.lng, wide); assert.ok(p.x >= 376 && p.x <= 800 && p.y >= 0 && p.y <= 600, '셋 모두 보인다'); }
    const tight = f.zoom, one = fitView([S[0]], 800, 600, {}, 40); assert.strictEqual(one.zoom, 16, '한 곳이면 줌 16'); assert.ok(one.zoom > tight);
    near(project(37.5, 127.0, one).x, 400, 1e-6, '한 곳이면 그 곳이 가운데'); }
  { const e = fitView([], 800, 600, {}); near(e.zoom, DEFAULT_VIEW.zoom, 1e-9); near(project(DEFAULT_VIEW.lat, DEFAULT_VIEW.lng, e).x, 400, 1e-6, '자료가 없으면 기본 시점'); }

  // ── 축척·격자 ──
  assert.strictEqual(niceLen(130), 100); assert.strictEqual(niceLen(250), 200); assert.strictEqual(niceLen(99), 50); assert.strictEqual(niceLen(500), 500); assert.strictEqual(niceLen(0.8), 0.5); assert.strictEqual(niceLen(1999), 1000);
  assert.strictEqual(fmtLen(500), '500 m'); assert.strictEqual(fmtLen(2000), '2 km'); assert.strictEqual(fmtLen(1500), '1.5 km');
  assert.strictEqual(gridStep(7), 1, '줌 7 은 1° 간격'); assert.strictEqual(gridStep(12), 0.05, '줌 12 는 0.05°(0.02° 는 58px 라 80px 미만)'); assert.strictEqual(gridStep(3), 10, '아주 멀면 10°');
  for (let z = 3; z <= 19; z++) { const s = gridStep(z), ppd = 256 * 2 ** z / 360; assert.ok(s * ppd >= 80 || s === 10, 'z' + z + ' 줄 간격 80px 이상'); }
  assert.strictEqual(fmtDeg(37.5, 0.5, 'N', 'S'), '37.5°N'); assert.strictEqual(fmtDeg(-33, 1, 'N', 'S'), '33°S'); assert.strictEqual(fmtDeg(0, 1, 'N', 'S'), '0°N', '0 은 양쪽 기호 중 앞'); assert.strictEqual(fmtDeg(127.02, 0.02, 'E', 'W'), '127.02°E'); assert.strictEqual(fmtDeg(130, 10, 'E', 'W'), '130°E'); assert.strictEqual(fmtDeg(127.1, 0.1, 'E', 'W'), '127.1°E');

  // ── 핀 선택 ──
  { // 샘플 3곳을 화면에 놓고, 핀을 누르면 그 단지의 id 가 나온다(검색 → 핀 → 상세 → 타입 선택 흐름)
    const f = fitView(S, 1000, 700, { l: 376 }), items = S.map((c) => { const p = project(c.lat, c.lng, f); return { id: c.id, x: p.x, y: p.y }; });
    for (const it of items) { assert.strictEqual(hitPin(items, it.x, it.y - PIN.head), it.id, '핀 머리를 누르면 그 단지: ' + it.id); }
    assert.strictEqual(hitPin(items, items[2].x + 3, items[2].y - 3), 's3', '핀 몸통 가까이(홀로 있는 핀)');
    assert.strictEqual(hitPin(items, items[0].x + 200, items[0].y + 100), null, '멀리 누르면 없음');
    { const o = [{ id: 'a', x: 100, y: 100 }], hy = 100 - PIN.head;   // 핀 상자(±14.4) 밖 4px 이내는 눌린 것으로 본다(손가락 오차)
      for (const dx of [17, -17]) assert.strictEqual(hitPin(o, 100 + dx, hy), 'a', '상자 밖 17px 는 허용 오차 안: ' + dx);
      for (const dx of [19, -19]) assert.strictEqual(hitPin(o, 100 + dx, hy), null, '19px 는 밖: ' + dx);
      assert.strictEqual(hitPin(o, 100, 100 + 3), 'a', '끝점 아래 3px'); assert.strictEqual(hitPin(o, 100, 100 + 6), null, '끝점 아래 6px 는 밖');
      assert.strictEqual(hitPin(o, 100, 100 - 41), 'a', '머리 위 허용'); assert.strictEqual(hitPin(o, 100, 100 - 46), null, '머리 위 46px 는 밖'); }
    assert.strictEqual(hitPin(items, items[0].x, items[0].y + 40), null, '끝점 아래쪽 멀리는 없음');
    // 겹친 핀 — 가까운 머리가 이기고, 같으면 위에 그린(뒤) 것
    const two = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 108, y: 100 }];
    assert.strictEqual(hitPin(two, 98, 78), 'a'); assert.strictEqual(hitPin(two, 112, 78), 'b'); assert.strictEqual(hitPin(two, 104, 78), 'b', '정확히 가운데면 위에 그린 것');
    // 선택 흐름
    const hit = hitPin(items, items[0].x, items[0].y - PIN.head), c = S.find((x) => x.id === hit), ls = typeLinks(c);
    assert.strictEqual(c.name, '샘플하늘마을'); assert.strictEqual(ls.length, 2);
    assert.deepStrictEqual(ls[0], { id: 't59', name: '59A', meta: '59.97㎡ · 방 3', href: '../plan/?template=ex-59a' }, '타입 → 템플릿 주소');
    assert.deepStrictEqual(ls[1], { id: 't84', name: '84B', meta: '84㎡ · 방 4', href: null }, '예시 평면이 없는 타입은 링크가 없다');
    assert.strictEqual(typeLinks(S[1])[0].href, '../plan/?template=ex+1%2F%EB%A3%B8', '주소에 넣을 때 인코딩');
    assert.strictEqual(new URLSearchParams(typeLinks(S[1])[0].href.split('?')[1]).get('template'), 'ex 1/룸', '디코딩하면 원래 id');
    assert.deepStrictEqual(typeLinks(S[2]), [], '타입이 없는 단지');
    // 검색 결과의 핀만 남기는 흐름: 검색 → 결과 id 집합
    const m = new Set(ids(search(S, '푸른'))); assert.ok(m.has('s2') && !m.has('s1') && !m.has('s3'));
  }

  // ── 라벨 겹침 ──
  { const w = 60, h = 20;
    const far = [{ id: 'a', x: 100, y: 200, w, h }, { id: 'b', x: 400, y: 200, w, h }, { id: 'c', x: 700, y: 200, w, h }];
    const lf = layoutLabels(far); assert.strictEqual(lf.size, 3, '멀리 떨어진 핀은 모두 라벨이 붙는다'); assert.deepStrictEqual(lf.get('a'), { x: 70, y: 203 }, '기본 자리 = 핀 끝점 아래 가운데');
    const dense = []; for (let i = 0; i < 12; i++) dense.push({ id: 'd' + i, x: 300 + (i % 4) * 14, y: 300 + Math.floor(i / 4) * 10, w, h });
    const ld = layoutLabels(dense);
    assert.ok(ld.size >= 1 && ld.size < dense.length, '빽빽하면 일부는 숨긴다: ' + ld.size); assert.ok(ld.has('d0'), '우선순위 첫째는 항상 붙는다');
    const boxes = [...ld].map(([id, p]) => [p.x, p.y, p.x + w, p.y + h]);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i].map((v, k) => v + (k < 2 ? -0.9 : 0.9)), boxes[j].map((v, k) => v + (k < 2 ? -0.9 : 0.9))), '붙은 라벨끼리 겹치지 않고 1px 이상 떨어진다');
    for (const [id, p] of ld) { const b = [p.x, p.y, p.x + w, p.y + h]; for (const it of dense) if (it.id !== id) assert.ok(!overlap(b, pinBox(it.x, it.y)), id + ' 라벨이 ' + it.id + ' 핀을 가리지 않는다'); }
    const pri = layoutLabels([{ id: 'x', x: 500, y: 500, w, h }, { id: 'y', x: 502, y: 500, w, h }]); assert.deepStrictEqual(pri.get('x'), { x: 470, y: 503 }, '앞선 것이 기본 자리를 지킨다'); assert.ok(!pri.has('y') || (pri.get('y').x !== 472 || pri.get('y').y !== 503), '뒤 것은 다른 자리로 밀리거나 숨는다');
    assert.strictEqual(layoutLabels(far, { max: 2 }).size, 2, '상한(max)을 넘으면 라벨을 만들지 않는다');
    assert.strictEqual(layoutLabels([]).size, 0);
    const k = layoutLabels([{ id: 'k', x: 100, y: 100, w, h, k: 1.25 }]).get('k'); assert.strictEqual(k.y, 100 + 3, '커진 핀도 끝점 아래'); }

  // ── 플래너 링크 ──
  assert.strictEqual(planUrl('draw'), '../plan/?new=1', '직접 그리기 = 빈 도면(?new=1 이 없으면 플래너가 마지막 저장 도면을 연다)'); assert.strictEqual(planUrl('trace'), '../plan/?underlay=1'); assert.strictEqual(planUrl('template', '', 'abc'), '../plan/?template=abc');
  assert.strictEqual(planUrl('draw', '?partner=baramdaero&embed=1&x=1&q=2'), '../plan/?new=1&partner=baramdaero&embed=1', '공동 브랜드·임베드만 이어 붙인다(다른 값은 버림)');
  assert.strictEqual(planUrl('trace', '?partner=baramdaero'), '../plan/?underlay=1&partner=baramdaero'); assert.strictEqual(planUrl('template', '?embed=1', 't1'), '../plan/?template=t1&embed=1');
  assert.strictEqual(typeMeta({ areaM2: 84.9712, rooms: 3 }), '84.97㎡ · 방 3'); assert.strictEqual(typeMeta({ areaM2: 59, rooms: 0 }), '59㎡ · 방 0');

  // ── 바탕 지도(OpenStreetMap 타일) · 주소 검색(Nominatim) ──
  { const { BASEMAP, tileUrl, visibleTiles, placesUrl, readPlaces, distKm, nearComplexes } = M, origin = (u) => new URL(u.replace(/\{\w\}/g, '0')).origin;
    assert.strictEqual(tileUrl(BASEMAP.tiles, 15, 27940, 12688), 'https://tile.openstreetmap.org/15/27940/12688.png');
    const v = { lat: 37.5663, lng: 126.9779, zoom: 15, w: 800, h: 600 }, ts = visibleTiles(v), n = 2 ** 15;   // 서울시청 · 줌 15
    const tx = Math.floor((v.lng + 180) / 360 * n), sn = Math.sin(v.lat * Math.PI / 180), ty = Math.floor((0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * n);   // OSM 슬리피 타일 공식(독립 계산)
    const c = ts.find((t) => t.x === tx && t.y === ty); assert.ok(c, '화면 가운데 점이 든 타일이 있다'); assert.ok(c.sx <= 400 && 400 < c.sx + c.s && c.sy <= 300 && 300 < c.sy + c.s, '그 타일이 화면 가운데를 덮는다');
    for (const [x, y] of [[0, 0], [799, 0], [0, 599], [799, 599]]) assert.ok(ts.some((t) => x >= t.sx && x < t.sx + t.s && y >= t.sy && y < t.sy + t.s), `화면 모서리 ${x},${y} 가 타일에 덮인다`);
    const t0 = ts[0], p0 = project(Math.atan(Math.sinh(Math.PI * (1 - 2 * t0.y / n))) * 180 / Math.PI, t0.x / n * 360 - 180, v); near(p0.x, t0.sx, 1e-6, '타일 왼쪽 위 x = project()'); near(p0.y, t0.sy, 1e-6, '타일 왼쪽 위 y = project()');
    assert.ok(ts.every((t) => t.z === 15 && t.s === 256) && new Set(ts.map((t) => t.x + ',' + t.y)).size === ts.length, '정수 줌: 256px · 중복 없음');
    const f = visibleTiles({ ...v, zoom: 15.4 }); assert.strictEqual(f[0].z, 15); near(f[0].s, 256 * 2 ** 0.4, 1e-9, '소수 줌은 타일을 늘려 그린다'); const g = visibleTiles({ ...v, zoom: 15.6 }); assert.strictEqual(g[0].z, 16, '타일 줌은 반올림(15.6 → 16)'); near(g[0].s, 256 * 2 ** -0.4, 1e-9, '반올림해 위 줌을 쓰면 줄여 그린다');
    assert.ok(visibleTiles({ lat: 0, lng: -179.9, zoom: 3, w: 2000, h: 600 }).every((t) => t.x >= 0 && t.x < 8 && t.y >= 0 && t.y < 8), '세계 가장자리 밖 타일은 뺀다');
    assert.ok(visibleTiles({ lat: 37, lng: 127, zoom: 19.4, w: 400, h: 400 }).every((t) => t.z === 19), '타일 줌 상한 19');
    assert.strictEqual(placesUrl(BASEMAP.geocode, ' 서울 시청 '), BASEMAP.geocode + '?format=jsonv2&limit=5&countrycodes=kr&accept-language=ko&q=' + encodeURIComponent('서울 시청')); assert.ok(placesUrl(BASEMAP.geocode, 'a'.repeat(200)).endsWith('q=' + 'a'.repeat(80)), '검색어는 80자까지');
    assert.deepStrictEqual(readPlaces([{ lat: '37.5666', lon: '126.9784', display_name: ' 서울특별시청 ' }, { lat: 'x', lon: '1', display_name: '좌표 아님' }, { lat: '95', lon: '1', display_name: '범위 밖' }, { lat: '1', lon: '1' }, null, 5]), [{ name: '서울특별시청', lat: 37.5666, lng: 126.9784 }], '모양이 다른 항목은 뺀다');
    assert.deepStrictEqual(readPlaces({}), []); assert.deepStrictEqual(readPlaces(null), []); assert.strictEqual(readPlaces(Array.from({ length: 9 }, (_, i) => ({ lat: '1', lon: '1', display_name: 'n' + i }))).length, 5, '최대 5건'); assert.strictEqual(readPlaces([{ lat: '1', lon: '1', display_name: '가'.repeat(300) }])[0].name.length, 120);
    near(distKm(37.5663, 126.9779, 35.1796, 129.0756), 325, 6, '서울시청–부산 약 325km'); assert.strictEqual(distKm(37, 127, 37, 127), 0);
    const cs = [{ id: 'far', lat: 35.18, lng: 129.07 }, { id: 'b', lat: 37.5700, lng: 126.9800 }, { id: 'a', lat: 37.5665, lng: 126.9780 }];
    assert.deepStrictEqual(nearComplexes(cs, 37.5663, 126.9779, 2).map((x) => x.id), ['a', 'b'], '반경 2km 안, 가까운 순'); assert.deepStrictEqual(nearComplexes(cs, 0, 0, 2), []);
    // 정적: 바깥으로 나가는 주소는 이 셋뿐이고 CSP 가 정확히 그 둘만 연다
    const html = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/maps/index.html'), 'utf8'), js = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/maps/maps.js'), 'utf8');
    const allowed = new Set([origin(BASEMAP.tiles), origin(BASEMAP.geocode), origin(BASEMAP.creditUrl)]);
    for (const u of js.match(/https:\/\/[^\s'"`)]+/g) || []) assert.ok(allowed.has(new URL(u.replace(/\{\w\}/g, '0')).origin), '허용 밖 외부 주소: ' + u);
    assert.ok(html.includes(`img-src 'self' data: blob: ${origin(BASEMAP.tiles)};`) && html.includes(`connect-src 'self' ${origin(BASEMAP.geocode)};`) && /script-src 'self';/.test(html), 'CSP: 이미지 = 타일 서버만, 연결 = 주소 검색 서버만, 스크립트는 그대로');
    assert.ok(/<meta name="robots" content="noindex">/.test(html), '자료가 비어 있는 동안 색인하지 않는다');
    assert.ok(/id="mpCredit"[^>]*rel="noopener noreferrer"/.test(html) && html.includes(BASEMAP.creditUrl) && ['mpGeo', 'mpGeoGo', 'mpPlaces'].every((id) => html.includes(`id="${id}"`)) && html.includes('주소 검색은 입력한 글을 OpenStreetMap 에 보냅니다.'), '저작권 표기 · 주소 검색 칸 · 보내는 곳 고지');
    const onQuery = js.slice(js.indexOf('function onQuery()'), js.indexOf("el.q.addEventListener('input'")); assert.ok(onQuery.length > 50 && !/geoSearch/.test(onQuery), '글자를 칠 때마다 주소 검색을 부르지 않는다(누르거나 Enter 일 때만)');
    assert.ok(/el\.credit\.style\.bottom = Math\.max\(px\('--sp-1'\), inset\.b\)/.test(js), '저작권 표기가 폰 시트에 가리지 않는다');
    assert.strictEqual((js.match(/geoSearch/g) || []).length, 3, 'geoSearch 는 정의 + Enter + 단추 클릭 셋뿐'); }

  // ── 올리기 전 점검 반영: 비행 중단 · 타일 재시도 · 주소 검색 재시작/초점 · 고지 · 터치 크기 · 서비스워커 ──
  { const { TILE_RETRY_MS, tileRetryable } = M;
    const html = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/maps/index.html'), 'utf8'), js = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/maps/maps.js'), 'utf8'), css = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/maps/maps.css'), 'utf8');
    // F1·F5: 비행을 끊는 곳은 모두 stopFly 한 곳을 지난다 — anim 취소와 moving 되돌리기, 예약된 맞춤 비행 취소를 함께 한다
    const sf = js.slice(js.indexOf('function stopFly()'), js.indexOf('function flyTo('));
    assert.ok(/clearTimeout\(fitTimer\)/.test(sf) && /cancelAnimationFrame\(anim\)/.test(sf) && /moving = false/.test(sf), 'stopFly = 맞춤 타이머 취소 + anim 취소 + moving=false');
    assert.strictEqual((js.match(/cancelAnimationFrame\(anim\)/g) || []).length, 1, 'anim 은 stopFly 안에서만 취소한다(moving 이 true 로 남지 않게)');
    assert.strictEqual((js.match(/stopFly\(\);/g) || []).length, 4, 'flyTo · pointerdown · wheel · 방향키가 stopFly 를 부른다');
    // F3: 실패한 타일은 실패 시각을 남기고 일정 시간 다시 부르지 않는다
    assert.ok(TILE_RETRY_MS >= 10000 && TILE_RETRY_MS <= 30000, '재시도 간격 10~30초');
    assert.strictEqual(tileRetryable(undefined, 1e9), false); assert.strictEqual(tileRetryable({ ok: true, failedAt: 0 }, 1e9), false, '받은 타일'); assert.strictEqual(tileRetryable({ ok: false }, 1e9), false, '아직 받는 중');
    assert.strictEqual(tileRetryable({ ok: false, failedAt: 1000 }, 1000 + TILE_RETRY_MS - 1), false, '실패 직후에는 다시 부르지 않는다'); assert.strictEqual(tileRetryable({ ok: false, failedAt: 1000 }, 1000 + TILE_RETRY_MS), true, '간격이 지나면 다시');
    assert.ok(/img\.onerror = \(\) => \{ e\.failedAt = /.test(js) && !/onerror[^;]*tiles\.delete/.test(js), '실패한 타일을 지우지 않고 실패 시각을 남긴다');
    assert.ok(/tiles\.size > 300/.test(js), '300개 초과 정리 규칙은 그대로');
    // F6·A11Y-05: 검색 중 다시 누르면 이전 요청을 접고 새로 시작, 누른 단추는 disabled 로 초점을 잃지 않는다
    const gs = js.slice(js.indexOf('async function geoSearch()'), js.indexOf('function onQuery()'));
    assert.ok(/geoCtl\.abort\(\)/.test(gs) && /ctl !== geoCtl/.test(gs) && /geoBusy && text === geoText/.test(gs), '이전 요청 취소 + 이어받은 검색 구분 + 같은 검색어 중복 누름 무시');
    assert.ok(!/geoGo\.disabled/.test(js) && /aria-disabled/.test(gs) && /aria-busy/.test(gs), 'disabled 대신 aria-disabled + aria-busy');
    assert.ok(/주소를 찾는 중입니다/.test(gs) && /if \(had\) \(.*\.focus\(/.test(gs) && /document\.activeElement === el\.geoGo/.test(gs), '진행 안내 + 단추를 눌렀을 때만 끝난 뒤 초점을 옮긴다');
    assert.ok(/id="mpCount"[^>]*tabindex="-1"/.test(html), '상태 줄은 초점을 받을 수 있다(폰: 단추가 숨겨질 때)');
    assert.ok(/\.mp-geogo\[aria-disabled="true"\]/.test(css) && !/\.mp-geogo:disabled/.test(css), 'CSS 도 aria-disabled 기준');
    // S3: 지도 카드에 항상 보이는 전달 고지(주소 검색 고지 .mp-geonote 와 별개)
    { const m = html.match(/<p class="mp-privacy" id="mpPrivacy">(.*?)<\/p>/), t = m && m[1].replace(/<[^>]+>/g, ''); assert.ok(m && /OpenStreetMap/.test(t) && /보는 구역/.test(t) && /내 위치/.test(t) && /전달/.test(t), '지도 이미지·보는 구역·내 위치가 OpenStreetMap 으로 전달된다는 고지');
      assert.ok(html.indexOf('id="mpPrivacy"') > html.indexOf('class="mp-sch"') && html.indexOf('id="mpPrivacy"') < html.indexOf('class="mp-note"'), '검색칸 아래, 접힌 시트에서도 보이는 자리(.mp-sch 안)');
      assert.ok(!/mp-privacy[^{]*\{[^}]*display:\s*none/.test(css) && !/data-open="false"[^{]*mp-privacy/.test(css), '고지는 어떤 상태에서도 숨기지 않는다');
      assert.ok(html.includes('주소 검색은 입력한 글을 OpenStreetMap 에 보냅니다.'), '주소 검색 고지는 그대로'); }
    // F2: 정적 href 도 같은 값
    assert.strictEqual((html.match(/href="\.\.\/plan\/\?new=1" data-kind="draw"/g) || []).length, 2, '도면 직접 그리기·만들기 정적 href 둘 다 ?new=1');
    // A11Y-12: 터치(pointer: coarse)에서 손잡이·지우기·목록으로 44px
    { const coarse = css.split('\n').filter((l) => l.startsWith('@media (pointer: coarse)')).join(' ');
      for (const sel of ['mp-handle', 'mp-clr', 'mp-back']) assert.ok(new RegExp('\\.' + sel + ' \\{[^}]*44px').test(coarse), sel + ' 터치 44px'); }

    // D4/F8: 서비스워커 — 단지·플래너 자료 JSON 은 네트워크 우선(실패하면 캐시), 다른 정적 자산은 캐시 우선 그대로
    const vm = require('vm'), swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    const swRun = async (url, net) => {
      const handlers = {}, calls = [], cache = { put: () => Promise.resolve() };
      vm.runInNewContext(swSrc, { URL, Request: class {}, Response: class {}, self: { addEventListener: (t, f) => { handlers[t] = f; } }, location: { origin: 'https://ain.test' },
        caches: { open: () => Promise.resolve(cache), match: () => { calls.push('cache'); return Promise.resolve('STALE'); }, keys: () => Promise.resolve([]) },
        fetch: () => { calls.push('net'); return net(); } });
      let out; handlers.fetch({ request: { method: 'GET', url: 'https://ain.test' + url, mode: 'cors' }, respondWith: (p) => { out = p; } });
      return { res: await out, calls };
    };
    const fresh = () => Promise.resolve({ ok: true, clone: () => ({}), tag: 'FRESH' }), down = () => Promise.reject(new Error('offline'));
    for (const u of ['/maker/3d/maps/data/complexes.json', '/maker/3d/plan/data/templates.json', '/maker/3d/plan/data/appliance-catalog.json?x=1', '/maker/3d/plan/core/model.js', '/maker/3d/plan/panels.js', '/maker/3d/plan/plan.css', '/maker/3d/plan/app.js?v=1', '/maker/3d/maps/maps.js?v=1', '/maker/3d/projects/projects.js', '/maker/3d/app/shell.js']) {
      assert.strictEqual((await swRun(u, fresh)).res.tag, 'FRESH', u + ' 네트워크 우선(캐시에 낡은 본이 있어도 새 본)');
      assert.strictEqual((await swRun(u, down)).res, 'STALE', u + ' 네트워크가 막히면 캐시');
    }
    for (const u of ['/maker/3d/studio.js?v=14', '/maker/3d/maps/data/other.txt', '/maker/3d/view/viewer.js', '/maker/3d/index.html']) assert.strictEqual((await swRun(u, fresh)).res, 'STALE', u + ' 캐시 우선은 그대로');
    assert.ok(/ain-v35'/.test(swSrc), 'VERSION 은 이번에 올리지 않는다(배포 때 판단)');
  }

  console.log('test-maps: OK');
})().catch((e) => { console.error(e); process.exit(1); });
