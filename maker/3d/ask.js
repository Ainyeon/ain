// 스튜디오를 말로 시킨다 — 정해진 말을 알아듣는 방식(모델을 부르지 않는다). 입력 글과 지금 화면 상태(ctx)를 받아
// { reply, acts }를 돌려준다. acts 는 정해진 어휘뿐이고(studio.js 가 화면의 단추를 눌러 실행한다), 임의의 주소·선택자를 싣지 않는다.
// 나중에 모델을 붙이면 parse() 한 곳만 바꾸면 된다(같은 { reply, acts } 를 돌려주면 화면은 그대로).
// 원칙: 시키는 말만 실행한다. 묻는 말·부정·'X 말고 Y'·두 값을 함께 말한 경우는 눌러야 할 것이 분명할 때만 누른다.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AinAsk = api;
}(this, function () {
  var OUT = { cg: '도면대로', photo: '사진처럼', design: '디자인 제안' };
  var NAME = { lg: 'LG', samsung: '삼성', white: '화이트', wood: '우드', gray: '그레이', day: '낮', evening: '저녁' };
  var UNKNOWN = '이 말은 아직 알아듣지 못합니다 · 아래 예시 문장을 눌러 보세요.';
  // 짧은 낱말은 띄어 쓴 낱말 하나로만 맞춘다(뒤에 조사만 허용) — '낮춰줘'의 낮, '밤새'의 밤, '나 무엇을'의 나무가 걸리지 않게
  var PT = '(?:으로|로|에서|에|엔|이랑|랑|이|가|을|를|은|는|도|만|처럼|톤|쪽)?(?=\\s|$)';
  var PT0 = '(?:으로|로|에서|에|엔|이랑|랑|이|가|을|를|도|만|처럼|톤|쪽)?(?=\\s|$)';   // 은·는 제외: '낮은 천장'의 낮은 낮(시간)이 아니다
  var rx = function (stems, p) { return new RegExp('(?:^|\\s)(?:' + stems + ')' + (p || PT)); };
  var BRAND = [['samsung', rx('삼성')], ['lg', rx('lg|엘지')]];
  var STYLE = [['white', rx('화이트|하얀색?|하얗게|흰색|흰')], ['wood', rx('우드색?|나무색?')], ['gray', rx('그레이색?|회색')]];
  var MOOD = [['evening', rx('저녁|야간|밤')], ['day', rx('낮|주간|아침', PT0)]];
  var OUTS = [['cg', /도면대로/], ['photo', /사진처럼/], ['design', /디자인(?:제안|안|으로|을)/]];   // 공백을 지운 글에서 찾는다
  var TOOLS = [['지우개', /지우개/, false], ['배경 떼기', /배경떼기|배경제거|배경지워|누끼/, false], ['색', /색보정|색조정/, false], ['색', /밝기|채도/, true],
    ['자르기', /자르기|크롭|잘라/, false], ['글자', /글자|문구|텍스트/, true]];   // true = 열라는 말이 함께 있어야 연다
  var TOOL_VERB = /열어|열래|켜|쓸래|쓸게|써볼|써줘|할래|하자|해줘|해볼|보여|도구|실행|시작/;
  var DIV = /\s+(?:말고|아니라|아니고|대신)(?=\s|$)\s*/;
  var NEG = /하지마|하지말|말아|말지|마요|마세요|그만|취소|싫|안해|못해|마$/;
  var Q = /어때|어떨까|어떻게|어떤|될까|되나|돼$|뭐|무엇|왜|얼마|언제|어디|가능|까$/;
  var TOUR = /사용법|도움|어떻게|둘러보기|뭘할수|뭐할수|무엇을할수/;
  var MAKE = /(?:만들어|만들기|만들자|만들게|만들래|생성해|제작해|시작해|시작하자|시작할게|진행해|진행시켜)(?:줘|주세요|봐|볼래|보자|라|요|줘요|주라|눌러줘|눌러주세요|눌러)?$/;
  var LOOSE_MAKE = /만들|생성|제작|시작|진행/;
  var FILE_OBJ = /(?:도면|파일|사진|이미지|평면도|평면|캐드|cad|dwg)(?:을|를|은|는|도|좀|이|가)?(?:올릴게|올릴래|올려|올리|넣을게|넣을래|넣어|업로드|첨부|고를게|고르|선택|등록)/;
  var FILE_BARE = /올릴게|올릴래|업로드|첨부/;
  var ROOMWORD = /(?:침실|욕실|화장실|거실|주방|안방|다용도실|드레스룸|현관|베란다|발코니)\d*/;
  var NAV = /보여|보기|보자|보고|볼래|이동|열어|가줘|가자|갈래|돌아/;

  var norm = function (s) {   // 소문자 · 문장부호는 공백 · 띄어쓰기 하나로 · '삼성이아니라' 같은 붙여 쓴 말고/아니라도 낱말로 떼어 둔다
    return String(s || '').toLowerCase().replace(/[.,!?~·'"()…:;\/\\\-_+*=<>\[\]{}|@#$%^&`‘’“”]+/g, ' ').replace(/(\S)(말고|아니라|아니고)(?=\s|$)/g, '$1 $2').replace(/\s+/g, ' ').trim();
  };
  var squash = function (w) { return w.replace(/\s+/g, ''); };
  var jong = function (w) { var c = String(w).charCodeAt(String(w).length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0; };   // 받침이 있나
  var ra = function (w) {
    var s = String(w), c = s.charCodeAt(s.length - 1);
    if (c >= 0x30 && c <= 0x39) return /[036]/.test(s.charAt(s.length - 1)) ? '으로' : '로';   // 읽는 소리로: 0 영 · 3 삼 · 6 육(십·백 포함)은 받침이 있다
    return jong(s) && (c - 0xAC00) % 28 !== 8 ? '으로' : '로';   // 받침 없음·ㄹ 받침은 '로', 그 밖의 받침은 '으로'
  };
  var ro = function (w) { return w + ra(w); };
  var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  var num = function (n) { var m = /(\d+)$/.exec(n); return m ? +m[1] : 0; };
  var hits = function (seg, table) { var o = []; for (var i = 0; i < table.length; i++) if (table[i][1].test(seg)) o.push(table[i][0]); return o; };

  function parse(text, ctx) {
    ctx = ctx || {};
    if (!String(text || '').trim()) return { reply: '', acts: [] };
    var w = norm(text), t = squash(w);
    if (!t) return { reply: UNKNOWN, acts: [] };            // 문장부호뿐인 입력도 무반응으로 두지 않는다
    var rooms = ctx.rooms || [], acts = [], say = [];
    var tour = TOUR.test(t);

    if (NEG.test(t)) return { reply: '알겠습니다 · 아무것도 실행하지 않습니다.', acts: [] };
    if (Q.test(t)) {                                        // 묻는 말은 실행하지 않는다 — 사용법만 연다
      if (tour) return { reply: '사용법을 엽니다.', acts: [{ do: 'tour' }] };
      return { reply: LOOSE_MAKE.test(t) ? '만들기는 도면을 넣고 “만들어 줘”라고 말하면 시작합니다.' : '묻는 말에는 답하지 못합니다 · “거실 보여줘”처럼 시키는 말로 해 주세요.', acts: [] };
    }

    // 'X 말고 Y' — 값은 Y(말고 뒤)에서 고른다
    var parts = w.split(DIV), divided = parts.length > 1, seg = divided ? parts[parts.length - 1] : w, segT = squash(seg);
    var pick = function (cat, table, label) {
      var h = hits(seg, table);
      if (h.length === 1) { acts.push({ do: 'opt', k: cat, v: h[0] }); say.push(label + ' ' + ro(NAME[h[0]]) + ' 정했습니다.'); }
      else if (h.length > 1) say.push(h.map(function (k) { return NAME[k]; }).join('·') + ' 중 하나만 말해 주세요.');
    };

    // 받을 것
    var o = [];
    for (var i = 0; i < OUTS.length; i++) if (OUTS[i][1].test(segT)) o.push(OUTS[i][0]);
    if (o.length === 1) { acts.push({ do: 'out', v: o[0] }); say.push('받을 것을 ‘' + OUT[o[0]] + '’' + ra(OUT[o[0]]) + ' 정했습니다.'); }
    else if (o.length > 1) say.push(o.map(function (k) { return OUT[k]; }).join('·') + ' 중 하나만 말해 주세요.');
    // 설정
    pick('brand', BRAND, '제조사를');
    pick('style', STYLE, '마감 톤을');
    pick('mood', MOOD, '시간을');

    // 사진 손질 도구
    for (var k = 0; k < TOOLS.length; k++) if (TOOLS[k][1].test(t) && (!TOOLS[k][2] || TOOL_VERB.test(t))) {
      if (ctx.tools === false) say.push('이 화면에서는 사진 손질 도구를 쓰지 않습니다.');
      else { acts.push({ do: 'tool', v: TOOLS[k][0] }); say.push(TOOLS[k][0] + ' 도구를 엽니다.'); }
      break;
    }
    // 물량표
    if (/견적|물량|csv|수량|내려받|엑셀/.test(t)) {
      if (ctx.hasResult) { acts.push({ do: 'sum' }); say.push('물량표로 이동합니다.'); }
      else say.push('물량표는 결과가 나온 뒤에 받습니다 · 도면을 넣고 만들어 보세요.');
    }
    // 예시 모형의 방 — 이름이 정확히 맞는 방, 말한 순서에서 마지막
    var room = null, best = -1;
    rooms.forEach(function (n) {
      if (!n || n === '전체') return;
      var re = new RegExp(esc(squash(norm(n))) + '(?!\\d)', 'g'), m, last = -1;
      while ((m = re.exec(segT))) last = m.index;
      if (last > best) { best = last; room = n; }
    });
    if (!room) {                                            // 번호 없이 '침실'이라고만 하면 번호가 가장 작은 침실 ('침실4'처럼 번호를 말했으면 해당 없음)
      var bases = ['침실', '욕실', '화장실'].filter(function (b) { return new RegExp(b + '(?!\\d)').test(segT); });
      if (/(?:^|\s)방(?:으로|을|이)?(?=\s|$)/.test(seg)) bases.push('방');
      for (var b = 0; b < bases.length && !room; b++) {
        var cand = rooms.filter(function (n) { return squash(norm(n)).replace(/\d+$/, '') === bases[b] && /\d$/.test(n); }).sort(function (x, y) { return num(x) - num(y); });
        if (cand.length) room = cand[0];
      }
    }
    if (!room && rooms.indexOf('전체') >= 0 && (/처음으로|한눈에|다보여/.test(segT) || /전체.*?(?:보여|보기|보자|보고|이동|돌아|가줘|가자)/.test(segT))) room = '전체';
    if (room) { acts.push({ do: 'room', v: room }); say.push(ro(room) + ' 이동합니다.'); }
    else if (!rooms.length && ROOMWORD.test(t)) say.push('모형이 열리면 방으로 이동할 수 있습니다 · 잠시 뒤 다시 말해 주세요.');
    else if (rooms.length && NAV.test(segT) && (ROOMWORD.test(segT) || /(?:^|\s)방\s?\d+/.test(seg))) say.push('이 모형에 그 방은 없습니다 · ' + rooms.filter(function (n) { return n !== '전체'; }).join(' · ') + '.');
    // 사용법
    if (tour) { acts.push({ do: 'tour' }); say.push('사용법을 엽니다.'); }
    // 만들기 · 도면 넣기
    var wantMake = MAKE.test(t), wantFile = FILE_OBJ.test(t) || FILE_BARE.test(t);
    if (wantMake) {
      if (!ctx.hasFile) { say.push('도면을 먼저 넣어 주세요.'); if (!wantFile) acts.push({ do: 'pickFile' }); }
      else if (!ctx.session) say.push('카카오 로그인 뒤에 만듭니다 · 아래 만들기 단추가 로그인으로 이어집니다.');
      else if (ctx.canMake === false) say.push('지금은 만들기를 시작할 수 없습니다 · 진행 중이거나 결과를 보는 중입니다.');
      else { acts.push({ do: 'make' }); say.push('만들기를 시작합니다.'); }
    }
    if (wantFile) {
      if (ctx.hasFile) { if (!wantMake) say.push('이미 넣은 도면이 있습니다 · 바꾸려면 [바꾸기]를 누르세요.'); }
      else { acts.push({ do: 'pickFile' }); if (!wantMake) say.push('파일 고르기를 엽니다.'); }
    }
    if (!say.length) say.push(divided ? '무엇으로 바꿀지 말해 주세요.' : /고마|감사/.test(t) ? '필요하면 또 말씀하세요.' : UNKNOWN);
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

  return { parse: parse, suggest: suggest, OUT: OUT, NAME: NAME, TOOL_NAMES: TOOLS.map(function (x) { return x[0]; }).filter(function (n, i, a) { return a.indexOf(n) === i; }) };
}));
