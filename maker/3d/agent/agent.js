// AI 에이전트 — 모드 고르기(일반·전문가) → 대화. 답은 supabase/functions/studio-agent(Claude API)가 만든다.
// 대화는 이 화면에만 둔다(저장하지 않는다). 로그인한 회원만, 하루 30번.
import { mountShell, h } from '../app/shell.js';
import { createLibrary } from '../plan/library.js';
import { roomAreaM2 } from '../plan/core/geom.js';

const MODES = {
  general: { name: '일반', title: '대화하며 아이디어 얻기', sub: '공간 구성·가구 배치·에어컨 배치를 말로 물어봅니다.',
    chips: ['20평 사무실을 3명이 쓰게 꾸미고 싶어요', '거실에 시스템에어컨은 어디에 두면 좋을까요?', '원룸을 침실과 작업 공간으로 나누고 싶어요', '카페 30평 좌석 배치를 추천해 주세요', '도면이 없는데 어떻게 시작하나요?'] },
  expert: { name: '전문가', title: '내 도면으로 작업하기', sub: '저장한 도면을 첨부하면 방 이름·면적·놓인 제품을 보고 답합니다.',
    chips: ['방마다 에어컨 용량을 계산해 주세요', '이 도면에 맞는 에어컨 배치를 제안해 주세요', '가구 배치에서 동선이 막히는 곳이 있나요?', '침실 하나를 서재로 바꾸면 어떻게 놓을까요?', '이 집에 필요한 가전 목록을 정리해 주세요'] },
};
const GO = { plan_new: ['도면 그리기', '/maker/3d/plan/?new=1'], templates: ['템플릿에서 고르기', '/maker/3d/plan/?new=1'], maps: ['도면 검색', '/maker/3d/maps/'], upload: ['도면 올리기', '/maker/3d/#stIn'], projects: ['내 프로젝트', '/maker/3d/projects/'] };
const ERR = { login: '로그인하면 대화할 수 있습니다.', limit_user: '오늘 대화 30번을 다 썼습니다. 내일 다시 이어 주세요.', limit_day: '오늘 준비한 대화량이 끝났습니다. 내일 다시 이어 주세요.', busy: '지금 요청이 많습니다. 잠시 뒤 다시 보내 주세요.' };
const TOUR = [
  ['모드를 고릅니다', '일반은 아이디어를 묻는 대화, 전문가는 저장한 도면을 첨부해 그 도면을 두고 묻는 대화입니다.'],
  ['예시 문장을 눌러 봅니다', '입력창 아래 문장을 누르면 입력창에 채워집니다. 고쳐서 보내도 됩니다.'],
  ['도면을 첨부합니다', '전문가 모드에서 내 프로젝트의 도면을 고르면 방 이름·면적·놓인 제품이 함께 갑니다. 도면 그림은 보내지 않습니다.'],
  ['답 아래 단추로 이어 갑니다', '답에 따라 도면 그리기·도면 검색·도면 열기 단추가 붙습니다. 누르면 그 화면으로 갑니다.'],
  ['알아 둘 것', '대화는 이 화면을 닫으면 사라집니다. 회원 한 명이 하루 30번 보낼 수 있습니다.'],
];

let storage; try { storage = window.localStorage; storage.getItem('ain-plan-docs'); } catch (e) { storage = null; }
const lib = storage && createLibrary(storage);
const S = { mode: null, log: [], busy: false, project: '', session: null };
let ui;

// 첨부 요약 — 방 이름·실면적·제품 수만(도면 좌표는 보내지 않는다)
function summary(id) {
  const doc = lib && lib.getPlan(id); if (!doc) return null;
  return { title: doc.title, floors: doc.floors.map((f, i) => {
    const view = { ...doc, cur: i }, ac = new Map(), app = new Map();
    for (const it of f.items || []) {
      if (it.kind === 'ac') { const k = [it.brand, it.model, it.code, it.capacityKw].join(' '); ac.set(k, (ac.get(k) || 0) + 1); }
      else if (it.kind === 'appliance') app.set(it.category, (app.get(it.category) || 0) + 1);
    }
    let rooms = []; try { rooms = f.rooms.map((r) => [r.name, Math.round(roomAreaM2(view, r) * 100) / 100]); } catch (e) { rooms = f.rooms.map((r) => [r.name, null]); }
    return { name: f.name, heightMm: f.heightMm, rooms, ac: [...ac].map(([k, n]) => `${k} ×${n}`), appliances: Object.fromEntries(app), furniture: (f.items || []).filter((x) => x.kind === 'furniture').length };
  }) };
}

function bubble(m) {
  const acts = (m.actions || []).map((a) => {
    if (a === 'plan_open') return S.project ? h('a', { class: 'ag-go', href: '/maker/3d/plan/?doc=' + encodeURIComponent(S.project), text: '첨부한 도면 열기' }) : null;
    return GO[a] ? h('a', { class: 'ag-go', href: GO[a][1], text: GO[a][0] }) : null;
  }).filter(Boolean);
  return h('div', { class: 'ag-msg ' + (m.role === 'user' ? 'me' : m.err ? 'ai err' : 'ai') }, [h('p', { text: m.content }), acts.length ? h('div', { class: 'ag-acts' }, acts) : null]);
}

async function send(text) {
  text = String(text || '').trim().slice(0, 1200);
  if (!text || S.busy) return;
  const sb = window.ainAuth && window.ainAuth.getClient();
  S.session = sb ? await window.ainAuth.getSession().catch(() => null) : null;
  if (!S.session) { S.log.push({ role: 'assistant', content: ERR.login, err: true, login: true }); render(); return; }
  S.log.push({ role: 'user', content: text }); S.busy = true; render();
  const msgs = S.log.filter((m) => !m.err).slice(-15).map((m) => ({ role: m.role, content: m.content }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  const body = { mode: S.mode, messages: msgs, project: S.mode === 'expert' && S.project ? summary(S.project) : undefined };
  const reply = { role: 'assistant', content: '' };
  const fail = (why) => Object.assign(reply, { content: ERR[why] || (why === 'net' ? '연결이 끊겼습니다. 다시 보내 주세요.' : '답을 받지 못했습니다. 잠시 뒤 다시 보내 주세요.'), err: true });
  try {
    const res = await fetch(sb.supabaseUrl + '/functions/v1/studio-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.session.access_token, apikey: sb.supabaseKey },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (!res.ok) { let why = ''; try { why = (await res.json()).error; } catch (e) { /* 아래 */ } fail(why); }
    else await readStream(res.body, (ev) => {
      if (ev.t) { if (!reply.content) { S.log.push(reply); render(); } reply.content += ev.t; paintLast(); }
      else if (ev.done) Object.assign(reply, { content: ev.reply, actions: ev.actions, left: ev.left });
      else if (ev.error) fail(ev.error);
    });
    if (!reply.content) fail('');
  } catch (e) { fail(reply.content ? '' : 'net'); }
  if (!S.log.includes(reply)) S.log.push(reply);
  S.busy = false; render(); ui.input.focus();
}

// SSE 줄(data: {...}) 읽기
async function readStream(stream, on) {
  const rd = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (line.startsWith('data: ')) on(JSON.parse(line.slice(6)));
    }
  }
}

// 오는 중인 답은 마지막 말풍선 글만 바꾼다(전체를 다시 그리지 않는다)
function paintLast() {
  const p = ui.body.querySelector('.ag-log > .ag-msg:last-child p');
  const m = S.log[S.log.length - 1];
  if (p && m) { p.textContent = m.content; p.closest('.ag-log').scrollTop = 1e9; }
}

function tour() {
  let i = 0;
  const title = h('h2', {}), text = h('p', {}), step = h('p', { class: 'ag-step' }), next = h('button', { type: 'button', class: 'pj-btn primary' }), prev = h('button', { type: 'button', class: 'pj-btn', text: '이전' });
  const dlg = h('dialog', { class: 'pj-dlg', 'aria-label': '둘러보기' }, [step, title, text, h('div', { class: 'row' }, [prev, next])]);
  const show = () => { title.textContent = TOUR[i][0]; text.textContent = TOUR[i][1]; step.textContent = `${i + 1} / ${TOUR.length}`; prev.hidden = !i; next.textContent = i === TOUR.length - 1 ? '시작하기' : '다음'; };
  next.onclick = () => (i === TOUR.length - 1 ? dlg.close() : (i++, show())); prev.onclick = () => { i--; show(); };
  dlg.addEventListener('close', () => { dlg.remove(); ui.tourBtn.focus(); });
  document.body.append(dlg); show(); dlg.showModal(); next.focus();
}

function render() {
  const m = S.mode && MODES[S.mode];
  if (!m) {
    ui.body.replaceChildren(h('div', { class: 'ag-modes' }, Object.entries(MODES).map(([k, v]) => h('button', { type: 'button', class: 'ag-mode', 'data-mode': k, onclick: () => { S.mode = k; render(); ui.input.focus(); } }, [h('span', { class: 'ag-mode-k', text: v.name }), h('strong', { text: v.title }), h('span', { text: v.sub })]))));
    return;
  }
  const tabs = h('div', { class: 'ag-tabs', role: 'group', 'aria-label': '모드' }, Object.entries(MODES).map(([k, v]) => h('button', { type: 'button', 'aria-pressed': S.mode === k ? 'true' : 'false', text: v.name, onclick: () => { S.mode = k; render(); } })));
  const plans = lib ? lib.listPlans() : [];
  const attach = S.mode === 'expert' ? h('label', { class: 'ag-attach' }, ['첨부할 도면', h('select', { onchange: (e) => { S.project = e.target.value; } }, [h('option', { value: '', text: plans.length ? '고르지 않음' : '저장한 도면이 없습니다' }), ...plans.map((p) => h('option', { value: p.id, text: p.title, selected: p.id === S.project }))])]) : null;
  const log = h('div', { class: 'ag-log', role: 'log', 'aria-live': 'polite' }, [...S.log.map(bubble), S.busy && S.log[S.log.length - 1].role === 'user' ? h('div', { class: 'ag-msg ai wait' }, [h('p', { text: '답을 쓰는 중…' })]) : null]);
  const lastLogin = S.log.length && S.log[S.log.length - 1].login;
  const chips = S.log.length ? null : h('div', { class: 'ag-chips', role: 'group', 'aria-label': '예시 문장' }, m.chips.map((c) => h('button', { type: 'button', text: c, onclick: () => { ui.input.value = c; ui.input.focus(); } })));
  const left = [...S.log].reverse().find((x) => typeof x.left === 'number');
  ui.body.replaceChildren(...[tabs, attach, log, lastLogin ? h('button', { type: 'button', class: 'pj-btn primary ag-login', text: '카카오 로그인', onclick: () => window.ainAuth && window.ainAuth.login() }) : null,
    h('form', { class: 'ag-form', onsubmit: (e) => { e.preventDefault(); const v = ui.input.value; ui.input.value = ''; send(v); } }, [ui.input, h('button', { type: 'submit', class: 'pj-btn primary', text: '보내기', disabled: S.busy })]),
    chips, h('p', { class: 'ag-note', text: `보낸 글은 답을 만들려고 Anthropic(미국)의 AI 로 보냅니다. 이름·연락처 같은 개인정보는 적지 마세요.${left ? ` · 오늘 ${left.left}번 남음` : ''}` })].filter(Boolean));   // replaceChildren 은 null 을 글자로 넣는다
  log.scrollTop = log.scrollHeight;
}

function boot() {
  const { main } = mountShell({ active: 'ask' });
  try { window.ainAuth.init('authSlot'); } catch (e) { /* 로그인 칸 없이 */ }
  ui = { body: h('div', { class: 'ag-body' }), input: h('textarea', { rows: '2', maxlength: '1200', placeholder: '무엇이든 물어보세요', 'aria-label': '보낼 글' }), tourBtn: h('button', { type: 'button', class: 'pj-btn', text: '둘러보기', onclick: () => tour() }) };
  ui.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.target.form.requestSubmit(); } });
  main.append(h('div', { class: 'ag-head' }, [h('div', {}, [h('p', { class: 'ag-k', text: 'AI 에이전트' }), h('h1', { text: '어떤 공간을 만들어 볼까요?' })]), ui.tourBtn]), ui.body);
  const q = new URLSearchParams(location.search);
  if (MODES[q.get('mode')]) S.mode = q.get('mode');
  render();
  document.title = 'AI 에이전트 | 3D 스튜디오';
}
boot();
