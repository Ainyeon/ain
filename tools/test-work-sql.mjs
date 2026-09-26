// supabase/17_work.sql 검사 — 실제 Postgres(PGlite, WASM)에서 운영 DB를 건드리지 않고 돌린다.
//
// 준비(한 번): npm i --prefix tools   (tools/package.json의 PGlite 1개. node_modules는 gitignore)
//   또는 설치된 경로를 PGLITE 환경변수로:  PGLITE=/path/to/@electric-sql/pglite/dist/index.js
// 실행: node tools/test-work-sql.mjs
//
// 운영 Supabase를 흉내 내는 부분 (2026-09-26 읽기 조사 기준)
//  - 역할 anon/authenticated, auth.uid()는 운영 정의와 같게 (request.jwt.claim.sub)
//  - default ACL: public의 새 테이블·시퀀스·함수에 anon/authenticated 전체 권한 → revoke 누락을 잡는다
//  - profiles(전 회원 조회), is_admin_user(), storage.buckets/objects/foldername
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite')); }
catch (e) {
  console.error('PGlite가 없습니다.  npm i --prefix tools  후 다시 실행하세요.');
  process.exit(2);
}
const SQL = fs.readFileSync(path.join(repo, 'supabase/17_work.sql'), 'utf8');
const L = (await import(path.join(repo, 'work/work-logic.js'))).default;

const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema auth; grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text, field text, region text, role text not null default 'member', is_admin boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now());
alter table public.profiles enable row level security;
create policy "members read profiles" on public.profiles for select to authenticated using (true);
create function public.is_admin_user() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create schema storage; grant usage on schema storage to anon, authenticated;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid default auth.uid(), created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated; grant select on storage.buckets to anon, authenticated;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $$;
grant execute on function storage.foldername(text) to anon, authenticated;
`;
const db = new PGlite();
await db.exec(STUB);

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const ADMIN = '00000000-0000-4000-8000-0000000000ad';
const NOPROFILE = '00000000-0000-4000-8000-0000000000ff';
await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${ADMIN}'),('${NOPROFILE}');
  insert into public.profiles (id, nickname, role) values ('${A}','에이','member'),('${B}','비','member'),('${ADMIN}','운영','admin');`);

// SQL 두 번 적용 — 재실행 안전 확인 (끝의 권한 단언 블록도 두 번 통과해야 한다)
await db.exec(SQL);
await db.exec(SQL);
// 베타 종료 뒤를 흉내 낼 때 쓰는 사본: 같은 함수 본문, 종료 시각만 과거로
const BETA_LIT = "timestamptz '2027-05-01 00:00+09'";
assert.ok(SQL.includes(BETA_LIT), '베타 종료 시각 리터럴');
assert.equal(new Date(L.PLAN.betaEnd).getTime(), new Date('2027-05-01T00:00:00+09:00').getTime(), 'JS PLAN.betaEnd = SQL 베타 종료');
const SQL_AFTER_BETA = SQL.replace(BETA_LIT, "timestamptz '2020-01-01 00:00+09'");

async function as(uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec('reset role'); }
}
async function fails(p, re, label) {
  try { await p; } catch (e) { if (re) assert.match(e.message, re, label + ' → ' + e.message); return e; }
  assert.fail(label + ': 실패해야 하는데 통과함');
}
const one = async (uid, sql, params) => (await as(uid, sql, params))[0];
let n = 0; const ok = (m) => { n++; if (process.env.VERBOSE) console.log('  ✓', m); };

// ── 권한: anon은 업무 테이블·내부 함수에 손을 못 댄다
for (const t of ['work_jobs', 'work_customers', 'work_photos', 'work_card_requests', 'work_profiles', 'subscriptions', 'work_usage', 'billing_events']) {
  await fails(as(null, `select * from public.${t}`), /permission denied/, `anon select ${t}`);
}
for (const f of ['work_is_pro()', 'issue_card(1)', 'revoke_card(1)', `admin_set_plan('${A}', null, null)`, `work_user_is_pro('${A}')`]) {
  await fails(as(null, `select public.${f}`), /permission denied/, `anon ${f}`);
}
await fails(as(A, 'select * from public.work_usage'), /permission denied/, '회원도 work_usage 직접 조회 불가');
await fails(as(A, 'select * from public.billing_events'), /permission denied/, '회원도 원장 조회 불가');
await fails(as(A, `select public.work_user_is_pro('${B}')`), /permission denied/, '남의 요금제 조회 함수 호출 불가');
ok('anon·내부 함수 차단');

// ── 고객·작업: 본인만
const cA = await one(A, `insert into public.work_customers (name, phone, address, revisit_months) values ('홍길동','01012345678','인천 서구 청라동 1',6) returning id, user_id`);
assert.equal(cA.user_id, A, 'user_id 기본값 = 로그인 사용자');
await one(B, `insert into public.work_customers (name) values ('비고객') returning id`);
assert.equal((await as(B, 'select * from public.work_customers')).length, 1);
assert.equal((await as(A, 'select * from public.work_customers')).length, 1);
await fails(as(B, `insert into public.work_customers (user_id, name) values ('${A}', '남의 것')`), /permission denied/, '남 명의로 고객 등록(user_id 열 권한 없음)');
assert.equal((await as(B, `update public.work_customers set name='탈취' where id=${cA.id} returning id`)).length, 0, '남 고객 수정 0행');
assert.equal((await as(B, `delete from public.work_customers where id=${cA.id} returning id`)).length, 0, '남 고객 삭제 0행');
await fails(as(A, `insert into public.work_customers (name, phone) values ('x','010-1234-5678')`), /check constraint/, '전화는 숫자만 저장');
await fails(as(A, `update public.work_customers set card_token = 'AAAAAAAAAAAAAAAAAAAAAA' where id=${cA.id}`), /permission denied/, '카드 토큰 직접 쓰기 불가');
ok('고객 격리·열 권한');

const jA = await one(A, `insert into public.work_jobs (customer_id, field, work_type, status, scheduled_at, address, sido, sigungu, items, total_amount, payments)
  values (${cA.id}, 'ac-clean', 'clean', 'booked', now(), '인천 서구 청라동 1', '인천', '서구',
          '[{"name":"벽걸이","qty":2,"unit":"대","price":50000},{"name":"할인","qty":1,"price":-10000}]', 90000,
          '[{"amount":30000,"at":"2026-09-26","method":"transfer"}]') returning id, user_id`);
assert.equal(jA.user_id, A);
await fails(as(B, `insert into public.work_jobs (customer_id, status) values (${cA.id}, 'inquiry')`), /foreign key/, '남의 고객에 작업 연결(복합 FK)');
await fails(as(B, `insert into public.work_jobs (parent_job_id, status) values (${jA.id}, 'inquiry')`), /foreign key/, '남의 작업을 부모로 연결');
assert.equal((await as(B, `select * from public.work_jobs`)).length, 0);
await fails(as(A, `update public.work_jobs set user_id = '${B}' where id=${jA.id}`), /permission denied/, '소유자 변경 불가');
await fails(as(A, `update public.work_jobs set created_at = '2000-01-01' where id=${jA.id}`), /permission denied/, 'created_at 쓰기 불가');
await fails(as(A, `insert into public.work_jobs (status, items) values ('booked', '{"x":1}')`), /check constraint/, 'items는 배열');
await fails(as(A, `insert into public.work_jobs (status, payments) values ('booked', '"x"')`), /check constraint/, 'payments는 배열');
await fails(as(A, `insert into public.work_jobs (status, sigungu) values ('booked', '서구 청라동 123-4 101동')`), /check constraint/, '시군구 칸에 상세 주소 불가');
await fails(as(A, `insert into public.work_jobs (status, total_amount) values ('booked', -1)`), /check constraint/, '음수 합계');
await as(A, `insert into public.work_jobs (status, sigungu) values ('inquiry', '수원시 영통구')`);
ok('작업 격리·복합 FK·열 권한·입력 제약');

// 고객 삭제 → 작업의 customer_id만 비움 (작업·금액은 남는다)
const cTmp = await one(A, `insert into public.work_customers (name) values ('임시') returning id`);
const jTmp = await one(A, `insert into public.work_jobs (customer_id, status, total_amount) values (${cTmp.id}, 'done', 50000) returning id`);
await as(A, `delete from public.work_customers where id=${cTmp.id}`);
const jAfter = await one(A, `select customer_id, user_id, total_amount from public.work_jobs where id=${jTmp.id}`);
assert.equal(jAfter.customer_id, null); assert.equal(jAfter.user_id, A); assert.equal(Number(jAfter.total_amount), 50000);
ok('고객 삭제 시 작업 보존');

// 기록은 요금제로 막지 않는다: 무료(베타 뒤)에도 작업 등록 무제한
for (let i = 0; i < 40; i++) await as(B, `insert into public.work_jobs (status) values ('inquiry')`);
ok('작업 등록 무제한');

// ── 요금제: 베타 중 전원 프로, 구독 표는 읽기만
assert.equal((await one(A, 'select public.work_is_pro() as v')).v, true, '베타 중 프로');
await fails(as(A, `insert into public.subscriptions (user_id, current_period_end) values ('${A}', now() + interval '1 year')`), /permission denied/, '구독 직접 생성');
await fails(as(A, `update public.subscriptions set current_period_end = now() + interval '9 years'`), /permission denied/, '구독 직접 수정');
ok('베타·구독 쓰기 차단');

// ── 사진: 예약 경로 → 업로드. 작업당 30장, 경로 규칙
const photo = (uid, job, f) => `${uid}/${job}/${f}`;
const reserve = (uid, job, f) => as(uid, `insert into public.work_photos (job_id, path, kind) values (${job}, '${photo(uid, job, f)}', 'after')`);
await reserve(A, jA.id, 'p00000000.jpg');
await as(A, `insert into storage.objects (bucket_id, name) values ('work', '${photo(A, jA.id, 'p00000000.jpg')}')`);
await fails(as(A, `insert into storage.objects (bucket_id, name) values ('work', '${photo(A, jA.id, 'notreserved.jpg')}')`), /row-level security/, '예약 안 한 경로 업로드');
await fails(as(A, `insert into storage.objects (bucket_id, name) values ('work', '${photo(B, jA.id, 'p00000000.jpg')}')`), /row-level security/, '남의 폴더 업로드');
await fails(as(A, `insert into storage.objects (bucket_id, name) values ('other', '${photo(A, jA.id, 'p00000000.jpg')}')`), /row-level security|foreign key/, '다른 버킷');
assert.equal((await as(A, `update storage.objects set name = name || 'x' where bucket_id = 'work' returning name`)).length, 0, '덮어쓰기·이동 불가(UPDATE 정책 없음)');
assert.equal((await as(B, `select * from storage.objects where bucket_id='work'`)).length, 0, '남의 파일 안 보임');
assert.equal((await as(A, `select * from storage.objects where bucket_id='work'`)).length, 1);
for (let i = 1; i < L.PLAN.pro.photosPerJob; i++) await reserve(A, jA.id, 'p' + String(i).padStart(8, '0') + '.jpg');
await fails(reserve(A, jA.id, 'overlimit.jpg'), /photo_limit_job/, `${L.PLAN.pro.photosPerJob + 1}번째 사진`);
const jA2 = await one(A, `insert into public.work_jobs (status) values ('inquiry') returning id`);
await fails(as(A, `insert into public.work_photos (job_id, path) values (${jA2.id}, '${photo(A, jA.id, 'yyyyyyyy.jpg')}')`), /check constraint/, '경로의 작업 번호 불일치');
await fails(as(A, `insert into public.work_photos (job_id, path) values (${jA2.id}, '${photo(B, jA2.id, 'yyyyyyyy.jpg')}')`), /check constraint/, '경로의 uid 불일치');
await fails(as(A, `insert into public.work_photos (job_id, path) values (${jA2.id}, '${photo(A, jA2.id, '../../x.jpg')}')`), /check constraint/, '경로 조작');
await fails(as(A, `update public.work_photos set path = '${photo(A, jA2.id, 'zzzzzzzz.jpg')}'`), /permission denied/, '경로 수정 불가');
await fails(as(B, `insert into public.work_photos (job_id, path) values (${jA.id}, '${photo(B, jA.id, 'bbbbbbbb.jpg')}')`), /foreign key/, '남의 작업에 사진');
ok('사진 예약 업로드·한도·경로·스토리지 정책');

// 월 1000장: 지워도 줄지 않는 카운터 (올리고 지우기 반복 차단)
await db.exec(`update public.work_usage set photos = ${L.PLAN.pro.photosPerMonth - 1} where user_id = '${A}'`);
await reserve(A, jA2.id, 'm0000000.jpg');
await as(A, `delete from public.work_photos where job_id = ${jA2.id}`);
await fails(reserve(A, jA2.id, 'm0000001.jpg'), /photo_limit_month/, '월 한도: 삭제 후 재등록도 센다');
await db.exec(`update public.work_usage set photos = 0 where user_id = '${A}'`);
ok('월 사진 한도');

// ── 베타 종료 → 무료: 새 사진 보관만 막히고, 기존 사진·기록은 그대로 (자동 결제 없음)
await db.exec(SQL_AFTER_BETA);
assert.equal((await one(A, 'select public.work_is_pro() as v')).v, false, '베타 뒤 무료');
await fails(reserve(A, jA2.id, 'afterbeta.jpg'), /plan_photos/, '무료는 사진 보관 불가');
assert.equal((await as(A, `select * from storage.objects where bucket_id='work'`)).length, 1, '베타 뒤에도 내 사진은 보인다');
await as(A, `insert into public.work_jobs (status) values ('inquiry')`);
ok('베타 종료 뒤 무료 전환');

// ── 관리자 수동 부여·회수 (원장 기록, 행은 지우지 않음)
await fails(as(A, `select public.admin_set_plan('${A}', now() + interval '30 days', 'x')`), /admin only/, '비관리자 부여');
await as(ADMIN, `select public.admin_set_plan('${A}', now() + interval '30 days', '계좌이체 확인')`);
assert.equal((await one(A, 'select public.work_is_pro() as v')).v, true, '수동 부여 → 프로');
assert.equal((await as(A, 'select source, current_period_end from public.subscriptions')).length, 1, '내 구독은 보임');
await fails(as(A, 'select note from public.subscriptions'), /permission denied/, '관리자 메모는 안 보임');
assert.equal((await as(B, 'select source, current_period_end from public.subscriptions')).length, 0, '남의 구독 안 보임');
await reserve(A, jA2.id, 'granted0.jpg');
await as(ADMIN, `select public.admin_set_plan('${A}', null, '환불')`);
assert.equal((await one(A, 'select public.work_is_pro() as v')).v, false, '회수 → 무료');
const ledger = (await db.query(`select kind from public.billing_events where user_ref = '${A}' order by id`)).rows.map((r) => r.kind);
assert.deepEqual(ledger, ['manual_grant', 'manual_revoke']);
assert.equal((await as(ADMIN, 'select * from public.work_jobs')).length, 0, '관리자도 남의 업무 데이터는 안 보임');
await fails(as(ADMIN, `select public.admin_set_plan('${NOPROFILE}', now() + interval '1 day')`), /no such user/, '없는 회원');
ok('관리자 부여·회수·원장·운영자 우회 없음');
await db.exec(SQL);  // 다시 베타 중으로

// ── 시공 카드 (고객 단위, 무료 무제한)
await as(A, `insert into public.work_profiles (biz_name, phone, intro, account, biz_no, logo_data) values ('시원설비','01099990000','에어컨 세척 전문','농협 123-45','123-45-67890','data:image/png;base64,iVBORw0KGgo=')`);
await fails(as(B, `insert into public.work_profiles (user_id, biz_name) values ('${A}','x')`), /permission denied/, '남 업체 정보');
assert.equal((await as(B, 'select * from public.work_profiles')).length, 0, '남의 업체 정보(계좌·사업자번호) 안 보임');
await fails(as(A, `update public.work_profiles set logo_data = 'javascript:alert(1)'`), /check constraint/, '로고는 이미지 data URL만');
await as(A, `update public.work_jobs set status='done', completed_at = now(), warranty_months = 12,
  checklist = '[{"label":"사용 약품","value":"중성 세정제"},{"label":"냄새 확인","value":""}]' where id=${jA.id}`);
const tok = (await one(A, `select public.issue_card(${cA.id}) as t`)).t;
assert.match(tok, /^[A-Za-z0-9_-]{22}$/);
assert.equal((await one(A, `select public.issue_card(${cA.id}) as t`)).t, tok, '같은 고객은 같은 링크 (QR 유지)');
await fails(as(B, `select public.issue_card(${cA.id})`), /not_found/, '남의 고객 카드 발급');
const card = (await one(null, `select public.get_card($1) as c`, [tok])).c;
assert.equal(card.biz_name, '시원설비');
assert.equal(card.customer, '홍*동', '고객 이름 마스킹');
assert.equal(card.region, '인천 서구');
assert.equal(card.pro, true); assert.ok(card.logo, '프로면 로고');
assert.equal(card.jobs.length, 1);
assert.deepEqual(card.jobs[0].items, [{ name: '벽걸이', model: null, unit: '대', qty: 2 }], '할인 줄·금액 빠짐');
assert.deepEqual(card.jobs[0].checklist, [{ label: '사용 약품', value: '중성 세정제' }]);
assert.ok(card.jobs[0].warranty_until);
assert.deepEqual(Object.keys(card).sort(), ['biz_intro', 'biz_name', 'biz_phone', 'customer', 'jobs', 'logo', 'pro', 'region'], '카드 필드 목록 고정');
assert.deepEqual(Object.keys(card.jobs[0]).sort(), ['checklist', 'done_on', 'field', 'items', 'warranty_until', 'work_type']);
const cardText = JSON.stringify(card);
for (const leak of ['01012345678', '청라동', 'price', 'total', 'payments', 'memo', 'account', 'user_id', '농협', '123-45-67890', A]) {
  assert.ok(!cardText.includes(leak), '카드에 노출되면 안 됨: ' + leak);
}
assert.equal((await one(null, `select public.get_card('AAAAAAAAAAAAAAAAAAAAAA') as c`)).c, null);
assert.equal((await one(null, `select public.get_card('bad token!') as c`)).c, null);
assert.equal((await one(null, `select public.get_card(null) as c`)).c, null);
ok('시공 카드 공개 조회·필드 선별');

await as(B, `select public.revoke_card(${cA.id})`);   // 남의 폐기는 조용히 0행
assert.ok((await one(null, `select public.get_card($1) as c`, [tok])).c, '남이 폐기 시도해도 유지');
await as(A, `select public.revoke_card(${cA.id})`);
assert.equal((await one(null, `select public.get_card($1) as c`, [tok])).c, null, '폐기한 링크는 안 열림');
const tok2 = (await one(A, `select public.issue_card(${cA.id}) as t`)).t;
assert.notEqual(tok2, tok, '재발급은 새 링크');
ok('시공 카드 폐기·재발급');

// AS 문의: 비로그인 고객이 토큰으로만. 24시간 3건. 업체는 처리 표시만
await fails(as(null, `insert into public.work_card_requests (user_id, customer_id, kind, message) values ('${A}', ${cA.id}, 'as', 'x')`), /permission denied/, '직접 삽입 불가');
await fails(as(A, `insert into public.work_card_requests (user_id, customer_id, kind, message) values ('${A}', ${cA.id}, 'as', 'x')`), /permission denied/, '회원도 직접 삽입 불가');
await fails(as(null, `select public.submit_card_request('AAAAAAAAAAAAAAAAAAAAAA', 'as', '물이 새요', null)`), /not_found/, '없는 토큰');
await fails(as(null, `select public.submit_card_request($1, 'hack', '물이 새요', null)`, [tok2]), /check constraint/, '종류 검사');
await fails(as(null, `select public.submit_card_request($1, null, '물이 새요', null)`, [tok2]), /null value|not-null/, '종류 NULL');
await fails(as(null, `select public.submit_card_request($1, 'as', '   ', null)`, [tok2]), /check constraint/, '빈 내용');
await fails(as(null, `select public.submit_card_request($1, 'as', null, null)`, [tok2]), /null value|not-null/, '내용 NULL');
await fails(as(null, `select public.submit_card_request($1, 'as', $2, null)`, [tok2, 'ㄱ'.repeat(1001)]), /check constraint/, '1000자 초과');
await fails(as(null, `select public.submit_card_request($1, 'as', '물', 'javascript:alert(1)')`, [tok2]), /check constraint/, '연락처는 전화 형식만');
for (let i = 0; i < 3; i++) {
  await as(null, `select public.submit_card_request($1, 'as', $2, '010-1111-2222 (저녁)')`, [tok2, '<img src=x onerror=alert(1)> 물이 떨어져요 ' + i]);
}
await fails(as(null, `select public.submit_card_request($1, 'as', '또', null)`, [tok2]), /rate_limited/, '24시간 4번째');
const reqs = await as(A, `select id, kind, message, contact, resolved_at from public.work_card_requests order by id`);
assert.equal(reqs.length, 3);
assert.equal(reqs[0].contact, '01011112222', '연락처는 숫자만');
assert.ok(reqs[0].message.startsWith('<img'), '문의 원문은 그대로 저장 (화면은 textContent로만 그린다)');
assert.equal((await as(B, 'select * from public.work_card_requests')).length, 0, '남의 문의 안 보임');
await as(A, `update public.work_card_requests set resolved_at = now() where id = ${reqs[0].id}`);
await fails(as(A, `update public.work_card_requests set message = '조작' where id = ${reqs[1].id}`), /permission denied/, '문의 내용 수정 불가');
assert.equal((await as(B, `delete from public.work_card_requests where id = ${reqs[1].id} returning id`)).length, 0, '남의 문의 삭제 0행');
assert.equal((await as(A, `delete from public.work_card_requests where id = ${reqs[2].id} returning id`)).length, 1, '업체는 고객 요구 시 문의 삭제 가능');
assert.equal((await as(B, `update public.work_card_requests set resolved_at = now() where id = ${reqs[1].id} returning id`)).length, 0);
ok('AS 문의 제출·제한·격리·삭제');

// 작업 삭제 → 사진 행 연쇄 삭제, 고객·문의는 남음
await as(A, `delete from public.work_jobs where id = ${jA.id}`);
assert.equal((await as(A, `select * from public.work_photos where job_id = ${jA.id}`)).length, 0);
assert.equal((await as(A, `select * from public.work_card_requests`)).length, 2);
assert.equal((await one(null, `select public.get_card($1) as c`, [tok2])).c.jobs.length, 0, '완료 작업이 없으면 빈 이력');
// 고객 삭제 → 카드·문의 함께 삭제
await as(A, `delete from public.work_customers where id = ${cA.id}`);
assert.equal((await as(A, `select * from public.work_card_requests`)).length, 0);
assert.equal((await one(null, `select public.get_card($1) as c`, [tok2])).c, null);
ok('삭제 연쇄');

// 회원 탈퇴(auth.users 삭제) → 업무 데이터 삭제, 결제 원장은 보존
await db.exec(`delete from auth.users where id = '${A}'`);
for (const t of ['work_customers', 'work_jobs', 'work_photos', 'work_profiles', 'subscriptions', 'work_usage']) {
  assert.equal((await db.query(`select count(*)::int n from public.${t} where user_id = '${A}'`)).rows[0].n, 0, t);
}
assert.equal((await db.query(`select count(*)::int n from public.billing_events where user_ref = '${A}'`)).rows[0].n, 2, '원장 보존');
ok('탈퇴 시 삭제·원장 보존');

// 권한 단언 블록이 실제로 잡는지: revoke 한 줄을 빼면 SQL 적용 자체가 실패해야 한다
const mutated = SQL.replace('revoke all on public.work_jobs from anon, authenticated, public;', '');
assert.notEqual(mutated, SQL);
const db2 = new PGlite();
await db2.exec(STUB);
await fails(db2.exec(mutated), /권한 잔존|RLS|anon/, '단언 블록이 revoke 누락을 잡는다');
const mutated2 = SQL.replace(/revoke all on function public\.issue_card\(bigint\) from public, anon, authenticated;/, '');
const db3 = new PGlite();
await db3.exec(STUB);
await fails(db3.exec(mutated2), /anon 실행 가능/, '단언 블록이 함수 revoke 누락을 잡는다');
// 남아 있던 시험 정책(using true)과 bucket_id 없는 storage 정책도 잡는다
const db4 = new PGlite();
await db4.exec(STUB);
await db4.exec(SQL);
await db4.exec(`create policy "leftover" on public.work_jobs for select to authenticated using (true)`);
await fails(db4.exec(SQL), /예상 밖 정책/, '남은 정책');
await db4.exec('rollback');   // 실패한 적용은 트랜잭션째 롤백된다
await db4.exec(`drop policy "leftover" on public.work_jobs; create policy "anyone uploads" on storage.objects for insert to authenticated with check (true)`);
await fails(db4.exec(SQL), /bucket_id 조건 없는 storage 정책/, '버킷 조건 없는 storage 정책');
ok('권한 단언 블록 음성 대조');

console.log(`test-work-sql: OK (${n}개 묶음)`);
