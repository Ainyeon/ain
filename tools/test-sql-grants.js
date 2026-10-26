// SQL 권한 정적 검사 — 실행: node tools/test-sql-grants.js
// DB·네트워크·PGlite 를 쓰지 않는다. sql/*.sql 과 supabase/*.sql 을 적용 순서대로 읽어 "권한 상태"를 흉내 낸 뒤 규칙을 건다.
//
// 왜 필요한가: PGlite 검사(test-work-sql / test-studio-sql)는 17·19·20 만 본다. 07~16(게시판·익명·저장·뷰)의 GRANT/RLS/definer 는
//   기계가 보는 곳이 없고, PGlite 는 이 worktree 에 설치돼 있지 않으면 exit 2 로 건너뛴다.
//
// 가정(17_work.sql 머리말과 같다): 이 DB 의 default ACL 은 새 테이블·뷰·시퀀스에 anon/authenticated 전체, 함수에는 PUBLIC 실행을 준다.
//   그래서 revoke 가 없으면 열려 있는 것으로 센다. 운영 DB 실측과는 다를 수 있다 — 이 검사는 "파일이 약속하는 상태"만 본다.
//
// KNOWN 은 SQL 파일에서 읽어 낼 수 있는 이미 알려진 권한 부채다. 정확히 같을 때만 통과한다:
//   새 위반이 생기면 실패, 부채를 고쳐서 사라지면 "목록에서 지우라"며 실패 → 목록이 거짓말을 하지 못한다.
//   그래서 공개 뷰·RPC·정책을 정당하게 늘리거나 부채를 갚을 때도 이 파일의 목록을 함께 고쳐야 한다(의도된 동작).
// 한계: DROP 뒤 재생성된 default ACL, ALTER OWNER, 운영 DB 의 실제 ACL 은 모델링하지 않는다. 로그인이 필요한 동작도 보지 않는다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORDER = [
  'sql/07-community.sql', 'sql/08-fix-grants-roles.sql', 'sql/09-engagement.sql', 'sql/10-fields-expand.sql',
  'supabase/11_v_gov_list.sql', 'supabase/12_summary_column.sql', 'supabase/14_hook_column.sql',
  'supabase/15_launch.sql', 'supabase/16_jobs_board.sql', 'supabase/17_work.sql',
  'supabase/19_admin_drafts.sql', 'supabase/20_studio.sql'
];
// sql/·supabase/ 의 모든 .sql 은 ORDER(적용 순서)에 있거나 여기에 이름이 있어야 한다 — 새 마이그레이션이 규칙 밖으로 빠지지 않게.
const NOT_APPLIED = ['supabase/_crosscheck_probe.sql'];   // 읽기 전용 대조용 SELECT 모음(아래 3-9 에서 따로 본다)
for (const dir of ['sql', 'supabase']) {
  for (const e of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = dir + '/' + e;
    assert.ok(!e.endsWith('.sql') || ORDER.includes(rel) || NOT_APPLIED.includes(rel),
      rel + ' 가 이 검사의 ORDER 에 없다 — 적용 순서대로 넣어 GRANT·RLS 규칙을 통과시킬 것');
  }
}
const ALL = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'];

// ── 1. 문장 분리: 주석 제거, 문자열·$$ 본문·"식별자" 안의 ; 는 건드리지 않는다
function statements(src) {
  const out = []; let cur = ''; let i = 0; const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '-' && d === '-') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'") { let j = i + 1; while (j < n) { if (src[j] === "'" && src[j + 1] === "'") j += 2; else if (src[j] === "'") break; else j++; } cur += src.slice(i, j + 1); i = j + 1; continue; }
    if (c === '"') { const e = src.indexOf('"', i + 1); cur += src.slice(i, e + 1); i = e + 1; continue; }
    if (c === '$') { const m = /^\$([A-Za-z_]*)\$/.exec(src.slice(i, i + 40)); if (m) { const e = src.indexOf(m[0], i + m[0].length); cur += src.slice(i, e + m[0].length); i = e + m[0].length; continue; } }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function splitBody(stmt) {
  const m = /\$([A-Za-z_]*)\$/.exec(stmt);
  if (!m) return { head: stmt, body: '' };
  const e = stmt.indexOf(m[0], m.index + m[0].length);
  return { head: stmt.slice(0, m.index) + ' $$ ' + stmt.slice(e + m[0].length), body: stmt.slice(m.index + m[0].length, e) };
}
const lc = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const splitTop = (s) => { const r = []; let d = 0, c = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { r.push(c.trim()); c = ''; } else c += ch; } if (c.trim()) r.push(c.trim()); return r; };

// ── 2. 권한 상태 흉내
function load() {
  const objs = new Map(); const rls = new Set(); const policies = []; const triggers = []; const probe = [];
  const ensure = (kind, name, file) => {
    const k = kind + ':' + name.replace(/^public\./, '');
    if (!objs.has(k)) {
      const o = { kind, name: name.replace(/^public\./, ''), file, tbl: { anon: new Set(), authenticated: new Set() }, col: { anon: {}, authenticated: {} }, exec: new Set(), external: false };
      if (kind !== 'function') ALL.forEach((p) => { o.tbl.anon.add(p); o.tbl.authenticated.add(p); });
      else ['public', 'anon', 'authenticated'].forEach((r) => o.exec.add(r));
      objs.set(k, o);
    }
    return objs.get(k);
  };
  for (const f of ORDER) {
    for (const st of statements(fs.readFileSync(path.join(ROOT, f), 'utf8'))) {
      const { head, body } = splitBody(st); const h = lc(head); let m;
      if ((m = /^create table (?:if not exists )?(public\.\w+)/.exec(h))) {
        ensure('table', m[1], f);
        for (const sm of head.matchAll(/\b(\w+)\s+(?:big)?serial\b/gi)) ensure('sequence', m[1].replace('public.', '') + '_' + sm[1] + '_seq', f);
      } else if ((m = /^create (?:or replace )?view (public\.\w+)/.exec(h))) {
        const o = ensure('view', m[1], f); o.definer = !/security_invoker/.test(h); o.sql = lc(st);
      } else if ((m = /^create (?:or replace )?function (public\.\w+)\s*\(/.exec(h))) {
        const argsRaw = /\(([^)]*)\)/.exec(head.slice(head.toLowerCase().indexOf(m[1].toLowerCase())))[1];
        const types = splitTop(argsRaw).map((a) => a.split(/\s+/).filter((w) => !/^default$/i.test(w))[1] || '').filter(Boolean);
        const o = ensure('function', m[1] + '(' + types.join(',') + ')', f);
        Object.assign(o, { fname: m[1].replace('public.', ''), definer: /\bsecurity definer\b/.test(h), setPath: /\bset search_path\b/.test(h), body: lc(body), trig: /returns trigger/.test(h) });
      } else if ((m = /^alter table (public\.\w+) enable row level security/.exec(h))) rls.add(m[1].replace('public.', ''));
      else if ((m = /^create policy "([^"]+)" on ((?:public|storage)\.\w+)(?: as \w+)? for (\w+) to ([\w, ]+?)(?: using| with check|$)/.exec(h))) {
        policies.push({ name: m[1], table: m[2], cmd: m[3], roles: m[4].split(',').map((x) => x.trim()),
          using: (/ using \((.*?)\)(?: with check|$)/.exec(h) || [])[1] || '', check: (/ with check \((.*)\)$/.exec(h) || [])[1] || '', file: f });
      } else if ((m = /^create trigger (\w+) (before|after) (.+?) on (public\.\w+) .*execute function (public\.\w+)/.exec(h))) triggers.push({ name: m[1], when: m[2] + ' ' + m[3], table: m[4], fn: m[5].replace('public.', ''), file: f });
      else if ((m = /^(grant|revoke) (.+?) on (?:(table|sequence|function) )?(.+?) (?:to|from) (.+)$/.exec(h))) {
        const [, verb, privs, kindW, objsRaw, rolesRaw] = m; const roles = rolesRaw.split(',').map((x) => x.trim());
        for (const nm of splitTop(objsRaw)) {
          if (kindW === 'function') {
            const mm = /^public\.(\w+)\s*\(([^)]*)\)/.exec(nm); if (!mm) continue;
            const o = objs.get('function:' + mm[1] + '(' + mm[2].split(',').map((a) => a.trim()).filter(Boolean).join(',') + ')');
            assert.ok(o, f + ': 정의가 없는 함수에 ' + verb + ' — ' + nm);
            roles.forEach((r) => (verb === 'grant' ? o.exec.add(r) : o.exec.delete(r)));
            continue;
          }
          const t = nm.replace(/^public\./, '');
          const o = objs.get('table:' + t) || objs.get('view:' + t) || objs.get('sequence:' + t) || (/^public\./.test(nm) ? Object.assign(ensure(kindW === 'sequence' ? 'sequence' : 'table', nm, f), { external: true }) : null);
          if (!o) continue;
          for (const it of splitTop(privs)) {
            const pm = /^([a-z ]+?)\s*(?:\(([^)]*)\))?$/.exec(it); const p = pm[1].trim(); const cols = pm[2] ? pm[2].split(',').map((c) => c.trim()) : null;
            for (const r of roles) {
              if (r === 'public') continue;
              for (const pp of (p === 'all' || p === 'all privileges') ? ALL : [p]) {
                if (verb === 'grant') { if (cols) { (o.col[r][pp] = o.col[r][pp] || new Set()); cols.forEach((c) => o.col[r][pp].add(c)); } else o.tbl[r].add(pp); }
                else if (!cols) { o.tbl[r].delete(pp); delete o.col[r][pp]; } else if (o.col[r][pp]) cols.forEach((c) => o.col[r][pp].delete(c));
              }
            }
          }
        }
      }
    }
  }
  for (const st of statements(fs.readFileSync(path.join(ROOT, 'supabase/_crosscheck_probe.sql'), 'utf8'))) probe.push(lc(st));
  return { objs, rls, policies, triggers, probe };
}
const M = load();
const all = (kind) => [...M.objs.values()].filter((o) => o.kind === kind);
// 열 단위로 본 실효 권한 (테이블 단위 부여는 모든 열을 덮는다)
const can = (t, role, priv, col) => { const o = M.objs.get('table:' + t) || M.objs.get('view:' + t); return !!o && (o.tbl[role].has(priv) || !!(o.col[role][priv] && o.col[role][priv].has(col))); };
const any = (o, role, priv) => o.tbl[role].has(priv) || !!(o.col[role][priv] && o.col[role][priv].size);

// ── 3. 알려진 부채 (SQL 파일 기준). 줄이는 방향으로만 바꾼다.
const KNOWN = {
  // authenticated 에 남은 TRUNCATE/REFERENCES/TRIGGER. 07 이 insert/update/delete 만 회수했다(PostgREST 는 TRUNCATE 를 노출하지 않아 위생 수준).
  authDangerous: ['comments', 'profiles', 'reports', 'site_stats', 'votes'],
  // anon 에 남은 TRUNCATE/REFERENCES/TRIGGER (site_stats). 09 가 insert/update/delete 만 회수했다.
  anonDangerous: ['site_stats'],
  // 시퀀스 default ACL 미회수 — 07 의 4개 + 15 의 admin_author_lookups. (신규 항목: 시퀀스)
  sequences: ['admin_author_lookups_id_seq', 'comments_id_seq', 'posts_id_seq', 'reports_id_seq', 'votes_id_seq'],
  // 테이블 단위 INSERT/UPDATE 를 가진 authenticated 표 (08 [A]: supabase-js upsert 가 전 열을 SET 하기 때문)
  tableLevelWrite: ['votes'],
  // anon(PUBLIC 포함)이 실행할 수 있는 함수. bump_stat·get_card·submit_card_request 는 의도(공개 카운터·카드 링크), 나머지는 PUBLIC 기본 실행권
  anonExec: ['bump_stat', 'get_card', 'is_admin_user', 'submit_card_request', 'tg_mask_comment', 'tg_mask_post'],
  // definer 인데 본문이 로그인·권한을 직접 묻지 않는 함수 (조회수/카운터는 의도, 카드 둘은 토큰이 열쇠)
  noIdentityGuard: ['bump_stat', 'get_card', 'increment_post_view', 'submit_card_request'],
  // 프런트 쓰기 페이로드가 열 GRANT 에 없는 곳 — 지금은 없다. (onboard 자가복구 insert 의 updated_at 은 보내지 않게 고쳤다: 07 의 INSERT 열은 id,nickname,field,region 뿐)
  frontWrite: []
};
const found = { authDangerous: new Set(), anonDangerous: new Set(), sequences: new Set(), tableLevelWrite: new Set(), anonExec: new Set(), noIdentityGuard: new Set(), frontWrite: new Set() };
const problems = [];
const bad = (m) => problems.push(m);

// 3-1 RLS: repo 가 만든 표는 전부 RLS ON
for (const t of all('table').filter((o) => !o.external)) if (!M.rls.has(t.name)) bad(`RLS 꺼짐: ${t.name} (${t.file})`);

// 3-2 anon: 표·뷰 권한은 공개 허용 목록뿐, 시퀀스는 부채 목록뿐
const ANON_OK = { v_board_teaser: ['select'], v_gov_list: ['select'], site_stats: ['select'] };
for (const o of [...all('table'), ...all('view')]) {
  for (const p of ALL) {
    if (!any(o, 'anon', p)) continue;
    if ((ANON_OK[o.name] || []).includes(p)) continue;
    if (['truncate', 'references', 'trigger'].includes(p) && KNOWN.anonDangerous.includes(o.name)) { found.anonDangerous.add(o.name); continue; }
    bad(`anon 권한 ${p.toUpperCase()}: ${o.name} (${o.file})`);
  }
}
for (const o of all('sequence')) if (!o.external && (any(o, 'anon', 'select') || any(o, 'authenticated', 'update'))) {
  // 시퀀스는 USAGE/SELECT/UPDATE 만 의미가 있다. 이 모델의 select/update 가 그 흔적이다.
  if (KNOWN.sequences.includes(o.name)) found.sequences.add(o.name); else bad(`시퀀스 default 권한 미회수: ${o.name} (${o.file})`);
}

// 3-3 authenticated: 뷰에는 쓰기 없음, TRUNCATE/REFERENCES/TRIGGER 없음, 테이블 단위 쓰기는 목록뿐
for (const o of [...all('table'), ...all('view')]) {
  for (const p of ['truncate', 'references', 'trigger']) if (any(o, 'authenticated', p)) { if (KNOWN.authDangerous.includes(o.name)) found.authDangerous.add(o.name); else bad(`authenticated ${p.toUpperCase()}: ${o.name}`); }
  if (o.kind === 'view') for (const p of ['insert', 'update', 'delete']) if (any(o, 'authenticated', p) || any(o, 'anon', p)) bad(`뷰에 쓰기 권한 ${p}: ${o.name}`);
  if (o.kind === 'table' && !o.external || o.name === 'profiles') for (const p of ['insert', 'update']) if (o.tbl.authenticated.has(p)) { if (KNOWN.tableLevelWrite.includes(o.name)) found.tableLevelWrite.add(o.name); else bad(`테이블 단위 ${p.toUpperCase()}: ${o.name}`); }
}

// 3-4 민감 열 — 클라이언트가 쓰거나 읽을 수 없어야 하는 열
const NO = [
  ['profiles', ['insert', 'update'], ['role', 'is_admin', 'business_id']],
  ['posts', ['select'], ['author_id']],
  ['posts', ['insert'], ['status', 'view_count', 'status_reason', 'admin_answer', 'admin_answered_at', 'closed_at']],
  ['posts', ['update'], ['author_id', 'board_type', 'status', 'status_reason', 'admin_answer', 'admin_answered_at', 'view_count', 'is_anonymous', 'ref_type', 'ref_id', 'review_kind', 'created_at']],
  ['comments', ['update'], ['author_id', 'post_id']],
  ['reports', ['update', 'delete'], ['reason']],
  ['work_customers', ['insert', 'update'], ['card_token', 'user_id']],
  ['work_jobs', ['insert', 'update'], ['user_id']],
  ['work_photos', ['update'], ['path', 'user_id', 'job_id']],
  ['subscriptions', ['select'], ['note']],
  ['studio_jobs', ['select'], ['params', 'inputs', 'outputs', 'user_id', 'worker']],
  ['studio_jobs', ['insert', 'update'], ['status', 'user_id', 'tool']]
];
for (const [t, privs, cols] of NO) for (const p of privs) for (const c of cols) {
  if (p === 'delete') { if (can(t, 'authenticated', 'delete')) bad(`${t}: authenticated DELETE`); continue; }
  if (can(t, 'authenticated', p, c) && !(t === 'votes')) bad(`민감 열 ${p.toUpperCase()}: ${t}.${c}`);
  if (can(t, 'anon', p, c)) bad(`anon 민감 열 ${p.toUpperCase()}: ${t}.${c}`);
}

// 3-5 함수: definer 는 search_path 고정, EXECUTE 는 필요한 역할에만, 로그인 확인이 본문에 있어야 한다
const fns = all('function');
// 본문(또는 본문이 부르는 보호된 definer 함수)이 re 로 호출자를 확인하는 함수 이름 집합
function guardedBy(re) {
  const set = new Set(fns.filter((f) => f.definer && re.test(f.body)).map((f) => f.fname));
  for (let grew = true; grew; ) { grew = false; for (const f of fns) if (f.definer && !set.has(f.fname) && [...set].some((g) => f.body.includes('public.' + g + '('))) { set.add(f.fname); grew = true; } }
  return set;
}
const guarded = guardedBy(/auth\.uid\(\)|is_admin_user\(\)|studio_is_worker\(\)/);
const adminGuarded = guardedBy(/is_admin_user\(\)/);   // admin_* 는 로그인(auth.uid())이 아니라 운영자 확인이어야 한다
for (const f of fns) {
  if (f.definer && !f.setPath) bad(`SECURITY DEFINER 에 search_path 없음: ${f.name}`);
  if (f.exec.has('anon') || f.exec.has('public')) { if (KNOWN.anonExec.includes(f.fname)) found.anonExec.add(f.fname); else bad(`anon/PUBLIC 이 실행 가능: ${f.name} (${f.file})`); }
  if (f.definer && !f.trig && f.exec.has('authenticated') && !guarded.has(f.fname)) { if (KNOWN.noIdentityGuard.includes(f.fname)) found.noIdentityGuard.add(f.fname); else bad(`definer 인데 auth.uid()/is_admin_user() 확인 없음: ${f.name}`); }
  if (f.definer && f.fname.startsWith('admin_') && !adminGuarded.has(f.fname)) bad(`admin_ 함수가 is_admin_user() 로 운영자 확인을 안 함: ${f.name}`);
}

// 3-6 뷰: definer 뷰를 anon 에 여는 것은 목록뿐, 회원용 definer 뷰는 로그인 조건을 안에서 다시 건다
for (const v of all('view')) {
  if (v.definer && any(v, 'authenticated', 'select') && !any(v, 'anon', 'select') && !/auth\.uid\(\) is not null/.test(v.sql)) bad(`회원용 definer 뷰에 로그인 조건 없음: ${v.name}`);
}

// 3-7 정책: 역할 명시, INSERT/ALL 은 WITH CHECK, using(true) 는 SELECT 만, 본인·운영자 확인 없는 정책은 목록뿐
const OPEN_SELECT = ['posts:members read posts', 'comments:members read comments', 'votes:members read votes', 'profiles:members read profiles',
  'site_stats:anyone reads stats', 'notice_complexes:members read notice complexes'];
for (const p of M.policies) {
  const id = p.table.replace(/^\w+\./, '') + ':' + p.name;
  if (!p.roles.length || p.roles.includes('public')) bad(`정책에 대상 역할이 없음(PUBLIC): ${id}`);
  if (['insert', 'all'].includes(p.cmd) && !p.check) bad(`INSERT/ALL 정책에 WITH CHECK 없음: ${id}`);
  const open = p.using.trim() === 'true';
  if (open && (p.cmd !== 'select' || !OPEN_SELECT.includes(id))) bad(`using (true) 정책: ${id}`);
  if (!open && p.table.startsWith('public.') && !/auth\.uid\(\)|is_admin_user\(\)/.test(p.using + ' ' + p.check)) bad(`본인/운영자 조건 없는 정책: ${id}`);
  if (p.table === 'storage.objects' && !/bucket_id\s*=/.test(p.using + ' ' + p.check)) bad(`storage 정책에 bucket_id 조건 없음: ${p.name}`);
}

// 3-8 트리거: 연락처 가림은 저장 시점(BEFORE)에 제목·본문 INSERT/UPDATE 모두에 걸려 있어야 한다 (15 [G])
const trg = (n) => M.triggers.find((t) => t.name === n);
assert.ok(trg('mask_contacts_posts') && /^before insert or update of title, body$/.test(trg('mask_contacts_posts').when) && trg('mask_contacts_posts').fn === 'tg_mask_post', 'mask_contacts_posts 트리거 정의가 달라졌다');
assert.ok(trg('mask_contacts_comments') && /^before insert or update of body$/.test(trg('mask_contacts_comments').when) && trg('mask_contacts_comments').fn === 'tg_mask_comment', 'mask_contacts_comments 트리거 정의가 달라졌다');
for (const f of ['tg_mask_post', 'tg_mask_comment']) assert.ok(M.objs.get('function:' + f + '()').body.includes('public.mask_contacts('), f + ' 가 mask_contacts 를 부르지 않는다');

// 3-9 읽기 전용 프로브 파일은 SELECT 만
for (const s of M.probe) if (!/^select\b/.test(s)) bad('supabase/_crosscheck_probe.sql 에 SELECT 가 아닌 문장: ' + s.slice(0, 60));

// ── 4. 프런트 쓰기 계약: insert/update/upsert 페이로드의 키가 열 GRANT 안에 있어야 한다
//      (08 의 "permission denied for table votes" 와 같은 부류 — 화면에서는 '저장 실패'로만 보인다)
function argOf(src, open) { let d = 0; for (let i = open; i < src.length; i++) { const c = src[i]; if ('({['.includes(c)) d++; if (')}]'.includes(c)) { d--; if (!d) return src.slice(open + 1, i); } } return ''; }
const topKeys = (obj) => splitTop(obj).map((k) => (k.startsWith('...') ? k : (/^['"]?([A-Za-z_]\w*)/.exec(k) || [])[1])).filter(Boolean);
function walk(dir, out) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!/^(legacy|_dev|_private|tools|docs|node_modules|\.git|\.claude|\.playwright-mcp|view)$/.test(e.name)) walk(rel, out); }
    else if (/\.(js|html)$/.test(e.name)) out.push(rel);
  }
  return out;
}
let sites = 0;
for (const f of walk('', [])) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (let m, re = /from\(\s*['"](\w+)['"]\s*\)([\s\S]{0,160}?)\.(insert|update|upsert)\(/g; (m = re.exec(src)); ) {
    const table = m[1]; if (!M.objs.has('table:' + table)) continue;                       // repo SQL 이 모르는 표(work-store 의 pick() 등)는 별도 검사가 있다
    const first = argOf(src, m.index + m[0].length - 1).trim().split(/,(?![^{]*})/)[0].trim();
    let keys = first.startsWith('{') ? topKeys(argOf(first, 0)) : (/^\w+$/.test(first) ? ['...' + first] : []);
    const keysX = [];
    for (const k of keys) {
      if (!k.startsWith('...')) { keysX.push(k); continue; }
      const nm = k.slice(3), lit = new RegExp('(?:const|let)\\s+' + nm + '\\s*=\\s*\\{').exec(src);
      if (lit) keysX.push(...topKeys(argOf(src, lit.index + lit[0].length - 1)));
      for (const a of src.matchAll(new RegExp('\\b' + nm + '\\.(\\w+)\\s*=(?!=)', 'g'))) keysX.push(a[1]);
    }
    sites++;
    for (const c of new Set(keysX)) {
      const ops = m[3] === 'upsert' ? ['insert', 'update'] : [m[3]];
      for (const op of ops) if (!can(table, 'authenticated', op, c)) {
        const id = `${f} ${table}.${m[3]} ${c}`;
        if (KNOWN.frontWrite.includes(id)) found.frontWrite.add(id); else bad(`프런트가 보내는 열에 ${op.toUpperCase()} 권한 없음: ${id} (:${src.slice(0, m.index).split('\n').length})`);
      }
    }
  }
}
assert.ok(sites >= 10, '프런트 쓰기 호출을 거의 못 찾았다(검사가 헛돈다): ' + sites);

// 4-2 프런트가 부르는 RPC 는 repo SQL 에 있고, 부르는 쪽이 실행할 수 있어야 한다 (비로그인 페이지가 부르는 것만 anon)
const ANON_RPC = ['bump_stat', 'get_card', 'submit_card_request'];
const rpcs = new Map();
for (const f of walk('', [])) for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/\.rpc\(\s*['"](\w+)['"]/g)) rpcs.set(m[1], f);
assert.ok(rpcs.size >= 10, 'rpc 호출을 거의 못 찾았다: ' + rpcs.size);
for (const [name, f] of rpcs) {
  const fn = fns.filter((x) => x.fname === name);
  if (!fn.length) { bad(`${f}: rpc('${name}') 가 repo SQL 에 없다`); continue; }
  if (!fn.some((x) => x.exec.has('authenticated'))) bad(`${f}: rpc('${name}') 를 authenticated 가 실행할 수 없다`);
  if (ANON_RPC.includes(name) && !fn.some((x) => x.exec.has('anon') || x.exec.has('public'))) bad(`${f}: 비로그인 rpc('${name}') 를 anon 이 실행할 수 없다`);
}

// ── 5. 알려진 부채 목록이 현실과 정확히 같은가
for (const [k, list] of Object.entries(KNOWN)) {
  const stale = list.filter((x) => !found[k].has(x));
  if (stale.length) bad(`KNOWN.${k} 에서 지울 것(이미 고쳐졌다): ${stale.join(', ')}`);
}

if (problems.length) { console.error('test-sql-grants: 실패 ' + problems.length + '건\n - ' + problems.join('\n - ')); process.exit(1); }
console.log(`test-sql-grants: OK (표 ${all('table').length}·뷰 ${all('view').length}·함수 ${fns.length}·정책 ${M.policies.length}, 프런트 쓰기 ${sites}곳)`);
