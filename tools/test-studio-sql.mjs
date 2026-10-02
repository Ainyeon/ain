// supabase/20_studio.sql 검사 — 실제 Postgres(PGlite, WASM)에서 운영 DB를 건드리지 않고 돌린다.
// 준비(한 번): npm i --prefix tools        실행: node tools/test-studio-sql.mjs
// 운영 흉내(역할·auth.uid·default ACL·storage 스텁)는 test-work-sql.mjs 의 STUB 를 그대로 읽어 쓴다(한 곳에서 고친다).
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
const SQL = fs.readFileSync(path.join(repo, 'supabase/20_studio.sql'), 'utf8');

const db = new PGlite();
await db.exec(STUB);
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', W = '00000000-0000-4000-8000-0000000000c1';
await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${W}');`);
await db.exec(SQL);
await db.exec(SQL);                                              // 재실행 안전(단언 블록 두 번 통과)
await db.exec(`insert into public.studio_workers (user_id, name) values ('${W}', 'mac');`);

async function as(uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
}
async function fails(p, re, label) {
  try { await p; } catch (e) { assert.match(e.message, re, label + ' → ' + e.message); return; }
  assert.fail(label + ': 실패해야 하는데 통과함');
}
const one = async (uid, sql) => (await as(uid, sql))[0];
const upload = (uid, name) => as(uid, `insert into storage.objects (bucket_id, name) values ('studio', '${name}') returning name`);
let n = 0; const ok = () => n++;

// ── anon 은 아무것도 못 한다
for (const t of ['studio_jobs', 'studio_usage', 'studio_workers']) await fails(as(null, `select * from public.${t}`), /permission denied/, `anon ${t}`);
for (const f of [`studio_submit('plan3d', '{}', '{in.png}')`, 'studio_ready(1)', 'studio_status(1)', 'studio_claim()', 'studio_heartbeat()', 'studio_expire()']) {
  await fails(as(null, `select public.${f}`), /permission denied/, `anon ${f}`);
}
await fails(as(A, 'select * from public.studio_usage'), /permission denied/, '회원도 사용량 직접 조회 불가');
await fails(as(A, 'select outputs from public.studio_jobs'), /permission denied/, '결과 목록 열은 함수로만');
ok();

// ── 접수: 도구·파일 이름 검사
await fails(as(A, `select public.studio_submit('hack', '{}', '{in.png}')`), /tool_not_allowed/, '허용 밖 도구');
await fails(as(A, `select public.studio_submit('plan3d', '{}', '{../x.png}')`), /bad_file/, '경로 꾸미기');
await fails(as(A, `select public.studio_submit('plan3d', '{}', '{in.exe}')`), /bad_file/, '확장자');
await fails(as(A, `select public.studio_submit('cutout', '{}', '{in.dwg}')`), /bad_file/, '사진 도구에 도면');
await fails(as(A, `select public.studio_submit('erase', '{}', '{in.png}')`), /bad_file/, '지우개는 마스크가 있어야');
await fails(as(A, `select public.studio_submit('cutout', '{}', '{in.png,mask.png}')`), /bad_file/, '배경 떼기에 마스크');
await fails(as(A, `select public.studio_submit('plan3d', '"x"', '{in.png}')`), /bad_params/, '옵션은 객체');
const s1 = (await one(A, `select public.studio_submit('plan3d', '{"style":"wood"}', '{in.dwg}') r`)).r;
assert.deepEqual(s1.paths, [`${A}/${s1.id}/in.dwg`]);
ok();

// ── 업로드: 예약 경로만, 남의 작업 경로 불가
await fails(upload(A, `${A}/${s1.id}/other.png`), /row-level security/, '예약 안 한 경로');
await fails(upload(B, `${A}/${s1.id}/in.dwg`), /row-level security/, '남의 예약 경로');
await fails(as(A, `select public.studio_ready(${s1.id})`), /not_found/, '올리기 전 ready');
await upload(A, `${A}/${s1.id}/in.dwg`);
await as(A, `select public.studio_ready(${s1.id})`);
assert.equal((await one(A, `select status from public.studio_jobs where id = ${s1.id}`)).status, 'queued');
assert.equal((await as(B, `select id from public.studio_jobs`)).length, 0, '남의 작업 안 보임');
await fails(as(B, `select public.studio_status(${s1.id})`), /not_found/, '남의 작업 상태');
const st = (await one(A, `select public.studio_status(${s1.id}) r`)).r;
assert.equal(st.status, 'queued'); assert.equal(st.worker_alive, false); assert.equal(Number(st.ahead), 0);
ok();

// ── 한도: 진행 중 2건
const s2 = (await one(A, `select public.studio_submit('erase', '{}', '{in.jpg,mask.png}') r`)).r;
assert.deepEqual(s2.paths, [`${A}/${s2.id}/in.jpg`, `${A}/${s2.id}/mask.png`]);
await fails(as(A, `select public.studio_submit('cutout', '{}', '{in.png}')`), /limit_active/, '진행 중 3건째');
assert.equal((await db.query(`select jobs from public.studio_usage where user_id = '${A}'`)).rows[0].jobs, 2, '거절된 접수는 사용량에 안 남음');
ok();

// ── 작업 기계
await fails(as(A, `select public.studio_claim()`), /worker_only/, '회원은 작업을 못 맡음');
await fails(as(A, `select public.studio_heartbeat()`), /worker_only/, '회원 하트비트');
await as(W, `select public.studio_heartbeat()`);
assert.equal((await one(A, `select public.studio_status(${s1.id}) r`)).r.worker_alive, true);
const c = (await one(W, `select public.studio_claim() r`)).r;
assert.equal(c.id, s1.id); assert.equal(c.tool, 'plan3d'); assert.equal(c.params.style, 'wood'); assert.deepEqual(c.inputs, [`${A}/${s1.id}/in.dwg`]);
assert.equal((await one(W, `select public.studio_claim() r`)).r, null, '대기 작업 없음(올리는 중인 지우개는 안 맡음)');
assert.equal((await as(W, `select name from storage.objects where bucket_id = 'studio' and name = '${A}/${s1.id}/in.dwg'`)).length, 1, '맡은 입력 읽기');
await upload(W, `${A}/${s1.id}/out/plan.webp`);
await fails(upload(W, `${A}/${s2.id}/out/x.webp`), /row-level security/, '안 맡은 작업 out/');
await fails(upload(W, `${A}/${s1.id}/in2.dwg`), /row-level security/, 'out/ 밖');
await fails(as(W, `select public.studio_complete(${s1.id}, true, '[{"path":"${B}/1/out/x.webp","kind":"image"}]', null)`), /bad_outputs/, '남의 경로를 결과로');
await as(W, `select public.studio_complete(${s1.id}, true, '[{"path":"${A}/${s1.id}/out/plan.webp","kind":"image","group":"drawings","caption":"컬러 평면도"}]', null)`);
const done = (await one(A, `select public.studio_status(${s1.id}) r`)).r;
assert.equal(done.status, 'done'); assert.equal(done.outputs[0].caption, '컬러 평면도');
assert.equal((await as(A, `select name from storage.objects where bucket_id = 'studio' and name like '${A}/%'`)).length, 2, '내 입력·결과 읽기');
assert.equal((await as(B, `select name from storage.objects where bucket_id = 'studio'`)).length, 0, '남은 못 읽음');
ok();

// ── 실패면 그달 접수 수 되돌림
await upload(A, `${A}/${s2.id}/in.jpg`); await upload(A, `${A}/${s2.id}/mask.png`);
await as(A, `select public.studio_ready(${s2.id})`);
assert.equal((await one(W, `select public.studio_claim() r`)).r.id, s2.id);
await as(W, `select public.studio_complete(${s2.id}, false, null, '사진을 읽지 못했습니다.')`);
assert.equal((await one(A, `select public.studio_status(${s2.id}) r`)).r.error_ko, '사진을 읽지 못했습니다.');
assert.equal((await db.query(`select jobs from public.studio_usage where user_id = '${A}'`)).rows[0].jobs, 1);
ok();

// ── 월 30건
await db.exec(`update public.studio_usage set jobs = 30 where user_id = '${A}'`);
await fails(as(A, `select public.studio_submit('plan3d', '{}', '{in.png}')`), /limit_month/, '월 한도');
ok();

// ── 14일 보관 끝 → 작업 기계가 지울 폴더, 지우기 정책
await db.exec(`update public.studio_jobs set finished_at = now() - interval '15 days' where id = ${s1.id}`);
assert.deepEqual((await as(W, `select public.studio_expire() p`)).map((r) => r.p).sort(), [`${A}/${s1.id}/`, `${A}/${s2.id}/`].filter((p) => p.endsWith(`/${s1.id}/`)));
assert.equal((await as(W, `delete from storage.objects where bucket_id = 'studio' and name like '${A}/${s1.id}/%' returning name`)).length, 2, '보관 끝난 파일 지움');
assert.equal((await one(A, `select public.studio_status(${s1.id}) r`)).r.status, 'expired');
await fails(as(A, `select public.studio_expire()`), /worker_only/, '회원은 못 부름');
ok();

console.log(`test-studio-sql: OK (${n}개 묶음)`);
