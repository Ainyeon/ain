-- Step 9: 참여 지표 — 조회수·삭제 잠금·템플릿 사용 카운터
-- Supabase SQL Editor에서 수동 실행. 멱등.

-- ════════════════════════════════════════
-- [A] 게시글 조회수
-- ════════════════════════════════════════
alter table public.posts add column if not exists view_count integer not null default 0;

-- 회원이 상세를 열 때 1 증가 (세션당 1회는 클라이언트에서 dedupe)
create or replace function public.increment_post_view(p_post_id bigint)
returns void language sql security definer set search_path = public as
$$ update public.posts set view_count = view_count + 1 where id = p_post_id $$;
revoke all on function public.increment_post_view(bigint) from public, anon;
grant execute on function public.increment_post_view(bigint) to authenticated;

-- ════════════════════════════════════════
-- [B] 삭제 잠금 — 투표 5명 이상 모인 제안글은 작성자도 삭제 불가 (기록 보존)
--     잠금 임계값(5)은 프론트 상수 DELETE_LOCK_VOTES와 쌍. 조정 시 양쪽 함께.
-- ════════════════════════════════════════
drop policy if exists "author or admin deletes posts" on public.posts;
create policy "author or admin deletes posts" on public.posts for delete to authenticated
    using (
      public.is_admin_user()
      or (
        auth.uid() = author_id
        and (
          board_type = 'free'
          or (select count(*) from public.votes v where v.post_id = posts.id) < 5
        )
      )
    );

-- ════════════════════════════════════════
-- [C] 사이트 지표 카운터 (템플릿 메이커 사용 수 — 시작값 518)
-- ════════════════════════════════════════
create table if not exists public.site_stats (
    key text primary key,
    value bigint not null default 0,
    updated_at timestamptz not null default now()
);
insert into public.site_stats (key, value) values ('maker_uses', 518)
on conflict (key) do nothing;

alter table public.site_stats enable row level security;
drop policy if exists "anyone reads stats" on public.site_stats;
create policy "anyone reads stats" on public.site_stats for select to anon, authenticated using (true);
revoke insert, update, delete on public.site_stats from anon, authenticated;
grant select on public.site_stats to anon, authenticated;

-- 증가는 definer RPC로만 (메이커는 비로그인도 쓰므로 anon 실행 허용 — 카운터 인플레 외 리스크 없음)
create or replace function public.bump_stat(p_key text)
returns bigint language plpgsql security definer set search_path = public as
$$
declare v bigint;
begin
  if p_key not in ('maker_uses') then
    raise exception 'unknown stat';
  end if;
  update public.site_stats set value = value + 1, updated_at = now()
  where key = p_key returning value into v;
  return v;
end;
$$;
grant execute on function public.bump_stat(text) to anon, authenticated;

-- ════════════════════════════════════════
-- 실행 후 확인
-- ════════════════════════════════════════
-- select key, value from public.site_stats;              -- maker_uses 518
-- select view_count from public.posts limit 3;           -- 0
-- 삭제 잠금: 투표 5개 이상 제안글에서 작성자 delete → 0 rows여야 함
