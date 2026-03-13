import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

declare const Deno: any;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(String(text || ""));
  } catch (_e) {
    return null;
  }
}

function firstTextFromAnthropic(respJson: any): string {
  const content = Array.isArray(respJson?.content) ? respJson.content : [];
  for (const c of content) {
    if (c?.type === "text" && typeof c?.text === "string") return c.text;
  }
  const txt = respJson?.text;
  return typeof txt === "string" ? txt : "";
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Only POST" }, 405);

  const bodyText = await req.text().catch(() => "");
  const parsed = safeJsonParse(bodyText);
  if (parsed === null) return jsonResponse({ error: "Invalid JSON" }, 400);
  const body = (parsed && typeof parsed === "object" ? parsed : {}) as any;

  const contexto = body?.contexto ?? {};
  const pergunta = String(body?.pergunta ?? "").trim();
  const model = String(body?.model || "claude-3-5-sonnet-20241022").trim() || "claude-3-5-sonnet-20241022";
  const maxTokens = Math.min(2048, Math.max(128, Number(body?.max_tokens ?? body?.maxTokens ?? 900) || 900));

  const apiKey =
    String(body?.apiKey ?? body?.key ?? "").trim() ||
    String(req.headers.get("x-anthropic-key") || req.headers.get("x-api-key") || "").trim();

  if (!pergunta) return jsonResponse({ error: "Missing pergunta" }, 400);
  if (!apiKey) return jsonResponse({ error: "Missing apiKey" }, 400);

  const prompt = `CONTEXTO_JSON:\n${JSON.stringify(contexto)}\n\nPERGUNTA:\n${pergunta}`.trim();
  const system = String(body?.system ?? "Responda estritamente em JSON válido. Não inclua texto fora do JSON.").trim();

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const upstreamText = await upstream.text().catch(() => "");
  const upstreamJson = safeJsonParse(upstreamText) ?? { raw: upstreamText };

  if (!upstream.ok) {
    const msg =
      String(upstreamJson?.error?.message ?? upstreamJson?.message ?? upstreamJson?.error ?? upstreamText ?? "").trim() ||
      `Anthropic error (${upstream.status})`;
    return jsonResponse({ error: msg }, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 500);
  }

  const text = firstTextFromAnthropic(upstreamJson).trim();
  const jsonOnly = safeJsonParse(text);
  if (jsonOnly && typeof jsonOnly === "object") return jsonResponse(jsonOnly, 200);
  return jsonResponse({ text, raw: upstreamJson }, 200);
});
