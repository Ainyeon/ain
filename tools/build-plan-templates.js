// 플래너 템플릿(maker/3d/plan/data/templates.json) 생성기 — core 명령(addRoomPoly·update·remove·addOpening)으로 예시 평면을 만든다.
// 실행: node tools/build-plan-templates.js [--check]  (--check: 파일을 쓰지 않고 지금 파일과 같은지만 본다)
// 평면은 중심선 좌표(mm)로 방 사각형만 적는다 — 방끼리 맞닿는 벽은 한 벽으로 합치고, 한 방에만 속한 벽은 외벽(exterior)이 된다.
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'maker/3d/plan/data/templates.json');
const M2_PER_PYEONG = 3.3058; // core/export.js 의 load_rule.m2_per_pyeong 와 같은 값(테스트가 대조)
const SIZE = [ // 평 = 실면적(㎡) ÷ 3.3058 의 구간
  { id: 'lt10', name: '10평미만', min: 0, max: 10 }, { id: 'p10', name: '10평대', min: 10, max: 20 }, { id: 'p20', name: '20평대', min: 20, max: 30 },
  { id: 'p30', name: '30평대', min: 30, max: 40 }, { id: 'ge40', name: '40평이상', min: 40, max: null },
];
const LAYOUT = ['원룸', '투룸', '쓰리룸', '아파트'];

// 방 [이름, x0, y0, x1, y1] = 벽 중심선 기준 사각형(방 안쪽 면은 75mm 안으로). 열림 [종류, x, y, 폭] = 벽 중심선 위의 점
const SPECS = [
  { id: 'studio-a', name: '원룸 · 현관 일체형', layout: '원룸',
    rooms: [['원룸', 0, 0, 4200, 5200], ['욕실', 4200, 0, 5900, 2000], ['현관·주방', 4200, 2000, 5900, 5200]],
    open: [['window', 2100, 0, 1800], ['window', 0, 2600, 1200], ['open', 4200, 3800, 900], ['door', 5050, 2000, 800], ['door', 5900, 4300, 900]] },
  { id: 'studio-b', name: '원룸 · 주방 분리형', layout: '원룸',
    rooms: [['원룸', 0, 0, 3700, 4800], ['주방', 3700, 0, 6300, 2600], ['욕실', 3700, 2600, 5100, 4800], ['현관', 5100, 2600, 6300, 4800]],
    open: [['window', 1850, 0, 1800], ['window', 5000, 0, 1200], ['open', 3700, 1300, 900], ['door', 4400, 2600, 800], ['open', 5700, 2600, 900], ['door', 6300, 3700, 900]] },
  { id: 'two-a', name: '투룸 · 소형', layout: '투룸',
    rooms: [['침실', 0, 0, 3300, 3400], ['작은방', 0, 3400, 3300, 6000], ['거실·주방', 3300, 0, 7500, 4400], ['욕실', 3300, 4400, 5200, 6000], ['현관', 5200, 4400, 7500, 6000]],
    open: [['window', 1650, 0, 1500], ['window', 5400, 0, 2400], ['window', 0, 4700, 1200], ['door', 3300, 1700, 800], ['door', 3300, 3900, 800], ['door', 5200, 5200, 800], ['open', 6350, 4400, 1000], ['door', 7500, 5200, 1000]] },
  { id: 'two-b', name: '투룸 · 거실 중앙', layout: '투룸',
    rooms: [['침실 1', 0, 0, 3300, 3800], ['거실·주방', 3300, 0, 7300, 6200], ['침실 2', 7300, 0, 10600, 3800], ['욕실·세탁', 0, 3800, 3300, 6200], ['현관·다용도', 7300, 3800, 10600, 6200]],
    open: [['window', 1650, 0, 1500], ['window', 5300, 0, 2400], ['window', 8950, 0, 1500], ['window', 5300, 6200, 2000], ['door', 3300, 1900, 800], ['door', 7300, 1900, 800], ['door', 3300, 5000, 800], ['open', 7300, 5000, 1000], ['door', 10600, 5000, 1000]] },
  { id: 'three-a', name: '쓰리룸 · 빌라형', layout: '쓰리룸',
    rooms: [['안방', 0, 0, 3400, 3500], ['침실 1', 3400, 0, 6400, 3500], ['침실 2', 6400, 0, 9100, 3500], ['거실·주방', 0, 3500, 5600, 6300], ['현관', 5600, 3500, 7300, 6300], ['욕실', 7300, 3500, 9100, 6300]],
    open: [['window', 1700, 0, 1800], ['window', 4900, 0, 1500], ['window', 7750, 0, 1500], ['window', 2800, 6300, 3000], ['window', 0, 4900, 1200], ['door', 1700, 3500, 800], ['door', 4500, 3500, 800], ['door', 6850, 3500, 800], ['open', 5600, 4900, 1000], ['door', 7300, 4900, 800], ['door', 6450, 6300, 1000]] },
  { id: 'three-b', name: '쓰리룸 · 거실 중앙', layout: '쓰리룸',
    rooms: [['안방', 0, 0, 3600, 4000], ['침실 1', 0, 4000, 3600, 7200], ['거실', 3600, 0, 8400, 4800], ['주방', 3600, 4800, 8400, 7200], ['침실 2', 8400, 0, 11000, 3800], ['욕실', 8400, 3800, 11000, 5600], ['현관', 8400, 5600, 11000, 7200]],
    open: [['window', 1800, 0, 1800], ['window', 6000, 0, 3000], ['window', 9700, 0, 1500], ['window', 0, 5600, 1500], ['window', 6000, 7200, 1500], ['door', 3600, 2000, 800], ['door', 3600, 5800, 800], ['open', 6000, 4800, 1800], ['door', 8400, 1900, 800], ['door', 8400, 4300, 800], ['open', 8400, 6400, 1000], ['door', 11000, 6400, 1000]] },
  { id: 'apt-a', name: '아파트 · 방 3개', layout: '아파트',
    rooms: [['침실 2', 0, 0, 3300, 4300], ['거실', 3300, 0, 8000, 4300], ['안방', 8000, 0, 11600, 4300], ['침실 1', 0, 4300, 3300, 7800], ['주방·식당', 3300, 4300, 6900, 7800], ['욕실', 6900, 4300, 8700, 6100], ['현관', 6900, 6100, 8700, 7800], ['드레스룸', 8700, 4300, 11600, 6100], ['욕실 2', 8700, 6100, 11600, 7800]],
    open: [['window', 1650, 0, 1800], ['window', 5650, 0, 3600], ['window', 9800, 0, 2000], ['window', 1650, 7800, 1800], ['window', 5100, 7800, 1500], ['door', 3300, 2150, 800], ['door', 8000, 2150, 900], ['door', 10150, 4300, 800], ['door', 10150, 6100, 800], ['door', 7800, 6100, 800], ['door', 3300, 6050, 800], ['open', 5100, 4300, 2400], ['open', 6900, 6950, 1000], ['door', 7800, 7800, 1000]] },
  { id: 'apt-b', name: '아파트 · 방 3개 + 다용도실', layout: '아파트',
    rooms: [['침실 2', 0, 0, 3500, 4500], ['거실', 3500, 0, 9100, 4500], ['안방', 9100, 0, 13000, 4500], ['침실 1', 0, 4500, 3500, 8600], ['주방·식당', 3500, 4500, 7300, 7000], ['다용도실', 3500, 7000, 7300, 8600], ['욕실', 7300, 4500, 9100, 5700], ['현관', 7300, 5700, 9100, 8600], ['드레스룸', 9100, 4500, 13000, 6500], ['욕실 2', 9100, 6500, 13000, 8600]],
    open: [['window', 1750, 0, 1800], ['window', 6300, 0, 3600], ['window', 11050, 0, 2000], ['window', 1750, 8600, 1800], ['window', 5400, 8600, 1500], ['door', 3500, 2250, 800], ['door', 9100, 2250, 900], ['door', 11050, 4500, 800], ['door', 11050, 6500, 800], ['door', 8200, 5700, 800], ['door', 3500, 6500, 800], ['open', 5400, 4500, 2400], ['open', 7300, 6350, 1000], ['door', 7300, 7800, 800], ['door', 5400, 7000, 800], ['door', 8200, 8600, 1000]] },
  { id: 'apt-c', name: '아파트 · 방 4개', layout: '아파트',
    rooms: [['침실 3', 0, 0, 3400, 4400], ['침실 2', 0, 4400, 3400, 8600], ['거실', 3400, 0, 9200, 4800], ['주방·식당', 3400, 4800, 8200, 8600], ['안방', 9200, 0, 13200, 4800], ['드레스룸', 9200, 4800, 11200, 6800], ['욕실 2', 11200, 4800, 13200, 6800], ['침실 1', 8200, 6800, 13200, 8600], ['욕실', 8200, 4800, 9200, 6800]],
    open: [['window', 1700, 0, 1500], ['window', 6300, 0, 3600], ['window', 11200, 0, 2000], ['window', 0, 6500, 1500], ['window', 5800, 8600, 1800], ['window', 10700, 8600, 1800], ['door', 3400, 2200, 800], ['door', 3400, 6500, 800], ['door', 9200, 2400, 900], ['door', 10200, 4800, 800], ['door', 12200, 6800, 800], ['door', 8700, 4800, 800], ['open', 6300, 4800, 2400], ['door', 8200, 7700, 800], ['door', 10700, 6800, 800], ['door', 8200, 5800, 800], ['door', 9200, 5800, 800]] },
  { id: 'apt-d', name: '아파트 · 대형 방 4개', layout: '아파트',
    rooms: [['서재', 0, 0, 3600, 4200], ['침실 3', 0, 4200, 3600, 10000], ['거실', 3600, 0, 10000, 5200], ['주방·식당', 3600, 5200, 8400, 10000], ['안방', 10000, 0, 14600, 5200], ['드레스룸', 10000, 5200, 12400, 8400], ['욕실 2', 12400, 5200, 14600, 8400], ['침실 2', 11000, 8400, 14600, 10000], ['욕실', 8400, 5200, 10000, 8400], ['현관', 8400, 8400, 11000, 10000], ['가사실', 3600, 10000, 8400, 11200]],
    open: [['window', 1800, 0, 1800], ['window', 6800, 0, 4000], ['window', 12300, 0, 2400], ['window', 0, 7700, 1600], ['window', 14600, 9200, 1500], ['window', 6000, 11200, 1800], ['door', 3600, 2100, 800], ['door', 3600, 7700, 800], ['door', 10000, 2600, 900], ['door', 11200, 5200, 800], ['door', 12400, 7400, 800], ['door', 11000, 9200, 800], ['door', 9200, 5200, 800], ['open', 6000, 5200, 2800], ['open', 8400, 9200, 1000], ['door', 9200, 8400, 800], ['open', 6000, 10000, 1000], ['door', 9700, 10000, 1000]] },
];

const r2 = (v) => Math.round(v * 100) / 100;

async function build() {
  const base = pathToFileURL(path.join(ROOT, 'maker/3d/plan/core/')).href;
  const [{ createDoc, validateDoc, DEFAULTS }, { Store }, { projectOnSeg, roomAreaM2, polyArea }, { toSpaceJSON }] = await Promise.all(['model', 'store', 'geom', 'export'].map((f) => import(base + f + '.js')));
  const h = DEFAULTS.wallT / 2, seen = new Set(), templates = [];
  for (const sp of SPECS) {
    if (seen.has(sp.id)) throw new Error('템플릿 id 가 겹칩니다: ' + sp.id);
    seen.add(sp.id);
    sp.rooms.forEach((a, i) => sp.rooms.slice(i + 1).forEach((b) => { if (a[1] < b[3] && b[1] < a[3] && a[2] < b[4] && b[2] < a[4]) throw new Error(`${sp.id}: ${a[0]} 과 ${b[0]} 이 겹칩니다`); }));
    const corners = sp.rooms.flatMap((r, k) => [[r[1], r[2]], [r[3], r[2]], [r[3], r[4]], [r[1], r[4]]].map((p) => [...p, k]));
    const cut = (k, axis, fixed, lo, hi) => [...new Set(corners.filter((c) => c[2] !== k && c[1 - axis] === fixed && c[axis] > lo && c[axis] < hi).map((c) => c[axis]))].sort((a, b) => a - b); // 이 변 위에 닿는 다른 방의 모서리
    const store = new Store(createDoc(sp.name));
    sp.rooms.forEach(([name, x0, y0, x1, y1], k) => { // 안쪽 면 사각형 + 이웃 모서리가 닿는 점마다 점 하나씩(맞닿는 벽이 같은 토막으로 나뉘게)
      const top = cut(k, 0, y0, x0, x1), bot = cut(k, 0, y1, x0, x1), left = cut(k, 1, x0, y0, y1), right = cut(k, 1, x1, y0, y1);
      store.exec({ type: 'addRoomPoly', name, poly: [[x0 + h, y0 + h], ...top.map((x) => [x, y0 + h]), [x1 - h, y0 + h], ...right.map((y) => [x1 - h, y]), [x1 - h, y1 - h], ...bot.slice().reverse().map((x) => [x, y1 - h]), [x0 + h, y1 - h], ...left.slice().reverse().map((y) => [x0 + h, y])] });
    });
    let f = store.doc.floors[0];
    const key = (w) => [w.a, w.b].map((p) => p.join(',')).sort().join('|') + '|' + w.t, first = new Map(), dup = [];
    for (const w of f.walls) { const k = key(w); if (first.has(k)) dup.push([w.id, first.get(k)]); else first.set(k, w.id); }
    const to = new Map(dup);
    for (const r of f.rooms) if (r.wallIds.some((i) => to.has(i))) store.exec({ type: 'update', id: r.id, patch: { wallIds: r.wallIds.map((i) => to.get(i) ?? i) } });
    if (dup.length) store.exec({ type: 'remove', ids: dup.map((d) => d[0]) });
    f = store.doc.floors[0];
    const users = new Map(f.walls.map((w) => [w.id, f.rooms.filter((r) => r.wallIds.includes(w.id)).length]));
    for (const w of f.walls) if (users.get(w.id) === 1) store.exec({ type: 'update', id: w.id, patch: { kind: 'exterior' } });
    for (const [kind, x, y, width] of sp.open) {
      const hits = store.doc.floors[0].walls.map((w) => ({ w, p: projectOnSeg([x, y], w.a, w.b) })).filter((c) => c.p.d < 1);
      if (hits.length !== 1) throw new Error(`${sp.id}: (${x},${y}) 에 벽이 ${hits.length}개입니다`);
      try { store.exec({ type: 'addOpening', wall: hits[0].w.id, at: hits[0].p.t, kind, width }); } catch (e) { throw new Error(`${sp.id}: (${x},${y}) ${kind} ${width} — ${e.message}`); }
    }
    const doc = store.doc, bad = validateDoc(doc);
    if (bad.length) throw new Error(`${sp.id}: ${bad[0]}`);
    const rooms = doc.floors[0].rooms.map((r) => ({ name: r.name, areaM2: r2(roomAreaM2(doc, r)) })), areaM2 = r2(rooms.reduce((s, r) => s + r.areaM2, 0));
    if (areaM2 !== toSpaceJSON(doc, 0).envelope.all_rooms_m2) throw new Error(`${sp.id}: 면적 표기가 core 계산과 다릅니다`);
    const pyeong = r2(areaM2 / M2_PER_PYEONG), size = SIZE.find((s) => pyeong >= s.min && (s.max === null || pyeong < s.max));
    for (const r of doc.floors[0].rooms) if (polyArea(r.poly) < 1e6) throw new Error(`${sp.id}: ${r.name} 이 1㎡ 미만입니다`);
    templates.push({ id: sp.id, name: sp.name, layout: sp.layout, size: size.id, tags: [sp.layout, size.name], areaM2, pyeong, rooms, doc: JSON.parse(JSON.stringify(doc)) });
  }
  const meta = {
    about: '예시 평면(실제 세대 아님). 각 doc 은 core 명령으로 만든 Doc 이고 validateDoc 을 통과한다. 벽 두께 150, 층고 2300.',
    areaBasis: 'areaM2 = 방 실면적(안쪽 면) 합. 방마다 소수 둘째 자리로 맺은 값의 합이며 toSpaceJSON(doc).envelope.all_rooms_m2 와 같다.',
    pyeongBasis: `pyeong = areaM2 ÷ ${M2_PER_PYEONG}. 평형 구간은 이 평 값으로 나눈 것이다(공급면적 기준 평형이 아니다).`,
    start: '?template=<id> 로 열면 doc 으로 새 문서를 시작한다(제목은 name).',
    builder: 'tools/build-plan-templates.js',
  };
  return { meta, filters: { size: SIZE.map(({ id, name }) => ({ id, name })), layout: LAYOUT.map((n) => ({ id: n, name: n })) }, templates };
}
const dump = (o) => '{\n  "meta": ' + JSON.stringify(o.meta, null, 2).replace(/\n/g, '\n  ') + ',\n  "filters": ' + JSON.stringify(o.filters) + ',\n  "templates": [\n' + o.templates.map((t) => '    ' + JSON.stringify(t)).join(',\n') + '\n  ]\n}\n';

module.exports = { build, dump, SPECS, SIZE, LAYOUT, M2_PER_PYEONG };
if (require.main === module) {
  build().then((o) => {
    const text = dump(o);
    if (process.argv.includes('--check')) { const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text; console.log('templates.json 은 생성기와 ' + (same ? '같습니다' : '다릅니다 — node tools/build-plan-templates.js 로 다시 만드세요')); process.exit(same ? 0 : 1); }
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    for (const t of o.templates) console.log(t.id.padEnd(9), String(t.areaM2).padStart(7), '㎡', String(t.pyeong).padStart(6), '평', t.tags.join('/'), t.doc.floors[0].rooms.length + '방', t.doc.floors[0].walls.length + '벽', t.doc.floors[0].openings.length + '개구부');
    console.log('쓴 파일:', path.relative(ROOT, OUT), fs.statSync(OUT).size, 'bytes');
  }).catch((e) => { console.error('build-plan-templates:', e.message); process.exit(1); });
}
