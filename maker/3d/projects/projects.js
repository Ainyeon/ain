// 내 프로젝트 — 브라우저에 저장한 도면(plan/library.js)과 로그인 뒤 만든 결과(studio_jobs)를 한곳에서 연다.
import { mountShell, h } from '../app/shell.js';
import { createLibrary } from '../plan/library.js';
import { thumbSvg } from './thumb.js';

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };
let storage, kept = true;
try { storage = window.localStorage; storage.getItem('ain-plan-docs'); } catch (e) { storage = memory(); kept = false; }   // 저장소를 못 쓰는 브라우저(사생활 보호 창): 이 화면 안에서만
const lib = createLibrary(storage);
const S = { view: 'all', sort: 'recent', session: null, jobs: null, jobsErr: '', entered: false, menuFk: null };
const STATUS = { uploading: '올리는 중', queued: '대기', running: '만드는 중', done: '완료', failed: '실패', expired: '보관 끝' };
const TOOLN = { plan3d: '도면대로', interior: '사진처럼', design: '디자인 제안', erase: '지우개', cutout: '배경 떼기' };
const TITLE = { all: '전체 프로젝트', bookmark: '북마크', jobs: '작업 결과', trash: '휴지통' };
const day = (ms) => new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
const area = (m) => (m.areaM2 ? m.areaM2.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) + '㎡' : '방 없음');
const SORTS = { recent: ['최근 수정', (a, b) => b.updated - a.updated], name: ['이름', (a, b) => a.title.localeCompare(b.title, 'ko')], area: ['면적', (a, b) => b.areaM2 - a.areaM2] };
const NOT_READ = '이 도면을 읽지 못했습니다 · 저장된 내용이 손상됐습니다';

let ui;                                                   // { main, views, bar, list, msg, live, barTitle }
const client = () => window.ainAuth && window.ainAuth.getClient();
const keyOf = (e) => (e && e.dataset ? e.dataset.fk : null);
function focusKey(fk) {                                   // render 가 눌린 요소를 새로 만들어도 키보드 초점이 그 자리로 돌아오게 — 없어졌으면(휴지통으로 간 카드) 목록 제목으로
  if (!fk) return;
  const t = [...document.querySelectorAll('[data-fk]')].find((e) => e.dataset.fk === fk) || ui.barTitle;
  if (t) t.focus({ preventScroll: true });
}

function dialog(title, body, actions, returnFk) {         // 이름 바꾸기·완전 삭제 확인용 작은 창 — 닫으면 창을 치우고 초점은 눌렀던 자리로(Esc 로 닫는 경우는 close 이벤트가 같은 일을 한다)
  let done = false;
  const finish = () => { if (done) return; done = true; dlg.remove(); focusKey(returnFk); };
  const close = () => { if (dlg.open) dlg.close(); finish(); };
  const dlg = h('dialog', { class: 'pj-dlg', 'aria-label': title }, [h('h2', { text: title }), body, h('div', { class: 'row' }, actions(close))]);
  dlg.addEventListener('close', finish);
  document.body.append(dlg); dlg.showModal(); return { dlg, close };
}
function rename(m, returnFk) {
  const note = h('p', { class: 'pj-msg err', role: 'alert', hidden: true });
  const input = h('input', { type: 'text', maxlength: '60', value: m.title, 'aria-label': '도면 이름', 'aria-describedby': 'pjRenameNote' });
  note.id = 'pjRenameNote';
  const fail = (t) => { note.textContent = t; note.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); };
  const save = (close) => { try { if (lib.renamePlan(m.id, input.value)) { close(); render(); } else fail(input.value.trim() ? NOT_READ : '이름을 입력해 주세요'); } catch (e) { fail(e.message); } };
  const d = dialog('이름 바꾸기', h('div', {}, [input, note]), (close) => [h('button', { type: 'button', class: 'pj-btn', text: '취소', onclick: close }), h('button', { type: 'button', class: 'pj-btn primary', text: '저장', onclick: () => save(close) })], returnFk);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(d.close); } });
  input.select();
}
function confirmDelete(m, returnFk) {
  dialog('완전히 삭제할까요?', h('p', { class: 'pj-msg', text: `‘${m.title}’은 복원할 수 없습니다.` }), (close) => [h('button', { type: 'button', class: 'pj-btn', text: '취소', onclick: close }), h('button', { type: 'button', class: 'pj-btn danger', text: '삭제', onclick: () => { lib.deletePlan(m.id); close(); render(); } })], returnFk);
}
function guard(fn) {                                      // 저장소 오류는 화면에 말하고, 성공하면 지난 오류 글을 지운다
  ui.msg.className = 'pj-msg'; ui.msg.textContent = '';
  try { if (fn() === null) { ui.msg.className = 'pj-msg err'; ui.msg.textContent = NOT_READ; } } catch (e) { ui.msg.className = 'pj-msg err'; ui.msg.textContent = e.message; }
  const fk = keyOf(document.activeElement) || S.menuFk; S.menuFk = null; render(fk);   // 메뉴에서 누른 동작은 메뉴가 먼저 닫혀 초점이 없다 — 메뉴를 연 자리로(없어진 카드면 목록 제목으로)
}

let open = null;                                          // 열린 관리 메뉴 { box, anchor, off }
function closeMenu(refocus) {
  if (!open) return;
  const { box, anchor, off } = open; open = null;
  box.remove(); anchor.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', off, true); document.removeEventListener('keydown', off, true);
  if (refocus) anchor.focus();
}
function menu(anchor, m) {                                // 관리 단추 — 이름 바꾸기·복제·휴지통(휴지통 화면은 복원·완전 삭제). 위·아래 화살표·Home·End 로 이동, Esc·Tab 으로 닫는다
  if (open && open.anchor === anchor) return closeMenu(true);
  closeMenu(false);
  const trash = S.view === 'trash', fk = keyOf(anchor); S.menuFk = fk;
  const items = trash ? [['복원', () => guard(() => lib.restorePlan(m.id)), ''], ['완전 삭제', () => confirmDelete(m, fk), 'danger']]
    : [['이름 바꾸기', () => rename(m, fk), ''], ['복제', () => guard(() => lib.duplicatePlan(m.id)), ''], ['휴지통', () => guard(() => lib.trashPlan(m.id)), 'danger']];
  const box = h('div', { class: 'pj-menu', role: 'menu', 'aria-label': `${m.title} 관리` }, items.map(([t, fn, c]) => h('button', { type: 'button', role: 'menuitem', class: c, text: t, onclick: () => { closeMenu(false); fn(); } })));
  const btns = [...box.children];
  box.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement), go = (n) => { e.preventDefault(); btns[(n + btns.length) % btns.length].focus(); };
    if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1); else if (e.key === 'Home') go(0); else if (e.key === 'End') go(btns.length - 1);
    else if (e.key === 'Tab') closeMenu(false);
  });
  const off = (e) => { if (e.type === 'keydown') { if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); } } else if (!box.contains(e.target) && e.target !== anchor) closeMenu(false); };
  anchor.parentElement.append(box); anchor.setAttribute('aria-expanded', 'true'); open = { box, anchor, off };
  document.addEventListener('click', off, true); document.addEventListener('keydown', off, true);
  btns[0].focus();
}

function card(m, i) {
  const href = '/maker/3d/plan/?doc=' + encodeURIComponent(m.id), trash = !!m.trashed;
  let doc = null, bad = false;
  try { doc = lib.getPlan(m.id); bad = !doc; } catch (e) { bad = true; }
  let thumb;
  try { thumb = thumbSvg(doc); } catch (e) { thumb = thumbSvg(null); bad = true; }   // 깨진 도면 한 건이 목록 전체를 막지 않게
  const more = h('button', { type: 'button', 'data-fk': 'more:' + m.id, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `${m.title} 관리`, text: '관리', onclick: (e) => menu(e.currentTarget, m) });
  const mark = h('button', { type: 'button', 'data-fk': 'mark:' + m.id, 'aria-pressed': m.bookmark ? 'true' : 'false', 'aria-label': `${m.title} 북마크`, text: '북마크', onclick: () => guard(() => lib.setBookmark(m.id, !m.bookmark)) });
  return h('article', { class: 'pj-card' + (S.entered ? ' still' : ''), style: `--i:${Math.min(i, 12)}` }, [
    h('a', { class: 'pj-thumb', href, tabindex: '-1', 'aria-hidden': 'true' }, [thumb]),
    h('div', { class: 'pj-meta' }, [h('h3', {}, [trash ? h('span', { text: m.title }) : h('a', { href, text: m.title })]), h('p', { class: bad ? 'bad' : null, text: bad ? NOT_READ : `수정 ${day(m.updated)} · 방 ${m.rooms} · ${area(m)}${m.ac ? ` · 에어컨 ${m.ac}` : ''}` })]),
    h('div', { class: 'pj-acts' }, [trash ? null : mark, more]),
  ]);
}
function newCard() {
  const input = h('input', { type: 'text', maxlength: '80', placeholder: '예) 거실 보여줘', 'aria-label': '말로 시키기' });
  return h('div', { class: 'pj-new' + (S.entered ? ' still' : ''), style: '--i:0' }, [
    h('h3', { text: '새 프로젝트' }), h('p', { text: '평면을 그려 시작하거나 도면 한 장을 올려 시작합니다.' }),
    h('div', { class: 'row' }, [h('a', { class: 'pj-btn primary', href: '/maker/3d/plan/?new=1', text: '도면 그리기' }), h('a', { class: 'pj-btn', href: '/maker/3d/', text: '도면 올리기' })]),
    h('form', { class: 'pj-ask', onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) location.href = '/maker/3d/?ask=' + encodeURIComponent(v); } }, [input, h('button', { type: 'submit', class: 'pj-btn', text: '말로 시키기' })]),
  ]);
}
function empty(title, text) { return h('div', { class: 'pj-empty' }, [h('strong', { text: title }), text]); }

async function loadJobs() {
  S.jobs = null; S.jobsErr = '';
  try {
    S.session = await window.ainAuth.getSession();
    if (S.session) {
      const r = await client().from('studio_jobs').select('id,tool,status,created_at').order('id', { ascending: false }).limit(50);
      if (r.error) S.jobsErr = '결과 목록을 불러오지 못했습니다 · 잠시 뒤 다시 열어 주세요'; else S.jobs = r.data;
    } else S.jobs = [];
  } catch (e) { S.session = null; S.jobs = []; }
  render(keyOf(document.activeElement));
}

function render(fk) {
  fk = fk || keyOf(document.activeElement);
  const all = lib.listPlans(), trash = lib.listPlans({ trashed: true }), marks = all.filter((m) => m.bookmark);
  const counts = { all: all.length, bookmark: marks.length, jobs: S.jobs ? S.jobs.length : 0, trash: trash.length };
  ui.views.replaceChildren(h('h2', { text: '보기' }), ...Object.keys(TITLE).map((k) => h('button', { type: 'button', class: 'pj-view', 'data-fk': 'v:' + k, 'aria-pressed': S.view === k ? 'true' : 'false', onclick: () => { S.view = k; render('v:' + k); } }, [TITLE[k], h('span', { class: 'n', text: k === 'jobs' && S.jobs === null ? '' : String(counts[k]) })])));
  const plans = (S.view === 'bookmark' ? marks : S.view === 'trash' ? trash : all).slice().sort(SORTS[S.sort][1]);
  ui.barTitle = h('h2', { tabindex: '-1' }, [TITLE[S.view], h('small', { text: S.view === 'jobs' ? '' : `${plans.length}개` })]);
  ui.bar.replaceChildren(ui.barTitle,
    S.view === 'jobs' ? null : h('label', { class: 'pj-sort' }, ['정렬', h('select', { 'data-fk': 'sort', onchange: (e) => { S.sort = e.target.value; render('sort'); } }, Object.entries(SORTS).map(([k, [t]]) => h('option', { value: k, selected: S.sort === k, text: t })))]));
  let body;
  if (S.view === 'jobs') {
    body = S.jobs === null ? h('p', { class: 'pj-msg', text: '불러오는 중…' })
      : S.jobsErr ? h('p', { class: 'pj-msg err', text: S.jobsErr })
        : !S.session ? empty('로그인하면 만든 결과를 볼 수 있습니다', '오른쪽 위 로그인으로 들어오세요. 그린 도면은 로그인 없이 이 브라우저에 저장됩니다.')
          : !S.jobs.length ? empty('아직 만든 결과가 없습니다', '시작하기에서 도면을 올려 만들면 여기에 쌓입니다.')
            : h('div', { class: 'pj-jobs' }, S.jobs.map((j) => h('a', { class: 'pj-job', href: '/maker/3d/#job-' + j.id }, [h('span', { text: `${TOOLN[j.tool] || '도면'} · ${new Date(j.created_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` }), h('span', { class: 's', text: STATUS[j.status] || j.status })])));
  } else if (S.view === 'all') {
    body = h('div', { class: 'pj-grid' }, [newCard(), ...plans.map((m, i) => card(m, i + 1))]);
  } else {
    body = plans.length ? h('div', { class: 'pj-grid' }, plans.map((m, i) => card(m, i)))
      : S.view === 'bookmark' ? empty('북마크한 도면이 없습니다', '카드의 [북마크]를 누르면 여기에 모입니다.') : empty('휴지통이 비어 있습니다', '지운 도면은 여기에 남아 있다가 [완전 삭제]로만 사라집니다.');
  }
  ui.list.replaceChildren(body);
  ui.live.textContent = S.view === 'jobs' ? TITLE[S.view] : `${TITLE[S.view]} ${plans.length}개`;   // 바뀐 결과만 알린다(목록 전체를 다시 읽지 않게 목록 영역은 라이브가 아니다)
  if (!kept && !ui.msg.textContent) ui.msg.textContent = '이 브라우저는 저장소를 막아 두었습니다 · 도면은 이 화면을 닫으면 사라집니다.';
  S.entered = true;                                       // 입장 애니메이션은 처음 한 번만
  focusKey(fk);
}

function boot() {
  const { main } = mountShell({ active: 'projects' });
  try { window.ainAuth.init('authSlot'); } catch (e) {}
  ui = { main, views: h('nav', { class: 'pj-views', 'aria-label': '보기' }), bar: h('div', { class: 'pj-bar' }), list: h('div'), msg: h('p', { class: 'pj-msg', role: 'status' }), live: h('p', { class: 'ap-vh', role: 'status' }), barTitle: null };
  main.append(
    h('div', { class: 'pj-head' }, [h('h1', { text: '프로젝트' }), h('a', { class: 'pj-btn primary', href: '/maker/3d/plan/?new=1', text: '새 프로젝트' })]),
    h('section', { class: 'pj-hints', 'aria-label': '시작 방법' }, [
      h('a', { class: 'pj-hint', href: '/maker/3d/plan/?new=1' }, [h('strong', { text: '도면 그리기' }), h('span', { text: '벽과 방을 그려 평면을 만들고 에어컨을 놓습니다.' })]),
      h('a', { class: 'pj-hint', href: '/maker/3d/maps/' }, [h('strong', { text: '도면 검색' }), h('span', { text: '단지를 찾아 그 평면에서 시작합니다.' })]),
      h('a', { class: 'pj-hint', href: '/maker/3d/' }, [h('strong', { text: '시작하기' }), h('span', { text: '도면 한 장을 올리면 렌더와 물량표가 나옵니다.' })]),
    ]),
    h('div', { class: 'pj-split' }, [ui.views, h('section', { class: 'pj-list', 'aria-label': '프로젝트 목록' }, [ui.bar, ui.msg, ui.live, ui.list])]));
  render();
  const wait = (n = 0) => (window.ainAuth ? loadJobs() : n < 40 ? setTimeout(() => wait(n + 1), 100) : (S.jobs = [], render()));
  wait();
  document.title = '내 프로젝트 | 3D 스튜디오';
}
boot();
