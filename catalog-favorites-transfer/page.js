(function(){
  'use strict';
  if (location.origin==='https://ainyeon.com') document.getElementById('source').hidden=false;
  else if (location.origin==='https://modang.io') document.getElementById('destination').hidden=false;
  else { document.getElementById('unavailable').hidden=false; return; }
  const save=document.getElementById('save'), load=document.getElementById('load'), closed=document.getElementById('closed');
  const saveStatus=document.getElementById('save-status'), loadStatus=document.getElementById('load-status');
  let changes=0;
  window.addEventListener('storage',event=>{
    if (event.storageArea===localStorage && (event.key===null || event.key.startsWith('ain-plan-fav-'))) {
      changes++;closed.checked=false;loadStatus.textContent='다른 탭에서 즐겨찾기가 바뀌었습니다. 편집 탭을 닫고 다시 확인해 주세요.';
    }
  });
  save.addEventListener('click',()=>{
    try {
      const text=window.catalogFavoritesTransfer.exportFavorites(localStorage), file=JSON.parse(text);
      const count=Object.values(file.favorites).reduce((n,items)=>n+items.length,0);
      if (!count) {saveStatus.textContent='이 브라우저에서 저장된 제품 즐겨찾기를 찾지 못했습니다.';return;}
      const url=URL.createObjectURL(new Blob([text],{type:'application/json'})), a=document.createElement('a');
      a.href=url;a.download='모당-3D-제품-즐겨찾기.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      saveStatus.textContent=`즐겨찾기 ${count}개를 파일로 준비했습니다. 다운로드 목록을 확인해 주세요.`;
    } catch (_) {saveStatus.textContent='즐겨찾기를 읽을 수 없습니다. 기존 기기의 자료를 지우지 마세요.';}
  });
  load.addEventListener('click',async()=>{
    const file=document.getElementById('file').files[0];
    if(!file || file.size>1024*1024){loadStatus.textContent='1MB 이하의 즐겨찾기 파일을 선택해 주세요.';return;}
    if(!closed.checked){loadStatus.textContent='다른 편집 탭을 닫은 뒤 확인해 주세요.';return;}
    load.disabled=true;const before=changes;
    try {
      const text=await file.text();
      if(changes!==before || !closed.checked){loadStatus.textContent='파일을 읽는 동안 즐겨찾기가 바뀌었습니다. 다시 확인해 주세요.';return;}
      const result=window.catalogFavoritesTransfer.importFavorites(localStorage,text);
      loadStatus.textContent=result.incomplete?`일부만 처리했습니다. ${result.added}개를 추가했습니다. 편집 탭과 저장 공간을 확인하고 같은 파일로 다시 시도해 주세요.`:`즐겨찾기 ${result.added}개를 추가했습니다. 3D 편집기에서 확인해 주세요.`;
    } catch (_) {loadStatus.textContent='파일이나 기존 즐겨찾기를 읽을 수 없습니다. 원본 파일과 기존 자료를 보관해 주세요.';}
    finally {load.disabled=false;}
  });
})();
