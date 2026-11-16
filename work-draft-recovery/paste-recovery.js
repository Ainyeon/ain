(function () {
  'use strict';
  if (!['https://ainyeon.com', 'https://www.ainyeon.com'].includes(location.origin)) return;
  const section = document.getElementById('paste-recovery');
  const consent = document.getElementById('paste-confirm');
  const read = document.getElementById('paste-read');
  const result = document.getElementById('paste-result');
  const text = document.getElementById('paste-text');
  const status = document.getElementById('paste-status');
  const hide = () => { text.value = ''; result.hidden = true; };
  section.hidden = false;
  read.addEventListener('click', () => {
    hide();
    if (!consent.checked) { status.textContent = '먼저 확인 항목을 선택해 주세요.'; return; }
    try {
      const raw = sessionStorage.getItem('work_paste');
      if (raw === null) { status.textContent = '이 탭에 남은 붙여넣기 내용이 없어요. 다른 탭에서 작성했다면 그 탭에서 다시 열어 주세요.'; return; }
      if (raw.length > 2000000) { status.textContent = '내용이 너무 커 화면에 표시할 수 없어요. 원본은 그대로 남아 있습니다.'; return; }
      text.value = raw; result.hidden = false;
      status.textContent = '이 탭에 남은 원문입니다. 고객 정보가 있으면 공개하지 마세요.';
    } catch (_) { status.textContent = '이 탭의 임시 저장소를 읽을 수 없어요. 원본은 변경하지 않았습니다.'; }
  });
  consent.addEventListener('change', () => { if (!consent.checked) { hide(); status.textContent = ''; } });
  document.getElementById('paste-select').addEventListener('click', () => { text.focus(); text.select(); });
  document.getElementById('paste-hide').addEventListener('click', () => { hide(); status.textContent = '화면에서 숨겼어요. 원본은 변경하지 않았습니다.'; });
  window.addEventListener('pagehide', hide);
})();
