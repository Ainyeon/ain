// 에인연 커뮤니티 공통 — 프로필 게이트·작성자 뱃지·티저·신고
// 로드 순서: supabase-js → auth.js → ain-common.js → 이 파일 → 페이지 스크립트
(function () {
  'use strict';

  const FIELD_LABELS = {
    'ac-install': '에어컨 설치', 'ac-clean': '에어컨 세척', 'panel-restore': '판넬 복원·도색',
    'interior': '인테리어', 'film-sheet': '필름·시트', 'paper-floor': '도배·장판',
    'tile-bath': '타일·욕실', 'movein-clean': '입주청소', 'custom': '기타'
  };

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

  // 신고 — unique 제약 충돌이면 이미 신고한 것
  const REPORT_REASONS = ['스팸·광고', '욕설·비방', '허위 정보', '기타'];
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

  // 비회원 티저 데이터
  async function fetchTeaser() {
    const { data, error } = await db().from('v_board_teaser').select('*');
    if (error) return null;
    return data;
  }

  window.ainCommunity = { FIELD_LABELS, fieldLabel, getMyProfile, requireMember, authorBadge, isStaff, authorSelect, timeAgo, report, fetchTeaser };
})();
