// 스튜디오 첫 화면의 '최근 프로젝트' — 이 브라우저에 저장한 도면(plan/library.js) 최근 4개를 썸네일과 함께
import { createLibrary } from './plan/library.js';
import { thumbSvg } from './projects/thumb.js';

const box = document.getElementById('stRecent');
let lib = null;
try { lib = createLibrary(window.localStorage); } catch (e) { /* 저장소를 못 쓰면 안내 문구 그대로 */ }
const list = lib ? lib.listPlans().slice(0, 4) : [];
if (box && list.length) {
  const day = (ms) => new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
  box.replaceChildren(...list.map((m) => {
    const li = document.createElement('li'), a = document.createElement('a'), th = document.createElement('span'), t = document.createElement('strong'), d = document.createElement('span');
    a.className = 'st-pj'; a.href = '/maker/3d/plan/?doc=' + encodeURIComponent(m.id);
    th.className = 'st-pj-th'; try { th.append(thumbSvg(lib.getPlan(m.id))); } catch (e) { /* 깨진 도면은 빈 칸 */ }
    t.textContent = m.title; d.textContent = day(m.updated);
    a.append(th, t, d); li.append(a); return li;
  }));
}
