// 에인연 업무 — 견적서·작업 보고서 이미지 (캔버스 1080px). 카톡 공유·저장·인쇄(PDF).
// 캔버스 유틸·폰트 준비는 maker-core를 읽기만 재사용한다(메이커 사용량 집계는 부르지 않는다).
(function () {
  'use strict';
  const L = window.ainWorkLogic;
  const W = 1080, M = 72;

  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function colors() {
    return { ink: tok('--c-ink'), sub: tok('--c-ink-sub'), faint: tok('--c-ink-faint'), line: tok('--c-line'),
      lineStrong: tok('--c-line-strong'), accent: tok('--c-accent'), accentBg: tok('--c-accent-bg'), paper: tok('--c-surface'), soft: tok('--c-surface-sub') };
  }

  // 사진 → ImageBitmap. 서명 URL은 fetch→blob으로 받아 캔버스를 오염시키지 않는다.
  // data:·blob: 주소는 <img>로 읽는다(CSP img-src 허용, connect-src 밖). 서명 URL(https)만 fetch.
  async function fromImg(url) {
    const img = new Image();
    img.src = url;
    await img.decode();
    return createImageBitmap(img);
  }
  async function toBitmap(src) {
    if (src instanceof Blob) return createImageBitmap(src);
    if (/^(data|blob):/.test(src)) return fromImg(src);
    const res = await fetch(src);
    return createImageBitmap(await res.blob());
  }
  async function loadImage(dataUrl) {
    if (!dataUrl) return null;
    try { return await fromImg(dataUrl); } catch (e) { return null; }
  }

  // kind: 'quote' | 'report'. d = { job, customer, biz, pro, photos: [Blob|url], fieldLabel }
  async function render(kind, d) {
    const MC = window.makerCore;
    await MC.ensureFonts();
    const F = MC.FONT;
    const C = colors();
    const bitmaps = kind === 'report' ? (await Promise.all((d.photos || []).slice(0, 12).map((p) => toBitmap(p).catch(() => null)))).filter(Boolean) : [];
    const logo = d.pro ? await loadImage(d.biz.logo_data) : null;
    const job = d.job, biz = d.biz || {}, cust = d.customer || {};
    const items = L.cleanItems(job.items);
    // 품목 없이 합계만 적은 작업은 저장된 합계를 쓴다
    const t = items.length ? L.totals(items, job.vat_mode) : { supply: L.toInt(job.total_amount), vat: 0, total: L.toInt(job.total_amount) };
    const checks = (job.checklist || []).filter((c) => c && c.value);
    const title = kind === 'quote' ? '견 적 서' : '작업 보고서';
    const when = kind === 'quote' ? new Date() : new Date(job.completed_at || job.scheduled_at || Date.now());

    function draw(ctx) {
      const U = MC.makeCtxUtils(ctx);
      let y = 0;
      const text = (s, x, yy, font, color, align) => { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.fillText(s, x, yy); };
      const rule = (yy, color, w) => { ctx.fillStyle = color; ctx.fillRect(M, yy, W - 2 * M, w || 2); };
      ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, ctx.canvas.height);
      ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, 12);
      y = 110;
      if (logo) { const s = Math.min(150 / logo.width, 90 / logo.height); ctx.drawImage(logo, W - M - logo.width * s, 44, logo.width * s, logo.height * s); }
      text(biz.biz_name || '업체명', M, y, `800 44px ${F}`, C.ink);
      y += 44;
      const bizLine = [biz.owner_name && '대표 ' + biz.owner_name, biz.phone && L.fmtPhone(biz.phone), biz.biz_no && '사업자 ' + biz.biz_no].filter(Boolean).join('  ·  ');
      if (bizLine) text(bizLine, M, y, `500 26px ${F}`, C.sub);
      y += 70;
      text(title, W / 2, y, `800 60px ${F}`, C.ink, 'center');
      y += 30;
      rule(y, C.ink, 3);
      y += 56;
      const kv = (k, v) => {
        if (!v) return;
        text(k, M, y, `600 26px ${F}`, C.faint);
        const lines = U.wrap(v, W - 2 * M - 170, `600 28px ${F}`).slice(0, 3);
        lines.forEach((ln, i) => text(ln, M + 170, y + i * 40, `600 28px ${F}`, C.ink));
        y += 40 * lines.length + 12;
      };
      kv('고객', (cust.name || '고객') + ' 님');
      kv('현장', job.address || cust.address || '');
      kv(kind === 'quote' ? '작성일' : '작업일', L.fmtDay(when));
      if (kind === 'quote' && job.scheduled_at && job.status !== 'done') kv('예정일', L.fmtDay(job.scheduled_at) + ' ' + L.fmtTime(job.scheduled_at, job.all_day));
      if (d.fieldLabel || job.work_type) kv('작업', [d.fieldLabel, L.WORK_TYPE_LABEL[job.work_type]].filter(Boolean).join(' · '));
      y += 20;

      // 품목 표
      const cx = [M, W - M - 520, W - M - 360, W - M];   // 품목 | 수량 | 단가 | 금액(오른쪽 끝)
      ctx.fillStyle = C.soft; ctx.fillRect(M, y - 38, W - 2 * M, 56);
      text('품목', cx[0] + 16, y, `700 25px ${F}`, C.sub);
      text('수량', cx[1] + 60, y, `700 25px ${F}`, C.sub, 'right');
      text('단가', cx[2] + 150, y, `700 25px ${F}`, C.sub, 'right');
      text('금액', cx[3] - 16, y, `700 25px ${F}`, C.sub, 'right');
      y += 30;
      rule(y, C.lineStrong, 2);
      y += 50;
      if (!items.length) { text('품목 없음', cx[0] + 16, y, `500 27px ${F}`, C.faint); y += 56; }
      items.forEach((it) => {
        const name = [it.name, it.model].filter(Boolean).join(' ');
        const lines = U.wrap(name, cx[1] - cx[0] - 80, `600 27px ${F}`).slice(0, 2);
        lines.forEach((ln, i) => text(ln, cx[0] + 16, y + i * 36, `600 27px ${F}`, it.price < 0 ? C.accent : C.ink));
        text(it.qty + (it.unit || ''), cx[1] + 60, y, `500 27px ${F}`, C.ink, 'right');
        text(it.price.toLocaleString('ko-KR'), cx[2] + 150, y, `500 27px ${F}`, C.ink, 'right');
        text((it.qty * it.price).toLocaleString('ko-KR'), cx[3] - 16, y, `700 27px ${F}`, it.price < 0 ? C.accent : C.ink, 'right');
        y += 36 * (lines.length - 1) + 22;
        rule(y, C.line, 1);
        y += 48;
      });
      // 합계
      y += 6;
      const sumRow = (k, v, big) => {
        text(k, W - M - 330, y, `${big ? 700 : 500} ${big ? 30 : 26}px ${F}`, big ? C.ink : C.sub);
        text(v, W - M - 16, y, `${big ? 800 : 600} ${big ? 40 : 27}px ${F}`, big ? C.accent : C.ink, 'right');
        y += big ? 64 : 44;
      };
      if (job.vat_mode !== 'none' && items.length) { sumRow('공급가액', L.won(t.supply)); sumRow('부가세', L.won(t.vat)); }
      sumRow(job.vat_mode === 'excl' ? '합계 (부가세 포함)' : job.vat_mode === 'incl' ? '합계 (부가세 포함)' : '합계', L.won(t.total), true);
      if (kind === 'report') {
        const p = L.paid(job);
        if (p > 0) sumRow('받은 금액', L.won(p));
        if (L.unpaid(job) > 0) sumRow('남은 금액', L.won(L.unpaid(job)));
      }
      y += 16;

      if (kind === 'report' && checks.length) {
        text('작업 확인', M, y, `800 30px ${F}`, C.ink); y += 20; rule(y, C.ink, 2); y += 46;
        checks.forEach((c) => {
          text(String(c.label).slice(0, 30), M + 16, y, `500 26px ${F}`, C.sub);
          text(String(c.value).slice(0, 40), W - M - 16, y, `700 27px ${F}`, C.ink, 'right');
          y += 18; rule(y, C.line, 1); y += 44;
        });
        y += 10;
      }
      if (kind === 'report' && bitmaps.length) {
        text('작업 사진', M, y, `800 30px ${F}`, C.ink); y += 20; rule(y, C.ink, 2); y += 24;
        const gw = (W - 2 * M - 24) / 2;
        for (let i = 0; i < bitmaps.length; i += 2) {
          const row = bitmaps.slice(i, i + 2);
          const h = Math.min(460, Math.max(...row.map((b) => gw * b.height / b.width)));
          row.forEach((b, k) => {
            const s = Math.min(gw / b.width, h / b.height);
            const bw = b.width * s, bh = b.height * s, x = M + k * (gw + 24);
            ctx.save(); U.roundRect(x, y, gw, h, 14); ctx.clip();
            ctx.fillStyle = C.soft; ctx.fillRect(x, y, gw, h);
            ctx.drawImage(b, x + (gw - bw) / 2, y + (h - bh) / 2, bw, bh);
            ctx.restore();
          });
          y += h + 24;
        }
        y += 10;
      }
      if (kind === 'report' && job.warranty_months > 0) {
        const until = L.addMonths(new Date(job.completed_at || job.scheduled_at || Date.now()), job.warranty_months);
        ctx.fillStyle = C.accentBg; U.roundRect(M, y - 6, W - 2 * M, 72, 14); ctx.fill();
        text('무상 AS 기간  ' + until.getFullYear() + '년 ' + L.fmtDay(until).replace(/ \(.\)$/, '') + '까지 (' + job.warranty_months + '개월)', M + 28, y + 40, `700 27px ${F}`, C.accent);
        y += 100;
      }
      const notes = [];
      if (kind === 'quote') notes.push(biz.quote_note || '이 견적은 작성일로부터 30일 동안 유효합니다. 현장 상황에 따라 금액이 달라질 수 있습니다.');
      if (biz.account) notes.push('입금 계좌  ' + biz.account);
      if (notes.length) {
        y += 6;
        notes.forEach((n) => {
          U.wrap(n, W - 2 * M, `500 25px ${F}`).slice(0, 6).forEach((ln) => { text(ln, M, y, `500 25px ${F}`, C.sub); y += 38; });
          y += 10;
        });
      }
      y += 40;
      if (!d.pro) {
        rule(y, C.line, 1); y += 44;
        text((biz.biz_name ? biz.biz_name + ' · ' : '') + '에인연 업무로 작성', W / 2, y, `500 22px ${F}`, C.faint, 'center');
        y += 30;
      }
      return y + 40;
    }

    const cv = document.createElement('canvas');
    cv.width = W; cv.height = 4000;
    const h = Math.ceil(draw(cv.getContext('2d')));
    cv.height = Math.max(900, h);
    draw(cv.getContext('2d'));
    return cv;
  }

  const toBlob = (cv) => new Promise((res) => cv.toBlob(res, 'image/png'));
  async function share(cv, name, toast) {
    const blob = await toBlob(cv);
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    download(blob, name);
    toast && toast('이 기기는 공유가 안 돼서 이미지로 저장했어요');
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // 인쇄(→ PDF로 저장): 이미지 한 장만 인쇄 영역에 두고 print
  async function print(cv) {
    const url = URL.createObjectURL(await toBlob(cv));
    let area = document.getElementById('printArea');
    if (!area) { area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
    area.replaceChildren();
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    area.appendChild(img);
    await img.decode().catch(() => {});
    window.print();
  }

  window.ainWorkDoc = { render, share, download, print, toBlob };
})();
