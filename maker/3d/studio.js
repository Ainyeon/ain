// 3D 스튜디오 — 넣기 → 받을 것 → 받기 (처음 온 사람 기준, 2026-10-02 대표 '사용자 친화적으로' — 시안 3개를 사용자 4명 관점으로 비교해 단계형으로).
// 2026-10-06 대표 'suapp 처럼': 큰 판 하나 + 번호 줄(누르면 큰 판이 바뀐다) + 그림으로 고르기. 큰 판은 접지 않는다(예시 모형 → 내 도면 → 내 모형 → 결과).
// 실제 작업은 로그인 후 supabase/20_studio.sql 의 studio_* 함수와 비공개 'studio' 저장소로, 계산은 운영자 장비가 차례로.
// 보안: 파일 이름·작업 결과 문구는 전부 textContent로만(innerHTML 금지). 색·자르기·글자는 기기 안에서만(서버로 안 보냄).
(function () {
  'use strict';
  const D = '/maker/3d/demo/';
  const MB = 1024 * 1024;
  const OUT = {                                          // 받을 것 — 셋 다 같은 엔진, 조감·평면·단면·전개·물량은 늘 함께
    cg: { tool: 'plan3d', name: '도면대로', m: '보통 5분', img: D + 'view_hero.webp' },
    photo: { tool: 'interior', name: '사진처럼', m: '보통 15~25분 · 질감은 AI', img: '/maker/3d/photo.webp' },
    design: { tool: 'design', name: '디자인 제안', m: '보통 15~25분 · 마감·가구는 AI', img: '/maker/3d/design.webp' },
  };
  const ALSO = ['조감', '평면', '단면', '전개', '등각'];
  const TOOLS = [                                        // 사진 손질 — 지우개·배경 떼기는 운영자 장비, 나머지는 기기 안
    { id: 'erase', name: '지우개', kind: 'erase', m: '작은 물건 지우기' },
    { id: 'cutout', name: '배경 떼기', kind: 'cutout', m: '가구 하나만 남기기' },
    { id: 'color', name: '색', kind: 'color' },
    { id: 'crop', name: '자르기', kind: 'crop' },
    { id: 'text', name: '글자', kind: 'text' },
  ];
  const NAME = { plan3d: '도면대로', interior: '사진처럼', design: '디자인 제안', erase: '지우개', cutout: '배경 떼기' };
  const DEMO = {                                         // 파일 · 큰 판 아래 이름 · 번호 줄 이름
    photo: [['/maker/3d/photo.webp', '사진처럼', '사진처럼'], ['/maker/3d/design.webp', '디자인 제안', '디자인']],
    views: [['view_hero.webp', '거실 와이드', '거실'], ['view_wide.webp', '전체 와이드', '전체'], ['view_reverse.webp', '역방향', '역방향'], ['view_medium.webp', '실내기 가까이', '가까이']],
    aerial: [['aerial.webp', '조감 — 천장 속 냉매 배관(청록)', '조감']],
    drawings: [['plan.webp', '컬러 평면도', '평면'], ['section.webp', '단면 — 천장고·반자 속(가정)', '단면'], ['elev_south.webp', '전개도', '전개'], ['iso.webp', '등각도', '등각'], ['elev_east.webp', '전개도', '전개 2']],
  };
  const GROUPS = ['photo', 'views', 'aerial', 'drawings', 'edit'];   // 결과 번호 줄의 순서: AI 사진 → 실내 → 조감 → 도면 → 손질 결과
  const EX = [].concat(...Object.entries(DEMO).map(([g, xs]) => xs.map(([f, cap, short]) => ({ url: f.startsWith('/') ? f : D + f, cap, short, group: g, ai: g === 'photo' }))));
  const BLANK = {};                                      // 큰 판에 올릴 것이 아직 없을 때(주소로 연 작업) — 글 없는 빈 판
  const LBL = { lg: 'LG', samsung: '삼성', white: '화이트', wood: '우드', gray: '그레이', day: '낮', evening: '저녁' };
  const ERR = {                                          // 사실 + 다음 행동 — 서버 오류 코드는 화면에 그대로 내보내지 않는다(한도 숫자는 서버 상수라 싣지 않는다)
    login_required: '로그인이 풀렸습니다 · 다시 로그인해 주세요.', tool_not_allowed: '지금은 쓸 수 없습니다 · 다른 받을 것을 골라 주세요.',
    limit_month: '이번 달 작업 한도를 다 썼습니다 · 다음 달 1일에 다시 열립니다.', limit_active: '진행 중인 작업이 있습니다 · 끝난 뒤 다시 눌러 주세요.',
    bad_file: '이 파일은 올릴 수 없습니다 · DWG·DXF·PDF·사진으로 다시 넣어 주세요.', not_found: '이 계정에서 찾을 수 없는 작업입니다 · 내 작업에서 골라 주세요.',
    PGRST202: '지금은 예시만 됩니다.',
  };
  const OK_EXT = ['dwg', 'dxf', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif'];
  const S = { session: null, file: null, out: 'cg', opt: { brand: 'lg', style: 'white', mood: 'day', area: '' }, timer: null, busy: false, view: 'in',
    items: [], pic: null, tok: 0, fin: false, sent: null, sheet: false };   // items 번호 줄 · pic 큰 판에 올린 것(null = 모형) · sent 이 방문에서 올린 작업
  const $ = (id) => document.getElementById(id);
  document.addEventListener('touchstart', () => {}, { passive: true });
  const rise = (el) => { if (el) new MutationObserver(() => { el.classList.remove('say'); void el.offsetWidth; el.classList.add('say'); }).observe(el, { childList: true, characterData: true, subtree: true }); };   // 상태 글이 바뀌면 띡 바뀌지 않고 떠오른다(애니는 .say 가 건다)   // iOS 사파리는 이게 있어야 눌린 순간(:active)이 보인다
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CSSV = getComputedStyle(document.documentElement), ms = (k, d) => parseFloat(CSSV.getPropertyValue(k)) || d;   // 전환 시간은 CSS 토큰이 정한다 — 타이머도 같은 값을 따라간다
  const T = { base: ms('--t-base', 200), slow: ms('--t-slow', 350) };
  const motion = () => (still() ? 'auto' : 'smooth');

  function h(tag, attrs, kids) {                         // 작은 DOM 도우미 — 글자는 textContent 로만
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids || [])) if (c) el.append(c);
    return el;
  }
  const errText = (e) => {
    const known = ERR[(e && (e.code === 'PGRST202' ? 'PGRST202' : e.message)) || ''];
    if (known) return known;
    if (!navigator.onLine || /network|fetch|load failed|timeout/i.test((e && e.message) || '')) return '연결이 끊겼습니다 · 네트워크를 확인하고 다시 눌러 주세요.';
    console.warn('studio', e);                          // 원문은 콘솔에만
    return '처리하지 못했습니다 · 잠시 뒤 다시 눌러 주세요.';
  };
  const client = () => window.ainAuth && window.ainAuth.getClient();
  const fmtMB = (n) => (n / MB < 1 ? Math.max(1, Math.round(n / 1024)) + 'KB' : (n / MB).toFixed(1) + 'MB');
  const clean = (cap) => (cap || '').replace(/\s*·\s*형태 일치 \d+%/, '').replace('(AI)', '').replace(' — 마감·가구는 AI', '').replace(' 다듬기', '');   // 수치는 AI 사진이 도면만큼 정확하다는 뜻으로 읽혀 화면에선 뺀다 · 'AI' 는 표시가, 나머지는 받을 것 줄이 이미 말한다
  const isDemo = () => !!$('stOutBody').dataset.demo;
  const heroOf = () => EX.find((x) => x.url === OUT[S.out].img);
  const area = () => { const a = Number(S.opt.area); return S.file && S.file.isImg && a >= 10 && a <= 400 ? a : ''; };   // 실제로 보낼 전용면적(범위 밖·사진 아님 = 자동)
  const key = () => JSON.stringify([S.out, S.opt.brand, S.opt.style, S.opt.mood, area()]);   // 방금 만든 것과 같은 주문인가
  function mine() {                                      // 넣은 도면을 큰 판·번호 줄에 올릴 항목 — S.file 안에 두지 않는다(로그인 왕복 때 IndexedDB 로 들어간다)
    if (!S.file) return null;
    if (!S.mine || S.mine.f !== S.file) S.mine = Object.assign({ f: S.file, mine: true, cap: S.file.name }, S.file.thumb ? { url: S.file.thumb } : { ext: S.file.up.toUpperCase() });
    return S.mine;
  }
  function gone(el, off) {                               // 사라질 때도 띡 사라지지 않게 — 흐려진 뒤 숨긴다
    clearTimeout(el._t);
    if (!off) { el.classList.remove('bye'); el.hidden = false; return; }
    if (el.hidden) return;
    el.classList.add('bye');
    el._t = setTimeout(() => { el.hidden = true; el.classList.remove('bye'); }, still() ? 0 : T.base);
  }
  // ── 공동 브랜드(파트너) · 임베드 ─────────────────────────
  // ?partner=<이름> → /maker/3d/partners/<이름>.json(이름·로고·색·숨길 칸·허용 사이트). 검증을 통과한 것만 쓰고, 못 받으면 에인연 화면 그대로.
  // ?embed=1 → 상단 메뉴 없이, 허용 사이트(hosts)에만 말을 건넨다(postMessage ns 'ain3d': ready · job · done).
  const P = { cfg: null };
  const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
  async function partner() {
    const root = document.documentElement, id = root.getAttribute('data-partner');
    if (!id) return;
    const off = () => root.removeAttribute('data-partner');
    try {
      const c = await (window.__ptCfg || fetch('/maker/3d/partners/' + id + '.json').then((r) => (r.ok ? r.json() : null)));   // partner-boot.js 가 이미 받기 시작했다
      if (!c) return off();
      const hex = /^#[0-9a-f]{6}$/i;
      const ok = typeof c.name === 'string' && c.name.length > 0 && c.name.length <= 20 && /^\/maker\/3d\/partners\/[a-z0-9-]+\.svg$/.test(c.logo || '') && /^https:\/\//.test(c.home || '')
        && [c.accent, c.accentBg, c.accentLine].every((x) => hex.test(x)) && contrast(c.accent, '#ffffff') >= 4.5 && contrast(c.accent, c.accentBg) >= 4.5;   // 글자 대비가 모자란 색은 쓰지 않는다
      if (!ok) return off();
      P.cfg = c; P.id = id;
      root.style.setProperty('--c-accent', c.accent); root.style.setProperty('--c-accent-bg', c.accentBg); root.style.setProperty('--c-accent-line', c.accentLine);
      try { localStorage.setItem('ain-pt-' + id, JSON.stringify([c.accent, c.accentBg, c.accentLine])); } catch (e) {}   // 검증을 통과한 색만 — 다음 방문 첫 그림에 쓴다
      if (!root.hasAttribute('data-embed')) {
        $('ptLogo').href = c.home; $('ptLogoImg').src = c.logo; $('ptLogoImg').alt = c.name;
        $('ptAuth').append($('authSlot'));              // 로그인 단추도 이 줄로(같은 칸이라 로그인 동작은 그대로)
        $('ptBar').hidden = false; $('ptFoot').hidden = false;
      }
      if ((c.hide || []).includes('tools')) document.querySelector('.st-tools').hidden = true;
      document.title = c.name + ' 3D 스튜디오';
    } catch (e) { off(); }
  }
  const keepQ = () => {                                  // 다시 쓰는 주소에 파트너·임베드 표시를 남긴다 — 로그인 토큰·코드는 싣지 않는다(표시 속성은 partner-boot.js 가 검증해 건 것)
    const r = document.documentElement, k = [];
    if (r.hasAttribute('data-partner')) k.push('partner=' + r.getAttribute('data-partner'));
    if (r.hasAttribute('data-embed')) k.push('embed=1');
    return k.length ? '?' + k.join('&') : '';
  };
  const noTools = () => !!(P.cfg && (P.cfg.hide || []).includes('tools'));
  function tell(type, data) {                           // 임베드일 때만, 파트너가 허용한 사이트(hosts)에만 — 아무에게나 보내지 않는다
    if (!P.cfg || !document.documentElement.hasAttribute('data-embed') || window.parent === window) return;
    for (const o of P.cfg.hosts || []) try { parent.postMessage(Object.assign({ ns: 'ain3d', type }, data), o); } catch (e) {}
  }

  function see() {                                       // 큰 판과 그 아래 줄이 다 보이면 그대로, 가려져 있으면 큰 판 위로(붙은 메뉴 아래)
    const el = $('stLive'), top = el.getBoundingClientRect().top, low = $('stOut').getBoundingClientRect().bottom;
    if (top < (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0) || low > innerHeight) el.scrollIntoView({ behavior: motion(), block: 'start' });
  }
  function clearFile() {                                 // 넣은 도면을 비운다 — 썸네일 주소도 놓는다
    if (S.file && S.file.thumb) URL.revokeObjectURL(S.file.thumb);
    S.file = S.mine = null;
    fileRow();
  }
  function seg(opts, cur, on, label) {                   // 하나 고르기 줄 — 다시 그리지 않고 표시만 바꾼다(색 전환이 돌고 초점이 남는다)
    const row = h('div', { class: 'st-row', role: label ? 'group' : null, 'aria-label': label }, opts.map(([v, n]) => h('button', { type: 'button', text: n, class: v === cur ? 'on' : null, 'aria-pressed': String(v === cur),
      onclick: (e) => { for (const b of row.children) { const hit = b === e.currentTarget; b.classList.toggle('on', hit); b.setAttribute('aria-pressed', String(hit)); } on(v); } })));
    return row;
  }

  // ── 화면 상태: in(넣기) · pick(받을 것) · out(받기) — 뒤로가기로 앞 단계. 칸을 접지 않는다(큰 판·번호 줄이 상태를 보여 준다) ──────────
  function setView(v, push = true) {
    S.view = v;
    if (v !== 'out') {                                   // 작업 화면을 떠나면 확인을 멈추고 큰 판은 예시로
      clearTimeout(S.timer);
      S.job = S.scene = null; S.fin = false;
      requestAnimationFrame(() => { if (S.view !== 'out') live(); });   // 한 박자 뒤, 그때도 예시일 때만(작업 주소로 바로 들어오면 예시 뷰어를 받지 않는다)
      demo();
    }
    bar();
    if (push) history.pushState({ v }, '', location.pathname + keepQ());
    if (v === 'pick') { $('stPickH').focus({ preventScroll: true }); $('stPickH').scrollIntoView({ behavior: motion(), block: 'nearest' }); }   // 보이면 그대로 — 큰 판에 올린 내 도면을 밀어내지 않는다
    if (v === 'out') { $('stOutH').focus({ preventScroll: true }); see(); }
  }

  // ── 예시 모형: 로그인·올리기 없이 바로 돌려 보는 합성 평면(2026-10-06 대표 '이렇게 매끄럽게') ──────────
  // 뷰어는 같은 출처 /maker/3d/view/ (엔진 commercial3d 뷰어 내보내기), 장면은 자료(apartment.json). 뷰어가 못 뜨면 조감 그림이 그대로 남는다.
  // 내 작업 장면(S.scene)은 주소가 아니라 말로 넘긴다(scene=@host → 뷰어 need → load). 뷰어 문서는 저장소와 말하지 않는다.
  function live() {
    const mine = S.scene || null;
    if (S.live === mine) return;                         // 같은 장면이면 그대로(보던 자리 유지) — S.live: 아직 없음 undefined · 예시 null · 내 장면
    S.live = mine;
    const box = $('stLiveBox'), msg = $('stLiveMsg'), nav = $('stLiveNav');
    const gone0 = S.frame; if (gone0) { gone0.inert = true; setTimeout(() => gone0.remove(), still() ? 0 : T.slow); }   // 옛 모형은 흐려지는 동안 조감 그림을 받치고 있다가 지운다(한 프레임에 사라지지 않게)
    box.classList.remove('on');
    clearTimeout(S.slowT);
    msg.textContent = '모형 받는 중…';                       // 받는 동안 빈 줄로 두지 않는다 — 늦으면 그렇게 말한다
    S.slowT = setTimeout(() => { if (!box.classList.contains('on')) msg.textContent = '모형이 늦어지고 있습니다'; }, 8000);
    nav.replaceChildren();
    box.querySelector('img').hidden = !!mine;            // 예시 그림은 내 모형 밑에 깔지 않는다('예시' 표시는 show() 가 맞춘다)
    const frame = S.frame = h('iframe', { src: '/maker/3d/view/?embed&scene=' + (mine ? '@host' : 'apartment&v=2'), title: mine ? '내 공간 모형' : '예시 평면 모형', loading: mine ? null : 'lazy' });
    const send = (m) => frame.contentWindow.postMessage(Object.assign({ ns: 'bd3d' }, m), location.origin);
    const mark = (id) => { for (const b of nav.children) { const on = b.dataset.id === (id || '') || (!!id && b.dataset.zone === id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); if (on && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2, behavior: motion() }); } };   // 바닥을 눌러 들어가면 id 가 구역이다
    window.removeEventListener('message', S.heard);
    window.addEventListener('message', S.heard = (e) => {
      const m = e.data;
      if (e.origin !== location.origin || e.source !== frame.contentWindow || !m || m.ns !== 'bd3d') return;
      if (m.type === 'need') { if (mine) send({ type: 'load', bundle: mine }); }
      else if (m.type === 'ready') {
        box.classList.add('on');
        clearTimeout(S.slowT);
        S.up = frame;
        frame.inert = !!S.pic;
        if (mine && S.pic && (S.pic.mine || S.pic === BLANK)) show(null);   // 기다리던 판(내 도면·빈 판)이면 이제 모형으로 겹쳐 넘긴다 — 그 사이 고른 그림·결과는 덮지 않는다
        msg.textContent = '실내기를 눌러 보세요';
        nav.replaceChildren(h('button', { type: 'button', 'data-id': '', style: '--i:0', text: '전체', onclick: () => send({ type: 'home' }) }),
          ...(m.entries || []).slice(0, 12).map((en, k) => h('button', { type: 'button', 'data-id': String(en.id), 'data-zone': String(en.zone || ''), style: '--i:' + (k + 1), text: String(en.name), onclick: () => send({ type: 'goUnit', id: en.id }) })));
        mark(null);
      } else if (m.type === 'enter') { msg.textContent = `${m.title} · ${m.sub}`; mark(m.id); }
      else if (m.type === 'home') { msg.textContent = '실내기를 눌러 보세요'; mark(null); }
      else if (m.type === 'drop' && m.file instanceof File) { $('stDrop').classList.remove('over'); if ($('stPanel').hidden) take(m.file); }   // 모형 위에 떨어뜨리거나 붙여넣은 파일도 넣기로
    });
    frame.inert = true;                                  // 뜨기 전(안 보임)에는 초점·읽기에서 뺀다 — ready 에서 푼다
    box.append(frame);                                   // 듣기를 먼저 걸고 만든다 — ready 를 놓치지 않는다
  }

  // ── 큰 판 · 번호 줄 ─────────────────────────────────
  // 항목: {url, cap, short?, group, ai, path?} · 내 도면 {mine, url | ext, cap} · BLANK. 모형 칸은 예시이거나 내 모형이 왔을 때만.
  function rail(items) {
    S.items = items;
    const had = $('stRail').contains(document.activeElement);   // 방향키로 넘기던 중이면 다시 그린 뒤 초점을 돌려준다
    const old = new Set([...$('stRail').querySelectorAll('input')].map((q) => q._x));   // 이미 줄에 있던 칸 — 다시 그려도 사라졌다 떠오르지 않는다(새로 생긴 칸만 떠오른다)
    let n = 0, i = 0;
    const tile = (x, body, name, label) => {
      const inp = h('input', { type: 'radio', name: 'view', 'aria-label': label, onchange: () => show(x) });
      inp._x = x;
      const kept = old.has(x);
      const el = h('label', { class: 'st-th' + (x && x.mine ? ' mine' : '') + (kept ? ' kept' : '') }, [inp, h('span', { class: 'b' }, body), h('span', { class: 't', text: name })]);
      if (!kept) el.style.setProperty('--i', Math.min(i++, 12));
      return el;
    };
    const pic = (x) => h('img', { src: x.url, alt: '', loading: 'lazy', decoding: 'async' });
    $('stRail').replaceChildren(
      ...items.filter((x) => x.mine).map((x) => tile(x, x.url ? pic(x) : x.ext, '내 도면', '내 도면')),
      ...(isDemo() || S.scene ? [tile(null, '모형', '', '모형')] : []),   // 글자 칸 — 이름을 한 번 더 적지 않는다
      ...items.filter((x) => !x.mine).map((x) => tile(x, [pic(x), h('span', { class: 'n', text: String(++n) }), x.ai ? h('span', { class: 'ai', text: 'AI' }) : null], x.short || x.cap.split(/ [—·] /)[0], n + ' ' + x.cap)));
    mark();
    const to = had && ($('stRail').querySelector('input:checked') || $('stRail').querySelector('input'));
    if (to) to.focus({ preventScroll: true });
  }
  function mark() {                                      // 고른 칸 표시 + 줄 안에서만 그 칸으로(scrollIntoView 는 페이지까지 끌고 간다)
    const r = $('stRail');
    for (const inp of r.querySelectorAll('input')) {
      inp.checked = inp._x === S.pic;
      const t = inp.parentNode;
      if (inp.checked) r.scrollTo({ left: t.offsetLeft - (r.clientWidth - t.offsetWidth) / 2, top: t.offsetTop - (r.clientHeight - t.offsetHeight) / 2, behavior: motion() });
    }
  }
  function show(x) {                                     // 큰 판에 올린다 — null 이면 모형. 새 그림이 다 열린 뒤 겹쳐 넘기고(빈 순간 없음) 마지막에 고른 것이 이긴다
    x = x || null;
    const box = $('stLiveBox'), prev = S.pic;
    S.pic = x;
    mark();
    const sync = () => {                                 // 큰 판 아래 줄·표시를 지금 올라온 것에 맞춘다(그림은 다 열린 뒤에 부른다 — 이름이 그림보다 먼저 바뀌지 않게)
      $('stLive').classList.toggle('pic', !!x);
      if (S.frame) S.frame.inert = !!x || S.up !== S.frame;   // 그림이 덮고 있거나 아직 안 뜬 모형은 초점·읽기에서 뺀다
      box.querySelector('.st-tag').classList.toggle('off', !isDemo() || !!(x && x.mine));   // '예시' 는 예시 모형·예시 그림에만
      if (!x) return;
      $('stCapT').replaceChildren(...[x.ai ? h('span', { class: 'st-tag', text: 'AI' }) : null, h('span', { class: 'c', text: x.mine ? '' : x.cap || '' }), x.ai ? h('span', { class: 'w', text: '도면과 다를 수 있음' }) : null].filter(Boolean));   // 내 도면 이름은 파일 줄이 이미 말한다
      $('stCapA').replaceChildren(...[x.url && !x.mine ? h('a', { class: 'btn-line', href: x.url, target: '_blank', rel: 'noopener', text: '크게' }) : null,
        x.path ? h('button', { type: 'button', class: 'st-save', text: '저장', onclick: (e) => keepPic(x, e.currentTarget) }) : null].filter(Boolean));
      if (x.path && matchMedia('(pointer: coarse)').matches) ready(x);   // 폰은 누른 그 자리에서 공유 창을 띄워야 한다 — 미리 받아 둔다
    };
    if (x === prev) return sync();                       // 같은 것을 다시 올림 — 열리는 중인 층이 그대로 이긴다(토큰을 올리면 그 층이 스스로 지워진다)
    const tok = ++S.tok;
    const old = [...box.querySelectorAll('.st-pic')], drop = () => setTimeout(() => old.forEach((o) => o.remove()), T.slow + 50);   // 옛 층은 새 층이 다 열린 뒤에 지운다
    if (!x) { box.removeAttribute('aria-busy'); sync(); old.forEach((o) => o.classList.remove('in')); return drop(); }
    const layer = h('div', { class: 'st-pic', 'data-d': prev && S.items.indexOf(prev) > S.items.indexOf(x) ? 'p' : 'n' });
    const on = () => { if (tok !== S.tok) return layer.remove(); box.removeAttribute('aria-busy'); sync(); void layer.offsetWidth; layer.classList.add('in'); drop(); };
    const fail = () => {                                 // 못 열었다(서명 주소 만료·망 끊김) — 앞 상태로 되돌린다(모형이면 다시 눌린다)
      layer.remove();
      if (tok !== S.tok) return;
      box.removeAttribute('aria-busy');
      S.pic = prev; mark();
      if (prev) capErr(); else $('stLiveMsg').textContent = '열지 못했습니다';
    };
    if (x.url) box.setAttribute('aria-busy', 'true'); else box.removeAttribute('aria-busy');
    if (x.url) layer.append(h('img', { src: x.url, alt: x.cap || '', decoding: 'async', onload: on, onerror: fail }));
    else if (x.ext) layer.append(h('div', { class: 'st-doc' }, [h('strong', { text: x.ext }), h('span', { text: x.cap })]));
    box.append(layer);
    if (!x.url) on();
  }
  const capErr = (t) => $('stCapT').replaceChildren(h('span', { class: 'c', text: t || '그림을 열지 못했습니다' }),   // 결과 화면이면 다시 불러오기(서명 주소는 한 시간짜리라 만료되기도 한다)
    ...(S.job && S.view === 'out' ? [h('button', { type: 'button', class: 'btn-line', text: '다시 불러오기', onclick: () => runView(S.job, false) })] : []));
  const ready = (x) => (x.ready = x.ready || client().storage.from('studio').download(x.path).then((d) => { if (d.error) x.ready = null; else x.blob = d.data; }, () => { x.ready = null; }));
  function keepPic(x, btn) {                             // 저장 — 폰은 공유 창(사진첩에 닿는다), 그 밖은 내려받기
    if (!x.blob) {                                       // 아직 못 받았다 — 받는 동안 단추를 잠그고(여러 번 눌러도 한 번) 다 받으면 이어서
      btn.disabled = true;
      return ready(x).then(() => { btn.disabled = false; if (x.blob) keepPic(x, btn); else if (S.pic === x) capErr(); });
    }
    const ext = (/\.(webp|png|jpe?g)$/i.exec(x.path) || [0, 'webp'])[1].toLowerCase();   // 아는 확장자만 — 경로를 이름에 싣지 않는다
    const name = ((x.cap || '').replace(/[\\/:*?"<>|\u0000-\u001f‪-‮]/g, ' ').trim().slice(0, 40) || 'ain-studio') + '.' + ext;
    const file = new File([x.blob], name, { type: x.blob.type || (ext === 'jpg' ? 'image/jpeg' : 'image/' + ext) });
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file] }).catch((e) => { if (!e || e.name !== 'AbortError') save(x.blob, name); });
    save(x.blob, name);
  }

  // ── 넣기 ──────────────────────────────────────────
  async function take(f, many) {                         // many: 한꺼번에 놓은 파일 수 — 첫 파일만 쓴다
    const msg = $('stInMsg');
    msg.className = 'st-msg err';
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!OK_EXT.includes(ext)) { msg.textContent = (/^[a-z0-9]{2,5}$/.test(ext) ? '.' + ext + ' 는 올릴 수 없습니다 · ' : '이 파일은 올릴 수 없습니다 · ') + 'DWG·DXF·PDF·사진(JPG·PNG·WEBP)으로 넣어 주세요'; return; }
    if (f.size > 20 * MB) { msg.textContent = fmtMB(f.size) + ' 파일입니다 · 20MB 이하로 줄여 다시 넣어 주세요'; return; }
    let blob = f, up = ext, isImg = /^(png|jpe?g|webp|heic|heif)$/.test(ext), thumb = null;
    if (isImg) {
      const im = await loadImage(f);
      if (!im) { msg.textContent = /^hei[cf]$/.test(ext) ? 'HEIC 는 이 기기에서 열리지 않습니다 · JPG 로 저장해 다시 넣어 주세요' : '사진을 열지 못했습니다 · 다른 사진으로 다시 넣어 주세요'; return; }
      if (ext !== 'png') {                                // PNG 는 원본(가는 선이 흐려지지 않게), 나머지는 JPEG 로 — HEIC 변환·위치 정보 제거도 이 한 번으로
        blob = await toBlob(fitCanvas(im, 4096), 'image/jpeg', .95);
        up = 'jpg';
      }
      thumb = URL.createObjectURL(blob);
    }
    if (S.file && S.file.thumb) URL.revokeObjectURL(S.file.thumb);
    S.file = { blob, name: f.name, up, size: blob.size, isImg, thumb, type: up === 'jpg' ? 'image/jpeg' : f.type || 'application/octet-stream' };
    msg.className = 'st-msg'; msg.textContent = many > 1 ? '한 번에 한 장씩 넣습니다 · 첫 파일만 사용했습니다' : '';
    fileRow();
    pick();
    setView('pick');
    show(mine());                                        // 넣은 도면이 큰 판에 — 들어갔다는 것이 보인다
  }
  function fileRow() {
    const r = $('stFileRow');
    $('stWiz').dataset.file = S.file ? '1' : '';        // 폰은 도면을 넣은 뒤에 받을 것(studio.css)
    const fold = (on) => { $('stDropF').classList.toggle('off', on); $('stDropF').inert = on; $('stFileF').classList.toggle('off', !on); $('stFileF').inert = !on; };   // 접히며 바뀐다 — 접히는 쪽은 초점·읽기에서도 뺀다
    if (!S.file) { fold(false); return; }
    fold(true);
    r.replaceChildren(S.file.thumb ? h('img', { src: S.file.thumb, alt: '', width: 56, height: 56 }) : h('span', { class: 'ext', text: S.file.up.toUpperCase() }),
      h('span', { class: 'nm' }, [S.file.name, h('small', { text: fmtMB(S.file.size) })]),
      h('button', { type: 'button', class: 'btn-line', text: '바꾸기', onclick: () => { clearFile(); setView('in'); $('stPick').focus(); } }));
  }

  // ── 받을 것 ────────────────────────────────────────
  function pick() {
    const say = () => $('stPickM').replaceChildren(h('span', { text: OUT[S.out].m }));
    const hero = () => { if (isDemo() && !(S.pic && S.pic.mine)) show(heroOf()); };   // 고르면 그 예시가 큰 판에(내 도면을 보는 중이면 그대로)
    $('stPickSet').replaceChildren(h('legend', { class: 'st-vh', text: '받을 것' }), ...Object.entries(OUT).map(([k, o]) =>
      h('label', { class: 'st-opt' }, [
        h('input', { type: 'radio', name: 'out', value: k, checked: S.out === k, onchange: () => { S.out = k; say(); bar(); hero(); }, onclick: () => { if (S.out === k) hero(); } }),   // 이미 고른 것을 다시 눌러도 반응한다
        h('span', { class: 'st-opt-b' }, [h('span', { class: 'p' }, [h('img', { src: o.img, alt: '', width: 160, height: 100, loading: 'lazy' }), k !== 'cg' ? h('span', { class: 'st-tag', text: 'AI' }) : null]),
          h('span', { class: 't', text: o.name })]),
      ])));
    say();
    $('stAlso').textContent = '함께 받음 · ' + ALSO.concat('물량').join(' · ');
    more();
  }
  function more() {
    const o = S.opt;
    const row = (k, name, vals) => seg(vals.map((v) => [v, LBL[v]]), o[k], (v) => { o[k] = v; keep(); bar(); }, name);
    const img = S.file && S.file.isImg;
    $('stMoreBody').replaceChildren(...[h('p', { class: 'lbl', text: '제조사' }), row('brand', '제조사', ['lg', 'samsung']), h('p', { class: 'lbl', text: '마감 톤' }), row('style', '마감 톤', ['white', 'wood', 'gray']),
      h('p', { class: 'lbl', text: '시간' }), row('mood', '시간', ['day', 'evening']),
      img ? h('label', { class: 'lbl wide', for: 'stArea', text: '전용면적(㎡) · 비우면 자동' }) : null,
      img ? h('input', { class: 'wide', type: 'number', id: 'stArea', name: 'area', autocomplete: 'off', min: 10, max: 400, step: '0.01', inputmode: 'decimal', placeholder: '예) 84.97', value: o.area,
        oninput: (e) => { o.area = e.target.value; bar(); } }) : null].filter(Boolean));
  }
  function keep() { try { localStorage.setItem('ain-studio-opt', JSON.stringify({ brand: S.opt.brand, style: S.opt.style, mood: S.opt.mood })); } catch (e) {} }
  function bar() {                                       // 바: 받을 것 단계의 [만들기] · 이 방문에서 그 도면으로 올린 작업이 끝난 뒤 [다시 만들기](선 모양) — 실패했거나, 받을 것·설정을 바꿨을 때만(같은 주문을 잘못 눌러 한 건을 쓰지 않게)
    const go = $('stGo'), re = $('stRe'), eta = $('stEta');
    const again = S.view === 'out' && !!S.fin && !!S.sent && S.sent.id === S.job && S.sent.f === S.file && (S.fin === 'fail' || key() !== S.sent.key);
    const on = S.view === 'pick' || again;
    gone($('stBar'), !on);
    $('stPick').classList.toggle('primary', S.view !== 'out');   // 작업을 보는 동안 채운 단추는 [저장] 하나
    if (!on) return;                                     // 사라지는 동안에는 안을 바꾸지 않는다(단추가 먼저 빠지지 않게)
    go.hidden = S.view !== 'pick';
    re.hidden = !again;
    go.disabled = re.disabled = S.busy;
    const t = S.session ? [LBL[S.opt.brand], LBL[S.opt.style], LBL[S.opt.mood]].join(' · ') : '로그인해도 도면은 남습니다';   // 고른 설정이 다음 만들기에 들어간다
    if (eta.textContent !== t) eta.replaceChildren(h('span', { text: t }));
    go.textContent = S.busy ? '올리는 중…' : S.session ? '만들기' : '카카오 로그인 후 만들기';
    re.textContent = S.busy ? '올리는 중…' : '다시 만들기';
  }

  async function submit() {
    if (!S.file) return setView('in');
    const ar = $('stMoreBody').querySelector('input');
    if (ar && !ar.checkValidity()) return ar.reportValidity();   // 전용면적이 범위 밖이면 말없이 버리지 않고 그 칸에서 알린다
    if (!S.session) return login(true);
    const params = { brand: S.opt.brand, style: S.opt.style, mood: S.opt.mood, photo: S.out !== 'cg', photo_mode: S.out === 'design' ? 'design' : 'photo', staging: true };
    if (area()) params.area = area();
    const k = key(), f = S.file;                         // 올리는 중에 도면을 바꿔도 이 작업의 도면은 이것
    $('stInMsg').textContent = '';
    S.busy = true; bar();
    try {
      const id = await submitJob(OUT[S.out].tool, params, [{ name: 'in.' + S.file.up, blob: S.file.blob, type: S.file.type }]);
      S.busy = false;
      S.sent = { id, key: k, f, m: OUT[S.out].m.split(' · ')[0] };   // m: '보통 5분' — 이 방문에서 올린 작업만 기준 시간을 말한다(값을 만들지 않는다)
      runView(id, true);
    } catch (e) {
      S.busy = false; bar();
      $('stInMsg').className = 'st-msg err';
      $('stInMsg').textContent = errText(e);
      $('stInMsg').scrollIntoView({ behavior: motion(), block: 'center' });   // 누른 자리(아래 바)에서 안 보이는 줄이다
    }
  }

  // ── 받기: 진행 · 결과 ─────────────────────────────────
  function demo() {                                      // 작업을 보지 않을 때 — 번호 줄은 예시(넣은 도면이 있으면 맨 앞에)
    const body = $('stOutBody'), m = mine();
    body.dataset.demo = '1';
    $('stOutH').textContent = '예시';
    body.replaceChildren(h('p', { class: 'note', text: '가구·소품은 연출' }));
    $('stSum').replaceChildren();
    rail((m ? [m] : []).concat(EX));
    show(S.items.includes(S.pic) ? S.pic : m || null);   // 보던 예시는 그대로, 작업에서 돌아왔으면 넣은 도면(없으면 모형)
  }

  const BOM_HEAD = ['구분', '품목', '규격', '수량', '단위', '근거'];
  function csv(rows) {                                   // 물량표 CSV — 엑셀에서 한글이 깨지지 않게 BOM, 수식으로 읽힐 글자는 앞에 ' 를 붙인다
    const cell = (v) => { let t = String(v ?? '').replace(/\r?\n/g, ' '); if (/^([=+@]|-\D)/.test(t)) t = "'" + t; return /[",]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    save(new Blob(['\ufeff' + [BOM_HEAD].concat(rows).map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), '물량표.csv');
  }
  function render(sum) {                                 // 물량 · 확인 필요 — 두 칼럼 아래 폭 전체
    const box = h('div', { class: 'st-out' });
    if ((sum.bom || []).length) box.append(h('div', { class: 'st-sumhead' }, [h('h3', { text: '물량' }), h('button', { type: 'button', class: 'btn-line', text: 'CSV', onclick: () => csv(sum.bom) })]), h('div', { class: 'st-wrap' }, h('table', { class: 'st-table' }, [
      h('tr', {}, ['구분', '품목', '규격', '수량', '단위', '근거'].map((x) => h('th', { text: x }))),
      ...sum.bom.map((r) => h('tr', {}, r.map((x) => h('td', { text: String(x ?? '') }))))])));
    if ((sum.pending || []).length) box.append(h('h3', { text: '확인 필요' }), h('ul', {}, sum.pending.map((x) => h('li', { class: 'st-msg', text: x }))));
    if (sum.note) box.append(h('p', { class: 'note', text: sum.note }));
    return box;
  }
  function fig(x) {
    return h('figure', {}, [h('img', { src: x.url, alt: x.cap, loading: 'lazy', decoding: 'async' }),
      h('figcaption', {}, [h('span', { text: x.cap }), h('a', { href: x.url, target: '_blank', rel: 'noopener', text: '크게' })])]);
  }

  const watching = (id) => S.job === id && S.view === 'out' && !isDemo();   // 그 작업 화면을 지금 보고 있나(떠난 뒤에도 도는 확인이 화면에 끼어들지 않게)
  async function scene(id) {                             // 작업기가 모형이 서자마자 올려 둔 장면 — 있으면 그림을 기다리지 않고 내 모형부터
    const st = client().storage.from('studio'), dir = S.session.user.id + '/' + id + '/out';
    const ls = await st.list(dir, { search: 'scene.json' });   // 아직 없을 때 404 를 내지 않으려고 목록부터
    if (ls.error || !(ls.data || []).some((o) => o.name === 'scene.json')) return;
    const d = await st.download(dir + '/scene.json');
    if (d.error) return;
    const b = JSON.parse(await d.data.text());
    if (!b || !b.data || !b.checks || !watching(id)) return;
    S.scene = b;
    live();
    rail(S.items);                                       // 모형 칸이 생긴다 — 큰 판은 모형이 뜬 뒤(ready)에 넘긴다(그 사이 빈 판이 되지 않게)
  }

  function runView(id, push) {
    clearTimeout(S.timer);
    const run = S.run = (S.run || 0) + 1, stale = () => S.run !== run || S.job !== id;   // 이 화면의 확인 고리 — 떠났거나 다시 열었으면 앞 고리는 화면에 쓰지 않는다
    S.job = id;
    S.scene = null; S.fin = false;
    const body = $('stOutBody');
    delete body.dataset.demo;
    $('stOutH').textContent = '받기';
    const steps = h('ol', { class: 'st-steps', 'aria-hidden': 'true' }, [h('li'), h('li'), h('li')]);   // 접수 · 만드는 중 · 완료 — 뜻은 옆의 상태 글이 말한다
    const msg = h('p', { class: 'st-msg', role: 'status' }); rise(msg);
    const tail = h('div', { class: 'st-tail' }, [h('p', { class: 'note', text: '닫아도 됩니다 · 내 작업에 남습니다' })]);
    body.replaceChildren(h('div', { class: 'st-run' }, [steps, msg, tail]));
    $('stSum').replaceChildren();
    const m = S.sent && S.sent.id === id && S.sent.f === S.file ? [mine()] : [];   // 기다리는 동안 큰 판에는 그 작업에 넣은 도면(주소·내 작업으로 연 것, 도면을 바꾼 뒤는 빈 판)
    rail(m);
    show(m[0] || BLANK);
    setView('out', push ?? S.view !== 'out');
    history.replaceState({ v: 'out' }, '', '#job-' + id);
    const t0 = Date.now();
    let last = '', fails = 0, now = -1, told = '';
    const note = (status, extra) => { if (told !== status) { told = status; tell('job', Object.assign({ id, status }, extra)); } };   // 상태가 바뀔 때만 한 번씩
    const paint = (n) => { if (n !== now) { now = n; [...steps.children].forEach((li, i) => { li.dataset.s = i < n ? 'done' : i === n ? 'now' : 'next'; }); } };   // 단계가 바뀔 때만(5초마다 다시 그리면 움직임이 끊긴다)
    const say = (t, err) => { if (t !== last) { last = t; msg.textContent = t; msg.className = err ? 'st-msg err' : 'st-msg'; } };
    const redo = () => h('button', { type: 'button', class: 'btn-line', text: '도면 다시 넣기', onclick: () => { clearFile(); setView('in'); $('stPick').focus(); } });
    const end = (t, err) => {
      say(t, err); steps.classList.add('stop'); S.fin = err ? 'fail' : 'ok'; bar();
      tail.replaceChildren(...(err ? [redo()] : []));      // 실패 뒤에는 다음 행동이 보인다
      if (err) note('failed');
      if (document.hidden) document.title = (err ? '(확인 필요) ' : '(완료) ') + (S.title || document.title);   // 숨은 탭에서도 알린다 — 파트너 이름은 그대로
    };
    paint(0);
    say('접수 확인 중');
    const tick = async () => {
      let r;
      try { r = await client().rpc('studio_status', { p_id: id }); } catch (e) { r = { error: { message: 'network' } }; }
      if (stale()) return;                               // 그 사이 다른 작업·예시로 넘어갔다 — 낡은 확인은 화면에 쓰지 않는다
      if (r.error) {
        if (/login_required/.test(r.error.message || '')) {   // 로그인이 풀린 것이지 작업이 실패한 것이 아니다 — 작업은 계속 만들어진다
          S.session = null; $('stMine').hidden = true; steps.classList.add('stop'); say('로그인이 풀렸습니다 · 작업은 계속 만들어집니다', true); bar();
          tail.replaceChildren(h('button', { type: 'button', class: 'btn-line', text: '다시 로그인', onclick: () => login(false) }));
          return;
        }
        if (/not_found/.test(r.error.message || '')) return end(errText(r.error), true);
        if (++fails > 1) say('연결 끊김 · 다시 확인 중');
      } else {
        fails = 0;
        const s = r.data;
        if ((s.status === 'running' || s.status === 'done') && !S.scene) { try { await scene(id); } catch (e) {} if (stale()) return; }
        if (s.status === 'uploading' || s.status === 'queued') {
          paint(0); note('queued');
          say(s.ahead ? `접수됨 · 앞에 ${s.ahead}건` : s.worker_alive ? '접수됨 · 곧 시작' : '작업 장비 응답이 없습니다 · 켜지면 이어서 시작합니다');
        } else if (s.status === 'running') {
          paint(1); note('running');
          say(`${S.scene ? '그림 만드는 중' : '만드는 중'} · ${Math.max(1, Math.round((Date.now() - t0) / 60000))}분째${S.sent && S.sent.id === id && S.sent.m ? ' · ' + S.sent.m : ''}`);
        } else if (s.status === 'failed') { paint(1); return end(s.error_ko || '만들지 못했습니다.', true); }
        else if (s.status === 'expired') return end('14일 지나 지웠습니다', true);
        else if (s.status === 'done') {
          const got = await results(s.outputs || [], stale);
          if (stale()) return;
          paint(3);
          if (!got.empty) note('done', { bom: got.bom, pend: got.pend });
          end(got.empty ? '결과가 비었습니다 · 다시 넣어 주세요' : '완료' + (got.bom && got.pend ? ' · 확인 필요 ' + got.pend : ''), got.empty);
          if (!got.empty) tail.replaceChildren(...(got.bom || got.pend ? [h('button', { type: 'button', class: 'btn-line', text: got.bom ? '물량' : '확인 필요 ' + got.pend,
            onclick: () => { $('stSum').focus({ preventScroll: true }); $('stSum').scrollIntoView({ behavior: motion(), block: 'start' }); } })] : []),
            h('p', { class: 'note', text: '14일 뒤 지워집니다 · 필요한 그림은 저장해 두세요' }));
          return;
        }
      }
      S.timer = setTimeout(tick, Date.now() - t0 < 120000 ? 5000 : 15000);   // 처음 2분은 5초, 그 뒤 15초
    };
    tick();
  }

  async function results(outputs, stale) {               // 결과를 번호 줄에 붙인다 — 모형을 보고 있으면 큰 판은 그대로(손으로 돌리는 중에 덮지 않는다)
    const c = client();
    const imgs = outputs.filter((o) => o.kind === 'image');
    const signed = imgs.length ? (await c.storage.from('studio').createSignedUrls(imgs.map((o) => o.path), 3600)).data || [] : [];
    const url = Object.fromEntries(signed.map((s) => [s.path, s.signedUrl]));
    const items = imgs.filter((o) => url[o.path]).map((o) => ({ url: url[o.path], path: o.path, cap: clean(o.caption), group: GROUPS.includes(o.group) ? o.group : 'edit', ai: o.group === 'photo' }))
      .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
    let sum = null;
    const so = outputs.find((o) => o.kind === 'summary');
    if (so) { const d = await c.storage.from('studio').download(so.path); if (!d.error) try { sum = JSON.parse(await d.data.text()); } catch (e) {} }
    if (stale()) return {};
    rail(S.items.filter((x) => x.mine).concat(items));
    if (items[0] && (!S.scene || S.pic || document.hidden)) show(items[0]);
    $('stSum').replaceChildren(...(sum ? [render(sum)] : []));
    return { bom: sum ? (sum.bom || []).length : 0, pend: sum ? (sum.pending || []).length : 0, empty: !items.length && !sum };
  }

  function openSheet(dlg, push) {                        // 창 열기 — 기록을 하나 쌓아 두어 뒤로가기 = 닫기(push === false: 쌓지 않는다)
    if (dlg.open) return;
    if (push !== false) { S.sheet = true; history.pushState({ v: S.view, sheet: 1 }, ''); }
    dlg.showModal();
  }
  let tourAt = 0;
  function tourStep(n, dir) {                                 // 사용법 창 — 한 번에 한 단계(그림·이름·한 문장, 아래 점·[이전][다음])
    const ps = [...$('stTour').querySelectorAll('.st-tour-p')];
    $('stTour').style.setProperty('--dx', String(dir || 0));   // 이동 방향 — 다음 1 · 이전 -1 · 열 때 0
    tourAt = Math.max(0, Math.min(ps.length - 1, n));
    ps.forEach((p, i) => { p.hidden = i !== tourAt; });
    $('stTour').querySelectorAll('.st-tour-dots span').forEach((d, i) => d.classList.toggle('on', i === tourAt));
    const prev = $('stTourPrev');
    if (tourAt === 0 && document.activeElement === prev) $('stTourNext').focus({ preventScroll: true });   // 숨기는 단추에 초점이 있으면 초점이 문서로 떨어진다
    prev.hidden = tourAt === 0;
    $('stTourNext').textContent = tourAt === ps.length - 1 ? '시작하기' : '다음';
  }
  function warmTour() {                                  // 사용법 그림은 닫힌 창 안의 lazy 라 열린 뒤에야 받는다 — 누르기 전(올려 둔 순간)에 받기 시작한다
    for (const im of $('stTour').querySelectorAll('img')) {
      if (im.loading !== 'eager') im.loading = 'eager';
      if (!im.complete) { im.classList.add('wait'); im.addEventListener('load', () => im.classList.remove('wait'), { once: true }); }
    }
  }
  function openTour(push) { warmTour(); tourStep(0); openSheet($('stTour'), push); }   // 늘 첫 단계부터
  const TOUR_KEY = 'maker_guide_studio_v1';              // 다른 도구의 첫 방문 안내와 같은 이름 규칙(maker_guide_<도구>_v1)
  function tourOnce(hash, back) {                        // 맨 처음 온 방문에만 — 임베드(호스트 화면 안)·주소로 온 방문(작업·도구·예시)·로그인 왕복은 건드리지 않는다
    if (document.documentElement.hasAttribute('data-embed') || hash || back) return;
    try { if (localStorage.getItem(TOUR_KEY)) return; localStorage.setItem(TOUR_KEY, '1'); } catch (e) { return; }
    $('stHelp').focus({ preventScroll: true });          // 닫으면 초점이 [사용법]으로 돌아온다(열기 전 초점이 없던 방문)
    openTour(false);                                     // 조작 없이 쌓은 기록은 크롬이 뒤로가기에서 건너뛴다 — 자동으로 여는 창은 기록을 쌓지 않는다
  }

  async function myJobs() {                              // 창으로 — 큰 판은 뒤에 그대로. 뒤로가기 = 닫기
    if (!S.session) return login(false);
    const dlg = $('stJobs'), body = $('stJobsBody');
    body.replaceChildren(h('p', { class: 'st-msg', text: '불러오는 중…' }));
    openSheet(dlg);
    const r = await client().from('studio_jobs').select('id,tool,status,created_at').order('id', { ascending: false }).limit(20);
    const st = { uploading: '올리는 중', queued: '대기', running: '만드는 중', done: '완료', failed: '실패', expired: '보관 끝' };
    body.replaceChildren(r.error ? h('p', { class: 'st-msg err', text: errText(r.error) })
      : !r.data.length ? h('p', { class: 'empty', text: '아직 작업이 없습니다.' })
        : h('div', { class: 'st-jobs' }, r.data.map((j) => h('button', { type: 'button', onclick: () => { S.sheet = false; dlg.close(); runView(j.id, false); } }, [   // 창을 연 기록 자리가 그 작업이 된다
          h('span', { text: `${NAME[j.tool] || '도면'} · ${new Date(j.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` }),
          h('span', { class: 's', text: st[j.status] || j.status })]))));
  }

  // ── 로그인 왕복에 파일 보관(IndexedDB, 30분 · 꺼내면 바로 지움) ─────────────
  function idb(mode, fn) {
    return new Promise((res) => {
      try {
        const rq = indexedDB.open('ain-studio', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('k');
        rq.onerror = () => res(null);
        rq.onsuccess = () => { try { const tx = rq.result.transaction('k', mode); const r = fn(tx.objectStore('k')); tx.oncomplete = () => res(r && 'result' in r ? r.result : true); tx.onerror = () => res(null); } catch (e) { res(null); } };
      } catch (e) { res(null); }
    });
  }
  async function login(withFile) {
    if (document.documentElement.hasAttribute('data-embed')) {   // 카카오 로그인 화면은 iframe 안에서 열리지 않는다 — 같은 파트너 화면을 새 창으로
      window.open(location.origin + '/maker/3d/' + (P.id ? '?partner=' + P.id : ''), '_blank', 'noopener');
      $('stInMsg').className = 'st-msg'; $('stInMsg').textContent = '새 창에서 로그인한 뒤, 그 창에서 도면을 다시 넣어 만들어 주세요';
      return;
    }
    if (S.leaving) return;                               // 이동 중 한 번 더 누르면 로그인 창이 둘 열린다
    S.leaving = true; $('stGo').textContent = '카카오로 이동 중…'; $('stGo').disabled = true;
    if (withFile && S.file) await idb('readwrite', (s) => s.put({ f: S.file, out: S.out, opt: S.opt, at: Date.now() }, 'p'));
    if (P.id) try { localStorage.setItem('ain-partner', JSON.stringify({ id: P.id, at: Date.now() })); } catch (e) {}   // 돌아와도 같은 파트너 화면(partner-boot.js 가 읽는다)
    // 돌아오는 주소에는 아무 표시도 붙이지 않는다 — 허용 목록과 글자까지 맞아야 하고, 주소 조각에는 로그인 토큰이 실려 온다
    const r = await client().auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: location.origin + '/maker/3d/' } });
    if (r && r.error) { S.leaving = false; bar(); $('stInMsg').className = 'st-msg err'; $('stInMsg').textContent = '로그인 창을 열지 못했습니다 · 네트워크를 확인하고 다시 눌러 주세요'; }   // 성공하면 페이지가 카카오로 넘어간다
  }
  async function resume() {
    const p = await idb('readonly', (s) => s.get('p'));
    await idb('readwrite', (s) => s.delete('p'));
    if (!p || Date.now() - p.at > 30 * 60000) { $('stInMsg').className = 'st-msg err'; $('stInMsg').textContent = '파일을 다시 넣어 주세요'; return; }
    S.file = { ...p.f, thumb: p.f.isImg ? URL.createObjectURL(p.f.blob) : null };
    S.out = p.out; S.opt = p.opt;
    fileRow(); pick(); setView('pick', false);
    history.replaceState({ v: 'pick' }, '', location.pathname + keepQ());   // 결과에서 뒤로 = 받을 것(파일 그대로)
    submit();
  }

  // ── 사진 손질(기존 도구 화면) ─────────────────────────
  function panel(title, sub, kids) {
    const p = $('stPanel');
    gone(p, false);
    p.replaceChildren(h('button', { type: 'button', class: 'btn-line back', text: '← 돌아가기', onclick: closePanel }),
      h('h3', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null, ...kids);
    p.scrollIntoView({ behavior: motion(), block: 'start' });
    const hd = p.querySelector('h3'); hd.tabIndex = -1; hd.focus({ preventScroll: true });   // 키보드·스크린리더는 나머지 도구 단추를 지나지 않고 패널 내용에 닿는다
    return p;
  }
  function closePanel() {                                // 도구 주소만 걷는다(기록 상태·작업 주소는 그대로 — 뒤로가기가 넣기 + 파일 비움이 되지 않게), 초점은 누른 단추로
    gone($('stPanel'), true);
    if (TOOLS.some((t) => '#' + t.id === location.hash)) history.replaceState(history.state, '', location.pathname + keepQ());
    $('stTools').scrollIntoView({ behavior: motion(), block: 'center' });
    const b = $('stTools').children[TOOLS.findIndex((t) => t.id === S.tool)];
    if (b) b.focus({ preventScroll: true });
  }
  function openTool(id) {
    const t = TOOLS.find((x) => x.id === id);
    if (!t || noTools()) return;
    S.tool = id;
    if (!/^#job-/.test(location.hash)) history.replaceState(history.state, '', '#' + id);
    return t.kind === 'erase' || t.kind === 'cutout' ? photoJobTool(t) : localTool(t);
  }
  const gallery = (pairs) => h('div', { class: 'st-gal' }, pairs.map(([f, cap]) => fig({ url: f.startsWith('/') ? f : D + f, cap })));

  function photoJobTool(t) {
    const file = h('input', { type: 'file', accept: 'image/*' });
    const msg = h('p', { class: 'st-msg', role: 'status' });
    const out = h('div');
    const stage = h('div');
    const ed = { img: null, mask: null, size: 36 };
    file.addEventListener('change', async () => {
      const im = await loadImage(file.files[0]);
      if (!im) { msg.className = 'st-msg err'; msg.textContent = '열지 못했습니다'; return; }
      ed.img = fitCanvas(im, 1600);
      if (t.kind === 'erase') {
        ed.mask = document.createElement('canvas');
        ed.mask.width = ed.img.width; ed.mask.height = ed.img.height;
        brush(ed);
        const cv = h('div', { class: 'st-canvas' }, [ed.img, ed.mask]);
        cv.style.setProperty('--ar', (ed.img.width / ed.img.height).toFixed(3));   // 폰에서 세로 사진이 화면을 다 덮지 않게(studio.css)
        stage.replaceChildren(cv,
          h('div', { class: 'st-sliders' }, [h('label', {}, ['붓 크기', h('input', { type: 'range', min: 8, max: 120, value: ed.size, oninput: (e) => { ed.size = +e.target.value; } })])]),
          h('div', { class: 'st-row' }, [h('button', { type: 'button', text: '칠한 곳 비우기', onclick: () => ed.mask.getContext('2d').clearRect(0, 0, ed.mask.width, ed.mask.height) })]),
          h('p', { class: 'st-msg', text: '지울 물건 위를 칠하세요 · 큰 가구는 자국이 남을 수 있음' }));
      } else {
        stage.replaceChildren(h('div', { class: 'st-canvas' }, [ed.img]));
      }
    });
    const go = h('button', { type: 'button', text: S.session ? '만들기' : '카카오 로그인 후 만들기' });
    go.addEventListener('click', async () => {
      if (!S.session) return login(false);
      if (!ed.img) { msg.className = 'st-msg err'; msg.textContent = '사진을 고르세요'; return; }
      const files = [{ name: 'in.jpg', blob: await toBlob(ed.img, 'image/jpeg', .92), type: 'image/jpeg' }];
      if (t.kind === 'erase') {
        const m = maskPng(ed.mask);
        if (!m.painted) { msg.className = 'st-msg err'; msg.textContent = '지울 곳을 먼저 칠하세요'; return; }
        files.push({ name: 'mask.png', blob: await toBlob(m.canvas, 'image/png'), type: 'image/png' });
      }
      go.disabled = true; msg.className = 'st-msg'; msg.textContent = '올리는 중… 닫지 마세요';
      S.sending = (S.sending || 0) + 1;                  // 올리는 중에 페이지를 떠나면 작업이 올리는 중에 멈춘다(만들기 바와 따로 센다 — 바가 같이 잠기지 않게)
      try { const id = await submitJob(t.id, {}, files); go.disabled = false; msg.textContent = ''; runView(id); }
      catch (e) { msg.className = 'st-msg err'; msg.textContent = errText(e); go.disabled = false; }
      finally { S.sending--; }
    });
    const ex = t.kind === 'erase' ? [['view_reverse.webp', '원본'], ['erase_after.webp', '지운 뒤 — 탁자 위 화병·책']] : [['cutout_before.webp', '원본'], ['cutout_after.webp', '배경 뗀 뒤(투명 PNG)']];
    panel(t.name, t.m, [...(S.session ? [] : [h('div', { class: 'st-go' }, [h('p', { class: 'st-msg', text: '만들려면 카카오 로그인이 필요합니다 · 로그인하면 처음 화면으로 돌아가니 먼저 로그인해 주세요.' }), h('button', { type: 'button', class: 'btn-line', text: '카카오 로그인', onclick: () => login(false) })])]),   // 칠한 마스크가 사라진 뒤에야 알리지 않는다
      h('div', { class: 'st-form' }, [h('label', {}, ['사진', file])]), stage, h('div', { class: 'st-go' }, [go, msg]), out,
      h('div', { class: 'st-out' }, [h('p', { class: 'st-msg' }, [h('span', { class: 'st-tag', text: '예시' }), '합성 렌더']), gallery(ex)])]);
  }

  function localTool(t) {
    const file = h('input', { type: 'file', accept: 'image/*' });
    const stage = h('div');
    const st = { src: null, out: document.createElement('canvas'), b: 100, c: 100, s: 100, w: 0, ratio: 0, zoom: 1, px: 50, py: 50, text: '', size: 6, color: '#ffffff', pos: 'bottom' };
    const draw = () => {
      const s = st.src;
      if (!s) return;
      const o = st.out, x = o.getContext('2d');
      if (t.kind === 'color') {
        o.width = s.width; o.height = s.height;
        x.filter = `brightness(${st.b}%) contrast(${st.c}%) saturate(${st.s}%)`;
        x.drawImage(s, 0, 0); x.filter = 'none';
        if (st.w) { x.globalCompositeOperation = 'soft-light'; x.fillStyle = st.w > 0 ? `rgba(255,150,60,${st.w / 100})` : `rgba(60,130,255,${-st.w / 100})`; x.fillRect(0, 0, o.width, o.height); x.globalCompositeOperation = 'source-over'; }
      } else if (t.kind === 'crop') {
        const r = st.ratio || s.width / s.height;
        let cw = s.width / st.zoom, ch = cw / r;
        if (ch > s.height / st.zoom) { ch = s.height / st.zoom; cw = ch * r; }
        const sx = (s.width - cw) * st.px / 100, sy = (s.height - ch) * st.py / 100;
        o.width = Math.round(cw); o.height = Math.round(ch);
        x.drawImage(s, sx, sy, cw, ch, 0, 0, o.width, o.height);
      } else {
        o.width = s.width; o.height = s.height; x.drawImage(s, 0, 0);
        if (st.text) {
          const fs = Math.round(o.width * st.size / 100);
          x.font = `760 ${fs}px "Pretendard Variable", Pretendard, sans-serif`; x.textAlign = 'center';
          x.textBaseline = st.pos === 'top' ? 'top' : st.pos === 'middle' ? 'middle' : 'bottom';
          const y = st.pos === 'top' ? fs * .6 : st.pos === 'middle' ? o.height / 2 : o.height - fs * .6;
          x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = fs * .25;
          x.fillStyle = st.color; x.fillText(st.text, o.width / 2, y); x.shadowBlur = 0;
        }
      }
    };
    const slider = (label, key, min, max, val) => h('label', {}, [label, h('input', { type: 'range', min, max, value: val, oninput: (e) => { st[key] = +e.target.value; draw(); } })]);
    const pickRow = (opts, key) => seg(opts, st[key], (v) => { st[key] = v; draw(); });
    const ctrl = t.kind === 'color' ? [h('div', { class: 'st-sliders' }, [slider('밝기', 'b', 50, 150, 100), slider('대비', 'c', 50, 150, 100), slider('채도', 's', 0, 200, 100), slider('따뜻함', 'w', -40, 40, 0)])]
      : t.kind === 'crop' ? [pickRow([[0, '원본 비율'], [16 / 9, '16:9'], [4 / 3, '4:3'], [1, '1:1'], [4 / 5, '4:5']], 'ratio'),
        h('div', { class: 'st-sliders' }, [h('label', {}, ['확대', h('input', { type: 'range', min: 100, max: 300, value: 100, oninput: (e) => { st.zoom = e.target.value / 100; draw(); } })]), slider('가로 위치', 'px', 0, 100, 50), slider('세로 위치', 'py', 0, 100, 50)])]
      : [h('div', { class: 'st-form' }, [h('label', {}, ['문구', h('input', { type: 'text', name: 'caption', autocomplete: 'off', maxlength: 40, placeholder: '예) 거실 시스템에어컨 제안', oninput: (e) => { st.text = e.target.value; draw(); } })])]),
        h('div', { class: 'st-sliders' }, [slider('글자 크기', 'size', 3, 12, 6)]), pickRow([['#ffffff', '흰 글자'], ['#1e1d1a', '검은 글자']], 'color'), pickRow([['top', '위'], ['middle', '가운데'], ['bottom', '아래']], 'pos')];
    file.addEventListener('change', async () => {
      const im = await loadImage(file.files[0]);
      if (!im) { stage.replaceChildren(h('p', { class: 'st-msg err', role: 'alert', text: '열지 못했습니다' })); return; }
      st.src = fitCanvas(im, 2400);
      draw();
      stage.replaceChildren(h('div', { class: 'st-canvas' }, [st.out]), ...ctrl,
        h('div', { class: 'st-go' }, [h('button', { type: 'button', text: '저장', onclick: async () => save(await toBlob(st.out, 'image/jpeg', .92), 'ain-studio.jpg') })]));
    });
    panel(t.name, '기기 안에서만 처리', [h('div', { class: 'st-form' }, [h('label', {}, ['사진', file])]), stage]);
  }

  // ── 사진·캔버스 도우미 ──────────────────────────────
  function loadImage(f) {
    return new Promise((res) => {
      if (!f || !/^image\//.test(f.type || 'image/')) return res(null);
      const u = URL.createObjectURL(f), im = new Image();
      im.onload = () => { res(im); URL.revokeObjectURL(u); }; im.onerror = () => { res(null); URL.revokeObjectURL(u); }; im.src = u;
    });
  }
  function fitCanvas(im, max) {
    const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c;
  }
  function brush(ed) {
    const x = ed.mask.getContext('2d');
    let down = false;
    const at = (e) => { const r = ed.mask.getBoundingClientRect(); return [(e.clientX - r.left) * ed.mask.width / r.width, (e.clientY - r.top) * ed.mask.height / r.height]; };
    const dot = (e) => { const [px, py] = at(e); x.fillStyle = 'rgba(193,52,56,.55)'; x.beginPath(); x.arc(px, py, ed.size * ed.mask.width / ed.mask.getBoundingClientRect().width / 2, 0, Math.PI * 2); x.fill(); };
    ed.mask.addEventListener('pointerdown', (e) => { down = true; ed.mask.setPointerCapture(e.pointerId); dot(e); });
    ed.mask.addEventListener('pointermove', (e) => { if (down) dot(e); });
    for (const ev of ['pointerup', 'pointercancel']) ed.mask.addEventListener(ev, () => { down = false; });
  }
  function maskPng(paint) {                              // 칠한 곳 = 흰(지울 곳), 나머지 = 검정
    const c = document.createElement('canvas');
    c.width = paint.width; c.height = paint.height;
    const a = paint.getContext('2d').getImageData(0, 0, c.width, c.height).data, x = c.getContext('2d'), out = x.createImageData(c.width, c.height);
    let painted = false;
    for (let i = 3; i < a.length; i += 4) { const v = a[i] > 10 ? 255 : 0; painted = painted || v > 0; out.data[i - 3] = out.data[i - 2] = out.data[i - 1] = v; out.data[i] = 255; }
    x.putImageData(out, 0, 0);
    return { canvas: c, painted };
  }
  const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));
  function save(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

  async function submitJob(tool, params, files) {
    const c = client();
    const r = await c.rpc('studio_submit', { p_tool: tool, p_params: params, p_files: files.map((f) => f.name) });
    if (r.error) throw r.error;
    const { id, paths } = r.data;
    for (let i = 0; i < files.length; i++) {
      const up = await c.storage.from('studio').upload(paths[i], files[i].blob, { contentType: files[i].type || 'application/octet-stream', upsert: false });
      if (up.error) throw up.error;
    }
    const ok = await c.rpc('studio_ready', { p_id: id });
    if (ok.error) throw ok.error;
    return id;                                           // 주소(#job-N)는 runView 가 — 여기서 바꾸면 받을 것 기록이 지워져 뒤로가기가 넣기로 간다
  }

  // ── 시작 ───────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    const back = /access_token=|[?&]code=/.test(location.hash + location.search);   // 로그인 왕복에서 돌아옴 — 로그인 라이브러리가 주소를 걷기 전에 읽는다
    let savedJob = 0;                                    // 로그인하러 가기 전에 보던 작업 번호(번호만, 15분) — 돌아오는 주소에는 아무것도 못 싣는다
    try { const j = JSON.parse(localStorage.getItem('ain-job') || 'null'); if (j && Date.now() - j.at < 15 * 60000) savedJob = +j.id || 0; if (back) localStorage.removeItem('ain-job'); } catch (e) {}
    for (const id of ['stInMsg', 'stLiveMsg']) rise($(id));   // 안내·오류·모형 글이 바뀔 때 떠오르게
    try { window.ainAuth.init('authSlot'); } catch (e) {}
    await partner();                                     // 공동 브랜드 — 못 받으면 에인연 화면 그대로
    try { Object.assign(S.opt, JSON.parse(localStorage.getItem('ain-studio-opt') || '{}')); } catch (e) {}
    const pickFrom = (inp) => { inp.value = ''; inp.click(); };
    $('stPick').addEventListener('click', () => pickFrom($('stFile')));
    $('stAlbum').addEventListener('click', () => pickFrom($('stAlbumIn')));
    $('stShoot').addEventListener('click', () => pickFrom($('stCamIn')));
    for (const id of ['stFile', 'stAlbumIn', 'stCamIn']) $(id).addEventListener('change', (e) => take(e.target.files[0], e.target.files.length));
    $('stGo').addEventListener('click', submit);
    $('stRe').addEventListener('click', submit);
    $('stMine').addEventListener('click', myJobs);
    const sheets = [[$('stJobs'), $('stJobsX')], [$('stTour'), $('stTourX')]];
    for (const [dlg, x] of sheets) {
      x.addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // 창 밖을 누르면 닫는다
      dlg.addEventListener('close', () => { if (S.sheet) { S.sheet = false; if (history.state && history.state.sheet) { S.skip = true; history.back(); } } });   // 닫기·Esc — 창을 열 때 쌓은 기록을 걷는다(그 사이 화면이 넘어갔으면 건드리지 않는다)
    }
    $('stHelp').addEventListener('click', () => openTour());
    for (const ev of ['pointerenter', 'pointerdown', 'focus']) $('stHelp').addEventListener(ev, warmTour, { once: true });   // 누르기 전에 그림부터
    $('stTourPrev').addEventListener('click', () => tourStep(tourAt - 1, -1));
    $('stTourNext').addEventListener('click', () => { if (tourAt < $('stTour').querySelectorAll('.st-tour-p').length - 1) tourStep(tourAt + 1, 1); else $('stTour').close(); });
    $('stTools').replaceChildren(...TOOLS.map((t) => h('button', { type: 'button', text: t.name, onclick: () => openTool(t.id) })));
    const drop = $('stDrop');
    document.addEventListener('dragover', (e) => { e.preventDefault(); if ($('stPanel').hidden) drop.classList.add('over'); });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('over'); });
    document.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if ($('stPanel').hidden && e.dataTransfer.files[0]) take(e.dataTransfer.files[0], e.dataTransfer.files.length); });
    document.addEventListener('paste', (e) => {
      const f = e.clipboardData && e.clipboardData.files[0], fs = e.clipboardData ? e.clipboardData.files.length : 0;
      if (f && $('stPanel').hidden && !(e.target && e.target.matches && e.target.matches('textarea, input:not([type=radio]):not([type=file]):not([type=range])'))) { e.preventDefault(); take(f, fs); }   // 글자를 받는 칸만 거른다(번호 줄·받을 것을 누른 뒤에도 붙여넣기가 된다)
    });
    window.addEventListener('popstate', (e) => {                // 폰 뒤로가기 = 앞 단계. 넣기로 돌아가면 파일을 비운다(넣기 칸이 다시 보이게)
      if (S.skip) { S.skip = false; return; }                   // 창을 닫으며 걷은 기록
      if (S.sheet) { S.sheet = false; for (const [d] of sheets) d.close(); return; }    // 창이 떠 있으면 닫기만
      let v = (e.state && e.state.v) || 'in';
      const j = location.hash.match(/^#job-(\d+)$/);
      if (v === 'out' && j && S.session) return runView(+j[1], false);   // 작업 기록으로 돌아오면 그 작업을 다시 연다(다시 만든 뒤 뒤로 = 앞 작업)
      if (v === 'out') v = 'pick';
      if (v === 'pick' && !S.file) v = 'in';
      if (v === 'in' && S.file) clearFile();
      setView(v, false);
    });
    window.addEventListener('pageshow', (e) => { if (e.persisted) { S.leaving = false; bar(); } });   // 카카오에서 뒤로 돌아오면(되돌아온 페이지) 로그인 단추를 다시 쓸 수 있게
    window.addEventListener('beforeunload', (e) => { if (S.busy || S.sending) e.preventDefault(); });   // 올리는 중(만들기·사진 손질)에 닫으면 작업이 올리는 중에 멈춘다   // 올리는 중에 닫으면 작업이 '올리는 중'에 멈춘다
    const hash = location.hash;
    const job = hash.match(/^#job-(\d+)$/);
    if (hash === '#interior') S.out = 'photo';
    if (hash === '#design') S.out = 'design';
    const first = () => {
      pick();
      setView('in', false);
      if (S.out !== 'cg' || hash === '#sample') show(heroOf());   // 주소로 고른 종류의 예시를 큰 판에
    };
    if (!job) first();                                   // 첫 화면은 로그인 확인을 기다리지 않는다(작업 주소로 온 때만 기다려 예시 뷰어를 받지 않는다)
    try { S.session = await window.ainAuth.getSession(); } catch (e) { S.session = null; }
    $('stMine').hidden = !S.session;
    window.addEventListener('ain:auth', (e) => { S.session = e.detail && e.detail.session; $('stMine').hidden = !S.session; bar(); });
    if (job) first(); else bar();
    if (S.view === 'in') history.replaceState({ v: 'in' }, '', location.pathname + keepQ() + (job ? hash : ''));   // 주소는 로그인 확인 뒤에 걷는다 — 돌아온 주소의 조각에 로그인 토큰이 실려 있다(그 사이 도면을 넣었으면 그 기록은 그대로)
    const title = S.title = document.title;              // 파트너 이름까지 들어간 제목 — '(완료)' 같은 표시는 돌아와 보면 걷는다
    document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = title; });   // '(완료)' 표시는 돌아와 보면 걷는다
    if (!(back && S.session)) idb('readwrite', (s) => s.delete('p'));   // 이어 올리지 않는 방문 — 맡겨 둔 도면을 기기에 남기지 않는다
    if (job && !S.session) try { localStorage.setItem('ain-job', JSON.stringify({ id: +job[1], at: Date.now() })); } catch (e) {}   // 로그인해서 돌아오면 그 작업으로
    if (job && S.session) runView(+job[1]);
    else if (job) { $('stInMsg').className = 'st-msg'; $('stInMsg').textContent = '이 작업은 로그인한 뒤에 열립니다 · 위의 카카오 로그인을 눌러 주세요'; }
    else if (back && S.session && savedJob) runView(savedJob);
    else if (back && S.session && (await idb('readonly', (s) => s.get('p')))) resume();   // 파일을 맡겨 두고 로그인하러 갔다 온 방문만
    else if (hash === '#sample') see();
    else if (TOOLS.some((t) => '#' + t.id === hash)) openTool(hash.slice(1));
    else tourOnce(hash, back);
    tell('ready');
  });
}());
