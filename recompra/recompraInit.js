/**
 * Bootstrap do Módulo Recompra — carregado via <script type="module">
 *
 * Aguarda o app principal estar pronto, então registra os handlers
 * das páginas do módulo sem tocar em app.js ou qualquer arquivo existente.
 */

import { initRecompraModule, registerRecompraPages } from './recompra.js';
import { renderOperationalDashboard } from './operationalDashboard.js';

// Aguarda o app principal estar pronto (usa evento customizado ou fallback por tempo)
function waitForApp(cb) {
  if (window._appReady || document.getElementById('page-recompra')) {
    cb();
  } else {
    document.addEventListener('crm:ready', cb, { once: true });
    // Fallback: tenta após 2s mesmo sem evento
    setTimeout(cb, 2000);
  }
}

waitForApp(async () => {
  // Contexto: reutiliza o supaClient já inicializado pelo app principal
  const supaClient = window._supaClient || window.supabaseClient;
  if (!supaClient) {
    console.warn('[Recompra] supaClient não encontrado. Módulo não inicializado.');
    return;
  }

  const ctx = { supaClient };

  try {
    await initRecompraModule(ctx);
    registerRecompraPages(ctx);

    // Registra o painel operacional como página adicional
    patchShowPageForOperational(ctx);

    // Exibe badge no nav se houver itens com falha
    pollFailureBadge(supaClient);

    console.info('[Recompra] Módulo inicializado com sucesso — incluindo motor de automação.');
  } catch (err) {
    console.error('[Recompra] Erro na inicialização:', err);
  }
});

// ─── Registra página do painel operacional ───────────────────
function patchShowPageForOperational(ctx) {
  const observer = new MutationObserver(() => {
    const el = document.getElementById('page-painel-operacional');
    if (el && el.classList.contains('active')) {
      const last = el.dataset.lastRendered;
      const now  = Date.now();
      if (!last || now - parseInt(last) > 30000) {
        el.dataset.lastRendered = now;
        renderOperationalDashboard(ctx);
      }
    }
  });

  observer.observe(document.getElementById('app') || document.body, {
    subtree:         true,
    attributeFilter: ['class'],
  });
}

// ─── Badge de falhas no nav ───────────────────────────────────
async function pollFailureBadge(supaClient) {
  const updateBadge = async () => {
    try {
      const { count } = await supaClient
        .from('automation_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('updated_at', new Date(Date.now() - 24 * 3600000).toISOString());

      const badge = document.getElementById('badge-motor');
      if (badge) {
        if (count > 0) {
          badge.textContent = count;
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch { /* silencia erros de polling */ }
  };

  await updateBadge();
  setInterval(updateBadge, 60000); // atualiza a cada minuto
}
