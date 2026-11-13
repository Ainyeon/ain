// 플래너 시험용 가짜 캔버스 — view2d.js·sheet.js 의 그리기를 node 에서 그대로 돌리고 부른 것만 적는다(그림은 그리지 않는다). test-plan-axo.js·test-plan-sheet.js 가 쓴다
'use strict';
// log: [이름, 인자 배열, 그때의 fillStyle] · 캔버스 width 를 넣을 때마다 ['size'] 가 한 줄 들어간다(그림 한 장의 시작)
function fakeCanvas(log = []) {
  const props = {}, ctx = new Proxy({}, {
    get: (_, k) => (k in props ? props[k] : k === 'measureText' ? (t) => ({ width: String(t).length * 6 }) : (...a) => { log.push([k, a, props.fillStyle]); }),
    set: (_, k, v) => { props[k] = v; return true; } });
  let w = 300;
  return { log, height: 150, attrs: {}, dataset: {}, style: {}, get width() { return w; }, set width(v) { w = v; log.push(['size', [v]]); }, getContext: () => ctx, setAttribute(k, v) { this.attrs[k] = v; }, toBlob(cb, type) { this.blobType = type; cb({}); } };
}
// document·window·getComputedStyle 을 깐다 → { canvases(만든 순서), body(class Set), fire(창 이벤트 이름), printed() }
function fakeDom() {
  const canvases = [], cls = new Set(), on = {}; let printed = 0;
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => n, fontFamily: 'f' });   // 색 토큰은 이름 그대로 돌려준다(어느 색을 썼는지 읽힌다)
  globalThis.document = { documentElement: {}, body: { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } }, createElement: () => { const c = fakeCanvas(); canvases.push(c); return c; } };
  globalThis.window = { addEventListener: (t, f) => (on[t] ??= new Set()).add(f), removeEventListener: (t, f) => on[t]?.delete(f), print: () => { printed++; } };
  return { canvases, body: cls, fire: (t) => [...(on[t] || [])].forEach((f) => f()), listeners: (t) => (on[t] ? on[t].size : 0), printed: () => printed };
}
module.exports = { fakeCanvas, fakeDom };
