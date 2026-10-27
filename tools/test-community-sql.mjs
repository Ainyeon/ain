// 커뮤니티 SQL(sql/07~10 · supabase/15·16) 동작 검사 — 실제 Postgres(PGlite, WASM)에서 운영 DB를 건드리지 않고 돌린다.
// 17·19·20 은 test-work-sql / test-studio-sql 이 보지만 게시판·익명·연락처 가림·저장·투표·신고·운영자 RPC 는 행동으로 보는 곳이 없었다.
// 준비(한 번): npm i --prefix tools   또는 설치본 경로를 PGLITE 로:  PGLITE=/path/to/@electric-sql/pglite/dist/index.js
// 실행: node tools/test-community-sql.mjs    (PGlite 가 없으면 exit 2 로 안내만 하고 건너뛴다)
// 역할·auth.uid()·default ACL 은 test-work-sql.mjs 의 STUB 가 흉내 낸 것이다(운영 DB 와 같지 않다) — test-studio-sql.mjs 와 같은 방식으로 읽어 쓴다.
// 일부러 굳히지 않는 것: 댓글 작성자(author_id)·투표자(user_id)의 노출 범위(제품 판단 사항), 연락처 가림의 정규식 세부.
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
const db = new PGlite(); await db.exec(STUB);
const FILES = ['sql/07-community.sql', 'sql/08-fix-grants-roles.sql', 'sql/09-engagement.sql', 'sql/10-fields-expand.sql', 'supabase/15_launch.sql', 'supabase/16_jobs_board.sql'];
for (const f of FILES) await db.exec(fs.readFileSync(path.join(repo, f), 'utf8'));
// 15→16 을 다시 적용해도 통과해야 한다. v_posts 는 16 이 create or replace 로 다시 정의하므로 최종 정의는 16 쪽이다(마스킹 검사는 16 기준).
for (const f of ['supabase/15_launch.sql', 'supabase/16_jobs_board.sql']) await db.exec(fs.readFileSync(path.join(repo, f), 'utf8'));

const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', ADM = '00000000-0000-4000-8000-0000000000ad';
await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${ADM}');
  insert into public.profiles (id, nickname, field, role) values ('${A}','에이에이','ac-clean','member'),('${B}','비비','tile','member'),('${ADM}','운영자','custom','admin');`);
async function as(uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
}
async function fails(p, re, label) { try { await p; } catch (e) { assert.match(e.message, re, label + ' → ' + e.message); return; } assert.fail(label + ': 실패해야 하는데 통과함'); }
let n = 0; const ok = () => { n++; };

// ── anon: 원본 표·회원 뷰 차단, 티저 뷰만 열림
for (const t of ['posts', 'comments', 'votes', 'reports', 'profiles', 'saved_items', 'notice_complexes', 'v_posts', 'admin_author_lookups'])
  await fails(as(null, `select * from public.${t}`), /permission denied/, `anon ${t}`);
await as(null, 'select * from public.v_board_teaser'); ok();

// ── 익명 보호: author_id 는 일반 API 로 읽히지 않고, 익명 글은 뷰가 작성자를 지운다
const p1 = (await as(A, `insert into public.posts (board_type, author_id, title, body, is_anonymous) values ('free','${A}','익명 질문','본문',true) returning id`))[0].id;
const p2 = (await as(A, `insert into public.posts (board_type, author_id, title, body) values ('free','${A}','실명 글','본문') returning id`))[0].id;
await fails(as(B, 'select author_id from public.posts'), /permission denied/, 'author_id 열 읽기');
await fails(as(B, 'select * from public.posts'), /permission denied/, 'select * 도 막힌다(열 단위 SELECT)');
await fails(as(B, `select id from public.posts where author_id = '${A}'`), /permission denied/, 'author_id 로 거르기(탐색)');
const v = await as(B, `select id, author_nick, author_field, is_mine from public.v_posts order by id`);
assert.equal(v.find((r) => r.id === p1).author_nick, null, '익명 글 작성자 null');
assert.equal(v.find((r) => r.id === p2).author_nick, '에이에이');
assert.equal((await as(A, `select is_mine from public.v_posts where id = ${p1}`))[0].is_mine, true);
assert.equal((await as(B, `select is_mine from public.v_posts where id = ${p1}`))[0].is_mine, false); ok();

// ── 자기 승격·상태 조작 차단 (열 GRANT + RLS)
await fails(as(A, `update public.posts set status = 'adopted' where id = ${p2}`), /permission denied/, 'status 직접 변경');
await fails(as(A, `insert into public.posts (board_type, author_id, title, body, status) values ('free','${A}','t','b','shipped')`), /permission denied/, 'status 지정 insert');
await fails(as(A, `insert into public.posts (board_type, author_id, title, body) values ('free','${B}','t','b')`), /row-level security/, '남 명의 글');
await fails(as(A, `update public.posts set author_id = '${B}' where id = ${p2}`), /permission denied/, '작성자 변경');
await fails(as(A, `update public.profiles set role = 'admin' where id = '${A}'`), /permission denied/, '자기 승격(role)');
await fails(as(A, `update public.profiles set is_admin = true where id = '${A}'`), /permission denied/, '자기 승격(is_admin)');
assert.equal((await as(B, `update public.posts set title = '탈취' where id = ${p2} returning id`)).length, 0, '남의 글 수정 0행');
assert.equal((await as(B, `delete from public.posts where id = ${p2} returning id`)).length, 0, '남의 글 삭제 0행'); ok();

// ── 연락처 가림은 저장 시점에 (트리거), 링크는 보존, 잘라서 저장하지 않는다
const m = (await as(A, `insert into public.posts (board_type, author_id, title, body) values ('free','${A}','문의 010-1234-5678','메일 a@b.co 공고 https://www.bizinfo.go.kr/x?pblancId=PBLN_1 카톡 abcd123') returning title, body`))[0];
assert.ok(m.title.includes('[가림]') && !m.title.includes('1234'), m.title);
assert.ok(m.body.includes('https://www.bizinfo.go.kr/x?pblancId=PBLN_1') && !m.body.includes('a@b.co') && !m.body.includes('abcd123'), m.body);
await fails(as(A, `insert into public.posts (board_type, author_id, title, body) values ('free','${A}', repeat('가', 80) || '카톡 abcd', 'b')`), /check constraint/, '가림 뒤 80자 초과는 거부(자르지 않음)');
const c = (await as(B, `insert into public.comments (post_id, author_id, body) values (${p2}, '${B}', '연락 01099998888') returning body`))[0];
assert.ok(c.body.includes('[가림]'), c.body);
const upd = (await as(A, `update public.posts set body = '바꿈 010 2222 3333' where id = ${p2} returning body`))[0];
assert.ok(upd.body.includes('[가림]'), 'UPDATE 도 가림: ' + upd.body);
const updT = (await as(A, `update public.posts set title = '제목 010-9999-8888' where id = ${p2} returning title`))[0];
assert.ok(updT.title.includes('[가림]'), 'title 만 UPDATE 해도 가림: ' + updT.title);
await fails(as(A, `insert into public.posts (board_type, author_id, title, body) values ('free','${A}','   ','b')`), /check constraint/, '공백 제목');
await fails(as(A, `insert into public.comments (post_id, author_id, body) values (${p2}, '${A}', E'\\n \\t')`), /check constraint/, '공백 댓글'); ok();

// ── 투표(upsert 경로)·삭제 잠금 해제·신고 열람
const prop = (await as(A, `insert into public.posts (board_type, author_id, title, body) values ('proposal','${A}','제안','b') returning id`))[0].id;
await as(B, `insert into public.votes (post_id, user_id, vote) values (${prop}, '${B}', 'up') on conflict (post_id, user_id) do update set post_id = excluded.post_id, user_id = excluded.user_id, vote = excluded.vote`);
await as(B, `insert into public.votes (post_id, user_id, vote) values (${prop}, '${B}', 'down') on conflict (post_id, user_id) do update set post_id = excluded.post_id, user_id = excluded.user_id, vote = excluded.vote`);
assert.equal((await as(B, `select vote from public.votes where post_id = ${prop}`))[0].vote, 'down');
await fails(as(A, `insert into public.votes (post_id, user_id, vote) values (${prop}, '${B}', 'up')`), /row-level security/, '남 명의 투표');
await as(B, `insert into public.reports (target_type, target_id, reporter_id, reason) values ('post', ${p2}, '${B}', '스팸')`);
await fails(as(B, `insert into public.reports (target_type, target_id, reporter_id, reason) values ('post', ${p2}, '${B}', '스팸')`), /duplicate|unique/, '같은 신고 두 번');
assert.equal((await as(B, 'select * from public.reports')).length, 0, '신고는 본인도 못 읽음');
assert.equal((await as(ADM, 'select * from public.reports')).length, 1, '운영자는 읽음'); ok();

// ── 운영자 RPC: 비운영자 거부, 운영자 성공, anon 은 실행 자체 불가
await fails(as(A, `select public.admin_set_post_state(${prop}, 'adopted', null, null)`), /admin only/, '비운영자');
await fails(as(null, `select public.admin_set_post_state(${prop}, 'adopted', null, null)`), /permission denied/, 'anon');
await as(ADM, `select public.admin_set_post_state(${prop}, 'held', '보류 사유', '답변')`);
assert.equal((await as(A, `select status, status_reason from public.v_posts where id = ${prop}`))[0].status, 'held');
await fails(as(ADM, `select public.admin_set_post_state(${prop}, 'held', '', '')`), /requires a reason/, '보류는 사유 필수');
await fails(as(A, `select * from public.admin_post_author(${p1}, 'abuse')`), /admin only/, '작성자 조회 비운영자');
assert.equal((await as(ADM, `select nickname from public.admin_post_author(${p1}, 'abuse')`))[0].nickname, '에이에이');
assert.equal((await db.query('select count(*)::int n from public.admin_author_lookups')).rows[0].n, 1, '열람 기록');
// 역할 변경 RPC: 운영자만, manager/member 만, admin 은 RPC 로 못 바꾼다
await fails(as(A, `select public.admin_set_role('${B}', 'manager')`), /admin only/, '비운영자의 역할 변경');
await fails(as(null, `select public.admin_set_role('${B}', 'manager')`), /permission denied/, 'anon 의 역할 변경');
await as(ADM, `select public.admin_set_role('${B}', 'manager')`);
assert.equal((await db.query(`select role from public.profiles where id = '${B}'`)).rows[0].role, 'manager', '운영자가 manager 로 올림');
await fails(as(ADM, `select public.admin_set_role('${B}', 'admin')`), /only manager\/member/, 'RPC 로 admin 승격 불가');
await fails(as(ADM, `select public.admin_set_role('${ADM}', 'member')`), /cannot change admin/, 'admin 대상 변경 불가'); ok();

// ── 저장 격리·카운터
await as(A, `insert into public.saved_items (user_id, target_type, target_id) values ('${A}','edu','E1')`);
assert.equal((await as(B, 'select * from public.saved_items')).length, 0, '남의 저장 안 보임');
await fails(as(B, `insert into public.saved_items (user_id, target_type, target_id) values ('${A}','edu','E2')`), /row-level security/, '남 명의 저장');
const before = Number((await as(null, `select value v from public.site_stats where key = 'maker_uses'`))[0].v);          // 시드값에 묶지 않는다
assert.equal(Number((await as(null, `select public.bump_stat('maker_uses') v`))[0].v), before + 1, 'anon 카운터는 1씩 오른다');
await fails(as(null, `select public.bump_stat('x')`), /unknown stat/, '임의 키');
await fails(as(null, `update public.site_stats set value = 0`), /permission denied/, '카운터 직접 쓰기'); ok();

console.log(`test-community-sql: OK (${n}개 묶음)`);
