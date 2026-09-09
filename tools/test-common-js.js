// 공통 JS 표시단 보정 회귀 검사 — 실행: node tools/test-common-js.js
// 대상: ain-common.js의 fillNewsSource(⑥) · dedupGov(③)
// 둘 다 "고쳐야 할 것만 고치고 나머지는 보존"이 핵심이라 반대 방향 오작동까지 확인한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'ain-common.js'), 'utf8');
// 실제 파일에서 해당 구간을 그대로 잘라 평가한다 (복사본을 따로 두지 않는다)
const cut = (start, end) => {
  const a = src.indexOf(start), b = src.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('구간을 찾지 못함: ' + start);
  return src.slice(a, b);
};
const api = new Function(
  cut('function govDedupKey', '  // ⑥ 뉴스 요약에 남은')
  + cut('const SOURCE_INLINE', '  window.escT')
  + '; return { govDedupKey, dedupGov, fillNewsSource };')();

// ── ⑥ 뉴스 요약의 SOURCE 자리표시자를 실제 출처명으로 치환 ──
// 실측(활성 60건 전수): 자리표시자는 문두가 아니라 문장 중간에 "SOURCE에 따르면"으로 남는다.
assert.strictEqual(
  api.fillNewsSource('…선보인다. SOURCE에 따르면 습도 관리가…', '투데이에너지'),
  '…선보인다. 투데이에너지에 따르면 습도 관리가…');
assert.strictEqual(
  api.fillNewsSource('기후에너지환경부가 추진한다. SOURCE에 따르면 태양광…', '뉴시스 경제'),
  '기후에너지환경부가 추진한다. 뉴시스 경제에 따르면 태양광…');
// 다른 조사도 같은 자리표시자
assert.strictEqual(api.fillNewsSource('SOURCE는 이렇게 전했다', '가스신문'), '가스신문는 이렇게 전했다');
// 출처를 모르면 매체명을 지어내지 않는다
assert.strictEqual(api.fillNewsSource('SOURCE에 따르면 …', ''), '출처에 따르면 …');
assert.strictEqual(api.fillNewsSource('SOURCE에 따르면 …', null), '출처에 따르면 …');

// 본문 단어·식별자는 훼손하지 않는다 — 뒤에 한글이 붙은 독립 토큰만 치환한다
assert.strictEqual(api.fillNewsSource('OPEN SOURCE 생태계 기사', '투데이에너지'), 'OPEN SOURCE 생태계 기사');
assert.strictEqual(api.fillNewsSource('SOURCES 복수형은 그대로', '투데이에너지'), 'SOURCES 복수형은 그대로');
assert.strictEqual(api.fillNewsSource('MY_SOURCE에 값을 넣는다', '투데이에너지'), 'MY_SOURCE에 값을 넣는다');
assert.strictEqual(api.fillNewsSource('data-SOURCE에 담긴 값', '투데이에너지'), 'data-SOURCE에 담긴 값');
assert.strictEqual(api.fillNewsSource('source에 따르면 (소문자)', '투데이에너지'), 'source에 따르면 (소문자)');
// 출처명 자체가 본문에 있어도 지우지 않는다
assert.strictEqual(api.fillNewsSource('연합뉴스 보도에 따르면 …', '연합뉴스'), '연합뉴스 보도에 따르면 …');

// 줄 맨 앞의 독립 표식(과거 보고된 형태)도 함께 정리한다
assert.strictEqual(api.fillNewsSource('SOURCE 연합뉴스에 따르면 …', '연합뉴스'), '연합뉴스에 따르면 …');
assert.strictEqual(api.fillNewsSource('SOURCE: 가스신문 보도', '가스신문'), '가스신문 보도');

assert.strictEqual(api.fillNewsSource('', '투데이에너지'), '');
assert.strictEqual(api.fillNewsSource(null, '투데이에너지'), '');

// ── ③ 정부사업 공고 중복 (표시 단계) ──
const SHORT = 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000126034';
const LONG = 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?hashCode=&rowsSel=&rows=15&cpage=11&pblancId=PBLN_000000000126034';
const OTHER = 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000999999';
const NOID = 'https://en-ter.co.kr/ac/bbs/notice/view.do?seq=25219';

// 같은 pblancId면 URL 형태가 달라도 한 건
assert.strictEqual(api.govDedupKey(SHORT), api.govDedupKey(LONG));
assert.notStrictEqual(api.govDedupKey(SHORT), api.govDedupKey(OTHER));
assert.strictEqual(api.govDedupKey(NOID), null);      // 판정 키가 없으면 합치지 않는다
assert.strictEqual(api.govDedupKey(''), null);
assert.strictEqual(api.govDedupKey('not a url'), null);

assert.strictEqual(api.dedupGov([{ source_url: SHORT }, { source_url: LONG }]).length, 1);
assert.strictEqual(api.dedupGov([{ source_url: SHORT }, { source_url: OTHER }]).length, 2);
// 제목이 같다는 이유만으로 다른 공고를 합치지 않는다
assert.strictEqual(api.dedupGov([
  { source_url: SHORT, program_name: '같은 이름' },
  { source_url: OTHER, program_name: '같은 이름' }
]).length, 2);
// 키가 없는 행은 여러 개여도 살아남는다
assert.strictEqual(api.dedupGov([{ source_url: NOID }, { source_url: NOID }]).length, 2);
// 실측 3행(en-ter 1 + bizinfo 동일 pblancId 2) → 2행
assert.strictEqual(api.dedupGov([{ source_url: NOID }, { source_url: SHORT }, { source_url: LONG }]).length, 2);

// ── §3.7/§10 개인 연락처만 가림 · 반복 작성 플래그 ──
// ain-community.js에서 해당 구간만 잘라 평가한다
const comm = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'ain-community.js'), 'utf8');
const cutc = (start, end) => {
  const a = comm.indexOf(start), b = comm.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('구간을 찾지 못함: ' + start);
  return comm.slice(a, b);
};
const c = new Function(cutc("  const MASK =", "  function loginWithKakao")
  + '; return { maskContacts };')();

// 가리는 것: 사람에게 직접 연결되는 값
assert.strictEqual(c.maskContacts('문의는 010-1234-5678로 주세요'), '문의는 [가림]로 주세요');
assert.strictEqual(c.maskContacts('01012345678'), '[가림]');
assert.strictEqual(c.maskContacts('02-123-4567 로 전화'), '[가림] 로 전화');
assert.ok(c.maskContacts('메일 hong@example.com 주세요').includes('[가림]'));
assert.ok(c.maskContacts('카톡 abc_123 주세요').includes('[가림]'));
assert.ok(!c.maskContacts('카톡 abc_123 주세요').includes('abc_123'));

// 가리지 않는 것: 기관 공식 링크와 공고 원문 링크 (SPEC §3.7 — 정보이므로 보존)
const officialUrl = 'http://www.krrc.or.kr/web/?top=education&sub=schedule&key=detail&code=112';
assert.strictEqual(c.maskContacts(officialUrl), officialUrl);
const bizUrl = 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_000000000126034';
assert.strictEqual(c.maskContacts(bizUrl), bizUrl);
// 링크 안의 숫자열이 전화번호로 잡히면 안 된다
assert.strictEqual(c.maskContacts('공고 https://idoedu.kr/bbs/board.php?wr_id=01012345678 참고'),
  '공고 https://idoedu.kr/bbs/board.php?wr_id=01012345678 참고');
// 평범한 숫자·날짜는 건드리지 않는다
assert.strictEqual(c.maskContacts('교육일 2026.10.14 ~ 2026.10.15'), '교육일 2026.10.14 ~ 2026.10.15');
assert.strictEqual(c.maskContacts('수강료 230000원'), '수강료 230000원');
assert.strictEqual(c.maskContacts(''), '');
assert.strictEqual(c.maskContacts(null), '');

// 반복 작성 판정은 서버 RPC(admin_repeat_flags)로 옮겼다 — 작성자 기준이라 화면에서 셀 수 없다.

console.log('common-js OK — SOURCE 치환 / pblancId 병합 / 연락처만 가림(공식 링크 보존)');
