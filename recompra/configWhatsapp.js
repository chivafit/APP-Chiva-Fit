/**
 * MÓDULO: Configurações WhatsApp
 * Conectar conta Z-API, gerenciar templates, parâmetros do módulo.
 */

import { recompraState } from './recompra.js';
import { checkZapiStatus, getQrCode } from './zapApi.js';

// ─── RENDER: Tela de configurações ───────────────────────────
export async function renderConfigWhatsApp(ctx) {
  const { supaClient } = ctx;
  const container = document.getElementById('page-config-whatsapp');
  if (!container) return;

  container.innerHTML = `<div class="recompra-loading">Carregando configurações...</div>`;

  const [{ data: accounts }, { data: templates }] = await Promise.all([
    supaClient.from('whatsapp_accounts').select('*').order('created_at'),
    supaClient.from('whatsapp_templates').select('*').order('template_name'),
  ]);

  recompraState.templates = templates || [];

  container.innerHTML = `
    <div class="recompra-page">
      <div class="recompra-header">
        <h1 class="recompra-title">Configurações WhatsApp</h1>
      </div>

      <!-- Abas -->
      <div class="config-tabs">
        <button class="config-tab active" onclick="window._recompra.showConfigTab('conta', this)">Conta</button>
        <button class="config-tab" onclick="window._recompra.showConfigTab('templates', this)">Templates</button>
        <button class="config-tab" onclick="window._recompra.showConfigTab('parametros', this)">Parâmetros</button>
      </div>

      <!-- Aba Conta -->
      <div id="config-tab-conta" class="config-tab-content">
        ${renderContaTab(accounts, ctx)}
      </div>

      <!-- Aba Templates -->
      <div id="config-tab-templates" class="config-tab-content" style="display:none">
        ${renderTemplatesTab(templates, accounts)}
      </div>

      <!-- Aba Parâmetros -->
      <div id="config-tab-parametros" class="config-tab-content" style="display:none">
        ${renderParametrosTab()}
      </div>
    </div>
  `;

  window._recompra = window._recompra || {};
  window._recompra.showConfigTab = showConfigTab;
  window._recompra.salvarConta = () => salvarConta(ctx);
  window._recompra.testarConexao = (id) => testarConexao(ctx, id);
  window._recompra.deletarConta = (id) => deletarConta(ctx, id);
  window._recompra.salvarTemplate = () => salvarTemplate(ctx);
  window._recompra.deletarTemplate = (id) => deletarTemplate(ctx, id);
  window._recompra.abrirFormTemplate = () => abrirFormTemplate();
  window._recompra.closeTemplateForm = () => {
    const f = document.getElementById('template-form');
    if (f) f.style.display = 'none';
  };
}

function renderContaTab(accounts, ctx) {
  const account = accounts?.[0]; // Primeira conta (por ora, 1 conta)

  return `
    <div class="config-section">
      <h3>Conexão Z-API</h3>
      <p class="config-hint">
        Acesse <strong>z-api.io</strong>, crie uma instância, escaneie o QR Code com o WhatsApp
        do número <strong>5531997763371</strong> e cole as credenciais abaixo.
      </p>

      ${account ? `
        <div class="account-card">
          <div class="account-header">
            <div>
              <div class="account-nome">${account.nome}</div>
              <div class="account-status status-${account.status}">${statusLabel(account.status)}</div>
            </div>
            <div class="account-actions">
              <button class="chiva-btn chiva-btn-sm" onclick="window._recompra.testarConexao('${account.id}')">Testar conexão</button>
              <button class="chiva-btn chiva-btn-sm danger" onclick="window._recompra.deletarConta('${account.id}')">Remover</button>
            </div>
          </div>
          <div class="account-credentials">
            <span>Instance: <code>${account.zapi_instance_id || '—'}</code></span>
            <span>Token: <code>••••••••</code></span>
          </div>
          <div id="conn-result-${account.id}" class="conn-result"></div>
        </div>
      ` : ''}

      <div class="config-form" id="form-nova-conta">
        <h4>${account ? 'Atualizar credenciais' : 'Conectar nova conta'}</h4>

        <label>Nome da conta *</label>
        <input type="text" id="acc-nome" class="chiva-input"
          value="${account?.nome || 'Loja Principal'}" placeholder="Ex: Loja Principal">

        <label>Instance ID *</label>
        <input type="text" id="acc-instance" class="chiva-input"
          value="${account?.zapi_instance_id || ''}" placeholder="Ex: 3DAEF42AB04...">

        <label>Token *</label>
        <input type="text" id="acc-token" class="chiva-input"
          value="${account?.zapi_token || ''}" placeholder="Token da instância Z-API">

        <label>Client Token *</label>
        <input type="text" id="acc-client-token" class="chiva-input"
          value="${account?.zapi_client_token || ''}" placeholder="Client-Token do painel Z-API">

        <input type="hidden" id="acc-id" value="${account?.id || ''}">

        <div class="form-actions">
          <button class="chiva-btn chiva-btn-primary" onclick="window._recompra.salvarConta()">
            ${account ? 'Atualizar conta' : 'Salvar e conectar'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderTemplatesTab(templates, accounts) {
  return `
    <div class="config-section">
      <div class="section-header-row">
        <h3>Templates de Mensagem</h3>
        <button class="chiva-btn chiva-btn-primary" onclick="window._recompra.abrirFormTemplate()">+ Adicionar Template</button>
      </div>

      <p class="config-hint">
        Para usar com Z-API, adicione seus templates manualmente com o texto da mensagem.
        Para Meta Cloud API, os templates precisam ser aprovados pelo WhatsApp.
      </p>

      <!-- Formulário de novo template (oculto) -->
      <div id="template-form" class="config-form" style="display:none">
        <h4>Novo Template</h4>

        <label>Nome do template *</label>
        <input type="text" id="tpl-nome" class="chiva-input" placeholder="Ex: recompra_15_dias">

        <label>Categoria</label>
        <select id="tpl-categoria" class="chiva-input">
          <option value="MARKETING">Marketing</option>
          <option value="UTILITY">Utilitário</option>
        </select>

        <label>Texto da mensagem *</label>
        <textarea id="tpl-texto" class="chiva-input" rows="5"
          placeholder="Olá {{1}}! Sentimos sua falta. Que tal aproveitar e renovar seu estoque? Seu ticket médio é {{2}}."></textarea>

        <p class="config-hint">Use {{1}}, {{2}}, etc. para variáveis. As variáveis são mapeadas por campo do cliente ao criar a campanha.</p>

        <label>Variáveis (uma por linha — ex: nome, ticket_medio, total_pedidos)</label>
        <textarea id="tpl-vars" class="chiva-input" rows="3" placeholder="nome&#10;ticket_medio"></textarea>

        ${accounts?.length ? `
          <label>Conta WhatsApp *</label>
          <select id="tpl-account" class="chiva-input">
            ${accounts.map(a => `<option value="${a.id}">${a.nome}</option>`).join('')}
          </select>
        ` : `<div class="alert-warn">Conecte uma conta WhatsApp primeiro.</div>`}

        <div class="form-actions">
          <button class="chiva-btn" onclick="window._recompra.closeTemplateForm()">Cancelar</button>
          <button class="chiva-btn chiva-btn-primary" onclick="window._recompra.salvarTemplate()">Salvar Template</button>
        </div>
      </div>

      <!-- Lista de templates -->
      ${templates.length === 0 ? `
        <div class="recompra-empty">
          <p>Nenhum template cadastrado. Adicione o primeiro template acima.</p>
        </div>
      ` : `
        <div class="templates-list">
          ${templates.map(t => `
            <div class="template-card">
              <div class="template-card-header">
                <div>
                  <div class="template-nome">${t.template_name}</div>
                  <div class="template-cat">${t.category} · ${t.language}</div>
                </div>
                <button class="icon-btn danger" onclick="window._recompra.deletarTemplate('${t.id}')">🗑️</button>
              </div>
              <div class="template-preview-text">${t.preview_text || '—'}</div>
              ${t.variaveis?.length ? `
                <div class="template-vars-list">
                  Variáveis: ${(t.variaveis || []).map(v => `<code>${v}</code>`).join(', ')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

function renderParametrosTab() {
  return `
    <div class="config-section">
      <h3>Parâmetros do Módulo</h3>

      <div class="config-param-grid">
        <div class="config-param">
          <label>Janela de atribuição de conversão (dias)</label>
          <input type="number" class="chiva-input" value="7" id="param-atrib-dias" min="1" max="30">
          <span class="param-hint">Tempo máximo após envio de mensagem para atribuir um pedido à campanha</span>
        </div>

        <div class="config-param">
          <label>Horário padrão de envio — início</label>
          <input type="time" class="chiva-input" value="08:00" id="param-hora-ini">
        </div>

        <div class="config-param">
          <label>Horário padrão de envio — fim</label>
          <input type="time" class="chiva-input" value="20:00" id="param-hora-fim">
        </div>

        <div class="config-param">
          <label>Cooldown padrão entre mensagens (dias)</label>
          <input type="number" class="chiva-input" value="7" id="param-cooldown" min="1" max="60">
          <span class="param-hint">Mínimo de dias entre mensagens para o mesmo cliente</span>
        </div>

        <div class="config-param">
          <label>Palavras-chave de opt-out (separadas por vírgula)</label>
          <input type="text" class="chiva-input" value="STOP,SAIR,PARAR,CANCELAR" id="param-optout-words">
          <span class="param-hint">Quando o cliente responder com estas palavras, será removido automaticamente</span>
        </div>
      </div>

      <div class="form-actions">
        <button class="chiva-btn chiva-btn-primary" onclick="window._recompra.salvarParametros && window._recompra.salvarParametros()">
          Salvar parâmetros
        </button>
      </div>
    </div>
  `;
}

// ─── Ações das abas ───────────────────────────────────────────
function showConfigTab(tab, btn) {
  document.querySelectorAll('.config-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  ['conta', 'templates', 'parametros'].forEach(t => {
    const el = document.getElementById(`config-tab-${t}`);
    if (el) el.style.display = t === tab ? 'block' : 'none';
  });
}

function abrirFormTemplate() {
  const f = document.getElementById('template-form');
  if (f) { f.style.display = 'block'; f.scrollIntoView({ behavior: 'smooth' }); }
}

async function salvarConta(ctx) {
  const { supaClient } = ctx;
  const nome = document.getElementById('acc-nome')?.value?.trim();
  const instance = document.getElementById('acc-instance')?.value?.trim();
  const token = document.getElementById('acc-token')?.value?.trim();
  const clientToken = document.getElementById('acc-client-token')?.value?.trim();
  const existingId = document.getElementById('acc-id')?.value;

  if (!nome || !instance || !token || !clientToken) {
    return alert('Preencha todos os campos obrigatórios.');
  }

  const payload = {
    nome,
    zapi_instance_id: instance,
    zapi_token: token,
    zapi_client_token: clientToken,
    provider: 'zapi',
    status: 'active',
  };

  let error;
  if (existingId) {
    ({ error } = await supaClient.from('whatsapp_accounts').update(payload).eq('id', existingId));
  } else {
    ({ error } = await supaClient.from('whatsapp_accounts').insert(payload));
  }

  if (error) return alert('Erro ao salvar: ' + error.message);

  alert('Conta salva com sucesso!');
  await renderConfigWhatsApp(ctx);
}

async function testarConexao(ctx, accountId) {
  const { supaClient } = ctx;
  const resultEl = document.getElementById(`conn-result-${accountId}`);
  if (resultEl) resultEl.innerHTML = '<span class="conn-testing">Testando conexão...</span>';

  const { data: acc } = await supaClient
    .from('whatsapp_accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (!acc) return;

  const status = await checkZapiStatus(acc);

  if (resultEl) {
    resultEl.innerHTML = status.connected
      ? `<span class="conn-ok">✓ Conectado — Status: ${status.status}</span>`
      : `<span class="conn-fail">✗ Desconectado — ${status.error || status.status}</span>`;
  }

  // Atualiza status no banco
  await supaClient
    .from('whatsapp_accounts')
    .update({ status: status.connected ? 'active' : 'inactive' })
    .eq('id', accountId);
}

async function deletarConta(ctx, accountId) {
  if (!confirm('Remover conta WhatsApp? As campanhas existentes serão mantidas.')) return;
  await ctx.supaClient.from('whatsapp_accounts').delete().eq('id', accountId);
  await renderConfigWhatsApp(ctx);
}

async function salvarTemplate(ctx) {
  const { supaClient } = ctx;
  const nome = document.getElementById('tpl-nome')?.value?.trim();
  const categoria = document.getElementById('tpl-categoria')?.value;
  const texto = document.getElementById('tpl-texto')?.value?.trim();
  const varsRaw = document.getElementById('tpl-vars')?.value?.trim();
  const accountId = document.getElementById('tpl-account')?.value;

  if (!nome || !texto || !accountId) return alert('Preencha nome, texto e conta.');

  const variaveis = varsRaw
    ? varsRaw.split('\n').map(v => v.trim()).filter(Boolean)
    : [];

  const { error } = await supaClient.from('whatsapp_templates').insert({
    account_id: accountId,
    template_name: nome,
    category: categoria,
    language: 'pt_BR',
    status: 'APPROVED',
    preview_text: texto,
    componentes: [{ type: 'BODY', text: texto }],
    variaveis: variaveis,
  });

  if (error) return alert('Erro ao salvar template: ' + error.message);

  window._recompra.closeTemplateForm();
  await renderConfigWhatsApp(ctx);
}

async function deletarTemplate(ctx, templateId) {
  if (!confirm('Excluir este template?')) return;
  await ctx.supaClient.from('whatsapp_templates').delete().eq('id', templateId);
  await renderConfigWhatsApp(ctx);
}

function statusLabel(s) {
  return { active: '✓ Ativa', inactive: '✗ Inativa', pending_review: '⏳ Em revisão', banned: '🚫 Banida' }[s] || s;
}
