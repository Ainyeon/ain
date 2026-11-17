// studio-agent 점검 — 네트워크 없음.  실행: deno test -A supabase/functions/studio-agent/core_test.ts
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { buildMessages, checkBody, costUsd, readOut, replySoFar } from "./core.ts";

const u = (content: string) => ({ role: "user", content }), a = (content: string) => ({ role: "assistant", content });

Deno.test("checkBody: 모드·순서·길이·첨부 크기", () => {
  assertEquals(checkBody({ mode: "general", messages: [u("안녕")] }).messages.length, 1);
  assertThrows(() => checkBody({ mode: "x", messages: [u("a")] }));
  assertThrows(() => checkBody({ mode: "general", messages: [] }));
  assertThrows(() => checkBody({ mode: "general", messages: [a("먼저")] }), Error, "bad_order");
  assertThrows(() => checkBody({ mode: "general", messages: [u("a"), a("b")] }), Error, "bad_order");   // 끝은 사용자
  assertThrows(() => checkBody({ mode: "general", messages: [u("가".repeat(1201))] }));
  assertThrows(() => checkBody({ mode: "general", messages: Array.from({ length: 17 }, (_, i) => (i % 2 ? a("b") : u("a"))) }));
  assertThrows(() => checkBody({ mode: "expert", messages: [u("a")], project: { x: "가".repeat(7000) } }), Error, "bad_project");
});

Deno.test("buildMessages: 첨부는 첫 사용자 말 앞에 자료로", () => {
  const m = buildMessages(checkBody({ mode: "expert", project: { title: "집" }, messages: [u("에어컨"), a("네"), u("더")] }));
  assertEquals(m.length, 3);
  assertEquals(m[0].content.startsWith("모드: 전문가"), true);
  assertEquals(m[0].content.includes('{"title":"집"}'), true);
  assertEquals(m[2].content, "더");
});

Deno.test("readOut: 정상·거절·깨짐·모르는 동작", () => {
  assertEquals(readOut({ stop_reason: "end_turn", content: [{ type: "text", text: '{"reply":" 네 ","actions":["maps","hack","plan_new","upload"]}' }] }), { reply: "네", actions: ["maps", "plan_new"] });
  assertEquals(readOut({ stop_reason: "refusal", content: [] }).actions, []);
  assertEquals(readOut({ stop_reason: "end_turn", content: [{ type: "text", text: "{깨짐" }] }).reply.startsWith("답을 만들지"), true);
});

Deno.test("replySoFar: 덜 온 JSON 에서 reply 앞부분만", () => {
  assertEquals(replySoFar('{"rep'), "");
  assertEquals(replySoFar('{"reply":"거실은 \\"남'), '거실은 "남');
  assertEquals(replySoFar('{"reply":"줄\\'), "줄");                       // 이스케이프가 반만 왔다
  assertEquals(replySoFar('{"reply":"a\\u00'), "a");
  assertEquals(replySoFar('{"reply":"a\\u00e9b\\nc","actions":["maps"]}'), "aéb\nc");
});

Deno.test("costUsd: 실측 한 번(입력 62·캐시 쓰기 1165·출력 478 → 약 $0.0156)", () => {
  assertEquals(Math.round(costUsd({ input_tokens: 62, cache_creation_input_tokens: 1165, output_tokens: 478 }) * 1e4), 156);
});
