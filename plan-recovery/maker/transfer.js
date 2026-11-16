/* 기기 내 안내문·카드 임시 저장 이전. 인증·업무·고객 기록은 다루지 않는다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.legacyMakerTransfer = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const keys = ['maker_notice_v2', 'maker_notice_v1', 'maker_compare_v2'];
  const limit = 1024 * 1024;
  const fileLimit = limit * keys.length + 1000;
  const validValue = (key, raw) => {
    if (typeof raw !== 'string' || raw.length > limit) return false;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      if (key.startsWith('maker_notice_') && value.sections !== undefined &&
          (!Array.isArray(value.sections) || value.sections.some(section => !section || typeof section !== 'object' || typeof section.title !== 'string' || typeof section.body !== 'string'))) return false;
      if (key === 'maker_compare_v2' && value.labels !== undefined &&
          (!value.labels || typeof value.labels !== 'object' || Array.isArray(value.labels) || Object.values(value.labels).some(label => typeof label !== 'string'))) return false;
      return true;
    }
    catch (_) { return false; }
  };
  function exportData(storage, group = 'all') {
    if (!['all', 'notice', 'compare'].includes(group)) throw new Error('invalid-group');
    const data = Object.create(null);
    const skipped = [];
    for (const key of keys) {
      if (group === 'notice' && !key.startsWith('maker_notice_')) continue;
      if (group === 'compare' && key !== 'maker_compare_v2') continue;
      if (key === 'maker_notice_v1' && data.maker_notice_v2) continue;
      const value = storage.getItem(key);
      if (value === null) continue;
      if (!validValue(key, value)) { skipped.push(key); continue; }
      data[key] = value;
    }
    const file = {type:'modang-maker-transfer', version:1, data};
    if (new TextEncoder().encode(JSON.stringify(file)).byteLength > fileLimit) throw new Error('too-large');
    return {file, skipped};
  }
  function inspectFile(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > fileLimit) throw new Error('invalid-file');
    let file;
    try { file = JSON.parse(text); } catch (_) { throw new Error('invalid-file'); }
    if (!file || file.type !== 'modang-maker-transfer' || file.version !== 1 || !file.data || typeof file.data !== 'object' || Array.isArray(file.data)) throw new Error('invalid-file');
    const found = Object.keys(file.data);
    if (!found.length || (found.includes('maker_notice_v1') && found.includes('maker_notice_v2')) || found.some(key => !keys.includes(key) || !validValue(key, file.data[key]))) throw new Error('invalid-file');
    return found;
  }
  function importData(storage, text) {
    const found = inspectFile(text), file = JSON.parse(text), imported = [], existing = [], failed = [];
    for (const key of found) {
      try {
        const noticeConflict = key.startsWith('maker_notice_') && (storage.getItem('maker_notice_v1') !== null || storage.getItem('maker_notice_v2') !== null);
        if (noticeConflict || storage.getItem(key) !== null) { existing.push(key); continue; }
        storage.setItem(key, file.data[key]);
        imported.push(key);
      } catch (_) { failed.push(key); }
    }
    return {imported, existing, failed};
  }
  return {exportData, inspectFile, importData};
});
