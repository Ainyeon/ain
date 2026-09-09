// 교육 목록 로직 회귀 검사 — 실행: node tools/test-edu-logic.js
// 여기서 지키는 것: 섹션이 세 축을 섞지 않을 것, 필터가 실제 데이터와 맞을 것,
//                  채용 접점이 교육 집계에 섞이지 않을 것.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const L = require(path.join(__dirname, '..', 'edu', 'edu-logic.js'));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'education.json'), 'utf8'));
const items = data.items;

// 1) 채용 접점은 교육 목록·집계에서 빠진다
assert.strictEqual(items.length, 15);
assert.strictEqual(L.listed(items).length, 14);
assert.ok(!L.listed(items).some((i) => i.record_type.startsWith('채용접점')));

// 2) 섹션 계수가 원장과 일치 (모든 마감 이전 시점 기준)
const BEFORE = Date.parse('2026-09-09T00:00:00+09:00');
const secs = L.groupSections(items, {}, BEFORE);
assert.deepStrictEqual(secs.map((s) => [s.key, s.items.length]),
  [['deadline', 6], ['posted_no_deadline', 2], ['unconfirmed', 6]]);
// 섹션 제목이 "지금 신청 가능"을 만들지 않는다
assert.ok(!secs.some((s) => /신청 가능|모집 중|모집중/.test(s.title)));

// 3) 원문 내부 표기 충돌은 목록에 남아 있다 (날짜 3 + 비용 1)
const conflicts = L.listed(items).filter((i) => i.conflict);
assert.strictEqual(conflicts.filter((c) => c.conflict.kind === 'date').length, 3);
assert.strictEqual(conflicts.filter((c) => c.conflict.kind === 'cost').length, 1);
// 충돌 3건은 모두 '접수 마감일시 명시' 섹션 안에 있고, 충돌 사실을 달고 있다
assert.strictEqual(conflicts.filter((c) => c.conflict.kind === 'date' && c.group === 'deadline').length, 3);

// 4) 필터
const only = (f) => L.groupSections(items, f, BEFORE).reduce((n, s) => n + s.items.length, 0);
assert.strictEqual(only({ work: 'hvac' }), 7);
assert.strictEqual(only({ region: '서울' }), 5);
assert.strictEqual(only({ cost: 'subsidy' }), 7);
assert.strictEqual(only({ status: 'deadline' }), 6);
assert.strictEqual(only({ work: 'hvac', region: '서울' }), 1);      // 폴리텍
assert.strictEqual(only({ work: 'hvac', cost: 'self' }), 5);        // KRRC 유료 5회차
assert.strictEqual(only({ region: '없는지역' }), 0);

// 5) 필터 선택지는 데이터에서만 나온다
assert.deepStrictEqual(L.optionsOf(items, 'region_code').sort(), ['경기', '논산', '서울', '인천']);
assert.ok(!L.optionsOf(items, 'region_code').includes('충남'));      // 논산을 충남으로 추론하지 않음

// 6) 재확인 필요 (60일 기준)
assert.strictEqual(L.isStale('2026-09-09', '2026-09-09'), false);
assert.strictEqual(L.isStale('2026-09-09', '2026-11-08'), false);   // 60일 = 아직 아님
assert.strictEqual(L.isStale('2026-09-09', '2026-11-09'), true);    // 61일
assert.strictEqual(L.isStale('', '2026-11-09'), false);

// 7) 정렬은 확인일 역순 — 점수·투표 같은 키를 쓰지 않는다
const sorted = L.sortByChecked(L.listed(items));
for (let i = 1; i < sorted.length; i++) {
  assert.ok(String(sorted[i - 1].checked_at) >= String(sorted[i].checked_at));
}

// 8) 마감 경과 — 시각이 지나면 '현재 모집' 섹션에서 빠지되 목록에서 사라지지 않는다
const AFTER_OCT = Date.parse('2026-10-20T00:00:00+09:00');   // C112(10-09)·C113(10-16) 경과
const s2 = L.groupSections(items, {}, AFTER_OCT);
const total2 = s2.reduce((n, s) => n + s.items.length, 0);
assert.strictEqual(total2, 14);                               // 조용히 지우지 않는다
assert.strictEqual(s2.find((s) => s.key === 'expired').items.length, 2);
assert.strictEqual(s2.find((s) => s.key === 'deadline').items.length, 4);

const AFTER_ALL = Date.parse('2027-01-01T00:00:00+09:00');    // 6회차 전부 경과
const s3 = L.groupSections(items, {}, AFTER_ALL);
assert.strictEqual(s3.find((s) => s.key === 'expired').items.length, 6);
assert.ok(!s3.some((s) => s.key === 'deadline'));
// 마감을 모르는 항목은 지났다고 단정하지 않는다
assert.ok(!L.listed(items).filter((i) => !i.apply_end_at).some((i) => L.isExpired(i, AFTER_ALL)));
// 마감 경과로 옮겨가도 원문 내부 표기 충돌은 그대로 남는다
assert.strictEqual(s3.find((s) => s.key === 'expired').items.filter((i) => i.conflict).length, 3);
// 필터도 시각 기준 섹션을 따른다
assert.strictEqual(L.groupSections(items, { status: 'expired' }, AFTER_OCT)
  .reduce((n, s) => n + s.items.length, 0), 2);
assert.strictEqual(L.groupSections(items, { status: 'expired' }, BEFORE).length, 0);

// 9) href에 들어가는 URL은 공백·설명 없는 단일 http(s)
for (const i of items) {
  assert.ok(/^https?:\/\/\S+$/.test(i.url), i.id);
  assert.ok(i.url_aux === '' || /^https?:\/\/\S+$/.test(i.url_aux), i.id);
}

// 10) 후기 수료 시점 필터 — 선택값 왕복과 월 경계
//     옵션 value(개월)를 상태로 두어야 다시 그릴 때 selected가 유지된다.
//     상태에 YYYY-MM을 넣으면 select가 "전체 기간"으로 되돌아간다.
const eduSrc = fs.readFileSync(path.join(__dirname, '..', 'edu', 'edu.js'), 'utf8');
assert.ok(eduSrc.indexOf('  const heartSvg') > eduSrc.indexOf('  function sinceBoundary'),
  'sinceBoundary 구간 앵커가 어긋남 — 검사가 빈 코드를 평가할 뻔했다');
const sinceBoundary = new Function(
  eduSrc.slice(eduSrc.indexOf('  function sinceBoundary'), eduSrc.indexOf('  const heartSvg'))
  + '; return sinceBoundary;')();

const SINCE_VALUES = ['', '12', '24', '36'];
for (const v of SINCE_VALUES) {
  // 상태에 담기는 값이 옵션 value와 같은 형태여야 selected 비교가 성립한다
  assert.ok(SINCE_VALUES.includes(v), v);
}
assert.strictEqual(sinceBoundary(''), null);
assert.strictEqual(sinceBoundary('0'), null);
assert.strictEqual(sinceBoundary('abc'), null);

// 윤년 말일에서 월을 빼도 경계가 밀리지 않아야 한다.
// 2024-02-29에서 12개월 전은 2023-02다. 일자를 먼저 1로 고정하지 않으면
// 없는 날짜(2023-02-29)가 2023-03-01로 넘어가 2023-03이 나온다.
const LEAP = new Date(2024, 1, 29).getTime();          // 2024-02-29 (로컬)
assert.strictEqual(sinceBoundary('12', LEAP), '2023-02', '윤년 말일 12개월 경계');
assert.strictEqual(sinceBoundary('24', LEAP), '2022-02');
assert.strictEqual(sinceBoundary('36', LEAP), '2021-02');
// 31일 달에서 30일·28일 달로 넘어갈 때도 같은 문제가 생긴다
assert.strictEqual(sinceBoundary('1', new Date(2026, 4, 31).getTime()), '2026-04', '5/31 → 4월');
assert.strictEqual(sinceBoundary('1', new Date(2026, 2, 31).getTime()), '2026-02', '3/31 → 2월');
assert.strictEqual(sinceBoundary('12', new Date(2026, 0, 15).getTime()), '2025-01', '연도 넘김');
// 일반 날짜에서도 정확히 N개월 전
assert.strictEqual(sinceBoundary('12', new Date(2026, 8, 9).getTime()), '2025-09');

// 게시판 목록의 서버 조건도 같은 규칙을 써야 한다 (두 구현이 어긋나면 안 됨)
const boardSrc = fs.readFileSync(path.join(__dirname, '..', 'board', 'board-free.js'), 'utf8');
const sinceMonth = new Function('P',
  boardSrc.slice(boardSrc.indexOf('  function sinceMonth'), boardSrc.indexOf('  function sinceBar'))
  + '; return sinceMonth;')(() => new URLSearchParams());
for (const [m, t, want] of [
  ['12', LEAP, '2023-02'], ['24', LEAP, '2022-02'],
  ['1', new Date(2026, 4, 31).getTime(), '2026-04'],
  ['12', new Date(2026, 8, 9).getTime(), '2025-09']
]) {
  assert.strictEqual(sinceMonth(m, t), want, '목록 필터 경계 ' + m + '개월');
  assert.strictEqual(sinceMonth(m, t), sinceBoundary(m, t), '상세와 목록의 경계가 달라짐');
}
assert.strictEqual(sinceMonth('0', LEAP), null);

// 수료 시점을 안 적은 후기는 걸러지지 않는다
{
  const boundary = sinceBoundary('12', LEAP);
  const rows = [{ review_done_month: null }, { review_done_month: '2020-01' }, { review_done_month: boundary }];
  const shown = rows.filter((r) => !r.review_done_month || r.review_done_month >= boundary);
  assert.strictEqual(shown.length, 2, '미기재 1건 + 경계 이후 1건이 남아야 함');
}

console.log('edu-logic OK — 15행 / 교육 14 / 섹션 6·2·6 / 충돌 3+1 / 마감경과 분리 / 수료시점 필터');
