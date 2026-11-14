/* Local prototype: only release the known root registration on explicit user action. */
(function (root) {
  'use strict';
  async function releaseKnownWorker(serviceWorker, origin) {
    if (!serviceWorker || typeof serviceWorker.getRegistrations !== 'function') throw new Error('worker-unknown');
    const registrations = await serviceWorker.getRegistrations();
    if (!Array.isArray(registrations) || registrations.length !== 1) throw new Error('worker-unknown');
    const registration = registrations[0];
    const expectedScope = new URL('/', origin).href, expectedScript = new URL('/sw.js', origin).href;
    if (registration.scope !== expectedScope || !registration.active || registration.active.scriptURL !== expectedScript ||
        registration.installing || registration.waiting ||
        (serviceWorker.controller && serviceWorker.controller.scriptURL !== expectedScript)) throw new Error('worker-unknown');
    if (!await registration.unregister()) throw new Error('worker-release-failed');
    // The current document may still be controlled. The verifier must continue to
    // reject this document until a new navigation confirms zero registrations.
    return true;
  }
  root.workDraftWorkerRelease = {releaseKnownWorker};
})(globalThis);
