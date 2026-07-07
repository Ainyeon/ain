// egress-test — Edge Function egress 검증용 본체
//
// 목적: 이 함수가 실제로 나가는 outbound IP의 국가와, BIZINFO_API_URL 호출
//       가능 여부를 JSON으로 보고한다. verify-egress.yml이 호출한다.
//
// 절대 규칙:
//  - 시크릿/키는 하드코딩하지 않는다. 필요한 값은 Deno.env로만 읽는다.
//  - 민감정보(키·토큰)를 응답이나 로그에 절대 포함하지 않는다.
//    BIZINFO_API_URL에 키가 쿼리로 붙어 있으면 URL 원문 대신 호스트만 노출한다.
//
// 참고: x-sb-edge-region 헤더는 Supabase 게이트웨이가 응답에 붙이는 것으로,
//       함수가 만들지 않는다. 워크플로우가 응답 헤더에서 직접 읽는다.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

const JSON_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  "Content-Type": "application/json; charset=utf-8",
};

// URL에서 호스트만 안전하게 추출 (키가 쿼리에 붙어 있어도 원문 노출 방지)
function safeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return "(invalid-url)";
  }
}

// fetch에 타임아웃을 거는 헬퍼
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 1) 함수(서버)의 실제 outbound IP와 국가를 확인한다.
async function getEgressIpInfo(): Promise<Record<string, unknown>> {
  try {
    const res = await fetchWithTimeout(
      "https://ipinfo.io/json",
      { headers: { accept: "application/json" } },
      10_000,
    );
    if (!res.ok) {
      return { ok: false, http_status: res.status, error: "ipinfo non-2xx" };
    }
    const data = await res.json();
    return {
      ok: true,
      ip: data?.ip ?? null,
      country: data?.country ?? null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 2) BIZINFO_API_URL 실제 호출을 시도한다.
async function getBizinfoResult(): Promise<Record<string, unknown>> {
  const target = Deno.env.get("BIZINFO_API_URL");
  if (!target) {
    return { ok: false, error: "BIZINFO_API_URL env not set" };
  }

  try {
    const res = await fetchWithTimeout(
      target,
      { headers: { accept: "application/json, text/plain, */*" } },
      10_000,
    );
    const body = await res.text();
    return {
      ok: res.ok,
      http_status: res.status,
      host: safeHost(target), // URL 원문 대신 호스트만
      sample: body.slice(0, 500), // 응답 앞부분 최대 500자
    };
  } catch (err) {
    return {
      ok: false,
      host: safeHost(target),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "method not allowed" }),
      { status: 405, headers: JSON_HEADERS },
    );
  }

  const [egressIpInfo, bizinfoResult] = await Promise.all([
    getEgressIpInfo(),
    getBizinfoResult(),
  ]);

  const payload: Record<string, unknown> = {
    egress_ip_info: egressIpInfo,
    bizinfo_result: bizinfoResult,
    checked_at: new Date().toISOString(),
  };

  // 함수가 인지 가능한 실행 리전 정보가 있으면 포함(없으면 생략).
  // 이는 함수 런타임 환경변수로 노출되는 값일 뿐, x-sb-edge-region 헤더와 무관.
  const region = Deno.env.get("SB_REGION") ?? Deno.env.get("DENO_REGION");
  if (region) {
    payload.runtime_region = region;
  }

  return new Response(JSON.stringify(payload), { status: 200, headers: JSON_HEADERS });
});
