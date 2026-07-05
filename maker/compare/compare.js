// T2 전·중·후 비교 — 승인 무드보드(클린 스플릿) 캔버스 렌더. 중 슬롯 = 3분할 자동.
(function () {
  'use strict';
  const M = () => window.makerCore;
  const $ = (id) => document.getElementById(id);
  const STORE = 'maker_compare_v1';

  let formats = [];
  let fmt = 'square';
  let style = 'ink'; // 브랜드 바: ink | white
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
        fmt, style, biz: $('fBiz').value, phone: $('fPhone').value
      }));
    } catch (e) {}
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }

  // ── 렌더 (물리 해상도 직접 — 사진 선명도 보존)
  function coverDraw(img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  function slot(img, x, y, w, h, label, scale) {
    const u = M().makeCtxUtils(ctx);
    if (img) coverDraw(img, x, y, w, h);
    else {
      ctx.fillStyle = '#ECEDEF'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#A3A7AE';
      ctx.font = `700 ${Math.round(28 * scale)}px ${M().FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(label + ' 사진', x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
    }
    // 라벨칩 (코너, 절제 크기 — 승인 토큰)
    const fs = Math.round(26 * scale);
    ctx.font = `800 ${fs}px ${M().FONT}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(15,16,19,.72)';
    u.roundRect(x + 18 * scale, y + 18 * scale, tw + 36 * scale, fs + 24 * scale, (fs + 24 * scale) / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 36 * scale, y + 18 * scale + fs + 6 * scale);
  }

  function renderCanvas() {
    const F = formats.find((f) => f.id === fmt) || formats[0];
    cv.width = F.W; cv.height = F.H;
    $('previewSize').textContent = F.W + '×' + F.H;
    const W = F.W, H = F.H;
    const scale = W / 1080;
    const BAR = Math.round(170 * scale);
    const PH = H - BAR;
    const G = Math.max(4, Math.round(6 * scale)); // 흰 디바이더
    const FONT = M().FONT;

    ctx.fillStyle = '#F7F7F8';
    ctx.fillRect(0, 0, W, H);

    const three = !!photos.mid;
    const slots = three
      ? [[photos.before, '시공 전'], [photos.mid, '시공 중'], [photos.after, '시공 후']]
      : [[photos.before, '시공 전'], [photos.after, '시공 후']];
    const n = slots.length;
    const landscape = W / PH > 1.15; // 가로형 규격(fb·band·a4가로)은 항상 열 분할

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, PH); // 디바이더 바탕
    if (W >= H * 0.98 || landscape) {
      // 정방형·가로형 → 좌우 열
      const w = (W - G * (n - 1)) / n;
      slots.forEach(([img, lb], i) => slot(img, i * (w + G), 0, w, PH, lb, scale));
    } else {
      // 세로형 → 행 분할
      const h = (PH - G * (n - 1)) / n;
      slots.forEach(([img, lb], i) => slot(img, 0, i * (h + G), W, h, lb, scale));
    }

    // 하단 브랜드 바 (잉크 / 화이트)
    const biz = $('fBiz').value.trim() || '에어컨 인테리어 연구소';
    const phone = $('fPhone').value.trim() || '010-0000-0000';
    const ink = style === 'ink';
    ctx.fillStyle = ink ? '#0F1013' : '#FFFFFF';
    ctx.fillRect(0, PH, W, BAR);
    if (!ink) { ctx.fillStyle = '#E8E8EC'; ctx.fillRect(0, PH, W, 2); }
    ctx.fillStyle = ink ? '#FFFFFF' : '#0F1013';
    ctx.font = `800 ${Math.round(40 * scale)}px ${FONT}`;
    ctx.fillText(biz, Math.round(60 * scale), PH + Math.round(72 * scale));
    ctx.font = `700 ${Math.round(34 * scale)}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(phone, W - Math.round(60 * scale), PH + Math.round(72 * scale));
    ctx.textAlign = 'left';
    ctx.fillStyle = ink ? 'rgba(255,255,255,.55)' : '#B9BDC4';
    ctx.font = `500 ${Math.round(22 * scale)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(M().TOKENS.watermark, W / 2, PH + BAR - Math.round(28 * scale));
    ctx.textAlign = 'left';
  }

  let pending = null;
  function render() {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      await M().ensureFonts();
      renderCanvas();
      saveState();
    }, 100);
  }
  window.__compareRender = render; // 테스트 훅

  async function loadPhoto(file, key) {
    if (!file) return;
    const { bitmap, thumb } = await M().resizePhoto(file);
    photos[key] = bitmap;
    const drop = $('drop' + key[0].toUpperCase() + key.slice(1));
    let img = drop.querySelector('img');
    if (!img) { img = document.createElement('img'); img.alt = ''; drop.appendChild(img); }
    img.src = thumb;
    $(key + 'Hint').hidden = true;
    // 지우기 버튼 (특히 '중' 비우면 2분할 복귀)
    if (!drop.querySelector('.photo-clear')) {
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'photo-clear'; x.textContent = '✕';
      x.setAttribute('aria-label', '사진 제거');
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
    return ($('fBiz').value.trim() || '에인연') + '-' + (photos.mid ? '전중후' : '전후') + '-' + fmt + '.png';
  }

  async function init() {
    formats = await M().loadFormats('compare');
    const s = loadState();
    if (s) {
      fmt = formats.some((f) => f.id === s.fmt) ? s.fmt : 'square';
      style = s.style === 'white' ? 'white' : 'ink';
      $('fBiz').value = s.biz || ''; $('fPhone').value = s.phone || '';
    }

    function renderFmtToggle() {
      $('fmtToggle').innerHTML = formats.map((f) =>
        '<button type="button" data-fmt="' + f.id + '" class="' + (fmt === f.id ? 'on' : '') + '">'
        + f.label + ' ' + f.W + '×' + f.H + '</button>').join('');
      $('fmtToggle').querySelectorAll('[data-fmt]').forEach((b) =>
        b.addEventListener('click', () => { fmt = b.dataset.fmt; renderFmtToggle(); render(); }));
    }
    renderFmtToggle();

    $('styleToggle').querySelectorAll('[data-style]').forEach((b) =>
      b.addEventListener('click', () => {
        style = b.dataset.style;
        $('styleToggle').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        render();
      }));
    if (style === 'white') {
      $('styleToggle').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.style === 'white'));
    }

    ['fBiz', 'fPhone'].forEach((id) => $(id).addEventListener('input', render));
    $('fileBefore').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'before'));
    $('fileMid').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'mid'));
    $('fileAfter').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'after'));
    $('btnSave').addEventListener('click', () => M().download(cv, fileName(), renderCanvas, toast));
    $('btnShare').addEventListener('click', () => M().share(cv, fileName(), renderCanvas, toast));

    render();
  }

  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', init) : init();
})();
