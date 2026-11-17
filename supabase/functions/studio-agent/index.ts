// studio-agent — 스튜디오 에이전트 대화 한 번(Claude API). supabase/28_studio_agent.sql 짝. 화면은 maker/3d/agent/.
//
// 절대 규칙:
//  - 키는 하드코딩하지 않는다. ANTHROPIC_API_KEY 는 함수 비밀값, SUPABASE_* 는 플랫폼이 넣는 값.
//  - 로그인한 회원만(JWT 확인). 회원 하루 30번·전체 하루 3달러(studio_agent_take).
//  - 응답·로그에 대화 내용을 남기지 않는다(상태와 토큰 수만).
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { buildMessages, checkBody, costUsd, LIMITS, MODEL, readOut, replySoFar, SCHEMA, SYSTEM } from "./core.ts";

const ORIGINS = [/^https:\/\/(www\.)?ainyeon\.com$/, /^http:\/\/localhost:\d+$/];
const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ORIGINS.some((r) => r.test(o)) ? o : "https://ainyeon.com",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
});

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  const out = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: h });
  if (req.method !== "POST") return out(405, { error: "method" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  if (!who?.user) return out(401, { error: "login" });

  let body, stream = false;
  try { const raw = await req.json(); stream = raw?.stream === true; body = checkBody(raw); } catch (e) { return out(400, { error: (e as Error).message }); }

  const { data: take, error: te } = await db.rpc("studio_agent_take", { p_user: who.user.id, p_user_max: LIMITS.userPerDay, p_day_usd: LIMITS.usdPerDay });
  if (te) return out(500, { error: "usage" });
  if (!take?.ok) return out(429, { error: take?.why ?? "limit" });

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const params = {
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: buildMessages(body),
  } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;   // fallbacks·output_config 가 SDK 타입보다 새로울 수 있어 모양만 맞춘다
  const finish = async (res: Anthropic.Beta.Messages.BetaMessage) => {
    const usd = costUsd(res.usage);
    await db.rpc("studio_agent_spend", { p_user: who.user.id, p_usd: usd });
    console.log(JSON.stringify({ ok: true, stop: res.stop_reason, in: res.usage.input_tokens, out: res.usage.output_tokens, usd: Math.round(usd * 1e4) / 1e4 }));
    return { ...readOut(res), left: take.left };
  };
  const fail = (e: unknown) => {
    const status = e instanceof Anthropic.APIError ? e.status : 0;
    console.log(JSON.stringify({ ok: false, status }));
    return status === 429 ? "busy" : "model";
  };

  if (!stream) {
    try { return out(200, await finish(await client.beta.messages.create(params))); }
    catch (e) { return out(502, { error: fail(e) }); }
  }

  // 스트리밍: 답 글이 오는 대로 {t} 조각, 끝에 {done, reply, actions, left}. 도중 실패는 {error}
  const enc = new TextEncoder();
  const body$ = new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      let raw = "", sent = 0;
      try {
        const s = client.beta.messages.stream(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming);
        for await (const ev of s) {
          if (ev.type !== "content_block_delta" || ev.delta.type !== "text_delta") continue;
          raw += ev.delta.text;
          const r = replySoFar(raw);
          if (r.length > sent) { send({ t: r.slice(sent) }); sent = r.length; }
        }
        send({ done: true, ...(await finish(await s.finalMessage())) });
      } catch (e) { send({ error: fail(e) }); }
      ctrl.close();
    },
  });
  return new Response(body$, { headers: { ...h, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
});
