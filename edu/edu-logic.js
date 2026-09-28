// 교육 목록의 순수 로직 — 섹션 분류 · 필터 · 재확인 필요 판정.
// 브라우저(window.ainEduLogic)와 node(require) 양쪽에서 같은 코드를 쓴다.
// 검사: node tools/test-edu-logic.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ainEduLogic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 목록 섹션 — 미래 일정 / 지금 접수 / 자리 남음을 섞지 않는다 (SPEC §3.3).
  // 제목에 "지금 신청 가능"을 쓰지 않는다.
  const SECTIONS = [
    {
      key: 'deadline',
      title: '접수 마감일시 명시',
      note: '공고에 접수 마감일시가 적혀 있는 회차입니다. 마감일이 남아 있다는 것과 '
        + '지금 접수를 받는다는 것, 자리가 남았다는 것은 서로 다릅니다. '
        + '정원 표기는 잔여석이 아니고, 접수에 자격·서류 심사가 붙는 과정이 있습니다.'
    },
    {
      key: 'posted_no_deadline',
      title: '공고는 있으나 접수 마감 미확인',
      note: '회차 공고는 있지만 원문에서 접수 마감일을 확인하지 못했습니다. '
        + '신청 가능 여부는 기관에 확인이 필요합니다.'
    },
    {
      key: 'unconfirmed',
      title: '현재 모집 미확인',
      note: '일정이 게시되지 않았거나, 회차 날짜는 있어도 접수 마감이 확인되지 않은 과정입니다. '
        + '신청 가능 여부는 기관에 확인이 필요합니다.'
    },
    {
      key: 'expired',
      title: '접수 마감 경과',
      note: '원문에 적힌 접수 마감이 지났거나, 마감 표기 없이 원문이 적은 개강일이 지난 회차입니다. '
        + '기록으로 남겨 두며, 추가 접수 여부는 기관에 확인해야 합니다.'
    }
  ];

  // 마감 경과 판정 — 원문에서 마감이 하나로 확정된 회차(apply_end_at)만 대상.
  // 마감을 모르는 항목을 지났다고 단정하지 않는다 (SPEC §3.4).
  function isExpired(item, nowMs) {
    if (!item || !item.apply_end_at) return false;
    const t = Date.parse(item.apply_end_at);
    return !Number.isNaN(t) && t < (nowMs == null ? Date.now() : nowMs);
  }

  // 화면 섹션 = 원장의 group + 시각 기준 마감 경과.
  // 마감이 지난 회차는 '현재 모집' 섹션에서 빼되 목록에서 지우지 않는다.
  function sectionOf(item, nowMs) {
    return isExpired(item, nowMs) ? 'expired' : item.group;
  }

  const TARGET_LABELS = { beginner: '초보 가능', experience: '경력 필요', condition: '조건 있음', unknown: '경력 조건 미확인' };
  const COST_LABELS = { subsidy: '국비 표기 있음', self: '자비', free: '무료', unknown: '미확인' };

  // 최종 확인일이 오래된 항목 (SPEC §3.4 — 제안값 60일)
  const STALE_DAYS = 60;
  function isStale(checkedAt, todayISO, days) {
    if (!checkedAt) return false;
    const a = Date.parse(checkedAt + 'T00:00:00+09:00');
    const b = Date.parse(todayISO + 'T00:00:00+09:00');
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return (b - a) / 86400000 > (days == null ? STALE_DAYS : days);
  }

  // 목록에 실리는 것 = 교육 기록만. 채용 접점은 교육 집계에서 제외한다 (SPEC §3.2).
  const listed = (items) => items.filter((i) => i.group !== 'excluded');

  function matches(item, f, nowMs) {
    if (f.work && !(item.work_codes || []).includes(f.work)) return false;
    if (f.region && item.region_code !== f.region) return false;
    if (f.status && sectionOf(item, nowMs) !== f.status) return false;
    if (f.target && item.target_level !== f.target) return false;
    if (f.cost && item.cost_level !== f.cost) return false;
    return true;
  }

  // 정렬은 최신 확인일순만. 순위·점수·별점·추천 정렬을 만들지 않는다 (SPEC §3.6).
  function sortByChecked(rows) {
    return rows.slice().sort((a, b) =>
      String(b.checked_at || '').localeCompare(String(a.checked_at || ''))
      || String(a.id).localeCompare(String(b.id)));
  }

  function groupSections(items, f, nowMs) {
    const rows = sortByChecked(listed(items).filter((i) => matches(i, f || {}, nowMs)));
    return SECTIONS.map((s) => ({
      key: s.key, title: s.title, note: s.note,
      items: rows.filter((i) => sectionOf(i, nowMs) === s.key)
    })).filter((s) => s.items.length);
  }

  // 필터 선택지는 실제 데이터에서만 만든다 (없는 지역·업무를 띄우지 않는다)
  function optionsOf(items, key) {
    const set = new Set();
    listed(items).forEach((i) => {
      if (key === 'work') (i.work_codes || []).forEach((c) => set.add(c));
      else set.add(i[key]);
    });
    return [...set].filter(Boolean).sort();
  }

  return { SECTIONS, TARGET_LABELS, COST_LABELS, STALE_DAYS, isStale, isExpired, sectionOf,
    listed, matches, sortByChecked, groupSections, optionsOf };
}));
