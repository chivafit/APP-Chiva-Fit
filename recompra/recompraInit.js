/**
 * Bootstrap do Módulo Recompra — carregado via <script type="module">
 *
 * Aguarda o app principal estar pronto, então registra os handlers
 * das páginas do módulo sem tocar em app.js ou qualquer arquivo existente.
 */

import { initRecompraModule, registerRecompraPages } from './recompra.js';

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
    console.info('[Recompra] Módulo inicializado com sucesso.');
  } catch (err) {
    console.error('[Recompra] Erro na inicialização:', err);
  }
});
