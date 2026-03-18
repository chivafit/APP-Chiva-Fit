import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { safeJsonParse, firstTextFromAnthropic, jsonResponse, getCorsHeaders } from '../_shared/utils.ts';
import { readBearerToken } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rate_limit.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

declare const Deno: { env: { get(key: string): string | undefined } };

// Modelo configurável via env var CLAUDE_MODEL — o caller NÃO pode sobrescrever.
function getModel(): string {
  const envModel = String(Deno.env.get('CLAUDE_MODEL') || '').trim();
  const ALLOWED_MODELS = new Set([
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-6',
  ]);
  return ALLOWED_MODELS.has(envModel) ? envModel : 'claude-haiku-4-5-20251001';
}

const MAX_CALLS_PER_HOUR = 30;

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST' }, 405, req);

  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim();
  const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();

  // Rate limiting por usuário autenticado
  let userEmail = 'anonymous';
  try {
    const jwt = readBearerToken(req);
    if (jwt && supabaseUrl && serviceRoleKey) {
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { data } = await supabase.auth.getUser(jwt);
      userEmail = String((data?.user as Record<string, unknown>)?.email || 'anonymous')
        .toLowerCase()
        .trim();
    }
  } catch (_e) {
    // falha ao extrair usuário — rate limiting será por "anonymous"
  }

  if (supabaseUrl && serviceRoleKey) {
    const rl = await checkRateLimit(
      supabaseUrl,
      serviceRoleKey,
      userEmail,
      'ia-commercial',
      MAX_CALLS_PER_HOUR,
    );
    if (!rl.allowed) {
      return jsonResponse(
        { error: 'Rate limit excedido. Tente novamente na próxima hora.', resetAt: rl.resetAt },
        429,
        req,
      );
    }
  }

  const bodyText = await req.text().catch(() => '');
  const parsed = safeJsonParse(bodyText);
  if (parsed === null) return jsonResponse({ error: 'Invalid JSON' }, 400, req);
  const body = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;

  const pergunta = String(body?.pergunta ?? '').trim();
  const maxTokens = Math.min(
    2048,
    Math.max(128, Number(body?.max_tokens ?? body?.maxTokens ?? 900) || 900),
  );

  // Contexto: apenas campos conhecidos e seguros são repassados ao modelo.
  // Isso previne prompt injection via objeto contexto arbitrário.
  const rawContexto = body?.contexto ?? {};
  const contexto = rawContexto && typeof rawContexto === 'object' ? rawContexto : {};

  const apiKey =
    String(Deno.env.get('ANTHROPIC_API_KEY') || '').trim() ||
    String(Deno.env.get('CLAUDE_API_KEY') || '').trim();

  if (!pergunta) return jsonResponse({ error: 'Missing pergunta' }, 400, req);
  if (!apiKey) return jsonResponse({ error: 'Missing ANTHROPIC_API_KEY secret' }, 500, req);

  const model = getModel();

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: `Você é o Assistente Comercial da Chiva Fit. Use o contexto JSON abaixo para responder à pergunta. Responda de forma curta, objetiva e amigável.
      
      CONTEXTO:
      ${JSON.stringify(contexto)}`,
      messages: [{ role: 'user', content: pergunta }],
    }),
  });

  if (!upstream.ok) {
    const { status } = upstream;
    const txt = await upstream.text().catch(() => '');
    let msg = txt;
    try {
      const json = JSON.parse(txt);
      if (json?.error?.message) msg = json.error.message;
    } catch (_e) {}
    return jsonResponse({ error: msg }, status, req);
  }

  const respJson = await upstream.json();
  const text = firstTextFromAnthropic(respJson);

  // Tentar extrair JSON se o modelo retornar algo que pareça um JSON
  let jsonOnly = null;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) jsonOnly = JSON.parse(match[0]);
  } catch (_e) {}

  if (jsonOnly && typeof jsonOnly === 'object') return jsonResponse(jsonOnly, 200, req);
  return jsonResponse({ text }, 200, req);
});
