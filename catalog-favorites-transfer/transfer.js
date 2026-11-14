/* Local prototype: product favorites only, no personal or authentication data. */
(function (root) {
  'use strict';
  const types = ['ac', 'appliance', 'finish'];
  const prefix = 'ain-plan-fav-';
  const maxBytes = 1024 * 1024, maxItems = 10000, maxIdLength = 512;
  const bytes = value => new TextEncoder().encode(value).byteLength;
  function parseList(raw) {
    let value;
    try { value = JSON.parse(raw); } catch (_) { throw new Error('invalid-list'); }
    if (!Array.isArray(value) || value.length > maxItems || value.some(id => typeof id !== 'string' || !id || id.length > maxIdLength)) throw new Error('invalid-list');
    return [...new Set(value)];
  }
  function exportFavorites(storage) {
    const favorites = {};
    for (const type of types) {
      const raw = storage.getItem(prefix + type);
      if (raw !== null) favorites[type] = parseList(raw);
    }
    const text = JSON.stringify({format:'modang-catalog-favorites', version:1, favorites});
    if (bytes(text) > maxBytes) throw new Error('too-large');
    return text;
  }
  function importFavorites(storage, text) {
    if (typeof text !== 'string' || bytes(text) > maxBytes) throw new Error('invalid-file');
    let file;
    try { file = JSON.parse(text); } catch (_) { throw new Error('invalid-file'); }
    if (!file || file.format !== 'modang-catalog-favorites' || file.version !== 1 || !file.favorites ||
        typeof file.favorites !== 'object' || Array.isArray(file.favorites)) throw new Error('invalid-file');
    const groups = Object.keys(file.favorites);
    if (groups.some(group => !types.includes(group))) throw new Error('invalid-file');
    const pending = [];
    for (const group of groups) {
      let incoming;
      try { incoming = parseList(JSON.stringify(file.favorites[group])); } catch (_) { throw new Error('invalid-file'); }
      const key = prefix + group, raw = storage.getItem(key);
      const existing = raw === null ? [] : parseList(raw);
      const merged = [...new Set([...existing, ...incoming])];
      if (merged.length > maxItems || bytes(JSON.stringify(merged)) > maxBytes) throw new Error('too-large');
      pending.push({key, raw, value:JSON.stringify(merged), added:merged.length-existing.length});
    }
    let imported = 0, added = 0;
    for (const item of pending) {
      try {
        if (storage.getItem(item.key) !== item.raw) return {imported, added, incomplete:true};
        if (item.added) storage.setItem(item.key, item.value);
        imported++; added += item.added;
      } catch (_) { return {imported, added, incomplete:true}; }
    }
    return {imported, added, incomplete:false};
  }
  root.catalogFavoritesTransfer = {exportFavorites, importFavorites};
})(globalThis);
