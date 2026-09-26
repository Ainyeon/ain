// 배포 전 점검: 약관·개인정보처리방침에 〔채울 것〕 표시가 남아 있으면 실패한다.
// node tools/check-legal.js
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let bad = 0;
for (const f of ['legal/terms/index.html', 'legal/privacy/index.html']) {
  const s = fs.readFileSync(path.join(root, f), 'utf8');
  const left = s.match(/〔채울 것:[^〕]*〕/g) || [];
  if (left.length) { bad += left.length; console.error(f + ': ' + left.length + '곳 — ' + [...new Set(left)].join(', ')); }
}
if (bad) { console.error('check-legal: 채울 곳 ' + bad + '개. 운영자 정보를 채우고 법률 검토 후 배포하세요.'); process.exit(1); }
console.log('check-legal: OK');
