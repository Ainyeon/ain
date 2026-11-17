// 갤러리 — 렌더샷(PNG)을 이 브라우저(IndexedDB)에 모아 두고 보고·내려받고·지운다. 서버로 보내지 않는다
const DB = 'ain-gallery', ST = 'shots';

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(ST, mode), req = fn(t.objectStore(ST));
    t.oncomplete = () => { d.close(); res(req.result); };
    t.onerror = t.onabort = () => { d.close(); rej(t.error || new Error('저장 공간을 쓸 수 없습니다')); };
  });
}
// shot = {planId, title, view('2D'|'3D'), at(ISO), w, h, blob} → id
export const addShot = (shot) => tx('readwrite', (s) => s.add(shot));
export const listShots = () => tx('readonly', (s) => s.getAll()).then((a) => a.sort((x, y) => y.id - x.id));
export const deleteShot = (id) => tx('readwrite', (s) => s.delete(id));

const fileName = (s) => `ain-렌더샷-${String(s.title || '도면').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)}-${s.id}.png`;
const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }); };

// 창으로 연다 — app.js 의 h·openDialog·download·toast·choose 를 받는다. planId 가 있으면 이 도면 것을 앞에 둔다
export async function openGallery({ h, openDialog, download, toast, choose }, { planId = null } = {}) {
  let shots;
  try { shots = await listShots(); } catch (e) { toast('갤러리를 열지 못했습니다', 'err'); return null; }
  const urls = [], grid = h('ul', { class: 'ed-gal' });
  const empty = () => h('p', { class: 'ed-note', text: '아직 찍은 렌더샷이 없습니다' });
  const card = (s) => {
    const url = URL.createObjectURL(s.blob); urls.push(url);
    const li = h('li', { class: 'ed-gal-i' + (planId && s.planId === planId ? ' cur' : '') }, [
      h('a', { class: 'ed-gal-im', href: url, target: '_blank', rel: 'noopener', 'aria-label': `${s.title} 렌더샷 크게 보기` }, [h('img', { src: url, alt: '', loading: 'lazy', width: 320, height: Math.round(320 * (s.h / s.w || 0.6)) })]),
      h('div', { class: 'ed-gal-t' }, [h('strong', { text: s.title || '도면' }), h('span', { text: `${s.view} · ${s.w}×${s.h} · ${when(s.at)}` })]),
      h('div', { class: 'ed-gal-a' }, [
        h('button', { type: 'button', class: 'ed-b ghost', onclick: () => download(fileName(s), s.blob) }, [h('span', { class: 'ico i-download-simple', 'aria-hidden': 'true' }), '내려받기']),
        h('button', { type: 'button', class: 'ed-b ghost danger', onclick: async () => {
          if ((await choose('렌더샷 지우기', '지운 렌더샷은 되살릴 수 없습니다.', [{ label: '취소', value: false }, { label: '지우기', value: true, danger: true }])) !== true) return;
          try { await deleteShot(s.id); li.remove(); if (!grid.children.length) grid.replaceWith(empty()); toast('지웠습니다'); } catch (e) { toast('지우지 못했습니다', 'err'); }
        } }, [h('span', { class: 'ico i-trash', 'aria-hidden': 'true' }), '지우기'])]),
    ]);
    return li;
  };
  const mine = planId ? shots.filter((s) => s.planId === planId) : [];
  for (const s of [...mine, ...shots.filter((s) => !mine.includes(s))]) grid.append(card(s));
  return openDialog('갤러리', shots.length ? grid : empty(), { onclose: () => urls.forEach((u) => URL.revokeObjectURL(u)) });
}
