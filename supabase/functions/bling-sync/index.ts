import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BlingTokenPair = { access_token: string; refresh_token?: string };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getConfigValue(supabase: ReturnType<typeof createClient>, chave: string) {
  const { data, error } = await supabase.from("configuracoes").select("valor_texto").eq("chave", chave).maybeSingle();
  if (error) throw error;
  return data?.valor_texto ?? "";
}

async function setConfigValues(supabase: ReturnType<typeof createClient>, rows: { chave: string; valor_texto: string }[]) {
  if (!rows.length) return;
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({ ...r, updated_at: now }));
  const { error } = await supabase.from("configuracoes").upsert(payload);
  if (error) throw error;
}

async function renewBlingToken(supabase: ReturnType<typeof createClient>): Promise<BlingTokenPair> {
  const clientId = Deno.env.get("BLING_CLIENT_ID");
  const clientSecret = Deno.env.get("BLING_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Missing BLING_CLIENT_ID/BLING_CLIENT_SECRET env vars");

  const currentRefresh = await getConfigValue(supabase, "bling_refresh_token");
  if (!currentRefresh) throw new Error("Missing bling_refresh_token in configuracoes");

  const b64 = btoa(`${clientId}:${clientSecret}`);
  const url = "https://api.bling.com.br/Api/v3/oauth/token";
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${b64}`,
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(currentRefresh)}`,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Bling token renew failed: ${resp.status} ${txt}`);
  }
  const data = (await resp.json()) as BlingTokenPair;
  if (!data?.access_token) throw new Error("Bling token renew returned no access_token");
  await setConfigValues(supabase, [
    { chave: "bling_access_token", valor_texto: data.access_token },
    { chave: "bling_refresh_token", valor_texto: data.refresh_token || currentRefresh },
  ]);
  return data;
}

async function getBlingAccessToken(supabase: ReturnType<typeof createClient>) {
  const token = await getConfigValue(supabase, "bling_access_token");
  if (token) return token;
  const renewed = await renewBlingToken(supabase);
  return renewed.access_token;
}

async function blingFetchJson(
  supabase: ReturnType<typeof createClient>,
  url: string,
  tokenRef: { value: string },
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
    const renewed = await renewBlingToken(supabase);
    tokenRef.value = renewed.access_token;
    return await blingFetchJson(supabase, url, tokenRef, false);
  }
  if (!resp.ok) {
    const txt = await resp.text();
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

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const from = String(body?.from ?? "").slice(0, 10);
    const to = String(body?.to ?? "").slice(0, 10);
    if (!from || !to) return jsonResponse({ error: "Missing from/to (YYYY-MM-DD)" }, 400);

    const limit = Math.min(100, Math.max(1, Number(body?.limit ?? 100) || 100));
    const maxPages = Math.min(200, Math.max(1, Number(body?.maxPages ?? 50) || 50));
    const concurrency = Math.min(10, Math.max(1, Number(body?.concurrency ?? 6) || 6));

    const tokenRef = { value: await getBlingAccessToken(supabase) };

    const base = "https://api.bling.com.br/Api/v3/pedidos/vendas";
    const ids: string[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const url = `${base}?dataInicial=${encodeURIComponent(from)}&dataFinal=${encodeURIComponent(to)}&pagina=${page}&limite=${limit}`;
      const json: any = await blingFetchJson(supabase, url, tokenRef);
      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      if (!data.length) break;
      data.forEach((r: any) => {
        const id = String(r?.id ?? "").trim();
        if (id) ids.push(id);
      });
      if (data.length < limit) break;
    }

    const uniqueIds = Array.from(new Set(ids));

    const details = await mapWithConcurrency(uniqueIds, concurrency, async (id) => {
      const url = `${base}/${encodeURIComponent(id)}`;
      const json: any = await blingFetchJson(supabase, url, tokenRef);
      return mapBlingOrder(json);
    });

    return jsonResponse({ orders: details, count: details.length });
  } catch (e) {
    return jsonResponse({ error: e?.message || String(e) }, 500);
  }
});
