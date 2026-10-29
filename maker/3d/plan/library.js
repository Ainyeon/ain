// 도면 문서 보관 — localStorage 에 목록(meta)과 문서를 따로 둔다. DOM 없음: node 에서 storage 를 주입해 테스트하고, 편집기와 프로젝트 화면이 같이 쓴다.
const LIST = 'ain-plan-docs', KEY = (id) => 'ain-plan-' + id;
export const QUOTA_MSG = '저장 공간이 부족합니다 · 안 쓰는 도면을 지워 주세요';
const isQuota = (e) => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
const polyAreaM2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2 / 1e6; };

// 문서에서 목록에 보일 수치(전 층 방 면적 합·방 수·에어컨 수)
export function summarize(doc) {
  let rooms = 0, area = 0, ac = 0;
  for (const f of (doc && Array.isArray(doc.floors) ? doc.floors : [])) {
    if (!f || typeof f !== 'object') continue;                    // 깨진 항목(null)은 세지 않는다 — 한 건이 저장·목록을 막지 않게
    for (const r of Array.isArray(f.rooms) ? f.rooms : []) { if (!r || typeof r !== 'object') continue; rooms++; if (Array.isArray(r.poly) && r.poly.length > 2 && r.poly.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) area += polyAreaM2(r.poly); }
    ac += (Array.isArray(f.items) ? f.items : []).filter((i) => i && i.kind === 'ac').length;
  }
  return { floors: doc && Array.isArray(doc.floors) ? doc.floors.length : 0, rooms, areaM2: Math.round(area * 100) / 100, ac };
}

export function createLibrary(storage, now = () => Date.now(), rand = Math.random) {
  const meta = (m) => m && typeof m.id === 'string' && /^p[a-z0-9]+$/.test(m.id) && typeof m.title === 'string' && Number.isFinite(m.updated);
  const readList = () => { try { const a = JSON.parse(storage.getItem(LIST) || '[]'); return Array.isArray(a) ? a.filter(meta) : []; } catch (e) { return []; } };
  const put = (k, v) => { try { storage.setItem(k, v); } catch (e) { throw isQuota(e) ? new Error(QUOTA_MSG) : e; } };
  const writeList = (list) => put(LIST, JSON.stringify(list.slice().sort((a, b) => b.updated - a.updated)));
  const newId = () => 'p' + now().toString(36) + Math.floor(rand() * 46656).toString(36).padStart(3, '0');
  const find = (id) => readList().find((m) => m.id === id) || null;
  const undo = (id, prev) => { try { if (prev == null) storage.removeItem(KEY(id)); else storage.setItem(KEY(id), prev); } catch (e) {} };   // 되돌리기도 실패하면 어쩔 수 없다 — 다음 저장이 맞춘다
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
      const prev = storage.getItem(KEY(nid));                         // 덮어쓰기가 실패하면 이 본문으로 되돌린다
      put(KEY(nid), JSON.stringify(doc));
      try { writeList(old ? list.map((x) => (x.id === nid ? m : x)) : list.concat(m)); } catch (e) { undo(nid, prev); throw e; }
      return m;
    },
    trashPlan(id) { return patch(id, { trashed: true }); },
    restorePlan(id) { return patch(id, { trashed: false, updated: now() }); },
    deletePlan(id) { writeList(readList().filter((m) => m.id !== id)); try { storage.removeItem(KEY(id)); } catch (e) {} },
    duplicatePlan(id) { const d = this.getPlan(id); if (!d) return null; const c = JSON.parse(JSON.stringify(d)); c.title = String(d.title || '이름 없는 도면').slice(0, 54) + ' 사본'; return this.savePlan(c); },
    setBookmark(id, on) { return patch(id, { bookmark: !!on }); },
    renamePlan(id, title) {                      // 문서 안 제목과 목록을 같이 바꾼다 — 목록 쓰기가 실패하면 본문도 되돌린다
      const t = String(title || '').trim().slice(0, 60); if (!t || !find(id)) return null;
      const d = this.getPlan(id), prev = storage.getItem(KEY(id));
      if (d) { d.title = t; put(KEY(id), JSON.stringify(d)); }
      try { return patch(id, { title: t }); } catch (e) { if (d) undo(id, prev); throw e; }
    },
  };
}
