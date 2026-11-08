// push-drain — 대기 중인 웹 푸시 알림(push_outbox)을 꺼내 보낸다. supabase/26_web_push.sql 짝.
//
// 누가 깨우나: push_outbox 에 줄이 들어갈 때(DB 트리거 → pg_net)와 매일 09:00 KST(pg_cron).
// 누가 불러도 '이미 대기 중인 것'만 보내므로 JWT 를 검사하지 않는다(verify_jwt=false).
//
// 절대 규칙:
//  - 키는 하드코딩하지 않는다. VAPID_PUBLIC_KEY·VAPID_PRIVATE_KEY 는 함수 비밀값, SUPABASE_* 는 플랫폼이 넣는 값.
//  - 응답·로그에 키, 구독 주소(endpoint), 알림 내용을 남기지 않는다(건수와 상태 코드만).
//  - service_role 은 push_claim·push_done 두 함수를 부르는 데만 쓴다.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

type Sub = { endpoint: string; p256dh: string; auth: string };
type Row = { id: number; title: string; body: string; url: string; subs: Sub[] };
type Result = { status: "sent" | "nosub" | "failed"; ok: string[]; gone: string[]; error: string | null };

// 한 알림을 그 회원의 모든 기기로. 404·410 은 푸시 서비스가 없앤 구독이라 지울 목록으로.
export async function deliver(
  row: Row,
  send: (sub: Sub, payload: string) => Promise<unknown>,
): Promise<Result> {
  const subs = row.subs ?? [];
  if (!subs.length) return { status: "nosub", ok: [], gone: [], error: null };
  const payload = JSON.stringify({ title: row.title, body: row.body, url: row.url });
  const ok: string[] = [], gone: string[] = [];
  let error: string | null = null;
  await Promise.all(subs.map(async (s) => {
    try {
      await send(s, payload);
      ok.push(s.endpoint);
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint);
      else error = `push ${code ?? "error"}`;
    }
  }));
  const status = ok.length ? "sent" : gone.length === subs.length ? "nosub" : "failed";
  return { status, ok, gone, error };
}

if (import.meta.main) {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  webpush.setVapidDetails("https://ainyeon.com", Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const send = (s: Sub, payload: string) =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
      TTL: 86400,
      urgency: "normal",
    });

  Deno.serve(async () => {
    const counts = { claimed: 0, sent: 0, nosub: 0, failed: 0 };
    const { data, error } = await sb.rpc("push_claim", { p_limit: 50 });
    if (error) {
      console.error("push_claim", error.code);
      return Response.json({ error: "claim failed" }, { status: 500 });
    }
    for (const row of (data ?? []) as Row[]) {
      counts.claimed++;
      const r = await deliver(row, send);
      counts[r.status]++;
      const done = await sb.rpc("push_done", { p_id: row.id, p_status: r.status, p_error: r.error, p_gone: r.gone, p_ok: r.ok });
      if (done.error) console.error("push_done", done.error.code);
    }
    console.log("push-drain", JSON.stringify(counts));
    return Response.json(counts);
  });
}
