#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// tools/qa-build/build.mjs — /qa 정적 아카이브 빌더
//
// Supabase v_qa_published(definer 뷰, published=true만)를 anon 키로 읽어
// /qa/ 전 페이지를 빌드 타임에 HTML로 생성한다. 클라이언트 fetch 없음 —
// 크롤러가 JS 실행 없이 HTML 소스에서 질문·답변 전문을 읽는다.
//
// 산출물:
//   {out}/qa/index.html                      카테고리 그룹 인덱스 (FAQPage JSON-LD)
//   {out}/qa/{slug}/index.html               개별 상세 (QAPage JSON-LD)
//   {out}/qa/error-code/{code}/index.html    에러코드 서브클러스터 (코드가 URL·h1에 노출)
//   {out}/qa/sitemap-qa.xml                  /qa 범위 사이트맵 — 루트 sitemap.xml(sitemap index,
//                                            수동 관리)이 참조한다. 이 빌드는 /qa 밖을 안 건드린다.
//
// 사용:
//   node tools/qa-build/build.mjs                          # Supabase에서 읽어 레포 루트에 생성
//   node tools/qa-build/build.mjs --fixture <json> --out <dir>   # 로컬 검증용 (네트워크 없이)
//
// 안전장치:
//   · published=false 행은 이중 차단 (RLS+뷰가 1차, 여기서 2차 필터 + 카운트 로그)
//   · price_flag=true 답변에 구체 금액 패턴이 있으면 해당 항목만 스킵 + 사유 로그
//     (빌드는 계속 진행 — 스킵 slug 목록이 워크플로 로그에 남는다)
//   · service_role 금지 — anon(publishable) 키만. 키가 sb_secret이면 즉시 중단
// ═══════════════════════════════════════════════════════════════
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://ainyeon.com';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://oqgoibbhnidsveueifet.supabase.co';
// anon publishable 키 — auth.js에 이미 공개된 값과 동일 (비밀 아님)
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_SpAwevRkW29BHRuJeFdfSA_Ube6Z4Vo';
const VIEW = 'v_qa_published';

// price_flag 항목 금액 단정 검출 — 걸리면 해당 항목 스킵 (빌드는 계속)
const AMOUNT_RE = /\d[\d,.]*\s*(억|만\s*원|천\s*원|원)/;
const PRICE_NOTICE = '시세는 변동됩니다 — 평형·배관 길이·실외기 위치·자재 시세, 현장 조건에 따라 실제 금액은 달라집니다.';

// ── CLI ──────────────────────────────────────────────
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const FIXTURE = argOf('--fixture');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(argOf('--out') || REPO_ROOT);

if (/^sb_secret|service_role/i.test(ANON_KEY)) {
  console.error('중단: anon(publishable) 키가 아닙니다. service_role 사용 금지.');
  process.exit(1);
}

// ── 데이터 로드 ───────────────────────────────────────
async function loadRows() {
  if (FIXTURE) {
    const raw = JSON.parse(readFileSync(resolve(FIXTURE), 'utf8'));
    return Array.isArray(raw) ? raw : raw.rows;
  }
  const url = `${SUPABASE_URL}/rest/v1/${VIEW}` +
    '?select=slug,category,category_label,error_code,error_title,question,answer,price_flag,sort_order,updated_at' +
    '&order=category.asc,sort_order.asc,slug.asc&limit=1000';
  const res = await fetch(url, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ── 검증 ─────────────────────────────────────────────
function validate(rows) {
  const errors = [];
  // published=false 이중 차단 (뷰 경유면 컬럼 자체가 없음 — undefined는 통과)
  const unpublished = rows.filter((r) => r.published === false);
  if (unpublished.length) {
    console.warn(`제외: published=false ${unpublished.length}건 (${unpublished.map((r) => r.slug).join(', ')})`);
  }
  const kept = rows.filter((r) => r.published !== false);

  const seen = new Set();
  for (const r of kept) {
    const tag = r.slug || '(slug 없음)';
    for (const f of ['slug', 'category', 'question', 'answer']) {
      if (!r[f] || !String(r[f]).trim()) errors.push(`${tag}: ${f} 누락`);
    }
    if (r.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.slug)) errors.push(`${tag}: slug 형식 위반 (소문자·숫자·하이픈만)`);
    if (r.slug) { if (seen.has(r.slug)) errors.push(`${tag}: slug 중복`); seen.add(r.slug); }
    if (r.category === 'error-code' && !(r.error_code && String(r.error_code).trim())) {
      errors.push(`${tag}: error-code 클러스터인데 error_code 누락`);
    }
  }
  if (errors.length) {
    console.error('빌드 실패 — 데이터 검증 오류:\n  ' + errors.join('\n  '));
    process.exit(1);
  }

  // price_flag 가드 — 금액 단정 항목은 그 항목만 스킵 (2차 발행부터 일부 불량이
  // 전체 발행을 막지 않도록). 스킵 slug는 로그로 남겨 데이터 수정 대상을 특정한다.
  const priceSkipped = [];
  const publishable = kept.filter((r) => {
    if (r.price_flag && AMOUNT_RE.test(r.answer)) { priceSkipped.push(r.slug); return false; }
    return true;
  });
  if (priceSkipped.length) {
    console.warn(`스킵: price_flag 금액 단정 ${priceSkipped.length}건 — 변동 요인 설명형으로 수정 후 재발행 필요`);
    for (const s of priceSkipped) console.warn(`  - ${s}`);
  }
  return { rows: publishable, priceSkipped };
}

// ── 공통 헬퍼 ─────────────────────────────────────────
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catLabel = (r) => r.category_label || r.category;
const codeSlug = (code) => String(code).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dateOf = (v) => (v ? String(v).slice(0, 10) : null);
const fmtDate = (v) => { const d = dateOf(v); return d ? d.replace(/-/g, '.') : ''; };

// JSON-LD·화면 공용 답변 전문 — price_flag면 고지 한 줄이 본문의 일부로 붙는다
// (스키마 텍스트 = 화면 텍스트 동일성 원칙)
const answerText = (r) => r.price_flag ? `${r.answer}\n\n※ ${PRICE_NOTICE}` : r.answer;

// 답변 본문 → 문단 HTML (빈 줄 = 문단, 단일 개행 = <br>)
const parasHtml = (text) => String(text).trim().split(/\n{2,}/)
  .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('\n');

const metaDesc = (text, n = 155) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

const jsonLd = (obj) =>
  `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

const qEntity = (r) => ({
  '@type': 'Question',
  name: r.question,
  acceptedAnswer: { '@type': 'Answer', text: answerText(r) },
});

// ── 페이지 셸 (gov/index.html과 동일 체계 — 토큰·컴포넌트만 소비) ──
const QA_CSS = `
  .qa-item{border-top:1px solid var(--c-line)}
  .qa-item:first-of-type{border-top:0}
  .qa-item summary{display:flex;align-items:flex-start;gap:var(--sp-2);
    padding:var(--sp-3) var(--sp-4);cursor:pointer;list-style:none;
    font-weight:var(--fw-semi);color:var(--c-ink)}
  .qa-item summary::-webkit-details-marker{display:none}
  .qa-item summary .qm{flex:none;color:var(--c-accent);font-weight:var(--fw-bold)}
  .qa-item[open] summary{background:var(--c-surface-sub)}
  .qa-fold{padding:var(--sp-3) var(--sp-4) var(--sp-4);color:var(--c-ink-sub)}
  .qa-fold p{margin-bottom:var(--sp-2)}
  .qa-fold p:last-of-type{margin-bottom:0}
  .qa-more{display:inline-block;margin-top:var(--sp-2);
    font-size:var(--fs-4);font-weight:var(--fw-semi);color:var(--c-accent)}
  .qa-more:hover{text-decoration:underline}
  .qa-article{padding:var(--sp-5) var(--sp-4)}
  .qa-article p{margin-bottom:var(--sp-3)}
  .qa-article p:last-of-type{margin-bottom:0}
  .qa-article h2{font-size:var(--fs-2);font-weight:var(--fw-bold);
    letter-spacing:-0.015em;margin:var(--sp-5) 0 var(--sp-2)}
  .qa-article h2:first-child{margin-top:0}
  .price-note{margin-top:var(--sp-4);padding:var(--sp-3) var(--sp-4);
    border:1px solid var(--c-accent-line);background:var(--c-accent-bg);
    border-radius:var(--r-1);font-size:var(--fs-4);color:var(--c-ink-sub)}
  .crumb a:hover{color:var(--c-ink)}`;

function pageShell({ title, desc, path, crumbHtml, h1, subHtml, statHtml, bodyHtml, ldBlocks }) {
  const canonical = SITE + path;
  return `<!doctype html>
<!-- generated by tools/qa-build — 손으로 수정 금지. 재발행: qa-publish 워크플로 -->
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:image" content="${SITE}/assets/og-card.png">
  <meta name="theme-color" content="#F3F2EF">
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
  <link rel="manifest" href="/manifest.json">
  <link rel="preload" href="/assets/fonts/PretendardVariable.subset.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/css/design-tokens.css?v=11">
  <link rel="stylesheet" href="/assets/css/components.css?v=12">
  <style>${QA_CSS}
  </style>
  <script defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
  <script defer src="/auth.js"></script>
  <script defer src="/assets/js/ain-common.js"></script>
  ${ldBlocks.join('\n  ')}
</head>
<body class="has-tabbar">
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <defs>
      <symbol id="i-chat" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></symbol>
      <symbol id="i-link" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></symbol>
      <symbol id="i-alert" viewBox="0 0 24 24"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></symbol>
    </defs>
  </svg>

  <nav class="tnav">
    <div class="tnav-in">
      <a class="brand" href="/"><svg class="brand-word" viewBox="0 0 929 307" role="img" aria-label="A.IN"><defs><linearGradient id="bgw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2D4A9E"/><stop offset="1" stop-color="#9E2D3D"/></linearGradient></defs><g fill="url(#bgw)"><path d="M149 0L0 303L202 302L178 250L85 249L179 61L298 303L358 303L211 1Z"/><circle cx="427" cy="268" r="40"/><path d="M510 0L509 302L565 303L565 0Z"/><path d="M633 0L632 302L688 302L689 88L862 303L927 303L928 1L872 1L871 224L693 0Z"/></g></svg><span class="brand-name">에어컨 인테리어 연구소</span></a>
      <div class="tnav-links">
        <a href="/">홈</a>
        <a href="/calendar/">입주정보</a>
        <a href="/prices/">시세</a>
        <a href="/gov/">정부사업</a>
        <a href="/news/">업계뉴스</a>
        <a class="on" href="/qa/">Q&amp;A</a>
        <a href="/board/free/">커뮤니티</a>
      </div>
      <div class="tnav-auth" id="authSlot"></div>
    </div>
  </nav>

  <main class="shell">
    <header class="phero">
      <div class="phero-bar">
        <div>
          <div class="crumb">${crumbHtml}</div>
          <h1>${esc(h1)}</h1>
          ${subHtml || ''}
        </div>
        ${statHtml || ''}
      </div>
    </header>
${bodyHtml}
  </main>

  <footer class="tfoot">
    <div class="tfoot-in">
      <div>에어컨 인테리어 연구소 A.IN — 현장 문답 아카이브</div>
      <div class="links">
        <a href="/">홈</a>
        <a href="/qa/">Q&amp;A 전체</a>
      </div>
    </div>
  </footer>

  <script>
    document.addEventListener("DOMContentLoaded", () => {
      if (window.ainAuth) ainAuth.init("authSlot");
    });
  </script>
</body>
</html>
`;
}

// ── 인덱스 ───────────────────────────────────────────
function renderIndex(general, errorGroups, total) {
  // 카테고리 그룹 (정렬된 입력 순서 유지)
  const cats = new Map();
  for (const r of general) {
    if (!cats.has(r.category)) cats.set(r.category, { label: catLabel(r), items: [] });
    cats.get(r.category).items.push(r);
  }

  const catPanels = [...cats.values()].map(({ label, items }) => `
    <section class="panel" style="margin-bottom:var(--sp-4)" aria-label="${esc(label)}">
      <div class="phead">
        <svg class="icon"><use href="#i-chat"/></svg>
        <h2>${esc(label)}</h2>
        <span class="cnt num">${items.length}건</span>
      </div>
      ${items.map((r) => `
      <details class="qa-item">
        <summary><span class="qm">Q.</span><span>${esc(r.question)}</span></summary>
        <div class="qa-fold">
${parasHtml(answerText(r))}
          <a class="qa-more" href="/qa/${r.slug}/">상세 페이지에서 보기</a>
        </div>
      </details>`).join('')}
    </section>`).join('\n');

  const errPanel = errorGroups.length ? `
    <section class="panel" style="margin-bottom:var(--sp-8)" aria-label="에러코드">
      <div class="phead">
        <svg class="icon"><use href="#i-alert"/></svg>
        <h2>에러코드</h2>
        <span class="cnt num">${errorGroups.length}개 코드</span>
      </div>
      <div class="rows">
        ${errorGroups.map((g) => `
        <a class="row" href="/qa/error-code/${g.slug}/">
          <span class="dday num">${esc(g.code)}</span>
          <div class="row-main">
            <div class="row-title">${esc(g.title || g.items[0].question)}</div>
            <div class="row-meta">문답 ${g.items.length}건 — ${esc(g.items[0].question)}</div>
          </div>
        </a>`).join('')}
      </div>
    </section>` : '';

  // FAQPage — mainEntity는 이 페이지에 질문·답변 전문이 실제 노출되는 항목만
  // (에러코드는 링크만 노출되므로 각 코드 페이지의 스키마가 담당)
  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: general.map(qEntity),
  });

  const desc = '에어컨·인테리어 현장에서 실제로 오간 질문과 답변을 정리한 Q&A 아카이브. 설치·시공, 유지보수, 비용 판단 기준과 에러코드 조치까지.';
  return pageShell({
    title: '현장 Q&A | 에어컨 인테리어 연구소',
    desc,
    path: '/qa/',
    crumbHtml: 'Q&amp;A ARCHIVE',
    h1: '현장 Q&A',
    subHtml: `<p class="sub">오픈채팅에서 실제로 오간 현장 문답을 검수해 정리합니다. 답변은 참고용이며 현장 조건에 따라 다를 수 있습니다.</p>`,
    statHtml: `
        <div class="phero-stat">
          <div class="st"><div class="n num">${total}</div><div class="l">문답</div></div>
          <div class="st"><div class="n num">${cats.size + (errorGroups.length ? 1 : 0)}</div><div class="l">카테고리</div></div>
        </div>`,
    bodyHtml: catPanels + errPanel,
    ldBlocks: [ld],
  });
}

// ── 개별 상세 ─────────────────────────────────────────
function renderDetail(r, siblings) {
  const related = siblings.filter((s) => s.slug !== r.slug).slice(0, 3);
  const body = `
    <section class="panel" style="margin-bottom:var(--sp-4)">
      <article class="qa-article">
${parasHtml(r.answer)}
        ${r.price_flag ? `<p class="price-note">※ ${esc(PRICE_NOTICE)}</p>` : ''}
      </article>
    </section>
    ${related.length ? `
    <section class="panel" style="margin-bottom:var(--sp-8)" aria-label="관련 문답">
      <div class="phead">
        <svg class="icon"><use href="#i-link"/></svg>
        <h2>${esc(catLabel(r))} 관련 문답</h2>
      </div>
      <div class="rows">
        ${related.map((s) => `
        <a class="row" href="/qa/${s.slug}/">
          <div class="row-main">
            <div class="row-title">${esc(s.question)}</div>
          </div>
        </a>`).join('')}
      </div>
    </section>` : ''}`;

  const ld = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'QAPage',
    mainEntity: {
      '@type': 'Question',
      name: r.question,
      text: r.question,
      answerCount: 1,
      acceptedAnswer: { '@type': 'Answer', text: answerText(r) },
    },
  });

  return pageShell({
    title: `${r.question} | 에어컨 인테리어 연구소`,
    desc: metaDesc(r.answer),
    path: `/qa/${r.slug}/`,
    crumbHtml: `<a href="/qa/">Q&amp;A ARCHIVE</a> · ${esc(catLabel(r))}`,
    h1: r.question,
    subHtml: r.updated_at ? `<p class="sub num">${fmtDate(r.updated_at)} 검수</p>` : '',
    bodyHtml: body,
    ldBlocks: [ld],
  });
}

// ── 에러코드 서브클러스터 ─────────────────────────────
function renderErrorCode(g, allGroups) {
  const others = allGroups.filter((o) => o.slug !== g.slug).slice(0, 3);
  const h1 = g.title ? `${g.code} — ${g.title}` : `에어컨 에러코드 ${g.code}`;
  const body = `
    <section class="panel" style="margin-bottom:var(--sp-4)">
      <article class="qa-article">
        ${g.items.map((r) => `
        <h2>Q. ${esc(r.question)}</h2>
${parasHtml(r.answer)}
        ${r.price_flag ? `<p class="price-note">※ ${esc(PRICE_NOTICE)}</p>` : ''}`).join('\n')}
      </article>
    </section>
    ${others.length ? `
    <section class="panel" style="margin-bottom:var(--sp-8)" aria-label="다른 에러코드">
      <div class="phead">
        <svg class="icon"><use href="#i-link"/></svg>
        <h2>다른 에러코드</h2>
      </div>
      <div class="rows">
        ${others.map((o) => `
        <a class="row" href="/qa/error-code/${o.slug}/">
          <span class="dday num">${esc(o.code)}</span>
          <div class="row-main">
            <div class="row-title">${esc(o.title || o.items[0].question)}</div>
          </div>
        </a>`).join('')}
      </div>
    </section>` : ''}`;

  const ld = g.items.length === 1
    ? jsonLd({
        '@context': 'https://schema.org',
        '@type': 'QAPage',
        mainEntity: {
          '@type': 'Question',
          name: g.items[0].question,
          text: g.items[0].question,
          answerCount: 1,
          acceptedAnswer: { '@type': 'Answer', text: answerText(g.items[0]) },
        },
      })
    : jsonLd({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: g.items.map(qEntity),
      });

  return pageShell({
    title: `에어컨 에러코드 ${g.code}${g.title ? ` — ${g.title}` : ''} | 에어컨 인테리어 연구소`,
    desc: metaDesc(`${g.code} ${g.title || ''} — ${g.items[0].answer}`),
    path: `/qa/error-code/${g.slug}/`,
    crumbHtml: `<a href="/qa/">Q&amp;A ARCHIVE</a> · 에러코드`,
    h1,
    subHtml: `<p class="sub">코드 표시 시 확인 순서와 조치를 현장 문답 기준으로 정리했습니다.</p>`,
    bodyHtml: body,
    ldBlocks: [ld],
  });
}

// ── 사이트맵 (/qa 범위만 — 루트 sitemap.xml은 sitemap index로 수동 관리) ──
function renderQaSitemap(general, errorGroups, maxUpdated) {
  const urls = [];
  urls.push({ loc: `${SITE}/qa/`, lastmod: maxUpdated });
  for (const r of general) urls.push({ loc: `${SITE}/qa/${r.slug}/`, lastmod: dateOf(r.updated_at) });
  for (const g of errorGroups) {
    const lm = g.items.map((r) => dateOf(r.updated_at)).filter(Boolean).sort().pop() || null;
    urls.push({ loc: `${SITE}/qa/error-code/${g.slug}/`, lastmod: lm });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

// ── 메인 ─────────────────────────────────────────────
const { rows, priceSkipped } = validate(await loadRows());
if (!rows.length) {
  console.error('중단: published 항목이 0건 — 발행할 것이 없으면 산출물을 건드리지 않는다.');
  process.exit(1);
}

const general = rows.filter((r) => r.category !== 'error-code');
const errRows = rows.filter((r) => r.category === 'error-code');
const groupMap = new Map();
for (const r of errRows) {
  const s = codeSlug(r.error_code);
  if (!groupMap.has(s)) groupMap.set(s, { slug: s, code: String(r.error_code).trim(), title: r.error_title || null, items: [] });
  const g = groupMap.get(s);
  if (!g.title && r.error_title) g.title = r.error_title;
  g.items.push(r);
}
const errorGroups = [...groupMap.values()];

// 기존 /qa 산출물 전체 재생성 (발행 취소분 잔존 방지)
const qaDir = join(OUT, 'qa');
rmSync(qaDir, { recursive: true, force: true });
mkdirSync(qaDir, { recursive: true });

const writePage = (relDir, html) => {
  const dir = join(OUT, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html);
};

writePage('qa', renderIndex(general, errorGroups, rows.length));
for (const r of general) {
  const siblings = general.filter((s) => s.category === r.category);
  writePage(join('qa', r.slug), renderDetail(r, siblings));
}
for (const g of errorGroups) writePage(join('qa', 'error-code', g.slug), renderErrorCode(g, errorGroups));

const maxUpdated = rows.map((r) => dateOf(r.updated_at)).filter(Boolean).sort().pop() || null;
writeFileSync(join(qaDir, 'sitemap-qa.xml'), renderQaSitemap(general, errorGroups, maxUpdated));

console.log([
  `빌드 완료 → ${OUT}`,
  `  문답 ${rows.length}건 (일반 ${general.length} · 에러코드 ${errRows.length})` +
    (priceSkipped.length ? ` · price 가드 스킵 ${priceSkipped.length}건` : ''),
  `  페이지: /qa/ 1 + 상세 ${general.length} + 에러코드 ${errorGroups.length}`,
  `  qa/sitemap-qa.xml: ${1 + general.length + errorGroups.length} URL (루트 sitemap.xml은 불변)`,
].join('\n'));
