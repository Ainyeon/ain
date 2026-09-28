// 교육 찾기 — 목록·필터·카드·상세. 비회원도 열람 가능 (SPEC §2.1).
// 데이터 두 갈래를 같은 카드 모양으로 합친다:
//   1) 검수 원장  /assets/data/education.json (tools/education-seed.csv → build-edu-json.py)
//   2) 자동 수집  Supabase v_edu_list (ain-automation scripts/collect_edu_programs.py)
// 자동 수집분은 '사람 검수 전'으로 표시한다 — 접속 성공은 검수가 아니다.
// v_edu_list 가 아직 없으면(SQL 미적용) 원장만 그린다. 실패를 0건처럼 꾸미지 않는다.
// 저장·제보·후기만 로그인 필요. 로직은 edu-logic.js(테스트 있음), 여기는 렌더만.
(function () {
  'use strict';
  const L = window.ainEduLogic;
  const C = () => window.ainCommunity;
  const panel = document.getElementById('eduPanel');
  const $ = (id) => document.getElementById(id);
  const esc = (v) => window.escT(v == null ? '' : v);
  const qs = () => new URLSearchParams(location.search);

  const kstToday = () => {
    const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' }).formatToParts(new Date());
    const o = Object.fromEntries(p.map((x) => [x.type, x.value]));
    return o.year + '-' + o.month + '-' + o.day;
  };

  let DATA = null;
  // 자동 수집 목록: null = 아직 조회 안 함 / 'unavailable' = 뷰 미적용 / [] = 조회했고 0건
  let AUTO = null;
  let saves = null;
  let gen = 0;   // 요청 세대 — 늦게 도착한 이전 세션의 응답이 화면을 덮지 않게 한다           // Map | null (비로그인 또는 미적용)
  // edu id -> {total, review, rows[]}. null = 아직 조회하지 않음(비회원·미적용) — 0건과 구분한다.
  let refCounts = null;
  // 오래된 후기를 하단에 몰지 않고 필터로 거른다 (SPEC §3.7).
  // 상태는 옵션 값(개월 문자열) 그대로 둔다 — 월 경계(YYYY-MM)를 넣어 두면
  // 다시 그릴 때 select의 selected 비교가 어긋나 "전체 기간"으로 되돌아간다.
  let reviewMonths = '';                 // '' | '12' | '24' | '36'
  // ⚠️ 일자를 먼저 1로 고정한 뒤 월을 뺀다. 오늘이 2024-02-29일 때 그냥 setMonth(-12)를 하면
  //    없는 날짜(2023-02-29)가 2023-03-01로 넘어가 경계가 한 달 밀린다.
  function sinceBoundary(months, now) {
    const n = Number(months);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date(now == null ? Date.now() : now);
    d.setDate(1);
    d.setMonth(d.getMonth() - n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // ── 자동 수집분 → 원장과 같은 카드 모양 ──────────────────────────
  // 원문에 없는 값을 만들지 않는다. 못 읽은 칸은 빈 값으로 두고 화면이 '원문에 없음'으로 적는다.
  const AUTO_ID = /^AUTO-/;
  const isAuto = (item) => AUTO_ID.test(String(item && item.id));

  function groupOfAuto(row, f) {
    if (row.status === 'closed') return 'expired';     // 원문 마감 또는 원문 개강일이 지남 (수집기가 판정)
    if (row.apply_end_at) return 'deadline';
    if (row.record_type === '모집회차' || f.schedule_raw) return 'posted_no_deadline';
    return 'unconfirmed';
  }

  function fromDb(row) {
    const f = row.fields || {};
    const labels = (DATA && DATA.field_labels) || {};
    const arr = (v) => Array.isArray(v) ? v : [];   // jsonb 모양이 어긋나도 페이지 전체가 멈추지 않게
    const codes = arr(f.work_codes);
    const conflicts = arr(f.conflicts);
    // 상세 페이지를 아직 못 읽은 행 — 빈 값은 '원문에 없음'이 아니라 '아직 모름'이다
    const unread = f.detail_read === false;
    return {
      id: row.notice_id,
      record_type: row.record_type || '과정소개',
      org: row.org,
      course: row.title,
      course_class: f.course_class || '',
      work_raw: codes.map((c) => labels[c] || c).join(' · ') || '업무 분류 미확인',
      work_codes: codes,
      region_raw: f.region_raw ? f.region_raw + (f.region_basis ? ' (기관 소재지)' : '') : (unread ? '상세 미확인' : '원문에 없음'),
      region_code: row.region_code && row.region_code !== '미확인' ? row.region_code : '',   // 모르는 지역은 필터 선택지에 넣지 않는다
      target_raw: f.target_raw || '',
      target_level: f.target_level || 'unknown',
      posted_raw: row.posted_raw || '',
      schedule_raw: f.schedule_raw || '',
      schedule_meaning: '',
      apply_start_raw: f.apply_start_raw || '',
      apply_end_raw: f.apply_end_raw || f.apply_period_raw || '',
      apply_end_at: row.apply_end_at || null,
      apply_notice: row.apply_end_at ? '접수 마감일시 명시' : '',
      capacity_raw: f.capacity_raw || '',
      seats_level: f.capacity_raw ? '정원 표기만 있음. 정원은 잔여석이 아니며 잔여석은 미확인' : '',
      // 원문 안에서 표기가 엇갈린 항목은 전부 이어 붙여 그대로 보여 준다 (어느 쪽도 고르지 않는다)
      conflict: conflicts.length
        ? { kind: conflicts[0].kind, text: conflicts.map((c) => c.text).join(' / ') } : null,
      status_label: row.status === 'closed' ? (row.apply_end_at ? '원문에 적힌 접수 마감이 지남' : '원문 개강일이 지남')
        : row.apply_end_at ? '접수 마감일시 명시' : '접수 마감 미확인',
      cost_raw: f.cost_raw || (unread ? '상세 미확인' : ''),
      cost_condition: '',
      subsidy_raw: f.subsidy_raw || '',
      cost_level: f.cost_level || 'unknown',
      practice_raw: '',
      cert_type: '',
      cert_basis: '',
      org_claim: '',                 // 자동 수집분은 기관 홍보 문구를 확인하지 않았다 — detailHtml 이 따로 적는다
      url: isHttpUrl(row.detail_url) ? row.detail_url : '',
      url_note: '',
      url_aux: row.list_url && row.list_url !== row.detail_url ? row.list_url : '',
      url_aux_note: row.list_url ? '기관 목록 페이지' : '',
      source_limit: '자동 수집기가 공개 목록·상세 페이지에서 읽은 표기입니다. 사람이 원문을 검수하지 않았습니다.',
      checked_at: row.checked_at,
      unknowns: [f.cost_raw ? '' : '비용', f.capacity_raw ? '' : '정원',
                 f.target_raw ? '' : '대상', row.apply_end_at ? '' : '접수 마감']
        .filter(Boolean).join(', '),
      exposure: '',
      verified_by: row.verified_by || '자동 수집 (사람 검수 전)',
      group: groupOfAuto(row, f),
      parse_status: row.parse_status,
      parse_note: row.parse_note,
      images: arr(f.images)
    };
  }

  // v_edu_list 가 없으면(운영 SQL 미적용) 조용히 원장만 쓴다.
  const relationMissing = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205'
    || e.code === 'PGRST200' || /does not exist|schema cache/i.test(String(e.message || '')));

  async function loadAuto() {
    if (!window.ainAuth || !ainAuth.getClient) return 'unavailable';
    let res;
    try {
      res = await ainAuth.getClient().from('v_edu_list')
        .select('notice_id,org,record_type,title,detail_url,list_url,posted_raw,region_code,'
          + 'apply_end_at,status,parse_status,parse_note,fields,checked_at,verified_by')
        .order('checked_at', { ascending: false }).limit(300);
    } catch (e) { console.warn('v_edu_list', e); return 'unavailable'; }
    if (res.error) {
      if (!relationMissing(res.error)) console.warn('v_edu_list', res.error);
      return 'unavailable';
    }
    return (res.data || []).map(fromDb);
  }

  // 원장 + 자동 수집. 같은 원문 주소를 가리키면 사람이 검수한 원장 쪽을 남긴다.
  function allItems() {
    const ledger = (DATA && DATA.items) || [];
    if (!Array.isArray(AUTO) || !AUTO.length) return ledger;
    const seen = new Set(ledger.map((i) => window.sourceUrlKey(i.url)));
    return ledger.concat(AUTO.filter((i) => !seen.has(window.sourceUrlKey(i.url))));
  }

  const heartSvg = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';

  // "원문에 없음" 류는 값이 아니라 모른다는 사실이다. 그대로 적되 값처럼 강조하지 않는다.
  const isBlank = (v) => !v || /^(원문에 없음|해당 없음|없음)$/.test(String(v).trim());
  // href에 넣기 전 단일 http(s) URL인지 확인 — 원장 칸에 설명이나 둘째 URL이 섞여도 새지 않게.
  const isHttpUrl = (v) => /^https?:\/\/\S+$/.test(String(v || '').trim());
  const kv = (k, v) => isBlank(v) ? '' :
    '<div class="edu-line"><span class="edu-k">' + esc(k) + '</span>' + esc(v) + '</div>';

  // ── 저장 버튼 ── 계정 저장만 쓴다. 미적용/실패를 성공처럼 그리지 않는다.
  function saveBtn(type, id, label, meta) {
    const on = saves && saves.has(C().saveKey(type, id));
    const ready = C().savesReady();
    return '<button type="button" class="edu-save' + (on ? ' on' : '') + '"'
      + ' data-save="' + esc(type + '|' + id) + '"'
      + ' data-label="' + esc(label || '') + '" data-meta="' + esc(meta || '') + '"'
      + (ready ? '' : ' disabled title="관심 저장을 아직 쓸 수 없습니다"')
      + '>' + heartSvg + (on ? '저장됨' : '관심 저장') + '</button>';
  }

  async function onSave(btn) {
    const [type, id] = btn.dataset.save.split('|');
    const key = C().saveKey(type, id);
    const on = saves && saves.has(key);
    const r = on ? await C().removeSave(type, id)
                 : await C().addSave(type, id, btn.dataset.label, btn.dataset.meta);
    if (r.needLogin) {
      if (confirm('관심 저장은 회원 기능입니다. 카카오로 로그인할까요?')) C().loginWithKakao();
      return;
    }
    if (r.error) {
      alert('저장하지 못했습니다. 관심 저장 기능을 아직 쓸 수 없습니다.');
      console.error('saved_items', r.error);
      render();   // savesReady()가 false로 바뀌었으면 버튼을 비활성으로 다시 그린다
      return;
    }
    saves = await C().loadSaves();
    render();
  }

  // ── 카드 ──
  function conflictHtml(item) {
    if (!item.conflict) return '';
    const head = item.conflict.kind === 'date'
      ? '공고 안에서 날짜·일시 표기가 서로 다릅니다'
      : item.conflict.kind === 'cost'
        ? '공고 안에서 비용 표기가 정리되지 않았습니다'
        : '공고 안에서 표기가 서로 다릅니다';
    const tail = item.conflict.kind === 'date'
      ? '날짜를 확정하지 마시고, 현재 접수 여부는 기관에 확인하세요.'
      : '실제 부담액은 기관에 확인하세요.';
    return '<div class="edu-warn"><span>⚠ ' + esc(head) + '</span>'
      + '<span class="sub">' + esc(item.conflict.text) + '</span>'
      + '<span class="sub">' + esc(tail) + '</span></div>';
  }

  function staleTag(item) {
    // 마감 표기 없이 원문 개강일로 닫힌 수집분은 '마감 경과'라고 하지 않는다(모르는 마감을 지났다고 단정하지 않음)
    return (L.isExpired(item) ? '<span class="edu-tag">접수 마감 경과</span>'
      : item.group === 'expired' ? '<span class="edu-tag">원문 개강일 지남</span>' : '')
      + (L.isStale(item.checked_at, kstToday()) ? '<span class="edu-tag accent">재확인 필요</span>' : '');
  }

  // 자동으로 읽어 온 항목임을 감추지 않는다. 접속 성공은 원문 검수가 아니다.
  function autoTag(item) {
    if (!isAuto(item)) return '';
    return '<span class="edu-tag">자동 수집 · 사람 검수 전</span>'
      + (item.parse_status === 'partial' ? '<span class="edu-tag accent">일부만 읽음</span>' : '')
      + (item.parse_status === 'failed' ? '<span class="edu-tag accent">상세를 읽지 못함</span>' : '');
  }

  function autoNote(item) {
    if (!isAuto(item)) return '';
    return '<div class="edu-warn"><span>이 항목은 수집기가 기관 페이지에서 읽은 표기입니다</span>'
      + '<span class="sub">사람이 원문을 검수하지 않았습니다. 신청 전에 공식 페이지에서 확인하세요.</span>'
      + (item.parse_note ? '<span class="sub">' + esc(item.parse_note) + '</span>' : '') + '</div>';
  }

  function cardHtml(item) {
    const tags = [
      item.record_type === '기관과정목록' ? '기관 과정 소개(회차 아님)' : '',
      L.TARGET_LABELS[item.target_level],
      L.COST_LABELS[item.cost_level]
    ].filter(Boolean).map((t) => '<span class="edu-tag">' + esc(t) + '</span>').join('');

    // 비용과 적용 조건은 같은 줄에 (SPEC §3.1)
    const costLine = isBlank(item.cost_raw) && isBlank(item.cost_condition) ? '' :
      '<div class="edu-line"><span class="edu-k">비용</span><b>' + esc(isBlank(item.cost_raw) ? '원문에 금액 표기 없음' : item.cost_raw) + '</b>'
      + (isBlank(item.cost_condition) ? '' : ' — 조건: ' + esc(item.cost_condition)) + '</div>';

    // 정원은 잔여석이 아니다 (SPEC §3.3)
    const capLine = isBlank(item.capacity_raw) ? '' :
      '<div class="edu-line"><span class="edu-k">정원</span>' + esc(item.capacity_raw)
      + ' <span class="edu-tag">잔여석 아님</span></div>';

    return '<article class="edu-card">'
      + '<div class="edu-tags">' + tags + staleTag(item) + autoTag(item) + '</div>'
      + '<h3><a href="?id=' + encodeURIComponent(item.id) + '">' + esc(item.course) + '</a></h3>'
      + '<div class="edu-org">' + esc(item.work_raw) + ' · ' + esc(item.org) + ' · ' + esc(item.region_raw) + '</div>'
      + kv('일정', item.schedule_raw)
      + (isBlank(item.schedule_meaning) ? '' : '<div class="edu-line"><span class="edu-k"></span><span style="color:var(--c-ink-faint)">' + esc(item.schedule_meaning) + '</span></div>')
      + kv('신청 마감', isBlank(item.apply_end_raw) ? '원문에 없음' : item.apply_end_raw)
      + kv('대상', item.target_raw)
      + costLine + capLine
      + kv('실습·시간', item.practice_raw)
      + kv('자격', item.cert_type)
      + conflictHtml(item)
      + '<div class="edu-line" style="color:var(--c-ink-faint)">최종 확인 ' + esc(item.checked_at) + '</div>'
      + '<div class="edu-actions">'
      + '<a class="btn-src" href="' + esc(item.url) + '" target="_blank" rel="noopener">공식 원문<svg class="icon sm"><use href="#i-ext"/></svg></a>'
      + '<a class="btn-line" href="?id=' + encodeURIComponent(item.id) + '">자세히</a>'
      + saveBtn('edu', item.id, item.course, item.org)
      + '</div></article>';
  }

  // ── 원문 사진 ────────────────────────────────────────────────────
  // 추출과 허락은 다르다. 개별 이미지에 이용 근거가 기록된 것(use.state === 'allowed')만
  // 띄우고, 나머지는 원문 링크로 보낸다. 사진이 없어도 카드 레이아웃은 그대로다.
  // 크롭·가공하지 않는다 — 원본 비율·전체 유지가 허락 조건에 포함된다.
  function imagesHtml(item) {
    const ok = (item.images || []).filter((im) => im && im.use && im.use.state === 'allowed'
      && /^https:\/\//.test(String(im.url || '')));
    if (!ok.length) return '';
    return '<div class="edu-block"><h4>원문 사진</h4>'
      + ok.slice(0, 3).map((im) =>
        '<figure class="edu-photo">'
        + '<img src="' + esc(im.url) + '" alt="' + esc(im.alt || (item.course + ' 원문 사진')) + '"'
        + ' loading="lazy" decoding="async" referrerpolicy="no-referrer"'
        + ' onerror="this.closest(\'figure\').remove()">'
        + '<figcaption>출처: ' + esc(item.org)
        + ' · <a href="' + esc(item.url) + '" target="_blank" rel="noopener">원문 보기</a>'
        + (im.use.verified_at ? ' · 이용 조건 확인 ' + esc(im.use.verified_at) : '')
        + '</figcaption></figure>').join('')
      + '</div>';
  }

  // ── 필터 ──
  function currentFilter() {
    const p = qs();
    return {
      work: p.get('work') || '', region: p.get('region') || '', status: p.get('status') || '',
      target: p.get('target') || '', cost: p.get('cost') || ''
    };
  }
  function setFilter(key, value) {
    const p = qs();
    if (value) p.set(key, value); else p.delete(key);
    p.delete('id');
    history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
    render();
  }

  function selectHtml(id, label, options, current) {
    return '<div class="edu-f"><label for="' + id + '">' + esc(label) + '</label>'
      + '<select id="' + id + '"><option value="">전체</option>'
      + options.map((o) => '<option value="' + esc(o.v) + '"' + (o.v === current ? ' selected' : '') + '>'
        + esc(o.l) + '</option>').join('')
      + '</select></div>';
  }

  function filtersHtml(f) {
    const labels = DATA.field_labels || {};
    const work = L.optionsOf(allItems(), 'work').map((v) => ({ v, l: labels[v] || v }));
    const region = L.optionsOf(allItems(), 'region_code').filter(Boolean).map((v) => ({ v, l: v }));
    const status = L.SECTIONS.map((s) => ({ v: s.key, l: s.title }));
    const target = ['beginner', 'experience', 'condition', 'unknown'].map((v) => ({ v, l: L.TARGET_LABELS[v] }));
    const cost = ['subsidy', 'self', 'free', 'unknown'].map((v) => ({ v, l: L.COST_LABELS[v] }));
    // 상세 조건에 값이 들어 있으면 접힌 채로 두지 않는다
    const detailOpen = (f.status || f.target || f.cost) ? ' open' : '';
    const on = [f.work, f.region, f.status, f.target, f.cost].filter(Boolean).length;

    return '<div class="edu-filters">'
      + '<div class="edu-frow">'
      + selectHtml('fWork', '업무', work, f.work)
      + selectHtml('fRegion', '지역', region, f.region)
      + '</div>'
      + '<details class="edu-more"' + detailOpen + '>'
      + '<summary>상세 조건' + (detailOpen ? '' : (on ? ' · ' + on + '개 적용' : '')) + '</summary>'
      + '<div class="edu-frow">'
      + selectHtml('fStatus', '현재 상태', status, f.status)
      + selectHtml('fTarget', '대상', target, f.target)
      + selectHtml('fCost', '비용 조건', cost, f.cost)
      + '</div></details>'
      + '<div class="edu-fbar"><span class="edu-sort">최근 확인순</span>'
      + (on ? '<button type="button" class="edu-reset" id="fReset">필터 초기화</button>' : '')
      + '</div></div>';
  }

  // ── 상세 (W3) ──
  function detailHtml(item) {
    const unknown = isBlank(item.unknowns) ? '' :
      '<div class="edu-block"><h4>미확인 정보</h4><div class="edu-line">' + esc(item.unknowns)
      + '</div><div class="edu-line" style="color:var(--c-ink-faint)">→ 신청 가능 여부는 기관에 확인하세요.</div></div>';

    const claimNone = /없음/.test(item.org_claim || '');
    const claim = '<div class="edu-block claim"><h4>기관 홍보 내용</h4>'
      + (isAuto(item)
        ? '<div class="edu-line" style="color:var(--c-ink-faint)">자동 수집 항목은 기관의 취업·수익 홍보 문구를 확인하지 않았습니다. 원문에서 확인하세요.</div>'
        : claimNone
        ? '<div class="edu-line" style="color:var(--c-ink-faint)">이 과정에는 취업·수익 관련 주장이 없습니다.</div>'
        : '<div class="edu-line">' + esc(item.org_claim.replace(/^\[[^\]]*\]\s*/, ''))
          + ' <span class="edu-unverified">에인연 미검증</span></div>'
          + '<div class="edu-line" style="color:var(--c-ink-faint)">출처: 기관 페이지 — ' + esc(item.org) + '</div>')
      + '</div>';

    const bucket = refCounts ? (refCounts.get(item.id) || { total: 0, review: 0, rows: [] }) : null;
    const all = bucket ? bucket.rows : [];
    // 수료 시점이 오래된 후기는 아래로 미루지 않고 필터로 거른다.
    // 시점을 안 적은 후기는 걸러 내지 않는다 — 모른다는 이유로 감추면 안 된다.
    const boundary = sinceBoundary(reviewMonths);
    // 수료 시점을 안 적은 후기는 걸러 내지 않는다 — 모른다는 이유로 감추면 안 된다.
    const shown = boundary
      ? all.filter((r) => !r.review_done_month || r.review_done_month >= boundary)
      : all;
    const expHead = bucket ? ' (' + bucket.review + '건)' : '';
    const expBody = !bucket
      ? '수강 후기는 로그인 후 확인할 수 있습니다.'
      : bucket.review
        ? ''
        : '등록된 후기가 없습니다.';

    const sinceOpts = [['', '전체 기간'], ['12', '최근 1년'], ['24', '최근 2년'], ['36', '최근 3년']];
    const filterHtml = bucket && bucket.review
      ? '<div class="edu-fbar"><label class="edu-sort" for="rSince">수료 시점</label>'
        + '<select id="rSince" class="edu-since">'
        + sinceOpts.map(([v, l]) => '<option value="' + v + '"' + (v === reviewMonths ? ' selected' : '') + '>'
          + l + '</option>').join('')
        + '</select>'
        + '<span class="edu-sort">수료 시점 미기재는 걸러지지 않습니다</span></div>'
      : '';

    const reviewList = shown.map((r) => {
      const facts = [
        r.review_done_month ? r.review_done_month.replace('-', '.') + ' 수료' : '수료 시점 미기재',
        r.review_cost != null ? Number(r.review_cost).toLocaleString('ko-KR') + '원' : '지출 금액 미기재',
        C().subsidyLabel(r.review_subsidy)
      ].filter(Boolean);
      return '<div class="edu-review">'
        + '<div class="edu-tags">' + facts.map((f) => '<span class="edu-tag">' + esc(f) + '</span>').join('') + '</div>'
        + '<a class="edu-line" href="/board/free/?id=' + r.id + '"><b>' + esc(C().maskContacts(r.title)) + '</b></a>'
        + '<div class="edu-line" style="color:var(--c-ink-faint)">' + C().authorBadgeOf(r) + '</div>'
        + '</div>';
    }).join('')
      + (bucket && bucket.review && !shown.length
        ? '<div class="edu-line" style="color:var(--c-ink-faint)">고른 기간에 해당하는 후기가 없습니다.</div>' : '');

    const link = bucket && bucket.total
      ? '<a class="btn-line" href="/board/free/?ref=edu:' + encodeURIComponent(item.id) + '">이 과정 글 ' + bucket.total + '건</a>'
      : '';

    const similar = L.listed(allItems())
      .filter((x) => x.id !== item.id && (x.work_codes || []).some((c) => (item.work_codes || []).includes(c)))
      .slice(0, 4);

    return '<a class="back-link" href="/edu/">← 교육 목록으로</a>'
      + '<article class="edu-card">'
      + '<div class="edu-tags"><span class="edu-tag accent">' + esc(item.status_label) + '</span>' + staleTag(item) + autoTag(item) + '</div>'
      + '<h3>' + esc(item.course) + '</h3>'
      + '<div class="edu-org">' + esc(item.org) + ' · ' + esc(item.course_class) + '</div>'

      + '<div class="edu-block"><h4>교육 안내</h4>'
      + kv('업무', item.work_raw)
      + kv('지역', item.region_raw)
      + kv('대상', item.target_raw)
      + kv('게시일', item.posted_raw)
      + kv('일정', item.schedule_raw)
      + (isBlank(item.schedule_meaning) ? '' : '<div class="edu-line"><span class="edu-k"></span><span style="color:var(--c-ink-faint)">ⓘ ' + esc(item.schedule_meaning) + '</span></div>')
      + kv('접수 시작', item.apply_start_raw)
      + kv('접수 마감', item.apply_end_raw)
      + kv('접수 문구', item.apply_notice)
      + (isBlank(item.capacity_raw) ? '' : '<div class="edu-line"><span class="edu-k">정원</span>' + esc(item.capacity_raw) + '</div>')
      + kv('여석', item.seats_level)
      + '<div class="edu-line"><span class="edu-k">비용</span><b>' + esc(isBlank(item.cost_raw) ? '원문에 금액 표기 없음' : item.cost_raw) + '</b>'
      + (isBlank(item.cost_condition) ? '' : '</div><div class="edu-line"><span class="edu-k"></span>└ 조건: ' + esc(item.cost_condition)) + '</div>'
      + kv('국비 표기', item.subsidy_raw)
      + kv('실습·시간', item.practice_raw)
      + kv('자격', item.cert_type)
      + (isBlank(item.cert_basis) ? '' : '<div class="edu-line"><span class="edu-k"></span><span style="color:var(--c-ink-faint)">' + esc(item.cert_basis) + '</span></div>')
      + kv('최종 확인', item.checked_at)
      + kv('출처 한계', item.source_limit)
      + '<div class="edu-actions"><a class="btn-src" href="' + esc(item.url) + '" target="_blank" rel="noopener">공식 페이지 열기<svg class="icon sm"><use href="#i-ext"/></svg></a>'
      + (isHttpUrl(item.url_aux) ? '<a class="btn-src" href="' + esc(item.url_aux) + '" target="_blank" rel="noopener">보조 출처<svg class="icon sm"><use href="#i-ext"/></svg></a>' : '')
      + '</div>'
      + (item.url_aux_note ? '<div class="edu-line" style="color:var(--c-ink-faint)">보조 출처 메모: ' + esc(item.url_aux_note) + '</div>' : '')
      + '</div>'

      + conflictHtml(item)
      + autoNote(item)
      + imagesHtml(item)
      + unknown
      + claim

      + '<div class="edu-block"><h4>수강 후기' + expHead + '</h4>'
      + (expBody ? '<div class="edu-line">' + expBody + '</div>' : '')
      + filterHtml + reviewList
      + '<div class="edu-actions">'
      + '<a class="btn-line" href="/board/free/?ref=edu:' + encodeURIComponent(item.id) + '&form=review">후기 작성</a>'
      + link + '</div></div>'

      + '<div class="edu-actions">' + saveBtn('edu', item.id, item.course, item.org) + '</div>'
      + '</article>'

      + (similar.length ? '<div class="edu-sec"><div class="edu-sec-head"><h2>비슷한 업무의 과정</h2></div>'
        + similar.map(cardHtml).join('') + '</div>' : '');
  }

  // ── 렌더 ──
  function render() {
    if (!DATA) return;
    const id = qs().get('id');
    if (id) {
      const item = L.listed(allItems()).find((x) => x.id === id);   // 교육 집계 제외분은 상세도 없음
      panel.innerHTML = item ? detailHtml(item)
        : '<div class="edu-note"><b>과정을 찾을 수 없습니다</b><a href="/edu/">교육 목록으로</a></div>';
      bind();
      return;
    }
    const f = currentFilter();
    const now = Date.now();
    const secs = L.groupSections(allItems(), f, now);
    const shown = secs.reduce((n, s) => n + s.items.length, 0);

    panel.innerHTML = filtersHtml(f)
      + (shown ? '' : '<div class="edu-note"><b>조건에 맞는 과정이 없습니다</b>필터를 넓혀 보세요.</div>')
      + secs.map((s) =>
        '<section class="edu-sec"><div class="edu-sec-head"><h2>' + esc(s.title) + '</h2>'
        + '<span class="n num">' + s.items.length + '건</span></div>'
        + '<p class="edu-sec-note">' + esc(s.note) + '</p>'
        + s.items.map(cardHtml).join('') + '</section>').join('')
      + '<div class="edu-note"><b>교육 추가·수정 제보</b>'
      + '기관명·과정명·공식 페이지 주소를 남겨 주세요. 확인 후 반영합니다. '
      + '주거 현장의 모든 공종이 대상입니다.'
      + '<div class="edu-actions"><a class="btn-line" href="/board/free/?form=edu_tip">제보하기</a></div></div>';
    bind();
  }

  function bind() {
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    on('fWork', 'change', (e) => setFilter('work', e.target.value));
    on('fRegion', 'change', (e) => setFilter('region', e.target.value));
    on('fStatus', 'change', (e) => setFilter('status', e.target.value));
    on('fTarget', 'change', (e) => setFilter('target', e.target.value));
    on('fCost', 'change', (e) => setFilter('cost', e.target.value));
    on('fReset', 'click', () => {
      history.replaceState(null, '', location.pathname);
      render();
    });
    panel.querySelectorAll('[data-save]').forEach((b) =>
      b.addEventListener('click', () => onSave(b)));
    const since = $('rSince');
    if (since) since.addEventListener('change', (e) => { reviewMonths = e.target.value; render(); });
  }

  // 교육 카드 ↔ 글 연결 (SPEC §3.8). 데이터가 있을 때만 링크한다.
  // 게시판은 회원 전용이므로 비회원은 아예 호출하지 않고, 조회하지 못한 상태를
  // "후기 0건"으로 바꿔 쓰지 않는다 (refCounts === null 유지).
  //
  // 전역 상태를 직접 쓰지 않고 값만 돌려준다. 로그아웃 뒤 늦게 끝난 이전 회원 요청이
  // refCounts를 되살리면, 다음 필터 조작에서 남의 데이터가 다시 나타난다.
  // eduId가 있으면 그 과정만 서버에서 걸러 온다. 전체 최신 200건을 받아
  // 과정별 전체 후기처럼 보여 주면 실제보다 적게 세는 일이 생긴다.
  async function fetchRefCounts(session, eduId) {
    if (!session) return null;
    let r;
    try {
      r = await C().readPosts((q) => {
        let x = q.eq('ref_type', 'edu');
        if (eduId) x = x.eq('ref_id', eduId);
        return x.limit(200);
      });
    } catch (e) { console.warn(e); return null; }
    if (!r || r.error || r.mode !== 'view') return null;
    const m = new Map();
    r.rows.forEach((p) => {
      if (!p.ref_id) return;
      const b = m.get(p.ref_id) || { total: 0, review: 0, rows: [] };
      b.total += 1;
      if (p.review_kind === 'review') { b.review += 1; b.rows.push(p); }
      m.set(p.ref_id, b);
    });
    return m;
  }

  addEventListener('DOMContentLoaded', async () => {
    try {
      const res = await fetch('/assets/data/education.json', { cache: 'no-cache' });
      DATA = await res.json();
    } catch (e) {
      panel.innerHTML = '<div class="edu-note"><b>교육 목록을 불러오지 못했습니다</b>잠시 후 새로고침 해주세요.</div>';
      console.error(e);
      return;
    }
    updateStats();
    $('eduSub').textContent = '내게 맞는 기술 교육을 조건별로 찾아보세요.';

    // 원장만으로 먼저 그린다(비회원도 즉시 열람). 단, 자동 수집 과정 딥링크(?id=AUTO-…)는
    // 원장에 없으니 먼저 그리면 '찾을 수 없음'이 잠깐 뜬다 → 자동 수집분을 받은 뒤 그린다.
    if (!/^AUTO-/.test(qs().get('id') || '')) render();
    AUTO = await loadAuto();        // 자동 수집분이 오면 합쳐서 다시 그린다
    updateStats();
    render();
    await refreshMember(await ainAuth.getSession());
  });

  // 집계는 화면에 실제로 실린 것만 센다 (원장 + 자동 수집).
  function updateStats() {
    const listed = L.listed(allItems());
    $('statEdu').textContent = listed.length;
    $('statOrg').textContent = new Set(listed.map((i) => i.org)).size;
    // 시각 기준으로 — 마감이 지난 회차를 '접수 마감 명시'로 세지 않는다
    $('statDeadline').textContent = listed
      .filter((i) => L.sectionOf(i, Date.now()) === 'deadline').length;
  }

  async function refreshMember(session) {
    const my = ++gen;
    // 세션이 바뀐 순간 회원 상태를 먼저 비운다 — 늦게 오는 응답을 기다리는 동안
    // 이전 회원의 저장 표시·연결 건수가 화면에 남아 있으면 안 된다.
    saves = null;
    refCounts = null;
    render();
    const [nextSaves, nextRefs] = await Promise.all([
      C().loadSaves(),
      fetchRefCounts(session, qs().get('id'))
    ]);
    if (my !== gen) return;         // 그 사이 로그인·로그아웃이 있었으면 값을 버린다
    saves = nextSaves;
    refCounts = nextRefs;
    render();
  }

  addEventListener('ain:auth', (e) => refreshMember(e.detail && e.detail.session));
})();
