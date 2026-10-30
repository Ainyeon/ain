// 플래너 화면 배치(maker/3d/plan/{index.html, plan.css, panels.css}) 정적 점검 — 폭별 겹침·넘침·터치 크기를 낳던 규칙이 되돌아오면 실패한다.
// 실제 화면 폭·눌림은 브라우저(playwright)로 본다(폭 1440·1280·1222·1100·1024·990·820·768·390, elementFromPoint). 여기는 그 원인이 된 규칙의 존재만 문자열·정규식으로 본다.
// 실행: node tools/test-plan-layout.js. 변이 시험용으로 PLAN_LAYOUT_DIR 로 다른 사본을 가리킬 수 있다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DIR = process.env.PLAN_LAYOUT_DIR || path.join(__dirname, '..', 'maker/3d/plan');
const rd = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const noComment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const flat = (s) => noComment(s).replace(/\s+/g, ' ');

// 미디어 쿼리 블록 본문을 중괄호 짝으로 잘라 낸다. media: 쿼리 정규식 → [본문…]
function mediaBodies(css, re) {
  const out = []; const rx = new RegExp('@media ' + re.source + '\\s*\\{', 'g'); let m;
  while ((m = rx.exec(css))) {
    let depth = 1, i = rx.lastIndex;
    while (i < css.length && depth) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
    out.push(css.slice(rx.lastIndex, i - 1));
  }
  return out;
}
const baseCss = (css) => { // 미디어 쿼리 밖 규칙만
  let out = '', depth = 0, inMedia = false;
  for (let i = 0; i < css.length; i++) {
    if (!inMedia && css.startsWith('@media', i)) { inMedia = true; depth = 0; }
    if (inMedia) { if (css[i] === '{') depth++; else if (css[i] === '}') { depth--; if (depth === 0) inMedia = false; } continue; }
    out += css[i];
  }
  return out;
};

const html = rd('index.html');
const css = flat(rd('plan.css'));
const pcss = flat(rd('panels.css'));
const base = baseCss(css);
const at = (s) => html.indexOf(s);

/* ===== #28 메뉴: 열린 메뉴가 버튼 다음 순서 (Tab 이 항목으로 이어진다) ===== */
assert.ok(at('id="plMore"') > 0 && at('id="plMore"') < at('id="plMenu"'), '#plMore 가 #plMenu 보다 앞(DOM 순서 = Tab 순서)');
assert.ok(at('id="plMenu"') < at('id="plSaveState"'), '메뉴 다음이 저장 상태·저장·나가기');
assert.ok(/\.ed-more \+ \.ed-menu \+ \.ed-ss \{ margin-left: 0; \}/.test(css), '바뀐 순서에 맞춘 형제 선택자');
assert.ok(!/\.ed-menu \+ \.ed-more/.test(css), '옛 순서(메뉴 → 단추) 선택자가 남지 않는다');

/* ===== #25 중간 폭: 위 바가 넘치지 않게 메뉴를 접고 칸을 좁힌다 ===== */
const collapse = [...css.matchAll(/@media \(max-width: (\d+)px\) \{/g)].map((m) => Number(m[1])).filter((n) => n > 768);
assert.ok(collapse.length === 1 && collapse[0] >= 991, `위 바 메뉴 접기 경계는 가로줄 최소폭(991px) 이상이어야 한다: ${collapse}`);
const mid = mediaBodies(css, /\(max-width: 1023px\)/).join(' ');
assert.ok(/\.ed-more \{ display: inline-flex; \}/.test(mid), '중간 폭: [메뉴] 단추가 보인다');
assert.ok(/\.ed-menu \{[^}]*position: absolute[^}]*display: none/.test(mid) && /\.ed-menu\.open \{ display: flex; \}/.test(mid), '중간 폭: 메뉴 항목은 접혀 열 때만 뜬다');
const narrow = mediaBodies(css, /\(min-width: 769px\) and \(max-width: 1023px\)/).join(' '), cols = mediaBodies(css, /\(min-width: 769px\) and \(max-width: 1279px\)/).join(' ');
const px = (re) => Number((cols.match(re) || [])[1]);
assert.ok(px(/--ed-panel: (\d+)px/) < 280 && px(/--ed-side: (\d+)px/) < 268, '중간 폭(1279px 까지, 작은 노트북 1024 포함): 패널 칸을 좁힌다(캔버스를 지킨다)');
{ const rail = Number((css.match(/--ed-rail: (\d+)px/) || [])[1]), canvas = 1024 - rail - px(/--ed-panel: (\d+)px/) - px(/--ed-side: (\d+)px/); assert.ok(canvas >= 480, '1024px 에서 캔버스 480px 이상: ' + canvas); }
assert.ok(!/\.ed-ss, |, \.ed-ss \{[^}]*display: none/.test(mid) && !/\.ed-big-only[^{]*\{[^}]*display: none/.test(mid + narrow), '중간 폭에서도 저장 상태·나가기는 감추지 않는다');
assert.ok(/\.ed-ss \{[^}]*max-width: \d+em[^}]*overflow: hidden[^}]*text-overflow: ellipsis/.test(base), '긴 저장 상태 글이 저장·나가기를 밀어내지 않는다');
assert.ok(!/\.ed-title \{[^}]*min-width: (1\d\d|[2-9]\d\d)px/.test(base), '제목 칸 최소 폭이 위 바를 밀지 않는다(96px)');

/* ===== #26 아래 조절줄: 겹치지 않고 줄바꿈한다 ===== */
assert.ok(/\.ed-ctls \{[^}]*position: absolute[^}]*display: flex[^}]*flex-wrap: wrap-reverse/.test(base), '두 조절줄은 한 상자(ed-ctls) 안에서 줄바꿈한다(좁으면 오른쪽 줄이 위로)');
assert.ok(/\.ed-ctls \{[^}]*pointer-events: none/.test(base) && /\.ed-ctl \{[^}]*pointer-events: auto/.test(base), '상자는 캔버스 입력을 막지 않고 줄만 받는다');
assert.ok(!/\.ed-ctl \{[^}]*position: absolute/.test(base), '기본(폭 넓음) 조절줄은 따로 절대 위치로 박지 않는다 — 박으면 서로 깔린다');
assert.ok(!/\.ed-ctl\.[lr] \{[^}]*(?<![\w-])(left|right):/.test(base), '기본 조절줄은 left/right 로 박히지 않는다');
assert.ok(/\.ed-ctl \{[^}]*max-width: 100%/.test(base) && /\.ed-ctl \{[^}]*flex-wrap: wrap/.test(base), '조절줄 하나가 상자보다 넓어도 안에서 줄바꿈한다');
assert.ok(/\.ed-ctl\.r \{ margin-left: auto; \}/.test(base), '오른쪽 줄은 혼자 한 줄이어도 오른쪽에 붙는다');
assert.ok(at('class="ed-ctls"') > 0 && at('class="ed-ctls"') < at('class="ed-ctl l"') && at('class="ed-ctl l"') < at('class="ed-ctl r"') && at('class="ed-ctl r"') < at('</main>'), 'index.html: ed-ctls 가 두 줄을 감싼다');

/* ===== #24 3D 보기 목록: 조절줄 윗끝에 붙어 터치에서 줄이 커져도 단추를 덮지 않는다 ===== */
assert.ok(/\.ed-views \{[^}]*position: absolute[^}]*bottom: calc\(100% \+ var\(--sp-1\)\)/.test(base), '보기 목록 위치 = 조절줄 윗끝(100%) 기준');
assert.ok(!/\.ed-views \{[^}]*bottom: calc\(var\(--sp-3\) \+ \d+px\)/.test(css), '목록 높이를 고정 px 로 어림하지 않는다(터치에서 줄이 62px 로 커진다)');
const viewsAt = at('id="plViews"');
assert.ok(viewsAt > at('class="ed-ctl l"') && viewsAt < at('class="ed-ctl r"'), 'index.html: #plViews 는 왼쪽 조절줄 안');
const beforeViews = html.slice(at('class="ed-ctl l"') - 5, viewsAt);   // <div class="ed-ctl l" … 부터 #plViews 직전까지 div 열고 닫은 수 차이 = 아직 왼쪽 줄 안인지
assert.strictEqual((beforeViews.match(/<div\b/g) || []).length - (beforeViews.match(/<\/div>/g) || []).length, 2, 'index.html: #plViews 는 왼쪽 줄 div 를 닫기 전(그 안)에 있다');
const phone = mediaBodies(css, /\(max-width: 768px\)/).join(' ');
assert.ok(/\.ed-ctls \{ display: contents; \}/.test(phone) && /\.ed-ctl \{ position: absolute; bottom: var\(--sp-3\);/.test(phone), '폰: 상자는 풀고 줄이 직접 자리를 잡는다(목록의 기준이 왼쪽 줄)');
assert.ok(!/\.ed-views \{[^}]*left: var\(--sp-2\)/.test(phone), '폰: 목록은 왼쪽 줄 안에서 따라간다(별도 left 없음)');

/* ===== #27 선택한 것의 속성: 오른쪽 열 맨 위 자기 칸 · 폰은 서랍 밖 아래 시트 ===== */
const propsAt = at('id="plProps"'), sideAt = at('<aside class="ed-side"'), sideEnd = at('</aside>', sideAt);
assert.ok(propsAt > 0 && propsAt < sideAt, '#plProps 는 #plSide 밖(앞) — 미니맵·층·설정 뒤 맨 아래가 아니다');
assert.ok(!(propsAt > sideAt && propsAt < html.indexOf('</aside>', sideAt)), '#plProps 가 서랍 안에 다시 들어가지 않는다');
assert.ok(/class="ed-sec ed-props"/.test(html), '#plProps 는 ed-props 칸');
assert.ok(/grid-template-areas: "top top top top" "rail panel stage props" "rail panel stage side"/.test(css) && /\.ed-props \{ grid-area: props;/.test(base), '데스크톱: 속성 칸이 오른쪽 열 맨 위');
assert.ok(/grid-template-rows: var\(--ed-top\) auto minmax\(0, 1fr\)/.test(base), '속성 칸 행은 auto — 선택이 없으면 0');
assert.ok(/\.ed-props \{[^}]*max-height: \d+dvh/.test(base), '속성 칸이 커도 미니맵·설정을 다 밀어내지 않는다');
assert.ok(/\.ed-app\.no-side \.ed-props/.test(base.match(/\.ed-app\.no-panel \.ed-panel[^{]*\{[^}]*\}/)[0]), '오른쪽 패널을 접으면 속성 칸도 접힌다(데스크톱)');
assert.ok(/\.ed-props \{[^}]*position: fixed[^}]*bottom: 56px/.test(phone), '폰: 속성은 서랍 밖 아래 시트');
assert.ok(/\.ed-app\.no-side \.ed-props \{ visibility: visible; \}/.test(phone), '폰: 서랍이 닫혀 있어도 속성 시트는 보인다');
assert.ok(/\.ed-app\.no-side \.ed-side \{ translate: 100% 0; visibility: hidden; \}/.test(phone), '폰: 서랍은 그대로 접힘');
assert.ok(/\.ed-props \{[^}]*z-index: 19/.test(phone) && /\.ed-panel \{[^}]*z-index: 20/.test(phone), '폰: 도구 시트(20)가 속성 시트(19) 위');

/* ===== #29 터치(pointer: coarse): 눌리는 것은 44px 이상 ===== */
const coarse = mediaBodies(css, /\(pointer: coarse\)/).join(' ');
for (const sel of ['.ed-b', '.ed-sb', '.ed-row', '.ed-title', '.ed-f select', '.ed-rg input[type="range"]']) assert.ok(coarse.includes(sel), `coarse(plan.css): ${sel}`);
assert.ok(/\{ min-height: 44px; \}/.test(coarse) && /\.ed-sb \{ min-width: 44px; \}/.test(coarse), 'coarse: 높이 44 · 단추 폭 44');
assert.ok(/--ed-edge: 44px/.test(coarse) && /\.ed-edge \{[^}]*width: var\(--ed-edge\)/.test(base) && /--ed-edge: 24px/.test(css), 'coarse: 패널 접기 단추(가장자리) 폭 44');
const pco = mediaBodies(pcss, /\(pointer: coarse\)/).join(' ');
const small = ['.pl-tabs-tab', '.pl-chips-tab', '.pl-fav', '.pl-btn', '.pl-link', '.pl-search', '.pl-sort', '.pl-est-dl'];
const hFirst = pco.match(/([^{}]+)\{ min-height: 44px; \}/);
assert.ok(hFirst, 'coarse(panels.css): 높이 규칙');
for (const sel of small) assert.ok(hFirst[1].includes(sel), `coarse(panels.css) 높이 44: ${sel}`);
const wFirst = pco.match(/([^{}]+)\{ min-width: 44px; \}/);
for (const sel of ['.pl-tabs-tab', '.pl-chips-tab', '.pl-fav', '.pl-btn']) assert.ok(wFirst && wFirst[1].includes(sel), `coarse(panels.css) 폭 44: ${sel}`);
assert.ok(/\.pl-grid--1 \.pl-fav \{[^}]*top: var\(--sp-1\)/.test(pco) && /\.pl-prod-type \{ min-height: 4\d?px; \}/.test(pco), '카드 오른쪽 위 즐겨찾기가 커진 만큼 카드 윗줄을 비운다');
// 판 안에서 눌리는 클래스가 새로 24~40px 높이로 생기면 coarse 목록에 넣어야 한다
const smallH = [...pcss.matchAll(/(\.pl-[\w-]+(?:\[[^\]]*\])?)(?:[:\w.-]*)\s*\{[^}]*?(?<![\w-])(?:min-)?height: (\d+)px/g)].filter((m) => Number(m[2]) < 44 && /^\.pl-(fav|btn|chips-tab|tabs-tab|search|sort|est-dl|link|card-main|tpl)/.test(m[1])).map((m) => m[1]);
for (const c of new Set(smallH)) assert.ok(small.includes(c) || pco.includes(c), `panels.css 에서 44px 미만인 ${c} 가 coarse 규칙에 없다`);

/* ===== 폰 시트 스크롤 · 터치 태블릿 가전 판 ===== */
assert.ok(/\.ed-panel \{[^}]*max-height: 60dvh/.test(phone) && /\.ed-panel\[data-own\] \{ height: 60dvh; \}/.test(phone), '폰 시트: panels.js 판(data-own)은 시트에 height 가 있어야 안쪽 목록만 스크롤된다(max-height 만이면 height:100% 가 풀려 목록이 내용 높이까지 늘어나 잘린다)');
assert.ok(/\.pl-root \{[^}]*height: 100%/.test(pcss) && /\.pl-body \{[^}]*flex: 1[^}]*min-height: 0[^}]*overflow-y: auto/.test(pcss), '판은 부모 높이를 채우고 .pl-body 만 스크롤한다(위 규칙과 한 쌍)');
assert.ok(/\.pl-chips \{[^}]*flex-wrap: nowrap[^}]*overflow-x: auto/.test(pco) && /\.pl-chips-tab \{ flex: none; white-space: nowrap; \}/.test(pco), 'coarse: 칩 줄은 한 줄 가로 스크롤(칩 44px 유지)');
assert.ok(/\.pl-fgroup \{ flex-direction: row;/.test(pco), 'coarse: 라벨은 칩 줄 왼쪽에 붙는다(분류 한 줄 · 브랜드 한 줄)');
const tablet = mediaBodies(pcss, /\(pointer: coarse\) and \(min-width: 769px\)/).join(' ');
assert.ok(/\.pl-filters \{[^}]*position: sticky[^}]*top: calc\(-1 \* var\(--sp-3\)\)[^}]*background: var\(--c-surface\)/.test(tablet), '터치 태블릿: 필터 묶음은 위에 붙는다(스크롤 상자 안쪽 여백만큼 당겨 맨 위에)');
assert.ok(!/\.pl-filters \{[^}]*position: sticky/.test(baseCss(pcss)) && !/position: sticky/.test(pco), '폰 시트와 마우스 화면에서는 필터를 붙이지 않는다');

/* ===== 접근성 2단계: 줄 단추 초점 링 · 320px 위 바 · 시트 초점 · 가전 링크 크기 · 터치 아닌 곳의 키보드 안내 ===== */
assert.ok(/\.ed-rb:focus-visible \{ outline-offset: -2px; \}/.test(base), '왼쪽 줄 단추의 초점 링은 단추 안쪽 — 바깥 링은 overflow 줄에 잘려 첫 단추에는 아무것도 안 보인다');
assert.ok(/\.ed-panel:focus \{ outline: none; \}/.test(base) && /id="plPanel"[^>]*tabindex="-1"/.test(html), '폰: 줄 단추로 연 시트로 초점을 코드로 옮기므로 시트는 tabindex=-1 이고 시트 테두리에는 링이 없다');
{ const tiny = mediaBodies(css, /\(max-width: 359px\)/).join(' ');
  assert.ok(/\.ed-top \{ gap: var\(--sp-1\); \}/.test(tiny) && /\.ed-hist \.ed-b \{ padding: 0 var\(--sp-1\); \}/.test(tiny), '320px 폰: 위 바 칸 사이·실행 취소 단추 여백을 한 단계 줄인다(341px → 313px, 저장 단추가 화면 안)');
  assert.ok(css.indexOf('@media (max-width: 359px)') > css.indexOf('@media (max-width: 768px)'), '359px 규칙은 768px 폰 규칙 뒤에 — 같은 특이도라 뒤에 있어야 이긴다'); }
{ const tok = fs.readFileSync(path.join(__dirname, '..', 'assets/css/design-tokens.css'), 'utf8'), sp = (n) => Number((tok.match(new RegExp(`--sp-${n}:\\s*(\\d+)px`)) || [])[1]);
  const src = (pcss.match(/(?<![\w-])\.pl-src \{([^}]*)\}/) || [])[1] || '', minH = Number((src.match(/min-height: (\d+)px/) || [])[1]), bottom = sp((src.match(/bottom: var\(--sp-(\d)\)/) || [])[1]);
  assert.ok(minH >= 24 && /display: inline-flex/.test(src), '가전 카드 [공식 페이지] 링크는 마우스 화면에서도 24px 이상(WCAG 2.5.8) — 글줄 높이(16.7px)로 두지 않는다');
  const pad = sp((pcss.match(/\.pl-app \{ padding-bottom: var\(--sp-(\d)\)/) || [])[1]);
  assert.ok(pad >= bottom + minH, `카드 아래 여백(${pad}px)이 링크 자리(아래 ${bottom}px + 높이 ${minH}px)를 비운다 — 링크가 카드 글을 덮지 않는다`); }
assert.ok(/@media \(pointer: coarse\), \(max-width: 768px\) \{ \.pl-kb \{ display: none; \} \}/.test(pcss), '키보드 안내(.pl-kb)는 폰 폭·터치에서 감춘다 — plan.css 의 state.touch 와 같은 조건');

console.log('test-plan-layout: OK');
