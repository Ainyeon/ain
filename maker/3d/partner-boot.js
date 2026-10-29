// 공동 브랜드(파트너) 화면 · 임베드 — 주소의 ?partner=<이름> · ?embed=1 을 첫 그림 전에 표시로 걸어 둔다(깜빡임 방지).
// 값은 여기서 쓰지 않는다 — studio.js 가 파트너 자료를 받아 검증한 뒤 쓴다. 못 받으면 에인연 화면 그대로.
(function () {
  var q = new URLSearchParams(location.search), p = q.get('partner') || '', r = document.documentElement;
  if (!p && /access_token=|[?&]code=/.test(location.hash + location.search)) {   // 로그인 왕복에서 돌아옴 — 가기 전의 파트너 화면으로(15분 안)
    try { var s = JSON.parse(localStorage.getItem('ain-partner') || 'null'); if (s && Date.now() - s.at < 900000) p = String(s.id || ''); localStorage.removeItem('ain-partner'); } catch (e) {}
  }
  if (/^[a-z0-9-]{1,32}$/.test(p)) {
    r.setAttribute('data-partner', p);
    window.__ptCfg = fetch('/maker/3d/partners/' + p + '.json').then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; });   // 스크립트 사슬을 기다리지 않고 지금 받기 시작한다(검증은 studio.js 가 한다)
    try {                                                // 지난 방문에 studio.js 가 검증해 둔 색만(#rrggbb 셋) — 첫 그림부터 파트너 색이라 에인연 색이 잠깐 비치지 않는다
      var c = JSON.parse(localStorage.getItem('ain-pt-' + p) || 'null');
      if (c && c.length === 3 && c.every(function (v) { return /^#[0-9a-f]{6}$/i.test(v); })) { r.style.setProperty('--c-accent', c[0]); r.style.setProperty('--c-accent-bg', c[1]); r.style.setProperty('--c-accent-line', c[2]); }
    } catch (e) {}
  }
  if (q.get('embed') === '1') r.setAttribute('data-embed', '');
}());
