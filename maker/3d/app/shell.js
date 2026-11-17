// 스튜디오 앱 셸 — 왼쪽 사이드바(글자만, 아이콘 없음)·위 바·본문 칸. 폰에서는 아래 탭. 프로젝트 화면 등이 같이 쓴다.
export function h(tag, attrs = {}, kids = []) {          // DOM 헬퍼 — 글은 textContent 로만 넣는다
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(kids)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export const NAV = [
  { items: [{ id: 'start', label: '시작하기', href: '/maker/3d/' }, { id: 'ask', label: 'AI 에이전트', href: '/maker/3d/agent/' }] },
  { label: '프로젝트', items: [{ id: 'projects', label: '내 프로젝트', href: '/maker/3d/projects/' }] },
  { label: '도면', items: [{ id: 'plan', label: '도면 그리기', href: '/maker/3d/plan/' }, { id: 'maps', label: '도면 검색', href: '/maker/3d/maps/' }] },
];

export function mountShell({ active, root = document.getElementById('app') }) {
  const link = (it) => h('a', { class: 'ap-link', href: it.href, 'aria-current': it.id === active ? 'page' : null, text: it.label });
  const side = h('aside', { class: 'ap-side' }, [
    h('a', { class: 'ap-brand', href: '/maker/3d/', 'aria-label': '3D 스튜디오 시작' }, [h('img', { src: '/assets/ain-wordmark-v4.svg', alt: 'A.IN', height: 22 }), h('span', { text: '스튜디오' })]),
    h('nav', { class: 'ap-nav', 'aria-label': '스튜디오' }, NAV.map((g) => h('div', { class: 'ap-group' }, [g.label ? h('p', { class: 'ap-glabel', text: g.label }) : null, ...g.items.map(link)]))),
    h('a', { class: 'ap-foot', href: '/', text: '홈페이지로' }),
  ]);
  const authSlot = h('div', { class: 'ap-auth', id: 'authSlot' });
  const bellBtn = h('button', { type: 'button', class: 'ap-bell', 'aria-label': '알림', hidden: true }, [h('span', { class: 'ap-i', 'aria-hidden': 'true' }), h('span', { class: 'ap-bell-n', hidden: true })]);
  const top = h('header', { class: 'ap-top' }, [h('a', { class: 'ap-brand sm', href: '/maker/3d/', 'aria-label': '3D 스튜디오 시작' }, [h('img', { src: '/assets/ain-wordmark-v4.svg', alt: 'A.IN', height: 20 })]), bellBtn, authSlot]);
  const main = h('main', { class: 'ap-main', id: 'main', tabindex: '-1' });
  root.replaceChildren(side, h('div', { class: 'ap-col' }, [top, main]));
  bell(bellBtn).catch(() => { /* 알림 없이 */ });
  return { main, top, side, authSlot };
}

// 알림(supabase/29_notices.sql) — 로그인한 회원만 종이 보인다. 열면 그때까지 온 것을 읽음으로
async function bell(btn) {
  const auth = window.ainAuth, sb = auth && auth.getClient();
  if (!sb || !(await auth.getSession().catch(() => null))) return;
  const { data: list, error } = await sb.from('notices').select('id,title,body,url,created_at,seen_at').order('id', { ascending: false }).limit(30);
  if (error) return;
  const badge = btn.lastChild;
  const paint = (n) => { badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n); btn.setAttribute('aria-label', n ? `알림 ${n}개 안 읽음` : '알림'); };
  paint(list.filter((x) => !x.seen_at).length);
  btn.hidden = false;
  const day = (t) => new Date(t).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  btn.onclick = () => {
    const close = h('button', { type: 'button', class: 'pj-btn', text: '닫기' });
    const items = list.length
      ? h('ul', { class: 'ap-notes' }, list.map((x) => h('li', { class: x.seen_at ? null : 'new' }, [h('a', { href: x.url }, [h('strong', { text: x.title }), x.body ? h('span', { text: x.body }) : null, h('time', { datetime: x.created_at, text: day(x.created_at) })])])))
      : h('p', { class: 'ap-notes-empty', text: '새 알림이 없습니다.' });
    const dlg = h('dialog', { class: 'pj-dlg ap-notes-dlg', 'aria-label': '알림' }, [h('h2', { text: '알림' }), items, h('div', { class: 'row' }, [close])]);
    close.onclick = () => dlg.close();
    dlg.addEventListener('close', () => { dlg.remove(); btn.focus(); });
    document.body.append(dlg); dlg.showModal(); close.focus();
    if (list.some((x) => !x.seen_at)) sb.rpc('notices_seen', { p_upto: list[0].id }).then(({ error: e }) => { if (!e) { list.forEach((x) => { x.seen_at = x.seen_at || 'now'; }); paint(0); } });
  };
}
