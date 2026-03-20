/**
 * MÓDULO: Inbox de Mensagens WhatsApp
 * Exibe todas as mensagens enviadas e recebidas, por cliente.
 */

import { recompraState, formatPhone, registrarInteraction } from './recompra.js';
import { sendWhatsAppMessage } from './zapApi.js';

// ─── RENDER: Tela de mensagens ────────────────────────────────
export async function renderMensagens(ctx) {
  const { supaClient } = ctx;
  const container = document.getElementById('page-mensagens');
  if (!container) return;

  container.innerHTML = `<div class="recompra-loading">Carregando mensagens...</div>`;

  // Carrega conversas únicas por telefone (últimas 100)
  const { data: mensagens } = await supaClient
    .from('whatsapp_messages')
    .select(`
      id, telefone, direcao, status, enviado_em, conteudo, tipo,
      cliente_id,
      v2_clientes(id, nome, score_recompra, next_best_action)
    `)
    .order('enviado_em', { ascending: false })
    .limit(200);

  if (!mensagens || mensagens.length === 0) {
    container.innerHTML = `
      <div class="recompra-page">
        <div class="recompra-header">
          <h1 class="recompra-title">Mensagens</h1>
        </div>
        <div class="recompra-empty">
          <div class="recompra-empty-icon">💬</div>
          <h3>Nenhuma mensagem ainda</h3>
          <p>As mensagens enviadas e recebidas aparecerão aqui.</p>
        </div>
      </div>
    `;
    return;
  }

  // Agrupa por telefone — última mensagem de cada conversa
  const conversas = [];
  const seen = new Set();
  for (const m of mensagens) {
    if (!seen.has(m.telefone)) {
      seen.add(m.telefone);
      conversas.push(m);
    }
  }

  container.innerHTML = `
    <div class="recompra-page inbox-page">
      <div class="inbox-layout">
        <!-- Lista de conversas -->
        <div class="inbox-sidebar">
          <div class="inbox-search">
            <input type="text" class="chiva-input" placeholder="Buscar por nome ou número..."
              id="inbox-search" oninput="window._recompra.filterInbox(this.value)">
          </div>

          <div class="inbox-filters">
            <button class="inbox-filter-btn active" onclick="window._recompra.setInboxFilter('todos', this)">Todos</button>
            <button class="inbox-filter-btn" onclick="window._recompra.setInboxFilter('inbound', this)">Recebidos</button>
            <button class="inbox-filter-btn" onclick="window._recompra.setInboxFilter('outbound', this)">Enviados</button>
          </div>

          <div class="inbox-list" id="inbox-list">
            ${conversas.map(m => renderConversaItem(m)).join('')}
          </div>
        </div>

        <!-- Área de conversa -->
        <div class="inbox-main" id="inbox-main">
          <div class="inbox-placeholder">
            <div class="recompra-empty-icon">💬</div>
            <p>Selecione uma conversa</p>
          </div>
        </div>
      </div>
    </div>
  `;

  window._recompra = window._recompra || {};
  window._recompra._allConversas = conversas;
  window._recompra._mensagensCtx = ctx;
  window._recompra.abrirConversa = (telefone, clienteId) => abrirConversa(ctx, telefone, clienteId);
  window._recompra.filterInbox = filterInbox;
  window._recompra.setInboxFilter = setInboxFilter;
  window._recompra.enviarMensagemAvulsa = (telefone, clienteId) => enviarMensagemAvulsa(ctx, telefone, clienteId);
}

function renderConversaItem(m) {
  const nome = m.v2_clientes?.nome || m.telefone;
  const preview = getMessagePreview(m);
  const hora = formatHora(m.enviado_em);
  const isInbound = m.direcao === 'inbound';

  return `
    <div class="conversa-item" data-telefone="${m.telefone}" data-cliente="${m.cliente_id || ''}"
      onclick="window._recompra.abrirConversa('${m.telefone}', '${m.cliente_id || ''}')">
      <div class="conversa-avatar">${nome.charAt(0).toUpperCase()}</div>
      <div class="conversa-info">
        <div class="conversa-nome">${nome}</div>
        <div class="conversa-preview ${isInbound ? 'preview-inbound' : ''}">
          ${isInbound ? '← ' : '→ '}${preview}
        </div>
      </div>
      <div class="conversa-meta">
        <div class="conversa-hora">${hora}</div>
        ${getStatusIcon(m.status)}
      </div>
    </div>
  `;
}

async function abrirConversa(ctx, telefone, clienteId) {
  const { supaClient } = ctx;

  // Destaca conversa selecionada
  document.querySelectorAll('.conversa-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.telefone === telefone);
  });

  const main = document.getElementById('inbox-main');
  if (!main) return;
  main.innerHTML = `<div class="recompra-loading">Carregando conversa...</div>`;

  // Carrega todas as mensagens desta conversa
  const [{ data: msgs }, { data: cliente }] = await Promise.all([
    supaClient
      .from('whatsapp_messages')
      .select('*, campaign_whatsapp(nome)')
      .eq('telefone', telefone)
      .order('enviado_em', { ascending: true })
      .limit(100),
    clienteId
      ? supaClient.from('v2_clientes').select('id, nome, email, telefone, total_pedidos, total_gasto, score_recompra, next_best_action').eq('id', clienteId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  main.innerHTML = `
    <div class="conversa-container">
      <!-- Header da conversa -->
      <div class="conversa-header">
        <div class="conversa-header-info">
          <div class="conversa-avatar large">${(cliente?.nome || telefone).charAt(0).toUpperCase()}</div>
          <div>
            <div class="conversa-header-nome">${cliente?.nome || telefone}</div>
            <div class="conversa-header-tel">${telefone}</div>
          </div>
        </div>
        <div class="conversa-header-actions">
          ${clienteId ? `<button class="chiva-btn chiva-btn-sm" onclick="window.openClienteDrawer && window.openClienteDrawer('${clienteId}')">Ver cliente</button>` : ''}
          <button class="chiva-btn chiva-btn-sm" onclick="window._recompra.enviarMensagemAvulsa('${telefone}', '${clienteId}')">Enviar mensagem</button>
        </div>
      </div>

      <!-- Contexto do cliente (se existir) -->
      ${cliente ? `
        <div class="conversa-context">
          <span>Score: <strong>${cliente.score_recompra || '—'}</strong></span>
          <span>Pedidos: <strong>${cliente.total_pedidos || 0}</strong></span>
          <span>LTV: <strong>R$ ${Number(cliente.total_gasto || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</strong></span>
          ${cliente.next_best_action ? `<span class="action-badge">${cliente.next_best_action}</span>` : ''}
        </div>
      ` : ''}

      <!-- Bolhas de mensagem -->
      <div class="mensagens-feed" id="mensagens-feed">
        ${(msgs || []).map(m => renderMsgBubble(m)).join('')}
      </div>

      <!-- Input de resposta manual -->
      <div class="conversa-input">
        <textarea id="msg-input-${telefone}" class="chiva-input" rows="2" placeholder="Digite uma mensagem..."></textarea>
        <button class="chiva-btn chiva-btn-primary"
          onclick="window._recompra.enviarTextoLivre('${telefone}', '${clienteId}')">
          Enviar
        </button>
      </div>
    </div>
  `;

  // Scroll para o final
  const feed = document.getElementById('mensagens-feed');
  if (feed) feed.scrollTop = feed.scrollHeight;

  window._recompra.enviarTextoLivre = (tel, cliId) => enviarTextoLivre(ctx, tel, cliId);
}

function renderMsgBubble(m) {
  const isOut = m.direcao === 'outbound';
  const texto = getMessagePreview(m);
  const hora = formatHora(m.enviado_em);

  return `
    <div class="msg-bubble-wrap ${isOut ? 'outbound' : 'inbound'}">
      <div class="msg-bubble">
        ${m.campaign_whatsapp?.nome ? `<div class="msg-campanha-tag">📢 ${m.campaign_whatsapp.nome}</div>` : ''}
        <div class="msg-texto">${texto}</div>
        <div class="msg-meta">
          ${hora}
          ${isOut ? getStatusIcon(m.status) : ''}
        </div>
      </div>
    </div>
  `;
}

async function enviarTextoLivre(ctx, telefone, clienteId) {
  const { supaClient } = ctx;
  const account = recompraState.account;
  if (!account) return alert('Nenhuma conta WhatsApp conectada.');

  const input = document.getElementById(`msg-input-${telefone}`);
  const texto = input?.value?.trim();
  if (!texto) return;

  input.disabled = true;

  const result = await sendWhatsAppMessage({
    account,
    telefone,
    textoLivre: texto,
  });

  if (result.success) {
    await supaClient.from('whatsapp_messages').insert({
      account_id: account.id,
      cliente_id: clienteId || null,
      wamid: result.messageId,
      direcao: 'outbound',
      tipo: 'text',
      conteudo: { text: texto },
      status: 'sent',
      telefone,
    });

    if (clienteId) {
      await registrarInteraction(supaClient, clienteId, texto, { tipo: 'manual', telefone });
    }

    if (input) { input.value = ''; input.disabled = false; }
    await abrirConversa(ctx, telefone, clienteId);
  } else {
    input.disabled = false;
    alert('Erro ao enviar: ' + result.error);
  }
}

async function enviarMensagemAvulsa(ctx, telefone, clienteId) {
  // Foca no input da conversa
  const input = document.getElementById(`msg-input-${telefone}`);
  if (input) input.focus();
}

// ─── Filtros do inbox ─────────────────────────────────────────
function filterInbox(termo) {
  const items = document.querySelectorAll('.conversa-item');
  const t = termo.toLowerCase();
  items.forEach(el => {
    const nome = el.querySelector('.conversa-nome')?.textContent?.toLowerCase() || '';
    const tel = el.dataset.telefone || '';
    el.style.display = nome.includes(t) || tel.includes(t) ? '' : 'none';
  });
}

function setInboxFilter(tipo, btn) {
  document.querySelectorAll('.inbox-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const items = document.querySelectorAll('.conversa-item');
  items.forEach(el => {
    if (tipo === 'todos') { el.style.display = ''; return; }
    const preview = el.querySelector('.conversa-preview');
    const isInbound = preview?.classList.contains('preview-inbound');
    el.style.display = (tipo === 'inbound' ? isInbound : !isInbound) ? '' : 'none';
  });
}

// ─── Helpers ─────────────────────────────────────────────────
function getMessagePreview(m) {
  const c = m.conteudo || {};
  if (c.text) return c.text.substring(0, 80);
  if (c.template) return `[Template: ${c.template}]`;
  if (m.tipo === 'image') return '[Imagem]';
  if (m.tipo === 'audio') return '[Áudio]';
  if (m.tipo === 'document') return '[Documento]';
  return '[Mensagem]';
}

function getStatusIcon(status) {
  const icons = { sent: '✓', delivered: '✓✓', read: '<span style="color:var(--green)">✓✓</span>', failed: '<span style="color:var(--red)">✗</span>' };
  return `<span class="msg-status">${icons[status] || ''}</span>`;
}

function formatHora(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
