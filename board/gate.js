// 비회원 즉시 게이트 — supabase-js(CDN)·세션 조회 전에 동기 렌더.
// 세션 토큰이 localStorage에 없으면 "불러오는 중"을 건너뛰고 가입 안내를 먼저 보여준다.
// 로그인 상태면 아무것도 하지 않는다 (board-*.js가 목록 렌더).
(function () {
  try { if (localStorage.getItem('sb-oqgoibbhnidsveueifet-auth-token')) return; } catch (e) { /* 저장소를 못 읽으면 게이트를 먼저 보여 준다 */ }
  var panel = document.getElementById('panel');
  if (!panel) return;
  panel.innerHTML = '<div class="gate-msg"><b>회원 전용입니다</b><br>'
    + '카카오 계정으로 로그인하면 읽고 쓸 수 있습니다.<br>'
    + '<button type="button" class="gate-cta" id="gateLogin">카카오 로그인</button></div>';
  document.getElementById('gateLogin').addEventListener('click', function () {
    // 느린 폰에서 로그인 모듈이 아직 안 왔으면 조용히 무시하지 않고 알린다
    if (!window.ainAuth) { this.textContent = '잠시만요… 다시 눌러 주세요'; return; }
    ainAuth.login();
  });
})();
