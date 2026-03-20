/**
 * Edge Function: whatsapp-send
 * Centraliza o envio de mensagens WhatsApp via Z-API (ou Meta Cloud API futuramente).
 *
 * POST /functions/v1/whatsapp-send
 * Body: {
 *   account_id: string,   // UUID da conta em whatsapp_accounts
 *   telefone: string,     // Ex: "5531997763371"
 *   message?: string,     // Texto livre
 *   template_id?: string, // UUID do template (alternativo ao texto livre)
 *   variaveis?: Record<string, string>  // Variáveis resolvidas do template
 * }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ZAPI_BASE = 'https://api.z-api.io/instances';

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const { account_id, telefone, message, template_id, variaveis } = await req.json();

    if (!account_id || !telefone) {
      return jsonError('account_id e telefone são obrigatórios', 400);
    }

    // Inicializa cliente Supabase com service role (seguro no servidor)
    const supaClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Verifica opt-out
    const phone = formatPhone(telefone);
    const { data: optout } = await supaClient
      .from('whatsapp_optouts')
      .select('id')
      .eq('telefone', phone)
      .maybeSingle();

    if (optout) {
      return jsonError('Número em opt-out — envio bloqueado', 200, { optout: true });
    }

    // Carrega conta
    const { data: account, error: accErr } = await supaClient
      .from('whatsapp_accounts')
      .select('*')
      .eq('id', account_id)
      .eq('status', 'active')
      .maybeSingle();

    if (accErr || !account) {
      return jsonError('Conta WhatsApp não encontrada ou inativa', 400);
    }

    // Resolve texto final
    let texto = message || '';

    if (!texto && template_id) {
      const { data: template } = await supaClient
        .from('whatsapp_templates')
        .select('preview_text, template_name')
        .eq('id', template_id)
        .maybeSingle();

      if (template?.preview_text) {
        texto = resolveVars(template.preview_text, variaveis || {});
      }
    }

    if (!texto) {
      return jsonError('Nenhum conteúdo de mensagem fornecido', 400);
    }

    // Envia via Z-API
    if (account.provider === 'zapi') {
      const result = await sendZApi(account, phone, texto);

      // Registra no banco
      await supaClient.from('whatsapp_messages').insert({
        account_id,
        telefone: phone,
        direcao: 'outbound',
        tipo: template_id ? 'template' : 'text',
        conteudo: { text: texto, template_id },
        status: result.success ? 'sent' : 'failed',
        wamid: result.messageId || null,
        metadata: { via: 'edge_function' },
      });

      if (!result.success) {
        return jsonError('Falha no envio: ' + result.error, 500);
      }

      return jsonOk({ messageId: result.messageId, telefone: phone });
    }

    return jsonError(`Provider ${account.provider} ainda não implementado`, 501);

  } catch (err) {
    console.error('[whatsapp-send] Erro:', err);
    return jsonError('Erro interno: ' + err.message, 500);
  }
});

// ─── Z-API ────────────────────────────────────────────────────
async function sendZApi(
  account: { zapi_instance_id: string; zapi_token: string; zapi_client_token: string },
  telefone: string,
  message: string
) {
  const url = `${ZAPI_BASE}/${account.zapi_instance_id}/token/${account.zapi_token}/send-text`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': account.zapi_client_token || '',
      },
      body: JSON.stringify({ phone: telefone, message }),
    });

    const json = await resp.json();

    if (!resp.ok || json.error) {
      return { success: false, error: json.error || json.message || `HTTP ${resp.status}` };
    }

    return {
      success: true,
      messageId: json.zaapId || json.messageId || json.id || null,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// ─── Helpers ─────────────────────────────────────────────────
function formatPhone(phone: string): string {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  return digits;
}

function resolveVars(text: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [idx, val]) => t.replace(new RegExp(`\\{\\{${idx}\\}\\}`, 'g'), val || ''),
    text
  );
}

function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ ok: true, ...data as object }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function jsonError(message: string, status = 400, extra = {}) {
  return new Response(JSON.stringify({ ok: false, error: message, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
