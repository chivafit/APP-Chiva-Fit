import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://chivafit.github.io";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

type BlingTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

declare const Deno: any;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeJsonParse(text: string): any | null {
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInvalidGrant(status: number, bodyText: string) {
  if (status === 400 || status === 401) {
    const t = String(bodyText || "").toLowerCase();
    return t.includes("invalid_grant");
  }
  return false;
}

function parseLock(raw: unknown) {
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object") return { locked: false, by: null, at: null };
    return {
      locked: !!(obj as any).locked,
      by: (obj as any).by ?? null,
      at: (obj as any).at ?? null,
    };
  } catch (_e) {
    return { locked: false, by: null, at: null };
  }
}

async function getConfigValue(supabase: any, chave: string) {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("valor_texto")
    .eq("chave", chave)
    .maybeSingle();
  if (error) throw error;
  return data?.valor_texto ?? null;
}

async function upsertConfigValue(supabase: any, chave: string, valor_texto: string) {
  const { error } = await supabase.from("configuracoes").upsert([
    { chave, valor_texto, updated_at: nowIso() },
  ], { onConflict: "chave" });
  if (error) throw error;
}

async function ensureLockRowExists(supabase: any, lockKey: string) {
  try {
    const existing = await getConfigValue(supabase, lockKey);
    if (existing != null) return;
  } catch (_e) {}
  try {
    await supabase.from("configuracoes").insert([{ chave: lockKey, valor_texto: JSON.stringify({ locked: false, by: null, at: null }), updated_at: nowIso() }]);
  } catch (_e) {}
}

async function acquireRefreshLock(supabase: any, lockKey: string, requestId: string) {
  await ensureLockRowExists(supabase, lockKey);
  const maxWaitMs = 30_000;
  const pollMs = 600;
  const staleMs = 40_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const current = await supabase
      .from("configuracoes")
      .select("valor_texto")
      .eq("chave", lockKey)
      .maybeSingle();

    const curVal = String(current?.data?.valor_texto ?? JSON.stringify({ locked: false, by: null, at: null }));
    const parsed = parseLock(curVal);
    const lockAtMs = parsed.at ? new Date(String(parsed.at)).getTime() : 0;
    const isStale = parsed.locked && (!lockAtMs || isNaN(lockAtMs) || (Date.now() - lockAtMs) > staleMs);

    if (parsed.locked && !isStale) {
      await sleep(pollMs);
      continue;
    }

    const nextVal = JSON.stringify({ locked: true, by: requestId, at: nowIso() });
    const { data, error } = await supabase
      .from("configuracoes")
      .update({ valor_texto: nextVal, updated_at: nowIso() })
      .eq("chave", lockKey)
      .eq("valor_texto", curVal)
      .select("chave");
    if (!error && Array.isArray(data) && data.length) {
      return { acquired: true, lockValue: nextVal };
    }
    await sleep(150);
  }
  return { acquired: false, lockValue: null };
}

async function releaseRefreshLock(supabase: any, lockKey: string, lockValue: string) {
  try {
    const nextVal = JSON.stringify({ locked: false, by: null, at: null });
    await supabase
      .from("configuracoes")
      .update({ valor_texto: nextVal, updated_at: nowIso() })
      .eq("chave", lockKey)
      .eq("valor_texto", lockValue);
  } catch (_e) {}
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let supabase: any = null;
  let lockKey = "bling_refresh_lock";
  let lockValue: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const auth = req.headers.get("authorization") || "";
    if (!supabaseKey || auth !== `Bearer ${supabaseKey}`) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (!supabaseUrl) {
      throw new Error("Missing SUPABASE_URL environment variable.");
    }
    supabase = createClient(supabaseUrl, supabaseKey);

    const clientId = Deno.env.get("BLING_CLIENT_ID");
    const clientSecret = Deno.env.get("BLING_CLIENT_SECRET");
    const envRefreshToken = Deno.env.get("BLING_REFRESH_TOKEN") || "";

    if (!clientId || !clientSecret) {
      throw new Error("Missing environment variables: BLING_CLIENT_ID or BLING_CLIENT_SECRET.");
    }

    const requestId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + String(Math.random()).slice(2);

    const rawBody = await req.text().catch(() => "");
    const body = safeJsonParse(rawBody);
    if (body === null) return json({ error: "Invalid JSON" }, 400);

    const bodyRefresh = String(body?.refresh_token || body?.refreshToken || "").trim();

    const lock = await acquireRefreshLock(supabase, lockKey, requestId);
    if (!lock.acquired || !lock.lockValue) {
      const latestAccess = String(await getConfigValue(supabase, "bling_access_token") || "").trim();
      if (latestAccess) {
        return json({ access_token: latestAccess, token_type: "bearer", expires_in: 0, scope: "" });
      }
      return json({ error: "Token refresh in progress. Tente novamente." }, 429);
    }
    lockValue = lock.lockValue;

    let currentRefreshToken = "";
    try {
      const cfgRefresh = String(await getConfigValue(supabase, "bling_refresh_token") || "").trim();
      currentRefreshToken = String(cfgRefresh || bodyRefresh || envRefreshToken || "").trim();
    } catch (_e) {
      currentRefreshToken = String(bodyRefresh || envRefreshToken || "").trim();
    }

    if (!currentRefreshToken) {
      throw new Error("Missing refresh token (set BLING_REFRESH_TOKEN secret or store bling_refresh_token in configuracoes).");
    }

    const b64 = btoa(`${clientId}:${clientSecret}`);
    const url = "https://www.bling.com.br/Api/v3/oauth/token";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "enable-jwt": "1",
        "Authorization": `Basic ${b64}`,
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(currentRefreshToken)}`,
    });

    if (!response.ok) {
      const txt = await response.text().catch(() => "");
      if (isInvalidGrant(response.status, txt)) {
        // Registrar erro para que o frontend possa alertar o usuário
        try {
          await upsertConfigValue(supabase, "bling_token_error", JSON.stringify({
            type: "invalid_grant",
            message: "Refresh Token inválido/rotacionado. Reautorize o Bling.",
            at: nowIso(),
          }));
        } catch (_e) {}
        lockValue = null; // impede double-release no finally
        await releaseRefreshLock(supabase, lockKey, lock.lockValue!);
        return json({
          error: "invalid_grant",
          message: "Refresh Token do Bling inválido/rotacionado. Reautorize o Bling nas Configurações.",
          reauthorize: true,
        }, 401);
      }
      throw new Error(`Erro API Bling: ${response.status} ${txt || "- Verifique o Refresh Token"}`);
    }

    const data = (await response.json()) as BlingTokenResponse;
    const access_token = String(data?.access_token || "").trim();
    const refresh_token = String(data?.refresh_token || "").trim();
    if (!access_token) throw new Error("Bling token response missing access_token.");

    const nextRefresh = refresh_token || currentRefreshToken;
    await upsertConfigValue(supabase, "bling_access_token", access_token);
    await upsertConfigValue(supabase, "bling_refresh_token", nextRefresh);
    // Limpar erro anterior após renovação bem-sucedida
    try { await upsertConfigValue(supabase, "bling_token_error", ""); } catch (_e) {}

    const safeResponse = {
      access_token,
      token_type: data?.token_type,
      expires_in: data?.expires_in,
      scope: data?.scope,
    };

    lockValue = null; // impede double-release no finally
    await releaseRefreshLock(supabase, lockKey, lock.lockValue!);
    return json(safeResponse, 200);

  } catch (error) {
    const errMsg = (error as any)?.message || String(error);
    // Registrar erro genérico para visibilidade no painel
    try {
      if (supabase) {
        await upsertConfigValue(supabase, "bling_token_error", JSON.stringify({
          type: "error",
          message: errMsg,
          at: nowIso(),
        }));
      }
    } catch (_e) {}
    return json({ error: errMsg }, 500);
  } finally {
    if (supabase && lockValue) {
      await releaseRefreshLock(supabase, lockKey, lockValue);
    }
  }
});
