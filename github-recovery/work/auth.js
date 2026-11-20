/* Prototype: a session's embedded user is never treated as proof of identity. */
(function (root) {
  'use strict';
  const PROJECT = 'oqgoibbhnidsveueifet';
  const SESSION = 'sb-' + PROJECT + '-auth-token';
  const ENDPOINT = 'https://' + PROJECT + '.supabase.co/auth/v1/user';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function createVerifier({storage, fetcher, publishableKey, serviceWorker}) {
    if (typeof publishableKey !== 'string' || !publishableKey.startsWith('sb_publishable_')) throw new Error('missing-public-key');
    return async function verifiedUser() {
      async function requireNoWorker() {
        if (!serviceWorker || typeof serviceWorker.getRegistrations !== 'function' || serviceWorker.controller) throw new Error('worker-present');
        const registrations = await serviceWorker.getRegistrations();
        if (!Array.isArray(registrations) || registrations.length || serviceWorker.controller) throw new Error('worker-present');
      }
      await requireNoWorker();
      let before, token;
      try {
        before = storage.getItem(SESSION);
        const session = JSON.parse(before);
        token = session && session.access_token;
      } catch (_) { throw new Error('session-unavailable'); }
      if (typeof token !== 'string' || !token || token.length > 16384) throw new Error('session-unavailable');
      let response;
      try {
        response = await fetcher(ENDPOINT, {method:'GET', headers:{apikey:publishableKey, Authorization:'Bearer ' + token},
          credentials:'omit', cache:'no-store', redirect:'error'});
      } catch (_) { throw new Error('identity-unverified'); }
      if (!response.ok) throw new Error('identity-unverified');
      let user;
      try { user = await response.json(); } catch (_) { throw new Error('identity-unverified'); }
      if (!user || typeof user.id !== 'string' || !uuid.test(user.id)) throw new Error('identity-unverified');
      await requireNoWorker();
      if (storage.getItem(SESSION) !== before) throw new Error('session-changed');
      return {id:user.id};
    };
  }
  root.workDraftAuth = {createVerifier};
})(globalThis);
