// 스튜디오를 말로 시킨다 — 정해진 말을 알아듣는 방식(모델을 부르지 않는다). 입력 글과 지금 화면 상태(ctx)를 받아
// { reply, acts }를 돌려준다. acts 는 정해진 어휘뿐이고(studio.js 가 화면의 단추를 눌러 실행한다), 임의의 주소·선택자를 싣지 않는다.
// 나중에 모델을 붙이면 parse() 한 곳만 바꾸면 된다(같은 { reply, acts } 를 돌려주면 화면은 그대로).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AinAsk = api;
}(this, function () {
  var OUT = { cg: '도면대로', photo: '사진처럼', design: '디자인 제안' };
  var NAME = { lg: 'LG', samsung: '삼성', white: '화이트', wood: '우드', gray: '그레이', day: '낮', evening: '저녁' };
  var TOOLS = [['지우개', /지우개/], ['배경 떼기', /배경떼기|배경제거|누끼|배경/], ['색', /색보정|밝기|색조정|채도/], ['자르기', /자르기|크롭|잘라/], ['글자', /글자|문구|텍스트/]];
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[\s.,!?~·'"()]+/g, ''); };
  var jong = function (w) { var c = String(w).charCodeAt(String(w).length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0; };   // 받침이 있나
  var ra = function (w) { var c = String(w).charCodeAt(String(w).length - 1); return jong(w) && (c - 0xAC00) % 28 !== 8 ? '으로' : '로'; };   // 받침 없음·ㄹ 받침은 '로', 그 밖의 받침은 '으로'
  var ro = function (w) { return w + ra(w); };
  var any = function (t, list) { for (var i = 0; i < list.length; i++) if (t.indexOf(list[i]) >= 0) return true; return false; };

  function parse(text, ctx) {
    ctx = ctx || {};
    var t = norm(text), acts = [], say = [], rooms = ctx.rooms || [];
    if (!t) return { reply: '', acts: [] };
    var wantMake = false, wantFile = false;

    // 받을 것
    var out = any(t, ['도면대로']) ? 'cg' : any(t, ['사진처럼']) ? 'photo' : any(t, ['디자인제안', '디자인']) ? 'design' : null;
    if (out) { acts.push({ do: 'out', v: out }); say.push('받을 것을 ‘' + OUT[out] + '’' + ra(OUT[out]) + ' 정했습니다.'); }
    // 설정
    var brand = any(t, ['삼성']) ? 'samsung' : any(t, ['lg', '엘지']) ? 'lg' : null;
    if (brand) { acts.push({ do: 'opt', k: 'brand', v: brand }); say.push('제조사를 ' + ro(NAME[brand]) + ' 정했습니다.'); }
    var style = any(t, ['화이트', '하얀', '흰색']) ? 'white' : any(t, ['우드', '나무']) ? 'wood' : any(t, ['그레이', '회색']) ? 'gray' : null;
    if (style) { acts.push({ do: 'opt', k: 'style', v: style }); say.push('마감 톤을 ' + ro(NAME[style]) + ' 정했습니다.'); }
    var mood = any(t, ['저녁', '밤', '야간']) ? 'evening' : any(t, ['낮', '주간', '아침']) ? 'day' : null;
    if (mood) { acts.push({ do: 'opt', k: 'mood', v: mood }); say.push('시간을 ' + ro(NAME[mood]) + ' 정했습니다.'); }
    // 사진 손질 도구
    for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i][1].test(t)) { acts.push({ do: 'tool', v: TOOLS[i][0] }); say.push(TOOLS[i][0] + ' 도구를 엽니다.'); break; }
    // 물량표
    if (any(t, ['견적', '물량', 'csv', '수량', '내려받', '엑셀'])) {
      if (ctx.hasResult) { acts.push({ do: 'sum' }); say.push('물량표로 이동합니다.'); }
      else say.push('물량표는 결과가 나온 뒤에 받습니다 · 도면을 넣고 만들어 보세요.');
    }
    // 예시 모형의 방
    var room = null;
    for (var r = 0; r < rooms.length; r++) { var nr = norm(rooms[r]); if (nr && nr !== '전체' && t.indexOf(nr) >= 0) { room = rooms[r]; break; } }
    if (!room) {                                          // 번호 없이 '침실'이라고만 하면 번호가 가장 작은 침실
      var cand = rooms.filter(function (n) { var b = norm(n).replace(/\d+$/, ''); return /^(침실|방|욕실|화장실)$/.test(b) && t.indexOf(b) >= 0; }).sort(function (a, b) { return norm(a) < norm(b) ? -1 : 1; });
      if (cand.length) room = cand[0];
    }
    if (!room && rooms.indexOf('전체') >= 0 && any(t, ['전체', '처음으로', '한눈에', '다보여'])) room = '전체';
    if (room) { acts.push({ do: 'room', v: room }); say.push(ro(room) + ' 이동합니다.'); }
    else if (!rooms.length && any(t, ['거실', '침실', '주방', '욕실', '방보여', '모형', '실내기'])) say.push('모형이 열리면 방으로 이동할 수 있습니다 · 잠시 뒤 다시 말해 주세요.');
    // 사용법
    if (any(t, ['사용법', '도움', '어떻게', '둘러보기', '뭘할수', '뭐할수'])) { acts.push({ do: 'tour' }); say.push('사용법을 엽니다.'); }
    // 만들기 · 도면 넣기
    wantMake = any(t, ['만들어', '만들래', '시작', '돌려', '생성', '제작', '진행']);
    wantFile = !out && any(t, ['도면', '파일', '올려', '올릴', '넣어', '넣을', '업로드', '사진']) || (wantMake && !ctx.hasFile);
    if (wantMake) {
      if (!ctx.hasFile) say.push('도면을 먼저 넣어 주세요.');
      else if (!ctx.session) say.push('카카오 로그인 뒤에 만듭니다 · 아래 만들기 단추가 로그인으로 이어집니다.');
      else { acts.push({ do: 'make' }); say.push('만들기를 시작합니다.'); }
    }
    if (wantFile) {
      if (ctx.hasFile && !wantMake) say.push('이미 넣은 도면이 있습니다 · 바꾸려면 [바꾸기]를 누르세요.');
      else if (!ctx.hasFile) { acts.push({ do: 'pickFile' }); if (!wantMake) say.push('파일 고르기를 엽니다.'); }
    }
    if (!say.length) say.push(any(t, ['고마', '감사']) ? '필요하면 또 말씀하세요.' : '이 말은 아직 알아듣지 못합니다 · 아래 예시 문장을 눌러 보세요.');
    return { reply: say.join(' '), acts: acts };
  }

  // 지금 상태에 맞는 예시 문장(눌러 보게) — 최대 5개
  function suggest(ctx) {
    ctx = ctx || {};
    var rooms = (ctx.rooms || []).filter(function (n) { return n && n !== '전체'; });
    var list = [];
    if (rooms.length) list.push(rooms[0] + ' 보여줘');
    list.push(ctx.hasFile ? '사진처럼 받을래' : '도면 넣을게');
    list.push('삼성으로 해줘');
    list.push(ctx.hasResult ? '물량표 보여줘' : ctx.hasFile ? '만들어 줘' : '저녁으로 해줘');
    list.push('사용법 알려줘');
    return list.slice(0, 5);
  }

  return { parse: parse, suggest: suggest, OUT: OUT, NAME: NAME };
}));
