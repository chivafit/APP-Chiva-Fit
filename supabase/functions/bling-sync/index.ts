import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

declare const Deno: any;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BlingTokenResponse = { access_token: string; expires_in?: number; refresh_token?: string };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

let tokenCache: { token: string; expiresAtMs: number } | null = null;

function isBlingCommunicationError(err: any): boolean {
  const msg = String(err?.message || err || "");
  return msg.startsWith("Bling API error:") || msg.startsWith("Falha ao renovar token:");
}

function safeJsonParse(text: string): unknown {
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
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
): Promise<unknown> {
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${tokenRef.value}`,
    },
  });
  if (resp.status === 401 && retry) {
    try {
      console.log("[bling-sync] 401 no Bling, renovando token e tentando novamente:", url);
    } catch (_e) {}
    tokenRef.value = await getBlingAccessToken(supabaseUrl, serviceRoleKey, true);
    return await blingFetchJson(url, tokenRef, supabaseUrl, serviceRoleKey, false);
  }
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    try {
      console.log("[bling-sync] Bling API error", {
        url,
        status: resp.status,
        statusText: resp.statusText,
        body: String(txt || "").slice(0, 2000),
      });
    } catch (_e) {}
    throw new Error(`Bling API error: ${resp.status} ${txt}`);
  }
  return await resp.json();
}

function pick<T>(v: T | null | undefined, fallback: T): T {
  return v == null ? fallback : v;
}

function toIsoDate(d: unknown): string {
  const s = String(d || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return "";
}

function onlyDigits(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function normUF(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(s)) return s;
  const norm = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const map: Record<string, string> = {
    ACRE: "AC",
    ALAGOAS: "AL",
    AMAPA: "AP",
    AMAZONAS: "AM",
    BAHIA: "BA",
    CEARA: "CE",
    "DISTRITO FEDERAL": "DF",
    "ESPIRITO SANTO": "ES",
    GOIAS: "GO",
    MARANHAO: "MA",
    "MATO GROSSO": "MT",
    "MATO GROSSO DO SUL": "MS",
    "MINAS GERAIS": "MG",
    PARA: "PA",
    PARAIBA: "PB",
    PARANA: "PR",
    PERNAMBUCO: "PE",
    PIAUI: "PI",
    "RIO DE JANEIRO": "RJ",
    "RIO GRANDE DO NORTE": "RN",
    "RIO GRANDE DO SUL": "RS",
    RONDONIA: "RO",
    RORAIMA: "RR",
    "SANTA CATARINA": "SC",
    "SAO PAULO": "SP",
    SERGIPE: "SE",
    TOCANTINS: "TO",
  };
  if (map[norm]) return map[norm];
  const letters = norm.replace(/ /g, "");
  return letters.length >= 2 ? letters.slice(0, 2) : "";
}

function mapBlingOrder(detail: any) {
  const data = detail?.data ?? detail ?? {};
  const contato = data?.contato ?? {};
  const contatoEndereco = contato?.endereco ?? {};
  const etiqueta = data?.transporte?.etiqueta ?? data?.etiqueta ?? {};

  const endereco = {
    municipio: String(pick(etiqueta?.municipio, contatoEndereco?.municipio) ?? "").trim(),
    uf: normUF(pick(etiqueta?.uf, contatoEndereco?.uf)),
    cep: onlyDigits(pick(etiqueta?.cep, contatoEndereco?.cep)),
    logradouro: String(pick(etiqueta?.endereco, contatoEndereco?.endereco) ?? "").trim(),
    numero: String(pick(etiqueta?.numero, contatoEndereco?.numero) ?? "").trim(),
    bairro: String(pick(etiqueta?.bairro, contatoEndereco?.bairro) ?? "").trim(),
  };

  const itensRaw = (data?.itens ?? data?.itensPedido ?? data?.produtos ?? []) as any[];
  const itens = Array.isArray(itensRaw)
    ? itensRaw
        .map((it) => {
          const prod = it?.produto ?? it ?? {};
          const descricao = String(prod?.descricao ?? prod?.nome ?? it?.descricao ?? "").trim();
          const codigo = String(prod?.codigo ?? prod?.sku ?? prod?.id ?? it?.codigo ?? "").trim();
          const quantidade = Number(it?.quantidade ?? it?.qty ?? 0) || 0;
          const valor = Number(it?.valor ?? it?.valorUnitario ?? it?.preco ?? 0) || 0;
          return { descricao, codigo, quantidade, valor };
        })
        .filter((it) => it.descricao || it.codigo)
    : [];

  const numero = String(data?.numero ?? data?.numeroPedido ?? data?.numeroPedidoLoja ?? data?.id ?? "").trim();
  const id = String(data?.id ?? numero).trim();
  const total = Number(data?.total ?? data?.totalProdutos ?? data?.valorTotal ?? 0) || 0;
  const dataPedido = toIsoDate(data?.data ?? data?.dataEmissao ?? data?.dataPedido ?? data?.dataCriacao ?? "");
  const status = String(data?.situacao?.nome ?? data?.situacao ?? data?.status ?? "").trim();

  const email = String(contato?.email ?? "").trim().toLowerCase();
  const tel = onlyDigits(contato?.telefone ?? contato?.fone ?? "");
  const cel = onlyDigits(contato?.celular ?? contato?.cel ?? "");
  const doc = onlyDigits(contato?.numeroDocumento ?? contato?.cpfCnpj ?? contato?.cpf ?? contato?.cnpj ?? "");

  return {
    id,
    numero,
    data: dataPedido,
    total,
    situacao: { nome: status },
    _source: "bling",
    cidade_entrega: endereco.municipio || null,
    uf_entrega: endereco.uf || null,
    contato: {
      nome: String(contato?.nome ?? "Desconhecido").trim(),
      cpfCnpj: doc,
      email,
      telefone: tel,
      celular: cel,
      endereco,
    },
    itens,
    _raw: data,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (idx < items.length) {
      const current = items[idx++];
      results.push(await fn(current));
    }
  });
  await Promise.all(workers);
  return results;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Only POST" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);

    const bodyText = await req.text().catch(() => "");
    const parsed = safeJsonParse(bodyText);
    if (parsed === null) return jsonResponse({ error: "Invalid JSON" }, 400);
    const body = (parsed && typeof parsed === "object" ? parsed : {}) as any;
    const from = String(body?.from ?? "").slice(0, 10);
    const to = String(body?.to ?? "").slice(0, 10);
    if (!from || !to) return jsonResponse({ error: "Missing from/to (YYYY-MM-DD)" }, 400);

    const limit = Math.min(100, Math.max(1, Number(body?.limit ?? 100) || 100));
    const maxPages = Math.min(200, Math.max(1, Number(body?.maxPages ?? 50) || 50));
    const concurrency = Math.min(10, Math.max(1, Number(body?.concurrency ?? 6) || 6));

    try {
      console.log("[bling-sync] request", { from, to, limit, maxPages, concurrency });
    } catch (_e) {}

    const tokenRef = { value: await getBlingAccessToken(supabaseUrl, serviceRoleKey) };

    const base = "https://api.bling.com.br/Api/v3/pedidos/vendas";
    const ids: string[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = `${base}?dataInicial=${encodeURIComponent(from)}&dataFinal=${encodeURIComponent(to)}&pagina=${page}&limite=${limit}`;
      const json: any = await blingFetchJson(url, tokenRef, supabaseUrl, serviceRoleKey);
      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      if (!data.length) break;
      data.forEach((r: any) => {
        const id = String(r?.id ?? "").trim();
        if (id) ids.push(id);
      });
      if (data.length < limit) break;
    }

    const uniqueIds = Array.from(new Set(ids));
    try {
      console.log("[bling-sync] ids", { total: ids.length, unique: uniqueIds.length });
    } catch (_e) {}

    const details = await mapWithConcurrency(uniqueIds, concurrency, async (id) => {
      const url = `${base}/${encodeURIComponent(id)}`;
      const json: any = await blingFetchJson(url, tokenRef, supabaseUrl, serviceRoleKey);
      return mapBlingOrder(json);
    });

    return jsonResponse({ orders: details, count: details.length });
  } catch (e) {
    const err = e as any;
    try {
      console.log("[bling-sync] internal error", { message: err?.message || String(err) });
      if (err?.stack) console.log(String(err.stack).slice(0, 5000));
    } catch (_e) {}
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
    if (isBlingCommunicationError(err)) {
      return jsonResponse({ error: err?.message || String(err) }, 400);
    }
    return jsonResponse({ error: err?.message || String(err) }, 500);
  }
});
