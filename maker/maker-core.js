// 메이커 공통 엔진 — 캔버스 유틸·색(단색/그라데이션)·배경 명도·규격·업종 검색·요소 조절·내보내기
// v3: 그라데이션 대표색, 무채색 배경 슬라이더, 규격 드롭다운+직접 입력, 탭 선택 조절 패널, 첫 방문 안내
(function () {
  'use strict';

  const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── 디자인 토큰 (승인 무드보드 기반, v3: 칩-본문 간격 1.85배 확대)
  const TOKENS = {
    watermark: 'made with 에인연 · ainyeon.com',
    margin: 96,            // 1080 논리폭 기준 좌우 여백
    sectionGap: 72,        // 섹션 간
    chipToBody: 52,        // 칩 → 본문 (v2 28 → 붙어 보임 피드백으로 확대)
    lineHeight: 1.75,
    radius: 20,
    // 라벨칩 팔레트 (섹션 인덱스 순환)
    chips: [
      { text: '#2F63C7', bg: 'rgba(79,140,255,.10)' },
      { text: '#B4551E', bg: 'rgba(255,138,101,.14)' },
      { text: '#12766C', bg: 'rgba(53,197,184,.12)' },
      { text: '#6847C4', bg: 'rgba(167,139,250,.15)' }
    ]
  };

  // ── 색 유틸
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbStr(c) { return 'rgb(' + c.map(Math.round).join(',') + ')'; }
  function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
  function luma(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
  function darken(hex, f) { return rgbStr(hexRgb(hex).map((v) => v * f)); }

  // 대표색 상태: {mode:'solid'|'grad', c1, c2, dir:'h'|'v'|'d'}
  const GRAD_PRESETS = [
    { name: '에인연',   c1: '#4F8CFF', c2: '#8E2F56', dir: 'd' },
    { name: '네이비',   c1: '#2C4A8A', c2: '#101C36', dir: 'd' },
    { name: '차콜',     c1: '#3A3F47', c2: '#15171B', dir: 'v' },
    { name: '웜 선셋',  c1: '#FF8A65', c2: '#B4551E', dir: 'd' },
    { name: '딥그린',   c1: '#12766C', c2: '#0A3F3A', dir: 'v' },
    { name: '라벤더',   c1: '#A78BFA', c2: '#5B3FA8', dir: 'd' }
  ];
  const DEFAULT_COLOR = { mode: 'grad', c1: '#4F8CFF', c2: '#8E2F56', dir: 'd' };

  // 캔버스 채우기 스타일 (영역 좌표 기준 그라데이션)
  function accentPaint(ctx, color, x0, y0, x1, y1) {
    if (!color || color.mode !== 'grad') return (color && color.c1) || '#4F8CFF';
    const g = color.dir === 'h' ? ctx.createLinearGradient(x0, y0, x1, y0)
      : color.dir === 'v' ? ctx.createLinearGradient(x0, y0, x0, y1)
      : ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, color.c1);
    g.addColorStop(1, color.c2);
    return g;
  }
  // 대표색 평균 명도 기준 대비 텍스트색 (그라데이션은 두 색 평균)
  function idealTextOn(color) {
    const c = typeof color === 'string' ? hexRgb(color)
      : color.mode === 'grad' ? mix(hexRgb(color.c1), hexRgb(color.c2), 0.5) : hexRgb(color.c1);
    return luma(c) > 160 ? '#0F1013' : '#FFFFFF';
  }
  function colorAvgHex(color) {
    if (typeof color === 'string') return color;
    if (color.mode !== 'grad') return color.c1;
    const c = mix(hexRgb(color.c1), hexRgb(color.c2), 0.5);
    return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  // ── 배경 명도(0=순백 ~ 100=순흑) → 지면·텍스트 토큰 자동 보간 (전 구간 가독성 보장)
  function grayStyle(g) {
    const t = Math.min(100, Math.max(0, g)) / 100;
    const page = mix([251, 251, 252], [12, 13, 16], t);
    const darkText = luma(page) > 150;                    // 밝은 지면 = 진한 글자
    const ink = darkText ? [15, 16, 19] : [255, 255, 255];
    // 중간 명도(글자-지면 대비가 얕은 구간)에서는 본문을 잉크에 바짝 붙여 가독성 유지
    const dist = Math.min(1, Math.abs(luma(page) - 150) / 90);
    return {
      g, page: rgbStr(page), darkText,
      ink: rgbStr(ink),
      body: rgbStr(mix(ink, page, 0.22 * dist)),
      mute: rgbStr(mix(ink, page, 0.48 * Math.max(dist, 0.5))),
      rule: rgbStr(mix(ink, page, 0.88)),
      wm: rgbStr(mix(ink, page, 0.66)),
      footer: darkText ? 'ink' : 'accent'                 // 어두운 지면 = 대표색 푸터
    };
  }

  // ── 캔버스 유틸
  function makeCtxUtils(ctx) {
    return {
      wrap(text, maxWidth, font) {
        ctx.font = font;
        const out = [];
        for (const raw of String(text).split('\n')) {
          let line = '';
          for (const ch of raw) {
            if (ctx.measureText(line + ch).width > maxWidth && line) { out.push(line); line = ch; }
            else line += ch;
          }
          out.push(line);
        }
        return out;
      },
      roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      }
    };
  }

  // ── 요소 조절 단계값 (자유값 없음 — 어떤 조합에서도 레이아웃 유지)
  const ADJ = {
    size: [0.85, 0.93, 1, 1.09, 1.2],   // 글자 크기 5단계 (2 = 기본)
    gap: [-28, -14, 0, 20, 44]           // 위 간격 5단계 (논리 px 가감)
  };
  const defAdj = () => ({ size: 2, gap: 2, align: 'left' });

  // 조절 패널 — show(key,{label,align}) / hide(). read/write/resetAll은 페이지가 공급
  function mountAdjustPanel(rootEl, opts) {
    rootEl.className = 'adjust-panel';
    rootEl.hidden = true;
    rootEl.innerHTML =
      '<div class="ap-head"><strong id="apName"></strong>'
      + '<button type="button" class="ap-close" id="apClose">선택 해제</button></div>'
      + '<div class="ap-rows">'
      + '<div class="ap-row"><span>글자 크기</span>'
      + '<button type="button" data-k="size" data-d="-1">작게</button>'
      + '<button type="button" data-k="size" data-d="1">크게</button></div>'
      + '<div class="ap-row"><span>위 간격</span>'
      + '<button type="button" data-k="gap" data-d="-1">좁게</button>'
      + '<button type="button" data-k="gap" data-d="1">넓게</button></div>'
      + '<div class="ap-row" id="apAlignRow"><span>정렬</span>'
      + '<button type="button" data-align="left">왼쪽</button>'
      + '<button type="button" data-align="center">가운데</button></div>'
      + '</div>'
      + '<div class="ap-foot">'
      + '<button type="button" id="apReset">이 부분 기본값으로</button>'
      + '<button type="button" id="apResetAll">전체 기본값으로</button>'
      + '</div>';
    let key = null;

    function paint() {
      if (!key) return;
      const a = opts.read(key) || defAdj();
      rootEl.querySelectorAll('[data-align]').forEach((b) =>
        b.classList.toggle('on', b.dataset.align === (a.align || 'left')));
    }
    rootEl.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
      if (!key) return;
      const a = Object.assign(defAdj(), opts.read(key));
      const next = Math.min(ADJ[b.dataset.k].length - 1, Math.max(0, a[b.dataset.k] + Number(b.dataset.d)));
      if (next === a[b.dataset.k]) return;
      a[b.dataset.k] = next;
      opts.write(key, a);
    }));
    rootEl.querySelectorAll('[data-align]').forEach((b) => b.addEventListener('click', () => {
      if (!key) return;
      const a = Object.assign(defAdj(), opts.read(key));
      a.align = b.dataset.align;
      opts.write(key, a); paint();
    }));
    rootEl.querySelector('#apReset').addEventListener('click', () => { if (key) { opts.write(key, null); paint(); } });
    rootEl.querySelector('#apResetAll').addEventListener('click', () => { opts.resetAll(); paint(); });
    rootEl.querySelector('#apClose').addEventListener('click', () => api.hide());

    const api = {
      show(k, o) {
        key = k;
        rootEl.querySelector('#apName').textContent = o.label;
        rootEl.querySelector('#apAlignRow').style.display = o.align === false ? 'none' : '';
        rootEl.hidden = false;
        paint();
        if (opts.onShow) opts.onShow(k);
      },
      hide() { key = null; rootEl.hidden = true; if (opts.onHide) opts.onHide(); },
      key: () => key
    };
    return api;
  }
  // 조절값 적용 헬퍼: 기본 px → 단계 반영 px
  function adjSize(base, a) { return Math.round(base * ADJ.size[(a && a.size != null) ? a.size : 2]); }
  function adjGap(base, a) { return Math.max(0, Math.round(base + ADJ.gap[(a && a.gap != null) ? a.gap : 2])); }

  // ── 색 선택 컴포넌트 (단색/그라데이션 + 프리셋)
  function mountColorControl(rootEl, initial, onChange) {
    let val = Object.assign({}, DEFAULT_COLOR, initial || {});
    rootEl.className = 'color-ctl';
    rootEl.innerHTML =
      '<div class="toggle-group" role="group" aria-label="색 방식">'
      + '<button type="button" data-mode="solid">단색</button>'
      + '<button type="button" data-mode="grad">그라데이션</button></div>'
      + '<div class="cc-solid"><input type="color" data-c="c1s" aria-label="색 선택">'
      + '<input type="text" data-hex maxlength="7" aria-label="색 번호 직접 입력"></div>'
      + '<div class="cc-grad">'
      + '<div class="cc-pair"><label>시작 색<input type="color" data-c="c1"></label>'
      + '<label>끝 색<input type="color" data-c="c2"></label></div>'
      + '<div class="toggle-group cc-dir" role="group" aria-label="그라데이션 방향">'
      + '<button type="button" data-dir="h">가로</button>'
      + '<button type="button" data-dir="v">세로</button>'
      + '<button type="button" data-dir="d">대각</button></div>'
      + '<div class="cc-presets" role="group" aria-label="추천 색">'
      + GRAD_PRESETS.map((p, i) =>
        '<button type="button" data-p="' + i + '"><i style="background:linear-gradient(135deg,'
        + p.c1 + ',' + p.c2 + ')"></i>' + esc(p.name) + '</button>').join('')
      + '</div></div>';

    function paint() {
      rootEl.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === val.mode));
      rootEl.querySelector('.cc-solid').style.display = val.mode === 'solid' ? '' : 'none';
      rootEl.querySelector('.cc-grad').style.display = val.mode === 'grad' ? '' : 'none';
      rootEl.querySelector('[data-c="c1s"]').value = val.c1;
      rootEl.querySelector('[data-hex]').value = val.c1.toUpperCase();
      rootEl.querySelector('[data-c="c1"]').value = val.c1;
      rootEl.querySelector('[data-c="c2"]').value = val.c2;
      rootEl.querySelectorAll('[data-dir]').forEach((b) => b.classList.toggle('on', b.dataset.dir === val.dir));
    }
    function emit() { paint(); onChange(Object.assign({}, val)); }

    rootEl.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { val.mode = b.dataset.mode; emit(); }));
    rootEl.querySelector('[data-c="c1s"]').addEventListener('input', (e) => { val.c1 = e.target.value; emit(); });
    rootEl.querySelector('[data-hex]').addEventListener('input', (e) => {
      const v = e.target.value.trim().replace(/^([0-9a-fA-F]{6})$/, '#$1');
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { val.c1 = v; emit(); }
    });
    rootEl.querySelector('[data-c="c1"]').addEventListener('input', (e) => { val.c1 = e.target.value; emit(); });
    rootEl.querySelector('[data-c="c2"]').addEventListener('input', (e) => { val.c2 = e.target.value; emit(); });
    rootEl.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { val.dir = b.dataset.dir; emit(); }));
    rootEl.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
      const p = GRAD_PRESETS[Number(b.dataset.p)];
      val = { mode: 'grad', c1: p.c1, c2: p.c2, dir: p.dir };
      emit();
    }));
    paint();
    return { get: () => Object.assign({}, val), set: (v) => { val = Object.assign({}, DEFAULT_COLOR, v); paint(); } };
  }

  // ── 배경 명도 슬라이더 (0 순백 ~ 100 순흑, 프리셋 점 3개 + 밝게/어둡게 버튼)
  function mountGraySlider(rootEl, initial, onChange) {
    let val = Math.min(100, Math.max(0, initial != null ? initial : 0));
    rootEl.className = 'gray-ctl';
    rootEl.innerHTML =
      '<div class="gc-presets" role="group" aria-label="배경 빠른 선택">'
      + '<button type="button" data-g="0">화이트</button>'
      + '<button type="button" data-g="50">그레이</button>'
      + '<button type="button" data-g="100">블랙</button></div>'
      + '<div class="gc-row">'
      + '<button type="button" class="gc-step" data-d="-5">밝게</button>'
      + '<input type="range" min="0" max="100" step="1" aria-label="배경 밝기 (0 흰색, 100 검정)">'
      + '<button type="button" class="gc-step" data-d="5">어둡게</button></div>';
    const range = rootEl.querySelector('input');

    function paint() {
      range.value = val;
      rootEl.querySelectorAll('[data-g]').forEach((b) => b.classList.toggle('on', Number(b.dataset.g) === val));
    }
    function emit() { paint(); onChange(val); }
    range.addEventListener('input', () => { val = Number(range.value); emit(); });
    rootEl.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { val = Number(b.dataset.g); emit(); }));
    rootEl.querySelectorAll('.gc-step').forEach((b) => b.addEventListener('click', () => {
      val = Math.min(100, Math.max(0, val + Number(b.dataset.d))); emit();
    }));
    paint();
    return { get: () => val, set: (v) => { val = Math.min(100, Math.max(0, v)); paint(); } };
  }

  // ── 규격 선택 (그룹 드롭다운 + 직접 입력) — onChange({id,label,W,H})
  function mountFormatSelect(rootEl, data, initial, onChange) {
    const lim = data.custom || { min: 400, max: 4000 };
    rootEl.className = 'fmt-ctl';
    let html = '<select aria-label="만들 크기 선택">';
    Object.keys(data.groups).forEach((gid) => {
      const items = data.formats.filter((f) => f.group === gid);
      if (!items.length) return;
      html += '<optgroup label="' + esc(data.groups[gid]) + '">'
        + items.map((f) => '<option value="' + f.id + '">' + esc(f.label) + ' — ' + f.W + '×' + f.H + '</option>').join('')
        + '</optgroup>';
    });
    html += '<optgroup label="직접 입력"><option value="__custom">원하는 크기 직접 입력</option></optgroup></select>'
      + '<div class="fmt-custom" hidden>'
      + '<input type="number" data-w inputmode="numeric" min="' + lim.min + '" max="' + lim.max + '" placeholder="가로" aria-label="가로 크기">'
      + '<span>×</span>'
      + '<input type="number" data-h inputmode="numeric" min="' + lim.min + '" max="' + lim.max + '" placeholder="세로" aria-label="세로 크기">'
      + '<button type="button">적용</button></div>'
      + '<p class="hint fmt-hint" hidden>' + lim.min + '~' + lim.max + ' 사이 숫자를 넣어 주세요.</p>';
    rootEl.innerHTML = html;
    const sel = rootEl.querySelector('select');
    const box = rootEl.querySelector('.fmt-custom');
    const hint = rootEl.querySelector('.fmt-hint');
    const iw = rootEl.querySelector('[data-w]');
    const ih = rootEl.querySelector('[data-h]');
    let val = null;

    function pick(id) {
      const f = data.formats.find((x) => x.id === id);
      if (f) { val = { id: f.id, label: f.label, W: f.W, H: f.H }; onChange(val); }
    }
    sel.addEventListener('change', () => {
      const isCustom = sel.value === '__custom';
      box.hidden = !isCustom;
      hint.hidden = true;
      if (!isCustom) pick(sel.value);
    });
    rootEl.querySelector('.fmt-custom button').addEventListener('click', () => {
      const w = Number(iw.value), h = Number(ih.value);
      const ok = w >= lim.min && w <= lim.max && h >= lim.min && h <= lim.max;
      hint.hidden = ok;
      if (!ok) return;
      val = { id: 'custom', label: '직접 입력', W: Math.round(w), H: Math.round(h) };
      onChange(val);
    });

    // 초기값
    if (initial && initial.id === 'custom') {
      sel.value = '__custom'; box.hidden = false;
      iw.value = initial.W; ih.value = initial.H;
      val = initial;
    } else {
      const f = data.formats.find((x) => initial && x.id === initial.id) || data.formats[0];
      sel.value = f.id;
      val = { id: f.id, label: f.label, W: f.W, H: f.H };
    }
    return { get: () => Object.assign({}, val) };
  }

  // ── 첫 방문 3단계 안내 (1회)
  function showGuideOnce(storeKey, steps) {
    try { if (localStorage.getItem(storeKey)) return; } catch (e) { return; }
    const ov = document.createElement('div');
    ov.className = 'guide-ov';
    ov.innerHTML = '<div class="guide-card" role="dialog" aria-label="사용 안내">'
      + '<h2>이렇게 만들어요</h2>'
      + '<ol>' + steps.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ol>'
      + '<div class="guide-actions">'
      + '<button type="button" class="g-skip">다시 보지 않기</button>'
      + '<button type="button" class="g-go">시작하기</button></div></div>';
    document.body.appendChild(ov);
    const done = () => { try { localStorage.setItem(storeKey, '1'); } catch (e) {} ov.remove(); };
    ov.querySelector('.g-skip').addEventListener('click', done);
    ov.querySelector('.g-go').addEventListener('click', done);
  }

  // ── 폰트 준비
  let fontReady = false;
  async function ensureFonts() {
    if (fontReady) return;
    await Promise.all([
      document.fonts.load(`800 64px ${FONT}`),
      document.fonts.load(`700 36px ${FONT}`),
      document.fonts.load(`500 32px ${FONT}`)
    ]).catch(() => {});
    await document.fonts.ready;
    fontReady = true;
  }

  // ── 데이터 로더
  async function loadJson(path) {
    const res = await fetch(path);
    return res.json();
  }

  // ── 업종 검색 컴포넌트 (검색형 자동완성 + 직접 입력)
  async function mountFieldSearch(rootEl, opts) {
    const data = await loadJson('/maker/fields.json');
    const flat = [];
    data.categories.forEach((cat) => cat.items.forEach((it) => {
      if (!it.custom) flat.push({ ...it, cat: cat.label });
    }));

    rootEl.classList.add('field-search');
    rootEl.innerHTML =
      '<input type="text" class="fs-input" placeholder="업종을 검색하세요 (예: 도배, 보일러)" autocomplete="off" '
      + 'role="combobox" aria-expanded="false" aria-label="업종 검색">'
      + '<div class="fs-list" role="listbox" hidden></div>';
    const input = rootEl.querySelector('.fs-input');
    const list = rootEl.querySelector('.fs-list');
    let current = null;

    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
    function open() { list.hidden = false; input.setAttribute('aria-expanded', 'true'); }

    function renderList(q) {
      const query = q.trim();
      const hits = query
        ? flat.filter((f) => (f.label + f.cat).replace(/\s/g, '').includes(query.replace(/\s/g, '')))
        : flat;
      let html = '';
      let lastCat = null;
      hits.slice(0, 30).forEach((f) => {
        if (f.cat !== lastCat) { html += '<div class="fs-cat">' + f.cat + '</div>'; lastCat = f.cat; }
        html += '<button type="button" class="fs-item" role="option" data-id="' + f.id + '">' + esc(f.label) + '</button>';
      });
      if (query) {
        html += '<button type="button" class="fs-item fs-custom" data-id="__custom">"'
          + esc(query) + '" 직접 입력으로 사용</button>';
      }
      list.innerHTML = html || '<div class="fs-cat">검색 결과 없음 — 계속 입력하면 직접 입력으로 쓸 수 있어요</div>';
      list.querySelectorAll('.fs-item').forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.id === '__custom') {
          current = { id: 'custom', label: input.value.trim(), custom: true };
        } else {
          current = flat.find((f) => f.id === b.dataset.id);
        }
        input.value = current.label;
        close();
        opts.onSelect(current);
      }));
      open();
    }

    input.addEventListener('input', () => renderList(input.value));
    input.addEventListener('focus', () => renderList(input.value));
    document.addEventListener('click', (e) => { if (!rootEl.contains(e.target)) close(); });

    return {
      get: () => current,
      set: (item) => { current = item; input.value = item ? item.label : ''; }
    };
  }

  // ── 내보내기 + 카운터
  async function exportCanvas(cv, name, renderFn) {
    await ensureFonts();
    renderFn();
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }
  function bumpUseCount() {
    try { ainAuth.getClient().rpc('bump_stat', { p_key: 'maker_uses' }).then(() => {}, () => {}); } catch (e) {}
  }
  async function download(cv, name, renderFn, toast) {
    const blob = await exportCanvas(cv, name, renderFn);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('이미지로 저장했어요');
    bumpUseCount();
  }
  async function share(cv, name, renderFn, toast) {
    const blob = await exportCanvas(cv, name, renderFn);
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); bumpUseCount(); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    toast('이 기기는 공유가 안 돼서 이미지로 저장했어요');
    bumpUseCount();
  }

  // ── 사진 줄이기 (긴 변 1600, 기기 밖 무전송)
  async function resizePhoto(file) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const oc = new OffscreenCanvas(w, h);
    oc.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const bitmap = await createImageBitmap(oc);
    const thumb = URL.createObjectURL(await oc.convertToBlob({ type: 'image/jpeg', quality: 0.8 }));
    return { bitmap, thumb };
  }

  window.makerCore = {
    FONT, TOKENS, GRAD_PRESETS, DEFAULT_COLOR, ADJ,
    makeCtxUtils, darken, idealTextOn, colorAvgHex, accentPaint, grayStyle,
    adjSize, adjGap, defAdj,
    mountColorControl, mountGraySlider, mountFormatSelect, mountAdjustPanel, mountFieldSearch,
    showGuideOnce, ensureFonts, loadJson, download, share, bumpUseCount, resizePhoto
  };
})();
