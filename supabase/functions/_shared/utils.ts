/**
 * _shared/utils.ts
 * Utilitários reutilizáveis para Edge Functions do CRM.
 */

export function safeJsonParse(text: string): unknown {
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (_e) {
    return null;
  }
}

export function jsonResponse(
  body: unknown,
  status = 200,
  req?: Request,
): Response {
  const corsHeaders = req ? getCorsHeaders(req) : {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Origens permitidas para chamadas às Edge Functions.
 * Adicione aqui qualquer domínio extra que precise de acesso.
 */
const ALLOWED_ORIGINS = new Set([
  'https://app-chiva-fit.vercel.app',
]);

/**
 * Retorna os headers de CORS restritos à lista de origens permitidas.
 * Origens localhost/127.0.0.1 são sempre permitidas para desenvolvimento local.
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const raw = (req as any)?.headers?.get?.('Origin') || '';
  const cleanOrigin = raw.endsWith('/') ? raw.slice(0, -1) : raw;

  const isAllowed =
    ALLOWED_ORIGINS.has(cleanOrigin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanOrigin);

  const allowOrigin = isAllowed ? cleanOrigin : 'https://app-chiva-fit.vercel.app';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/**
 * Extrai o primeiro texto da resposta da API Anthropic.
 */
export function firstTextFromAnthropic(respJson: unknown): string {
  if (!respJson || typeof respJson !== 'object') return '';
  const resp = respJson as Record<string, unknown>;
  const content = Array.isArray(resp.content) ? resp.content : [];
  for (const c of content) {
    if (c && typeof c === 'object') {
      const entry = c as Record<string, unknown>;
      if (entry.type === 'text' && typeof entry.text === 'string') return entry.text;
    }
  }
  const txt = resp.text;
  return typeof txt === 'string' ? txt : '';
}
