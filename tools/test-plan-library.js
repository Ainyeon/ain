// 도면 문서 보관(maker/3d/plan/library.js) — 저장·목록·휴지통·복제·이름·용량 초과를 메모리 storage 로 검증한다.
const assert = require('assert');
(async () => {
  const { createLibrary, summarize, QUOTA_MSG } = await import('../maker/3d/plan/library.js');
  const mem = (limit = Infinity) => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), removeItem: (k) => m.delete(k),
    setItem: (k, v) => { let n = v.length; for (const [kk, vv] of m) if (kk !== k) n += vv.length; if (n > limit) { const e = new Error('q'); e.name = 'QuotaExceededError'; throw e; } m.set(k, v); } }; };
  const room = (w, d, x = 0, y = 0) => ({ id: 'R1', name: '방', poly: [[x, y], [x + w, y], [x + w, y + d], [x, y + d]], wallIds: [] });
  const doc = (title, rooms = [room(5000, 4000)], ac = 0) => ({ v: 1, unit: 'mm', title, cur: 0, floors: [{ id: 'F1', rooms, walls: [], items: Array.from({ length: ac }, (_, i) => ({ id: 'I' + i, kind: 'ac' })) }] });
  let t = 1000; const lib = createLibrary(mem(), () => ++t, () => 0.5);
  assert.deepStrictEqual(summarize(doc('a', [room(5000, 4000), room(3000, 3000, 6000)], 2)), { floors: 1, rooms: 2, areaM2: 29, ac: 2 }, '방 면적 합(5×4 + 3×3 = 29㎡)·방 수·에어컨 수');
  const a = lib.savePlan(doc('첫 도면', [room(5000, 4000)], 1)), b = lib.savePlan(doc('둘째'));
  assert.ok(/^p[a-z0-9]+$/.test(a.id) && a.id !== b.id && a.areaM2 === 20 && a.ac === 1 && a.bookmark === false && a.trashed === false, '새 id·meta');
  assert.deepStrictEqual(lib.listPlans().map((m) => m.title), ['둘째', '첫 도면'], '최근 저장이 먼저');
  assert.strictEqual(lib.lastPlanId(), b.id, '마지막으로 연 도면');
  const a2 = lib.savePlan(Object.assign(lib.getPlan(a.id), { title: '첫 도면 수정' }), { id: a.id });
  assert.strictEqual(a2.id, a.id, '같은 id 로 덮어쓴다'); assert.strictEqual(lib.listPlans().length, 2); assert.strictEqual(lib.lastPlanId(), a.id, '저장하면 맨 앞으로');
  lib.setBookmark(a.id, true); assert.strictEqual(lib.getMeta(a.id).bookmark, true); assert.strictEqual(lib.savePlan(lib.getPlan(a.id), { id: a.id }).bookmark, true, '저장해도 북마크는 유지');
  lib.trashPlan(b.id); assert.deepStrictEqual(lib.listPlans().map((m) => m.id), [a.id]); assert.deepStrictEqual(lib.listPlans({ trashed: true }).map((m) => m.id), [b.id], '휴지통은 따로');
  assert.ok(lib.getPlan(b.id), '휴지통의 문서는 남아 있다'); lib.restorePlan(b.id); assert.strictEqual(lib.listPlans().length, 2, '복원');
  const c = lib.duplicatePlan(a.id); assert.ok(c.id !== a.id && /첫 도면 수정 사본$/.test(c.title) && c.bookmark === false, '복제는 북마크 없이 새 id'); assert.strictEqual(lib.getPlan(c.id).title, c.title);
  assert.strictEqual(lib.renamePlan(a.id, '  새 이름  ').title, '새 이름'); assert.strictEqual(lib.getPlan(a.id).title, '새 이름', '문서 안 제목도 바뀐다'); assert.strictEqual(lib.renamePlan(a.id, '   '), null, '빈 이름은 거절');
  lib.deletePlan(b.id); assert.strictEqual(lib.getPlan(b.id), null); assert.strictEqual(lib.getMeta(b.id), null, '완전 삭제');
  // 깨진 저장값은 목록·문서 모두 조용히 비운다(앱이 멈추지 않는다)
  const bad = mem(); bad.setItem('ain-plan-docs', '{깨짐'); const lb = createLibrary(bad); assert.deepStrictEqual(lb.listPlans(), []); bad.setItem('ain-plan-docs', JSON.stringify([{ id: 'x', title: 1 }, { id: 'pabc', title: 'ok', updated: 1 }])); assert.strictEqual(createLibrary(bad).listPlans().length, 1, '모양이 틀린 항목은 거른다');
  bad.setItem('ain-plan-pabc', '{"v":2}'); assert.strictEqual(createLibrary(bad).getPlan('pabc'), null, '버전이 다른 문서는 열지 않는다');
  // 용량 초과: 한국어 메시지, 새 문서는 되돌려 찌꺼기를 남기지 않는다
  const small = mem(400), ls = createLibrary(small, () => ++t, () => 0.1);
  assert.throws(() => ls.savePlan(doc('큰 도면', Array.from({ length: 40 }, (_, i) => room(1000, 1000, i * 1000)))), { message: QUOTA_MSG });
  assert.strictEqual([...small.m.keys()].filter((k) => k !== 'ain-plan-docs').length, 0, '실패한 새 문서가 남지 않는다');
  console.log('test-plan-library: OK');
})().catch((e) => { console.error(e); process.exit(1); });
