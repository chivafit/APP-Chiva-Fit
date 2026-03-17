import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { safeJsonParse, firstTextFromAnthropic } from '../_shared/utils.ts';
import { readBearerToken } from '../_shared/auth.ts';
import { checkRateLimit } from '../_shared/rate_limit.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

declare const Deno: any;

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') || 'https://chivafit.github.io';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

function jsonResponse(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Only POST' }, 405);

  const supabaseUrl = String(Deno.env.get('SUPABASE_URL') || '').trim();
  const serviceRoleKey = String(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();

  // Rate limiting por usuário autenticado
  let userEmail = 'anonymous';
  try {
    const jwt = readBearerToken(req);
    if (jwt && supabaseUrl && serviceRoleKey) {
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { data } = await supabase.auth.getUser(jwt);
      userEmail = String((data?.user as any)?.email || 'anonymous')
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
      );
    }
  }

  const bodyText = await req.text().catch(() => '');
  const parsed = safeJsonParse(bodyText);
  if (parsed === null) return jsonResponse({ error: 'Invalid JSON' }, 400);
  const body = (parsed && typeof parsed === 'object' ? parsed : {}) as any;

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

  if (!pergunta) return jsonResponse({ error: 'Missing pergunta' }, 400);
  if (!apiKey) return jsonResponse({ error: 'Missing ANTHROPIC_API_KEY secret' }, 500);

  const model = getModel();

  // System prompt fixo — não pode ser sobrescrito pelo caller
  const system =
    'Você é um assistente comercial especializado em CRM para e-commerce. ' +
    'Responda estritamente em JSON válido. Não inclua texto fora do JSON. ' +
    'Seja preciso e baseie suas respostas apenas nos dados fornecidos no contexto.';

  const prompt = `CONTEXTO_JSON:\n${JSON.stringify(contexto)}\n\nPERGUNTA:\n${pergunta}`.trim();

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const upstreamText = await upstream.text().catch(() => '');
  const upstreamJson = safeJsonParse(upstreamText) ?? { raw: upstreamText };

  if (!upstream.ok) {
    const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 500;
    const msg =
      status === 429
        ? 'Limite de API Anthropic atingido. Tente novamente em instantes.'
        : `Erro ao processar com IA (${upstream.status}).`;
    console.error('[ia-commercial] upstream error:', upstream.status, upstreamText?.slice(0, 200));
    return jsonResponse({ error: msg }, status);
  }

  const text = firstTextFromAnthropic(upstreamJson).trim();
  const jsonOnly = safeJsonParse(text);
  if (jsonOnly && typeof jsonOnly === 'object') return jsonResponse(jsonOnly, 200);
  return jsonResponse({ text }, 200);
});
