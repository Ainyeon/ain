/* Local overlay only. Server-verified identity remains required by page.js. */
(function(){
  'use strict';
  if(location.origin!=='https://ainyeon.com')return;
  const button=document.getElementById('reauth-button'), consent=document.getElementById('reauth-consent'), status=document.getElementById('reauth-status');
  let loading, client;
  async function noWorker(){
    if(!navigator.serviceWorker || navigator.serviceWorker.controller)throw new Error('worker-present');
    const registrations=await navigator.serviceWorker.getRegistrations();
    if(registrations.length || navigator.serviceWorker.controller)throw new Error('worker-present');
  }
  async function sdk(){
    await noWorker();
    if(!loading)loading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='/work-draft-recovery/supabase-2.117.2.js';
      script.integrity='sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok';script.crossOrigin='anonymous';
      script.onload=resolve;script.onerror=()=>reject(new Error('sdk-load-failed'));document.head.append(script);
    });
    try {await loading;await noWorker();}catch(e){loading=null;throw e;}
    if(!window.supabase || typeof window.supabase.createClient!=='function')throw new Error('sdk-load-failed');
  }
  function getClient(){
    if(!client)client=window.supabase.createClient('https://oqgoibbhnidsveueifet.supabase.co',window.workDraftPublicKey,
      {auth:{storage:window.sessionStorage,storageKey:'ain-work-recovery-auth-v1',autoRefreshToken:false,persistSession:true,detectSessionInUrl:true}});
    return client;
  }
  const options=()=>({origin:location.origin,serviceWorker:navigator.serviceWorker,createClient:getClient});
  function fail(error){
    if(error && error.message==='worker-present'){
      document.getElementById('worker-help').hidden=false;
      status.textContent='기존 서비스 설정을 해제한 뒤 이 화면을 새로 열어 주세요.';
    }else status.textContent='로그인을 완료하지 못했습니다. 초안은 지우지 말고 다시 시도해 주세요.';
  }
  button.addEventListener('click',async()=>{
    if(!consent.checked){status.textContent='안내를 확인하고 체크해 주세요.';return;}
    button.disabled=true;status.textContent='로그인 화면을 준비하고 있습니다.';
    try{await sdk();await window.workDraftReauthPrototype.begin({...options(),consented:true});}
    catch(error){fail(error);button.disabled=false;}
  });
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('error') || fragment.has('error_description')){
    history.replaceState(null,'',location.pathname+location.search);fail();
  }else if(fragment.has('access_token')){
    button.disabled=true;status.textContent='로그인 복귀를 확인하고 있습니다.';
    (async()=>{try{await sdk();await window.workDraftReauthPrototype.finish(options());
      status.textContent='로그인 후 돌아왔습니다. 아래 버튼으로 계정과 초안을 다시 확인해 주세요.';
    }catch(error){history.replaceState(null,'',location.pathname+location.search);fail(error);}
    finally{button.disabled=false;}})();
  }
})();
