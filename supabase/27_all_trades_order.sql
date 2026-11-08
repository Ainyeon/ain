-- ═══════════════════════════════════════════════════════════════════════
-- 27_all_trades_order.sql — 현장직 전체 분야 + 오더 공유 게시판
-- 적용: 로컬 검증(node tools/test-all-trades-sql.mjs) 뒤 운영에 적용한다. 재실행 안전. 프런트보다 먼저 적용한다.
--
-- 결정(2026-11-08 사용자): 에인연은 '현장직 사람들의 모든 공간' — 청소 등으로 국한하지 않는다.
--   [A] 주력분야를 냉난방·인테리어 위주 24종 → 현장직 전체 9묶음 52종(+ 예전 값 2종 그대로 허용).
--       목록의 정본은 maker/fields.json, 화면은 ain-community.js FIELD_GROUPS — tools/test-fields-sync.js 가 셋을 대조한다.
--   [B] 오더 공유 게시판(board_type 'order') — 서로 일감을 넘기는 곳. 구인·구직처럼 회원만 읽는다
--       (v_posts 의 비회원 조건이 free·proposal 만이라 따로 막지 않아도 된다). 마감(closed_at) 가능, 후기·교육 연결 없음.
--   [C] 알림 링크(post_path)에 오더 글 주소.
--
-- 롤백:
--   ⚠️ order 글·새 분야 회원이 생긴 뒤에는 되돌리면 제약이 실패한다(먼저 정리).
--   posts_board_type_check / posts_closed_at_check / posts_job_plain_check 는 16_jobs_board.sql 정의로,
--   profiles_field_check 는 sql/10-fields-expand.sql 목록으로, post_path 는 26_web_push.sql 정의로 되돌린다.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ── [A] 현장직 전체 분야 ────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_field_check;
alter table public.profiles add constraint profiles_field_check check (field is null or field in (
    'ac-install', 'ac-system', 'ac-clean', 'duct-clean', 'panel-restore', 'boiler', 'vent', 'refrigeration',
    'gas-pipe', 'electric', 'lighting', 'telecom', 'solar', 'ev-charger', 'pipe', 'waterproof',
    'leak', 'fire', 'drain', 'interior', 'paper', 'floor', 'film-sheet', 'tile',
    'paint', 'carpentry', 'sash', 'silicone', 'grout', 'mold', 'elastic-coat', 'blind',
    'furniture', 'middle-door', 'screen', 'movein-clean', 'move-clean', 'office-clean', 'home-clean', 'window-clean',
    'pest', 'facility', 'demolition', 'masonry', 'waste', 'appliance', 'lock', 'sign',
    'handyman', 'moving', 'freight', 'custom', 'paper-floor', 'tile-bath'));

-- ── [B] 오더 공유 게시판 ────────────────────────────────────────────
alter table public.posts drop constraint if exists posts_board_type_check;
alter table public.posts add constraint posts_board_type_check
  check (board_type in ('free', 'proposal', 'job_offer', 'job_seek', 'order'));
alter table public.posts drop constraint if exists posts_closed_at_check;
alter table public.posts add constraint posts_closed_at_check
  check (closed_at is null or board_type in ('job_offer', 'job_seek', 'order'));
alter table public.posts drop constraint if exists posts_job_plain_check;
alter table public.posts add constraint posts_job_plain_check
  check (board_type not in ('job_offer', 'job_seek', 'order') or (review_kind is null and ref_type is null));

-- ── [C] 알림 링크 — ain-community.js postHref 와 같은 규칙 ─────────
create or replace function public.post_path(p_board text, p_id bigint)
returns text language sql immutable set search_path = public as $$
  select case p_board when 'proposal'  then '/board/proposal/?id='
                      when 'job_offer' then '/edu/jobs/?kind=offer&id='
                      when 'job_seek'  then '/edu/jobs/?kind=seek&id='
                      when 'order'     then '/board/order/?id='
                      else '/board/free/?id=' end || p_id
$$;

-- ── [D] 적용 확인 ──────────────────────────────────────────────────
do $$
begin
  if public.post_path('order', 1) <> '/board/order/?id=1' then raise exception '오더 알림 링크'; end if;
  if not exists (select 1 from pg_constraint where conname = 'posts_board_type_check'
                  and pg_get_constraintdef(oid) like '%order%') then raise exception '게시판 종류에 order 없음'; end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_field_check'
                  and pg_get_constraintdef(oid) like '%window-clean%' and pg_get_constraintdef(oid) like '%paper-floor%') then
    raise exception '분야 목록 확장 실패';
  end if;
  if has_table_privilege('anon', 'public.posts', 'SELECT') then raise exception '원본 글 표가 비회원에게 열림'; end if;
end $$;

commit;
