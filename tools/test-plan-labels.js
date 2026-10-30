// 평면도 글씨 자리(maker/3d/plan/labels.js) — 문이 열리는 호·기둥·제품을 피하고, 방 밖으로 나가지 않으며, 비어 있으면 중심 그대로.
const assert = require('assert');
(async () => {
  const { swingPoly, polyHitsRect, rectInsidePoly, findLabelSpot, boxOfPoly } = await import('../maker/3d/plan/labels.js');
  const sq = (x, y, w, d) => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
  const room = sq(0, 0, 3000, 3000), center = [1500, 1500];
  // 부채꼴 — 아래쪽 벽(y=3000)의 문, 법선이 위(방 안쪽, -y). 문 폭 900: 경첩 (1050,3000)에서 반지름 900
  const door = { el: { width: 900 }, p: [1500, 3000], tan: [1, 0], n: [0, -1] }, sw = swingPoly(door);
  assert.deepStrictEqual(sw[0], [1050, 3000], '경첩은 문 중심에서 벽 방향 반대로 반 폭'); assert.strictEqual(sw.length, 10);
  assert.ok(Math.abs(sw[1][0] - 1950) < 1e-9 && Math.abs(sw[1][1] - 3000) < 1e-9, '호의 한 끝은 벽을 따라(닫힌 문짝)'); assert.ok(Math.abs(sw[9][0] - 1050) < 1e-9 && Math.abs(sw[9][1] - 2100) < 1e-9, '다른 끝은 법선 쪽(열린 문짝)');
  assert.ok(sw.every((p) => Math.hypot(p[0] - 1050, p[1] - 3000) <= 900 + 1e-9), '모든 점이 반지름 안');
  // 경첩 쪽(hinge)·열리는 쪽(swing): 기본 a·+법선 은 위와 같고, b 는 반대 문틀에서 닫힌 문짝이 a 쪽을 향하며, swing -1 은 반대편으로 열린다
  { const { swingSigns } = await import('../maker/3d/plan/labels.js'), at = (el) => swingPoly({ ...door, el: { width: 900, ...el } }), near = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9;
    assert.deepStrictEqual([swingSigns({}), swingSigns({ hinge: 'a', swing: 1 }), swingSigns({ hinge: 'b', swing: -1 })], [{ hs: -1, sg: 1 }, { hs: -1, sg: 1 }, { hs: 1, sg: -1 }], '기본 = a · +법선');
    assert.deepStrictEqual(at({ hinge: 'a', swing: 1 }), sw, '명시한 기본값 = 기본');
    const b = at({ hinge: 'b' }), m = at({ swing: -1 }), bm = at({ hinge: 'b', swing: -1 });
    assert.ok(near(b[0], [1950, 3000]) && near(b[1], [1050, 3000]) && near(b[9], [1950, 2100]), 'hinge b: 경첩 (1950,3000), 닫힌 문짝은 a 쪽 문틀로, 열린 끝은 (1950,2100)');
    assert.ok(near(m[0], [1050, 3000]) && near(m[1], [1950, 3000]) && near(m[9], [1050, 3900]), 'swing -1: 같은 경첩, 반대편(y 아래)으로 열림');
    assert.ok(near(bm[0], [1950, 3000]) && near(bm[1], [1050, 3000]) && near(bm[9], [1950, 3900]), '둘 다 반대');
    for (const el of [{ hinge: 'b' }, { swing: -1 }, { hinge: 'b', swing: -1 }]) assert.ok(at(el).every((p, i, a) => Math.hypot(p[0] - a[0][0], p[1] - a[0][1]) <= 900 + 1e-9), '호는 항상 경첩에서 문 폭 안'); }
  // 겹침 판정
  assert.ok(polyHitsRect(sw, [1100, 2500, 1300, 2800]) && !polyHitsRect(sw, [100, 100, 300, 300]), '호 안/밖');
  assert.ok(polyHitsRect(sq(0, 0, 100, 100), [-50, -50, 200, 200]), '큰 상자가 작은 다각형을 덮음'); assert.ok(polyHitsRect(sq(0, 0, 1000, 1000), [400, 400, 600, 600]), '상자가 다각형 안에 있음');
  assert.ok(polyHitsRect([[0, 0], [2000, 0], [2000, 50], [0, 50]], [900, -100, 1100, 300]), '가는 띠를 가로지르는 상자(꼭짓점은 서로 밖)');
  // 방 안 판정
  assert.ok(rectInsidePoly(room, [1000, 1000, 2000, 2000]) && !rectInsidePoly(room, [2800, 1000, 3200, 2000]) && !rectInsidePoly(room, [-10, 100, 500, 300]));
  const L = [[0, 0], [3000, 0], [3000, 1000], [1000, 1000], [1000, 3000], [0, 3000]];
  assert.ok(!rectInsidePoly(L, [1500, 200, 2500, 800]) === false && !rectInsidePoly(L, [1200, 1200, 2000, 2000]), 'ㄱ자 방: 팔 안은 되고 오목한 바깥은 안 됨');
  assert.ok(!rectInsidePoly(L, [500, 500, 2500, 2500]) , '네 모서리가 안에 있어도 방 변이 가로지르면 안 됨');
  // 글씨 자리
  const free = findLabelSpot({ poly: room, center, w: 600, h: 300, avoid: [], step: 50 }); assert.deepStrictEqual([free.x, free.y, free.moved], [1500, 1500, false], '비어 있으면 중심 그대로');
  // 방 가운데까지 열리는 큰 문(폭 2400): 중심이 호 안
  const big = { el: { width: 2400 }, p: [1500, 3000], tan: [1, 0], n: [0, -1] }, bigSw = swingPoly(big), avoid = [{ poly: bigSw }];
  assert.ok(polyHitsRect(bigSw, [1200, 1350, 1800, 1650]), '중심 글씨가 호에 걸린다(전제)');
  const moved = findLabelSpot({ poly: room, center, w: 600, h: 300, avoid, step: 50 });
  assert.ok(moved.moved && !moved.blocked, '옮겼다'); const r = [moved.x - 302, moved.y - 152, moved.x + 302, moved.y + 152];
  assert.ok(rectInsidePoly(room, r), '방 안에 있다'); assert.ok(!polyHitsRect(bigSw, r), '호와 겹치지 않는다');
  const d0 = Math.hypot(moved.x - 1500, moved.y - 1500); for (const [dx, dy] of [[-200, 0], [200, 0], [0, -200], [0, 200]]) { const x = 1500 + dx, y = 1500 + dy; if (rectInsidePoly(room, [x - 302, y - 152, x + 302, y + 152]) && !polyHitsRect(bigSw, [x - 302, y - 152, x + 302, y + 152])) assert.ok(d0 <= Math.hypot(dx, dy) + 1e-6, '더 가까운 빈 자리가 있으면 안 된다'); }
  assert.deepStrictEqual(findLabelSpot({ poly: room, center, w: 600, h: 300, avoid, step: 50 }), moved, '같은 입력은 같은 결과');
  // 기둥·제품 상자도 피한다
  const col = { poly: sq(1300, 1350, 400, 300) }, m2 = findLabelSpot({ poly: room, center, w: 600, h: 300, avoid: [col], step: 50 }); assert.ok(m2.moved && !polyHitsRect(col.poly, [m2.x - 302, m2.y - 152, m2.x + 302, m2.y + 152]));
  // 오목한 방: 무게중심이 방 밖일 때 방 안으로
  const cx = [1500, 1500]; const inL = findLabelSpot({ poly: L, center: cx, w: 400, h: 200, avoid: [], step: 50 }); assert.ok(inL.moved && rectInsidePoly(L, [inL.x - 202, inL.y - 102, inL.x + 202, inL.y + 102]), 'ㄱ자 방에서 중심이 밖이면 안으로');
  // 못 놓는 작은 방: 중심 그대로 + blocked
  const tiny = findLabelSpot({ poly: sq(0, 0, 300, 300), center: [150, 150], w: 600, h: 300, avoid: [], step: 20 }); assert.deepStrictEqual([tiny.x, tiny.y, tiny.moved, tiny.blocked], [150, 150, false, true]);
  // 방 없이(제품 글씨): 반경 안에서만
  const it = findLabelSpot({ center: [1500, 2700], w: 300, h: 100, avoid: [{ poly: bigSw }], step: 25, maxRadius: 700 }); assert.ok(Math.hypot(it.x - 1500, it.y - 2700) <= 700 + 1e-6);
  assert.deepStrictEqual(boxOfPoly(sq(10, 20, 30, 40)), [10, 20, 40, 60]);
  console.log('test-plan-labels: OK');
})().catch((e) => { console.error(e); process.exit(1); });
