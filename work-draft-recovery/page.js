(function () {
  'use strict';
  const origin = location.origin;
  const source = document.getElementById('source'), destination = document.getElementById('destination');
  if (origin === 'https://ainyeon.com') source.hidden = false;
  else if (origin === 'https://modang.io') destination.hidden = false;
  else { document.getElementById('unavailable').hidden = false; return; }
  const exportButton = document.getElementById('export'), importButton = document.getElementById('import');
  const exportStatus = document.getElementById('export-status'), importStatus = document.getElementById('import-status');
  const listButton = document.getElementById('list-drafts'), listStatus = document.getElementById('list-status'), draftList = document.getElementById('draft-list');
  const conflicts = document.getElementById('conflicts'), conflictList = document.getElementById('conflict-list');
  function clearConflicts() { conflictList.replaceChildren(); conflicts.hidden = true; }
  document.getElementById('file').addEventListener('change', clearConflicts);
  window.addEventListener('storage', event => {
    if (!event.key || event.key.startsWith('sb-')) clearConflicts();
    if (!event.key || event.key.startsWith('sb-') || event.key.startsWith('work_draft_')) {
      draftList.replaceChildren(); listStatus.textContent = '계정이나 초안이 바뀌었습니다. 다시 찾아 주세요.';
    }
  });
  // 재인증 세션은 이 탭에만 둔다. 없으면 기존 에인연 세션을 검증한다.
  const identityStorage = {getItem(key) { const isolated=sessionStorage.getItem('ain-work-recovery-auth-v1'); return isolated === null ? localStorage.getItem(key) : isolated; }};
  const verify = () => window.workDraftAuth.createVerifier({storage:identityStorage, fetcher:fetch,
    publishableKey:window.workDraftPublicKey, serviceWorker:navigator.serviceWorker})();
  function errorMessage(error) {
    switch (error && error.message) {
      case 'worker-present':
        document.getElementById('worker-help').hidden = false;
        return '이전에 설치된 서비스 설정이 남아 있어 계정을 확인할 수 없습니다. 아래 안내를 확인해 주세요.';
      case 'session-unavailable': case 'identity-unverified': case 'session-changed':
        return '계정을 확인하지 못했습니다. 같은 계정의 로그인 상태와 인터넷 연결을 확인해 주세요.';
      case 'drafts-changed':
        return '다른 탭에서 초안이 바뀌었습니다. 업무 편집 탭을 닫고 다시 시도해 주세요.';
      case 'invalid-file': return '파일이 올바르지 않거나 현재 계정과 다릅니다. 원본 파일과 로그인 계정을 확인해 주세요.';
      case 'too-large': case 'invalid-draft':
        return '초안 크기가 너무 크거나 내용을 읽을 수 없습니다. 이전 자료는 그대로 두고 운영자에게 문의해 주세요.';
      default: return '자료를 처리하지 못했습니다. 기존 자료는 확인하지 않은 채 삭제하지 마세요.';
    }
  }
  document.getElementById('worker-release').addEventListener('click', async () => {
    const status = document.getElementById('worker-status'), button = document.getElementById('worker-release');
    if (!document.getElementById('worker-consent').checked) { status.textContent = '안내를 읽고 동의해 주세요.'; return; }
    button.disabled = true;
    try {
      await window.workDraftWorkerRelease.releaseKnownWorker(navigator.serviceWorker, location.origin);
      status.textContent = '설정을 해제했습니다. 다른 탭을 모두 닫고 이 화면을 새로고침한 뒤 다시 시도해 주세요.';
    } catch (_) {
      status.textContent = '예상한 설정을 확인하거나 해제하지 못했습니다. 기존 자료를 지우지 말고 운영자에게 문의해 주세요.';
    } finally { button.disabled = false; }
  });
  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true; exportStatus.textContent = '계정과 초안을 확인하고 있습니다.';
    try {
      const text = await window.workDraftRecovery.exportDrafts(localStorage, verify);
      const count = JSON.parse(text).drafts.length;
      if (!count) { exportStatus.textContent = '이 계정의 임시 저장 초안을 찾지 못했습니다.'; return; }
      const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
      const a = document.createElement('a'); a.href = url; a.download = '모당-업무-초안.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      exportStatus.textContent = `초안 ${count}개를 파일로 준비했습니다. 다운로드 목록에서 확인해 주세요.`;
    } catch (error) { exportStatus.textContent = errorMessage(error); }
    finally { exportButton.disabled = false; }
  });
  listButton.addEventListener('click', async () => {
    listButton.disabled = true; draftList.replaceChildren(); listStatus.textContent = '계정과 초안을 확인하고 있습니다.';
    try {
      const ids = await window.workDraftRecovery.listDraftIds(localStorage, verify);
      listStatus.textContent = ids.length ? `초안 ${ids.length}개를 찾았습니다. 각각 보관해 주세요.` : '이 계정의 임시 저장 초안을 찾지 못했습니다.';
      for (const id of ids) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = (id === 'new' ? '새 업무 초안' : '업무 초안 ' + id) + ' 받기';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const result = await window.workDraftRecovery.exportOneDraft(localStorage, verify, id);
            const url = URL.createObjectURL(new Blob([result.text], {type:result.recoverable ? 'application/json' : 'text/plain;charset=utf-8'}));
            const a = document.createElement('a'); a.href = url; a.download = '모당-업무-초안-' + id + (result.recoverable ? '.json' : '-원본.txt'); a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            listStatus.textContent = result.recoverable ? '파일을 받았습니다. 모당 전환 안내 전까지 보관해 주세요.' : '손상됐거나 너무 큰 초안을 원본 텍스트로 보관했습니다. 모당에서 바로 불러올 수 없으니 원본 파일을 보관해 주세요.';
          } catch (error) { listStatus.textContent = errorMessage(error); }
          finally { button.disabled = false; }
        });
        draftList.append(button, document.createTextNode(' '));
      }
    } catch (error) { listStatus.textContent = errorMessage(error); }
    finally { listButton.disabled = false; }
  });
  importButton.addEventListener('click', async () => {
    clearConflicts();
    const file = document.getElementById('file').files[0];
    if (!file || file.size > 2 * 1024 * 1024) { importStatus.textContent = '2MB 이하의 이전 초안 파일을 선택해 주세요.'; return; }
    importButton.disabled = true; importStatus.textContent = '계정과 파일을 확인하고 있습니다.';
    try {
      const result = await window.workDraftRecovery.importDrafts(localStorage, verify, await file.text());
      importStatus.textContent = `가져온 초안 ${result.imported}개, 기존 내용이 있어 건너뛴 초안 ${result.existing}개.`
        + (result.failed ? ` 저장에 실패해 ${result.unprocessed}개를 처리하지 못했습니다. 원본 파일을 보관하고 저장 공간을 확인한 뒤 다시 시도해 주세요.` : ' 모당 업무에서 확인해 주세요.');
      for (const item of result.conflicts) {
        const details = document.createElement('details'), summary = document.createElement('summary'), content = document.createElement('pre');
        summary.textContent = item.id === 'new' ? '이전 새 업무 초안' : '이전 업무 초안 ' + item.id;
        content.textContent = JSON.stringify(JSON.parse(item.raw), null, 2);
        content.tabIndex = 0; details.append(summary, content); conflictList.append(details);
      }
      conflicts.hidden = result.conflicts.length === 0;
    } catch (error) { importStatus.textContent = errorMessage(error); }
    finally { importButton.disabled = false; }
  });
})();
