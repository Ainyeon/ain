// 3D 스튜디오 — 도구 격자 · 도구 화면 · 예시(로그인 전) · 실제 작업(로그인 후, supabase/20_studio.sql 의 studio_* 함수와 비공개 'studio' 저장소).
// 보안: 파일 이름·작업 결과 문구는 전부 textContent로만 그린다(innerHTML 금지). 색 보정·자르기·글자 넣기는 기기 안에서만(서버로 안 보냄).
// 계산(렌더·지우개·배경 떼기)은 운영자 장비가 차례로 처리한다 — 대기 순번과 작업 기계 상태를 보여 준다.
(function () {
  'use strict';
  const D = '/maker/3d/demo/';
  const CATS = ['전체', '렌더', '변환', '분석', '편집'];
  // kind: engine = 도면 한 장으로 렌더·조감·도면 컷을 한 번에(preset·focus 만 다름) · erase/cutout = 사진 손질(운영자 장비) · color/crop/text = 기기 안
  const TOOLS = [
    { id: 'plan3d', cat: '렌더', name: '평면도로 3D', m: '도면·평면도 한 장 → 방·에어컨·배관', img: D + 'view_hero.webp', kind: 'engine', focus: 'views' },
    { id: 'interior', cat: '렌더', name: '실내 렌더', m: '사진처럼 다듬기까지', img: '/maker/3d/photo.webp', kind: 'engine', preset: { photo: true }, focus: 'photo' },
    { id: 'design', cat: '렌더', name: '디자인 제안', m: '마감·가구만 AI가 꾸밈', img: '/maker/3d/design.webp', kind: 'engine', preset: { photo: true, photo_mode: 'design' }, focus: 'photo' },
    { id: 'aerial', cat: '렌더', name: '조감도', m: '천장 걷고 위에서', img: D + 'aerial.webp', kind: 'engine', focus: 'aerial' },
    { id: 'views', cat: '변환', name: '시점 여러 컷', m: '와이드·역방향·미디엄', img: D + 'view_reverse.webp', kind: 'engine', focus: 'views', pick: 'view_reverse.webp' },
    { id: 'mood', cat: '변환', name: '낮·저녁', m: '해 질 녘, 실내등 켜고', img: D + 'view_wide.webp', kind: 'engine', preset: { mood: 'evening' }, focus: 'views' },
    { id: 'tone', cat: '변환', name: '마감 톤', m: '화이트·우드·그레이', img: D + 'view_medium.webp', kind: 'engine', preset: { style: 'wood' }, focus: 'views' },
    { id: 'plan', cat: '분석', name: '컬러 평면도', m: '실 이름·면적·실내기', img: D + 'plan.webp', kind: 'engine', focus: 'drawings', pick: 'plan.webp' },
    { id: 'iso', cat: '분석', name: '등각도', m: '세대 전체를 비스듬히', img: D + 'iso.webp', kind: 'engine', focus: 'drawings', pick: 'iso.webp' },
    { id: 'section', cat: '분석', name: '단면도', m: '반자 속 실내기·배관', img: D + 'section.webp', kind: 'engine', focus: 'drawings', pick: 'section.webp' },
    { id: 'elev', cat: '분석', name: '전개도', m: '벽마다 실내기 높이', img: D + 'elev_south.webp', kind: 'engine', focus: 'drawings', pick: 'elev_south.webp' },
    { id: 'report', cat: '분석', name: '물량·검사', m: '장비·배관 물량표', img: D + 'iso.webp', kind: 'engine', focus: 'report' },
    { id: 'erase', cat: '편집', name: '지우개', m: '작은 물건 지우기', img: D + 'erase_after.webp', kind: 'erase' },
    { id: 'cutout', cat: '편집', name: '배경 떼기', m: '가구 하나만 남기기', img: D + 'cutout_after.webp', kind: 'cutout' },
    { id: 'color', cat: '편집', name: '색 보정', m: '밝기·대비·채도 — 기기 안에서', img: D + 'view_wide.webp', kind: 'color' },
    { id: 'crop', cat: '편집', name: '자르기', m: '16:9·4:3·1:1 — 기기 안에서', img: D + 'view_hero.webp', kind: 'crop' },
    { id: 'text', cat: '편집', name: '글자 넣기', m: '제목·문구 얹기 — 기기 안에서', img: D + 'view_medium.webp', kind: 'text' },
  ];
  const DEMO = {
    views: [['view_hero.webp', '설득용 와이드'], ['view_wide.webp', '전체 와이드'], ['view_reverse.webp', '역방향 와이드'], ['view_medium.webp', '미디엄 — 실내기']],
    photo: [['/maker/3d/photo.webp', '사진처럼 다듬기(AI) — 모양은 도면대로'], ['/maker/3d/design.webp', '디자인 제안(AI) — 마감·가구는 AI']],
    aerial: [['aerial.webp', '조감 — 천장 속 냉매 배관(청록)']],
    drawings: [['plan.webp', '컬러 평면도'], ['iso.webp', '등각도'], ['section.webp', '단면 — 천장고·반자 속(가정)'], ['elev_south.webp', '전개도 — 창 쪽 벽'], ['elev_east.webp', '전개도 — 옆 벽']],
  };
  const GROUP_TITLE = { photo: 'AI 사진 다듬기', views: '실내 렌더', aerial: '조감', drawings: '도면 컷', report: '물량·검사', edit: '결과' };
  const ERR = {
    login_required: '로그인이 필요합니다.', tool_not_allowed: '지금은 쓸 수 없는 도구입니다.', limit_month: '이번 달 작업 한도를 다 썼습니다.',
    limit_active: '진행 중인 작업이 끝나면 다시 올려 주세요.', bad_file: '올릴 수 없는 파일입니다.', not_found: '작업을 찾지 못했습니다.',
    PGRST202: '작업 대기열이 아직 열리지 않았습니다. 지금은 예시만 볼 수 있습니다.',
  };
  const ENGINE_ACCEPT = '.dwg,.dxf,.pdf,.png,.jpg,.jpeg,.webp';
  const S = { cat: '전체', session: null, timer: null };
  const $ = (id) => document.getElementById(id);
  const motion = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');   // 움직임 줄이기 설정을 따른다

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

  // ── 격자 ───────────────────────────────────────────
  function renderTabs() {
    const box = $('stTabs');
    box.replaceChildren(...CATS.map((c) => h('button', { type: 'button', class: c === S.cat ? 'on' : null, 'aria-pressed': String(c === S.cat), text: c,
      onclick: () => { S.cat = c; renderTabs(); renderGrid(); } })));
  }
  function renderGrid() {
    $('stGrid').replaceChildren(...TOOLS.filter((t) => S.cat === '전체' || t.cat === S.cat).map((t) =>
      h('button', { type: 'button', class: 'st-card', onclick: () => openTool(t.id) }, [
        h('img', { src: t.img, alt: '', loading: 'lazy', decoding: 'async', width: 640, height: 400 }),
        h('span', { class: 't', text: t.name }), h('span', { class: 'm', text: t.m }), h('span', { class: 'k', text: t.cat }),
      ])));
  }

  // ── 도구 화면 ──────────────────────────────────────
  function panel(title, sub, kids) {
    clearInterval(S.timer);
    const p = $('stPanel');
    p.hidden = false;
    p.replaceChildren(h('button', { type: 'button', class: 'btn-line back', text: '← 도구 목록', onclick: closePanel }),
      h('h2', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null, ...kids);
    p.scrollIntoView({ behavior: motion(), block: 'start' });
    return p;
  }
  function closePanel() { clearInterval(S.timer); $('stPanel').hidden = true; history.replaceState(null, '', location.pathname); $('stTabs').scrollIntoView({ behavior: motion(), block: 'start' }); }   // 폰에선 도구 목록이 위에 있다

  function openTool(id) {
    const t = TOOLS.find((x) => x.id === id);
    if (!t) return;
    history.replaceState(null, '', '#' + id);
    if (t.kind === 'engine') return engineTool(t);
    if (t.kind === 'erase' || t.kind === 'cutout') return photoJobTool(t);
    return localTool(t);
  }

  function gallery(items, base) {
    return h('div', { class: 'st-gal' }, items.map(([f, cap]) => h('figure', {}, [
      h('img', { src: f.startsWith('/') || f.startsWith('http') || f.startsWith('blob:') ? f : (base || D) + f, alt: cap, loading: 'lazy', decoding: 'async' }),
      h('figcaption', { text: cap })])));
  }

  function demoOut(t) {
    const order = t.focus === 'drawings' ? ['drawings', 'views', 'aerial'] : t.focus === 'aerial' ? ['aerial', 'views', 'drawings']
      : t.focus === 'photo' ? ['photo', 'views', 'drawings'] : t.focus === 'report' ? ['drawings', 'views'] : ['views', 'photo', 'aerial', 'drawings'];
    return h('div', { class: 'st-out' }, [h('span', { class: 'st-tag', text: '예시 결과 — 합성 평면' }),
      ...order.flatMap((g) => [h('h3', { text: GROUP_TITLE[g] }), gallery([...DEMO[g]].sort((a, b) => (b[0] === t.pick) - (a[0] === t.pick)))]),   // 고른 도구의 컷이 맨 앞
      h('p', { class: 'note', text: '예시 평면으로 만든 결과입니다(실제 세대 아님). 천장고·반자 속처럼 도면에 없는 값은 (가정)으로 표시합니다. 가구·소품은 연출입니다.' })]);
  }

  function engineTool(t) {
    const pre = t.preset || {};
    const f = {
      file: h('input', { type: 'file', id: 'stFile', accept: ENGINE_ACCEPT }),
      brand: h('select', { id: 'stBrand' }, [h('option', { value: 'lg', text: 'LG' }), h('option', { value: 'samsung', text: '삼성' })]),
      area: h('input', { type: 'number', id: 'stArea', name: 'area', autocomplete: 'off', min: 10, max: 400, step: '0.01', inputmode: 'decimal', placeholder: '예) 84.97' }),
      style: h('select', { id: 'stStyle' }, [['white', '화이트'], ['wood', '우드'], ['gray', '그레이']].map(([v, n]) => h('option', { value: v, text: n, selected: (pre.style || 'white') === v }))),
      mood: h('select', { id: 'stMood' }, [['day', '낮'], ['evening', '저녁']].map(([v, n]) => h('option', { value: v, text: n, selected: (pre.mood || 'day') === v }))),
      photo: h('input', { type: 'checkbox', id: 'stOptPhoto', checked: !!pre.photo }),
      design: h('input', { type: 'checkbox', id: 'stOptDesign', checked: pre.photo_mode === 'design' }),
    };
    const msg = h('p', { class: 'st-msg', role: 'status' });
    const out = h('div');
    const go = h('button', { type: 'button', text: S.session ? '올리고 만들기' : '로그인하고 올리기' });
    go.addEventListener('click', async () => {
      if (!S.session) return login();
      const file = f.file.files[0];
      if (!file) { msg.className = 'st-msg err'; msg.textContent = '도면이나 평면도 파일을 고르세요.'; return; }
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!ENGINE_ACCEPT.split(',').includes('.' + ext) || file.size > 20 * 1024 * 1024) { msg.className = 'st-msg err'; msg.textContent = 'DWG·DXF·PDF·PNG·JPG, 20MB까지 올릴 수 있습니다.'; return; }
      const params = { brand: f.brand.value, style: f.style.value, mood: f.mood.value, photo: f.photo.checked || f.design.checked,
        photo_mode: f.design.checked ? 'design' : 'photo', staging: true, focus: t.focus };
      if (f.area.value) params.area = Number(f.area.value);
      go.disabled = true; msg.className = 'st-msg'; msg.textContent = '올리는 중…';
      try {
        const id = await submitJob(t.id, params, [{ name: 'in.' + ext, blob: file, type: file.type }]);
        watchJob(id, msg, out, t.focus);
      } catch (e) { msg.className = 'st-msg err'; msg.textContent = errText(e); go.disabled = false; }
    });
    panel(t.name, t.m, [
      h('div', { class: 'st-form' }, [
        h('label', { class: 'full' }, ['도면·평면도(DWG·DXF·PDF·이미지)', f.file]),
        h('label', {}, ['제조사', f.brand]), h('label', {}, ['평면도 이미지면 전용면적(㎡)', f.area]),
        h('label', {}, ['마감 톤', f.style]), h('label', {}, ['시간', f.mood]),
        h('label', { class: 'st-check' }, [f.photo, '사진처럼 다듬기(AI, 장당 약 2분)']),
        h('label', { class: 'st-check' }, [f.design, '디자인 제안(AI가 마감·가구를 꾸밈)']),
      ]),
      h('div', { class: 'st-go' }, [go, msg]), out, demoOut(t)]);
  }

  function photoJobTool(t) {
    const file = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp' });
    const msg = h('p', { class: 'st-msg', role: 'status' });
    const out = h('div');
    const stage = h('div');
    const ed = { img: null, mask: null, size: 36 };
    file.addEventListener('change', async () => {
      const im = await loadImage(file.files[0]);
      if (!im) return;
      ed.img = fitCanvas(im, 1600);
      if (t.kind === 'erase') {
        ed.mask = document.createElement('canvas');
        ed.mask.width = ed.img.width; ed.mask.height = ed.img.height;
        brush(ed);
        stage.replaceChildren(h('div', { class: 'st-canvas' }, [ed.img, ed.mask]),
          h('div', { class: 'st-sliders' }, [h('label', {}, ['붓 크기', h('input', { type: 'range', min: 8, max: 120, value: ed.size, oninput: (e) => { ed.size = +e.target.value; } })])]),
          h('div', { class: 'st-row' }, [h('button', { type: 'button', text: '칠한 곳 비우기', onclick: () => ed.mask.getContext('2d').clearRect(0, 0, ed.mask.width, ed.mask.height) })]),
          h('p', { class: 'st-msg', text: '지울 물건 위를 칠하세요. 작은 물건에 잘 맞고, 큰 가구는 자국이 남을 수 있습니다.' }));
      } else {
        stage.replaceChildren(h('div', { class: 'st-canvas' }, [ed.img]));
      }
    });
    const go = h('button', { type: 'button', text: S.session ? '올리고 처리하기' : '로그인하고 올리기' });
    go.addEventListener('click', async () => {
      if (!S.session) return login();
      if (!ed.img) { msg.className = 'st-msg err'; msg.textContent = '사진을 고르세요.'; return; }
      const files = [{ name: 'in.jpg', blob: await toBlob(ed.img, 'image/jpeg', .92), type: 'image/jpeg' }];
      if (t.kind === 'erase') {
        const m = maskPng(ed.mask);
        if (!m.painted) { msg.className = 'st-msg err'; msg.textContent = '지울 곳을 먼저 칠하세요.'; return; }
        files.push({ name: 'mask.png', blob: await toBlob(m.canvas, 'image/png'), type: 'image/png' });
      }
      go.disabled = true; msg.className = 'st-msg'; msg.textContent = '올리는 중…';
      try { watchJob(await submitJob(t.id, {}, files), msg, out); }
      catch (e) { msg.className = 'st-msg err'; msg.textContent = errText(e); go.disabled = false; }
    });
    const ex = t.kind === 'erase' ? [['erase_before.webp', '원본'], ['erase_after.webp', '지운 뒤 — 탁자 위 화병·책']] : [['cutout_before.webp', '원본'], ['cutout_after.webp', '배경 뗀 뒤(투명 PNG)']];
    panel(t.name, t.m, [h('div', { class: 'st-form' }, [h('label', { class: 'full' }, ['사진', file])]), stage,
      h('div', { class: 'st-go' }, [go, msg]), out,
      h('div', { class: 'st-out' }, [h('span', { class: 'st-tag', text: '예시 결과 — 합성 렌더' }), gallery(ex)])]);
  }

  // ── 기기 안 도구: 색 보정 · 자르기 · 글자 넣기 ─────────────
  function localTool(t) {
    const file = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp' });
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
    const pick = (opts, key) => {
      const row = h('div', { class: 'st-row' });
      const paint = () => row.replaceChildren(...opts.map(([v, n]) => h('button', { type: 'button', text: n, class: st[key] === v ? 'on' : null, 'aria-pressed': String(st[key] === v), onclick: () => { st[key] = v; paint(); draw(); } })));
      paint();
      return row;
    };
    const ctrl = t.kind === 'color' ? [h('div', { class: 'st-sliders' }, [slider('밝기', 'b', 50, 150, 100), slider('대비', 'c', 50, 150, 100), slider('채도', 's', 0, 200, 100), slider('따뜻함', 'w', -40, 40, 0)])]
      : t.kind === 'crop' ? [pick([[0, '원본 비율'], [16 / 9, '16:9'], [4 / 3, '4:3'], [1, '1:1'], [4 / 5, '4:5']], 'ratio'),
        h('div', { class: 'st-sliders' }, [h('label', {}, ['확대', h('input', { type: 'range', min: 100, max: 300, value: 100, oninput: (e) => { st.zoom = e.target.value / 100; draw(); } })]), slider('가로 위치', 'px', 0, 100, 50), slider('세로 위치', 'py', 0, 100, 50)])]
      : [h('div', { class: 'st-form' }, [h('label', { class: 'full' }, ['문구', h('input', { type: 'text', name: 'caption', autocomplete: 'off', maxlength: 40, placeholder: '예) 거실 시스템에어컨 제안', oninput: (e) => { st.text = e.target.value; draw(); } })])]),
        h('div', { class: 'st-sliders' }, [slider('글자 크기', 'size', 3, 12, 6)]), pick([['#ffffff', '흰 글자'], ['#1e1d1a', '검은 글자']], 'color'), pick([['top', '위'], ['middle', '가운데'], ['bottom', '아래']], 'pos')];
    file.addEventListener('change', async () => {
      const im = await loadImage(file.files[0]);
      if (!im) return;
      st.src = fitCanvas(im, 2400);
      draw();
      stage.replaceChildren(h('div', { class: 'st-canvas' }, [st.out]), ...ctrl,
        h('div', { class: 'st-go' }, [h('button', { type: 'button', text: '저장', onclick: async () => save(await toBlob(st.out, 'image/jpeg', .92), 'ain-studio.jpg') })]));
    });
    panel(t.name, '사진은 이 기기 안에서만 처리하고 서버로 보내지 않습니다.', [h('div', { class: 'st-form' }, [h('label', { class: 'full' }, ['사진', file])]), stage]);
  }

  // ── 사진·캔버스 도우미 ──────────────────────────────
  function loadImage(f) {
    return new Promise((res) => {
      if (!f || !/^image\//.test(f.type)) return res(null);
      const u = URL.createObjectURL(f), im = new Image();
      im.onload = () => { res(im); URL.revokeObjectURL(u); }; im.onerror = () => res(null); im.src = u;
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

  // ── 작업 대기열(로그인 후) ───────────────────────────
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

  function watchJob(id, msg, out, focus) {
    clearInterval(S.timer);
    const tick = async () => {
      const r = await client().rpc('studio_status', { p_id: id });
      if (r.error) { msg.className = 'st-msg err'; msg.textContent = errText(r.error); clearInterval(S.timer); return; }
      const s = r.data;
      msg.className = 'st-msg';
      if (s.status === 'queued') msg.textContent = (s.worker_alive ? '대기 중' : '작업 기계가 쉬는 중 — 접수만 됐습니다') + (s.ahead ? ` · 앞에 ${s.ahead}건` : '');
      else if (s.status === 'running') msg.textContent = '만드는 중… 도면 한 장에 5~25분 걸립니다(사진 다듬기 포함 시 더).';
      else if (s.status === 'failed') { msg.className = 'st-msg err'; msg.textContent = s.error_ko || '만들지 못했습니다.'; clearInterval(S.timer); }
      else if (s.status === 'done') { msg.textContent = '완료'; clearInterval(S.timer); out.replaceChildren(await results(s.outputs || [], focus)); }
    };
    tick();
    S.timer = setInterval(tick, 5000);
  }

  async function results(outputs, focus) {
    const c = client();
    const imgs = outputs.filter((o) => o.kind === 'image');
    const signed = imgs.length ? (await c.storage.from('studio').createSignedUrls(imgs.map((o) => o.path), 600)).data || [] : [];
    const url = Object.fromEntries(signed.map((s) => [s.path, s.signedUrl]));
    const box = h('div', { class: 'st-out' });
    for (const g of [focus, 'photo', 'views', 'aerial', 'drawings', 'edit'].filter((x, i, a) => x && a.indexOf(x) === i)) {   // 고른 도구의 묶음을 맨 위로
      const it = imgs.filter((o) => o.group === g && url[o.path]);
      if (it.length) box.append(h('h3', { text: GROUP_TITLE[g] }), gallery(it.map((o) => [url[o.path], o.caption || ''])));
    }
    const sum = outputs.find((o) => o.kind === 'summary');
    if (sum) {
      const d = await c.storage.from('studio').download(sum.path);
      if (!d.error) {
        const j = JSON.parse(await d.data.text());
        if ((j.bom || []).length) box.append(h('h3', { text: '물량표' }), h('div', { class: 'st-wrap' }, h('table', { class: 'st-table' }, [
          h('tr', {}, ['구분', '품목', '규격', '수량', '단위', '근거'].map((x) => h('th', { text: x }))),
          ...j.bom.map((r) => h('tr', {}, r.map((x) => h('td', { text: String(x ?? '') }))))])));
        if ((j.pending || []).length) box.append(h('h3', { text: '확인 필요' }), h('ul', {}, j.pending.map((x) => h('li', { class: 'st-msg', text: x }))));
        if (j.note) box.append(h('p', { class: 'note', text: j.note }));
      }
    }
    return box;
  }

  async function myJobs() {
    if (!S.session) return login();
    const p = panel('내 작업', '최근 20건 · 결과는 14일 동안 보관합니다.', [h('p', { class: 'st-msg', text: '불러오는 중…' })]);
    const r = await client().from('studio_jobs').select('id,tool,status,created_at').order('id', { ascending: false }).limit(20);
    const msg = h('p', { class: 'st-msg', role: 'status' }), out = h('div');
    const name = (id) => (TOOLS.find((t) => t.id === id) || { name: id }).name;
    const st = { uploading: '올리는 중', queued: '대기', running: '만드는 중', done: '완료', failed: '실패', expired: '보관 끝' };
    p.lastElementChild.replaceWith(r.error ? h('p', { class: 'st-msg err', text: errText(r.error) })
      : !r.data.length ? h('p', { class: 'empty', text: '아직 작업이 없습니다.' })
        : h('div', { class: 'st-jobs' }, r.data.map((j) => h('button', { type: 'button', onclick: () => watchJob(j.id, msg, out, (TOOLS.find((t) => t.id === j.tool) || {}).focus) }, [
          h('span', { text: `${name(j.tool)} · ${new Date(j.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` }),
          h('span', { class: 's', text: st[j.status] || j.status })]))));
    p.append(msg, out);
  }

  function login() {
    client().auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: location.origin + '/maker/3d/' + location.hash } });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try { window.ainAuth.init('authSlot'); } catch (e) {}
    renderTabs();
    renderGrid();
    $('stNew').addEventListener('click', () => openTool('plan3d'));
    $('stEdit').addEventListener('click', () => { S.cat = '편집'; renderTabs(); renderGrid(); $('stGrid').scrollIntoView({ behavior: motion() }); });
    $('stMine').addEventListener('click', myJobs);
    try { S.session = await window.ainAuth.getSession(); } catch (e) { S.session = null; }
    window.addEventListener('ain:auth', (e) => { S.session = e.detail && e.detail.session; });
    const m = location.hash.match(/^#job-(\d+)$/);
    if (m && S.session) { const msg = h('p', { class: 'st-msg', role: 'status' }), out = h('div'); panel('작업 결과', null, [msg, out]); watchJob(+m[1], msg, out); }
    else if (location.hash.length > 1) openTool(location.hash.slice(1));
  });
}());
