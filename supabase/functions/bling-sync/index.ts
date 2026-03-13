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

let tokenCache: { token: string; expiresAtMs: number } | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

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

async function getConfigValue(supabaseUrl: string, serviceRoleKey: string, chave: string): Promise<string> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase
    .from("configuracoes")
    .select("valor_texto")
    .eq("chave", chave)
    .maybeSingle();
  if (error) throw error;
  return String(data?.valor_texto || "").trim();
}

function normText(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseJsonObjectMap(v: string): Record<string, string> {
  try {
    const obj = JSON.parse(String(v || ""));
    if (!obj || typeof obj !== "object") return {};
    const out: Record<string, string> = {};
    Object.entries(obj as Record<string, unknown>).forEach(([k, val]) => {
      const key = String(k || "").trim();
      const value = String(val ?? "").trim().toLowerCase();
      if (key && value) out[key] = value;
    });
    return out;
  } catch (_e) {
    return {};
  }
}

async function getBlingLojaIdMap(supabaseUrl: string, serviceRoleKey: string): Promise<Record<string, string>> {
  const raw =
    (await getConfigValue(supabaseUrl, serviceRoleKey, "bling_loja_id_map").catch(() => "")) ||
    (await getConfigValue(supabaseUrl, serviceRoleKey, "bling_loja_map").catch(() => "")) ||
    "";
  const map = parseJsonObjectMap(String(raw || ""));
  return map;
}

function inferCanalSlugFromBling(detailData: any, lojaIdMap: Record<string, string>) {
  const data = detailData && typeof detailData === "object" ? detailData : {};
  const lojaObj = data?.loja ?? data?.store ?? {};

  const lojaId = String(lojaObj?.id ?? data?.idLoja ?? data?.lojaId ?? data?.loja_id ?? "").trim();
  const lojaNome = String(lojaObj?.nome ?? lojaObj?.descricao ?? data?.lojaNome ?? data?.nomeLoja ?? "").trim();

  const canalObj = data?.canal ?? data?.canalVenda ?? data?.origem ?? data?.ecommerce ?? {};
  const canalNome = String(canalObj?.nome ?? canalObj?.descricao ?? "").trim();

  const numeroPedidoEcommerce = String(
    data?.numeroPedidoEcommerce ?? data?.numeroPedidoLoja ?? data?.numeroPedidoEcommerceLoja ?? data?.numeroPedidoLojaEcommerce ?? "",
  ).trim();

  let slug = "";
  if (lojaId && lojaIdMap[lojaId]) slug = String(lojaIdMap[lojaId] || "").trim().toLowerCase();
  if (!slug) {
    const hay = [lojaNome, canalNome, numeroPedidoEcommerce].map(normText).join(" ");
    if (/\bmercado\s*livre\b|\bmercadolivre\b|\bmeli\b|\bmlb\b/.test(hay) || /^mlb/.test(normText(numeroPedidoEcommerce))) slug = "ml";
    else if (/\bshopee\b/.test(hay) || /^shopee/.test(normText(numeroPedidoEcommerce))) slug = "shopee";
    else if (/\bamazon\b/.test(hay)) slug = "amazon";
    else if (/\bshopify\b/.test(hay)) slug = "shopify";
    else if (/\byampi\b/.test(hay)) slug = "yampi";
  }

  return { slug, lojaId, lojaNome, canalNome, numeroPedidoEcommerce };
}

function onlyDigitsStr(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

function isValidDocDigits(d: string): boolean {
  return d.length === 11 || d.length === 14;
}

function cleanEmail(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  return s.includes("@") ? s : "";
}

function cleanPhone(v: unknown): string {
  const d = onlyDigitsStr(v);
  return d.length >= 10 ? d : "";
}

function makeCustomerDocKey(order: any): string {
  const contato = order?.contato ?? {};
  const doc = onlyDigitsStr(contato?.cpfCnpj ?? contato?.numeroDocumento ?? contato?.cpf ?? contato?.cnpj ?? "");
  if (isValidDocDigits(doc)) return doc;
  const email = cleanEmail(contato?.email ?? "");
  if (email) return email;
  const tel = cleanPhone(contato?.telefone ?? contato?.celular ?? "");
  if (tel) return tel;
  const nome = String(contato?.nome ?? "").trim();
  return nome || String(order?.id ?? order?.numero ?? "").trim();
}

const CANAL_NAME_BY_SLUG: Record<string, string> = {
  ml: "Mercado Livre",
  shopee: "Shopee",
  amazon: "Amazon",
  shopify: "Site (Shopify)",
  yampi: "Yampi",
  cnpj: "B2B (Atacado)",
  outros: "Outros",
};

async function ensureCanaisAndGetMap(supabaseUrl: string, serviceRoleKey: string): Promise<Record<string, string>> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const rows = Object.entries(CANAL_NAME_BY_SLUG).map(([slug, nome]) => ({
    slug,
    nome,
    created_at: nowIso(),
  }));
  await supabase.from("v2_canais").upsert(rows, { onConflict: "slug" });
  const { data, error } = await supabase
    .from("v2_canais")
    .select("id,slug")
    .in("slug", Object.keys(CANAL_NAME_BY_SLUG))
    .limit(50);
  if (error) throw error;
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => {
    const slug = String(r?.slug ?? "").trim().toLowerCase();
    const id = String(r?.id ?? "").trim();
    if (slug && id) map[slug] = id;
  });
  return map;
}

async function persistSyncResultToDb(
  supabaseUrl: string,
  serviceRoleKey: string,
  orders: any[],
  canaisMap: Record<string, string>,
  updateLastSync: boolean,
) {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = nowIso();

  let pedidosItemsTotalCol: "valor_total" | "total" = "valor_total";
  try {
    const t1 = await supabase.from("v2_pedidos_items").select("valor_total").limit(1);
    if (t1?.error) throw t1.error;
    pedidosItemsTotalCol = "valor_total";
  } catch (_e) {
    try {
      const t2 = await supabase.from("v2_pedidos_items").select("total").limit(1);
      if (t2?.error) throw t2.error;
      pedidosItemsTotalCol = "total";
    } catch (_e2) {
      pedidosItemsTotalCol = "valor_total";
    }
  }

  const customersByDoc: Record<string, any> = {};
  orders.forEach((o) => {
    const docKey = String(makeCustomerDocKey(o) || "").trim();
    if (!docKey) return;
    const contato = o?.contato ?? {};
    const end = contato?.endereco ?? {};
    const nome = String(contato?.nome ?? "Desconhecido").trim() || "Desconhecido";
    const email = cleanEmail(contato?.email ?? "");
    const telefone = cleanPhone(contato?.telefone ?? contato?.celular ?? "");
    const cidade = String(end?.municipio ?? o?.cidade_entrega ?? "").trim();
    const uf = String(end?.uf ?? o?.uf_entrega ?? "").trim().toUpperCase();
    customersByDoc[docKey] = {
      doc: docKey,
      nome,
      email: email || null,
      telefone: telefone || null,
      cidade: cidade || null,
      uf: uf || null,
      updated_at: now,
    };
  });

  const customerRows = Object.values(customersByDoc);
  for (let i = 0; i < customerRows.length; i += 100) {
    const batch = customerRows.slice(i, i + 100);
    const { error } = await supabase.from("v2_clientes").upsert(batch, { onConflict: "doc" });
    if (error) throw error;
  }

  const docToId: Record<string, string> = {};
  const docs = Object.keys(customersByDoc);
  for (let i = 0; i < docs.length; i += 200) {
    const slice = docs.slice(i, i + 200);
    const { data, error } = await supabase.from("v2_clientes").select("id,doc").in("doc", slice).limit(5000);
    if (error) throw error;
    (data || []).forEach((r: any) => {
      const doc = String(r?.doc ?? "").trim();
      const id = String(r?.id ?? "").trim();
      if (doc && id) docToId[doc] = id;
    });
  }

  const pedidosRows = orders
    .map((o) => {
      const id = String(o?.id ?? o?.numero ?? "").trim();
      if (!id) return null;
      const docKey = String(makeCustomerDocKey(o) || "").trim();
      const clienteId = docToId[docKey] || null;
      const contato = o?.contato ?? {};
      const docDigits = onlyDigitsStr(contato?.cpfCnpj ?? "");
      const isCnpj = docDigits.length === 14;

      let canalSlug = String(o?._canal ?? "").trim().toLowerCase();
      if (isCnpj) canalSlug = "cnpj";
      if (!canalSlug) canalSlug = "outros";
      const canalId = canaisMap[canalSlug] || canaisMap["outros"] || null;

      const numero = String(o?.numero ?? id).trim();
      const dataPedido = String(o?.data ?? "").slice(0, 10);
      const total = Number(o?.total ?? 0) || 0;
      const status = String(o?.situacao?.nome ?? o?.situacao ?? "").trim();
      const itens = Array.isArray(o?.itens) ? o.itens : [];

      return {
        id,
        numero_pedido: numero || null,
        bling_id: id,
        cliente_id: clienteId,
        canal_id: canalId,
        data_pedido: dataPedido || null,
        total,
        status: status || null,
        source: "bling",
        itens,
        created_at: now,
      };
    })
    .filter(Boolean);

  for (let i = 0; i < pedidosRows.length; i += 100) {
    const batch = pedidosRows.slice(i, i + 100);
    const { error } = await supabase.from("v2_pedidos").upsert(batch, { onConflict: "id" });
    if (error) throw error;
  }

  const productsById: Record<string, any> = {};
  const pedidoIds: string[] = [];
  pedidosRows.forEach((p: any) => {
    const pid = String(p?.id ?? "").trim();
    if (pid) pedidoIds.push(pid);
    const itens = Array.isArray(p?.itens) ? p.itens : [];
    itens.forEach((it: any) => {
      const codigo = String(it?.codigo ?? "").trim();
      const nome = String(it?.descricao ?? "").trim();
      const key = String(codigo || nome).trim();
      if (!key) return;
      if (!productsById[key]) {
        productsById[key] = {
          id: key,
          codigo: codigo || null,
          nome: nome || null,
          estoque: null,
          preco: null,
          situacao: null,
          origem: "bling",
          updated_at: now,
          raw: { codigo: codigo || null, nome: nome || null, source: "bling-sync" },
        };
      } else {
        if (codigo && !productsById[key].codigo) productsById[key].codigo = codigo;
        if (nome && !productsById[key].nome) productsById[key].nome = nome;
      }
    });
  });

  const productRows = Object.values(productsById).filter((r: any) => String(r?.id ?? "").trim());
  if (productRows.length) {
    for (let i = 0; i < productRows.length; i += 200) {
      const batch = productRows.slice(i, i + 200);
      const { error } = await supabase.from("v2_produtos").upsert(batch, { onConflict: "id" });
      if (error) throw error;
    }
    await supabase.from("configuracoes").upsert([{ chave: "ultima_sync_bling_produtos", valor_texto: now, updated_at: now }], {
      onConflict: "chave",
    });
  }

  const itemRows: any[] = [];
  pedidosRows.forEach((p: any) => {
    const pid = String(p?.id ?? "").trim();
    if (!pid) return;
    const itens = Array.isArray(p?.itens) ? p.itens : [];
    itens.forEach((it: any) => {
      const produtoNome = String(it?.descricao ?? it?.codigo ?? "").trim();
      if (!produtoNome) return;
      const quantidade = Number(it?.quantidade ?? 0) || 0;
      const valorUnitario = Number(it?.valor ?? 0) || 0;
      const valorTotal = quantidade * valorUnitario;
      const row: any = {
        pedido_id: pid,
        produto_nome: produtoNome,
        quantidade,
        valor_unitario: valorUnitario,
        created_at: now,
      };
      row[pedidosItemsTotalCol] = valorTotal;
      itemRows.push(row);
    });
  });

  if (itemRows.length) {
    const uniquePedidoIds = Array.from(new Set(pedidoIds)).filter(Boolean);
    for (let i = 0; i < uniquePedidoIds.length; i += 200) {
      const batch = uniquePedidoIds.slice(i, i + 200);
      const { error } = await supabase.from("v2_pedidos_items").delete().in("pedido_id", batch);
      if (error) throw error;
    }
    for (let i = 0; i < itemRows.length; i += 1000) {
      const batch = itemRows.slice(i, i + 1000);
      const { error } = await supabase.from("v2_pedidos_items").insert(batch);
      if (error) throw error;
    }
  }

  if (updateLastSync) {
    await supabase.from("configuracoes").upsert([{ chave: "ultima_sync_bling", valor_texto: now, updated_at: now }], {
      onConflict: "chave",
    });
  }
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(String(dateIso || "").slice(0, 10) + "T00:00:00.000Z");
  if (isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function clampDateRange(from: string, to: string, maxDays: number): { from: string; to: string } {
  const f = new Date(String(from || "").slice(0, 10) + "T00:00:00.000Z");
  const t = new Date(String(to || "").slice(0, 10) + "T00:00:00.000Z");
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return { from, to };
  if (f.getTime() > t.getTime()) return { from: to, to: to };
  const diffDays = Math.floor((t.getTime() - f.getTime()) / 86400000);
  if (diffDays <= maxDays) return { from, to };
  const clampedFrom = addDaysIso(to, -maxDays);
  return { from: clampedFrom || from, to };
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
): Promise<unknown> {
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
      try {
        console.log("[bling-sync] 401 no Bling, renovando token e tentando novamente:", url);
      } catch (_e) {}
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
      try {
        console.log("[bling-sync] 429 rate limit, aguardando", { waitMs, attempt, url });
      } catch (_e) {}
      await sleep(waitMs);
      continue;
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
  throw new Error("Bling API error: 429 Too Many Requests");
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
    numeroPedidoEcommerce: String(data?.numeroPedidoLoja ?? data?.numeroPedidoEcommerce ?? data?.numeroPedidoEcommerceLoja ?? "").trim() || undefined,
    loja: data?.loja ? { id: String(data?.loja?.id ?? "").trim() || undefined, nome: String(data?.loja?.nome ?? data?.loja?.descricao ?? "").trim() || undefined } : undefined,
    canal: data?.canalVenda || data?.canal || data?.origem || data?.ecommerce
      ? { nome: String((data?.canalVenda?.nome ?? data?.canal?.nome ?? data?.origem?.nome ?? data?.ecommerce?.nome) ?? "").trim() || undefined }
      : undefined,
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
    const cronSecret = Deno.env.get("CRON_SECRET") || "";

    const bodyText = await req.text().catch(() => "");
    const parsed = safeJsonParse(bodyText);
    if (parsed === null) return jsonResponse({ error: "Invalid JSON" }, 400);
    const body = (parsed && typeof parsed === "object" ? parsed : {}) as any;
    const persist = body?.persist === true;

    if (persist) {
      const headerSecret = String(req.headers.get("x-cron-secret") || "").trim();
      if (!cronSecret || headerSecret !== cronSecret) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
    }
    const reqFrom = String(body?.from ?? "").slice(0, 10);
    const reqTo = String(body?.to ?? "").slice(0, 10);

    let from = reqFrom;
    let to = reqTo || isoToday();

    if (!from) {
      let lastSync = "";
      try {
        lastSync = await getConfigValue(supabaseUrl, serviceRoleKey, "ultima_sync_bling");
      } catch (_e) {}
      const lastSyncDate = String(lastSync || "").slice(0, 10);
      if (lastSyncDate) {
        from = lastSyncDate;
      } else {
        from = addDaysIso(to, -365) || "";
      }
    }

    if (!from || !to) return jsonResponse({ error: "Missing from/to (YYYY-MM-DD)" }, 400);
    ({ from, to } = clampDateRange(from, to, 365));

    const limit = Math.min(100, Math.max(1, Number(body?.limit ?? 50) || 50));
    const hasExplicitOffset = body?.offset != null;
    let offset = Math.max(0, Number(body?.offset ?? 0) || 0);
    const maxPages = Math.min(200, Math.max(1, Number(body?.maxPages ?? 50) || 50));
    const concurrency = Math.min(10, Math.max(1, Number(body?.concurrency ?? 6) || 6));

    if (persist && !hasExplicitOffset) {
      let cursorText = "";
      try {
        cursorText = await getConfigValue(supabaseUrl, serviceRoleKey, "bling_sync_cursor");
      } catch (_e) {}
      const parsedCursor: any = safeJsonParse(String(cursorText || ""));
      const curFrom = String(parsedCursor?.from ?? "").slice(0, 10);
      const curTo = String(parsedCursor?.to ?? "").slice(0, 10);
      const curOffset = Number(parsedCursor?.offset ?? NaN);
      if (curFrom === from && curTo === to && Number.isFinite(curOffset) && curOffset >= 0) {
        offset = Math.floor(curOffset);
      } else {
        offset = 0;
        try {
          const supabase = createClient(supabaseUrl, serviceRoleKey);
          await supabase.from("configuracoes").upsert([{
            chave: "bling_sync_cursor",
            valor_texto: JSON.stringify({ from, to, offset, limit }),
            updated_at: nowIso(),
          }], { onConflict: "chave" });
        } catch (_e) {}
      }
    }

    try {
      console.log("[bling-sync] request", { from, to, limit, offset, maxPages, concurrency });
    } catch (_e) {}

    const lojaIdMap = await getBlingLojaIdMap(supabaseUrl, serviceRoleKey).catch(() => ({}));
    const tokenRef = { value: await getBlingAccessToken(supabaseUrl, serviceRoleKey) };

    const base = "https://api.bling.com.br/Api/v3/pedidos/vendas";
    const ids: string[] = [];
    const seen = new Set<string>();
    const startPage = Math.floor(offset / limit) + 1;
    let skipInFirst = offset % limit;
    let lastPageLen = 0;
    let page = startPage;
    let hadExtraInPage = false;
    let pagesFetched = 0;

    while (ids.length < limit && pagesFetched < maxPages) {
      const url = `${base}?dataInicial=${encodeURIComponent(from)}&dataFinal=${encodeURIComponent(to)}&pagina=${page}&limite=${limit}`;
      const json: any = await blingFetchJson(url, tokenRef, supabaseUrl, serviceRoleKey);
      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
      lastPageLen = data.length;
      if (!data.length) break;
      let slice = data;
      if (skipInFirst > 0) {
        slice = slice.slice(skipInFirst);
        skipInFirst = 0;
      }
      const remaining = limit - ids.length;
      if (slice.length > remaining) {
        hadExtraInPage = true;
        slice = slice.slice(0, remaining);
      }
      slice.forEach((r: any) => {
        const id = String(r?.id ?? "").trim();
        if (!id || seen.has(id)) return;
        seen.add(id);
        ids.push(id);
      });
      if (data.length < limit) break;
      if (ids.length >= limit) break;
      page += 1;
      pagesFetched += 1;
    }

    const uniqueIds = ids;
    try {
      console.log("[bling-sync] ids", { total: uniqueIds.length, limit, offset, startPage, fetched: pagesFetched + 1 });
    } catch (_e) {}

    const details = await mapWithConcurrency(uniqueIds, concurrency, async (id) => {
      const url = `${base}/${encodeURIComponent(id)}`;
      const json: any = await blingFetchJson(url, tokenRef, supabaseUrl, serviceRoleKey);
      const mapped = mapBlingOrder(json);
      const infer = inferCanalSlugFromBling(mapped?._raw ?? json?.data ?? json ?? {}, lojaIdMap);
      if (infer.slug) (mapped as any)._canal = infer.slug;
      if (infer.lojaId && !(mapped as any)?.loja?.id) (mapped as any).loja = { ...(mapped as any).loja, id: infer.lojaId };
      if (infer.lojaNome && !(mapped as any)?.loja?.nome) (mapped as any).loja = { ...(mapped as any).loja, nome: infer.lojaNome };
      if (infer.canalNome && !(mapped as any)?.canal?.nome) (mapped as any).canal = { ...(mapped as any).canal, nome: infer.canalNome };
      if (infer.numeroPedidoEcommerce && !(mapped as any)?.numeroPedidoEcommerce) (mapped as any).numeroPedidoEcommerce = infer.numeroPedidoEcommerce;
      return mapped;
    });

    const nextOffset = offset + uniqueIds.length;
    const hasMore = uniqueIds.length === limit && (hadExtraInPage || lastPageLen === limit);

    if (persist) {
      const canaisMap = await ensureCanaisAndGetMap(supabaseUrl, serviceRoleKey);
      await persistSyncResultToDb(supabaseUrl, serviceRoleKey, details, canaisMap, false);
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const now = nowIso();
      if (hasMore) {
        await supabase.from("configuracoes").upsert([{
          chave: "bling_sync_cursor",
          valor_texto: JSON.stringify({ from, to, offset: nextOffset, limit }),
          updated_at: now,
        }], { onConflict: "chave" });
      } else {
        await supabase.from("configuracoes").upsert([{
          chave: "bling_sync_cursor",
          valor_texto: "",
          updated_at: now,
        }], { onConflict: "chave" });
        await supabase.from("configuracoes").upsert([{
          chave: "ultima_sync_bling",
          valor_texto: now,
          updated_at: now,
        }], { onConflict: "chave" });
      }
      return jsonResponse({ ok: true, persisted: true, count: details.length, from, to, limit, offset, nextOffset, hasMore });
    }

    return jsonResponse({ orders: details, count: details.length, from, to, limit, offset, nextOffset, hasMore });
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
