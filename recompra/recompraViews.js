/**
 * MÓDULO: Central de Recompra — Tela principal
 * Funil de recompra + ações urgentes + segmentos + últimas campanhas
 */

import { recompraState, initRecompraModule } from './recompra.js';

// ─── RENDER: Central de Recompra ─────────────────────────────
export async function renderCentralRecompra(ctx) {
  const { supaClient } = ctx;
  const container = document.getElementById('page-recompra');
  if (!container) return;

  container.innerHTML = `<div class="recompra-loading">Carregando Central de Recompra...</div>`;

  // Inicializa módulo se necessário
  if (!recompraState.lastRefresh) {
    await initRecompraModule(ctx);
    recompraState.lastRefresh = Date.now();
  }

  // Carrega dados em paralelo
  const [
    funil,
    acoes,
    segments,
    campaigns,
    kpis,
  ] = await Promise.all([
    loadFunil(supaClient),
    loadAcoesUrgentes(supaClient),
    loadSegments(supaClient),
    loadUltimasCampanhas(supaClient),
    loadKpis(supaClient),
  ]);

  container.innerHTML = `
    <div class="recompra-page">
      <div class="recompra-header">
        <div>
          <h1 class="recompra-title">Central de Recompra</h1>
          <p class="recompra-subtitle">Pipeline de reconquista de clientes</p>
        </div>
        <button class="chiva-btn chiva-btn-primary"
          onclick="document.querySelector('[data-page=campanhas]')?.click()">
          + Nova Campanha
        </button>
      </div>

      <!-- KPIs principais -->
      <div class="recompra-kpis">
        ${kpiCard('Prontos para recompra', kpis.prontos, '🎯', 'green')}
        ${kpiCard('VIP em risco hoje', kpis.vipRisco, '⚠️', 'amber')}
        ${kpiCard('Receita 7 dias (atrib.)', kpis.receita7d, '💰', 'green')}
        ${kpiCard('Conversão de campanhas', kpis.taxaConversao, '📈', 'blue')}
        ${kpiCard('Mensagens enviadas (30d)', kpis.mensagens30d, '📤', 'gray')}
      </div>

      <!-- Grid principal -->
      <div class="recompra-main-grid">

        <!-- Funil de recompra -->
        <div class="recompra-card">
          <div class="card-header">
            <h2>Funil de Recompra</h2>
          </div>
          ${renderFunil(funil)}
        </div>

        <!-- Ações urgentes -->
        <div class="recompra-card">
          <div class="card-header">
            <h2>Ações Urgentes Hoje</h2>
            <span class="card-badge">${acoes.length} clientes</span>
          </div>
          ${renderAcoesUrgentes(acoes)}
        </div>

      </div>

      <!-- Segmentos automáticos -->
      <div class="recompra-card full-width">
        <div class="card-header">
          <h2>Segmentos de Clientes</h2>
          <a href="#campanhas" class="card-link" onclick="document.querySelector('[data-page=campanhas]')?.click()">
            Ver todas as campanhas →
          </a>
        </div>
        <div class="segments-grid">
          ${renderSegmentCards(segments)}
        </div>
      </div>

      <!-- Últimas campanhas -->
      <div class="recompra-card full-width">
        <div class="card-header">
          <h2>Últimas Campanhas</h2>
          <a class="card-link" onclick="document.querySelector('[data-page=campanhas]')?.click()">
            Ver todas →
          </a>
        </div>
        ${renderCampanhasResumidas(campaigns)}
      </div>
    </div>
  `;

  // Handler de envio individual da linha de ações
  window._recompra = window._recompra || {};
  window._recompra.enviarAcaoIndividual = (clienteId) => enviarAcaoIndividual(ctx, clienteId);
  window._recompra.abrirSegmento = (segId) => abrirSegmento(segId);
}

// ─── KPIs ─────────────────────────────────────────────────────
async function loadKpis(supaClient) {
  const [
    { count: prontos },
    { count: vipRisco },
    { data: receitaData },
    { data: mensagensData },
    { data: taxaData },
  ] = await Promise.all([
    supaClient
      .from('vw_clientes_inteligencia')
      .select('*', { count: 'exact', head: true })
      .in('next_best_action', ['sugerir_recompra', 'oferta_kit', 'tratamento_vip']),

    supaClient
      .from('vw_clientes_vip_risco')
      .select('*', { count: 'exact', head: true }),

    supaClient
      .from('campaign_whatsapp')
      .select('receita_atribuida')
      .gte('concluida_em', new Date(Date.now() - 7 * 86400000).toISOString()),

    supaClient
      .from('whatsapp_messages')
      .select('*', { count: 'exact', head: true })
      .eq('direcao', 'outbound')
      .gte('enviado_em', new Date(Date.now() - 30 * 86400000).toISOString()),

    supaClient
      .from('campaign_whatsapp')
      .select('total_enviados, total_convertidos')
      .eq('status', 'concluida'),
  ]);

  const receita7d = (receitaData || []).reduce((s, c) => s + (c.receita_atribuida || 0), 0);
  const totalEnv = (taxaData || []).reduce((s, c) => s + (c.total_enviados || 0), 0);
  const totalConv = (taxaData || []).reduce((s, c) => s + (c.total_convertidos || 0), 0);
  const taxa = totalEnv > 0 ? ((totalConv / totalEnv) * 100).toFixed(1) + '%' : '—';

  return {
    prontos: prontos || 0,
    vipRisco: vipRisco || 0,
    receita7d: receita7d > 0
      ? `R$ ${receita7d.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`
      : 'R$ 0',
    taxaConversao: taxa,
    mensagens30d: mensagensData || 0,
  };
}

async function loadFunil(supaClient) {
  const { data } = await supaClient.from('vw_funil_recompra').select('*');
  return data || [];
}

async function loadAcoesUrgentes(supaClient) {
  const { data } = await supaClient
    .from('vw_clientes_inteligencia')
    .select('id, nome, telefone, score_final, next_best_action, dias_desde_ultima_compra, ticket_medio')
    .not('next_best_action', 'eq', 'nao_acionar')
    .order('score_final', { ascending: false })
    .limit(10);
  return data || [];
}

async function loadSegments(supaClient) {
  const { data } = await supaClient
    .from('customer_segments')
    .select('*')
    .order('customer_count', { ascending: false });
  return data || [];
}

async function loadUltimasCampanhas(supaClient) {
  const { data } = await supaClient
    .from('vw_campaign_metrics')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
  return data || [];
}

// ─── Render helpers ───────────────────────────────────────────
function kpiCard(label, value, icon, color) {
  return `
    <div class="recompra-kpi-card color-${color}">
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-label">${label}</div>
    </div>
  `;
}

function renderFunil(funil) {
  if (!funil || funil.length === 0) {
    return `<div class="empty-mini">Dados do funil indisponíveis</div>`;
  }

  return `
    <div class="funil-bars">
      ${funil.map((stage, i) => {
        const max = funil[0]?.total || 1;
        const pct = Math.round(((stage.total || 0) / max) * 100);
        return `
          <div class="funil-stage">
            <div class="funil-label">${stage.estagio || stage.stage || `Estágio ${i + 1}`}</div>
            <div class="funil-bar-wrap">
              <div class="funil-bar" style="width:${pct}%"></div>
            </div>
            <div class="funil-value">${(stage.total || 0).toLocaleString('pt-BR')}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderAcoesUrgentes(acoes) {
  if (!acoes || acoes.length === 0) {
    return `<div class="empty-mini">Nenhuma ação urgente hoje</div>`;
  }

  const actionLabels = {
    tratamento_vip: '👑 VIP',
    oferta_kit: '🎁 Kit',
    oferecer_assinatura: '🔄 Assinar',
    sugerir_recompra: '🛒 Recompra',
    reativar_sem_desconto: '🔁 Reativar',
    reativacao_com_cupom: '🏷️ Cupom',
    nutrir_cliente: '🌱 Nutrir',
  };

  return `
    <div class="acoes-list">
      ${acoes.map(a => `
        <div class="acao-row">
          <div class="acao-cliente">
            <div class="acao-nome">${a.nome?.split(' ').slice(0, 2).join(' ') || '—'}</div>
            <div class="acao-meta">${a.dias_desde_ultima_compra || 0}d sem comprar · Score ${a.score_final || 0}</div>
          </div>
          <div class="acao-tipo">
            <span class="acao-badge">${actionLabels[a.next_best_action] || a.next_best_action}</span>
          </div>
          <button class="chiva-btn chiva-btn-sm chiva-btn-outline"
            onclick="window._recompra.enviarAcaoIndividual('${a.id}')">
            Enviar
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSegmentCards(segments) {
  if (!segments || segments.length === 0) {
    return `<div class="empty-mini">Nenhum segmento disponível</div>`;
  }

  const segIcons = {
    'VIP em Risco': '👑',
    'Recompra Provável': '🛒',
    'Reativação sem Cupom': '🔁',
    'Reativação com Cupom': '🏷️',
    'Carrinhos Abandonados': '🛍️',
    'Assinatura Potencial': '🔄',
  };

  return segments.map(s => `
    <div class="segment-mini-card" onclick="window._recompra.abrirSegmento('${s.id}')">
      <div class="seg-mini-icon">${segIcons[s.nome] || '👥'}</div>
      <div class="seg-mini-count">${(s.customer_count || 0).toLocaleString('pt-BR')}</div>
      <div class="seg-mini-nome">${s.nome}</div>
      <button class="chiva-btn chiva-btn-sm chiva-btn-outline seg-btn"
        onclick="event.stopPropagation(); criarCampanhaComSegmento('${s.id}')">
        Criar campanha
      </button>
    </div>
  `).join('');
}

function renderCampanhasResumidas(campaigns) {
  if (!campaigns || campaigns.length === 0) {
    return `
      <div class="recompra-empty">
        <p>Nenhuma campanha ainda. <a onclick="document.querySelector('[data-page=campanhas]')?.click()" style="cursor:pointer;color:var(--green)">Criar primeira campanha →</a></p>
      </div>
    `;
  }

  const statusBadge = {
    rascunho:  { l: 'Rascunho',  c: 'badge-gray'   },
    agendada:  { l: 'Agendada',  c: 'badge-blue'   },
    enviando:  { l: 'Enviando',  c: 'badge-yellow' },
    concluida: { l: 'Concluída', c: 'badge-green'  },
    pausada:   { l: 'Pausada',   c: 'badge-orange' },
    erro:      { l: 'Erro',      c: 'badge-red'    },
  };

  return `
    <table class="chiva-table">
      <thead>
        <tr>
          <th>Campanha</th>
          <th>Status</th>
          <th class="text-right">Enviados</th>
          <th class="text-right">Conv.</th>
          <th class="text-right">Receita</th>
        </tr>
      </thead>
      <tbody>
        ${campaigns.map(c => {
          const b = statusBadge[c.status] || { l: c.status, c: 'badge-gray' };
          return `
            <tr>
              <td>
                <div>${c.nome}</div>
                <div class="table-sub">${c.segmento_nome || '—'}</div>
              </td>
              <td><span class="chiva-badge ${b.c}">${b.l}</span></td>
              <td class="text-right">${c.total_enviados || 0}</td>
              <td class="text-right">${c.total_convertidos || 0} ${c.taxa_conversao > 0 ? `<span class="rate">(${c.taxa_conversao}%)</span>` : ''}</td>
              <td class="text-right">${c.receita_atribuida > 0 ? `R$ ${Number(c.receita_atribuida).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}` : '—'}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ─── Ações inline ─────────────────────────────────────────────
async function enviarAcaoIndividual(ctx, clienteId) {
  // Abre o WA modal existente do app.js se disponível
  if (typeof window.openWaModal === 'function') {
    window.openWaModal(clienteId);
  } else {
    alert('Abra o perfil do cliente para enviar mensagem individual.');
  }
}

function abrirSegmento(segId) {
  // Navega para campanhas com segmento pré-selecionado
  document.querySelector('[data-page="campanhas"]')?.click();
  setTimeout(() => {
    if (window._recompra?.openNovaCampanha) {
      window._recompra.openNovaCampanha();
      setTimeout(() => {
        window._recompra.goStep?.(2);
        window._recompra.selectSegment?.(segId, '', 0);
      }, 100);
    }
  }, 200);
}

function criarCampanhaComSegmento(segId) {
  abrirSegmento(segId);
}
