// 자유게시판 — 목록·글쓰기·상세·댓글. 회원 전용(비회원 티저).
(function () {
  'use strict';
  const panel = document.getElementById('panel');
  const db = () => ainAuth.getClient();
  const C = () => window.ainCommunity;
  const qsId = () => new URLSearchParams(location.search).get('id');

  function gate(html) { panel.innerHTML = '<div class="gate-msg">' + html + '</div>'; }

  function teaserRender(rows) {
    const items = (rows || []).map((r) =>
      '<div class="board-card board-teaser-blur"><h2>' + escT(r.title) + '</h2>'
      + '<div class="card-meta-line"><time>' + C().timeAgo(r.created_at) + '</time></div></div>').join('');
    const total = rows && rows.length ? rows[0].total_count : 0;
    panel.innerHTML =
      '<div class="gate-msg"><b>게시글 ' + total + '개</b> — 게시판은 에인연 회원 전용입니다.<br>'
      + '읽기·쓰기 모두 카카오 3초 로그인이면 충분합니다.<br>'
      + '<button type="button" class="gate-cta" id="gateLogin">카카오 3초 로그인</button></div>'
      + items;
    document.getElementById('gateLogin').addEventListener('click', () => {
      ainAuth.getClient().auth.signInWithOAuth({
        provider: 'kakao', options: { redirectTo: location.origin + location.pathname }
      });
    });
  }

  async function renderList(me) {
    const { data, error } = await db().from('posts')
      .select('id,title,created_at,view_count,author:profiles(' + C().authorSelect() + '),comments(count)')
      .eq('board_type', 'free')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { gate('게시판 준비 중입니다. 잠시 후 다시 확인해 주세요.'); console.warn(error); return; }
    // 공감 수 집계
    const ids = (data || []).map((p) => p.id);
    let likeMap = {};
    if (ids.length) {
      const { data: likes } = await db().from('votes').select('post_id').in('post_id', ids).eq('vote', 'up');
      (likes || []).forEach((v) => { likeMap[v.post_id] = (likeMap[v.post_id] || 0) + 1; });
    }

    const writeBlock =
      '<button type="button" class="write-btn" id="writeOpen">글쓰기</button>'
      + '<form class="write-form" id="writeForm" hidden>'
      + '<input type="text" id="wTitle" placeholder="제목 (2~80자)" maxlength="80" required>'
      + '<textarea id="wBody" placeholder="내용" maxlength="4000" required></textarea>'
      + '<div class="form-actions"><button type="button" class="btn-ghost" id="writeCancel">취소</button>'
      + '<button type="submit" class="btn-primary">등록</button></div></form>';

    const list = data.length ? data.map((p) =>
      '<a class="board-card' + (C().isStaff(p.author) ? ' staff-accent' : '') + '" href="?id=' + p.id + '"><h2>' + escT(p.title) + '</h2>'
      + '<div class="card-meta-line"><span class="author-line">' + C().authorBadge(p.author) + '</span>'
      + '<span><span class="cmt-count">공감 ' + (likeMap[p.id] || 0) + ' · 댓글 ' + ((p.comments && p.comments[0] && p.comments[0].count) || 0) + ' · 조회 ' + (p.view_count || 0) + '</span>'
      + ' · <time>' + C().timeAgo(p.created_at) + '</time></span></div></a>').join('')
      : '<p class="empty-note">첫 글의 주인공이 되어 주세요.</p>';

    panel.innerHTML = writeBlock + list;

    const form = document.getElementById('writeForm');
    document.getElementById('writeOpen').addEventListener('click', (e) => {
      form.hidden = false; e.target.hidden = true; document.getElementById('wTitle').focus();
    });
    document.getElementById('writeCancel').addEventListener('click', () => {
      form.hidden = true; document.getElementById('writeOpen').hidden = false;
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error: err } = await db().from('posts').insert({
        board_type: 'free', author_id: me.user.id,
        title: document.getElementById('wTitle').value.trim(),
        body: document.getElementById('wBody').value.trim()
      });
      if (err) { alert('등록 실패: ' + err.message); return; }
      location.reload();
    });
  }

  async function renderDetail(me, id) {
    const [{ data: post, error }, { data: cmts }, { data: likes }] = await Promise.all([
      db().from('posts').select('id,title,body,created_at,view_count,author_id,author:profiles(' + C().authorSelect() + ')').eq('id', id).maybeSingle(),
      db().from('comments').select('id,body,created_at,author_id,author:profiles(' + C().authorSelect() + ')').eq('post_id', id).order('created_at'),
      db().from('votes').select('user_id').eq('post_id', id).eq('vote', 'up')
    ]);
    if (error || !post) { gate('글을 찾을 수 없습니다. <br><br><a class="back-link" href="./">← 목록으로</a>'); return; }
    if (!sessionStorage.getItem('viewed_f' + id)) {
      sessionStorage.setItem('viewed_f' + id, '1');
      db().rpc('increment_post_view', { p_post_id: Number(id) }).then(() => {}, () => {});
    }
    const likeCount = (likes || []).length;
    const iLiked = (likes || []).some((v) => v.user_id === me.user.id);

    const mine = post.author_id === me.user.id;
    const cmtHtml = (cmts || []).map((c) =>
      '<div class="cmt"><span class="author-line">' + C().authorBadge(c.author)
      + ' <time style="color:var(--txt3);font-size:11.5px">' + C().timeAgo(c.created_at) + '</time></span>'
      + '<div class="cmt-body">' + escT(c.body) + '</div>'
      + '<div class="post-tools">'
      + (c.author_id === me.user.id
        ? '<button type="button" class="tool-link" data-del-cmt="' + c.id + '">삭제</button>'
        : '<button type="button" class="tool-link" data-report-cmt="' + c.id + '">신고</button>')
      + '</div></div>').join('');

    panel.innerHTML =
      '<a class="back-link" href="./">← 목록으로</a>'
      + '<article class="board-card"><h2 style="font-size:19px">' + escT(post.title) + '</h2>'
      + '<div class="card-meta-line"><span class="author-line">' + C().authorBadge(post.author) + '</span>'
      + '<span><span class="view-count">조회 ' + ((post.view_count || 0) + 1) + '</span> <time style="color:var(--txt3);font-size:12px">' + C().timeAgo(post.created_at) + '</time></span></div>'
      + '<div class="post-body">' + escT(post.body) + '</div>'
      + '<div class="vote-row"><button type="button" class="like-btn' + (iLiked ? ' on' : '') + '" id="likeBtn">❤️ 공감 ' + likeCount + '</button></div>'
      + '<div class="post-tools">'
      + (mine ? '<button type="button" class="tool-link" id="delPost">글 삭제</button>'
              : '<button type="button" class="tool-link" id="repPost">신고</button>')
      + '</div></article>'
      + '<section class="board-card"><b style="font-size:14px">댓글 ' + (cmts || []).length + '</b>'
      + cmtHtml
      + '<form class="cmt-form" id="cmtForm">'
      + '<input type="text" id="cmtBody" placeholder="댓글 남기기" maxlength="2000" required aria-label="댓글 입력">'
      + '<button type="submit">등록</button></form></section>';

    document.getElementById('likeBtn').addEventListener('click', async () => {
      const { error: e1 } = iLiked
        ? await db().from('votes').delete().eq('post_id', id).eq('user_id', me.user.id)
        : await db().from('votes').upsert({ post_id: Number(id), user_id: me.user.id, vote: 'up' }, { onConflict: 'post_id,user_id' });
      if (e1) { alert('처리 실패: ' + e1.message); return; }
      location.reload();
    });
    const del = document.getElementById('delPost');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('글을 삭제할까요?')) return;
      await db().from('posts').delete().eq('id', id);
      location.href = './';
    });
    const rep = document.getElementById('repPost');
    if (rep) rep.addEventListener('click', () => C().report('post', post.id));
    panel.querySelectorAll('[data-report-cmt]').forEach((b) =>
      b.addEventListener('click', () => C().report('comment', Number(b.dataset.reportCmt))));
    panel.querySelectorAll('[data-del-cmt]').forEach((b) =>
      b.addEventListener('click', async () => {
        if (!confirm('댓글을 삭제할까요?')) return;
        await db().from('comments').delete().eq('id', Number(b.dataset.delCmt));
        location.reload();
      }));
    document.getElementById('cmtForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error: err } = await db().from('comments').insert({
        post_id: Number(id), author_id: me.user.id,
        body: document.getElementById('cmtBody').value.trim()
      });
      if (err) { alert('등록 실패: ' + err.message); return; }
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
