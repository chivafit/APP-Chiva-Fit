import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

declare const Deno: any;

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://chivafit.github.io";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
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

  const prompt = String(body?.prompt ?? "").trim();
  const system = body?.system == null ? "" : String(body.system);
  const model = String(body?.model || "claude-3-5-sonnet-20241022").trim() || "claude-3-5-sonnet-20241022";
  const maxTokens = Math.min(2048, Math.max(64, Number(body?.max_tokens ?? body?.maxTokens ?? 900) || 900));

  const apiKey =
    String(Deno.env.get("ANTHROPIC_API_KEY") || "").trim() ||
    String(Deno.env.get("CLAUDE_API_KEY") || "").trim();

  if (!prompt) return jsonResponse({ error: "Missing prompt" }, 400);
  if (!apiKey) return jsonResponse({ error: "Missing ANTHROPIC_API_KEY secret" }, 500);

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
      system: system || undefined,
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
  return jsonResponse({ text, raw: upstreamJson }, 200);
});
