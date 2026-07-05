// T1 고객 안내문 — 그라데이션 대표색·배경 밝기 슬라이더·크기 12종+직접 입력·탭 선택 조절
(function () {
  'use strict';
  const M = () => window.makerCore;
  const $ = (id) => document.getElementById(id);
  const STORE = 'maker_notice_v2';
  const STORE_V1 = 'maker_notice_v1';

  let fmtSel = { id: 'kakao', label: '카톡 세로', W: 1080, H: 1527 };
  let gray = 0;                 // 배경 밝기 0(흰)~100(검)
  let color = null;             // {mode,c1,c2,dir}
  let field = null;             // {id,label,custom?} | null (무선택 = 범용 문구)
  let sections = [];            // [{title, body}]
  let tone = '';                // 하단 인사 문구 (업종별)
  let adj = {};                 // 요소 조절값 {key:{size,gap,align}}
  let selKey = null;            // 미리보기에서 선택된 요소
  let regions = [];             // 렌더 시 기록되는 탭 영역 (논리 좌표)
  let copyData = null;
  let fieldSearchApi = null;
  let panel = null;

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
        fmtSel, gray, color, field, tone, adj, sections,
        biz: $('fBiz').value, phone: $('fPhone').value, area: $('fArea').value
      }));
    } catch (e) {}
  }
  function loadState() {
    try {
      const v2 = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (v2) return v2;
      const v1 = JSON.parse(localStorage.getItem(STORE_V1) || 'null');
      if (!v1) return null;
      // v2(구버전) 상태 이관: 다크 토글→배경 100, 단색 대표색 유지
      return {
        fmtSel: null, gray: v1.style === 'dark' ? 100 : 0,
        color: v1.color ? { mode: 'solid', c1: v1.color, c2: '#8E2F56', dir: 'd' } : null,
        field: v1.field || null, sections: v1.sections || [],
        biz: v1.biz, phone: v1.phone, area: v1.area
      };
    } catch (e) { return null; }
  }

  // ── 섹션 편집기
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function renderSectionEditor() {
    const root = $('sections');
    root.innerHTML = '';
    sections.forEach((sec, i) => {
      const card = document.createElement('div');
      card.className = 'sec-card';
      card.innerHTML =
        '<div class="sec-head-row">'
        + '<input type="text" value="' + esc(sec.title) + '" maxlength="12" aria-label="내용 제목">'
        + '<button type="button" class="sec-btn" data-up' + (i === 0 ? ' disabled' : '') + '>위로</button>'
        + '<button type="button" class="sec-btn" data-down' + (i === sections.length - 1 ? ' disabled' : '') + '>아래로</button>'
        + '<button type="button" class="sec-btn del" data-del>삭제</button>'
        + '</div>'
        + '<textarea placeholder="한 줄에 한 항목씩 입력" aria-label="내용"></textarea>';
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
        if (sections.length <= 1) { toast('내용 칸은 1개 이상 필요합니다'); return; }
        sections.splice(i, 1);
        renderSectionEditor(); render();
      });
      root.appendChild(card);
    });
  }

  function fillFromCopy(fieldId) {
    const c = copyData.copy[fieldId] || copyData.copy.generic;
    tone = c.tone || '';
    sections = c.sections.map((s) => ({ title: s.title, body: (s.lines || []).join('\n') }));
    renderSectionEditor();
  }

  // ── 캔버스 렌더 (논리폭 1080 → 규격 스케일, forExport=선택 테두리 생략)
  function renderCanvas(forExport) {
    const F = fmtSel;
    cv.width = F.W; cv.height = F.H;
    $('previewSize').textContent = F.W + '×' + F.H;
    const S = F.W / 1080;
    const LH = Math.round(F.H / S);
    ctx.setTransform(S, 0, 0, S, 0, 0);

    const C = M();
    const T = C.TOKENS;
    const st = C.grayStyle(gray);
    const u = C.makeCtxUtils(ctx);
    const FONT = C.FONT;
    const biz = $('fBiz').value.trim() || '에어컨 인테리어 연구소';
    const phone = $('fPhone').value.trim() || '010-0000-0000';
    const area = $('fArea').value.trim();
    const MG = T.margin;
    const tight = LH <= 760;
    const compact = LH <= 1200;
    regions = [];

    const A = (k) => adj[k];
    const drawText = (txt, x, y, align) => {
      if (align === 'center') { ctx.textAlign = 'center'; ctx.fillText(txt, 540, y); ctx.textAlign = 'left'; }
      else ctx.fillText(txt, x, y);
    };

    // 지면
    ctx.fillStyle = st.page;
    ctx.fillRect(0, 0, 1080, LH);

    // 좌측 대표색 액센트 바 (세로 흐름 고정)
    const bar = ctx.createLinearGradient(0, 0, 0, LH);
    if (color.mode === 'grad') { bar.addColorStop(0, color.c1); bar.addColorStop(1, color.c2); }
    else { bar.addColorStop(0, color.c1); bar.addColorStop(1, C.darken(color.c1, 0.72)); }
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, 18, LH);

    // 키커 (업종)
    let y = tight ? 76 : compact ? 96 : 130;
    if (field) {
      ctx.fillStyle = st.mute;
      ctx.font = `700 27px ${FONT}`;
      ctx.fillText(field.label, MG, y);
      y += tight ? 44 : 54;
    } else {
      y += tight ? 0 : 10;
    }

    // 문서 제목
    const aT = A('title');
    const titleSize = C.adjSize(tight ? 46 : compact ? 56 : 64, aT);
    y = y + C.adjGap(0, aT) + (compact ? 0 : 10);
    ctx.fillStyle = st.ink;
    ctx.font = `800 ${titleSize}px ${FONT}`;
    const title = field ? (field.custom ? field.label + ' 안내' : field.label + ' 관리 안내') : '고객 안내 말씀';
    const tTop = y - titleSize * 0.2;
    u.wrap(title, 1080 - MG * 2, ctx.font).slice(0, 2).forEach((ln) => {
      drawText(ln, MG, y + titleSize * 0.82, aT && aT.align);
      y += titleSize * 1.22;
    });
    y += titleSize * 0.1;
    regions.push({ key: 'title', label: '문서 제목', x: MG, y: tTop, w: 1080 - MG * 2, h: y - tTop, align: true });

    // 상호·연락처·지역 줄
    const aS = A('subline');
    const subSize = C.adjSize(27, aS);
    y += C.adjGap(tight ? 10 : 18, aS);
    ctx.fillStyle = st.mute;
    ctx.font = `600 ${subSize}px ${FONT}`;
    const subTxt = [biz, phone, area].filter(Boolean).join('  ·  ');
    drawText(subTxt, MG, y + subSize, aS && aS.align);
    regions.push({ key: 'subline', label: '상호·연락처 줄', x: MG, y, w: 1080 - MG * 2, h: subSize * 1.5, align: true });
    y += subSize * 1.5;

    // 헤어라인
    y += tight ? 18 : 26;
    ctx.fillStyle = st.rule;
    ctx.fillRect(MG, y, 1080 - MG * 2, 2);
    y += tight ? 34 : compact ? 44 : 60;

    // 푸터 위치 먼저 계산 (본문 공간 보호)
    const aF = A('footer');
    const FH = tight ? 118 : 150;
    const footBase = tight ? 58 : compact ? 64 : 84;
    const FY = LH - FH - C.adjGap(footBase, aF);

    // 내용 섹션들 (칩 + 본문)
    sections.forEach((sec, i) => {
      if (y > FY - 90) return;
      const aSec = A('sec' + i);
      const bodySize = C.adjSize(tight ? 26 : compact ? 28 : 31, aSec);
      const chipSize = C.adjSize(tight ? 21 : compact ? 22 : 24, aSec);
      const maxLines = tight ? 1 : compact ? 2 : 4;
      const secTop = y - chipSize - 8;
      y += C.adjGap(0, aSec);
      const chip = T.chips[i % T.chips.length];
      ctx.font = `800 ${chipSize}px ${FONT}`;
      const tw = ctx.measureText(sec.title).width;
      ctx.fillStyle = st.darkText ? chip.bg
        : chip.bg.replace('.10', '.2').replace('.14', '.22').replace('.12', '.2').replace('.15', '.22');
      u.roundRect(MG, y - chipSize - 8, tw + 36, chipSize + 20, (chipSize + 20) / 2);
      ctx.fill();
      ctx.fillStyle = st.darkText ? chip.text : '#EAECEF';
      ctx.fillText(sec.title, MG + 18, y);
      y += C.adjGap(T.chipToBody, aSec) + chipSize * 0.4;

      ctx.font = `500 ${bodySize}px ${FONT}`;
      const items = sec.body.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, maxLines);
      for (const item of items) {
        if (y > FY - 40) break;
        const lns = u.wrap(item, 1080 - MG * 2 - 44, ctx.font);
        ctx.fillStyle = st.mute;
        ctx.fillText('·', MG + 4, y);
        ctx.fillStyle = st.body;
        lns.forEach((ln) => { ctx.fillText(ln, MG + 44, y); y += bodySize * T.lineHeight; });
        y += 4;
      }
      if (!items.length) y += bodySize;
      regions.push({ key: 'sec' + i, label: '내용: ' + (sec.title || (i + 1) + '번째'), x: MG, y: secTop, w: 1080 - MG * 2, h: y - secTop, align: false });
      y += tight ? 26 : compact ? 34 : T.sectionGap - 18;
    });

    // 하단 상호 영역
    if (st.footer === 'accent') {
      ctx.fillStyle = C.accentPaint(ctx, color, MG, FY, 1080 - MG, FY + FH);
    } else {
      ctx.fillStyle = '#0F1013';
    }
    u.roundRect(MG, FY, 1080 - MG * 2, FH, T.radius);
    ctx.fill();
    const footTxt = st.footer === 'accent' ? C.idealTextOn(color) : '#FFFFFF';
    const bizSize = C.adjSize(38, aF);              // v3: 상호명 1단계 축소 (42→38)
    const phoneSize = C.adjSize(34, aF);
    ctx.fillStyle = footTxt;
    ctx.font = `800 ${bizSize}px ${FONT}`;
    ctx.fillText(biz, MG + 44, FY + (tight ? 54 : 66));
    ctx.font = `700 ${phoneSize}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(phone, 1080 - MG - 44, FY + (tight ? 54 : 66));
    ctx.textAlign = 'left';
    if (!tight) {
      ctx.globalAlpha = 0.66;
      ctx.font = `500 ${C.adjSize(24, aF)}px ${FONT}`;
      ctx.fillText(tone || '문의 언제든 환영합니다', MG + 44, FY + 112);
      ctx.globalAlpha = 1;
    }
    regions.push({ key: 'footer', label: '하단 상호 영역', x: MG, y: FY, w: 1080 - MG * 2, h: FH, align: false });

    // 워터마크
    ctx.fillStyle = st.wm;
    ctx.font = `500 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(T.watermark, 540, LH - 26);
    ctx.textAlign = 'left';

    // 선택 표시 (내보내기 제외)
    if (!forExport && selKey) {
      const r = regions.find((x) => x.key === selKey);
      if (r) {
        ctx.strokeStyle = '#4F8CFF';
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 8]);
        u.roundRect(r.x - 14, r.y - 10, r.w + 28, r.h + 20, 14);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
  window.__noticeRender = render; // 테스트 훅

  function fileName() {
    return ($('fBiz').value.trim() || '에인연') + '-안내문-' + fmtSel.W + 'x' + fmtSel.H + '.png';
  }

  // ── 초기화
  async function init() {
    const C = M();
    ctx.fillStyle = '#FBFBFC';           // 데이터 로드 전 즉시 첫 페인트
    ctx.fillRect(0, 0, cv.width, cv.height);
    copyData = await C.loadJson('/maker/copy.json');
    const fmtData = await C.loadJson('/maker/formats.json');

    const s = loadState() || {};
    gray = typeof s.gray === 'number' ? s.gray : 0;
    color = s.color || Object.assign({}, C.DEFAULT_COLOR);
    field = s.field || null;
    tone = s.tone || '';
    adj = s.adj || {};
    sections = Array.isArray(s.sections) && s.sections.length ? s.sections : [];
    if (s.biz) $('fBiz').value = s.biz;
    if (s.phone) $('fPhone').value = s.phone;
    if (s.area) $('fArea').value = s.area;
    if (s.fmtSel && s.fmtSel.W) fmtSel = s.fmtSel;

    if (!sections.length) fillFromCopy(field ? (field.custom ? 'generic' : field.id) : 'generic');
    else renderSectionEditor();

    // 업종 검색 (v3: 디폴트 무선택 — 범용 문구로 시작)
    fieldSearchApi = await C.mountFieldSearch($('fieldSearch'), {
      onSelect(item) {
        field = item;
        const hasContent = sections.some((x) => x.body.trim());
        if (!hasContent || confirm('선택한 업종의 기본 문구로 내용을 새로 채울까요? (지금 내용은 사라집니다)')) {
          fillFromCopy(item.custom ? 'generic' : item.id);
        }
        render();
      }
    });
    if (field) fieldSearchApi.set(field);

    // 대표색 (단색/그라데이션)
    C.mountColorControl($('colorCtl'), color, (v) => { color = v; render(); });
    // 배경 밝기
    C.mountGraySlider($('grayCtl'), gray, (v) => { gray = v; render(); });
    // 크기
    const fmtApi = C.mountFormatSelect($('fmtCtl'), fmtData, fmtSel, (v) => { fmtSel = v; render(); });
    fmtSel = fmtApi.get();

    // 탭 선택 조절
    panel = C.mountAdjustPanel($('adjustPanel'), {
      read: (k) => adj[k],
      write: (k, v) => { if (v) adj[k] = v; else delete adj[k]; render(); },
      resetAll: () => { adj = {}; render(); },
      onHide: () => { selKey = null; render(); }
    });
    cv.addEventListener('click', (e) => {
      const rect = cv.getBoundingClientRect();
      const S = cv.width / 1080;
      const x = (e.clientX - rect.left) * (cv.width / rect.width) / S;
      const yy = (e.clientY - rect.top) * (cv.height / rect.height) / S;
      const hit = [...regions].reverse().find((r) => x >= r.x - 14 && x <= r.x + r.w + 14 && yy >= r.y - 10 && yy <= r.y + r.h + 10);
      if (hit) { selKey = hit.key; panel.show(hit.key, { label: hit.label, align: hit.align }); }
      else { selKey = null; panel.hide(); }
      render();
    });

    // 기본 입력
    ['fBiz', 'fPhone', 'fArea'].forEach((id) => $(id).addEventListener('input', render));
    $('secAdd').addEventListener('click', () => {
      sections.push({ title: '새 내용', body: '' });
      renderSectionEditor(); render();
    });

    $('btnSave').addEventListener('click', () => M().download(cv, fileName(), () => renderCanvas(true), toast));
    $('btnShare').addEventListener('click', () => M().share(cv, fileName(), () => renderCanvas(true), toast));

    C.showGuideOnce('maker_guide_notice_v1', [
      '업종을 검색해 고르면 기본 문구가 채워져요',
      '제목과 내용을 자유롭게 고치세요 — 미리보기의 글자를 누르면 크기·간격도 바뀌어요',
      '다 되면 이미지로 저장하거나 카톡으로 보내세요'
    ]);

    render();
  }

  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', init) : init();
})();
