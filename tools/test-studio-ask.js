// 스튜디오 '말로 시키기'(maker/3d/ask.js) — 정해진 말을 알아듣는 방식. 말 → 동작(acts)과 안내(reply), 어휘 밖의 동작은 없다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const A = require('../maker/3d/ask.js');
const base = { hasFile: false, hasResult: false, session: false, rooms: ['전체', '거실', '침실1', '침실2', '주방'] };
const P = (s, o) => A.parse(s, Object.assign({}, base, o || {}));
const has = (r, a) => r.acts.some((x) => Object.keys(a).every((k) => x[k] === a[k]));

assert.ok(has(P('거실 보여줘'), { do: 'room', v: '거실' }), '방 이름으로 이동');
assert.ok(has(P('침실 보여줘'), { do: 'room', v: '침실1' }), '번호 없는 침실은 첫 침실');
assert.ok(has(P('침실2 좀 볼래'), { do: 'room', v: '침실2' }), '번호가 있으면 그 방');
assert.ok(has(P('처음으로 돌아가'), { do: 'room', v: '전체' }), '전체로');
assert.ok(has(P('삼성으로 해줘'), { do: 'opt', k: 'brand', v: 'samsung' }) && has(P('LG로'), { do: 'opt', k: 'brand', v: 'lg' }) && has(P('엘지로'), { do: 'opt', k: 'brand', v: 'lg' }), '제조사');
assert.ok(has(P('우드 톤으로'), { do: 'opt', k: 'style', v: 'wood' }) && has(P('흰색으로'), { do: 'opt', k: 'style', v: 'white' }), '마감 톤');
assert.ok(has(P('저녁으로 해줘'), { do: 'opt', k: 'mood', v: 'evening' }) && has(P('낮으로'), { do: 'opt', k: 'mood', v: 'day' }), '시간');
{ const r = P('사진처럼 받을래'); assert.ok(has(r, { do: 'out', v: 'photo' }) && !has(r, { do: 'pickFile' }), '받을 것을 고를 때 파일 대화상자를 열지 않는다'); }
assert.ok(has(P('디자인 제안으로'), { do: 'out', v: 'design' }) && has(P('도면대로 할래'), { do: 'out', v: 'cg' }), '받을 것 셋');
assert.ok(has(P('도면 넣을게'), { do: 'pickFile' }), '도면 넣기 = 파일 고르기');
{ const r = P('도면 넣을게', { hasFile: true }); assert.ok(!has(r, { do: 'pickFile' }) && /이미 넣은 도면/.test(r.reply), '이미 넣었으면 바꾸는 법을 말한다'); }
{ const r = P('만들어 줘'); assert.ok(/도면을 먼저/.test(r.reply) && has(r, { do: 'pickFile' }) && !has(r, { do: 'make' }), '도면 없이 만들기 → 먼저 넣게'); }
{ const r = P('만들어 줘', { hasFile: true }); assert.ok(/카카오 로그인/.test(r.reply) && !has(r, { do: 'make' }), '로그인 없이는 만들기를 누르지 않는다'); }
assert.ok(has(P('만들어 줘', { hasFile: true, session: true }), { do: 'make' }), '로그인한 상태에서 만들기');
{ const r = P('도면대로 만들어줘', { hasFile: true, session: true }); assert.deepStrictEqual(r.acts.map((x) => x.do), ['out', 'make'], '받을 것을 정한 뒤 만든다(순서)'); }
{ const r = P('물량표 보여줘'); assert.ok(/결과가 나온 뒤/.test(r.reply) && !has(r, { do: 'sum' }), '결과가 없으면 물량표로 보내지 않는다'); }
assert.ok(has(P('물량표 보여줘', { hasResult: true }), { do: 'sum' }), '결과가 있으면 물량표로');
assert.ok(has(P('지우개 열어줘'), { do: 'tool', v: '지우개' }) && has(P('배경 떼기'), { do: 'tool', v: '배경 떼기' }) && has(P('자르기 할래'), { do: 'tool', v: '자르기' }), '사진 손질 도구');
assert.ok(has(P('사용법 알려줘'), { do: 'tour' }), '사용법');
assert.deepStrictEqual(P('   '), { reply: '', acts: [] }, '빈 말은 아무것도 안 한다');
assert.ok(/알아듣지 못합니다/.test(P('ㅋㅋㅋ').reply) && P('ㅋㅋㅋ').acts.length === 0, '모르는 말은 솔직하게');
assert.ok(/또 말씀/.test(P('고마워').reply), '인사');
assert.ok(/모형이 열리면/.test(P('거실 보여줘', { rooms: [] }).reply), '모형이 아직 없으면 그렇게 말한다');
{ const s = A.suggest(base); assert.ok(s.length >= 3 && s.length <= 5 && s[0] === '거실 보여줘' && s.every((x) => typeof x === 'string'), '예시 문장은 상태에 맞게 최대 5개'); }
// 어휘 밖의 동작은 없다 — 모든 말 조합이 정해진 동작 종류와 값만 낸다
const DO = new Set(['out', 'opt', 'room', 'tool', 'sum', 'tour', 'make', 'pickFile']);
for (const s of ['삼성 우드 저녁 사진처럼 만들어줘', '<script>alert(1)</script> 거실', '도면 파일 사진 올려 넣어', '침실 욕실 방', '../../etc/passwd 사용법']) {
  const r = P(s, { hasFile: true, session: true, hasResult: true });
  assert.ok(r.acts.every((a) => DO.has(a.do) && (a.v == null || typeof a.v === 'string')), '동작 어휘 밖의 것이 없다: ' + s);
}
// 시키는 말만 실행한다 — 묻는 말·부정·일상어는 눌러선 안 되는 것을 누르지 않는다(리뷰에서 나온 실제 입력)
const full = { hasFile: true, session: true, canMake: true };
const none = (s, o) => { const r = P(s, Object.assign({}, full, o || {})); assert.ok(!r.acts.some((a) => a.do === 'make'), '만들기를 누르면 안 된다: ' + s); return r; };
for (const s of ['시작하지 마', '만들어도 돼?', '카메라 돌려줘', '모형 돌려서 보여줘', '진행 상황 알려줘', '만들어진 거 보여줘', '제작 시간 얼마나 걸려', '이거 어떻게 만들어?', '시작 화면으로', '다 만들어졌어?', '생성된 결과 보여줘', '제작 방법 알려줘', '처음으로 돌려줘']) none(s);
for (const s of ['만들어 줘', '만들기 눌러줘', '만들기', '만들자', '만들게', '시작해줘', '생성해줘', '삼성으로 해서 만들어줘']) assert.ok(has(P(s, full), { do: 'make' }), '만들기: ' + s);
assert.ok(has(P('삼성 말고 lg로 만들어줘', full), { do: 'opt', k: 'brand', v: 'lg' }) && has(P('삼성 말고 lg로 만들어줘', full), { do: 'make' }), '말고 뒤의 값으로 만든다');
assert.ok(!has(P('만들어줘', Object.assign({}, full, { canMake: false })), { do: 'make' }), '결과를 보는 중·진행 중에는 만들기를 누르지 않는다');
assert.ok(!P('시작하지 마', full).acts.length && /실행하지 않습니다/.test(P('시작하지 마', full).reply), '부정은 아무것도 하지 않는다');
assert.ok(P('삼성이랑 LG 비교해줘', full).acts.length === 0 && /하나만/.test(P('삼성이랑 LG 비교해줘', full).reply), '두 값을 함께 말하면 고르게 한다');
// 'X 말고 Y' — Y 를 고른다
for (const [s, a] of [['LG 말고 삼성', { k: 'brand', v: 'samsung' }], ['삼성 말고 LG', { k: 'brand', v: 'lg' }], ['삼성이 아니라 엘지로', { k: 'brand', v: 'lg' }], ['우드 말고 화이트', { k: 'style', v: 'white' }], ['화이트 말고 우드', { k: 'style', v: 'wood' }], ['낮 말고 저녁', { k: 'mood', v: 'evening' }], ['저녁 말고 낮으로', { k: 'mood', v: 'day' }]]) assert.ok(has(P(s, full), Object.assign({ do: 'opt' }, a)) && P(s, full).acts.length === 1, s);
assert.ok(has(P('도면대로 말고 사진처럼', full), { do: 'out', v: 'photo' }), '받을 것도 말고 뒤');
assert.ok(P('삼성 말고', full).acts.length === 0 && /무엇으로/.test(P('삼성 말고', full).reply), '말고 뒤가 비면 되묻는다');
// 짧은 낱말은 낱말로만 맞는다
for (const s of ['온도를 낮춰줘', '낮춰줘', '낮은 천장', '밤새 돌려줘', '밤색 우드', '집 디자인 어때', '디자인 좋네', '배경을 화이트로']) assert.ok(!P(s, full).acts.some((a) => (a.k === 'mood' || a.do === 'out' || a.do === 'tool')), '엉뚱한 설정이 눌리면 안 된다: ' + s);
assert.ok(has(P('나 무엇을 할 수 있어?', full), { do: 'tour' }) && !P('나 무엇을 할 수 있어?', full).acts.some((a) => a.k === 'style'), '나무로 읽지 않는다');
// 파일 창은 올리겠다는 말에만 — 다른 말과 같이 쓰여도 열리지 않는다
const noFile = { hasFile: false, session: true };
for (const s of ['거실 사진 보여줘', '우드 톤 넣어줘', '삼성 넣어줘', 'LG 제품 넣어줘', '사진 지우개 열어줘', '침실2 사진', '톤 올려줘', '도면 보여줘', '물량표 넣어줘', '전체 도면 올릴게 ㅋ']) {
  const r = P(s, noFile); if (s === '전체 도면 올릴게 ㅋ') assert.ok(has(r, { do: 'pickFile' })); else assert.ok(!has(r, { do: 'pickFile' }), '파일 창이 열리면 안 된다: ' + s);
}
for (const s of ['도면대로 올릴게', '사진처럼 도면 올릴게', '디자인 제안으로 파일 올릴게', '도면 올려줘', '파일 고르기']) assert.ok(has(P(s, noFile), { do: 'pickFile' }), '올리기 요청을 버리지 않는다: ' + s);
assert.ok(has(P('도면대로 올릴게', noFile), { do: 'out', v: 'cg' }), '받을 것과 올리기를 함께');
// 방 이름은 정확히 맞는 방, 말한 순서에서 마지막 / 없는 방은 없다고 말한다
const r3 = { rooms: ['전체', '거실', '침실1', '침실2', '침실3', '주방'] };
for (const [s, v] of [['침실3 보여줘', '침실3'], ['주방 말고 거실', '거실'], ['주방 보여주고 거실로', '거실'], ['침실2 말고 침실3', '침실3'], ['침실 보여줘', '침실1'], ['전체 보여줘', '전체']]) assert.ok(has(P(s, r3), { do: 'room', v }) && P(s, r3).acts.length === 1, s);
for (const s of ['침실4 보여줘', '안방 보여줘', '사용 방법 알려줘', '방금 한 거 취소', '방향 바꿔줘']) assert.ok(!P(s, r3).acts.some((a) => a.do === 'room'), '엉뚱한 방으로 가면 안 된다: ' + s);
assert.ok(/그 방은 없습니다/.test(P('침실4 보여줘', r3).reply), '없는 방은 없다고 말한다');
assert.ok(has(P('침실10 보여줘', { rooms: ['전체', '침실1', '침실10'] }), { do: 'room', v: '침실10' }) && has(P('침실1 보여줘', { rooms: ['전체', '침실1', '침실10'] }), { do: 'room', v: '침실1' }), '침실1 과 침실10 을 구별한다');
assert.ok(has(P('방 보여줘', { rooms: ['전체', '거실', '방1', '방2', '방10'] }), { do: 'room', v: '방1' }), '방N 은 번호가 가장 작은 방');
for (const s of ['전체를 삼성으로 해줘', '전체적으로 우드로']) assert.ok(!P(s, r3).acts.some((a) => a.do === 'room'), '전체 보기로 옮기면 안 된다: ' + s);
// 조사 · 부호 · 파트너 화면
assert.ok(/침실3으로/.test(P('침실3 보여줘', r3).reply) && /침실1로/.test(P('침실1', r3).reply) && /침실10으로/.test(P('침실10', { rooms: ['침실10'] }).reply), '숫자로 끝나는 방 이름의 조사');
for (const s of ['?', '...', '!!']) assert.ok(P(s).reply && P(s).acts.length === 0, '부호뿐인 입력도 답한다: ' + s);
{ const r = P('지우개 열어줘', { tools: false }); assert.ok(!r.acts.length && /쓰지 않습니다/.test(r.reply), '도구가 없는 화면에서는 연다고 답하지 않는다'); }
// ── 회귀 말뭉치: 두 번의 독립 리뷰(47건)에서 나온 실제 입력. 값 선택은 되돌릴 수 있어도 말한 것과 반대로 눌리면 안 된다.
const F = { hasFile: true, session: true, canMake: true, rooms: ['전체', '거실', '침실1', '침실2', '주방'] }, NF = { hasFile: false, session: true, rooms: F.rooms };
const acts = (s, c) => P(s, c || F).acts, kinds = (s, c) => acts(s, c).map((a) => a.do + (a.k ? ':' + a.k : '') + (a.v ? '=' + a.v : '')).join(' ');
const NOACT = (list, c) => list.forEach((s) => assert.strictEqual(kinds(s, c), '', '아무것도 하면 안 된다: ' + s));
const ONLY = (list, want, c) => list.forEach((s) => assert.strictEqual(kinds(s, c), want, s + ' → ' + want));
// 되돌릴 수 없는 만들기: 말이 누르지 않고(ASK_DO.make 가 초점만), 명령형이 아니면 준비도 하지 않는다
NOACT(['시작하지 마', '만들어도 돼?', '카메라 돌려줘', '모형 돌려서 보여줘', '진행 상황 알려줘', '만들어진 거 보여줘', '제작 시간 얼마나 걸려', '시작 화면으로', '다 만들어졌어?', '생성된 결과 보여줘', '제작 방법 알려줘', '안 만들어', '안 만들어줘', '안 시작해', '만들어?', '시작해?', '진행해?', '만들어요?']);
NOACT(['삼성 LG 둘 다 만들어줘', '도면대로 사진처럼 만들어줘', '화이트랑 우드 만들어줘', '낮이랑 저녁 둘 다 만들어줘', '삼성 말고 만들어줘']);
NOACT(['견적 만들어줘', '엑셀 만들어줘', '물량표 만들어줘', 'csv 만들어줘'], Object.assign({}, F, { hasResult: false }));
ONLY(['사용법 만들어줘', '사용법 시작해', '둘러보기 시작해'], 'tour');   // 사용법을 열 뿐 만들기를 준비하지 않는다
ONLY(['만들어 줄래', '만들어줄래', '만들어 주십시오', '만들어주셈', '시작하세요', '시작합시다', '설정 안 해도 되니까 만들어줘', '그만하고 만들어줘', '취소하고 다시 만들어줘', '만들기 눌러줘'], 'make');
ONLY(['삼성으로 해서 만들어줘', '삼성 말고 lg로 만들어줘'].slice(0, 1), 'opt:brand=samsung make');
// 부정·제외는 그 값을 고르지 않는다 / 말고·아니라 는 뒤의 값
NOACT(['삼성 안 할래', '삼성 안 쓸래', '삼성 안 써', '삼성은 빼', '삼성 빼줘', '삼성 제외', '삼성 아님', '삼성은 아니야', '삼성 별로야', '삼성 안 좋아', '삼성 아닌 걸로', '디자인으로 안 할래', '도면대로 안 할래', '사진처럼은 안 할래', '우드 안 할래', '저녁 안 할래', '디자인 안 좋아', '디자인 안 예뻐', '디자인 안 바꿔', '거실 안 볼래']);
ONLY(['삼성 아냐 LG야', '삼성은 싫고 LG로 해줘', '삼성으로 하지 말고 LG로 해줘', '취소하고 LG로 해줘'], 'opt:brand=lg');
ONLY(['우드 하지 말고 화이트로 해줘', '우드 톤은 싫고 화이트로 해줘', '우드는 하지 말고 화이트로'], 'opt:style=white');
ONLY(['낮으로 하지 말고 저녁으로 해줘'], 'opt:mood=evening'); ONLY(['도면대로 하지 말고 사진처럼 받을래'], 'out=photo');
ONLY(['지우개 말고 자르기 열어줘'], 'tool=자르기'); ONLY(['지우개 대신 색보정 열어줘'], 'tool=색'); ONLY(['지우개가 아니라 자르기'], 'tool=자르기'); ONLY(['색보정 말고 지우개', '배경 떼기 말고 지우개'], 'tool=지우개');
ONLY(['물량표 말고 거실 보여줘', '사용법 말고 거실 보여줘', '거실 그만 보고 주방 보여줘', '방금 한 거 취소하고 거실 보여줘'].slice(0, 2), 'room=거실');
// 둘을 이어 말하면(이랑·와/과·하고·이나) 고르게 한다
for (const s of ['삼성이랑 LG', '삼성과 LG 비교해줘', '삼성하고 LG 비교', '삼성이나 LG로 해줘', '삼성과 엘지 중에 골라줘', '우드와 화이트 비교해줘', '우드하고 화이트', '우드나 화이트로 해줘', '낮과 저녁 비교해줘', '낮하고 밤']) { assert.strictEqual(kinds(s), '', s); assert.ok(/하나만/.test(P(s, F).reply), s + ' → 되묻는다'); }
// 묻는 말(존재·가능·물음표)은 값을 바꾸지 않고, 부탁하는 말은 실행한다
NOACT(['삼성도 있나요', '삼성은 없나요', '삼성 모델도 있나요', '삼성도 있어', '삼성으로 할까요', '삼성이 좋을까요', '삼성이 낫냐', '저녁으로 바꿀까요', '삼성으로 하나요', '거실 볼 수 있나요', '삼성도 되나요', '삼성으로 변경 가능한가요']);
ONLY(['가능하면 삼성으로 해주세요', '삼성으로 바꿔 주시면 안 될까요', '삼성으로 부탁드려도 될까요', '삼성으로 해줘?'], 'opt:brand=samsung'); ONLY(['거실 좀 보여주시면 안 될까요'], 'room=거실');
// 띄어쓰기 없이·조사·접미·전각·영문 혼용
ONLY(['삼성으로해줘', '삼성전자로 해줘', '삼성에어컨으로 해줘', '삼성걸로 해줘', '삼성이요', '삼성으로요', '삼성이야', '삼성입니다', '삼성제품으로'], 'opt:brand=samsung');
ONLY(['lg로바꿔줘', '엘지로바꿔', 'LG전자로', 'LG에어컨', 'L G로', 'ＬＧ로 해줘', 'ｌｇ로'], 'opt:brand=lg');
ONLY(['화이트로해줘', '화이트톤으로 해줘', '흰색톤으로', '하얀색으로 해줘'], 'opt:style=white'); ONLY(['우드톤으로 해줘', '우드마감으로', '나무톤으로', '원목 톤', '원목으로 해줘', '목재 톤으로'], 'opt:style=wood'); ONLY(['그레이톤으로', '회색톤으로'], 'opt:style=gray');
ONLY(['저녁으로해줘', '저녁시간으로', '야경으로 해줘', '야경', '석양', '노을 분위기'], 'opt:mood=evening'); ONLY(['오전으로', '오후로', '한낮', '대낮으로', '낮시간으로'], 'opt:mood=day');
NOACT(['온도를 낮춰줘', '낮춰줘', '낮은 천장', '밤새 돌려줘', '밤색 우드', '집 디자인 어때', '디자인 좋네', '배경을 화이트로'].filter((s) => !/배경|밤색/.test(s)));
assert.strictEqual(kinds('밤색 우드'), 'opt:style=wood', '밤색은 밤이 아니다'); assert.strictEqual(kinds('배경을 화이트로'), 'opt:style=white');
// 전체 · 방 이름
ONLY(['전체', '전체로', '전체 화면', '집 전체', '처음 화면으로', '돌아가줘', '원래 화면', '처음으로 돌아가'], 'room=전체');
NOACT(['베란다 보여줘', '침실4 보여줘', '안방 보여줘', '사용 방법 알려줘', '방향 바꿔줘', '전체를 삼성으로 해줘'].filter((s) => !/전체를/.test(s)));
ONLY(['2번 침실 보여줘', '둘째 침실 보여줘', '두번째 침실', '침실 두번째', '침실２ 보여줘', '마지막 침실'], 'room=침실2'); ONLY(['침실１ 보여줘', '첫째 침실'], 'room=침실1'); ONLY(['부엌 보여줘'], 'room=주방');
for (const s of ['베란다 보여줘', '침실4 보여줘', '안방 보여줘']) assert.ok(/그 방은 없습니다/.test(P(s, F).reply), s + ' → 없는 방이라고 말한다');
// '안' 은 단독 부정 낱말일 때만 부정이다 — 안방·안내·안쪽·안에·안으로 의 '안' 에 걸려 말한 값이 버려지면 안 된다
const AB = { hasFile: true, session: true, canMake: true, rooms: ['전체', '거실', '안방', '침실1', '주방'] };
ONLY(['삼성으로 안방 보여줘', '삼성으로 해줘 안방 보여줘'], 'opt:brand=samsung room=안방', AB); ONLY(['LG로 안방 보여줘'], 'opt:brand=lg room=안방', AB);
ONLY(['화이트로 해줘 안방'], 'opt:style=white room=안방', AB); ONLY(['사진처럼 안방 보여줘'], 'out=photo room=안방', AB); ONLY(['저녁으로 해줘 안방 보여줘'], 'opt:mood=evening room=안방', AB);
ONLY(['거실로 안내해줘', '거실 안쪽 보여줘', '거실 안으로 들어가'], 'room=거실', AB); ONLY(['삼성으로 안내해줘', '삼성 안쪽으로 해줘', '삼성 안에 넣어줘'], 'opt:brand=samsung', AB);
ONLY(['삼성 안 해 안방 보여줘', '화이트 안 할래 안방'], 'room=안방', AB);   // 진짜 부정은 그대로 — 부정된 값만 버리고 방은 간다
NOACT(['삼성 안 돼', '삼성 안돼', '삼성 안돼요', '삼성으로 안 해줘', '삼성 안 땡겨', '안방 안 볼래'], AB);
assert.ok(/삼성은 선택하지 않습니다/.test(P('삼성 안 돼', AB).reply), '삼성 안 돼 → 선택하지 않는다고 말한다');
// 파일 창은 올리겠다는 말에만(지난 일·방법·부정에는 열지 않는다)
NOACT(['업로드했어', '첨부했어', '첨부 파일 보여줘', '업로드한 도면 보여줘', '파일 선택했어', '이미지 선택했어요', '도면 등록했어', '도면 올려놨어', '사진 올려놨어', '파일 선택 안됨', '파일을 선택하지 않았어', '사진 올리는 법', '도면 올리는 방법 알려줘', '도면 안 올릴게'], NF);
ONLY(['도면 넣고 싶어', '도면을 넣고 싶어', '도면 한 장 올려줘', '사진 한 장 올려줘', 'pdf 올려줘', 'pdf 넣을게', '파일 열어줘', '도면 열기'], 'pickFile', NF);
// 사진 손질 도구를 부르는 흔한 말
ONLY(['글자 넣어줘', '글자 넣기', '문구 넣어줘', '텍스트 넣을래', '글자를 넣고 싶어'], 'tool=글자'); ONLY(['밝기 올려줘', '채도 높여줘', '밝기 조절'], 'tool=색'); NOACT(['문구 알려줘']);
// 입력 방어: 방 이름이 빈 글이 되어도 끝난다(무한 루프 방지) · 이상한 ctx · 아주 긴 입력 · 문서 조각
{ const t0 = Date.now();
  for (const rooms of [[' ', '-', '.', '·', '()', '?', '\n', '거실'], 'not-array', null, [1, null, {}, '거실'], ['거실(1)', '방[2]', '침실+1']]) { const r = A.parse('거실 보여줘 침실1 삼성으로', { rooms }); assert.ok(Array.isArray(r.acts)); }
  A.parse('삼성으로 해줘 '.repeat(20000), F); A.parse('ㅋ'.repeat(100000), F); A.parse('<script>alert(1)</script> ../../etc/passwd \u0000 😀', F);
  assert.ok(Date.now() - t0 < 1500, '어떤 입력에도 빨리 끝난다'); }
assert.strictEqual(kinds('거실(1) 보여줘', { rooms: ['전체', '거실(1)', '방[2]'] }), 'room=거실(1)', '방 이름의 정규식 특수문자는 글자 그대로');
// studio.js 가 모든 동작 종류를 실제로 실행한다 — 동작마다 눌러야 할 요소와 값의 쓰임까지 확인(비워도·선택자가 바뀌어도 걸린다)
const js = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/studio.js'), 'utf8'), page = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/index.html'), 'utf8');
const block = js.slice(js.indexOf('const ASK_DO'), js.indexOf('function askUI')), ui = js.slice(js.indexOf('function askUI'), js.indexOf('async function login'));
const entry = {}; block.replace(/\n    (\w+): ([\s\S]*?)(?=\n    \w+: |\n  \};)/g, (m, k, v) => { entry[k] = v; return m; });
const NEED = { out: ['stPickSet', 'input[value="\' + a.v + \'"]', '.click()'], opt: ['stMoreBody', 'LBL[a.v]', '.click()'], room: ['stRail', 'stLiveNav', 'a.v', '.click()'], tool: ['stTools', 'a.v', '.click()'], sum: ['stSum', 'scrollIntoView'], tour: ['openTour'], make: ["$('stRe')", "$('stGo')", '!b.hidden', '!b.disabled', '.focus('], pickFile: ['stPick', '.click()'] };
for (const d of DO) { assert.ok(entry[d], 'studio.js 가 동작 ' + d + ' 를 실행한다'); for (const need of NEED[d]) assert.ok(entry[d].includes(need), 'ASK_DO.' + d + ' 가 ' + need + ' 를 쓴다'); }
assert.ok(!/querySelector(All)?\(\s*a\.|eval\(|Function\(|innerHTML|location/.test(block), '동작이 말로 선택자·주소·코드를 만들지 않는다');
assert.ok(!entry.make.includes('.click(') && !entry.make.includes('submit'), '말은 [만들기]를 누르지 않는다 — 초점만 준다(작업 1건과 월 한도는 사람이 누른다)');
assert.ok(/\n\s+askUI\(\);/.test(js), 'askUI() 를 부른다');
assert.ok(ui.includes("!window.AinAsk") && ui.includes("$('stAsk').hidden = true"), 'ask.js 를 못 받으면 카드를 숨긴다');
assert.ok(ui.includes('canMake') && ui.includes('tools: !noTools()') && ui.includes('hasFile') && ui.includes('session'), 'ctx 가 화면 상태(만들 수 있나·도구 있나)를 알려 준다');
assert.ok(/for \(const a of r\.acts\)[\s\S]{0,80}ASK_DO\[a\.do\]\(a\)/.test(ui), 'acts 를 순서대로 실행한다');
// ask.js 와 studio.js 의 이름이 어긋나지 않는다(어긋나면 눌러 줄 단추를 못 찾는다)
const LBL = new Function('return ' + /const LBL = (\{[^}]*\});/.exec(js)[1])();
for (const k of Object.keys(A.NAME)) assert.strictEqual(LBL[k], A.NAME[k], '라벨 ' + k);
const toolNames = [...js.slice(js.indexOf('const TOOLS = ['), js.indexOf('];', js.indexOf('const TOOLS = [['.slice(0, -1)))).matchAll(/name: '([^']+)'/g)].map((m) => m[1]);
for (const n of A.TOOL_NAMES) assert.ok(toolNames.includes(n), '사진 손질 도구 이름 ' + n);
const outKeys = [...js.slice(js.indexOf('const OUT = {'), js.indexOf('const NAME = {')).matchAll(/^\s{4}(\w+): \{ tool:/gm)].map((m) => m[1]);
for (const k of Object.keys(A.OUT)) assert.ok(outKeys.includes(k), '받을 것 값 ' + k);
for (const id of ['stAsk', 'stAskForm', 'stAskIn', 'stAskChips', 'stAskLog', 'stHelp', 'stPick', 'stGo', 'stSum', 'stPickSet', 'stMoreBody', 'stLiveNav', 'stRail', 'stTools']) assert.ok(page.includes('id="' + id + '"') || js.includes("'" + id + "'"), 'index.html 에 #' + id);
assert.ok(/<div class="st-ask-log" id="stAskLog" role="log">/.test(page) && !/<ol[^>]*stAskLog/.test(page), '응답 줄은 목록이 아닌 log 영역');
assert.ok(!/innerHTML/.test(fs.readFileSync(path.join(__dirname, '..', 'maker/3d/ask.js'), 'utf8')), 'ask.js 는 화면을 만지지 않는다');
console.log('test-studio-ask: OK');
