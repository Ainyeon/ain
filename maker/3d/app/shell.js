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
  { items: [{ id: 'start', label: '시작하기', href: '/maker/3d/' }, { id: 'ask', label: '말로 시키기', href: '/maker/3d/#stAsk' }] },
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
  const top = h('header', { class: 'ap-top' }, [h('a', { class: 'ap-brand sm', href: '/maker/3d/', 'aria-label': '3D 스튜디오 시작' }, [h('img', { src: '/assets/ain-wordmark-v4.svg', alt: 'A.IN', height: 20 })]), authSlot]);
  const main = h('main', { class: 'ap-main', id: 'main', tabindex: '-1' });
  root.replaceChildren(side, h('div', { class: 'ap-col' }, [top, main]));
  return { main, top, side, authSlot };
}
