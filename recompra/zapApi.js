/**
 * ADAPTER: Z-API WhatsApp
 * Toda comunicação com a API do WhatsApp passa por aqui.
 * Quando migrar para Meta Cloud API: só muda este arquivo.
 *
 * Documentação Z-API: https://developer.z-api.io
 */

const ZAPI_BASE = 'https://api.z-api.io/instances';

// ─── Envio de mensagem via Z-API ─────────────────────────────
export async function sendWhatsAppMessage({ account, telefone, template, variaveis, textoLivre }) {
  if (!account?.zapi_instance_id || !account?.zapi_token) {
    return { success: false, error: 'Conta Z-API não configurada (instance_id ou token ausente)' };
  }

  const url = `${ZAPI_BASE}/${account.zapi_instance_id}/token/${account.zapi_token}/send-text`;

  // Monta o texto final a partir do template + variáveis resolvidas
  const texto = textoLivre || resolveTemplateText(template, variaveis);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Token': account.zapi_client_token || '',
      },
      body: JSON.stringify({
        phone: telefone,
        message: texto,
      }),
    });

    const json = await resp.json();

    if (!resp.ok || json.error) {
      return {
        success: false,
        error: json.error || json.message || `HTTP ${resp.status}`,
      };
    }

    return {
      success: true,
      messageId: json.zaapId || json.messageId || json.id || null,
      raw: json,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Envio de template (para quando migrar para Meta) ────────
export async function sendTemplateMessage({ account, telefone, templateName, language, components }) {
  // Placeholder para Meta Cloud API
  // POST https://graph.facebook.com/v18.0/{phone_number_id}/messages
  // Body: { messaging_product: 'whatsapp', to: telefone, type: 'template', template: {...} }
  throw new Error('Meta Cloud API ainda não implementada. Use Z-API por enquanto.');
}

// ─── Verifica status da instância Z-API ──────────────────────
export async function checkZapiStatus(account) {
  if (!account?.zapi_instance_id || !account?.zapi_token) {
    return { connected: false, error: 'Credenciais ausentes' };
  }

  const url = `${ZAPI_BASE}/${account.zapi_instance_id}/token/${account.zapi_token}/status`;

  try {
    const resp = await fetch(url, {
      headers: { 'Client-Token': account.zapi_client_token || '' },
    });
    const json = await resp.json();

    return {
      connected: json.connected === true || json.value === 'CONNECTED',
      status: json.value || json.status || 'unknown',
      raw: json,
    };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

// ─── Busca QR Code para conectar instância ───────────────────
export async function getQrCode(account) {
  if (!account?.zapi_instance_id || !account?.zapi_token) return null;

  const url = `${ZAPI_BASE}/${account.zapi_instance_id}/token/${account.zapi_token}/qr-code/image`;

  try {
    const resp = await fetch(url, {
      headers: { 'Client-Token': account.zapi_client_token || '' },
    });
    const json = await resp.json();
    return json.value || json.qrcode || null;
  } catch {
    return null;
  }
}

// ─── Resolve texto do template com variáveis ─────────────────
function resolveTemplateText(template, variaveis) {
  if (!template) return '';

  let text = template.preview_text || '';

  // Substitui {{1}}, {{2}}, etc.
  if (variaveis && typeof variaveis === 'object') {
    Object.entries(variaveis).forEach(([idx, value]) => {
      text = text.replace(new RegExp(`\\{\\{${idx}\\}\\}`, 'g'), value || '');
    });
  }

  return text || template.template_name || '';
}
