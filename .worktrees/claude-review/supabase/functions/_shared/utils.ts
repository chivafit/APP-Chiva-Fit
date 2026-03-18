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
  corsHeaders: Record<string, string> = {},
): Response {
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
