/**
 * MÓDULO: Central de Recompra & Automação WhatsApp
 * Arquivo de entrada — inicialização e roteamento interno
 *
 * Integra-se ao sistema existente via:
 *   - registerPageHandler() em controller.js
 *   - Leitura das tabelas/views existentes (v2_clientes, customer_intelligence, etc.)
 *   - Escrita nas novas tabelas (whatsapp_*, campaign_*, automation_*, attribution_*)
 *
 * NÃO modifica app.js, ia.js, producao.js ou qualquer módulo existente.
 */

import { renderCentralRecompra } from './recompraViews.js';
import { renderCampanhas, renderCampanhaDetalhe } from './campaigns.js';
import { renderAutomacoes } from './automations.js';
import { renderMensagens } from './messages.js';
import { renderConfigWhatsApp } from './configWhatsapp.js';
import { initSegments } from './segments.js';

// ─── Estado global do módulo ──────────────────────────────────
export const recompraState = {
  account: null,          // Conta WhatsApp ativa
  templates: [],          // Templates carregados
  segments: [],           // Segmentos disponíveis
  campaigns: [],          // Campanhas carregadas
  automations: [],        // Regras de automação
  lastRefresh: null,
};

// ─── Inicialização ───────────────────────────────────────────
export async function initRecompraModule(ctx) {
  const { supaClient } = ctx;

  // Carrega conta WhatsApp ativa
  const { data: accounts } = await supaClient
    .from('whatsapp_accounts')
    .select('*')
    .eq('status', 'active')
    .limit(1);

  if (accounts && accounts.length > 0) {
    recompraState.account = accounts[0];
  }

  // Carrega segmentos
  const { data: segments } = await supaClient
    .from('customer_segments')
    .select('*')
    .order('nome');

  recompraState.segments = segments || [];

  // Inicializa contagem de segmentos automáticos em background
  initSegments(ctx).catch(console.error);

  return recompraState;
}

// ─── Registro de handlers de página ─────────────────────────
// Chamado em main.js após inicialização do app
export function registerRecompraPages(ctx) {
  // Mapeia cada rota para sua função de render
  const pageHandlers = {
    'recompra':        () => renderCentralRecompra(ctx),
    'campanhas':       () => renderCampanhas(ctx),
    'automacoes':      () => renderAutomacoes(ctx),
    'mensagens':       () => renderMensagens(ctx),
    'config-whatsapp': () => renderConfigWhatsApp(ctx),
  };

  // Integra com o sistema de hash-routing existente
  Object.entries(pageHandlers).forEach(([page, handler]) => {
    document.addEventListener('recompra:navigate', (e) => {
      if (e.detail?.page === page) handler();
    });
  });

  // Intercepta showPage do controller existente
  patchShowPage(pageHandlers);
}

// ─── Patch não-invasivo em showPage ─────────────────────────
// Adiciona handler sem modificar controller.js
function patchShowPage(handlers) {
  const pages = Object.keys(handlers);

  // Observer no DOM para detectar quando uma página do módulo é ativada
  const observer = new MutationObserver(() => {
    pages.forEach(page => {
      const el = document.getElementById(`page-${page}`);
      if (el && el.classList.contains('active')) {
        const lastPage = el.dataset.lastRendered;
        const now = Date.now();
        // Re-render se passou mais de 30s ou nunca renderizou
        if (!lastPage || now - parseInt(lastPage) > 30000) {
          el.dataset.lastRendered = now;
          handlers[page]();
        }
      }
    });
  });

  observer.observe(document.getElementById('app') || document.body, {
    subtree: true,
    attributeFilter: ['class'],
  });
}

// ─── Utilitários compartilhados ──────────────────────────────

/**
 * Formata número de telefone para padrão E.164
 * Entrada: "31997763371", "(31) 99776-3371", "+5531997763371"
 * Saída: "5531997763371"
 */
export function formatPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  return digits;
}

/**
 * Resolve variáveis do template a partir dos dados do cliente
 * Mapa: { "1": "nome", "2": "ticket_medio" }
 * Retorna: { "1": "Maria", "2": "R$ 120,00" }
 */
export function resolveTemplateVars(variavelMapa, cliente) {
  const result = {};
  const formatCurrency = (v) =>
    v != null
      ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      : '';

  const fieldFormatters = {
    nome: (c) => c.nome?.split(' ')[0] || c.nome || 'Cliente',
    ticket_medio: (c) => formatCurrency(c.ticket_medio),
    total_gasto: (c) => formatCurrency(c.total_gasto || c.ltv),
    total_pedidos: (c) => String(c.total_pedidos || 0),
    ultimo_pedido: (c) =>
      c.ultimo_pedido
        ? new Date(c.ultimo_pedido).toLocaleDateString('pt-BR')
        : '',
    cidade: (c) => c.cidade || '',
    uf: (c) => c.uf || '',
  };

  Object.entries(variavelMapa || {}).forEach(([idx, field]) => {
    const formatter = fieldFormatters[field];
    result[idx] = formatter ? formatter(cliente) : (cliente[field] ?? '');
  });

  return result;
}

/**
 * Verifica se cliente está em opt-out
 */
export async function isOptOut(supaClient, telefone) {
  const phone = formatPhone(telefone);
  if (!phone) return false;
  const { data } = await supaClient
    .from('whatsapp_optouts')
    .select('id')
    .eq('telefone', phone)
    .maybeSingle();
  return !!data;
}

/**
 * Registra opt-out de cliente
 */
export async function registrarOptOut(supaClient, telefone, clienteId = null) {
  const phone = formatPhone(telefone);
  if (!phone) return;
  await supaClient.from('whatsapp_optouts').upsert(
    { telefone: phone, cliente_id: clienteId, motivo: 'solicitacao_cliente' },
    { onConflict: 'telefone' }
  );
}

/**
 * Registra mensagem no histórico de interações do cliente (tabela existente)
 */
export async function registrarInteraction(supaClient, clienteId, texto, meta = {}) {
  await supaClient.from('interactions').insert({
    customer_id: clienteId,
    type: 'whatsapp_enviado',
    description: texto,
    source: 'recompra_module',
    metadata: meta,
  });
}
