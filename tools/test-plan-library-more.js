// 도면 보관 보강 — 롤백·삭제 범위·북마크 해제·문서/목록 검증·용량 오류 변종·summarize·제목 길이·id 충돌(독립 리뷰의 변이 시험에서 못 잡힌 곳)
const assert = require('assert');
(async () => {
  const { createLibrary, summarize, QUOTA_MSG } = await import('../maker/3d/plan/library.js');
  const mem = (limit = Infinity) => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), removeItem: (k) => m.delete(k),
    setItem: (k, v) => { let n = v.length; for (const [kk, vv] of m) if (kk !== k) n += vv.length; if (n > limit) { const e = new Error('q'); e.name = 'QuotaExceededError'; throw e; } m.set(k, v); } }; };
  const room = (w, d, x = 0, y = 0) => ({ id: 'R1', name: '방', poly: [[x, y], [x + w, y], [x + w, y + d], [x, y + d]], wallIds: [] });
  const doc = (title, rooms = [room(5000, 4000)], ac = 0) => ({ v: 1, unit: 'mm', title, cur: 0, floors: [{ id: 'F1', rooms, walls: [], items: Array.from({ length: ac }, (_, i) => ({ id: 'I' + i, kind: 'ac' })) }] });
  let t = 1000;
  const quota = (o) => Object.assign(new Error('q'), { name: 'QuotaExceededError' }, o);
  // 1) 문서는 들어갔는데 목록 쓰기가 실패 — 새 문서는 되돌리고, 덮어쓰기에서는 기존 문서를 지우지 않는다
  { const s = mem(), lib = createLibrary(s, () => ++t, () => 0.5), a = lib.savePlan(doc('a'));
    const orig = s.setItem; s.setItem = (k, v) => { if (k === 'ain-plan-docs') throw quota(); orig(k, v); };
    assert.throws(() => lib.savePlan(doc('새 도면')), { message: QUOTA_MSG });
    assert.deepStrictEqual([...s.m.keys()].sort(), ['ain-plan-' + a.id, 'ain-plan-docs'].sort(), '목록 쓰기가 실패하면 새로 쓴 문서도 되돌린다');
    assert.throws(() => lib.savePlan(Object.assign(lib.getPlan(a.id), { title: '수정' }), { id: a.id }), { message: QUOTA_MSG });
    assert.ok(lib.getPlan(a.id), '덮어쓰기 실패 때 기존 문서는 남는다');
  }
  // 2) 한 건 삭제가 다른 건을 건드리지 않는다 · 북마크 해제 · 마지막 도면은 휴지통 제외 · 복원은 맨 앞으로
  { const lib = createLibrary(mem(), () => ++t, () => 0.5), a = lib.savePlan(doc('a')), b = lib.savePlan(doc('b')), c = lib.savePlan(doc('c'));
    lib.deletePlan(b.id);
    assert.deepStrictEqual(lib.listPlans().map((m) => m.id).sort(), [a.id, c.id].sort(), '지운 것만 사라진다'); assert.ok(lib.getPlan(a.id) && lib.getPlan(c.id), '다른 문서 본문은 그대로');
    lib.setBookmark(a.id, true); lib.setBookmark(a.id, false); assert.strictEqual(lib.getMeta(a.id).bookmark, false, '북마크 해제');
    lib.trashPlan(c.id); assert.strictEqual(lib.lastPlanId(), a.id, '마지막 도면에 휴지통 문서는 안 나온다');
    const before = lib.getMeta(c.id).updated; lib.restorePlan(c.id); assert.ok(lib.getMeta(c.id).updated > before && lib.lastPlanId() === c.id, '복원하면 맨 앞으로');
  }
  // 3) 문서 모양 검사 — 깨진 JSON·버전·floors 를 각각
  { const s = mem(), lib = createLibrary(s);
    s.setItem('ain-plan-pabc', '{깨짐'); assert.strictEqual(lib.getPlan('pabc'), null, '깨진 문서 JSON 은 null');
    s.setItem('ain-plan-pabc', '{"v":2,"floors":[]}'); assert.strictEqual(lib.getPlan('pabc'), null, '버전만 틀려도 거절');
    s.setItem('ain-plan-pabc', '{"v":1}'); assert.strictEqual(lib.getPlan('pabc'), null, 'floors 없으면 거절');
    s.setItem('ain-plan-pabc', '{"v":1,"floors":[]}'); assert.ok(lib.getPlan('pabc'), '맞는 문서는 연다');
  }
  // 4) 목록 항목 검사 — id·updated·title 을 하나씩만 틀려도 거른다
  { const s = mem(); s.setItem('ain-plan-docs', JSON.stringify([{ id: '../x', title: 't', updated: 1 }, { id: 'pabc', title: 't', updated: 'x' }, { id: 'pdef', title: 5, updated: 1 }, { id: 'pok', title: 't', updated: 1 }]));
    assert.deepStrictEqual(createLibrary(s).listPlans().map((m) => m.id), ['pok']); }
  // 5) 용량 초과 인식(Firefox 이름·code 22·1014) · 다른 오류는 그대로
  for (const e of [{ name: 'NS_ERROR_DOM_QUOTA_REACHED' }, { name: 'Error', code: 22 }, { name: 'Error', code: 1014 }]) {
    const lib = createLibrary({ getItem: () => null, setItem() { throw Object.assign(new Error('x'), e); }, removeItem() {} }); assert.throws(() => lib.savePlan(doc('a')), { message: QUOTA_MSG }, JSON.stringify(e)); }
  assert.throws(() => createLibrary({ getItem: () => null, setItem() { throw new Error('boom'); }, removeItem() {} }).savePlan(doc('a')), { message: 'boom' }, '용량 아닌 오류는 그대로');
  // 6) summarize — 에어컨만 · 시계 방향 방 · 여러 층 · 빈 문서
  assert.deepStrictEqual(summarize({ floors: [{ rooms: [room(5000, 4000)], items: [{ kind: 'ac' }, { kind: 'light' }] }, { rooms: [{ poly: [[0, 0], [0, 3000], [3000, 3000], [3000, 0]] }], items: [{ kind: 'ac' }] }] }), { floors: 2, rooms: 2, areaM2: 29, ac: 2 });
  assert.deepStrictEqual(summarize(null), { floors: 0, rooms: 0, areaM2: 0, ac: 0 });
  // 7) 제목 길이 — 저장·이름 바꾸기 60자, 복제는 ' 사본'이 잘리지 않는다
  { const lib = createLibrary(mem(), () => ++t, () => 0.5), a = lib.savePlan(doc('가'.repeat(100)));
    assert.strictEqual(a.title.length, 60); assert.strictEqual(lib.renamePlan(a.id, '나'.repeat(100)).title.length, 60);
    assert.ok(/ 사본$/.test(lib.duplicatePlan(a.id).title), '복제 제목 끝이 잘리지 않는다'); }
  // 8) 같은 ms 에 두 번 만들어도 id 가 다르다
  { let k = 0; const lib = createLibrary(mem(), () => 5000, () => ((k++ % 50) / 50)), a = lib.savePlan(doc('a')), b = lib.savePlan(doc('b')); assert.ok(a.id !== b.id && lib.listPlans().length === 2, '같은 ms 충돌 없음'); }
  // 9) 깨진 항목(null·문자열·NaN 좌표)이 섞여도 요약·저장이 예외 없이 된다 — 한 건이 목록 전체를 막지 않게
  assert.deepStrictEqual(summarize({ floors: [null, { rooms: [null, 'x', { poly: [[0, 0], [NaN, 1], [1, 1]] }, room(1000, 1000)], items: [null, { kind: 'ac' }] }] }), { floors: 2, rooms: 2, areaM2: 1, ac: 1 }, 'null·NaN 은 건너뛴다');
  assert.deepStrictEqual(summarize({ floors: 'x' }), { floors: 0, rooms: 0, areaM2: 0, ac: 0 });
  { const lib = createLibrary(mem(), () => ++t, () => 0.5); assert.ok(lib.savePlan({ v: 1, title: '깨진', floors: [{ rooms: [null], walls: [null], items: [null] }] }).id, '깨진 항목이 있는 문서도 저장된다'); }
  console.log('test-plan-library-more: OK');
})().catch((e) => { console.error(e); process.exit(1); });
