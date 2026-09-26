// 에인연 업무 — 화면. 해시 라우팅(#today …), 데이터는 ainWorkStore, 계산은 ainWorkLogic.
// 보안: 사용자·고객·외부(AS 문의) 입력은 전부 textContent로만 그린다 (innerHTML 금지).
(function () {
  'use strict';
  const L = window.ainWorkLogic;
  const DOC = window.ainWorkDoc;
  const app = document.getElementById('app');
  const DEMO = new URLSearchParams(location.search).has('demo');
  const FIELD_LABELS = (window.ainCommunity && window.ainCommunity.FIELD_LABELS) || {};
  const FIELD_OPTIONS = Object.entries(FIELD_LABELS).filter(([k]) => !['paper-floor', 'tile-bath'].includes(k));
  const fieldLabel = (f) => FIELD_LABELS[f] || '';

  const S = { store: null, d: null, uid: null, gen: 0, myField: null, cal: null, jobFilter: 'all', q: '', cq: '', docPhotos: [] };

  // ── DOM 도우미 (문자열 → 텍스트 노드. HTML로 해석하지 않는다)
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'multiple', 'open'].includes(k)) el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c instanceof Node ? c : String(c)); });
    return el;
  }
  const icon = (id) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'icon'); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#i-' + id); s.appendChild(u);
    return s;
  };
  const btn = (label, onclick, cls, ic) => h('button', { type: 'button', class: 'w-btn ' + (cls || ''), onclick }, ic ? icon(ic) : null, label);
  const linkBtn = (label, href, cls, ic, ext) => h('a', { class: 'w-btn ' + (cls || ''), href, target: ext ? '_blank' : null, rel: ext ? 'noopener' : null }, ic ? icon(ic) : null, label);
  const panel = (title, ic, body, extra) => h('section', { class: 'panel' },
    h('div', { class: 'phead' }, ic ? icon(ic) : null, h('h2', { text: title }), extra ? h('div', { class: 'phead-meta' }, extra) : null), body);
  const empty = (b, t) => h('div', { class: 'empty' }, h('b', { text: b }), t || '');
  const field = (label, input, hint) => h('label', { class: 'w-field' }, h('span', { text: label }), input, hint ? h('small', { text: hint }) : null);
  const sel = (opts, value, props) => h('select', props || {}, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, t)));
  let toastTimer = null;
  function toast(msg) {
    document.querySelectorAll('.w-toast').forEach((t) => t.remove());
    const t = h('div', { class: 'w-toast', role: 'status', text: msg });
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), 2600);
  }
  function fail(e, fallback) {
    console.error(e);
    toast(L.limitMessage(e) || fallback || '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  const custOf = (id) => S.d.customers.find((c) => c.id === id) || null;
  const jobOf = (id) => S.d.jobs.find((j) => j.id === id) || null;
  const today = () => new Date();
  const plan = () => L.planView(S.d.isPro, S.d.sub);
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg || '복사했어요'); }
    catch (e) { window.prompt('길게 눌러 복사하세요', text); }
  }
  const cardLink = (token) => location.origin + '/c/#t=' + (token === 'demo' ? 'demo' : token);

  // ── 연락 버튼 (전화·문자·길찾기)
  function contactBar(phone, address, job, customer) {
    const bar = h('div', { class: 'w-quick' });
    if (phone) {
      bar.append(linkBtn('전화', L.telHref(phone), 'sm', 'phone'));
      bar.append(btn('문자', () => smsDialog(phone, job, customer), 'sm', 'msg'));
    }
    if (address) bar.append(linkBtn('길찾기', L.mapHref(address), 'sm', 'map', true));
    return bar;
  }
  function openDialog(title, body, foot) {
    const dlg = h('dialog', { class: 'w-dialog' },
      h('div', { class: 'dh' }, title, h('button', { type: 'button', class: 'w-btn sm', onclick: () => dlg.close() }, '닫기')),
      h('div', { class: 'db' }, body), foot ? h('div', { class: 'df' }, foot) : null);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
    return dlg;
  }
  async function smsDialog(phone, job, customer, only) {
    let link = '';
    const cust = customer || (job && custOf(job.customer_id));
    if (cust && cust.card_token && !S.store.isDemo) link = cardLink(cust.card_token);
    if (cust && S.store.isDemo) link = cardLink('demo');
    const kinds = L.SMS_KINDS.filter((k) => !only || only.includes(k.id));
    const list = h('div', { class: 'w-sms' }, kinds.map((k) => {
      const body = L.smsText(k.id, job, cust, S.d.profile, { link });
      return h('button', { type: 'button', onclick: async () => {
        let text = body;
        if (k.id === 'done' && cust && !cust.card_token) {                    // 완료 문자에는 시공 카드 링크를 붙인다
          try { const t = await S.store.issueCard(cust.id); cust.card_token = t; text = L.smsText('done', job, cust, S.d.profile, { link: cardLink(t) }); }
          catch (e) { fail(e, '시공 카드 링크를 만들지 못했어요'); }
        }
        location.href = L.smsHref(phone, text);
        dlg.close();
      } }, h('b', { text: k.label }), h('span', { text: body }));
    }));
    const dlg = openDialog('문자 보내기', [
      !S.d.profile.biz_name ? h('div', { class: 'w-warn' }, '상호가 비어 있어 모르는 번호처럼 보일 수 있어요. ', h('a', { href: '#settings', text: '업체 정보 넣기' })) : null,
      list, h('div', { class: 'w-note', text: '문자 앱이 열리고 내용이 채워집니다. 발송은 폰에서 직접 누르세요(비용 없음). 문구는 설정에서 고칠 수 있어요.' })]);
  }

  // ── 부팅·세션
  async function boot() {
    const gen = ++S.gen;
    app.replaceChildren(h('div', { class: 'empty', text: '불러오는 중' }));
    try {
      if (DEMO) {
        S.store = window.ainWorkStore.demoStore();
        S.uid = 'demo';
      } else {
        const session = await ainAuth.getSession();
        if (gen !== S.gen) return;
        if (!session) {
          forgetDevice(null);   // 다른 화면에서 로그아웃했어도 이 기기의 업무 흔적을 지운다
          S.store = null; S.uid = null; S.d = null; document.body.classList.remove('w-app'); renderLanding(); return;
        }
        S.uid = session.user.id;
        // 카카오 로그인 복귀 토큰은 getSession이 이미 읽었다 — 주소창에서 지운다
        if (/access_token/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
        S.store = window.ainWorkStore.supabaseStore(ainAuth.getClient(), S.uid);
        ainCommunity.getMyProfile().then((r) => { if (gen === S.gen) S.myField = r && r.profile && r.profile.field; }).catch(() => {});
      }
      const d = await S.store.load();
      if (gen !== S.gen) return;
      S.d = d;
      document.body.classList.add('w-app');
      route();
    } catch (e) {
      if (gen !== S.gen) return;
      console.error(e);
      const snap = S.store && S.store.offline && S.store.offline();
      if (snap && snap.jobs) { renderOffline(snap); return; }
      const missing = e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202');
      app.replaceChildren(empty(missing ? '업무 기능 준비 중입니다' : '불러오지 못했어요',
        missing ? '운영 DB 적용 전이에요. 체험 모드로 먼저 둘러보세요.' : '네트워크를 확인하고 새로고침 해 주세요.'),
      h('div', { class: 'w-actions' }, linkBtn('체험 모드로 보기', '/work/?demo=1', 'primary'), btn('다시 시도', boot)));
    }
  }
  // 전파가 없을 때: 마지막으로 불러온 오늘·내일 일정만 읽기 전용으로
  function renderOffline(snap) {
    const byId = Object.fromEntries((snap.customers || []).map((c) => [c.id, c]));
    const jobs = snap.jobs.slice().sort(L.byTime);
    app.replaceChildren(
      h('div', { class: 'w-warn', text: '연결이 안 돼서 ' + L.fmtDay(snap.at) + ' ' + L.fmtTime(snap.at) + '에 불러온 오늘·내일 일정만 보여 드려요. 수정은 연결된 뒤에 할 수 있어요.' }),
      panel('오늘·내일 일정 (읽기 전용)', 'cal', jobs.length ? h('div', { class: 'rows' }, jobs.map((j) => {
        const c = byId[j.customer_id] || {};
        return h('div', { class: 'w-row' },
          h('div', { class: 'w-time num' }, h('b', { text: L.fmtTime(j.scheduled_at, j.all_day) }), L.fmtDay(j.scheduled_at).replace(/ \(.\)$/, '')),
          h('div', { class: 'w-main' }, h('div', { class: 'w-title', text: c.name || '고객' }), h('div', { class: 'w-meta', text: [j.address, j.memo].filter(Boolean).join(' · ') })),
          h('div', { class: 'w-side' }),
          h('div', { class: 'w-quick' }, c.phone ? linkBtn('전화', L.telHref(c.phone), 'sm', 'phone') : null));
      })) : empty('저장된 일정이 없어요')),
      h('div', { class: 'w-actions' }, btn('다시 연결', boot, 'primary')));
  }
  function renderLanding() {
    app.replaceChildren(
      panel('현장 업무, 폰 하나로', 'home', h('div', { class: 'w-hero' },
        h('p', { text: '오늘 갈 곳, 받을 돈, 다시 연락할 고객을 한 화면에서 봅니다. 견적서는 현장에서 1분, 작업이 끝나면 시공 카드 링크를 문자로 보내고, 고객의 AS 문의는 업무 화면으로 받습니다.' }),
        h('ul', { class: 'w-list' },
          h('li', { text: '오늘·내일 일정, 동선(구별), 겹치는 예약 경고' }),
          h('li', { text: '고객 장부 · 전화 뒷번호 검색 · 재방문 명단' }),
          h('li', { text: '견적서·작업 보고서 이미지 (카톡 공유·PDF)' }),
          h('li', { text: '수금 이력(계약금·잔금)과 미수금, 입금 요청 문자' }),
          h('li', { text: '시공 카드: 고객이 앱 없이 시공 이력 확인 + AS 문의' }),
          h('li', { text: '엑셀(CSV) 가져오기·내보내기 — 내 데이터는 언제든 가지고 나갑니다' })),
        h('div', { class: 'w-actions' },
          btn('카카오로 로그인하고 시작', () => ainAuth.getClient().auth.signInWithOAuth({ provider: 'kakao', options: { redirectTo: location.origin + '/work/' } }), 'primary'),
          linkBtn('로그인 없이 체험하기', '/work/?demo=1')),
        h('p', { class: 'w-note', text: '베타 기간(' + L.planView(true, null).betaEndLabel + '까지)에는 프로 기능까지 모두 무료입니다. 끝나도 자동으로 결제되지 않고 무료로 돌아갑니다. 작업·고객·일정·수금·시공 카드는 무료에서도 제한 없이 씁니다.' })))
    );
  }

  // ── 라우팅
  function parseHash() {
    const raw = location.hash.replace(/^#/, '');
    const [path, qs] = raw.split('?');
    return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
  }
  function route() {
    if (/access_token|error_description/.test(location.hash)) return;    // 카카오 로그인 복귀: supabase가 먼저 읽는다
    if (!S.d) return;
    document.querySelectorAll('dialog.w-dialog').forEach((d) => d.close());   // 뒤로 가기 등으로 화면이 바뀌면 창을 닫는다
    const { parts, q } = parseHash();
    const [name, a, b] = parts;
    const view = ({
      today: viewToday, calendar: viewCalendar, jobs: viewJobs, job: () => (a === 'new' ? viewJobForm(null, q) : b === 'edit' ? viewJobForm(jobOf(+a), q) : viewJob(jobOf(+a))),
      customers: viewCustomers, customer: () => (a === 'new' ? viewCustomerForm(null) : b === 'edit' ? viewCustomerForm(custOf(+a)) : viewCustomer(custOf(+a))),
      stats: viewStats, settings: viewSettings, import: viewImport
    })[name || 'today'] || viewToday;
    const out = view(a, q);
    app.replaceChildren(...[demoBar(), navBar(name || 'today'), out].flat().filter(Boolean));
    fab();
    window.scrollTo(0, 0);
  }
  function demoBar() {
    if (!S.store.isDemo) return null;
    return h('div', { class: 'w-demo' }, h('b', { text: '체험 모드' }), '예시 데이터입니다. 바꿔도 저장되지 않아요.',
      linkBtn('로그인하고 내 업무 시작', '/work/', 'primary sm'));
  }
  function navBar(cur) {
    const open = S.d.requests.filter((r) => !r.resolved_at).length;
    const items = [['today', '오늘', open], ['calendar', '일정'], ['jobs', '작업'], ['customers', '고객'], ['stats', '매출'], ['settings', '설정']];
    return h('nav', { class: 'w-nav', 'aria-label': '업무 메뉴' }, items.map(([k, t, n]) =>
      h('a', { href: '#' + k, class: (cur === k || (cur === 'job' && k === 'jobs') || (cur === 'customer' && k === 'customers') || (cur === 'import' && k === 'customers')) ? 'on' : null,
        'aria-current': cur === k ? 'page' : null }, t, n ? h('span', { class: 'dot', 'aria-label': 'AS 문의 ' + n + '건', text: String(n) }) : null)));
  }
  function fab() {
    document.querySelectorAll('.w-fab').forEach((x) => x.remove());
    const { parts } = parseHash();
    if (parts[0] === 'job' && (parts[1] === 'new' || parts[2] === 'edit')) return;
    if (parts[0] === 'customer' && (parts[1] === 'new' || parts[2] === 'edit')) return;
    if (parts[0] === 'settings' || parts[0] === 'import') return;
    document.body.appendChild(h('a', { class: 'w-fab', href: '#job/new' }, icon('plus'), '작업 등록'));
  }

  // ── 작업 한 줄
  function jobRow(j, opts) {
    const c = custOf(j.customer_id);
    const o = opts || {};
    const u = L.unpaid(j);
    const sd = j.scheduled_at && new Date(j.scheduled_at);
    const dayText = sd && (sd.getFullYear() === today().getFullYear() ? L.fmtDay(sd).replace(/ \(.\)$/, '') : sd.getFullYear() + '.' + (sd.getMonth() + 1) + '.' + sd.getDate());
    const when = j.scheduled_at ? (o.dateFirst ? [h('b', { text: dayText }), L.fmtTime(j.scheduled_at, j.all_day)]
      : [h('b', { text: L.fmtTime(j.scheduled_at, j.all_day) })]) : [h('b', { text: '미정' })];
    const items = L.cleanItems(j.items).filter((i) => i.price >= 0).map((i) => i.name + (i.qty > 1 ? ' ' + i.qty + (i.unit || '') : '')).join(', ');
    // 행 전체를 눌러도 열리게 하되(편의), 키보드·낭독기는 제목 링크로 연다
    const row = h('div', { class: 'w-row link', onclick: (e) => { if (!e.target.closest('a,button,select,label')) go('#job/' + j.id); } },
      h('div', { class: 'w-time num' }, when),
      h('div', { class: 'w-main' },
        h('a', { class: 'w-title', href: '#job/' + j.id }, j.sigungu ? h('span', { class: 'w-sgg', text: j.sigungu }) : null, c ? c.name : '(고객 미지정)',
          c && c.tag ? h('span', { class: 'w-tag ' + (c.tag === 'caution' ? 'caution' : ''), text: c.tag === 'vip' ? ' VIP' : ' 주의' }) : null),
        h('div', { class: 'w-meta', text: [fieldLabel(j.field), L.WORK_TYPE_LABEL[j.work_type], items].filter(Boolean).join(' · ') || (j.memo || '').slice(0, 40) })),
      h('div', { class: 'w-side' },
        u > 0 ? h('span', { class: 'w-st unpaid num', text: '미수 ' + L.won(u) }) : h('span', { class: 'num', text: j.total_amount ? L.won(j.total_amount) : '' }),
        h('span', { class: 'w-st ' + j.status, text: L.STATUS_LABEL[j.status] })));
    if (o.actions) {
      const bar = contactBar(c && c.phone, j.address, j, c);
      if (j.status === 'booked') bar.append(btn('완료', () => markDone(j), 'sm', 'check'));
      row.append(bar);
    }
    return row;
  }
  // 완료 시각: 작업일이 지났으면 그 날(매출 달·보증 시작이 작업일 기준), 아니면 지금
  const doneAt = (scheduled) => (scheduled && new Date(scheduled) < new Date() ? scheduled : new Date().toISOString());
  // 세척·설치를 마친 고객은 재방문 주기가 비어 있으면 12개월로 켠다 (다음 시즌 명단이 비지 않게)
  async function autoRevisit(j) {
    const c = custOf(j.customer_id);
    if (!c || c.revisit_months || !['clean', 'install'].includes(j.work_type)) return;
    try { Object.assign(c, await S.store.save('work_customers', { id: c.id, revisit_months: 12 })); } catch (e) { console.error(e); }
  }
  // 완료 → 한 창에서 수금·완료 문자(시공 카드)·보고서까지
  function markDone(j) {
    const c = custOf(j.customer_id);
    const left = Math.max(0, L.toInt(j.total_amount) - L.paid(j));
    const amt = h('input', { type: 'number', inputmode: 'numeric', class: 'w-in', value: left ? String(left) : '', 'aria-label': '받은 금액' });
    const meth = sel(L.PAY_METHODS.map((m) => [m.id, m.label]), 'transfer', { class: 'w-in', 'aria-label': '결제 수단' });
    const body = h('div', { class: 'w-form', style: { padding: 0 } },
      h('div', { class: 'w-title', text: (c ? c.name : '고객') + ' · 합계 ' + L.won(j.total_amount) }),
      field('지금 받은 금액 (없으면 비워 두세요)', amt), field('결제 수단', meth));
    const dlg = openDialog('작업 완료', body, [btn('완료 처리', async (e) => {
      e.currentTarget.disabled = true;
      const a = L.toInt(amt.value);
      const pays = L.cleanPayments(j.payments).concat(a > 0 ? [{ amount: a, method: meth.value, at: L.dayKey(today()) }] : []);
      try {
        Object.assign(j, await S.store.save('work_jobs', { id: j.id, status: 'done', completed_at: j.completed_at || doneAt(j.scheduled_at), payments: pays }));
        await autoRevisit(j);
      } catch (err) { fail(err); dlg.close(); return; }
      // 다음 할 일
      dlg.querySelector('.db').replaceChildren(h('div', { class: 'w-note', text: '완료했어요' + (L.unpaid(j) ? ' · 남은 금액 ' + L.won(L.unpaid(j)) : ' · 수금 완료') + '. 고객에게 시공 카드 링크를 보내 두면 다음 AS·재방문 문의가 나에게 옵니다.' }),
        h('div', { class: 'w-actions grid' },
          c && c.phone ? btn('완료 문자 보내기', () => { dlg.close(); smsDialog(c.phone, j, c, L.unpaid(j) > 0 ? ['done', 'pay'] : ['done']); }, 'primary', 'msg') : null,
          btn('작업 보고서 만들기', () => { dlg.close(); go('#job/' + j.id); setTimeout(() => showDoc('report', j), 50); }, '', 'doc')));
      dlg.querySelector('.df').replaceChildren(btn('닫기', () => { dlg.close(); route(); }));
    }, 'primary', 'check')]);
  }

  // ── 오늘
  function viewToday() {
    const now = today();
    const tk = L.dayKey(now), tmk = L.dayKey(L.addDays(now, 1));
    const by = L.groupByDay(S.d.jobs.filter((j) => j.status !== 'canceled'));
    const todayJobs = by[tk] || [], tomorrowJobs = by[tmk] || [];
    const sum = L.monthSummary(S.d.jobs, L.monthKey(now));
    const open = S.d.requests.filter((r) => !r.resolved_at);
    const unpaidJobs = S.d.jobs.filter((j) => L.unpaid(j) > 0).sort((a, b) => String(a.completed_at).localeCompare(String(b.completed_at)));
    const due = L.revisitDue(S.d.customers, S.d.jobs, now, 14);
    const inquiries = S.d.jobs.filter((j) => (j.status === 'inquiry' || j.status === 'quote') && !j.scheduled_at);
    const p = plan();
    const out = [];
    if (!S.store.isDemo && !S.d.profile.biz_name) out.push(setupCard());

    out.push(h('section', { class: 'panel' },
      h('div', { class: 'phead' }, icon('cal'), h('h2', { text: L.fmtDay(now) }),
        h('div', { class: 'phead-meta' }, h('span', { class: 'w-st ' + (p.isPro ? 'pro' : ''), text: p.label }))),
      h('div', { class: 'w-stats' },
        h('div', { class: 'w-stat' }, h('div', { class: 'n num', text: String(todayJobs.length) }), h('div', { class: 'l', text: '오늘 일정' })),
        h('div', { class: 'w-stat' }, h('div', { class: 'n num', text: String(tomorrowJobs.length) }), h('div', { class: 'l', text: '내일 일정' })),
        h('div', { class: 'w-stat' }, h('div', { class: 'n num', text: L.won(sum.doneAmount) }), h('div', { class: 'l', text: '이달 완료 매출 (' + sum.doneCount + '건)' })),
        h('div', { class: 'w-stat ' + (sum.unpaidAmount ? 'warn' : '') }, h('div', { class: 'n num', text: L.won(sum.unpaidAmount) }), h('div', { class: 'l', text: '미수금 (' + sum.unpaidCount + '건)' }))),
      h('div', { class: 'w-pad w-actions' }, linkBtn('작업 등록', '#job/new', 'primary', 'plus'), btn('문자·카톡 붙여넣어 등록', pasteDialog, '', 'msg'))));

    if (open.length) {
      out.push(panel('AS·재설치 문의', 'bell', h('div', { class: 'rows' }, open.map(requestRow)), h('span', { class: 'cnt num', text: String(open.length) })));
    }
    out.push(panel('오늘 일정', 'cal', todayJobs.length ? h('div', { class: 'rows' }, todayJobs.map((j) => jobRow(j, { actions: true })))
      : empty('오늘 잡힌 일정이 없어요', '작업 등록이나 붙여넣기로 일정을 넣어 보세요.'), h('a', { class: 'more', href: '#calendar', text: '달력' })));
    if (tomorrowJobs.length) out.push(panel('내일 일정', 'cal', h('div', { class: 'rows' }, tomorrowJobs.map((j) => jobRow(j, { actions: true })))));
    if (inquiries.length) out.push(panel('일정 미정 문의·견적', 'msg', h('div', { class: 'rows' }, inquiries.slice(0, 8).map((j) => jobRow(j)))));
    if (unpaidJobs.length) {
      out.push(panel('받을 돈', 'won', h('div', { class: 'rows' }, unpaidJobs.slice(0, 6).map((j) => {
        const c = custOf(j.customer_id);
        const days = j.completed_at ? Math.floor((now - new Date(j.completed_at)) / 86400000) : null;
        return h('div', { class: 'w-row' },
          h('div', { class: 'w-time num' }, h('b', { text: days != null ? days + '일' : '-' }), '경과'),
          h('div', { class: 'w-main' }, h('a', { class: 'w-title', href: '#job/' + j.id, text: (c ? c.name : '고객') + ' · ' + L.won(L.unpaid(j)) }),
            h('div', { class: 'w-meta', text: j.completed_at ? L.fmtDay(j.completed_at) + ' 완료' : '' })),
          h('div', { class: 'w-side' }, c && c.phone ? btn('입금 요청', () => { location.href = L.smsHref(c.phone, L.smsText('pay', j, c, S.d.profile)); }, 'sm', 'msg') : null));
      })), h('span', { class: 'cnt num', text: L.won(sum.unpaidAmount) })));
    }
    if (due.length) out.push(panel('다시 연락할 고객', 'user', h('div', { class: 'rows' }, due.slice(0, 8).map(revisitRow)), h('span', { class: 'cnt num', text: String(due.length) })));
    const nearby = h('div', { class: 'rows' }, h('div', { class: 'empty', text: '확인 중' }));
    out.push(panel('내 작업 지역 입주 예정 단지', 'home', nearby, h('a', { class: 'more', href: '/area/', text: '입주정보' })));
    loadNearby(nearby);
    return out;
  }
  // 처음 쓰는 사람: 견적서·문자에 찍힐 업체 정보 3칸부터
  function setupCard() {
    const nm = h('input', { type: 'text', class: 'w-in', placeholder: '상호 (예: 시원설비)', maxlength: 40, 'aria-label': '상호' });
    const ph = h('input', { type: 'tel', class: 'w-in', inputmode: 'tel', placeholder: '연락처', 'aria-label': '연락처' });
    const ac = h('input', { type: 'text', class: 'w-in', placeholder: '입금 계좌 (은행 번호 예금주)', maxlength: 60, 'aria-label': '입금 계좌' });
    return panel('업체 정보부터 넣어 주세요', 'home', h('div', { class: 'w-form' },
      h('div', { class: 'w-note', text: '견적서·보고서·문자·시공 카드에 찍힙니다. 나머지는 설정에서 언제든 고칠 수 있어요.' }),
      nm, ph, ac, btn('저장', async () => {
        if (!nm.value.trim()) { toast('상호를 적어 주세요'); return; }
        if (ph.value.trim() && !L.normPhone(ph.value)) { toast('연락처 형식을 확인해 주세요'); return; }
        try { S.d.profile = await S.store.save('work_profiles', { biz_name: nm.value.trim(), phone: L.normPhone(ph.value), account: ac.value.trim() || null }); toast('저장했어요'); route(); } catch (e) { fail(e); }
      }, 'primary')));
  }
  function requestRow(r) {
    const c = custOf(r.customer_id);
    const kind = { as: 'AS', reinstall: '재설치·이전', etc: '기타' }[r.kind] || r.kind;
    const phone = r.contact || (c && c.phone);
    return h('div', { class: 'w-row' },
      h('div', { class: 'w-time num' }, h('b', { text: kind }), L.fmtDay(r.created_at).replace(/ \(.\)$/, '')),
      h('div', { class: 'w-main' }, h('a', { class: 'w-title', href: c ? '#customer/' + c.id : '#customers', text: c ? c.name : '고객' }),
        h('div', { class: 'w-meta', text: phone ? '연락처 ' + L.fmtPhone(phone) : '연락처 없음 — 고객 정보의 번호로 연락' })),
      h('div', { class: 'w-side' }),
      h('div', { class: 'w-msg', text: r.message }),                          // 외부 입력: 텍스트로만
      h('div', { class: 'w-quick' },
        phone ? linkBtn('전화', L.telHref(phone), 'sm', 'phone') : null,
        phone ? btn('문자', () => { location.href = L.smsHref(phone, (c ? c.name + '님, ' : '') + (S.d.profile.biz_name || '') + '입니다. 남겨 주신 문의 확인했습니다. '); }, 'sm', 'msg') : null,
        c ? linkBtn('AS 작업 등록', '#job/new?customer=' + c.id + '&type=as', 'sm', 'plus') : null,
        btn('처리함', async () => {
          try { Object.assign(r, await S.store.resolveRequest(r.id)); toast('처리함으로 표시했어요'); route(); } catch (e) { fail(e); }
        }, 'sm', 'check'),
        requestDeleteBtn(r)));
  }
  function requestDeleteBtn(r) {
    return btn('삭제', async () => {
      if (!confirm('이 문의를 지울까요? 고객이 삭제를 요청한 경우에 쓰세요. 되돌릴 수 없어요.')) return;
      try { await S.store.deleteRequest(r.id); S.d.requests = S.d.requests.filter((x) => x.id !== r.id); toast('지웠어요'); route(); } catch (e) { fail(e); }
    }, 'sm danger');
  }
  function revisitRow(r) {
    const c = r.customer;
    const snooze = async (v) => {
      const patch = { id: c.id };
      if (v === 'stop') patch.revisit_months = null;
      else patch.revisit_snooze_until = L.dayKey(v === 'month' ? L.addMonths(today(), 1) : L.addMonths(today(), c.revisit_months));
      try { Object.assign(c, await S.store.save('work_customers', patch)); toast(v === 'stop' ? '재방문 알림을 껐어요' : '명단에서 미뤘어요'); route(); } catch (e) { fail(e); }
    };
    return h('div', { class: 'w-row' },
      h('div', { class: 'w-time num' }, h('b', { text: L.fmtDay(r.due).replace(/ \(.\)$/, '') }), '주기 ' + c.revisit_months + '개월'),
      h('div', { class: 'w-main' }, h('a', { class: 'w-title', href: '#customer/' + c.id, text: c.name }),
        h('div', { class: 'w-meta', text: '마지막 ' + L.fmtDay(r.lastDone) + (c.address ? ' · ' + c.address : '') })),
      h('div', { class: 'w-side' }),
      h('div', { class: 'w-quick' },
        c.phone ? btn('재방문 문자', () => { location.href = L.smsHref(c.phone, L.smsText('revisit', null, c, S.d.profile)); }, 'sm', 'msg') : null,
        btn('연락함', () => snooze('done'), 'sm'), btn('한 달 뒤', () => snooze('month'), 'sm'), btn('그만', () => snooze('stop'), 'sm')));
  }
  async function loadNearby(box) {
    const put = (...n) => box.replaceChildren(...n);
    if (S.store.isDemo) { put(h('div', { class: 'empty', text: '로그인하면 내가 일하는 시·군·구의 입주 예정 단지(사전점검·입주 시작일)가 여기 뜹니다.' })); return; }
    const regions = {};
    S.d.jobs.forEach((j) => { if (j.sigungu && j.sido) regions[j.sido + '|' + j.sigungu.split(' ')[0]] = true; });
    const keys = Object.keys(regions).slice(0, 10);
    if (!keys.length) { put(h('div', { class: 'empty', text: '작업 주소가 쌓이면 그 지역의 입주 예정 단지를 보여 드려요.' })); return; }
    try {
      const { data, error } = await ainAuth.getClient().from('move_in_complexes')
        .select('id,complex_name_raw,complex_name_ad,sido,sigungu,stage,expected_move_in')
        .in('sigungu', [...new Set(keys.map((k) => k.split('|')[1]))]).eq('is_public', true)
        .gte('expected_move_in', L.dayKey(today())).order('expected_move_in', { ascending: true }).limit(30);
      if (error) throw error;
      const rows = (data || []).filter((r) => regions[L.normSido(r.sido) + '|' + String(r.sigungu).split(' ')[0]]).slice(0, 6);
      if (!rows.length) { put(h('div', { class: 'empty', text: '내 작업 지역에 공개된 입주 예정 단지가 아직 없어요.' })); return; }
      put(...rows.map((r) => h('a', { class: 'w-row', href: '/area/?id=' + encodeURIComponent(r.id) },
        h('div', { class: 'w-time num' }, h('b', { text: String(r.expected_move_in || '').slice(5).replace('-', '/') }), '입주'),
        h('div', { class: 'w-main' }, h('div', { class: 'w-title', text: r.complex_name_ad || r.complex_name_raw }),
          h('div', { class: 'w-meta', text: [L.normSido(r.sido), r.sigungu, r.stage].filter(Boolean).join(' · ') })),
        h('div', { class: 'w-side' }))));
    } catch (e) { put(h('div', { class: 'empty', text: '입주 정보를 불러오지 못했어요.' })); }
  }
  function pasteDialog() {
    const ta = h('textarea', { class: 'w-in', rows: 7, placeholder: '예) 성함 김민지 / 010-2345-6789 / 인천 서구 청라동 123 101동 1203호 / 10월 2일 오후 2시 벽걸이 2대 세척' });
    const dlg = openDialog('붙여넣어 등록', [h('div', { class: 'w-note', text: '카톡·문자·숨고 메시지를 그대로 붙여넣으면 전화번호·주소·날짜·시간을 찾아 등록 화면에 채워 드려요.' }), ta],
      [btn('채워서 등록 화면으로', () => {
        const p = L.parsePaste(ta.value, today());
        sessionStorage.setItem('work_paste', JSON.stringify(Object.assign(p, { memo: ta.value.slice(0, 2000) })));
        dlg.close();
        go('#job/new?paste=1');
      }, 'primary')]);
    setTimeout(() => ta.focus(), 50);
  }

  // ── 일정 (월 달력 + 날짜별, 구별 묶음 = 동선)
  function viewCalendar(arg) {
    const selKey = /^\d{4}-\d{2}-\d{2}$/.test(arg || '') ? arg : (S.cal || L.dayKey(today()));
    S.cal = selKey;
    const [y, m] = selKey.split('-').map(Number);
    const grid = L.monthGrid(y, m - 1);
    const by = L.groupByDay(S.d.jobs.filter((j) => j.status !== 'canceled'));
    const tk = L.dayKey(today());
    const move = (n) => go('#calendar/' + L.dayKey(L.addMonths(new Date(y, m - 1, 1), n)));
    const cal = h('div', { class: 'w-cal', 'aria-label': y + '년 ' + m + '월 달력' },
      ['일', '월', '화', '수', '목', '금', '토'].map((d) => h('div', { class: 'dow', text: d })),
      grid.flat().map((c) => {
        const list = by[c.key] || [];
        const open = list.filter((j) => j.status !== 'done').length;
        return h('button', { type: 'button', class: ['d', c.inMonth ? '' : 'out', c.key === tk ? 'today' : '', c.key === selKey ? 'sel' : '', c.dow === 0 ? 'sun' : '', c.dow === 6 ? 'sat' : ''].join(' '),
          'aria-label': c.key + (list.length ? ' 일정 ' + list.length + '건' : ''), onclick: () => go('#calendar/' + c.key) },
        h('span', { class: 'n num', text: String(c.day) }),
        list.length ? h('span', { class: 'c num ' + (open ? '' : 'done'), text: open ? open + '건' : '완료 ' + list.length }) : null);
      }));
    const dayJobs = by[selKey] || [];
    const groups = {};
    dayJobs.forEach((j) => { const k = j.sigungu || '지역 미정'; (groups[k] = groups[k] || []).push(j); });
    const overlapIds = new Set(dayJobs.filter((j) => j.status === 'booked' && L.overlaps(j, dayJobs).length).map((j) => j.id));
    const dayBody = dayJobs.length ? h('div', { class: 'rows' }, Object.entries(groups).map(([k, list]) => [
      h('div', { class: 'subhead', text: k + ' · ' + list.length + '건' }), list.map((j) => jobRow(j, { actions: true }))]),
    overlapIds.size ? h('div', { class: 'w-pad' }, h('div', { class: 'w-warn', text: '시간이 겹치는 예약이 ' + overlapIds.size + '건 있어요. 소요 시간을 확인하세요.' })) : null)
      : empty('이 날은 일정이 없어요');
    return [
      h('section', { class: 'panel' },
        h('div', { class: 'w-cal-head' }, btn('‹ 이전 달', () => move(-1), 'sm'), h('h2', { class: 'num', text: y + '년 ' + m + '월' }), btn('다음 달 ›', () => move(1), 'sm')),
        cal),
      panel(L.fmtDay(new Date(y, m - 1, +selKey.slice(8))), 'cal', dayBody, h('a', { class: 'more', href: '#job/new?date=' + selKey, text: '+ 이 날 등록' }))
    ];
  }

  // ── 작업 목록
  function viewJobs() {
    const filters = [['all', '전체'], ['open', '문의·견적'], ['booked', '예약'], ['done', '완료'], ['unpaid', '미수'], ['canceled', '취소']];
    const listBox = h('div', { class: 'rows' });
    const paint = () => {
      const q = S.q;
      let list = S.d.jobs.filter((j) => {
        const f = S.jobFilter;
        if (f === 'open' && !(j.status === 'inquiry' || j.status === 'quote')) return false;
        if (['booked', 'done', 'canceled'].includes(f) && j.status !== f) return false;
        if (f === 'unpaid' && !(L.unpaid(j) > 0)) return false;
        if (!q) return true;
        const c = custOf(j.customer_id);
        return (c && L.matchCustomer(c, q)) || String(j.address || '').includes(q) || String(j.memo || '').includes(q);
      });
      list = list.sort((a, b) => S.jobFilter === 'booked' ? L.byTime(a, b) : String(b.scheduled_at || '9').localeCompare(String(a.scheduled_at || '9')));
      listBox.replaceChildren(...(list.length ? list.slice(0, 300).map((j) => jobRow(j, { dateFirst: true })) : [empty('해당하는 작업이 없어요')]));
    };
    const chips = h('div', { class: 'w-chips', role: 'tablist' }, filters.map(([k, t]) => h('button', { type: 'button', role: 'tab', class: 'w-chip' + (S.jobFilter === k ? ' on' : ''),
      'aria-selected': S.jobFilter === k ? 'true' : 'false', onclick: (e) => { S.jobFilter = k; chips.querySelectorAll('.w-chip').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); }); e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-selected', 'true'); paint(); } }, t)));
    const search = h('input', { type: 'search', class: 'w-in', placeholder: '고객 이름 · 전화 뒷번호 · 주소', value: S.q, 'aria-label': '작업 찾기',
      oninput: (e) => { S.q = e.target.value.trim(); paint(); } });
    paint();
    return panel('작업', 'doc', [h('div', { class: 'w-tools' }, search, chips), listBox],
      btn('엑셀(CSV) 내보내기', exportJobs, 'sm'));
  }
  function exportJobs() {
    if (S.store.isDemo) { toast('체험 모드에서는 내보내기를 막아 두었어요'); return; }
    const byId = Object.fromEntries(S.d.customers.map((c) => [c.id, c]));
    DOC.download(new Blob([L.jobsCsv(S.d.jobs, byId, FIELD_LABELS)], { type: 'text/csv' }), '에인연_작업_' + L.dayKey(today()) + '.csv');
  }
  function exportCustomers() {
    if (S.store.isDemo) { toast('체험 모드에서는 내보내기를 막아 두었어요'); return; }
    DOC.download(new Blob([L.customersCsv(S.d.customers, S.d.jobs)], { type: 'text/csv' }), '에인연_고객_' + L.dayKey(today()) + '.csv');
  }

  // ── 작업 상세
  function viewJob(j) {
    if (!j) return empty('작업을 찾을 수 없어요', '지워졌거나 다른 계정의 작업입니다.');
    const c = custOf(j.customer_id);
    const items = L.cleanItems(j.items);
    const t = L.totals(items, j.vat_mode);
    const out = [];
    const dl = h('dl', { class: 'w-kv' });
    const kv = (k, v) => { if (v) dl.append(h('dt', { text: k }), h('dd', { text: v })); };
    kv('일정', j.scheduled_at ? L.fmtDay(j.scheduled_at) + ' ' + L.fmtTime(j.scheduled_at, j.all_day) + (j.duration_min ? ' · ' + j.duration_min + '분' : '') : '미정');
    kv('주소', j.address);
    kv('작업', [fieldLabel(j.field), L.WORK_TYPE_LABEL[j.work_type]].filter(Boolean).join(' · '));
    kv('유입', L.SOURCE_LABEL[j.source]);
    kv('넘김·소개', [j.referral_party, j.referral_fee ? '소개 몫 ' + L.won(j.referral_fee) : ''].filter(Boolean).join(' · '));
    kv('보증', j.warranty_months ? j.warranty_months + '개월' : '');
    kv('메모', j.memo);
    const ov = j.status === 'booked' ? L.overlaps(j, S.d.jobs) : [];
    out.push(h('section', { class: 'panel' },
      h('div', { class: 'phead' }, icon('doc'), h('h2', {}, c ? h('a', { href: '#customer/' + c.id, text: c.name }) : '(고객 미지정)'),
        h('div', { class: 'phead-meta' }, h('span', { class: 'w-st ' + j.status, text: L.STATUS_LABEL[j.status] }))),
      dl,
      ov.length ? h('div', { class: 'w-pad' }, h('div', { class: 'w-warn', text: '같은 시간대 예약 ' + ov.length + '건: ' + ov.map((o) => (custOf(o.customer_id) || {}).name || '고객').join(', ') })) : null,
      h('div', { class: 'w-pad' }, contactBar(c && c.phone, j.address || (c && c.address), j, c)),
      h('div', { class: 'w-pad w-actions' },
        j.status !== 'done' ? btn('완료 처리', () => markDone(j), 'primary', 'check') : null,
        linkBtn('수정', '#job/' + j.id + '/edit'),
        j.scheduled_at && j.status !== 'done' ? btn('폰 캘린더에 넣기', () => DOC.download(new Blob([L.icsFor(j, c, S.d.profile)], { type: 'text/calendar' }), '작업_' + ((c && c.name) || j.id) + '.ics'), '', 'cal') : null,
        linkBtn('같은 구성으로 새 작업', '#job/new?copy=' + j.id),
        j.status !== 'canceled' && j.status !== 'done' ? btn('취소로 바꾸기', async () => {
          try { Object.assign(j, await S.store.save('work_jobs', { id: j.id, status: 'canceled', completed_at: null })); route(); } catch (e) { fail(e); }
        }, 'danger') : null)));

    // 금액·수금
    const tbl = h('table', { class: 'w-table' }, h('tbody', {}, items.map((i) => h('tr', {},
      h('td', { text: [i.name, i.model].filter(Boolean).join(' ') }), h('td', { class: 'r num', text: i.qty + (i.unit || '') }),
      h('td', { class: 'r num', text: L.won(i.qty * i.price) })))));
    const pays = L.cleanPayments(j.payments);
    const payList = h('div', { class: 'rows' }, pays.map((p, idx) => h('div', { class: 'w-row' },
      h('div', { class: 'w-time num' }, h('b', { text: p.at ? p.at.slice(5).replace('-', '/') : '-' })),
      h('div', { class: 'w-main' }, h('div', { class: 'w-title num', text: L.won(p.amount) + ' · ' + L.PAY_LABEL[p.method] })),
      h('div', { class: 'w-side' }, btn('지우기', async () => {
        const next = pays.filter((_, k) => k !== idx);
        try { Object.assign(j, await S.store.save('work_jobs', { id: j.id, payments: next })); route(); } catch (e) { fail(e); }
      }, 'sm')))));
    const amt = h('input', { type: 'number', inputmode: 'numeric', class: 'w-in', value: String(L.unpaid(j) || Math.max(0, L.toInt(j.total_amount) - L.paid(j)) || ''), 'aria-label': '받은 금액' });
    const meth = sel(L.PAY_METHODS.map((m) => [m.id, m.label]), 'transfer', { class: 'w-in', 'aria-label': '결제 수단' });
    const on = h('input', { type: 'date', class: 'w-in', value: L.dayKey(today()), 'aria-label': '받은 날' });
    out.push(panel('금액·수금', 'won', [
      items.length ? tbl : null,
      h('div', { class: 'w-pad' },
        j.vat_mode !== 'none' && items.length ? h('div', { class: 'w-meta', text: '공급가 ' + L.won(t.supply) + ' · 부가세 ' + L.won(t.vat) }) : null,
        h('div', { class: 'w-total' }, h('span', { text: '합계' }), h('span', { class: 'n num', text: L.won(j.total_amount) })),
        h('div', { class: 'w-meta', text: '받은 금액 ' + L.won(L.paid(j)) + (L.unpaid(j) ? ' · 남은 금액 ' + L.won(L.unpaid(j)) : '') })),
      pays.length ? payList : null,
      h('div', { class: 'w-form' }, h('div', { class: 'w-3' }, amt, meth, on),
        btn('수금 기록', async () => {
          const a = L.toInt(amt.value);
          if (a <= 0) { toast('금액을 적어 주세요'); return; }
          try { Object.assign(j, await S.store.save('work_jobs', { id: j.id, payments: pays.concat([{ amount: a, method: meth.value, at: on.value }]) })); toast('수금을 기록했어요'); route(); } catch (e) { fail(e); }
        }, 'primary'))
    ]));

    // 견적서·보고서
    const photos = S.d.photos.filter((p) => p.job_id === j.id);
    const pick = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr', id: 'docPick',
      onchange: (e) => { S.docPhotos = [...e.target.files].slice(0, 12); pickNote.textContent = S.docPhotos.length ? '기기 사진 ' + S.docPhotos.length + '장을 보고서에 넣어요 (업로드 안 함)' : ''; } });
    const pickNote = h('span', { class: 'w-meta' });
    S.docPhotos = [];
    out.push(panel('견적서 · 작업 보고서', 'doc', h('div', { class: 'w-pad w-actions' },
      btn('견적서 이미지', () => showDoc('quote', j), 'primary'),
      btn('작업 보고서 이미지', () => showDoc('report', j)),
      h('label', { class: 'w-btn', for: 'docPick' }, icon('camera'), '보고서에 넣을 사진 고르기'), pick, pickNote,
      btn('블로그 후기 초안 복사', () => copy(L.blogDraft(j, c, S.d.profile, fieldLabel(j.field)), '블로그 초안을 복사했어요. 사진만 넣어 올리세요')))));

    // 사진 보관 (프로)
    const photoBox = h('div', { class: 'w-photos' });
    const paintPhotos = async () => {
      if (!photos.length) { photoBox.replaceChildren(h('div', { class: 'w-meta', text: '보관한 사진이 없어요.' })); return; }
      const urls = await S.store.photoUrls(photos).catch(() => ({}));
      photoBox.replaceChildren(...photos.map((p) => h('div', { class: 'w-photo' },
        h('img', { src: urls[p.path] || '', alt: (p.kind === 'before' ? '작업 전' : p.kind === 'after' ? '작업 후' : '') + ' 사진', loading: 'lazy' }),
        p.kind !== 'etc' ? h('em', { text: p.kind === 'before' ? '전' : '후' }) : null,
        h('button', { type: 'button', 'aria-label': '사진 지우기', text: '✕', onclick: async () => {
          if (!confirm('이 사진을 지울까요?')) return;
          try { await S.store.removePhoto(p); S.d.photos = S.d.photos.filter((x) => x.id !== p.id); route(); } catch (e) { fail(e); }
        } }))));
    };
    paintPhotos();
    const kindSel = sel([['before', '작업 전'], ['after', '작업 후'], ['etc', '기타']], 'after', { class: 'w-in', 'aria-label': '사진 종류' });
    const up = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'sr', id: 'photoUp', onchange: async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      toast('사진 올리는 중… (' + files.length + '장)');
      for (const f of files) {
        try { S.d.photos.push(await S.store.addPhoto(j.id, f, kindSel.value)); } catch (err) { fail(err, '사진을 올리지 못했어요'); break; }
      }
      route();
    } });
    out.push(panel('사진 보관', 'camera', [
      plan().isPro ? h('div', { class: 'w-pad w-actions' }, kindSel, h('label', { class: 'w-btn', for: 'photoUp' }, icon('camera'), '사진 올리기'), up)
        : h('div', { class: 'w-pad' }, h('div', { class: 'w-note', text: '사진 서버 보관은 프로 기능이에요. 무료에서도 위 "보고서에 넣을 사진 고르기"로 기기 사진을 넣은 보고서를 바로 만들 수 있어요.' })),
      photoBox,
      h('div', { class: 'w-pad w-meta', text: '작업당 ' + L.PLAN.pro.photosPerJob + '장까지. 올릴 때 긴 변 1600px로 줄여 보관합니다. 요금제가 바뀌어도 올린 사진은 계속 보고 지울 수 있어요.' })
    ], h('span', { class: 'cnt num', text: photos.length + '/' + L.PLAN.pro.photosPerJob })));

    // 시공 카드
    if (c) out.push(cardPanel(c, j));
    out.push(h('div', { class: 'w-actions' }, btn('이 작업 지우기', async () => {
      if (!confirm('이 작업을 지울까요? 금액·수금 기록과 보관한 사진도 함께 지워집니다.')) return;
      try { await S.store.remove('work_jobs', j.id); S.d.jobs = S.d.jobs.filter((x) => x.id !== j.id); S.d.jobs.forEach((x) => { if (x.parent_job_id === j.id) x.parent_job_id = null; }); S.d.photos = S.d.photos.filter((p) => p.job_id !== j.id); toast('지웠어요'); go('#jobs'); } catch (e) { fail(e); }
    }, 'danger')));
    return out;
  }
  async function showDoc(kind, j) {
    const c = custOf(j.customer_id);
    toast('만드는 중…');
    try {
      let photos = S.docPhotos.slice();
      if (kind === 'report') {
        const stored = S.d.photos.filter((p) => p.job_id === j.id);
        if (stored.length) {
          const urls = await S.store.photoUrls(stored);
          photos = stored.map((p) => urls[p.path]).filter(Boolean).concat(photos);
        }
      }
      const cv = await DOC.render(kind, { job: j, customer: c, biz: S.d.profile, pro: plan().isPro, photos, fieldLabel: fieldLabel(j.field) });
      const name = (kind === 'quote' ? '견적서_' : '작업보고서_') + ((c && c.name) || '고객') + '_' + L.dayKey(today()) + '.png';
      const url = URL.createObjectURL(await DOC.toBlob(cv));
      openDialog(kind === 'quote' ? '견적서' : '작업 보고서', [
        h('img', { class: 'doc', src: url, alt: (kind === 'quote' ? '견적서' : '작업 보고서') + ' 미리보기' }),
        !S.d.profile.biz_name ? h('div', { class: 'w-note' }, '업체 정보(상호·연락처·계좌)를 ', h('a', { href: '#settings', text: '설정' }), '에서 넣으면 문서에 찍힙니다.') : null
      ], [
        btn('카톡·문자로 공유', () => DOC.share(cv, name, toast), 'primary'),
        btn('저장', async () => DOC.download(await DOC.toBlob(cv), name)),
        btn('인쇄·PDF', () => DOC.print(cv))
      ]);
    } catch (e) { fail(e, '문서를 만들지 못했어요'); }
  }
  function cardPanel(c, j) {
    const link = c.card_token ? cardLink(c.card_token) : null;
    const body = h('div', { class: 'w-pad' },
      h('div', { class: 'w-note', text: '고객이 앱 없이 시공 이력·보증 기간을 보고, AS·재설치 문의를 남기는 링크입니다. 고객 이름은 가리고 금액·연락처·상세 주소는 보이지 않아요. 고객마다 하나라 실내기에 QR 스티커로 붙여도 해마다 같은 링크입니다.' }),
      h('div', { class: 'w-actions', style: { marginTop: 'var(--sp-3)' } },
        c.phone ? btn(link ? '링크 문자로 보내기' : '링크 만들어 문자로 보내기', async () => {
          try {
            const t = c.card_token || await S.store.issueCard(c.id);
            c.card_token = t;
            location.href = L.smsHref(c.phone, L.smsText('done', j, c, S.d.profile, { link: cardLink(t) }));
          } catch (e) { fail(e, '링크를 만들지 못했어요'); }
        }, 'primary', 'link') : null,
        btn(link ? '링크 복사' : '링크 만들기', async () => {
          try { const t = c.card_token || await S.store.issueCard(c.id); c.card_token = t; copy(cardLink(t), '시공 카드 링크를 복사했어요'); if (!link) route(); } catch (e) { fail(e, '링크를 만들지 못했어요'); }
        }, '', 'link'),
        link ? linkBtn('고객 화면으로 보기', link, '', null, true) : null,
        link ? btn('링크 폐기', async () => {
          if (!confirm('이 링크를 없앨까요? 이미 보낸 링크와 붙인 QR은 더 이상 열리지 않아요. 새로 만들면 다른 링크가 됩니다.')) return;
          try { await S.store.revokeCard(c.id); c.card_token = null; toast('링크를 없앴어요'); route(); } catch (e) { fail(e); }
        }, 'danger') : null));
    return panel('시공 카드 링크', 'link', body, link ? h('span', { class: 'w-st booked', text: '발급됨' }) : null);
  }

  // ── 작업 등록·수정
  function viewJobForm(j, q) {
    const isNew = !j;
    const src = j || {};
    const copyFrom = q.get('copy') ? jobOf(+q.get('copy')) : null;
    const pasted = q.get('paste') ? JSON.parse(sessionStorage.getItem('work_paste') || '{}') : {};
    if (q.get('paste')) sessionStorage.removeItem('work_paste');
    const draftKey = 'work_draft_' + S.uid + '_' + (j ? j.id : 'new');   // 사용자별 (공용 기기에서 남의 입력이 뜨지 않게)
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch (e) { draft = null; }

    let customer = custOf(src.customer_id || (copyFrom && copyFrom.customer_id) || +q.get('customer') || null);
    const base = Object.assign({
      field: S.myField && FIELD_LABELS[S.myField] ? S.myField : 'ac-clean', work_type: q.get('type') || 'clean', status: 'booked', vat_mode: 'none',
      items: [], checklist: [], payments: [], all_day: false
    }, copyFrom ? { field: copyFrom.field, work_type: copyFrom.work_type, items: copyFrom.items, vat_mode: copyFrom.vat_mode, address: copyFrom.address,
      source: 'repeat', parent_job_id: copyFrom.id } : {}, src);
    const st = {
      items: L.cleanItems(base.items).map((i) => Object.assign({}, i)),
      checklist: (base.checklist || []).map((x) => ({ label: x.label, value: x.value })),
      manualTotal: !L.cleanItems(base.items).length && base.total_amount ? base.total_amount : null
    };
    const dt = base.scheduled_at ? new Date(base.scheduled_at) : null;

    const phone = h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off', value: customer ? L.fmtPhone(customer.phone) : (pasted.phone ? L.fmtPhone(pasted.phone) : ''), placeholder: '010-0000-0000' });
    const name = h('input', { type: 'text', autocomplete: 'off', maxlength: 40, value: customer ? customer.name : (pasted.name || ''), placeholder: '이름 또는 상호' });
    const suggest = h('div', { class: 'w-suggest', hidden: true });
    const picked = h('div', { hidden: true });
    const date = h('input', { type: 'date', value: dt ? L.dayKey(dt) : (q.get('date') || pasted.date || '') });
    const time = h('input', { type: 'time', step: 600, value: dt ? L.timeKey(dt) : (pasted.time || '09:00') });
    const allDay = h('input', { type: 'checkbox', checked: !!base.all_day });
    const status = sel(L.STATUS.map((s) => [s.id, s.label]), base.status || 'booked');
    const address = h('input', { type: 'text', value: base.address || pasted.address || (customer && customer.address) || '', placeholder: '인천 서구 청라동 123 101동 1203호', autocomplete: 'street-address' });
    const memo = h('textarea', { rows: 3, placeholder: '현장 메모 (주차, 기기 상태, 요청 사항)', value: base.memo || (pasted.memo || '') });
    const fieldSel = sel([['', '선택 안 함']].concat(FIELD_OPTIONS.map(([k, v]) => [k, v])), base.field || '');
    const typeSel = sel([['', '선택 안 함']].concat(L.WORK_TYPES.map((t) => [t.id, t.label])), base.work_type || '');
    const dur = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 1440, step: 10, value: base.duration_min || '', placeholder: '기본 ' + L.durationOf(base) + '분' });
    const vat = sel([['none', '부가세 없음(간이·면세)'], ['excl', '부가세 별도 (+10%)'], ['incl', '부가세 포함가']], base.vat_mode);
    const warranty = sel([['', '없음'], ['1', '1개월'], ['3', '3개월'], ['6', '6개월'], ['12', '12개월'], ['24', '24개월']], base.warranty_months || '');
    const source = sel([['', '선택 안 함']].concat(L.SOURCES.map((s) => [s.id, s.label])), base.source || '');
    const refParty = h('input', { type: 'text', value: base.referral_party || '', placeholder: '넘겨준·받은 업체 (선택)' });
    const refFee = h('input', { type: 'number', inputmode: 'numeric', value: base.referral_fee || '', placeholder: '소개 몫 (원)' });
    const totalBox = h('div', { class: 'w-total' });
    const manualTotal = h('input', { type: 'number', inputmode: 'numeric', value: st.manualTotal || '', placeholder: '품목 없이 합계만 적기 (원)' });
    const itemsBox = h('div', { class: 'w-items' });
    const presetBox = h('div', { class: 'w-chips', style: { flexWrap: 'wrap' } });
    const checkBox = h('div', { class: 'w-form', style: { padding: 0 } });
    const warnBox = h('div');
    const errBox = h('div');
    const regionHint = h('small', { class: 'w-meta' });
    const paintRegion = () => {
      const r = L.parseRegion(address.value);
      regionHint.textContent = !address.value.trim() ? '시·군·구까지는 동선 묶음과 시공 카드 지역 표시에 쓰여요'
        : r.sigungu ? '지역: ' + [r.sido, r.sigungu].filter(Boolean).join(' ')
          : '지역을 못 찾았어요 — 주소 앞에 "인천 서구"처럼 시·구를 적으면 동선·시공 카드에 쓰여요';
    };
    address.addEventListener('input', paintRegion);

    // 기존 고객 연결
    function setCustomer(c) {
      customer = c;
      picked.replaceChildren(c ? h('div', { class: 'w-picked' }, icon('user'), '기존 고객: ' + c.name + (c.phone ? ' · ' + L.fmtPhone(c.phone) : ''),
        h('button', { type: 'button', class: 'w-btn sm', onclick: () => setCustomer(null) }, '연결 해제')) : '');
      picked.hidden = !c;
      if (c) {
        name.value = c.name; phone.value = L.fmtPhone(c.phone);
        if (!address.value && c.address) { address.value = c.address; paintRegion(); }
      }
      suggest.hidden = true;
    }
    function showSuggest(qv) {
      if (customer || !qv || qv.length < 2) { suggest.hidden = true; return; }
      const hits = S.d.customers.filter((c) => L.matchCustomer(c, qv)).slice(0, 5);
      suggest.replaceChildren(...hits.map((c) => h('button', { type: 'button', onclick: () => setCustomer(c) }, icon('user'),
        c.name, h('span', { class: 'w-meta', text: [L.fmtPhone(c.phone), c.address].filter(Boolean).join(' · ') }))));
      suggest.hidden = !hits.length;
    }
    phone.addEventListener('input', () => { showSuggest(L.digits(phone.value)); dupCheck(); });
    name.addEventListener('input', () => showSuggest(name.value.trim()));
    function dupCheck() {
      if (customer) return;
      const same = L.findByPhone(S.d.customers, phone.value);
      warnBox.replaceChildren(same.length ? h('div', { class: 'w-warn' }, '같은 번호의 고객이 있어요: ' + same[0].name + ' ',
        h('button', { type: 'button', class: 'w-btn sm', onclick: () => setCustomer(same[0]) }, '이 고객으로 연결')) : '');
    }

    // 품목
    function paintItems() {
      itemsBox.replaceChildren(...st.items.map((it, idx) => {
        const upd = (k) => (e) => { it[k] = k === 'name' || k === 'unit' || k === 'model' ? e.target.value : L.toInt(e.target.value); paintTotal(); saveDraft(); };
        return h('div', { class: 'w-item' },
          h('input', { class: 'nm', type: 'text', value: it.name, placeholder: '품목', 'aria-label': '품목', oninput: upd('name') }),
          h('input', { type: 'number', inputmode: 'numeric', value: it.qty, 'aria-label': '수량', oninput: upd('qty') }),
          sel(L.UNITS.map((u) => [u, u]), it.unit || '대', { 'aria-label': '단위', onchange: upd('unit') }),
          h('input', { type: 'number', inputmode: 'numeric', value: it.price, 'aria-label': '단가(할인은 음수)', oninput: upd('price') }),
          h('button', { type: 'button', class: 'x', 'aria-label': '품목 지우기', onclick: () => { st.items.splice(idx, 1); paintItems(); paintTotal(); saveDraft(); } }, '✕'));
      }));
    }
    function paintPresets() {
      const last = L.lastPrices(S.d.jobs);
      const list = L.ITEM_PRESETS[L.presetKey(fieldSel.value)] || L.ITEM_PRESETS.etc;
      presetBox.replaceChildren(...list.map(([nm, unit]) => h('button', { type: 'button', class: 'w-chip add', onclick: () => {
        const hit = st.items.find((i) => i.name === nm);
        if (hit) hit.qty += 1; else st.items.push({ name: nm, model: '', unit, qty: 1, price: last[nm] || 0, kind: nm });
        paintItems(); paintTotal(); saveDraft();
      } }, nm + (last[nm] ? ' ' + (last[nm] / 10000).toLocaleString('ko-KR') + '만' : ''))),
      h('button', { type: 'button', class: 'w-chip add', onclick: () => { st.items.push({ name: '', model: '', unit: '대', qty: 1, price: 0 }); paintItems(); } }, '직접 입력'),
      h('button', { type: 'button', class: 'w-chip add', onclick: () => { st.items.push({ name: '할인', model: '', unit: '식', qty: 1, price: -10000 }); paintItems(); paintTotal(); } }, '할인'));
    }
    function computeTotal() {
      const items = L.cleanItems(st.items);
      return items.length ? L.totals(items, vat.value).total : Math.max(0, L.toInt(manualTotal.value));
    }
    function paintTotal() {
      const items = L.cleanItems(st.items);
      manualTotal.hidden = !!items.length;
      const t = L.totals(items, vat.value);
      totalBox.replaceChildren(h('span', { text: vat.value === 'none' ? '합계' : '합계 (공급가 ' + L.won(t.supply) + ' + 부가세 ' + L.won(t.vat) + ')' }),
        h('span', { class: 'n num', text: L.won(computeTotal()) }));
    }
    function paintChecklist() {
      const tpl = L.checklistFor(fieldSel.value, typeSel.value);
      tpl.forEach((lab) => { if (!st.checklist.some((c) => c.label === lab)) st.checklist.push({ label: lab, value: '' }); });
      checkBox.replaceChildren(...(st.checklist.length ? st.checklist.map((c) => field(c.label, h('input', { type: 'text', value: c.value || '', placeholder: '예) 이상 없음',
        oninput: (e) => { c.value = e.target.value; saveDraft(); } }))) : [h('div', { class: 'w-meta', text: '이 작업유형은 기본 확인 항목이 없어요.' })]),
      h('button', { type: 'button', class: 'w-chip add', onclick: () => { const lab = prompt('확인 항목 이름'); if (lab) { st.checklist.push({ label: lab.slice(0, 40), value: '' }); paintChecklist(); } } }, '항목 추가'));
    }
    function paintOverlap() {
      if (!date.value || allDay.checked) { errBox.replaceChildren(); return; }
      const probe = { id: j && j.id, work_type: typeSel.value, duration_min: L.toInt(dur.value) || null, scheduled_at: L.combineDateTime(date.value, time.value) };
      const ov = L.overlaps(probe, S.d.jobs);
      errBox.replaceChildren(ov.length ? h('div', { class: 'w-warn', text: '같은 시간대 예약이 있어요: ' + ov.map((o) => L.fmtTime(o.scheduled_at) + ' ' + ((custOf(o.customer_id) || {}).name || '고객')).join(', ') }) : '');
    }
    fieldSel.addEventListener('change', () => { paintPresets(); paintChecklist(); });
    typeSel.addEventListener('change', () => { paintChecklist(); paintOverlap(); dur.placeholder = '기본 ' + L.durationOf({ work_type: typeSel.value }) + '분'; });
    vat.addEventListener('change', paintTotal);
    manualTotal.addEventListener('input', paintTotal);
    [date, time, allDay, dur].forEach((x) => x.addEventListener('change', paintOverlap));

    // 임시 저장 (지하·기계실에서 저장이 실패해도 입력이 남는다)
    function collect() {
      return { phone: phone.value, name: name.value, date: date.value, time: time.value, allDay: allDay.checked, status: status.value, address: address.value,
        memo: memo.value, field: fieldSel.value, type: typeSel.value, dur: dur.value, vat: vat.value, warranty: warranty.value, source: source.value,
        refParty: refParty.value, refFee: refFee.value, manual: manualTotal.value, items: st.items, checklist: st.checklist, customerId: customer && customer.id };
    }
    let draftTimer = null, submitted = false;
    function saveDraft() {
      if (submitted) return;
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => { if (!submitted) try { localStorage.setItem(draftKey, JSON.stringify(collect())); } catch (e) {} }, 400);
    }
    function restore(dr) {
      phone.value = dr.phone || ''; name.value = dr.name || ''; date.value = dr.date || ''; time.value = dr.time || '09:00'; allDay.checked = !!dr.allDay;
      status.value = dr.status || 'booked'; address.value = dr.address || ''; memo.value = dr.memo || ''; fieldSel.value = dr.field || fieldSel.value;
      typeSel.value = dr.type || typeSel.value; dur.value = dr.dur || ''; vat.value = dr.vat || 'none'; warranty.value = dr.warranty || ''; source.value = dr.source || '';
      refParty.value = dr.refParty || ''; refFee.value = dr.refFee || ''; manualTotal.value = dr.manual || '';
      st.items = dr.items || []; st.checklist = dr.checklist || [];
      if (dr.customerId) setCustomer(custOf(dr.customerId));
      paintItems(); paintPresets(); paintChecklist(); paintTotal(); paintOverlap(); paintRegion(); dupCheck();
    }

    async function submit() {
      const payload = {
        customer_id: customer ? customer.id : null, customer_name: name.value.trim(), customer_phone: phone.value.trim(),
        status: status.value, scheduled_at: date.value ? L.combineDateTime(date.value, allDay.checked ? '00:00' : time.value) : null, items: st.items, memo: memo.value
      };
      if (!date.value && payload.status === 'booked') payload.status = 'inquiry';
      const errs = L.validateJob(payload);
      if (errs.length) { errBox.replaceChildren(h('div', { class: 'w-warn', text: errs.join(' ') })); errBox.scrollIntoView({ block: 'center' }); return; }
      saveBtn.disabled = true;
      try {
        let c = customer;
        const nm = (payload.customer_name || L.fmtPhone(payload.customer_phone)).slice(0, 40);
        const ph = L.normPhone(payload.customer_phone);
        if (!c) {
          c = await S.store.save('work_customers', { name: nm, phone: ph, address: address.value.trim().slice(0, 200) || null });
          S.d.customers.unshift(c);
          setCustomer(c);                                   // 작업 저장이 실패해 다시 눌러도 고객이 두 번 생기지 않게
        } else {
          const patch = { id: c.id };
          if (payload.customer_name && nm !== c.name) patch.name = nm;
          if (ph && ph !== c.phone) patch.phone = ph;
          if (!c.address && address.value.trim()) patch.address = address.value.trim().slice(0, 200);
          if (Object.keys(patch).length > 1) Object.assign(c, await S.store.save('work_customers', patch));
        }
        const reg = L.parseRegion(address.value);
        const items = L.cleanItems(st.items);
        const wasDone = j && j.status === 'done';
        const row = {
          id: j ? j.id : undefined, customer_id: c.id, field: fieldSel.value || null, work_type: typeSel.value || null, status: payload.status,
          scheduled_at: payload.scheduled_at, all_day: allDay.checked, duration_min: Math.min(1440, Math.max(0, L.toInt(dur.value))) || null,
          address: address.value.trim().slice(0, 200) || null, sido: reg.sido, sigungu: reg.sigungu, items, vat_mode: vat.value,
          total_amount: Math.min(2000000000, computeTotal()),
          checklist: st.checklist.filter((x) => x.label).map((x) => ({ label: x.label, value: String(x.value || '').slice(0, 40) })),
          memo: memo.value.trim().slice(0, 2000) || null, source: source.value || null, referral_party: refParty.value.trim().slice(0, 40) || null,
          referral_fee: Math.min(2000000000, Math.max(0, L.toInt(refFee.value))) || null,
          warranty_months: warranty.value ? +warranty.value : null,
          parent_job_id: j ? undefined : (base.parent_job_id || null),   // 수정 때는 보내지 않는다(부모가 지워졌을 수 있다)
          payments: j ? j.payments : [],
          completed_at: payload.status === 'done'
            ? (payload.scheduled_at && new Date(payload.scheduled_at) < new Date() ? payload.scheduled_at : (wasDone && j.completed_at) || new Date().toISOString()) : null
        };
        const saved = await S.store.save('work_jobs', row);
        submitted = true; clearTimeout(draftTimer);
        if (j) Object.assign(j, saved); else S.d.jobs.unshift(saved);
        if (saved.status === 'done') await autoRevisit(saved);
        try { localStorage.removeItem(draftKey); } catch (e) {}
        toast(isNew ? '등록했어요' : '저장했어요');
        go('#job/' + saved.id);
      } catch (e) {
        saveBtn.disabled = false;
        fail(e, '저장하지 못했어요. 입력은 이 기기에 임시 저장돼 있으니 다시 눌러 주세요.');
      }
    }
    const saveBtn = btn(isNew ? '등록' : '저장', submit, 'primary');

    const form = h('div', { class: 'w-form', oninput: saveDraft, onchange: saveDraft },
      draft && !q.get('paste') && !q.get('copy') ? h('div', { class: 'w-note' }, '저장하지 못한 입력이 있어요. ',
        btn('불러오기', (e) => { restore(draft); e.currentTarget.parentElement.remove(); }, 'sm'),
        btn('버리기', (e) => { localStorage.removeItem(draftKey); e.currentTarget.parentElement.remove(); }, 'sm')) : null,
      picked,
      h('div', { class: 'w-2' }, field('전화', phone), field('고객', name)),
      suggest, warnBox,
      h('div', { class: 'w-2' }, field('날짜', date, '비우면 일정 미정 문의로 저장'), field('시간', time)),
      h('div', { class: 'w-2' }, h('label', { class: 'w-check' }, allDay, '종일'), field('상태', status)),
      field('주소', address), regionHint,
      field('메모', memo),
      h('details', { open: !isNew || !!copyFrom || (base.items || []).length > 0 },
        h('summary', { text: '견적·품목·확인 항목 (자세히)' }),
        h('div', { class: 'w-form' },
          h('div', { class: 'w-2' }, field('공종', fieldSel), field('작업유형', typeSel)),
          h('div', { class: 'w-lab', text: '품목 빠른 선택 (내가 마지막에 쓴 단가로 채워요)' }), presetBox,
          itemsBox, manualTotal, h('div', { class: 'w-2' }, field('부가세', vat), field('소요 시간(분)', dur)), totalBox,
          h('div', { class: 'w-lab', text: '작업 확인 항목 (보고서·시공 카드에 찍혀요)' }), checkBox,
          h('div', { class: 'w-2' }, field('무상 AS 기간', warranty), field('유입 경로', source)),
          h('div', { class: 'w-2' }, field('넘긴·받은 업체', refParty, '나만 보는 기록'), field('소개 몫', refFee, '나만 보는 기록')))),
      errBox);
    if (customer) setCustomer(customer);
    paintItems(); paintPresets(); paintChecklist(); paintTotal(); paintOverlap(); paintRegion(); dupCheck();
    return h('section', { class: 'panel' },
      h('div', { class: 'phead' }, icon('plus'), h('h2', { text: isNew ? (copyFrom ? '같은 구성으로 새 작업' : '작업 등록') : '작업 수정' })),
      isNew ? h('div', { class: 'w-pad' }, btn('문자·카톡 붙여넣기로 채우기', pasteDialog, 'sm', 'msg')) : null,
      form,
      h('div', { class: 'w-sticky' }, linkBtn('취소', j ? '#job/' + j.id : '#today'), saveBtn));
  }

  // ── 고객
  function viewCustomers() {
    const listBox = h('div', { class: 'rows' });
    const stats = {};
    S.d.jobs.forEach((j) => {
      if (!j.customer_id) return;
      const s = stats[j.customer_id] = stats[j.customer_id] || { n: 0, amt: 0, last: '' };
      s.n++;
      if (j.status === 'done') { s.amt += L.toInt(j.total_amount); const k = L.dayKey(j.completed_at || j.scheduled_at); if (k > s.last) s.last = k; }
    });
    const paint = () => {
      const list = S.d.customers.filter((c) => L.matchCustomer(c, S.cq));
      listBox.replaceChildren(...(list.length ? list.slice(0, 300).map((c) => {
        const s = stats[c.id] || { n: 0, amt: 0, last: '' };
        return h('a', { class: 'w-row', href: '#customer/' + c.id },
          h('div', { class: 'w-time num' }, h('b', { text: s.n + '건' }), s.last ? s.last.slice(2).replace(/-/g, '.') : '-'),
          h('div', { class: 'w-main' }, h('div', { class: 'w-title' }, c.name, c.tag ? h('span', { class: 'w-tag ' + (c.tag === 'caution' ? 'caution' : ''), text: c.tag === 'vip' ? ' VIP' : ' 주의' }) : null),
            h('div', { class: 'w-meta', text: [L.fmtPhone(c.phone), c.address].filter(Boolean).join(' · ') })),
          h('div', { class: 'w-side num', text: s.amt ? L.won(s.amt) : '' }));
      }) : [empty(S.cq ? '찾는 고객이 없어요' : '아직 고객이 없어요', S.cq ? '' : '작업을 등록하면 고객이 자동으로 생기고, 엑셀(CSV)로 한 번에 가져올 수도 있어요.')]));
    };
    paint();
    return panel('고객 장부', 'user', [
      h('div', { class: 'w-tools' }, h('input', { type: 'search', class: 'w-in', placeholder: '이름 · 전화 뒷번호 · 주소', value: S.cq, 'aria-label': '고객 찾기', oninput: (e) => { S.cq = e.target.value.trim(); paint(); } }),
        h('div', { class: 'w-actions' }, linkBtn('고객 추가', '#customer/new', 'sm', 'plus'), linkBtn('엑셀 가져오기', '#import', 'sm'), btn('엑셀 내보내기', exportCustomers, 'sm'))),
      listBox
    ], h('span', { class: 'cnt num', text: String(S.d.customers.length) }));
  }
  function viewCustomer(c) {
    if (!c) return empty('고객을 찾을 수 없어요');
    const jobs = S.d.jobs.filter((j) => j.customer_id === c.id).sort((a, b) => String(b.scheduled_at || '9').localeCompare(String(a.scheduled_at || '9')));
    const reqs = S.d.requests.filter((r) => r.customer_id === c.id);
    const done = jobs.filter((j) => j.status === 'done');
    const dl = h('dl', { class: 'w-kv' });
    const kv = (k, v) => { if (v) dl.append(h('dt', { text: k }), h('dd', { text: v })); };
    kv('연락처', L.fmtPhone(c.phone));
    kv('주소', c.address);
    kv('누적', done.length + '건 · ' + L.won(done.reduce((s, j) => s + L.toInt(j.total_amount), 0)));
    kv('재방문', c.revisit_months ? c.revisit_months + '개월 주기' + (c.revisit_snooze_until ? ' (' + c.revisit_snooze_until + '까지 미룸)' : '') : '알림 안 함');
    const memoLine = h('input', { type: 'text', class: 'w-in', placeholder: '통화·상담 내용 한 줄 (날짜 자동)' });
    const revisit = sel([['', '알림 안 함'], ['3', '3개월'], ['6', '6개월'], ['12', '12개월'], ['24', '24개월']], c.revisit_months || '', { class: 'w-in', 'aria-label': '재방문 주기',
      onchange: async (e) => { try { Object.assign(c, await S.store.save('work_customers', { id: c.id, revisit_months: e.target.value ? +e.target.value : null, revisit_snooze_until: null })); toast('재방문 주기를 저장했어요'); route(); } catch (err) { fail(err); } } });
    return [
      h('section', { class: 'panel' },
        h('div', { class: 'phead' }, icon('user'), h('h2', { text: c.name }), c.tag ? h('span', { class: 'w-tag ' + (c.tag === 'caution' ? 'caution' : ''), text: c.tag === 'vip' ? 'VIP' : '주의' }) : null),
        dl,
        h('div', { class: 'w-pad' }, contactBar(c.phone, c.address, null, c)),
        h('div', { class: 'w-pad w-actions' }, linkBtn('이 고객 작업 등록', '#job/new?customer=' + c.id, 'primary', 'plus'), linkBtn('수정', '#customer/' + c.id + '/edit'),
          h('label', { class: 'w-field', style: { minWidth: '160px' } }, h('span', { text: '재방문 알림' }), revisit))),
      panel('상담 기록', 'msg', [
        h('div', { class: 'w-form' }, h('div', { class: 'w-2' }, memoLine, btn('기록 추가', async () => {
          const v = memoLine.value.trim();
          if (!v) return;
          const next = (L.dayKey(today()) + ' ' + v + (c.memo ? '\n' + c.memo : '')).slice(0, 4000);
          try { Object.assign(c, await S.store.save('work_customers', { id: c.id, memo: next })); route(); } catch (e) { fail(e); }
        }, 'primary'))),
        c.memo ? h('div', { class: 'w-pad' }, h('div', { class: 'w-msg', text: c.memo })) : null]),
      cardPanel(c, done[0] || null),
      reqs.length ? panel('AS·재설치 문의 기록', 'bell', h('div', { class: 'rows' }, reqs.map((r) => r.resolved_at
        ? h('div', { class: 'w-row' }, h('div', { class: 'w-time num' }, h('b', { text: '처리' }), L.fmtDay(r.created_at).replace(/ \(.\)$/, '')),
          h('div', { class: 'w-main' }, h('div', { class: 'w-title', text: r.message }), h('div', { class: 'w-meta', text: r.contact ? L.fmtPhone(r.contact) : '' })), h('div', { class: 'w-side' }, requestDeleteBtn(r)))
        : requestRow(r)))) : null,
      panel('작업 이력', 'doc', jobs.length ? h('div', { class: 'rows' }, jobs.map((j) => jobRow(j, { dateFirst: true }))) : empty('아직 작업이 없어요'), h('span', { class: 'cnt num', text: String(jobs.length) })),
      h('div', { class: 'w-actions' }, btn('이 고객 지우기', async () => {
        if (!confirm(c.name + ' 고객을 지울까요? 매출 집계용 금액은 남기고, 작업에 적힌 주소·메모와 시공 카드 링크·문의 기록은 함께 지웁니다.')) return;
        try {
          for (const j of S.d.jobs.filter((x) => x.customer_id === c.id)) {
            Object.assign(j, await S.store.save('work_jobs', { id: j.id, address: null, memo: null, referral_party: null }));
          }
          await S.store.remove('work_customers', c.id); S.d.customers = S.d.customers.filter((x) => x.id !== c.id); S.d.jobs.forEach((j) => { if (j.customer_id === c.id) j.customer_id = null; }); S.d.requests = S.d.requests.filter((r) => r.customer_id !== c.id); toast('지웠어요'); go('#customers'); } catch (e) { fail(e); }
      }, 'danger'))
    ];
  }
  function viewCustomerForm(c) {
    const src = c || {};
    const name = h('input', { type: 'text', value: src.name || '', required: true });
    const phone = h('input', { type: 'tel', inputmode: 'tel', value: L.fmtPhone(src.phone) || '' });
    const address = h('input', { type: 'text', value: src.address || '' });
    const tag = sel([['', '없음'], ['vip', 'VIP'], ['caution', '주의']], src.tag || '');
    const revisit = sel([['', '알림 안 함'], ['3', '3개월'], ['6', '6개월'], ['12', '12개월'], ['24', '24개월']], src.revisit_months || '');
    const memo = h('textarea', { rows: 4, value: src.memo || '' });
    const warn = h('div');
    phone.addEventListener('input', () => {
      const same = L.findByPhone(S.d.customers, phone.value).filter((x) => !c || x.id !== c.id);
      warn.replaceChildren(same.length ? h('div', { class: 'w-warn' }, '같은 번호의 고객이 있어요: ', h('a', { href: '#customer/' + same[0].id, text: same[0].name })) : '');
    });
    const save = async () => {
      if (!name.value.trim()) { toast('이름을 적어 주세요'); return; }
      if (phone.value.trim() && !L.normPhone(phone.value)) { toast('전화번호 형식을 확인해 주세요'); return; }
      try {
        const saved = await S.store.save('work_customers', { id: c ? c.id : undefined, name: name.value.trim().slice(0, 40), phone: L.normPhone(phone.value),
          address: address.value.trim() || null, tag: tag.value || null, revisit_months: revisit.value ? +revisit.value : null, memo: memo.value.trim() || null });
        if (c) Object.assign(c, saved); else S.d.customers.unshift(saved);
        toast('저장했어요');
        go('#customer/' + saved.id);
      } catch (e) { fail(e); }
    };
    return h('section', { class: 'panel' },
      h('div', { class: 'phead' }, icon('user'), h('h2', { text: c ? '고객 수정' : '고객 추가' })),
      h('div', { class: 'w-form' }, h('div', { class: 'w-2' }, field('이름·상호', name), field('전화', phone)), warn, field('주소', address),
        h('div', { class: 'w-2' }, field('표시', tag), field('재방문 알림', revisit)), field('메모', memo)),
      h('div', { class: 'w-sticky' }, linkBtn('취소', c ? '#customer/' + c.id : '#customers'), btn('저장', save, 'primary')));
  }

  // ── 가져오기 (브리젤·엑셀 명부 → CSV)
  function viewImport() {
    const out = h('div', { class: 'w-pad' });
    const asJob = h('input', { type: 'checkbox', checked: true });
    const file = h('input', { type: 'file', accept: '.csv,text/csv', class: 'sr', id: 'csvPick', onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const buf = await f.arrayBuffer();
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (err) { text = new TextDecoder('euc-kr').decode(buf); }   // 한글 윈도 엑셀 기본 저장
      const m = L.mapImport(L.parseCsv(text));
      const exist = new Set(S.d.customers.map((c) => c.phone).filter(Boolean));
      const fresh = m.customers.filter((c) => !c.phone || !exist.has(c.phone));
      const labels = { name: '이름', phone: '전화', address: '주소', memo: '메모', last: '최근 작업일', item: '품목·기기', amount: '금액' };
      out.replaceChildren(
        h('div', { class: 'w-note', text: '찾은 열: ' + (Object.keys(m.cols).map((k) => labels[k]).join(', ') || '없음') + ' · 고객 ' + m.customers.length + '명 (같은 번호는 합침)'
          + (m.customers.length - fresh.length ? ' · 이미 있는 번호 ' + (m.customers.length - fresh.length) + '명은 건너뜀' : '') + (m.skipped ? ' · 이름·번호 없는 줄 ' + m.skipped + '개 제외' : '') }),
        !('name' in m.cols) && !('phone' in m.cols) ? h('div', { class: 'w-warn', text: '이름이나 전화 열을 찾지 못했어요. 첫 줄에 "이름", "연락처" 같은 머리글이 있어야 해요.' }) : null,
        fresh.length ? h('table', { class: 'w-table' }, h('tbody', {}, fresh.slice(0, 8).map((c) => h('tr', {}, h('td', { text: c.name }), h('td', { text: L.fmtPhone(c.phone) }), h('td', { text: c.last || '' }))))) : null,
        fresh.length ? h('div', { class: 'w-actions', style: { marginTop: 'var(--sp-3)' } }, btn(fresh.length + '명 가져오기', async (ev) => {
          ev.currentTarget.disabled = true;
          let n = 0;
          for (const r of fresh) {
            try {
              const c = await S.store.save('work_customers', { name: r.name, phone: r.phone, address: r.address, memo: r.memo, revisit_months: r.last ? 12 : null });
              S.d.customers.unshift(c);
              if (asJob.checked && r.last) {
                const reg = L.parseRegion(r.address);
                const at = new Date(r.last + 'T10:00:00').toISOString();
                S.d.jobs.unshift(await S.store.save('work_jobs', { customer_id: c.id, status: 'done', scheduled_at: at, completed_at: at, address: r.address, sido: reg.sido, sigungu: reg.sigungu,
                  items: r.item ? [{ name: r.item, model: '', unit: '식', qty: 1, price: r.amount || 0 }] : [], total_amount: r.amount || 0, source: 'repeat',
                  payments: r.amount ? [{ amount: r.amount, at: r.last, method: 'etc' }] : [], memo: '가져온 기록' }));
              }
              n++;
            } catch (err) { fail(err, n + '명까지 가져오고 멈췄어요'); break; }
          }
          toast(n + '명을 가져왔어요');
          go('#customers');
        }, 'primary')) : null);
    } });
    return panel('엑셀(CSV)로 고객 가져오기', 'user', [
      h('div', { class: 'w-pad' }, h('ol', { class: 'w-list' },
        h('li', { text: '엑셀에서 "다른 이름으로 저장 → CSV UTF-8(쉼표로 분리)"로 저장하세요. 일반 CSV(한글 윈도)도 읽습니다.' }),
        h('li', { text: '첫 줄 머리글에 이름(고객명·성함), 연락처(전화·휴대폰), 주소, 메모, 최근 작업일(서비스일·시공일)이 있으면 자동으로 맞춥니다.' }),
        h('li', { text: '다른 업무 앱에서 내려받은 고객 엑셀도 같은 방법으로 옮길 수 있어요. 같은 전화번호는 한 명으로 합칩니다.' })),
        h('label', { class: 'w-check' }, asJob, '최근 작업일이 있으면 완료 작업으로 기록 (재방문 알림 12개월 주기 켜기)'),
        h('div', { class: 'w-actions' }, h('label', { class: 'w-btn primary', for: 'csvPick' }, 'CSV 파일 고르기'), file)),
      out
    ]);
  }

  // ── 매출
  function viewStats() {
    const now = today();
    const months = L.last12(S.d.jobs, now);
    const max = Math.max(1, ...months.map((m) => m.amount));
    const half = L.halfYear(S.d.jobs, now);
    const src = L.bySource(S.d.jobs, now);
    const sum = L.monthSummary(S.d.jobs, L.monthKey(now));
    const total12 = months.reduce((s, m) => s + m.amount, 0);
    return [
      panel('최근 12개월 완료 매출', 'won', [
        h('div', { class: 'w-bars', role: 'img', 'aria-label': months.map((m) => m.ym + ' ' + L.won(m.amount)).join(', ') }, months.map((m, i) =>
          h('div', { class: 'w-bar' + (i === 11 ? ' now' : ''), title: m.ym + ' ' + L.won(m.amount) + ' (' + m.count + '건)' },
            h('i', { style: { height: Math.round(100 * m.amount / max) + '%' } }), h('span', { class: 'num', text: String(+m.ym.slice(5)) })))),
        h('div', { class: 'w-stats' },
          h('div', { class: 'w-stat' }, h('div', { class: 'n num', text: L.won(sum.doneAmount) }), h('div', { class: 'l', text: '이번 달' })),
          h('div', { class: 'w-stat' }, h('div', { class: 'n num', text: L.won(total12) }), h('div', { class: 'l', text: '최근 12개월' })),
          h('div', { class: 'w-stat' }, h('div', { class: 'n num', text: L.won(half.amount) }), h('div', { class: 'l', text: half.label + ' (부가세 신고 기간)' })),
          h('div', { class: 'w-stat ' + (sum.unpaidAmount ? 'warn' : '') }, h('div', { class: 'n num', text: L.won(sum.unpaidAmount) }), h('div', { class: 'l', text: '미수금 ' + sum.unpaidCount + '건' })))
      ]),
      panel('유입 경로별 매출 (최근 12개월)', 'user', src.length ? h('table', { class: 'w-table' }, h('tbody', {}, src.map((r) => h('tr', {},
        h('td', { text: r.label }), h('td', { class: 'r num', text: r.count + '건' }), h('td', { class: 'r num', text: L.won(r.amount) })))))
        : empty('완료 작업이 쌓이면 보여요', '작업에 유입 경로(숨고·당근·소개 등)를 적으면 광고비 대비 효과를 볼 수 있어요.')),
      h('div', { class: 'w-note', text: '매출은 완료 처리한 작업의 합계 기준입니다. 세무 신고용 장부가 아니니 신고 전 증빙과 맞춰 보세요.' })
    ];
  }

  // ── 설정
  function viewSettings() {
    const p = S.d.profile || {};
    const pv = plan();
    const f = {};
    const inp = (k, props) => (f[k] = h(props && props.rows ? 'textarea' : 'input', Object.assign({ type: 'text', value: k === 'phone' ? L.fmtPhone(p[k]) : (p[k] || '') }, props || {})));
    const saveProfile = async () => {
      const phone = f.phone.value.trim();
      if (phone && !L.normPhone(phone)) { toast('연락처 형식을 확인해 주세요'); return; }
      const bn = f.biz_no.value.trim();
      if (bn && !/^[0-9]{3}-?[0-9]{2}-?[0-9]{5}$/.test(bn)) { toast('사업자번호는 숫자 10자리예요'); return; }
      try {
        S.d.profile = await S.store.save('work_profiles', { biz_name: f.biz_name.value.trim() || null, owner_name: f.owner_name.value.trim() || null, phone: L.normPhone(phone),
          account: f.account.value.trim() || null, biz_no: bn || null, intro: f.intro.value.trim() || null, quote_note: f.quote_note.value.trim() || null });
        toast('업체 정보를 저장했어요');
      } catch (e) { fail(e); }
    };
    const logoIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'sr', id: 'logoPick', onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const bmp = await createImageBitmap(file);
        const s = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
        const cv = h('canvas');
        cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
        cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
        const data = cv.toDataURL('image/png');
        if (data.length > 200000) { toast('로고 파일이 너무 커요. 더 단순한 이미지를 골라 주세요'); return; }
        S.d.profile = await S.store.save('work_profiles', { logo_data: data });
        toast('로고를 저장했어요'); route();
      } catch (err) { fail(err, '로고를 저장하지 못했어요'); }
    } });
    const tpl = {};
    const tplBox = h('div', { class: 'w-form', style: { padding: 0 } }, L.SMS_KINDS.map((k) => field(k.label,
      (tpl[k.id] = h('textarea', { rows: 3, maxlength: 300, value: (p.sms_templates || {})[k.id] || k.text })))));
    return [
      panel('업체 정보', 'home', [
        h('div', { class: 'w-form' },
          h('div', { class: 'w-2' }, field('상호', inp('biz_name', { maxlength: 40 })), field('대표자', inp('owner_name', { maxlength: 20 }))),
          h('div', { class: 'w-2' }, field('연락처', inp('phone', { type: 'tel', inputmode: 'tel' })), field('사업자등록번호', inp('biz_no', { inputmode: 'numeric', placeholder: '000-00-00000' }))),
          field('입금 계좌', inp('account', { maxlength: 60, placeholder: '은행 계좌번호 (예금주)' })),
          field('소개 한 줄', inp('intro', { maxlength: 200 }), '시공 카드에 보여요'),
          field('견적서 안내 문구', inp('quote_note', { rows: 3, maxlength: 500 }))),
        h('div', { class: 'w-sticky' }, btn('업체 정보 저장', saveProfile, 'primary'))
      ]),
      panel('로고', 'camera', h('div', { class: 'w-pad' },
        pv.isPro ? h('div', { class: 'w-actions' }, p.logo_data ? h('img', { src: p.logo_data, alt: '업체 로고', style: { maxHeight: '56px', maxWidth: '160px' } }) : null,
          h('label', { class: 'w-btn', for: 'logoPick' }, p.logo_data ? '로고 바꾸기' : '로고 올리기'), logoIn,
          p.logo_data ? btn('로고 지우기', async () => { try { S.d.profile = await S.store.save('work_profiles', { logo_data: null }); route(); } catch (e) { fail(e); } }, 'danger') : null)
          : h('div', { class: 'w-note', text: '견적서·보고서·시공 카드의 업체 로고는 프로 기능이에요.' }))),
      panel('문자 문구', 'msg', [h('div', { class: 'w-form' }, h('div', { class: 'w-note', text: '{고객} {상호} {일시} {주소} {금액} {미수금} {계좌} {링크} 자리에 값이 들어갑니다.' }), tplBox),
        h('div', { class: 'w-sticky' }, btn('기본 문구로', () => { L.SMS_KINDS.forEach((k) => { tpl[k.id].value = k.text; }); }), btn('문구 저장', async () => {
          const obj = {};
          L.SMS_KINDS.forEach((k) => { const v = tpl[k.id].value.trim().slice(0, 300); if (v && v !== k.text) obj[k.id] = v; });
          try { S.d.profile = await S.store.save('work_profiles', { sms_templates: obj }); toast('문구를 저장했어요'); } catch (e) { fail(e); }
        }, 'primary'))]),
      panel('요금제', 'won', h('div', { class: 'w-pad', style: { display: 'grid', gap: 'var(--sp-3)' } },
        h('div', { class: 'w-title' }, '지금: ', h('span', { class: 'w-st ' + (pv.isPro ? 'pro' : ''), text: pv.label }),
          pv.until ? ' ' + L.fmtDay(pv.until) + '까지' : pv.inBeta ? ' (베타 · ' + pv.betaEndLabel + '까지 무료)' : ''),
        h('ul', { class: 'w-list' },
          h('li', { text: '무료: 작업·고객·일정·수금·시공 카드·AS 문의·견적서·보고서·엑셀 가져오기/내보내기 — 건수 제한 없음' }),
          h('li', { text: '프로: 사진 서버 보관(작업당 ' + L.PLAN.pro.photosPerJob + '장, 월 ' + L.PLAN.pro.photosPerMonth + '장), 업체 로고, 문서·카드의 에인연 표기 제거' }),
          h('li', { text: '계획(확정 아님): 3D 배치도 — 현장 사진·치수로 설치 위치 미리보기' })),
)),
      panel('데이터', 'doc', h('div', { class: 'w-pad w-actions' }, btn('작업 엑셀(CSV) 내보내기', exportJobs), btn('고객 엑셀(CSV) 내보내기', exportCustomers), linkBtn('엑셀로 고객 가져오기', '#import'),
        h('div', { class: 'w-note', text: '업무 데이터는 내 계정에서만 보이게 저장됩니다. 운영자는 법령상 요구나 내가 요청한 장애 대응 외에는 열람하지 않습니다. 고객·작업·수금 기록은 무료에서도 언제든 엑셀로 내보낼 수 있어요(사진은 작업 화면에서 길게 눌러 저장). 백업은 보장하지 않으니 정기적으로 내보내 두세요.' })))
    ];
  }

  // 이 기기에 남긴 업무 흔적(임시 입력·오프라인 요약)을 지운다. uid가 없으면 체험용을 뺀 전부
  function forgetDevice(uid) {
    try { sessionStorage.removeItem('work_paste'); } catch (e) { /* 무시 */ }
    try {
      Object.keys(localStorage).filter((k) => uid
        ? k.startsWith('work_draft_' + uid + '_') || k === window.ainWorkStore.offlineKey(uid)
        : (k.startsWith('work_draft_') && !k.startsWith('work_draft_demo_')) || k.startsWith('work_offline_')).forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* 저장소 접근 불가 */ }
  }

  // ── 시작
  addEventListener('hashchange', route);
  addEventListener('ain:auth', (e) => {
    const uid = e.detail && e.detail.session ? e.detail.session.user.id : null;
    if (DEMO) return;
    if (uid !== S.uid) {
      if (S.uid && S.uid !== 'demo') forgetDevice(S.uid);
      document.querySelectorAll('.w-fab, dialog.w-dialog, #printArea').forEach((x) => x.remove());
      S.d = null; boot();
    }
    else if (S.d && /access_token/.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); route(); }
  });
  addEventListener('DOMContentLoaded', () => {
    if (window.ainAuth) ainAuth.init('authSlot');
    boot();
  });
})();
