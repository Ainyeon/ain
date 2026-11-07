// supabase/21_open_board.sql · 22_price_history.sql(+22b) 검사 — PGlite(WASM)로, 운영 DB를 건드리지 않는다.
// 준비(한 번): npm i --prefix tools        실행: node tools/test-open-board-sql.mjs
// 운영 흉내(역할·auth.uid·default ACL)는 test-work-sql.mjs 의 STUB 를 그대로 쓴다.
// posts·comments·votes·move_in_contents·prices 는 운영에서 쓰는 열과 RLS 만 최소로 흉내 낸다.
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
const read = (f) => fs.readFileSync(path.join(repo, 'supabase', f), 'utf8');

const BOARD = `
create table public.posts (
  id bigserial primary key, board_type text not null default 'free', author_id uuid not null references public.profiles(id),
  title text not null check (char_length(title) <= 80), body text not null check (char_length(body) <= 4000),
  status text not null default 'open', status_reason text, admin_answer text, admin_answered_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(), view_count int default 0,
  is_anonymous boolean default false, ref_type text, ref_id text, review_kind text, review_cost int,
  review_subsidy text, review_done_month text, closed_at timestamptz,
  constraint posts_ref_type_check check (ref_type is null or ref_type in ('edu', 'notice')));
create table public.comments (id bigserial primary key, post_id bigint references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id), body text not null, created_at timestamptz default now());
create table public.votes (post_id bigint references public.posts(id) on delete cascade, user_id uuid references public.profiles(id),
  vote text not null check (vote in ('up','down')), primary key (post_id, user_id));
alter table public.posts enable row level security; alter table public.comments enable row level security; alter table public.votes enable row level security;
revoke all on public.posts, public.comments, public.votes from anon;
create policy "members read posts" on public.posts for select to authenticated using (true);
create policy "members read comments" on public.comments for select to authenticated using (true);
create policy "members read votes" on public.votes for select to authenticated using (true);
create function public.increment_post_view(p_post_id bigint) returns void language sql security definer set search_path = public
  as $$ update public.posts set view_count = view_count + 1 where id = p_post_id $$;
revoke all on function public.increment_post_view(bigint) from public, anon;
create view public.v_board_teaser as select board_type, title from public.posts;

create table public.move_in_contents (id bigserial primary key, complex_id bigint, region text, stage text,
  content_text text, source_payload jsonb, is_public boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now(), unique (complex_id, stage));
create table public.prices (id bigserial primary key, item_id text unique, name text, price numeric, status text default 'active',
  collected_at timestamptz);
`;

const db = new PGlite();
await db.exec(STUB);
await db.exec(BOARD);
const ADMIN = '00000000-0000-4000-8000-0000000000aa', A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
await db.exec(`insert into auth.users values ('${ADMIN}'),('${A}'),('${B}');
  insert into public.profiles (id, nickname, field, role, created_at) values
    ('${ADMIN}', '운영자', 'custom', 'admin', '2026-07-04'), ('${A}', '에어컨김', 'aircon', 'member', '2026-08-01'), ('${B}', '줄눈박', 'grout', 'member', '2026-08-02');`);

const kstDay = (offset) => {   // 오늘(한국) ± 일 → YYYYMMDD
  const d = new Date(Date.now() + 9 * 3600e3 + offset * 86400e3);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};
// 적용 전에 있던 캘린더 행 — 최근 3일은 미리 올라가고 그보다 오래된 건 안 올라가야 한다
await db.exec(`insert into public.move_in_contents (complex_id, region, stage, content_text) values
  (1, 'METRO',  'calendar_metro_${kstDay(0)}',  '수도권 오늘 — 인천 OO단지 (2027년 3월 입주예정)'),
  (1, 'NATION', 'calendar_nation_${kstDay(-2)}', '전국 그제'),
  (1, 'NATION', 'calendar_nation_${kstDay(-5)}', '전국 닷새 전'),
  (1, 'METRO',  'D90', '캘린더 아님');
  insert into public.prices (item_id, name, price, collected_at) values
  ('copper', '전기동', 13975.1583, '2026-11-07T00:31:34Z'), ('usd_krw', '환율', 1364.05, '2026-11-07T00:31:34Z');`);

for (let i = 0; i < 2; i++) {               // 재실행 안전(단언 블록 두 번 통과)
  await db.exec(read('21_open_board.sql'));
  await db.exec(read('22_price_history.sql'));
  await db.exec(read('22b_price_history_backfill.sql'));
}

async function as(uid, sql) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
}
async function fails(p, re, label) {
  try { await p; } catch (e) { assert.match(e.message, re, label + ' → ' + e.message); return; }
  assert.fail(label + ': 실패해야 하는데 통과함');
}
let n = 0; const ok = () => n++;

// ── 미리 올린 캘린더 글: 최근 3일만, 운영자 이름으로, 자유게시판에
const moveIn = (await db.query(`select title, ref_id, board_type, author_id from public.posts where ref_type = 'move_in' order by ref_id`)).rows;
assert.deepEqual(moveIn.map((r) => r.ref_id).sort(), [`calendar_metro_${kstDay(0)}`, `calendar_nation_${kstDay(-2)}`].sort(), '최근 3일 캘린더만 미리 게시');
assert.ok(moveIn.every((r) => r.board_type === 'free' && r.author_id === ADMIN), '자유게시판 · 운영자');
assert.ok(moveIn.some((r) => /^입주 캘린더 · \d{1,2}\.\d{1,2} 수도권$/.test(r.title)), '제목 형식: ' + moveIn.map((r) => r.title));
ok();

// ── 파이프라인이 새 행을 넣으면 글이 생기고, 같은 행을 고치면 같은 글이 바뀐다(중복 없음)
await db.exec(`insert into public.posts (board_type, author_id, title, body) values
  ('free', '${A}', '자유 글', '안녕하세요'), ('proposal', '${B}', '제안 글', '이거 해 주세요'),
  ('job_offer', '${A}', '구인 글', '사람 구합니다');
  update public.posts set is_anonymous = true where title = '제안 글';`);
const today = kstDay(1);
await db.exec(`insert into public.move_in_contents (complex_id, region, stage, content_text) values (2, 'METRO', 'calendar_metro_${today}', '첫 판');`);
await db.exec(`update public.move_in_contents set content_text = '고친 판' where stage = 'calendar_metro_${today}';`);
const same = (await db.query(`select body from public.posts where ref_id = 'calendar_metro_${today}'`)).rows;
assert.equal(same.length, 1, '하루 한 글');
assert.equal(same[0].body, '고친 판', '고치면 본문이 바뀐다');
// 긴 본문은 4000자 안으로 줄 단위로 자르고 전체 위치를 적는다
const long = Array.from({ length: 400 }, (_, i) => '  · 경기 — 아주긴이름의단지' + i + ' (2028년 1월 입주예정)').join('\n');
await db.exec(`insert into public.move_in_contents (complex_id, region, stage, content_text) values (3, 'NATION', 'calendar_nation_${today}', '${long}');`);
const cut = (await db.query(`select body from public.posts where ref_id = 'calendar_nation_${today}'`)).rows[0].body;
assert.ok(cut.length <= 4000, '4000자 안');
assert.match(cut, /입주예정\)\n…\n\n.*입주 캘린더\(ainyeon\.com\/calendar\/\)/, '줄 단위로 자르고 전체 위치를 적는다');
// 캘린더가 아닌 행·비공개 행은 글이 되지 않는다
const before = (await db.query(`select count(*)::int c from public.posts`)).rows[0].c;
await db.exec(`insert into public.move_in_contents (complex_id, region, stage, content_text) values (4, 'METRO', 'D30', 'x');
  insert into public.move_in_contents (complex_id, region, stage, content_text, is_public) values (5, 'METRO', 'calendar_metro_20991231', 'x', false);`);
assert.equal((await db.query(`select count(*)::int c from public.posts`)).rows[0].c, before, '캘린더 아님·비공개는 무시');
ok();

// ── 게시 실패가 수집을 막지 않는다: 운영자가 없으면 글 없이 행만 들어간다
await db.exec(`update public.profiles set role = 'member' where id = '${ADMIN}';`);
await db.exec(`insert into public.move_in_contents (complex_id, region, stage, content_text) values (6, 'METRO', 'calendar_metro_20991230', 'x');`);
assert.equal((await db.query(`select count(*)::int c from public.posts where ref_id = 'calendar_metro_20991230'`)).rows[0].c, 0);
await db.exec(`update public.profiles set role = 'admin' where id = '${ADMIN}';`);
ok();

// ── 비회원: 자유·제안만, 원본 표는 못 본다, 입주 캘린더 본문은 비어 온다
for (const t of ['posts', 'comments', 'votes']) await fails(as(null, `select * from public.${t}`), /permission denied/, `anon ${t}`);
const guest = await as(null, `select title, board_type, body, ref_type, is_mine, author_nick from public.v_posts order by id`);
assert.ok(!guest.some((r) => r.board_type === 'job_offer'), '구인·구직은 회원 전용');
assert.ok(guest.some((r) => r.title === '자유 글' && r.body === '안녕하세요' && r.author_nick === '에어컨김'), '자유 글 공개');
assert.ok(guest.some((r) => r.title === '제안 글' && r.author_nick === null), '익명 글은 작성자 없음');
assert.ok(guest.filter((r) => r.ref_type === 'move_in').every((r) => r.body === null && r.title), '캘린더 본문은 회원만');
assert.ok(guest.every((r) => r.is_mine === null), '비회원은 내 글 표시 없음');
const member = await as(A, `select body from public.v_posts where ref_type = 'move_in'`);
assert.ok(member.length && member.every((r) => r.body), '회원은 캘린더 본문을 본다');
assert.ok((await as(A, `select 1 from public.v_posts where board_type = 'job_offer'`)).length === 1, '회원은 구인 글도 본다');
await fails(as(null, `insert into public.v_posts (title) values ('x')`), /permission denied|cannot insert/, 'anon v_posts 쓰기');
await fails(as(null, `select public.increment_post_view(1)`), /permission denied/, '비회원 조회수 올리기');
await fails(as(A, `select public.upsert_move_in_post('calendar_metro_20990101', 'x', true, now())`), /permission denied/, '회원이 자동 게시 함수 호출');
ok();

// ── 댓글·집계
const free = (await db.query(`select id from public.posts where title = '자유 글'`)).rows[0].id;
const job = (await db.query(`select id from public.posts where title = '구인 글'`)).rows[0].id;
await db.exec(`insert into public.comments (post_id, author_id, body) values (${free}, '${B}', '반갑습니다'), (${job}, '${B}', '연락 주세요');
  insert into public.votes values (${free}, '${A}', 'up'), (${free}, '${B}', 'up');`);
const gc = await as(null, `select * from public.v_comments`);
assert.equal(gc.length, 1, '비회원은 구인 글 댓글을 못 본다');
assert.equal(gc[0].author_nick, '줄눈박');
assert.ok(!('author_id' in gc[0]), '댓글 작성자 id 는 안 나간다');
assert.equal((await as(B, `select is_mine from public.v_comments where post_id = ${free}`))[0].is_mine, true);
assert.equal((await as(A, `select count(*)::int c from public.v_comments`))[0].c, 2, '회원은 모든 댓글');
const st = (await as(null, `select up, down, comments from public.v_post_stats where post_id = ${free}`))[0];
assert.deepEqual(st, { up: 2, down: 0, comments: 1 });
assert.equal((await as(null, `select count(*)::int c from public.v_post_stats where post_id = ${job}`))[0].c, 0, '구인 글 집계는 회원만');
await fails(as(null, `delete from public.v_post_stats`), /permission denied/, 'anon 집계 뷰 삭제');
ok();

// ── 시세 기록: 덮어써도 날마다 남고, 비회원은 읽기만
await db.exec(`update public.prices set price = 14000, collected_at = '2026-11-07T22:00:00Z' where item_id = 'copper';`);   // 11-08 KST
const hist = (await db.query(`select day::text, price::float from public.price_history where item_id = 'copper' and day >= '2026-11-07' order by day`)).rows;
assert.deepEqual(hist.map((h) => h.day), ['2026-11-07', '2026-11-08'], '날짜별로 남는다');
assert.equal(hist[1].price, 14000);
assert.ok((await as(null, `select count(*)::int c from public.price_history where item_id = 'usd_krw'`))[0].c >= 100, '백필 + 공개 읽기');
await fails(as(null, `insert into public.price_history values ('copper', '2026-01-01', 1, now())`), /permission denied|row-level security/, 'anon 기록 쓰기');
await fails(as(A, `delete from public.price_history`), /permission denied/, '회원 기록 지우기');
ok();

console.log(`test-open-board-sql: ${n}개 묶음 통과`);
