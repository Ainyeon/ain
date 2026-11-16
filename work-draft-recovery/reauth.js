/* Local design prototype only: network/auth client is injected by caller. */
(function(root){
  'use strict';
  const callback='https://ainyeon.com/work-draft-recovery/';
  async function ensureNoWorker(sw){
    if(!sw || typeof sw.getRegistrations!=='function' || sw.controller)throw new Error('worker-present');
    const registrations=await sw.getRegistrations();
    if(!Array.isArray(registrations)||registrations.length||sw.controller)throw new Error('worker-present');
  }
  async function begin({origin,serviceWorker,createClient,consented}){
    if(origin!=='https://ainyeon.com')throw new Error('wrong-origin');
    if(consented!==true)throw new Error('consent-required');
    await ensureNoWorker(serviceWorker);
    const client=createClient();
    await ensureNoWorker(serviceWorker);
    const result=await client.auth.signInWithOAuth({provider:'kakao',options:{redirectTo:callback}});
    if(result.error)throw new Error('login-failed');
    return result;
  }
  async function finish({origin,serviceWorker,createClient}){
    if(origin!=='https://ainyeon.com')throw new Error('wrong-origin');
    await ensureNoWorker(serviceWorker);
    const client=createClient();
    const result=await client.auth.getSession();
    await ensureNoWorker(serviceWorker);
    if(result.error||!result.data||!result.data.session)throw new Error('session-unavailable');
    // Supabase getSession is not identity proof. Caller must separately verify
    // against the authentication server before reading any account-owned draft.
    return true;
  }
  root.workDraftReauthPrototype={begin,finish};
})(globalThis);
