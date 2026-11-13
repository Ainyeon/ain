// 스튜디오 모형 뷰어(/maker/3d/view/viewer.js — 엔진 내보내기 사본)의 순수 로직: 관성 감쇠 계수·탭 판정·해상도 조절기. 사본은 손으로 고치지 않는다(엔진 src.html → export_site.py)
const assert = require('assert'), fs = require('fs'), path = require('path');
const js = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/view/viewer.js'), 'utf8');
const block = js.match(/\/\* <smooth>[\s\S]*?\/\* <\/smooth> \*\//);
assert.ok(block, '<smooth> 블록이 있다');
const { dampK, isTap, prGovernor } = new Function(block[0] + '\nreturn { dampK, isTap, prGovernor };')();
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);
const feed = (g, ms, n, hidden) => { let pr; for (let i = 0; i < n; i++) pr = g(ms, hidden); return pr; };

near(dampK(1 / 60), 0.08, 5e-4);                                                        // 60Hz 에서는 예전 고정 계수
for (const fps of [15, 30, 60, 120]) near((1 - dampK(1 / fps)) ** fps, Math.exp(-5));   // 프레임률이 달라도 1초 뒤 남는 몫이 같다
near(dampK(.5), dampK(.1)); near(dampK(0), dampK(1 / 60));                              // dt 상한 0.1초, 멈췄다 그리는 첫 프레임은 1/60
assert.ok(isTap(5.9, 599, false) && !isTap(6, 100, false) && isTap(11.9, 899, true) && !isTap(12, 100, true));
assert.ok(!isTap(40, 300, false) && !isTap(40, 300, true), '끌었다 돌아와도 탭이 아니다');
let g = prGovernor(2);
near(feed(g, 22, 50), 1.85); near(feed(g, 33, 5000), .9);                               // 느리면 -0.15, 하한 0.9
near(feed(g, 14, 150), .9); near(feed(g, 14, 50), 1); near(feed(g, 8, 50 * 4 * 20), 2); // 빠른 구간 4번에 +0.1, 상한은 처음 값
g = prGovernor(2); near(feed(g, 300, 500), 2); near(feed(g, 30, 500, true), 2);         // 250ms 넘는 프레임·숨은 탭은 세지 않는다
// 뷰어가 실제로 쓰는지: 고정 계수 대신 프레임 시간, 요청 렌더(embed)에서만 그림자 맵을 골라 갱신
assert.ok(js.includes('controls.dampingFactor = dampK(dt / 1000)') && js.includes('isTap(far,') && js.includes('renderer.shadowMap.autoUpdate = !EMBED'));
assert.ok(/apartment&v=3'/.test(fs.readFileSync(path.join(__dirname, '..', 'maker/3d/studio.js'), 'utf8')), '예시 모형 주소 판 올림');
console.log('studio-smooth ok');
