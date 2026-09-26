// 게시판 목록·글쓰기·상세·댓글·본인 수정/삭제. 회원 전용(비회원 티저).
// 읽기는 ainCommunity.readPosts 경유 (v_posts). 익명 글의 작성자는 API 응답에 들어 있지 않다.
//
// 자유게시판이 기본이고, 구인·구직 페이지는 window.AIN_BOARD 로 board_type 만 바꿔 쓴다.
// 등록·수정·삭제·댓글·신고·익명 보호·연락처 가림이 모두 같은 경로라 따로 만들지 않는다.
(function () {
  'use strict';
  const panel = document.getElementById('panel');
  const BOARDS = {
    free: { type: 'free', empty: '등록된 글이 없습니다.' },
    job_offer: {
      type: 'job_offer', closable: true,
      empty: '등록된 구인 글이 없습니다.',
      hint: '사람을 구하는 글입니다. 지역·공종·기간·조건을 본문에 적어 주세요.'
    },
    job_seek: {
      type: 'job_seek', closable: true,
      empty: '등록된 구직 글이 없습니다.',
      hint: '일할 곳을 찾는 글입니다. 지역·공종·경력·가능한 기간을 본문에 적어 주세요.'
    }
  };
  const CFG = BOARDS[(window.AIN_BOARD || {}).type] || BOARDS.free;
  // 구인/구직은 같은 주소(/edu/jobs/)에 ?kind 로 갈린다. 글 열기·목록 복귀·등록 뒤 이동에서 kind 를 잃지 않게 한다.
  const KIND_Q = CFG.type === 'job_seek' ? 'kind=seek' : CFG.type === 'job_offer' ? 'kind=offer' : '';
  const listUrl = () => location.pathname + (KIND_Q ? '?' + KIND_Q : '');
  const postUrl = (id) => '?' + (KIND_Q ? KIND_Q + '&' : '') + 'id=' + encodeURIComponent(id);
  const db = () => ainAuth.getClient();
  const C = () => window.ainCommunity;
  const P = () => new URLSearchParams(location.search);
  const qsId = () => P().get('id');

  // 교육 카드에서 넘어온 경우 — 글을 그 과정에 연결한다 (SPEC §3.8)
  const refParam = () => {
    if (CFG.type !== 'free') return null;            // 구인·구직 글은 교육 과정에 연결하지 않는다
    const v = P().get('ref') || '';
    const m = v.match(/^(edu|notice):(.+)$/);
    return m ? { type: m[1], id: m[2] } : null;
  };
  // ⚠️ preset.kind 는 posts.review_kind 로 저장된다. DB 제약이 review/tip 만 받으므로
  //    구인·구직 프리셋의 kind 는 반드시 null 이다 (kind 를 붙이면 등록이 거부된다).
  const FORM_PRESETS = {
    review: { kind: 'review', ph: '수강한 과정, 배운 내용, 도움이 된 점' },
    edu_tip: { kind: 'tip', ph: '기관명, 과정명, 공식 페이지 주소.\n기관·업체 관계자면 어떤 관계인지도 적어 주세요.\n운영자가 원문을 확인한 뒤 반영합니다.' },
    job_offer: { kind: null, ph: '지역, 공종, 기간, 급여 조건, 지원 방법.\n개인 연락처는 본문에 적지 마세요 — 저장할 때 가려집니다.' },
    job_seek: { kind: null, ph: '지역, 공종, 경력, 가능한 기간.\n개인 연락처는 본문에 적지 마세요 — 저장할 때 가려집니다.' }
  };
  // 후기·제보 양식(?form=)은 자유게시판에서만. 구인·구직은 항상 자기 양식(후기 항목이 붙지 않게)
  const formKey = () => (CFG.type === 'free' && P().get('form')) || CFG.type;
  // 오래된 후기를 하단으로 몰지 않고 수료 시점으로 거른다 (SPEC §3.7).
  // ?since=12|24|36 (개월). 없으면 전체.
  const SINCE_OPTS = [['', '전체 기간'], ['12', '최근 1년'], ['24', '최근 2년'], ['36', '최근 3년']];
  // ⚠️ 일자를 먼저 1로 고정한 뒤 월을 뺀다. 오늘이 2024-02-29일 때 그냥 setMonth(-12)를 하면
  //    없는 날짜(2023-02-29)가 2023-03-01로 넘어가 경계가 한 달 밀린다.
  function sinceMonth(months, now) {
    const n = Number(months == null ? P().get('since') : months);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date(now == null ? Date.now() : now);
    d.setDate(1);
    d.setMonth(d.getMonth() - n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function sinceBar(count) {
    const cur = P().get('since') || '';
    return '<div class="review-filter"><label for="fSince">수료 시점</label>'
      + '<select id="fSince">'
      + SINCE_OPTS.map(([v, l]) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>'
        + l + '</option>').join('')
      + '</select>'
      + '<span class="write-hint">후기 ' + count + '건 · 수료 시점 미기재는 걸러지지 않음</span>'
      + '</div>';
  }

  // 후기 선택 입력 (SPEC §3.7) — 금액·국비 유형·수료 시점 모두 선택.
  // 금액이 없다고 자동으로 비공개하지 않고, 같은 기관이라도 회차·시점이 다르면 또 쓸 수 있다.
  function reviewFields() {
    if (!C().anonymousReady()) return '';   // 후기 컬럼도 같은 마이그레이션에 들어 있다
    const now = new Date();
    const max = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    return '<fieldset class="review-fields">'
      + '<legend>선택 입력 (비워도 등록됩니다)</legend>'
      + '<div class="review-grid">'
      + '<label for="rCost">지출 금액 (원)</label>'
      + '<input type="number" id="rCost" min="0" max="100000000" step="1" inputmode="numeric" placeholder="예: 22500">'
      + '<label for="rSubsidy">국비 유형</label>'
      + '<select id="rSubsidy">'
      + '<option value="">선택 안 함</option>'
      + Object.entries(C().SUBSIDY_LABELS).map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('')
      + '</select>'
      + '<label for="rMonth">수료 시점</label>'
      + '<input type="month" id="rMonth" max="' + max + '" aria-describedby="rMonthHint">'
      + '</div>'
      + '<p class="write-hint" id="rMonthHint">수료 시점을 적으면 기간별로 걸러 볼 수 있습니다. '
      + '공식 페이지 주소를 첨부할 수 있습니다. 개인 연락처는 본문에 적지 마세요.</p>'
      + '</fieldset>';
  }

  function gate(html) { panel.innerHTML = '<div class="gate-msg">' + html + '</div>'; }

  function teaserRender(rows) {
    const items = (rows || []).map((r) =>
      '<div class="board-card board-teaser-blur"><h2>' + escT(r.title) + '</h2>'
      + '<div class="card-meta-line"><time>' + C().timeAgo(r.created_at) + '</time></div></div>').join('');
    const total = rows && rows.length ? rows[0].total_count : 0;
    panel.innerHTML =
      '<div class="gate-msg"><b>회원 전용입니다</b>' + (total ? ' — 글 ' + total + '개' : '') + '<br>'
      + '카카오 계정으로 로그인하면 읽고 쓸 수 있습니다.<br>'
      + '<button type="button" class="gate-cta" id="gateLogin">카카오 로그인</button></div>'
      + items;
    document.getElementById('gateLogin').addEventListener('click', () => C().loginWithKakao());
  }

  // 글쓰기 폼 — 짧은 글도 막지 않는다 (최소 글자 수·필수 양식 없음, SPEC §6.1)
  function writeBlock() {
    const ref = refParam();
    const preset = FORM_PRESETS[formKey()] || null;
    const openNow = !!(ref || P().get('form'));
    const isReview = !!preset && preset.kind === 'review';
    return '<button type="button" class="write-btn" id="writeOpen"' + (openNow ? ' hidden' : '') + '>글쓰기</button>'
      + '<form class="write-form" id="writeForm"' + (openNow ? '' : ' hidden') + '>'
      + (isReview ? '<p class="write-hint">아래 항목은 모두 선택 입력입니다.</p>' : '')
      + (ref ? '<p class="write-hint">교육 과정 <b>' + escT(ref.id) + '</b>에 연결됩니다.</p>' : '')
      + '<label class="write-hint" for="wTitle">제목</label>'
      + '<input type="text" id="wTitle" placeholder="제목 (80자까지)" maxlength="80" required>'
      + '<label class="write-hint" for="wBody">내용</label>'
      + '<textarea id="wBody" placeholder="' + escT(preset ? preset.ph : '내용') + '" maxlength="4000" required></textarea>'
      + (isReview ? reviewFields() : '')
      + anonBox('wAnon')
      + '<div class="form-actions"><button type="button" class="btn-ghost" id="writeCancel">취소</button>'
      + '<button type="submit" class="btn-primary">등록</button></div></form>';
  }

  // 익명 선택지는 실제로 익명이 되는 경우에만 보여준다.
  // 지원되지 않는 상태에서 체크박스만 띄우면 익명인 척하는 것이 된다.
  function anonBox(id) {
    if (!C().anonymousReady()) return '';
    return '<label class="anon-row"><input type="checkbox" id="' + id + '">'
      + '<span>익명으로 작성 (닉네임·분야 숨김). '
      + '운영자는 중복·악용 확인 목적으로만 작성자를 확인할 수 있습니다.</span></label>';
  }

  async function renderList(me) {
    const ref = refParam();
    // ref가 있으면 그 과정에 연결된 글만 본다. 필터 컬럼은 v_posts에만 있으므로
    // legacy 경로에서는 필터를 걸지 않고 그 사실을 화면에 적는다.
    const since = sinceMonth();
    const r = await C().readPosts((q, mode) => {
      let x = q.eq('board_type', CFG.type);
      if (mode === 'view' && CFG.type === 'free') {
        if (ref) x = x.eq('ref_type', ref.type).eq('ref_id', ref.id);
        // 수료 시점 필터는 서버에서 건다. 후기가 아닌 글과 시점을 안 적은 후기는
        // 거르지 않는다 — 모른다는 이유로 감추면 안 되기 때문(SPEC §3.7).
        if (since) x = x.or('review_kind.is.null,review_done_month.is.null,review_done_month.gte.' + since);
      }
      return x.order('created_at', { ascending: false }).limit(50);
    }, me.user.id);
    if (r.error) { gate('게시판 준비 중입니다. 잠시 후 다시 확인해 주세요.'); console.warn(r.error); return; }
    const data = r.rows;
    const refFiltered = !!ref && r.mode === 'view';
    const reviewCount = data.filter((p) => p.review_kind === 'review').length;
    // 후기가 있는 목록에서만 필터를 띄운다 (v_posts 경로에서만 서버 조건을 걸 수 있다)
    const sinceHtml = (r.mode === 'view' && (reviewCount || P().get('since'))) ? sinceBar(reviewCount) : '';
    const refHead = ref
      ? '<div class="rules-banner">' + (refFiltered
          ? '교육 과정 <b>' + escT(ref.id) + '</b>에 연결된 글만 표시 중. '
            + '<a href="/board/free/">전체 글</a> · <a href="/edu/?id=' + encodeURIComponent(ref.id) + '">과정 보기</a>'
          : '과정별 보기는 아직 쓸 수 없어 전체 글을 표시합니다. '
            + '<a href="/edu/?id=' + encodeURIComponent(ref.id) + '">과정 보기</a>')
        + '</div>'
      : '';

    const ids = data.map((p) => p.id);
    let likeMap = {};
    if (ids.length) {
      const { data: likes } = await db().from('votes').select('post_id').in('post_id', ids).eq('vote', 'up');
      (likes || []).forEach((v) => { likeMap[v.post_id] = (likeMap[v.post_id] || 0) + 1; });
    }
    const { data: cmtRows } = await db().from('comments').select('post_id').in('post_id', ids.length ? ids : [0]);
    const cmtMap = {};
    (cmtRows || []).forEach((c) => { cmtMap[c.post_id] = (cmtMap[c.post_id] || 0) + 1; });

    const closedTag = (p) => p.closed_at ? '<span class="field-badge">마감</span>' : '';
    const reviewTag = (p) => p.review_kind !== 'review' ? '' :
      '<span class="field-badge">' + escT(p.review_done_month
        ? p.review_done_month.replace('-', '.') + ' 수료' : '수료 시점 미기재') + '</span>';
    const list = data.length ? data.map((p) =>
      '<a class="board-card' + (C().isStaff(p.author) ? ' staff-accent' : '') + '" href="' + postUrl(p.id) + '"><h2>' + closedTag(p) + reviewTag(p) + ' ' + escT(p.title) + '</h2>'
      + '<div class="card-meta-line"><span class="author-line">' + C().authorBadgeOf(p) + '</span>'
      + '<span><span class="cmt-count">공감 ' + (likeMap[p.id] || 0) + ' · 댓글 ' + (cmtMap[p.id] || 0) + ' · 조회 ' + (p.view_count || 0) + '</span>'
      + ' · <time>' + C().timeAgo(p.created_at) + '</time></span></div></a>').join('')
      : '<p class="empty-note">' + (refFiltered ? '이 과정에 연결된 글이 없습니다.' : CFG.empty) + '</p>';

    const boardHint = CFG.hint ? '<div class="rules-banner">' + escT(CFG.hint) + '</div>' : '';
    panel.innerHTML = boardHint + refHead + writeBlock() + sinceHtml + list;
    bindWrite(me, CFG.type);
    const fs = document.getElementById('fSince');
    if (fs) fs.addEventListener('change', () => {
      const q = P();
      if (fs.value) q.set('since', fs.value); else q.delete('since');
      location.search = q.toString();
    });
  }

  function bindWrite(me, boardType) {
    const form = document.getElementById('writeForm');
    if (!form) return;
    const openBtn = document.getElementById('writeOpen');
    if (openBtn) openBtn.addEventListener('click', (e) => {
      form.hidden = false; e.target.hidden = true; document.getElementById('wTitle').focus();
    });
    document.getElementById('writeCancel').addEventListener('click', () => {
      form.hidden = true; if (openBtn) openBtn.hidden = false;
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ref = refParam();
      const anon = document.getElementById('wAnon');
      const preset = FORM_PRESETS[formKey()] || null;
      const title = document.getElementById('wTitle').value.trim();
      const body = document.getElementById('wBody').value.trim();
      // 최소 글자 수로 막지 않는다 (짧은 질문 환영). 공백만 있는 글만 거른다.
      if (!title || !body) { alert('제목과 내용을 적어 주세요.'); return; }
      const row = { board_type: boardType, author_id: me.user.id, title: title, body: body };
      if (C().anonymousReady()) {
        row.is_anonymous = !!(anon && anon.checked);
        if (ref) { row.ref_type = ref.type; row.ref_id = ref.id; }
        if (preset && preset.kind) row.review_kind = preset.kind;   // null 이면 넣지 않는다
        // 후기 선택 입력 — 비어 있으면 넣지 않는다. 금액이 없다고 막지 않는다.
        if (preset && preset.kind === 'review') {
          const cost = document.getElementById('rCost');
          const subsidy = document.getElementById('rSubsidy');
          const month = document.getElementById('rMonth');
          const c = cost && cost.value.trim();
          if (c !== '' && c != null && Number.isFinite(Number(c))) row.review_cost = Math.round(Number(c));
          if (subsidy && subsidy.value) row.review_subsidy = subsidy.value;
          if (month && /^\d{4}-\d{2}$/.test(month.value)) row.review_done_month = month.value;
        }
      }
      const { error: err } = await db().from('posts').insert(row);
      if (err) { alert('등록하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(err); return; }
      location.href = listUrl();
    });
  }

  // 본인 글 수정 — RLS가 author_id로 판정하므로 클라이언트가 작성자 id를 몰라도 동작한다
  function editForm(post) {
    return '<form class="write-form" id="editForm" hidden>'
      + '<label class="write-hint" for="eTitle">제목 수정</label>'
      + '<input type="text" id="eTitle" maxlength="80" required value="' + escT(post.title) + '">'
      + '<label class="write-hint" for="eBody">내용 수정</label>'
      + '<textarea id="eBody" maxlength="4000" required>' + escT(post.body) + '</textarea>'
      + '<div class="form-actions"><button type="button" class="btn-ghost" id="editCancel">취소</button>'
      + '<button type="submit" class="btn-primary">수정 저장</button></div></form>';
  }
  function bindEdit(id) {
    const form = document.getElementById('editForm');
    if (!form) return;
    const open = document.getElementById('editPost');
    if (open) open.addEventListener('click', () => { form.hidden = !form.hidden; });
    document.getElementById('editCancel').addEventListener('click', () => { form.hidden = true; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = document.getElementById('eTitle').value.trim();
      const b = document.getElementById('eBody').value.trim();
      if (!t || !b) { alert('제목과 내용을 적어 주세요.'); return; }
      const { error } = await db().from('posts').update({
        title: t, body: b, updated_at: new Date().toISOString()
      }).eq('id', id);
      if (error) { alert('수정하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(error); return; }
      location.reload();
    });
  }

  async function renderDetail(me, id) {
    const [r, { data: cmts }, { data: likes }] = await Promise.all([
      C().readPosts((q) => q.eq('id', id).eq('board_type', CFG.type), me.user.id),   // 다른 게시판 글은 이 화면에서 열지 않는다
      db().from('comments').select('id,body,created_at,author_id,author:profiles(' + C().authorSelect() + ')').eq('post_id', id).order('created_at'),
      db().from('votes').select('user_id').eq('post_id', id).eq('vote', 'up')
    ]);
    const post = r.rows && r.rows[0];
    if (r.error || !post) { gate('글을 찾을 수 없습니다. <br><br><a class="back-link" href="' + escT(listUrl()) + '">← 목록으로</a>'); return; }
    if (!sessionStorage.getItem('viewed_f' + id)) {
      sessionStorage.setItem('viewed_f' + id, '1');
      db().rpc('increment_post_view', { p_post_id: Number(id) }).then(() => {}, () => {});
    }
    const likeCount = (likes || []).length;
    const iLiked = (likes || []).some((v) => v.user_id === me.user.id);
    const mine = !!post.is_mine;

    const cmtHtml = (cmts || []).map((c) =>
      '<div class="cmt"><span class="author-line">' + C().authorBadge(c.author)
      + ' <time style="color:var(--c-ink-faint);font-size:11.5px">' + C().timeAgo(c.created_at) + '</time></span>'
      + '<div class="cmt-body">' + escT(C().maskContacts(c.body)) + '</div>'
      + '<div class="post-tools">'
      + (c.author_id === me.user.id
        ? '<button type="button" class="tool-link" data-del-cmt="' + c.id + '">삭제</button>'
        : '<button type="button" class="tool-link" data-report-cmt="' + c.id + '">신고</button>')
      + '</div></div>').join('');

    const reviewFacts = post.review_kind === 'review'
      ? '<div class="card-meta-line"><span class="author-line">'
        + [post.review_done_month ? post.review_done_month.replace('-', '.') + ' 수료' : '수료 시점 미기재',
           post.review_cost != null ? Number(post.review_cost).toLocaleString('ko-KR') + '원' : '지출 금액 미기재',
           C().subsidyLabel(post.review_subsidy)]
          .filter(Boolean).map((f) => '<span class="field-badge">' + escT(f) + '</span>').join(' ')
        + '</span></div>'
      : '';
    const refLink = post.ref_type === 'edu' && post.ref_id
      ? '<div class="card-meta-line"><a class="btn-line" href="/edu/?id=' + encodeURIComponent(post.ref_id) + '">연결된 교육 과정 보기</a></div>'
      : '';

    panel.innerHTML =
      '<a class="back-link" href="' + escT(listUrl()) + '">← 목록으로</a>'
      + '<article class="board-card"><h2 style="font-size:19px">' + escT(post.title) + '</h2>'
      + '<div class="card-meta-line"><span class="author-line">' + C().authorBadgeOf(post) + '</span>'
      + '<span><span class="view-count">조회 ' + ((post.view_count || 0) + 1) + '</span> <time style="color:var(--c-ink-faint);font-size:12px">' + C().timeAgo(post.created_at) + '</time></span></div>'
      + (post.closed_at ? '<div class="card-meta-line"><span class="field-badge">마감된 글</span></div>' : '')
      + reviewFacts + refLink
      + '<div class="post-body">' + escT(C().maskContacts(post.body)) + '</div>'
      + '<div class="vote-row"><button type="button" class="like-btn' + (iLiked ? ' on' : '') + '" id="likeBtn"><svg width=\'13\' height=\'13\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\' style=\'vertical-align:-2px\' aria-hidden=\'true\'><path d=\'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z\'/></svg> 공감 ' + likeCount + '</button></div>'
      + '<div class="post-tools">'
      + (mine
        ? '<button type="button" class="tool-link" id="editPost">수정</button>'
          + (post.board_type === 'job_offer' || post.board_type === 'job_seek'
            ? '<button type="button" class="tool-link" id="closePost">'
              + (post.closed_at ? '마감 해제' : '마감') + '</button>' : '')
          + '<button type="button" class="tool-link" id="delPost">삭제</button>'
        : '<button type="button" class="tool-link" id="repPost">신고</button>')
      + '</div>'
      + (mine ? editForm(post) : '')
      + '</article>'
      + '<section class="board-card"><b style="font-size:14px">댓글 ' + (cmts || []).length + '</b>'
      + cmtHtml
      + '<form class="cmt-form" id="cmtForm">'
      + '<input type="text" id="cmtBody" placeholder="댓글 남기기" maxlength="2000" required aria-label="댓글 입력">'
      + '<button type="submit">등록</button></form></section>';

    bindEdit(id);
    document.getElementById('likeBtn').addEventListener('click', async () => {
      const { error: e1 } = iLiked
        ? await db().from('votes').delete().eq('post_id', id).eq('user_id', me.user.id)
        : await db().from('votes').upsert({ post_id: Number(id), user_id: me.user.id, vote: 'up' }, { onConflict: 'post_id,user_id' });
      if (e1) { alert('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(e1); return; }
      location.reload();
    });
    const del = document.getElementById('delPost');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('글을 삭제할까요?')) return;
      const { error: delErr } = await db().from('posts').delete().eq('id', id);
      if (delErr) { alert('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(delErr); return; }
      location.href = listUrl();
    });
    const closeBtn = document.getElementById('closePost');
    if (closeBtn) closeBtn.addEventListener('click', async () => {
      // 글을 지우지 않고 마감만 표시한다 — 기록은 남는다.
      const { error: cErr } = await db().from('posts')
        .update({ closed_at: post.closed_at ? null : new Date().toISOString() }).eq('id', id);
      if (cErr) { alert('마감 표시를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(cErr); return; }
      location.reload();
    });
    const rep = document.getElementById('repPost');
    if (rep) rep.addEventListener('click', () => C().report('post', post.id));
    panel.querySelectorAll('[data-report-cmt]').forEach((b) =>
      b.addEventListener('click', () => C().report('comment', Number(b.dataset.reportCmt))));
    panel.querySelectorAll('[data-del-cmt]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('댓글을 삭제할까요?')) return;
        const { error: cdErr } = await db().from('comments').delete().eq('id', Number(b.dataset.delCmt));
        if (cdErr) { alert('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(cdErr); return; }
        location.reload();
      }));
    document.getElementById('cmtForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const cb = document.getElementById('cmtBody').value.trim();
      if (!cb) { alert('댓글 내용을 적어 주세요.'); return; }
      const { error: err } = await db().from('comments').insert({
        post_id: Number(id), author_id: me.user.id, body: cb
      });
      if (err) { alert('등록하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(err); return; }
      location.reload();
    });
  }

  addEventListener('DOMContentLoaded', async () => {
    const me = await ainCommunity.requireMember();
    if (me.redirecting) return;
    if (me.infraError) { gate('게시판 준비 중입니다. 잠시 후 다시 확인해 주세요.'); return; }
    // 비회원 티저는 자유게시판에서만 글 제목을 보여 준다. 구인·구직에서 게시판 글이 보이면 구인 글로 오해한다.
    if (!me.user) { teaserRender(CFG.type === 'free' ? await ainCommunity.fetchTeaser() : []); return; }
    const id = qsId();
    id ? renderDetail(me, id) : renderList(me);
  });
})();
