// supabase/27_all_trades_order.sql 검사 — PGlite(WASM)로, 운영 DB를 건드리지 않는다.
// 준비(한 번): npm i --prefix tools        실행: node tools/test-all-trades-sql.mjs
// 역할·auth.uid 는 test-work-sql.mjs STUB, 게시판 표는 test-open-board-sql.mjs BOARD, 읽기 뷰는 21 을 먼저 적용한다.
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
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
await db.exec(`insert into auth.users values ('${A}'),('${B}');
  insert into public.profiles (id, nickname, field, role) values ('${A}', '유리청소', null, 'member'), ('${B}', '에어컨김', 'paper-floor', 'member');`);
await db.exec(read('21_open_board.sql'));
for (let i = 0; i < 2; i++) await db.exec(read('27_all_trades_order.sql'));   // 재실행 안전

async function as(uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
}
async function fails(p, re, label) {
  try { await p; } catch (e) { assert.match(e.message, re, label + ' → ' + e.message); return; }
  assert.fail(label + ' — 막혀야 하는데 통과함');
}

// 1) 분야 — 새 분야·예전 값은 되고, 목록에 없는 값은 안 된다
await db.exec(`update public.profiles set field = 'window-clean' where id = '${A}'`);
await db.exec(`update public.profiles set field = 'ev-charger' where id = '${A}'`);
await fails(db.exec(`update public.profiles set field = 'nonsense' where id = '${A}'`), /profiles_field_check/, '없는 분야');
assert.equal((await db.query(`select field from public.profiles where id = '${B}'`)).rows[0].field, 'paper-floor', '예전 값 유지');

// 2) 오더 공유 글 — 쓰기·마감은 되고, 자유게시판 마감·오더 후기 표시는 안 된다
await db.exec(`insert into public.posts (id, board_type, author_id, title, body) values
  (1, 'order', '${A}', '[인천 서구] 입주청소 34평 넘깁니다', '11/20, 소개비 없음'), (2, 'free', '${B}', '자유 글', '본문')`);
await db.exec(`update public.posts set closed_at = now() where id = 1`);
await fails(db.exec(`update public.posts set closed_at = now() where id = 2`), /posts_closed_at_check/, '자유게시판 마감');
await fails(db.exec(`insert into public.posts (board_type, author_id, title, body, review_kind) values ('order', '${A}', 't', 'b', 'review')`),
  /posts_job_plain_check/, '오더 글에 후기 표시');
await fails(db.exec(`insert into public.posts (board_type, author_id, title, body) values ('market', '${A}', 't', 'b')`),
  /posts_board_type_check/, '없는 게시판');

// 3) 공개 범위 — 비회원은 오더 글을 못 보고, 회원은 본다
const guest = await as(null, `select id, board_type from public.v_posts order by id`);
assert.deepEqual(guest.map((r) => r.board_type), ['free'], '비회원은 자유 글만');
const member = await as(B, `select id, board_type, closed_at is not null as closed from public.v_posts order by id`);
assert.deepEqual(member.map((r) => [r.board_type, r.closed]), [['order', true], ['free', false]]);

// 4) 알림 링크
assert.equal((await db.query(`select public.post_path('order', 7) p`)).rows[0].p, '/board/order/?id=7');
assert.equal((await db.query(`select public.post_path('free', 7) p`)).rows[0].p, '/board/free/?id=7');

console.log('test-all-trades-sql: 4 groups OK');
