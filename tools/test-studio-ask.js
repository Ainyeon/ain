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
// studio.js 가 모든 동작 종류를 실행하고, 쓰는 요소가 index.html 에 있다
const js = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/studio.js'), 'utf8'), page = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/index.html'), 'utf8');
for (const d of DO) assert.ok(new RegExp('\\b' + d + '\\s*:').test(js.slice(js.indexOf('const ASK_DO'), js.indexOf('const ASK_DO') + 2200)), 'studio.js 가 동작 ' + d + ' 를 실행한다');
for (const id of ['stAsk', 'stAskForm', 'stAskIn', 'stAskChips', 'stAskLog', 'stHelp', 'stPick', 'stGo', 'stSum', 'stPickSet', 'stMoreBody', 'stLiveNav', 'stTools']) assert.ok(page.includes('id="' + id + '"'), 'index.html 에 #' + id);
assert.ok(!/innerHTML/.test(fs.readFileSync(path.join(__dirname, '..', 'maker/3d/ask.js'), 'utf8')), 'ask.js 는 화면을 만지지 않는다');
console.log('test-studio-ask: OK');
