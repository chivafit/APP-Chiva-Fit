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
 * Retorna os headers de CORS baseados na origem da requisição.
 */
export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = (req as any)?.headers?.get?.('Origin') || '*';
  // Se a origem terminar com '/', removemos para evitar mismatch
  const cleanOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;

  return {
    'Access-Control-Allow-Origin': cleanOrigin,
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
