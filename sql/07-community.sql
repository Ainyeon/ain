-- Step 7: 커뮤니티 — 프로필 확장 + 게시판 2종(자유/제안투표) + 찬반 투표 + 신고
-- Supabase SQL Editor에서 수동 실행. 멱등성 보장(여러 번 실행 안전).
--
-- 실행 순서: 이 파일 전체 실행 → 맨 아래 [관리자 세팅] 주석 해제해 본인 계정 1줄 실행
-- 전제: 02_auth_profiles.sql 적용 상태 (profiles 테이블 + 가입 트리거 존재 → CREATE 아닌 ALTER)
--       02를 늦게 실행했다면 기존 가입자 백필 필요:
--         insert into public.profiles (id, kakao_nickname, kakao_avatar_url)
--         select id, coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name'),
--                raw_user_meta_data->>'avatar_url'
--         from auth.users on conflict (id) do nothing;
-- 보안 원칙: anon GRANT 없음(티저 뷰 제외). is_admin·business_id는 컬럼 GRANT에서 제외해
--           본인 UPDATE로도 승격 불가. posts.status 변경은 SECURITY DEFINER RPC로만.

-- ════════════════════════════════════════
-- [A] profiles 확장 (기존 테이블 ALTER)
-- ════════════════════════════════════════
alter table public.profiles add column if not exists nickname text;
alter table public.profiles add column if not exists field text;        -- 주력분야: maker/presets.json 업종 id 체계
alter table public.profiles add column if not exists region text;       -- 활동지역 (선택)
alter table public.profiles add column if not exists business_id uuid;  -- 미래 확장용 씨앗 (현재 미사용)
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- 닉네임: 2~12자, 한글·영문·숫자만, 유니크
do $$ begin
  alter table public.profiles add constraint profiles_nickname_format
    check (nickname is null or nickname ~ '^[가-힣A-Za-z0-9]{2,12}$');
exception when duplicate_object then null; end $$;
create unique index if not exists idx_profiles_nickname_unique on public.profiles (nickname);

-- 주력분야: presets.json 9종 id
do $$ begin
  alter table public.profiles add constraint profiles_field_check
    check (field is null or field in
      ('ac-install','ac-clean','panel-restore','interior','film-sheet','paper-floor','tile-bath','movein-clean','custom'));
exception when duplicate_object then null; end $$;

-- 관리자 판별 헬퍼 (RLS 재귀 회피용 definer)
create or replace function public.is_admin_user()
returns boolean language sql security definer set search_path = public stable as
$$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

-- RLS: 로그인 사용자 전체 select (닉네임·분야 표시용) / 본인만 insert·update
drop policy if exists "user reads own profile" on public.profiles;
drop policy if exists "members read profiles" on public.profiles;
create policy "members read profiles"
    on public.profiles for select to authenticated using (true);

drop policy if exists "user updates own profile" on public.profiles;
create policy "user updates own profile"
    on public.profiles for update to authenticated
    using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "user inserts own profile" on public.profiles;
create policy "user inserts own profile"
    on public.profiles for insert to authenticated
    with check (auth.uid() = id);

-- 컬럼 단위 권한: is_admin·business_id는 본인도 못 바꿈 (승격 차단)
revoke insert, update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant insert (id, nickname, field, region) on public.profiles to authenticated;
grant update (nickname, field, region, updated_at) on public.profiles to authenticated;

-- ════════════════════════════════════════
-- [B] posts — 게시판 2종
-- ════════════════════════════════════════
create table if not exists public.posts (
    id bigserial primary key,
    board_type text not null check (board_type in ('free','proposal')),
    author_id uuid not null references public.profiles(id) on delete cascade,
    title text not null check (char_length(title) between 2 and 80),
    body text not null check (char_length(body) between 1 and 4000),
    status text not null default 'open' check (status in ('open','adopted','building','shipped')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_posts_board_created on public.posts (board_type, created_at desc);

alter table public.posts enable row level security;

drop policy if exists "members read posts" on public.posts;
create policy "members read posts" on public.posts for select to authenticated using (true);

drop policy if exists "members write own posts" on public.posts;
create policy "members write own posts" on public.posts for insert to authenticated
    with check (auth.uid() = author_id and status = 'open');

drop policy if exists "author updates own posts" on public.posts;
create policy "author updates own posts" on public.posts for update to authenticated
    using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "author or admin deletes posts" on public.posts;
create policy "author or admin deletes posts" on public.posts for delete to authenticated
    using (auth.uid() = author_id or public.is_admin_user());

-- status는 컬럼 GRANT에서 제외 → 작성자도 직접 변경 불가. 변경은 아래 RPC로만.
revoke insert, update, delete on public.posts from authenticated;
grant select, delete on public.posts to authenticated;
grant insert (board_type, author_id, title, body) on public.posts to authenticated;
grant update (title, body, updated_at) on public.posts to authenticated;

-- 관리자 전용 상태 변경 RPC (투표중 open → adopted → building → shipped)
create or replace function public.admin_set_post_status(p_post_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_admin_user() then
    raise exception 'admin only';
  end if;
  if p_status not in ('open','adopted','building','shipped') then
    raise exception 'invalid status';
  end if;
  update public.posts set status = p_status, updated_at = now() where id = p_post_id;
end;
$$;
revoke all on function public.admin_set_post_status(bigint, text) from public, anon;
grant execute on function public.admin_set_post_status(bigint, text) to authenticated;

-- ════════════════════════════════════════
-- [C] comments
-- ════════════════════════════════════════
create table if not exists public.comments (
    id bigserial primary key,
    post_id bigint not null references public.posts(id) on delete cascade,
    author_id uuid not null references public.profiles(id) on delete cascade,
    body text not null check (char_length(body) between 1 and 2000),
    created_at timestamptz not null default now()
);
create index if not exists idx_comments_post on public.comments (post_id, created_at);

alter table public.comments enable row level security;
drop policy if exists "members read comments" on public.comments;
create policy "members read comments" on public.comments for select to authenticated using (true);
drop policy if exists "members write own comments" on public.comments;
create policy "members write own comments" on public.comments for insert to authenticated
    with check (auth.uid() = author_id);
drop policy if exists "author updates own comments" on public.comments;
create policy "author updates own comments" on public.comments for update to authenticated
    using (auth.uid() = author_id) with check (auth.uid() = author_id);
drop policy if exists "author or admin deletes comments" on public.comments;
create policy "author or admin deletes comments" on public.comments for delete to authenticated
    using (auth.uid() = author_id or public.is_admin_user());

revoke insert, update, delete on public.comments from authenticated;
grant select, delete on public.comments to authenticated;
grant insert (post_id, author_id, body) on public.comments to authenticated;
grant update (body) on public.comments to authenticated;

-- ════════════════════════════════════════
-- [D] votes — 1인 1표, 변경은 upsert
-- ════════════════════════════════════════
create table if not exists public.votes (
    id bigserial primary key,
    post_id bigint not null references public.posts(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    vote text not null check (vote in ('up','down')),
    created_at timestamptz not null default now(),
    unique (post_id, user_id)
);
create index if not exists idx_votes_post on public.votes (post_id);

alter table public.votes enable row level security;
drop policy if exists "members read votes" on public.votes;
create policy "members read votes" on public.votes for select to authenticated using (true);
drop policy if exists "user votes self" on public.votes;
create policy "user votes self" on public.votes for insert to authenticated
    with check (auth.uid() = user_id);
drop policy if exists "user changes own vote" on public.votes;
create policy "user changes own vote" on public.votes for update to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "user removes own vote" on public.votes;
create policy "user removes own vote" on public.votes for delete to authenticated
    using (auth.uid() = user_id);

revoke insert, update, delete on public.votes from authenticated;
grant select, delete on public.votes to authenticated;
grant insert (post_id, user_id, vote) on public.votes to authenticated;
grant update (vote) on public.votes to authenticated;

-- ════════════════════════════════════════
-- [E] reports — 신고 (열람은 관리자만)
-- ════════════════════════════════════════
create table if not exists public.reports (
    id bigserial primary key,
    target_type text not null check (target_type in ('post','comment')),
    target_id bigint not null,
    reporter_id uuid not null references public.profiles(id) on delete cascade,
    reason text not null check (char_length(reason) between 1 and 200),
    created_at timestamptz not null default now(),
    unique (target_type, target_id, reporter_id)
);

alter table public.reports enable row level security;
drop policy if exists "members report" on public.reports;
create policy "members report" on public.reports for insert to authenticated
    with check (auth.uid() = reporter_id);
drop policy if exists "admin reads reports" on public.reports;
create policy "admin reads reports" on public.reports for select to authenticated
    using (public.is_admin_user());

revoke insert, update, delete on public.reports from authenticated;
grant select on public.reports to authenticated;  -- 정책이 admin으로 제한
grant insert (target_type, target_id, reporter_id, reason) on public.reports to authenticated;

-- ════════════════════════════════════════
-- [F] 비회원 티저 뷰 (definer — 글 수 + 최신 제목 5건, 본문·작성자 미포함)
-- ════════════════════════════════════════
-- Supabase 기본 권한(default privileges)이 새 테이블에 anon GRANT를 자동 부여하므로 명시 회수.
-- (RLS가 to authenticated뿐이라 데이터는 안 새지만, "grant부터 차단" 원칙 준수)
revoke all on public.profiles, public.posts, public.comments, public.votes, public.reports from anon;

create or replace view public.v_board_teaser as
select board_type, title, status, created_at,
       count(*) over ()::int as total_count
from public.posts
order by created_at desc
limit 5;
grant select on public.v_board_teaser to anon, authenticated;

-- ════════════════════════════════════════
-- 실행 후 확인
-- ════════════════════════════════════════
-- set role anon;
-- select * from public.posts limit 1;        -- permission denied = 성공
-- select * from public.v_board_teaser;       -- 성공 (0행이어도 정상)
-- reset role;

-- ════════════════════════════════════════
-- [관리자 세팅] — 본인 계정에만, 주석 해제 후 실행
-- ════════════════════════════════════════
-- update public.profiles set is_admin = true
-- where id = (select id from auth.users where email = 'minhyeok.pp@gmail.com');

-- ════════════════════════════════════════
-- [롤백] — 필요 시 주석 해제 (역순)
-- ════════════════════════════════════════
-- drop view if exists public.v_board_teaser;
-- drop table if exists public.reports;
-- drop table if exists public.votes;
-- drop table if exists public.comments;
-- drop table if exists public.posts;
-- drop function if exists public.admin_set_post_status(bigint, text);
-- drop function if exists public.is_admin_user();
-- alter table public.profiles
--   drop column if exists nickname, drop column if exists field,
--   drop column if exists region, drop column if exists business_id,
--   drop column if exists is_admin;
