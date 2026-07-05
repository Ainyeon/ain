// 에인연 템플릿 메이커 — 규격별 고정 해상도 캔버스 렌더 (기기 무관 픽셀 동일)
// 사진은 클라이언트에서만 처리. 서버 전송 0건. 미리보기는 모든 입력에 즉시 반영(디바운스 60ms).
(function () {
  'use strict';

  const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';
  const WATERMARK = 'made with 에인연 · ainyeon.com';
  const STORE_KEY = 'maker_state_v2';

  // 규격 정의 — 논리 좌표는 폭 1080 기준, scale = W/1080 (A4도 동일 조판을 고해상도로)
  const FORMATS = {
    T1: {
      kakao:  { W: 1080, H: 1527, label: '1080×1527 · 카톡' },
      square: { W: 1080, H: 1080, label: '1080×1080 · 정방형' },
      a4:     { W: 2480, H: 3508, label: 'A4 · 인쇄용' },
      story:  { W: 1080, H: 1920, label: '1080×1920 · 스토리' }
    },
    T2: {
      square:   { W: 1080, H: 1080, label: '1080×1080 · 당근/피드' },
      portrait: { W: 1080, H: 1350, label: '1080×1350 · 인스타 세로' },
      story:    { W: 1080, H: 1920, label: '1080×1920 · 스토리/릴스' }
    }
  };

  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const toastEl = $('toast');

  let presets = [];
  let active = 'T1';
  let fmt = { T1: 'kakao', T2: 'square' };
  let photos = { before: null, mid: null, after: null };

  // ── 상태 저장/복원 (사진 제외)
  function saveState() {
    const s = {
      active, fmt,
      t1: {
        industry: $('f1industry').value, industryName: $('f1industryName').value,
        biz: $('f1biz').value, phone: $('f1phone').value,
        area: $('f1area').value, color: $('f1color').value, extra: $('f1extra').value,
        title: $('f1title').value, care: $('f1care').value, caution: $('f1caution').value, as: $('f1as').value
      },
      t2: { biz: $('f2biz').value, phone: $('f2phone').value }
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
          || JSON.parse(localStorage.getItem('maker_state_v1') || 'null'); // v1 마이그레이션
    } catch (e) { return null; }
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  // ── 유틸
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
    return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
  }
  // 어두운 대표색 → 밝은 텍스트 자동 반전 (가독성)
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

  // ── 프리셋/입력
  function currentPreset() {
    return presets.find((p) => p.id === $('f1industry').value) || presets[0];
  }
  function t1Data() {
    const p = currentPreset();
    const custom = !!p.custom;
    const customName = $('f1industryName').value.trim();
    const lines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);
    return {
      industry: custom && customName ? customName : p.label,
      title: (custom && $('f1title').value.trim())
        || (custom && customName ? customName + ' 시공 완료 안내' : p.title),
      tone: p.tone,
      biz: $('f1biz').value.trim() || '에어컨 인테리어 연구소',
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

  // ── T1: 고객 안내문 (논리폭 1080 조판 → 규격별 스케일)
  function renderT1() {
    const F = FORMATS.T1[fmt.T1];
    cv.width = F.W; cv.height = F.H;
    $('previewSize').textContent = F.W + '×' + F.H;
    const S = F.W / 1080;          // 물리 스케일 (A4=2.296)
    const LH = Math.round(F.H / S); // 논리 높이 (kakao/a4≈1527, square=1080, story=1920)
    ctx.setTransform(S, 0, 0, S, 0, 0);

    const d = t1Data();
    const M = 72;
    // 규격별 밀도: 정방형은 압축, 스토리는 여유
    const cfg = LH <= 1100 ? { cap: 2, head: 226, gap: 22, lead: 40 }
              : LH <= 1600 ? { cap: 4, head: 300, gap: 40, lead: 46 }
                           : { cap: 4, head: 380, gap: 64, lead: 50 };

    ctx.fillStyle = '#F7F7F8';
    ctx.fillRect(0, 0, 1080, LH);

    // 헤더 밴드 (대표색 — 어두우면 흰 텍스트 자동)
    const grad = ctx.createLinearGradient(0, 0, 1080, cfg.head);
    grad.addColorStop(0, d.color);
    grad.addColorStop(1, darken(d.color, 0.72));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, cfg.head);
    ctx.fillStyle = idealTextOn(d.color);
    ctx.globalAlpha = 0.82;
    ctx.font = `700 30px ${FONT}`;
    ctx.fillText(d.industry + (d.area ? ' · ' + d.area : ''), M, cfg.head * 0.36);
    ctx.globalAlpha = 1;
    ctx.font = `800 ${LH <= 1100 ? 54 : 64}px ${FONT}`;
    wrap(d.title, 1080 - M * 2, ctx.font).slice(0, 2)
      .forEach((ln, i) => ctx.fillText(ln, M, cfg.head * 0.64 + i * 74));

    // 본문 블록
    const sections = [
      ['관리 요령', d.blocks.care],
      ['주의사항', d.blocks.caution],
      ['A/S 안내', d.blocks.as]
    ];
    let y = cfg.head + 76;
    for (const [head, items] of sections) {
      ctx.fillStyle = d.color;
      roundRect(M, y - 32, 10, 40, 5); ctx.fill();
      ctx.fillStyle = '#0F1013';
      ctx.font = `800 ${LH <= 1100 ? 34 : 40}px ${FONT}`;
      ctx.fillText(head, M + 30, y);
      y += LH <= 1100 ? 50 : 58;
      ctx.font = `500 ${LH <= 1100 ? 28 : 32}px ${FONT}`;
      for (const item of items.slice(0, cfg.cap)) {
        const lns = wrap(item, 1080 - M * 2 - 44, ctx.font);
        ctx.fillStyle = '#63676F';
        ctx.fillText('•', M + 6, y);
        lns.forEach((ln) => { ctx.fillText(ln, M + 44, y); y += cfg.lead; });
        y += 6;
      }
      y += cfg.gap;
    }

    // 추가 한 줄 / 톤
    const note = d.extra || d.tone;
    if (note && LH - y > 300) {
      ctx.fillStyle = '#FFFFFF';
      roundRect(M, y - 44, 1080 - M * 2, 90, 18); ctx.fill();
      ctx.strokeStyle = '#E8E8EC'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#0F1013';
      ctx.font = `700 32px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(wrap(note, 1080 - M * 2 - 60, ctx.font)[0], 540, y + 12);
      ctx.textAlign = 'left';
    }

    // 푸터 + 워터마크
    const FY = LH - 200;
    ctx.fillStyle = '#0F1013';
    ctx.fillRect(0, FY, 1080, 144);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 44px ${FONT}`;
    ctx.fillText(d.biz, M, FY + 64);
    ctx.font = `700 36px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(d.phone, 1080 - M, FY + 64);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.65;
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText('문의·예약 언제든 환영합니다', M, FY + 112);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#6E737C';
    ctx.font = `600 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(WATERMARK, 540, LH - 22);
    ctx.textAlign = 'left';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ── T2: 전·중·후 비교 (중은 선택 — 2장이면 기존 배치, 3장이면 3분할)
  function coverDraw(img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  function slotDraw(img, x, y, w, h, label) {
    if (img) coverDraw(img, x, y, w, h);
    else {
      ctx.fillStyle = '#ECEDEF'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#A3A7AE';
      ctx.font = `700 30px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(label + ' 사진', x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
    }
    ctx.font = `800 28px ${FONT}`;
    const cw = ctx.measureText(label).width + 40;
    ctx.fillStyle = 'rgba(15,16,19,.78)';
    roundRect(x + 20, y + 20, cw, 54, 27); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 40, y + 57);
  }
  function renderT2() {
    const F = FORMATS.T2[fmt.T2];
    cv.width = F.W; cv.height = F.H;
    $('previewSize').textContent = F.W + '×' + F.H;
    const W = F.W, H = F.H;
    const BAR = 170;
    const PH = H - BAR;
    const three = !!photos.mid; // 시공중 사진이 있으면 3분할

    ctx.fillStyle = '#F7F7F8';
    ctx.fillRect(0, 0, W, H);

    const slots = three
      ? [[photos.before, '시공 전'], [photos.mid, '시공 중'], [photos.after, '시공 후']]
      : [[photos.before, '시공 전'], [photos.after, '시공 후']];
    const n = slots.length;
    const G = 6; // 슬롯 간격

    if (fmt.T2 === 'square' && !three) {
      // 2장 정방형: 좌/우 (기존 배치)
      const half = (W - G) / 2;
      slotDraw(slots[0][0], 0, 0, half, PH, slots[0][1]);
      slotDraw(slots[1][0], half + G, 0, half, PH, slots[1][1]);
    } else if (fmt.T2 === 'square') {
      // 3장 정방형: 세로 3열
      const w3 = (W - G * 2) / 3;
      slots.forEach(([img, lb], i) => slotDraw(img, i * (w3 + G), 0, w3, PH, lb));
    } else {
      // 세로형(1350/1920): 가로 행 분할 (2행 또는 3행)
      const hN = (PH - G * (n - 1)) / n;
      slots.forEach(([img, lb], i) => slotDraw(img, 0, i * (hN + G), W, hN, lb));
    }

    // 하단 바 + 워터마크
    const biz = $('f2biz').value.trim() || '에어컨 인테리어 연구소';
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

  // ── 렌더 스케줄 (폰트 로드 후 + 60ms 디바운스 — 실시간 미리보기)
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

  // ── 사진 리사이즈 (긴 변 1600px, 기기 내 처리 — 전송 없음)
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
    const blob = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const drop = $('drop' + slot[0].toUpperCase() + slot.slice(1));
    let img = drop.querySelector('img');
    if (!img) { img = document.createElement('img'); img.alt = ''; drop.appendChild(img); }
    img.src = URL.createObjectURL(blob);
    const hint = $(slot + 'Hint');
    if (hint) hint.hidden = true;
    render();
  }

  // ── 내보내기 / 공유
  function fileName() {
    const biz = (active === 'T1' ? $('f1biz').value : $('f2biz').value).trim() || '에인연';
    return `${biz}-${active === 'T1' ? '안내문' : '전후비교'}-${fmt[active]}.png`;
  }
  async function exportBlob() {
    await ensureFonts();
    active === 'T1' ? renderT1() : renderT2();
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }
  // 사용 카운터 (site_stats.maker_uses — 09 SQL 미실행이면 조용히 생략)
  async function loadUseCount() {
    try {
      const { data } = await ainAuth.getClient().from('site_stats').select('value').eq('key', 'maker_uses').maybeSingle();
      if (data && data.value != null) {
        const el = $('makerCount');
        el.textContent = '지금까지 ' + Number(data.value).toLocaleString('ko-KR') + '명이 템플릿을 만들어 갔어요';
        el.hidden = false;
      }
    } catch (e) {}
  }
  function bumpUseCount() {
    try {
      ainAuth.getClient().rpc('bump_stat', { p_key: 'maker_uses' }).then(({ data }) => {
        if (data != null) {
          const el = $('makerCount');
          el.textContent = '지금까지 ' + Number(data).toLocaleString('ko-KR') + '명이 템플릿을 만들어 갔어요';
          el.hidden = false;
        }
      }, () => {});
    } catch (e) {}
  }

  async function doDownload() {
    const blob = await exportBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('PNG 저장 완료');
    bumpUseCount();
  }
  async function doShare() {
    const blob = await exportBlob();
    const file = new File([blob], fileName(), { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); bumpUseCount(); return; }
      catch (e) { if (e.name === 'AbortError') return; }
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
      if (s.fmt) fmt = { T1: FORMATS.T1[s.fmt.T1] ? s.fmt.T1 : 'kakao', T2: FORMATS.T2[s.fmt.T2] ? s.fmt.T2 : 'square' };
      const t1 = s.t1 || {};
      if (t1.industry && presets.some((p) => p.id === t1.industry)) sel.value = t1.industry;
      $('f1industryName').value = t1.industryName || '';
      $('f1biz').value = t1.biz || ''; $('f1phone').value = t1.phone || '';
      $('f1area').value = t1.area || ''; $('f1color').value = t1.color || '#4F8CFF';
      $('f1extra').value = t1.extra || ''; $('f1title').value = t1.title || '';
      $('f1care').value = t1.care || ''; $('f1caution').value = t1.caution || ''; $('f1as').value = t1.as || '';
      const t2 = s.t2 || {};
      $('f2biz').value = t2.biz || t1.biz || ''; $('f2phone').value = t2.phone || t1.phone || '';
    }
    $('f1hex').value = $('f1color').value.toUpperCase();

    function fmtButtonsHtml(tpl) {
      return Object.entries(FORMATS[tpl]).map(([k, f]) =>
        `<button type="button" data-fmt="${k}" class="${fmt[tpl] === k ? 'on' : ''}">${f.label}</button>`).join('');
    }
    function syncUI() {
      const t1 = active === 'T1';
      $('formT1').hidden = !t1; $('formT2').hidden = t1;
      $('tabT1').classList.toggle('on', t1); $('tabT2').classList.toggle('on', !t1);
      $('tabT1').setAttribute('aria-selected', t1); $('tabT2').setAttribute('aria-selected', !t1);
      $('customFields').hidden = !(t1 && currentPreset().custom);
      $('fmtT1').innerHTML = fmtButtonsHtml('T1');
      $('fmtT2').innerHTML = fmtButtonsHtml('T2');
      document.querySelectorAll('#fmtT1 [data-fmt]').forEach((b) =>
        b.addEventListener('click', () => { fmt.T1 = b.dataset.fmt; syncUI(); }));
      document.querySelectorAll('#fmtT2 [data-fmt]').forEach((b) =>
        b.addEventListener('click', () => { fmt.T2 = b.dataset.fmt; syncUI(); }));
      render();
    }
    $('tabT1').addEventListener('click', () => { active = 'T1'; syncUI(); });
    $('tabT2').addEventListener('click', () => { active = 'T2'; syncUI(); });

    // 모든 입력 → 즉시 미리보기
    document.querySelectorAll('#formT1 input, #formT1 select, #formT1 textarea, #formT2 input')
      .forEach((el) => el.addEventListener('input', () => {
        if (el.id === 'f1industry') $('customFields').hidden = !currentPreset().custom;
        if (el.id === 'f1color') $('f1hex').value = el.value.toUpperCase();
        if (el.id === 'f1hex') {
          const v = el.value.trim().replace(/^([0-9a-fA-F]{6})$/, '#$1');
          if (/^#[0-9a-fA-F]{6}$/.test(v)) $('f1color').value = v;
        }
        render();
      }));

    $('fileBefore').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'before'));
    $('fileMid').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'mid'));
    $('fileAfter').addEventListener('change', (e) => loadPhoto(e.target.files[0], 'after'));
    $('btnSave').addEventListener('click', doDownload);
    $('btnShare').addEventListener('click', doShare);
    $('btnAccount').addEventListener('click', () => toast('로그인 저장은 곧 제공됩니다'));

    syncUI();
    loadUseCount();
  }

  document.readyState === 'loading'
    ? addEventListener('DOMContentLoaded', init)
    : init();
})();
