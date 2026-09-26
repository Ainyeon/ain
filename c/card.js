// 시공 카드 공개 페이지 — 고객이 앱 없이 시공 이력·보증을 보고 AS를 문의한다.
// 토큰은 주소의 # 뒤(#t=…)에 둔다: 서버 로그·서비스워커 캐시·Referer에 남지 않는다.
// 표시 필드는 서버(get_card)가 이미 골라 준 것만. 업체가 쓴 값도 textContent로만 그린다.
(function () {
  'use strict';
  const L = window.ainWorkLogic;
  const root = document.getElementById('card');
  const FIELD_LABELS = (window.ainCommunity && window.ainCommunity.FIELD_LABELS) || {};
  const token = (new URLSearchParams(location.hash.slice(1)).get('t') || (location.hash === '#demo' ? 'demo' : '')).trim();
  const isDemo = token === 'demo';

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (['value', 'checked', 'disabled'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c instanceof Node ? c : String(c)); });
    return el;
  }
  const DEMO = {
    biz_name: '시원설비', biz_phone: '01099990000', biz_intro: '에어컨 설치·세척 12년. 청라·검단·루원', pro: false, logo: null,
    customer: '김*지', region: '인천 서구',
    jobs: [
      { done_on: L.dayKey(L.addDays(new Date(), -2)), field: 'ac-clean', work_type: 'clean', items: [{ name: '벽걸이', unit: '대', qty: 2 }],
        checklist: [{ label: '분해 범위', value: '완전 분해' }, { label: '사용 약품', value: '중성 세정제' }, { label: '배수 확인', value: '정상' }],
        warranty_until: L.dayKey(L.addMonths(new Date(), 1)) },
      { done_on: L.dayKey(L.addDays(new Date(), -370)), field: 'ac-clean', work_type: 'clean', items: [{ name: '벽걸이', unit: '대', qty: 2 }], checklist: [], warranty_until: null }
    ]
  };

  async function load() {
    if (!token) return null;
    if (isDemo) return DEMO;
    const { data, error } = await ainAuth.getClient().rpc('get_card', { p_token: token });
    if (error) throw error;
    return data;
  }

  function render(c) {
    const todayKey = L.dayKey(new Date());
    const latest = c.jobs[0];
    const w = latest && latest.warranty_until;
    const link = location.href;
    const out = [];
    out.push(h('section', { class: 'panel' },
      h('div', { class: 'card-biz' },
        c.logo ? h('img', { src: c.logo, alt: c.biz_name + ' 로고' }) : null,
        h('h1', { text: c.biz_name }),
        c.biz_intro ? h('p', { text: c.biz_intro }) : null,
        h('p', { text: (c.customer ? c.customer + ' 님' : '고객님') + '의 시공 기록' + (c.region ? ' · ' + c.region : '') })),
      c.biz_phone ? h('div', { class: 'card-call' },
        h('a', { class: 'w-btn primary', href: L.telHref(c.biz_phone) }, '전화하기'),
        h('a', { class: 'w-btn', href: L.smsHref(c.biz_phone, '[시공 카드] 안녕하세요, 문의드립니다.\n' + link) }, '문자 보내기')) : null,
      w ? h('div', { class: 'card-warranty' + (w < todayKey ? ' over' : ''), text: w >= todayKey ? '무상 AS 기간 중 · ' + w + '까지' : '무상 AS 기간 종료 (' + w + ')' }) : null));

    out.push(h('section', { class: 'panel' },
      h('div', { class: 'phead' }, h('h2', { text: '시공 이력' }), h('span', { class: 'cnt num', text: String(c.jobs.length) })),
      c.jobs.length ? c.jobs.map((j) => h('article', { class: 'card-job' },
        h('h3', { text: [j.done_on, FIELD_LABELS[j.field], L.WORK_TYPE_LABEL[j.work_type]].filter(Boolean).join(' · ') }),
        j.items.length ? h('ul', {}, j.items.map((i) => h('li', { text: [i.name, i.model].filter(Boolean).join(' ') + (i.qty ? ' ' + i.qty + (i.unit || '') : '') }))) : null,
        j.checklist.length ? h('ul', {}, j.checklist.map((x) => h('li', { text: x.label + ': ' + x.value }))) : null,
        j.warranty_until ? h('div', { class: 'w-meta', text: '무상 AS ' + j.warranty_until + '까지' }) : null))
        : h('div', { class: 'empty', text: '완료된 시공 기록이 아직 없어요.' })));

    out.push(asForm(c));
    out.push(h('p', { class: 'card-foot' },
      '이 페이지에는 고객님 이름 일부와 시·군·구까지만 보이며, 금액·고객 연락처·상세 주소는 표시하지 않습니다.',
      c.pro ? null : [h('br'), '에인연 업무로 만든 시공 카드']));
    root.replaceChildren(...out);
  }

  function asForm(c) {
    const box = h('div', { class: 'w-form' });
    const kinds = [['as', 'AS·고장'], ['reinstall', '재설치·이전'], ['etc', '기타']];
    const radios = kinds.map(([v, t], i) => h('label', {}, h('input', { type: 'radio', name: 'kind', value: v, checked: i === 0 }), t));
    const msg = h('textarea', { rows: 4, maxlength: 1000, placeholder: '예) 벽걸이 실내기에서 물이 떨어져요. 평일 저녁 방문 원해요.', 'aria-label': '문의 내용' });
    const contact = h('input', { type: 'tel', inputmode: 'tel', placeholder: '010-0000-0000 (선택)', 'aria-label': '연락받을 번호' });
    const status = h('div', { role: 'status' });
    const send = h('button', { type: 'button', class: 'w-btn primary', onclick: submit }, '문의 남기기');
    async function submit() {
      const kind = (box.querySelector('input[name=kind]:checked') || {}).value || 'as';
      const text = msg.value.trim();
      if (!text) { status.replaceChildren(h('div', { class: 'w-warn', text: '문의 내용을 적어 주세요.' })); return; }
      if (contact.value.trim() && !L.normPhone(contact.value)) { status.replaceChildren(h('div', { class: 'w-warn', text: '연락처 형식을 확인해 주세요.' })); return; }
      send.disabled = true;
      try {
        if (!isDemo) {
          const { error } = await ainAuth.getClient().rpc('submit_card_request', { p_token: token, p_kind: kind, p_message: text, p_contact: L.normPhone(contact.value) });
          if (error) throw error;
        }
        const label = kinds.find((k) => k[0] === kind)[1];
        const smsBody = '[시공 카드 문의] ' + label + '\n' + text + (contact.value.trim() ? '\n연락처 ' + L.fmtPhone(contact.value) : '') + '\n' + location.href;
        box.replaceChildren(h('div', { class: 'w-note', text: isDemo ? '체험용 카드라 실제로 접수되지는 않았어요. 실제 카드에서는 업체 업무 화면의 "오늘"에 바로 뜹니다.'
          : '접수됐어요. 업체가 앱을 열면 바로 보입니다. 더 빨리 연락받으려면 아래 문자도 보내 주세요.' }),
          c.biz_phone ? h('a', { class: 'w-btn primary', href: L.smsHref(c.biz_phone, smsBody) }, '업체에 문자 보내기') : null);
        // 업체 폰으로 바로 알림이 가도록 문자 앱을 연다 (발송은 고객이 누른다. 막히면 위 버튼)
        if (c.biz_phone && !isDemo) location.href = L.smsHref(c.biz_phone, smsBody);
      } catch (e) {
        console.error(e);
        send.disabled = false;
        status.replaceChildren(h('div', { class: 'w-warn', text: L.limitMessage(e) || '접수하지 못했어요. 업체에 전화로 연락해 주세요.' }));
      }
    }
    const notice = h('p', { class: 'w-meta' }, '남기신 내용과 연락처(선택)는 이 업체에만 전달되며, 업체가 처리한 뒤 지울 수 있습니다. ',
      h('a', { href: '/legal/privacy/', target: '_blank', rel: 'noopener', text: '개인정보처리방침' }));
    box.append(h('div', { class: 'card-kinds', role: 'radiogroup', 'aria-label': '문의 종류' }, radios), msg, contact, notice, status, send);
    return h('section', { class: 'panel' }, h('div', { class: 'phead' }, h('h2', { text: 'AS·재설치 문의' })), box);
  }

  addEventListener('DOMContentLoaded', async () => {
    try {
      const c = await load();
      if (!c) {
        root.replaceChildren(h('div', { class: 'empty' }, h('b', { text: '열 수 없는 시공 카드예요' }), '링크가 잘렸거나 업체가 링크를 새로 만들었을 수 있어요. 시공한 업체에 문의해 주세요.'));
        return;
      }
      document.title = c.biz_name + ' 시공 카드';
      render(c);
    } catch (e) {
      console.error(e);
      root.replaceChildren(h('div', { class: 'empty' }, h('b', { text: '지금은 불러오지 못했어요' }), '잠시 후 다시 열어 주세요.'));
    }
  });
})();
