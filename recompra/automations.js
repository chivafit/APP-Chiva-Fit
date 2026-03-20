/**
 * MÓDULO: Automações WhatsApp
 * Gerencia regras de automação — criação, ativação e execução.
 *
 * Engine de execução: roda via cron na Edge Function automation-engine
 * ou pode ser disparada manualmente aqui para debug.
 */

import { recompraState, formatPhone, resolveTemplateVars, registrarInteraction, isOptOut } from './recompra.js';
import { sendWhatsAppMessage } from './zapApi.js';

// ─── Templates de automação prontos ──────────────────────────
const AUTOMATION_TEMPLATES = [
  {
    nome: 'Recompra D+15',
    descricao: 'Envia mensagem 15 dias após a última compra — momento ideal de recompra',
    trigger_tipo: 'dias_desde_compra',
    trigger_config: { dias: 15 },
    cooldown_dias: 30,
    icon: '🛒',
  },
  {
    nome: 'Reativação D+30',
    descricao: 'Clientes que não compraram em 30 dias — reativar sem desconto',
    trigger_tipo: 'dias_desde_compra',
    trigger_config: { dias: 30 },
    cooldown_dias: 14,
    icon: '🔄',
  },
  {
    nome: 'Carrinho Abandonado (1h)',
    descricao: 'Lembrete 1 hora após abandono de carrinho com link de finalização',
    trigger_tipo: 'carrinho_abandonado',
    trigger_config: { minutos: 60 },
    cooldown_dias: 3,
    icon: '🛍️',
  },
  {
    nome: 'Boas-vindas Pós-Compra',
    descricao: 'Mensagem de agradecimento após primeiro pedido',
    trigger_tipo: 'primeiro_pedido',
    trigger_config: { delay_horas: 2 },
    cooldown_dias: 999,
    icon: '🎉',
  },
  {
    nome: 'VIP em Risco',
    descricao: 'Alerta quando um cliente VIP ultrapassa o intervalo médio de compra em 50%',
    trigger_tipo: 'score_mudou',
    trigger_config: { next_best_action: 'tratamento_vip', dias_sem_compra_min: 20 },
    cooldown_dias: 14,
    icon: '⚠️',
  },
];

// ─── RENDER: Tela de automações ───────────────────────────────
export async function renderAutomacoes(ctx) {
  const { supaClient } = ctx;
  const container = document.getElementById('page-automacoes');
  if (!container) return;

  container.innerHTML = `<div class="recompra-loading">Carregando automações...</div>`;

  const { data: rules } = await supaClient
    .from('automation_rules')
    .select(`
      *,
      whatsapp_templates(template_name, preview_text),
      whatsapp_accounts(nome, status)
    `)
    .order('created_at', { ascending: false });

  // Métricas de cada regra
  const rulesWithMetrics = await Promise.all(
    (rules || []).map(async (rule) => {
      const { count: totalRuns } = await supaClient
        .from('automation_runs')
        .select('*', { count: 'exact', head: true })
        .eq('rule_id', rule.id)
        .eq('status', 'enviado');

      const { count: convertidos } = await supaClient
        .from('automation_runs')
        .select('*', { count: 'exact', head: true })
        .eq('rule_id', rule.id)
        .eq('convertido', true);

      return { ...rule, _total_enviados: totalRuns || 0, _convertidos: convertidos || 0 };
    })
  );

  const account = recompraState.account;

  container.innerHTML = `
    <div class="recompra-page">
      <div class="recompra-header">
        <div>
          <h1 class="recompra-title">Automações</h1>
          <p class="recompra-subtitle">Mensagens automáticas baseadas no comportamento do cliente</p>
        </div>
        ${account ? `<button class="chiva-btn chiva-btn-primary" onclick="window._recompra.openNovaAutomacao()">+ Nova Automação</button>` : ''}
      </div>

      ${!account ? `
        <div class="alert-warn">
          ⚠️ Configure uma conta WhatsApp em <strong>Configurações</strong> para ativar automações.
        </div>
      ` : ''}

      ${rulesWithMetrics.length > 0 ? renderRuleCards(rulesWithMetrics) : renderSugestoesAutomacoes(ctx)}
    </div>

    ${renderNovaAutomacaoModal(ctx)}
  `;

  window._recompra = window._recompra || {};
  window._recompra.openNovaAutomacao = () => openNovaAutomacaoModal(ctx);
  window._recompra.toggleAutomacao = (id, ativo) => toggleAutomacao(ctx, id, ativo);
  window._recompra.deleteAutomacao = (id) => deleteAutomacao(ctx, id);
  window._recompra.criarDeTemplate = (idx) => criarDeTemplate(ctx, AUTOMATION_TEMPLATES[idx]);
  window._recompra.closeAutoModal = () => {
    const m = document.getElementById('modal-nova-automacao');
    if (m) m.style.display = 'none';
  };
  window._recompra.salvarAutomacao = () => salvarAutomacao(ctx);
}

function renderRuleCards(rules) {
  return `
    <div class="automation-grid">
      ${rules.map(rule => {
        const taxa = rule._total_enviados > 0
          ? Math.round((rule._convertidos / rule._total_enviados) * 100)
          : 0;

        return `
          <div class="automation-card ${rule.ativo ? 'ativo' : 'inativo'}">
            <div class="automation-card-header">
              <div class="automation-toggle">
                <label class="toggle-switch">
                  <input type="checkbox" ${rule.ativo ? 'checked' : ''}
                    onchange="window._recompra.toggleAutomacao('${rule.id}', this.checked)">
                  <span class="toggle-slider"></span>
                </label>
                <span class="toggle-label">${rule.ativo ? 'Ativa' : 'Inativa'}</span>
              </div>
              <button class="icon-btn danger" onclick="window._recompra.deleteAutomacao('${rule.id}')" title="Excluir">🗑️</button>
            </div>

            <h3 class="automation-nome">${rule.nome}</h3>
            <p class="automation-desc">${rule.descricao || ''}</p>

            <div class="automation-meta">
              <span class="meta-item">⚡ ${formatTrigger(rule.trigger_tipo, rule.trigger_config)}</span>
              <span class="meta-item">📋 ${rule.whatsapp_templates?.template_name || 'Template não definido'}</span>
              <span class="meta-item">⏱️ Cooldown: ${rule.cooldown_dias}d</span>
            </div>

            <div class="automation-stats">
              <div class="stat"><span>${rule._total_enviados}</span><label>Enviados</label></div>
              <div class="stat"><span>${rule._convertidos}</span><label>Convertidos</label></div>
              <div class="stat"><span>${taxa}%</span><label>Taxa Conv.</label></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="section-divider">
      <span>Sugestões de automações</span>
    </div>
    ${renderSugestoesCards()}
  `;
}

function renderSugestoesAutomacoes(ctx) {
  return `
    <div class="recompra-empty">
      <div class="recompra-empty-icon">⚡</div>
      <h3>Nenhuma automação configurada</h3>
      <p>Comece com uma das sugestões abaixo — criadas especificamente para aumentar recompra.</p>
    </div>
    ${renderSugestoesCards()}
  `;
}

function renderSugestoesCards() {
  return `
    <div class="suggestions-grid">
      ${AUTOMATION_TEMPLATES.map((t, i) => `
        <div class="suggestion-card">
          <div class="suggestion-icon">${t.icon}</div>
          <h4>${t.nome}</h4>
          <p>${t.descricao}</p>
          <div class="suggestion-meta">
            <span>Cooldown: ${t.cooldown_dias}d</span>
          </div>
          <button class="chiva-btn chiva-btn-outline" onclick="window._recompra.criarDeTemplate(${i})">
            Criar esta automação
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderNovaAutomacaoModal(ctx) {
  const templates = recompraState.templates || [];
  const account = recompraState.account;

  return `
    <div id="modal-nova-automacao" class="recompra-modal" style="display:none">
      <div class="recompra-modal-overlay" onclick="window._recompra.closeAutoModal()"></div>
      <div class="recompra-modal-content">
        <div class="modal-header">
          <h2 id="auto-modal-title">Nova Automação</h2>
          <button onclick="window._recompra.closeAutoModal()">✕</button>
        </div>

        <div class="modal-body">
          <label>Nome *</label>
          <input type="text" id="auto-nome" class="chiva-input" placeholder="Ex: Recompra D+15">

          <label>Descrição</label>
          <textarea id="auto-desc" class="chiva-input" rows="2"></textarea>

          <label>Trigger *</label>
          <select id="auto-trigger" class="chiva-input" onchange="window._recompra.onTriggerChange && window._recompra.onTriggerChange()">
            <option value="dias_desde_compra">N dias após última compra</option>
            <option value="carrinho_abandonado">Carrinho abandonado</option>
            <option value="primeiro_pedido">Primeiro pedido realizado</option>
            <option value="score_mudou">Score de recompra mudou</option>
          </select>

          <div id="trigger-config" class="trigger-config">
            <label>Dias após compra</label>
            <input type="number" id="trigger-dias" class="chiva-input" value="15" min="1" max="365">
          </div>

          ${templates.length > 0 ? `
            <label>Template WhatsApp *</label>
            <select id="auto-template" class="chiva-input">
              <option value="">Selecione...</option>
              ${templates.map(t => `<option value="${t.id}">${t.template_name}</option>`).join('')}
            </select>
          ` : `<div class="alert-warn">Adicione templates em Configurações antes de criar automações.</div>`}

          <div class="form-row">
            <div>
              <label>Horário início</label>
              <input type="time" id="auto-hora-ini" class="chiva-input" value="08:00">
            </div>
            <div>
              <label>Horário fim</label>
              <input type="time" id="auto-hora-fim" class="chiva-input" value="20:00">
            </div>
          </div>

          <label>Cooldown (dias entre acionamentos do mesmo cliente)</label>
          <input type="number" id="auto-cooldown" class="chiva-input" value="7" min="1">
        </div>

        <div class="modal-footer">
          <button class="chiva-btn" onclick="window._recompra.closeAutoModal()">Cancelar</button>
          <button class="chiva-btn chiva-btn-primary" onclick="window._recompra.salvarAutomacao()">Salvar Automação</button>
        </div>
      </div>
    </div>
  `;
}

function openNovaAutomacaoModal(ctx) {
  const modal = document.getElementById('modal-nova-automacao');
  if (modal) modal.style.display = 'flex';
}

function criarDeTemplate(ctx, tpl) {
  openNovaAutomacaoModal(ctx);

  setTimeout(() => {
    const nome = document.getElementById('auto-nome');
    const desc = document.getElementById('auto-desc');
    const trigger = document.getElementById('auto-trigger');
    const dias = document.getElementById('trigger-dias');
    const cooldown = document.getElementById('auto-cooldown');
    const title = document.getElementById('auto-modal-title');

    if (nome) nome.value = tpl.nome;
    if (desc) desc.value = tpl.descricao;
    if (trigger) trigger.value = tpl.trigger_tipo;
    if (dias && tpl.trigger_config?.dias) dias.value = tpl.trigger_config.dias;
    if (cooldown) cooldown.value = tpl.cooldown_dias;
    if (title) title.textContent = `Criar: ${tpl.nome}`;
  }, 50);
}

async function salvarAutomacao(ctx) {
  const { supaClient } = ctx;
  const account = recompraState.account;

  const nome = document.getElementById('auto-nome')?.value?.trim();
  const desc = document.getElementById('auto-desc')?.value?.trim();
  const triggerTipo = document.getElementById('auto-trigger')?.value;
  const dias = parseInt(document.getElementById('trigger-dias')?.value || '15');
  const templateId = document.getElementById('auto-template')?.value;
  const horaIni = document.getElementById('auto-hora-ini')?.value || '08:00';
  const horaFim = document.getElementById('auto-hora-fim')?.value || '20:00';
  const cooldown = parseInt(document.getElementById('auto-cooldown')?.value || '7');

  if (!nome) return alert('Informe o nome da automação.');
  if (!account) return alert('Nenhuma conta WhatsApp conectada.');
  if (!templateId) return alert('Selecione um template WhatsApp.');

  const triggerConfig = triggerTipo === 'dias_desde_compra' ? { dias } :
    triggerTipo === 'carrinho_abandonado' ? { minutos: 60 } : {};

  const { error } = await supaClient.from('automation_rules').insert({
    nome,
    descricao: desc,
    ativo: false,
    trigger_tipo: triggerTipo,
    trigger_config: triggerConfig,
    condicoes: {},
    account_id: account.id,
    template_id: templateId,
    variaveis_mapa: {},
    janela_horario_inicio: horaIni,
    janela_horario_fim: horaFim,
    cooldown_dias: cooldown,
    max_envios_dia: 500,
  });

  if (error) return alert('Erro ao salvar: ' + error.message);

  window._recompra.closeAutoModal();
  await renderAutomacoes(ctx);
}

async function toggleAutomacao(ctx, ruleId, ativo) {
  const { supaClient } = ctx;
  await supaClient
    .from('automation_rules')
    .update({ ativo })
    .eq('id', ruleId);
}

async function deleteAutomacao(ctx, ruleId) {
  if (!confirm('Excluir esta automação? Esta ação não pode ser desfeita.')) return;
  const { supaClient } = ctx;
  await supaClient.from('automation_rules').delete().eq('id', ruleId);
  await renderAutomacoes(ctx);
}

function formatTrigger(tipo, config = {}) {
  const map = {
    dias_desde_compra: `${config.dias || '?'}d após compra`,
    carrinho_abandonado: `Carrinho ${config.minutos || 60}min`,
    primeiro_pedido: 'Primeiro pedido',
    score_mudou: 'Score mudou',
    aniversario_cliente: 'Aniversário',
  };
  return map[tipo] || tipo;
}
