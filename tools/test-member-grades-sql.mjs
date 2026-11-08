// supabase/24_member_grades.sql 검사 — PGlite(WASM)로, 운영 DB를 건드리지 않는다.
// 준비(한 번): npm i --prefix tools        실행: node tools/test-member-grades-sql.mjs
// 역할·auth.uid 는 test-work-sql.mjs STUB, 게시판 표는 test-open-board-sql.mjs BOARD 를 그대로 쓰고 21 을 먼저 적용한다.
// profiles 권한은 운영 실측(2026-11-08)대로 좁힌다: 회원 SELECT + nickname·field·region·updated_at 열만 UPDATE.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE || '@electric-sql/pglite')); }
catch (e) { console.error('PGlite가 없습니다.  npm i --prefix tools  후 다시 실행하세요.'); process.exit(2); }
const grab = (file, name) => fs.readFileSync(path.join(here, file), 'utf8').match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;'))[1];
const read = (f) => fs.readFileSync(path.join(repo, 'supabase', f), 'utf8');

const db = new PGlite();
await db.exec(grab('test-work-sql.mjs', 'STUB'));
await db.exec(grab('test-open-board-sql.mjs', 'BOARD'));
await db.exec(`revoke all on public.profiles from anon, authenticated;
  grant select on public.profiles to authenticated;
  grant update (nickname, field, region, updated_at) on public.profiles to authenticated;
  create policy "user updates own profile" on public.profiles for update to authenticated using (auth.uid() = id);`);

const ADMIN = '00000000-0000-4000-8000-0000000000aa', A = '00000000-0000-4000-8000-00000000000a',
  B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c', D = '00000000-0000-4000-8000-00000000000d';
await db.exec(`insert into auth.users values ('${ADMIN}'),('${A}'),('${B}'),('${C}'),('${D}');
  insert into public.profiles (id, nickname, field, role, created_at) values
    ('${ADMIN}', '운영자', 'custom', 'admin', now() - interval '200 days'),
    ('${A}', '새내기', 'aircon', 'member', now() - interval '1 day'),
    ('${B}', '댓글러', 'grout', 'member', now() - interval '5 days'),
    ('${C}', '오래된', 'aircon', 'member', now() - interval '40 days'),
    ('${D}', '도배꾼', 'aircon', 'member', now() - interval '60 days');`);

await db.exec(read('21_open_board.sql'));
for (let i = 0; i < 2; i++) await db.exec(read('24_member_grades.sql'));   // 재실행 안전

// 활동 만들기 (소유자 권한으로 직접 넣는다)
await db.exec(`
  -- A: 익명 글 1개만 → 세지 않으므로 새싹
  insert into public.posts (board_type, author_id, title, body, is_anonymous) values ('free', '${A}', '익명 질문', '본문', true);
  -- B: 같은 날 댓글 3개 → 일꾼
  insert into public.posts (board_type, author_id, title, body) values ('free', '${ADMIN}', '공지', '본문');
  insert into public.comments (post_id, author_id, body) select (select min(id) from public.posts where author_id = '${ADMIN}'), '${B}', '댓글 ' || g from generate_series(1, 3) g;
  -- C: 10일 동안 하루 1개씩 글 10개, 가입 40일 → 단골
  insert into public.posts (board_type, author_id, title, body, created_at)
    select 'free', '${C}', '현장 ' || g, '본문', now() - (g || ' days')::interval from generate_series(1, 10) g;
  -- D: 하루에 글 30개(하루 3개까지만 셈) + 입주 캘린더 자동 글 → 글 3개로 셈, 일꾼
  insert into public.posts (board_type, author_id, title, body) select 'free', '${D}', '도배 ' || g, '본문' from generate_series(1, 30) g;
  insert into public.posts (board_type, author_id, title, body, ref_type, ref_id) values ('free', '${D}', '입주 캘린더', '본문', 'move_in', 'calendar_metro_20261108');
`);

async function as(uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
}
async function fails(p, re, label) {
  try { await p; } catch (e) { assert.match(e.message, re, label + ' → ' + e.message); return; }
  assert.fail(label + ' — 막혀야 하는데 통과함');
}

// 1) 등급 계산
const grades = Object.fromEntries((await db.query(`select user_id, grade, posts, comments from public.v_member_grades`)).rows
  .map((r) => [r.user_id, r]));
assert.equal(grades[A].grade, '새싹', '익명 글은 세지 않는다');
assert.equal(grades[A].posts, 0);
assert.equal(grades[B].grade, '일꾼', '댓글 3개');
assert.equal(grades[C].grade, '단골', '글 10개 + 가입 30일');
assert.equal(grades[D].posts, 3, '하루 글은 3개까지, 자동 게시 제외');
assert.equal(grades[D].grade, '일꾼');

// 2) 운영자 지정 고수 — 회원은 스스로 못 바꾼다
await fails(as(B, `update public.profiles set grade_pin = '고수' where id = '${B}'`), /permission denied/, '회원 등급 자가 수정');
await fails(db.exec(`update public.profiles set grade_pin = '최고' where id = '${B}'`), /profiles_grade_pin_check/, '없는 등급');
await db.exec(`update public.profiles set grade_pin = '고수' where id = '${B}'`);
assert.equal((await db.query(`select grade from public.v_member_grades where user_id = '${B}'`)).rows[0].grade, '고수');
// 회원은 닉네임은 여전히 고칠 수 있다
await as(B, `update public.profiles set nickname = '댓글러2' where id = '${B}'`);

// 3) 다른 사람에게는 등급 이름만 — 익명 글은 등급도 지운다
const guestPosts = await as(null, `select title, author_nick, author_grade from public.v_posts order by id`);
assert.equal(guestPosts.find((p) => p.title === '익명 질문').author_grade, null, '익명 글 등급 비움');
assert.equal(guestPosts.find((p) => p.title === '현장 1').author_grade, '단골');
const guestComments = await as(null, `select author_nick, author_grade from public.v_comments`);
assert.ok(guestComments.length === 3 && guestComments.every((c) => c.author_grade === '고수' && c.author_nick === '댓글러2'));

// 4) 집계는 본인만
await fails(as(null, `select * from public.v_member_grades`), /permission denied/, '비회원 집계 뷰');
await fails(as(A, `select * from public.v_member_grades`), /permission denied/, '회원 집계 뷰');
await fails(as(null, `select * from public.v_my_grade`), /permission denied/, '비회원 내 등급');
const mine = await as(C, `select grade, posts, comments, days from public.v_my_grade`);
assert.deepEqual(mine, [{ grade: '단골', posts: 10, comments: 0, days: 40 }]);
assert.equal((await as(A, `select * from public.v_my_grade`)).length, 1, '본인 한 줄만');

console.log('test-member-grades-sql: 4 groups OK');
