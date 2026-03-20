/**
 * ABSTRAÇÃO DE PROVIDER DE MENSAGERIA
 *
 * Toda a lógica de automação é independente do canal.
 * O provider é apenas a camada de entrega — um detalhe de implementação.
 *
 * Para migrar de Z-API para Meta Cloud API ou qualquer outro provider:
 *  1. Crie uma classe que estende MessageProvider
 *  2. Implemente send() e checkStatus()
 *  3. Adicione o case no createProvider()
 *  4. Zero mudanças no motor de automação
 *
 * Contrato (interface):
 *  send(params)    → Promise<SendResult>
 *  checkStatus(id) → Promise<StatusResult>
 *
 * SendResult: { success, messageId?, error? }
 * StatusResult: { status, delivered?, read?, error? }
 */

const ZAPI_BASE = 'https://api.z-api.io/instances';

// ─── Classe base (interface) ──────────────────────────────────
export class MessageProvider {
  constructor(account) {
    this.account = account;
  }

  get name() { return 'base'; }

  /**
   * Envia mensagem para um destinatário
   * @param {object} params
   * @param {string} params.telefone - Número E.164 (ex: "5531997763371")
   * @param {string} params.text - Texto da mensagem (já com variáveis resolvidas)
   * @param {string} [params.templateName] - Nome do template (providers que exigem)
   * @param {object} [params.metadata] - Dados extras (campaign_id, rule_id, etc.)
   * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
   */
  async send({ telefone, text, templateName, metadata }) {
    throw new Error(`[${this.name}] send() não implementado`);
  }

  /**
   * Consulta status de uma mensagem pelo ID
   * @param {string} messageId
   * @returns {Promise<{status: string, delivered?: boolean, read?: boolean, error?: string}>}
   */
  async checkStatus(messageId) {
    throw new Error(`[${this.name}] checkStatus() não implementado`);
  }

  /**
   * Verifica se a conta está conectada
   * @returns {Promise<{connected: boolean, status?: string, error?: string}>}
   */
  async checkConnection() {
    throw new Error(`[${this.name}] checkConnection() não implementado`);
  }
}

// ─── Provider Z-API ───────────────────────────────────────────
export class ZApiProvider extends MessageProvider {
  get name() { return 'zapi'; }

  get baseUrl() {
    return `${ZAPI_BASE}/${this.account.zapi_instance_id}/token/${this.account.zapi_token}`;
  }

  get headers() {
    return {
      'Content-Type':  'application/json',
      'Client-Token':  this.account.zapi_client_token || '',
    };
  }

  async send({ telefone, text }) {
    if (!this.account.zapi_instance_id || !this.account.zapi_token) {
      return { success: false, error: 'Credenciais Z-API ausentes (instance_id ou token)' };
    }

    try {
      const resp = await fetch(`${this.baseUrl}/send-text`, {
        method:  'POST',
        headers: this.headers,
        body:    JSON.stringify({ phone: telefone, message: text }),
      });

      const json = await resp.json();

      if (!resp.ok || json.error) {
        return { success: false, error: json.error || json.message || `HTTP ${resp.status}` };
      }

      return {
        success:   true,
        messageId: json.zaapId || json.messageId || json.id || null,
        raw:       json,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async checkStatus(messageId) {
    try {
      const resp = await fetch(`${this.baseUrl}/message-status/${messageId}`, {
        headers: this.headers,
      });
      const json = await resp.json();
      return {
        status:    json.status || 'unknown',
        delivered: json.status === 'DELIVERY_ACK' || json.status === 'READ',
        read:      json.status === 'READ',
      };
    } catch (err) {
      return { status: 'error', error: err.message };
    }
  }

  async checkConnection() {
    try {
      const resp = await fetch(`${this.baseUrl}/status`, { headers: this.headers });
      const json = await resp.json();
      const connected = json.connected === true || json.value === 'CONNECTED';
      return { connected, status: json.value || json.status || 'unknown' };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  }

  async getQrCode() {
    try {
      const resp = await fetch(`${this.baseUrl}/qr-code/image`, { headers: this.headers });
      const json = await resp.json();
      return json.value || json.qrcode || null;
    } catch {
      return null;
    }
  }
}

// ─── Provider Meta Cloud API (futuro) ────────────────────────
export class MetaProvider extends MessageProvider {
  get name() { return 'meta'; }

  async send({ telefone, text, templateName, metadata }) {
    if (!this.account.phone_number_id || !this.account.access_token_enc) {
      return { success: false, error: 'Credenciais Meta ausentes (phone_number_id ou access_token)' };
    }

    // TODO: implementar quando migrar para Meta Cloud API
    // POST https://graph.facebook.com/v18.0/{phone_number_id}/messages
    // Body: {
    //   messaging_product: 'whatsapp',
    //   to: telefone,
    //   type: templateName ? 'template' : 'text',
    //   template: { name: templateName, language: { code: 'pt_BR' }, components: [...] },
    //   text: { body: text }
    // }
    throw new Error('[MetaProvider] Ainda não implementado. Use ZApiProvider por enquanto.');
  }

  async checkConnection() {
    return { connected: false, error: 'Meta provider não implementado' };
  }
}

// ─── Factory ─────────────────────────────────────────────────
/**
 * Cria o provider correto baseado na conta WhatsApp
 * @param {object} account - Linha de whatsapp_accounts
 * @returns {MessageProvider}
 */
export function createProvider(account) {
  if (!account) throw new Error('Account não pode ser null');

  switch (account.provider) {
    case 'zapi':  return new ZApiProvider(account);
    case 'meta':  return new MetaProvider(account);
    default:
      throw new Error(`Provider "${account.provider}" não suportado. Use: zapi, meta`);
  }
}

// ─── Utilitário: envia com retry automático ───────────────────
/**
 * Envia mensagem com retry exponencial (3 tentativas)
 * Útil para chamadas diretas (não via fila)
 */
export async function sendWithRetry(provider, params, maxAttempts = 3) {
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await provider.send(params);
    if (result.success) return result;
    lastError = result.error || 'Erro desconhecido';
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  return { success: false, error: lastError, attempts: maxAttempts };
}
