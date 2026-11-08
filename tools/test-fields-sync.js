// 현장직 분야 목록 세 곳 대조 — maker/fields.json(정본) · ain-community.js FIELD_GROUPS(가입·뱃지·업무) · supabase 27 의 profiles_field_check.
// 한 곳만 늘리면: 가입 화면에서 고른 값이 DB 에서 거부되거나, 메이커 검색에만 나오고 뱃지는 '미설정'이 된다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

const master = JSON.parse(fs.readFileSync(path.join(ROOT, 'maker/fields.json'), 'utf8'));
const win = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets/js/ain-community.js'), 'utf8'),
  { window: win, document: {}, location: {}, console });
const C = win.ainCommunity;
const GROUPS = JSON.parse(JSON.stringify(C.FIELD_GROUPS));   // 다른 실행 공간의 배열 → 비교 가능한 평범한 값

// 1) 묶음 이름·순서·항목 id·이름이 같다 (custom 은 메이커 '직접 입력' / 뱃지 '기타'로 일부러 다르다)
assert.deepStrictEqual(GROUPS.map(([g]) => g), master.categories.map((c) => c.label), '묶음 이름·순서');
master.categories.forEach((cat, i) => {
  const mine = GROUPS[i][1];
  assert.deepStrictEqual(mine.map(([id]) => id), cat.items.map((it) => it.id), cat.label + ' 항목 id·순서');
  cat.items.forEach((it, j) => { if (it.id !== 'custom') assert.strictEqual(mine[j][1], it.label, it.id + ' 이름'); });
});

// 2) DB 허용 목록 = 정본 전체 + 예전 값(legacy_map) — 더도 덜도 아니게
const sql = fs.readFileSync(path.join(ROOT, 'supabase/27_all_trades_order.sql'), 'utf8');
const block = sql.slice(sql.indexOf('profiles_field_check check'), sql.indexOf('));', sql.indexOf('profiles_field_check check')));
const dbIds = [...block.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
const want = master.categories.flatMap((c) => c.items.map((it) => it.id)).concat(Object.keys(master.legacy_map)).sort();
assert.deepStrictEqual(dbIds, want, 'DB 허용 목록');

// 3) 예전 값은 뱃지 표기만 되고 고르는 목록(묶음)에는 없다
Object.keys(master.legacy_map).forEach((id) => {
  assert.ok(C.FIELD_LABELS[id], id + ' 뱃지 표기');
  assert.ok(!GROUPS.some(([, items]) => items.some(([x]) => x === id)), id + ' 는 고르는 목록에 없음');
});
assert.strictEqual(C.fieldLabel('window-clean'), '유리·외벽 청소');
console.log('fields-sync OK — 묶음 ' + C.FIELD_GROUPS.length + '개 · 분야 ' + want.length + '개(예전 값 포함)');
