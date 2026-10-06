// 3D 스튜디오 예시 모형(/maker/3d/view/) — 뷰어 내보내기와 장면 자료가 사이트 규칙을 지키는지.
// 뷰어 원본은 엔진(hvac-space-3d/assets/commercial3d/web/src.html)이고 여기 파일은 export_site.py 생성물이다(손으로 고치지 않는다).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const page = read('maker/3d/index.html'), sw = read('sw.js');
for (const m of page.matchAll(/\/maker\/3d\/studio\.(?:css|js)\?v=\d+/g)) assert.ok(sw.includes("'" + m[0] + "'"), 'sw SHELL 에 ' + m[0]);
assert.ok(!/\.innerHTML\s*[+=]|insertAdjacentHTML\(/.test(read('maker/3d/studio.js')), 'studio.js 는 textContent 만');

const view = read('maker/3d/view/index.html');
assert.ok(/Content-Security-Policy[^>]*script-src 'self';/.test(view), '뷰어 문서 CSP');
assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(view), '뷰어 문서에 인라인 스크립트 없음');
for (const f of ['index.html', 'viewer.js', 'viewer.css', 'mode.js']) assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(read('maker/3d/view/' + f)), f + ': 외부 주소 없음');
const lib = read('maker/3d/view/viewer.js').match(/from '\.\/(lib\/three-[\d.]+)\/three\.module\.min\.js'/);
assert.ok(lib, 'three 는 같은 출처 lib/ 에서');
for (const f of ['three.module.min.js', 'OrbitControls.js']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'maker/3d/view', lib[1], f)), lib[1] + '/' + f);
assert.ok(/from '\.\/three\.module\.min\.js'/.test(read('maker/3d/view/' + lib[1] + '/OrbitControls.js')), 'OrbitControls 는 같은 폴더의 three 를');

const sceneText = read('maker/3d/view/apartment.json'), scene = JSON.parse(sceneText);
assert.ok(scene.data && scene.checks, '장면 = {data, checks}');
assert.ok(!/\/Users|[\w-]+\.(?:json|py|md|csv|png|jpe?g|pdf|dwg|dxf|txt|html)\b/i.test(sceneText), '장면에 로컬 경로·파일 이름 없음');
// 공개 예시에는 작업 메모·내부 도구 이름·제조사 모델 코드를 싣지 않는다(export_site.py --scene 이 비운다)
assert.ok(!/대표|macOS|hvac-|home3d|내부 자료|조합 미확인|M-Q\d|RPUQ|LATS|DVM/.test(sceneText), '장면에 작업 메모·모델 코드 없음');
const keys = Object.keys(scene.data);
assert.ok(keys.length && keys.every((k) => scene.checks[k] && scene.data[k].ac_units.length && scene.data[k].rooms.length), '장면마다 실·실내기·검사 결과');
for (const k of keys) assert.ok(scene.checks[k].counts.PASS > 0 && scene.checks[k].counts.FAIL === 0, k + ' 검사 통과·FAIL 0');
// 내보낸 뷰어는 늘 embed(단독 화면의 목록·검사·출처 시트는 공개 주소에 두지 않는다)
assert.ok(/^document\.documentElement\.classList\.add\('embed'\)/.test(read('maker/3d/view/mode.js')), 'mode.js 는 늘 embed');

console.log('test-studio-live: OK');
