-- ═══════════════════════════════════════════════════════════════════
-- 20_studio.sql — 3D 스튜디오(/maker/3d/) 작업 대기열 · 비공개 저장소 'studio' · 작업 기계(운영자 맥)
--
-- 적용: 사용자가 검토한 뒤 Supabase SQL Editor에서 직접 실행한다. (CLAUDE.md: RLS/GRANT 변경 SQL은 파일로만)
-- 로컬 검증: node tools/test-studio-sql.mjs  (PGlite, 운영 DB 무접촉)
-- 재실행 안전: if not exists / create or replace / drop ... if exists. 끝의 단언 블록이 실패하면 전체 롤백.
--
-- 흐름
--  1. 회원: studio_submit(도구, 옵션, 파일 이름) → 작업 행(uploading)과 올릴 경로 <uid>/<작업>/in.확장자
--  2. 회원: 그 경로로만 저장소 업로드 → studio_ready → queued
--  3. 작업 기계(관리자가 만든 전용 auth 계정, service_role 안 씀): studio_claim → 입력 받기 → 엔진 → <uid>/<작업>/out/ 에 결과 →
--     studio_complete. 30초마다 studio_heartbeat (회원 화면에 '작업 기계 쉬는 중' 표시용)
--  4. 14일 지난 작업은 작업 기계가 studio_expire 로 받아 파일을 지운다(무료 저장 1GB).
-- 원칙
--  - 작업·결과는 본인만 본다. 결과 목록(outputs)은 클라이언트 열 권한 없이 studio_status 로만.
--  - 한도: 진행 중(올리는 중·대기·처리 중) 2건, 월 30건(접수 때 +1, 실패면 되돌림). 베타 동안 전원 같은 한도.
--  - 이 DB의 default ACL은 새 객체에 anon/authenticated 전체 권한을 준다 → 전부 revoke 후 필요한 것만 grant (17_work.sql 과 같음).
--  - 작업 기계 계정 등록(관리자, 계정을 만든 뒤 한 번): insert into public.studio_workers (user_id, name) values ('<uuid>', 'mac');
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1) 작업 기계 ────────────────────────────────────────────────────
create table if not exists public.studio_workers (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  name     text not null default 'mac',
  seen_at  timestamptz
);
alter table public.studio_workers enable row level security;
revoke all on public.studio_workers from anon, authenticated, public;

-- 로그인한 내가 작업 기계인가(인자 없음 — 남을 묻지 못한다). 저장소 정책이 부르므로 authenticated 실행 허용.
create or replace function public.studio_is_worker() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.studio_workers where user_id = auth.uid())
$$;
revoke all on function public.studio_is_worker() from public, anon, authenticated;
grant execute on function public.studio_is_worker() to authenticated;

-- ── 2) 작업 ─────────────────────────────────────────────────────────
create table if not exists public.studio_jobs (
  id           bigserial primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tool         text not null check (tool in ('plan3d', 'interior', 'design', 'aerial', 'views', 'mood', 'tone',
                                             'plan', 'iso', 'section', 'elev', 'report', 'erase', 'cutout')),
  params       jsonb not null default '{}'::jsonb,
  inputs       text[] not null default '{}',
  status       text not null default 'uploading' check (status in ('uploading', 'queued', 'running', 'done', 'failed', 'expired')),
  outputs      jsonb not null default '[]'::jsonb,
  error_ko     text,
  worker       uuid,
  created_at   timestamptz not null default now(),
  queued_at    timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists studio_jobs_queue on public.studio_jobs (status, queued_at);
create index if not exists studio_jobs_user on public.studio_jobs (user_id, id desc);
alter table public.studio_jobs enable row level security;
revoke all on public.studio_jobs from anon, authenticated, public;
grant select (id, tool, status, error_ko, created_at, finished_at) on public.studio_jobs to authenticated;   -- 결과 목록·입력 경로는 함수로만
revoke all on sequence public.studio_jobs_id_seq from anon, authenticated, public;
drop policy if exists "user reads own studio jobs" on public.studio_jobs;
create policy "user reads own studio jobs" on public.studio_jobs
  for select to authenticated using (user_id = auth.uid());

-- 월 접수 수(실패면 되돌림). 클라이언트 권한 없음.
create table if not exists public.studio_usage (
  user_id  uuid not null references auth.users(id) on delete cascade,
  ym       text not null,
  jobs     int not null default 0,
  primary key (user_id, ym)
);
alter table public.studio_usage enable row level security;
revoke all on public.studio_usage from anon, authenticated, public;

-- ── 3) 회원 함수 ────────────────────────────────────────────────────
create or replace function public.studio_submit(p_tool text, p_params jsonb, p_files text[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_id bigint;
  v_n int;
  v_paths text[];
  f text;
begin
  if v_uid is null then raise exception 'login_required' using errcode = 'P0001'; end if;
  if p_tool is null or p_tool not in ('plan3d', 'interior', 'design', 'aerial', 'views', 'mood', 'tone',
                                      'plan', 'iso', 'section', 'elev', 'report', 'erase', 'cutout') then
    raise exception 'tool_not_allowed' using errcode = 'P0001';
  end if;
  if p_files is null or cardinality(p_files) not between 1 and 2 then raise exception 'bad_file' using errcode = 'P0001'; end if;
  foreach f in array p_files loop
    if f is null or f !~ '^(in|mask)\.(dwg|dxf|pdf|png|jpg|jpeg|webp)$' then raise exception 'bad_file' using errcode = 'P0001'; end if;
  end loop;
  if p_files[1] !~ '^in\.' then raise exception 'bad_file' using errcode = 'P0001'; end if;
  if p_tool in ('erase', 'cutout') and p_files[1] !~ '^in\.(png|jpg|jpeg|webp)$' then raise exception 'bad_file' using errcode = 'P0001'; end if;
  if (p_tool = 'erase') <> (cardinality(p_files) = 2 and p_files[2] = 'mask.png') then raise exception 'bad_file' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_params, '{}'::jsonb)) <> 'object' or octet_length(coalesce(p_params, '{}'::jsonb)::text) > 2000 then
    raise exception 'bad_params' using errcode = 'P0001';
  end if;

  insert into public.studio_usage as u (user_id, ym, jobs)
  values (v_uid, to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'), 1)
  on conflict (user_id, ym) do update set jobs = u.jobs + 1
  returning u.jobs into v_n;                                   -- 행 잠금 → 같은 사람의 동시 접수가 한 줄로 선다
  if v_n > 30 then raise exception 'limit_month' using errcode = 'P0001'; end if;
  if (select count(*) from public.studio_jobs
       where user_id = v_uid
         and (status in ('queued', 'running') or (status = 'uploading' and created_at > now() - interval '1 hour'))) >= 2 then
    raise exception 'limit_active' using errcode = 'P0001';  -- 올리다 만 작업은 1시간 뒤 한도에서 빠진다
  end if;

  insert into public.studio_jobs (user_id, tool, params) values (v_uid, p_tool, coalesce(p_params, '{}'::jsonb)) returning id into v_id;
  select array_agg(v_uid::text || '/' || v_id || '/' || x order by o) into v_paths from unnest(p_files) with ordinality t(x, o);
  update public.studio_jobs set inputs = v_paths where id = v_id;
  return jsonb_build_object('id', v_id, 'paths', to_jsonb(v_paths));
end $$;
revoke all on function public.studio_submit(text, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.studio_submit(text, jsonb, text[]) to authenticated;

-- 입력 파일이 다 올라왔으면 대기열로
create or replace function public.studio_ready(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.studio_jobs j set status = 'queued', queued_at = now()
   where j.id = p_id and j.user_id = auth.uid() and j.status = 'uploading'
     and (select count(*) from storage.objects o where o.bucket_id = 'studio' and o.name = any (j.inputs)) = cardinality(j.inputs);
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
end $$;
revoke all on function public.studio_ready(bigint) from public, anon, authenticated;
grant execute on function public.studio_ready(bigint) to authenticated;

-- 상태 · 앞 순번 · 작업 기계 살아 있음 · (끝났으면) 결과 목록
create or replace function public.studio_status(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'status', j.status,
    'error_ko', j.error_ko,
    'outputs', case when j.status = 'done' then j.outputs else '[]'::jsonb end,
    'ahead', case when j.status = 'queued' then
      (select count(*) from public.studio_jobs q where q.status = 'running' or (q.status = 'queued' and q.queued_at < j.queued_at)) end,
    'worker_alive', exists (select 1 from public.studio_workers w where w.seen_at > now() - interval '3 minutes'))
    into r
    from public.studio_jobs j where j.id = p_id and j.user_id = auth.uid();
  if r is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  return r;
end $$;
revoke all on function public.studio_status(bigint) from public, anon, authenticated;
grant execute on function public.studio_status(bigint) to authenticated;

-- ── 4) 작업 기계 함수 (studio_workers 에 등록된 계정만) ──────────────
create or replace function public.studio_heartbeat() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.studio_workers set seen_at = now() where user_id = auth.uid();
  if not found then raise exception 'worker_only' using errcode = 'P0001'; end if;
end $$;
revoke all on function public.studio_heartbeat() from public, anon, authenticated;
grant execute on function public.studio_heartbeat() to authenticated;

-- 가장 오래 기다린 작업 하나를 맡는다. 2시간 넘게 처리 중인 작업은 실패로 정리(기계가 꺼졌던 경우).
create or replace function public.studio_claim() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.studio_jobs;
begin
  if not public.studio_is_worker() then raise exception 'worker_only' using errcode = 'P0001'; end if;
  update public.studio_workers set seen_at = now() where user_id = auth.uid();
  update public.studio_jobs set status = 'failed', finished_at = now(), error_ko = '처리 시간이 너무 길어 멈췄습니다. 다시 올려 주세요.'
   where status = 'running' and started_at < now() - interval '2 hours';
  select * into j from public.studio_jobs where status = 'queued' order by queued_at, id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.studio_jobs set status = 'running', started_at = now(), worker = auth.uid() where id = j.id;
  return jsonb_build_object('id', j.id, 'user_id', j.user_id, 'tool', j.tool, 'params', j.params, 'inputs', to_jsonb(j.inputs));
end $$;
revoke all on function public.studio_claim() from public, anon, authenticated;
grant execute on function public.studio_claim() to authenticated;

-- 끝내기. 결과 경로는 그 작업의 out/ 아래만. 실패면 그달 접수 수를 되돌린다.
create or replace function public.studio_complete(p_id bigint, p_ok boolean, p_outputs jsonb, p_error text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j public.studio_jobs; e jsonb;
begin
  if not public.studio_is_worker() then raise exception 'worker_only' using errcode = 'P0001'; end if;
  select * into j from public.studio_jobs where id = p_id and status = 'running' and worker = auth.uid() for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_ok then
    if jsonb_typeof(p_outputs) <> 'array' or jsonb_array_length(p_outputs) > 60 then raise exception 'bad_outputs' using errcode = 'P0001'; end if;
    for e in select * from jsonb_array_elements(p_outputs) loop
      if jsonb_typeof(e) <> 'object' or coalesce(e->>'path', '') not like j.user_id::text || '/' || j.id || '/out/%'
         or coalesce(e->>'kind', '') not in ('image', 'summary') or length(coalesce(e->>'caption', '')) > 200 then
        raise exception 'bad_outputs' using errcode = 'P0001';
      end if;
    end loop;
    update public.studio_jobs set status = 'done', outputs = p_outputs, finished_at = now() where id = p_id;
  else
    update public.studio_jobs set status = 'failed', error_ko = left(coalesce(p_error, '만들지 못했습니다.'), 300), finished_at = now() where id = p_id;
    update public.studio_usage set jobs = greatest(jobs - 1, 0)
     where user_id = j.user_id and ym = to_char(j.created_at at time zone 'Asia/Seoul', 'YYYY-MM');
  end if;
end $$;
revoke all on function public.studio_complete(bigint, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.studio_complete(bigint, boolean, jsonb, text) to authenticated;

-- 14일 지난 작업을 보관 끝으로 돌리고 지울 폴더(<uid>/<작업>/)를 돌려준다. 작업 기계가 저장소 API로 지운다.
create or replace function public.studio_expire() returns setof text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.studio_is_worker() then raise exception 'worker_only' using errcode = 'P0001'; end if;
  return query
    update public.studio_jobs set status = 'expired', outputs = '[]'::jsonb
     where (status in ('done', 'failed') and finished_at < now() - interval '14 days')
        or (status = 'uploading' and created_at < now() - interval '1 day')
    returning user_id::text || '/' || id || '/';
end $$;
revoke all on function public.studio_expire() from public, anon, authenticated;
grant execute on function public.studio_expire() to authenticated;

-- ── 5) 저장소 (비공개 'studio', 20MB — DWG·PDF 도면이 있어 work 버킷보다 크다) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio', 'studio', false, 20971520,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/json',
              'application/octet-stream', 'image/vnd.dwg', 'application/acad', 'application/dxf', 'image/vnd.dxf'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 정책 판단은 definer 함수로(회원에게 studio_jobs.inputs·user_id 열 권한이 없어 정책 안 하위 질의가 permission denied 였다).
-- 함수는 '로그인한 내가 이 경로에 …할 수 있나'만 참·거짓으로 돌려준다.
create or replace function public.studio_may_upload(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.studio_jobs j where j.user_id = auth.uid() and j.status = 'uploading' and p_name = any (j.inputs))
$$;
create or replace function public.studio_worker_may_read(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.studio_is_worker() and exists (select 1 from public.studio_jobs j
    where ((j.status = 'running' and j.worker = auth.uid()) or j.status = 'expired')   -- 보관 끝 폴더도(지우기가 지울 행을 읽는다)
      and p_name like j.user_id::text || '/' || j.id || '/%')                     -- 맡은 작업 폴더(입력 + 방금 올린 결과 — 업로드가 올린 행을 다시 읽는다)
$$;
create or replace function public.studio_worker_may_write(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.studio_is_worker() and exists (select 1 from public.studio_jobs j
    where j.status = 'running' and j.worker = auth.uid() and p_name like j.user_id::text || '/' || j.id || '/out/%' and p_name not like '%..%')
$$;
create or replace function public.studio_worker_may_delete(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.studio_is_worker() and exists (select 1 from public.studio_jobs j where j.status = 'expired' and p_name like j.user_id::text || '/' || j.id || '/%')
$$;
revoke all on function public.studio_may_upload(text), public.studio_worker_may_read(text), public.studio_worker_may_write(text),
  public.studio_worker_may_delete(text) from public, anon, authenticated;
grant execute on function public.studio_may_upload(text), public.studio_worker_may_read(text), public.studio_worker_may_write(text),
  public.studio_worker_may_delete(text) to authenticated;

-- 회원 업로드: 접수 때 예약한 입력 경로만(올리는 중인 내 작업)
drop policy if exists "studio: upload reserved input" on storage.objects;
create policy "studio: upload reserved input" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'studio' and (storage.foldername(name))[1] = auth.uid()::text and public.studio_may_upload(name));
-- 회원 읽기(서명 URL 포함): 내 폴더
drop policy if exists "studio: read own" on storage.objects;
create policy "studio: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'studio' and (storage.foldername(name))[1] = auth.uid()::text);
-- 작업 기계: 맡은 작업 폴더 읽기 · out/ 쓰기 · 보관 끝난 작업 지우기
drop policy if exists "studio: worker reads claimed input" on storage.objects;
create policy "studio: worker reads claimed input" on storage.objects
  for select to authenticated using (bucket_id = 'studio' and public.studio_worker_may_read(name));
drop policy if exists "studio: worker writes output" on storage.objects;
create policy "studio: worker writes output" on storage.objects
  for insert to authenticated with check (bucket_id = 'studio' and public.studio_worker_may_write(name));
drop policy if exists "studio: worker deletes expired" on storage.objects;
create policy "studio: worker deletes expired" on storage.objects
  for delete to authenticated using (bucket_id = 'studio' and public.studio_worker_may_delete(name));
-- UPDATE 정책은 만들지 않는다(덮어쓰기·move 차단). 회원 삭제도 없음(보관 끝은 작업 기계가).

-- ── 6) 권한 단언: 하나라도 걸리면 전체 롤백 ─────────────────────────
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'studio\_%' and not c.relrowsecurity;
  if bad is not null then raise exception 'RLS 꺼짐: %', bad; end if;

  -- anon 권한 0. authenticated 는 studio_jobs 의 정해진 열 SELECT 뿐.
  select string_agg(c.relname || ':' || r.rol || ':' || x.p, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated')) r(rol)
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) x(p)
   where n.nspname = 'public' and c.relkind in ('r', 'v') and c.relname like 'studio\_%'
     and case when x.p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
              then has_any_column_privilege(r.rol, c.oid, x.p)
              else has_table_privilege(r.rol, c.oid, x.p) end
     and (r.rol = 'anon' or x.p <> 'SELECT' or c.relname <> 'studio_jobs');
  if bad is not null then raise exception '권한 잔존: %', bad; end if;
  if has_column_privilege('authenticated', 'public.studio_jobs', 'outputs', 'SELECT')
     or has_column_privilege('authenticated', 'public.studio_jobs', 'inputs', 'SELECT')
     or has_column_privilege('authenticated', 'public.studio_jobs', 'params', 'SELECT') then
    raise exception 'studio_jobs 결과·입력·옵션 열은 함수로만';
  end if;

  -- anon 이 실행할 수 있는 studio 함수 0
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'studio\_%' and has_function_privilege('anon', p.oid, 'EXECUTE');
  if bad is not null then raise exception 'anon 실행 가능: %', bad; end if;

  select string_agg(tablename || ':' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public' and tablename like 'studio\_%'
     and (tablename || ':' || policyname) not in ('studio_jobs:user reads own studio jobs');
  if bad is not null then raise exception '예상 밖 정책: %', bad; end if;

  if exists (select 1 from storage.buckets where id = 'studio' and public) then raise exception 'studio 버킷이 공개로 되어 있음'; end if;
  select string_agg(policyname, ', ') into bad
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%bucket_id%';
  if bad is not null then raise exception 'bucket_id 조건 없는 storage 정책(studio 버킷까지 열림): %', bad; end if;
end $$;

commit;

-- ── 적용 후 (관리자) ────────────────────────────────────────────────
-- 1) Authentication → Users 에서 작업 기계 계정을 만든다(이메일·긴 비밀번호, 이 맥 키체인에만 보관).
-- 2) insert into public.studio_workers (user_id, name) values ('<그 계정 uuid>', 'mac');
-- 확인(읽기 전용):
--   select status, count(*) from public.studio_jobs group by 1;
--   select name, seen_at from public.studio_workers;
