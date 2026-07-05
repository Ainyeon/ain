// T1 고객 안내문 — 승인 무드보드(클리닉 미니멀 + 다크 프리미엄 토글) 캔버스 렌더
(function () {
  'use strict';
  const M = () => window.makerCore;
  const $ = (id) => document.getElementById(id);
  const STORE = 'maker_notice_v1';

  let formats = [];        // 이 도구용 규격
  let fmt = 'kakao';
  let style = 'white';
  let field = null;        // {id,label,custom?}
  let sections = [];       // [{title, body}]
  let copyData = null;
  let fieldSearchApi = null;

  const cv = $('cv');
  const ctx = cv.getContext('2d');

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ── 상태
  function saveState() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        fmt, style, field,
        biz: $('fBiz').value, phone: $('fPhone').value, area: $('fArea').value, color: $('fColor').value,
        sections
      }));
    } catch (e) {}
  }
  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }

  // ── 섹션 편집기 (제목 인라인 수정·추가·삭제·순서 이동 → 전부 실시간 반영)
  function renderSectionEditor() {
    const root = $('sections');
    root.innerHTML = '';
    sections.forEach((sec, i) => {
      const card = document.createElement('div');
      card.className = 'sec-card';
      card.innerHTML =
        '<div class="sec-head-row">'
        + '<input type="text" value="' + escT(sec.title) + '" maxlength="12" aria-label="섹션 제목">'
        + '<button type="button" class="sec-btn" data-up aria-label="위로"' + (i === 0 ? ' disabled' : '') + '>↑</button>'
        + '<button type="button" class="sec-btn" data-down aria-label="아래로"' + (i === sections.length - 1 ? ' disabled' : '') + '>↓</button>'
        + '<button type="button" class="sec-btn del" data-del aria-label="섹션 삭제">✕</button>'
        + '</div>'
        + '<textarea placeholder="한 줄에 한 항목씩 입력" aria-label="섹션 내용"></textarea>';
      card.querySelector('textarea').value = sec.body;
      card.querySelector('input').addEventListener('input', (e) => { sec.title = e.target.value; render(); });
      card.querySelector('textarea').addEventListener('input', (e) => { sec.body = e.target.value; render(); });
      card.querySelector('[data-up]').addEventListener('click', () => {
        [sections[i - 1], sections[i]] = [sections[i], sections[i - 1]];
        renderSectionEditor(); render();
      });
      card.querySelector('[data-down]').addEventListener('click', () => {
        [sections[i + 1], sections[i]] = [sections[i], sections[i + 1]];
        renderSectionEditor(); render();
      });
      card.querySelector('[data-del]').addEventListener('click', () => {
        if (sections.length <= 1) { toast('섹션은 1개 이상 필요합니다'); return; }
        sections.splice(i, 1);
        renderSectionEditor(); render();
      });
      root.appendChild(card);
    });
  }

  function fillFromCopy(fieldId) {
    const c = copyData.copy[fieldId];
    const src = c || { sections: copyData.default_sections.map((t) => ({ title: t, lines: [] })) };
    sections = src.sections.map((s) => ({ title: s.title, body: (s.lines || []).join('\n') }));
    renderSectionEditor();
  }

  function isDirty() {
    // 현재 섹션이 마지막 자동 채움과 다른가 (업종 전환 시 덮어쓰기 확인용)
    return sections.some((s) => s.body.trim() && !Object.values(copyData.copy).some((c) =>
      c.sections.some((cs) => (cs.lines || []).join('\n') === s.body)));
  }

  // ── 캔버스 렌더 (논리폭 1080 → 규격 스케일)
  function renderCanvas() {
    const F = formats.find((f) => f.id === fmt) || formats[0];
    cv.width = F.W; cv.height = F.H;
    $('previewSize').textContent = F.W + '×' + F.H;
    const S = F.W / 1080;
    const LH = Math.round(F.H / S);
    ctx.setTransform(S, 0, 0, S, 0, 0);

    const T = M().TOKENS;
    const st = T.styles[style];
    const u = M().makeCtxUtils(ctx);
    const FONT = M().FONT;
    const color = $('fColor').value;
    const biz = $('fBiz').value.trim() || '에어컨 인테리어 연구소';
    const phone = $('fPhone').value.trim() || '010-0000-0000';
    const area = $('fArea').value.trim();
    const fieldLabel = field ? field.label : '업종 선택';
    const MG = T.margin;
    const compact = LH <= 1200;

    // 지면
    ctx.fillStyle = st.page;
    ctx.fillRect(0, 0, 1080, LH);

    // 좌측 대표색 액센트 바
    const grad = ctx.createLinearGradient(0, 0, 0, LH);
    grad.addColorStop(0, color);
    grad.addColorStop(1, M().darken(color, 0.72));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 18, LH);

    // 키커 (업종 · 지역)
    let y = compact ? 96 : 130;
    ctx.fillStyle = st.mute;
    ctx.font = `700 27px ${FONT}`;
    ctx.fillText((fieldLabel + (area ? '  ·  ' + area : '')).toUpperCase(), MG, y);

    // 제목
    y += compact ? 54 : 64;
    ctx.fillStyle = st.ink;
    const titleSize = compact ? 56 : 64;
    ctx.font = `800 ${titleSize}px ${FONT}`;
    const title = (field && field.custom ? fieldLabel + ' ' : '') + '시공 후 관리 안내';
    u.wrap(field && !field.custom ? fieldLabel + ' 시공 후 안내' : title, 1080 - MG * 2, ctx.font)
      .slice(0, 2).forEach((ln) => { ctx.fillText(ln, MG, y); y += titleSize * 1.22; });

    // 헤어라인
    y += compact ? 6 : 14;
    ctx.fillStyle = st.rule;
    ctx.fillRect(MG, y, 1080 - MG * 2, 2);
    y += compact ? 44 : 60;

    // 섹션들 (칩 + 본문)
    const bodySize = compact ? 28 : 31;
    const chipSize = compact ? 22 : 24;
    const maxLines = compact ? 2 : 4;
    for (const sec of sections) {
      if (y > LH - 300) break; // 푸터 공간 보호
      const chip = T.chips[sections.indexOf(sec) % T.chips.length];
      // 라벨칩
      ctx.font = `800 ${chipSize}px ${FONT}`;
      const tw = ctx.measureText(sec.title).width;
      ctx.fillStyle = style === 'dark' ? chip.bg.replace('.10', '.18').replace('.14', '.2').replace('.12', '.18').replace('.15', '.2') : chip.bg;
      u.roundRect(MG, y - chipSize - 8, tw + 36, chipSize + 20, (chipSize + 20) / 2);
      ctx.fill();
      ctx.fillStyle = style === 'dark' ? '#EAECEF' : chip.text;
      ctx.fillText(sec.title, MG + 18, y);
      y += T.chipToBody + chipSize * 0.4;

      // 본문 (한 줄 = 한 항목)
      ctx.font = `500 ${bodySize}px ${FONT}`;
      const items = sec.body.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, maxLines);
      for (const item of items) {
        const lns = u.wrap(item, 1080 - MG * 2 - 44, ctx.font);
        ctx.fillStyle = st.mute;
        ctx.fillText('·', MG + 4, y);
        ctx.fillStyle = st.body;
        lns.forEach((ln) => { ctx.fillText(ln, MG + 44, y); y += bodySize * M().TOKENS.lineHeight; });
        y += 4;
      }
      if (!items.length) y += bodySize;
      y += compact ? 34 : T.sectionGap - 18;
    }

    // 푸터 박스
    const FH = 150;
    const FY = LH - FH - (compact ? 64 : 84);
    if (st.footer === 'accent') {
      const fg = ctx.createLinearGradient(MG, FY, 1080 - MG, FY + FH);
      fg.addColorStop(0, color); fg.addColorStop(1, M().darken(color, 0.7));
      ctx.fillStyle = fg;
    } else {
      ctx.fillStyle = '#0F1013';
    }
    u.roundRect(MG, FY, 1080 - MG * 2, FH, M().TOKENS.radius);
    ctx.fill();
    const footTxt = st.footer === 'accent' ? M().idealTextOn(color) : '#FFFFFF';
    ctx.fillStyle = footTxt;
    ctx.font = `800 42px ${FONT}`;
    ctx.fillText(biz, MG + 44, FY + 66);
    ctx.font = `700 34px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(phone, 1080 - MG - 44, FY + 66);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.66;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText('문의·예약 언제든 환영합니다', MG + 44, FY + 112);
    ctx.globalAlpha = 1;

    // 워터마크
    ctx.fillStyle = st.wm;
    ctx.font = `500 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(M().TOKENS.watermark, 540, LH - 26);
    ctx.textAlign = 'left';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // 실시간 미리보기 — 100ms 디바운스
  let pending = null;
  function render() {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      await M().ensureFonts();
      renderCanvas();
      saveState();
    }, 100);
  }
  window.__noticeRender = render; // 테스트 훅

  function fileName() {
    return ($('fBiz').value.trim() || '에인연') + '-안내문-' + fmt + '.png';
  }

  // ── 초기화
  async function init() {
    copyData = await M().loadJson('/maker/copy.json');
    formats = await M().loadFormats('notice');

    const s = loadState();
    if (s) {
      fmt = formats.some((f) => f.id === s.fmt) ? s.fmt : 'kakao';
      style = s.style === 'dark' ? 'dark' : 'white';
      field = s.field || null;
      sections = Array.isArray(s.sections) && s.sections.length ? s.sections : [];
      $('fBiz').value = s.biz || ''; $('fPhone').value = s.phone || '';
      $('fArea').value = s.area || ''; $('fColor').value = s.color || '#4F8CFF';
    }
    $('fHex').value = $('fColor').value.toUpperCase();
    if (!field) field = { id: 'ac-install', label: '에어컨 설치' }; // 첫 방문 기본 업종
    if (!sections.length) fillFromCopy(field.id);
    else renderSectionEditor();

    // 업종 검색
    fieldSearchApi = await M().mountFieldSearch($('fieldSearch'), {
      onSelect(item) {
        field = item;
        const hasContent = sections.some((x) => x.body.trim());
        if (!hasContent || confirm('선택한 업종의 기본 문구로 섹션을 새로 채울까요? (지금 내용은 사라집니다)')) {
          fillFromCopy(item.custom ? 'custom' : item.id);
        }
        render();
      }
    });
    if (field) fieldSearchApi.set(field);

    // 규격 토글
    function renderFmtToggle() {
      $('fmtToggle').innerHTML = formats.map((f) =>
        '<button type="button" data-fmt="' + f.id + '" class="' + (fmt === f.id ? 'on' : '') + '">'
        + f.label + ' ' + f.W + '×' + f.H + '</button>').join('');
      $('fmtToggle').querySelectorAll('[data-fmt]').forEach((b) =>
        b.addEventListener('click', () => { fmt = b.dataset.fmt; renderFmtToggle(); render(); }));
    }
    renderFmtToggle();

    // 스타일 토글
    $('styleToggle').querySelectorAll('[data-style]').forEach((b) =>
      b.addEventListener('click', () => {
        style = b.dataset.style;
        $('styleToggle').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        render();
      }));
    if (style === 'dark') {
      $('styleToggle').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.style === 'dark'));
    }

    // 기본 입력 → 실시간
    ['fBiz', 'fPhone', 'fArea'].forEach((id) => $(id).addEventListener('input', render));
    $('fColor').addEventListener('input', () => { $('fHex').value = $('fColor').value.toUpperCase(); render(); });
    $('fHex').addEventListener('input', () => {
      const v = $('fHex').value.trim().replace(/^([0-9a-fA-F]{6})$/, '#$1');
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { $('fColor').value = v; render(); }
    });
    $('secAdd').addEventListener('click', () => {
      sections.push({ title: '새 섹션', body: '' });
      renderSectionEditor(); render();
    });

    $('btnSave').addEventListener('click', () => M().download(cv, fileName(), renderCanvas, toast));
    $('btnShare').addEventListener('click', () => M().share(cv, fileName(), renderCanvas, toast));

    render();
  }

  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', init) : init();
})();
