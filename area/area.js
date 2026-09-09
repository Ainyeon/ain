// 내 지역 — 입주 예정 단지 + 확인된 모집 공고 요약 (SPEC §4).
// 게이팅은 현행 유지: 지역·입주월·건수는 비회원도, 단지명은 회원만.
(function () {
  'use strict';
  const C = () => window.ainCommunity;
  const db = () => ainAuth.getClient();
  const panel = document.getElementById('areaPanel');
  const esc = (v) => window.escT(v == null ? '' : v);
  const qs = () => new URLSearchParams(location.search);

  const REGIONS = [{ code: 'METRO', label: '수도권' }, { code: 'NATION', label: '전국' }];

  // 분모 정의 (SPEC ⑧) — 2026-09-09 읽기 전용 실측으로 확인한 집계 조건 그대로 적는다.
  // move_in_teaser / v_stat_movein = is_public = true AND expected_move_in >= CURRENT_DATE,
  // complex_name_ad 기준 중복 제거. 전체 수집 이력 건수가 아니다.
  const DENOM_NOTE = '분모: 공개 대상이면서 입주예정일이 오늘 이후인 단지를 단지명 기준으로 중복 제거한 수입니다. '
    + '전체 수집 이력 건수가 아닙니다. 출처: 청약홈 자동 수집.';

  let saves = null;
  let notices = null;
  // 공고 단지명은 회원 전용 (입주 단지와 같은 선). 공개 JSON에는 없고 회원만 조회한다.
  //   'anon'   = 비회원 → 로그인 안내
  //   'failed' = 회원인데 조회 실패 → 이미 로그인한 사람에게 재로그인을 권하지 않는다
  //   Map      = 조회 성공 (비어 있으면 아직 등록 안 된 것)
  let noticeNames = 'anon';
  let gen = 0;   // 요청 세대 — 로그아웃 뒤 늦게 온 회원 응답이 화면을 덮지 않게 한다

  const kstToday = () => {
    const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' }).formatToParts(new Date());
    const o = Object.fromEntries(p.map((x) => [x.type, x.value]));
    return o.year + '-' + o.month + '-' + o.day;
  };

  // ⑨ 월 단위 입주 예정일을 실제 날짜처럼 보이게 하지 않는다.
  // 파이프라인이 월만 아는 행을 YYYY-MM-01로 채우므로 -01은 "그 달" 이상을 뜻하지 않는다.
  const isMonthOnly = (v) => /-01$/.test(String(v || ''));
  function moveInLabel(v) {
    if (!v) return '입주월 확인 중';
    const s = String(v).slice(0, 10);
    return isMonthOnly(s)
      ? s.slice(0, 7).replace('-', '.') + ' 입주예정 (월 단위)'
      : s.replace(/-/g, '.') + ' 입주예정';
  }
  function ddayHtml(v) {
    if (!v) return '';
    if (isMonthOnly(v)) return '<span class="dday always">월 단위</span>';
    const n = Math.round((new Date(String(v).slice(0, 10) + 'T00:00:00+09:00')
      - new Date(kstToday() + 'T00:00:00+09:00')) / 864e5);
    if (n < 0) return '<span class="dday always">경과</span>';
    return '<span class="dday' + (n <= 7 ? ' urgent' : '') + ' num">' + (n === 0 ? 'D-day' : 'D-' + n) + '</span>';
  }

  const heartSvg = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';

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
    const on = saves && saves.has(C().saveKey(type, id));
    const r = on ? await C().removeSave(type, id)
                 : await C().addSave(type, id, btn.dataset.label, btn.dataset.meta);
    if (r.needLogin) {
      if (confirm('관심 저장은 회원 기능입니다. 카카오로 로그인할까요?')) C().loginWithKakao();
      return;
    }
    if (r.error) {
      alert('저장하지 못했습니다. 관심 저장 기능을 아직 쓸 수 없습니다.');
      console.error('saved_items', r.error);
      render();
      return;
    }
    saves = await C().loadSaves();
    render();
  }

  // ── 저장한 단지로 다시 찾기 (내 활동 → /area/?complex=<id>) ──
  // 지역·날짜 기본 필터를 태우지 않고 저장한 id로 바로 조회한다.
  // 비회원에게는 단지명을 보여 주지 않는다 (입주 단지와 같은 게이팅).
  async function focusComplexHtml(session, id) {
    const back = '<div class="edu-note"><a class="btn-line" href="/area/">입주 예정 단지 전체 보기</a></div>';
    if (!session) {
      return '<div class="edu-note"><b>저장한 단지</b>'
        + '단지명은 회원에게 공개됩니다. 로그인하면 저장한 단지로 바로 돌아옵니다.'
        + '<div class="edu-actions"><button type="button" class="btn-line" id="areaLogin">카카오 3초 로그인</button></div></div>'
        + back;
    }
    // 공개 조건은 서버에서 건다 — 공개 대상에서 빠진 단지는 이름 자체를 응답으로 받지 않는다.
    // 지역·날짜 기본 필터는 넣지 않는다(저장한 단지가 그 때문에 탈락하면 안 되므로).
    const { data, error } = await db().from('move_in_complexes')
      .select('id,complex_name_raw,complex_name_ad,sido,sigungu,stage,expected_move_in')
      .eq('id', id).eq('is_public', true).limit(1);
    if (error) {
      return '<div class="edu-note"><b>지금은 확인할 수 없습니다</b>'
        + '잠시 후 다시 시도해 주세요.</div>' + back;
    }
    const row = (data || [])[0];
    if (!row) {
      // 삭제·비공개 전환 등으로 더 이상 볼 수 없는 경우 — 무엇이 없어졌는지 알리고
      // 저장 목록에서 뺄 수 있게 한다 (저장만 남아 계속 헛걸음하지 않도록).
      return '<div class="edu-note"><b>저장한 단지를 더 이상 볼 수 없습니다</b>'
        + '공개 대상에서 빠졌거나 자료가 정리된 단지입니다.'
        + '<div class="edu-actions">' + saveBtn('complex', id, '저장한 단지', '') + '</div></div>'
        + back;
    }
    const name = row.complex_name_ad || row.complex_name_raw;
    const loc = [row.sido, row.sigungu].filter(Boolean).join(' ');
    return '<div class="edu-note"><b>저장한 단지</b>내 활동에서 저장해 둔 단지입니다.</div>'
      + '<article class="edu-card">'
      + '<div class="edu-tags">' + ddayHtml(row.expected_move_in)
      + (row.stage ? '<span class="edu-tag">' + esc(row.stage) + '</span>' : '') + '</div>'
      + '<h3>' + esc(name) + '</h3>'
      + '<div class="edu-org">' + esc(loc) + '</div>'
      + '<div class="edu-line">' + esc(moveInLabel(row.expected_move_in)) + '</div>'
      + '<div class="edu-actions">' + saveBtn('complex', row.id, name, loc) + '</div>'
      + '</article>' + back;
  }

  // ── 입주 예정 단지 ──
  async function complexHtml(session, region) {
    const tabs = '<div class="edu-filters">'
      + '<div class="edu-frow"><div class="edu-f"><label for="fRegion">지역</label>'
      + '<select id="fRegion">'
      + REGIONS.map((r) => '<option value="' + r.code + '"' + (r.code === region ? ' selected' : '') + '>'
        + r.label + '</option>').join('')
      + '</select></div></div>'
      + '<div class="edu-fbar"><span class="edu-sort">입주 임박순</span></div></div>';

    if (!session) {
      const { data, error } = await db().from('move_in_teaser')
        .select('region,sido,sigungu,move_in_month,stage,total_count');
      if (error) return tabs + '<div class="edu-note"><b>입주 정보를 불러오지 못했습니다</b>잠시 후 새로고침 해주세요.</div>';
      const rows = (data || []).filter((r) => r.region === region);
      const total = data && data.length ? Number(data[0].total_count) || 0 : 0;
      return tabs
        + '<div class="edu-note"><b>추적 중인 입주 예정 단지 ' + total.toLocaleString('ko-KR') + '건</b>' + esc(DENOM_NOTE) + '</div>'
        + (rows.length ? rows.map((r) =>
          '<article class="edu-card">'
          + '<h3><svg class="icon sm"><use href="#i-lock"/></svg> 단지명 — 로그인 후 확인</h3>'
          + '<div class="edu-org">' + esc([r.sido, r.sigungu].filter(Boolean).join(' ') || (region === 'METRO' ? '수도권' : '전국')) + '</div>'
          + '<div class="edu-line">' + esc(r.move_in_month || '입주월 확인 중') + ' 입주예정 (월 단위)</div>'
          + (r.stage ? '<div class="edu-line"><span class="edu-k">단계</span>' + esc(r.stage) + '</div>' : '')
          + '<div class="edu-line" style="color:var(--c-ink-faint)">사검일정 미정 · 행사일정 미정</div>'
          + '</article>').join('')
          : '<div class="edu-note">이 지역에서 공개할 단지가 없습니다.</div>')
        + '<div class="edu-note"><b>단지명은 회원에게 공개됩니다</b>'
        + '<div class="edu-actions"><button type="button" class="btn-line" id="areaLogin">카카오 3초 로그인</button></div></div>';
    }

    const { data, error } = await db().from('move_in_complexes')
      .select('id,complex_name_raw,complex_name_ad,sido,sigungu,stage,expected_move_in')
      .eq('region', region).eq('is_public', true).gte('expected_move_in', kstToday())
      .order('expected_move_in', { ascending: true }).limit(60);
    if (error) return tabs + '<div class="edu-note"><b>입주 정보를 불러오지 못했습니다</b>잠시 후 새로고침 해주세요.</div>';

    // 집계 분모와 같은 기준으로 화면에서도 단지명 중복을 제거한다
    const seen = new Set();
    const rows = (data || []).filter((r) => {
      const k = String(r.complex_name_ad || r.complex_name_raw || '').trim().toLowerCase();
      return k && !seen.has(k) && seen.add(k);
    });

    return tabs
      + '<div class="edu-note"><b>' + rows.length + '건</b>' + esc(DENOM_NOTE) + '</div>'
      + (rows.length ? rows.map((r) => {
        const name = r.complex_name_ad || r.complex_name_raw;
        const loc = [r.sido, r.sigungu].filter(Boolean).join(' ');
        return '<article class="edu-card">'
          + '<div class="edu-tags">' + ddayHtml(r.expected_move_in)
          + (r.stage ? '<span class="edu-tag">' + esc(r.stage) + '</span>' : '') + '</div>'
          + '<h3>' + esc(name) + '</h3>'
          + '<div class="edu-org">' + esc(loc) + '</div>'
          + '<div class="edu-line">' + esc(moveInLabel(r.expected_move_in)) + '</div>'
          + '<div class="edu-actions">'
          + saveBtn('complex', r.id, name, loc) + '</div>'
          + '</article>';
      }).join('') : '<div class="edu-note">이 지역에서 예정된 입주 단지가 없습니다.</div>')
      + '<div class="edu-note"><a class="btn-line" href="/calendar/">단계별 입주 캘린더 보기</a></div>';
  }

  // 전역 상태를 직접 쓰지 않고 값만 돌려준다 — 로그아웃 뒤 늦게 끝난 이전 회원 요청이
  // 단지명을 되살리면 비회원 화면에 회원 전용 값이 다시 나타난다.
  async function fetchNoticeNames(session) {
    if (!session) return 'anon';
    if (!notices || !notices.items.length) return new Map();
    const { data, error } = await db().from('notice_complexes')
      .select('notice_id,complex_name')
      .in('notice_id', notices.items.map((n) => n.id));
    return error ? 'failed'
      : new Map((data || []).map((r) => [r.notice_id, r.complex_name]));
  }

  function complexNameHtml(id) {
    const k = '<div class="edu-line"><span class="edu-k">단지명</span>';
    if (noticeNames === 'anon') {
      return k + '<svg class="icon sm"><use href="#i-lock"/></svg> 로그인 후 확인</div>';
    }
    if (noticeNames === 'failed') {
      return k + '지금은 확인할 수 없습니다 — 잠시 후 다시 시도해 주세요</div>';
    }
    const name = noticeNames.get(id);
    return k + (name ? esc(name) : '아직 등록되지 않았습니다') + '</div>';
  }

  // ── 모집 공고 ──
  function noticeHtml() {
    if (!notices || !notices.items.length) {
      return '<div class="edu-note"><b>확인된 모집 공고가 없습니다</b>'
        + '운영자가 원문을 확인한 공고만 싣습니다.</div>';
    }
    return '<div class="edu-note"><b>확인된 모집 공고 ' + notices.items.length + '건</b>'
      + '필요한 사실 요약과 원문 링크를 싣습니다. '
      + '담당자 이메일·전화·QR는 원문에서 확인하세요.</div>'
      + notices.items.map((n) =>
        '<article class="edu-card">'
        + '<div class="edu-tags">'
        + (n.deadline_passed ? '<span class="edu-tag">마감 경과</span>' : '')
        + '<span class="edu-tag">현재 접수 여부 미확인</span></div>'
        + '<h3>' + esc(n.title) + ' · ' + esc(n.region_raw) + '</h3>'
        + '<div class="edu-org">주관사 ' + esc(n.host) + ' · ' + esc(n.households) + '</div>'
        + complexNameHtml(n.id)
        + '<div class="edu-line"><span class="edu-k">게시일</span>' + esc(n.posted_raw) + '</div>'
        + '<div class="edu-line"><span class="edu-k">접수기간</span>' + esc(n.apply_end_raw) + '</div>'
        + '<div class="edu-line"><span class="edu-k">입주예정</span>' + esc(n.move_in_raw) + '</div>'
        + '<div class="edu-line"><span class="edu-k">행사</span>' + esc(n.event_raw) + '</div>'
        + '<div class="edu-warn"><span>⚠ ' + esc(n.status_label) + '</span>'
        + '<span class="sub">' + esc(n.after_deadline_raw) + ' — 원문 표기 그대로입니다.</span></div>'
        + '<div class="edu-line">요구 항목: '
        + esc(n.requirements.map((r) => r.label + ' ' + r.count).join(' · ')) + '</div>'
        + '<details><summary class="btn-line" style="display:inline-flex;margin:8px 0">요약 자세히</summary>'
        + n.requirements.map((r) =>
          '<div class="edu-block"><h4>' + esc(r.label) + ' ' + r.count + '항</h4>'
          + r.lines.map((l) => '<div class="edu-line">· ' + esc(l) + '</div>').join('') + '</div>').join('')
        + '<div class="edu-block"><h4>모르는 항목</h4><div class="edu-line">' + esc(n.unknowns) + '</div></div>'
        + '</details>'
        + '<div class="edu-line" style="color:var(--c-ink-faint)">ⓘ ' + esc(n.scope_note) + '</div>'
        + '<div class="edu-line" style="color:var(--c-ink-faint)">최종 확인 ' + esc(notices.checked_at) + '</div>'
        + '<div class="edu-actions">'
        + (n.url ? '<a class="btn-src" href="' + esc(n.url) + '" target="_blank" rel="noopener">공고 원문<svg class="icon sm"><use href="#i-ext"/></svg></a>' : '')
        + (n.url_image ? '<a class="btn-src" href="' + esc(n.url_image) + '" target="_blank" rel="noopener">첨부 이미지<svg class="icon sm"><use href="#i-ext"/></svg></a>' : '')
        + saveBtn('notice', n.id, n.title + ' · ' + n.region_raw, n.host) + '</div>'
        + '</article>').join('');
  }

  // ── 렌더 ──
  let session = null;
  let renderGen = 0;   // 렌더 세대 — 늦게 끝난 단지 조회가 최신 화면을 덮지 않게 한다
  async function render() {
    const my = ++renderGen;
    const mySession = session;
    const p = qs();
    const tab = p.get('tab') === 'notice' ? 'notice' : 'complex';
    const region = p.get('region') === 'NATION' ? 'NATION' : 'METRO';
    const focusId = p.get('complex');
    document.querySelectorAll('#areaTabs a').forEach((a) =>
      a.classList.toggle('on', a.getAttribute('href').indexOf(tab) > -1));
    panel.innerHTML = '<div class="empty">불러오는 중</div>';
    // complexHtml은 회원/비회원에 따라 다른 테이블을 읽는다. await 하는 동안
    // 로그아웃하거나 지역을 다시 바꾸면 이 결과는 버려야 한다 —
    // 그러지 않으면 로그인 시절 단지명이나 이전 지역 결과가 화면에 남는다.
    const html = tab === 'notice' ? noticeHtml()
      : focusId ? await focusComplexHtml(mySession, focusId)
      : await complexHtml(mySession, region);
    if (my !== renderGen || mySession !== session) return;
    panel.innerHTML = html;

    const sel = document.getElementById('fRegion');
    if (sel) sel.addEventListener('change', () => {
      const q = qs(); q.set('region', sel.value); q.set('tab', 'complex');
      history.replaceState(null, '', location.pathname + '?' + q);
      render();
    });
    const lg = document.getElementById('areaLogin');
    if (lg) lg.addEventListener('click', () => C().loginWithKakao());
    panel.querySelectorAll('[data-save]').forEach((b) =>
      b.addEventListener('click', () => onSave(b)));
  }

  addEventListener('DOMContentLoaded', async () => {
    try {
      notices = await (await fetch('/assets/data/notices.json', { cache: 'no-cache' })).json();
    } catch (e) { notices = { items: [], checked_at: '' }; console.warn(e); }
    await refreshMember(await ainAuth.getSession());
  });

  async function refreshMember(next) {
    const my = ++gen;
    session = next;
    // 세션이 바뀐 순간 회원 상태를 먼저 비우고 다시 그린다
    saves = null;
    noticeNames = 'anon';
    render();
    const [nextSaves, nextNames] = await Promise.all([
      C().loadSaves(),
      fetchNoticeNames(next)
    ]);
    if (my !== gen) return;                  // 그 사이 세션이 바뀌었으면 값을 버린다
    saves = nextSaves;
    noticeNames = nextNames;
    render();
  }

  addEventListener('ain:auth', (e) => refreshMember(e.detail && e.detail.session));
})();
