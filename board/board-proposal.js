// 제안·투표 게시판 — 찬반 투표(1인 1표, upsert 변경), 채택 임계 하이라이트.
(function () {
  'use strict';
  // 채택 이중조건 — 회원 규모에 따라 조정 (규칙 배너에도 이 값이 찍힘)
  const THRESHOLD_COUNT = 20;   // 찬성 최소 인원
  const THRESHOLD_RATE = 0.7;   // 찬성률
  const DELETE_LOCK_VOTES = 5;  // 이 수 이상 투표가 모인 제안은 작성자 삭제 불가 (sql/09 정책과 쌍)

  const STATUS_LABELS = { open: '투표중', adopted: '채택됨', building: '개발중', shipped: '반영완료' };
  const panel = document.getElementById('panel');
  const db = () => ainAuth.getClient();
  const C = () => window.ainCommunity;
  const qsId = () => new URLSearchParams(location.search).get('id');
  let sortMode = 'votes'; // 'votes' | 'recent'

  function gate(html) { panel.innerHTML = '<div class="gate-msg">' + html + '</div>'; }

  function rulesBanner() {
    return '<div class="rules-banner">채택 규칙 — 찬성 <b>' + THRESHOLD_COUNT + '명 이상</b> + 찬성률 <b>'
      + Math.round(THRESHOLD_RATE * 100) + '% 이상</b> 도달 시 검토 후 채택됩니다. '
      + '상태: 투표중 → 채택됨 → 개발중 → 반영완료</div>';
  }

  function teaserRender(rows) {
    const items = (rows || []).map((r) =>
      '<div class="board-card board-teaser-blur"><h2>' + escT(r.title) + '</h2>'
      + '<div class="card-meta-line"><span class="status-badge status-' + escT(r.status) + '">'
      + (STATUS_LABELS[r.status] || r.status) + '</span>'
      + '<time>' + C().timeAgo(r.created_at) + '</time></div></div>').join('');
    const total = rows && rows.length ? rows[0].total_count : 0;
    panel.innerHTML = rulesBanner()
      + '<div class="gate-msg"><b>게시글 ' + total + '개</b> — 제안·투표는 에인연 회원 전용입니다.<br>'
      + '필요한 기능에 직접 투표하세요.<br>'
      + '<button type="button" class="gate-cta" id="gateLogin">카카오 3초 로그인</button></div>'
      + items;
    document.getElementById('gateLogin').addEventListener('click', () => {
      ainAuth.getClient().auth.signInWithOAuth({
        provider: 'kakao', options: { redirectTo: location.origin + location.pathname }
      });
    });
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

  function voteRowHtml(postId, t) {
    const total = t.up + t.down;
    const rate = total ? Math.round((t.up / total) * 100) : 0;
    return '<div class="vote-row">'
      + '<button type="button" class="vote-btn up' + (t.mine === 'up' ? ' on' : '') + '" data-vote="up" data-post="' + postId + '"><svg width=\'13\' height=\'13\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\' style=\'vertical-align:-2px\' aria-hidden=\'true\'><path d=\'M7 10v12\'/><path d=\'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z\'/></svg> 찬성 ' + t.up + '</button>'
      + '<button type="button" class="vote-btn down' + (t.mine === 'down' ? ' on' : '') + '" data-vote="down" data-post="' + postId + '"><svg width=\'13\' height=\'13\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\' style=\'vertical-align:-2px\' aria-hidden=\'true\'><path d=\'M17 14V2\'/><path d=\'M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z\'/></svg> 반대 ' + t.down + '</button>'
      + (reached(t) ? '<span class="reach-note">채택 기준 도달</span>' : '')
      + '</div>'
      + '<div class="rate-wrap"><div class="rate-bar"><div class="rate-fill" style="width:' + rate + '%"></div></div>'
      + '<div class="rate-label"><span>찬성률 ' + rate + '%</span><span>' + total + '명 참여</span></div></div>';
  }

  async function castVote(me, postId, vote) {
    const { error } = await db().from('votes').upsert(
      { post_id: Number(postId), user_id: me.user.id, vote },
      { onConflict: 'post_id,user_id' }
    );
    if (error) { alert('투표 실패: ' + error.message); return; }
    location.reload();
  }
  function bindVotes(me) {
    panel.querySelectorAll('[data-vote]').forEach((b) =>
      b.addEventListener('click', () => castVote(me, b.dataset.post, b.dataset.vote)));
  }

  async function fetchAll() {
    const [{ data: posts, error }, { data: votes }] = await Promise.all([
      db().from('posts')
        .select('id,title,body,status,created_at,view_count,author_id,author:profiles(' + C().authorSelect() + ')')
        .eq('board_type', 'proposal').limit(100),
      db().from('votes').select('post_id,user_id,vote')
    ]);
    return { posts, votes, error };
  }

  async function renderList(me) {
    const { posts, votes, error } = await fetchAll();
    if (error) { gate('게시판 준비 중입니다. 잠시 후 다시 확인해 주세요.'); console.warn(error); return; }
    const t = tally(votes, me.user.id);
    const get = (id) => t[id] || { up: 0, down: 0, mine: null };

    const sorted = [...posts].sort((a, b) => sortMode === 'votes'
      ? get(b.id).up - get(a.id).up || new Date(b.created_at) - new Date(a.created_at)
      : new Date(b.created_at) - new Date(a.created_at));

    const writeBlock =
      '<button type="button" class="write-btn" id="writeOpen">기능 제안하기</button>'
      + '<form class="write-form" id="writeForm" hidden>'
      + '<input type="text" id="wTitle" placeholder="제안 제목 (예: 세척 단가표 지역별 공유)" maxlength="80" required>'
      + '<textarea id="wBody" placeholder="어떤 기능이 왜 필요한지 적어 주세요" maxlength="4000" required></textarea>'
      + '<div class="form-actions"><button type="button" class="btn-ghost" id="writeCancel">취소</button>'
      + '<button type="submit" class="btn-primary">등록</button></div></form>';

    const sortBlock = '<div class="sort-toggle" role="group" aria-label="정렬">'
      + '<button type="button" id="sortVotes" class="' + (sortMode === 'votes' ? 'on' : '') + '">찬성순</button>'
      + '<button type="button" id="sortRecent" class="' + (sortMode === 'recent' ? 'on' : '') + '">최신순</button></div>';

    const cards = sorted.length ? sorted.map((p) => {
      const tv = get(p.id);
      return '<article class="board-card' + (reached(tv) && p.status === 'open' ? ' reach-highlight' : '') + (C().isStaff(p.author) ? ' staff-accent' : '') + '">'
        + '<a href="?id=' + p.id + '"><h2>' + escT(p.title) + '</h2></a>'
        + '<div class="card-meta-line"><span class="author-line">' + C().authorBadge(p.author) + '</span>'
        + '<span><span class="view-count">조회 ' + (p.view_count || 0) + '</span> <span class="status-badge status-' + escT(p.status) + '">' + (STATUS_LABELS[p.status] || p.status) + '</span></span></div>'
        + voteRowHtml(p.id, tv) + '</article>';
    }).join('') : '<p class="empty-note">첫 제안을 올려 주세요 — 필요한 기능이 있다면 지금이 기회입니다.</p>';

    panel.innerHTML = rulesBanner() + writeBlock + sortBlock + cards;
    bindVotes(me);

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
        board_type: 'proposal', author_id: me.user.id,
        title: document.getElementById('wTitle').value.trim(),
        body: document.getElementById('wBody').value.trim()
      });
      if (err) { alert('등록 실패: ' + err.message); return; }
      location.reload();
    });
    document.getElementById('sortVotes').addEventListener('click', () => { sortMode = 'votes'; renderList(me); });
    document.getElementById('sortRecent').addEventListener('click', () => { sortMode = 'recent'; renderList(me); });
  }

  async function renderDetail(me, id) {
    const [{ data: post, error }, { data: votes }, { data: cmts }] = await Promise.all([
      db().from('posts').select('id,title,body,status,created_at,view_count,author_id,author:profiles(' + C().authorSelect() + ')').eq('id', id).maybeSingle(),
      db().from('votes').select('post_id,user_id,vote').eq('post_id', id),
      db().from('comments').select('id,body,created_at,author_id,author:profiles(' + C().authorSelect() + ')').eq('post_id', id).order('created_at')
    ]);
    if (error || !post) { gate('글을 찾을 수 없습니다. <br><br><a class="back-link" href="./">← 목록으로</a>'); return; }
    // 조회수: 세션당 1회 증가 (RPC 미생성이어도 무시)
    if (!sessionStorage.getItem('viewed_p' + id)) {
      sessionStorage.setItem('viewed_p' + id, '1');
      db().rpc('increment_post_view', { p_post_id: Number(id) }).then(() => {}, () => {});
    }
    const tv = tally(votes, me.user.id)[post.id] || { up: 0, down: 0, mine: null };
    const mine = post.author_id === me.user.id;

    const cmtHtml = (cmts || []).map((c) =>
      '<div class="cmt"><span class="author-line">' + C().authorBadge(c.author)
      + ' <time style="color:var(--txt3);font-size:11.5px">' + C().timeAgo(c.created_at) + '</time></span>'
      + '<div class="cmt-body">' + escT(c.body) + '</div></div>').join('');

    panel.innerHTML =
      '<a class="back-link" href="./">← 목록으로</a>'
      + '<article class="board-card' + (reached(tv) && post.status === 'open' ? ' reach-highlight' : '') + '">'
      + '<div class="card-meta-line" style="margin:0 0 8px"><span class="status-badge status-' + escT(post.status) + '">'
      + (STATUS_LABELS[post.status] || post.status) + '</span>'
      + '<span><span class="view-count">조회 ' + ((post.view_count || 0) + 1) + '</span> <time style="color:var(--txt3);font-size:12px">' + C().timeAgo(post.created_at) + '</time></span></div>'
      + '<h2 style="font-size:19px">' + escT(post.title) + '</h2>'
      + '<div class="card-meta-line"><span class="author-line">' + C().authorBadge(post.author) + '</span></div>'
      + '<div class="post-body">' + escT(post.body) + '</div>'
      + voteRowHtml(post.id, tv)
      + '<div class="post-tools">'
      + (mine
        ? ((tv.up + tv.down) >= DELETE_LOCK_VOTES
          ? '<span class="del-locked">투표 ' + DELETE_LOCK_VOTES + '명 이상 모인 제안은 삭제할 수 없습니다 (기록 보존)</span>'
          : '<button type="button" class="tool-link" id="delPost">글 삭제</button>')
        : '<button type="button" class="tool-link" id="repPost">신고</button>')
      + '</div></article>'
      + '<section class="board-card"><b style="font-size:14px">의견 ' + (cmts || []).length + '</b>'
      + cmtHtml
      + '<form class="cmt-form" id="cmtForm">'
      + '<input type="text" id="cmtBody" placeholder="의견 남기기" maxlength="2000" required aria-label="의견 입력">'
      + '<button type="submit">등록</button></form></section>';

    bindVotes(me);
    const del = document.getElementById('delPost');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('제안을 삭제할까요? 투표 기록도 함께 삭제됩니다.')) return;
      const { error: delErr } = await db().from('posts').delete().eq('id', id);
      if (delErr) { alert('삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.'); console.error(delErr); return; }
      location.href = './';
    });
    const rep = document.getElementById('repPost');
    if (rep) rep.addEventListener('click', () => C().report('post', post.id));
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
