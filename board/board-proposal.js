// 제안·건의 게시판 — 찬반 투표(1인 1표, upsert 변경), 채택 임계 하이라이트.
(function () {
  'use strict';
  // 표 수는 우선순위를 보는 신호일 뿐 개발 약속이 아니다 (SPEC ②).
  // 임계 상수는 목록 하이라이트에만 쓰고, 화면 문구에 수치를 약속처럼 적지 않는다.
  const THRESHOLD_COUNT = 20;
  const THRESHOLD_RATE = 0.7;
  // 작성자 본인 삭제는 A8 완료 기준이라 09의 5표 삭제 잠금을 뺐다 (supabase/15_launch.sql [B]).

  // 기존 4상태 유지 + 보류/안 함만 추가 (개발중을 검토중에 합치지 않는다)
  const STATUS_LABELS = {
    open: '투표중', adopted: '채택됨', building: '개발중', shipped: '반영완료',
    held: '보류', declined: '안 함'
  };
  const panel = document.getElementById('panel');
  const db = () => ainAuth.getClient();
  const C = () => window.ainCommunity;
  const qsId = () => new URLSearchParams(location.search).get('id');
  let sortMode = 'votes'; // 'votes' | 'recent'

  function gate(html) { panel.innerHTML = '<div class="gate-msg">' + html + '</div>'; }
  // 느린 폰에서 두 번 눌러 같은 제안·의견이 두 번 올라가지 않게 — 처리 중에는 제출 버튼을 잠근다
  function lockSubmit(form, e) {
    const b = (e && e.submitter) || (form && form.querySelector ? form.querySelector('[type=submit]') : null);
    if (!b) return () => {};
    if (b.disabled) return null;
    b.disabled = true;
    return () => { b.disabled = false; };
  }

  function rulesBanner() {
    return '<div class="rules-banner">투표 결과는 검토 우선순위에 참고합니다. '
      + '표가 많다고 자동으로 개발되지는 않습니다. 진행 상황은 각 제안의 상태로 표시합니다.<br>'
      + '상태: 투표중 · 채택됨 · 개발중 · 반영완료 · 보류(이유) · 안 함(이유)</div>';
  }

  function teaserRender(rows) {
    // 티저 뷰는 자유게시판·제안 글을 섞어 준다 — 제안만 보여 주고, 섞인 합계는 적지 않는다
    const items = (rows || []).filter((r) => r.board_type === 'proposal').map((r) =>
      '<div class="board-card board-teaser-blur" aria-hidden="true"><h2>' + escT(r.title) + '</h2>'
      + '<div class="card-meta-line"><span class="status-badge status-' + escT(r.status) + '">'
      + (STATUS_LABELS[r.status] || r.status) + '</span>'
      + '<time>' + C().timeAgo(r.created_at) + '</time></div></div>').join('');
    panel.innerHTML = rulesBanner()
      + '<div class="gate-msg"><b>회원 전용입니다</b><br>'
      + (qsId() ? '이 제안은 회원만 볼 수 있습니다. 로그인하면 바로 열립니다.<br>' : '')
      + '카카오 계정으로 로그인하면 제안과 투표를 할 수 있습니다. 처음이면 닉네임과 주력분야만 정하면 됩니다.<br>'
      + '<button type="button" class="gate-cta" id="gateLogin">카카오 로그인</button></div>'
      + items;
    document.getElementById('gateLogin').addEventListener('click', () => C().loginWithKakao());
  }

  // 투표 집계: votes 전체(회원 select) → {postId: {up, down, mine}}
  function tally(votes, myId) {
    const m = {};
    for (const v of votes || []) {
      const t = m[v.post_id] || (m[v.post_id] = { up: 0, down: 0, mine: null });
      t[v.vote]++;
      if (v.user_id === myId) t.mine = v.vote;
    }
    return m;
  }
  function reached(t) {
    const total = t.up + t.down;
    return t.up >= THRESHOLD_COUNT && total > 0 && t.up / total >= THRESHOLD_RATE;
  }

  // 제안 → 답변 → 진행 → 결과가 한 줄로 이어지게 (SPEC §6.2 / §6.3)
  function statusBlock(p) {
    const reason = p.status_reason
      ? '<div class="status-reason"><b>' + escT(STATUS_LABELS[p.status] || p.status) + ' 이유</b>'
        + escT(p.status_reason) + '</div>' : '';
    const answer = p.admin_answer
      ? '<div class="admin-answer"><b>운영자 답변</b>' + escT(p.admin_answer)
        + (p.admin_answered_at ? ' <time>' + C().timeAgo(p.admin_answered_at) + '</time>' : '')
        + '</div>' : '';
    return reason + answer;
  }

  function voteRowHtml(postId, t) {
    const total = t.up + t.down;
    const rate = total ? Math.round((t.up / total) * 100) : 0;
    return '<div class="vote-row">'
      + '<button type="button" class="vote-btn up' + (t.mine === 'up' ? ' on' : '') + '" data-vote="up" data-post="' + postId + '" data-mine="' + (t.mine || '') + '" aria-pressed="' + (t.mine === 'up') + '"><svg width=\'13\' height=\'13\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\' style=\'vertical-align:-2px\' aria-hidden=\'true\'><path d=\'M7 10v12\'/><path d=\'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z\'/></svg> 찬성 ' + t.up + '</button>'
      + '<button type="button" class="vote-btn down' + (t.mine === 'down' ? ' on' : '') + '" data-vote="down" data-post="' + postId + '" data-mine="' + (t.mine || '') + '" aria-pressed="' + (t.mine === 'down') + '"><svg width=\'13\' height=\'13\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\' style=\'vertical-align:-2px\' aria-hidden=\'true\'><path d=\'M17 14V2\'/><path d=\'M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z\'/></svg> 반대 ' + t.down + '</button>'
      + (reached(t) ? '<span class="reach-note">채택 기준 도달</span>' : '')
      + '</div>'
      + '<div class="rate-wrap"><div class="rate-bar"><div class="rate-fill" style="width:' + rate + '%"></div></div>'
      + '<div class="rate-label"><span>찬성률 ' + rate + '%</span><span>' + total + '명 참여</span></div></div>';
  }

  async function castVote(me, postId, vote, mine) {
    // 이미 누른 쪽을 다시 누르면 투표를 거둔다 (자유게시판 공감과 같은 동작)
    const { error } = mine === vote
      ? await db().from('votes').delete().eq('post_id', Number(postId)).eq('user_id', me.user.id)
      : await db().from('votes').upsert(
        { post_id: Number(postId), user_id: me.user.id, vote },
        { onConflict: 'post_id,user_id' }
      );
    if (error) { alert('투표하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(error); return; }
    location.reload();
  }
  function bindVotes(me) {
    panel.querySelectorAll('[data-vote]').forEach((b) =>
      b.addEventListener('click', () => castVote(me, b.dataset.post, b.dataset.vote, b.dataset.mine)));
  }

  async function fetchAll(myId) {
    const [r, { data: votes }] = await Promise.all([
      C().readPosts((q) => q.eq('board_type', 'proposal').order('created_at', { ascending: false }).limit(100), myId),   // 최신 100건
      db().from('votes').select('post_id,user_id,vote')
    ]);
    return { posts: r.rows, votes, error: r.error };
  }

  async function renderList(me) {
    const { posts, votes, error } = await fetchAll(me.user.id);
    if (error) { gate('게시판 준비 중입니다. 잠시 후 다시 확인해 주세요.'); console.warn(error); return; }
    const t = tally(votes, me.user.id);
    const get = (id) => t[id] || { up: 0, down: 0, mine: null };

    const sorted = [...posts].sort((a, b) => sortMode === 'votes'
      ? get(b.id).up - get(a.id).up || new Date(b.created_at) - new Date(a.created_at)
      : new Date(b.created_at) - new Date(a.created_at));

    const writeBlock =
      '<button type="button" class="write-btn" id="writeOpen" aria-controls="writeForm" aria-expanded="false">제안 쓰기</button>'
      + '<form class="write-form" id="writeForm" hidden>'
      + '<label class="write-hint" for="wTitle">제안 제목</label>'
      + '<input type="text" id="wTitle" placeholder="예: 세척 단가표 지역별 공유" maxlength="80" required>'
      + '<label class="write-hint" for="wBody">내용</label>'
      + '<textarea id="wBody" placeholder="어떤 기능이 왜 필요한지" maxlength="4000" required></textarea>'
      + (C().anonymousReady()
        ? '<label class="anon-row"><input type="checkbox" id="wAnon"><span>익명으로 작성 (닉네임·분야 숨김). '
          + '운영자는 중복·악용 확인 목적으로만 작성자를 확인할 수 있습니다.</span></label>' : '')
      + '<div class="form-actions"><button type="button" class="btn-ghost" id="writeCancel">취소</button>'
      + '<button type="submit" class="btn-primary">등록</button></div></form>';

    const sortBlock = '<div class="sort-toggle" role="group" aria-label="정렬">'
      + '<button type="button" id="sortVotes" class="' + (sortMode === 'votes' ? 'on' : '') + '" aria-pressed="' + (sortMode === 'votes') + '">찬성순</button>'
      + '<button type="button" id="sortRecent" class="' + (sortMode === 'recent' ? 'on' : '') + '" aria-pressed="' + (sortMode === 'recent') + '">최신순</button></div>';

    const cards = sorted.length ? sorted.map((p) => {
      const tv = get(p.id);
      return '<article class="board-card' + (reached(tv) && p.status === 'open' ? ' reach-highlight' : '') + (C().isStaff(p.author) ? ' staff-accent' : '') + '">'
        + '<a href="?id=' + p.id + '"><h2>' + escT(p.title) + '</h2></a>'
        + '<div class="card-meta-line"><span class="author-line">' + C().authorBadgeOf(p) + '</span>'
        + '<span><span class="view-count">조회 ' + (p.view_count || 0) + '</span> <span class="status-badge status-' + escT(p.status) + '">' + (STATUS_LABELS[p.status] || p.status) + '</span></span></div>'
        + statusBlock(p) + voteRowHtml(p.id, tv) + '</article>';
    }).join('') : '<p class="empty-note">등록된 제안이 없습니다.</p>';

    panel.innerHTML = rulesBanner() + writeBlock + sortBlock + cards;
    bindVotes(me);

    const form = document.getElementById('writeForm');
    const openBtn = document.getElementById('writeOpen');
    openBtn.addEventListener('click', () => {
      form.hidden = false; openBtn.hidden = true; openBtn.setAttribute('aria-expanded', 'true');
      document.getElementById('wTitle').focus();
    });
    document.getElementById('writeCancel').addEventListener('click', () => {
      form.hidden = true; openBtn.hidden = false; openBtn.setAttribute('aria-expanded', 'false'); openBtn.focus();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const unlock = lockSubmit(form, e);
      if (!unlock) return;
      const title = document.getElementById('wTitle').value.trim();
      const body = document.getElementById('wBody').value.trim();
      // 짧은 제안도 막지 않는다. 공백만 있는 글만 거른다 (DB 제약과 같은 규칙).
      if (!title || !body) { unlock(); alert('제목과 내용을 적어 주세요.'); return; }
      const row = { board_type: 'proposal', author_id: me.user.id, title: title, body: body };
      const anon = document.getElementById('wAnon');
      if (C().anonymousReady()) row.is_anonymous = !!(anon && anon.checked);
      const { error: err } = await db().from('posts').insert(row);
      if (err) { unlock(); alert('등록하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(err); return; }
      location.reload();
    });
    // 정렬을 바꾸면 목록을 다시 그린다 — 누른 버튼에 포커스를 돌려준다
    document.getElementById('sortVotes').addEventListener('click', async () => { sortMode = 'votes'; await renderList(me); document.getElementById('sortVotes').focus(); });
    document.getElementById('sortRecent').addEventListener('click', async () => { sortMode = 'recent'; await renderList(me); document.getElementById('sortRecent').focus(); });
  }

  async function renderDetail(me, id) {
    const [r, { data: votes }, { data: cmts }] = await Promise.all([
      C().readPosts((q) => q.eq('id', id).eq('board_type', 'proposal'), me.user.id),
      db().from('votes').select('post_id,user_id,vote').eq('post_id', id),
      db().from('comments').select('id,body,created_at,author_id,author:profiles(' + C().authorSelect() + ')').eq('post_id', id).order('created_at')
    ]);
    const post = r.rows && r.rows[0];
    const error = r.error;
    if (error || !post) { gate('글을 찾을 수 없습니다. <br><br><a class="back-link" href="./">← 목록으로</a>'); return; }
    // 조회수: 세션당 1회 증가 (RPC 미생성이어도 무시)
    if (!sessionStorage.getItem('viewed_p' + id)) {
      sessionStorage.setItem('viewed_p' + id, '1');
      db().rpc('increment_post_view', { p_post_id: Number(id) }).then(() => {}, () => {});
    }
    const tv = tally(votes, me.user.id)[post.id] || { up: 0, down: 0, mine: null };
    const mine = !!post.is_mine;

    // 의견도 자유게시판 댓글과 같게: 본인은 삭제, 다른 사람 의견은 신고, 연락처는 가려서 보여 준다
    const cmtHtml = (cmts || []).map((c) =>
      '<div class="cmt"><span class="author-line">' + C().authorBadge(c.author)
      + ' <time style="color:var(--c-ink-faint);font-size:var(--fs-4)">' + C().timeAgo(c.created_at) + '</time></span>'
      + '<div class="cmt-body">' + escT(C().maskContacts(c.body)) + '</div>'
      + '<div class="post-tools">' + (c.author_id === me.user.id
        ? '<button type="button" class="tool-link" data-del-cmt="' + c.id + '">삭제</button>'
        : '<button type="button" class="tool-link" data-report-cmt="' + c.id + '">신고</button>') + '</div></div>').join('');

    panel.innerHTML =
      '<a class="back-link" href="./">← 목록으로</a>'
      + '<article class="board-card' + (reached(tv) && post.status === 'open' ? ' reach-highlight' : '') + '">'
      + '<div class="card-meta-line" style="margin:0 0 8px"><span class="status-badge status-' + escT(post.status) + '">'
      + (STATUS_LABELS[post.status] || post.status) + '</span>'
      + '<span><span class="view-count">조회 ' + ((post.view_count || 0) + 1) + '</span> <time style="color:var(--c-ink-faint);font-size:var(--fs-4)">' + C().timeAgo(post.created_at) + '</time></span></div>'
      + '<h2 style="font-size:var(--fs-1)">' + escT(post.title) + '</h2>'
      + '<div class="card-meta-line"><span class="author-line">' + C().authorBadgeOf(post) + '</span></div>'
      + '<div class="post-body">' + escT(C().maskContacts(post.body)) + '</div>'
      + statusBlock(post)
      + voteRowHtml(post.id, tv)
      + '<div class="post-tools">'
      + (mine
        ? '<button type="button" class="tool-link" id="editPost">수정</button>'
          + '<button type="button" class="tool-link" id="delPost">삭제</button>'
        : '<button type="button" class="tool-link" id="repPost">신고</button>')
      + '</div>'
      + (mine ? '<form class="write-form" id="editForm" hidden>'
          + '<label class="write-hint" for="eTitle">제목 수정</label>'
          + '<input type="text" id="eTitle" maxlength="80" required value="' + escT(post.title) + '">'
          + '<label class="write-hint" for="eBody">내용 수정</label>'
          + '<textarea id="eBody" maxlength="4000" required>' + escT(post.body) + '</textarea>'
          + '<div class="form-actions"><button type="button" class="btn-ghost" id="editCancel">취소</button>'
          + '<button type="submit" class="btn-primary">수정 저장</button></div></form>' : '')
      + '</article>'
      + '<section class="board-card"><b style="font-size:var(--fs-2)">의견 ' + (cmts || []).length + '</b>'
      + cmtHtml
      + '<form class="cmt-form" id="cmtForm">'
      + '<input type="text" id="cmtBody" placeholder="의견 남기기" maxlength="2000" required aria-label="의견 입력">'
      + '<button type="submit">등록</button></form></section>';

    bindVotes(me);
    const editBtn = document.getElementById('editPost');
    const editForm = document.getElementById('editForm');
    if (editBtn && editForm) {
      editBtn.addEventListener('click', () => { editForm.hidden = !editForm.hidden; });
      document.getElementById('editCancel').addEventListener('click', () => { editForm.hidden = true; });
      editForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const unlock = lockSubmit(editForm, ev);
        if (!unlock) return;
        const t = document.getElementById('eTitle').value.trim();
        const b = document.getElementById('eBody').value.trim();
        if (!t || !b) { unlock(); alert('제목과 내용을 적어 주세요.'); return; }
        const { error: eErr } = await db().from('posts').update({
          title: t, body: b, updated_at: new Date().toISOString()
        }).eq('id', id);
        if (eErr) { unlock(); alert('수정하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(eErr); return; }
        location.reload();
      });
    }
    const del = document.getElementById('delPost');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('제안을 삭제할까요? 투표 기록도 함께 삭제됩니다.')) return;
      const { error: delErr } = await db().from('posts').delete().eq('id', id);
      if (delErr) { alert('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(delErr); return; }
      location.href = './';
    });
    const rep = document.getElementById('repPost');
    if (rep) rep.addEventListener('click', () => C().report('post', post.id));
    panel.querySelectorAll('[data-report-cmt]').forEach((b) =>
      b.addEventListener('click', () => C().report('comment', Number(b.dataset.reportCmt))));
    panel.querySelectorAll('[data-del-cmt]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('의견을 삭제할까요?')) return;
        const { error: cdErr } = await db().from('comments').delete().eq('id', Number(b.dataset.delCmt));
        if (cdErr) { alert('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(cdErr); return; }
        location.reload();
      }));
    document.getElementById('cmtForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const unlock = lockSubmit(form, e);
      if (!unlock) return;
      const cb = document.getElementById('cmtBody').value.trim();
      if (!cb) { unlock(); alert('의견 내용을 적어 주세요.'); return; }
      const { error: err } = await db().from('comments').insert({
        post_id: Number(id), author_id: me.user.id, body: cb
      });
      if (err) { unlock(); alert('등록하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(err); return; }
      location.reload();
    });
  }

  addEventListener('DOMContentLoaded', async () => {
    const me = await ainCommunity.requireMember();
    if (me.redirecting) return;
    if (me.infraError) { gate('게시판 준비 중입니다. 잠시 후 다시 확인해 주세요.'); return; }
    if (!me.user) { teaserRender(await ainCommunity.fetchTeaser()); return; }
    const id = qsId();
    id ? renderDetail(me, id) : renderList(me);
  });
})();
