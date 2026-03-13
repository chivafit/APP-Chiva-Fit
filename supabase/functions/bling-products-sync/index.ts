import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

declare const Deno: any;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BlingTokenResponse = { access_token: string; expires_in?: number; refresh_token?: string };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeJsonParse(text: string): unknown {
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

let tokenCache: { token: string; expiresAtMs: number } | null = null;

let rateMutex: Promise<void> = Promise.resolve();
let nextAllowedAtMs = 0;
const minSpacingMs = 350;

async function rateLimitWait() {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const prev = rateMutex;
  rateMutex = prev.then(() => gate);
  await prev;

  const now = Date.now();
  const waitMs = Math.max(0, nextAllowedAtMs - now);
  nextAllowedAtMs = Math.max(now, nextAllowedAtMs) + minSpacingMs;
  release();
  if (waitMs > 0) await sleep(waitMs);
}

async function getStoredBlingAccessToken(supabaseUrl: string, serviceRoleKey: string): Promise<string> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase
    .from("configuracoes")
    .select("valor_texto")
    .eq("chave", "bling_access_token")
    .maybeSingle();
  if (error) throw error;
  return String(data?.valor_texto || "").trim();
}

async function renewBlingTokenViaEdgeFunction(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<BlingTokenResponse> {
  const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/bling-renew-token`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25_000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      let details = txt;
      try {
        const parsed = JSON.parse(txt);
        if (parsed?.error) details = String(parsed.error);
        if (parsed?.message) details = String(parsed.message);
      } catch (_e) {}
      if (resp.status === 401) {
        throw new Error(`BLING_REAUTH_REQUIRED:${details || "invalid_grant"}`);
      }
      throw new Error(`Falha ao renovar token: ${resp.status} ${details || "sem detalhes"}`);
    }
    const data = (await resp.json()) as BlingTokenResponse;
    const access_token = String(data?.access_token || "").trim();
    if (!access_token) throw new Error("bling-renew-token returned no access_token");
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getBlingAccessToken(supabaseUrl: string, serviceRoleKey: string, forceRenew = false) {
  const now = Date.now();
  const safetyWindowMs = 120_000;
  if (!forceRenew && tokenCache?.token && now < tokenCache.expiresAtMs - safetyWindowMs) return tokenCache.token;

  if (!forceRenew) {
    try {
      const stored = await getStoredBlingAccessToken(supabaseUrl, serviceRoleKey);
      if (stored) {
        tokenCache = { token: stored, expiresAtMs: now + 10 * 60 * 1000 };
        return stored;
      }
    } catch (_e) {}
  }

  const renewed = await renewBlingTokenViaEdgeFunction(supabaseUrl, serviceRoleKey);
  const expiresInSec = Number(renewed?.expires_in ?? 0) || 6 * 60 * 60;
  tokenCache = { token: renewed.access_token, expiresAtMs: now + expiresInSec * 1000 };
  return renewed.access_token;
}

async function blingFetchJson(
  url: string,
  tokenRef: { value: string },
  supabaseUrl: string,
  serviceRoleKey: string,
  retry = true,
): Promise<any> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await rateLimitWait();
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenRef.value}`,
      },
    });

    if (resp.status === 401 && retry) {
      tokenRef.value = await getBlingAccessToken(supabaseUrl, serviceRoleKey, true);
      return await blingFetchJson(url, tokenRef, supabaseUrl, serviceRoleKey, false);
    }

    if (resp.status === 429 && attempt < maxAttempts) {
      const retryAfter = String(resp.headers.get("retry-after") || "").trim();
      let waitMs = 0;
      if (retryAfter) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds) && seconds > 0) waitMs = Math.ceil(seconds * 1000);
      }
      if (!waitMs) waitMs = Math.min(10_000, 500 * Math.pow(2, attempt - 1));
      await sleep(waitMs);
      continue;
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`Bling API error: ${resp.status} ${txt}`);
    }
    return await resp.json();
  }
  throw new Error("Bling API error: 429 Too Many Requests");
}

function mapBlingProduct(row: any) {
  const data = row?.data ?? row ?? {};
  const id = String(data?.id ?? "").trim();
  const codigo = String(data?.codigo ?? data?.codigoItem ?? data?.codigoProduto ?? data?.sku ?? "").trim();
  const nome = String(data?.nome ?? data?.descricao ?? data?.descricaoCurta ?? "").trim();
  const situacao = String(data?.situacao?.nome ?? data?.situacao ?? data?.status ?? "").trim();
  const preco = data?.preco ?? data?.precoVenda ?? data?.valor ?? data?.precoVenda1;
  const estoqueRaw =
    data?.estoque?.saldo ??
    data?.estoque?.saldoFisico ??
    data?.saldo ??
    data?.saldoFisico ??
    data?.estoque ??
    data?.estoqueAtual ??
    null;
  const estoque = estoqueRaw == null ? null : Number(estoqueRaw) || 0;
  const precoNum = preco == null ? null : Number(preco) || 0;
  return {
    id,
    codigo: codigo || null,
    nome: nome || null,
    estoque,
    preco: precoNum,
    situacao: situacao || null,
    origem: "bling",
    updated_at: nowIso(),
    raw: data,
  };
}

async function persistProductsToDb(supabaseUrl: string, serviceRoleKey: string, products: any[]) {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = nowIso();
  const rows = products
    .map((p) => ({
      id: String(p?.id ?? "").trim(),
      codigo: p?.codigo ?? null,
      nome: p?.nome ?? null,
      estoque: p?.estoque ?? null,
      preco: p?.preco ?? null,
      situacao: p?.situacao ?? null,
      origem: "bling",
      updated_at: now,
      raw: p?.raw ?? {},
    }))
    .filter((p) => p.id);

  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await supabase.from("v2_produtos").upsert(batch, { onConflict: "id" });
    if (error) throw error;
  }

  await supabase.from("configuracoes").upsert([{ chave: "ultima_sync_bling_produtos", valor_texto: now, updated_at: now }], {
    onConflict: "chave",
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Only POST" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);

    const cronSecret = Deno.env.get("CRON_SECRET") || "";

    const bodyText = await req.text().catch(() => "");
    const parsed = safeJsonParse(bodyText);
    if (parsed === null) return jsonResponse({ error: "Invalid JSON" }, 400);
    const body = (parsed && typeof parsed === "object" ? parsed : {}) as any;

    const persist = body?.persist === true;
    if (persist) {
      const headerSecret = String(req.headers.get("x-cron-secret") || "").trim();
      if (!cronSecret || headerSecret !== cronSecret) return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const limit = Math.min(100, Math.max(1, Number(body?.limit ?? 100) || 100));
    const maxPages = Math.min(500, Math.max(1, Number(body?.maxPages ?? 200) || 200));

    const tokenRef = { value: await getBlingAccessToken(supabaseUrl, serviceRoleKey) };
    const base = "https://api.bling.com.br/Api/v3/produtos";

    const out: any[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = `${base}?pagina=${page}&limite=${limit}`;
      const json = await blingFetchJson(url, tokenRef, supabaseUrl, serviceRoleKey);
      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      if (!data.length) break;
      data.forEach((r: any) => {
        const mapped = mapBlingProduct(r);
        if (mapped.id) out.push(mapped);
      });
      if (data.length < limit) break;
    }

    if (persist) {
      await persistProductsToDb(supabaseUrl, serviceRoleKey, out);
      return jsonResponse({ ok: true, persisted: true, count: out.length }, 200);
    }

    return jsonResponse({ products: out, count: out.length }, 200);
  } catch (e) {
    const err = e as any;
    const msg = String(err?.message || String(err) || "");
    if (msg.startsWith("BLING_REAUTH_REQUIRED:")) {
      return jsonResponse(
        {
          error: "bling_reauthorize_required",
          message: msg.replace(/^BLING_REAUTH_REQUIRED:/, "").trim() || "Reautorize o Bling nas Configurações.",
          reauthorize: true,
        },
        401,
      );
    }
    return jsonResponse({ error: msg }, msg.startsWith("Bling API error:") ? 400 : 500);
  }
});

