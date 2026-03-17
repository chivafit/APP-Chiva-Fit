function _sentryCapture(error, context) {
  try {
    if (typeof window !== "undefined" && typeof window.Sentry !== "undefined" && window.APP_CONFIG && window.APP_CONFIG.sentryDsn) {
      window.Sentry.captureException(error, context ? { extra: context } : undefined);
    }
  } catch (_e) {}
}

export function escapeHTML(str){
  if(str === null || str === undefined) return "";
  const s = String(str);
  const map = {
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    "\"":"&quot;",
    "'":"&#39;",
    "`":"&#96;",
    "=":"&#61;",
    "/":"&#47;"
  };
  return s.replace(/[&<>"'`=\/]/g, ch => map[ch] || ch);
}

export function safeJsonParse(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(raw == null) return fallback;
    return JSON.parse(raw);
  }catch(_e){
    try{ localStorage.removeItem(key); }catch(_e2){}
    return fallback;
  }
}

export function escapeJsSingleQuote(str){
  return String(str||"")
    .replace(/\\/g,"\\\\")
    .replace(/'/g,"\\'")
    .replace(/\r/g,"\\r")
    .replace(/\n/g,"\\n")
    .replace(/\u2028/g,"\\u2028")
    .replace(/\u2029/g,"\\u2029");
}

// Chaves grandes que podem ser removidas para liberar espaço (ordem de prioridade)
const EVICTABLE_KEYS = [
  "crm_bling_orders",
  "crm_yampi_orders",
  "crm_shopify_orders",
  "crm_carrinhos_abandonados",
  "crm_bling_products",
  "crm_insumos",
  "crm_ordens_producao",
  "crm_movimentos_estoque",
  "crm_receitas_produtos",
  "crm_climeta",
];

/**
 * Retry com exponential backoff.
 * @param {Function} fn - função async a executar
 * @param {number} maxAttempts - máximo de tentativas (default 3)
 * @param {number} baseDelayMs - delay base em ms (default 1000)
 */
export async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1000){
  let lastError;
  for(let attempt = 1; attempt <= maxAttempts; attempt++){
    try{
      return await fn();
    }catch(e){
      lastError = e;
      const isRetryable = !e?.message?.includes("Unauthorized") &&
                          !e?.message?.includes("invalid_grant") &&
                          !e?.message?.includes("Supabase não configurado");
      if(!isRetryable || attempt === maxAttempts){
        _sentryCapture(e, { withRetry: true, attempt, maxAttempts });
        throw e;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[retry] tentativa ${attempt}/${maxAttempts} falhou, aguardando ${delay}ms:`, e?.message);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

/**
 * Converte data em formato BR (dd/mm/yyyy) ou ISO (yyyy-mm-dd) para ISO.
 * Retorna string vazia se não reconhecer o formato.
 */
export function parseDateToIso(v){
  const s = String(v||"").trim();
  if(!s) return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(br) return `${br[3]}-${br[2]}-${br[1]}`;
  return "";
}

/**
 * Converte data ISO (yyyy-mm-dd) para formato BR (dd/mm/yyyy).
 */
export function fmtDateBrFromIso(iso){
  const s = String(iso||"").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

export function debounce(fn, delay){
  let timer;
  return function(...args){
    clearTimeout(timer);
    timer = setTimeout(()=> fn.apply(this, args), delay);
  };
}

export function safeSetItem(key, value){
  try{
    localStorage.setItem(key, value);
  }catch(e){
    const isQuota = e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22);
    if(!isQuota){ console.warn("[localStorage] Erro ao salvar", key, e); return; }
    console.warn("[localStorage] Quota excedida ao salvar", key, "– limpando entradas antigas...");
    for(const evict of EVICTABLE_KEYS){
      if(evict === key) continue;
      try{ localStorage.removeItem(evict); }catch(_e){}
      try{
        localStorage.setItem(key, value);
        return;
      }catch(_e2){}
    }
    console.error("[localStorage] Não foi possível salvar", key, "mesmo após limpeza. Dado descartado.");
  }
}
