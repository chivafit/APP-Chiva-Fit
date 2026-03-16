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
