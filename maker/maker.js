// 에인연 템플릿 메이커 — 캔버스 1080 고정 렌더 (기기 무관 동일 산출물)
// 사진은 클라이언트에서만 처리. 서버 전송 0건.
(function () {
  'use strict';

  const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';
  const WATERMARK = 'made with 에인연 · ainyeon.com';
  const STORE_KEY = 'maker_state_v1';

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const toastEl = $('toast');

  let presets = [];
  let active = 'T1';
  let photos = { before: null, after: null }; // ImageBitmap (리사이즈 완료본)
  let t2fmt = 'square';

  // ── 상태 저장/복원 (사진 제외)
  function saveState() {
    const s = {
      active, t2fmt,
      t1: {
        industry: $('f1industry').value, biz: $('f1biz').value, phone: $('f1phone').value,
        area: $('f1area').value, color: $('f1color').value, extra: $('f1extra').value,
        title: $('f1title').value, care: $('f1care').value, caution: $('f1caution').value, as: $('f1as').value
      },
      t2: { biz: $('f2biz').value, phone: $('f2phone').value }
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; }
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // ── 텍스트 유틸
  function wrap(text, maxWidth, font) {
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
  }
  function darken(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
    return `rgb(${r},${g},${b})`;
  }
  function idealTextOn(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return lum > 160 ? '#0F1013' : '#FFFFFF';
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ── 현재 프리셋/입력 수집
  function currentPreset() {
    return presets.find((p) => p.id === $('f1industry').value) || presets[0];
  }
  function t1Data() {
    const p = currentPreset();
    const custom = !!p.custom;
    const lines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);
    return {
      industry: p.label,
      title: (custom && $('f1title').value.trim()) || p.title,
      tone: p.tone,
      biz: $('f1biz').value.trim() || '상호명',
      phone: $('f1phone').value.trim() || '010-0000-0000',
      area: $('f1area').value.trim(),
      color: $('f1color').value,
      extra: $('f1extra').value.trim(),
      blocks: custom ? {
        care: lines($('f1care').value).length ? lines($('f1care').value) : p.blocks.care,
        caution: lines($('f1caution').value).length ? lines($('f1caution').value) : p.blocks.caution,
        as: lines($('f1as').value).length ? lines($('f1as').value) : p.blocks.as
      } : p.blocks
    };
  }

  // ── T1: 고객 안내문 1080×1527
  function renderT1() {
    const W = 1080, H = 1527;
    cv.width = W; cv.height = H;
    $('previewSize').textContent = '1080×1527';
    const d = t1Data();
    const M = 72; // 좌우 여백

    ctx.fillStyle = '#F7F7F8';
    ctx.fillRect(0, 0, W, H);

    // 헤더 밴드 (대표색)
    const grad = ctx.createLinearGradient(0, 0, W, 300);
    grad.addColorStop(0, d.color);
    grad.addColorStop(1, darken(d.color, 0.72));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, 300);
    const headTxt = idealTextOn(d.color);
    ctx.fillStyle = headTxt;
    ctx.globalAlpha = 0.82;
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(d.industry + (d.area ? ' · ' + d.area : ''), M, 108);
    ctx.globalAlpha = 1;
    ctx.font = `800 64px ${FONT}`;
    const titleLines = wrap(d.title, W - M * 2, `800 64px ${FONT}`);
    titleLines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, M, 192 + i * 78));

    // 본문 블록
    const sections = [
      ['관리 요령', d.blocks.care],
      ['주의사항', d.blocks.caution],
      ['A/S 안내', d.blocks.as]
    ];
    let y = 300 + 84;
    for (const [head, items] of sections) {
      ctx.fillStyle = d.color;
      roundRect(M, y - 34, 10, 42, 5); ctx.fill();
      ctx.fillStyle = '#0F1013';
      ctx.font = `800 40px ${FONT}`;
      ctx.fillText(head, M + 30, y);
      y += 58;
      ctx.font = `500 32px ${FONT}`;
      for (const item of items.slice(0, 4)) {
        const lines = wrap(item, W - M * 2 - 44, `500 32px ${FONT}`);
        ctx.fillStyle = '#63676F';
        ctx.fillText('•', M + 6, y);
        lines.forEach((ln) => {
          ctx.fillText(ln, M + 44, y);
          y += 46;
        });
        y += 6;
      }
      y += 40;
    }

    // 추가 한 줄 / 톤
    const note = d.extra || d.tone;
    if (note) {
      ctx.fillStyle = '#FFFFFF';
      roundRect(M, y - 46, W - M * 2, 92, 18); ctx.fill();
      ctx.strokeStyle = '#E8E8EC'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#0F1013';
      ctx.font = `700 32px ${FONT}`;
      const nl = wrap(note, W - M * 2 - 60, `700 32px ${FONT}`)[0];
      ctx.textAlign = 'center';
      ctx.fillText(nl, W / 2, y + 12);
      ctx.textAlign = 'left';
    }

    // 푸터 (연락처 블록)
    const FY = H - 210;
    ctx.fillStyle = '#0F1013';
    ctx.fillRect(0, FY, W, 150);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 44px ${FONT}`;
    ctx.fillText(d.biz, M, FY + 66);
    ctx.font = `700 36px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(d.phone, W - M, FY + 66);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.65;
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText('문의·예약 언제든 환영합니다', M, FY + 116);
    ctx.globalAlpha = 1;

    // 워터마크
    ctx.fillStyle = '#6E737C';
    ctx.font = `600 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(WATERMARK, W / 2, H - 24);
    ctx.textAlign = 'left';
  }

  // ── T2: 전후 비교 1080×1080 / 1080×1350
  function coverDraw(img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  function photoPlaceholder(x, y, w, h, label) {
    ctx.fillStyle = '#ECEDEF';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#A3A7AE';
    ctx.font = `700 34px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(label + ' 사진을 선택하세요', x + w / 2, y + h / 2);
    ctx.textAlign = 'left';
  }
  function chip(x, y, label) {
    ctx.font = `800 30px ${FONT}`;
    const w = ctx.measureText(label).width + 44;
    ctx.fillStyle = 'rgba(15,16,19,.78)';
    roundRect(x, y, w, 58, 29); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 22, y + 40);
  }
  function renderT2() {
    const W = 1080, H = t2fmt === 'square' ? 1080 : 1350;
    cv.width = W; cv.height = H;
    $('previewSize').textContent = `1080×${H}`;
    const BAR = 170;
    const PH = H - BAR;

    ctx.fillStyle = '#F7F7F8';
    ctx.fillRect(0, 0, W, H);

    if (t2fmt === 'square') {
      // 좌/우 분할
      const half = W / 2;
      photos.before ? coverDraw(photos.before, 0, 0, half - 3, PH) : photoPlaceholder(0, 0, half - 3, PH, 'BEFORE');
      photos.after ? coverDraw(photos.after, half + 3, 0, half - 3, PH) : photoPlaceholder(half + 3, 0, half - 3, PH, 'AFTER');
      ctx.fillStyle = '#fff'; ctx.fillRect(half - 3, 0, 6, PH);
      chip(24, 24, 'BEFORE');
      chip(half + 27, 24, 'AFTER');
    } else {
      // 상/하 분할
      const half = PH / 2;
      photos.before ? coverDraw(photos.before, 0, 0, W, half - 3) : photoPlaceholder(0, 0, W, half - 3, 'BEFORE');
      photos.after ? coverDraw(photos.after, 0, half + 3, W, half - 3) : photoPlaceholder(0, half + 3, W, half - 3, 'AFTER');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, half - 3, W, 6);
      chip(24, 24, 'BEFORE');
      chip(24, half + 27, 'AFTER');
    }

    // 하단 바
    const biz = $('f2biz').value.trim() || '상호명';
    const phone = $('f2phone').value.trim() || '010-0000-0000';
    ctx.fillStyle = '#0F1013';
    ctx.fillRect(0, PH, W, BAR);
    ctx.fillStyle = '#fff';
    ctx.font = `800 42px ${FONT}`;
    ctx.fillText(biz, 60, PH + 74);
    ctx.font = `700 36px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(phone, W - 60, PH + 74);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.font = `600 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(WATERMARK, W / 2, PH + 128);
    ctx.textAlign = 'left';
  }

  // ── 렌더 스케줄 (폰트 로드 후 + 입력 디바운스)
  let fontReady = false;
  let pending = null;
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
  function render() {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      await ensureFonts();
      active === 'T1' ? renderT1() : renderT2();
      saveState();
    }, 60);
  }

  // ── 사진 리사이즈 (긴 변 1600px, 기기 내 처리)
  async function loadPhoto(file, slot) {
    if (!file) return;
    const bmp = await createImageBitmap(file);
    const MAXE = 1600;
    const s = Math.min(1, MAXE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const oc = new OffscreenCanvas(w, h);
    oc.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    photos[slot] = await createImageBitmap(oc);
    // 썸네일 표시
    const blob = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const url = URL.createObjectURL(blob);
    const drop = $(slot === 'before' ? 'dropBefore' : 'dropAfter');
    let img = drop.querySelector('img');
    if (!img) { img = document.createElement('img'); img.alt = ''; drop.appendChild(img); }
    img.src = url;
    $(slot === 'before' ? 'beforeHint' : 'afterHint').hidden = true;
    render();
  }

  // ── 내보내기
  function fileName() {
    const biz = (active === 'T1' ? $('f1biz').value : $('f2biz').value).trim() || '에인연';
    return `${biz}-${active === 'T1' ? '안내문' : '전후비교'}.png`;
  }
  async function exportBlob() {
    await ensureFonts();
    active === 'T1' ? renderT1() : renderT2();
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }
  async function doDownload() {
    const blob = await exportBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('PNG 저장 완료');
  }
  async function doShare() {
    const blob = await exportBlob();
    const file = new File([blob], fileName(), { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    await doDownload();
    toast('이 기기는 공유 미지원 — PNG로 저장했어요');
  }

  // ── 초기화
  async function init() {
    const res = await fetch('/maker/presets.json');
    presets = (await res.json()).presets;
    const sel = $('f1industry');
    sel.innerHTML = presets.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');

    const s = loadState();
    if (s) {
      active = s.active === 'T2' ? 'T2' : 'T1';
      t2fmt = s.t2fmt === 'portrait' ? 'portrait' : 'square';
      const t1 = s.t1 || {};
      if (t1.industry && presets.some((p) => p.id === t1.industry)) sel.value = t1.industry;
      $('f1biz').value = t1.biz || ''; $('f1phone').value = t1.phone || '';
      $('f1area').value = t1.area || ''; $('f1color').value = t1.color || '#4F8CFF';
      $('f1extra').value = t1.extra || ''; $('f1title').value = t1.title || '';
      $('f1care').value = t1.care || ''; $('f1caution').value = t1.caution || ''; $('f1as').value = t1.as || '';
      const t2 = s.t2 || {};
      $('f2biz').value = t2.biz || t1.biz || ''; $('f2phone').value = t2.phone || t1.phone || '';
    }

    function syncTab() {
      const t1 = active === 'T1';
      $('formT1').hidden = !t1; $('formT2').hidden = t1;
      $('tabT1').classList.toggle('on', t1); $('tabT2').classList.toggle('on', !t1);
      $('tabT1').setAttribute('aria-selected', t1); $('tabT2').setAttribute('aria-selected', !t1);
      $('customFields').hidden = !(t1 && currentPreset().custom);
      $('fmtSquare').classList.toggle('on', t2fmt === 'square');
      $('fmtPortrait').classList.toggle('on', t2fmt === 'portrait');
      render();
    }
    $('tabT1').addEventListener('click', () => { active = 'T1'; syncTab(); });
    $('tabT2').addEventListener('click', () => { active = 'T2'; syncTab(); });
    $('fmtSquare').addEventListener('click', () => { t2fmt = 'square'; syncTab(); });
    $('fmtPortrait').addEventListener('click', () => { t2fmt = 'portrait'; syncTab(); });

    document.querySelectorAll('#formT1 input, #formT1 select, #formT1 textarea, #formT2 input')
      .forEach((el) => el.addEventListener('input', () => {
        if (el.id === 'f1industry') $('customFields').hidden = !currentPreset().custom;
        render();
      }));
    document.querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
      $('f1color').value = b.dataset.c; render();
    }));
    $('fileBefore').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'before'));
    $('fileAfter').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'after'));
    $('btnSave').addEventListener('click', doDownload);
    $('btnShare').addEventListener('click', doShare);
    $('btnAccount').addEventListener('click', () => toast('로그인 저장은 곧 제공됩니다'));

    syncTab();
  }

  document.readyState === 'loading'
    ? addEventListener('DOMContentLoaded', init)
    : init();
})();
