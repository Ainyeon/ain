// 스튜디오 모형 뷰어(/maker/3d/view/viewer.js — 엔진 내보내기 사본)의 순수 로직(관성 감쇠 계수·탭 판정·해상도 조절기)과 배선. 사본은 손으로 고치지 않는다(엔진 src.html → export_site.py)
// 본문은 엔진 test_smooth.mjs 와 같다(엔진 저장소가 없는 곳에서도 돌게 사본으로 둔다)
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'maker/3d/view/viewer.js'), 'utf8');
const block = src.match(/\/\* <smooth>[\s\S]*?\/\* <\/smooth> \*\//);
assert.ok(block, '<smooth> 블록이 있다');
const { dampK, isTap, prGovernor } = new Function(block[0] + '\nreturn { dampK, isTap, prGovernor };')();
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);
const feed = (g, ms, n, hidden, hold) => { let pr; for (let i = 0; i < n; i++) pr = g(ms, hidden, hold); return pr; };

// 감쇠: 60Hz 에서 예전 고정 계수 0.08, 프레임률이 달라도 같은 시간 뒤 남는 몫이 같다, dt 상한 0.1초, dt 없으면 1/60
near(dampK(1 / 60), 0.08, 5e-4);
for (const fps of [15, 30, 60, 120, 144]) near((1 - dampK(1 / fps)) ** fps, Math.exp(-5));
near(dampK(.5), dampK(.1)); near(dampK(0), dampK(1 / 60)); near(dampK(-1), dampK(1 / 60)); near(dampK(NaN), dampK(1 / 60));
near(dampK(1 / 60, 10), 1 - .92 ** 2, 1e-3);                       // 끄는 동안(k 10)은 60Hz 에서 예전의 '프레임당 두 번'
near(dampK(.0166, 12), 1 - Math.exp(-.1992));                      // 초 단위(ms 를 넣으면 상한에 걸린다)

// 탭: 마우스 6px·600ms, 터치 12px·900ms. 가장 멀리 간 거리로 본다
assert.ok(isTap(0, 100, false) && isTap(5.9, 599, false) && !isTap(6, 100, false) && !isTap(0, 600, false));
assert.ok(isTap(11.9, 899, true) && !isTap(12, 100, true) && !isTap(0, 900, true) && isTap(0, 700, true));
assert.ok(!isTap(40, 300, false) && !isTap(40, 300, true), '끌었다 돌아와도(far 40) 탭이 아니다');

// 해상도 조절기 — 느리면 내린다
let g = prGovernor(2);
near(feed(g, 22, 49), 2); near(g(22), 1.85);                       // 50프레임 평균 21ms 초과 → -0.15
near(feed(g, 21, 50), 1.85);                                       // 21ms 는 넘지 않았다
g = prGovernor(2); near(feed(g, 22, 40), 2); near(feed(g, 22, 40), 1.85); near(feed(g, 22, 19), 1.85); near(g(22), 1.7); // 창은 50프레임, 끝나면 새로 센다
// 내려서 빨라지면 거기 머문다. 60Hz(16.7ms)에서도 빠른 구간 4번이면 +0.1 — 14.5ms 밑으로 못 내려가는 화면도 다시 오른다
const run = (g, ms) => { let pr = g(0), log = [pr]; for (let i = 0; i < 50 * 60; i++) { const p = g(ms(pr)); if (p !== pr) log.push(+(pr = p).toFixed(2)); } return log; };
const gpu = (c, hz) => pr => Math.ceil(c * (pr / 2) ** 2 * hz / 1000) * 1000 / hz; // 해상도 2 에서 그리는 데 c ms 걸리고 화소 수에 비례, 수직동기에 맞춰 프레임을 놓치는 기계
assert.deepEqual(run(prGovernor(2), gpu(28, 60)), [2, 1.85, 1.7, 1.55, 1.4, 1.5, 1.6, 1.45, 1.5]);        // 올리자마자 느려진 1.6 으로는 다시 안 간다
assert.deepEqual(run(prGovernor(2), gpu(24, 90)), [2, 1.85, 1.7, 1.55, 1.4, 1.25, 1.35, 1.45, 1.3, 1.35]); // 90Hz(11.1 / 22.2ms)에서도 멈춘다
assert.deepEqual(run(prGovernor(2), () => 33.3), [2, 1.85, 1.7, 1.55, 1.4, 2]);                            // 화소를 절반으로 내려도 그대로 → 되돌리고
g = prGovernor(2); feed(g, 33.3, 50 * 5); near(feed(g, 33.3, 5000), 2); near(feed(g, 16.7, 5000), 2); // 그 방문에서는 더 조절하지 않는다(30fps 로 묶인 절전 상태)
near(feed(prGovernor(2), 33.3, 50 * 4), 1.4);                      // 되돌리기 전 가장 낮은 값
g = prGovernor(2); feed(g, 50, 50 * 4); near(feed(g, 33.3, 50), 1.25); // 절반에서 10% 넘게 빨라졌으면 계속 내린다
near(feed(g, 33.3, 50 * 2), .95); near(feed(g, 33.3, 50), 1.4);    // 다음 절반에서 그대로면 앞 절반까지만 되돌린다
// 잠깐 느렸다 풀리면 다시 오른다
g = prGovernor(2); feed(g, 33.3, 100); near(feed(g, 16.7, 50 * 3), 1.7); near(feed(g, 16.7, 50), 1.8); near(feed(g, 16.7, 50 * 4 * 5), 2);
g = prGovernor(2); feed(g, 8.3, 50); feed(g, 33.3, 100); near(feed(g, 15, 500), 1.7); near(feed(g, 14, 200), 1.8); // 120Hz(가장 빠른 구간 8.3ms): 15ms 는 빠름이 아니고 14.5ms 미만은 빠름
g = prGovernor(2); feed(g, 33.3, 100); feed(g, 16.7, 150); feed(g, 19, 50); near(feed(g, 16.7, 150), 1.7); near(feed(g, 16.7, 50), 1.8); // 사이에 보통 구간(19ms)이 끼면 다시 센다
g = prGovernor(2); feed(g, 33.3, 100); feed(g, 16.7, 150); feed(g, 33.3, 50); feed(g, 16.7, 150); near(g(16.7), 1.55); near(feed(g, 16.7, 49), 1.65); // 내리면 빠른 구간 셈도 0 부터
g = prGovernor(2); feed(g, 33.3, 100); feed(g, 16, 200); near(feed(g, 17.5, 200), 1.9); near(feed(g, 17.7, 500), 1.9); // 가장 빠른 구간(16ms)의 1.1배 안이면 빠름, 밖이면 아니다
g = prGovernor(2); feed(g, 33.3, 100); feed(g, 16.7, 250); feed(g, 33.3, 50); near(feed(g, 16.7, 5000), 2); // 올린 다음 구간이 멀쩡했으면, 나중에 느려져도 그 단계를 막지 않는다
g = prGovernor(2); feed(g, 33.3, 100); feed(g, 16.7, 50); near(feed(g, 33.3, 200), 1.1);                   // 한 번 풀렸다 다시 느려지면 '절반' 비교도 거기서부터 다시
// 정해진 비행 중(hold)에는 재기만 하고 도착한 프레임에 바꾼다
g = prGovernor(2); near(feed(g, 33.3, 500, false, true), 2); near(g(33.3, false, false), 1.85);
// 세지 않는 프레임: 250ms 초과·숨은 탭·dt 없는 첫 프레임
g = prGovernor(2); near(feed(g, 300, 500), 2); near(feed(g, 30, 500, true), 2);
feed(g, 30, 49); feed(g, 5000, 10); near(feed(g, 0, 10), 2); feed(g, NaN, 10); feed(g, 30, 10, true); near(g(30), 1.85); // 걸러진 프레임은 창에도 평균에도 안 들어간다
g = prGovernor(2); feed(g, 250, 49); near(g(250), 1.85);            // 250ms 는 센다
near(feed(prGovernor(1), 33, 50), .9); near(feed(prGovernor(1), 33, 5000), 1); near(feed(prGovernor(.75), 33, 50), .75); near(feed(prGovernor(.75), 33, 5000), .75); // 낮은 배율 화면: 하한 0.9, 처음 값 밑으로 안 내린다

// 배선 — 순수 로직을 뷰어가 실제로 쓰는지(없애면 고친 것이 통째로 사라지는 줄들)
const has = (s, why) => assert.ok(src.includes(s), why + ' — ' + s);
has("if (down) down.far = Math.max(down.far, Math.hypot(e.clientX - down.x, e.clientY - down.y));", '끄는 동안 가장 멀리 간 거리를 잰다');
has("if (isTap(far, performance.now() - down.t, e.pointerType === 'touch'))", '탭 판정');
has("const pr = govern(dt, document.hidden, !!tween); if (pr !== renderer.getPixelRatio()) renderer.setPixelRatio(pr);", '해상도 조절기: 숨은 탭·비행 중을 넘긴다');
has("lastT = tween || moving || held.size || !EMBED ? now : 0;", '멈췄다 그리는 프레임은 세지 않고, 누르고 있는 동안은 센다');
has("if (tween) invalidate(); else if (moving || held.size) invalidate(true);", '누른 동안 프레임을 잇는다 · 카메라만 도는 프레임은 그림자 맵을 건드리지 않는다');
has("controls.dampingFactor = dampK(gap < 250 ? gap / 1000 : 0, held.size ? 10 : 5); return update.call(controls, dt);", '감쇠는 update() 사이 시간으로. OrbitControls 의 update 는 this 를 쓴다(두 손가락 확대 길에서) — 떼어 부르면 던진다');
has("renderer.shadowMap.autoUpdate = !EMBED;", '요청 렌더에서는 그림자 맵을 골라 갱신');
has("renderer.shadowMap.needsUpdate = shadowDirty || flying; shadowDirty = false;", '장면이 바뀐 프레임·비행 중에는 그림자 맵을 다시 그린다');
has("controls.addEventListener('change', () => invalidate(true));", '카메라만 움직인 프레임');
has("function invalidate(camOnly) { if (camOnly !== true) shadowDirty = true;", '그 밖의 요청은 그림자 맵을 다시 그린다');
assert.ok(!/dampingFactor = 0?\.\d/.test(src), '고정 감쇠 계수가 남아 있지 않다');
assert.ok(/apartment&v=4'/.test(fs.readFileSync(path.join(__dirname, '..', 'maker/3d/studio.js'), 'utf8')), '예시 모형 주소 판 올림');
console.log('studio-smooth ok');
