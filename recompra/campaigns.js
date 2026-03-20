/**
 * MÓDULO: Campanhas WhatsApp
 * Criação, disparo, tracking e análise de campanhas
 */

import { recompraState, formatPhone, resolveTemplateVars, registrarInteraction, isOptOut } from './recompra.js';
import { loadSegmentClientes } from './segments.js';
import { sendWhatsAppMessage } from './zapApi.js';

// ─── RENDER: Lista de campanhas ───────────────────────────────
export async function renderCampanhas(ctx) {
  const { supaClient } = ctx;
  const container = document.getElementById('page-campanhas');
  if (!container) return;

  container.innerHTML = `<div class="recompra-loading">Carregando campanhas...</div>`;

  const { data: campaigns, error } = await supaClient
    .from('vw_campaign_metrics')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    container.innerHTML = `<div class="recompra-error">Erro ao carregar campanhas: ${error.message}</div>`;
    return;
  }

  recompraState.campaigns = campaigns || [];

  container.innerHTML = `
    <div class="recompra-page">
      <div class="recompra-header">
        <div>
          <h1 class="recompra-title">Campanhas WhatsApp</h1>
          <p class="recompra-subtitle">${campaigns?.length || 0} campanha(s) encontrada(s)</p>
        </div>
        <button class="chiva-btn chiva-btn-primary" onclick="window._recompra.openNovaCampanha()">
          + Nova Campanha
        </button>
      </div>

      ${!campaigns || campaigns.length === 0 ? renderEmptyCampanhas() : renderCampanhasList(campaigns)}
    </div>

    ${renderNovaCampanhaModal(ctx)}
  `;

  // Expõe funções globalmente para handlers inline
  window._recompra = window._recompra || {};
  window._recompra.openNovaCampanha = () => openNovaCampanhaModal(ctx);
  window._recompra.verCampanha = (id) => renderCampanhaDetalhe(ctx, id);
  window._recompra.clonarCampanha = (id) => clonarCampanha(ctx, id);
}

function renderEmptyCampanhas() {
  return `
    <div class="recompra-empty">
      <div class="recompra-empty-icon">📢</div>
      <h3>Nenhuma campanha ainda</h3>
      <p>Crie sua primeira campanha para reconquistar clientes com alto potencial de recompra.</p>
    </div>
  `;
}

function renderCampanhasList(campaigns) {
  const statusBadge = {
    rascunho:  { label: 'Rascunho',  cls: 'badge-gray'   },
    agendada:  { label: 'Agendada',  cls: 'badge-blue'   },
    enviando:  { label: 'Enviando',  cls: 'badge-yellow' },
    concluida: { label: 'Concluída', cls: 'badge-green'  },
    pausada:   { label: 'Pausada',   cls: 'badge-orange' },
    erro:      { label: 'Erro',      cls: 'badge-red'    },
  };

  return `
    <div class="campaign-table-wrap">
      <table class="chiva-table campaign-table">
        <thead>
          <tr>
            <th>Campanha</th>
            <th>Segmento</th>
            <th>Status</th>
            <th class="text-right">Enviados</th>
            <th class="text-right">Lidos</th>
            <th class="text-right">Convertidos</th>
            <th class="text-right">Receita</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${campaigns.map(c => {
            const badge = statusBadge[c.status] || { label: c.status, cls: 'badge-gray' };
            const receita = c.receita_atribuida
              ? `R$ ${Number(c.receita_atribuida).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`
              : '—';
            return `
              <tr class="campaign-row" onclick="window._recompra.verCampanha('${c.id}')">
                <td>
                  <div class="campaign-nome">${c.nome}</div>
                  <div class="campaign-data">${formatDate(c.created_at)}</div>
                </td>
                <td>${c.segmento_nome || '—'}</td>
                <td><span class="chiva-badge ${badge.cls}">${badge.label}</span></td>
                <td class="text-right">${c.total_enviados || 0}</td>
                <td class="text-right">
                  ${c.total_lidos || 0}
                  ${c.taxa_leitura > 0 ? `<span class="rate">${c.taxa_leitura}%</span>` : ''}
                </td>
                <td class="text-right">
                  ${c.total_convertidos || 0}
                  ${c.taxa_conversao > 0 ? `<span class="rate rate-green">${c.taxa_conversao}%</span>` : ''}
                </td>
                <td class="text-right">${receita}</td>
                <td class="campaign-actions" onclick="event.stopPropagation()">
                  <button class="icon-btn" onclick="window._recompra.clonarCampanha('${c.id}')" title="Clonar">⧉</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── RENDER: Detalhe de campanha ──────────────────────────────
export async function renderCampanhaDetalhe(ctx, campaignId) {
  const { supaClient } = ctx;

  const [{ data: campaign }, { data: recipients }] = await Promise.all([
    supaClient.from('vw_campaign_metrics').select('*').eq('id', campaignId).maybeSingle(),
    supaClient
      .from('campaign_recipients')
      .select('id, telefone, status, enviado_em, entregue_em, lido_em, convertido, receita_atribuida, erro_detalhe, v2_clientes(nome)')
      .eq('campaign_id', campaignId)
      .order('enviado_em', { ascending: false })
      .limit(200),
  ]);

  if (!campaign) return;

  const drawer = document.getElementById('recompra-drawer') || createDrawer();
  drawer.innerHTML = `
    <div class="drawer-header">
      <h2>${campaign.nome}</h2>
      <button class="drawer-close" onclick="document.getElementById('recompra-drawer').classList.remove('open')">✕</button>
    </div>
    <div class="drawer-body">
      <div class="campaign-kpis">
        ${kpiCard('Enviados',    campaign.total_enviados)}
        ${kpiCard('Entregues',   campaign.total_entregues)}
        ${kpiCard('Lidos',       `${campaign.total_lidos} (${campaign.taxa_leitura}%)`)}
        ${kpiCard('Convertidos', `${campaign.total_convertidos} (${campaign.taxa_conversao}%)`)}
        ${kpiCard('Receita',     `R$ ${Number(campaign.receita_atribuida || 0).toLocaleString('pt-BR')}`)}
      </div>

      <h3 class="drawer-section-title">Destinatários</h3>
      <div class="recipients-list">
        ${(recipients || []).map(r => `
          <div class="recipient-row recipient-${r.status}">
            <span class="recipient-nome">${r.v2_clientes?.nome || r.telefone}</span>
            <span class="chiva-badge badge-status-${r.status}">${r.status}</span>
            ${r.convertido ? '<span class="converted-tag">✓ Converteu</span>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  drawer.classList.add('open');
}

// ─── MODAL: Nova Campanha (wizard 4 passos) ───────────────────
function renderNovaCampanhaModal(ctx) {
  const segments = recompraState.segments || [];
  const templates = recompraState.templates || [];
  const account = recompraState.account;

  return `
    <div id="modal-nova-campanha" class="recompra-modal" style="display:none">
      <div class="recompra-modal-overlay" onclick="window._recompra.closeModal()"></div>
      <div class="recompra-modal-content">
        <div class="modal-header">
          <h2>Nova Campanha</h2>
          <button onclick="window._recompra.closeModal()">✕</button>
        </div>

        <!-- Stepper -->
        <div class="modal-stepper" id="modal-stepper">
          <div class="step active" data-step="1">1. Básico</div>
          <div class="step" data-step="2">2. Segmento</div>
          <div class="step" data-step="3">3. Mensagem</div>
          <div class="step" data-step="4">4. Envio</div>
        </div>

        <!-- Passo 1 -->
        <div class="modal-step" id="step-1">
          <label>Nome da campanha *</label>
          <input type="text" id="camp-nome" class="chiva-input" placeholder="Ex: Reativação Junho 2026">

          <label>Objetivo</label>
          <textarea id="camp-desc" class="chiva-input" rows="2" placeholder="Ex: Reativar clientes que não compram há mais de 30 dias"></textarea>

          <div class="modal-footer">
            <button class="chiva-btn chiva-btn-primary" onclick="window._recompra.goStep(2)">Próximo →</button>
          </div>
        </div>

        <!-- Passo 2 -->
        <div class="modal-step" id="step-2" style="display:none">
          <label>Segmento de clientes *</label>
          <div class="segment-cards">
            ${segments.map(s => `
              <div class="segment-card" data-seg-id="${s.id}" onclick="window._recompra.selectSegment('${s.id}', '${escapeHtml(s.nome)}', ${s.customer_count || 0})">
                <div class="seg-nome">${s.nome}</div>
                <div class="seg-count">${s.customer_count || 0} clientes</div>
                <div class="seg-desc">${s.descricao || ''}</div>
              </div>
            `).join('')}
          </div>
          <div id="segment-preview" class="segment-preview" style="display:none">
            <strong id="seg-preview-nome"></strong>: <span id="seg-preview-count"></span> clientes selecionados
          </div>
          <div class="modal-footer">
            <button class="chiva-btn" onclick="window._recompra.goStep(1)">← Voltar</button>
            <button class="chiva-btn chiva-btn-primary" onclick="window._recompra.goStep(3)">Próximo →</button>
          </div>
        </div>

        <!-- Passo 3 -->
        <div class="modal-step" id="step-3" style="display:none">
          ${!account ? `
            <div class="alert-warn">
              ⚠️ Nenhuma conta WhatsApp conectada. Configure em <a href="#config-whatsapp">Configurações</a>.
            </div>
          ` : templates.length === 0 ? `
            <div class="alert-warn">
              ⚠️ Nenhum template disponível. Adicione templates em <a href="#config-whatsapp">Configurações</a>.
            </div>
          ` : `
            <label>Template de mensagem *</label>
            <select id="camp-template" class="chiva-input" onchange="window._recompra.onTemplateChange()">
              <option value="">Selecione um template...</option>
              ${templates.map(t => `<option value="${t.id}" data-vars='${JSON.stringify(t.variaveis)}'>${t.template_name}</option>`).join('')}
            </select>

            <div id="template-vars" class="template-vars" style="display:none">
              <label>Preview da mensagem:</label>
              <div id="template-preview" class="template-preview"></div>
            </div>
          `}
          <div class="modal-footer">
            <button class="chiva-btn" onclick="window._recompra.goStep(2)">← Voltar</button>
            <button class="chiva-btn chiva-btn-primary" onclick="window._recompra.goStep(4)">Próximo →</button>
          </div>
        </div>

        <!-- Passo 4 -->
        <div class="modal-step" id="step-4" style="display:none">
          <div class="campaign-summary" id="campaign-summary"></div>

          <label>
            <input type="radio" name="send-type" value="now" checked onchange="window._recompra.onSendTypeChange()">
            Enviar agora
          </label>
          <label>
            <input type="radio" name="send-type" value="scheduled" onchange="window._recompra.onSendTypeChange()">
            Agendar envio
          </label>

          <div id="schedule-input" style="display:none; margin-top:12px">
            <label>Data e hora de envio</label>
            <input type="datetime-local" id="camp-agendado" class="chiva-input">
          </div>

          <div class="modal-footer">
            <button class="chiva-btn" onclick="window._recompra.goStep(3)">← Voltar</button>
            <button class="chiva-btn chiva-btn-success" onclick="window._recompra.confirmarCampanha()">
              ✓ Criar Campanha
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function openNovaCampanhaModal(ctx) {
  const modal = document.getElementById('modal-nova-campanha');
  if (modal) {
    modal.style.display = 'flex';
    window._recompra._ctx = ctx;
    window._recompra._campData = {};

    window._recompra.goStep = (step) => goStep(step, ctx);
    window._recompra.closeModal = () => { modal.style.display = 'none'; };
    window._recompra.selectSegment = selectSegment;
    window._recompra.onTemplateChange = onTemplateChange;
    window._recompra.onSendTypeChange = onSendTypeChange;
    window._recompra.confirmarCampanha = () => confirmarCampanha(ctx);
  }
}

function goStep(step) {
  [1, 2, 3, 4].forEach(s => {
    const el = document.getElementById(`step-${s}`);
    if (el) el.style.display = s === step ? 'block' : 'none';
    const dot = document.querySelector(`[data-step="${s}"]`);
    if (dot) dot.classList.toggle('active', s === step);
  });
}

function selectSegment(id, nome, count) {
  document.querySelectorAll('.segment-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`[data-seg-id="${id}"]`);
  if (card) card.classList.add('selected');

  window._recompra._campData = window._recompra._campData || {};
  window._recompra._campData.segment_id = id;

  const preview = document.getElementById('segment-preview');
  if (preview) {
    preview.style.display = 'block';
    document.getElementById('seg-preview-nome').textContent = nome;
    document.getElementById('seg-preview-count').textContent = count;
  }
}

function onTemplateChange() {
  const sel = document.getElementById('camp-template');
  if (!sel?.value) return;
  const opt = sel.options[sel.selectedIndex];
  const vars = JSON.parse(opt.dataset.vars || '[]');

  const varBlock = document.getElementById('template-vars');
  const preview = document.getElementById('template-preview');
  if (varBlock && preview) {
    varBlock.style.display = 'block';
    preview.textContent = opt.text;
    window._recompra._campData = window._recompra._campData || {};
    window._recompra._campData.template_id = sel.value;
    window._recompra._campData.template_vars = vars;
  }
}

function onSendTypeChange() {
  const tipo = document.querySelector('input[name="send-type"]:checked')?.value;
  const schedInput = document.getElementById('schedule-input');
  if (schedInput) schedInput.style.display = tipo === 'scheduled' ? 'block' : 'none';
}

async function confirmarCampanha(ctx) {
  const { supaClient } = ctx;
  const nome = document.getElementById('camp-nome')?.value?.trim();
  const desc = document.getElementById('camp-desc')?.value?.trim();
  const data = window._recompra._campData || {};
  const sendType = document.querySelector('input[name="send-type"]:checked')?.value;
  const agendadoPara = sendType === 'scheduled'
    ? document.getElementById('camp-agendado')?.value
    : null;

  if (!nome) return alert('Informe o nome da campanha.');
  if (!data.segment_id) return alert('Selecione um segmento.');
  if (!data.template_id) return alert('Selecione um template.');
  if (!recompraState.account) return alert('Nenhuma conta WhatsApp conectada.');

  const btn = document.querySelector('.chiva-btn-success');
  if (btn) { btn.disabled = true; btn.textContent = 'Criando...'; }

  const { data: campaign, error } = await supaClient
    .from('campaign_whatsapp')
    .insert({
      nome,
      descricao: desc,
      segment_id: data.segment_id,
      account_id: recompraState.account.id,
      template_id: data.template_id,
      status: agendadoPara ? 'agendada' : 'rascunho',
      agendada_para: agendadoPara || null,
      janela_atribuicao_dias: 7,
    })
    .select()
    .single();

  if (error || !campaign) {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Criar Campanha'; }
    return alert('Erro ao criar campanha: ' + (error?.message || 'desconhecido'));
  }

  window._recompra.closeModal();

  // Se imediato, dispara
  if (!agendadoPara) {
    await dispararCampanha(ctx, campaign.id);
  }

  // Re-render lista
  await renderCampanhas(ctx);
}

// ─── DISPARO DE CAMPANHA ──────────────────────────────────────
export async function dispararCampanha(ctx, campaignId) {
  const { supaClient } = ctx;

  // Marca como enviando
  await supaClient
    .from('campaign_whatsapp')
    .update({ status: 'enviando', enviada_em: new Date().toISOString() })
    .eq('id', campaignId);

  // Carrega campanha + segmento
  const { data: campaign } = await supaClient
    .from('campaign_whatsapp')
    .select('*, customer_segments(*), whatsapp_templates(*), whatsapp_accounts(*)')
    .eq('id', campaignId)
    .single();

  if (!campaign) return;

  const clientes = await loadSegmentClientes(supaClient, campaign.customer_segments, 500);

  let enviados = 0;
  let erros = 0;

  for (const cliente of clientes) {
    const telefone = formatPhone(cliente.telefone);
    if (!telefone) { erros++; continue; }

    // Verifica opt-out
    if (await isOptOut(supaClient, telefone)) continue;

    // Resolve variáveis do template
    const vars = resolveTemplateVars(campaign.variaveis_mapa, cliente);

    // Cria recipient
    const { data: recipient } = await supaClient
      .from('campaign_recipients')
      .insert({
        campaign_id: campaignId,
        cliente_id: cliente.id,
        telefone,
        variaveis_resolvidas: vars,
        status: 'pendente',
      })
      .select()
      .single();

    // Envia via Z-API
    const result = await sendWhatsAppMessage({
      account: campaign.whatsapp_accounts,
      telefone,
      template: campaign.whatsapp_templates,
      variaveis: vars,
    });

    if (result.success) {
      enviados++;
      await supaClient
        .from('campaign_recipients')
        .update({ status: 'enviado', wamid: result.messageId, enviado_em: new Date().toISOString() })
        .eq('id', recipient.id);

      // Registra no inbox unificado
      await supaClient.from('whatsapp_messages').insert({
        account_id: campaign.account_id,
        cliente_id: cliente.id,
        campaign_id: campaignId,
        recipient_id: recipient.id,
        wamid: result.messageId,
        direcao: 'outbound',
        tipo: 'template',
        conteudo: { template: campaign.whatsapp_templates?.template_name, vars },
        status: 'sent',
        telefone,
      });

      // Registra na timeline de interações existente
      if (cliente.id) {
        await registrarInteraction(
          supaClient,
          cliente.id,
          `Mensagem WhatsApp enviada — Campanha: ${campaign.nome}`,
          { campaign_id: campaignId, template: campaign.whatsapp_templates?.template_name }
        );
      }
    } else {
      erros++;
      await supaClient
        .from('campaign_recipients')
        .update({ status: 'erro', erro_detalhe: result.error })
        .eq('id', recipient.id);
    }

    // Rate limiting: 1 msg/s para Z-API (evitar bloqueio)
    await new Promise(r => setTimeout(r, 1000));
  }

  // Finaliza campanha
  await supaClient
    .from('campaign_whatsapp')
    .update({
      status: erros > 0 && enviados === 0 ? 'erro' : 'concluida',
      concluida_em: new Date().toISOString(),
      total_destinatarios: clientes.length,
      total_enviados: enviados,
      total_erros: erros,
    })
    .eq('id', campaignId);
}

async function clonarCampanha(ctx, campaignId) {
  const { supaClient } = ctx;
  const { data: orig } = await supaClient
    .from('campaign_whatsapp')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (!orig) return;

  await supaClient.from('campaign_whatsapp').insert({
    nome: `${orig.nome} (cópia)`,
    descricao: orig.descricao,
    segment_id: orig.segment_id,
    account_id: orig.account_id,
    template_id: orig.template_id,
    variaveis_mapa: orig.variaveis_mapa,
    status: 'rascunho',
    janela_atribuicao_dias: orig.janela_atribuicao_dias,
  });

  await renderCampanhas(ctx);
}

// ─── Helpers ─────────────────────────────────────────────────
function kpiCard(label, value) {
  return `
    <div class="chiva-card">
      <div class="chiva-card-value">${value}</div>
      <div class="chiva-card-label">${label}</div>
    </div>
  `;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function escapeHtml(str) {
  return String(str).replace(/['"<>&]/g, c => ({ "'": '&#39;', '"': '&quot;', '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

function createDrawer() {
  const el = document.createElement('div');
  el.id = 'recompra-drawer';
  el.className = 'recompra-side-drawer';
  document.body.appendChild(el);
  return el;
}
