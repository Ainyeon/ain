// studio-agent — 스튜디오 에이전트 대화 한 번(Claude API). supabase/28_studio_agent.sql 짝. 화면은 maker/3d/agent/.
//
// 절대 규칙:
//  - 키는 하드코딩하지 않는다. ANTHROPIC_API_KEY 는 함수 비밀값, SUPABASE_* 는 플랫폼이 넣는 값.
//  - 로그인한 회원만(JWT 확인). 회원 하루 30번·전체 하루 3달러(studio_agent_take).
//  - 응답·로그에 대화 내용을 남기지 않는다(상태와 토큰 수만).
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { buildMessages, checkBody, costUsd, LIMITS, MODEL, readOut, SCHEMA, SYSTEM } from "./core.ts";

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

  let body;
  try { body = checkBody(await req.json()); } catch (e) { return out(400, { error: (e as Error).message }); }

  const { data: take, error: te } = await db.rpc("studio_agent_take", { p_user: who.user.id, p_user_max: LIMITS.userPerDay, p_day_usd: LIMITS.usdPerDay });
  if (te) return out(500, { error: "usage" });
  if (!take?.ok) return out(429, { error: take?.why ?? "limit" });

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: buildMessages(body),
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);   // fallbacks·output_config 가 SDK 타입보다 새로울 수 있어 모양만 맞춘다
    const usd = costUsd(res.usage);
    await db.rpc("studio_agent_spend", { p_user: who.user.id, p_usd: usd });
    console.log(JSON.stringify({ ok: true, stop: res.stop_reason, in: res.usage.input_tokens, out: res.usage.output_tokens, usd: Math.round(usd * 1e4) / 1e4 }));
    return out(200, { ...readOut(res), left: take.left });
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : 0;
    console.log(JSON.stringify({ ok: false, status }));
    return out(502, { error: status === 429 ? "busy" : "model" });
  }
});
