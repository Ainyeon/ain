(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const labels = {maker_notice_v1:'고객 안내문', maker_notice_v2:'고객 안내문', maker_compare_v2:'홍보 카드'};
  const names = keys => keys.map(key => labels[key]).join(', ');
  const host = location.hostname;
  if (host === 'ainyeon.com') {
    $('source').hidden = false;
    function download(group) {
      const status = $('export-status');
      try {
        const result = legacyMakerTransfer.exportData(localStorage, group);
        const keys = Object.keys(result.file.data);
        if (!keys.length) { status.textContent = result.skipped.length ? '저장자료를 읽지 못했습니다.' : '이 브라우저에서 이전 저장자료를 찾지 못했습니다.'; return; }
        const url = URL.createObjectURL(new Blob([JSON.stringify(result.file)], {type:'application/json'}));
        const link = document.createElement('a'); link.href = url; link.download = group === 'notice' ? '모당-이전-안내문.json' : group === 'compare' ? '모당-이전-홍보카드.json' : '모당-이전-안내문-카드.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        status.textContent = names(keys) + ' 파일의 다운로드 목록을 확인해 주세요.' + (result.skipped.length ? ' 읽지 못한 자료도 있습니다.' : '');
      } catch (error) {
        if (error && error.message === 'too-large') {
          $('split-download').hidden = false;
          status.textContent = group === 'all' ? '자료가 너무 커 종류별로 나누어 받아 주세요.' : '이 자료가 너무 커 파일로 옮길 수 없습니다. 기존 자료를 그대로 두고 운영자에게 문의해 주세요.';
        } else status.textContent = '기기 저장자료를 읽지 못했습니다.';
      }
    }
    $('download').addEventListener('click', () => download('all'));
    $('download-notice').addEventListener('click', () => download('notice'));
    $('download-compare').addEventListener('click', () => download('compare'));
  } else if (host === 'modang.io') {
    $('destination').hidden = false;
    function showConflicts(text, keys) {
      const area = $('conflicts'), list = $('conflict-list');
      area.hidden = !keys.length; list.replaceChildren();
      if (!keys.length) return;
      const file = JSON.parse(text);
      for (const key of keys) {
        const value = JSON.parse(file.data[key]);
        const title = document.createElement('h4'); title.textContent = labels[key];
        const lines = [];
        const add = (label, text) => { if (typeof text === 'string' && text.trim()) lines.push(label + ': ' + text); };
        add('업체명', value.biz); add('전화번호', value.phone);
        if (key.startsWith('maker_notice_')) {
          add('지역', value.area); add('제목', value.title); add('인사말', value.tone);
          if (Array.isArray(value.sections)) for (const section of value.sections) {
            add('항목', section.title); add('내용', section.body);
          }
        } else {
          add('제목', value.head); add('부제', value.sub);
          if (value.labels) { add('첫 사진 이름', value.labels.before); add('중간 사진 이름', value.labels.mid); add('마지막 사진 이름', value.labels.after); }
        }
        const body = document.createElement('pre');
        body.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;max-height:18rem;overflow:auto;background:#f4f6f7;padding:12px';
        body.textContent = lines.length ? lines.join('\n\n') : '복사할 글 내용이 없습니다.';
        list.append(title, body);
      }
    }
    $('import').addEventListener('click', async () => {
      const status = $('import-status'), file = $('file').files[0];
      $('conflicts').hidden = true; $('conflict-list').replaceChildren();
      if (!file) { status.textContent = '먼저 파일을 선택해 주세요.'; return; }
      if (file.size > 3 * 1024 * 1024 + 1000) { status.textContent = '파일 크기가 너무 큽니다.'; return; }
      try {
        const text = await file.text();
        const result = legacyMakerTransfer.importData(localStorage, text);
        showConflicts(text, result.existing);
        const parts = [];
        if (result.imported.length) parts.push('가져온 자료: ' + names(result.imported) + '. 해당 도구를 다시 열어 확인해 주세요.');
        if (result.existing.length) parts.push('기존 내용이 있어 건너뛴 자료: ' + names(result.existing) + '.');
        if (result.failed.length) parts.push('저장하지 못한 자료: ' + names(result.failed) + '.');
        status.textContent = parts.join(' ');
      } catch (_) { status.textContent = '파일을 읽을 수 없습니다. 에인연에서 받은 이전 자료 파일인지 확인해 주세요.'; }
    });
  } else $('unavailable').hidden = false;
})();
