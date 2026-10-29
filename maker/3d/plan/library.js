// 도면 문서 보관 — localStorage 에 목록(meta)과 문서를 따로 둔다. DOM 없음: node 에서 storage 를 주입해 테스트하고, 편집기와 프로젝트 화면이 같이 쓴다.
const LIST = 'ain-plan-docs', KEY = (id) => 'ain-plan-' + id;
export const QUOTA_MSG = '저장 공간이 부족합니다 · 안 쓰는 도면을 지워 주세요';
const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
const polyAreaM2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2 / 1e6; };

// 문서에서 목록에 보일 수치(전 층 방 면적 합·방 수·에어컨 수)
export function summarize(doc) {
  let rooms = 0, area = 0, ac = 0;
  for (const f of (doc && doc.floors) || []) {
    for (const r of f.rooms || []) { rooms++; if (Array.isArray(r.poly) && r.poly.length > 2) area += polyAreaM2(r.poly); }
    ac += (f.items || []).filter((i) => i.kind === 'ac').length;
  }
  return { floors: ((doc && doc.floors) || []).length, rooms, areaM2: Math.round(area * 100) / 100, ac };
}

export function createLibrary(storage, now = () => Date.now(), rand = Math.random) {
  const meta = (m) => m && typeof m.id === 'string' && /^p[a-z0-9]+$/.test(m.id) && typeof m.title === 'string' && Number.isFinite(m.updated);
  const readList = () => { try { const a = JSON.parse(storage.getItem(LIST) || '[]'); return Array.isArray(a) ? a.filter(meta) : []; } catch (e) { return []; } };
  const put = (k, v) => { try { storage.setItem(k, v); } catch (e) { throw isQuota(e) ? new Error(QUOTA_MSG) : e; } };
  const writeList = (list) => put(LIST, JSON.stringify(list.slice().sort((a, b) => b.updated - a.updated)));
  const newId = () => 'p' + now().toString(36) + Math.floor(rand() * 46656).toString(36).padStart(3, '0');
  const find = (id) => readList().find((m) => m.id === id) || null;
  const patch = (id, p) => { const list = readList(), m = list.find((x) => x.id === id); if (!m) return null; Object.assign(m, p); writeList(list); return m; };

  return {
    listPlans({ trashed = false } = {}) { return readList().filter((m) => !!m.trashed === !!trashed).sort((a, b) => b.updated - a.updated); },
    allPlans() { return readList(); },
    getMeta: find,
    getPlan(id) { try { const d = JSON.parse(storage.getItem(KEY(id)) || 'null'); return d && d.v === 1 && Array.isArray(d.floors) ? d : null; } catch (e) { return null; } },
    lastPlanId() { const m = this.listPlans()[0]; return m ? m.id : null; },
    savePlan(doc, { id } = {}) {                  // 문서와 목록을 같이 쓴다 — 문서가 들어갔는데 목록이 실패하면 새로 만든 문서는 되돌린다
      const list = readList(), old = id ? list.find((m) => m.id === id) : null, nid = old ? old.id : newId();
      const m = Object.assign({ id: nid, title: String(doc.title || '이름 없는 도면').slice(0, 60), updated: now(), bookmark: old ? !!old.bookmark : false, trashed: false }, summarize(doc));
      put(KEY(nid), JSON.stringify(doc));
      try { writeList(old ? list.map((x) => (x.id === nid ? m : x)) : list.concat(m)); } catch (e) { if (!old) try { storage.removeItem(KEY(nid)); } catch (e2) {} throw e; }
      return m;
    },
    trashPlan(id) { return patch(id, { trashed: true }); },
    restorePlan(id) { return patch(id, { trashed: false, updated: now() }); },
    deletePlan(id) { writeList(readList().filter((m) => m.id !== id)); try { storage.removeItem(KEY(id)); } catch (e) {} },
    duplicatePlan(id) { const d = this.getPlan(id); if (!d) return null; const c = JSON.parse(JSON.stringify(d)); c.title = String(d.title || '이름 없는 도면').slice(0, 54) + ' 사본'; return this.savePlan(c); },
    setBookmark(id, on) { return patch(id, { bookmark: !!on }); },
    renamePlan(id, title) { const t = String(title || '').trim().slice(0, 60); if (!t) return null; const d = this.getPlan(id); if (d) { d.title = t; put(KEY(id), JSON.stringify(d)); } return patch(id, { title: t }); },
  };
}
