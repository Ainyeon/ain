// push-drain 점검 — 네트워크로 보내지 않는다.  실행: deno test -A supabase/functions/push-drain/drain_test.ts
// ① deliver: 기기별 결과를 sent/nosub/failed 로 묶고 404·410 구독을 지울 목록으로 뺀다.
// ② npm:web-push 가 Deno(에지 런타임과 같은 계열)에서 암호화·VAPID 서명을 실제로 만든다.
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import webpush from "npm:web-push@3.6.7";
import { deliver } from "./index.ts";

const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, p256dh: "k", auth: "a" });
const row = (subs: ReturnType<typeof sub>[]) => ({ id: 1, title: "t", body: "b", url: "/board/free/?id=1", subs });
const fail = (statusCode: number) => Object.assign(new Error("x"), { statusCode });

Deno.test("deliver: 기기마다 보내고 결과를 묶는다", async () => {
  const seen: string[] = [];
  const r = await deliver(row([sub(1), sub(2), sub(3)]), (s, payload) => {
    seen.push(payload);
    if (s.endpoint.endsWith("/2")) return Promise.reject(fail(410));
    if (s.endpoint.endsWith("/3")) return Promise.reject(fail(500));
    return Promise.resolve();
  });
  assertEquals(r.status, "sent");
  assertEquals(r.ok, [sub(1).endpoint]);
  assertEquals(r.gone, [sub(2).endpoint]);
  assertEquals(r.error, "push 500");
  assertEquals(JSON.parse(seen[0]), { title: "t", body: "b", url: "/board/free/?id=1" });
});

Deno.test("deliver: 구독 없음·전부 사라짐·전부 실패", async () => {
  assertEquals((await deliver(row([]), () => Promise.resolve())).status, "nosub");
  assertEquals((await deliver(row([sub(1)]), () => Promise.reject(fail(404)))).status, "nosub");
  assertEquals((await deliver(row([sub(1)]), () => Promise.reject(fail(429)))).status, "failed");
});

Deno.test("web-push: Deno 에서 암호화·VAPID 서명 생성", async () => {
  // 받는 쪽(브라우저) 키를 만들어 실제 구독처럼 꾸민다
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const vapid = webpush.generateVAPIDKeys();
  const details = webpush.generateRequestDetails(
    { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: b64u(raw), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } },
    JSON.stringify({ title: "에인연", body: "시험", url: "/" }),
    { vapidDetails: { subject: "https://ainyeon.com", publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 },
  );
  assertEquals(details.method, "POST");
  assertEquals(details.headers["Content-Encoding"], "aes128gcm");
  assertMatch(String(details.headers["Authorization"]), /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assertEquals(details.body.length > 100, true);
});
