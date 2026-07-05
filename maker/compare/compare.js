// T2 홍보 카드 — 레이아웃 선택형(전후 좌우/상하/3분할/대각선/사진+문구/문구 배너) + 탭 선택 조절
(function () {
  'use strict';
  const M = () => window.makerCore;
  const $ = (id) => document.getElementById(id);
  const STORE = 'maker_compare_v2';

  const LAYOUTS = [
    { id: 'side2',  name: '전후 좌우',  thumb: 't-side',   slots: ['before', 'after'] },
    { id: 'stack2', name: '전후 상하',  thumb: 't-stack',  slots: ['before', 'after'] },
    { id: 'tri3',   name: '전·중·후',   thumb: 't-tri',    slots: ['before', 'mid', 'after'] },
    { id: 'diag',   name: '대각선',     thumb: 't-diag',   slots: ['before', 'after'] },
    { id: 'single', name: '사진+문구',  thumb: 't-single', slots: ['before'] },
    { id: 'banner', name: '문구 배너',  thumb: 't-banner', slots: [] }
  ];
  const LABEL_PRESETS = [
    { name: '시공 전/후', v: ['시공 전', '시공 중', '시공 후'] },
    { name: 'Before/After', v: ['BEFORE', 'DURING', 'AFTER'] },
    { name: '청소 전/후', v: ['청소 전', '청소 중', '청소 후'] }
  ];

  let layout = 'side2';
  let labels = { before: '시공 전', mid: '시공 중', after: '시공 후' };
  let barStyle = 'ink';
  let color = null;
  let fmtSel = { id: 'square', label: '인스타 정사각', W: 1080, H: 1080 };
  let adj = {};
  let selKey = null;
  let regions = [];   // 물리 좌표
  let panel = null;
  const photos = { before: null, mid: null, after: null };

  const cv = $('cv');
  const ctx = cv.getContext('2d');

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  function saveState() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        layout, labels, barStyle, color, fmtSel, adj,
        biz: $('fBiz').value, phone: $('fPhone').value,
        head: $('fHead').value, sub: $('fSub').value
      }));
    } catch (e) {}
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }

  const L = () => LAYOUTS.find((l) => l.id === layout);

  // ── 렌더 (물리 해상도 직접 — 사진 선명도 보존)
  function coverDraw(img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  function emptySlot(x, y, w, h, scale) {
    ctx.fillStyle = '#ECEDEF'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#A3A7AE';
    ctx.font = `700 ${Math.round(28 * scale)}px ${M().FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('사진을 넣어 주세요', x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
  }
  function chipLabel(text, x, y, scale, alignRight) {
    if (!text) return null;
    const u = M().makeCtxUtils(ctx);
    const fs = M().adjSize(Math.round(26 * scale), adj.labels);
    ctx.font = `800 ${fs}px ${M().FONT}`;
    const tw = ctx.measureText(text).width;
    const bx = alignRight ? x - tw - 36 * scale : x;
    ctx.fillStyle = 'rgba(15,16,19,.72)';
    u.roundRect(bx, y, tw + 36 * scale, fs + 24 * scale, (fs + 24 * scale) / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, bx + 18 * scale, y + fs + 6 * scale);
    return { x: bx, y, w: tw + 36 * scale, h: fs + 24 * scale };
  }
  function addLabelRegion(r) {
    if (r && !regions.some((g) => g.key === 'labels')) {
      regions.push({ key: 'labels', label: '사진 이름표', x: r.x, y: r.y, w: r.w, h: r.h, align: false });
    }
  }
  function photoSlot(key, x, y, w, h, scale) {
    const img = photos[key];
    if (img) coverDraw(img, x, y, w, h);
    else emptySlot(x, y, w, h, scale);
    addLabelRegion(chipLabel(labels[key], x + 18 * scale, y + 18 * scale, scale, false));
  }

  function renderCanvas(forExport) {
    const F = fmtSel;
    cv.width = F.W; cv.height = F.H;
    $('previewSize').textContent = F.W + '×' + F.H;
    const W = F.W, H = F.H;
    const scale = W / 1080;
    const BAR = Math.round((H / W > 1.4 ? 150 : 170) * scale);
    const PH = H - BAR;
    const G = Math.max(4, Math.round(6 * scale));
    const FONT = M().FONT;
    const C = M();
    const u = C.makeCtxUtils(ctx);
    regions = [];

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    const lay = L();
    const landscape = W / PH > 1.15;

    if (layout === 'banner') {
      // 문구 배너 — 대표색 배경 + 큰 문구
      ctx.fillStyle = C.accentPaint(ctx, color, 0, 0, W, PH);
      ctx.fillRect(0, 0, W, PH);
      const txtColor = C.idealTextOn(color);
      const aH = adj.headline, aS2 = adj.sub;
      const hSize = C.adjSize(Math.round(66 * scale), aH);
      const sSize = C.adjSize(Math.round(32 * scale), aS2);
      const head = $('fHead').value.trim() || '믿고 맡기는 시공, 확실한 마무리';
      const sub = $('fSub').value.trim() || '상담·견적 언제든 환영합니다';
      ctx.fillStyle = txtColor;
      ctx.font = `800 ${hSize}px ${FONT}`;
      const lines = u.wrap(head, W * 0.82, ctx.font).slice(0, 3);
      let ty = PH / 2 - ((lines.length - 1) * hSize * 1.25 + sSize * 2.4) / 2 + C.adjGap(0, aH);
      ctx.textAlign = 'center';
      const hTop = ty - hSize;
      lines.forEach((ln) => { ctx.fillText(ln, W / 2, ty); ty += hSize * 1.25; });
      regions.push({ key: 'headline', label: '한 줄 문구', x: W * 0.09, y: hTop, w: W * 0.82, h: ty - hTop - hSize * 0.25, align: false });
      ty += sSize * 1.1 + C.adjGap(0, aS2);
      ctx.globalAlpha = 0.85;
      ctx.font = `500 ${sSize}px ${FONT}`;
      ctx.fillText(sub, W / 2, ty);
      ctx.globalAlpha = 1;
      regions.push({ key: 'sub', label: '보조 문구', x: W * 0.09, y: ty - sSize * 1.1, w: W * 0.82, h: sSize * 1.6, align: false });
      ctx.textAlign = 'left';
    } else if (layout === 'single') {
      // 사진 + 문구 (하단 어둡게 + 대표색 포인트)
      if (photos.before) coverDraw(photos.before, 0, 0, W, PH);
      else emptySlot(0, 0, W, PH, scale);
      const ov = ctx.createLinearGradient(0, PH * 0.45, 0, PH);
      ov.addColorStop(0, 'rgba(10,11,14,0)');
      ov.addColorStop(1, 'rgba(10,11,14,.72)');
      ctx.fillStyle = ov;
      ctx.fillRect(0, 0, W, PH);
      const aH = adj.headline, aS2 = adj.sub;
      const hSize = C.adjSize(Math.round(56 * scale), aH);
      const sSize = C.adjSize(Math.round(30 * scale), aS2);
      const head = $('fHead').value.trim() || '믿고 맡기는 시공, 확실한 마무리';
      const sub = $('fSub').value.trim() || '상담·견적 언제든 환영합니다';
      const mgx = Math.round(60 * scale);
      ctx.font = `800 ${hSize}px ${FONT}`;
      const lines = u.wrap(head, W - mgx * 2, ctx.font).slice(0, 2);
      let ty = PH - Math.round(sSize * 1.7 + 60 * scale) - (lines.length - 1) * hSize * 1.2 + C.adjGap(0, aH);
      // 대표색 포인트 바
      ctx.fillStyle = C.accentPaint(ctx, color, mgx, 0, mgx + 110 * scale, 0);
      ctx.fillRect(mgx, ty - hSize - Math.round(34 * scale), Math.round(110 * scale), Math.round(10 * scale));
      ctx.fillStyle = '#fff';
      const hTop = ty - hSize;
      lines.forEach((ln) => { ctx.fillText(ln, mgx, ty); ty += hSize * 1.2; });
      regions.push({ key: 'headline', label: '한 줄 문구', x: mgx, y: hTop, w: W - mgx * 2, h: ty - hTop - hSize * 0.2, align: false });
      ctx.globalAlpha = 0.88;
      ctx.font = `500 ${sSize}px ${FONT}`;
      const subY = PH - Math.round(44 * scale) + C.adjGap(0, aS2);
      ctx.fillText(sub, mgx, subY);
      ctx.globalAlpha = 1;
      regions.push({ key: 'sub', label: '보조 문구', x: mgx, y: subY - sSize, w: W - mgx * 2, h: sSize * 1.6, align: false });
    } else if (layout === 'diag') {
      // 대각선 스플릿 (좌상=전, 우하=후)
      if (photos.before) coverDraw(photos.before, 0, 0, W, PH); else emptySlot(0, 0, W, PH, scale);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(W, 0); ctx.lineTo(W, PH); ctx.lineTo(0, PH); ctx.closePath();
      ctx.clip();
      if (photos.after) coverDraw(photos.after, 0, 0, W, PH);
      else { ctx.fillStyle = '#D9DCE1'; ctx.fillRect(0, 0, W, PH); }
      ctx.restore();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(4, Math.round(7 * scale));
      ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(0, PH); ctx.stroke();
      addLabelRegion(chipLabel(labels.before, Math.round(18 * scale), Math.round(18 * scale), scale, false));
      chipLabel(labels.after, W - Math.round(18 * scale), PH - Math.round(70 * scale), scale, true);
    } else {
      // 분할 (좌우/상하/3분할 — 3분할은 규격 모양 따라 자동)
      const keys = lay.slots;
      const n = keys.length;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, PH);
      const asCols = layout === 'side2' || (layout === 'tri3' && (W >= H * 0.98 || landscape));
      if (asCols) {
        const w = (W - G * (n - 1)) / n;
        keys.forEach((k, i) => photoSlot(k, i * (w + G), 0, w, PH, scale));
      } else {
        const h = (PH - G * (n - 1)) / n;
        keys.forEach((k, i) => photoSlot(k, 0, i * (h + G), W, h, scale));
      }
    }

    // 하단 상호 띠
    const biz = $('fBiz').value.trim() || '에어컨 인테리어 연구소';
    const phone = $('fPhone').value.trim() || '010-0000-0000';
    const ink = barStyle === 'ink';
    ctx.fillStyle = ink ? '#0F1013' : '#FFFFFF';
    ctx.fillRect(0, PH, W, BAR);
    if (!ink) { ctx.fillStyle = '#E8E8EC'; ctx.fillRect(0, PH, W, 2); }
    const aB = adj.bar;
    const bizSize = C.adjSize(Math.round(38 * scale), aB);   // v3: 상호명 1단계 축소 (40→38)
    const phoneSize = C.adjSize(Math.round(34 * scale), aB);
    ctx.fillStyle = ink ? '#FFFFFF' : '#0F1013';
    ctx.font = `800 ${bizSize}px ${FONT}`;
    ctx.fillText(biz, Math.round(60 * scale), PH + Math.round(70 * scale));
    ctx.font = `700 ${phoneSize}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(phone, W - Math.round(60 * scale), PH + Math.round(70 * scale));
    ctx.textAlign = 'left';
    regions.push({ key: 'bar', label: '하단 상호 띠', x: 0, y: PH, w: W, h: BAR, align: false });
    ctx.fillStyle = ink ? 'rgba(255,255,255,.55)' : '#B9BDC4';
    ctx.font = `500 ${Math.round(22 * scale)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(M().TOKENS.watermark, W / 2, PH + BAR - Math.round(26 * scale));
    ctx.textAlign = 'left';

    // 선택 표시 (내보내기 제외)
    if (!forExport && selKey) {
      const r = regions.find((x) => x.key === selKey);
      if (r) {
        ctx.strokeStyle = '#4F8CFF';
        ctx.lineWidth = Math.max(3, 4 * scale);
        ctx.setLineDash([12 * scale, 8 * scale]);
        u.roundRect(r.x - 10 * scale, r.y - 8 * scale, r.w + 20 * scale, r.h + 16 * scale, 12 * scale);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  let pending = null;
  function render() {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      await M().ensureFonts();
      renderCanvas(false);
      saveState();
    }, 100);
  }
  window.__compareRender = render; // 테스트 훅

  // ── 레이아웃별 입력 노출
  function syncFormVisibility() {
    const lay = L();
    $('photoField').hidden = !lay.slots.length;
    ['before', 'mid', 'after'].forEach((k) => {
      const K = k[0].toUpperCase() + k.slice(1);
      $('drop' + K).style.display = lay.slots.includes(k) ? '' : 'none';
      $('lb' + K).style.display = lay.slots.includes(k) ? '' : 'none';
      $('tag' + K).textContent = lay.slots.length > 1 ? labels[k] : '사진';
    });
    $('labelField').hidden = lay.slots.length <= 1;
    const showText = layout === 'single' || layout === 'banner';
    $('textField').hidden = !showText;
    $('colorField').hidden = !showText;
  }

  function renderLayoutPick() {
    $('layoutPick').innerHTML = LAYOUTS.map((l) => {
      const bars = l.thumb === 't-tri' ? '<i></i><i></i><i></i>'
        : (l.thumb === 't-single' || l.thumb === 't-banner') ? '<i></i>' : '<i></i><i></i>';
      return '<button type="button" class="lp-item ' + (layout === l.id ? 'on' : '') + '" data-l="' + l.id + '">'
        + '<span class="lp-thumb ' + l.thumb + '">' + (l.thumb === 't-banner' ? '' : bars) + '</span>'
        + '<span>' + l.name + '</span></button>';
    }).join('');
    $('layoutPick').querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => {
      layout = b.dataset.l;
      selKey = null; if (panel) panel.hide();
      renderLayoutPick(); syncFormVisibility(); render();
    }));
  }

  async function loadPhoto(file, key) {
    if (!file) return;
    const { bitmap, thumb } = await M().resizePhoto(file);
    photos[key] = bitmap;
    const drop = $('drop' + key[0].toUpperCase() + key.slice(1));
    let img = drop.querySelector('img');
    if (!img) { img = document.createElement('img'); img.alt = ''; drop.appendChild(img); }
    img.src = thumb;
    $(key + 'Hint').hidden = true;
    if (!drop.querySelector('.photo-clear')) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'photo-clear'; x.textContent = '✕';
      x.setAttribute('aria-label', '사진 빼기');
      x.addEventListener('click', (e) => {
        e.preventDefault();
        photos[key] = null;
        drop.querySelector('img').remove();
        x.remove();
        $(key + 'Hint').hidden = false;
        $('file' + key[0].toUpperCase() + key.slice(1)).value = '';
        render();
      });
      drop.appendChild(x);
    }
    render();
  }

  function fileName() {
    return ($('fBiz').value.trim() || '에인연') + '-홍보카드-' + fmtSel.W + 'x' + fmtSel.H + '.png';
  }

  async function init() {
    const C = M();
    ctx.fillStyle = '#F7F7F8';           // 데이터 로드 전 즉시 첫 페인트
    ctx.fillRect(0, 0, cv.width, cv.height);
    const fmtData = await C.loadJson('/maker/formats.json');

    const s = loadState() || {};
    layout = LAYOUTS.some((l) => l.id === s.layout) ? s.layout : 'side2';
    if (s.labels) labels = Object.assign(labels, s.labels);
    barStyle = s.barStyle === 'white' ? 'white' : 'ink';
    color = s.color || Object.assign({}, C.DEFAULT_COLOR);
    adj = s.adj || {};
    if (s.fmtSel && s.fmtSel.W) fmtSel = s.fmtSel;
    if (s.biz) $('fBiz').value = s.biz;
    if (s.phone) $('fPhone').value = s.phone;
    if (s.head) $('fHead').value = s.head;
    if (s.sub) $('fSub').value = s.sub;
    $('lbBefore').value = labels.before;
    $('lbMid').value = labels.mid;
    $('lbAfter').value = labels.after;

    renderLayoutPick();
    syncFormVisibility();

    // 이름표 입력 + 프리셋
    [['lbBefore', 'before'], ['lbMid', 'mid'], ['lbAfter', 'after']].forEach(([id, k]) =>
      $(id).addEventListener('input', (e) => { labels[k] = e.target.value; syncFormVisibility(); render(); }));
    $('labelPresets').innerHTML = LABEL_PRESETS.map((p, i) =>
      '<button type="button" data-p="' + i + '">' + p.name + '</button>').join('');
    $('labelPresets').querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
      const p = LABEL_PRESETS[Number(b.dataset.p)];
      labels = { before: p.v[0], mid: p.v[1], after: p.v[2] };
      $('lbBefore').value = labels.before; $('lbMid').value = labels.mid; $('lbAfter').value = labels.after;
      syncFormVisibility(); render();
    }));

    // 대표색·크기
    C.mountColorControl($('colorCtl'), color, (v) => { color = v; render(); });
    const fmtApi = C.mountFormatSelect($('fmtCtl'), fmtData, fmtSel, (v) => { fmtSel = v; render(); });
    fmtSel = fmtApi.get();

    // 하단 띠 색
    $('barToggle').querySelectorAll('[data-bar]').forEach((b) =>
      b.addEventListener('click', () => {
        barStyle = b.dataset.bar;
        $('barToggle').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        render();
      }));
    if (barStyle === 'white') {
      $('barToggle').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.bar === 'white'));
    }

    // 탭 선택 조절
    panel = C.mountAdjustPanel($('adjustPanel'), {
      read: (k) => adj[k],
      write: (k, v) => { if (v) adj[k] = v; else delete adj[k]; render(); },
      resetAll: () => { adj = {}; render(); },
      onHide: () => { selKey = null; render(); }
    });
    cv.addEventListener('click', (e) => {
      const rect = cv.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (cv.width / rect.width);
      const yy = (e.clientY - rect.top) * (cv.height / rect.height);
      const hit = [...regions].reverse().find((r) => x >= r.x - 12 && x <= r.x + r.w + 12 && yy >= r.y - 10 && yy <= r.y + r.h + 10);
      if (hit) { selKey = hit.key; panel.show(hit.key, { label: hit.label, align: false }); }
      else { selKey = null; panel.hide(); }
      render();
    });

    ['fBiz', 'fPhone', 'fHead', 'fSub'].forEach((id) => $(id).addEventListener('input', render));
    $('fileBefore').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'before'));
    $('fileMid').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'mid'));
    $('fileAfter').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'after'));
    $('btnSave').addEventListener('click', () => M().download(cv, fileName(), () => renderCanvas(true), toast));
    $('btnShare').addEventListener('click', () => M().share(cv, fileName(), () => renderCanvas(true), toast));

    C.showGuideOnce('maker_guide_compare_v1', [
      '카드 모양을 먼저 고르세요 — 사진 비교, 사진+문구, 문구 배너',
      '사진과 문구를 넣으세요 — 미리보기의 글자를 누르면 크기도 바뀌어요',
      '다 되면 이미지로 저장하거나 카톡으로 보내세요'
    ]);

    render();
  }

  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', init) : init();
})();
