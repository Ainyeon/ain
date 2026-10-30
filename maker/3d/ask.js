// 스튜디오를 말로 시킨다 — 정해진 말을 알아듣는 방식(모델을 부르지 않는다). 입력 글과 지금 화면 상태(ctx)를 받아
// { reply, acts }를 돌려준다. acts 는 정해진 어휘뿐이고(studio.js 가 화면의 단추를 눌러 실행한다), 임의의 주소·선택자를 싣지 않는다.
// 나중에 모델을 붙이면 parse() 한 곳만 바꾸면 된다(같은 { reply, acts } 를 돌려주면 화면은 그대로).
// 원칙: ① 되돌릴 수 없는 일([만들기] — 작업 1건과 월 한도를 쓴다)은 말이 눌러 주지 않는다 — 단추로 데려가 초점만 주고 사람이 누른다.
// ② 값 고르기는 낱말 바로 뒤의 부정·질문을 보고 건너뛴다. 'X 말고 Y' 는 Y 에서만 고른다. 두 값을 함께 말하면 고르게 한다.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AinAsk = api;
}(this, function () {
  var OUT = { cg: '도면대로', photo: '사진처럼', design: '디자인 제안' };
  var NAME = { lg: 'LG', samsung: '삼성', white: '화이트', wood: '우드', gray: '그레이', day: '낮', evening: '저녁' };
  var UNKNOWN = '이 말은 아직 알아듣지 못합니다 · 아래 예시 문장을 눌러 보세요.';
  var CANCEL = '알겠습니다 · 아무것도 실행하지 않습니다.';
  // 값 낱말(공백을 지운 글에서 찾는다 — 띄어쓰기 없이 쳐도 된다). 짧은 낱말은 헷갈리는 이웃을 뺀다('낮춰줘'·'낮은'·'밤새'·'밤색')
  var BRAND = [['samsung', /삼성/], ['lg', /lg|엘지/]];
  var STYLE = [['white', /화이트|흰색|흰톤|하얀|하얗|백색/], ['wood', /우드|원목|목재/], ['gray', /그레이|회색|회톤/]];
  var MOOD = [['evening', /저녁|야간|야경|석양|노을|밤(?!새|색|낮)/], ['day', /낮(?!춰|추|은|아|게|다|지)|한낮|대낮|주간|아침|오전|오후/]];
  var OUTS = [['cg', /도면대로/], ['photo', /사진처럼|실사/], ['design', /디자인제안|디자인(?:으로|을)|디자인안(?:으로|을)/]];
  var TOOLS = [['지우개', /지우개/, false], ['배경 떼기', /배경떼기|배경제거|배경지워|누끼/, false], ['색', /색보정|색조정/, false], ['색', /밝기|채도/, true],
    ['자르기', /자르기|크롭|잘라/, false], ['글자', /글자|문구|텍스트/, true]];   // true = 여는 말이 함께 있어야 연다
  var TOOL_VERB = /열어|열래|열기|켜|쓸래|쓸게|써볼|써줘|할래|하자|해줘|해볼|보여|도구|실행|시작|넣어|넣기|넣을|넣고|올려|올릴|높여|조절|키워|줄여|바꿔|편집/;
  var DIV = /\s+(?:말고|아니라|아니고|아닌|아냐|아니야|대신)(?:\s+|$)/;
  var NEGW = /안|못|말아|말지|말고|하지마|마요|마세요|마$|빼|제외|싫|별로|아님|아냐|아니|아닌|그만|취소/;   // 낱말 바로 뒤 몇 글자에서 본다
  var CANCEL_RE = /하지마|하지말|말아|말지|마요|마세요|마$|그만|취소|싫|안해|안할|안쓸|못해/;
  var HARDQ = /어때|어떨까|어떻게|어떤|뭐|무엇|왜|얼마|언제|어디|있나|있어요|있습니까|있어$|없나|없어요|없어$|가능한가|가능해\?|가능하나/;
  var SOFTQ = /까요|나요|니$|냐$|죠$|돼요|될까|할까|볼까|가능|까$/;
  var IMPER = /줘|주세요|주십시오|주실래|주시면|주셈|해라|하자|해요|해봐|볼래|보자|할래|바꿔|켜|열어|눌러|부탁|해줄래/;
  var TOUR = /사용법|도움|어떻게|둘러보기|뭘할수|뭐할수|무엇을할수/;
  var MAKE = /(?:만들어|만들기|만들자|만들게|만들래|만들고|생성해|제작해|시작해|시작하자|시작할게|시작하세요|시작합시다|진행해|진행하자|진행할게|진행시켜)(?!진|졌|지|서|도|야|놓|놨|둔|뒀)/;   // '만들어진 거'·'시작해서'·'만들어도'는 시키는 말이 아니다
  var MAKE_OTHER = /(?:견적서?|물량표?|엑셀|csv|사용법|둘러보기|지우개|자르기|색보정|색조정|배경|글자|문구|텍스트)(?:을|를|은|는)?(?:만들|시작|제작|생성|진행)/;
  var LOOSE_MAKE = /만들|생성|제작|시작|진행/;
  var FILE_OBJ = /(?:도면|파일|사진|이미지|평면도|평면|캐드|cad|dwg|dxf|pdf)(?:을|를|은|는|도|좀|한장|한개)*(?:올려|올릴|올리고|올리기|넣어|넣을|넣고|넣기|업로드|첨부|등록|고를|고르|선택|열어|열기|불러)/;
  var FILE_BARE = /올릴게|올릴래|업로드해|업로드할|첨부할|첨부해/;
  var FILE_BLOCK = /했|놨|놓았|됐|됨|법|방법|어떻게|안올|안넣|못|않/;   // 지난 일·방법 질문·부정은 파일 창을 열지 않는다
  var ROOMWORD = /(?:침실|욕실|화장실|거실|주방|부엌|키친|안방|다용도실|드레스룸|현관|베란다|발코니)\d*/;
  var NAV = /보여|보기|보자|보고|볼래|이동|열어|가줘|가자|갈래|돌아/;
  var PUNCT = /[.,!?~·'"()…:;\/\\\-_+*=<>\[\]{}|@#$%^&`‘’“”「」『』]+/g;
  var ORD = { '첫': 1, '둘': 2, '두': 2, '셋': 3, '세': 3, '넷': 4, '네': 4 };

  var norm = function (s) {   // 호환 문자(전각 ＬＧ·２)를 풀고 · 소문자 · 문장부호는 공백 · 서수('2번 침실'·'둘째 침실')는 방 이름으로 · 붙여 쓴 '말고'는 낱말로
    s = String(s);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.toLowerCase().replace(PUNCT, ' ');
    s = s.replace(/(\d+)\s?번\s?째?\s?(침실|욕실|화장실|방)/g, '$2$1').replace(/(침실|욕실|화장실|방)\s?(\d+)\s?번\s?째?/g, '$1$2')
      .replace(/(첫|두|세|네)\s?번\s?째\s?(침실|욕실|화장실|방)/g, function (m, o, r) { return r + ORD[o]; })
      .replace(/(침실|욕실|화장실|방)\s?(첫|두|세|네)\s?번\s?째/g, function (m, r, o) { return r + ORD[o]; })
      .replace(/(첫|둘|셋|넷)째\s?(침실|욕실|화장실|방)/g, function (m, o, r) { return r + ORD[o]; });
    return s.replace(/(\S)(말고|아니라|아니고|아닌|아냐|아니야|대신)(?=\s|$)/g, '$1 $2').replace(/\s+/g, ' ').trim();
  };
  var squash = function (w) { return w.replace(/\s+/g, ''); };
  var jong = function (w) { var c = String(w).charCodeAt(String(w).length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0; };   // 받침이 있나
  var ra = function (w) {
    var s = String(w), c = s.charCodeAt(s.length - 1);
    if (c >= 0x30 && c <= 0x39) return /[036]/.test(s.charAt(s.length - 1)) ? '으로' : '로';   // 읽는 소리로: 0 영 · 3 삼 · 6 육(십·백 포함)은 받침이 있다
    return jong(s) && (c - 0xAC00) % 28 !== 8 ? '으로' : '로';   // 받침 없음·ㄹ 받침은 '로', 그 밖의 받침은 '으로'
  };
  var ro = function (w) { return w + ra(w); };
  var eun = function (w) { return w + (jong(w) ? '은' : '는'); };
  var num = function (n) { var m = /(\d+)$/.exec(n); return m ? +m[1] : 0; };
  var uniq = function (a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); };
  var hitsOf = function (table, t) { var o = []; for (var i = 0; i < table.length; i++) { var m = table[i][1].exec(t); if (m) o.push({ k: table[i][0], e: m.index + m[0].length }); } return o; };
  var NOTNEG = /안(?=방|내|쪽|에|으로|의|팎)/g;   // 안방·안내·안쪽·안에·안으로·안의·안팎의 '안' 은 부정이 아니다('안 해'·'안 돼'·'안 좋아'는 그대로 부정)
  var negNear = function (t, e) { return NEGW.test(t.slice(e, e + 7).replace(NOTNEG, '_').slice(0, 5)); };   // 낱말 바로 뒤 5글자(조사·'안 할래'·'빼줘')만 — 멀리 있는 다른 절은 보지 않는다. 5글자 끝의 '안' 뒤 낱말까지 보려고 7글자를 자른다

  function parse(text, ctx) {
    ctx = ctx || {};
    var raw = String(text == null ? '' : text).slice(0, 300);
    if (!raw.trim()) return { reply: '', acts: [] };
    var w = norm(raw), t = squash(w);
    if (!t) return { reply: UNKNOWN, acts: [] };            // 문장부호뿐인 입력도 무반응으로 두지 않는다
    var rooms = Array.isArray(ctx.rooms) ? ctx.rooms.filter(function (n) { return typeof n === 'string' && squash(norm(n)); }) : [];
    var acts = [], say = [], amb = false;                  // amb: 되묻는 말을 했으면 같은 문장에서 만들기를 준비하지 않는다

    // 묻는 말은 실행하지 않는다(사용법만 연다). 부탁하는 말(~해 주세요·~해 주시면)은 물음표·'까요'가 있어도 부탁이다
    var q = HARDQ.test(t) || ((SOFTQ.test(t) || /\?\s*$/.test(raw)) && !IMPER.test(t));
    if (q) {
      if (TOUR.test(t)) return { reply: '사용법을 엽니다.', acts: [{ do: 'tour' }] };
      return { reply: LOOSE_MAKE.test(t) ? '만들기는 도면을 넣고 “만들어 줘”라고 말하면 준비합니다.' : '묻는 말에는 답하지 못합니다 · “거실 보여줘”처럼 시키는 말로 해 주세요.', acts: [] };
    }

    // 'X 말고 Y' · 'X 대신 Y' — 값·도구·방·물량표·사용법·만들기는 모두 Y(말고 뒤)에서 본다
    var parts = w.split(DIV), divided = parts.length > 1, seg = divided ? parts[parts.length - 1] : w, s = squash(seg);
    var pick = function (cat, table, label) {
      var all = hitsOf(table, s);
      if (cat === 'style' && /나무/.test(seg)) all.push({ k: 'wood', e: s.indexOf('나무') + 2 });   // '나 무엇을'처럼 띄어 쓴 말에는 걸리지 않게 띄어쓰기를 둔 글에서 확인
      var pos = uniq(all.filter(function (h) { return !negNear(s, h.e); }).map(function (h) { return h.k; }));
      if (pos.length === 1) { acts.push({ do: 'opt', k: cat, v: pos[0] }); say.push(label + ' ' + ro(NAME[pos[0]]) + ' 정했습니다.'); }
      else if (pos.length > 1) { amb = true; say.push(pos.map(function (k) { return NAME[k]; }).join('·') + ' 중 하나만 말해 주세요.'); }
      else if (all.length) say.push(eun(NAME[all[0].k]) + ' 선택하지 않습니다.');
    };

    // 받을 것
    var oAll = hitsOf(OUTS, s), oPos = uniq(oAll.filter(function (h) { return !negNear(s, h.e); }).map(function (h) { return h.k; }));
    if (oPos.length === 1) { acts.push({ do: 'out', v: oPos[0] }); say.push('받을 것을 ‘' + OUT[oPos[0]] + '’' + ra(OUT[oPos[0]]) + ' 정했습니다.'); }
    else if (oPos.length > 1) { amb = true; say.push(oPos.map(function (k) { return OUT[k]; }).join('·') + ' 중 하나만 말해 주세요.'); }
    else if (oAll.length) say.push(eun(OUT[oAll[0].k]) + ' 선택하지 않습니다.');
    // 설정
    pick('brand', BRAND, '제조사를');
    pick('style', STYLE, '마감 톤을');
    pick('mood', MOOD, '시간을');

    if (divided && !acts.length && !amb) {                  // '삼성 말고' 처럼 말고 뒤에 고를 것이 없으면 되묻는다
      var before = squash(parts.slice(0, -1).join(' '));
      if ([BRAND, STYLE, MOOD, OUTS].some(function (tb) { return hitsOf(tb, before).length; })) { amb = true; say.push('무엇으로 바꿀지 말해 주세요.'); }
    }

    // 사진 손질 도구
    for (var k = 0; k < TOOLS.length; k++) {
      var tm = TOOLS[k][1].exec(s);
      if (tm && (!TOOLS[k][2] || TOOL_VERB.test(s)) && !negNear(s, tm.index + tm[0].length)) {
        if (ctx.tools === false) say.push('이 화면에서는 사진 손질 도구를 쓰지 않습니다.');
        else { acts.push({ do: 'tool', v: TOOLS[k][0] }); say.push(TOOLS[k][0] + ' 도구를 엽니다.'); }
        break;
      }
    }
    // 물량표
    if (/견적|물량|csv|수량|내려받|엑셀/.test(s) && !MAKE_OTHER.test(s)) {
      if (ctx.hasResult) { acts.push({ do: 'sum' }); say.push('물량표로 이동합니다.'); }
      else say.push('물량표는 결과가 나온 뒤에 받습니다 · 도면을 넣고 만들어 보세요.');
    }
    // 예시 모형의 방 — 이름이 정확히 맞는 방, 말한 순서에서 마지막(indexOf 로 찾아 반드시 끝난다)
    var room = null, best = -1, st = rooms.indexOf('주방') >= 0 ? s.replace(/부엌|키친/g, '주방') : s;
    rooms.forEach(function (n) {
      if (n === '전체') return;
      var key = squash(norm(n)), from = 0, i;
      while ((i = st.indexOf(key, from)) >= 0) { if (!/\d/.test(st.charAt(i + key.length)) && i > best) { best = i; room = n; } from = i + 1; }
    });
    if (!room) {                                            // 번호 없이 '침실'이라고만 하면 번호가 가장 작은 침실('마지막 침실'은 가장 큰 번호), '침실4'처럼 번호를 말했으면 해당 없음
      var bases = ['침실', '욕실', '화장실'].filter(function (b) { return new RegExp(b + '(?!\\d)').test(st); });
      if (/(?:^|\s)방(?:으로|을|이)?(?=\s|$)/.test(seg)) bases.push('방');
      for (var b = 0; b < bases.length && !room; b++) {
        var cand = rooms.filter(function (n) { return squash(norm(n)).replace(/\d+$/, '') === bases[b] && /\d$/.test(n); }).sort(function (x, y) { return num(x) - num(y); });
        if (cand.length) room = /마지막/.test(st) ? cand[cand.length - 1] : cand[0];
      }
    }
    if (!room && rooms.indexOf('전체') >= 0) {
      var rest = st.replace(/전체|집|화면|모습|보기|보여줘|보여주세요|보자|로|으로|를|을|좀|해줘|이동|돌아가줘|돌아가|가줘|가자|처음|원래/g, '');
      if (/처음으로|처음화면|원래화면|한눈에/.test(st) || /(?:^|\s)다 ?보여/.test(seg) || /^(?:돌아가|뒤로)/.test(st) || (st.indexOf('전체') >= 0 && (rest === '' || /전체(?:화면|모습|보기|로|를)?(?:보여|보자|이동|돌아|가)/.test(st)))) room = '전체';
    }
    if (room && negNear(s, Math.max(0, s.indexOf(squash(norm(room))) + squash(norm(room)).length))) { say.push(eun(room) + ' 이동하지 않습니다.'); room = null; }
    else if (room) { acts.push({ do: 'room', v: room }); say.push(ro(room) + ' 이동합니다.'); }
    else if (!rooms.length && ROOMWORD.test(s)) say.push('모형이 열리면 방으로 이동할 수 있습니다 · 잠시 뒤 다시 말해 주세요.');
    else if (rooms.length && NAV.test(s) && (ROOMWORD.test(st) || /(?:^|\s)방\s?\d+/.test(seg))) say.push('이 모형에 그 방은 없습니다 · ' + rooms.filter(function (n) { return n !== '전체'; }).join(' · ') + '.');
    // 사용법
    if (TOUR.test(s)) { acts.push({ do: 'tour' }); say.push('사용법을 엽니다.'); }
    // 만들기 · 도면 넣기 — 만들기는 단추 앞까지만 데려간다(누르는 것은 사람)
    var mm = MAKE.exec(s), wantMake = !!mm && !amb && !MAKE_OTHER.test(s) && !negNear(s, mm.index + mm[0].length) && !/(?:안|못)$/.test(s.slice(0, mm.index));
    var wantFile = (FILE_OBJ.test(s) || FILE_BARE.test(s)) && !FILE_BLOCK.test(s);
    if (wantMake) {
      if (!ctx.hasFile) { say.push('도면을 먼저 넣어 주세요.'); if (!wantFile) acts.push({ do: 'pickFile' }); }
      else if (!ctx.session) say.push('카카오 로그인 뒤에 만듭니다 · 아래 만들기 단추가 로그인으로 이어집니다.');
      else if (ctx.canMake === false) say.push('지금은 만들기를 시작할 수 없습니다 · 진행 중입니다.');
      else { acts.push({ do: 'make' }); say.push('준비했습니다 · 만들기 단추를 눌러 시작하세요.'); }
    }
    if (wantFile) {
      if (ctx.hasFile) { if (!wantMake) say.push('이미 넣은 도면이 있습니다 · 바꾸려면 [바꾸기]를 누르세요.'); }
      else { acts.push({ do: 'pickFile' }); if (!wantMake) say.push('파일 고르기를 엽니다.'); }
    }
    if (!say.length) say.push(divided ? '무엇으로 바꿀지 말해 주세요.' : CANCEL_RE.test(t) ? CANCEL : /고마|감사/.test(t) ? '필요하면 또 말씀하세요.' : UNKNOWN);
    return { reply: say.join(' '), acts: acts };
  }

  // 지금 상태에 맞는 예시 문장(눌러 보게) — 최대 5개
  function suggest(ctx) {
    ctx = ctx || {};
    var rooms = (Array.isArray(ctx.rooms) ? ctx.rooms : []).filter(function (n) { return typeof n === 'string' && n && n !== '전체'; });
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
