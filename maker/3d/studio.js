// 3D 스튜디오 — 넣기 → 받을 것 → 받기 (처음 온 사람 기준, 2026-10-02 대표 '사용자 친화적으로' — 시안 3개를 사용자 4명 관점으로 비교해 단계형으로).
// 실제 작업은 로그인 후 supabase/20_studio.sql 의 studio_* 함수와 비공개 'studio' 저장소로, 계산은 운영자 장비가 차례로.
// 보안: 파일 이름·작업 결과 문구는 전부 textContent로만(innerHTML 금지). 색·자르기·글자는 기기 안에서만(서버로 안 보냄).
(function () {
  'use strict';
  const D = '/maker/3d/demo/';
  const MB = 1024 * 1024;
  const OUT = {                                          // 받을 것 — 셋 다 같은 엔진, 조감·평면·단면·전개·물량은 늘 함께
    cg: { tool: 'plan3d', name: '도면대로', m: '보통 5분', img: D + 'view_hero.webp', eta: '보통 5분' },
    photo: { tool: 'interior', name: '사진처럼', m: 'AI · 보통 15~25분 · 질감은 AI', img: '/maker/3d/photo.webp', eta: '보통 15~25분' },
    design: { tool: 'design', name: '디자인 제안', m: 'AI · 보통 15~25분 · 마감·가구는 AI', img: '/maker/3d/design.webp', eta: '보통 15~25분' },
  };
  const ALSO = [['aerial.webp', '조감'], ['plan.webp', '평면'], ['section.webp', '단면'], ['elev_south.webp', '전개'], ['iso.webp', '등각']];
  const TOOLS = [                                        // 사진 손질 — 지우개·배경 떼기는 운영자 장비, 나머지는 기기 안
    { id: 'erase', name: '지우개', kind: 'erase', m: '작은 물건 지우기' },
    { id: 'cutout', name: '배경 떼기', kind: 'cutout', m: '가구 하나만 남기기' },
    { id: 'color', name: '색', kind: 'color' },
    { id: 'crop', name: '자르기', kind: 'crop' },
    { id: 'text', name: '글자', kind: 'text' },
  ];
  const NAME = { plan3d: '도면대로', interior: '사진처럼', design: '디자인 제안', erase: '지우개', cutout: '배경 떼기' };
  const DEMO = {
    photo: [['/maker/3d/photo.webp', '사진처럼(AI)'], ['/maker/3d/design.webp', '디자인 제안(AI) — 마감·가구는 AI']],
    views: [['view_hero.webp', '거실 와이드'], ['view_wide.webp', '전체 와이드'], ['view_reverse.webp', '역방향'], ['view_medium.webp', '실내기 가까이']],
    aerial: [['aerial.webp', '조감 — 천장 속 냉매 배관(청록)']],
    drawings: [['plan.webp', '컬러 평면도'], ['section.webp', '단면 — 천장고·반자 속(가정)'], ['elev_south.webp', '전개도'], ['iso.webp', '등각도'], ['elev_east.webp', '전개도']],
  };
  const GROUP = { photo: 'AI 사진', views: '실내', aerial: '조감', drawings: '도면', edit: '결과' };
  const ERR = {
    login_required: '로그인이 필요합니다.', tool_not_allowed: '지금은 쓸 수 없는 도구입니다.', limit_month: '이번 달 작업 한도를 다 썼습니다.',
    limit_active: '진행 중인 작업이 끝나면 다시 올려 주세요.', bad_file: '올릴 수 없는 파일입니다.', not_found: '작업을 찾지 못했습니다.',
    PGRST202: '지금은 예시만 됩니다.',
  };
  const OK_EXT = ['dwg', 'dxf', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif'];
  const S = { session: null, file: null, out: 'cg', opt: { brand: 'lg', style: 'white', mood: 'day', area: '' }, timer: null, busy: false, view: 'in' };
  const $ = (id) => document.getElementById(id);
  const motion = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const wide = () => matchMedia('(min-width: 901px)').matches;

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
  const errText = (e) => ERR[(e && (e.code === 'PGRST202' ? 'PGRST202' : e.message)) || ''] || ('처리하지 못했습니다' + (e && e.message ? ' — ' + e.message : ''));
  const client = () => window.ainAuth && window.ainAuth.getClient();
  const fmtMB = (n) => (n / MB < 1 ? Math.max(1, Math.round(n / 1024)) + 'KB' : (n / MB).toFixed(1) + 'MB');
  const clean = (cap) => (cap || '').replace(/\s*·\s*형태 일치 \d+%/, '');   // 수치는 AI 사진이 도면만큼 정확하다는 뜻으로 읽혀 화면에선 뺀다

  // ── 화면 상태: in(넣기) · pick(받을 것) · out(받기) — 뒤로가기로 앞 단계 ──────────
  function setView(v, push = true) {
    S.view = v;
    $('stPickSec').hidden = !(v === 'pick' || (v === 'out' && S.file));
    $('stOut').hidden = !(v === 'out' || wide());
    $('stBar').hidden = v !== 'pick';
    $('stLive').hidden = v === 'out';                    // 내 작업을 보는 동안 예시 모형은 접는다(다시 보이면 보던 자리 그대로)
    if (v !== 'out') requestAnimationFrame(() => { if (!$('stLive').hidden) live(); });   // 한 박자 뒤, 그때도 보일 때만(작업 주소로 바로 들어오면 곧 접히므로 뷰어를 받지 않는다)
    if (v !== 'out') demo();
    bar();
    if (push) history.pushState({ v }, '', location.pathname + location.search + (location.hash.startsWith('#job-') && v === 'out' ? location.hash : ''));
    const head = { in: 'stInH', pick: 'stPickH', out: 'stOutH' }[v];
    if (head && v !== 'in') { $(head).focus({ preventScroll: true }); $(head).scrollIntoView({ behavior: motion(), block: 'start' }); }
  }

  // ── 예시 모형: 로그인·올리기 없이 바로 돌려 보는 합성 평면(2026-10-06 대표 '이렇게 매끄럽게') ──────────
  // 뷰어는 같은 출처 /maker/3d/view/ (엔진 commercial3d 뷰어 내보내기), 장면은 자료(apartment.json). 뷰어가 못 뜨면 조감 그림이 그대로 남는다.
  function live() {
    if (S.live) return;                                  // 처음 한 번만
    S.live = true;
    const box = $('stLiveBox'), msg = $('stLiveMsg'), nav = $('stLiveNav');
    const frame = h('iframe', { src: '/maker/3d/view/?embed&scene=apartment&v=2', title: '예시 평면 모형', loading: 'lazy' });
    const send = (m) => frame.contentWindow.postMessage(Object.assign({ ns: 'bd3d' }, m), location.origin);
    const mark = (id) => { for (const b of nav.children) { const on = b.dataset.id === (id || '') || (!!id && b.dataset.zone === id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } };   // 바닥을 눌러 들어가면 id 가 구역이다
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (e.origin !== location.origin || e.source !== frame.contentWindow || !m || m.ns !== 'bd3d') return;
      if (m.type === 'ready') {
        box.classList.add('on');
        msg.textContent = '실내기를 눌러 보세요';
        nav.replaceChildren(h('button', { type: 'button', 'data-id': '', text: '전체', onclick: () => send({ type: 'home' }) }),
          ...(m.entries || []).slice(0, 12).map((en) => h('button', { type: 'button', 'data-id': String(en.id), 'data-zone': String(en.zone || ''), text: String(en.name), onclick: () => send({ type: 'goUnit', id: en.id }) })));
        mark(null);
      } else if (m.type === 'enter') { msg.textContent = `${m.title} · ${m.sub}`; mark(m.id); }
      else if (m.type === 'home') { msg.textContent = '실내기를 눌러 보세요'; mark(null); }
      else if (m.type === 'drop' && m.file instanceof File) { $('stDrop').classList.remove('over'); if ($('stPanel').hidden) take(m.file); }   // 모형 위에 떨어뜨리거나 붙여넣은 파일도 넣기로
    });
    box.append(frame);                                   // 듣기를 먼저 걸고 만든다 — ready 를 놓치지 않는다
  }

  // ── 넣기 ──────────────────────────────────────────
  async function take(f) {
    const msg = $('stInMsg');
    msg.className = 'st-msg err';
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!OK_EXT.includes(ext)) { msg.textContent = 'DWG·DXF·PDF·사진만 됩니다'; return; }
    if (f.size > 20 * MB) { msg.textContent = '20MB까지 됩니다'; return; }
    let blob = f, up = ext, isImg = /^(png|jpe?g|webp|heic|heif)$/.test(ext), thumb = null;
    if (isImg) {
      const im = await loadImage(f);
      if (!im) { msg.textContent = '열지 못했습니다 · 사진첩에서 다시'; return; }
      if (ext !== 'png') {                                // PNG 는 원본(가는 선이 흐려지지 않게), 나머지는 JPEG 로 — HEIC 변환·위치 정보 제거도 이 한 번으로
        blob = await toBlob(fitCanvas(im, 4096), 'image/jpeg', .95);
        up = 'jpg';
      }
      thumb = URL.createObjectURL(blob);
    }
    if (S.file && S.file.thumb) URL.revokeObjectURL(S.file.thumb);
    S.file = { blob, name: f.name, up, size: blob.size, isImg, thumb, type: up === 'jpg' ? 'image/jpeg' : f.type || 'application/octet-stream' };
    msg.textContent = '';
    fileRow();
    pick();
    setView('pick');
  }
  function fileRow() {
    const r = $('stFileRow');
    $('stSample').hidden = !!S.file;                    // 파일을 넣은 뒤엔 예시 링크 대신 받을 것
    if (!S.file) { r.hidden = true; $('stDrop').hidden = false; return; }
    $('stDrop').hidden = true;
    r.hidden = false;
    r.replaceChildren(S.file.thumb ? h('img', { src: S.file.thumb, alt: '', width: 56, height: 56 }) : h('span', { class: 'ext', text: S.file.up.toUpperCase() }),
      h('span', { class: 'nm' }, [S.file.name, h('small', { text: fmtMB(S.file.size) })]),
      h('button', { type: 'button', class: 'btn-line', text: '바꾸기', onclick: () => { S.file = null; fileRow(); setView('in'); $('stPick').focus(); } }));
  }

  // ── 받을 것 ────────────────────────────────────────
  function pick() {
    $('stPickSet').replaceChildren(h('legend', { class: 'st-vh', text: '받을 것' }), ...Object.entries(OUT).map(([k, o]) =>
      h('label', { class: 'st-opt' }, [
        h('input', { type: 'radio', name: 'out', value: k, checked: S.out === k, onchange: () => { S.out = k; bar(); demo(); } }),
        h('span', { class: 'st-opt-b' }, [h('img', { src: o.img, alt: '', width: 96, height: 60, loading: 'lazy' }),
          h('span', {}, [h('span', { class: 't', text: o.name }), h('span', { class: 'm', text: o.m })])]),
      ])));
    $('stAlso').replaceChildren(h('span', { text: '함께 받음' }), ...ALSO.map(([f, n]) => h('figure', {}, [h('img', { src: D + f, alt: '', width: 48, height: 36, loading: 'lazy' }), h('figcaption', { text: n })])),
      h('figure', {}, [h('span', { class: 'st-tag', text: '표' }), h('figcaption', { text: '물량' })]));
    more();
  }
  function more() {
    const o = S.opt;
    const label = { lg: 'LG', samsung: '삼성', white: '화이트', wood: '우드', gray: '그레이', day: '낮', evening: '저녁' };
    $('stMoreSum').textContent = `더 고르기 · ${label[o.brand]} · ${label[o.style]} · ${label[o.mood]}`;
    const row = (key, vals) => h('div', { class: 'st-row' }, vals.map((v) => h('button', { type: 'button', text: label[v], class: o[key] === v ? 'on' : null,
      'aria-pressed': String(o[key] === v), onclick: () => { o[key] = v; keep(); more(); } })));
    const area = h('input', { type: 'number', id: 'stArea', name: 'area', autocomplete: 'off', min: 10, max: 400, step: '0.01', inputmode: 'decimal', placeholder: '예) 84.97', value: o.area,
      oninput: (e) => { o.area = e.target.value; } });
    $('stMoreBody').replaceChildren(h('p', { class: 'lbl', text: '제조사' }), row('brand', ['lg', 'samsung']), h('p', { class: 'lbl', text: '마감 톤' }), row('style', ['white', 'wood', 'gray']),
      h('p', { class: 'lbl', text: '시간' }), row('mood', ['day', 'evening']),
      S.file && S.file.isImg ? h('label', { class: 'lbl', for: 'stArea' }, ['전용면적(㎡) · 비우면 자동']) : null, S.file && S.file.isImg ? area : null);
  }
  function keep() { try { localStorage.setItem('ain-studio-opt', JSON.stringify({ brand: S.opt.brand, style: S.opt.style, mood: S.opt.mood })); } catch (e) {} }
  function bar() {
    const go = $('stGo'), eta = $('stEta');
    if (S.busy) { go.disabled = true; go.textContent = '올리는 중…'; return; }
    go.disabled = false;
    go.textContent = S.session ? '만들기' : '카카오 로그인 후 만들기';
    eta.textContent = S.session ? OUT[S.out].eta : '파일은 그대로';
  }

  async function submit() {
    if (!S.file) return setView('in');
    if (!S.session) return login(true);
    const params = { brand: S.opt.brand, style: S.opt.style, mood: S.opt.mood, photo: S.out !== 'cg', photo_mode: S.out === 'design' ? 'design' : 'photo', staging: true };
    const a = Number(S.opt.area);
    if (S.file.isImg && a >= 10 && a <= 400) params.area = a;
    S.busy = true; bar();
    try {
      const id = await submitJob(OUT[S.out].tool, params, [{ name: 'in.' + S.file.up, blob: S.file.blob, type: S.file.type }]);
      S.busy = false;
      runView(id);
    } catch (e) {
      S.busy = false; bar();
      $('stInMsg').className = 'st-msg err';
      $('stInMsg').textContent = errText(e);
    }
  }

  // ── 받기: 진행 · 결과 ─────────────────────────────────
  function demo() {
    if (S.view === 'out' && !$('stOutBody').dataset.demo) return;   // 작업을 보는 중이면 예시로 덮지 않는다
    $('stOutH').textContent = '예시';
    const hero = S.out === 'cg' ? D + 'view_hero.webp' : OUT[S.out].img;
    const items = [{ url: hero, cap: S.out === 'cg' ? '거실 와이드' : DEMO.photo[S.out === 'design' ? 1 : 0][1], group: 'hero', ai: S.out !== 'cg' }]
      .concat(...Object.entries(DEMO).map(([g, xs]) => xs.map(([f, c]) => ({ url: f.startsWith('/') ? f : D + f, cap: c, group: g, ai: g === 'photo' }))));
    const body = $('stOutBody');
    body.dataset.demo = '1';
    body.replaceChildren(h('p', { class: 'st-msg' }, [h('span', { class: 'st-tag', text: '예시' }), '합성 평면']), render(items, null),
      h('p', { class: 'note', text: '가구·소품은 연출 · (가정)은 도면에 없는 값' }));
  }

  function render(items, sum) {                          // items: {url, cap, group, ai} — 맨 앞 group 'hero' 는 크게
    const box = h('div', { class: 'st-out' });
    const hero = items.find((x) => x.group === 'hero');
    if (hero) box.append(fig(hero, 'st-hero'));
    const groups = ['photo', 'views', 'aerial', 'drawings', 'edit'].filter((g) => items.some((x) => x.group === g));
    const chips = groups.map((g) => h('a', { href: '#stG-' + g, text: GROUP[g] }));
    if (sum && (sum.bom || []).length) chips.push(h('a', { href: '#stG-bom', text: '물량' }));
    if (sum && (sum.pending || []).length) chips.push(h('a', { href: '#stG-pend', text: '확인 필요' }));
    if (chips.length > 1) box.append(h('nav', { class: 'st-chips', 'aria-label': '묶음' }, chips));
    for (const g of groups) {
      box.append(h('h3', { id: 'stG-' + g, text: GROUP[g] }), h('div', { class: 'st-gal' }, items.filter((x) => x.group === g).map((x) => fig(x))));
      if (g === 'photo') box.append(h('p', { class: 'note', text: 'AI · 도면과 다를 수 있음' }));
    }
    if (sum) {
      if ((sum.bom || []).length) box.append(h('h3', { id: 'stG-bom', text: '물량' }), h('div', { class: 'st-wrap' }, h('table', { class: 'st-table' }, [
        h('tr', {}, ['구분', '품목', '규격', '수량', '단위', '근거'].map((x) => h('th', { text: x }))),
        ...sum.bom.map((r) => h('tr', {}, r.map((x) => h('td', { text: String(x ?? '') }))))])));
      if ((sum.pending || []).length) box.append(h('h3', { id: 'stG-pend', text: '확인 필요' }), h('ul', {}, sum.pending.map((x) => h('li', { class: 'st-msg', text: x }))));
      if (sum.note) box.append(h('p', { class: 'note', text: sum.note }));
    }
    return box;
  }
  function fig(x, cls) {
    return h('figure', { class: cls || null }, [h('img', { src: x.url, alt: x.cap, loading: cls ? 'eager' : 'lazy', decoding: 'async' }),
      h('figcaption', {}, [h('span', {}, [x.ai ? h('span', { class: 'st-tag', text: 'AI' }) : null, x.cap]),
        h('a', { href: x.url, target: '_blank', rel: 'noopener', text: '크게' })])]);
  }

  function runView(id) {
    clearTimeout(S.timer);
    const body = $('stOutBody');
    delete body.dataset.demo;
    $('stOutH').textContent = '받기';
    const steps = h('ol', { class: 'st-steps' });
    const msg = h('p', { class: 'st-msg', role: 'status' });
    const res = h('div');
    body.replaceChildren(steps, msg, h('p', { class: 'note', text: '닫아도 됩니다 · 내 작업에 남습니다' }), res);
    setView('out', S.view !== 'out');
    const t0 = Date.now();
    let last = '', fails = 0;
    const paint = (now) => steps.replaceChildren(...['접수', '만드는 중', '완료'].map((n, i) => h('li', { 'data-s': i < now ? 'done' : i === now ? 'now' : 'next', 'aria-current': i === now ? 'step' : null, text: n })));
    const say = (t, err) => { if (t !== last) { last = t; msg.textContent = t; msg.className = err ? 'st-msg err' : 'st-msg'; } };
    paint(0);
    const tick = async () => {
      let r;
      try { r = await client().rpc('studio_status', { p_id: id }); } catch (e) { r = { error: { message: 'network' } }; }
      if (r.error) {
        if (/not_found|login_required/.test(r.error.message || '')) { say(errText(r.error), true); return; }
        if (++fails > 1) say('연결 끊김 · 다시 확인 중');
      } else {
        fails = 0;
        const s = r.data;
        if (s.status === 'uploading' || s.status === 'queued') {
          paint(0);
          say(s.ahead ? `접수됨 · 앞에 ${s.ahead}건` : s.worker_alive ? '접수됨 · 곧 시작' : '접수됨 · 늦어질 수 있음');
        } else if (s.status === 'running') {
          paint(1);
          say(`만드는 중 · ${Math.max(1, Math.round((Date.now() - t0) / 60000))}분째`);
        } else if (s.status === 'failed') { paint(1); say(s.error_ko || '만들지 못했습니다.', true); return; }
        else if (s.status === 'expired') { say('14일 지나 지웠습니다', true); return; }
        else if (s.status === 'done') { paint(3); say('완료'); res.replaceChildren(await results(s.outputs || [])); if (document.hidden) document.title = '(완료) 3D 스튜디오'; return; }
      }
      S.timer = setTimeout(tick, Date.now() - t0 < 120000 ? 5000 : 15000);   // 처음 2분은 5초, 그 뒤 15초
    };
    tick();
  }

  async function results(outputs) {
    const c = client();
    const imgs = outputs.filter((o) => o.kind === 'image');
    const signed = imgs.length ? (await c.storage.from('studio').createSignedUrls(imgs.map((o) => o.path), 3600)).data || [] : [];
    const url = Object.fromEntries(signed.map((s) => [s.path, s.signedUrl]));
    const items = imgs.filter((o) => url[o.path]).map((o) => ({ url: url[o.path], cap: clean(o.caption), group: o.group || 'edit', ai: o.group === 'photo' }));
    const first = items.find((x) => x.group === 'photo') || items.find((x) => x.group === 'views') || items[0];
    if (first) items.unshift({ ...first, group: 'hero' });
    let sum = null;
    const so = outputs.find((o) => o.kind === 'summary');
    if (so) { const d = await c.storage.from('studio').download(so.path); if (!d.error) try { sum = JSON.parse(await d.data.text()); } catch (e) {} }
    return items.length || sum ? render(items, sum) : h('p', { class: 'st-msg', text: '결과가 비었습니다 · 다시 넣어 주세요' });
  }

  async function myJobs() {
    if (!S.session) return login(false);
    const body = $('stOutBody');
    delete body.dataset.demo;
    $('stOutH').textContent = '내 작업';
    body.replaceChildren(h('p', { class: 'st-msg', text: '불러오는 중…' }));
    setView('out');
    const r = await client().from('studio_jobs').select('id,tool,status,created_at').order('id', { ascending: false }).limit(20);
    const st = { uploading: '올리는 중', queued: '대기', running: '만드는 중', done: '완료', failed: '실패', expired: '보관 끝' };
    body.replaceChildren(r.error ? h('p', { class: 'st-msg err', text: errText(r.error) })
      : !r.data.length ? h('p', { class: 'empty', text: '아직 작업이 없습니다.' })
        : h('div', { class: 'st-jobs' }, r.data.map((j) => h('button', { type: 'button', onclick: () => { history.replaceState(null, '', '#job-' + j.id); runView(j.id); } }, [
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
    if (withFile && S.file) await idb('readwrite', (s) => s.put({ f: S.file, out: S.out, opt: S.opt, at: Date.now() }, 'p'));
    client().auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: location.origin + '/maker/3d/' + (withFile ? '#resume' : '') } });
  }
  async function resume() {
    const p = await idb('readonly', (s) => s.get('p'));
    await idb('readwrite', (s) => s.delete('p'));
    history.replaceState(null, '', location.pathname);
    if (!p || Date.now() - p.at > 30 * 60000) { $('stInMsg').className = 'st-msg err'; $('stInMsg').textContent = '파일을 다시 넣어 주세요'; return; }
    S.file = { ...p.f, thumb: p.f.isImg ? URL.createObjectURL(p.f.blob) : null };
    S.out = p.out; S.opt = p.opt;
    fileRow(); pick(); setView('pick', false);
    submit();
  }

  // ── 사진 손질(기존 도구 화면) ─────────────────────────
  function panel(title, sub, kids) {
    const p = $('stPanel');
    p.hidden = false;
    p.replaceChildren(h('button', { type: 'button', class: 'btn-line back', text: '← 돌아가기', onclick: closePanel }),
      h('h3', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null, ...kids);
    p.scrollIntoView({ behavior: motion(), block: 'start' });
    return p;
  }
  function closePanel() { $('stPanel').hidden = true; if (location.hash) history.replaceState(null, '', location.pathname); $('stTools').scrollIntoView({ behavior: motion(), block: 'center' }); }
  function openTool(id) {
    const t = TOOLS.find((x) => x.id === id);
    if (!t) return;
    history.replaceState(null, '', '#' + id);
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
        stage.replaceChildren(h('div', { class: 'st-canvas' }, [ed.img, ed.mask]),
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
      go.disabled = true; msg.className = 'st-msg'; msg.textContent = '올리는 중…';
      try { await submitJob(t.id, {}, files); go.disabled = false; msg.textContent = ''; runView(+location.hash.slice(5)); }
      catch (e) { msg.className = 'st-msg err'; msg.textContent = errText(e); go.disabled = false; }
    });
    const ex = t.kind === 'erase' ? [['view_reverse.webp', '원본'], ['erase_after.webp', '지운 뒤 — 탁자 위 화병·책']] : [['cutout_before.webp', '원본'], ['cutout_after.webp', '배경 뗀 뒤(투명 PNG)']];
    panel(t.name, t.m, [h('div', { class: 'st-form' }, [h('label', {}, ['사진', file])]), stage, h('div', { class: 'st-go' }, [go, msg]), out,
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
    const pickRow = (opts, key) => {
      const row = h('div', { class: 'st-row' });
      const paint = () => row.replaceChildren(...opts.map(([v, n]) => h('button', { type: 'button', text: n, class: st[key] === v ? 'on' : null, 'aria-pressed': String(st[key] === v), onclick: () => { st[key] = v; paint(); draw(); } })));
      paint();
      return row;
    };
    const ctrl = t.kind === 'color' ? [h('div', { class: 'st-sliders' }, [slider('밝기', 'b', 50, 150, 100), slider('대비', 'c', 50, 150, 100), slider('채도', 's', 0, 200, 100), slider('따뜻함', 'w', -40, 40, 0)])]
      : t.kind === 'crop' ? [pickRow([[0, '원본 비율'], [16 / 9, '16:9'], [4 / 3, '4:3'], [1, '1:1'], [4 / 5, '4:5']], 'ratio'),
        h('div', { class: 'st-sliders' }, [h('label', {}, ['확대', h('input', { type: 'range', min: 100, max: 300, value: 100, oninput: (e) => { st.zoom = e.target.value / 100; draw(); } })]), slider('가로 위치', 'px', 0, 100, 50), slider('세로 위치', 'py', 0, 100, 50)])]
      : [h('div', { class: 'st-form' }, [h('label', {}, ['문구', h('input', { type: 'text', name: 'caption', autocomplete: 'off', maxlength: 40, placeholder: '예) 거실 시스템에어컨 제안', oninput: (e) => { st.text = e.target.value; draw(); } })])]),
        h('div', { class: 'st-sliders' }, [slider('글자 크기', 'size', 3, 12, 6)]), pickRow([['#ffffff', '흰 글자'], ['#1e1d1a', '검은 글자']], 'color'), pickRow([['top', '위'], ['middle', '가운데'], ['bottom', '아래']], 'pos')];
    file.addEventListener('change', async () => {
      const im = await loadImage(file.files[0]);
      if (!im) return;
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
    ed.mask.addEventListener('pointerup', () => { down = false; });
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
    history.replaceState(null, '', '#job-' + id);
    return id;
  }

  // ── 시작 ───────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    try { window.ainAuth.init('authSlot'); } catch (e) {}
    try { Object.assign(S.opt, JSON.parse(localStorage.getItem('ain-studio-opt') || '{}')); } catch (e) {}
    const pickFrom = (inp) => { inp.value = ''; inp.click(); };
    $('stPick').addEventListener('click', () => pickFrom($('stFile')));
    $('stAlbum').addEventListener('click', () => pickFrom($('stAlbumIn')));
    $('stShoot').addEventListener('click', () => pickFrom($('stCamIn')));
    for (const id of ['stFile', 'stAlbumIn', 'stCamIn']) $(id).addEventListener('change', (e) => take(e.target.files[0]));
    $('stSample').addEventListener('click', () => { S.view = 'in'; demo(); $('stLive').hidden = false; live(); $('stOut').hidden = false; $('stOutH').focus({ preventScroll: true }); $('stOut').scrollIntoView({ behavior: motion(), block: 'start' }); });
    $('stGo').addEventListener('click', submit);
    $('stMine').addEventListener('click', myJobs);
    $('stTools').replaceChildren(...TOOLS.map((t) => h('button', { type: 'button', text: t.name, onclick: () => openTool(t.id) })));
    const drop = $('stDrop');
    document.addEventListener('dragover', (e) => { e.preventDefault(); if ($('stPanel').hidden) drop.classList.add('over'); });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('over'); });
    document.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if ($('stPanel').hidden && e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); });
    document.addEventListener('paste', (e) => {
      const f = e.clipboardData && e.clipboardData.files[0];
      if (f && $('stPanel').hidden && !/^(INPUT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) { e.preventDefault(); take(f); }
    });
    window.addEventListener('popstate', (e) => {                // 폰 뒤로가기 = 앞 단계. 넣기로 돌아가면 파일을 비운다(넣기 칸이 다시 보이게)
      const v = (e.state && e.state.v) || 'in';
      if (v === 'in' && S.file) { S.file = null; fileRow(); }
      setView(v === 'pick' && !S.file ? 'in' : v, false);
    });
    window.addEventListener('beforeunload', (e) => { if (S.busy) e.preventDefault(); });   // 올리는 중에 닫으면 작업이 '올리는 중'에 멈춘다
    window.addEventListener('resize', () => { if (S.view !== 'out') $('stOut').hidden = !wide(); });
    try { S.session = await window.ainAuth.getSession(); } catch (e) { S.session = null; }
    $('stMine').hidden = !S.session;
    window.addEventListener('ain:auth', (e) => { S.session = e.detail && e.detail.session; $('stMine').hidden = !S.session; bar(); });
    const hash = location.hash;
    const job = hash.match(/^#job-(\d+)$/);
    if (hash === '#interior') S.out = 'photo';
    if (hash === '#design') S.out = 'design';
    setView('in', false);
    history.replaceState({ v: 'in' }, '', location.pathname + (job ? hash : ''));
    if (job && S.session) runView(+job[1]);
    else if (hash === '#resume' && S.session) resume();
    else if (hash === '#sample') $('stSample').click();
    else if (TOOLS.some((t) => '#' + t.id === hash)) openTool(hash.slice(1));
  });
}());
