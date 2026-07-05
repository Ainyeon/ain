// 메이커 v2 공통 엔진 — 캔버스 유틸·규격·업종 검색·내보내기·카운터
// 승인된 무드보드 토큰(2026-07-05)이 이 파일의 TOKENS에 고정됨.
(function () {
  'use strict';

  const FONT = '"Pretendard Variable", Pretendard, -apple-system, "Apple SD Gothic Neo", sans-serif';

  // ── 승인 토큰 (무드보드 → 캔버스 이식)
  const TOKENS = {
    watermark: 'made with 에인연 · ainyeon.com',
    margin: 96,            // 1080 논리폭 기준 좌우 여백
    sectionGap: 72,        // 섹션 간
    chipToBody: 28,        // 칩 → 본문
    lineHeight: 1.75,
    radius: 20,
    // 라벨칩 팔레트 (섹션 인덱스 순환: 관리=파랑, 주의=주황, A/S=청록, 이후 보라)
    chips: [
      { text: '#2F63C7', bg: 'rgba(79,140,255,.10)' },
      { text: '#B4551E', bg: 'rgba(255,138,101,.14)' },
      { text: '#12766C', bg: 'rgba(53,197,184,.12)' },
      { text: '#6847C4', bg: 'rgba(167,139,250,.15)' }
    ],
    // 스타일 프리셋 2종
    styles: {
      white: { page: '#FBFBFC', ink: '#0F1013', body: '#4A4E55', mute: '#8A8F98', rule: '#ECEDEF', wm: '#B9BDC4', footer: 'ink' },
      dark:  { page: '#141519', ink: '#FFFFFF', body: '#B9BDC4', mute: '#787F8A', rule: '#26282E', wm: '#4A4E55', footer: 'accent' }
    }
  };

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
  function darken(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
  }
  function idealTextOn(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    return lum > 160 ? '#0F1013' : '#FFFFFF';
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
  async function loadFormats(tool) {
    const d = await loadJson('/maker/formats.json');
    return d.formats.filter((f) => f.tools.includes(tool));
  }

  // ── 업종 검색 컴포넌트 (검색형 자동완성 + 직접 입력)
  // mount(el, {onSelect(item)}) — item: {id,label,custom?} 또는 {id:'custom',label:입력값,custom:true}
  async function mountFieldSearch(rootEl, opts) {
    const data = await loadJson('/maker/fields.json');
    const flat = [];
    data.categories.forEach((cat) => cat.items.forEach((it) => {
      if (!it.custom) flat.push({ ...it, cat: cat.label });
    }));

    rootEl.classList.add('field-search');
    rootEl.innerHTML =
      '<input type="text" class="fs-input" placeholder="업종 검색 (예: 에어컨, 도배, 방수…)" autocomplete="off" '
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
        html += '<button type="button" class="fs-item" role="option" data-id="' + f.id + '">' + escT(f.label) + '</button>';
      });
      if (query) {
        html += '<button type="button" class="fs-item fs-custom" data-id="__custom">"'
          + escT(query) + '" 직접 입력으로 사용</button>';
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
    toast('PNG 저장 완료');
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
    toast('이 기기는 공유 미지원 — PNG로 저장했어요');
    bumpUseCount();
  }

  // ── 사진 리사이즈 (긴 변 1600, 무전송)
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
    FONT, TOKENS, makeCtxUtils, darken, idealTextOn, ensureFonts,
    loadJson, loadFormats, mountFieldSearch, download, share, bumpUseCount, resizePhoto
  };
})();
