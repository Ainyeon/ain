-- 19_admin_drafts.sql — 운영자만 보는 초안 페이지(요금제 등)의 본문
--
-- 왜: 요금제는 시장 진입(모두의 창업 결과 발표) 전까지 운영자만 본다(2026-09-26 사용자 결정).
--     공개 저장소·사이트 HTML에 본문을 두면 누구나 읽는다. 본문은 이 표에 두고 /pricing/ 은 빈 틀만 배포한다.
-- 읽기: 로그인한 운영자(profiles.role = 'admin', is_admin_user())만. 일반 회원은 0행, anon 은 권한 없음.
-- 쓰기: SQL(대시보드·Claude MCP)로만. anon/authenticated 에는 쓰기 권한이 없다.
-- 적용: 2026-09-26부터 Claude가 Supabase MCP로 적용(사용자 위임). 끝의 단언이 실패하면 전체가 롤백된다.

begin;

create table if not exists public.admin_drafts (
  slug       text primary key check (slug ~ '^[a-z0-9-]{1,40}$'),
  html       text not null check (length(html) <= 200000),
  updated_at timestamptz not null default now()
);

alter table public.admin_drafts enable row level security;
revoke all on public.admin_drafts from anon, authenticated, public;
grant select on public.admin_drafts to authenticated;

drop policy if exists "admin reads drafts" on public.admin_drafts;
create policy "admin reads drafts" on public.admin_drafts
  for select to authenticated using (public.is_admin_user());

-- 권한 단언 — 새 표에 붙는 기본 권한(anon/authenticated 전체)이 남아 있으면 적용 실패
do $$
begin
  if has_table_privilege('anon', 'public.admin_drafts', 'select') then
    raise exception '권한 잔존: anon 이 admin_drafts 를 읽을 수 있음';
  end if;
  if has_table_privilege('authenticated', 'public.admin_drafts', 'insert')
     or has_table_privilege('authenticated', 'public.admin_drafts', 'update')
     or has_table_privilege('authenticated', 'public.admin_drafts', 'delete')
     or has_table_privilege('authenticated', 'public.admin_drafts', 'truncate') then
    raise exception '권한 잔존: authenticated 가 admin_drafts 에 쓸 수 있음';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.admin_drafts'::regclass) then
    raise exception 'RLS 꺼짐: admin_drafts';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'admin_drafts') <> 1 then
    raise exception '예상 밖 정책: admin_drafts 정책이 1개가 아님';
  end if;
end $$;

commit;
