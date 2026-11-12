// 일조·단면·그림자(maker/3d/plan/core/sun.js) 순수 계산 시험 + 방위·위도 저장(doc.site) + 화면 연결 정적 점검 — 수치는 알려진 값·손계산으로 단언한다.
// 실행: node tools/test-plan-sun.js. 화면(캔버스 그림·슬라이더·재생·폰 시트)은 브라우저로 따로 본다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIR = path.join(__dirname, '..', 'maker/3d/plan');
const rd = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);
const imp = (f) => import(pathToFileURL(path.join(DIR, f)).href);
const tan = (deg) => Math.tan((deg * Math.PI) / 180);

(async () => {
  const [U, M, G, S, X] = await Promise.all(['core/sun.js', 'core/model.js', 'core/geom.js', 'core/store.js', 'core/export.js'].map(imp));
  const TPL = JSON.parse(rd('data/templates.json')).templates, tpl = (id) => TPL.find((t) => t.id === id).doc, cf = M.curFloor;
  const SEOUL = { lat: 37.57, north: 0 }, W = U.DAYS.winter.decl, E = U.DAYS.equinox.decl, SM = U.DAYS.summer.decl;

  /* ===== 0. 정적: 순수 모듈 · 화면 연결 ===== */
  { const src = rd('core/sun.js'), code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(/^\/\/ \S/.test(src), 'sun.js 맨 위 한 줄 역할 주석');
    assert.ok(!/\b(document|window|navigator|globalThis)\s*[.\[]|\b(localStorage|sessionStorage|requestAnimationFrame)\b|innerHTML|\beval\s*\(|new Function|Math\.random|Date\.now|new Date/.test(code), 'sun.js 는 DOM·난수·시계를 쓰지 않는다(순수)');
    const app = rd('app.js'), css = rd('plan.css'), v2 = rd('view2d.js');
    assert.ok(/const ANA = \{ poche: '포셰', zone: '존', route: '동선', sun: '일조', section: '단면', shadow: '그림자' \}/.test(app), '분석 종류 여섯');
    assert.ok(!/innerHTML/.test(app + v2), 'innerHTML 을 쓰지 않는다');
    assert.ok(/type: 'range', id: 'plSunT'/.test(app) && /h\('label', \{ for: 'plSunT', text: '시각' \}\)/.test(app) && /'aria-valuetext'/.test(app), '시각 슬라이더: label 연결 · 읽는 값');
    for (const l of ['자를 방', '지역', '층수', '층당 높이', '위도', '위쪽 방위']) assert.ok(app.includes(`'${l}'`), '라벨: ' + l);
    assert.ok(/run\(\{ type: 'setSite', patch: \{ lat: v \} \}\)/.test(app) && /run\(\{ type: 'setSite', patch: \{ north: v \} \}\)/.test(app), '방위·위도는 문서 명령으로만 바꾼다(잠금·되돌리기·검증을 그대로 탄다)');
    assert.ok(/calm = matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(app) && /const playB = calm\.matches \? null : /.test(app), '움직임 줄이기 설정이면 재생 단추가 없다');
    assert.ok(/onclick: \(\) => \(playRaf \? stopPlay\(\) : startPlay\(paint\)\)/.test(app) && /visibilitychange/.test(app), '재생은 같은 단추로 멈춘다');
    assert.ok(!/sun|site/.test((app.match(/const savePrefs = [^\n]*/) || [''])[0]), '보기 상태·방위는 환경설정에 남기지 않는다');
    for (const t of ['진태양시', '평지 · 앞 건물 없음 · 천장 높이는 층 높이', '평지 · 앞 건물 없음', '맞통풍', '외벽 창이 없습니다', '남향 창이 없습니다', '들지 않음', '해 없음']) assert.ok((app + v2).includes(t), '문구: ' + t);
    const added = (src0) => src0.split('\n').filter((l) => /일조|단면|그림자|직사광|맞통풍|방위|태양/.test(l)).join('\n');
    assert.ok(!/3D/.test(added(app).replace(/\/\/.*$/gm, '').replace(/view3d|enter3d|exit3d|is3d|plMode3d|plView3d/g, '')) && !/3D/.test(rd('core/sun.js')), "새 문구에 '3D' 낱말이 없다");
    assert.ok(/role: 'img', 'aria-label': `단면 · /.test(app), '단면 캔버스는 글로도 읽힌다');
    assert.ok(/view\.fit\(fitBounds\(\)\)/.test(app) && /polysBox\(view\.ana\.shade/.test(app), '보기 맞춤에 그림자 범위를 넣는다');
    assert.ok(/ctx\.fill\('nonzero'\)/.test(v2) && /fillText\('N'/.test(v2) && /drawPill\(ctx, C, '북'/.test(v2), '캔버스: 그림자 합집합 칠 · 방위표 N · 자른 선 글자');
    const mine = css.slice(css.indexOf('/* 일조·단면·그림자'), css.indexOf('/* 알림·창 */'));
    assert.ok(mine.length > 200 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(|gradient|999px|\d+m?s\b/.test(mine), '새 CSS 는 토큰만(hex·rgb·gradient·999px·시간 숫자 없음)');
    const phone = css.slice(css.indexOf('@media (max-width: 768px)'), css.indexOf('@media (max-width: 359px)'));
    assert.ok(phone.includes('.ed-props > .ed-ana-ctl { grid-column: 1 / -1; }') && phone.includes('.ed-props > .ed-seg.wide { grid-template-columns: repeat(6, minmax(0, 1fr)); }'), '폰: 조작 묶음은 시트 두 칸을 다 쓰고 종류 단추 6개는 한 줄');
    assert.ok(/\.ed-props > \.ed-seg\.wide \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/.test(css), '넓은 화면: 종류 단추는 세 칸 두 줄(넘치지 않는다)'); }

  /* ===== 1. 태양 위치 — 알려진 값(서울 37.57°) ===== */
  { const noon = (lat, d, n = 0) => U.sunAt(lat, d, 12, n);
    near(noon(37.57, SM).alt, 75.87, 0.005, '하지 정오 고도 ≈ 75.9°'); near(noon(37.57, W).alt, 28.99, 0.005, '동지 정오 고도 ≈ 29.0°'); near(noon(37.57, E).alt, 52.43, 0.005, '춘추분 정오 = 90 − 위도');
    for (const d of [W, E, SM]) { near(noon(37.57, d).az, 180, 1e-9, '정오의 해는 정남'); near(noon(37.57, d).alt, 90 - 37.57 + d, 1e-9, '남중 고도 = 90 − 위도 + 적위'); }
    const a9 = U.sunAt(37.57, W, 9), a15 = U.sunAt(37.57, W, 15);
    near(a9.alt, 15.763, 0.001); near(a9.az, 137.615, 0.001, '동지 9시 = 남동'); near(a15.alt, a9.alt, 1e-9, '오전·오후 대칭'); near(a15.az, 360 - a9.az, 1e-9);
    assert.ok(a9.x > 0 && a9.y > 0 && a15.x < 0 && a15.y > 0, '위가 북인 도면: 오전의 해는 오른쪽(동)·아래(남), 오후는 왼쪽(서)'); near(Math.hypot(a9.x, a9.y, a9.z), 1, 1e-12, '단위벡터');
    near(U.sunAt(37.57, E, 6).alt, 0, 1e-9, '춘추분 6시 해 뜸'); near(U.sunAt(37.57, E, 6).az, 90, 1e-9, '정동에서 뜬다'); near(U.sunAt(37.57, E, 9).alt, 34.088, 0.001); near(U.sunAt(37.57, SM, 9).az, 97.054, 0.001);
    assert.ok(U.sunAt(37.57, W, 3).z < 0 && U.sunAt(37.57, SM, 0).z < 0, '밤에는 해가 땅 아래');
    const dr = (lat, d) => U.dayRange(lat, d);
    near(dr(37.57, W)[0], 7.2989, 0.0001); near(dr(37.57, W)[1], 16.7011, 0.0001); near(dr(37.57, E)[0], 6, 1e-9); near(dr(37.57, SM)[0], 4.7011, 0.0001, '하지 해 뜸'); near(dr(37.57, SM)[1], 19.2989, 0.0001);
    for (const d of [W, E, SM]) for (const t of dr(37.57, d)) near(U.sunAt(37.57, d, t).alt, 0, 1e-6, '해 뜸·짐 시각의 고도는 0');
    near(noon(35.18, W).alt, 31.38, 0.005, '부산'); near(noon(33.5, W).alt, 33.06, 0.005, '제주');
    for (const [n, v] of U.CITIES) assert.ok(typeof n === 'string' && v >= 33 && v <= 38.5, '도시 위도(한국): ' + n); assert.deepStrictEqual(U.CITIES[0], ['서울', M.SITE.lat]); assert.ok(U.CITIES.length >= 9);
    // 방위: north = 도면 위쪽이 가리키는 방위. 정오의 해(정남)는 north 0 이면 아래(+y), 90(위가 동)이면 오른쪽(+x), 180 이면 위, 270 이면 왼쪽
    for (const [n, x, y] of [[0, 0, 1], [90, 1, 0], [180, 0, -1], [270, -1, 0]]) { const s = noon(37.57, E, n), k = Math.hypot(s.x, s.y); near(s.x / k, x, 1e-9, `north ${n} x`); near(s.y / k, y, 1e-9, `north ${n} y`); }
    assert.deepStrictEqual([0, 44, 90, 135, 180, 225, 270, 315, 359, 360, -90].map(U.compass), ['북', '북동', '동', '남동', '남', '남서', '서', '북서', '북', '북', '서']);
    // 남반구·저위도·경계 위도: 값이 깨지지 않는다
    near(noon(-33.87, W).alt, 79.57, 0.005, '남반구 12월 정오'); near(noon(-33.87, W).az, 0, 1e-9, '남반구의 정오 해는 북쪽'); near(noon(10, SM).az, 0, 1e-9, '북회귀선 아래의 하지 정오 해도 북쪽');
    near(noon(0, E).alt, 90, 1e-6, '적도 춘추분 정오는 머리 위'); for (const v of Object.values(noon(0, E))) assert.ok(Number.isFinite(v));
    near(noon(66, W).alt, 0.56, 0.005, '위도 66° 동지에도 해가 뜬다'); assert.ok(dr(66, W)[1] - dr(66, W)[0] > 1.7 && dr(-66, SM)[1] - dr(-66, SM)[0] > 1.7, '±66° 안에서는 늘 뜨고 진다'); }

  /* ===== 2. 방위·위도 저장(doc.site) · 검증 · 되돌리기 · 옛 문서 ===== */
  { const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000] });
    assert.ok(!('site' in s.doc), '새 문서에는 site 키가 없다'); assert.deepStrictEqual(M.siteOf(s.doc), { north: 0, lat: 37.57 }, '기본: 위가 북 · 서울');
    assert.deepStrictEqual(s.exec({ type: 'setSite', patch: { lat: 35.18 } }), []); assert.deepStrictEqual(s.doc.site, { north: 0, lat: 35.18 }); assert.ok(s.dirty && s.canUndo, '저장할 변경 · 되돌릴 수 있다');
    const before = s.doc; s.exec({ type: 'setSite', patch: { lat: 35.18 } }); assert.strictEqual(s.doc, before, '같은 값은 이력에 남지 않는다');
    s.exec({ type: 'setSite', patch: { north: 540 } }); assert.strictEqual(s.doc.site.north, 180, '방위는 0~360 으로 접는다'); s.exec({ type: 'setSite', patch: { north: -90 } }); assert.strictEqual(s.doc.site.north, 270); s.exec({ type: 'setSite', patch: { north: 360 } }); assert.strictEqual(s.doc.site.north, 0);
    for (const patch of [{ lat: 70 }, { lat: -66.01 }, { lat: 'x' }, { lat: NaN }, { north: 'a' }, { north: Infinity }]) { let err; try { s.exec({ type: 'setSite', patch }); } catch (e) { err = e; } assert.ok(err && /방위·위도/.test(err.message), '범위 밖 값은 한국어로 거절: ' + JSON.stringify(patch)); assert.deepStrictEqual(s.doc.site, { north: 0, lat: 35.18 }, '거절되면 문서 그대로'); }
    assert.throws(() => s.exec({ type: 'setSite' }), /방위·위도 값/); s.exec({ type: 'setSite', patch: { lat: 66 } }); s.exec({ type: 'setSite', patch: { lat: -66, north: 359.5 } }); assert.deepStrictEqual(s.doc.site, { north: 359.5, lat: -66 }, '경계 값');
    assert.deepStrictEqual(X.fromDocJSON(X.toDocJSON(s.doc)).site, { north: 359.5, lat: -66 }, '내보내기·불러오기 왕복');
    s.exec({ type: 'mirror', axis: 'x' }); s.exec({ type: 'rotate', deg: 90 }); assert.deepStrictEqual(s.doc.site, { north: 359.5, lat: -66 }, '층을 돌려도 방위 값은 그대로(따로 고친다)');
    while (s.canUndo) s.undo(); assert.ok(!('site' in s.doc), '되돌리면 키가 없다'); s.redo(); s.redo(); assert.deepStrictEqual(s.doc.site, { north: 0, lat: 35.18 }, '다시 실행');
    s.exec({ type: 'load', doc: M.createDoc() }); assert.ok(!('site' in s.doc), 'site 없는 문서를 load 하면 앞 문서의 값이 남지 않는다');
    const ok = (site) => M.validateDoc({ ...M.createDoc(), site });
    assert.deepStrictEqual(ok({ north: 0, lat: 37.57 }), []); assert.deepStrictEqual(ok({ north: 359.99, lat: -66 }), []);
    for (const bad of [{ north: 360, lat: 0 }, { north: -1, lat: 0 }, { north: 0, lat: 67 }, { north: 0, lat: -67 }, { north: 0, lat: 90 }, { north: 0 }, { lat: 37 }, { north: '0', lat: 37 }, [], null, 'x']) assert.ok(ok(bad).some((m) => /방위·위도/.test(m)), '검증 거절: ' + JSON.stringify(bad));
    assert.throws(() => X.fromDocJSON(JSON.stringify({ ...M.createDoc(), site: { north: 0, lat: 90 } })), /읽지 못했습니다/, '극지 위도 파일은 열지 않는다');
    assert.ok(!('site' in M.createDoc()), 'createDoc 은 키를 만들지 않는다(옛 문서와 같은 모양)'); }
  for (const t of TPL) { assert.deepStrictEqual(M.validateDoc(t.doc), [], t.id + ' 검증'); assert.ok(!('site' in t.doc)); assert.deepStrictEqual(M.siteOf(X.fromDocJSON(JSON.stringify(t.doc))), { north: 0, lat: 37.57 }, t.id + ' 옛 문서는 기본값'); }

  /* ===== 3. 외벽 창 · 햇빛 자리 · 직사광 시간 ===== */
  // 손 문서: 방 [0,0]~[4000,3000](벽 W1 위 · W2 오른쪽 · W3 아래 · W4 왼쪽, 중심선은 75 바깥), W3 한가운데 창 1200 × 1200, 바닥에서 900 → 윗단 2100
  const one = (extra = []) => { const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000] }); s.exec({ type: 'addOpening', wall: 'W3', at: 0.5, kind: 'window' }); for (const e of extra) s.exec(e); return s; };
  const f1 = cf(one().doc), area = (p) => G.polyArea(p) / 1e6, box = (p) => { const b = U.polysBox([p]); return [b.x0, b.y0, b.x1, b.y1]; };
  { const w = U.extWindows(f1); assert.strictEqual(w.length, 1); assert.strictEqual(U.extWindows(f1), w, '같은 층 객체면 다시 계산하지 않는다');
    assert.deepStrictEqual([w[0].id, w[0].room.id, w[0].out, w[0].w, w[0].z0, w[0].z1, w[0].c], ['O1', 'R1', [0, 1], 1200, 900, 2100, [2000, 3075]], '아래 벽 창: 바깥 법선 = 아래');
    assert.deepStrictEqual([w[0].a, w[0].b].sort((p, q) => p[0] - q[0]), [[1400, 3075], [2600, 3075]]); assert.ok(f1.walls.every((x) => x.kind === 'inner'), '벽 kind 가 inner 여도 기하로 외벽을 가린다');
    // 정오 자리(위가 북, 창은 남향): 창 아랫단이 3075 − 900 ÷ tan(고도), 윗단이 3075 − 2100 ÷ tan(고도) 에 떨어지고 방(y 0~3000)에서 잘린다
    const patch = (d, t = 12, n = 0) => U.sunPatches(f1, { lat: 37.57, north: n }, d, [t]);
    const pw = patch(W)[0].poly, pe = patch(E)[0].poly, ps = patch(SM)[0].poly;
    [[pw, [1400, 0, 2600, 3075 - 900 / tan(28.99)]], [pe, [1400, 3075 - 2100 / tan(52.43), 2600, 3075 - 900 / tan(52.43)]], [ps, [1400, 3075 - 2100 / tan(75.87), 2600, 3075 - 900 / tan(75.87)]]].forEach(([p, b], i) => box(p).forEach((v, k) => near(v, b[k], 1e-6, `정오 자리 ${i} 상자 ${k}`)));
    near(area(pw), 1.7408, 0.0001, '동지 1.2 × 1.4507'); near(box(pw)[3], 1450.7, 0.05); near(area(pe), 1.1077, 0.0001, '춘추분'); near(box(pe)[1], 1459.5, 0.05); near(area(ps), 0.3625, 0.0001, '하지 1.2 × 0.3021'); near(box(ps)[1], 2546.3, 0.05); near(box(ps)[3], 2848.4, 0.05);
    // 동지 9시(고도 15.76°, 남동): 창 아랫단은 3189 mm 를 북서로 간다 → x 는 2150 왼쪽, y 는 2356 위. 자리는 방 왼쪽 벽(x=0)에서 잘린다
    const p9 = patch(W, 9)[0].poly, b9 = box(p9), k9 = 900 / tan(15.763357710215427); near(k9, 3188.3, 0.1); near(b9[0], 0, 1e-6, '왼쪽 벽에서 잘린다'); near(b9[3], 3075 - k9 * 0.7386, 1, '아랫단 y'); assert.ok(b9[2] < 2600 - k9 * 0.674 + 1 && area(p9) > 0.1);
    assert.ok(G.polyArea(patch(W, 15)[0].poly) > 0 && Math.abs(area(patch(W, 15)[0].poly) - area(p9)) < 1e-6, '오후 3시는 좌우 대칭'); near(box(patch(W, 15)[0].poly)[2], 4000, 1e-6);
    assert.deepStrictEqual(patch(W, 3), [], '밤'); assert.deepStrictEqual(patch(W, 12, 180), [], '방위 180°: 남향 창이 북향이 되어 정오 햇빛이 없다');
    const min = (f, n, d) => U.sunHours(f, { lat: 37.57, north: n }, d)[0].min;
    assert.deepStrictEqual([W, E, SM].map((d) => min(f1, 0, d)), [390, 530, 430], '남향 창 직사광(분)');
    assert.deepStrictEqual([W, E].map((d) => min(f1, 180, d)), [0, 0], '방위를 180° 돌리면 동지·춘추분 직사광 0'); assert.strictEqual(min(f1, 180, SM), 200, '하지의 북향 창은 해 뜰 녘·질 녘에 든다(해가 북동에서 뜨고 북서로 진다)');
    assert.deepStrictEqual([90, 270].map((n) => min(f1, n, W)), [190, 190], '동향·서향은 서로 같다');
    const r0 = U.sunHours(f1, SEOUL, W); assert.deepStrictEqual(r0, [{ id: 'R1', name: '방 1', min: 390, windows: 1 }]); assert.deepStrictEqual(U.sunHours(f1, SEOUL, W, 30)[0].min, 390, '표본 간격을 바꿔도 같은 자리(8:30 은 아직, 9:00 부터)');
    const fb = cf(one([{ type: 'addOpening', wall: 'W1', at: 0.25, kind: 'window' }]).doc); assert.strictEqual(U.extWindows(fb).length, 2); assert.deepStrictEqual([W, SM].map((d) => min(fb, 0, d)), [390, 590], '북쪽 창을 더하면 하지만 늘어난다(430 + 북향의 아침·저녁)');
    assert.strictEqual(U.sunHours(fb, SEOUL, W)[0].windows, 2);
    const tall = cf(one([{ type: 'update', id: 'O1', patch: { height: 2000 } }]).doc); assert.strictEqual(U.extWindows(tall)[0].z1, 2300, '창 윗단은 천장(층 높이)까지');
    const high = cf(one([{ type: 'update', id: 'O1', patch: { sill: 2300 } }]).doc); assert.deepStrictEqual(U.extWindows(high), [], '천장보다 높은 창은 없는 것으로');
    for (const kind of ['door', 'open']) { const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000] }); s.exec({ type: 'addOpening', wall: 'W3', at: 0.5, kind }); assert.deepStrictEqual(U.extWindows(cf(s.doc)), [], '문·개방은 뺀다: ' + kind); assert.strictEqual(U.sunHours(cf(s.doc), SEOUL, W)[0].min, 0); } }
  { // 위가 동(north 90)이면 아래 벽은 서향 → 오후에만, 위가 서(270)면 동향 → 오전에만. 회전 부호가 반대면 뒤바뀐다
    const lit = (n) => { const out = []; for (let m = 0; m < 1440; m += 10) if (U.sunPatches(f1, { lat: 37.57, north: n }, W, [m / 60]).length) out.push(m); return [out[0], out.at(-1)]; };
    assert.deepStrictEqual(lit(0), [530, 910], '남향: 8:50 ~ 15:10(정오 대칭)'); assert.deepStrictEqual(lit(270), [530, 710], '위가 서 → 아래 벽 창은 동향: 8:50 ~ 11:50'); assert.deepStrictEqual(lit(90), [730, 910], '위가 동 → 아래 벽 창은 서향: 12:10 ~ 15:10'); }
  { // 내벽 창 제외: 방 도구로 따로 그린 두 방(아래위로 맞닿음). 위 방의 아래 벽(W3)은 두 방 사이
    const two = (y, ex = []) => { const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000] }); s.exec({ type: 'addRoomRect', a: [0, y], b: [4000, y + 3000] }); s.exec({ type: 'addOpening', wall: 'W3', at: 0.5, kind: 'window' }); for (const e of ex) s.exec(e); return s; };
    assert.deepStrictEqual(U.extWindows(cf(two(3150).doc)), [], '중심선이 같은 두 겹 벽의 창'); assert.deepStrictEqual(U.extWindows(cf(two(3300).doc)), [], '등을 맞댄 벽의 창'); assert.strictEqual(U.extWindows(cf(two(3400).doc)).length, 1, '100 떨어지면 바깥');
    const s = two(3150, [{ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'window' }, { type: 'addOpening', wall: 'W7', at: 0.5, kind: 'window' }]), w = U.extWindows(cf(s.doc));
    assert.deepStrictEqual(w.map((x) => [x.id, x.room.id, x.out]), [['O2', 'R1', [0, -1]], ['O3', 'R2', [0, 1]]], '바깥 벽의 창만 남는다(위 방의 위 벽 · 아래 방의 아래 벽)');
    assert.deepStrictEqual(U.sunHours(cf(s.doc), SEOUL, W).map((r) => [r.name, r.min, r.windows]), [['방 1', 0, 1], ['방 2', 390, 1]], '북쪽 방은 직사광 없음');
    const lone = M.createDoc(); lone.floors[0].walls.push({ id: 'W1', a: [0, 0], b: [4000, 0], t: 150, kind: 'exterior', bulge: 0 }); lone.floors[0].openings.push({ id: 'O1', wall: 'W1', at: 0.5, width: 1200, height: 1200, sill: 900, type: 'window' });
    assert.deepStrictEqual(M.validateDoc(lone), []); assert.deepStrictEqual(U.extWindows(lone.floors[0]), [], '방 없는 홑벽의 창'); assert.deepStrictEqual(U.sunHours(lone.floors[0], SEOUL, W), []); }
  { // 볼록 자르기: ㄱ자 ∩ 사각 = 3 ㎡ (손계산: 2000×2000 − 겹치지 않는 1000×1000), 방향을 뒤집어도 같다, 안 겹치면 빈 배열
    const ell = [[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]], sq = [[1000, 1000], [3000, 1000], [3000, 3000], [1000, 3000]];
    near(G.polyArea(U.clipConvex(ell, sq)), 3e6, 1e-6); near(G.polyArea(U.clipConvex(ell, [...sq].reverse())), 3e6, 1e-6); assert.deepStrictEqual(U.clipConvex(ell, sq.map((p) => [p[0] + 9000, p[1]])), []); near(G.polyArea(U.clipConvex(sq, ell.slice(0, 3))), G.polyArea(U.clipConvex(sq, [[0, 0], [4000, 0], [4000, 2000]])), 1e-9); }
  for (const t of TPL) { // 템플릿 10개: 창은 모두 외벽 창, 직사광은 0~해 떠 있는 시간, 빠르다
    const f = cf(t.doc), t0 = process.hrtime.bigint(), w = U.extWindows(f); assert.strictEqual(w.length, f.openings.filter((o) => o.type === 'window').length, t.id + ' 외벽 창 수 = 창 수');
    for (const n of [0, 90, 180, 270]) for (const d of [W, E, SM]) { const span = (U.dayRange(37.57, d)[1] - U.dayRange(37.57, d)[0]) * 60; for (const r of U.sunHours(f, { lat: 37.57, north: n }, d)) assert.ok(r.min >= 0 && r.min <= span && (r.windows > 0 || r.min === 0), `${t.id} ${r.name}`); }
    assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 1500, t.id + ' 계산 시간'); }
  { const f = cf(tpl('apt-a')), at = (n) => Object.fromEntries(U.sunHours(f, { lat: 37.57, north: n }, W).map((r) => [r.name, r.min]));
    assert.strictEqual(at(0)['거실'], 0, '템플릿의 거실 창은 도면 위쪽 — 위가 북이면 북향'); assert.strictEqual(at(180)['거실'], 450, '위가 남이면 남향'); assert.strictEqual(at(180)['욕실'], 0, '창 없는 방'); }

  /* ===== 4. 단면 ===== */
  { const sec = (s, id) => U.section(cf(s.doc), M.siteOf(s.doc), id), a = sec(one());
    assert.deepStrictEqual([a.ok, a.room, a.c, a.a, a.b, a.H], [true, { id: 'R1', name: '방 1' }, [2000, 3075], [2000, -750], [2000, 3750], 2300], '기준 창 중심을 지나는 남북 선(북 끝 → 남 끝)');
    assert.deepStrictEqual(a.cuts, [{ u: -3150, t: 150, gap: null }, { u: 0, t: 150, gap: { z0: 900, z1: 2100, type: 'window' } }], '잘린 벽 둘: 북쪽 벽(빈틈 없음) · 창 벽');
    assert.deepStrictEqual(a.rooms, [{ id: 'R1', name: '방 1', u0: -3075, u1: -75 }]); assert.deepStrictEqual(a.ref, { id: 'O1', z0: 900, z1: 2100, inward: -1 });
    // 깊이 = 창 윗단 2100 ÷ tan(정오 고도): 동지 2100 ÷ tan 28.99° = 3790, 하지 2100 ÷ tan 75.87° = 529
    near(a.winter.alt, 28.99, 0.005); near(a.winter.depth, 2100 / tan(28.99), 1e-6); near(a.winter.depth, 3790.1, 0.05); near(a.summer.alt, 75.87, 0.005); near(a.summer.depth, 528.7, 0.05);
    assert.strictEqual(a.roomDepth, 3075, '창 벽 중심선 → 맞은편 벽 면'); assert.ok(a.winter.depth > a.roomDepth, '동지 햇빛은 맞은편 벽에 닿는다'); assert.strictEqual(a.vent, false, '창이 한쪽뿐이면 맞통풍 안 됨');
    near(U.section(f1, { lat: 35.18, north: 0 }).winter.depth, 2100 / tan(31.38), 1e-6, '부산'); near(U.section(f1, { lat: 35.18, north: 0 }).winter.depth, 3443.1, 0.05);
    assert.strictEqual(sec(one([{ type: 'addOpening', wall: 'W1', at: 0.25, kind: 'window' }])).vent, true, '마주 보는 외벽 양쪽에 창 → 맞통풍 됨');
    assert.strictEqual(sec(one([{ type: 'addOpening', wall: 'W2', at: 0.5, kind: 'window' }])).vent, false, '옆 벽의 창은 마주 보지 않는다');
    const b = sec(one([{ type: 'setSite', patch: { north: 180 } }])); // 위가 남: 아래 벽 창은 북향 → 기준 창 없음, 방 한가운데를 자른다
    assert.deepStrictEqual([b.ref, b.c, b.a, b.b, b.winter.depth, b.summer.depth, b.roomDepth], [null, [2000, 1500], [2000, 3750], [2000, -750], 0, 0, 0], '남향 창이 없으면 방 중심 · 깊이 없음'); assert.deepStrictEqual(b.cuts.map((x) => [x.u, !!x.gap]), [[1575, false], [-1575, true]]);
    const c = sec(one([{ type: 'setSite', patch: { north: 180 } }, { type: 'addOpening', wall: 'W1', at: 0.25, kind: 'window', width: 1800 }])); assert.deepStrictEqual([c.ref.id, c.ref.inward, c.c], ['O2', -1, [962.5, -75]], '위가 남이면 위 벽 창이 남향'); near(c.winter.depth, 3790.1, 0.05);
    const d = sec(one([{ type: 'setSite', patch: { north: 90 } }])); assert.deepStrictEqual([d.ref, d.a, d.b], [null, [-750, 1500], [4750, 1500]], '위가 동이면 남북 선은 가로(북 = 왼쪽)'); assert.deepStrictEqual(d.cuts.map((x) => x.gap), [null, null]);
    const big = sec(one([{ type: 'addOpening', wall: 'W3', at: 0.15, kind: 'window', width: 800 }, { type: 'addOpening', wall: 'W3', at: 0.85, kind: 'window', width: 1200, height: 1300 }])); assert.strictEqual(big.ref.id, 'O3', '가장 큰 남향 창(폭 × 높이)');
    const sh = sec(one([{ type: 'setSite', patch: { lat: -35 } }])); assert.deepStrictEqual([sh.ref, sh.winter.depth], [null, 0], '남반구: 남향 창에는 정오 햇빛이 들지 않는다'); near(sh.winter.alt, 90 - Math.abs(-35 + 23.44), 1e-9);
    const sn = sec(one([{ type: 'setSite', patch: { lat: -35 } }, { type: 'addOpening', wall: 'W1', at: 0.5, kind: 'window' }])); assert.strictEqual(sn.ref.id, 'O2', '남반구는 북향 창이 기준'); near(sn.summer.depth, 2100 / tan(90 - 58.44), 1e-6, '남반구의 6월(낮은 해)');
    assert.deepStrictEqual(U.section(M.createDoc().floors[0], SEOUL), { ok: false }, '방이 없으면 없다'); }
  { // 두 방(북쪽 방 창은 북향, 남쪽 방 창은 남향): 문이 없으면 맞통풍 안 됨, 사이 벽에 문을 달면 됨. 방을 골라 자를 수 있다
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000], name: '북방' }); s.exec({ type: 'addRoomRect', a: [0, 3150], b: [4000, 6150], name: '남방' });
    s.exec({ type: 'addOpening', wall: 'W1', at: 0.3, kind: 'window' }); s.exec({ type: 'addOpening', wall: 'W7', at: 0.5, kind: 'window' });
    const a = U.section(cf(s.doc), SEOUL); assert.deepStrictEqual([a.room.name, a.ref.id, a.rooms.map((r) => r.name), a.vent], ['남방', 'O2', ['북방', '남방'], false], '기본 = 남향 창이 있는 방 · 문 없이 막힌 두 방');
    const n = U.section(cf(s.doc), SEOUL, 'R1'); assert.deepStrictEqual([n.room.name, n.ref, n.c], ['북방', null, [2000, 1500]], '고른 방에 남향 창이 없으면 그 방 중심');
    s.exec({ type: 'addOpening', wall: 'W3', at: 0.2, kind: 'door' }); assert.strictEqual(U.section(cf(s.doc), SEOUL).vent, true, '문으로 이어지면 맞통풍 됨'); assert.strictEqual(U.section(cf(s.doc), SEOUL).cuts.length, 4, '두 겹 벽까지 넷'); }
  for (const t of TPL) for (const n of [0, 90, 180, 270]) { // 템플릿: 어느 방위에서도 계산되고, 고른 방을 지난다
    const f = cf(t.doc), a = U.section(f, { lat: 37.57, north: n }); assert.ok(a.ok && a.cuts.length >= 2 && a.u1 > a.u0 && a.rooms.some((r) => r.id === a.room.id), `${t.id} north ${n}`);
    for (const r of f.rooms) { const x = U.section(f, { lat: 37.57, north: n }, r.id); assert.ok(x.ok && x.room.id === r.id && [x.winter.depth, x.summer.depth, x.roomDepth].every((v) => Number.isFinite(v) && v >= 0), `${t.id} ${r.name}`); if (x.ref) near(x.winter.depth, x.ref.z1 / tan(28.99), 1e-6); } }
  { const a = U.section(cf(tpl('apt-a')), { lat: 37.57, north: 180 }); assert.deepStrictEqual([a.room.name, a.vent, a.cuts.length], ['거실', true, 3], 'apt-a(위가 남): 거실을 자른다 · 맞통풍 됨'); near(a.winter.depth, 3790.1, 0.05); }

  /* ===== 5. 그림자 ===== */
  { const len = (d, t, h = 2800) => U.shadowAt(SEOUL, d, t, h).lenMm;
    near(len(W, 12), 5053.4, 0.05, '높이 2.8 m 동지 정오 ≈ 5.05 m'); near(len(W, 12), 2800 / tan(28.99), 1e-6, '길이 = 높이 ÷ tan(고도)'); near(len(SM, 12), 704.9, 0.05, '하지 정오 0.70 m'); near(len(E, 12), 2154, 0.05); near(len(W, 9), 9919.2, 0.05); near(len(W, 15), len(W, 9), 1e-6);
    near(len(W, 12, 2300), 4151, 0.5); near(len(W, 12, 28000), 50534, 0.5, '10층');
    const v = (t, n = 0) => U.shadowAt({ lat: 37.57, north: n }, W, t, 2800).v;
    [[12, [0, -5053.4]], [9, [-6686.6, -7326.7]], [15, [6686.6, -7326.7]]].forEach(([t, e]) => v(t).forEach((x, i) => near(x, e[i], 0.05, `위가 북: ${t}시 그림자는 북쪽(위)으로 — 오전은 서쪽(왼쪽)`)));
    near(v(12, 180)[1], 5053.4, 0.05, '위가 남이면 아래로'); near(v(12, 90)[0], -5053.4, 0.05, '위가 동이면 왼쪽(북)으로'); near(Math.hypot(...v(9)), len(W, 9), 1e-6);
    assert.strictEqual(U.shadowAt(SEOUL, W, 5, 2800), null, '해 뜨기 전'); assert.strictEqual(U.shadowAt(SEOUL, W, 20, 2800), null);
    // 바닥 외곽: 방 하나 = 벽 두께까지 넓힌 사각형 [−150, −150]~[4150, 3150] + 벽 넷
    const foot = U.footprint(f1); assert.strictEqual(foot.length, 5); assert.deepStrictEqual(U.polysBox(foot), { x0: -150, y0: -150, x1: 4150, y1: 3150 }); assert.ok(foot.every((p) => G.signedArea(p) > 0), '모두 같은 방향');
    const sq = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], sp = U.shadowPolys([sq], [0, -5053]); assert.strictEqual(sp.length, 6, '조각 + 옮긴 조각 + 변 넷'); assert.ok(sp.every((p) => G.signedArea(p) >= 0), '같은 방향 — nonzero 칠 = 합집합'); assert.deepStrictEqual(U.polysBox(sp), { x0: 0, y0: -5053, x1: 4000, y1: 3000 });
    // 합집합 넓이 = 바닥 + 쓸린 띠: 사각형을 (−3000, −2000) 으로 쓸면 12 + 4×2 + 3×3 = 29 ㎡ — 표본점으로 nonzero 포함을 센다
    { const P = U.shadowPolys([sq], [-3000, -2000]); let n = 0; for (let x = -2950; x < 4000; x += 100) for (let y = -1950; y < 3000; y += 100) if (P.some((p) => G.pointInPoly(p, [x, y]))) n++; near(n / 100, 29, 0.6, '쓸고 간 자리 넓이'); }
    // 오목한 외곽(ㄱ자)도 빈틈·넘침 없이: 쓸고 간 자리의 점 = (그 점 − s·v 가 ㄱ자 안인 s∈[0,1] 이 있다)
    { const ell = [[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]], vv = [1500, -2500], P = U.shadowPolys([ell], vv);
      for (let x = -450; x < 6000; x += 300) for (let y = -2950; y < 4500; y += 300) { let want = false; for (let k = 0; k <= 2000 && !want; k++) want = G.pointInPoly(ell, [x - (vv[0] * k) / 2000, y - (vv[1] * k) / 2000]); assert.strictEqual(P.some((p) => G.pointInPoly(p, [x, y])), want, `ㄱ자 그림자 (${x}, ${y})`); } }
    assert.strictEqual(U.polysBox([]), null); assert.deepStrictEqual(U.footprint(M.createDoc().floors[0]), []);
    for (const t of TPL) { const fp = U.footprint(cf(t.doc)), b = G.bounds(t.doc), pb = U.polysBox(fp); assert.ok(fp.length > 0 && fp.every((p) => G.signedArea(p) > 0), t.id); for (const k of ['x0', 'y0', 'x1', 'y1']) near(pb[k], b[k], 1, `${t.id} 바닥 외곽 = 도면 범위 ${k}`); } }

  /* ===== 6. 검토 보강 — 고른 시각 접기 · 그림자 맞춤 · 가장자리 글자 · 변이로 살아남던 가지 ===== */
  { // 날·위도를 바꿔 낮이 줄면 고른 시각이 새 범위로 들어온다(하지 19:10 → 동지 16:40)
    assert.deepStrictEqual([U.daySpanMin(37.57, W), U.daySpanMin(37.57, SM), U.daySpanMin(33.5, SM)], [[440, 1000], [290, 1150], [300, 1140]], '낮 범위(분, 10분 단위 안쪽): 서울 동지·하지 · 제주 하지');
    assert.deepStrictEqual([U.clampDayMin(1150, 37.57, W), U.clampDayMin(1100, 37.57, W), U.clampDayMin(290, 37.57, W), U.clampDayMin(720, 37.57, W), U.clampDayMin(1150, 33.5, SM), U.clampDayMin(700.5, 37.57, W)], [1000, 1000, 440, 720, 1140, 700.5], '범위 밖 시각만 끝으로 접는다(재생 중의 소수 시각은 그대로)');
    for (const [lat, d] of [[37.57, W], [33.5, SM], [-35, SM], [66, W]]) for (const t of U.daySpanMin(lat, d)) assert.ok(U.sunAt(lat, d, t / 60).alt > 0, `접은 시각에는 해가 떠 있다 ${lat} ${d}`);
    const app = rd('app.js'), sr = app.slice(app.indexOf('const syncRoutes = '), app.indexOf('function fitBounds'));
    assert.ok(/if \(S\.t !== null\) \{ const t = clampDayMin\(S\.t, siteOf\(store\.doc\)\.lat, DAYS\[S\.day\]\.decl\); if \(t !== S\.t\) state\.sun = \{ \.\.\.S, t \}; \}/.test(sr) && sr.indexOf('clampDayMin') < sr.indexOf('anaView('), '그리기·칸 맞춤 앞(syncRoutes)에서 접는다 — 날 단추·위도·되돌리기·불러오기가 모두 지난다');
    assert.ok(/const sunSpan = \(\) => daySpanMin\(/.test(app), '슬라이더 범위와 같은 식'); }
  { // 그림자 맞춤: 그림자가 최소 배율에도 다 안 들어가면 도면(keep)이 화면에 남는다. 다 들어가면 기존 맞춤 그대로
    const V = await imp('view2d.js'), vp = V.newVP(800, 600), keep = { x0: -8000, y0: -8000, x1: 16000, y1: 14000 }, far = { x0: -400000, y0: -500000, x1: 408000, y1: 6000 };
    const old = V.fitVP(vp, far), v = V.fitVP(vp, far, undefined, 0, keep); assert.strictEqual(v.scale, V.SCALE.min);
    assert.ok(V.toPx(old, [0, 6000])[1] > 600, '고치기 전 맞춤: 도면이 화면 아래로 나간다'); assert.deepStrictEqual([V.toPx(v, [0, 0]), V.toPx(v, [8000, 6000]), V.toPx(v, [0, 14000])], [[384, 488], [416, 512], [384, 544]], '도면은 아래 여백(56) 안쪽에 · 그림자가 뻗는 위쪽을 넓게');
    const r = V.fitVP({ ...vp, w: 390, h: 338 }, far, undefined, 64, keep), q0 = V.toPx(r, [0, 0]), q1 = V.toPx(r, [8000, 6000]); assert.ok(q0[0] >= 56 && q1[0] <= 390 - 64 && q0[1] >= 56 && q1[1] <= 338 - 56, '폰(오른쪽 단추 묶음 64)에서도 도면이 여백 안');
    const fits = { x0: -20000, y0: -30000, x1: 28000, y1: 6000 }; assert.deepStrictEqual(V.fitVP(vp, fits, undefined, 0, keep), V.fitVP(vp, fits), '다 들어가면 keep 을 쓰지 않는다'); assert.deepStrictEqual(V.fitVP(vp, far, undefined, 0, null), old);
    const app = rd('app.js'), v2 = rd('view2d.js');
    assert.ok(/keep: \{ x0: b\.x0 - g, y0: b\.y0 - g, x1: b\.x1 \+ g, y1: b\.y1 \+ g \}/.test(app) && /fit\(b\) \{ set\(fitVP\(vp, b, undefined, view\.insetRight \? view\.insetRight\(\) : 0, b && b\.keep\)\); \}/.test(v2), '보기 맞춤이 도면 상자를 넘긴다');
    // 가장자리 글자: 안내 막대 아래 · 눈금자 위로 선을 따라 당긴다
    const box = [24, 60, 376, 452];
    assert.deepStrictEqual([V.pullIn([100, 10], [100, 500], box), V.pullIn([100, 500], [100, 10], box), V.pullIn([100, 100], [100, 300], box), V.pullIn([-50, 200], [400, 200], box)], [[100, 60], [100, 452], [100, 100], [24, 200]], '세로 선의 위·아래 끝 · 안에 있으면 그대로 · 가로 선');
    const dg = V.pullIn([0, 0], [300, 400], box); near(dg[0], 45, 1e-9); near(dg[1], 60, 1e-9, '비스듬한 선은 선 위에서 움직인다'); assert.deepStrictEqual(V.pullIn([100, 10], [100, 40], box), [100, 23.5], '짧은 선은 반 가까이까지만');
    assert.ok(/view\.insetTop = \(\) => /.test(app) && /const safe = \[24, \(view\.insetTop \? view\.insetTop\(\) : 0\) \+ 16, vp\.w - 24, vp\.h - \(vp\.w >= 560 \? 48 : 16\)\]/.test(v2) && /pullIn\(q\[0\], q\[1\], safe\)/.test(v2) && /pullIn\(q\[1\], q\[0\], safe\)/.test(v2) && /clamp\(q\[1\], safe\[1\], safe\[3\]\)/.test(v2), '자른 선 글자·그림자 길이 글자는 안내 막대·눈금자를 피한다'); }
  // 지역을 바꾸면 방별 직사광이 바뀐다(위도가 계산에 들어간다)
  assert.deepStrictEqual([35.18, 33.5, -35].map((lat) => [W, E, SM].map((d) => U.sunHours(f1, { lat, north: 0 }, d)[0].min)), [[410, 530, 390], [410, 530, 350], [240, 0, 0]], '남향 창 직사광(분): 부산 · 제주 · 남반구(12월 아침·저녁만)');
  assert.deepStrictEqual(Object.entries(U.DAYS).map(([k, v]) => [k, v.label, v.decl]), [['winter', '동지', -23.44], ['equinox', '춘추분', 0], ['summer', '하지', 23.44]], '날 이름과 적위의 짝');
  { // 단면의 잘린 벽: 비스듬한 방위 · 나란한 벽 · 개구부 가장자리 · 천장 넘는 창
    const sec = (ex, north) => U.section(cf(one(ex).doc), { lat: 37.57, north });
    const a = sec([], 30); assert.strictEqual(a.ref.id, 'O1'); a.cuts.forEach((c) => near(c.t, 150 / Math.cos(Math.PI / 6), 1e-9, '30° 비스듬히 자르면 두께 = 150 ÷ cos 30° = 173.2')); near(a.cuts[0].u, -3150 / Math.cos(Math.PI / 6), 1e-6);
    const p = sec([{ type: 'addWall', a: [1800, 500], b: [1800, 2500] }], 10); assert.strictEqual(p.cuts.length, 2, '자른 선과 10° 로 엇갈리는 벽은 뺀다(sin 10° < 0.2)'); assert.ok(p.cuts.every((c) => c.t < 160));
    for (const at of [0.5 + 900 / 4150, 0.5 - 900 / 4150]) assert.deepStrictEqual(sec([{ type: 'addOpening', wall: 'W1', at, kind: 'window' }], 0).cuts[0], { u: -3150, t: 150, gap: null }, '창 중심에서 폭의 0.75배 떨어진 자른 선은 창을 지나지 않는다');
    assert.deepStrictEqual(sec([{ type: 'addOpening', wall: 'W1', at: 0.5 + 500 / 4150, kind: 'window' }], 0).cuts[0].gap, { z0: 900, z1: 2100, type: 'window' }, '폭의 반 안쪽이면 지난다');
    assert.deepStrictEqual(sec([{ type: 'update', id: 'O1', patch: { height: 2000 } }], 0).cuts[1].gap, { z0: 900, z1: 2300, type: 'window' }, '잘린 창 윗단도 천장까지');
    // 기준 창은 남향 ±45° 안
    assert.strictEqual(sec([], 40).ref.id, 'O1', '남에서 40° 튼 창은 기준'); assert.strictEqual(sec([], 50).ref, null, '50° 튼 창은 아니다'); assert.strictEqual(sec([], 310).ref, null); assert.strictEqual(sec([], 320).ref.id, 'O1');
    // 저위도: 하지 정오의 해는 북쪽 → 남향 기준 창 깊이 0, 동지는 든다
    const lo = U.section(f1, { lat: 10, north: 0 }); assert.strictEqual(lo.ref.id, 'O1'); assert.strictEqual(lo.summer.depth, 0, '위도 10° 하지: 해가 창 반대쪽'); near(lo.summer.alt, 76.56, 1e-9); near(lo.winter.depth, 2100 / tan(56.56), 1e-6); near(lo.winter.depth, 1386.8, 0.05); }
  { // 맞통풍은 자른 선이 지나는 방의 창만 본다: 서쪽 방에만 마주 보는 창 쌍, 자른 선은 동쪽 방(더 큰 남향 창)
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000], name: '서방' }); s.exec({ type: 'addRoomRect', a: [4150, 0], b: [8150, 3000], name: '동방' });
    for (const o of [{ wall: 'W1' }, { wall: 'W3' }, { wall: 'W7', width: 1800 }]) s.exec({ type: 'addOpening', at: 0.5, kind: 'window', ...o });
    const x = U.section(cf(s.doc), SEOUL); assert.deepStrictEqual([x.ref.id, x.rooms.map((r) => r.name), x.vent], ['O3', ['동방'], false]); assert.strictEqual(U.section(cf(s.doc), SEOUL, 'R1').vent, true, '서쪽 방을 자르면 됨'); }
  { // 바닥 외곽: 방 밖의 사각·둥근 기둥 · 방향 맞춤 · 벽 두께 넓힘
    const s = one([{ type: 'addColumn', c: [6000, 1000], kind: 'rect', w: 400, d: 600 }, { type: 'addColumn', c: [-2000, 1000], kind: 'round', w: 500 }]), fp = U.footprint(cf(s.doc));
    assert.strictEqual(fp.length, 7, '방 + 벽 넷 + 기둥 둘'); assert.deepStrictEqual(U.polysBox(fp), { x0: -2250, y0: -150, x1: 6200, y1: 3150 }, '둥근 기둥은 반지름 250 · 사각 기둥은 폭 400 의 반');
    assert.deepStrictEqual(U.polysBox([fp[0]]), { x0: -150, y0: -150, x1: 4150, y1: 3150 }, '방 조각은 벽 두께까지 넓힌 외곽'); assert.deepStrictEqual(U.polysBox([fp[6]]), { x0: -2250, y0: 750, x1: -1750, y1: 1250 });
    const d = JSON.parse(JSON.stringify(s.doc)); d.floors[0].rooms[0].poly.reverse(); assert.deepStrictEqual(M.validateDoc(d), []);
    const W0 = new Map(d.floors[0].walls.map((w) => [w.id, w])); assert.ok(G.signedArea(G.roomOutlineWithArcs(d.floors[0].rooms[0], W0, { withWalls: true })) < 0, '뒤집은 방의 외곽은 반대 방향'); assert.ok(U.footprint(d.floors[0]).every((q) => G.signedArea(q) > 0), '바닥 조각은 그래도 모두 같은 방향(칠에 구멍이 나지 않는다)'); }
  { // 햇빛 자리 방어: 해가 땅 아래 · 해가 창 뒤쪽
    const s = new S.Store(); s.exec({ type: 'addRoomRect', a: [0, 0], b: [4000, 3000] }); s.exec({ type: 'addOpening', wall: 'W1', at: 0.5, kind: 'window' });
    assert.deepStrictEqual(U.extWindows(cf(s.doc))[0].out, [0, -1]); assert.ok(U.sunAt(37.57, SM, 0).y < 0 && U.sunAt(37.57, SM, 0).z < 0); assert.deepStrictEqual(U.sunPatches(cf(s.doc), SEOUL, SM, [0]), [], '북향 창의 하지 자정: 해는 북쪽 땅 아래 — 자리 없음');
    // ㄷ자 방의 안쪽 벽 창처럼 창 바깥쪽에도 방이 이어질 때: 해가 창 등 뒤(방 쪽)에 있으면 자리 없음
    const win = { poly: [[-1e4, -1e4], [1e4, -1e4], [1e4, 1e4], [-1e4, 1e4]], a: [-600, 0], b: [600, 0], out: [0, 1], z0: 900, z1: 2100 }, back = U.sunAt(37.57, SM, 6);
    assert.ok(back.z > 0 && back.y < 0); assert.deepStrictEqual(U.sunPatch(win, back), [], '해가 창 뒤쪽'); const under = U.sunAt(37.57, W, 6); assert.ok(under.z < 0 && under.y > 0); assert.deepStrictEqual(U.sunPatch(win, under), [], '해가 창 앞쪽이어도 땅 아래면(동지 6시) 자리 없음 — 투영이 바깥쪽 방으로 뒤집히지 않는다'); assert.ok(U.sunPatch(win, U.sunAt(37.57, W, 12)).length >= 3, '같은 창에 해가 앞쪽이면 자리가 있다'); }

  console.log('test-plan-sun: OK');
})().catch((e) => { console.error(e); process.exit(1); });
