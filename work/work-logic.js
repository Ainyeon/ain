// 에인연 업무 — 순수 로직 (금액·수금·날짜·재방문·지역·문자·CSV·붙여넣기 해석).
// 브라우저(window.ainWorkLogic)와 node(require) 양쪽에서 같은 코드를 쓴다.
// 검사: node tools/test-work-logic.js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ainWorkLogic = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── 요금제. 기록(작업·고객·일정·수금·시공 카드)은 요금제로 막지 않는다.
  //    서버 강제: 사진 보관(supabase/17_work.sql work_photos_before_insert). 베타 종료 시각은 SQL work_user_is_pro()와 같아야 한다.
  const PLAN = {
    pro: { photosPerJob: 30, photosPerMonth: 1000 },
    priceWon: 19900,                            // 정식 과금 예정가 (VAT 포함). 과금 개시 전 별도 동의
    betaEnd: '2027-05-01T00:00:00+09:00'        // 이 시각 전까지 전원 프로. 끝나면 무료로 돌아간다(자동 결제 없음)
  };

  const STATUS = [
    { id: 'inquiry', label: '문의' },
    { id: 'quote', label: '견적' },
    { id: 'booked', label: '예약' },
    { id: 'done', label: '완료' },
    { id: 'canceled', label: '취소' }
  ];
  const STATUS_LABEL = Object.fromEntries(STATUS.map((s) => [s.id, s.label]));

  const WORK_TYPES = [
    { id: 'install', label: '설치', min: 240 },
    { id: 'clean', label: '세척·청소', min: 90 },
    { id: 'repair', label: '수리', min: 60 },
    { id: 'inspect', label: '점검', min: 60 },
    { id: 'as', label: 'AS', min: 60 },
    { id: 'move', label: '이전·철거', min: 180 },
    { id: 'etc', label: '기타', min: 60 }
  ];
  const WORK_TYPE_LABEL = Object.fromEntries(WORK_TYPES.map((s) => [s.id, s.label]));
  const durationOf = (j) => (j && j.duration_min) || (WORK_TYPES.find((t) => t.id === (j && j.work_type)) || WORK_TYPES[6]).min;

  // 유입 경로 — 경로별 매출을 보면 광고비(숨고 등) 대비 판단이 선다
  const SOURCES = [
    { id: 'direct', label: '직접 문의' }, { id: 'repeat', label: '단골·재방문' }, { id: 'referral', label: '소개' },
    { id: 'soomgo', label: '숨고' }, { id: 'danggeun', label: '당근' }, { id: 'blog', label: '블로그·검색' },
    { id: 'order', label: '넘겨받은 일' }, { id: 'etc', label: '기타' }
  ];
  const SOURCE_LABEL = Object.fromEntries(SOURCES.map((s) => [s.id, s.label]));
  const PAY_METHODS = [{ id: 'transfer', label: '이체' }, { id: 'cash', label: '현금' }, { id: 'card', label: '카드' }, { id: 'etc', label: '기타' }];
  const PAY_LABEL = Object.fromEntries(PAY_METHODS.map((s) => [s.id, s.label]));
  const UNITS = ['대', '개', 'm', '평', '식', '회'];

  // 공종별 품목 빠른 선택 [이름, 단위]. 단가는 내가 마지막에 쓴 값으로 채운다(lastPrices).
  const ITEM_PRESETS = {
    ac: [['벽걸이', '대'], ['스탠드', '대'], ['2in1', '식'], ['시스템 1way', '대'], ['시스템 2way', '대'], ['시스템 4way', '대'],
      ['360 원형', '대'], ['실외기', '대'], ['배관 추가', 'm'], ['앵글·거치대', '개'], ['타공', '회'], ['진공·가스 충전', '회'],
      ['고소 작업', '식'], ['철거', '대']],
    clean: [['입주청소', '평'], ['이사청소', '평'], ['베란다', '식'], ['새집증후군', '평'], ['줄눈(욕실)', '식'], ['줄눈(현관)', '식'], ['탄성코트', '식']],
    interior: [['도배', '평'], ['장판', '평'], ['마루', '평'], ['필름', 'm'], ['타일', '식'], ['실리콘', '식'], ['철거', '식'], ['자재비', '식'], ['인건비', '식']],
    etc: [['출장비', '회'], ['자재비', '식'], ['인건비', '식'], ['기타', '식']]
  };
  function presetKey(field) {
    if (!field) return 'etc';
    if (/^ac-|duct|panel|vent|boiler/.test(field)) return 'ac';
    if (/clean|grout|silicone|mold/.test(field)) return 'clean';
    if (/interior|paper|floor|film|tile|paint|carpentry|sash|pipe|waterproof/.test(field)) return 'interior';
    return 'etc';
  }
  // 작업유형별 확인 항목 (리포트·시공 카드에 찍혀 보증·AS 분쟁의 근거가 된다)
  const CHECKLISTS = {
    'ac:install': ['배관 길이(m)', '진공 시간(분)', '가스 압력(psi)', '누설 확인', '배수 확인', '시운전'],
    'ac:clean': ['분해 범위', '사용 약품', '배수 확인', '냄새 확인', '시운전'],
    'ac:repair': ['증상', '원인', '조치', '시운전'],
    'ac:as': ['증상', '원인', '조치', '시운전'],
    'clean:clean': ['범위', '사용 약품', '마감 확인'],
    'interior:install': ['자재', '마감 확인', '잔재 정리']
  };
  function checklistFor(field, workType) {
    return CHECKLISTS[presetKey(field) + ':' + workType] || [];
  }

  // ── 금액 (원 단위 정수). 할인은 음수 단가 한 줄로.
  const toInt = (v) => {
    const n = Math.round(Number(String(v ?? '').replace(/[^0-9.-]/g, '')));
    return Number.isFinite(n) ? n : 0;
  };
  function cleanItems(items) {
    return (Array.isArray(items) ? items : [])
      .map((i) => {
        const o = {
          name: String(i && i.name || '').trim().slice(0, 60),
          model: String(i && i.model || '').trim().slice(0, 60),
          unit: String(i && i.unit || '').trim().slice(0, 6),
          qty: Math.max(0, toInt(i && i.qty)),
          price: toInt(i && i.price)
        };
        if (i && i.kind) o.kind = String(i.kind).slice(0, 40);
        return o;
      })
      .filter((i) => i.name || i.model || i.price);
  }
  // vat_mode: incl(부가세 포함가) / excl(별도 — 10% 더함) / none(부가세 없음·간이·면세)
  function totals(items, vatMode) {
    const subtotal = Math.max(0, cleanItems(items).reduce((s, i) => s + i.qty * i.price, 0));
    if (vatMode === 'excl') {
      const vat = Math.round(subtotal * 0.1);
      return { subtotal, supply: subtotal, vat, total: subtotal + vat };
    }
    if (vatMode === 'incl') {
      const supply = Math.round(subtotal / 1.1);
      return { subtotal, supply, vat: subtotal - supply, total: subtotal };
    }
    return { subtotal, supply: subtotal, vat: 0, total: subtotal };
  }
  function cleanPayments(p) {
    return (Array.isArray(p) ? p : [])
      .map((x) => ({ amount: Math.max(0, toInt(x && x.amount)), at: String(x && x.at || '').slice(0, 10), method: PAY_LABEL[x && x.method] ? x.method : 'etc' }))
      .filter((x) => x.amount > 0);
  }
  const paid = (job) => cleanPayments(job && job.payments).reduce((s, x) => s + x.amount, 0);
  function unpaid(job) {
    if (!job || job.status !== 'done') return 0;
    return Math.max(0, toInt(job.total_amount) - paid(job));
  }
  const won = (n) => toInt(n).toLocaleString('ko-KR') + '원';
  // 내가 마지막으로 쓴 단가 (품목 이름 기준, 최근 작업 우선)
  function lastPrices(jobs) {
    const out = {};
    [...(jobs || [])].sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
      .forEach((j) => cleanItems(j.items).forEach((i) => { if (i.name && i.price > 0 && !(i.name in out)) out[i.name] = i.price; }));
    return out;
  }

  // ── 날짜 (기기 로컬 = 한국 시간 가정)
  const pad = (n) => String(n).padStart(2, '0');
  function dayKey(d) {
    if (d == null || d === '') return '';
    const x = d instanceof Date ? d : new Date(d);
    if (isNaN(x)) return '';
    return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  }
  const monthKey = (d) => dayKey(d).slice(0, 7);
  const timeKey = (d) => { const x = new Date(d); return pad(x.getHours()) + ':' + pad(x.getMinutes()); };
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function addMonths(d, n) {
    const x = new Date(d);
    const day = x.getDate();
    x.setDate(1);
    x.setMonth(x.getMonth() + n);
    const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    x.setDate(Math.min(day, last));
    return x;
  }
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function fmtDay(d) {
    const x = new Date(d);
    return (x.getMonth() + 1) + '월 ' + x.getDate() + '일 (' + WEEK[x.getDay()] + ')';
  }
  function fmtTime(d, allDay) {
    if (allDay) return '종일';
    const x = new Date(d);
    const h = x.getHours();
    return (h < 12 ? '오전 ' : '오후 ') + ((h % 12) || 12) + ':' + pad(x.getMinutes());
  }
  // 날짜(YYYY-MM-DD) + 시각(HH:MM) → ISO. 로컬 시간으로 해석한다.
  function combineDateTime(date, time) {
    if (!date) return null;
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = (time || '09:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh || 0, mm || 0).toISOString();
  }
  // 달력 격자 (일요일 시작, 6주 고정)
  function monthGrid(year, month0) {
    const first = new Date(year, month0, 1);
    const start = addDays(first, -first.getDay());
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, w * 7 + i);
        row.push({ key: dayKey(d), day: d.getDate(), inMonth: d.getMonth() === month0, dow: d.getDay() });
      }
      weeks.push(row);
    }
    return weeks;
  }
  function groupByDay(jobs) {
    const map = {};
    (jobs || []).forEach((j) => {
      const k = j.scheduled_at ? dayKey(j.scheduled_at) : 'none';
      (map[k] = map[k] || []).push(j);
    });
    Object.values(map).forEach((list) => list.sort(byTime));
    return map;
  }
  function byTime(a, b) {
    const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
    const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
    if (!!a.all_day !== !!b.all_day && dayKey(a.scheduled_at) === dayKey(b.scheduled_at)) return a.all_day ? -1 : 1;
    return ta - tb;
  }
  // 같은 날 시간이 겹치는 예약 (취소·종일 제외)
  function overlaps(job, jobs) {
    if (!job || !job.scheduled_at || job.all_day) return [];
    const s = new Date(job.scheduled_at).getTime(), e = s + durationOf(job) * 60000;
    return (jobs || []).filter((o) => o.id !== job.id && o.scheduled_at && !o.all_day
      && o.status !== 'canceled' && o.status !== 'done' && (() => {
        const os = new Date(o.scheduled_at).getTime(), oe = os + durationOf(o) * 60000;
        return os < e && s < oe;
      })());
  }

  // 이달 요약: 완료 매출(완료일 기준), 완료 건수, 예약 건수, 미수금(기간 무관 전체)
  function monthSummary(jobs, ym) {
    let doneAmount = 0, doneCount = 0, bookedCount = 0, unpaidAmount = 0, unpaidCount = 0;
    (jobs || []).forEach((j) => {
      const when = j.completed_at || j.scheduled_at;
      if (j.status === 'done' && when && monthKey(when) === ym) { doneAmount += toInt(j.total_amount); doneCount++; }
      if (j.status === 'booked' && j.scheduled_at && monthKey(j.scheduled_at) === ym) bookedCount++;
      const u = unpaid(j);
      if (u > 0) { unpaidAmount += u; unpaidCount++; }
    });
    return { doneAmount, doneCount, bookedCount, unpaidAmount, unpaidCount };
  }
  // 최근 12개월 완료 매출 [{ym, amount, count}] (오래된 달 → 이번 달)
  function last12(jobs, today) {
    const base = new Date(today || Date.now());
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(monthKey(addMonths(new Date(base.getFullYear(), base.getMonth(), 1), -i)));
    const acc = Object.fromEntries(months.map((m) => [m, { ym: m, amount: 0, count: 0 }]));
    (jobs || []).forEach((j) => {
      if (j.status !== 'done') return;
      const m = monthKey(j.completed_at || j.scheduled_at);
      if (acc[m]) { acc[m].amount += toInt(j.total_amount); acc[m].count++; }
    });
    return months.map((m) => acc[m]);
  }
  // 부가세 신고 반기(1~6월 / 7~12월) 합계
  function halfYear(jobs, today) {
    const t = new Date(today || Date.now());
    const y = t.getFullYear(), h = t.getMonth() < 6 ? 1 : 2;
    let amount = 0, count = 0;
    (jobs || []).forEach((j) => {
      if (j.status !== 'done') return;
      const d = new Date(j.completed_at || j.scheduled_at);
      if (d.getFullYear() === y && (d.getMonth() < 6 ? 1 : 2) === h) { amount += toInt(j.total_amount); count++; }
    });
    return { label: y + '년 ' + (h === 1 ? '1~6월' : '7~12월'), amount, count };
  }
  // 유입 경로별 완료 매출 (최근 12개월)
  function bySource(jobs, today) {
    const from = monthKey(addMonths(new Date(today || Date.now()), -11));
    const acc = {};
    (jobs || []).forEach((j) => {
      if (j.status !== 'done') return;
      const m = monthKey(j.completed_at || j.scheduled_at);
      if (!m || m < from) return;
      const k = j.source || 'none';
      acc[k] = acc[k] || { source: k, label: SOURCE_LABEL[k] || '미기록', amount: 0, count: 0 };
      acc[k].amount += toInt(j.total_amount); acc[k].count++;
    });
    return Object.values(acc).sort((a, b) => b.amount - a.amount);
  }

  // 재방문: 고객별 마지막 완료일 + 주기. 오늘부터 windowDays 안에 오거나 지난 고객.
  // 이미 다음 예약이 잡혔거나, 미뤄 둔(revisit_snooze_until) 고객은 뺀다.
  function revisitDue(customers, jobs, today, windowDays) {
    const now = new Date(today || Date.now());
    const last = {}, upcoming = {};
    (jobs || []).forEach((j) => {
      if (!j.customer_id) return;
      if (j.status === 'done') {
        const t = new Date(j.completed_at || j.scheduled_at).getTime();
        if (!last[j.customer_id] || t > last[j.customer_id]) last[j.customer_id] = t;
      } else if ((j.status === 'booked' || j.status === 'quote') && j.scheduled_at && new Date(j.scheduled_at) >= addDays(now, -1)) {
        upcoming[j.customer_id] = true;
      }
    });
    const limit = addDays(now, windowDays == null ? 14 : windowDays);
    const todayKey = dayKey(now);
    return (customers || [])
      .filter((c) => c.revisit_months && last[c.id] && !upcoming[c.id]
        && !(c.revisit_snooze_until && String(c.revisit_snooze_until) > todayKey))
      .map((c) => ({ customer: c, lastDone: new Date(last[c.id]), due: addMonths(new Date(last[c.id]), c.revisit_months) }))
      .filter((r) => r.due <= limit)
      .sort((a, b) => a.due - b.due);
  }

  // ── 지역: 주소 첫 단어 → 짧은 시도 표기 (move_in_complexes와 같은 표기)
  const SIDO = {
    '서울': ['서울특별시', '서울시', '서울'], '부산': ['부산광역시', '부산시', '부산'], '대구': ['대구광역시', '대구시', '대구'],
    // "광주시"는 경기 광주시와 헷갈리므로 광역시 별칭에서 뺀다
    '인천': ['인천광역시', '인천시', '인천'], '광주': ['광주광역시', '광주'], '대전': ['대전광역시', '대전시', '대전'],
    '울산': ['울산광역시', '울산시', '울산'], '세종': ['세종특별자치시', '세종시', '세종'], '경기': ['경기도', '경기'],
    '강원': ['강원특별자치도', '강원도', '강원'], '충북': ['충청북도', '충북'], '충남': ['충청남도', '충남'],
    '전북': ['전북특별자치도', '전라북도', '전북'], '전남': ['전라남도', '전남'], '경북': ['경상북도', '경북'],
    '경남': ['경상남도', '경남'], '제주': ['제주특별자치도', '제주도', '제주']
  };
  const SIDO_ALIAS = {};
  Object.entries(SIDO).forEach(([k, arr]) => arr.forEach((a) => { SIDO_ALIAS[a] = k; }));
  const normSido = (s) => SIDO_ALIAS[String(s || '').trim()] || null;
  const SGG_RE = /^[가-힣]+(시|군|구)$/;
  function parseRegion(address) {
    const parts = String(address || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { sido: null, sigungu: null };
    const sido = normSido(parts[0]);
    const i = sido ? 1 : 0;
    let sigungu = parts[i] && SGG_RE.test(parts[i]) && parts[i].length <= 8 ? parts[i] : null;
    if (sigungu && /시$/.test(sigungu) && parts[i + 1] && /^[가-힣]+구$/.test(parts[i + 1])) sigungu = sigungu + ' ' + parts[i + 1];
    return { sido, sigungu };
  }

  // ── 표시·연락
  function maskName(name) {
    const chars = [...String(name || '').trim()];
    if (!chars.length) return '고객';
    if (chars.length <= 2) return chars[0] + '*';
    return chars[0] + '*'.repeat(chars.length - 2) + chars[chars.length - 1];
  }
  const digits = (p) => String(p || '').replace(/[^0-9]/g, '');
  // 저장용: 숫자만, 형식이 아니면 null (DB CHECK ^0[0-9]{8,10}$ 와 같다)
  const normPhone = (p) => { const d = digits(p); return /^0[0-9]{8,10}$/.test(d) ? d : null; };
  function fmtPhone(p) {
    const d = digits(p);
    if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    if (d.length === 10) return d.startsWith('02') ? '02-' + d.slice(2, 6) + '-' + d.slice(6) : d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    if (d.length === 9 && d.startsWith('02')) return '02-' + d.slice(2, 5) + '-' + d.slice(5);
    return String(p || '').trim();
  }
  const telHref = (p) => 'tel:' + digits(p);
  // iOS·안드로이드 공통으로 동작하는 형태 (?&body=)
  const smsHref = (p, body) => 'sms:' + digits(p) + '?&body=' + encodeURIComponent(body || '');
  const mapHref = (address) => 'https://map.kakao.com/link/search/' + encodeURIComponent(String(address || '').trim());
  const naverMapHref = (address) => 'https://map.naver.com/p/search/' + encodeURIComponent(String(address || '').trim());
  // 고객 찾기: 이름 일부 또는 전화 뒷자리
  function matchCustomer(c, q) {
    const s = String(q || '').trim();
    if (!s) return true;
    const d = digits(s);
    return String(c.name || '').includes(s) || String(c.address || '').includes(s) || (d.length >= 3 && digits(c.phone).includes(d));
  }
  const findByPhone = (customers, phone) => { const d = normPhone(phone); return d ? (customers || []).filter((c) => c.phone === d) : []; };

  // ── 문자 템플릿. {고객} {상호} {일시} {주소} {금액} {미수금} {계좌} {링크} 를 채운다. 업체가 설정에서 고칠 수 있다.
  const SMS_KINDS = [
    { id: 'remind', label: '방문 안내', text: '{고객}님 안녕하세요, {상호}입니다. {일시}에 방문 예정입니다. 변동 있으시면 편하게 연락 주세요.' },
    { id: 'arrive', label: '출발·도착', text: '{고객}님, {상호}입니다. 지금 출발해서 곧 도착합니다.' },
    { id: 'quote', label: '견적 안내', text: '{고객}님, {상호}입니다. 말씀하신 작업 견적은 {금액}입니다. 편하실 때 답 주시면 일정 잡아 드리겠습니다.' },
    { id: 'pay', label: '입금 요청', text: '{고객}님, {상호}입니다. 작업 대금 {미수금} 입금 부탁드립니다. {계좌}' },
    { id: 'done', label: '작업 완료', text: '{고객}님, 오늘 작업 마쳤습니다. 시공 내역과 AS 문의는 여기서 보실 수 있어요. {링크}' },
    { id: 'revisit', label: '재방문 안내', text: '{고객}님 안녕하세요, {상호}입니다. 지난번 작업하고 시간이 지나 점검·관리 시기를 안내드립니다. 편하신 날 알려 주세요.' }
  ];
  function smsText(kind, job, customer, biz, extra) {
    const custom = biz && biz.sms_templates && biz.sms_templates[kind];
    const base = custom || (SMS_KINDS.find((k) => k.id === kind) || SMS_KINDS[0]).text;
    const vars = {
      고객: customer && customer.name ? customer.name : '고객',
      상호: (biz && biz.biz_name) || '',
      일시: job && job.scheduled_at ? fmtDay(job.scheduled_at) + ' ' + fmtTime(job.scheduled_at, job.all_day) : '',
      주소: (job && job.address) || (customer && customer.address) || '',
      금액: job ? won(job.total_amount) : '',
      미수금: job ? won(unpaid(job) || job.total_amount) : '',
      계좌: (biz && biz.account) || '',
      링크: (extra && extra.link) || ''
    };
    return base.replace(/\{(고객|상호|일시|주소|금액|미수금|계좌|링크)\}/g, (_, k) => vars[k])
      .replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  }

  // 네이버 블로그용 후기 글 초안 (API 없이 작업 기록으로 조립)
  function blogDraft(job, customer, biz, fieldLabel) {
    const r = parseRegion(job.address || (customer && customer.address));
    const where = [r.sido, r.sigungu].filter(Boolean).join(' ');
    const items = cleanItems(job.items).filter((i) => i.price >= 0).map((i) => [i.name, i.model].filter(Boolean).join(' ') + (i.qty > 1 ? ' ' + i.qty + (i.unit || '') : ''));
    const checks = (job.checklist || []).filter((c) => c && c.value).map((c) => '- ' + c.label + ': ' + c.value);
    const title = [where, fieldLabel, WORK_TYPE_LABEL[job.work_type]].filter(Boolean).join(' ') + ' 후기';
    return [
      '[제목] ' + title,
      '',
      (job.completed_at ? fmtDay(job.completed_at) + ', ' : '') + (where ? where + '에서 ' : '') + (fieldLabel || '') + ' 작업을 했습니다.',
      items.length ? '작업 내용: ' + items.join(', ') : '',
      checks.length ? '\n작업 확인 항목\n' + checks.join('\n') : '',
      '\n(작업 전 사진)\n\n(작업 후 사진)\n',
      '문의: ' + ((biz && biz.biz_name) || '') + (biz && biz.phone ? ' ' + fmtPhone(biz.phone) : ''),
      '#' + [where.replace(/\s/g, ''), (fieldLabel || '').replace(/\s/g, ''), WORK_TYPE_LABEL[job.work_type] || ''].filter(Boolean).join(' #')
    ].filter((l) => l !== '').join('\n');
  }

  // ── 요금제 상태 (work_is_pro() + 내 subscriptions 행 → 화면용)
  function planView(isPro, sub, now) {
    const t = now ? new Date(now) : new Date();
    const inBeta = t < new Date(PLAN.betaEnd);
    const until = sub && sub.current_period_end && new Date(sub.current_period_end) > t ? new Date(sub.current_period_end) : null;
    const pro = !!isPro;
    return {
      isPro: pro, inBeta, until,
      label: !pro ? '무료' : until ? '프로' : inBeta ? '베타 프로' : '프로',
      betaEndLabel: (() => { const e = addDays(new Date(PLAN.betaEnd), -1); return e.getFullYear() + '년 ' + fmtDay(e).replace(/ \(.\)$/, ''); })()
    };
  }
  // 서버 오류 메시지 → 사람이 읽는 문장
  function limitMessage(err) {
    const m = String(err && (err.message || err) || '');
    if (m.includes('plan_photos')) return '사진 서버 보관은 프로 기능이에요. 무료에서는 기기 사진으로 리포트 이미지를 바로 만들 수 있어요.';
    if (m.includes('photo_limit_job')) return '작업 하나에 사진은 ' + PLAN.pro.photosPerJob + '장까지 보관할 수 있어요.';
    if (m.includes('photo_limit_month')) return '이번 달 사진 보관 한도(' + PLAN.pro.photosPerMonth + '장)를 넘었어요.';
    if (m.includes('rate_limited')) return '문의가 너무 자주 접수됐어요. 업체에 전화로 연락해 주세요.';
    if (m.includes('too_many_open')) return '처리 안 된 문의가 많아요. 업체에 전화로 연락해 주세요.';
    return null;
  }

  // ── 검증
  function validateJob(j) {
    const errs = [];
    if (!j.customer_id && !String(j.customer_name || '').trim() && !normPhone(j.customer_phone)) errs.push('고객 이름이나 전화번호를 적어 주세요.');
    if (j.customer_phone && !normPhone(j.customer_phone)) errs.push('전화번호 형식을 확인해 주세요.');
    if (j.status !== 'inquiry' && j.status !== 'quote' && !j.scheduled_at) errs.push('일정을 정해 주세요.');
    if (String(j.memo || '').length > 2000) errs.push('메모는 2,000자까지예요.');
    if (cleanItems(j.items).length > 50) errs.push('품목은 50줄까지예요.');
    return errs;
  }

  // ── 붙여넣기 해석: 카톡·문자·숨고 메시지에서 전화·날짜·시간·주소를 뽑는다
  function parsePaste(text, today) {
    const s = String(text || '');
    const out = {};
    const ph = s.match(/0\d{1,2}[\s.-]?\d{3,4}[\s.-]?\d{4}/);
    if (ph) out.phone = normPhone(ph[0]);
    const now = new Date(today || Date.now());
    let d = null;
    const md = s.match(/(\d{1,2})\s*[월/.]\s*(\d{1,2})\s*일?/);
    if (md && +md[1] >= 1 && +md[1] <= 12 && +md[2] >= 1 && +md[2] <= 31) {
      d = new Date(now.getFullYear(), +md[1] - 1, +md[2]);
      if (d < addDays(now, -60)) d.setFullYear(d.getFullYear() + 1);   // 12월에 받은 "1월 5일"은 내년
    } else if (/모레/.test(s)) d = addDays(now, 2);
    else if (/내일/.test(s)) d = addDays(now, 1);
    else if (/오늘/.test(s)) d = new Date(now);
    if (d) out.date = dayKey(d);
    const tm = s.match(/(오전|오후|아침|저녁|밤)?\s*(\d{1,2})\s*(?:시|:)\s*(반|\d{1,2})?\s*분?/);
    if (tm && !(md && tm.index === md.index)) {
      let h = +tm[2];
      const m = tm[3] === '반' ? 30 : tm[3] ? +tm[3] : 0;
      if ((tm[1] === '오후' || tm[1] === '저녁' || tm[1] === '밤') && h < 12) h += 12;
      if (!tm[1] && h >= 1 && h <= 6) h += 12;                         // "3시" = 오후 3시 (현장 관행)
      if (h <= 23 && m <= 59) out.time = pad(h) + ':' + pad(m);
    }
    const lines = s.split(/\n|,(?=\s*[가-힣])/).map((l) => l.trim()).filter(Boolean);
    const addr = lines.find((l) => (normSido(l.split(/\s+/)[0]) || /^[가-힣]+(시|군|구)\s/.test(l)) && /(동|로|길|읍|면|리|아파트|빌라|\d)/.test(l));
    if (addr) out.address = addr.replace(/^주소\s*[:：]?\s*/, '').slice(0, 200);
    const nm = s.match(/(?:성함|이름|고객)\s*[:：]?\s*([가-힣]{2,4})/);
    if (nm) out.name = nm[1];
    return out;
  }

  // ── CSV (엑셀에서 한글이 깨지지 않게 BOM)
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    // 스프레드시트 수식 주입 방지 (=, +, -, @로 시작하면 앞에 ' 를 붙인다)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(header, rows) {
    return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  }
  function jobsCsv(jobs, customersById, fieldLabels) {
    const fl = fieldLabels || {};
    const header = ['일정', '상태', '고객', '연락처', '주소', '공종', '작업', '품목', '합계', '받은 금액', '미수금', '수금 내역', '유입 경로', '넘긴·받은 업체', '소개 몫', '메모'];
    const rows = (jobs || []).map((j) => {
      const c = (customersById || {})[j.customer_id] || {};
      return [
        j.scheduled_at ? dayKey(j.scheduled_at) + ' ' + fmtTime(j.scheduled_at, j.all_day) : '',
        STATUS_LABEL[j.status] || j.status, c.name || '', fmtPhone(c.phone), j.address || '',
        fl[j.field] || j.field || '', WORK_TYPE_LABEL[j.work_type] || '',
        cleanItems(j.items).map((i) => [i.name, i.model].filter(Boolean).join(' ') + ' x' + i.qty + (i.unit || '')).join(' / '),
        toInt(j.total_amount), paid(j), unpaid(j),
        cleanPayments(j.payments).map((p) => p.at + ' ' + PAY_LABEL[p.method] + ' ' + p.amount).join(' / '),
        SOURCE_LABEL[j.source] || '', j.referral_party || '', j.referral_fee || '', j.memo || ''
      ];
    });
    return toCsv(header, rows);
  }
  function customersCsv(customers, jobs) {
    const lastDone = {};
    (jobs || []).forEach((j) => {
      if (j.status !== 'done' || !j.customer_id) return;
      const k = dayKey(j.completed_at || j.scheduled_at);
      if (!lastDone[j.customer_id] || k > lastDone[j.customer_id]) lastDone[j.customer_id] = k;
    });
    const header = ['이름', '연락처', '주소', '최근 작업일', '표시', '재방문 주기(개월)', '메모', '등록일'];
    const rows = (customers || []).map((c) => [c.name, fmtPhone(c.phone), c.address || '', lastDone[c.id] || '',
      c.tag === 'vip' ? 'VIP' : c.tag === 'caution' ? '주의' : '', c.revisit_months || '', c.memo || '', dayKey(c.created_at)]);
    return toCsv(header, rows);
  }

  // CSV 읽기 (따옴표·줄바꿈·BOM 처리). 엑셀은 "다른 이름으로 저장 → CSV UTF-8".
  function parseCsv(text) {
    const s = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some((c) => c.trim())) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c.trim())) rows.push(row);
    return rows;
  }
  // 머리글 이름으로 열 찾기 (브리젤·일반 명부·에인연 내보내기 공통)
  const IMPORT_COLS = {
    name: /^(이름|고객\s*명?|성함|고객\s*이름|상호|name)$/i,
    phone: /(연락처|전화|휴대폰|핸드폰|phone|mobile)/i,
    address: /(주소|현장|address)/i,
    memo: /(메모|비고|특이|note|memo)/i,
    last: /(최근|마지막|서비스\s*일|작업\s*일|시공\s*일|방문\s*일|날짜|date)/i,
    item: /(기기|품목|모델|제품|서비스\s*내용|작업\s*내용)/i,
    amount: /(금액|합계|결제|가격|amount)/i
  };
  function mapImport(rows) {
    if (!rows || rows.length < 2) return { cols: {}, customers: [], skipped: 0 };
    const head = rows[0].map((h) => String(h).trim().replace(/^'/, ''));
    const cols = {};
    Object.entries(IMPORT_COLS).forEach(([k, re]) => {
      const i = head.findIndex((h, idx) => re.test(h) && !Object.values(cols).includes(idx));
      if (i >= 0) cols[k] = i;
    });
    const get = (r, k) => (cols[k] == null ? '' : String(r[cols[k]] || '').trim().replace(/^'/, ''));
    const byPhone = {};
    const customers = [];
    let skipped = 0;
    rows.slice(1).forEach((r) => {
      const name = get(r, 'name').slice(0, 40);
      const phone = normPhone(get(r, 'phone'));
      if (!name && !phone) { skipped++; return; }
      const lastRaw = get(r, 'last').replace(/[./]/g, '-').match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      const last = lastRaw ? lastRaw[1] + '-' + pad(lastRaw[2]) + '-' + pad(lastRaw[3]) : null;
      const rec = {
        name: name || fmtPhone(phone), phone, address: get(r, 'address').slice(0, 200) || null,
        memo: get(r, 'memo').slice(0, 1000) || null, last, item: get(r, 'item').slice(0, 60) || null,
        amount: toInt(get(r, 'amount')) || 0
      };
      if (phone && byPhone[phone]) {                       // 같은 번호는 한 고객으로 합치고 최근 작업일은 늦은 쪽
        const p = byPhone[phone];
        if (rec.last && (!p.last || rec.last > p.last)) { p.last = rec.last; p.item = rec.item || p.item; p.amount = rec.amount || p.amount; }
        if (rec.memo && !String(p.memo || '').includes(rec.memo)) p.memo = [p.memo, rec.memo].filter(Boolean).join(' / ').slice(0, 1000);
        return;
      }
      if (phone) byPhone[phone] = rec;
      customers.push(rec);
    });
    return { cols, customers, skipped };
  }

  return {
    PLAN, STATUS, STATUS_LABEL, WORK_TYPES, WORK_TYPE_LABEL, durationOf, SOURCES, SOURCE_LABEL, PAY_METHODS, PAY_LABEL, UNITS,
    ITEM_PRESETS, presetKey, CHECKLISTS, checklistFor,
    toInt, cleanItems, totals, cleanPayments, paid, unpaid, won, lastPrices,
    dayKey, monthKey, timeKey, addDays, addMonths, fmtDay, fmtTime, combineDateTime, monthGrid, groupByDay, byTime, overlaps,
    monthSummary, last12, halfYear, bySource, revisitDue,
    SIDO, normSido, parseRegion,
    maskName, digits, normPhone, fmtPhone, telHref, smsHref, mapHref, naverMapHref, matchCustomer, findByPhone,
    SMS_KINDS, smsText, blogDraft, planView, limitMessage, validateJob, parsePaste,
    csvCell, toCsv, jobsCsv, customersCsv, parseCsv, mapImport
  };
}));
