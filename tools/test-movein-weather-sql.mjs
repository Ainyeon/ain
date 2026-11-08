// supabase/23_movein_detail_weather.sql 검사 — PGlite(WASM)로, 운영 DB를 건드리지 않는다.
// 준비(한 번): npm i --prefix tools        실행: node tools/test-movein-weather-sql.mjs
// 운영 흉내(역할·auth.uid·default ACL)는 test-work-sql.mjs 의 STUB 를 그대로 쓴다.
// move_in_complexes 는 운영 실측(2026-11-08) 권한 그대로: RLS on, 회원 SELECT 만, 정책 is_public = true.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite')); }
catch (e) { console.error('PGlite가 없습니다.  npm i --prefix tools  후 다시 실행하세요.'); process.exit(2); }
const STUB = fs.readFileSync(path.join(here, 'test-work-sql.mjs'), 'utf8').match(/const STUB = `([\s\S]*?)`;/)[1];
const SQL = fs.readFileSync(path.join(repo, 'supabase', '23_movein_detail_weather.sql'), 'utf8');

const db = new PGlite();
await db.exec(STUB);
await db.exec(`
create table public.move_in_complexes (id bigserial primary key, region text not null, complex_name_raw text not null,
  complex_name_ad text not null, sido text, sigungu text, notice_date date not null, expected_move_in date,
  stage text not null default '공고', is_public boolean not null default true);
alter table public.move_in_complexes enable row level security;
revoke all on public.move_in_complexes from anon, authenticated, public;
grant select on public.move_in_complexes to authenticated;
create policy "public read visible move in complexes" on public.move_in_complexes for select using (is_public = true);
insert into public.move_in_complexes (region, complex_name_raw, complex_name_ad, sido, notice_date, expected_move_in, is_public) values
  ('METRO', 'OO단지', 'OO단지', '서울특별시', '2025-01-10', '2027-03-01', true),
  ('METRO', '숨김단지', '숨김단지', '경기도', '2025-01-10', '2027-03-01', false);`);

for (let i = 0; i < 2; i++) await db.exec(SQL);   // 재실행 안전(단언 블록 두 번 통과)

const UID = '00000000-0000-4000-8000-00000000000a';
await db.exec(`insert into auth.users values ('${UID}')`);
async function as(uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
}
async function fails(p, re, label) {
  try { await p; } catch (e) { assert.match(e.message, re, label + ' → ' + e.message); return; }
  assert.fail(label + ' — 막혀야 하는데 통과함');
}

// 1) 파이프라인(service role = 소유자)이 상세를 채운다
await db.exec(`update public.move_in_complexes set house_manage_no = '2025000123', supply_households = 523,
  builder = '현대건설(주)', developer = 'OO도시개발', house_types = '[{"type":"084.9800A","area":84.98,"supply_area":112.4,"units":300}]'
  where complex_name_raw = 'OO단지'`);

// 2) 회원은 공개 단지의 새 칸을 읽고, 비공개 단지는 못 본다
const rows = await as(UID, `select complex_name_ad, supply_households, builder, house_types from public.move_in_complexes`);
assert.equal(rows.length, 1, '회원은 공개 단지만');
assert.equal(rows[0].supply_households, 523);
assert.equal(rows[0].builder, '현대건설(주)');
assert.equal(rows[0].house_types[0].units, 300);
// 회원도 쓰기는 못 한다
await fails(as(UID, `update public.move_in_complexes set builder = 'x'`), /permission denied/, '회원 단지 수정');

// 3) 비회원은 단지 표 자체를 못 읽는다(새 칸 포함)
await fails(as(null, `select builder from public.move_in_complexes`), /permission denied/, '비회원 단지 표');

// 4) 날씨: 소유자가 쓰고, 비회원·회원은 읽기만
await db.exec(`insert into public.weather_daily (sido, day, tmin, tmax, pop_max, pty, wind_max, base_at)
  values ('서울', '2026-11-09', 3, 12, 70, '비', 6.1, '2026-11-08T05:00:00+09:00')`);
const w = await as(null, `select sido, pop_max, pty from public.weather_daily`);
assert.deepEqual(w, [{ sido: '서울', pop_max: 70, pty: '비' }]);
await fails(as(null, `insert into public.weather_daily (sido, day, base_at) values ('부산', '2026-11-09', now())`), /permission denied/, '비회원 날씨 쓰기');
await fails(as(UID, `delete from public.weather_daily`), /permission denied/, '회원 날씨 지우기');
await fails(as(UID, `update public.weather_daily set pop_max = 0`), /permission denied/, '회원 날씨 고치기');

console.log('test-movein-weather-sql: 4 groups OK');
