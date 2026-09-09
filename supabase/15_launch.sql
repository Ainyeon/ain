-- ═══════════════════════════════════════════════════════════════
-- 15_launch.sql — 첫 출시 (관심 저장 · 익명 글 · 제안 루프 확장)
-- 작성 2026-09-09. **실행하지 않음.** 박민혁 검토 후 Supabase SQL Editor에서 수동 실행.
-- 멱등(여러 번 실행 안전). 기존 07/08/09/10 구조 위에 얹는다.
--
-- 실측 전제 (2026-09-09 읽기 전용 확인, LIVE_SCHEMA_READONLY):
--   · posts = 4상태(open/adopted/building/shipped), author_id NOT NULL,
--     RLS "members read posts" = authenticated 전체 SELECT, 삭제 잠금 = 제안 5표.
--   · profiles_field_check = 22공종 + legacy 2 (sql/10 적용 완료 상태).
--   · saved / bookmark / education 이름의 테이블 없음 → [A]는 신규 생성.
--
-- 적용 순서: [A] → [B] → [C] → [D] → [E] (뒤가 앞을 참조)
-- 롤백 한계: [B]의 revoke select(author_id)를 되돌리면 익명 글의 작성자가
--            일반 API에서 다시 보인다. [B] 롤백 = 익명 기능 철회와 같다.
-- ═══════════════════════════════════════════════════════════════


-- ⚠️ 전체를 한 트랜잭션으로 실행한다.
--    테이블 생성·GRANT 회수·뷰 교체가 섞여 있어 중간에 실패하면
--    "posts의 SELECT만 회수되고 v_posts는 없는" 상태가 남아 게시판이 통째로 멈춘다.
--    Supabase SQL Editor는 이 파일 전체를 한 번에 실행하면 된다.
begin;

-- ════════════════════════════════════════
-- [A] saved_items — 관심 저장 (SPEC A2)
--     계정 저장. 저장/해제/재로그인 유지/다른 기기 조회가 모두 이 테이블 하나로 성립한다.
--     label·meta는 저장 시점 스냅샷 — 내 활동이 원본을 다시 조인하지 않아도 렌더된다.
--     (교육·공고는 정적 JSON, 단지는 회원 전용 뷰라 조인 경로가 서로 다르기 때문)
-- ════════════════════════════════════════
create table if not exists public.saved_items (
    id bigserial primary key,
    user_id uuid not null references public.profiles(id) on delete cascade,
    target_type text not null check (target_type in ('edu','notice','complex')),
    target_id text not null check (char_length(target_id) between 1 and 200),
    label text check (label is null or char_length(label) <= 200),
    meta text check (meta is null or char_length(meta) <= 300),
    created_at timestamptz not null default now(),
    unique (user_id, target_type, target_id)
);
create index if not exists idx_saved_items_user on public.saved_items (user_id, created_at desc);

alter table public.saved_items enable row level security;

-- 본인 행만. 다른 회원의 저장 목록은 조회·수정·삭제 모두 불가.
drop policy if exists "user reads own saves" on public.saved_items;
create policy "user reads own saves" on public.saved_items for select to authenticated
    using (auth.uid() = user_id);
drop policy if exists "user inserts own saves" on public.saved_items;
create policy "user inserts own saves" on public.saved_items for insert to authenticated
    with check (auth.uid() = user_id);
drop policy if exists "user deletes own saves" on public.saved_items;
create policy "user deletes own saves" on public.saved_items for delete to authenticated
    using (auth.uid() = user_id);

-- Supabase 디폴트 프리빌리지는 신규 테이블에 authenticated/anon ALL(TRUNCATE 포함)을 붙인다.
-- 셋 모두 회수한 뒤 필요한 것만 다시 준다 (11_v_gov_list.sql과 같은 원칙).
revoke all on public.saved_items from anon, authenticated, public;
grant select, delete on public.saved_items to authenticated;
grant insert (user_id, target_type, target_id, label, meta) on public.saved_items to authenticated;
revoke all on sequence public.saved_items_id_seq from anon, authenticated, public;
grant usage, select on sequence public.saved_items_id_seq to authenticated;


-- ════════════════════════════════════════
-- [B] 익명 글 (SPEC A8) — 화면에서 가리는 것이 아니라 API에서 안 나가게 한다
--     1) posts.is_anonymous 추가
--     2) authenticated의 posts SELECT를 컬럼 단위로 좁혀 author_id를 제외
--        → PostgREST의 select=author_id 도, author:profiles(...) 임베드도 모두 실패
--     3) 읽기는 definer 뷰 v_posts 경유. 뷰가 익명 글의 작성자를 null로 지운다.
--     RLS(본인 수정·삭제)는 posts.author_id 기준 그대로 — 클라이언트가 그 값을 못 봐도 동작한다.
-- ════════════════════════════════════════
alter table public.posts add column if not exists is_anonymous boolean not null default false;
-- 교육 카드 ↔ 글 연결 (SPEC §3.8). 데이터가 있을 때만 링크를 띄우기 위한 참조.
alter table public.posts add column if not exists ref_type text
    check (ref_type is null or ref_type in ('edu','notice'));
alter table public.posts add column if not exists ref_id text
    check (ref_id is null or char_length(ref_id) <= 200);
create index if not exists idx_posts_ref on public.posts (ref_type, ref_id);

-- 짧은 글을 최소 글자 수로 막지 않는다 (SPEC §6.1).
-- 07의 2~80자 / 1~4000자 제약을 "공백만 아니면 되고 상한만 지킨다"로 바꾼다.
-- 제목 1자("왜?" 같은 짧은 질문)를 막을 이유가 없다. 공백만 있는 글은 계속 거부한다.
-- ⚠️ btrim은 기본적으로 일반 공백만 지운다. btrim(title) <> '' 로 두면
--    탭·줄바꿈만 있는 제목·본문이 API로 그대로 저장된다.
--    "공백이 아닌 글자가 하나라도 있는가"를 직접 묻는다 —
--    [:space:]는 space·tab·newline·CR·form feed·vertical tab을 모두 포함한다.
alter table public.posts drop constraint if exists posts_title_check;
alter table public.posts add constraint posts_title_check
  check (title ~ '[^[:space:]]' and char_length(title) <= 80);
alter table public.posts drop constraint if exists posts_body_check;
alter table public.posts add constraint posts_body_check
  check (body ~ '[^[:space:]]' and char_length(body) <= 4000);
alter table public.comments drop constraint if exists comments_body_check;
alter table public.comments add constraint comments_body_check
  check (body ~ '[^[:space:]]' and char_length(body) <= 2000);

-- 교육 후기 선택 입력 (SPEC A6 / §3.7) — 장벽을 최소로 둔다.
--   · 금액은 선택. 모르면 비워 둔다. **금액이 없다고 자동 비공개 하지 않는다.**
--   · 국비 유형도 선택.
--   · 수료 시점(YYYY-MM)은 오래된 후기를 필터로 거르기 위한 값이며, 하단 일괄 배치는 하지 않는다.
--   · 같은 기관이라도 회차·시점이 다르면 추가 작성이 가능하다 → 유니크 제약을 두지 않는다.
-- 형식·길이는 DB 제약으로 강제한다(프론트만 믿지 않는다).
alter table public.posts add column if not exists review_kind text
    check (review_kind is null or review_kind in ('review','tip'));
alter table public.posts add column if not exists review_cost integer
    check (review_cost is null or (review_cost >= 0 and review_cost <= 100000000));
alter table public.posts add column if not exists review_subsidy text
    check (review_subsidy is null or review_subsidy in
      ('none','card','national','company','other','unknown'));
alter table public.posts add column if not exists review_done_month text
    check (review_done_month is null or review_done_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
create index if not exists idx_posts_review on public.posts (review_kind, review_done_month desc);

-- 후기 전용 필드는 후기 유형일 때만 채워질 수 있다 (질문 글에 금액이 붙지 않게).
-- ⚠️ review_kind가 NULL이면 (review_kind = 'review')는 NULL이고 NULL or false = NULL이라
--    CHECK가 통과해 버린다. coalesce로 NULL을 false로 못박아야 실제로 막힌다.
alter table public.posts drop constraint if exists posts_review_fields_check;
alter table public.posts add constraint posts_review_fields_check
  check (coalesce(review_kind = 'review', false)
         or (review_cost is null and review_subsidy is null and review_done_month is null));

-- 제안 루프 확장 (SPEC ②) — 기존 4상태는 그대로 두고 보류/안 함만 추가한다.
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('open','adopted','building','shipped','held','declined'));
alter table public.posts add column if not exists status_reason text
    check (status_reason is null or char_length(status_reason) <= 500);
alter table public.posts add column if not exists admin_answer text
    check (admin_answer is null or char_length(admin_answer) <= 2000);
alter table public.posts add column if not exists admin_answered_at timestamptz;

-- ── 작성자 본인 삭제 (SPEC A8-3 / §10) ──
-- sql/09-engagement.sql [B]는 투표 5명 이상 모인 제안글의 작성자 삭제를 막았다(기록 보존).
-- 첫 출시의 A8 완료 기준은 "작성자 본인의 수정·삭제 권한이 동작한다"이므로 잠금을 뺀다.
-- 영향: 표가 모인 제안도 작성자가 지울 수 있고, votes/comments가 FK cascade로 함께 사라진다.
--       기록 보존이 다시 필요해지면 삭제 대신 숨김 상태를 두는 쪽으로 설계해야 한다
--       (같은 정책을 되돌리면 A8-3이 다시 깨지므로 원복은 답이 아니다).
--       프론트 상수 DELETE_LOCK_VOTES도 함께 제거됨 — 이 정책과 쌍이었다.
drop policy if exists "author or admin deletes posts" on public.posts;
create policy "author or admin deletes posts" on public.posts for delete to authenticated
    using (auth.uid() = author_id or public.is_admin_user());

-- ── 컬럼 단위 SELECT. author_id 제외가 이 블록의 전부다. ──
-- 07은 SELECT/INSERT/UPDATE/DELETE만 손댔고, Supabase 디폴트로 붙은
-- TRUNCATE/REFERENCES/TRIGGER는 authenticated에 남아 있다(실측 확인). 여기서 걷어낸다.
revoke truncate, references, trigger on public.posts from anon, authenticated;
revoke select on public.posts from authenticated;
grant select (id, board_type, title, body, status, status_reason, admin_answer,
              admin_answered_at, created_at, updated_at, view_count,
              is_anonymous, ref_type, ref_id,
              review_kind, review_cost, review_subsidy, review_done_month)
  on public.posts to authenticated;
-- 쓰기 권한은 07 그대로 유지 + 신규 컬럼만 추가 부여 (status/author_id는 계속 제외)
grant insert (board_type, author_id, title, body, is_anonymous, ref_type, ref_id,
              review_kind, review_cost, review_subsidy, review_done_month)
  on public.posts to authenticated;
grant update (title, body, updated_at,
              review_cost, review_subsidy, review_done_month) on public.posts to authenticated;
revoke all on public.posts from anon;

-- ── 읽기 경로: definer 뷰. RLS를 우회하므로 회원 제한을 뷰 안에서 다시 건다. ──
drop view if exists public.v_posts;
create view public.v_posts as
select
    p.id, p.board_type, p.title, p.body, p.status, p.status_reason,
    p.admin_answer, p.admin_answered_at,
    p.created_at, p.updated_at, p.view_count, p.is_anonymous, p.ref_type, p.ref_id,
    p.review_kind, p.review_cost, p.review_subsidy, p.review_done_month,
    (p.author_id = auth.uid()) as is_mine,
    case when p.is_anonymous then null else pr.nickname end as author_nick,
    case when p.is_anonymous then null else pr.field    end as author_field,
    case when p.is_anonymous then null else pr.role     end as author_role
from public.posts p
join public.profiles pr on pr.id = p.author_id
where auth.uid() is not null;   -- 07의 "members read posts"와 동일한 회원 제한

-- 신규 뷰에 디폴트로 붙는 쓰기 권한 회수 후 SELECT만 재부여 (11_v_gov_list.sql과 동일 원칙)
revoke all on public.v_posts from anon, authenticated, public;
grant select on public.v_posts to authenticated;


-- ════════════════════════════════════════
-- [C] 운영자 제한 조회 (SPEC §10-2) — 목적을 중복·악용 확인으로 한정하고 열람 기록을 남긴다
-- ════════════════════════════════════════
create table if not exists public.admin_author_lookups (
    id bigserial primary key,
    post_id bigint not null,
    admin_id uuid not null,
    purpose text not null check (purpose in ('duplicate','abuse')),
    created_at timestamptz not null default now()
);
alter table public.admin_author_lookups enable row level security;
drop policy if exists "admin reads lookups" on public.admin_author_lookups;
create policy "admin reads lookups" on public.admin_author_lookups for select to authenticated
    using (public.is_admin_user());
revoke all on public.admin_author_lookups from anon, authenticated, public;
grant select on public.admin_author_lookups to authenticated;   -- 정책이 admin으로 제한

create or replace function public.admin_post_author(p_post_id bigint, p_purpose text)
returns table (nickname text, role text, post_count bigint)
language plpgsql security definer set search_path = public as
$$
declare v_author uuid;
begin
  if not public.is_admin_user() then
    raise exception 'admin only';
  end if;
  if p_purpose not in ('duplicate','abuse') then
    raise exception 'purpose must be duplicate or abuse';
  end if;
  select author_id into v_author from public.posts where id = p_post_id;
  if v_author is null then
    raise exception 'post not found';
  end if;
  insert into public.admin_author_lookups (post_id, admin_id, purpose)
    values (p_post_id, auth.uid(), p_purpose);
  return query
    select pr.nickname, pr.role, (select count(*) from public.posts x where x.author_id = v_author)
    from public.profiles pr where pr.id = v_author;
end;
$$;
revoke all on function public.admin_post_author(bigint, text) from public, anon;
grant execute on function public.admin_post_author(bigint, text) to authenticated;


-- ════════════════════════════════════════
-- [D] 제안 상태·답변 RPC — 07의 admin_set_post_status 교체 (상태 6종 + 사유 + 운영자 답변)
-- ════════════════════════════════════════
create or replace function public.admin_set_post_status(p_post_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as
$$
begin
  perform public.admin_set_post_state(p_post_id, p_status, null, null);
end;
$$;

create or replace function public.admin_set_post_state(
    p_post_id bigint, p_status text, p_reason text, p_answer text)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin_user() then
    raise exception 'admin only';
  end if;
  if p_status is not null and p_status not in
     ('open','adopted','building','shipped','held','declined') then
    raise exception 'invalid status';
  end if;
  -- 보류·안 함은 이유 없이 둘 수 없다 (SPEC ②: 보류(이유) / 안 함(이유))
  if p_status in ('held','declined')
     and coalesce(nullif(btrim(p_reason), ''), '') = '' then
    raise exception 'held/declined requires a reason';
  end if;
  update public.posts set
      status = coalesce(p_status, status),
      status_reason = case when p_status is null then status_reason else nullif(btrim(p_reason), '') end,
      admin_answer = coalesce(nullif(btrim(p_answer), ''), admin_answer),
      admin_answered_at = case when nullif(btrim(p_answer), '') is null
                               then admin_answered_at else now() end,
      updated_at = now()
  where id = p_post_id;
end;
$$;
revoke all on function public.admin_set_post_state(bigint, text, text, text) from public, anon;
grant execute on function public.admin_set_post_state(bigint, text, text, text) to authenticated;
revoke all on function public.admin_set_post_status(bigint, text) from public, anon;
grant execute on function public.admin_set_post_status(bigint, text) to authenticated;


-- ════════════════════════════════════════
-- [E] 티저 뷰 재확인 — 익명 여부와 무관하게 제목만 나간다 (작성자 컬럼 없음). 변경 없음.
--     v_board_teaser는 07 그대로 두고 여기서는 권한만 재확인한다.
-- ════════════════════════════════════════
-- 실측: anon/authenticated에 광범위한 grant가 남아 있다. 셋 모두 회수 후 SELECT만 부여.
revoke all on public.v_board_teaser from anon, authenticated, public;
grant select on public.v_board_teaser to anon, authenticated;


-- ════════════════════════════════════════
-- [F] notice_complexes — 모집 공고의 단지명 (회원 전용)
--     기존 게이팅 정책과 같은 선: 지역·세대수·공고 조건은 공개, 단지명은 회원만.
--     그래서 공개 정적 파일(assets/data/notices.json)에는 단지명을 담지 않고 여기에만 둔다.
--     행 INSERT는 이 파일에 넣지 않는다 — 단지명이 공개 repo에 남으면 게이팅이 무의미해진다.
--     시드는 repo 밖 파일로 별도 전달하며, 운영 적용 전까지 화면은 "로그인 후 확인"이 아니라
--     "단지명 미등록"으로 비어 있게 된다(회원에게도 값이 없음).
-- ════════════════════════════════════════
create table if not exists public.notice_complexes (
    notice_id text primary key check (char_length(notice_id) between 1 and 100),
    complex_name text not null check (char_length(complex_name) between 1 and 200),
    updated_at timestamptz not null default now()
);
alter table public.notice_complexes enable row level security;
drop policy if exists "members read notice complexes" on public.notice_complexes;
create policy "members read notice complexes" on public.notice_complexes
    for select to authenticated using (true);
-- 쓰기 정책 없음 = authenticated는 INSERT/UPDATE/DELETE 불가. 등록은 SQL Editor에서 수동.
revoke all on public.notice_complexes from anon, authenticated, public;
grant select on public.notice_complexes to authenticated;


-- ════════════════════════════════════════
-- [G] 개인 연락처 정리 (SPEC §3.7 / §10) — 화면 가림으로 끝내지 않는다
--     일반 REST로 title/body/comments를 그대로 읽어도 개인 연락처가 나오지 않도록
--     **저장 시점에** 정리한다. 기관 공식 링크와 공고 원문 링크는 보존한다.
--     완전 탐지를 약속하지 않는다 — 놓친 것은 신고(개인정보 노출)로 받는다.
--     기존 운영 본문은 일괄 수정하지 않는다. 신규 입력·수정분에만 적용된다.
-- ════════════════════════════════════════
create or replace function public.mask_contacts(t text)
returns text language plpgsql immutable set search_path = public as
$$
declare
  out_t text := coalesce(t, '');
  m text;
  urls text[] := '{}';
  i int := 0;
begin
  if out_t = '' then return out_t; end if;

  -- 링크를 먼저 빼 둔다. 공고 URL 안의 숫자열이 전화번호로 잡히면 안 된다.
  for m in select (regexp_matches(out_t, '(https?://[^[:space:]]+)', 'g'))[1] loop
    i := i + 1;
    urls := array_append(urls, m);
    out_t := replace(out_t, m, chr(1) || i::text || chr(1));
  end loop;

  -- 사람에게 직접 연결되는 값만 가린다
  out_t := regexp_replace(out_t,                                    -- 전화
    '(^|[^0-9A-Za-z])(0[0-9]{1,2}[-. ]?[0-9]{3,4}[-. ]?[0-9]{4})(?![0-9])',
    '\1[가림]', 'g');
  out_t := regexp_replace(out_t,                                    -- 이메일
    '(^|[^A-Za-z0-9._+-])[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9._-]+',
    '\1[가림]', 'g');
  out_t := regexp_replace(out_t,                                    -- 카톡·오픈채팅 아이디
    '(카톡|카카오톡|오픈채팅|오픈톡)[[:space:]]*(아이디)?[[:space:]]*[:：]?[[:space:]]*[A-Za-z0-9._-]{3,}',
    '\1 [가림]', 'g');

  -- 링크를 되돌린다
  for i in 1 .. coalesce(array_length(urls, 1), 0) loop
    out_t := replace(out_t, chr(1) || i::text || chr(1), urls[i]);
  end loop;
  return out_t;
end;
$$;
revoke all on function public.mask_contacts(text) from public, anon;
grant execute on function public.mask_contacts(text) to authenticated;

create or replace function public.tg_mask_post()
returns trigger language plpgsql set search_path = public as
$$
begin
  new.title := public.mask_contacts(new.title);
  new.body  := public.mask_contacts(new.body);
  -- 길이를 넘으면 자르지 않고 거부한다. 사용자가 쓴 글을 조용히 잃는 것이
  -- 등록 실패보다 나쁘다 — 무엇이 사라졌는지 본인도 모르게 된다.
  -- 아래 posts_title_check(80자)가 거부하며, 화면은 "등록하지 못했습니다"로 되돌린다.
  return new;
end;
$$;
drop trigger if exists mask_contacts_posts on public.posts;
create trigger mask_contacts_posts
  before insert or update of title, body on public.posts
  for each row execute function public.tg_mask_post();

create or replace function public.tg_mask_comment()
returns trigger language plpgsql set search_path = public as
$$
begin
  new.body := public.mask_contacts(new.body);
  return new;
end;
$$;
drop trigger if exists mask_contacts_comments on public.comments;
create trigger mask_contacts_comments
  before insert or update of body on public.comments
  for each row execute function public.tg_mask_comment();


-- ════════════════════════════════════════
-- [H] 동일 계정 단시간 반복 작성 플래그 (SPEC §3.7)
--     작성자 기준으로 세야 하는 값이므로 서버에서 계산한다.
--     반환값은 post_id와 플래그뿐 — author_id를 새로 내보내지 않는다(익명 보호 유지).
--     자동 비공개·작성 금지가 아니라 운영자 검토 신호다.
-- ════════════════════════════════════════
create or replace function public.admin_repeat_flags(p_window_min int default 10, p_limit int default 3)
returns table (post_id bigint, repeat_flag boolean)
language sql security definer set search_path = public stable as
$$
  select p.id,
         (count(*) over (
            partition by p.author_id
            order by p.created_at
            range between (p_window_min || ' minutes')::interval preceding and current row
          ) >= p_limit) as repeat_flag
  from public.posts p
  where public.is_admin_user()
$$;
revoke all on function public.admin_repeat_flags(int, int) from public, anon;
grant execute on function public.admin_repeat_flags(int, int) to authenticated;

commit;

-- ════════════════════════════════════════
-- 실행 후 확인 (SPEC §10 완료 기준 3항) — commit 이후 별도로 실행
-- ════════════════════════════════════════
-- 1) 일반 API에 작성자 식별 정보가 없다:
--    set local role authenticated;
--    select author_id from public.posts limit 1;      -- permission denied for column = 성공
--    select * from public.v_posts limit 1;            -- author_nick이 익명 글에서 null이어야 함
--    reset role;
-- 2) 운영자 제한 조회 + 기록:
--    select * from public.admin_post_author(<익명글id>, 'duplicate');  -- admin만 성공
--    select * from public.admin_author_lookups order by id desc limit 1;
-- 3) 본인 수정·삭제 (타인 거부 / 본인 성공 / 5표 이상도 본인 삭제 성공):
--    작성자 계정으로 update posts set body='x' where id=<본인글>;      -- 1행
--    다른 계정으로 같은 쿼리;                                          -- 0행
--    다른 계정으로 delete from posts where id=<남의글>;                 -- 0행
--    작성자 계정으로 delete from posts where id=<본인글>;               -- 1행
--    작성자 계정으로 delete from posts where id=<투표 5표 이상인 본인 제안>;  -- 1행 (잠금 해제 확인)
-- 3-1) 대상 권한 잔재 확인 (TRUNCATE 등이 남아 있지 않아야 함):
--    select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type)
--    from information_schema.role_table_grants
--    where table_schema='public'
--      and table_name in ('saved_items','posts','v_posts','v_board_teaser','admin_author_lookups')
--      and grantee in ('anon','authenticated')
--    group by 1,2 order by 1,2;
--    기대: saved_items      = authenticated DELETE,INSERT,SELECT / anon 없음
--          posts           = authenticated DELETE,INSERT,SELECT,UPDATE / anon 없음
--                            (TRUNCATE·REFERENCES·TRIGGER가 남아 있으면 위 revoke 미적용)
--                            SELECT는 테이블 레벨이 아니라 컬럼 단위로만 잡혀야 한다
--          v_posts         = authenticated SELECT / anon 없음
--          v_board_teaser  = anon SELECT, authenticated SELECT
--          notice_complexes= authenticated SELECT / anon 없음
--    select grantee, privilege_type, column_name from information_schema.role_column_grants
--    where table_schema='public' and table_name='posts' and grantee='authenticated'
--      and privilege_type='SELECT' and column_name='author_id';   -- 0행이어야 성공
-- 4) 저장 격리:
--    다른 계정으로 select * from public.saved_items;               -- 본인 행만
-- 4-1) 단지명 게이팅 (입주 단지와 같은 선):
--    set local role anon;  select * from public.notice_complexes;  -- permission denied = 성공
--    reset role;  회원 세션에서는 조회 성공
-- 4-2) 개인 연락처 정리 (신규 입력분):
--    insert … values ('문의 010-1234-5678 / a@b.co / 공고 https://www.bizinfo.go.kr/x?pblancId=PBLN_1');
--    select title, body from public.posts order by id desc limit 1;
--    기대: 전화·이메일은 [가림], 공고 URL은 그대로
--    select public.mask_contacts('https://idoedu.kr/bbs/board.php?wr_id=01012345678');  -- 원문 그대로
-- 4-2b) 제목을 자르지 않는다:
--    insert … values (repeat('가', 80) || '카톡 abcd');   -- 가림 후 80자 초과 → 제약 위반이어야 함
--    (조용히 잘려 저장되면 실패다)
-- 4-2c) 짧은 글 허용:
--    insert … values ('왜', '짧은 질문');                  -- 성공
--    insert … values ('?', '한 글자 제목');                -- 성공
--    insert … values ('   ', '공백만 제목');               -- 제약 위반이어야 함
--    insert … values (E'\t\n', '탭·줄바꿈만 제목');        -- 제약 위반이어야 함
--    insert … values ('제목', '   ');                      -- 제약 위반이어야 함
--    insert … values ('제목', E'\t\t');                    -- 제약 위반이어야 함
--    insert into comments … values (E'\n \t');             -- 제약 위반이어야 함
-- 4-3) 후기 필드 경계:
--    insert … (review_kind, review_cost) values (null, 120000);        -- 제약 위반이어야 함
--    insert … (review_kind, review_cost) values ('tip', 120000);       -- 제약 위반이어야 함
--    insert … (review_kind, review_cost) values ('review', 22500);     -- 성공
--    insert … (review_done_month) values ('2026-13');                  -- 제약 위반이어야 함
-- 4-4) 반복 작성 플래그:
--    select * from public.admin_repeat_flags(10, 3);   -- admin만 행이 나오고 post_id·flag만 반환
-- 5) 보류 사유 강제:
--    select public.admin_set_post_state(<id>,'held','','');         -- 예외여야 함

-- ════════════════════════════════════════
-- [롤백] — 실행형 역순 스크립트를 두지 않는다
-- ════════════════════════════════════════
-- 이 마이그레이션은 되돌리기가 대칭이 아니다. 그대로 뒤집으면 두 가지가 깨진다.
--
--   1) 신원 재노출: posts의 테이블 레벨 SELECT를 다시 부여하면, 이미 익명으로 작성된
--      글의 author_id가 일반 API 응답에 다시 실린다. 사용자가 익명을 약속받고 쓴 글이므로
--      이것은 되돌리기가 아니라 약속 파기다.
--   2) 데이터 손실·제약 실패: status 제약을 4상태로 되돌리면 held/declined 행이 남아 있는 한
--      실패하고, 통과시키려면 그 행들의 상태·이유를 지워야 한다. saved_items를 드롭하면
--      회원이 저장한 항목이 사라진다.
--   3) **옛 프론트로 통째 되돌리면 게시판 조회가 깨진다.** dae7498 시점 프론트는
--      posts를 author:profiles(...) 임베드로 읽는데, 이 마이그레이션이 authenticated의
--      posts.author_id SELECT를 회수하므로 그 쿼리가 실패한다. 목록·상세가 뜨지 않는다.
--      "프론트만 되돌리면 화면이 이전과 같아진다"는 성립하지 않는다.
--
-- 문제가 생겼을 때의 순서 (앞의 둘 중 하나를 고른다):
--   (a) v_posts를 읽는 프론트를 기준으로 앞으로 고친다. 익명 보호와 저장 데이터가 유지되고
--       게시판도 계속 뜬다. 기본 선택지다.
--   (a2) 굳이 옛 프론트로 되돌려야 한다면 게시판이 뜨지 않는 상태를 감수하고 점검 안내를 띄운다.
--       익명 SELECT 보호를 풀어서 되살리는 것은 답이 아니다(익명 글 작성자가 다시 노출된다).
--   (b) 그래도 남는 문제만 개별로 좁혀 고친다.
--       · 제안 상태를 되돌리고 싶으면: update public.posts set status='open', status_reason=null
--         where status in ('held','declined');  → 그 다음에야 제약을 좁힐 수 있다.
--       · 저장 기능만 끄고 싶으면: revoke insert on public.saved_items from authenticated;
--         (테이블은 남겨 둔다 — 드롭하면 회원 데이터가 사라진다)
--       · notice_complexes만 비우고 싶으면: delete from public.notice_complexes;
--   (c) 익명 보호(=[B]의 컬럼 GRANT)는 마지막까지 유지한다. 되돌릴 이유가 생기면
--       익명 글을 먼저 정리한 뒤에 판단한다.
