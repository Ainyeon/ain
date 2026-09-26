-- ═══════════════════════════════════════════════════════════════════
-- 17_work.sql — 에인연 업무(/work/) · 요금제 · 시공 카드 공개 링크 · 사진
--
-- 적용: 사용자가 검토한 뒤 Supabase SQL Editor에서 직접 실행한다.
--       (CLAUDE.md 절대 규칙: RLS/GRANT 변경 SQL은 파일로만 출력)
-- 로컬 검증: node tools/test-work-sql.mjs  (PGlite, 운영 DB 무접촉)
-- 재실행 안전: if not exists / create or replace / drop ... if exists. 끝의 단언 블록이 실패하면 전체 롤백.
--
-- 원칙
--  - 업무 데이터(고객·작업·사진·AS 문의)는 본인만 읽고 쓴다. 운영자 우회 정책 없음
--    (판매자 편 원칙 3 "고객은 기술자의 것").
--  - 기록은 요금제로 막지 않는다. 무료도 작업·고객·시공 카드 무제한. 프로는 사진 서버 보관·로고·표기 제거(·3D).
--  - 이 DB의 default ACL은 새 테이블·시퀀스·함수에 anon/authenticated 전체 권한을 주고, 함수는 PUBLIC에도 열린다.
--    그래서 모든 새 객체는 revoke all (public 포함) 후 필요한 권한만 다시 준다. 끝의 단언 블록이 이를 확인한다.
--  - 요금 등급은 profiles(전 회원 조회 가능)가 아닌 subscriptions에 둔다. 클라이언트 쓰기 권한 없음.
--  - 베타 종료 시각은 work_user_is_pro() 한 곳 (work/work-logic.js PLAN.betaEnd와 같아야 한다).
--  - updated_at·completed_at은 기존 관례대로 클라이언트가 넣는다 (운영 DB에 updated_at 트리거 없음).
-- ═══════════════════════════════════════════════════════════════════

begin;

do $$ begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'PG15+ 필요 (on delete set null 열 목록)';
  end if;
end $$;

-- ── 1) 요금제 ───────────────────────────────────────────────────────
-- 유료(또는 수동 부여) 프로 기간. 행이 없거나 기간이 지나면 무료. 베타는 행 없이 날짜로 판정.
create table if not exists public.subscriptions (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  source             text not null default 'manual' check (source in ('manual', 'toss')),
  current_period_end timestamptz not null,
  note               text check (note is null or char_length(note) <= 200),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated, public;
grant select (user_id, source, current_period_end, updated_at) on public.subscriptions to authenticated;   -- note(관리자 메모)는 제외
drop policy if exists "user reads own subscription" on public.subscriptions;
create policy "user reads own subscription" on public.subscriptions
  for select to authenticated using (user_id = auth.uid());

-- 청약·결제 원장. FK 없음: 탈퇴 후에도 법정 기간 보존(전자상거래법 시행령 6조). 정책 없음 = definer 함수만 쓴다.
create table if not exists public.billing_events (
  id           bigserial primary key,
  user_ref     uuid not null,
  kind         text not null check (kind in ('manual_grant', 'manual_revoke', 'charge', 'refund', 'cancel')),
  until_at     timestamptz,
  amount       integer check (amount is null or amount >= 0),
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  note         text check (note is null or char_length(note) <= 200),
  created_at   timestamptz not null default now()
);
alter table public.billing_events enable row level security;
revoke all on public.billing_events from anon, authenticated, public;
revoke all on sequence public.billing_events_id_seq from anon, authenticated, public;

-- 내부용: 그 사람이 지금 프로인가. 인자를 받으므로 클라이언트에 절대 열지 않는다(definer 함수 안에서만 호출).
create or replace function public.work_user_is_pro(p_user uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select now() < timestamptz '2027-05-01 00:00+09'          -- 베타: 2027-04-30까지 전원 프로, 끝나면 무료(자동 결제 없음)
      or exists (select 1 from public.subscriptions s
                  where s.user_id = p_user and s.current_period_end > now())
$$;
revoke all on function public.work_user_is_pro(uuid) from public, anon, authenticated;

-- 로그인한 본인이 지금 프로인가 (인자 없음 → 남의 요금제를 볼 수 없다)
create or replace function public.work_is_pro() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and public.work_user_is_pro(auth.uid())
$$;
revoke all on function public.work_is_pro() from public, anon, authenticated;
grant execute on function public.work_is_pro() to authenticated;

-- 관리자 수동 부여·회수 (계좌이체 확인 등). p_until이 null이거나 지났으면 회수. 행은 지우지 않는다.
create or replace function public.admin_set_plan(p_user uuid, p_until timestamptz, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_until timestamptz := coalesce(p_until, now());
begin
  if not public.is_admin_user() then raise exception 'admin only'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'no such user'; end if;
  insert into public.subscriptions (user_id, source, current_period_end, note)
  values (p_user, 'manual', v_until, left(p_note, 200))
  on conflict (user_id) do update
    set source = 'manual', current_period_end = excluded.current_period_end, note = excluded.note, updated_at = now();
  insert into public.billing_events (user_ref, kind, until_at, note)
  values (p_user, case when v_until > now() then 'manual_grant' else 'manual_revoke' end, v_until, left(p_note, 200));
end $$;
revoke all on function public.admin_set_plan(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.admin_set_plan(uuid, timestamptz, text) to authenticated;

-- ── 2) 업체 정보 (견적서·시공 카드에 찍힘) ──────────────────────────
create table if not exists public.work_profiles (
  user_id       uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  biz_name      text check (biz_name is null or char_length(biz_name) <= 40),
  owner_name    text check (owner_name is null or char_length(owner_name) <= 20),
  phone         text check (phone is null or phone ~ '^0[0-9]{8,10}$'),
  account       text check (account is null or char_length(account) <= 60),
  biz_no        text check (biz_no is null or biz_no ~ '^[0-9]{3}-?[0-9]{2}-?[0-9]{5}$'),
  intro         text check (intro is null or char_length(intro) <= 200),
  quote_note    text check (quote_note is null or char_length(quote_note) <= 500),
  logo_data     text check (logo_data is null or (char_length(logo_data) <= 200000
                                                  and logo_data ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')),
  sms_templates jsonb not null default '{}'::jsonb
                  check (case when jsonb_typeof(sms_templates) = 'object' then pg_column_size(sms_templates) <= 8192 else false end),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.work_profiles enable row level security;
revoke all on public.work_profiles from anon, authenticated, public;
grant select on public.work_profiles to authenticated;
grant insert (biz_name, owner_name, phone, account, biz_no, intro, quote_note, logo_data, sms_templates, updated_at)
  on public.work_profiles to authenticated;
grant update (biz_name, owner_name, phone, account, biz_no, intro, quote_note, logo_data, sms_templates, updated_at)
  on public.work_profiles to authenticated;
drop policy if exists "user reads own work profile" on public.work_profiles;
create policy "user reads own work profile" on public.work_profiles
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "user writes own work profile" on public.work_profiles;
create policy "user writes own work profile" on public.work_profiles
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "user updates own work profile" on public.work_profiles;
create policy "user updates own work profile" on public.work_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 3) 고객 (= 시공 장소. 시공 카드 링크가 고객 단위라 QR 스티커가 해마다 유지된다) ──
create table if not exists public.work_customers (
  id                   bigserial primary key,
  user_id              uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name                 text not null check (char_length(name) between 1 and 40 and name ~ '[^[:space:]]'),
  phone                text check (phone is null or phone ~ '^0[0-9]{8,10}$'),       -- 숫자만 저장
  address              text check (address is null or char_length(address) <= 200),
  memo                 text check (memo is null or char_length(memo) <= 4000),
  tag                  text check (tag in ('vip', 'caution')),
  revisit_months       int  check (revisit_months in (3, 6, 12, 24)),
  revisit_snooze_until date,                                                        -- 연락함·다음 달·보류
  card_token           text unique check (card_token ~ '^[A-Za-z0-9_-]{22}$'),       -- 서버(issue_card)만 쓴다
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, user_id)            -- 복합 FK 대상: 남의 고객을 참조하지 못하게
);
create index if not exists work_customers_user_phone on public.work_customers (user_id, phone);
alter table public.work_customers enable row level security;
revoke all on public.work_customers from anon, authenticated, public;
grant select, delete on public.work_customers to authenticated;
grant insert (name, phone, address, memo, tag, revisit_months, revisit_snooze_until, updated_at)
  on public.work_customers to authenticated;
grant update (name, phone, address, memo, tag, revisit_months, revisit_snooze_until, updated_at)
  on public.work_customers to authenticated;
revoke all on sequence public.work_customers_id_seq from anon, authenticated, public;
grant usage, select on sequence public.work_customers_id_seq to authenticated;
drop policy if exists "user manages own customers" on public.work_customers;
create policy "user manages own customers" on public.work_customers
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 4) 작업 ─────────────────────────────────────────────────────────
create table if not exists public.work_jobs (
  id              bigserial primary key,
  user_id         uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  customer_id     bigint,
  field           text check (field is null or field ~ '^[a-z-]{2,30}$'),
  work_type       text check (work_type in ('install', 'clean', 'repair', 'inspect', 'as', 'move', 'etc')),
  status          text not null default 'booked' check (status in ('inquiry', 'quote', 'booked', 'done', 'canceled')),
  scheduled_at    timestamptz,
  all_day         boolean not null default false,
  duration_min    int check (duration_min is null or duration_min between 0 and 1440),
  address         text check (address is null or char_length(address) <= 200),
  sido            text check (sido is null or sido ~ '^[가-힣]{2,4}$'),
  sigungu         text check (sigungu is null or (char_length(sigungu) <= 15 and sigungu ~ '^[가-힣]+(시|군|구)( [가-힣]+구)?$')),
  complex_id      bigint,     -- move_in_complexes.id. FK 금지: 수집 파이프라인(service_role) 재적재를 막지 않는다
  items           jsonb not null default '[]'::jsonb check (case when jsonb_typeof(items) = 'array'
                    then jsonb_array_length(items) <= 50 and pg_column_size(items) <= 16384 else false end),
  checklist       jsonb not null default '[]'::jsonb check (case when jsonb_typeof(checklist) = 'array'
                    then jsonb_array_length(checklist) <= 40 and pg_column_size(checklist) <= 8192 else false end),
  vat_mode        text not null default 'none' check (vat_mode in ('incl', 'excl', 'none')),
  total_amount    bigint not null default 0 check (total_amount between 0 and 2000000000),
  payments        jsonb not null default '[]'::jsonb check (case when jsonb_typeof(payments) = 'array'
                    then jsonb_array_length(payments) <= 30 and pg_column_size(payments) <= 4096 else false end),
  memo            text check (memo is null or char_length(memo) <= 2000),
  completed_at    timestamptz,
  source          text check (source in ('direct', 'repeat', 'referral', 'soomgo', 'danggeun', 'blog', 'order', 'etc')),
  referral_party  text check (referral_party is null or char_length(referral_party) <= 40),
  referral_fee    bigint check (referral_fee is null or referral_fee between 0 and 2000000000),
  parent_job_id   bigint,
  warranty_months int check (warranty_months is null or warranty_months between 0 and 120),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, user_id),
  foreign key (customer_id, user_id) references public.work_customers (id, user_id) on delete set null (customer_id),
  foreign key (parent_job_id, user_id) references public.work_jobs (id, user_id) on delete set null (parent_job_id)
);
create index if not exists work_jobs_user_sched on public.work_jobs (user_id, scheduled_at);
create index if not exists work_jobs_user_customer on public.work_jobs (user_id, customer_id);
alter table public.work_jobs enable row level security;
revoke all on public.work_jobs from anon, authenticated, public;
grant select, delete on public.work_jobs to authenticated;
grant insert (customer_id, field, work_type, status, scheduled_at, all_day, duration_min, address, sido, sigungu, complex_id,
              items, checklist, vat_mode, total_amount, payments, memo, completed_at, source, referral_party, referral_fee,
              parent_job_id, warranty_months, updated_at)
  on public.work_jobs to authenticated;
grant update (customer_id, field, work_type, status, scheduled_at, all_day, duration_min, address, sido, sigungu, complex_id,
              items, checklist, vat_mode, total_amount, payments, memo, completed_at, source, referral_party, referral_fee,
              parent_job_id, warranty_months, updated_at)
  on public.work_jobs to authenticated;
revoke all on sequence public.work_jobs_id_seq from anon, authenticated, public;
grant usage, select on sequence public.work_jobs_id_seq to authenticated;
drop policy if exists "user manages own jobs" on public.work_jobs;
create policy "user manages own jobs" on public.work_jobs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 5) 작업 사진 (프로: 서버 보관. 작업당 30장, 월 300장) ────────────
-- 흐름: 경로 생성 → work_photos 행 insert(여기서 요금제·한도 검사) → 그 경로로만 storage 업로드 허용.
create table if not exists public.work_photos (
  id         bigserial primary key,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  job_id     bigint not null,
  path       text not null unique,
  kind       text not null default 'etc' check (kind in ('before', 'after', 'etc')),
  created_at timestamptz not null default now(),
  foreign key (job_id, user_id) references public.work_jobs (id, user_id) on delete cascade,
  check (path ~ ('^' || user_id::text || '/' || job_id::text || '/[A-Za-z0-9_-]{8,40}\.(jpg|png|webp)$'))
);
create index if not exists work_photos_job on public.work_photos (user_id, job_id);
alter table public.work_photos enable row level security;
revoke all on public.work_photos from anon, authenticated, public;
grant select, delete on public.work_photos to authenticated;
grant insert (job_id, path, kind) on public.work_photos to authenticated;
grant update (kind) on public.work_photos to authenticated;
revoke all on sequence public.work_photos_id_seq from anon, authenticated, public;
grant usage, select on sequence public.work_photos_id_seq to authenticated;
drop policy if exists "user manages own photos" on public.work_photos;
create policy "user manages own photos" on public.work_photos
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 월 업로드 횟수 (삭제해도 줄지 않는다 → 올리고 지우기 반복으로 저장소를 채우지 못한다). 클라이언트 권한 없음.
create table if not exists public.work_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  ym      text not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  photos  int  not null default 0,
  primary key (user_id, ym)
);
alter table public.work_usage enable row level security;
revoke all on public.work_usage from anon, authenticated, public;

create or replace function public.work_photos_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if not public.work_user_is_pro(new.user_id) then raise exception 'plan_photos' using errcode = 'P0001'; end if;
  -- 같은 작업의 동시 insert를 한 줄로 세운다
  perform 1 from public.work_jobs where id = new.job_id and user_id = new.user_id for no key update;
  if (select count(*) from public.work_photos where job_id = new.job_id and user_id = new.user_id) >= 30 then
    raise exception 'photo_limit_job' using errcode = 'P0001';
  end if;
  insert into public.work_usage as u (user_id, ym, photos)
  values (new.user_id, to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM'), 1)
  on conflict (user_id, ym) do update set photos = u.photos + 1
  returning u.photos into v_n;                                   -- 행 잠금 → 동시 insert 직렬화
  if v_n > 300 then raise exception 'photo_limit_month' using errcode = 'P0001'; end if;
  return new;
end $$;
revoke all on function public.work_photos_before_insert() from public, anon, authenticated;
drop trigger if exists work_photos_before_insert on public.work_photos;
create trigger work_photos_before_insert before insert on public.work_photos
  for each row execute function public.work_photos_before_insert();

-- ── 6) 시공 카드 공개 링크 (고객 단위, 무료 무제한) ──────────────────
-- 토큰은 서버만 만든다. 122bit 난수 base64url 22자 (pg_catalog 함수만 → 확장 의존 없음). 이미 있으면 그대로.
create or replace function public.issue_card(p_customer bigint) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_tok text;
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  select card_token into v_tok from public.work_customers
   where id = p_customer and user_id = auth.uid() for update;
  if not found then raise exception 'not_found'; end if;
  if v_tok is not null then return v_tok; end if;
  v_tok := rtrim(translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), '=');
  update public.work_customers set card_token = v_tok where id = p_customer and user_id = auth.uid();
  return v_tok;
end $$;
revoke all on function public.issue_card(bigint) from public, anon, authenticated;
grant execute on function public.issue_card(bigint) to authenticated;

-- 링크 폐기 (유출 시). 다시 발급하면 새 링크.
create or replace function public.revoke_card(p_customer bigint) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.work_customers set card_token = null where id = p_customer and user_id = auth.uid();
$$;
revoke all on function public.revoke_card(bigint) from public, anon, authenticated;
grant execute on function public.revoke_card(bigint) to authenticated;

-- 공개 조회 (비로그인 고객). 필드 선별·마스킹은 여기서 끝낸다:
-- 고객 이름 마스킹, 지역은 시·군·구까지, 금액·연락처·주소·메모·id·user_id·사진 경로 없음. 실패는 모두 null.
create or replace function public.get_card(p_token text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'biz_name', coalesce(nullif(p.biz_name, ''), '시공 업체'),
    'biz_phone', p.phone,
    'biz_intro', p.intro,
    'pro', public.work_user_is_pro(c.user_id),
    'logo', case when public.work_user_is_pro(c.user_id) then p.logo_data end,
    'customer', case when char_length(c.name) <= 2 then left(c.name, 1) || '*'
                     else left(c.name, 1) || repeat('*', char_length(c.name) - 2) || right(c.name, 1) end,
    'region', (select nullif(trim(coalesce(j.sido, '') || ' ' || coalesce(j.sigungu, '')), '')
                 from public.work_jobs j where j.customer_id = c.id and j.user_id = c.user_id and j.sigungu is not null
                order by coalesce(j.completed_at, j.scheduled_at) desc nulls last limit 1),
    'jobs', coalesce((
      select jsonb_agg(x.o order by x.d desc) from (
        select j.completed_at as d, jsonb_build_object(
          'done_on', to_char(j.completed_at at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
          'field', j.field,
          'work_type', j.work_type,
          'items', (select coalesce(jsonb_agg(jsonb_build_object(
                       'name', left(e->>'name', 60), 'model', left(e->>'model', 60), 'unit', left(e->>'unit', 6),
                       'qty', case when (e->>'qty') ~ '^[0-9]{1,6}$' then (e->>'qty')::int end)), '[]'::jsonb)
                      from jsonb_array_elements(j.items) e
                     where jsonb_typeof(e) = 'object' and coalesce(e->>'name', '') <> ''
                       and coalesce(e->>'price', '') !~ '^-'),                         -- 할인 줄은 빼고
          'checklist', (select coalesce(jsonb_agg(jsonb_build_object('label', left(e->>'label', 40), 'value', left(e->>'value', 40))), '[]'::jsonb)
                          from jsonb_array_elements(j.checklist) e
                         where jsonb_typeof(e) = 'object' and coalesce(e->>'value', '') <> ''),
          'warranty_until', case when j.warranty_months > 0
            then to_char((j.completed_at at time zone 'Asia/Seoul') + make_interval(months => j.warranty_months), 'YYYY-MM-DD') end
        ) as o
        from public.work_jobs j
        where j.customer_id = c.id and j.user_id = c.user_id and j.status = 'done' and j.completed_at is not null
        order by j.completed_at desc limit 20) x), '[]'::jsonb)
  )
  from public.work_customers c
  left join public.work_profiles p on p.user_id = c.user_id
  where p_token ~ '^[A-Za-z0-9_-]{22}$' and c.card_token = p_token
$$;
revoke all on function public.get_card(text) from public, anon, authenticated;
grant execute on function public.get_card(text) to anon, authenticated;

-- 고객의 AS·재설치 문의. 삽입은 submit_card_request로만. 업체는 읽기·처리 표시·삭제(고객의 삭제 요구 대응)만, 내용 수정 불가.
create table if not exists public.work_card_requests (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,  -- 받는 업체. default auth.uid() 없음(anon 호출)
  customer_id bigint not null,
  kind        text not null check (kind in ('as', 'reinstall', 'etc')),
  message     text not null check (char_length(message) <= 1000 and message ~ '[^[:space:]]'),
  contact     text check (contact is null or contact ~ '^0[0-9]{8,10}$'),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (customer_id, user_id) references public.work_customers (id, user_id) on delete cascade
);
create index if not exists work_card_requests_user on public.work_card_requests (user_id, resolved_at, created_at desc);
create index if not exists work_card_requests_customer on public.work_card_requests (customer_id, created_at desc);
alter table public.work_card_requests enable row level security;
revoke all on public.work_card_requests from anon, authenticated, public;
grant select, delete on public.work_card_requests to authenticated;
grant update (resolved_at) on public.work_card_requests to authenticated;
revoke all on sequence public.work_card_requests_id_seq from anon, authenticated, public;
drop policy if exists "owner reads own card requests" on public.work_card_requests;
create policy "owner reads own card requests" on public.work_card_requests
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "owner deletes own card requests" on public.work_card_requests;
create policy "owner deletes own card requests" on public.work_card_requests
  for delete to authenticated using (user_id = auth.uid());
drop policy if exists "owner resolves own card requests" on public.work_card_requests;
create policy "owner resolves own card requests" on public.work_card_requests
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 카드당 24시간 3건, 미처리 20건. 같은 카드의 동시 요청은 고객 행 잠금으로 한 줄로 세운다.
-- kind·message·contact 형식은 테이블 NOT NULL·CHECK가 막는다(plpgsql의 NULL 통과 함정 없음).
create or replace function public.submit_card_request(p_token text, p_kind text, p_message text, p_contact text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cid bigint; v_uid uuid;
begin
  select id, user_id into v_cid, v_uid from public.work_customers
   where p_token ~ '^[A-Za-z0-9_-]{22}$' and card_token = p_token
   for no key update;
  if not found then raise exception 'not_found'; end if;
  if (select count(*) from public.work_card_requests
       where customer_id = v_cid and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.work_card_requests where customer_id = v_cid and resolved_at is null) >= 20 then
    raise exception 'too_many_open' using errcode = 'P0001';
  end if;
  insert into public.work_card_requests (user_id, customer_id, kind, message, contact)
  values (v_uid, v_cid, p_kind, btrim(p_message), nullif(regexp_replace(coalesce(p_contact, ''), '[^0-9]', '', 'g'), ''));
end $$;
revoke all on function public.submit_card_request(text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_card_request(text, text, text, text) to anon, authenticated;

-- ── 7) 사진 저장소 (비공개 버킷 'work', 1MB — 클라이언트가 긴 변 1600px JPEG로 줄여 올린다) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work', 'work', false, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 업로드: work_photos 행으로 먼저 예약한 경로만 (요금제·장수 검사는 행 insert에서 끝남)
drop policy if exists "work: upload reserved photo" on storage.objects;
create policy "work: upload reserved photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'work' and (storage.foldername(name))[1] = auth.uid()::text
              and exists (select 1 from public.work_photos p where p.path = objects.name and p.user_id = auth.uid()));
-- 읽기(서명 URL 포함): 행이 있는 내 파일만. 요금제와 무관 → 베타·구독이 끝나도 내 사진은 계속 보인다.
drop policy if exists "work: read own photo" on storage.objects;
create policy "work: read own photo" on storage.objects
  for select to authenticated
  using (bucket_id = 'work' and (storage.foldername(name))[1] = auth.uid()::text
         and exists (select 1 from public.work_photos p where p.path = objects.name and p.user_id = auth.uid()));
drop policy if exists "work: delete own photo" on storage.objects;
create policy "work: delete own photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'work' and (storage.foldername(name))[1] = auth.uid()::text);
-- UPDATE 정책은 만들지 않는다(덮어쓰기·move로 한도 우회 차단).

-- ── 8) 권한 단언: 하나라도 걸리면 전체 롤백 ─────────────────────────
do $$
declare bad text;
begin
  select string_agg(c.relname, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (c.relname like 'work\_%' or c.relname in ('subscriptions', 'billing_events'))
     and not c.relrowsecurity;
  if bad is not null then raise exception 'RLS 꺼짐: %', bad; end if;

  -- anon은 어떤 권한도 없다. authenticated도 TRUNCATE/REFERENCES/TRIGGER 없음, 서버 전용 표에는 쓰기 없음.
  select string_agg(c.relname || ':' || r.rol || ':' || x.p, ', ') into bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated')) r(rol)
   cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) x(p)
   where n.nspname = 'public' and c.relkind in ('r', 'v')
     and (c.relname like 'work\_%' or c.relname in ('subscriptions', 'billing_events'))
     and case when x.p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
              then has_any_column_privilege(r.rol, c.oid, x.p)
              else has_table_privilege(r.rol, c.oid, x.p) end
     and (r.rol = 'anon'
          or x.p in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
          or c.relname in ('billing_events', 'work_usage')
          or (c.relname = 'subscriptions' and x.p <> 'SELECT')
          or (c.relname = 'work_card_requests' and x.p = 'INSERT'));
  if bad is not null then raise exception '권한 잔존: %', bad; end if;

  -- 서버 전용 열은 클라이언트가 못 쓴다
  if has_column_privilege('authenticated', 'public.work_customers', 'card_token', 'UPDATE')
     or has_column_privilege('authenticated', 'public.work_customers', 'card_token', 'INSERT')
     or has_column_privilege('authenticated', 'public.work_customers', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.work_jobs', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.work_photos', 'path', 'UPDATE')
     or has_column_privilege('authenticated', 'public.work_photos', 'user_id', 'INSERT') then
    raise exception '서버 전용 열에 쓰기 권한 잔존';
  end if;

  -- anon이 실행할 수 있는 함수는 get_card·submit_card_request 둘뿐
  select string_agg(p.oid::regprocedure::text, ', ') into bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname not in ('get_card', 'submit_card_request')
     and (p.proname like 'work\_%' or p.proname in ('issue_card', 'revoke_card', 'admin_set_plan'))
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if bad is not null then raise exception 'anon 실행 가능: %', bad; end if;
  if has_function_privilege('authenticated', 'public.work_user_is_pro(uuid)', 'EXECUTE') then
    raise exception 'work_user_is_pro는 내부 전용';
  end if;
  if has_column_privilege('authenticated', 'public.subscriptions', 'note', 'SELECT') then
    raise exception 'subscriptions.note는 관리자 전용';
  end if;

  -- 정책은 정해진 것만 (예전 시험 정책이 남아 using(true)로 열리는 일 방지)
  select string_agg(tablename || ':' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and (tablename like 'work\_%' or tablename in ('subscriptions', 'billing_events'))
     and (tablename || ':' || policyname) not in (
       'subscriptions:user reads own subscription',
       'work_profiles:user reads own work profile', 'work_profiles:user writes own work profile', 'work_profiles:user updates own work profile',
       'work_customers:user manages own customers', 'work_jobs:user manages own jobs', 'work_photos:user manages own photos',
       'work_card_requests:owner reads own card requests', 'work_card_requests:owner resolves own card requests',
       'work_card_requests:owner deletes own card requests');
  if bad is not null then raise exception '예상 밖 정책: %', bad; end if;

  -- 저장소: work 버킷은 비공개. storage.objects 정책은 OR로 합쳐지므로 bucket_id 조건 없는 다른 정책이 있으면 work 버킷이 열린다
  if exists (select 1 from storage.buckets where id = 'work' and public) then raise exception 'work 버킷이 공개로 되어 있음'; end if;
  select string_agg(policyname, ', ') into bad
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname not like 'work:%'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%bucket_id%';
  if bad is not null then raise exception 'bucket_id 조건 없는 storage 정책(work 버킷까지 열림): %', bad; end if;
end $$;

commit;

-- ── 적용 후 확인 (읽기 전용) ─────────────────────────────────────────
--   select public.work_is_pro();                       -- 로그인 세션에서 (베타 중 true)
--   select tablename, rowsecurity from pg_tables where tablename like 'work_%' or tablename in ('subscriptions','billing_events');
-- 수동 확인(사각): 로그인 후 남의 uid 폴더·예약 안 한 경로로 업로드하면 거부되는지 (PGlite는 storage를 스텁으로만 검사)
-- 고아 파일 점검(관리자):
--   select o.name from storage.objects o where o.bucket_id = 'work'
--      and not exists (select 1 from public.work_photos p where p.path = o.name);
-- 관리자 수동 부여 예: select public.admin_set_plan('<user uuid>', '2027-06-01 00:00+09', '계좌이체 확인 9/30');
-- 회수: select public.admin_set_plan('<user uuid>', null, '환불');
