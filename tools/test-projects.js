// 내 프로젝트 화면(maker/3d/projects) + 앱 셸(maker/3d/app) — 썸네일 계산, 마크업 안전(innerHTML 없음), CSS 토큰 규칙, 이동 주소를 정적으로 검증한다.
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
(async () => {
  const { thumbData } = await import('../maker/3d/projects/thumb.js');
  const room = (x, y, w, d) => ({ poly: [[x, y], [x + w, y], [x + w, y + d], [x, y + d]] });
  const doc = (f) => ({ v: 1, cur: 0, floors: [Object.assign({ walls: [], rooms: [], columns: [], items: [] }, f)] });
  const d = thumbData(doc({ walls: [{ a: [0, 0], b: [5000, 0], t: 150 }], rooms: [room(0, 0, 5000, 4000)], items: [{ kind: 'ac', c: [2500, 2000], size: [1000, 500] }] }));
  assert.deepStrictEqual(d.vb, [-300, -300, 5600, 4600], '경계 + 6% 여백'); assert.strictEqual(d.rooms.length, 1); assert.deepStrictEqual(d.acs, [{ x: 2500, y: 2000, w: 1000, d: 500 }]);
  assert.strictEqual(thumbData(doc({})), null, '빈 층은 그리지 않는다'); assert.strictEqual(thumbData(null), null); assert.strictEqual(thumbData({ floors: [] }), null);
  assert.strictEqual(thumbData(doc({ walls: [{ a: [0, 'x'], b: [1, 1] }] })), null, '깨진 좌표는 그리지 않는다');
  assert.ok(thumbData(doc({ rooms: [room(0, 0, 10, 10)] })).vb[2] >= 1000, '아주 작은 도면도 최소 1m 틀');
  assert.strictEqual(thumbData({ cur: 9, floors: [doc({ rooms: [room(0, 0, 100, 100)] }).floors[0]] }).rooms.length, 1, '층 번호가 범위 밖이어도 안전');
  // 마크업 안전 — 사용자 글(도면 이름)은 textContent 로만
  for (const f of ['maker/3d/projects/projects.js', 'maker/3d/app/shell.js', 'maker/3d/projects/thumb.js', 'maker/3d/plan/library.js']) assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(read(f)), f + ': HTML 문자열 주입 없음');
  // CSS: 토큰만(hex·rgb·그라디언트·999px·글자 시간 리터럴 없음 — 움직임 토큰 정의 한 줄만 예외)
  for (const f of ['maker/3d/projects/projects.css', 'maker/3d/app/shell.css']) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^:root \{ --t-fast/.test(l)).join('\n');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css) && !/rgba?\(/.test(css) && !/gradient/.test(css) && !/999px/.test(css) && !/\b\d+m?s\b/.test(css.replace(/animation-delay: calc\(var\(--i, 0\) \* 30ms\)/g, '')), f + ': 토큰만');
    assert.ok(/prefers-reduced-motion/.test(css), f + ': 동작 줄이기');
  }
  const html = read('maker/3d/projects/index.html');
  assert.ok(/script-src 'self' https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.117\.2\//.test(html) && !/script-src[^;]*unsafe-inline/.test(html), 'CSP: 인라인 스크립트 없음');
  assert.ok(/<meta name="robots" content="noindex">/.test(html) && /<h1|id="app"/.test(html), '개인 목록은 색인하지 않는다');
  for (const m of html.matchAll(/(?:href|src)="(\/[^"?]+)(?:\?[^"]*)?"/g)) assert.ok(fs.existsSync(path.join(root, m[1].slice(1))) || /^\/(auth\.js|assets\/)/.test(m[1]) && fs.existsSync(path.join(root, m[1].slice(1))), '참조 파일 있음: ' + m[1]);
  // 셸: 글자 메뉴(아이콘 없음) · 이동 주소 · 현재 위치 표시
  const shell = read('maker/3d/app/shell.js'); assert.ok(!/<svg|createElementNS/.test(shell), '셸에는 아이콘을 그리지 않는다'); assert.ok(/aria-current/.test(shell) && /aria-label': '스튜디오'/.test(shell), '현재 위치·내비게이션 이름');
  for (const href of ['/maker/3d/', '/maker/3d/#stAsk', '/maker/3d/projects/', '/maker/3d/plan/', '/maker/3d/maps/']) assert.ok(shell.includes("'" + href + "'"), '메뉴 주소 ' + href);
  // 프로젝트 화면: 만들 수 없는 것을 약속하지 않는다 — 보기 4가지, 휴지통은 복원·완전 삭제만, 완전 삭제는 확인창
  const pj = read('maker/3d/projects/projects.js'); for (const t of ['전체 프로젝트', '북마크', '작업 결과', '휴지통', '복원', '완전 삭제', '이름 바꾸기', '복제']) assert.ok(pj.includes(t), '화면 글자: ' + t);
  assert.ok(/confirmDelete\(m\)/.test(pj) && /lib\.deletePlan\(m\.id\); close\(\)/.test(pj) && (pj.match(/lib\.deletePlan/g) || []).length === 1, '완전 삭제는 확인창 한 곳에서만');
  assert.ok(/\/maker\/3d\/\?ask=/.test(pj) && /\/maker\/3d\/plan\/\?new=1/.test(pj) && /\?doc=/.test(pj), '시작 페이지로 말 넘기기·새 도면·도면 열기 주소');
  // 시작 페이지 연결
  const st = read('maker/3d/index.html'); for (const href of ['/maker/3d/projects/', '/maker/3d/plan/', '/maker/3d/maps/']) assert.ok(st.includes('href="' + href + '"'), '시작 페이지 메뉴: ' + href);
  const js = read('maker/3d/studio.js'); assert.ok(/searchParams\.get\('ask'\)/.test(js) && /searchParams\.delete\('ask'\)/.test(js), '?ask= 를 실행하고 주소에서 지운다');
  console.log('test-projects: OK');
})().catch((e) => { console.error(e); process.exit(1); });
