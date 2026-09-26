// 에인연 게시판 공통 — 프로필 게이트·작성자 뱃지·티저·신고
// (모듈명 ainCommunity와 파일명은 내부 식별자라 그대로 둔다)
// 로드 순서: supabase-js → auth.js → ain-common.js → 이 파일 → 페이지 스크립트
(function () {
  'use strict';

  // maker/fields.json 마스터와 동기 (신규 22종 + legacy 2종 표기 변환)
  const FIELD_LABELS = {
    'ac-install': '에어컨 설치', 'ac-system': '시스템에어컨', 'ac-clean': '에어컨 세척',
    'duct-clean': '덕트 청소', 'panel-restore': '냉난방기 복원·도색', 'boiler': '보일러', 'vent': '환기 시스템',
    'interior': '종합 인테리어', 'paper': '도배', 'floor': '장판·마루', 'film-sheet': '필름·시트',
    'tile': '타일', 'paint': '도장', 'carpentry': '목공', 'sash': '새시·창호',
    'pipe': '상하수도·배관', 'waterproof': '방수',
    'silicone': '실리콘·코킹', 'grout': '줄눈', 'mold': '결로·곰팡이', 'movein-clean': '입주청소',
    'custom': '기타',
    'paper-floor': '도배·장판', 'tile-bath': '타일·욕실'
  };
  // 표시 전용 legacy id — 신규 선택지(온보딩 select 등)에서는 제외
  const FIELD_LEGACY = ['paper-floor', 'tile-bath'];

  // 교육 후기 국비 유형 표기 — 작성 폼·목록·상세·교육 카드가 같은 값을 쓴다.
  // 사본을 따로 두면 한쪽만 바뀌어 화면마다 다른 이름이 나온다.
  const SUBSIDY_LABELS = {
    none: '국비 없이 자비', card: '국민내일배움카드', national: '국비훈련(국기)',
    company: '회사·단체 지원', other: '그 밖', unknown: '기억 안 남 / 미기재'
  };
  const subsidyLabel = (v) => (v ? (SUBSIDY_LABELS[v] || v) : null);

  const db = () => ainAuth.getClient();

  // role 컬럼 미존재(08 SQL 미실행) 폴백 플래그
  let roleColumnMissing = false;
  const authorSelect = () => roleColumnMissing ? 'nickname,field' : 'nickname,field,role';

  async function getSessionUser() {
    const session = await ainAuth.getSession();
    return session ? session.user : null;
  }

  // 내 프로필 (없으면 null). 테이블 미생성 등 인프라 에러는 {infraError:true}
  async function getMyProfile() {
    const user = await getSessionUser();
    if (!user) return { user: null, profile: null };
    let { data, error } = await db().from('profiles')
      .select('id,nickname,field,region,role').eq('id', user.id).maybeSingle();
    if (error && String(error.message || '').includes('role')) {
      roleColumnMissing = true; // 08 미실행 → member 폴백
      ({ data, error } = await db().from('profiles')
        .select('id,nickname,field,region').eq('id', user.id).maybeSingle());
      if (data) data.role = 'member';
    }
    if (error) return { user, profile: null, infraError: true, errorMsg: error.message };
    return { user, profile: data };
  }

  // 회원 게이트: 미로그인 → null 반환(페이지가 티저 렌더),
  // 로그인 + 닉네임 미설정 → 온보딩으로 이동
  async function requireMember() {
    const r = await getMyProfile();
    if (!r.user || r.infraError) return r;
    if (!r.profile || !r.profile.nickname) {
      location.href = '/onboard/?next=' + encodeURIComponent(location.pathname + location.search);
      return { ...r, redirecting: true };
    }
    return r;
  }

  function fieldLabel(field) { return FIELD_LABELS[field] || '미설정'; }

  const ROLE_BADGES = { admin: '운영자', manager: '매니저' };
  const isStaff = (p) => !!(p && ROLE_BADGES[p.role]);

  // "닉네임 · 분야뱃지" 통일 표기 (+운영자·매니저 전용 뱃지)
  function authorBadge(profile) {
    const nick = profile && profile.nickname ? profile.nickname : '알 수 없음';
    const field = profile && profile.field ? fieldLabel(profile.field) : null;
    const role = profile && ROLE_BADGES[profile.role]
      ? '<span class="role-badge role-' + profile.role + '">' + ROLE_BADGES[profile.role] + '</span>' : '';
    return '<span class="author-nick">' + escT(nick) + '</span>' + role
      + (field ? '<span class="field-badge">' + escT(field) + '</span>' : '');
  }

  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    if (s < 86400 * 7) return Math.floor(s / 86400) + '일 전';
    const d = new Date(iso);
    return (d.getMonth() + 1) + '.' + d.getDate();
  }

  // 신고 — unique 제약 충돌이면 이미 신고한 것.
  // 사유 4종은 SPEC §10 그대로: 광고 / 개인정보 / 욕설·비방 / 사실과 다름.
  const REPORT_REASONS = ['광고', '개인정보 노출', '욕설·비방', '사실과 다름'];
  async function report(targetType, targetId) {
    const user = await getSessionUser();
    if (!user) { alert('로그인 후 신고할 수 있습니다.'); return false; }
    const idx = prompt('신고 사유를 선택하세요:\n' + REPORT_REASONS.map((r, i) => (i + 1) + '. ' + r).join('\n'), '1');
    if (idx == null) return false;
    const reason = REPORT_REASONS[parseInt(idx, 10) - 1] || REPORT_REASONS[3];
    const { error } = await db().from('reports')
      .insert({ target_type: targetType, target_id: targetId, reporter_id: user.id, reason });
    if (error) {
      alert(String(error.message || '').includes('duplicate') || error.code === '23505'
        ? '이미 신고한 게시물입니다.' : '신고 처리에 실패했습니다.');
      return false;
    }
    alert('신고가 접수되었습니다.');
    return true;
  }

  // 글 → 그 글이 속한 게시판 주소·이름 (내 활동·관리 화면 공용)
  function postHref(p) {
    const id = encodeURIComponent(p.id);
    if (p.board_type === 'proposal') return '/board/proposal/?id=' + id;
    if (p.board_type === 'job_offer') return '/edu/jobs/?kind=offer&id=' + id;
    if (p.board_type === 'job_seek') return '/edu/jobs/?kind=seek&id=' + id;
    return '/board/free/?id=' + id;
  }
  const BOARD_NAMES = { proposal: '제안', job_offer: '구인', job_seek: '구직', free: '질문·경험' };
  const boardName = (p) => BOARD_NAMES[p.board_type] || '질문·경험';

  // 비회원 티저 데이터
  async function fetchTeaser() {
    const { data, error } = await db().from('v_board_teaser').select('*');
    if (error) return null;
    return data;
  }


  // ══════════════════════════════════════════════════════════════
  // 운영 DB 적용 여부 (supabase/15_launch.sql). 미적용 상태를 성공처럼 꾸미지 않는다.
  //   posts : 'view'   = v_posts 있음 → 익명 글 지원
  //           'legacy' = 15 미적용 → 기존 posts+profiles 경로, 익명 UI 숨김
  //   saves : true/false — false면 저장 버튼이 실패를 알리고 아무것도 저장하지 않는다
  //           (localStorage 대체 금지: 다른 기기에서 다시 찾기가 성립하지 않으므로)
  // ══════════════════════════════════════════════════════════════
  const caps = { posts: null, saves: null };
  const missingRelation = (e) =>
    !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST200'
            || /does not exist|schema cache|column .* does not exist/i.test(String(e.message || '')));

  // v_posts가 내보내는 열과 짝을 이룬다. 뷰에 열이 있어도 여기서 빠지면
  // PostgREST가 그 열을 내려보내지 않아 후기가 일반 글로 취급된다(계약 검사 있음).
  const POST_COLS_BASE = 'id,board_type,title,body,status,status_reason,admin_answer,'
    + 'admin_answered_at,created_at,updated_at,view_count,is_anonymous,ref_type,ref_id,'
    + 'review_kind,review_cost,review_subsidy,review_done_month,'
    + 'is_mine,author_nick,author_field,author_role';
  // 나중 마이그레이션(16_jobs_board)에서 붙는 열. 프런트가 SQL보다 먼저 배포돼도
  // 게시판이 통째로 멈추지 않게, 없으면 한 번만 빼고 다시 읽는다.
  const POST_COLS_OPTIONAL = ['closed_at'];
  let postColsOptional = POST_COLS_OPTIONAL.slice();
  const postCols = () => postColsOptional.length
    ? POST_COLS_BASE + ',' + postColsOptional.join(',') : POST_COLS_BASE;
  const POST_COLS = postCols();      // 계약 검사가 읽는 전체 목록
  const missingColumn = (e) => !!e && (e.code === '42703'
    || /column .* does not exist/i.test(String(e.message || '')));

  function fromView(r) {
    return Object.assign({}, r, {
      author: r.is_anonymous ? null
        : { nickname: r.author_nick, field: r.author_field, role: r.author_role }
    });
  }
  function fromLegacy(r, myId) {
    return Object.assign({}, r, {
      is_mine: r.author_id === myId,
      is_anonymous: false,
      status_reason: null, admin_answer: null, admin_answered_at: null,
      ref_type: null, ref_id: null
    });
  }

  // 목록/상세 공통 읽기. build(q, mode) 로 필터를 얹는다. 반환 {rows, mode, error}
  // mode를 넘기는 이유: ref_type/ref_id·is_mine은 v_posts에만 있는 컬럼이라
  //   legacy 경로에 그대로 걸면 쿼리가 깨진다. 호출부가 모드별로 다른 필터를 건다.
  async function readPosts(build, myId) {
    if (caps.posts !== 'legacy') {
      let r = await build(db().from('v_posts').select(postCols()), 'view');
      // 아직 없는 선택 열 때문에 실패한 것이면 그 열만 빼고 한 번 더 — legacy로 내려가면
      // author_id 조인이 필요해져서 오히려 게시판 전체가 막힌다.
      if (r.error && postColsOptional.length && missingColumn(r.error)) {
        postColsOptional = [];
        r = await build(db().from('v_posts').select(postCols()), 'view');
      }
      if (!r.error) { caps.posts = 'view'; return { rows: (r.data || []).map(fromView), mode: 'view' }; }
      if (!missingRelation(r.error)) return { rows: [], mode: 'view', error: r.error };
      caps.posts = 'legacy';
    }
    const r2 = await build(db().from('posts').select(
      'id,board_type,title,body,status,created_at,updated_at,view_count,author_id,author:profiles('
      + authorSelect() + ')'), 'legacy');
    if (r2.error) return { rows: [], mode: 'legacy', error: r2.error };
    return { rows: (r2.data || []).map((x) => fromLegacy(x, myId)), mode: 'legacy' };
  }

  // 내 글만 — 서버에서 걸러야 한다. 전체를 받아 와 클라이언트에서 거르면
  // 다른 사람 글이 쌓일수록 내 글이 limit 밖으로 밀려 사라진다.
  async function readMyPosts(myId, limit) {
    return readPosts((q, mode) => (mode === 'view'
      ? q.eq('is_mine', true)
      : q.eq('author_id', myId))
      .order('created_at', { ascending: false }).limit(limit || 100), myId);
  }
  const anonymousReady = () => caps.posts === 'view';

  // 익명 글은 뷰가 작성자를 지우고 내려보낸다. 화면에서만 가리는 것이 아니다.
  function authorBadgeOf(row) {
    if (row && row.is_anonymous) return '<span class="author-nick">익명</span>';
    return authorBadge(row && row.author);
  }

  // ── 관심 저장 (계정 저장) ──
  const saveKey = (t, id) => t + ':' + id;
  async function loadSaves() {
    const user = await getSessionUser();
    if (!user) { caps.saves = null; return null; }
    const { data, error } = await db().from('saved_items')
      .select('target_type,target_id,label,meta,created_at')
      .order('created_at', { ascending: false });
    if (error) { caps.saves = false; return null; }
    caps.saves = true;
    const map = new Map();
    (data || []).forEach((r) => map.set(saveKey(r.target_type, r.target_id), r));
    return map;
  }
  async function addSave(targetType, targetId, label, meta) {
    const user = await getSessionUser();
    if (!user) return { error: { message: '로그인이 필요합니다' }, needLogin: true };
    // DB CHECK(1~200자)에 맞춰 자른다 — 긴 자동 수집 제목 하나로 저장 기능 전체가 꺼지지 않게
    const { error } = await db().from('saved_items').insert({
      user_id: user.id, target_type: targetType, target_id: String(targetId).slice(0, 200),
      label: label ? String(label).slice(0, 200) : null, meta: meta || null
    });
    if (error && error.code === '23505') return {};   // 이미 저장됨 = 성공으로 취급
    if (error) caps.saves = false;
    return { error };
  }
  async function removeSave(targetType, targetId) {
    const user = await getSessionUser();
    if (!user) return { error: { message: '로그인이 필요합니다' }, needLogin: true };
    const { error } = await db().from('saved_items').delete()
      .eq('user_id', user.id).eq('target_type', targetType).eq('target_id', String(targetId));
    if (error) caps.saves = false;
    return { error };
  }
  const savesReady = () => caps.saves !== false;

  // ── 개인 연락처만 가린다 (SPEC §3.7 / §10) ──
  // 본체는 서버다 — supabase/15_launch.sql [G]의 mask_contacts + BEFORE INSERT/UPDATE 트리거가
  // 저장 시점에 정리하므로 일반 REST로 title/body/comments를 그대로 읽어도 나오지 않는다.
  // 여기 함수는 트리거 적용 전에 저장된 기존 본문을 화면에서 덮어 주는 이중 방어이며,
  // 서버와 같은 규칙·같은 문구를 쓴다.
  // 기관 공식 링크와 공고 원문 링크는 정보이므로 절대 가리지 않는다.
  // 완전 탐지를 약속하지 않는다 — 놓친 것은 신고(개인정보 노출)로 받는다.
  const MASK = '[가림]';
  const CONTACT_RULES = [
    // 전화: 010-1234-5678 / 01012345678 / 02-123-4567 (구분자는 - . 공백)
    [/(^|[^0-9A-Za-z])(0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4})(?![0-9])/g, '$1' + MASK],
    // 이메일
    [/(^|[^\w.+-])[\w.+-]+@[\w-]+\.[\w.-]+/g, '$1' + MASK],
    // 카톡·오픈채팅 아이디 표기 ("카톡 abc123", "카카오톡: abc_1")
    [/(카톡|카카오톡|오픈채팅|오픈톡)\s*(아이디)?\s*[:：]?\s*[A-Za-z0-9._-]{3,}/g, '$1 ' + MASK]
  ];
  function maskContacts(text) {
    let t = String(text == null ? '' : text);
    // 링크는 먼저 빼 두고 나중에 되돌린다 — 공고 URL 안의 숫자가 전화번호로 잡히면 안 된다
    const urls = [];
    t = t.replace(/https?:\/\/\S+/g, (m) => { urls.push(m); return '\u0000' + (urls.length - 1) + '\u0000'; });
    CONTACT_RULES.forEach(([re, to]) => { t = t.replace(re, to); });
    return t.replace(/\u0000(\d+)\u0000/g, (m, i) => urls[Number(i)]);
  }

  function loginWithKakao() {
    return db().auth.signInWithOAuth({
      provider: 'kakao', options: { redirectTo: location.origin + location.pathname + location.search }
    });
  }

  window.ainCommunity = { FIELD_LABELS, FIELD_LEGACY, fieldLabel, getMyProfile, requireMember,
    authorBadge, authorBadgeOf, isStaff, authorSelect, timeAgo, report, fetchTeaser, postHref, boardName,
    readPosts, readMyPosts, anonymousReady, loadSaves, addSave, removeSave, savesReady, saveKey,
    loginWithKakao, maskContacts, REPORT_REASONS, SUBSIDY_LABELS, subsidyLabel, caps };
})();
