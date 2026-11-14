/* Local prototype: caller must obtain user.id from a verified Auth response. */
(function (root) {
  'use strict';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const suffix = /^(?:new|[1-9][0-9]*)$/;
  const maxDrafts = 200, maxBytes = 2 * 1024 * 1024;
  const byteLength = text => new TextEncoder().encode(text).byteLength;
  async function identity(getVerifiedUser) {
    const user = await getVerifiedUser();
    if (!user || typeof user.id !== 'string' || !uuid.test(user.id)) throw new Error('identity-unverified');
    return user.id;
  }
  function validateDraft(raw) {
    if (typeof raw !== 'string' || byteLength(raw) > maxBytes) throw new Error('invalid-draft');
    let value;
    try { value = JSON.parse(raw); } catch (_) { throw new Error('invalid-draft'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-draft');
  }
  function draftIds(storage, userId) {
    const prefix = 'work_draft_' + userId + '_', ids = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (typeof key === 'string' && key.startsWith(prefix) && suffix.test(key.slice(prefix.length))) ids.push(key.slice(prefix.length));
    }
    return ids.sort();
  }
  async function listDraftIds(storage, getVerifiedUser) {
    const userId = await identity(getVerifiedUser), ids = draftIds(storage, userId);
    if (await identity(getVerifiedUser) !== userId) throw new Error('session-changed');
    if (JSON.stringify(ids) !== JSON.stringify(draftIds(storage, userId))) throw new Error('drafts-changed');
    return ids;
  }
  async function exportOneDraft(storage, getVerifiedUser, id) {
    if (typeof id !== 'string' || !suffix.test(id)) throw new Error('invalid-draft');
    const userId = await identity(getVerifiedUser), key = 'work_draft_' + userId + '_' + id;
    const raw = storage.getItem(key);
    if (typeof raw !== 'string') throw new Error('drafts-changed');
    if (await identity(getVerifiedUser) !== userId) throw new Error('session-changed');
    if (storage.getItem(key) !== raw) throw new Error('drafts-changed');
    try {
      validateDraft(raw);
      const text = JSON.stringify({version:1, userId, drafts:[{id, raw}]});
      if (byteLength(text) <= maxBytes) return {text, recoverable:true};
    } catch (error) {
      if (error.message !== 'invalid-draft') throw error;
    }
    return {text:raw, recoverable:false};
  }
  async function exportDrafts(storage, getVerifiedUser) {
    const userId = await identity(getVerifiedUser), prefix = 'work_draft_' + userId + '_';
    const drafts = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (!suffix.test(id)) continue;
      const raw = storage.getItem(key);
      validateDraft(raw);
      drafts.push({id, raw});
      if (drafts.length > maxDrafts) throw new Error('too-many-drafts');
    }
    // Verification involves network I/O; another tab may change accounts or drafts
    // while it is pending. Never release a snapshot under a different account.
    if (await identity(getVerifiedUser) !== userId) throw new Error('session-changed');
    const current = new Map();
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (typeof key === 'string' && key.startsWith(prefix) && suffix.test(key.slice(prefix.length))) {
        current.set(key.slice(prefix.length), storage.getItem(key));
      }
    }
    if (current.size !== drafts.length || drafts.some(item => current.get(item.id) !== item.raw)) throw new Error('drafts-changed');
    const text = JSON.stringify({version:1, userId, drafts});
    if (byteLength(text) > maxBytes) throw new Error('too-large');
    return text;
  }
  async function importDrafts(storage, getVerifiedUser, text) {
    const userId = await identity(getVerifiedUser);
    if (typeof text !== 'string' || byteLength(text) > maxBytes) throw new Error('invalid-file');
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new Error('invalid-file'); }
    if (!data || data.version !== 1 || data.userId !== userId || !Array.isArray(data.drafts) || data.drafts.length > maxDrafts) throw new Error('invalid-file');
    const seen = new Set();
    for (const item of data.drafts) {
      if (!item || typeof item.id !== 'string' || !suffix.test(item.id) || seen.has(item.id)) throw new Error('invalid-file');
      seen.add(item.id); validateDraft(item.raw);
    }
    // Recheck after file validation, immediately before the synchronous writes.
    if (await identity(getVerifiedUser) !== userId) throw new Error('session-changed');
    let imported = 0;
    const conflicts = [];
    for (const [index, item] of data.drafts.entries()) {
      const key = 'work_draft_' + userId + '_' + item.id;
      try {
        if (storage.getItem(key) !== null) { conflicts.push(item); continue; }
        storage.setItem(key, item.raw); imported++;
      } catch (_) { return {imported, existing:conflicts.length, conflicts, failed:true, unprocessed:data.drafts.length - index}; }
    }
    return {imported, existing:conflicts.length, conflicts, failed:false, unprocessed:0};
  }
  root.workDraftRecovery = {exportDrafts, importDrafts, listDraftIds, exportOneDraft};
})(globalThis);
