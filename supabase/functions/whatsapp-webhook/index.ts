/**
 * Edge Function: whatsapp-webhook
 *
 * Recebe callbacks de status do WhatsApp (Z-API ou Meta Cloud API):
 *  - Confirmação de entrega (DELIVERED)
 *  - Confirmação de leitura (READ)
 *  - Mensagens recebidas (inbound)
 *  - Opt-out via palavra-chave (STOP, SAIR, PARAR, CANCELAR)
 *
 * Atualiza:
 *  - whatsapp_messages.status
 *  - automation_queue.status
 *  - campaign_recipients.status
 *  - whatsapp_optouts (se opt-out detectado)
 *
 * Adicionalmente: detecta opt-outs e conversões via resposta.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Palavras que indicam opt-out (case insensitive)
const OPTOUT_KEYWORDS = ['stop', 'sair', 'parar', 'cancelar', 'remover', 'descadastrar', '0'];

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === 'OPTIONS') return corsOk();

  // GET: verificação de webhook do Meta
  if (req.method === 'GET') {
    const url    = new URL(req.url);
    const mode   = url.searchParams.get('hub.mode');
    const token  = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    // Verifica token de validação (configurado em whatsapp_accounts.webhook_verify_token)
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: account } = await supabase
      .from('whatsapp_accounts')
      .select('webhook_verify_token')
      .eq('webhook_verify_token', token)
      .maybeSingle();

    if (mode === 'subscribe' && account && challenge) {
      return new Response(challenge, { status: 200 });
    }

    return new Response('Forbidden', { status: 403 });
  }

  // POST: evento de webhook
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const payload = await req.json();

    // ─── Detecta o provider pelo payload ─────────────────────
    // Z-API: payload.instanceId presente
    // Meta: payload.object === 'whatsapp_business_account'

    if (payload.object === 'whatsapp_business_account') {
      await handleMetaWebhook(supabase, payload);
    } else if (payload.instanceId || payload.phone || payload.type) {
      await handleZapiWebhook(supabase, payload);
    } else {
      console.warn('[webhook] Formato de payload não reconhecido:', JSON.stringify(payload).slice(0, 200));
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[webhook] Erro:', err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

// ─── Handler Z-API ────────────────────────────────────────────
async function handleZapiWebhook(supabase: any, payload: any) {
  const type      = payload.type;         // message, delivery, read, status
  const phone     = normalizePhone(payload.phone || payload.from || '');
  const messageId = payload.messageId || payload.zaapId || null;
  const text      = payload.text?.message || payload.message || '';

  if (!phone) return;

  switch (type) {
    case 'DeliveryCallback':
    case 'delivery':
      await updateMessageStatus(supabase, messageId, phone, 'delivered', { entregue_em: new Date().toISOString() });
      break;

    case 'ReadCallback':
    case 'read':
      await updateMessageStatus(supabase, messageId, phone, 'read', { lido_em: new Date().toISOString() });
      break;

    case 'ReceivedCallback':
    case 'message':
      // Mensagem recebida → salva no inbox
      await handleInboundMessage(supabase, phone, text, messageId, payload);
      break;

    case 'DisconnectedCallback':
      // Conta desconectada → marca como inativa
      if (payload.instanceId) {
        await supabase
          .from('whatsapp_accounts')
          .update({ status: 'inactive' })
          .eq('zapi_instance_id', payload.instanceId);
      }
      break;
  }
}

// ─── Handler Meta Cloud API ───────────────────────────────────
async function handleMetaWebhook(supabase: any, payload: any) {
  const entries = payload.entry || [];

  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      const value = change.value || {};

      // Status updates (delivered/read)
      for (const status of value.statuses || []) {
        const phone      = normalizePhone(status.recipient_id);
        const messageId  = status.id;
        const statusVal  = status.status; // sent, delivered, read, failed

        const updates: Record<string, string> = {};
        if (statusVal === 'delivered') updates.entregue_em = new Date(status.timestamp * 1000).toISOString();
        if (statusVal === 'read')      updates.lido_em     = new Date(status.timestamp * 1000).toISOString();

        await updateMessageStatus(supabase, messageId, phone, statusVal, updates);
      }

      // Mensagens recebidas
      for (const msg of value.messages || []) {
        const phone = normalizePhone(msg.from);
        const text  = msg.text?.body || '';
        await handleInboundMessage(supabase, phone, text, msg.id, msg);
      }
    }
  }
}

// ─── Atualiza status de uma mensagem ─────────────────────────
async function updateMessageStatus(
  supabase: any,
  wamid: string | null,
  phone: string,
  newStatus: string,
  extraFields: Record<string, string> = {}
) {
  if (!wamid && !phone) return;

  // Atualiza whatsapp_messages
  const msgUpdate: Record<string, any> = { status: newStatus, atualizado_em: new Date().toISOString() };

  let msgQuery = supabase.from('whatsapp_messages').update(msgUpdate);
  if (wamid) {
    msgQuery = msgQuery.eq('wamid', wamid);
  } else {
    msgQuery = msgQuery.eq('telefone', phone).eq('direcao', 'outbound');
  }
  await msgQuery;

  // Atualiza automation_queue
  const queueStatus = newStatus === 'delivered' ? 'delivered' : newStatus === 'read' ? 'read' : null;
  if (queueStatus && wamid) {
    await supabase
      .from('automation_queue')
      .update({ status: queueStatus, ...extraFields })
      .eq('wamid', wamid);
  }

  // Atualiza campaign_recipients
  if (wamid) {
    const recipientStatus = newStatus === 'delivered' ? 'entregue' : newStatus === 'read' ? 'lido' : null;
    if (recipientStatus) {
      await supabase
        .from('campaign_recipients')
        .update({ status: recipientStatus, ...extraFields })
        .eq('wamid', wamid);
    }

    // Se lido: atualiza contador da campanha
    if (newStatus === 'read') {
      const { data: recipient } = await supabase
        .from('campaign_recipients')
        .select('campaign_id')
        .eq('wamid', wamid)
        .maybeSingle();

      if (recipient?.campaign_id) {
        await supabase.rpc('increment_campaign_reads', { p_campaign_id: recipient.campaign_id })
          .catch(() => {
            // Fallback se a função não existir
            supabase
              .from('campaign_whatsapp')
              .update({ total_lidos: supabase.rpc('total_lidos + 1') })
              .eq('id', recipient.campaign_id);
          });
      }
    }
  }
}

// ─── Mensagem inbound recebida ────────────────────────────────
async function handleInboundMessage(
  supabase: any,
  phone: string,
  text: string,
  wamid: string | null,
  rawPayload: any
) {
  // 1. Detecta opt-out
  const normalized = text.trim().toLowerCase().replace(/[!.,?]/g, '');
  const isOptOut = OPTOUT_KEYWORDS.some(kw => normalized === kw || normalized.startsWith(kw + ' '));

  if (isOptOut) {
    await registrarOptOut(supabase, phone, text);
    console.info(`[webhook] Opt-out registrado: ${phone} — "${text}"`);
    return;
  }

  // 2. Busca cliente associado ao telefone
  const { data: cliente } = await supabase
    .from('v2_clientes')
    .select('id, nome')
    .or(`telefone.eq.${phone},celular.eq.${phone}`)
    .maybeSingle();

  // 3. Persiste no inbox
  await supabase
    .from('whatsapp_messages')
    .insert({
      account_id:  await getDefaultAccountId(supabase),
      cliente_id:  cliente?.id || null,
      wamid:       wamid,
      direcao:     'inbound',
      tipo:        rawPayload.type === 'image' ? 'image' : 'text',
      conteudo:    { text, raw: rawPayload },
      status:      'sent',
      telefone:    phone,
    })
    .on('conflict', ['wamid'])
    .ignore();

  // 4. Verifica se é resposta de confirmação de compra (ex: "COMPREI", "SIM", "1")
  const conversionKeywords = ['comprei', 'sim', 'fiz o pedido', 'ja comprei', 'já comprei', '1'];
  const isConversion = conversionKeywords.some(kw => normalized.includes(kw));

  if (isConversion && cliente?.id) {
    // Marca o item da fila mais recente como "respondido com conversão"
    await supabase
      .from('automation_queue')
      .update({ status: 'read' })
      .eq('telefone', phone)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(1);
  }
}

// ─── Registra opt-out ─────────────────────────────────────────
async function registrarOptOut(supabase: any, telefone: string, motivo: string) {
  const { data: cliente } = await supabase
    .from('v2_clientes')
    .select('id')
    .or(`telefone.eq.${telefone},celular.eq.${telefone}`)
    .maybeSingle();

  await supabase
    .from('whatsapp_optouts')
    .upsert(
      { telefone, cliente_id: cliente?.id || null, motivo: `resposta_cliente: "${motivo}"` },
      { onConflict: 'telefone' }
    );

  // Cancela itens pendentes na fila para este número
  await supabase
    .from('automation_queue')
    .update({ status: 'opted_out' })
    .eq('telefone', telefone)
    .eq('status', 'pending');
}

async function getDefaultAccountId(supabase: any): Promise<string | null> {
  const { data } = await supabase
    .from('whatsapp_accounts')
    .select('id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

function normalizePhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  return digits;
}

function corsOk() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}
