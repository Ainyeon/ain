// 프로젝트 화면 보강 — DOM 없이(독립 리뷰의 변이 시험에서 못 잡힌 곳): thumbData 세부 · CSS 규칙 · index.html 구조 · 시작 페이지 메뉴 · studio.js ?ask= 조각 실행
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
(async () => {
  const { thumbData } = await import('../maker/3d/projects/thumb.js');
  const room = (x, y, w, d) => ({ poly: [[x, y], [x + w, y], [x + w, y + d], [x, y + d]] });
  const fl = (o) => Object.assign({ walls: [], rooms: [], columns: [], items: [] }, o), one = (o) => ({ v: 1, cur: 0, floors: [fl(o)] });
  // thumbData
  const two = { v: 1, cur: 1, floors: [fl({ rooms: [room(0, 0, 1000, 1000)] }), fl({ rooms: [room(0, 0, 8000, 6000)] })] };
  assert.ok(thumbData(two).vb[2] > 8000, 'cur 층을 그린다'); assert.ok(thumbData(Object.assign({}, two, { cur: -3 })).vb[2] < 2000, '음수 cur 는 0층');
  assert.ok(thumbData(one({ rooms: [room(0, 0, 1000, 1000)], walls: [{ a: [0, 0], b: [9000, 0] }] })).vb[2] > 9000, '벽도 경계에 든다');
  assert.ok(thumbData(one({ rooms: [room(0, 0, 1000, 1000)], columns: [{ c: [0, 7000], w: 200 }] })).vb[3] > 7000, '기둥도 경계에 든다');
  assert.deepStrictEqual(thumbData(one({ walls: [{ a: [10, 20], b: [30, 40] }] })).walls, [{ x1: 10, y1: 20, x2: 30, y2: 40, t: 150 }], '벽 좌표·기본 두께');
  assert.strictEqual(thumbData(one({ walls: [{ a: [0, 0], b: [1, 1], t: 10 }] })).walls[0].t, 80, '벽 두께 하한'); assert.strictEqual(thumbData(one({ walls: [{ a: [0, 0], b: [1, 1], t: 200 }] })).walls[0].t, 200);
  assert.deepStrictEqual(thumbData(one({ columns: [{ c: [5, 6] }] })).cols, [{ x: 5, y: 6, r: 150 }], '기둥 기본 반지름'); assert.strictEqual(thumbData(one({ columns: [{ c: [5, 6], w: 100 }] })).cols[0].r, 75, '기둥 반지름 하한');
  assert.deepStrictEqual(thumbData(one({ rooms: [room(0, 0, 1, 1)], items: [{ kind: 'ac', c: [1, 2] }, { kind: 'light', c: [3, 4] }] })).acs, [{ x: 1, y: 2, w: 900, d: 500 }], '에어컨만·기본 크기');
  assert.strictEqual(thumbData(one({ rooms: [room(0, 0, 100, 50)] })).rooms[0], '0,0 100,0 100,50 0,50', '방 다각형 문자열'); assert.strictEqual(thumbData(one({ rooms: [{ poly: [[0, 0], [1, 1]] }] })).rooms.length, 0, '점 2개 방은 안 그린다');
  assert.strictEqual(thumbData(one({ walls: [{ a: ['x', 0], b: [1, 1] }] })), null, '첫 좌표만 깨져도 null');
  // CSS 규칙(토큰·그림자·모서리·동작 줄이기·포커스·터치 크기·폰 레이아웃)
  const css = {}; for (const f of ['maker/3d/projects/projects.css', 'maker/3d/app/shell.css']) css[f] = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
  const all = Object.values(css).join('\n');
  for (const m of all.matchAll(/border-radius:\s*([^;}]+)/g)) assert.ok(/^(var\(--r-[1-3]\)|0)( (var\(--r-[1-3]\)|0))*$/.test(m[1].trim()), '모서리는 --r-1~3 토큰: ' + m[1]);
  for (const m of all.matchAll(/box-shadow:\s*([^;}]+)/g)) assert.ok(/^(none|var\(--sh-\d\))$/.test(m[1].trim()), '그림자는 토큰만: ' + m[1]);
  assert.ok(!/\b(hsla?|hwb|lab|lch|oklab|oklch)\(/.test(all), '색 함수 없음'); assert.ok(!/(^|[;{]\s*)(color|background(-color)?|border(-\w+)?-color|fill|stroke)\s*:\s*(white|black|red|blue|green|gray|grey|orange|yellow|purple)\b/m.test(all), '이름 있는 색 없음');
  for (const [f, c] of Object.entries(css)) assert.ok(/prefers-reduced-motion: reduce\) \{[^}]*:\s*none/.test(c), f + ': 동작 줄이기가 실제로 끈다');
  assert.ok(/\.ap-link:focus-visible[^{]*\{[^}]*outline: 2px/.test(css['maker/3d/app/shell.css']), '셸 포커스 윤곽'); assert.ok(/\.pj-btn \{[^}]*min-height: 44px/.test(css['maker/3d/projects/projects.css']), '버튼 터치 높이 44');
  assert.ok(/@media \(max-width: 768px\) \{[\s\S]*?\.ap-side \{ position: fixed/.test(css['maker/3d/app/shell.css']), '폰은 아래 탭');
  // projects/index.html
  const html = read('maker/3d/projects/index.html');
  assert.ok(/<html lang="ko">/.test(html) && /<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html), 'lang·viewport');
  assert.ok(/<script type="module" src="\/maker\/3d\/projects\/projects\.js\?v=\d+"><\/script>/.test(html), 'projects.js 는 module');
  assert.ok(/<script defer src="\/auth\.js\?v=\d+">/.test(html), 'auth.js 연결'); for (const f of ['/assets/css/design-tokens.css', '/maker/3d/app/shell.css', '/maker/3d/projects/projects.css']) assert.ok(html.includes('href="' + f + '?'), '스타일 연결 ' + f);
  for (const m of html.matchAll(/<script[^>]*src="https:[^>]*>/g)) assert.ok(/integrity="sha384-[^"]+"/.test(m[0]) && /crossorigin/.test(m[0]), '외부 스크립트는 SRI: ' + m[0].slice(0, 60));
  assert.ok(/<a class="ap-skip" href="#main">/.test(html), '본문 건너뛰기');
  const csp = Object.fromEntries(html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].split(';').map((s) => s.trim().split(/ (.*)/s)).filter((x) => x[0]).map((x) => [x[0], x[1]]));
  assert.strictEqual(csp['default-src'], "'self'"); assert.strictEqual(csp['script-src'], "'self' https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/", 'script-src 는 정확히 이 둘'); for (const [k, v] of [['base-uri', "'none'"], ['object-src', "'none'"], ['form-action', "'self'"]]) assert.strictEqual(csp[k], v, k);
  assert.ok(/id: 'main'/.test(read('maker/3d/app/shell.js')), '#main 대상');
  // 시작 페이지 .st-apps — 라벨과 주소를 짝으로
  const nav = read('maker/3d/index.html').match(/<nav class="st-apps"([^>]*)>([\s\S]*?)<\/nav>/); assert.ok(nav && !/hidden/.test(nav[1]), '.st-apps 가 보인다');
  assert.deepStrictEqual([...nav[2].matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[2], m[1]]), [['내 프로젝트', '/maker/3d/projects/'], ['도면 그리기', '/maker/3d/plan/'], ['도면 검색', '/maker/3d/maps/']], '시작 페이지 메뉴 짝');
  // studio.js ?ask= — 조각을 꺼내 실행
  const js = read('maker/3d/studio.js'), i = js.indexOf('const url = new URL(location.href), ask'), j = js.indexOf('\n', js.indexOf("else if (location.hash === '#stAsk')", i)); assert.ok(i > 0 && j > i, '?ask= 조각을 찾는다');
  const exec = (href) => { const out = { called: [], replaced: null }, location = new URL(href), history = { state: 7, replaceState: (s, t, u) => { out.replaced = u; } }, el = { scrollIntoView() {}, focus() {} };
    new Function('location', 'history', 'run', '$', 'inp', 'motion', js.slice(i, j))(location, history, (x) => out.called.push(x), () => el, el, () => 'auto'); return out; };
  assert.deepStrictEqual(exec('https://x.test/maker/3d/?ask=%EA%B1%B0%EC%8B%A4&keep=1#h'), { called: ['거실'], replaced: '/maker/3d/?keep=1#h' }, '말을 실행하고 주소에서 ask 만 지운다');
  assert.strictEqual(exec('https://x.test/maker/3d/?ask=' + 'a'.repeat(100)).called[0].length, 80, '80자까지'); assert.deepStrictEqual(exec('https://x.test/maker/3d/'), { called: [], replaced: null }, 'ask 없으면 아무것도 안 한다');
  console.log('test-projects-more: OK');
})().catch((e) => { console.error(e); process.exit(1); });
