/**
 * PAINEL OPERACIONAL — Motor de Recompra
 *
 * Tela de monitoramento em tempo real do motor de automação.
 * Mostra: status do motor, fila ao vivo, métricas por regra, histórico de execuções.
 *
 * Auto-refresh a cada 30s enquanto a página estiver visível.
 */

const ENGINE_URL = `${window.location.origin}/functions/v1/automation-engine`;
let _refreshTimer = null;
let _ctx = null;

// ─── RENDER: Painel Operacional ───────────────────────────────
export async function renderOperationalDashboard(ctx) {
  _ctx = ctx;
  const { supaClient } = ctx;
  const container = document.getElementById('page-painel-operacional');
  if (!container) return;

  container.innerHTML = `<div class="recompra-loading">Carregando painel operacional...</div>`;

  await refreshDashboard(ctx);

  // Auto-refresh
  clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => {
    if (document.getElementById('page-painel-operacional')?.classList.contains('active')) {
      refreshDashboard(ctx);
    }
  }, 30000);
}

async function refreshDashboard(ctx) {
  const { supaClient } = ctx;
  const container = document.getElementById('page-painel-operacional');
  if (!container) return;

  // Carrega tudo em paralelo
  const [
    dashData,
    queueLive,
    ruleSummary,
    execLogs,
    queueByStatus,
  ] = await Promise.all([
    supaClient.from('vw_automation_dashboard').select('*').single(),
    supaClient.from('vw_automation_queue_live')
      .select('*')
      .in('status', ['pending', 'processing', 'failed'])
      .order('priority', { ascending: false })
      .limit(50),
    supaClient.rpc('fn_rule_operational_summary'),
    supaClient.from('automation_execution_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20),
    supaClient.from('automation_queue')
      .select('status')
      .gte('created_at', new Date(Date.now() - 48 * 3600000).toISOString()),
  ]);

  const dash       = dashData.data || {};
  const queue      = queueLive.data || [];
  const rules      = ruleSummary.data || [];
  const logs       = execLogs.data || [];
  const allItems   = queueByStatus.data || [];

  // Agrega por status
  const statusCounts = allItems.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});

  const lastLog = logs[0];
  const isRunning = lastLog?.status === 'running';

  container.innerHTML = `
    <div class="recompra-page painel-page">

      <!-- ── Cabeçalho do Motor ─────────────────────────────── -->
      <div class="recompra-header">
        <div>
          <h1 class="recompra-title">Motor de Recompra</h1>
          <p class="recompra-subtitle">
            ${isRunning
              ? '<span class="engine-running">⚡ Motor em execução...</span>'
              : `Última execução: ${lastLog ? relativeTime(lastLog.started_at) : 'nunca'}`
            }
          </p>
        </div>
        <div class="painel-header-actions">
          <button class="chiva-btn" onclick="window._painel.refresh()" title="Atualizar dados">
            ↺ Atualizar
          </button>
          <button class="chiva-btn chiva-btn-primary" id="btn-run-engine"
            onclick="window._painel.runEngine()"
            ${isRunning ? 'disabled' : ''}>
            ${isRunning ? '⚡ Executando...' : '▶ Executar Agora'}
          </button>
        </div>
      </div>

      <!-- ── KPIs do Motor ──────────────────────────────────── -->
      <div class="painel-kpis">
        ${engineKpi('Regras ativas',    dash.regras_ativas    ?? '—', '⚡', 'green')}
        ${engineKpi('Fila pendente',    dash.fila_pendente    ?? 0,   '📋', dash.fila_pendente > 0 ? 'amber' : 'gray')}
        ${engineKpi('Enviados 24h',     dash.enviados_24h     ?? 0,   '✓',  'green')}
        ${engineKpi('Falhas 24h',       dash.falhas_24h       ?? 0,   '✗',  dash.falhas_24h > 0 ? 'red' : 'gray')}
        ${engineKpi('Conversões 7d',    dash.conversoes_7d    ?? 0,   '🏆', 'blue')}
        ${engineKpi('Receita 7d (atrib.)',
          dash.receita_7d > 0
            ? `R$ ${Number(dash.receita_7d).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`
            : 'R$ 0',
          '💰', 'green')}
      </div>

      <!-- ── Barra de status da fila ───────────────────────── -->
      <div class="recompra-card" style="margin-bottom:16px">
        <div class="card-header">
          <h2>Fila em Tempo Real</h2>
          <span style="font-size:11px;color:var(--text-3)">Atualiza a cada 30s</span>
        </div>
        <div class="queue-status-bar">
          ${queueStatusBar(statusCounts)}
        </div>
      </div>

      <!-- ── Grid principal ────────────────────────────────── -->
      <div class="painel-main-grid">

        <!-- Regras ativas com métricas -->
        <div class="recompra-card">
          <div class="card-header">
            <h2>Regras Automáticas</h2>
            <span class="card-badge">${rules.length} regra(s)</span>
          </div>
          ${renderRuleSummaryTable(rules)}
        </div>

        <!-- Fila ao vivo: itens pendentes/em processo/com falha -->
        <div class="recompra-card">
          <div class="card-header">
            <h2>Fila Ativa</h2>
            <span class="card-badge">${queue.length} item(s)</span>
          </div>
          ${renderQueueLive(queue)}
        </div>

      </div>

      <!-- ── Histórico de execuções ─────────────────────────── -->
      <div class="recompra-card full-width" style="margin-top:16px">
        <div class="card-header">
          <h2>Histórico de Execuções</h2>
          <span style="font-size:11px;color:var(--text-3)">Últimas ${logs.length} execuções</span>
        </div>
        ${renderExecLog(logs)}
      </div>

      <!-- ── Itens com falha (para reprocessamento) ─────────── -->
      ${renderFailedItems(queue.filter(q => q.status === 'failed'))}

    </div>
  `;

  // Binds de ações
  window._painel = window._painel || {};
  window._painel.refresh      = () => refreshDashboard(ctx);
  window._painel.runEngine    = () => runEngineManually(ctx);
  window._painel.retryItem    = (id) => retryQueueItem(ctx, id);
  window._painel.skipItem     = (id) => skipQueueItem(ctx, id);
  window._painel.toggleRule   = (id, ativo) => toggleRule(ctx, id, ativo);
  window._painel.clearFailed  = () => clearFailedItems(ctx);
}

// ─── Executa o motor manualmente ─────────────────────────────
async function runEngineManually(ctx) {
  const btn = document.getElementById('btn-run-engine');
  if (btn) { btn.disabled = true; btn.textContent = '⚡ Executando...'; }

  try {
    // Chama a edge function via supabase functions.invoke
    const { data, error } = await ctx.supaClient.functions.invoke('automation-engine', {
      body: { triggered_by: 'manual' },
    });

    if (error) throw error;

    if (data?.ok) {
      showToast(`Motor executado: ${data.sent ?? 0} enviados, ${data.enqueued ?? 0} enfileirados`, 'success');
    } else {
      showToast(`Erro: ${data?.error || 'desconhecido'}`, 'error');
    }
  } catch (err) {
    showToast(`Erro ao executar motor: ${err.message}`, 'error');
  }

  // Aguarda 3s e atualiza
  setTimeout(() => refreshDashboard(ctx), 3000);
}

// ─── Retry de item com falha ──────────────────────────────────
async function retryQueueItem(ctx, itemId) {
  await ctx.supaClient
    .from('automation_queue')
    .update({
      status:       'pending',
      attempts:     0,
      error_detail: null,
      scheduled_for: new Date().toISOString(),
    })
    .eq('id', itemId);

  showToast('Item recolocado na fila', 'success');
  await refreshDashboard(ctx);
}

async function skipQueueItem(ctx, itemId) {
  await ctx.supaClient
    .from('automation_queue')
    .update({ status: 'skipped', error_detail: 'pulado_manualmente' })
    .eq('id', itemId);

  await refreshDashboard(ctx);
}

async function clearFailedItems(ctx) {
  if (!confirm('Descartar todos os itens com falha permanente? Esta ação não pode ser desfeita.')) return;

  await ctx.supaClient
    .from('automation_queue')
    .update({ status: 'expired' })
    .eq('status', 'failed');

  await refreshDashboard(ctx);
}

async function toggleRule(ctx, ruleId, ativo) {
  await ctx.supaClient
    .from('automation_rules')
    .update({ ativo })
    .eq('id', ruleId);

  await refreshDashboard(ctx);
}

// ─── Renders ─────────────────────────────────────────────────

function engineKpi(label, value, icon, color) {
  return `
    <div class="recompra-kpi-card color-${color}">
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-label">${label}</div>
    </div>
  `;
}

function queueStatusBar(counts) {
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total === 0) return '<div class="empty-mini">Fila vazia no período de 48h</div>';

  const segments = [
    { key: 'pending',    label: 'Pendente',    color: '#60a5fa' },
    { key: 'processing', label: 'Processando', color: '#fbbf24' },
    { key: 'sent',       label: 'Enviado',     color: '#34d399' },
    { key: 'delivered',  label: 'Entregue',    color: '#10b981' },
    { key: 'read',       label: 'Lido',        color: '#059669' },
    { key: 'failed',     label: 'Falhou',      color: '#f87171' },
    { key: 'skipped',    label: 'Pulado',      color: '#9ca3af' },
    { key: 'expired',    label: 'Expirado',    color: '#6b7280' },
    { key: 'opted_out',  label: 'Opt-out',     color: '#f59e0b' },
  ];

  const pills = segments
    .filter(s => counts[s.key])
    .map(s => `
      <div class="queue-pill" style="background:${s.color}22; border-color:${s.color}55">
        <span class="queue-pill-dot" style="background:${s.color}"></span>
        <span class="queue-pill-count">${counts[s.key]}</span>
        <span class="queue-pill-label">${s.label}</span>
      </div>
    `).join('');

  // Barra proporcional
  const bars = segments
    .filter(s => counts[s.key])
    .map(s => {
      const pct = Math.max(1, Math.round((counts[s.key] / total) * 100));
      return `<div class="qbar-seg" style="width:${pct}%;background:${s.color}" title="${s.label}: ${counts[s.key]}"></div>`;
    }).join('');

  return `
    <div class="queue-pills">${pills}</div>
    <div class="queue-bar-container">
      <div class="queue-bar">${bars}</div>
      <div class="queue-bar-total">${total.toLocaleString('pt-BR')} total (48h)</div>
    </div>
  `;
}

function renderRuleSummaryTable(rules) {
  if (!rules || rules.length === 0) {
    return `<div class="empty-mini">Nenhuma regra cadastrada. Crie automações em <strong>Automações</strong>.</div>`;
  }

  const triggerIcons = {
    dias_desde_compra:  '📅',
    carrinho_abandonado:'🛍️',
    primeiro_pedido:    '🎉',
    score_mudou:        '📊',
    aniversario_cliente:'🎂',
  };

  return `
    <div class="table-scroll">
      <table class="chiva-table">
        <thead>
          <tr>
            <th></th>
            <th>Regra</th>
            <th>Trigger</th>
            <th class="text-right">Pendentes</th>
            <th class="text-right">Env. 24h</th>
            <th class="text-right">Conv.</th>
            <th class="text-right">Taxa</th>
            <th>Último envio</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rules.map(r => `
            <tr class="${r.ativo ? '' : 'row-inactive'}">
              <td>
                <label class="toggle-switch" style="margin:0">
                  <input type="checkbox" ${r.ativo ? 'checked' : ''}
                    onchange="window._painel.toggleRule('${r.rule_id}', this.checked)">
                  <span class="toggle-slider"></span>
                </label>
              </td>
              <td>
                <div class="rule-nome">${r.rule_nome}</div>
              </td>
              <td>
                <span class="trigger-badge">
                  ${triggerIcons[r.trigger_tipo] || '⚡'} ${r.trigger_tipo}
                </span>
              </td>
              <td class="text-right">
                ${r.pendentes > 0
                  ? `<span class="count-badge amber">${r.pendentes}</span>`
                  : `<span class="count-muted">0</span>`
                }
              </td>
              <td class="text-right">${r.enviados_24h || 0}</td>
              <td class="text-right">${r.convertidos || 0}</td>
              <td class="text-right">
                ${r.taxa_conversao > 0
                  ? `<span class="rate-green">${r.taxa_conversao}%</span>`
                  : '<span class="count-muted">—</span>'
                }
              </td>
              <td class="text-nowrap">
                ${r.ultimo_envio ? relativeTime(r.ultimo_envio) : '—'}
              </td>
              <td>
                ${r.falhas_24h > 0
                  ? `<span class="count-badge red">${r.falhas_24h} falhas</span>`
                  : ''
                }
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderQueueLive(items) {
  if (!items || items.length === 0) {
    return `<div class="empty-mini">Fila ativa vazia — tudo enviado!</div>`;
  }

  const statusColors = {
    pending:    '#60a5fa',
    processing: '#fbbf24',
    failed:     '#f87171',
  };

  return `
    <div class="queue-live-list">
      ${items.map(item => `
        <div class="queue-item-row">
          <div class="queue-item-status-dot"
            style="background:${statusColors[item.status] || '#9ca3af'}"
            title="${item.status}"></div>

          <div class="queue-item-info">
            <div class="queue-item-nome">${item.cliente_nome || item.telefone}</div>
            <div class="queue-item-meta">
              ${item.rule_nome} ·
              ${item.trigger_tipo} ·
              ${item.status === 'pending' ? `Agendado: ${formatTime(item.scheduled_for)}` : ''}
              ${item.attempts > 0 ? `· ${item.attempts} tentativa(s)` : ''}
            </div>
            ${item.error_detail
              ? `<div class="queue-item-error">✗ ${item.error_detail}</div>`
              : ''
            }
          </div>

          <div class="queue-item-actions">
            ${item.status === 'failed' ? `
              <button class="icon-btn" onclick="window._painel.retryItem('${item.id}')" title="Tentar novamente">↺</button>
              <button class="icon-btn" onclick="window._painel.skipItem('${item.id}')" title="Descartar">✕</button>
            ` : ''}
            ${item.status === 'pending' ? `
              <button class="icon-btn" onclick="window._painel.skipItem('${item.id}')" title="Pular">✕</button>
            ` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderExecLog(logs) {
  if (!logs || logs.length === 0) {
    return `<div class="empty-mini">Nenhuma execução registrada ainda</div>`;
  }

  const statusIcon = {
    completed: '✓',
    partial:   '⚠',
    failed:    '✗',
    running:   '⚡',
  };

  const statusColor = {
    completed: 'green',
    partial:   'amber',
    failed:    'red',
    running:   'blue',
  };

  return `
    <div class="table-scroll">
      <table class="chiva-table exec-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Início</th>
            <th>Duração</th>
            <th>Trigger</th>
            <th class="text-right">Regras</th>
            <th class="text-right">Enfileirados</th>
            <th class="text-right">Enviados</th>
            <th class="text-right">Falhas</th>
            <th class="text-right">Conv.</th>
            <th>Erros</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(log => `
            <tr>
              <td>
                <span class="chiva-badge badge-${statusColor[log.status] || 'gray'}">
                  ${statusIcon[log.status] || '?'} ${log.status}
                </span>
              </td>
              <td class="text-nowrap">${formatDateTime(log.started_at)}</td>
              <td class="text-nowrap">${log.duration_ms ? `${(log.duration_ms/1000).toFixed(1)}s` : '—'}</td>
              <td>
                <span class="trigger-badge">${log.triggered_by}</span>
              </td>
              <td class="text-right">${log.rules_evaluated ?? 0}</td>
              <td class="text-right">${log.newly_enqueued ?? 0}</td>
              <td class="text-right">
                ${log.sent > 0
                  ? `<span class="count-badge green">${log.sent}</span>`
                  : '0'
                }
              </td>
              <td class="text-right">
                ${log.failed > 0
                  ? `<span class="count-badge red">${log.failed}</span>`
                  : '0'
                }
              </td>
              <td class="text-right">${log.conversions_detected ?? 0}</td>
              <td>
                ${Array.isArray(log.errors) && log.errors.length > 0
                  ? `<span class="error-hint" title="${log.errors.join('\n')}">${log.errors.length} erro(s)</span>`
                  : '—'
                }
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderFailedItems(failedItems) {
  if (!failedItems || failedItems.length === 0) return '';

  return `
    <div class="recompra-card full-width failed-section" style="margin-top:16px">
      <div class="card-header">
        <h2>Falhas Pendentes de Revisão</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="chiva-badge badge-red">${failedItems.length}</span>
          <button class="chiva-btn chiva-btn-sm" onclick="window._painel.clearFailed()">
            Descartar todos
          </button>
        </div>
      </div>
      <div class="queue-live-list">
        ${failedItems.slice(0, 10).map(item => `
          <div class="queue-item-row">
            <div class="queue-item-status-dot" style="background:#f87171"></div>
            <div class="queue-item-info">
              <div class="queue-item-nome">${item.cliente_nome || item.telefone}</div>
              <div class="queue-item-meta">${item.rule_nome} · ${item.attempts} tentativa(s)</div>
              <div class="queue-item-error">✗ ${item.error_detail || 'Erro desconhecido'}</div>
            </div>
            <div class="queue-item-actions">
              <button class="chiva-btn chiva-btn-sm" onclick="window._painel.retryItem('${item.id}')">
                ↺ Tentar novamente
              </button>
            </div>
          </div>
        `).join('')}
        ${failedItems.length > 10 ? `<div class="empty-mini">+${failedItems.length - 10} mais...</div>` : ''}
      </div>
    </div>
  `;
}

// ─── Helpers ─────────────────────────────────────────────────
function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `há ${days}d`;
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast-${type}`;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 4000);
}
