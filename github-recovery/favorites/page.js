(function(){
  'use strict';
  if (['https://ainyeon.com','https://www.ainyeon.com','https://ainyeon.github.io'].includes(location.origin)) document.getElementById('source').hidden=false;
  else if (location.origin==='https://modang.io') document.getElementById('destination').hidden=false;
  else { document.getElementById('unavailable').hidden=false; return; }
  const load=document.getElementById('load'), closed=document.getElementById('closed');
  const saveStatus=document.getElementById('save-status'), loadStatus=document.getElementById('load-status');
  let changes=0;
  window.addEventListener('storage',event=>{
    if (event.storageArea===localStorage && (event.key===null || event.key.startsWith('ain-plan-fav-'))) {
      changes++;closed.checked=false;loadStatus.textContent='다른 탭에서 즐겨찾기가 바뀌었습니다. 편집 탭을 닫고 다시 확인해 주세요.';
    }
  });
  const productGroups = {ac:'에어컨', appliance:'가전', finish:'마감재'};
  function bindBackup(buttonId, status, groupBoxId, filename) {
    const button = document.getElementById(buttonId);
    const groupBox = document.getElementById(groupBoxId);
    if (!button || !groupBox) return;
    function download(group) {
      const label = group ? productGroups[group] + ' 즐겨찾기' : '즐겨찾기';
      try {
        const text = window.catalogFavoritesTransfer.exportFavorites(localStorage, group);
        const count = Object.values(JSON.parse(text).favorites).reduce((n, items) => n + items.length, 0);
        if (!group) groupBox.hidden = true;
        if (!count) {
          status.textContent = '이 브라우저에 저장된 ' + label + '가 없어요.';
          return;
        }
        const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename + (group ? '-' + productGroups[group] : '') + '.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        status.textContent = label + ' ' + count + '개를 파일로 준비했어요. 다운로드 목록을 확인해 주세요.';
      } catch (_) {
        groupBox.hidden = false;
        status.textContent = group
          ? label + '를 파일로 만들 수 없어요. 다른 종류는 따로 받을 수 있어요. 원래 브라우저의 자료를 보관해 주세요.'
          : '전체 파일을 만들 수 없어요. 아래에서 종류를 하나씩 골라 받을 수 있어요.';
      }
    }
    button.addEventListener('click', () => download());
    groupBox.addEventListener('click', event => {
      const group = event.target.dataset.group;
      if (Object.hasOwn(productGroups, group)) download(group);
    });
  }
  bindBackup('save', saveStatus, 'source-groups', '에인연-제품-즐겨찾기');
  bindBackup('backup-destination', document.getElementById('backup-status'), 'destination-groups', '모당-기존-제품-즐겨찾기');
  load.addEventListener('click',async()=>{
    if(load.disabled)return;
    const file=document.getElementById('file').files[0];
    if(!file || file.size>1024*1024){loadStatus.textContent='1MB 이하의 즐겨찾기 파일을 선택해 주세요.';return;}
    if(!closed.checked){loadStatus.textContent='다른 편집 탭을 닫은 뒤 확인해 주세요.';return;}
    load.disabled=true;const before=changes;
    try {
      const text=await file.text();
      if(document.getElementById('file').files[0]!==file){loadStatus.textContent='선택한 파일이 바뀌었어요. 가져올 파일을 다시 확인해 주세요.';return;}
      if(changes!==before || !closed.checked){loadStatus.textContent='파일을 읽는 동안 즐겨찾기가 바뀌었습니다. 다시 확인해 주세요.';return;}
      const result=window.catalogFavoritesTransfer.importFavorites(localStorage,text);
      loadStatus.textContent=result.incomplete?`일부만 처리했습니다. ${result.added}개를 추가했습니다. 편집 탭과 저장 공간을 확인하고 같은 파일로 다시 시도해 주세요.`:`즐겨찾기 ${result.added}개를 추가했습니다. 3D 편집기에서 확인해 주세요.`;
    } catch (_) {loadStatus.textContent='파일이나 기존 즐겨찾기를 읽을 수 없습니다. 원본 파일과 기존 자료를 보관해 주세요.';}
    finally {load.disabled=false;}
  });
})();
