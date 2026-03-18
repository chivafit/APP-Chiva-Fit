import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { captureToSentry } from '../_shared/sentry.ts';
import { requireUserAuth } from '../_shared/auth.ts';
import { safeJsonParse, nowIso, sleep, jsonResponse, getCorsHeaders } from '../_shared/utils.ts';

declare const Deno: { env: { get(key: string): string | undefined } };

type BlingTokenResponse = { access_token: string; expires_in?: number; refresh_token?: string };

// sleep e nowIso importados de ../_shared/utils.ts

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

async function getStoredBlingAccessToken(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<string> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase
    .from('configuracoes')
    .select('valor_texto')
    .eq('chave', 'bling_access_token')
    .maybeSingle();
  if (error) throw error;
  return String(data?.valor_texto || '').trim();
}

async function renewBlingTokenViaEdgeFunction(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<BlingTokenResponse> {
  const url = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/bling-renew-token`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      let details = txt;
      try {
        const parsed = JSON.parse(txt);
        if (parsed?.error) details = String(parsed.error);
        if (parsed?.message) details = String(parsed.message);
      } catch (_e) {}
      if (resp.status === 401) {
        throw new Error(`BLING_REAUTH_REQUIRED:${details || 'invalid_grant'}`);
      }
      throw new Error(`Falha ao renovar token: ${resp.status} ${details || 'sem detalhes'}`);
    }
    const data = (await resp.json()) as BlingTokenResponse;
    const access_token = String(data?.access_token || '').trim();
    if (!access_token) throw new Error('bling-renew-token returned no access_token');
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getBlingAccessToken(
  supabaseUrl: string,
  serviceRoleKey: string,
  forceRenew = false,
) {
  const now = Date.now();
  const safetyWindowMs = 120_000;
  if (!forceRenew && tokenCache?.token && now < tokenCache.expiresAtMs - safetyWindowMs)
    return tokenCache.token;

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
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokenRef.value}`,
      },
    });

    if (resp.status === 401 && retry) {
      tokenRef.value = await getBlingAccessToken(supabaseUrl, serviceRoleKey, true);
      return await blingFetchJson(url, tokenRef, supabaseUrl, serviceRoleKey, false);
    }

    if (resp.status === 429 && attempt < maxAttempts) {
      const retryAfter = String(resp.headers.get('retry-after') || '').trim();
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
      const txt = await resp.text().catch(() => '');
      throw new Error(`Bling API error: ${resp.status} ${txt}`);
    }
    return await resp.json();
  }
  throw new Error('Bling API error: 429 Too Many Requests');
}

function mapBlingProduct(row: Record<string, unknown>) {
  const rawData = (row?.data ?? row) as Record<string, unknown>;
  const data: Record<string, unknown> = rawData && typeof rawData === 'object' ? rawData : {};
  const id = String(data?.id ?? '').trim();
  const codigo = String(
    data?.codigo ?? data?.codigoItem ?? data?.codigoProduto ?? data?.sku ?? '',
  ).trim();
  const nome = String(data?.nome ?? data?.descricao ?? data?.descricaoCurta ?? '').trim();
  const situacaoObj = data?.situacao as Record<string, unknown> | null | undefined;
  const situacao = String(situacaoObj?.nome ?? data?.situacao ?? data?.status ?? '').trim();
  const preco = data?.preco ?? data?.precoVenda ?? data?.valor ?? data?.precoVenda1;
  const estoqueObj = data?.estoque as Record<string, unknown> | null | undefined;
  const estoqueRaw =
    estoqueObj?.saldo ??
    estoqueObj?.saldoFisico ??
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
    origem: 'bling',
    updated_at: nowIso(),
    raw: data,
  };
}

interface MappedProduct {
  id: string;
  codigo: string | null;
  nome: string | null;
  estoque: number | null;
  preco: number | null;
  situacao: string | null;
  origem: string;
  updated_at: string;
  raw: Record<string, unknown>;
}

async function persistProductsToDb(supabaseUrl: string, serviceRoleKey: string, products: MappedProduct[]) {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = nowIso();
  const rows = products
    .map((p) => ({
      id: String(p?.id ?? '').trim(),
      codigo: p?.codigo ?? null,
      nome: p?.nome ?? null,
      estoque: p?.estoque ?? null,
      preco: p?.preco ?? null,
      situacao: p?.situacao ?? null,
      origem: 'bling',
      updated_at: now,
      raw: p?.raw ?? {},
    }))
    .filter((p) => p.id);

  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const { error } = await supabase.from('v2_produtos').upsert(batch, { onConflict: 'id' });
    if (error) throw error;
  }

  await supabase
    .from('configuracoes')
    .upsert([{ chave: 'ultima_sync_bling_produtos', valor_texto: now, updated_at: now }], {
      onConflict: 'chave',
    });
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST' }, 405, req);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !serviceRoleKey)
      return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500, req);

    const bodyText = await req.text().catch(() => '');
    const parsed = safeJsonParse(bodyText);
    if (parsed === null) return jsonResponse({ error: 'Invalid JSON' }, 400, req);
    const body = (parsed && typeof parsed === 'object' ? parsed : {}) as any;
    const persist = body?.persist === true;
    const cronSecret = Deno.env.get('CRON_SECRET') || '';

    if (persist) {
      const headerSecret = String(req.headers.get('x-cron-secret') || '').trim();
      if (!cronSecret || headerSecret !== cronSecret) {
        return jsonResponse({ error: 'Unauthorized' }, 401, req);
      }
    } else {
      const auth = await requireUserAuth(req, supabaseUrl, serviceRoleKey);
      if (!auth.ok) return jsonResponse({ error: 'Unauthorized' }, 401, req);
    }

    const limit = Math.min(100, Math.max(1, Number(body?.limit ?? 100) || 100));
    const maxPages = Math.min(500, Math.max(1, Number(body?.maxPages ?? 200) || 200));

    const tokenRef = { value: await getBlingAccessToken(supabaseUrl, serviceRoleKey) };
    const base = 'https://api.bling.com.br/Api/v3/produtos';

    const out: MappedProduct[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = `${base}?pagina=${page}&limite=${limit}`;
      const json = await blingFetchJson(url, tokenRef, supabaseUrl, serviceRoleKey);
      const jsonObj = json as Record<string, unknown>;
      const data: unknown[] = Array.isArray(jsonObj?.data) ? (jsonObj.data as unknown[]) : Array.isArray(json) ? (json as unknown[]) : [];
      if (!data.length) break;
      data.forEach((r) => {
        const mapped = mapBlingProduct(r as Record<string, unknown>);
        if (mapped.id) out.push(mapped);
      });
      if (data.length < limit) break;
    }

    if (persist) {
      await persistProductsToDb(supabaseUrl, serviceRoleKey, out);
      return jsonResponse({ ok: true, persisted: true, count: out.length }, 200, req);
    }

    return jsonResponse({ products: out, count: out.length }, 200, req);
  } catch (e) {
    await captureToSentry(e, { function: 'bling-products-sync' }).catch(() => {});
    const msg = String(e instanceof Error ? e.message : String(e) || '');
    if (msg.startsWith('BLING_REAUTH_REQUIRED:')) {
      return jsonResponse(
        {
          error: 'bling_reauthorize_required',
          message:
            msg.replace(/^BLING_REAUTH_REQUIRED:/, '').trim() ||
            'Reautorize o Bling nas Configurações.',
          reauthorize: true,
        },
        401,
        req,
      );
    }
    return jsonResponse({ error: msg }, msg.startsWith('Bling API error:') ? 400 : 500, req);
  }
});
