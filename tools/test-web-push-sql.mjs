// supabase/26_web_push.sql 검사 — PGlite(WASM)로, 운영 DB를 건드리지 않는다.
// 준비(한 번): npm i --prefix tools        실행: node tools/test-web-push-sql.mjs
// 역할·auth.uid 는 test-work-sql.mjs STUB, 게시판 표는 test-open-board-sql.mjs BOARD 를 그대로 쓴다.
// pg_net 은 흉내만 낸다(net.http_post 가 부른 주소를 net.calls 에 적는다). pg_cron 은 없으면 건너뛰는지만 본다.
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
const SQL = fs.readFileSync(path.join(repo, 'supabase', '26_web_push.sql'), 'utf8');

const db = new PGlite();
await db.exec(grab('test-work-sql.mjs', 'STUB'));
await db.exec(grab('test-open-board-sql.mjs', 'BOARD'));
await db.exec(`
  create schema net;
  create table net.calls (id bigserial primary key, url text);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
    timeout_milliseconds integer default 5000) returns bigint language sql as $$ insert into net.calls (url) values (url) returning id $$;
  create table public.saved_items (id bigserial primary key, user_id uuid not null references public.profiles(id),
    target_type text not null, target_id text not null, unique (user_id, target_type, target_id));
  create table public.move_in_complexes (id bigserial primary key, complex_name_raw text not null, complex_name_ad text,
    expected_move_in date, is_public boolean not null default true);`);

const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c';
await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}');
  insert into public.profiles (id, nickname, field, role) values ('${A}', '에어컨김', 'aircon', 'member'),
    ('${B}', '줄눈박', 'grout', 'member'), ('${C}', '청소이', 'cleaning', 'member');`);

for (let i = 0; i < 2; i++) await db.exec(SQL);   // 재실행 안전(단언 블록 두 번 통과)

async function as(uid, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role ${uid === 'service' ? 'service_role' : uid ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
async function fails(p, re, label) {
  try { await p; } catch (e) { assert.match(e.message, re, label + ' → ' + e.message); return; }
  assert.fail(label + ' — 막혀야 하는데 통과함');
}
const q = async (sql) => (await db.query(sql)).rows;
const outbox = () => q(`select user_id, kind, title, body, url, dedupe_key from public.push_outbox order by id`);
const calls = async () => (await q(`select count(*)::int n from net.calls`))[0].n;
const FCM = 'https://fcm.googleapis.com/fcm/send/abc123';
const KEY = 'B' + 'x'.repeat(86), AUTH = 'y'.repeat(22);

// 1) 기기 등록 — 회원 본인만, 알려진 푸시 서비스만, 표는 직접 못 읽음
await as(A, `select public.save_push_subscription($1, $2, $3)`, [FCM, KEY, AUTH]);
assert.equal((await q(`select user_id from public.push_subscriptions`))[0].user_id, A);
await fails(as(A, `select public.save_push_subscription('https://evil.example.com/x', $1, $2)`, [KEY, AUTH]), /알 수 없는 알림 주소/, '아무 주소');
await fails(as(null, `select public.save_push_subscription($1, $2, $3)`, [FCM, KEY, AUTH]), /permission denied/, '비회원 등록');
await fails(as(A, `select * from public.push_subscriptions`), /permission denied/, '회원 표 직접 읽기');
await fails(as(A, `select * from public.push_outbox`), /permission denied/, '회원 알림 줄 읽기');
await fails(as(A, `select * from public.push_claim(10)`), /permission denied/, '회원 대기 줄 가져가기');
await fails(as(A, `select public.push_enqueue('${A}', 'test', 't', 'b', '/', null)`), /permission denied/, '회원 알림 만들기');

// 2) 댓글 — 남의 글에 달리면 글쓴이에게, 내 글에 내가 단 건 없음, 구독 없는 글쓴이는 쌓지 않음
await db.exec(`insert into public.posts (id, board_type, author_id, title, body) values
  (1, 'free', '${A}', '실외기 앵글 질문', '본문'), (2, 'proposal', '${A}', '알림 기능', '본문'), (3, 'free', '${C}', 'C 글', '본문')`);
const before = await calls();
await db.exec(`insert into public.comments (post_id, author_id, body) values (1, '${B}', E'저는   벽걸이\\n앵글 씁니다')`);
await db.exec(`insert into public.comments (post_id, author_id, body) values (1, '${A}', '감사합니다')`);
await db.exec(`insert into public.comments (post_id, author_id, body) values (3, '${B}', 'C는 구독 없음')`);
let rows = await outbox();
assert.equal(rows.length, 1, '남이 단 댓글 1건만');
assert.deepEqual([rows[0].user_id, rows[0].kind, rows[0].url], [A, 'comment', '/board/free/?id=1']);
assert.equal(rows[0].body, '줄눈박: 저는 벽걸이 앵글 씁니다', '공백 정리');
assert.ok(await calls() > before, '넣을 때 보내는 함수를 깨움');

// 3) 공감·찬성 — 글마다 하루 한 번, 반대는 없음
await db.exec(`insert into public.votes (post_id, user_id, vote) values (1, '${B}', 'up'), (1, '${C}', 'up'), (2, '${B}', 'down')`);
await db.exec(`insert into public.votes (post_id, user_id, vote) values (2, '${C}', 'up')`);
rows = await outbox();
const votes = rows.filter((r) => r.kind === 'vote');
assert.equal(votes.length, 2, '글 1 공감 하루 한 번 + 제안 2 찬성');
assert.equal(votes[1].title, '내 제안에 찬성이 늘었어요');
assert.equal(votes[1].url, '/board/proposal/?id=2');

// 4) 관심 단지 입주 — 30일·7일, 월 단위는 30일 전만, 같은 날 다시 돌려도 한 번
await db.exec(`insert into public.move_in_complexes (id, complex_name_raw, complex_name_ad, expected_move_in, is_public) values
  (10, 'OO자이', 'OO자이', '2027-01-01', true), (11, 'XX힐스', 'XX힐스', '2026-12-09', true),
  (12, '숨김단지', '숨김단지', '2027-01-01', false), (13, '먼단지', '먼단지', '2027-06-15', true), (14, '월단지', '월단지', '2026-12-01', true);
  insert into public.saved_items (user_id, target_type, target_id) values ('${A}', 'complex', '10'), ('${A}', 'complex', '11'),
    ('${A}', 'complex', '12'), ('${A}', 'complex', '13'), ('${A}', 'complex', '14'), ('${B}', 'complex', '10'), ('${A}', 'edu', '10');`);
assert.equal((await q(`select public.push_movein_reminders('2026-12-02') n`))[0].n, 2, 'OO자이 30일(월 단위) + XX힐스 7일');
await q(`select public.push_movein_reminders('2026-12-02')`);
assert.equal((await q(`select public.push_movein_reminders('2026-11-24') n`))[0].n, 0, '월 단위 7일 전은 보내지 않음');
const movein = (await outbox()).filter((r) => r.kind === 'movein');
assert.equal(movein.length, 2, '다시 돌려도 한 번');
assert.deepEqual(movein.map((r) => [r.title, r.body, r.url]), [
  ['관심 단지 입주가 다가와요', 'OO자이 · 2027년 1월 입주 예정', '/area/?complex=10'],
  ['관심 단지 입주 D-7', 'XX힐스 · 12월 9일 입주 예정', '/area/?complex=11'],
]);
assert.ok(!movein.some((r) => r.user_id === B), 'B 는 구독이 없어 쌓지 않음');

// 5) 보내는 함수: 가져가기 → 다시 가져가지 않음 → 결과 적기(없어진 구독은 지움)
const claimed = await as('service', `select id, user_id, title, url, subs from public.push_claim(50)`);
assert.equal(claimed.length, 5);
assert.deepEqual(claimed[0].subs, [{ endpoint: FCM, p256dh: KEY, auth: AUTH }]);
assert.equal((await as('service', `select * from public.push_claim(50)`)).length, 0, '이미 가져간 줄');
await as('service', `select public.push_done($1, 'sent', null, '{}', $2)`, [claimed[0].id, [FCM]]);
await as('service', `select public.push_done($1, 'nosub', null, $2, '{}')`, [claimed[1].id, [FCM]]);
assert.deepEqual(await q(`select status from public.push_outbox where id in (${claimed[0].id}, ${claimed[1].id}) order by id`),
  [{ status: 'sent' }, { status: 'nosub' }]);
assert.equal((await q(`select count(*)::int n from public.push_subscriptions`))[0].n, 0, '410 받은 구독은 지움');

// 6) 구독이 없으면 쌓지 않음 · 남의 기기는 못 지움 · 같은 기기를 다른 계정이 켜면 옮겨 감
await db.exec(`insert into public.comments (post_id, author_id, body) values (1, '${C}', '구독 없을 때')`);
assert.equal((await outbox()).length, 5, '구독 없으면 안 쌓임');
await as(A, `select public.save_push_subscription($1, $2, $3)`, [FCM, KEY, AUTH]);
await as(B, `select public.delete_push_subscription($1)`, [FCM]);
assert.equal((await q(`select count(*)::int n from public.push_subscriptions`))[0].n, 1, 'B 는 A 기기를 못 지움');
await as(B, `select public.save_push_subscription($1, $2, $3)`, [FCM, KEY, AUTH]);
assert.equal((await q(`select user_id from public.push_subscriptions`))[0].user_id, B, '같은 기기를 B 가 켜면 B 것');
await as(B, `select public.delete_push_subscription($1)`, [FCM]);
assert.equal((await q(`select count(*)::int n from public.push_subscriptions`))[0].n, 0);

console.log('test-web-push-sql: 6 groups OK');
