// 에인연 업무 순수 로직 검사 — node tools/test-work-logic.js
'use strict';
const assert = require('assert');
const L = require('../work/work-logic.js');

// 금액: 부가세 세 방식
assert.deepStrictEqual(L.totals([{ name: '벽걸이', qty: 2, price: 50000 }], 'none'), { subtotal: 100000, supply: 100000, vat: 0, total: 100000 });
assert.deepStrictEqual(L.totals([{ name: '벽걸이', qty: 2, price: 50000 }], 'excl'), { subtotal: 100000, supply: 100000, vat: 10000, total: 110000 });
assert.deepStrictEqual(L.totals([{ name: '벽걸이', qty: 1, price: 110000 }], 'incl'), { subtotal: 110000, supply: 100000, vat: 10000, total: 110000 });
// 문자 섞인 입력·음수·빈 행 정리
assert.deepStrictEqual(L.cleanItems([{ name: ' 스탠드 ', qty: '1', price: '120,000원', unit: '대', kind: 'ac' }, { name: '', qty: 3, price: 0 }, { name: '할인', qty: 1, price: '-10,000' }]),
  [{ name: '스탠드', model: '', unit: '대', qty: 1, price: 120000, kind: 'ac' }, { name: '할인', model: '', unit: '', qty: 1, price: -10000 }]);
// 할인 줄(음수)은 합계에서 빼되 합계는 0 밑으로 안 내려간다
assert.strictEqual(L.totals([{ name: '벽걸이', qty: 1, price: 100000 }, { name: '할인', qty: 1, price: -10000 }], 'none').total, 90000);
assert.strictEqual(L.totals([{ name: '할인', qty: 1, price: -10000 }], 'none').total, 0);
assert.strictEqual(L.won(1234567), '1,234,567원');

// 수금 이력(계약금·잔금) → 받은 금액·미수금. 미수금은 완료 건만
const pay = (arr) => arr.map(([amount, at, method]) => ({ amount, at, method }));
assert.strictEqual(L.paid({ payments: pay([[30000, '2026-09-01', 'transfer'], [20000, '2026-09-05', 'cash']]) }), 50000);
assert.strictEqual(L.unpaid({ status: 'done', total_amount: 100000, payments: pay([[30000, '2026-09-01', 'transfer']]) }), 70000);
assert.strictEqual(L.unpaid({ status: 'booked', total_amount: 100000, payments: [] }), 0);
assert.strictEqual(L.unpaid({ status: 'canceled', total_amount: 100000 }), 0);
assert.strictEqual(L.unpaid({ status: 'done', total_amount: 100000, payments: pay([[150000, '', 'etc']]) }), 0);
assert.deepStrictEqual(L.cleanPayments([{ amount: '-5' }, { amount: '1,000', at: '2026-09-01T00:00', method: 'x' }]), [{ amount: 1000, at: '2026-09-01', method: 'etc' }]);
assert.deepStrictEqual(L.lastPrices([
  { updated_at: '2026-09-01', items: [{ name: '벽걸이', qty: 1, price: 80000 }] },
  { updated_at: '2026-09-20', items: [{ name: '벽걸이', qty: 1, price: 90000 }, { name: '할인', qty: 1, price: -5000 }] }]), { '벽걸이': 90000 });

// 날짜
assert.strictEqual(L.dayKey(new Date(2026, 8, 5, 23, 59)), '2026-09-05');
assert.strictEqual(L.dayKey(L.addMonths(new Date(2026, 0, 31), 1)), '2026-02-28', '월말 보정');
assert.strictEqual(L.fmtTime(new Date(2026, 8, 5, 14, 30)), '오후 2:30');
assert.strictEqual(L.fmtTime(new Date(2026, 8, 5, 0, 0)), '오전 12:00');
assert.strictEqual(L.fmtTime(new Date(), true), '종일');
const iso = L.combineDateTime('2026-09-26', '13:30');
assert.strictEqual(new Date(iso).getHours(), 13);
assert.strictEqual(L.dayKey(iso), '2026-09-26');
const grid = L.monthGrid(2026, 8); // 2026-09
assert.strictEqual(grid.length, 6);
assert.strictEqual(grid[0][0].key, '2026-08-30', '9월 1일(화) 앞 일요일부터');
assert.ok(grid.flat().filter((c) => c.inMonth).length === 30);

// 같은 날: 종일 먼저, 그다음 시간순
const day = L.groupByDay([
  { id: 1, scheduled_at: new Date(2026, 8, 26, 15).toISOString() },
  { id: 2, scheduled_at: new Date(2026, 8, 26, 9).toISOString() },
  { id: 3, scheduled_at: new Date(2026, 8, 26, 0).toISOString(), all_day: true },
  { id: 4, scheduled_at: null }
]);
assert.deepStrictEqual(day['2026-09-26'].map((j) => j.id), [3, 2, 1]);
assert.deepStrictEqual(day.none.map((j) => j.id), [4]);

// 이달 요약
const S = L.monthSummary([
  { status: 'done', total_amount: 100000, payments: pay([[100000, '2026-09-03', 'transfer']]), completed_at: '2026-09-03T02:00:00Z' },
  { status: 'done', total_amount: 50000, payments: [], completed_at: '2026-09-10T02:00:00Z' },
  { status: 'done', total_amount: 70000, payments: pay([[20000, '2026-08-28', 'cash']]), completed_at: '2026-08-28T02:00:00Z' },
  { status: 'booked', total_amount: 90000, scheduled_at: '2026-09-20T02:00:00Z' },
  { status: 'canceled', total_amount: 90000, scheduled_at: '2026-09-21T02:00:00Z' }
], '2026-09');
assert.deepStrictEqual(S, { doneAmount: 150000, doneCount: 2, bookedCount: 1, unpaidAmount: 100000, unpaidCount: 2 });
const y12 = L.last12([{ status: 'done', total_amount: 100000, completed_at: new Date(2026, 8, 3).toISOString() },
  { status: 'done', total_amount: 50000, completed_at: new Date(2025, 9, 3).toISOString() },
  { status: 'done', total_amount: 70000, completed_at: new Date(2025, 8, 3).toISOString() }], new Date(2026, 8, 26));
assert.strictEqual(y12.length, 12); assert.strictEqual(y12[0].ym, '2025-10'); assert.strictEqual(y12[11].ym, '2026-09');
assert.strictEqual(y12[0].amount, 50000); assert.strictEqual(y12[11].amount, 100000, '12개월 밖(2025-09)은 제외');
assert.deepStrictEqual(L.halfYear([{ status: 'done', total_amount: 10, completed_at: new Date(2026, 6, 1).toISOString() },
  { status: 'done', total_amount: 99, completed_at: new Date(2026, 5, 30).toISOString() }], new Date(2026, 8, 26)), { label: '2026년 7~12월', amount: 10, count: 1 });
assert.deepStrictEqual(L.bySource([{ status: 'done', total_amount: 30, source: 'soomgo', completed_at: new Date(2026, 8, 1).toISOString() },
  { status: 'done', total_amount: 50, completed_at: new Date(2026, 8, 2).toISOString() }], new Date(2026, 8, 26)).map((r) => r.label), ['미기록', '숨고']);

// 시간 겹침 (설치 기본 4시간)
const ov = L.overlaps({ id: 9, work_type: 'clean', scheduled_at: new Date(2026, 8, 26, 11).toISOString() },
  [{ id: 1, work_type: 'install', status: 'booked', scheduled_at: new Date(2026, 8, 26, 9).toISOString() },
   { id: 2, work_type: 'clean', status: 'booked', scheduled_at: new Date(2026, 8, 26, 13).toISOString() },
   { id: 3, work_type: 'install', status: 'canceled', scheduled_at: new Date(2026, 8, 26, 10).toISOString() }]);
assert.deepStrictEqual(ov.map((j) => j.id), [1]);

// 재방문: 6개월 주기 → 마지막 완료 + 6개월이 오늘+14일 안이면 대상
const today = new Date(2026, 8, 26);
const due = L.revisitDue(
  [{ id: 1, name: 'A', revisit_months: 6 }, { id: 2, name: 'B', revisit_months: 12 }, { id: 3, name: 'C', revisit_months: null }],
  [{ customer_id: 1, status: 'done', completed_at: new Date(2026, 2, 30).toISOString() },
   { customer_id: 1, status: 'canceled', scheduled_at: new Date(2026, 7, 1).toISOString() },
   { customer_id: 2, status: 'done', completed_at: new Date(2026, 2, 1).toISOString() },
   { customer_id: 3, status: 'done', completed_at: new Date(2025, 0, 1).toISOString() }],
  today, 14);
assert.deepStrictEqual(due.map((r) => r.customer.id), [1]);
// 미뤄 둔 고객·다음 예약이 이미 잡힌 고객은 명단에서 빠진다
assert.deepStrictEqual(L.revisitDue([{ id: 1, revisit_months: 6, revisit_snooze_until: '2026-10-26' }],
  [{ customer_id: 1, status: 'done', completed_at: new Date(2026, 2, 30).toISOString() }], today, 14), []);
assert.deepStrictEqual(L.revisitDue([{ id: 1, revisit_months: 6 }],
  [{ customer_id: 1, status: 'done', completed_at: new Date(2026, 2, 30).toISOString() },
   { customer_id: 1, status: 'booked', scheduled_at: new Date(2026, 9, 2).toISOString() }], today, 14), []);

// 지역: DB 두 표기 모두 짧은 표기로
assert.deepStrictEqual(L.parseRegion('인천광역시 서구 청라동 123'), { sido: '인천', sigungu: '서구' });
assert.deepStrictEqual(L.parseRegion('경기도 수원시 영통구 광교로 1'), { sido: '경기', sigungu: '수원시 영통구' });
assert.deepStrictEqual(L.parseRegion('경기 광주시 오포읍'), { sido: '경기', sigungu: '광주시' });
assert.deepStrictEqual(L.parseRegion('광주 북구 용봉동'), { sido: '광주', sigungu: '북구' });
assert.deepStrictEqual(L.parseRegion('광주시 오포읍'), { sido: null, sigungu: '광주시' });
assert.deepStrictEqual(L.parseRegion('수원시 영통구 광교로 1'), { sido: null, sigungu: '수원시 영통구' });
assert.deepStrictEqual(L.parseRegion('충남 천안시 서북구'), { sido: '충남', sigungu: '천안시 서북구' });
assert.deepStrictEqual(L.parseRegion('검단 A단지 1204호'), { sido: null, sigungu: null });
assert.strictEqual(L.normSido('경기도'), '경기');
assert.strictEqual(L.normSido('서울특별시'), '서울');
assert.strictEqual(L.normSido('충남'), '충남');

// 표시·연락
assert.strictEqual(L.maskName('홍길동'), '홍*동');
assert.strictEqual(L.maskName('남궁민수'), '남**수');
assert.strictEqual(L.maskName('김철'), '김*');
assert.strictEqual(L.maskName(''), '고객');
assert.strictEqual(L.fmtPhone('01012345678'), '010-1234-5678');
assert.strictEqual(L.fmtPhone('0212345678'), '02-1234-5678');
assert.strictEqual(L.fmtPhone('0311234567'), '031-123-4567');
assert.strictEqual(L.normPhone('010-1234-5678'), '01012345678');
assert.strictEqual(L.normPhone('1234'), null);
assert.ok(L.matchCustomer({ name: '홍길동', phone: '01012345678' }, '5678'), '뒷번호 검색');
assert.ok(L.matchCustomer({ name: '홍길동', phone: '01012345678' }, '길동'));
assert.ok(!L.matchCustomer({ name: '홍길동', phone: '01012345678' }, '9999'));
assert.deepStrictEqual(L.findByPhone([{ id: 1, phone: '01012345678' }, { id: 2, phone: null }], '010 1234 5678').map((c) => c.id), [1]);
assert.strictEqual(L.smsHref('010-1234-5678', '안녕 &'), 'sms:01012345678?&body=%EC%95%88%EB%85%95%20%26');
assert.ok(L.mapHref('인천 서구 청라동').startsWith('https://map.kakao.com/link/search/'));
assert.ok(L.smsText('remind', { scheduled_at: new Date(2026, 8, 26, 10).toISOString() }, { name: '김고객' }, { biz_name: '시원설비' }).includes('9월 26일 (토) 오전 10:00'));
assert.strictEqual(L.smsText('pay', { status: 'done', total_amount: 100000, payments: pay([[30000, '', 'cash']]) }, { name: '김고객' }, { biz_name: '시원설비', account: '농협 123' }),
  '[시원설비] 김고객님, 작업 대금 70,000원 입금 부탁드립니다. 농협 123');
assert.ok(L.smsText('revisit', null, { name: '김' }, { biz_name: 'A' }).startsWith('(광고) [A] 김님'), '재방문 안내는 광고 표시');
assert.ok(L.smsText('revisit', null, { name: '김' }, { biz_name: 'A' }).includes('수신거부'));
assert.ok(L.smsText('remind', {}, { name: '김' }, {}).startsWith('김님'), '상호가 비면 [] 없이');
const ics = L.icsFor({ id: 7, work_type: 'clean', scheduled_at: new Date(Date.UTC(2026, 9, 1, 5, 0)).toISOString(), address: '인천 서구, 청라동', memo: 'a;b' }, { name: '김', phone: '01012345678' }, {});
assert.ok(ics.includes('DTSTART:20261001T050000Z') && ics.includes('DTEND:20261001T063000Z'), '세척 기본 90분');
assert.ok(ics.includes('LOCATION:인천 서구\\, 청라동') && ics.includes('TRIGGER:-PT1H') && ics.includes('a\\;b'));
assert.strictEqual(L.icsFor({ scheduled_at: null }), null);
assert.strictEqual(L.smsText('arrive', {}, { name: '김' }, { biz_name: 'A', sms_templates: { arrive: '{고객}님 {상호} 도착 {없는키}' } }), '김님 A 도착 {없는키}', '업체가 고친 문구');
assert.ok(L.smsText('done', {}, {}, {}, { link: 'https://ainyeon.com/c/#t=x' }).endsWith('https://ainyeon.com/c/#t=x'));
const blog = L.blogDraft({ address: '인천 서구 청라동', work_type: 'clean', completed_at: new Date(2026, 8, 20).toISOString(),
  items: [{ name: '벽걸이', qty: 2, unit: '대', price: 80000 }], checklist: [{ label: '사용 약품', value: '중성 세정제' }, { label: '냄새 확인', value: '' }] },
  {}, { biz_name: '시원설비', phone: '01099990000' }, '에어컨 세척');
assert.ok(blog.startsWith('[제목] 인천 서구 에어컨 세척 세척·청소 후기'));
assert.ok(blog.includes('벽걸이 2대') && blog.includes('사용 약품: 중성 세정제') && !blog.includes('냄새 확인'));
assert.ok(blog.includes('010-9999-0000') && !blog.includes('80000'), '블로그 초안에 단가 없음');

// 요금제 보기
let pv = L.planView(true, null, new Date('2026-10-01T00:00:00+09:00'));
assert.strictEqual(pv.label, '베타 프로'); assert.strictEqual(pv.inBeta, true);
assert.strictEqual(pv.betaEndLabel, '2027년 4월 30일', '베타 마지막 날 표기');
pv = L.planView(false, { current_period_end: '2027-04-01T00:00:00+09:00' }, new Date('2027-06-01T00:00:00+09:00'));
assert.strictEqual(pv.label, '무료'); assert.strictEqual(pv.until, null);
pv = L.planView(true, { current_period_end: '2027-07-01T00:00:00+09:00' }, new Date('2027-06-01T00:00:00+09:00'));
assert.strictEqual(pv.label, '프로'); assert.ok(pv.until);
assert.ok(L.limitMessage({ message: 'plan_photos' }).includes('프로'));
assert.ok(L.limitMessage({ message: 'photo_limit_job' }).includes(String(L.PLAN.pro.photosPerJob)));
assert.strictEqual(L.limitMessage({ message: 'other' }), null);

// 검증
assert.deepStrictEqual(L.validateJob({ customer_name: '', status: 'booked' }), ['고객 이름이나 전화번호를 적어 주세요.', '일정을 정해 주세요.']);
assert.deepStrictEqual(L.validateJob({ customer_id: 3, status: 'inquiry' }), []);
assert.deepStrictEqual(L.validateJob({ customer_phone: '010-1', status: 'quote' }), ['고객 이름이나 전화번호를 적어 주세요.', '전화번호 형식을 확인해 주세요.']);

// 붙여넣기 해석 (카톡·숨고 메시지)
const today2 = new Date(2026, 8, 26, 10);
assert.deepStrictEqual(L.parsePaste('안녕하세요 에어컨 청소 문의요\n성함: 김민지\n010-2345-6789\n인천 서구 청라동 123-4 101동 1203호\n10월 2일 오후 2시 가능할까요?', today2),
  { phone: '01023456789', date: '2026-10-02', time: '14:00', address: '인천 서구 청라동 123-4 101동 1203호', name: '김민지' });
assert.deepStrictEqual(L.parsePaste('내일 3시 반 가능? 01012345678', today2), { phone: '01012345678', date: '2026-09-27', time: '15:30' });
assert.strictEqual(L.parsePaste('1/5 오전 10시', new Date(2026, 11, 20)).date, '2027-01-05', '연말에 받은 1월 날짜는 내년');
assert.deepStrictEqual(L.parsePaste('그냥 인사', today2), {});
// 리뷰에서 찾은 오인식: 전화번호 숫자·금액·"5시간"을 날짜·시간으로 읽지 않는다, 연도 표기는 읽는다
assert.deepStrictEqual(L.parsePaste('010.2345.6789 연락주세요', today2), { phone: '01023456789' });
assert.deepStrictEqual(L.parsePaste('견적 9.5만원이요', today2), {});
assert.deepStrictEqual(L.parsePaste('5시간 걸려요?', today2), {});
assert.deepStrictEqual(L.parsePaste('2026.10.2 오전 10시', today2), { date: '2026-10-02', time: '10:00' });
assert.deepStrictEqual(L.parsePaste('10월 2일 오후 2시 010-1111-2222', today2), { phone: '01011112222', date: '2026-10-02', time: '14:00' });


// CSV: BOM, 따옴표, 수식 주입 차단
assert.strictEqual(L.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
assert.strictEqual(L.csvCell('-5'), "'-5");
assert.strictEqual(L.csvCell('a,b'), '"a,b"');
const csv = L.jobsCsv([{ customer_id: 1, status: 'done', scheduled_at: new Date(2026, 8, 26, 10).toISOString(), items: [{ name: '벽걸이', qty: 2, unit: '대', price: 50000 }], total_amount: 100000,
  payments: pay([[40000, '2026-09-26', 'transfer']]), field: 'ac-clean', work_type: 'clean', source: 'soomgo' }],
  { 1: { name: '김고객', phone: '01011112222', card_token: 'SECRETSECRETSECRETSECR' } }, { 'ac-clean': '에어컨 세척' });
assert.ok(csv.startsWith('\ufeff일정,상태,고객'));
assert.ok(csv.includes('완료,김고객,010-1111-2222'));
assert.ok(csv.includes('에어컨 세척,세척·청소,벽걸이 x2대,100000,40000,60000,2026-09-26 이체 40000,숨고'));
assert.ok(!csv.includes('SECRET'), 'CSV에 시공 카드 토큰 없음');
const ccsv = L.customersCsv([{ id: 1, name: '김', phone: '01011112222', created_at: '2026-01-01T00:00:00Z' }],
  [{ customer_id: 1, status: 'done', completed_at: new Date(2026, 5, 1).toISOString() }]);
assert.ok(ccsv.includes('김,010-1111-2222,,2026-06-01'));

// CSV 읽기·가져오기 (따옴표 안 쉼표·줄바꿈, BOM, 같은 번호 합치기)
const rows = L.parseCsv('\ufeff고객명,연락처,주소,최근 서비스일,메모\r\n홍길동,010-1111-2222,"인천 서구, 청라동",2025.07.03,"벽걸이\n2대"\r\n홍길동,01011112222,,2026-07-10,재방문\r\n,,,\r\n김철수,02-123-4567,,,\r\n');
assert.strictEqual(rows.length, 4);
assert.strictEqual(rows[1][2], '인천 서구, 청라동');
const im = L.mapImport(rows);
assert.deepStrictEqual(im.cols, { name: 0, phone: 1, address: 2, memo: 4, last: 3 });
assert.strictEqual(im.customers.length, 2);
assert.strictEqual(im.customers[0].last, '2026-07-10', '같은 번호는 최근 작업일');
assert.strictEqual(im.customers[0].memo, '벽걸이\n2대 / 재방문');
assert.strictEqual(im.customers[1].phone, '021234567');
assert.strictEqual(im.skipped, 0);
assert.strictEqual(L.mapImport(L.parseCsv('성명,전화\n홍길동,01012345678')).customers[0].name, '홍길동', '성명 머리글');
assert.ok(L.jobsCsv([], {}, {}).includes('완료일,부가세,보증(개월),확인 항목'), 'CSV에 완료일·부가세·보증·확인 항목');
assert.strictEqual(L.checklistFor('ac-install', 'install')[0], '배관 길이(m)');
assert.deepStrictEqual(L.checklistFor('tile', 'repair'), []);
assert.strictEqual(L.durationOf({ work_type: 'install' }), 240);
assert.strictEqual(L.durationOf({ work_type: 'install', duration_min: 30 }), 30);

// 품목 빠른 선택
assert.strictEqual(L.presetKey('ac-clean'), 'ac');
assert.strictEqual(L.presetKey('movein-clean'), 'clean');
assert.strictEqual(L.presetKey('grout'), 'clean');
assert.strictEqual(L.presetKey('tile'), 'interior');
assert.strictEqual(L.presetKey(null), 'etc');

console.log('test-work-logic: OK');
