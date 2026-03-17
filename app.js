import { allInsumos, allOrdens, getEstPct, getEstStatus } from "./producao.js?v=20260316-6";
import {
  computeCustomerIntelligence as computeCustomerIntelligenceImpl,
  definirNextBestAction as definirNextBestActionImpl,
  getTodaySalesActions as getTodaySalesActionsImpl,
  renderIADashboard as renderIADashboardImpl,
  gerarMensagemIA as gerarMensagemIAImpl,
  runAI as runAIImpl,
  copyWhatsAppMessageForCustomer as copyWhatsAppMessageForCustomerImpl,
  openWhatsAppForCustomer as openWhatsAppForCustomerImpl
} from "./ia.js?v=20260316-6";
import { escapeHTML, safeJsonParse, escapeJsSingleQuote, safeSetItem, debounce, withRetry } from "./utils.js?v=20260317-3";
import { initSentry, captureError, captureMessage, setSentryUser } from "./sentry.js?v=20260317-3";
import { CRMStore } from "./store.js?v=20260316-6";
import { STORAGE_KEYS } from "./constants.js?v=20260316-6";
import { getSupabaseClient } from "./supabaseClient.js?v=20260316-6";
import {
  getDashboardKpis as getDashboardKpisView,
  getDashboardDaily as getDashboardDailyView,
  getDashboardDailyChannel as getDashboardDailyChannelView,
  getNewCustomersDaily as getNewCustomersDailyView,
  getTopCidades as getTopCidadesView,
  getProdutosFavoritos as getProdutosFavoritosView,
  getClientesVipRisco as getClientesVipRiscoView,
  getClientesReativacao as getClientesReativacaoView,
  getClientesSemContato as getClientesSemContatoView,
  getClientesInteligencia as getClientesInteligenciaView,
  getFunilRecompra as getFunilRecompraView,
  normalizeClienteIntel
} from "./viewsApi.js?v=20260316-6";
import {
  scheduleAutoBlingSync as scheduleAutoBlingSyncImpl,
  syncBling as syncBlingImpl,
  syncBlingProdutos as syncBlingProdutosImpl,
  backfillBlingEnderecos as backfillBlingEnderecosImpl
} from "./sync/bling.js?v=20260316-6";
import {
  syncYampi as syncYampiImpl,
  syncCarrinhosAbandonadosYampi as syncCarrinhosAbandonadosYampiImpl,
  scheduleAutoCarrinhosSync as scheduleAutoCarrinhosSyncImpl
} from "./sync/yampi.js?v=20260316-6";

// ── Sentry: inicializa e registra handlers globais ──
initSentry();
window.addEventListener("unhandledrejection", function(event) {
  captureError(event.reason, { type: "unhandledrejection" });
});
window.onerror = function(message, source, lineno, colno, error) {
  captureError(error || new Error(String(message)), { source, lineno, colno });
};

document.addEventListener("DOMContentLoaded",function(){
  if(window.Chart){
    Chart.defaults.font.family="'Plus Jakarta Sans',system-ui,sans-serif";
    Chart.defaults.color="#585f78";
    Chart.defaults.borderColor="rgba(255,255,255,.04)";
    Chart.defaults.plugins.tooltip.backgroundColor="#0e1018";
    Chart.defaults.plugins.tooltip.borderColor="#1d2235";
    Chart.defaults.plugins.tooltip.borderWidth=1;
    Chart.defaults.plugins.tooltip.titleColor="#edeef4";
    Chart.defaults.plugins.tooltip.bodyColor="#a0a8be";
    Chart.defaults.plugins.tooltip.padding=10;
    Chart.defaults.plugins.tooltip.cornerRadius=8;
  }
});

/* ═══════════════════════════════════════════
   FUNÇÕES UTILITÁRIAS — CORREÇÃO DE ERROS
   Inicialização de variáveis e helpers críticos
═══════════════════════════════════════════ */

// ── Inicialização de variáveis globais ──
let tarefasCache = [];
let supaConnected = false;
let supaClient = null;
let supaSession = null;
let supaAccessToken = "";
let supaAuthUnsub = null;
let canaisLookup = {};
let clientesIntelCache = [];
let clientesIntelLoadedAt = 0;
let clientesIntelInFlight = false;
let clientesIntelCursor = null;
let clientesIntelHasMore = true;
let clientesIntelObserver = null;
let clientesIntelDomMode = "";
let clientesIntelDomCount = 0;
let clientesIntelUfSet = new Set();
let clientesIntelSegSet = new Set();

// ═══════════════════════════════════════════════════
//  SIDEBAR COLLAPSE
// ═══════════════════════════════════════════════════
function initSidebarCollapse(){
  if(localStorage.getItem("crm_sidebar_collapsed") === "1"){
    document.getElementById("sidebar")?.classList.add("collapsed");
    document.getElementById("main-area")?.classList.add("sidebar-collapsed");
  }
}
function toggleSidebarCollapse(){
  const sidebar = document.getElementById("sidebar");
  const mainArea = document.getElementById("main-area");
  if(!sidebar || !mainArea) return;
  const collapsed = sidebar.classList.toggle("collapsed");
  mainArea.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem("crm_sidebar_collapsed", collapsed ? "1" : "0");
}
initSidebarCollapse();

// ═══════════════════════════════════════════════════
//  THEME SYSTEM
// ═══════════════════════════════════════════════════
function initTheme(){
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  const theme = saved || "light";
  if(theme === "light"){
    document.documentElement.classList.add("light");
  } else {
    document.documentElement.classList.remove("light");
  }
  CRMStore.ui.theme = theme === "light" ? "light" : "dark";
  updateThemeUI();
}
function toggleTheme(){
  document.documentElement.classList.toggle("light");
  const isLight = document.documentElement.classList.contains("light");
  localStorage.setItem(STORAGE_KEYS.theme, isLight ? "light" : "dark");
  CRMStore.ui.theme = isLight ? "light" : "dark";
  updateThemeUI();
}
function updateThemeUI(){
  const isLight = document.documentElement.classList.contains("light");
  const icon = document.getElementById("theme-icon");
  const topbarIcon = document.getElementById("topbar-theme-icon");
  const label = document.getElementById("theme-label");
  if(icon) icon.textContent = isLight ? "☀️" : "🌙";
  if(topbarIcon) topbarIcon.textContent = isLight ? "☀️" : "🌙";
  if(label) label.textContent = isLight ? "Modo Claro" : "Modo Escuro";
}
initTheme();

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
function safeInvokeName(name, ...args){
  try{
    const fn = window[name];
    if(typeof fn === "function") return fn(...args);
  }catch(e){
    console.warn(name + ":", e?.message || String(e));
  }
}

let CID="", CSEC="", SHOP="", SHOPKEY="";
try{
  CID     = localStorage.getItem("crm_cid")||"";
  CSEC    = localStorage.getItem("crm_csec")||"";
  SHOP    = localStorage.getItem("crm_shop")||"";
  SHOPKEY = localStorage.getItem("crm_shopkey")||"";
}catch(_e){ console.warn("[init] localStorage indisponível — modo privado?"); }

let cliMeta = safeJsonParse("crm_climeta", {});
let cliMetaCache = {};
let notifs = safeJsonParse("crm_notifs", []);
let WA_TPLS = safeJsonParse("crm_wa_tpls", null) || [
  "Oi {nome}! 😊 Sentimos sua falta na Chiva Fit! Que tal experimentar nossos novos sabores? Temos condições especiais pra você! 💪",
  "Olá {nome}! Obrigada pela sua compra! Esperamos que esteja amando 😍 Qualquer dúvida é só chamar!",
  "Oi {nome}! 🔥 Novidades chegando na Chiva Fit essa semana! Fica de olho no nosso perfil 👀💪"
];
let blingOrders = safeJsonParse("crm_bling_orders", []);
let yampiOrders = safeJsonParse("crm_yampi_orders", []);
let shopifyOrders = safeJsonParse("crm_shopify_orders", []);
let blingProducts = safeJsonParse("crm_bling_products", []);
let carrinhosAbandonados = safeJsonParse("crm_carrinhos_abandonados", []);
let allOrders = [];
let allCustomers = [];
let customerIntel = [];
let customerIntelligence = [];
let activeCh = "all";
let charts   = {};
let activeSegment = null;
let syncTimer = null;
let waPhone="", waName="", waCustomerId=null;
let selectedUser="admin";
let currentClienteId = null;
let oppPipeline = safeJsonParse("crm_opp_pipeline", []);
let allTasks = safeJsonParse("crm_tasks", null) || [
  {id:1,titulo:"Reativar clientes VIP inativos (WhatsApp)",desc:"Clientes VIP que não compram há +60 dias",prioridade:"alta",status:"pendente",cliente:"",data:new Date().toISOString().slice(0,10)},
  {id:2,titulo:"Enviar campanha de reativação",desc:"Segmento de inativos - template WhatsApp",prioridade:"media",status:"pendente",cliente:"",data:new Date().toISOString().slice(0,10)},
  {id:3,titulo:"Verificar pedidos pendentes no Bling",desc:"Conferir status de entregas desta semana",prioridade:"alta",status:"em_andamento",cliente:"",data:new Date().toISOString().slice(0,10)},
];
let taskIdSeq = allTasks.length ? Math.max(...allTasks.map(t=>t.id))+1 : 1;
let CRM_BOOTSTRAPPED = false;
let CRM_BOOTSTRAP_ERROR = null;
let dataReady = false;
let isLoadingData = false;
let lastDetectChDebugCanal = "";

CRMStore.data.orders = allOrders;
CRMStore.data.customers = allCustomers;
CRMStore.data.tasks = allTasks;
CRMStore.intelligence.customerScores = customerIntelligence;
CRMStore.ui.currentPage = "dashboard";
window.CRMStore = CRMStore;

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async ()=>{
  const shell = document.getElementById("app-shell");
  if(shell && shell.classList.contains("visible")) return;

  const url = getSupabaseProjectUrl();
  const key = getSupabaseAnonKey();
  const hasSupabase = !!(url && key);

  if(hasSupabase){
    try{
      supaClient = getSupabaseClient(url, key);
      try{
        if(!supaAuthUnsub && supaClient.auth && typeof supaClient.auth.onAuthStateChange === "function"){
          const res = supaClient.auth.onAuthStateChange((_event, session)=>{
            supaSession = session || null;
            supaAccessToken = session?.access_token ? String(session.access_token) : "";
          });
          supaAuthUnsub = res?.data?.subscription || res?.subscription || null;
        }
      }catch(_e){}

      const session = await refreshSupabaseSession();
      const email = String(session?.user?.email || "").trim().toLowerCase();
      if(session && session.access_token && email){
        localStorage.setItem(STORAGE_KEYS.loginFlag, "true");
        localStorage.setItem(STORAGE_KEYS.sessionEmail, email);
        enterApp(email);
        return;
      }
      forceLogout("");
      return;
    }catch(_e){
      forceLogout("");
      return;
    }
  }

  const loggedIn = localStorage.getItem(STORAGE_KEYS.loginFlag) === "true";
  if(!loggedIn) return;
  const email = localStorage.getItem(STORAGE_KEYS.sessionEmail) || "admin@chivafit.com";
  enterApp(email);
});

try{
  (()=>{
    mergeOrders();
    const now=new Date(), from=new Date(now.getFullYear(),now.getMonth()-17,1);
    const shopFromSaved = localStorage.getItem("crm_shopify_from") || "";
    const shopToSaved = localStorage.getItem("crm_shopify_to") || "";
    const blingFromEl = document.getElementById("date-from");
    const blingToEl = document.getElementById("date-to");
    if(blingFromEl) blingFromEl.value = fmtDate(iso(from));
    if(blingToEl) blingToEl.value = fmtDate(iso(now));
    const shopFromEl = document.getElementById("shop-date-from");
    const shopToEl = document.getElementById("shop-date-to");
    if(shopFromEl) shopFromEl.value = shopFromSaved || iso(from);
    if(shopToEl) shopToEl.value = shopToSaved || iso(now);
    const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,"0");
    const pm=now.getMonth()===0?12:now.getMonth(), py=now.getMonth()===0?y-1:y;
    const ca=document.getElementById("cmp-a"), cb=document.getElementById("cmp-b");
    if(ca) ca.value=`${y}-${m}`; if(cb) cb.value=`${py}-${String(pm).padStart(2,"0")}`;
    const ad=localStorage.getItem("crm_alertdays"); if(ad){ const el=document.getElementById("alert-days"); if(el) el.value=ad; }
    if(CID){ const el=document.getElementById("inp-cid"); if(el) el.value=CID; }
    if(CSEC){ const el=document.getElementById("inp-csec"); if(el) el.value=CSEC; }
    if(SHOP){ const el=document.getElementById("inp-shop"); if(el) el.value=SHOP; }
    if(SHOPKEY){ const el=document.getElementById("inp-shopkey"); if(el) el.value=SHOPKEY; }
    
    localStorage.removeItem("crm_ai_key");
    
    loadTemplatesUI();
  })();
}catch(e){
  console.warn("Init:", e?.message || String(e));
}

function mergeOrders(){
  if(isLoadingData) return;
  const seen = new Set();
  // Build into temp arrays first — swap atomically at the end to
  // avoid renderDash() reading a half-populated allOrders mid-merge.
  const nextOrders = [];

  const normKey = (v)=>String(v ?? "").trim();
  const safeLower = (v)=>String(v ?? "").toLowerCase().trim();

  (Array.isArray(blingOrders) ? blingOrders : []).forEach((o, idx)=>{
    const key = normKey(o?.numero || o?.id) || ("idx:" + idx);
    const sk = "b:" + key;
    if(seen.has(sk)) return;
    seen.add(sk);
    try{ o._source = "bling"; }catch(_e){}
    nextOrders.push(normalizeOrderForCRM(o, "bling"));
  });

  (Array.isArray(yampiOrders) ? yampiOrders : []).forEach((o, idx)=>{
    const keyNum = normKey(o?.numero || o?.id);
    if(keyNum && seen.has("b:" + keyNum)) return;

    const keyEmail = [
      safeLower(o?.email || o?.contato?.email),
      String(o?.data || o?.dataPedido || o?.data_pedido || "").slice(0,10),
      String(Math.round(Number(o?.total || o?.valor || o?.totalProdutos || 0)))
    ].join("|");

    if(keyEmail !== "||0" && seen.has("y:" + keyEmail)) return;
    if(keyEmail !== "||0") seen.add("y:" + keyEmail);
    if(!keyEmail || keyEmail === "||0"){
      const fallback = "y:idx:" + idx;
      if(seen.has(fallback)) return;
      seen.add(fallback);
    }

    try{ o._source = "yampi"; }catch(_e){}
    nextOrders.push(normalizeOrderForCRM(o, "yampi"));
  });

  (Array.isArray(shopifyOrders) ? shopifyOrders : []).forEach((o, idx)=>{
    const keyNum = normKey(o?.numero || o?.order_number || o?.name || o?.id);
    if(keyNum && (seen.has("b:" + keyNum) || seen.has("y:" + keyNum))) return;
    const key = keyNum || ("idx:" + idx);
    const sk = "s:" + key;
    if(seen.has(sk)) return;
    seen.add(sk);
    try{ o._source = "shopify"; }catch(_e){}
    nextOrders.push(normalizeOrderForCRM(o, "shopify"));
  });

  // Atomic swap: renderDash() reads allOrders — do this in one shot
  allOrders.length = 0;
  allOrders.push(...nextOrders);

  const nextCustomers = Object.values(buildCli(allOrders)).map(c=>{
    const sc = calcCliScores(c);
    return { ...c, total_gasto: sc.ltv, status: sc.status, canal_principal: c.channels && c.channels.size ? [...c.channels][0] : "" };
  });
  allCustomers.length = 0;
  allCustomers.push(...nextCustomers);

  (Array.isArray(yampiOrders) ? yampiOrders : []).forEach((yo)=>{
    const email = safeLower(yo?.email || yo?.contato?.email);
    if(!email) return;
    const cliente = allCustomers.find(c => safeLower(c?.email) === email);
    if(!cliente) return;
    const tel = String(yo?.telefone || yo?.contato?.telefone || yo?.contato?.celular || "").trim();
    const doc = String(yo?.doc || yo?.cpfCnpj || yo?.contato?.cpfCnpj || yo?.contato?.numeroDocumento || "").trim();
    if(!cliente.telefone && tel) cliente.telefone = tel;
    if(!cliente.doc && doc) cliente.doc = doc;
  });

  console.log(
    "[mergeOrders] Total:",
    allOrders.length,
    "| Bling:",
    allOrders.filter(o=>o._source==="bling").length,
    "| Yampi exclusivo:",
    allOrders.filter(o=>o._source==="yampi").length,
    "| Shopify:",
    allOrders.filter(o=>o._source==="shopify").length
  );

  computeCustomerIntelligence();
  reconcileCarrinhosRecuperados().catch(e=>console.warn("[reconcile carrinhos]", e?.message||e));
  recomputeCarrinhosScoresAndPersist().catch(e=>console.warn("[recompute carrinhos]", e?.message||e));
}

function checkEstoqueCritico(){
  const list = Array.isArray(allInsumos) ? allInsumos : [];
  const crit = list.filter(i=>{
    const atual = Number(i?.estoque_atual ?? i?.estoque ?? 0) || 0;
    const min = Number(i?.estoque_minimo ?? i?.minimo ?? 0) || 0;
    return min > 0 && atual < min;
  });
  const badge = document.getElementById("badge-producao");
  if(badge){
    if(crit.length){
      badge.style.display = "";
      badge.textContent = String(crit.length);
    }else{
      badge.style.display = "none";
    }
  }
  if(!crit.length) return;

  const today = new Date().toISOString().slice(0,10);
  const hash = crit
    .map(i=>`${String(i?.id||"")}:${String(i?.nome||"")}:${Number(i?.estoque_atual ?? i?.estoque ?? 0) || 0}:${Number(i?.estoque_minimo ?? i?.minimo ?? 0) || 0}`)
    .sort()
    .join("|");
  const prevHash = String(localStorage.getItem("crm_estoque_critico_hash") || "");
  const prevDay = String(localStorage.getItem("crm_estoque_critico_day") || "");
  if(hash === prevHash && prevDay === today) return;

  localStorage.setItem("crm_estoque_critico_hash", hash);
  localStorage.setItem("crm_estoque_critico_day", today);

  const names = crit.map(i=>String(i?.nome||"").trim()).filter(Boolean);
  const head = names.slice(0,6).join(", ");
  toast(`🚨 Estoque crítico: ${head}${names.length>6?` (+${names.length-6})`:``}`);

  if(supaConnected && supaClient){
    const lastLogged = String(localStorage.getItem("crm_estoque_critico_logged_day") || "");
    if(lastLogged !== today){
      localStorage.setItem("crm_estoque_critico_logged_day", today);
      supaClient.from("v2_alertas").insert({
        tipo: "estoque_critico",
        conteudo: { itens: crit.map(i=>({ id: i?.id, nome: i?.nome, estoque_atual: i?.estoque_atual ?? i?.estoque ?? 0, estoque_minimo: i?.estoque_minimo ?? i?.minimo ?? 0 })) },
        created_at: new Date().toISOString()
      }).then(()=>{}).catch(()=>{});
    }
  }
}

function iso(d){ return d.toISOString().slice(0,10); }
function blng(d){ if(!d)return""; const[y,m,dd]=d.split("-"); return`${dd}/${m}/${y}`; }

// Endpoints e headers para Edge Functions do Supabase
function getSupabaseProjectUrl(){
  const raw =
    window.APP_CONFIG?.supabaseUrl ||
    localStorage.getItem("crm_supa_url") ||
    localStorage.getItem("supa_url") ||
    localStorage.getItem("supabase_url") ||
    "";
  let url = String(raw || "").trim().replace(/\/+$/,"");
  if(!url) return "";
  if(!url.includes("://")) url = "https://" + url;
  return url;
}

function getSupabaseAnonKey(){
  const raw =
    window.APP_CONFIG?.supabaseAnonKey ||
    localStorage.getItem("crm_supa_key") ||
    localStorage.getItem("supa_key") ||
    localStorage.getItem("supabase_key") ||
    "";
  return String(raw || "").trim();
}

function getSupaFnBase(){
  const url = getSupabaseProjectUrl();
  if(!url) throw new Error("Supabase não configurado: informe a URL do projeto em Configurações.");
  return url + "/functions/v1";
}

let _sessionRefreshInFlight = null;
async function refreshSupabaseSession(){
  if(!supaClient || !supaClient.auth || typeof supaClient.auth.getSession !== "function") return null;
  // Singleton: se já há um refresh em andamento, aguardar o mesmo resultado
  if(_sessionRefreshInFlight) return _sessionRefreshInFlight;
  _sessionRefreshInFlight = (async()=>{
    try{
      const { data, error } = await supaClient.auth.getSession();
      if(error) return null;
      supaSession = data?.session || null;
      supaAccessToken = supaSession?.access_token ? String(supaSession.access_token) : "";
      return supaSession;
    }catch(_e){
      return null;
    }
  })().finally(()=>{ _sessionRefreshInFlight = null; });
  return _sessionRefreshInFlight;
}

async function supaFnHeadersAsync(){
  const session = await refreshSupabaseSession();
  if(!session?.access_token){
    forceLogout("Sessão do Supabase expirada.");
    throw new Error("Sessão do Supabase expirada. Faça login novamente.");
  }
  return supaFnHeaders();
}

function supaFnHeaders(){
  const anonKey = getSupabaseAnonKey();
  if(!anonKey) throw new Error("Supabase não configurado: informe a chave pública (anon) em Configurações.");
  if(!supaAccessToken){
    throw new Error("Sessão do Supabase expirada. Faça login novamente.");
  }
  return {
    "Content-Type":"application/json",
    "apikey": anonKey,
    "Authorization": "Bearer "+supaAccessToken
  };
}

async function bootstrapFromSupabase(){
  try{
    const connected = await initSupabase();
    if(connected){
      await loadSupabaseData();
      // Verificar erro de token Bling e alertar o usuário no boot
      try{
        const { data: tokenErrRow } = await supaClient.from("configuracoes")
          .select("valor_texto").eq("chave","bling_token_error").maybeSingle();
        const tokenErr = String(tokenErrRow?.valor_texto || "").trim();
        if(tokenErr){
          const parsed = JSON.parse(tokenErr);
          if(parsed?.type && parsed?.message){
            setTimeout(()=> toast(`⚠ Bling: ${parsed.message}`, "error"), 3500);
          }
        }
      }catch(_e){}
    }
    CRM_BOOTSTRAPPED = true;
    CRM_BOOTSTRAP_ERROR = null;
  }catch(e){
    console.warn("bootstrapFromSupabase:", e.message);
    CRM_BOOTSTRAPPED = false;
    CRM_BOOTSTRAP_ERROR = e.message;
    throw e;
  }
}

// ═══════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════
async function handleLoginSubmit(e){
  if(e){ e.preventDefault(); e.stopPropagation(); }
  
  const emailEl = document.getElementById("login-email");
  const passEl = document.getElementById("login-pass");
  const errEl = document.getElementById("login-error");
  const btnEl = e?.target?.querySelector('button[type="submit"]');
  
  const email = emailEl ? String(emailEl.value||"").trim().toLowerCase() : "";
  const pass = passEl ? String(passEl.value||"").trim() : "";
  
  if(errEl){ errEl.textContent=""; errEl.style.color=""; }
  
  try {
    if(!email || !pass){
      if(errEl) errEl.textContent = "Informe e-mail e senha.";
      return false;
    }

    if(btnEl){
      btnEl.disabled = true;
      btnEl.innerHTML = '<span>Entrando...</span>';
    }

    const ADMIN_EMAILS = new Set(["admin@chivafit.com","admin@chivafit.com.br","admin"]);
    const isAdmin = ADMIN_EMAILS.has(email);
    const canonicalEmail = (email === "admin" || email === "admin@chivafit.com.br") ? "admin@chivafit.com" : email;

    const url = getSupabaseProjectUrl();
    const key = getSupabaseAnonKey();
    const hasSupabase = !!(url && key);

    if(hasSupabase){
      try{
        supaClient = getSupabaseClient(url, key);
        try{
          if(!supaAuthUnsub && supaClient.auth && typeof supaClient.auth.onAuthStateChange === "function"){
            const res = supaClient.auth.onAuthStateChange((_event, session)=>{
              supaSession = session || null;
              supaAccessToken = session?.access_token ? String(session.access_token) : "";
            });
            supaAuthUnsub = res?.data?.subscription || res?.subscription || null;
          }
        }catch(_e){}
      }catch(_e){
        if(errEl) errEl.textContent = "Supabase JS não carregou corretamente neste ambiente.";
        return false;
      }

      if(!supaClient?.auth || typeof supaClient.auth.signInWithPassword !== "function"){
        if(errEl) errEl.textContent = "Supabase Auth não está disponível neste ambiente.";
        return false;
      }

      let allowUsers = loadAccessUsers();
      if(!allowUsers.length){
        const hydrated = await hydrateAccessUsersFromSupabaseForLogin();
        if(hydrated) allowUsers = loadAccessUsers();
      }
      if(allowUsers.length && !isAdmin){
        const allowed = allowUsers.some(u => normalizeAccessEmail(u?.email) === canonicalEmail);
        if(!allowed){
          if(errEl) errEl.textContent = "Acesso não autorizado para este e-mail.";
          return false;
        }
      }

      const { data, error } = await supaClient.auth.signInWithPassword({ email: canonicalEmail, password: pass });
      if(error || !data?.session?.access_token){
        if(errEl) errEl.textContent = error?.message ? String(error.message) : "Falha ao autenticar no Supabase (Auth).";
        return false;
      }

      supaSession = data.session;
      supaAccessToken = String(data.session.access_token || "");

      const connected = await initSupabase();
      if(!connected){
        if(errEl) errEl.textContent = "Supabase não está conectado. Verifique a URL, a chave (anon) e as políticas (RLS).";
        return false;
      }

      localStorage.setItem(STORAGE_KEYS.loginFlag, "true");
      localStorage.setItem(STORAGE_KEYS.sessionEmail, canonicalEmail);
      enterApp(canonicalEmail);
      return false;
    }

    let ok = await verifyAccessUser(canonicalEmail, pass);
    if(!ok){
      const hydrated = await hydrateAccessUsersFromSupabaseForLogin();
      if(hydrated) ok = await verifyAccessUser(canonicalEmail, pass);
    }
    if(ok){
      localStorage.setItem(STORAGE_KEYS.loginFlag, "true");
      localStorage.setItem(STORAGE_KEYS.sessionEmail, canonicalEmail);
      enterApp(canonicalEmail);
      return false;
    }
    
    if(isAdmin){
      const hasAdmin = !!getAccessUserByEmail("admin@chivafit.com");
      if(!hasAdmin){
        const bootPass = localStorage.getItem("crm_bootstrap_pass");
        if(errEl){
          errEl.textContent = bootPass
            ? `Administrador não cadastrado neste navegador. Use a senha temporária ${bootPass}.`
            : "Administrador não cadastrado neste navegador. Cadastre um usuário em Configurações.";
        }
      }else{
        if(errEl) errEl.textContent = "Senha do administrador inválida.";
      }
    } else {
      if(errEl) errEl.textContent = "Credenciais inválidas. Use o admin ou um usuário cadastrado.";
    }
  } catch(err) {
    captureError(err, { context: "login" });
    console.error("Login error:", err);
    if(!window.isSecureContext){
      if(errEl) errEl.textContent = "Este login precisa de HTTPS (ou servidor local). Evite abrir o arquivo via file://";
    } else {
      if(errEl) errEl.textContent = "Erro ao validar credenciais. Verifique o console.";
    }
  } finally {
    if(btnEl){
      btnEl.disabled = false;
      btnEl.innerHTML = '<span>Entrar</span>';
    }
  }
  return false;
}
window.handleLoginSubmit = handleLoginSubmit;
function enterApp(userEmail){
  setSentryUser({ email: userEmail || "admin" });
  try{ localStorage.removeItem("crm_bootstrap_pass"); }catch(_e){}
  try{ localStorage.removeItem("crm_bootstrap_pass_ts"); }catch(_e){}
  const loginEl = document.getElementById("login-screen");
  if(loginEl) loginEl.style.display="none";
  const shell = document.getElementById("app-shell");
  if(shell){
    shell.style.display="flex";
    shell.classList.add("visible");
  }
  const emojiEl = document.getElementById("user-emoji");
  if(emojiEl) emojiEl.textContent=(userEmail && userEmail !== "admin@chivafit.com") ? "👤" : "🛡️";
  const topbarAvatarEl = document.getElementById("topbar-avatar");
  if(topbarAvatarEl) topbarAvatarEl.textContent=(userEmail && userEmail !== "admin@chivafit.com") ? "👤" : "🛡️";
  const nameEl = document.getElementById("user-name-hdr");
  if(nameEl){
    if(userEmail && userEmail !== "admin@chivafit.com"){
      nameEl.textContent = userEmail;
    }else{
      nameEl.textContent="Administrador";
    }
  }
  safeInvokeName("showPage","dashboard");

  const overlay = document.getElementById("app-loader");
  if(overlay){ overlay.style.display="flex"; overlay.style.pointerEvents="auto"; }
  const overlayKill = setTimeout(()=>{ if(overlay){ overlay.style.display="none"; overlay.style.pointerEvents="none"; } }, 15000);

  (async()=>{
    try{
      const connected = await initSupabase();
      if(connected) await loadSupabaseData();
      safeInvokeName("updateBadge");
      if(blingOrders.length) safeInvokeName("startTimers");
      try{ scheduleAutoBlingSync(); }catch(_e){}
      try{ scheduleAutoCarrinhosSync(); }catch(_e){}
      localStorage.setItem('crm_last_bling_sync', new Date().toISOString());
    }catch(e){
      captureError(e, { context: "bootstrap", userEmail });
      console.warn("Erro no bootstrap, usando cache local:", e.message);
      // Fallback: usar dados locais se existirem
      if(!blingOrders.length){
        const cached = safeJsonParse("crm_bling_orders", []);
        blingOrders.length = 0;
        blingOrders.push(...cached);
      }
      if(!yampiOrders.length){
        const cached = safeJsonParse("crm_yampi_orders", []);
        yampiOrders.length = 0;
        yampiOrders.push(...cached);
      }
      safeInvokeName("mergeOrders");
      safeInvokeName("populateUFs");
      safeInvokeName("renderAll");
      safeInvokeName("updateBadge");
      try{ scheduleAutoBlingSync(); }catch(_e){}
      try{ scheduleAutoCarrinhosSync(); }catch(_e){}
    }finally{
      clearTimeout(overlayKill);
      if(overlay){ overlay.style.display="none"; overlay.style.pointerEvents="none"; }
    }
  })();
}
window.enterApp = enterApp;

// ─── CLIENT DRAWER ────────────────────────────────────────────
function openClienteDrawer(clienteId){
  const c = allCustomers.find(x=>x.id===clienteId);
  if(!c) return;

  const fmt = v => v!=null ? "R$ "+Number(v).toLocaleString("pt-BR",{minimumFractionDigits:2}) : "—";
  const fmtN = v => v!=null ? Number(v).toLocaleString("pt-BR") : "—";

  // Get orders for this client
  const orders = allOrders.filter(o=>o.cliente_id===clienteId).sort((a,b)=>new Date(b.data_pedido)-new Date(a.data_pedido));

  const statusColor = {ativo:"var(--green)",inativo:"var(--text-3)",vip:"var(--ai)",risco:"var(--amber)"};
  const sc = statusColor[c.status||""] || "var(--text-3)";

  const kpis = `
    <div class="drawer-kpi-row">
      <div class="drawer-kpi"><div class="drawer-kpi-val">${fmtN(c.total_pedidos)}</div><div class="drawer-kpi-label">Pedidos</div></div>
      <div class="drawer-kpi"><div class="drawer-kpi-val" style="font-size:13px">${fmt(c.total_gasto)}</div><div class="drawer-kpi-label">Total Gasto</div></div>
      <div class="drawer-kpi"><div class="drawer-kpi-val" style="font-size:13px">${fmt(c.ticket_medio)}</div><div class="drawer-kpi-label">Ticket Médio</div></div>
    </div>`;

  const infoRows = [
    c.doc ? `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Documento</span><span>${escapeHTML(c.doc)}</span></div>` : "",
    c.email ? `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Email</span><span>${escapeHTML(c.email)}</span></div>` : "",
    c.telefone ? `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Telefone</span><span>${escapeHTML(c.telefone)}</span></div>` : "",
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Cidade</span><span>${escapeHTML(c.cidade||"—")} ${escapeHTML(c.uf||"")}</span></div>`,
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Canal</span><span>${escapeHTML(c.canal_principal||"—")}</span></div>`,
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Último pedido</span><span>${c.ultimo_pedido ? new Date(c.ultimo_pedido).toLocaleDateString("pt-BR") : "—"}</span></div>`,
    `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px"><span style="color:var(--text-3)">Score recompra</span><span style="color:var(--chiva-primary-light);font-weight:600">${c.score_recompra!=null ? c.score_recompra+"%" : "—"}</span></div>`,
  ].filter(Boolean).join("");

  const ordersHtml = orders.length ? orders.slice(0,8).map(o=>
    `<div class="drawer-order-row" onclick="openPedidoDrawer('${o.id}')">
      <div>
        <div class="drawer-order-num">#${escapeHTML(o.numero_pedido||o.id.slice(0,8))}</div>
        <div class="drawer-order-date">${o.data_pedido ? new Date(o.data_pedido).toLocaleDateString("pt-BR") : "—"} · ${escapeHTML(CH[detectCh(o)]||detectCh(o)||"—")}</div>
      </div>
      <span class="chiva-badge ${o.status==="atendido"?"chiva-badge-green":o.status==="cancelado"?"chiva-badge-red":"chiva-badge-amber"}" style="font-size:9px">${escapeHTML(o.status||"—")}</span>
      <div class="drawer-order-val">${fmt(o.total)}</div>
    </div>`
  ).join("") : `<div style="font-size:12px;color:var(--text-3);padding:12px 0">Nenhum pedido encontrado.</div>`;

  const bodyHTML = `
    ${kpis}
    <div class="drawer-section">
      <div class="drawer-section-title">Informações</div>
      ${infoRows}
    </div>
    <div class="drawer-section">
      <div class="drawer-section-title">Pedidos recentes (${orders.length})</div>
      ${ordersHtml}
    </div>
    ${c.notas ? `<div class="drawer-section"><div class="drawer-section-title">Notas</div><p style="font-size:12px;color:var(--text-2);line-height:1.6">${escapeHTML(c.notas)}</p></div>` : ""}
  `;

  const phone = (c.telefone||"").replace(/\D/g,"");
  const actionsHTML = phone ? `
    <button class="drawer-btn drawer-btn-primary" onclick="openWaModal('${c.id}')">💬 WhatsApp</button>
    <button class="drawer-btn drawer-btn-ghost" onclick="closeDrawer()">Fechar</button>
  ` : `<button class="drawer-btn drawer-btn-ghost" onclick="closeDrawer()">Fechar</button>`;

  const badge = c.status||"";
  openDrawer(c.nome||"Cliente", `${badge} · ${c.cidade||""} ${c.uf||""}`, bodyHTML, actionsHTML);
}

// ─── PEDIDO DRAWER ────────────────────────────────────────────
function openPedidoDrawer(pedidoId){
  const o = allOrders.find(x=>x.id===pedidoId);
  if(!o) return;
  const c = allCustomers.find(x=>x.id===o.cliente_id);
  const fmt = v => v!=null ? "R$ "+Number(v).toLocaleString("pt-BR",{minimumFractionDigits:2}) : "—";

  const infoRows = [
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Número</span><span class="chiva-table-mono">#${escapeHTML(o.numero_pedido||o.id.slice(0,8))}</span></div>`,
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Data</span><span>${o.data_pedido ? new Date(o.data_pedido).toLocaleDateString("pt-BR") : "—"}</span></div>`,
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Canal</span><span>${escapeHTML(CH[detectCh(o)]||detectCh(o)||"—")}</span></div>`,
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Status</span><span><span class="chiva-badge ${o.status==="atendido"?"chiva-badge-green":o.status==="cancelado"?"chiva-badge-red":"chiva-badge-amber"}">${escapeHTML(o.status||"—")}</span></span></div>`,
    `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px"><span style="color:var(--text-3)">Total</span><span style="font-size:15px;font-weight:700;color:var(--chiva-primary-light)">${fmt(o.total)}</span></div>`,
  ].join("");

  const bodyHTML = `
    <div class="drawer-section">
      <div class="drawer-section-title">Detalhes do Pedido</div>
      ${infoRows}
    </div>
    ${c ? `<div class="drawer-section"><div class="drawer-section-title">Cliente</div>
      <div class="drawer-order-row" onclick="openClienteDrawer('${c.id}')">
        <div><div class="drawer-order-num">${escapeHTML(c.nome||"—")}</div><div class="drawer-order-date">${escapeHTML(c.cidade||"")} ${escapeHTML(c.uf||"")}</div></div>
        <div class="drawer-order-val">→</div>
      </div>
    </div>` : ""}
  `;

  openDrawer(`Pedido #${o.numero_pedido||o.id.slice(0,8)}`, o.data_pedido ? new Date(o.data_pedido).toLocaleDateString("pt-BR") : "", bodyHTML,
    `<button class="drawer-btn drawer-btn-ghost" onclick="closeDrawer()">Fechar</button>`);
}

// ─── PEDIDOS PAGE ─────────────────────────────────────────────

function filterClientesByCity(cidade, uf){
  const clients = allCustomers.filter(c =>
    (c.cidade||"").toLowerCase().includes(cidade.toLowerCase()) &&
    (!uf || (c.uf||"").toUpperCase() === uf.toUpperCase())
  );
  if(!clients.length){ toast("Nenhum cliente em "+cidade); return; }
  const body = clients.slice(0,30).map(c=>
    `<div class="drawer-order-row" onclick="openClienteDrawer('${c.id}')">
      <div><div class="drawer-order-num">${escapeHTML(c.nome||"—")}</div><div class="drawer-order-date">${escapeHTML(c.status||"—")} · Canal: ${escapeHTML(c.canal_principal||"—")}</div></div>
      <div class="drawer-order-val">R$ ${(c.total_gasto||0).toLocaleString("pt-BR",{minimumFractionDigits:0})}</div>
    </div>`
  ).join("");
  openDrawer(cidade + (uf?" ("+uf+")":""), clients.length+" clientes", body, "");
}

function renderPedidosPage(){
  const q = String((document.getElementById("ped-search")||{value:""}).value||"").toLowerCase().trim();
  const sf = String((document.getElementById("ped-status-filter")||{value:""}).value||"").toLowerCase().trim();
  const ch = String((document.getElementById("ped-canal-filter")||{value:""}).value||"").toLowerCase().trim();
  const from = parseDateToIso(String((document.getElementById("ped-date-from")||{value:""}).value||"").trim());
  const to = parseDateToIso(String((document.getElementById("ped-date-to")||{value:""}).value||"").trim());
  const minRaw = String((document.getElementById("ped-min")||{value:""}).value||"").trim();
  const minVal = minRaw ? (Number(minRaw)||0) : null;

  let orders = allOrders.slice();
  if(ch) orders = orders.filter(o=>detectCh(o)===ch);
  if(sf) orders = orders.filter(o=>normSt(o.situacao)===sf);
  if(from) orders = orders.filter(o=>String(o.data||"")>=from);
  if(to) orders = orders.filter(o=>String(o.data||"")<=to);
  if(minVal != null) orders = orders.filter(o=>val(o) >= minVal);
  if(q){
    orders = orders.filter(o=>{
      const num = String(o.numero||o.id||"").toLowerCase();
      const nm = String(o.contato?.nome||"").toLowerCase();
      const em = String(o.contato?.email||"").toLowerCase();
      const ph = rawPhone(o.contato?.telefone||"");
      return num.includes(q) || nm.includes(q) || em.includes(q) || (ph && ph.includes(q.replace(/\D/g,"")));
    });
  }
  orders.sort((a,b)=>new Date(b.data||0)-new Date(a.data||0));

  // KPIs
  const total = orders.reduce((s,o)=>s+val(o),0);
  const kpiEl = document.getElementById("ped-kpi-row");
  if(kpiEl) kpiEl.innerHTML = [
    {label:"Total Pedidos",val:orders.length.toLocaleString("pt-BR")},
    {label:"Receita",val:"R$ "+total.toLocaleString("pt-BR",{minimumFractionDigits:0})},
    {label:"Ticket Médio",val:orders.length?"R$ "+(total/orders.length).toLocaleString("pt-BR",{minimumFractionDigits:0}):"—"},
  ].map(k=>`<div class="chiva-card ped-kpi-card"><div class="chiva-card-value">${escapeHTML(k.val)}</div><div class="chiva-card-label">${escapeHTML(k.label)}</div></div>`).join("");

  const wrap = document.getElementById("pedidos-list-wrap");
  if(!wrap) return;
  if(!orders.length){ wrap.innerHTML=`<div class="pedidos-empty">Nenhum pedido encontrado.</div>`; return; }

  const fmt = v => v!=null ? "R$ "+Number(v).toLocaleString("pt-BR",{minimumFractionDigits:2}) : "—";

  wrap.innerHTML = `
    <div class="pedido-table-header">
      <span class="pedido-th">Nº Pedido</span>
      <span class="pedido-th">Cliente</span>
      <span class="pedido-th">Canal</span>
      <span class="pedido-th pedido-th-right">Valor</span>
      <span class="pedido-th pedido-th-center">Status</span>
    </div>
    ${orders.slice(0,200).map(o=>{
      const st = normSt(o.situacao);
      const ch = detectCh(o);
      const oid = escapeJsSingleQuote(String(o.id||o.numero||""));
      return `<div class="pedido-row" onclick="openCRMOrderDrawer('${oid}')">
        <span class="pedido-num">#${escapeHTML(String(o.numero||o.id||"—"))}</span>
        <span class="pedido-client">${escapeHTML(o.contato?.nome||"—")}<br><span class="pedido-date">${escapeHTML(fmtDate(o.data))}</span></span>
        <span class="pedido-canal">${escapeHTML(CH[ch]||ch)}</span>
        <span class="pedido-val">${fmt(val(o))}</span>
        <span class="pedido-status"><span class="sp ${ST_CLASS[st]||"s-outros"}">${escapeHTML(ST_LABEL[st]||st)}</span></span>
      </div>`;
    }).join("")}
  `;
}

function forceLogout(reason){
  if(syncTimer) clearInterval(syncTimer);
  try{ localStorage.removeItem(STORAGE_KEYS.loginFlag); }catch(_e){}
  try{ localStorage.removeItem(STORAGE_KEYS.sessionEmail); }catch(_e){}
  try{
    if(supaClient && supaClient.auth && typeof supaClient.auth.signOut === "function"){
      supaClient.auth.signOut().catch(()=>{});
    }
  }catch(_e){}
  supaSession = null;
  supaAccessToken = "";
  try{
    if(supaAuthUnsub && typeof supaAuthUnsub.unsubscribe === "function") supaAuthUnsub.unsubscribe();
  }catch(_e){}
  supaAuthUnsub = null;
  const loginScreen = document.getElementById("login-screen");
  if(loginScreen) loginScreen.style.display="flex";
  const shell = document.getElementById("app-shell");
  if(shell){
    shell.style.display="none";
    shell.classList.remove("visible");
  }
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  const errEl = document.getElementById("login-error");
  if(errEl){
    errEl.textContent = reason ? String(reason) : "";
    errEl.style.color = reason ? "#f87171" : "";
  }
  const passEl = document.getElementById("login-pass");
  if(passEl) passEl.value = "";
}

function goLogout(){
  if(!confirm("Sair?"))return;
  (async()=>{
    try{
      const url = getSupabaseProjectUrl();
      const key = getSupabaseAnonKey();
      if(url && key && supaClient?.auth && typeof supaClient.auth.signOut === "function"){
        await supaClient.auth.signOut();
      }
    }catch(_e){}
    forceLogout("");
    try{ window.location.replace("./login.html"); }catch(_e){}
  })();
}
window.goLogout = goLogout;

function normalizeAccessEmail(email){
  return String(email||"").trim().toLowerCase();
}

function loadAccessUsers(){
  const users = safeJsonParse("crm_access_users", []);
  return Array.isArray(users) ? users : [];
}

function saveAccessUsers(users){
  localStorage.setItem("crm_access_users", JSON.stringify(users));
  if(supaConnected && supaClient) sbSetConfig("crm_access_users", JSON.stringify(users)).catch(()=>{});
}

function getAccessUserByEmail(email){
  const em = normalizeAccessEmail(email);
  if(!em) return null;
  const users = loadAccessUsers();
  return users.find(x => normalizeAccessEmail(x.email) === em) || null;
}

async function hydrateAccessUsersFromSupabaseForLogin(){
  const url = getSupabaseProjectUrl();
  const key = getSupabaseAnonKey();
  if(!url || !key) return false;
  try{
    const tmp = getSupabaseClient(url, key);
    const {data, error} = await tmp
      .from("configuracoes")
      .select("valor_texto")
      .eq("chave","crm_access_users")
      .maybeSingle();
    if(error) return false;
    const raw = data?.valor_texto;
    if(!raw) return false;
    localStorage.setItem("crm_access_users", raw);
    return true;
  }catch(_e){
    return false;
  }
}

function bytesToBase64(bytes){
  let bin = "";
  for(let i=0;i<bytes.length;i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function sha256Hex(str){
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for(let i=0;i<bytes.length;i++) hex += bytes[i].toString(16).padStart(2,"0");
  return hex;
}

async function hashPassword(password, salt){
  return sha256Hex(String(salt||"")+"::"+String(password||""));
}

async function verifyAccessUser(email, password){
  const em = normalizeAccessEmail(email);
  if(!em || !password) return false;
  const users = loadAccessUsers();
  const u = users.find(x => normalizeAccessEmail(x.email) === em);
  if(!u || !u.salt || !u.hash) return false;
  const h = await hashPassword(password, u.salt);
  return h === u.hash;
}

function generateBootstrapPassword(){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for(let i=0;i<bytes.length;i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function showBootstrapHintIfNeeded(pass){
  const loggedIn = localStorage.getItem(STORAGE_KEYS.loginFlag) === "true";
  if(loggedIn) return;
  const errEl = document.getElementById("login-error");
  if(!errEl) return;
  if(String(errEl.textContent||"").trim()) return;
  errEl.textContent = `Primeiro acesso: use admin@chivafit.com e a senha temporária ${pass}.`;
  errEl.style.color = "rgba(52,211,153,1)";
}

async function ensureBootstrapAdminUser(){
  if(!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) return;
  const url = getSupabaseProjectUrl();
  const key = getSupabaseAnonKey();
  if(url && key) return;
  const users = loadAccessUsers();
  if(users.length) return;

  const storedPlain = localStorage.getItem("crm_bootstrap_pass");
  const pass = storedPlain || generateBootstrapPassword();

  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToBase64(saltBytes);
  const hash = await hashPassword(pass, salt);

  const email = "admin@chivafit.com";
  saveAccessUsers([{ email, salt, hash, created_at: new Date().toISOString(), bootstrap: true }]);
  if(!storedPlain){
    localStorage.setItem("crm_bootstrap_pass", pass);
    localStorage.setItem("crm_bootstrap_pass_ts", new Date().toISOString());
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", ()=>showBootstrapHintIfNeeded(pass), { once:true });
  }else{
    showBootstrapHintIfNeeded(pass);
  }
}

async function addAccessUser(){
  const emailEl = document.getElementById("inp-access-email");
  const passEl = document.getElementById("inp-access-pass");
  const st = document.getElementById("access-status");
  const email = normalizeAccessEmail(emailEl?.value || "");
  const pass = String(passEl?.value || "");
  if(st){ st.textContent=""; st.className="setup-status"; }

  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    if(st){ st.textContent="⚠ Informe um e-mail válido."; st.className="setup-status s-err"; }
    return;
  }
  if(!pass || pass.length < 6){
    if(st){ st.textContent="⚠ A senha deve ter pelo menos 6 caracteres."; st.className="setup-status s-err"; }
    return;
  }

  const users = loadAccessUsers();
  if(users.some(u => normalizeAccessEmail(u.email) === email)){
    if(st){ st.textContent="⚠ Este e-mail já está cadastrado."; st.className="setup-status s-err"; }
    return;
  }

  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToBase64(saltBytes);
  const hash = await hashPassword(pass, salt);

  users.push({ email, salt, hash, created_at: new Date().toISOString() });
  saveAccessUsers(users);
  if(emailEl) emailEl.value = "";
  if(passEl) passEl.value = "";
  renderAccessUsers();
  if(st){ st.textContent="✓ Usuário adicionado."; st.className="setup-status s-ok"; }
}

function removeAccessUser(email){
  const em = normalizeAccessEmail(email);
  const users = loadAccessUsers().filter(u => normalizeAccessEmail(u.email) !== em);
  saveAccessUsers(users);
  renderAccessUsers();
}

function renderAccessUsers(){
  const wrap = document.getElementById("access-users-list");
  if(!wrap) return;
  const users = loadAccessUsers().slice().sort((a,b)=>String(a.email||"").localeCompare(String(b.email||"")));
  if(!users.length){
    wrap.innerHTML = `<div style="font-size:11px;color:var(--text-3)">Nenhum usuário cadastrado.</div>`;
    return;
  }
  wrap.innerHTML = users.map(u=>{
    const em = escapeHTML(u.email||"");
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border-sub);border-radius:10px;background:var(--card);margin-bottom:6px">
      <div style="min-width:0">
        <div style="font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${em}</div>
        <div style="font-size:10px;color:var(--text-3)">${u.created_at ? new Date(u.created_at).toLocaleString("pt-BR") : ""}</div>
      </div>
      <button class="btn" style="padding:7px 10px;font-size:10px" onclick="removeAccessUser('${em.replace(/'/g,"&#39;")}')">Remover</button>
    </div>`;
  }).join("");
}

function hydrateConfigPage(){
  const u = getSupabaseProjectUrl();
  const k = getSupabaseAnonKey();
  const urlEl = document.getElementById("inp-supa-url");
  const keyEl = document.getElementById("inp-supa-key");
  if(urlEl) urlEl.value = u;
  if(keyEl) keyEl.value = k;

  const from = localStorage.getItem("crm_shopify_from") || "";
  const to = localStorage.getItem("crm_shopify_to") || "";
  const fromEl = document.getElementById("shop-date-from");
  const toEl = document.getElementById("shop-date-to");
  if(fromEl && from) fromEl.value = from;
  if(toEl && to) toEl.value = to;

  loadTemplatesUI();
  renderAccessUsers();
  refreshBlingAutoCard();
  startBlingAutoCardRefresh();
}

let blingAutoCardTimer = null;

function startBlingAutoCardRefresh(){
  if(blingAutoCardTimer) clearInterval(blingAutoCardTimer);
  blingAutoCardTimer = setInterval(()=>{
    const active = document.getElementById("page-config")?.classList.contains("active");
    if(!active) return;
    refreshBlingAutoCard();
  }, 30000);
}

function fmtDateTimePtBR(iso){
  const ts = iso ? new Date(String(iso)).getTime() : NaN;
  if(!isFinite(ts)) return "—";
  return new Date(ts).toLocaleString("pt-BR");
}

function blingStateBadge(state){
  const el = document.getElementById("bling-auto-state");
  if(!el) return;
  const s = String(state||"").toLowerCase();
  const label =
    s === "ok" ? "OK" :
    s === "running" ? "Executando" :
    s === "late" ? "Atrasado" :
    s === "error" ? "Erro" :
    s === "waiting" ? "Aguardando" :
    "—";
  const cls =
    s === "ok" ? "chiva-badge chiva-badge-green" :
    s === "running" ? "chiva-badge chiva-badge-amber" :
    s === "late" ? "chiva-badge chiva-badge-amber" :
    s === "waiting" ? "chiva-badge chiva-badge-amber" :
    s === "error" ? "chiva-badge chiva-badge-red" :
    "chiva-badge";
  el.textContent = label;
  el.className = cls;
}

async function refreshBlingAutoCard(){
  const card = document.getElementById("bling-auto-card");
  if(!card) return;

  const lastEl = document.getElementById("bling-auto-last");
  const nextEl = document.getElementById("bling-auto-next");
  const ordersEl = document.getElementById("bling-auto-orders");
  const productsEl = document.getElementById("bling-auto-products");
  const msgEl = document.getElementById("bling-auto-message");

  let lastOrdersIso = "";
  let lastProductsIso = "";

  if(supaConnected && supaClient){
    try{
      const {data} = await supaClient
        .from("configuracoes")
        .select("chave,valor_texto")
        .in("chave", ["ultima_sync_bling","ultima_sync_bling_produtos"])
        .limit(10);
      (data||[]).forEach(r=>{
        const k = String(r?.chave||"").trim();
        const v = String(r?.valor_texto||"").trim();
        if(k === "ultima_sync_bling") lastOrdersIso = v;
        if(k === "ultima_sync_bling_produtos") lastProductsIso = v;
      });
    }catch(_e){}
  }

  const lastOrdersTs = lastOrdersIso ? new Date(lastOrdersIso).getTime() : NaN;
  const lastProductsTs = lastProductsIso ? new Date(lastProductsIso).getTime() : NaN;
  const lastTs = Math.max(isFinite(lastOrdersTs)?lastOrdersTs:0, isFinite(lastProductsTs)?lastProductsTs:0) || 0;
  const lastIso = lastTs ? new Date(lastTs).toISOString() : "";

  const nowTs = Date.now();
  const ageMin = lastTs ? Math.max(0, Math.floor((nowTs - lastTs) / 60000)) : null;

  let state = "waiting";
  if(lastTs){
    if(ageMin != null && ageMin <= 30) state = "ok";
    else if(ageMin != null && ageMin <= 180) state = "late";
    else state = "error";
  }
  blingStateBadge(state);

  if(lastEl) lastEl.textContent = lastIso ? fmtDateTimePtBR(lastIso) : "—";

  const nextTs = lastTs ? (lastTs + 20*60*1000) : 0;
  if(nextEl){
    if(!lastTs) nextEl.textContent = "—";
    else nextEl.textContent = fmtDateTimePtBR(new Date(nextTs).toISOString());
  }

  if(ordersEl){
    const n = Array.isArray(blingOrders) ? blingOrders.length : 0;
    ordersEl.textContent = n ? String(n) : "—";
  }
  if(productsEl){
    const n = Array.isArray(blingProducts) ? blingProducts.length : 0;
    productsEl.textContent = n ? String(n) : "—";
  }

  if(msgEl){
    let msg = "";
    if(state === "waiting") msg = "Aguardando primeira sincronização.";
    if(state === "late") msg = "Sem atualização recente. Verifique se a sincronização está rodando.";
    if(state === "error") msg = "Falha ou atraso crítico. Tente sincronizar manualmente ou verifique o backend.";
    msgEl.textContent = msg;
    msgEl.style.display = msg ? "block" : "none";
  }
}

ensureBootstrapAdminUser().catch(()=>{});

// ═══════════════════════════════════════════════════
//  CREDENTIALS
// ═══════════════════════════════════════════════════
function saveCreds(){
  localStorage.setItem("crm_cid",CID); localStorage.setItem("crm_csec",CSEC);
  localStorage.setItem("crm_shop",SHOP); localStorage.setItem("crm_shopkey",SHOPKEY);
}

function saveAlertDays(){
  const el = document.getElementById("alert-days");
  if(!el) return;
  const v = String(el.value||"").trim();
  if(!v) return;
  localStorage.setItem("crm_alertdays", v);
  if(supaConnected && supaClient){
    sbSetConfig("alert_days", v).catch(()=>{});
  }
}

function saveSupabaseConfig(){
  let url = document.getElementById("inp-supa-url")?.value?.trim() || "";
  const key = document.getElementById("inp-supa-key")?.value?.trim() || "";
  const st = document.getElementById("supa-status");

  if(!url || !key){
    if(st){ st.textContent="⚠ Preencha URL e chave."; st.className="setup-status s-err"; }
    return;
  }

  // Auto-completar URL se o usuário colou apenas o ID do projeto
  if(!url.includes(".") && !url.includes("://")){
    url = `https://${url}.supabase.co`;
    const urlEl = document.getElementById("inp-supa-url");
    if(urlEl) urlEl.value = url;
  } else if(!url.startsWith("http")){
    url = `https://${url}`;
    const urlEl = document.getElementById("inp-supa-url");
    if(urlEl) urlEl.value = url;
  }

  // Limpar chaves antigas e salvar novas (usando apenas o prefixo crm_ como padrão)
  const keys = ["crm_supa_url", "crm_supa_key", "supa_url", "supa_key", "supabase_url", "supabase_key"];
  keys.forEach(k => localStorage.removeItem(k));

  localStorage.setItem("crm_supa_url", url);
  localStorage.setItem("crm_supa_key", key);

  if(st){ st.textContent="✓ Salvo! Conectando..."; st.className="setup-status s-ok"; }
  renderSupabaseShareLink();

  setTimeout(async()=>{
    const connected = await initSupabase();
    if(connected){
      try{ await loadSupabaseData(); }catch(e){ console.error("[supabase] loadSupabaseData falhou:", e?.message||e); }
      toast("✓ Supabase conectado com sucesso!");
    }
  }, 300);
}

function getSupabaseShareUrl(){
  const u =
    (document.getElementById("inp-supa-url")?.value || "").trim() ||
    String(localStorage.getItem("crm_supa_url") || localStorage.getItem("supa_url") || localStorage.getItem("supabase_url") || "").trim();
  const k =
    (document.getElementById("inp-supa-key")?.value || "").trim() ||
    String(localStorage.getItem("crm_supa_key") || localStorage.getItem("supa_key") || localStorage.getItem("supabase_key") || "").trim();
  if(!u || !k) return "";
  let base = "";
  try{
    base = String(window.location.origin || "") + String(window.location.pathname || "");
  }catch(_e){}
  if(!base) base = String(window.location.href || "").split("#")[0].split("?")[0];
  const params = new URLSearchParams();
  params.set("supa_url", u);
  params.set("supa_key", k);
  return base + "?" + params.toString() + "#config";
}

function renderSupabaseShareLink(){
  const el = document.getElementById("supa-share-url");
  const btn = document.getElementById("btn-copy-supa-link");
  if(!el && !btn) return;
  const link = getSupabaseShareUrl();
  if(el) el.value = link;
  if(btn) btn.disabled = !link;
}

function copySupabaseShareLink(){
  const link = getSupabaseShareUrl();
  if(!link){
    toast("⚠ Configure o Supabase primeiro.");
    return;
  }
  const fallback = ()=>{
    try{
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("✓ Link copiado");
    }catch(_e){
      toast("⚠ Não foi possível copiar o link");
    }
  };
  try{
    if(navigator?.clipboard?.writeText){
      navigator.clipboard.writeText(link).then(()=>toast("✓ Link copiado")).catch(fallback);
    }else{
      fallback();
    }
  }catch(_e){
    fallback();
  }
}
// Load supa config into form on page open
document.addEventListener("DOMContentLoaded", ()=>{
  bindDateMasks(document);
  const u =
    localStorage.getItem("crm_supa_url") ||
    localStorage.getItem("supa_url") ||
    localStorage.getItem("supabase_url") ||
    "";
  const k =
    localStorage.getItem("crm_supa_key") ||
    localStorage.getItem("supa_key") ||
    localStorage.getItem("supabase_key") ||
    "";

  const urlEl = document.getElementById("inp-supa-url");
  const keyEl = document.getElementById("inp-supa-key");
  if(urlEl){ urlEl.value = u; }
  if(keyEl){ keyEl.value = k; }
  renderSupabaseShareLink();
  if(urlEl) urlEl.addEventListener("input", renderSupabaseShareLink);
  if(keyEl) keyEl.addEventListener("input", renderSupabaseShareLink);

  try{
    const fromEl = document.getElementById("date-from");
    const toEl = document.getElementById("date-to");
    if(fromEl && !fromEl.value){
      const d = new Date();
      d.setDate(d.getDate() - 365);
      fromEl.value = fmtDate(d.toISOString().slice(0,10));
    }
    if(toEl && !toEl.value){
      toEl.value = fmtDate(new Date().toISOString().slice(0,10));
    }
  }catch(_e){}
});

function saveAIKey(){
  toast("A chave da IA agora é gerenciada com segurança no servidor.");
}

function getSyncCtx(){
  return {
    isSupaReady: ()=>!!(supaConnected && supaClient),
    getSupaClient: ()=>supaClient,
    getSupaFnBase,
    supaFnHeaders,
    supaFnHeadersAsync,
    normalizeOrderForCRM,
    mergeOrders,
    populateUFs,
    upsertOrdersToSupabase,
    renderAll,
    startTimers,
    toast,
    sbSetConfig,
    blingOrders,
    blingProducts,
    yampiOrders,
    loadOrdersFromSupabaseForCRM,
    loadCarrinhosAbandonadosFromSupabase,
    fetchYampiAbandoned,
    normalizeCarrinhoAbandonado,
    getCarrinhosAbandonados: ()=>carrinhosAbandonados,
    setCarrinhosAbandonados: (next)=>{ carrinhosAbandonados = Array.isArray(next) ? next : []; },
    reconcileCarrinhosRecuperados,
    recomputeCarrinhosScoresAndPersist,
    upsertCarrinhosAbandonadosToSupabase,
    renderCarrinhosAbandonados,
    renderProdutos
  };
}

// ═══════════════════════════════════════════════════
//  BLING
// ═══════════════════════════════════════════════════
function scheduleAutoBlingSync(){
  return scheduleAutoBlingSyncImpl(getSyncCtx());
}

async function syncBling(){
  const bar = document.getElementById("sync-bar");
  const barTxt = document.getElementById("sync-txt-bar");
  if(bar) bar.classList.add("show");
  if(barTxt) barTxt.textContent = "⟳ Sincronizando Bling…";
  const opts = arguments?.[0];
  try{
    const res = await withRetry(()=> syncBlingImpl(getSyncCtx(), opts), 3, 2000);
    checkEstoqueCritico();
    try{ refreshBlingAutoCard(); }catch(_e){}
    if(barTxt) barTxt.textContent = "✓ Bling sincronizado";
    setTimeout(()=>{ if(bar) bar.classList.remove("show"); }, 2500);
    return res;
  }catch(e){
    const msg = e?.message || "Verifique as configurações do Bling";
    if(barTxt) barTxt.textContent = "⚠ Bling: " + msg;
    toast("⚠ Bling: " + msg, "error");
    setTimeout(()=>{ if(bar) bar.classList.remove("show"); }, 6000);
    throw e;
  }
}

async function syncBlingProdutos(){
  const bar = document.getElementById("sync-bar");
  const barTxt = document.getElementById("sync-txt-bar");
  if(bar) bar.classList.add("show");
  if(barTxt) barTxt.textContent = "⟳ Sincronizando produtos Bling…";
  try{
    const res = await syncBlingProdutosImpl(getSyncCtx());
    checkEstoqueCritico();
    try{ refreshBlingAutoCard(); }catch(_e){}
    if(barTxt) barTxt.textContent = "✓ Produtos sincronizados";
    setTimeout(()=>{ if(bar) bar.classList.remove("show"); }, 2500);
    return res;
  }catch(e){
    const msg = e?.message || "Erro ao sincronizar produtos";
    if(barTxt) barTxt.textContent = "⚠ Produtos: " + msg;
    toast("⚠ Produtos Bling: " + msg, "error");
    setTimeout(()=>{ if(bar) bar.classList.remove("show"); }, 6000);
    throw e;
  }
}

async function backfillBlingEnderecos(){
  return backfillBlingEnderecosImpl(getSyncCtx());
}

// ═══════════════════════════════════════════════════
//  YAMPI
// ═══════════════════════════════════════════════════
function scheduleAutoCarrinhosSync(){
  return scheduleAutoCarrinhosSyncImpl(getSyncCtx());
}

async function syncYampi(){
  const bar = document.getElementById("sync-bar");
  const barTxt = document.getElementById("sync-txt-bar");
  if(bar) bar.classList.add("show");
  if(barTxt) barTxt.textContent = "⟳ Sincronizando Yampi…";
  try{
    const res = await withRetry(()=> syncYampiImpl(getSyncCtx()), 3, 2000);
    checkEstoqueCritico();
    if(barTxt) barTxt.textContent = "✓ Yampi sincronizado";
    setTimeout(()=>{ if(bar) bar.classList.remove("show"); }, 2500);
    return res;
  }catch(e){
    const msg = e?.message || "Verifique as configurações do Yampi";
    if(barTxt) barTxt.textContent = "⚠ Yampi: " + msg;
    toast("⚠ Yampi: " + msg, "error");
    setTimeout(()=>{ if(bar) bar.classList.remove("show"); }, 6000);
    throw e;
  }
}

function normalizeYampiOrder(o){
  const next = o || {};
  next._source = "yampi";
  next.numero = next.numero || next.numero_pedido || next.order_number || next.number || next.name || next.id;
  next.data = next.data || next.data_pedido || next.created_at || next.updated_at || "";
  if(next.data) next.data = String(next.data).slice(0,10);

  const total =
    Number(next.total ?? next.total_price ?? next.valor_total ?? next.amount_total ?? 0) || 0;
  next.total = total;
  next.totalProdutos = total;

  const statusRaw = next.status || next.status_atual || next.financial_status || next.payment_status || "";
  next.situacao = next.situacao || { nome: String(statusRaw || "").toLowerCase() };

  const cliente = next.cliente || next.customer || next.buyer || {};
  const endereco = cliente.endereco || cliente.address || next.endereco_entrega || next.shipping_address || {};
  const nome = cliente.nome || cliente.name || [cliente.first_name, cliente.last_name].filter(Boolean).join(" ").trim();
  
  // Extração completa para persistência
  next.contato = next.contato || {
    nome: nome || "Cliente",
    cpfCnpj: cliente.cpf || cliente.cnpj || cliente.document || cliente.document_number || "",
    email: cliente.email || next.email || "",
    telefone: cliente.telefone || cliente.phone || next.phone || "",
    endereco: {
      municipio: endereco.cidade || endereco.city || endereco.municipio || "",
      uf: normalizeUF(endereco.uf || endereco.state || endereco.province || endereco.estado || ""),
      logradouro: endereco.logradouro || endereco.address1 || endereco.endereco || endereco.street || "",
      numero: endereco.numero || endereco.number || "",
      bairro: endereco.bairro || endereco.neighborhood || endereco.district || "",
      cep: endereco.cep || endereco.zipcode || endereco.zip || ""
    }
  };

  const itens = next.itens || next.items || next.produtos || next.products || next.line_items || [];
  if(Array.isArray(itens)){
    next.itens = itens.filter(Boolean).map(it=>({
      descricao: it?.descricao || it?.title || it?.nome || it?.name || it?.produto || "",
      codigo: it?.codigo || it?.sku || it?.id || "",
      quantidade: Number(it?.quantidade ?? it?.quantity ?? it?.qty ?? 1) || 1,
      valor: Number(it?.valor ?? it?.price ?? it?.preco ?? 0) || 0
    }));
  }else{
    next.itens = [];
  }

  next._canal = next._canal || String(next.canal || next.channel || "yampi").toLowerCase();
  return next;
}

function normalizeCarrinhoAbandonado(raw){
  const c = raw || {};
  const checkoutId = String(c.checkout_id || c.id || c.checkoutId || c.uuid || "").trim();
  const nome = String(c.cliente_nome || c.customer_name || c.nome || c.customer?.name || c.cliente?.nome || "").trim();
  const email = String(c.email || c.customer_email || c.customer?.email || c.cliente?.email || "").trim().toLowerCase();
  const telefone = String(c.telefone || c.phone || c.customer_phone || c.customer?.phone || c.cliente?.telefone || "").trim();
  const valor = Number(c.valor ?? c.total ?? c.amount ?? c.total_price ?? 0) || 0;
  const produtos = c.produtos || c.items || c.itens || c.products || c.line_items || [];
  const criado = c.criado_em || c.created_at || c.createdAt || c.created || c.data || null;
  const criadoEm = criado ? new Date(criado).toISOString() : new Date().toISOString();
  const recuperado = !!(c.recuperado || c.recovered || c.recovered_at || c.recuperado_em);
  const recuperadoEm = c.recuperado_em || c.recovered_at || null;
  const linkFinalizacao = String(c.link_finalizacao || c.checkout_url || c.recovery_url || c.recover_url || c.url || "").trim() || null;
  const score = c.score_recuperacao == null ? null : (Number(c.score_recuperacao||0) || 0);
  const lastEtapa = String(c.last_etapa_enviada || c.last_whatsapp_stage || "").trim() || null;
  const lastAtRaw = c.last_mensagem_at || c.last_whatsapp_at || null;
  const lastAt = lastAtRaw ? new Date(lastAtRaw).toISOString() : null;
  return {
    checkout_id: checkoutId,
    cliente_nome: nome,
    telefone,
    email,
    valor,
    produtos,
    criado_em: criadoEm,
    recuperado,
    recuperado_em: recuperadoEm,
    recuperado_pedido_id: c.recuperado_pedido_id || c.recovered_order_id || null,
    link_finalizacao: linkFinalizacao,
    score_recuperacao: score,
    last_etapa_enviada: lastEtapa,
    last_mensagem_at: lastAt
  };
}

// Função utilitária para obter valor numérico de um pedido
function val(o){ 
  if(!o) return 0;
  const v = o.total_pedido || o.total_venda || o.totalProdutos || o.total || o.valor || 0;
  return parseFloat(v) || 0; 
}
function getPedidoItens(o){
  const candidate =
    o?.itens != null ? o.itens :
    o?.items != null ? o.items :
    o?.produtos != null ? o.produtos :
    o?.itensPedido != null ? o.itensPedido :
    null;

  let raw = [];
  if(Array.isArray(candidate)){
    raw = candidate;
  }else if(typeof candidate === "string"){
    const s = candidate.trim();
    if(s){
      try{
        const parsed = JSON.parse(s);
        if(Array.isArray(parsed)) raw = parsed;
        else if(parsed && typeof parsed === "object"){
          if(Array.isArray(parsed.itens)) raw = parsed.itens;
          else if(Array.isArray(parsed.items)) raw = parsed.items;
          else if(Array.isArray(parsed.produtos)) raw = parsed.produtos;
          else if(Array.isArray(parsed.itensPedido)) raw = parsed.itensPedido;
          else if(Array.isArray(parsed.item)) raw = parsed.item;
          else if(parsed.item && typeof parsed.item === "object") raw = [parsed.item];
        }
      }catch(_e){}
    }
  }else if(candidate && typeof candidate === "object"){
    if(Array.isArray(candidate.itens)) raw = candidate.itens;
    else if(Array.isArray(candidate.items)) raw = candidate.items;
    else if(Array.isArray(candidate.produtos)) raw = candidate.produtos;
    else if(Array.isArray(candidate.itensPedido)) raw = candidate.itensPedido;
    else if(Array.isArray(candidate.item)) raw = candidate.item;
    else if(candidate.item && typeof candidate.item === "object") raw = [candidate.item];
  }

  if(!Array.isArray(raw) || !raw.length) return [];
  const out = [];
  raw.filter(Boolean).forEach(it=>{
    const base = (it && typeof it === "object" && it.item && typeof it.item === "object") ? it.item : it;
    const descricao = String(base?.descricao || base?.produto_nome || base?.title || base?.nome || base?.name || base?.produto || base?.product_name || "").trim();
    const codigo = String(base?.codigo || base?.sku || base?.id || base?.product_id || base?.produto_id || "").trim();
    const quantidade = Number(base?.quantidade ?? base?.quantity ?? base?.qty ?? 1) || 1;
    const valor = Number(base?.valor ?? base?.valor_unitario ?? base?.price ?? base?.preco ?? 0) || 0;
    const valor_total = base?.valor_total != null ? (Number(base.valor_total) || 0) : (quantidade * valor);
    if(!descricao && !codigo) return;
    out.push({ descricao, codigo, quantidade, valor, valor_total });
  });
  return out;
}
function cliKey(o){
  const contato = o?.contato || {};
  const docDigits = String(contato.cpfCnpj || contato.numeroDocumento || "").replace(/\D/g,"");
  if(docDigits.length===11 || docDigits.length===14) return docDigits;
  const email = String(contato.email || "").trim().toLowerCase();
  if(email) return email;
  const phoneDigits = String(contato.telefone || contato.celular || "").replace(/\D/g,"");
  if(phoneDigits.length>=10) return phoneDigits;
  return String(contato.nome || "").trim();
}
function orderCustomerKey(o){
  const cid = String(o?.cliente_id || "").trim();
  if(cid) return cid;
  return cliKey(o);
}


function minutosDesdeIso(isoStr){
  const ts = isoStr ? new Date(isoStr).getTime() : NaN;
  if(!isFinite(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 60000));
}

function fmtTempoDesde(mins){
  if(mins == null) return "—";
  if(mins < 60) return mins + "min";
  const h = Math.floor(mins/60);
  if(h < 48) return h + "h";
  const d = Math.floor(h/24);
  return d + "d";
}

function sugerirEtapaMensagem(mins){
  if(mins == null) return {id:"", label:"—"};
  if(mins < 10) return {id:"aguardar", label:"Aguardar"};
  if(mins >= 10 && mins < 120) return {id:"ajuda", label:"Ajuda (10–20min)"};
  if(mins >= 360 && mins < 1440) return {id:"link", label:"Link (6h)"};
  if(mins >= 1440 && mins < 4320) return {id:"incentivo", label:"Incentivo leve (24h)"};
  return {id:"tarde", label:"Fora da janela"};
}

function sugerirEtapaParaCarrinho(c, mins){
  const base = sugerirEtapaMensagem(mins);
  if(!c || c.recuperado) return {id:"", label:"—"};
  const last = String(c.last_etapa_enviada || "").trim();
  if(!last) return base;
  if(base.id !== last) return base;
  if(mins != null && mins >= 1440 && last !== "incentivo") return {id:"incentivo", label:"Incentivo leve (24h)"};
  if(mins != null && mins >= 360 && mins < 1440 && last !== "link") return {id:"link", label:"Link (6h)"};
  return {id:"aguardar", label:"Já enviado"};
}

function prioridadePorScore(score){
  const s = Number(score||0)||0;
  if(s >= 75) return {id:"alta", label:"Alta"};
  if(s >= 45) return {id:"media", label:"Média"};
  return {id:"baixa", label:"Baixa"};
}

function normalizeUF(raw){
  const s = String(raw||"").trim();
  if(!s) return "";
  const up = s.toUpperCase().trim();
  if(/^[A-Z]{2}$/.test(up)) return up;
  const norm = up
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const map = {
    "ACRE":"AC",
    "ALAGOAS":"AL",
    "AMAPA":"AP",
    "AMAZONAS":"AM",
    "BAHIA":"BA",
    "CEARA":"CE",
    "DISTRITO FEDERAL":"DF",
    "ESPIRITO SANTO":"ES",
    "GOIAS":"GO",
    "MARANHAO":"MA",
    "MATO GROSSO":"MT",
    "MATO GROSSO DO SUL":"MS",
    "MINAS GERAIS":"MG",
    "PARA":"PA",
    "PARAIBA":"PB",
    "PARANA":"PR",
    "PERNAMBUCO":"PE",
    "PIAUI":"PI",
    "RIO DE JANEIRO":"RJ",
    "RIO GRANDE DO NORTE":"RN",
    "RIO GRANDE DO SUL":"RS",
    "RONDONIA":"RO",
    "RORAIMA":"RR",
    "SANTA CATARINA":"SC",
    "SAO PAULO":"SP",
    "SERGIPE":"SE",
    "TOCANTINS":"TO",
    "FEDERAL DISTRICT":"DF"
  };
  if(map[norm]) return map[norm];
  const letters = norm.replace(/ /g,"");
  if(letters.length>=2) return letters.slice(0,2);
  return "";
}

function buildClienteLookupParaCarrinhos(){
  const cliMap = buildCli(Array.isArray(allOrders)?allOrders:[]);
  const byEmail = {};
  const byPhone = {};
  Object.values(cliMap).forEach(c=>{
    const sc = calcCliScores(c);
    const email = String(c.email||"").trim().toLowerCase();
    const phone = rawPhone(c.telefone||"");
    const info = {n: sc.n, status: sc.status, ltv: sc.ltv};
    if(email) byEmail[email] = info;
    if(phone) byPhone[phone] = info;
  });
  return {byEmail, byPhone};
}

function calcularScoreRecuperacaoCarrinho(c, cliLookup){
  const mins = minutosDesdeIso(c?.criado_em);
  const valor = Number(c?.valor||0)||0;
  const email = String(c?.email||"").trim().toLowerCase();
  const phone = rawPhone(c?.telefone||"");
  const cli = (email && cliLookup?.byEmail?.[email]) || (phone && cliLookup?.byPhone?.[phone]) || null;

  const valueCap = 500;
  const valueScore = clamp01(Math.log10(Math.max(0, Math.min(valor, valueCap)) + 1) / Math.log10(valueCap + 1));
  const hasBoughtScore = cli && cli.n > 0 ? 1 : 0;
  const historyScore =
    cli && cli.status === "vip" ? 1 :
    cli && cli.n >= 2 ? 0.75 :
    cli && cli.n === 1 ? 0.35 :
    0;
  const timeScore =
    mins == null ? 0.4 :
    mins < 60 ? 1 :
    mins < 360 ? 0.8 :
    mins < 1440 ? 0.6 :
    mins < 4320 ? 0.4 :
    0.2;

  const score = Math.round(100 * (
    0.40 * valueScore +
    0.25 * hasBoughtScore +
    0.20 * historyScore +
    0.15 * timeScore
  ));
  return {score, mins, cli};
}

async function recomputeCarrinhosScoresAndPersist(){
  try{
    carrinhosAbandonados = safeJsonParse("crm_carrinhos_abandonados", []) || carrinhosAbandonados || [];
  }catch(_e){}
  if(!Array.isArray(carrinhosAbandonados) || !carrinhosAbandonados.length) return;
  const lookup = buildClienteLookupParaCarrinhos();
  let changed = false;
  const updated = carrinhosAbandonados.map(raw=>{
    const c = normalizeCarrinhoAbandonado(raw);
    if(!c.checkout_id) return c;
    if(c.recuperado) return c;
    const {score} = calcularScoreRecuperacaoCarrinho(c, lookup);
    const prev = c.score_recuperacao == null ? null : (Number(c.score_recuperacao||0)||0);
    if(prev == null || Math.abs(prev - score) >= 1){
      changed = true;
      return {...c, score_recuperacao: score};
    }
    return c;
  });
  if(!changed) return;
  carrinhosAbandonados = updated;
  localStorage.setItem("crm_carrinhos_abandonados", JSON.stringify(carrinhosAbandonados));
  if(supaConnected && supaClient) await upsertCarrinhosAbandonadosToSupabase(carrinhosAbandonados);
}

async function loadCarrinhosAbandonadosFromSupabase(){
  if(!supaConnected || !supaClient) return;
  try{
    let data=null;
    let error=null;
    ({data, error} = await supaClient
      .from("carrinhos_abandonados")
      .select("checkout_id,cliente_nome,telefone,email,valor,produtos,criado_em,recuperado,recuperado_em,recuperado_pedido_id,score_recuperacao,link_finalizacao,last_etapa_enviada,last_mensagem_at")
      .order("criado_em", { ascending: false })
      .limit(10000));
    if(error){
      ({data, error} = await supaClient
        .from("carrinhos_abandonados")
        .select("checkout_id,cliente_nome,telefone,email,valor,produtos,criado_em,recuperado,recuperado_em,recuperado_pedido_id")
        .order("criado_em", { ascending: false })
        .limit(10000));
    }
    if(error || !Array.isArray(data)) return;
    carrinhosAbandonados = data.map(normalizeCarrinhoAbandonado);
    safeSetItem("crm_carrinhos_abandonados", JSON.stringify(carrinhosAbandonados));
    if(document.getElementById("page-comercial")?.classList.contains("active")) {
      if(typeof window.renderCarrinhosAbandonados === "function") window.renderCarrinhosAbandonados();
    }
    await reconcileCarrinhosRecuperados();
    await recomputeCarrinhosScoresAndPersist();
  }catch(_e){}
}

async function upsertCarrinhosAbandonadosToSupabase(list){
  if(!supaConnected || !supaClient) return;
  if(!Array.isArray(list) || !list.length) return;
  const nowIso = new Date().toISOString();
  const baseRows = list.filter(x=>x && x.checkout_id).map(c=>({
    checkout_id: String(c.checkout_id),
    cliente_nome: c.cliente_nome || null,
    telefone: c.telefone || null,
    email: c.email || null,
    valor: Number(c.valor||0) || 0,
    produtos: c.produtos && typeof c.produtos === "object" ? c.produtos : [],
    criado_em: c.criado_em || null,
    recuperado: !!c.recuperado,
    recuperado_em: c.recuperado_em || null,
    recuperado_pedido_id: c.recuperado_pedido_id || null,
    score_recuperacao: c.score_recuperacao == null ? null : (Number(c.score_recuperacao||0) || 0),
    link_finalizacao: c.link_finalizacao || null,
    last_etapa_enviada: c.last_etapa_enviada || null,
    last_mensagem_at: c.last_mensagem_at || null
  }));
  if(!baseRows.length) return;
  const rowsWithUpdatedAt = baseRows.map(r=>({ ...r, updated_at: nowIso }));
  const rowsFallback = baseRows;
  const rowsFallbackCore = rowsFallback.map(({score_recuperacao, link_finalizacao, last_etapa_enviada, last_mensagem_at, ...rest})=>rest);
  try{
    if(globalThis.__carrinhosHasUpdatedAt == null){
      try{
        const {error} = await supaClient.from("carrinhos_abandonados").select("checkout_id,updated_at").limit(1);
        globalThis.__carrinhosHasUpdatedAt = !error;
      }catch(_e){
        globalThis.__carrinhosHasUpdatedAt = false;
      }
    }
    const useUpdatedAt = !!globalThis.__carrinhosHasUpdatedAt;
    for(let i=0;i<baseRows.length;i+=1000){
      const {error} = await supaClient
        .from("carrinhos_abandonados")
        .upsert((useUpdatedAt ? rowsWithUpdatedAt : rowsFallback).slice(i,i+1000), { onConflict: "checkout_id" });
      if(error && useUpdatedAt){
        globalThis.__carrinhosHasUpdatedAt = false;
        const {error: e2} = await supaClient.from("carrinhos_abandonados").upsert(rowsFallback.slice(i,i+1000), { onConflict: "checkout_id" });
        if(e2){
          await supaClient.from("carrinhos_abandonados").upsert(rowsFallbackCore.slice(i,i+1000), { onConflict: "checkout_id" });
        }
      }else if(error){
        await supaClient.from("carrinhos_abandonados").upsert(rowsFallbackCore.slice(i,i+1000), { onConflict: "checkout_id" });
      }
    }
  }catch(_e){}
}

async function fetchYampiAbandoned(){
  if(supaConnected && supaClient){
    let data=null, error=null;
    try{
      ({data, error} = await supaClient
        .from("yampi_orders")
        .select("external_id,total,created_at,updated_at,status,is_abandoned_cart,customer_name,customer_email,customer_phone,raw")
        .eq("is_abandoned_cart", true)
        .order("created_at", { ascending: false })
        .limit(2000));
    }catch(e){
      throw e;
    }
    if(error) throw error;
    return (Array.isArray(data) ? data : []).map(r=>{
      const raw = (r && typeof r.raw === "object" && r.raw) ? r.raw : {};
      const items = raw.items || raw.itens || raw.products || raw.line_items || raw.produtos || [];
      const url = raw.checkout_url || raw.recovery_url || raw.recover_url || raw.url || raw.link_finalizacao || "";
      return {
        checkout_id: String(r.external_id||""),
        cliente_nome: r.customer_name || "",
        email: r.customer_email || "",
        telefone: r.customer_phone || "",
        valor: Number(r.total||0) || 0,
        produtos: items,
        criado_em: r.created_at || r.updated_at || null,
        status: r.status || null,
        link_finalizacao: url || null,
        canal: "yampi"
      };
    });
  }
  return (safeJsonParse("crm_carrinhos_abandonados", []) || []).filter(Boolean);
}

async function syncCarrinhosAbandonadosYampi(){
  const res = await syncCarrinhosAbandonadosYampiImpl(getSyncCtx());
  checkEstoqueCritico();
  return res;
}

function buildCarrinhoWaMessage(c, ctx){
  const nome = String(c?.cliente_nome || "tudo bem?");
  const itens = Array.isArray(c?.produtos) ? c.produtos : [];
  const produtosTxt = itens.slice(0,4).map(it=>String(it?.nome || it?.title || it?.descricao || it?.name || "").trim()).filter(Boolean).join(", ");
  const valorTxt = Number(c?.valor||0) ? fmtBRL(Number(c.valor||0)||0) : "";
  const etapa = ctx?.etapa?.id || "";
  const prioridade = ctx?.prioridade?.id || "baixa";
  const link = c?.link_finalizacao ? String(c.link_finalizacao) : "";

  if(etapa==="ajuda"){
    return [
      `Oi ${nome}!`,
      "Vi que você estava finalizando seu pedido e ele ficou pendente.",
      produtosTxt ? `Carrinho: ${produtosTxt}` : "",
      "Quer que eu te ajude a concluir por aqui?"
    ].filter(Boolean).join(" ");
  }
  if(etapa==="link"){
    return [
      `Oi ${nome}!`,
      "Passando pra te ajudar a finalizar seu pedido.",
      produtosTxt ? `Carrinho: ${produtosTxt}` : "",
      valorTxt ? `Total: ${valorTxt}` : "",
      link ? `Link para finalizar: ${link}` : "Se você quiser, eu te mando o link pra finalizar rapidinho.",
      "Posso te ajudar em algo?"
    ].filter(Boolean).join(" ");
  }
  if(etapa==="incentivo"){
    const incentivo =
      prioridade==="alta" ? "Se precisar, consigo te ajudar com um incentivo leve pra fechar hoje." :
      "Se fizer sentido pra você, eu te ajudo a concluir rapidinho.";
    return [
      `Oi ${nome}!`,
      "Só passando pra lembrar do seu carrinho que ficou pendente.",
      produtosTxt ? `Carrinho: ${produtosTxt}` : "",
      valorTxt ? `Total: ${valorTxt}` : "",
      incentivo,
      link ? `Link: ${link}` : ""
    ].filter(Boolean).join(" ");
  }
  return [
    `Oi ${nome}!`,
    "Vi que você iniciou um pedido no nosso site mas não finalizou.",
    produtosTxt ? `Seu carrinho: ${produtosTxt}` : "",
    valorTxt ? `Total: ${valorTxt}` : "",
    "Posso te ajudar a concluir agora?"
  ].filter(Boolean).join(" ");
}

async function ensureCustomerForCarrinho(c){
  if(!supaConnected || !supaClient) return null;
  const email = String(c?.email||"").trim().toLowerCase();
  const phone = rawPhone(c?.telefone||"");
  const docKey = email || phone || "";
  if(!docKey) return null;
  try{
    const nome = cleanText(c?.cliente_nome || "") || email || phone || "Cliente";
    await supaClient.from("v2_clientes").upsert({
      doc: docKey,
      nome,
      email: email || null,
      telefone: phone || null,
      updated_at: new Date().toISOString()
    }, { onConflict: "doc" });
  }catch(_e){}
  try{
    return await resolveCustomerUuid(docKey);
  }catch(_e){}
  return null;
}

async function openWhatsAppCarrinho(checkoutId){
  const cid = String(checkoutId||"");
  const c = (carrinhosAbandonados||[]).find(x=>String(x?.checkout_id||"")===cid);
  if(!c){ toast("⚠ Carrinho não encontrado"); return; }
  const digits = rawPhone(c.telefone||"");
  if(!digits){ toast("⚠ Carrinho sem telefone"); return; }
  const phone = digits.startsWith("55") ? digits : ("55"+digits);
  const lookup = buildClienteLookupParaCarrinhos();
  const calc = calcularScoreRecuperacaoCarrinho(c, lookup);
  const etapa = sugerirEtapaParaCarrinho(c, calc.mins);
  const prioridade = prioridadePorScore(c.score_recuperacao == null ? calc.score : c.score_recuperacao);
  const text = buildCarrinhoWaMessage(c, {etapa, prioridade, score: c.score_recuperacao == null ? calc.score : c.score_recuperacao});
  const url = "https://wa.me/" + phone + "?text=" + encodeURIComponent(text);
  window.open(url, "_blank");

  if(etapa && (etapa.id==="ajuda" || etapa.id==="link" || etapa.id==="incentivo")){
    const nowIso = new Date().toISOString();
    const idx = (carrinhosAbandonados||[]).findIndex(x=>String(x?.checkout_id||"")===cid);
    if(idx >= 0){
      carrinhosAbandonados[idx] = Object.assign({}, normalizeCarrinhoAbandonado(carrinhosAbandonados[idx]), {
        last_etapa_enviada: etapa.id,
        last_mensagem_at: nowIso
      });
      safeSetItem("crm_carrinhos_abandonados", JSON.stringify(carrinhosAbandonados));
      if(supaConnected && supaClient) upsertCarrinhosAbandonadosToSupabase([carrinhosAbandonados[idx]]).catch(()=>{});
      if(typeof window.renderCarrinhosAbandonados === "function") window.renderCarrinhosAbandonados();
    }
  }

  const customerKey = String(c.email||"").trim().toLowerCase() || rawPhone(c.telefone||"") || "";
  if(customerKey){
    try{
      await ensureCustomerForCarrinho(c);
      await logInteraction(customerKey, "mensagem_enviada", "Recuperação carrinho abandonado ("+etapa.id+")", {
        checkout_id: c.checkout_id,
        etapa: etapa.id,
        score_recuperacao: c.score_recuperacao == null ? calc.score : c.score_recuperacao,
        valor: Number(c.valor||0)||0,
        prioridade: prioridade.id
      });
    }catch(_e){}
  }
}

function openCarrinhoLinkFromRadar(checkoutId){
  const cid = String(checkoutId||"");
  const c = (carrinhosAbandonados||[]).find(x=>String(x?.checkout_id||"")===cid);
  const link = c?.link_finalizacao ? String(c.link_finalizacao) : "";
  if(!link){ toast("⚠ Carrinho sem link"); return; }
  window.open(link, "_blank");
}

function openCarrinhoInComercialFromRadar(checkoutId){
  const cid = String(checkoutId||"");
  const c = (carrinhosAbandonados||[]).find(x=>String(x?.checkout_id||"")===cid) || {};
  const q = String(c.email || c.telefone || cid || "").trim();
  try{
    showPage("comercial");
    setComTab("carrinhos");
    const inp = document.getElementById("car-search");
    if(inp) inp.value = q;
    renderCarrinhosAbandonados();
  }catch(_e){}
}

function openRadarVisitouDrawer(checkoutId){
  const cid = String(checkoutId||"");
  const c0 = (carrinhosAbandonados||[]).find(x=>String(x?.checkout_id||"")===cid);
  if(!c0){ toast("⚠ Carrinho não encontrado"); return; }
  const c = normalizeCarrinhoAbandonado(c0);
  const lookup = buildClienteLookupParaCarrinhos();
  const calc = calcularScoreRecuperacaoCarrinho(c, lookup);
  const score = c.score_recuperacao == null ? (Number(calc.score||0)||0) : (Number(c.score_recuperacao||0)||0);
  const etapa = sugerirEtapaParaCarrinho(c, calc.mins);
  const tempo = fmtTempoDesde(calc.mins);
  const nome = String(c.cliente_nome || "Cliente").trim();
  const contato = [c.telefone?fmtPhone(c.telefone):"", c.email?String(c.email):""].filter(Boolean).join(" · ") || "—";
  const resumo = (Array.isArray(c.produtos) ? c.produtos : []).slice(0,4).map(it=>String(it?.nome||it?.title||it?.descricao||it?.name||"").trim()).filter(Boolean).join(", ");
  const body = `
    <div class="drawer-section">
      <div class="drawer-section-title">Visita / Carrinho</div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Cliente</span><span>${escapeHTML(nome)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Contato</span><span>${escapeHTML(contato)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Tempo</span><span class="chiva-table-mono">${escapeHTML(tempo||"—")}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Valor</span><span class="chiva-table-mono" style="color:var(--green)">${escapeHTML(fmtBRL(c.valor||0))}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Score</span><span class="chiva-table-mono">${escapeHTML(String(Math.round(score||0)))}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px"><span style="color:var(--text-3)">Próxima mensagem</span><span>${escapeHTML(String(etapa?.label||"—"))}</span></div>
    </div>
    ${resumo ? `<div class="drawer-section"><div class="drawer-section-title">Itens</div><div style="font-size:12px;color:var(--text-2);line-height:1.6">${escapeHTML(resumo)}</div></div>` : ""}
  `;
  const actions = `
    <button class="drawer-btn drawer-btn-ghost" onclick="closeDrawer()">Fechar</button>
    <button class="drawer-btn drawer-btn-ghost" onclick="openCarrinhoInComercialFromRadar('${escapeJsSingleQuote(cid)}')">Abrir carrinho</button>
    ${c.link_finalizacao ? `<button class="drawer-btn drawer-btn-ghost" onclick="openCarrinhoLinkFromRadar('${escapeJsSingleQuote(cid)}')">Link</button>` : ""}
    ${rawPhone(c.telefone||"") ? `<button class="drawer-btn drawer-btn-primary" onclick="openWhatsAppCarrinho('${escapeJsSingleQuote(cid)}')">WhatsApp</button>` : ""}
  `;
  openDrawer("👀 Visitou", "Carrinho aberto (sem compra)", body, actions);
}

async function reconcileCarrinhosRecuperados(){
  try{
    carrinhosAbandonados = safeJsonParse("crm_carrinhos_abandonados", []) || carrinhosAbandonados || [];
  }catch(_e){}
  if(!Array.isArray(carrinhosAbandonados) || !carrinhosAbandonados.length) return;
  const orders = Array.isArray(allOrders) ? allOrders : [];
  if(!orders.length) return;
  const bestByEmail = {};
  const bestByPhone = {};
  orders.forEach(o=>{
    const email = String(o?.contato?.email || "").trim().toLowerCase();
    const phone = rawPhone(o?.contato?.telefone || o?.contato?.celular || "");
    const dtRaw = o?.data || o?.data_pedido || o?.created_at || o?.updated_at || "";
    const ts = dtRaw ? new Date(dtRaw).getTime() : NaN;
    if(!isFinite(ts)) return;
    if(email){
      const cur = bestByEmail[email];
      if(!cur || ts > cur.ts) bestByEmail[email] = {ts, id:String(o?.id||o?.numero||""), data: dtRaw};
    }
    if(phone){
      const cur2 = bestByPhone[phone];
      if(!cur2 || ts > cur2.ts) bestByPhone[phone] = {ts, id:String(o?.id||o?.numero||""), data: dtRaw};
    }
  });

  let changed = false;
  const updated = carrinhosAbandonados.map(c=>{
    if(!c || c.recuperado) return c;
    const createdTs = c.criado_em ? new Date(c.criado_em).getTime() : NaN;
    const email = String(c.email||"").trim().toLowerCase();
    const phone = rawPhone(c.telefone||"");
    const hit = (email && bestByEmail[email]) || (phone && bestByPhone[phone]) || null;
    if(!hit) return c;
    if(isFinite(createdTs) && hit.ts <= createdTs) return c;
    changed = true;
    return {...c, recuperado:true, recuperado_em:new Date(hit.ts).toISOString(), recuperado_pedido_id: hit.id || null};
  });
  if(!changed) return;
  carrinhosAbandonados = updated;
  localStorage.setItem("crm_carrinhos_abandonados", JSON.stringify(carrinhosAbandonados));
  if(supaConnected && supaClient) await upsertCarrinhosAbandonadosToSupabase(carrinhosAbandonados);
  if(typeof window.renderCarrinhosAbandonados === "function") window.renderCarrinhosAbandonados();
  await recomputeCarrinhosScoresAndPersist();
}

// ═══════════════════════════════════════════════════
//  SHOPIFY
// ═══════════════════════════════════════════════════
async function fetchShopify(shop,key,from,to){
  const r=await fetch(getSupaFnBase()+"/shopify-sync",{
    method:"POST",
    headers:await supaFnHeadersAsync(),
    body:JSON.stringify({shop,key,from,to})
  });
  if(!r.ok){
    const txt = await r.text();
    throw new Error(txt || ("Erro no shopify-sync ("+r.status+")"));
  }
  const d=await r.json();
  return (d.orders||[]).map(o=>{
    const addr=o.shipping_address||o.billing_address||{};
    o._source="shopify"; o._canal="shopify";
    o.numero=o.name; o.data=o.created_at?.slice(0,10);
    o.total=parseFloat(o.total_price)||0; o.totalProdutos=o.total;
    o.situacao={nome:mapShopifyStatus(o.financial_status)};
    o.contato={
      nome:o.customer?`${o.customer.first_name||""} ${o.customer.last_name||""}`.trim():(addr.name||"Desconhecido"),
      cpfCnpj:"",email:o.email||o.customer?.email||"",
      telefone:o.phone||o.customer?.phone||addr.phone||"",
      endereco:{municipio:addr.city||"",uf:addr.province_code?.split("-")[1]||"",logradouro:addr.address1||""}
    };
    o.itens=(o.line_items||[]).map(it=>({descricao:it.title,codigo:it.sku||"",quantidade:it.quantity,valor:parseFloat(it.price)||0}));
    return o;
  });
}
function mapShopifyStatus(s){ if(/paid|authorized/i.test(s||""))return"aprovado"; if(/pending/i.test(s||""))return"pendente"; if(/refunded|voided/i.test(s||""))return"cancelado"; return s||"outros"; }
async function syncShopify(){
  const shopEl = document.getElementById("inp-shop");
  const keyEl = document.getElementById("inp-shopkey");
  const st = document.getElementById("shopify-status");
  const fromEl = document.getElementById("shop-date-from");
  const toEl = document.getElementById("shop-date-to");
  if(!shopEl || !keyEl || !st || !fromEl || !toEl){
    toast("Shopify não está configurado nesta versão do CRM.");
    return;
  }
  SHOP=shopEl.value.trim().replace(/^https?:\/\//,"");
  SHOPKEY=keyEl.value.trim(); saveCreds();
  if(!SHOP||!SHOPKEY){st.textContent="⚠ Preencha URL e token";st.className="setup-status s-err";return;}
  if(!fromEl.value || !toEl.value){ st.textContent="⚠ Preencha o período"; st.className="setup-status s-err"; return; }
  localStorage.setItem("crm_shopify_from", fromEl.value);
  localStorage.setItem("crm_shopify_to", toEl.value);
  st.textContent="Importando..."; st.className="setup-status";
  try{
    const nextShopify = await fetchShopify(SHOP,SHOPKEY,fromEl.value,toEl.value);
    shopifyOrders.length = 0;
    shopifyOrders.push(...nextShopify);
    safeSetItem("crm_shopify_orders",JSON.stringify(shopifyOrders));
    mergeOrders(); populateUFs();
    upsertOrdersToSupabase(shopifyOrders).catch(e=>console.warn(e)); renderAll();
    try{ if(supaConnected) await sbSetConfig('ultima_sync_shopify',new Date().toISOString()); }catch(e){}
    st.textContent=`✓ ${shopifyOrders.length} pedidos importados`; st.className="setup-status s-ok";
    toast("✓ Shopify sincronizado!");
  }catch(e){ st.textContent="⚠ "+e.message; st.className="setup-status s-err"; }
}

// ═══════════════════════════════════════════════════
//  TIMERS
// ═══════════════════════════════════════════════════
function startTimers(){
  if(syncTimer) clearInterval(syncTimer);
  syncTimer=setInterval(async()=>{
    try{ await recarregar(true); }
    catch(e){ console.error("[sync-timer] Falha ao sincronizar:", e?.message||e); }
  },6*60*60*1000);
}
async function recarregar(silent=false){
  const icon=document.getElementById("ri"); icon.classList.add("spinning");
  const bar=document.getElementById("sync-bar"); bar.classList.add("show");
  document.getElementById("sync-txt").textContent="⟳ Sincronizando...";
  try{
    const from=iso(new Date(new Date().getFullYear(),new Date().getMonth()-17,1));
    const to=iso(new Date());
    const resp=await fetch(getSupaFnBase()+"/bling-sync",{
      method:"POST",
      headers:await supaFnHeadersAsync(),
      body:JSON.stringify({from,to})
    });
    if(resp.ok){
      const data=await resp.json();
      const fresh=(data.orders||[]).map(o=>{ o._source="bling"; o._canal=detectCh(o); return o; });
      const known=new Set(blingOrders.map(o=>String(o.id||o.numero)));
      fresh.filter(o=>!known.has(String(o.id||o.numero))).forEach(o=>pushNotif(`🛒 Novo pedido #${o.numero||o.id} — ${fmtBRL(val(o))}`));
      blingOrders.length = 0;
      blingOrders.push(...fresh);
      safeSetItem("crm_bling_orders",JSON.stringify(blingOrders));
    }
    mergeOrders();
    document.getElementById("sync-time").textContent="Sync: "+new Date().toLocaleTimeString("pt-BR");
    populateUFs(); renderAll();
    if(!silent) toast("✓ Atualizado!");
  }catch(e){
    if(!silent) toast("⚠ "+e.message);
  }finally{ icon.classList.remove("spinning"); setTimeout(()=>bar.classList.remove("show"),3000); }
}

// ═══════════════════════════════════════════════════
//  NOTIFS
// ═══════════════════════════════════════════════════
function pushNotif(msg){
  notifs.unshift({msg,time:new Date().toLocaleString("pt-BR"),read:false});
  if(notifs.length > 30) notifs.length = 30;
  localStorage.setItem("crm_notifs",JSON.stringify(notifs));
  updateBadge();
}
function updateBadge(){
  const unread = notifs.filter(x=>!x.read).length;
  const now = new Date();
  const overdue = tarefasCache.filter(t=>{
    if(t.status !== "pendente") return false;
    const due = t.data_vencimento || t.vencimento || t.data;
    if(!due) return false;
    const d = new Date(due);
    if(Number.isNaN(d.getTime())) return false;
    return d < now;
  }).length;
  const n = unread + overdue;
  const el = document.getElementById("notif-badge");
  if(!el) return;
  if(n){ el.style.display="flex"; el.textContent=n; }
  else el.style.display="none";
}
function toggleNotif(){
  const p=document.getElementById("notif-panel"); p.classList.toggle("open");
  if(p.classList.contains("open")){
    notifs.forEach(n=>{ n.read = true; });
    if(notifs.length > 30) notifs.length = 30;
    localStorage.setItem("crm_notifs",JSON.stringify(notifs));
    updateBadge();
    document.getElementById("notif-list").innerHTML=notifs.length?notifs.map(n=>`<div class="np-item"><div class="np-time">${escapeHTML(n.time)}</div>${escapeHTML(n.msg)}</div>`).join(""):`<div style="font-size:11px;color:var(--text-3)">Nenhuma notificação.</div>`;
  }
}
document.addEventListener("click",e=>{ if(!e.target.closest("#notif-panel")&&!e.target.closest(".notif-wrap")) document.getElementById("notif-panel").classList.remove("open"); });

// ═══════════════════════════════════════════════════
//  PAGES
// ═══════════════════════════════════════════════════
function showPage(id){
  // Hide all pages
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));

  // Update sidebar nav active state
  document.querySelectorAll(".nav-item").forEach(t=>t.classList.remove("active"));
  const navId = id === "cliente" ? "clientes"
              : (id === "segmento-detalhe" || id === "ia" || id === "segmentos") ? "inteligencia"
              : id;
  const navEl = document.getElementById("nav-"+navId);
  if(navEl) navEl.classList.add("active");

  // Update topbar title
  const titles = {dashboard:"Dashboard",clientes:"Clientes",inteligencia:"Inteligência de Clientes",pedidos:"Pedidos",
    "pedidos-page":"Pedidos",cidades:"Cidades",produtos:"Produtos",tarefas:"Tarefas",
    oportunidades:"Oportunidades",alertas:"Alertas",
    "segmento-detalhe":"Segmento",
    comercial:"Comercial",producao:"Produção",marca:"Marca",config:"Configurações",cliente:"Cliente"};
  const titleEl = document.getElementById("topbar-title");
  if(titleEl) titleEl.textContent = titles[id] || id;

  const pageEl = document.getElementById("page-"+id);
  if(pageEl) pageEl.classList.add("active");

  try{
    document.documentElement.classList.toggle("skin-dashboard", id === "dashboard");
  }catch(_e){}

  if(id==='oportunidades') setTimeout(()=>safeInvokeName("renderOportunidades"),50);
  if(id==='tarefas') setTimeout(()=>safeInvokeName("renderTarefas"),50);
  if(id==="producao"){ safeInvokeName("renderProdKpis"); safeInvokeName("renderInsumos"); }
  if(id==="comercial"){ safeInvokeName("renderComKpis"); safeInvokeName("renderComPedidos"); setTimeout(()=>safeInvokeName("renderChartsCom"),100); }
  if(id==="marca"){ safeInvokeName("renderMarcaKpis"); safeInvokeName("renderCalendario"); }
  if(id==="pedidos-page") setTimeout(()=>safeInvokeName("renderPedidosPage"),50);
  if(id==="clientes") setTimeout(()=>safeInvokeName("renderClientes"),50);
  if(id==="cliente") setTimeout(()=>safeInvokeName("renderClientePage"),0);
  if(id==="inteligencia") setTimeout(()=>{
    safeInvokeName("renderInteligencia");
    safeInvokeName("renderSegmentos");
    safeInvokeName("renderIADashboard");
  },0);
  if(id==="cidades") setTimeout(()=>safeInvokeName("renderCidades"),50);
  if(id==="produtos") setTimeout(async ()=>{
    try{
      if(supaConnected && supaClient) await loadBlingProductsFromSupabase();
    }catch(_e){}
    safeInvokeName("renderProdutos");
  },50);
  if(id==="config") setTimeout(()=>safeInvokeName("hydrateConfigPage"),0);

  // Close mobile sidebar
  closeMobileSidebar();
}

// Sidebar mobile controls
function openMobileSidebar(){
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-overlay").classList.add("visible");
}
function closeMobileSidebar(){
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("visible");
}

// Drawer controls
function openDrawer(title, subtitle, bodyHTML, actionsHTML){
  document.getElementById("drawer-title").textContent = title || "";
  document.getElementById("drawer-subtitle").textContent = subtitle || "";
  document.getElementById("drawer-body").innerHTML = bodyHTML || "";
  document.getElementById("drawer-actions").innerHTML = actionsHTML || "";
  document.getElementById("detail-drawer").classList.add("open");
  document.getElementById("drawer-overlay").classList.add("visible");
  document.body.style.overflow = "hidden";
}
function closeDrawer(){
  document.getElementById("detail-drawer").classList.remove("open");
  document.getElementById("drawer-overlay").classList.remove("visible");
  document.body.style.overflow = "";
}

// Topbar search
const handleTopbarSearchDebounced = debounce(function(q){ handleTopbarSearch(q); }, 300);
const renderClientesDebounced = debounce(function(){ renderClientes(); }, 250);
const renderPedidosPageDebounced = debounce(function(){ renderPedidosPage(); }, 250);

function handleTopbarSearch(q){
  if(!q||q.length<2) return;
  const lower = q.toLowerCase();
  const matches = allCustomers.filter(c=>
    (c.nome||"").toLowerCase().includes(lower)||
    (c.doc||"").includes(lower)||
    (c.cidade||"").toLowerCase().includes(lower)
  ).slice(0,8);
  if(matches.length>0){
    const body = matches.map(c=>
      `<div class="drawer-order-row" onclick="openClientePage('${c.id}')">
        <div><div class="drawer-order-num">${escapeHTML(c.nome||"—")}</div><div class="drawer-order-date">${escapeHTML(c.cidade||"")} ${escapeHTML(c.uf||"")} · ${escapeHTML(c.status||"")}</div></div>
        <div class="drawer-order-val">R$ ${(c.total_gasto||0).toLocaleString("pt-BR",{minimumFractionDigits:0})}</div>
       </div>`
    ).join("");
    openDrawer("Resultados da busca", `${matches.length} cliente(s) encontrado(s)`, body, "");
  }
}

// ═══════════════════════════════════════════════════
//  TAREFAS
// ═══════════════════════════════════════════════════
function saveTasks(){ localStorage.setItem("crm_tasks", JSON.stringify(allTasks)); }

function renderTarefas(){
  const statusFil = document.getElementById("fil-task-status")?.value||"";
  const prioFil   = document.getElementById("fil-task-prio")?.value||"";
  const PRIO_LABEL = {alta:"🔴 Alta",media:"🟡 Média",baixa:"🟢 Baixa"};
  const STATUS_LABEL = {pendente:"⏳ Pendente",em_andamento:"⚡ Em andamento",concluida:"✅ Concluída"};
  
  let tasks = [...allTasks];
  if(statusFil) tasks = tasks.filter(t=>t.status===statusFil);
  if(prioFil)   tasks = tasks.filter(t=>t.prioridade===prioFil);
  tasks.sort((a,b)=>{const p={alta:0,media:1,baixa:2}; return (p[a.prioridade]||1)-(p[b.prioridade]||1);});
  
  const pending  = allTasks.filter(t=>t.status==="pendente").length;
  const andamento= allTasks.filter(t=>t.status==="em_andamento").length;
  const done     = allTasks.filter(t=>t.status==="concluida").length;
  document.getElementById("tasks-label").innerHTML=`
    <span class="tasks-label-total">${allTasks.length} tarefas</span> &nbsp;·&nbsp;
    <span class="tasks-label-pending">${pending} pendentes</span> &nbsp;·&nbsp;
    <span class="tasks-label-progress">${andamento} em andamento</span> &nbsp;·&nbsp;
    <span class="tasks-label-done">${done} concluídas</span>`;
  
  document.getElementById("tasks-list").innerHTML = tasks.length ? tasks.map(t=>`
    <div class="task-card status-${escapeHTML(t.status||"pendente")}">
      <div class="task-header">
        <input type="checkbox" ${t.status==="concluida"?"checked":""} 
          class="task-check"
          onchange="toggleTask(${t.id},this.checked)"/>
        <div class="task-main">
          <div class="task-title ${t.status==="concluida"?"done":""}">${escapeHTML(t.titulo)}</div>
          ${t.desc?`<div class="task-desc">${escapeHTML(t.desc)}</div>`:""}
          ${t.cliente?`<div class="task-client">👤 ${escapeHTML(t.cliente)}</div>`:""}
          <div class="task-badges">
            <span class="task-badge">${PRIO_LABEL[t.prioridade]||t.prioridade}</span>
            <span class="task-badge">${STATUS_LABEL[t.status]||t.status}</span>
            ${t.data?`<span class="task-badge">📅 ${escapeHTML(fmtDate(t.data))}</span>`:""}
          </div>
        </div>
        <div class="task-actions">
          <button class="task-icon-btn" onclick="openTaskModal(${t.id})">✏️</button>
          <button class="task-icon-btn" onclick="deleteTask(${t.id})">🗑️</button>
        </div>
      </div>
    </div>`).join("") : `<div class="empty">Nenhuma tarefa encontrada.</div>`;
}

function toggleTask(id, done){
  const t=allTasks.find(t=>t.id===id);
  if(t){
    t.status=done?"concluida":"pendente";
    saveTasks();
    renderTarefas();
    // Sincronizar com v2_tarefas
    if(supaConnected && supaClient && t._supaId){
      const sbStatus = done ? 'concluida' : 'aberta';
      supaClient.from('v2_tarefas').update({status:sbStatus}).eq('id',t._supaId)
        .then(()=>{}).catch(e=>console.warn("[tarefas] update falhou:", e?.message||e));
    }
  }
}

function deleteTask(id){
  const t=allTasks.find(t=>t.id===id);
  // Remover do Supabase se tiver UUID
  if(supaConnected && supaClient && t?._supaId){
    supaClient.from('v2_tarefas').delete().eq('id',t._supaId)
      .then(()=>{}).catch(e=>console.warn("[tarefas] delete falhou:", e?.message||e));
  }
  allTasks=allTasks.filter(t=>t.id!==id);
  saveTasks(); renderTarefas();
  toast("🗑️ Tarefa removida");
}

function openTaskModal(id, cliente, customerId){
  // Remove qualquer modal anterior antes de inserir novo (evita acúmulo no DOM)
  document.getElementById("task-modal-overlay")?.remove();
  const t = id ? allTasks.find(t=>t.id===id) : null;
  const html=`
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:500;display:flex;align-items:center;justify-content:center;padding:16px" id="task-modal-overlay">
      <div style="background:var(--surface);border-radius:16px;padding:20px;width:100%;max-width:400px;border:1px solid var(--border)">
        <div style="font-size:14px;font-weight:800;margin-bottom:14px">${t?"✏️ Editar":"➕ Nova"} Tarefa</div>
        <input type="hidden" id="tm-customer-id" value="${escapeHTML(String(t?.customer_id||customerId||""))}"/>
        <input id="tm-titulo" placeholder="Título da tarefa *" value="${escapeHTML(t?.titulo||"")}" 
          style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:12px;margin-bottom:8px;box-sizing:border-box"/>
        <textarea id="tm-desc" placeholder="Descrição (opcional)" rows="2"
          style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:12px;margin-bottom:8px;box-sizing:border-box;resize:none;font-family:inherit">${escapeHTML(t?.desc||"")}</textarea>
        <input id="tm-cliente" placeholder="Cliente relacionado (opcional)" value="${escapeHTML(t?.cliente||cliente||"")}"
          style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:12px;margin-bottom:8px;box-sizing:border-box"/>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <select id="tm-prio" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--text);font-size:12px">
            <option value="alta" ${t?.prioridade==="alta"?"selected":""}>🔴 Alta</option>
            <option value="media" ${!t||t?.prioridade==="media"?"selected":""}>🟡 Média</option>
            <option value="baixa" ${t?.prioridade==="baixa"?"selected":""}>🟢 Baixa</option>
          </select>
          <select id="tm-status" style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--text);font-size:12px">
            <option value="pendente" ${!t||t?.status==="pendente"?"selected":""}>⏳ Pendente</option>
            <option value="em_andamento" ${t?.status==="em_andamento"?"selected":""}>⚡ Em andamento</option>
            <option value="concluida" ${t?.status==="concluida"?"selected":""}>✅ Concluída</option>
          </select>
        </div>
        <input id="tm-data" type="text" data-date-mask="1" inputmode="numeric" placeholder="dd/mm/aaaa" value="${escapeHTML(fmtDate(t?.data||new Date().toISOString().slice(0,10)))}"
          style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:12px;margin-bottom:14px;box-sizing:border-box"/>
        <div style="display:flex;gap:8px">
          <button onclick="document.getElementById('task-modal-overlay').remove()" 
            style="flex:1;padding:10px;background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;cursor:pointer;font-family:inherit">Cancelar</button>
          <button onclick="saveTask(${id||"null"})"
            style="flex:1;padding:10px;background:linear-gradient(135deg,var(--chiva-primary),var(--chiva-primary-light));border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
  bindDateMasks(document.getElementById("task-modal-overlay"));
}

function saveTask(id){
  const titulo=document.getElementById("tm-titulo")?.value.trim();
  if(!titulo){toast("⚠️ Título obrigatório");return;}
  const prev = id ? allTasks.find(t=>t.id===id) : null;
  const task={
    id: id||taskIdSeq++,
    titulo,
    desc: document.getElementById("tm-desc")?.value.trim()||"",
    cliente: document.getElementById("tm-cliente")?.value.trim()||"",
    customer_id: String(document.getElementById("tm-customer-id")?.value || "").trim(),
    prioridade: document.getElementById("tm-prio")?.value||"media",
    status: document.getElementById("tm-status")?.value||"pendente",
    data: parseDateToIso(document.getElementById("tm-data")?.value||"") || "",
  };
  if(id) { const i=allTasks.findIndex(t=>t.id===id); if(i>=0) allTasks[i]=task; }
  else allTasks.push(task);
  saveTasks();
  // Sincronizar com v2_tarefas (fire-and-forget)
  if(supaConnected && supaClient){
    const sbTaskBase = {
      titulo: task.titulo,
      descricao: task.desc||null,
      prioridade: task.prioridade,
      status: task.status === 'pendente' ? 'aberta' : task.status,
      vencimento: task.data||null,
    };
    const syncToSupabase = (sbTask)=>{
      if(task._supaId){
        supaClient.from('v2_tarefas').update(sbTask).eq('id', task._supaId).then(()=>{});
      } else {
        supaClient.from('v2_tarefas').insert({...sbTask, created_at: new Date().toISOString()})
          .select('id').single().then(({data})=>{
            if(data?.id){
              const t2=allTasks.find(t=>t.id===task.id);
              if(t2){ t2._supaId=data.id; saveTasks(); }
            }
          });
      }
    };
    const cid = String(task.customer_id||"").trim();
    if(cid){
      resolveCustomerUuid(cid).then(uuid=>{
        const sbTask = uuid ? { ...sbTaskBase, cliente_id: uuid } : sbTaskBase;
        syncToSupabase(sbTask);
      }).catch(()=>{ syncToSupabase(sbTaskBase); });
    }else{
      syncToSupabase(sbTaskBase);
    }
  }
  document.getElementById("task-modal-overlay")?.remove();
  renderTarefas();
  if(task.cliente){
    const cid = document.getElementById("tm-customer-id")?.value || "";
    const q = task.cliente.toLowerCase();
    const cust = cid ? allCustomers.find(c=>String(c.id||"")===String(cid)) : (allCustomers.find(c=>(c.nome||"").toLowerCase()===q) || allCustomers.find(c=>(c.nome||"").toLowerCase().includes(q)));
    const custId = cust?.id || cid || "";
    if(custId){
      if(!prev){
        logInteraction(custId, "tarefa_criada", `Tarefa: ${task.titulo}`.slice(0,240), { task_id: String(task._supaId||task.id) }).catch(()=>{});
      }else if(prev.status !== task.status && task.status === "concluida"){
        logInteraction(custId, "tarefa_concluida", `Tarefa concluída: ${task.titulo}`.slice(0,240), { task_id: String(task._supaId||task.id) }).catch(()=>{});
      }
    }
  }
  toast("✅ Tarefa salva!");
}

// ═══════════════════════════════════════════════════
//  CUSTOMER INTELLIGENCE (CLIENTE)
// ═══════════════════════════════════════════════════
function getIACtx(){
  return {
    allOrders,
    allCustomers,
    customerIntel,
    customerIntelligence,
    buildCli,
    cliKey,
    val,
    daysSince,
    isCNPJ,
    calcCliScores,
    detectCh,
    get CH(){ return CH; },
    fmtBRL,
    toast,
    escapeHTML,
    getSupaFnBase,
    supaFnHeaders,
    supaFnHeadersAsync,
    supaConnected,
    supaClient,
    selectedUser,
    renderIADashboard
  };
}

function computeCustomerIntelligence(){
  return computeCustomerIntelligenceImpl(getIACtx());
}

function definirNextBestAction(cli){
  return definirNextBestActionImpl(cli);
}

function getTodaySalesActions(){
  return getTodaySalesActionsImpl(getIACtx());
}

function renderIADashboard(){
  return renderIADashboardImpl(getIACtx());
}

async function gerarMensagemIA(clienteId,contextoTipo){
  return gerarMensagemIAImpl(getIACtx(), clienteId, contextoTipo);
}

function copyWhatsAppMessageForCustomer(clienteId){
  return copyWhatsAppMessageForCustomerImpl(getIACtx(), clienteId);
}

function openWhatsAppForCustomer(clienteId){
  return openWhatsAppForCustomerImpl(getIACtx(), clienteId);
}

let currentSegmentId = null;
let computedSegments = [];

function normSegText(v){
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .trim();
}

function segIncludes(v, needle){
  const hay = normSegText(v);
  const n = normSegText(needle);
  if(!hay || !n) return false;
  return hay.includes(n);
}

function segIncludesAny(v, needles){
  const hay = normSegText(v);
  if(!hay) return false;
  return (Array.isArray(needles) ? needles : []).some(n => {
    const nn = normSegText(n);
    return nn ? hay.includes(nn) : false;
  });
}

function segmentRiskThresholdDays(c){
  const interval = Number(c?.intervalo_medio_dias) || 0;
  if(interval > 0) return Math.max(60, interval * 2);
  return 60;
}

function computeRFVForCustomers(customers){
  const list = Array.isArray(customers) ? customers : [];
  const base = list.filter(c => (Number(c?.total_pedidos) || 0) > 0);
  const n = base.length;
  const scoreByQuintiles = (rows, valueFn, lowIsBest) => {
    const arr = rows.map(c => ({ id: c?.id, v: Number(valueFn(c)) || 0 }));
    arr.sort((a,b) => a.v - b.v);
    const out = {};
    const len = arr.length || 1;
    for(let i=0;i<arr.length;i++){
      const q = Math.min(4, Math.floor((i / len) * 5));
      const score = lowIsBest ? (5 - q) : (q + 1);
      if(arr[i].id != null) out[arr[i].id] = score;
    }
    return out;
  };
  if(!n){
    list.forEach(c=>{
      c._rfv = { r: 1, f: 1, v: 1, score: 3, segment: "outros", dias_desde_ultima_compra: daysSince(c?.ultimo_pedido) };
    });
    return;
  }
  const rMap = scoreByQuintiles(base, c => daysSince(c?.ultimo_pedido), true);
  const fMap = scoreByQuintiles(base, c => Number(c?.total_pedidos) || 0, false);
  const vMap = scoreByQuintiles(base, c => Number(c?.total_gasto) || 0, false);
  list.forEach(c=>{
    const dias = daysSince(c?.ultimo_pedido);
    const r = rMap[c?.id] || 1;
    const f = fMap[c?.id] || 1;
    const v = vMap[c?.id] || 1;
    const ped = Number(c?.total_pedidos) || 0;
    const total = r + f + v;
    let seg = "outros";
    if(ped > 0 && dias > 120) seg = "perdidos";
    else if(ped > 0 && dias > 60) seg = "dormindo";
    else if(r >= 4 && f >= 4 && v >= 4) seg = "champions";
    else if(r >= 4 && v >= 4) seg = "vip";
    else if(f >= 4 && r >= 3) seg = "fieis";
    else if(r >= 4 && f >= 2) seg = "promissores";
    else if(ped === 1 && dias <= 30) seg = "novos";
    c._rfv = { r, f, v, score: total, segment: seg, dias_desde_ultima_compra: dias };
  });
}

function getSegmentDefinitions(){
  return [
    { id: 'champions', name: 'Champions', desc: 'Recência alta + frequência alta + valor alto (RFV)', filter: c => c?._rfv?.segment === "champions" },
    { id: 'vip', name: 'VIP', desc: 'Muito valor + recência alta (RFV) / alto LTV', filter: c => c?._rfv?.segment === "vip" || (Number(c?.total_gasto)||0) >= 650 || (Number(c?.total_pedidos)||0) >= 6 },
    { id: 'fieis', name: 'Clientes fiéis', desc: 'Compram com frequência (RFV)', filter: c => c?._rfv?.segment === "fieis" },
    { id: 'promissores', name: 'Promissores', desc: 'Compraram recentemente e têm potencial de recorrência (RFV)', filter: c => c?._rfv?.segment === "promissores" },
    { id: 'novos_rfv', name: 'Novos clientes', desc: 'Primeira compra recente (RFV)', filter: c => c?._rfv?.segment === "novos" },
    { id: 'dormindo', name: 'Dormindo', desc: '61–120 dias sem comprar (RFV/recência)', filter: c => c?._rfv?.segment === "dormindo" },
    { id: 'perdidos', name: 'Clientes perdidos', desc: '120+ dias sem comprar (RFV/recência)', filter: c => c?._rfv?.segment === "perdidos" },

    { id: 'risco', name: 'Em Risco', desc: 'Dias sem comprar > max(60, intervalo médio × 2) e ainda não perdido', filter: c => {
      const dias = Number(c?._rfv?.dias_desde_ultima_compra) || daysSince(c?.ultimo_pedido);
      const th = segmentRiskThresholdDays(c);
      return (Number(c?.total_pedidos)||0) > 0 && dias > th && dias <= 120;
    }},
    { id: 'recompra', name: 'Recompra', desc: '2+ pedidos e intervalo médio ≤ 30 dias', filter: c => (Number(c?.total_pedidos)||0) >= 2 && (Number(c?.intervalo_medio_dias)||999) <= 30 },
    { id: 'alto_ticket', name: 'Alto Ticket', desc: 'Ticket médio (por pedido) ≥ R$100', filter: c => (Number(c?.ticket_medio)||0) >= 100 },

    { id: 'low_carb', name: 'Low Carb Lovers', desc: 'Produto favorito contém: low', filter: c => segIncludes(String(c?.produto_favorito||""), "low") },
    { id: 'cranberry', name: 'Cranberry Lovers', desc: 'Produto favorito contém: cranberry', filter: c => segIncludes(String(c?.produto_favorito||""), "cranberry") },
    { id: 'tradicional', name: 'Tradicional Lovers', desc: 'Produto favorito contém: tradicional', filter: c => segIncludes(String(c?.produto_favorito||""), "tradicional") },
    { id: 'site', name: 'Clientes do Site', desc: 'Canal principal: site/shopify', filter: c => segIncludesAny(c?.canal_principal, ["site","shopify"]) },
    { id: 'shopee', name: 'Clientes Shopee', desc: 'Canal principal: shopee', filter: c => segIncludes(String(c?.canal_principal||""), "shopee") },
    { id: 'amazon', name: 'Clientes Amazon', desc: 'Canal principal: amazon', filter: c => segIncludes(String(c?.canal_principal||""), "amazon") },
    { id: 'mg', name: 'Clientes MG', desc: 'Localizados em Minas Gerais', filter: c => String(c.uf || "").toUpperCase() === 'MG' },
    { id: 'sp', name: 'Clientes SP', desc: 'Localizados em São Paulo', filter: c => String(c.uf || "").toUpperCase() === 'SP' }
  ];
}

async function recalculateSegments(){
  const loader = document.getElementById('app-loader');
  if(loader) loader.style.display = 'flex';
  
  try {
    // 1. Garantir dados atualizados
    if(supaConnected && supaClient){
      const { data, error } = await supaClient.from('v2_clientes').select('*');
      if(!error && data) {
        allCustomers.length = 0;
        allCustomers.push(...data);
      }
    }

    computeRFVForCustomers(allCustomers);

    // 2. Calcular segmentos
    const defs = getSegmentDefinitions();
    const totalClis = allCustomers.length;
    computedSegments = defs.map(d => {
      const filtered = allCustomers.filter(d.filter);
      const totalRevenue = filtered.reduce((s, c) => s + (Number(c.total_gasto) || 0), 0);
      const totalOrders = filtered.reduce((s, c) => s + (Number(c.total_pedidos) || 0), 0);
      const avgTicket = totalOrders ? totalRevenue / totalOrders : 0;
      const pctBase = totalClis ? (filtered.length / totalClis) : 0;
      return {
        ...d,
        count: filtered.length,
        revenue: totalRevenue,
        avgTicket: avgTicket,
        pctBase,
        orders: totalOrders,
        customers: filtered
      };
    });

    renderSegmentos();
    toast('✅ Segmentos recalculados!');
  } catch(e) {
    console.error(e);
    toast('❌ Erro ao calcular segmentos');
  } finally {
    if(loader) loader.style.display = 'none';
  }
}

function renderSegmentos(){
  const statsHost = document.getElementById('segment-stats');
  const listHost = document.getElementById('segment-list');
  if(!statsHost || !listHost) return;

  // KPIs Topo
  const totalClis = allCustomers.length;
  const vipSeg = computedSegments.find(s => s.id === 'vip');
  const riscoSeg = computedSegments.find(s => s.id === 'risco');
  const championsSeg = computedSegments.find(s => s.id === 'champions');
  const novosSeg = computedSegments.find(s => s.id === 'novos_rfv');
  const totalRevenue = allCustomers.reduce((s, c) => s + (Number(c.total_gasto) || 0), 0);
  const totalOrders = allCustomers.reduce((s, c) => s + (Number(c.total_pedidos) || 0), 0);
  const avgTicketGeral = totalOrders ? totalRevenue / totalOrders : 0;

  statsHost.innerHTML = [
    {l:"Total Clientes", v:totalClis, s:"base ativa"},
    {l:"Champions", v:championsSeg?.count || 0, s:Math.round((championsSeg?.count || 0) / (totalClis || 1) * 100) + "% da base"},
    {l:"Clientes VIP", v:vipSeg?.count || 0, s:Math.round((vipSeg?.count || 0) / (totalClis || 1) * 100) + "% da base"},
    {l:"Em Risco", v:riscoSeg?.count || 0, s:Math.round((riscoSeg?.count || 0) / (totalClis || 1) * 100) + "% da base"},
    {l:"Novos", v:novosSeg?.count || 0, s:Math.round((novosSeg?.count || 0) / (totalClis || 1) * 100) + "% da base"},
    {l:"Ticket Médio", v:fmtBRL(avgTicketGeral), s:"por pedido"},
    {l:"Receita Total", v:fmtBRL(totalRevenue), s:"acumulada"}
  ].map(s => `<div class="stat"><div class="stat-label">${s.l}</div><div class="stat-value">${s.v}</div><div class="stat-sub">${s.s}</div></div>`).join("");

  // Lista de Cards
  listHost.innerHTML = computedSegments.map(s => `
    <div class="canal-card" style="cursor:pointer; transition:transform 0.2s" onclick="openSegmentDetail('${s.id}')" onmouseover="this.style.transform='translateY(-4px)'" onmouseout="this.style.transform='none'">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px">
        <div>
          <div style="font-size:15px; font-weight:800; color:var(--chiva-primary-light)">${escapeHTML(s.name)}</div>
          <div style="font-size:11px; color:var(--text-3); margin-top:2px">${escapeHTML(s.desc)}</div>
        </div>
        <div class="badge" style="background:var(--chiva-primary-bg); color:var(--chiva-primary)">${s.count} clis · ${Math.round((s.pctBase || 0) * 100)}%</div>
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px">
        <div>
          <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; font-weight:700">Receita</div>
          <div style="font-size:14px; font-weight:700; font-family:var(--mono)">${fmtBRL(s.revenue)}</div>
        </div>
        <div>
          <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; font-weight:700">Ticket Médio</div>
          <div style="font-size:14px; font-weight:700; font-family:var(--mono)">${fmtBRL(s.avgTicket)}</div>
        </div>
      </div>

      <div style="display:flex; gap:8px" onclick="event.stopPropagation()">
        <button class="btn" style="flex:1; font-size:10px; padding:6px" onclick="openSegmentDetail('${s.id}')">Ver clientes</button>
        <button class="btn" style="flex:1; font-size:10px; padding:6px" onclick="exportSegmentData('${s.id}')">Exportar</button>
        <button class="btn-primary" style="flex:1; font-size:10px; padding:6px" onclick="toast('Campanha iniciada para ${s.name}')">Campanha</button>
      </div>
    </div>
  `).join("");
}

function openSegmentDetail(id){
  currentSegmentId = id;
  const seg = computedSegments.find(s => s.id === id);
  if(!seg) return;

  const titleEl = document.getElementById('seg-detalhe-title');
  const descEl = document.getElementById('seg-detalhe-desc');
  if(titleEl) titleEl.textContent = seg.name;
  if(descEl) descEl.textContent = seg.desc;

  // Stats interna
  const statsHost = document.getElementById('seg-detalhe-stats');
  if(statsHost){
    statsHost.innerHTML = [
      {l:"Clientes", v:seg.count, s:"no grupo"},
      {l:"Receita Total", v:fmtBRL(seg.revenue), s:"acumulada"},
      {l:"Ticket Médio", v:fmtBRL(seg.avgTicket), s:"do grupo"},
      {l:"% da Base", v:Math.round((seg.pctBase || 0) * 100) + "%", s:"participação"}
    ].map(s => `<div class="stat"><div class="stat-label">${s.l}</div><div class="stat-value">${s.v}</div><div class="stat-sub">${s.s}</div></div>`).join("");
  }

  showPage('segmento-detalhe');
  renderSegmentCustomers();
  renderSegmentCharts(seg);
}

function renderSegmentCustomers(){
  const host = document.getElementById('seg-cust-list');
  if(!host) return;

  const seg = computedSegments.find(s => s.id === currentSegmentId);
  if(!seg) return;

  const q = String(document.getElementById('seg-cust-search')?.value || "").toLowerCase();
  const list = seg.customers.filter(c => 
    String(c.nome || "").toLowerCase().includes(q) || 
    String(c.email || "").toLowerCase().includes(q)
  );

  if(!list.length){
    host.innerHTML = `<div class="empty">Nenhum cliente encontrado</div>`;
    return;
  }

  host.innerHTML = `
    <table class="chiva-table">
      <thead>
        <tr>
          <th>Nome</th>
          <th>Cidade</th>
          <th style="text-align:right">Total Gasto</th>
          <th style="text-align:right">Pedidos</th>
          <th style="text-align:right">Risco Churn</th>
          <th>Favorito</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(c => `
          <tr style="cursor:pointer" onclick="openClienteDrawer('${c.id}')">
            <td>
              <div style="font-weight:700">${escapeHTML(c.nome || "—")}</div>
              <div style="font-size:10px; color:var(--text-3)">${escapeHTML(c.email || "—")}</div>
            </td>
            <td>${escapeHTML(c.cidade || "—")} ${escapeHTML(c.uf || "")}</td>
            <td style="text-align:right; font-family:var(--mono)">${fmtBRL(c.total_gasto || 0)}</td>
            <td style="text-align:right">${c.total_pedidos || 0}</td>
            <td style="text-align:right">
              <span style="color:${(c.risco_churn||0) > 60 ? 'var(--red)' : (c.risco_churn||0) > 30 ? 'var(--amber)' : 'var(--green)'}">
                ${c.risco_churn || 0}%
              </span>
            </td>
            <td><span class="badge">${escapeHTML(c.produto_favorito || "—")}</span></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderSegmentCharts(seg){
  // Cidades
  const cities = {};
  seg.customers.forEach(c => { const k = c.cidade || "Não inf."; cities[k] = (cities[k]||0) + 1; });
  const topCities = Object.entries(cities).sort((a,b) => b[1]-a[1]).slice(0,5);
  const citiesHost = document.getElementById('seg-chart-cidades');
  if(citiesHost) citiesHost.innerHTML = topCities.map(([name, count]) => `
    <div style="margin-bottom:10px">
      <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px">
        <span>${escapeHTML(name)}</span>
        <span style="font-weight:700">${count}</span>
      </div>
      <div style="height:6px; background:var(--border); border-radius:10px; overflow:hidden">
        <div style="height:100%; background:var(--chiva-primary); width:${Math.min(100, count/seg.count*100)}%"></div>
      </div>
    </div>
  `).join("") || '<div class="empty">Sem dados</div>';

  // Produtos
  const prods = {};
  seg.customers.forEach(c => { const k = c.produto_favorito || "Não inf."; prods[k] = (prods[k]||0) + 1; });
  const topProds = Object.entries(prods).sort((a,b) => b[1]-a[1]).slice(0,5);
  const prodsHost = document.getElementById('seg-chart-produtos');
  if(prodsHost) prodsHost.innerHTML = topProds.map(([name, count]) => `
    <div style="margin-bottom:10px">
      <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px">
        <span>${escapeHTML(name)}</span>
        <span style="font-weight:700">${count}</span>
      </div>
      <div style="height:6px; background:var(--border); border-radius:10px; overflow:hidden">
        <div style="height:100%; background:var(--indigo-hi); width:${Math.min(100, count/seg.count*100)}%"></div>
      </div>
    </div>
  `).join("") || '<div class="empty">Sem dados</div>';
}

function exportSegmentData(id){
  const seg = id ? computedSegments.find(s => s.id === id) : { name: "Todos Clientes", customers: allCustomers };
  if(!seg || !seg.customers.length) return toast("Nenhum dado para exportar");

  const headers = ["Nome", "Email", "Telefone", "Cidade", "UF", "Total Gasto", "Pedidos", "Favorito"];
  const csv = [
    headers.join(";"),
    ...seg.customers.map(c => [
      c.nome, c.email, c.telefone, c.cidade, c.uf, c.total_gasto, c.total_pedidos, c.produto_favorito
    ].join(";"))
  ].join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", `segmento_${seg.name.toLowerCase().replace(/\s/g, '_')}.csv`);
  link.click();
  toast("✅ CSV gerado com sucesso!");
}

function selectSegment(id){
  showPage('inteligencia');
  setTimeout(() => openSegmentDetail(id), 200);
}

function renderAll(){
  safeInvokeName("renderDash");
  safeInvokeName("renderClientes");
  safeInvokeName("renderInteligencia");
  safeInvokeName("renderProdutos");
  safeInvokeName("renderCidades");
  safeInvokeName("renderAlertas");
  safeInvokeName("renderTarefas");
  safeInvokeName("renderInsumos");
  safeInvokeName("renderOrdens");
  safeInvokeName("renderProdKpis");
  safeInvokeName("renderComKpis");
  safeInvokeName("renderMarcaKpis");
  safeInvokeName("renderComPedidos");
  safeInvokeName("renderCanaisGrid");
  safeInvokeName("renderCampanhas");
  safeInvokeName("renderCalendario");
  safeInvokeName("renderDegustacoes");
  safeInvokeName("renderIADashboard");
  safeInvokeName("recalculateSegments");
}

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════
function detectCh(o){
  const doc=(o.contato?.cpfCnpj||o.contato?.numeroDocumento||"").replace(/\D/g,"");
  if(doc.length===14) return "cnpj";

  const norm=(v)=>String(v||"")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"");

  const known={ml:1,shopee:1,amazon:1,shopify:1,cnpj:1,yampi:1,outros:1};
  const origemCanal = norm(o?.origem_canal || o?.origemCanal || "");
  if(origemCanal){
    if(origemCanal === "mercado_livre") return "ml";
    if(origemCanal === "b2b") return "cnpj";
    if(known[origemCanal]) return origemCanal;
  }
  const canalRaw = norm(o?.canal?.nome || o?.canal?.descricao || o?.canal);
  const origemRaw = norm(o?.origem?.nome || o?.origem?.descricao || o?.origem);
  const lojaRaw = norm(o?.loja?.nome || o?.loja?.descricao || o?.loja);
  const srcRaw = norm(o?._source || o?.source);
  const numRaw = norm(o?.numero || o?.numeroPedidoEcommerce || o?._raw?.numeroPedidoEcommerce || o?.numero_pedido || o?.id);

  const guess = (s)=>{
    const t = norm(s);
    if(!t) return "";
    if(/\bshopify\b|\bsite\b/.test(t)) return "shopify";
    if(/\bmercado\s*livre\b|\bmercadolivre\b|\bmeli\b|\bmlb\b/.test(t)) return "ml";
    if(/\bshopee\b/.test(t)) return "shopee";
    if(/\byampi\b/.test(t)) return "yampi";
    if(/\bamazon\b/.test(t)) return "amazon";
    return "";
  };

  const g1 = guess(canalRaw);
  if(g1) return g1;
  const g2 = guess(origemRaw);
  if(g2) return g2;
  const g3 = guess(lojaRaw);
  if(g3) return g3;

  if(srcRaw && known[srcRaw]) return srcRaw;

  const fields = [
    o.observacoes,
    o.ecommerce?.nome, o.ecommerce?.descricao,
    o.numeroPedidoEcommerce,
    o._raw?.loja?.nome,
    o._raw?.observacoes
  ].map(norm).join(" ");
  const gx = guess(fields);
  if(gx) return gx;

  if(/^mlb/.test(numRaw) || /^ml[\W_]/.test(numRaw) || /^ml\d/.test(numRaw)) return "ml";
  if(/^shopee/.test(numRaw) || /^sp[\W_]/.test(numRaw) || /^sp\d/.test(numRaw)) return "shopee";
  if(/^shopify/.test(numRaw) || /^sh[\W_]/.test(numRaw) || /^sh\d/.test(numRaw)) return "shopify";

  const canal = norm(o?._canal);
  if(canal && known[canal]) return canal;
  return "outros";
}
const CH={ml:"Mercado Livre",shopee:"Shopee",amazon:"Amazon",shopify:"Site (Shopify)",cnpj:"B2B (Atacado)",yampi:"Yampi",outros:"Outros"};
const CH_COLOR={ml:"#f3b129",shopee:"#f06320",amazon:"#00a8e0",shopify:"#96bf48",yampi:"#e040fb",cnpj:"#f59e0b",outros:"#9b8cff"};
function normCanalKey(v){
  return String(v||"").toLowerCase().trim();
}
function clienteTemPedidoNoCanal(clienteId, canal){
  const canalFiltro = normCanalKey(canal);
  if(!canalFiltro) return true;
  const cid = String(clienteId||"").trim();
  if(!cid) return false;
  const list = Array.isArray(allOrders) ? allOrders : [];
  return list.some(o=>{
    const ehDoCliente =
      String(cliKey(o)||"").trim() === cid ||
      String(orderCustomerKey(o)||"").trim() === cid ||
      String(o?.cliente_id||"").trim() === cid;
    if(!ehDoCliente) return false;
    const ch = normCanalKey(detectCh(o));
    return ch === canalFiltro;
  });
}
function normSt(s){ const v=(s?.nome||s?.id||s||"").toString().toLowerCase(); if(/aprovado|pago|conclu|fatur|enviado|entregue|paid|authorized/i.test(v)) return "aprovado"; if(/pendent|aguard|aberto|novo|pending/i.test(v)) return "pendente"; if(/cancel|refund|void/i.test(v)) return "cancelado"; return "outros"; }
const ST_LABEL={aprovado:"Aprovado",pendente:"Pendente",cancelado:"Cancelado"};
const ST_CLASS={aprovado:"s-aprovado",pendente:"s-pendente",cancelado:"s-cancelado"};
function fmtBRL(v){ return(parseFloat(v)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); }
function fmtDate(d){
  if(!d) return "—";
  const s = String(d).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(br) return s;
  const dt = new Date(s);
  return isNaN(dt) ? "—" : dt.toLocaleDateString("pt-BR");
}
function parseDateToIso(v){
  const s = String(v || "").trim();
  if(!s) return "";
  const onlyDigits = s.replace(/\D/g,"");
  if(/^\d{8}$/.test(onlyDigits) && !s.includes("-")){
    const dd = onlyDigits.slice(0,2);
    const mm = onlyDigits.slice(2,4);
    const yyyy = onlyDigits.slice(4,8);
    return `${yyyy}-${mm}-${dd}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(iso) return s;
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(br) return `${br[3]}-${br[2]}-${br[1]}`;
  return "";
}

function formatDateMaskValue(raw){
  const digits = String(raw || "").replace(/\D/g,"").slice(0,8);
  if(!digits) return "";
  const dd = digits.slice(0,2);
  const mm = digits.slice(2,4);
  const yyyy = digits.slice(4,8);
  if(digits.length <= 2) return dd;
  if(digits.length <= 4) return `${dd}/${mm}`;
  return `${dd}/${mm}/${yyyy}`;
}

function attachDateMask(el){
  if(!el || el.dataset?.dateMaskBound === "1") return;
  el.dataset.dateMaskBound = "1";
  el.addEventListener("input", ()=>{
    const next = formatDateMaskValue(el.value);
    if(el.value !== next) el.value = next;
  });
  el.addEventListener("blur", ()=>{
    const iso = parseDateToIso(el.value);
    if(!iso){
      if(String(el.value||"").trim()) el.value = "";
      return;
    }
    el.value = fmtDate(iso);
  });
  if(String(el.value||"").trim()){
    const next = formatDateMaskValue(el.value);
    if(el.value !== next) el.value = next;
  }
}

function bindDateMasks(root){
  try{
    const scope = root && root.querySelectorAll ? root : document;
    const els = scope.querySelectorAll('input[data-date-mask="1"]');
    els.forEach(attachDateMask);
  }catch(_e){}
}
function fmtDoc(d){ d=(d||"").replace(/\D/g,""); if(d.length===11)return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4"); if(d.length===14)return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5"); return d; }
function fmtPhone(p){ p=(p||"").replace(/\D/g,""); if(!p)return""; if(p.length===11)return`(${p.slice(0,2)}) ${p.slice(2,7)}-${p.slice(7)}`; if(p.length===10)return`(${p.slice(0,2)}) ${p.slice(2,6)}-${p.slice(6)}`; return p; }
function rawPhone(p){ return(p||"").replace(/\D/g,""); }
function daysSince(ds){ if(!ds)return 9999; const d=new Date(ds); return isNaN(d)?9999:Math.floor((Date.now()-d)/86400000); }
function isCNPJ(doc){ return (doc||"").replace(/\D/g,"").length===14; }
function cleanText(v){
  const s = String(v ?? "").trim();
  if(!s) return "";
  if(s === "-" || s === "—") return "";
  return s;
}
function cleanEmail(v){
  const s = cleanText(v).toLowerCase();
  return s.includes("@") ? s : "";
}
function cleanPhoneDigits(v){
  const d = String(v ?? "").replace(/\D/g,"");
  return d.length>=10 ? d : "";
}
function cleanDocDigits(v){
  const d = String(v ?? "").replace(/\D/g,"");
  return (d.length===11 || d.length===14) ? d : "";
}
function cleanCepDigits(v){
  const d = String(v ?? "").replace(/\D/g,"");
  return d.length===8 ? d : "";
}

function buildCli(list){
  const m={};
  list.forEach(o=>{
    const k = orderCustomerKey(o);
    if(!m[k]) m[k]={id:k,nome:o.contato?.nome||"Desconhecido",doc:o.contato?.cpfCnpj||"",email:o.contato?.email||"",telefone:o.contato?.telefone||o.contato?.celular||"",cidade:o.contato?.endereco?.municipio||"",uf:o.contato?.endereco?.uf||"",cep:o.contato?.endereco?.cep||"",orders:[],channels:new Set(),last:null,first:null};
    m[k].orders.push(o);
    m[k].channels.add(detectCh(o));
    
    // Atualiza campos se estiverem vazios
    if(!m[k].email && o.contato?.email) m[k].email = o.contato.email;
    if(!m[k].telefone && (o.contato?.telefone || o.contato?.celular)) m[k].telefone = o.contato?.telefone || o.contato?.celular;
    if(!m[k].cidade && o.contato?.endereco?.municipio) m[k].cidade = o.contato.endereco.municipio;
    if(!m[k].uf && o.contato?.endereco?.uf) m[k].uf = o.contato.endereco.uf;
    if(!m[k].doc && o.contato?.cpfCnpj) m[k].doc = o.contato.cpfCnpj;
    if(!m[k].cep && o.contato?.endereco?.cep) m[k].cep = o.contato.endereco.cep;

    const d=new Date(o.data);
    if(!isNaN(d)){
      const ds = d.toISOString().slice(0,10);
      if(!m[k].last || ds > m[k].last) m[k].last = ds;
      if(!m[k].first || ds < m[k].first) m[k].first = ds;
    }
  });
  return m;
}

// ── Scores ──────────────────────────────────────────
function calcCliScores(c){
  if(!c || typeof c !== "object") return {ltv:0,recorrencia:0,recompraScore:0,churnRisk:0,avgInterval:null,status:"outros",n:0,ds:9999,isCnpj:false};
  if(!Array.isArray(c.orders)) c.orders = [];
  if(!c.orders.length && Array.isArray(allOrders) && allOrders.length){
    const cid = String(c.id || "").trim();
    if(cid){
      const rebuilt = allOrders.filter(o=>{
        const ok1 = String(orderCustomerKey(o)||"").trim() === cid;
        const ok2 = String(cliKey(o)||"").trim() === cid;
        return ok1 || ok2 || String(o?.cliente_id||"").trim() === cid;
      });
      if(rebuilt.length) c.orders = rebuilt;
    }
  }
  const tot=c.orders.reduce((s,o)=>s+val(o),0);
  const n=c.orders.length;
  const ds=daysSince(c.last);
  const ad=parseInt(localStorage.getItem("crm_alertdays")||"60");
  const isCnpj=isCNPJ(c.doc);

  // LTV = total gasto
  const ltv=tot;

  // Recorrência: % de clientes com 2+ pedidos = bom sinal
  const recorrencia=n>=3?100:n===2?60:0;

  // Intervalo médio de compras (dias)
  let avgInterval=null;
  if(n>=2){
    const sorted=c.orders.map(o=>new Date(o.data)).filter(d=>!isNaN(d)).sort((a,b)=>a-b);
    const gaps=sorted.slice(1).map((d,i)=>Math.floor((d-sorted[i])/86400000));
    avgInterval=gaps.length?Math.round(gaps.reduce((s,g)=>s+g,0)/gaps.length):null;
  }

  // Score de recompra (0-100)
  let recompraScore=0;
  if(n>=3) recompraScore+=40; else if(n===2) recompraScore+=20;
  if(ds<30) recompraScore+=30; else if(ds<60) recompraScore+=15; else if(ds<90) recompraScore+=5;
  if(tot>=650&&!isCnpj) recompraScore+=20;
  if(avgInterval&&avgInterval<45) recompraScore+=10;
  recompraScore=Math.min(recompraScore,100);
  if(recompraScore === 0 && n > 0 && localStorage.getItem("crm_debug_scores")==="1"){
    try{ console.warn("[Score zero inesperado]", c.id, c.nome, "pedidos:", n); }catch(_e){}
  }

  // Risco de churn (0-100)
  let churnRisk=0;
  if(ds>120) churnRisk=90; else if(ds>90) churnRisk=70; else if(ds>60) churnRisk=45; else if(ds>30) churnRisk=20;
  if(n===1) churnRisk+=15;
  churnRisk=Math.min(churnRisk,100);

  // Status
 const meta = (typeof cliMetaCache !== "undefined" && cliMetaCache && cliMetaCache[c.id]) ? cliMetaCache[c.id] : (cliMeta && cliMeta[c.id] ? cliMeta[c.id] : {});
  let status=meta.status;
  if(!status){
    if(isCnpj) status="cnpj";
    else if(tot>=650&&n>=1) status="vip";
    else if(n===1&&ds<=60) status="novo";
    else if(ds>ad) status="inativo";
    else status="ativo";
  }

  return {ltv,recorrencia,recompraScore,churnRisk,avgInterval,status,n,ds,isCnpj};
}

function populateUFs(){
  const ufs = new Set();
  const add = (v)=>{
    const uf = normalizeUF(v);
    if(uf) ufs.add(uf);
  };
  (Array.isArray(allOrders) ? allOrders : []).forEach(o=>{
    add(o?.uf_entrega);
    add(o?.contato?.endereco?.uf);
    add(o?.contato?.uf);
    add(o?.uf);
    add(o?.state);
    add(o?.contato?.endereco?.estado);
    add(o?.contato?.endereco?.state);
  });
  (Array.isArray(allCustomers) ? allCustomers : []).forEach(c=>{
    add(c?.uf);
    add(c?.endereco?.uf);
    add(c?.endereco?.estado);
  });
  ["fil-estado","fil-uf"].forEach(id=>{
    const s = document.getElementById(id);
    if(!s) return;
    const v = s.value;
    s.innerHTML = `<option value="">Todos estados</option>` +
      [...ufs].sort().map(uf=>`<option>${escapeHTML(uf)}</option>`).join("");
    s.value = v;
  });
}

// ═══════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════
let dashRevenueCache = { at: 0, rows: null };

async function renderDashRevenueFromSupabase(){
  if(!supaConnected || !supaClient) return false;
  const yearSel = document.getElementById("dash-year");
  const nowTs = Date.now();
  if(!dashRevenueCache.rows || (nowTs - dashRevenueCache.at) > 3*60*1000){
    const {data, error} = await supaClient
      .from("vw_dashboard_revenue_growth")
      .select("*")
      .limit(5000);
    if(error) throw error;
    dashRevenueCache = { at: nowTs, rows: Array.isArray(data) ? data : [] };
  }
  const rows = Array.isArray(dashRevenueCache.rows) ? dashRevenueCache.rows : [];

  const pickNum = (row, keys)=>{
    for(const k of keys){
      const v = row?.[k];
      if(v == null) continue;
      const n = Number(v);
      if(Number.isFinite(n)) return n;
    }
    return 0;
  };

  const pickYear = (row)=>{
    const y = row?.ano ?? row?.year ?? row?.yyyy;
    const yn = Number(y);
    if(Number.isFinite(yn) && yn > 1900 && yn < 2200) return yn;
    const ref = row?.mes ?? row?.month ?? row?.periodo ?? row?.period;
    const s = String(ref || "");
    const m = s.match(/(20\d{2})/);
    if(m) return Number(m[1]);
    return null;
  };

  const pickMonth = (row)=>{
    const m = row?.mes_num ?? row?.mes ?? row?.month ?? row?.mm;
    const mn = Number(m);
    if(Number.isFinite(mn) && mn >= 1 && mn <= 12) return mn;
    const ref = row?.periodo ?? row?.period ?? row?.mes ?? "";
    const s = String(ref || "");
    const mm = s.match(/(?:20\d{2})[-/](\d{1,2})/);
    if(mm){
      const n = Number(mm[1]);
      if(Number.isFinite(n) && n >= 1 && n <= 12) return n;
    }
    return null;
  };

  const revenueKeys = ["faturamento", "receita", "revenue", "total", "valor", "valor_total", "total_revenue"];
  const years = Array.from(new Set(rows.map(pickYear).filter(Boolean))).sort((a,b)=>b-a);
  const storedYear = Number(localStorage.getItem("crm_dash_year") || "");
  const defaultYear = years.includes(new Date().getFullYear()) ? new Date().getFullYear() : (years[0] || new Date().getFullYear());
  const selectedYear = yearSel ? (Number(yearSel.value||storedYear||defaultYear) || defaultYear) : (storedYear || defaultYear);

  if(yearSel){
    const current = String(yearSel.value || storedYear || "");
    yearSel.innerHTML = `<option value="">Ano</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join("");
    yearSel.value = years.includes(Number(current)) ? String(Number(current)) : String(selectedYear);
    localStorage.setItem("crm_dash_year", yearSel.value || String(selectedYear));
  }

  const byMonth = new Array(12).fill(0);
  rows.forEach(r=>{
    const y = pickYear(r);
    if(y !== selectedYear) return;
    const m = pickMonth(r);
    if(m == null) return;
    byMonth[m-1] += pickNum(r, revenueKeys);
  });

  const labels = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const growth = byMonth.map((v,i)=>{
    if(i===0) return 0;
    const prev = byMonth[i-1] || 0;
    if(prev <= 0) return 0;
    return ((v - prev) / prev) * 100;
  });

  const canvasMes = document.getElementById("chart-mes");
  if(canvasMes && canvasMes.getContext){
    const ctx = canvasMes.getContext("2d");
    if(ctx){
      if(charts.mes) charts.mes.destroy();
      const grad = ctx.createLinearGradient(0,0,0,180);
      grad.addColorStop(0, "rgba(164,233,107,.35)");
      grad.addColorStop(1, "rgba(15,167,101,0)");
      charts.mes = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "Faturamento",
            data: byMonth,
            tension: 0.35,
            fill: true,
            backgroundColor: grad,
            borderColor: "#A4E96B",
            borderWidth: 2,
            pointRadius: 0,
            pointHitRadius: 12
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c)=>fmtBRL(c.parsed.y||0) } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 } } },
            y: { grid: { color: "rgba(255,255,255,.06)" }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 }, callback: (v)=>fmtBRL(v) } }
          }
        }
      });
    }
  }

  const canvasGrow = document.getElementById("chart-crescimento");
  if(canvasGrow && canvasGrow.getContext){
    const ctx = canvasGrow.getContext("2d");
    if(ctx){
      if(charts.crescimento) charts.crescimento.destroy();
      charts.crescimento = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "Crescimento",
            data: growth,
            tension: 0.35,
            fill: false,
            borderColor: "#60a5fa",
            borderWidth: 2,
            pointRadius: 0,
            pointHitRadius: 12
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c)=>(Number(c.parsed.y||0).toFixed(1)+"%") } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 } } },
            y: { grid: { color: "rgba(255,255,255,.06)" }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 }, callback: (v)=>String(v)+"%" } }
          }
        }
      });
    }
  }

  return true;
}

let dashRenderTimer = null;
let dashLastYearRange = "";
let dashAutoAdjustedRange = false;

function isDashCompareEnabled(){
  const v = String(localStorage.getItem("crm_dash_compare") || "1").trim();
  return v !== "0";
}
function toggleDashCompare(){
  const next = isDashCompareEnabled() ? "0" : "1";
  localStorage.setItem("crm_dash_compare", next);
  renderDash();
}
function isDashMAEnabled(){
  const v = String(localStorage.getItem("crm_dash_ma") || "0").trim();
  return v === "1";
}
function toggleDashMA(){
  const next = isDashMAEnabled() ? "0" : "1";
  localStorage.setItem("crm_dash_ma", next);
  renderDash();
}

function detectTipoVenda(o){
  const raw = String(o?.tipo_venda ?? o?.tipoVenda ?? "").trim().toLowerCase();
  if(raw === "b2b" || raw === "b2c") return raw;
  const doc = String(o?.contato?.cpfCnpj || o?.contato?.numeroDocumento || "").replace(/\D/g,"");
  if(doc.length === 14) return "b2b";
  return "b2c";
}

function renderDash(){
  if(dashRenderTimer) clearTimeout(dashRenderTimer);
  dashRenderTimer = setTimeout(()=>{
    dashRenderTimer = null;
    renderDashNow();
  }, 80);
}

function renderDashNow(){
  const yearSel = document.getElementById("dash-year");
  if(yearSel){
    const stored = String(localStorage.getItem("crm_dash_year")||"").trim();
    if(stored && !yearSel.value) yearSel.value = stored;
    if(yearSel.value) localStorage.setItem("crm_dash_year", String(yearSel.value));
  }
  const dashSel = document.getElementById("dash-canal-filter");
  if(dashSel){
    const stored = String(localStorage.getItem("crm_dash_canal")||"").toLowerCase().trim();
    if(stored && !dashSel.value) dashSel.value = stored;
  }
  const dashTipoSel = document.getElementById("dash-tipo-filter");
  if(dashTipoSel){
    const stored = String(localStorage.getItem("crm_dash_tipo")||"").toLowerCase().trim();
    if(stored && !dashTipoSel.value) dashTipoSel.value = stored;
  }
  const fromEl = document.getElementById("dash-from");
  const toEl = document.getElementById("dash-to");
  if(fromEl && toEl){
    const storedFrom = String(localStorage.getItem("crm_dash_from") || "").trim();
    const storedTo = String(localStorage.getItem("crm_dash_to") || "").trim();
    if(storedFrom && !fromEl.value) fromEl.value = fmtDate(storedFrom);
    if(storedTo && !toEl.value) toEl.value = fmtDate(storedTo);

    const selectedYear = Number(yearSel?.value || "");
    if(selectedYear && selectedYear > 1900 && selectedYear < 2200){
      const yearKey = String(selectedYear);
      if(dashLastYearRange !== yearKey){
        const now = new Date();
        const from = new Date(selectedYear, 0, 1);
        const to = (selectedYear === now.getFullYear()) ? now : new Date(selectedYear, 11, 31);
        fromEl.value = fmtDate(iso(from));
        toEl.value = fmtDate(iso(to));
        localStorage.setItem("crm_dash_from", iso(from));
        localStorage.setItem("crm_dash_to", iso(to));
        dashLastYearRange = yearKey;
      }
    }else{
      dashLastYearRange = "";
    }

    if(!fromEl.value || !toEl.value){
      const to = new Date();
      const from = new Date();
      from.setDate(to.getDate() - 29);
      fromEl.value = fmtDate(iso(from));
      toEl.value = fmtDate(iso(to));
      localStorage.setItem("crm_dash_from", iso(from));
      localStorage.setItem("crm_dash_to", iso(to));
    }else{
      const fromIso = parseDateToIso(fromEl.value);
      const toIso = parseDateToIso(toEl.value);
      if(fromIso) localStorage.setItem("crm_dash_from", fromIso);
      if(toIso) localStorage.setItem("crm_dash_to", toIso);
    }
  }
  const dashCh = normCanalKey(dashSel?.value||"");
  if(dashSel) localStorage.setItem("crm_dash_canal", dashCh);
  const dashTipo = String(dashTipoSel?.value || "").trim().toLowerCase();
  if(dashTipoSel) localStorage.setItem("crm_dash_tipo", dashTipo);
  const ordersBase = Array.isArray(allOrders) ? allOrders : [];
  const selectedYear = Number(yearSel?.value || "");
  const fromIso = String(localStorage.getItem("crm_dash_from") || "").trim();
  const toIso = String(localStorage.getItem("crm_dash_to") || "").trim();
  const fromTs = fromIso ? new Date(fromIso + "T00:00:00").getTime() : null;
  const toTs = toIso ? new Date(toIso + "T23:59:59").getTime() : null;
  const ordersAllRange = ordersBase.filter(o=>{
    const raw = o?.data || o?.dataPedido || o?.data_pedido || o?.created_at || "";
    const s = String(raw || "").slice(0,10);
    if(!s) return false;
    const dt = new Date(s + "T12:00:00");
    const dts = dt.getTime();
    if(!isFinite(dts)) return false;
    if(fromTs != null && dts < fromTs) return false;
    if(toTs != null && dts > toTs) return false;
    if(selectedYear && selectedYear > 1900 && selectedYear < 2200){
      const y = dt.getFullYear();
      if(y !== selectedYear) return false;
    }
    return true;
  });

  if(!selectedYear && ordersBase.length && !ordersAllRange.length && !dashAutoAdjustedRange){
    let lastDateIso = "";
    let lastTs = 0;
    ordersBase.forEach(o=>{
      const raw = o?.data || o?.dataPedido || o?.data_pedido || o?.created_at || "";
      const s = String(raw || "").slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return;
      const ts = new Date(s + "T12:00:00").getTime();
      if(!isFinite(ts)) return;
      if(ts > lastTs){
        lastTs = ts;
        lastDateIso = s;
      }
    });
    if(lastDateIso){
      const to = new Date(lastDateIso + "T12:00:00");
      const from = new Date(to);
      from.setDate(to.getDate() - 29);
      const adjFrom = iso(from);
      const adjTo = iso(to);
      localStorage.setItem("crm_dash_from", adjFrom);
      localStorage.setItem("crm_dash_to", adjTo);
      if(fromEl) fromEl.value = fmtDate(adjFrom);
      if(toEl) toEl.value = fmtDate(adjTo);
      dashAutoAdjustedRange = true;
      renderDash();
      return;
    }
  }

  try{
    const compareBtn = document.getElementById("dash-compare-btn");
    const maBtn = document.getElementById("dash-ma-btn");
    const r30 = document.getElementById("dash-range-30");
    const r90 = document.getElementById("dash-range-90");
    if(compareBtn) compareBtn.classList.toggle("active", isDashCompareEnabled());
    if(maBtn) maBtn.classList.toggle("active", isDashMAEnabled());
    const diffDays = (fromTs != null && toTs != null) ? Math.round((toTs - fromTs) / (24*60*60*1000)) + 1 : 0;
    if(r30) r30.classList.toggle("active", diffDays === 30);
    if(r90) r90.classList.toggle("active", diffDays === 90);
  }catch(_e){}

  const ordersTipo = dashTipo ? ordersAllRange.filter(o=>detectTipoVenda(o) === dashTipo) : ordersAllRange;
  const ordersSales = dashCh ? ordersTipo.filter(o=>normCanalKey(detectCh(o)) === dashCh && clienteTemPedidoNoCanal(orderCustomerKey(o), dashCh)) : ordersTipo;
  const prevRange = (fromIso && toIso) ? calcPrevRange(fromIso, toIso) : null;
  const ordersPrevAll = prevRange ? ordersBase.filter(o=>{
    const raw = o?.data || o?.dataPedido || o?.data_pedido || o?.created_at || "";
    const s = String(raw || "").slice(0,10);
    if(!s) return false;
    const dt = new Date(s + "T12:00:00");
    const dts = dt.getTime();
    if(!isFinite(dts)) return false;
    const pf = new Date(prevRange.prevFromIso + "T00:00:00").getTime();
    const pt = new Date(prevRange.prevToIso + "T23:59:59").getTime();
    if(dts < pf || dts > pt) return false;
    if(selectedYear && selectedYear > 1900 && selectedYear < 2200){
      const y = dt.getFullYear();
      if(y !== selectedYear) return false;
    }
    return true;
  }) : [];
  const ordersPrevTipo = dashTipo ? ordersPrevAll.filter(o=>detectTipoVenda(o) === dashTipo) : ordersPrevAll;
  const ordersPrevSales = dashCh ? ordersPrevTipo.filter(o=>normCanalKey(detectCh(o)) === dashCh && clienteTemPedidoNoCanal(orderCustomerKey(o), dashCh)) : ordersPrevTipo;

  // Atualizar período
  const dp = document.getElementById("dash-period");
  if(dp){
    const fromLabel = fromEl?.value ? String(fromEl.value) : (fromIso ? fmtDate(fromIso) : "");
    const toLabel = toEl?.value ? String(toEl.value) : (toIso ? fmtDate(toIso) : "");
    const bits = [];
    if(fromLabel && toLabel) bits.push(fromLabel + " — " + toLabel);
    if(dashCh) bits.push(CH[dashCh] || dashCh);
    if(dashTipo) bits.push(dashTipo.toUpperCase());
    bits.push(String(ordersSales.length) + " pedidos");
    dp.textContent = bits.filter(Boolean).join(" · ");
  }

  const total=ordersSales.reduce((s,o)=>s+val(o),0);
  const totalPrev=ordersPrevSales.reduce((s,o)=>s+val(o),0);
  const now=new Date();
  const thisMo=ordersSales.filter(o=>{ const d=new Date(o.data); return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth(); });
  const prevMo=ordersSales.filter(o=>{ const d=new Date(o.data); const pm=now.getMonth()===0?11:now.getMonth()-1,py=now.getMonth()===0?now.getFullYear()-1:now.getFullYear(); return d.getFullYear()===py&&d.getMonth()===pm; });
  const tMo=thisMo.reduce((s,o)=>s+val(o),0),pMo=prevMo.reduce((s,o)=>s+val(o),0);
  const delta=pMo>0?((tMo-pMo)/pMo*100):0;
  const cliMap=buildCli(ordersSales);
  const cliList=Object.values(cliMap);
  const vipCount=cliList.filter(c=>calcCliScores(c).status==="vip").length;
  const recorrentes=cliList.filter(c=>c.orders.length>=2).length;
  const pctRec=cliList.length?Math.round(recorrentes/cliList.length*100):0;

  const sr = document.getElementById("source-row");
  if(sr) sr.innerHTML=
    (blingOrders.length?`<span style="background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.2);border-radius:7px;padding:3px 9px">🔵 Bling: ${blingOrders.length}</span>`:"")
    +(yampiOrders.length?`<span style="background:rgba(217,70,239,.1);border:1px solid rgba(217,70,239,.2);border-radius:7px;padding:3px 9px">🟣 Yampi: ${yampiOrders.length}</span>`:"")
    +(shopifyOrders.length?`<span style="background:rgba(150,191,72,.1);border:1px solid rgba(150,191,72,.2);border-radius:7px;padding:3px 9px">🟢 Shopify: ${shopifyOrders.length}</span>`:"")
    +(dashCh?`<span style="background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.18);border-radius:7px;padding:3px 9px">Filtro: ${escapeHTML(CH[dashCh]||dashCh)}</span>`:"")
    +(!ordersSales.length?`<span style="color:var(--text-3)">Sem dados no período</span>`:"");

  const dayEl = document.getElementById("dash-insights-day");
  if(dayEl){
    const ticket = ordersSales.length ? (total / ordersSales.length) : 0;
    const inativos30 = cliList.filter(c=>daysSince(c.last) >= 30).length;
    const potencial = inativos30 ? (inativos30 * ticket) : 0;
    const deltaTicket = pctDelta(ticket, (ordersPrevSales.length ? (totalPrev / ordersPrevSales.length) : 0));
    const insights = [];
    if(inativos30){
      insights.push(`⚠️ ${inativos30} clientes sem comprar há mais de 30 dias → potencial de recuperação de ${fmtBRL(potencial)}`);
    }
    if(deltaTicket != null && isFinite(deltaTicket) && Math.abs(deltaTicket) >= 8){
      const dir = deltaTicket >= 0 ? "subiu" : "caiu";
      insights.push(`📈 ticket médio ${dir} ${Math.abs(deltaTicket).toFixed(0)}% → oportunidade de kits promocionais`);
    }
    if(vipCount){
      insights.push(`💎 ${vipCount} clientes VIP ativos na base → priorize retenção e recompra`);
    }
    if(!insights.length){
      dayEl.innerHTML = "";
    }else{
      dayEl.innerHTML = `
        <div class="dash-day-insights">
          <div class="dash-day-insights-title">Insights do Dia</div>
          <div class="dash-day-insights-body">
            ${insights.slice(0,3).map(t=>`<div class="dash-day-insight">${escapeHTML(t)}</div>`).join("")}
          </div>
        </div>
      `;
    }
  }

  const autoEl = document.getElementById("auto-insights");
  if(autoEl){
    const weekMs = 7*86400000;
    const nowTs = Date.now();
    const inLast = (days)=>ordersSales.filter(o=>{ const d=new Date(o.data); return !isNaN(d) && (nowTs - d.getTime()) <= days*86400000; });
    const w1 = inLast(7);
    const w2 = ordersSales.filter(o=>{ const d=new Date(o.data); const dt=d.getTime(); return !isNaN(d) && (nowTs - dt) > weekMs && (nowTs - dt) <= 2*weekMs; });
    const t1 = w1.reduce((s,o)=>s+val(o),0);
    const t2 = w2.reduce((s,o)=>s+val(o),0);
    const ticket1 = w1.length ? t1/w1.length : 0;
    const ticket2 = w2.length ? t2/w2.length : 0;
    const ticketDelta = ticket2 > 0 ? ((ticket1-ticket2)/ticket2*100) : 0;

    const vips45 = cliList
      .filter(c=>calcCliScores(c).status==="vip" && daysSince(c.last) >= 45)
      .sort((a,b)=>daysSince(b.last)-daysSince(a.last))
      .slice(0,6);

    const prod7 = {};
    w1.forEach(o=>{
      const itens = getPedidoItens(o);
      itens.forEach(it=>{
        const k = String(it?.codigo||it?.descricao||"—");
        prod7[k] = (prod7[k]||0) + (Number(it?.quantidade||1)||1);
      });
    });
    const prod14 = {};
    w2.forEach(o=>{
      const itens = getPedidoItens(o);
      itens.forEach(it=>{
        const k = String(it?.codigo||it?.descricao||"—");
        prod14[k] = (prod14[k]||0) + (Number(it?.quantidade||1)||1);
      });
    });
    const stopped = Object.entries(prod14)
      .filter(([k,q])=>q>=6 && !prod7[k])
      .slice(0,1)
      .map(([k])=>k)[0];

    const insights = [];
    if(vips45.length){
      insights.push({
        title:`⚠ ${vips45.length} VIP sem comprar há 45+ dias`,
        desc:`Priorize reativação com oferta VIP e WhatsApp.`,
        cta:`Ver VIPs`,
        action:`showPage('inteligencia');selectSegment('vip')`
      });
    }
    if(ticket2 > 0 && Math.abs(ticketDelta) >= 8){
      const dir = ticketDelta >= 0 ? "subiu" : "caiu";
      insights.push({
        title:`📉 Ticket médio ${dir} ${Math.abs(ticketDelta).toFixed(0)}% na semana`,
        desc:`Compare últimos 7 dias vs semana anterior para ajustar oferta/kit.`,
        cta:`Comparar`,
        action:`showPage('dashboard');document.getElementById('cmp-card')?.scrollIntoView({behavior:'smooth',block:'start'})`
      });
    }
    if(stopped){
      insights.push({
        title:`📦 Produto com queda forte: ${stopped}`,
        desc:`Vendeu na semana anterior e zerou nos últimos 7 dias.`,
        cta:`Ver Produtos`,
        action:`showPage('produtos');document.getElementById('search-prod').value='${escapeJsSingleQuote(stopped)}';renderProdutos()`
      });
    }
    if(!insights.length){
      autoEl.innerHTML = "";
    }else{
      autoEl.innerHTML = `<div class="auto-insights">${insights.slice(0,3).map(i=>`
        <div class="insight">
          <div>
            <div class="insight-title">${escapeHTML(i.title)}</div>
            <div class="insight-desc">${escapeHTML(i.desc)}</div>
          </div>
          <button class="insight-cta" onclick="${i.action}">${escapeHTML(i.cta)}</button>
        </div>
      `).join("")}</div>`;
    }
  }

  const firstByCustomer = {};
  ordersBase.forEach(o=>{
    const k = orderCustomerKey(o);
    if(!k) return;
    const d = String(o?.data || o?.dataPedido || o?.data_pedido || o?.created_at || "").slice(0,10);
    if(!d) return;
    const ts = new Date(d + "T12:00:00").getTime();
    if(!isFinite(ts)) return;
    if(firstByCustomer[k] == null || ts < firstByCustomer[k]) firstByCustomer[k] = ts;
  });
  const novosSet = new Set();
  ordersSales.forEach(o=>{
    const k = orderCustomerKey(o);
    if(!k) return;
    const ts = firstByCustomer[k];
    if(ts == null) return;
    if(fromTs != null && ts < fromTs) return;
    if(toTs != null && ts > toTs) return;
    novosSet.add(k);
  });
  const novos = novosSet.size;
  const ticket = ordersSales.length ? (total / ordersSales.length) : 0;
  const ticketPrev = ordersPrevSales.length ? (totalPrev / ordersPrevSales.length) : 0;
  const pedidosPrev = ordersPrevSales.length;
  const novosPrevSet = new Set();
  if(prevRange){
    const pf = new Date(prevRange.prevFromIso + "T00:00:00").getTime();
    const pt = new Date(prevRange.prevToIso + "T23:59:59").getTime();
    ordersPrevSales.forEach(o=>{
      const k = orderCustomerKey(o);
      if(!k) return;
      const ts = firstByCustomer[k];
      if(ts == null) return;
      if(ts < pf || ts > pt) return;
      novosPrevSet.add(k);
    });
  }
  const novosPrev = novosPrevSet.size;
  const showCompare = isDashCompareEnabled();
  const deltaLine = (cur, prev)=>{
    if(!showCompare) return `<div class="dash-kpi-delta"> </div>`;
    const d = pctDelta(cur, prev);
    if(d == null || !isFinite(d)) return `<div class="dash-kpi-delta">—</div>`;
    const up = d >= 0;
    const cls = up ? "dash-kpi-delta-pos" : "dash-kpi-delta-neg";
    return `<div class="dash-kpi-delta ${cls}">${up ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}% <span class="dash-kpi-delta-sub">vs mês anterior</span></div>`;
  };

  const dashKpisEl = document.getElementById("dash-kpis");
  if(dashKpisEl){
    const items = [
      { key: "revenue", label: "Receita (30 dias)", value: fmtBRL(total), delta: deltaLine(total, totalPrev), icon: "💹", iconCls: "dash-kpi-icon--green", spark: "kpi-spark-revenue" },
      { key: "orders", label: "Pedidos", value: String(ordersSales.length), delta: deltaLine(ordersSales.length, pedidosPrev), icon: "📦", iconCls: "dash-kpi-icon--amber", spark: "kpi-spark-orders" },
      { key: "ticket", label: "Ticket Médio", value: fmtBRL(ticket), delta: deltaLine(ticket, ticketPrev), icon: "🎟️", iconCls: "dash-kpi-icon--orange", spark: "kpi-spark-ticket" }
    ];
    dashKpisEl.innerHTML = items.map(s=>`
      <div class="dash-kpi" data-kpi="${escapeHTML(s.key)}">
        <div class="dash-kpi-top">
          <div class="dash-kpi-main">
            <div class="dash-kpi-label">${escapeHTML(s.label)}</div>
            <div class="dash-kpi-value">${escapeHTML(s.value)}</div>
            ${s.delta}
          </div>
          <div class="dash-kpi-side">
            <div class="dash-kpi-icon ${escapeHTML(s.iconCls)}">${escapeHTML(s.icon)}</div>
            <div class="dash-kpi-spark">
              <canvas id="${escapeHTML(s.spark)}"></canvas>
            </div>
          </div>
        </div>
      </div>
    `).join("")
    + `
      <div class="dash-kpi dash-kpi--ghost" data-kpi="ltv">
        <div class="dash-kpi-top">
          <div class="dash-kpi-main">
            <div class="dash-kpi-label">LTV Médio</div>
            <div class="dash-kpi-value"><span id="kpi-ltv-medio">—</span></div>
            <div class="dash-kpi-delta"> </div>
          </div>
          <div class="dash-kpi-side">
            <div class="dash-kpi-icon dash-kpi-icon--ghost">💎</div>
          </div>
        </div>
      </div>
      <div class="dash-kpi dash-kpi--ghost" data-kpi="base">
        <div class="dash-kpi-top">
          <div class="dash-kpi-main">
            <div class="dash-kpi-label">Clientes Base</div>
            <div class="dash-kpi-value"><span id="kpi-clientes-base">—</span></div>
            <div class="dash-kpi-delta"> </div>
          </div>
          <div class="dash-kpi-side">
            <div class="dash-kpi-icon dash-kpi-icon--ghost">👥</div>
          </div>
        </div>
      </div>
    `;
    try{
      renderDashKpiSparklines({ ordersSales, ordersPrevSales, fromIso, toIso, firstByCustomer });
    }catch(_e){}
  }

  const newCountEl = document.getElementById("dash-new-count");
  if(newCountEl) newCountEl.textContent = String(novos || 0);
  const newDeltaEl = document.getElementById("dash-new-delta");
  if(newDeltaEl){
    if(showCompare){
      const d = pctDelta(novos, novosPrev);
      if(d == null || !isFinite(d)) newDeltaEl.innerHTML = "";
      else{
        const up = d >= 0;
        newDeltaEl.className = "dash-side-delta " + (up ? "pos" : "neg");
        newDeltaEl.textContent = (up ? "▲ " : "▼ ") + Math.abs(d).toFixed(0) + "%";
      }
    }else{
      newDeltaEl.innerHTML = "";
    }
  }

  const pillThis = document.getElementById("dash-pill-this");
  const pillPrev = document.getElementById("dash-pill-prev");
  if(pillThis) pillThis.classList.toggle("active", !showCompare);
  if(pillPrev) pillPrev.classList.toggle("active", showCompare);

  const rangeEl = document.getElementById("dash-receita-range");
  if(rangeEl){
    const diffDays = (fromTs != null && toTs != null) ? Math.round((toTs - fromTs) / (24*60*60*1000)) + 1 : 0;
    rangeEl.textContent = diffDays ? `Últimos ${diffDays} dias` : "Últimos 30 dias";
  }

  try{
    renderDashReceitaFooter(ordersSales);
  }catch(_e){}

  renderMeta(tMo); renderAlertBanner(ordersSales);
  renderDashSalesByDay(ordersSales, ordersPrevSales);
  const ordersNew = ordersSales.filter(o=>novosSet.has(orderCustomerKey(o)));
  renderChartCanal(ordersNew);
  try{
    const prodEl = document.getElementById("dash-top-products");
    if(prodEl && !prodEl.innerHTML) prodEl.innerHTML = `<div class="empty" style="padding:14px 0">Carregando…</div>`;
    const alertsEl = document.getElementById("dash-alerts-mini");
    if(alertsEl && !alertsEl.innerHTML) alertsEl.innerHTML = `<div class="empty" style="padding:14px 0">Carregando…</div>`;
    const vipsEl = document.getElementById("dash-vips-mini");
    if(vipsEl && !vipsEl.innerHTML) vipsEl.innerHTML = `<div class="empty" style="padding:14px 0">Carregando…</div>`;
  }catch(_e){}

  try{ renderDashInsightsMini(ordersSales); }catch(_e){}
  try{ renderDashProductsMini(ordersSales, ordersPrevSales); }catch(_e){}
  try{ renderDashAlertsMini(ordersSales); }catch(_e){}
  try{ renderDashVipMini(ordersSales); }catch(_e){}
  try{ renderDashGeoMini(ordersSales); }catch(_e){}
  updateDashSecondaryFromSupabase().catch(()=>{});
}

async function updateDashSecondaryFromSupabase(){
  const elLtv = document.getElementById("kpi-ltv-medio");
  const elCli = document.getElementById("kpi-clientes-base");
  if(!elLtv || !elCli) return;
  if(!supaConnected || !supaClient){
    const list = Array.isArray(allCustomers) ? allCustomers : [];
    const ltvMedio = list.length ? (list.reduce((s,c)=>s + (Number(c?.total_gasto || 0) || 0), 0) / list.length) : 0;
    elLtv.textContent = fmtBRL(ltvMedio);
    elCli.textContent = String(list.length);
    return;
  }
  // KPIs e Funil em paralelo — são independentes entre si
  try{
    const [k, funilRows] = await Promise.all([
      getDashboardKpisView(supaClient),
      getFunilRecompraView(supaClient)
    ]);
    if(k){
      const clientes = Number(k.total_clientes || 0) || 0;
      const ltvMedio = Number(k.ltv_medio || 0) || 0;
      elLtv.textContent = fmtBRL(ltvMedio);
      elCli.textContent = String(clientes);
    }
    renderDashV2Funil(funilRows);
  }catch(e){ console.warn("[dashboard] falha ao carregar KPIs/funil:", e?.message||e); }
}

function renderDashKpiSparklines(ctx){
  const ordersSales = Array.isArray(ctx?.ordersSales) ? ctx.ordersSales : [];
  const ordersPrevSales = Array.isArray(ctx?.ordersPrevSales) ? ctx.ordersPrevSales : [];
  const fromIso = String(ctx?.fromIso || "").trim();
  const toIso = String(ctx?.toIso || "").trim();
  const firstByCustomer = ctx?.firstByCustomer && typeof ctx.firstByCustomer === "object" ? ctx.firstByCustomer : {};

  const byDayRevenue = {};
  const byDayOrders = {};
  ordersSales.forEach(o=>{
    const d = String(o?.data || "").slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    byDayRevenue[d] = (byDayRevenue[d] || 0) + val(o);
    byDayOrders[d] = (byDayOrders[d] || 0) + 1;
  });
  const keys = Object.keys(byDayRevenue).sort();
  if(!keys.length) return;
  const revenue = keys.map(k=>Number(byDayRevenue[k] || 0) || 0);
  const orders = keys.map(k=>Number(byDayOrders[k] || 0) || 0);
  const ticket = keys.map((k,i)=>{
    const n = orders[i] || 0;
    return n ? (revenue[i] / n) : 0;
  });

  const fromTs = fromIso ? new Date(fromIso + "T00:00:00").getTime() : null;
  const toTs = toIso ? new Date(toIso + "T23:59:59").getTime() : null;
  const newByDay = {};
  Object.entries(firstByCustomer).forEach(([cid, ts])=>{
    const n = Number(ts);
    if(!isFinite(n)) return;
    if(fromTs != null && n < fromTs) return;
    if(toTs != null && n > toTs) return;
    const day = iso(new Date(n));
    newByDay[day] = (newByDay[day] || 0) + 1;
  });
  const novos = keys.map(k=>Number(newByDay[k] || 0) || 0);

  const prevByDayRevenue = {};
  ordersPrevSales.forEach(o=>{
    const d = String(o?.data || "").slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    prevByDayRevenue[d] = (prevByDayRevenue[d] || 0) + val(o);
  });
  const prevKeys = Object.keys(prevByDayRevenue).sort();
  const prevRevenue = prevKeys.map(k=>Number(prevByDayRevenue[k] || 0) || 0);

  const renderSpark = (id, values, color)=>{
    const canvas = document.getElementById(id);
    if(!canvas || !canvas.getContext) return;
    const c = canvas.getContext("2d");
    if(!c) return;
    const key = "kpi_" + id;
    if(charts[key]){ try{ charts[key].destroy(); }catch(_e){} charts[key] = null; }
    const g = c.createLinearGradient(0, 0, 0, canvas.height || 40);
    g.addColorStop(0, color.replace("1)", ".20)"));
    g.addColorStop(1, color.replace("1)", "0)"));
    charts[key] = new Chart(c, {
      type: "line",
      data: {
        labels: values.map((_,i)=>String(i)),
        datasets: [{
          data: values,
          borderColor: color,
          backgroundColor: g,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.35,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } }
      }
    });
  };

  renderSpark("kpi-spark-revenue", revenue, "rgba(15,167,101,1)");
  renderSpark("kpi-spark-orders", orders, "rgba(251,191,36,1)");
  renderSpark("kpi-spark-ticket", ticket, "rgba(249,115,22,1)");
  renderSpark("kpi-spark-new", novos, "rgba(167,139,250,1)");

  try{
    const showCompare = isDashCompareEnabled();
    if(showCompare && prevRevenue.length){
      const el = document.querySelector('[data-kpi="revenue"] .dash-kpi-label');
      if(el) el.textContent = "Receita (período)";
    }
  }catch(_e){}
}

function fmtPtShortDate(d){
  const isoStr = String(d || "").slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return "—";
  const dd = isoStr.slice(8,10);
  const mm = Number(isoStr.slice(5,7));
  const mons = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return dd + " " + (mons[mm-1] || "");
}
function dashInitials(name){
  const s = String(name || "").trim();
  if(!s) return "—";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = parts[0] ? parts[0][0] : "";
  const b = parts.length > 1 ? parts[parts.length-1][0] : (parts[0] ? parts[0][1] : "");
  return (a + b).toUpperCase();
}
function dashSafeName(name){
  const s = String(name || "").trim();
  if(!s) return "Cliente";
  return s.length > 34 ? s.slice(0, 31) + "..." : s;
}

function renderDashReceitaFooter(ordersSales){
  const bestEl = document.getElementById("dash-mini-best");
  const avgEl = document.getElementById("dash-mini-avg");
  const ordEl = document.getElementById("dash-mini-orders");
  if(!bestEl && !avgEl && !ordEl) return;
  const byDay = {};
  ordersSales.forEach(o=>{
    const d = String(o?.data || "").slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    byDay[d] = (byDay[d] || 0) + val(o);
  });
  const keys = Object.keys(byDay).sort();
  const total = ordersSales.reduce((s,o)=>s + val(o), 0);
  const daysCount = keys.length || 1;
  const avg = total / daysCount;
  let bestDate = "";
  let bestVal = 0;
  keys.forEach(k=>{
    const v = Number(byDay[k] || 0) || 0;
    if(bestDate === "" || v > bestVal){
      bestDate = k;
      bestVal = v;
    }
  });
  if(bestEl){
    bestEl.innerHTML = `<div class="dash-mini-ic">↗</div><div><div class="dash-mini-label">Melhor dia</div><div class="dash-mini-value">${escapeHTML(fmtPtShortDate(bestDate))} — ${escapeHTML(fmtBRL(bestVal))}</div></div>`;
  }
  if(avgEl){
    avgEl.innerHTML = `<div class="dash-mini-ic">📈</div><div><div class="dash-mini-label">Média diária</div><div class="dash-mini-value">${escapeHTML(fmtBRL(avg))}</div></div>`;
  }
  if(ordEl){
    ordEl.innerHTML = `<div class="dash-mini-ic">📦</div><div><div class="dash-mini-label">Total Pedidos</div><div class="dash-mini-value">${escapeHTML(String(ordersSales.length || 0))}</div></div>`;
  }
}

function renderDashInsightsMini(_ordersSales){
  const el = document.getElementById("dash-insights-list");
  if(!el) return;
  const clis = Object.values(buildCli(Array.isArray(allOrders) ? allOrders : []))
    .map(c=>({ c, s: calcCliScores(c) }))
    .filter(x=>x.c && x.c.id && !x.s.isCnpj)
    .filter(x=>x.s.ds >= 21 && x.s.ds <= 60)
    .sort((a,b)=>{
      if(a.s.status !== b.s.status) return a.s.status === "vip" ? -1 : b.s.status === "vip" ? 1 : 0;
      if(b.s.recompraScore !== a.s.recompraScore) return b.s.recompraScore - a.s.recompraScore;
      return (b.s.ltv || 0) - (a.s.ltv || 0);
    })
    .slice(0, 3);
  if(!clis.length){
    el.innerHTML = `<div class="empty" style="padding:14px 0">Sem insights agora.</div>`;
    return;
  }
  el.innerHTML = clis.map(x=>{
    const nm = dashSafeName(x.c.nome || "Cliente");
    return `<div class="dash-insight-row">
      <div class="dash-insight-left">
        <div class="dash-avatar">${escapeHTML(dashInitials(nm))}</div>
        <div class="dash-insight-main">
          <div class="dash-insight-name">${escapeHTML(nm)}</div>
          <div class="dash-insight-sub">${escapeHTML(String(x.s.ds))} dias desde a última compra</div>
        </div>
      </div>
      <div class="dash-insight-days">${escapeHTML(String(x.s.ds))}d</div>
    </div>`;
  }).join("");
}

function renderDashProductsMini(ordersSales, ordersPrevSales){
  const el = document.getElementById("dash-top-products");
  if(!el) return;
  try{
  const agg = (orders)=>{
    const m = {};
    orders.forEach(o=>{
      getPedidoItens(o).forEach(it=>{
        const name = String(it?.descricao || "").trim();
        if(!name) return;
        if(!m[name]) m[name] = { name, qty: 0, rev: 0 };
        m[name].qty += Number(it?.quantidade || 0) || 0;
        m[name].rev += Number(it?.valor_total || 0) || 0;
      });
    });
    return m;
  };
  const cur = agg(Array.isArray(ordersSales) ? ordersSales : []);
  const prev = agg(Array.isArray(ordersPrevSales) ? ordersPrevSales : []);
  const list = Object.values(cur)
    .map(p=>{
      const pv = prev[p.name]?.rev || 0;
      return { ...p, prevRev: pv, delta: pctDelta(p.rev, pv) };
    })
    .sort((a,b)=> (b.rev||0) - (a.rev||0))
    .slice(0, 5);
  if(!list.length){
    const hasOrders = Array.isArray(ordersSales) && ordersSales.length > 0;
    el.innerHTML = hasOrders
      ? `<div class="empty" style="padding:14px 0">Sem itens de produtos nos pedidos desse período.</div>`
      : `<div class="empty" style="padding:14px 0">Sem produtos no período.</div>`;
    return;
  }
  el.innerHTML = list.map((p,i)=>{
    const d = p.delta;
    const show = d != null && isFinite(d);
    const up = show ? d >= 0 : true;
    const cls = show ? (up ? "pos" : "neg") : "";
    const txt = show ? ((up ? "▲ " : "▼ ") + Math.abs(d).toFixed(0) + "%") : "";
    const icon = (String(p.name).match(/[A-Za-zÀ-ÿ]/) ? String(p.name).trim()[0] : "★").toUpperCase();
    return `<div class="dash-prod-row">
      <div class="dash-prod-rank">${escapeHTML(String(i+1))}</div>
      <div class="dash-prod-img">${escapeHTML(icon)}</div>
      <div class="dash-prod-main">
        <div class="dash-prod-name">${escapeHTML(dashSafeName(p.name))}</div>
        <div class="dash-prod-sub">${escapeHTML(String(p.qty))} un. · ${escapeHTML(fmtBRL(p.rev))}</div>
      </div>
      <div class="dash-prod-delta ${escapeHTML(cls)}">${escapeHTML(txt)}</div>
    </div>`;
  }).join("");
  }catch(_e){
    el.innerHTML = `<div class="empty" style="padding:14px 0">Erro ao carregar produtos.</div>`;
  }
}

function renderDashAlertsMini(_ordersSales){
  const el = document.getElementById("dash-alerts-mini");
  const badge = document.getElementById("dash-alerts-badge");
  if(!el && !badge) return;
  const ad = parseInt(localStorage.getItem("crm_alertdays") || "60");
  const clis = Object.values(buildCli(Array.isArray(allOrders) ? allOrders : [])).map(c=>({ c, s: calcCliScores(c) })).filter(x=>x.c && x.c.id);
  const vipRisk = clis.filter(x=>x.s.status === "vip" && !x.s.isCnpj && x.s.ds >= 45).length;
  const inactive = clis.filter(x=>!x.s.isCnpj && x.s.ds >= ad).length;

  const fromIso = String(localStorage.getItem("crm_dash_from") || "").trim();
  const toIso = String(localStorage.getItem("crm_dash_to") || "").trim();
  const prevRange = (fromIso && toIso) ? calcPrevRange(fromIso, toIso) : null;
  const ordersAll = Array.isArray(allOrders) ? allOrders : [];
  const byRange = (fromIso, toIso)=>{
    const f = fromIso ? new Date(fromIso + "T00:00:00").getTime() : null;
    const t = toIso ? new Date(toIso + "T23:59:59").getTime() : null;
    return ordersAll.filter(o=>{
      const d = String(o?.data || "").slice(0,10);
      if(!d) return false;
      const ts = new Date(d + "T12:00:00").getTime();
      if(!isFinite(ts)) return false;
      if(f != null && ts < f) return false;
      if(t != null && ts > t) return false;
      return true;
    });
  };
  let produtoQueda = "";
  let produtoQuedaPct = null;
  if(prevRange?.prevFromIso && prevRange?.prevToIso){
    const curOrders = byRange(fromIso, toIso);
    const prevOrders = byRange(prevRange.prevFromIso, prevRange.prevToIso);
    const aggProd = (orders)=>{
      const m = {};
      orders.forEach(o=>{
        getPedidoItens(o).forEach(it=>{
          const name = String(it?.descricao || "").trim();
          if(!name) return;
          m[name] = (m[name] || 0) + (Number(it?.valor_total || 0) || 0);
        });
      });
      return m;
    };
    const cur = aggProd(curOrders);
    const prev = aggProd(prevOrders);
    Object.keys(prev).forEach(n=>{
      const a = Number(cur[n] || 0) || 0;
      const b = Number(prev[n] || 0) || 0;
      const d = pctDelta(a, b);
      if(d == null || !isFinite(d)) return;
      if(d >= -25) return;
      if(produtoQuedaPct == null || d < produtoQuedaPct){
        produtoQuedaPct = d;
        produtoQueda = n;
      }
    });
  }

  const rows = [];
  if(vipRisk){
    rows.push({ ic: "👑", cls: "red", title: "VIP em risco", sub: `${vipRisk} VIP sem comprar há 45+ dias`, right: "ver" });
  }
  if(inactive){
    rows.push({ ic: "⏳", cls: "", title: "Inativos", sub: `${inactive} clientes sem comprar há ${ad}+ dias`, right: "ver" });
  }
  if(produtoQueda){
    rows.push({ ic: "📉", cls: "red", title: "Queda de produto", sub: `${dashSafeName(produtoQueda)} (${Math.abs(produtoQuedaPct).toFixed(0)}%)`, right: "ver" });
  }

  if(badge){
    if(rows.length){
      badge.style.display = "";
      badge.textContent = rows.length + " itens";
    }else{
      badge.style.display = "none";
    }
  }
  if(!el) return;
  if(!rows.length){
    el.innerHTML = `<div class="empty" style="padding:14px 0">Sem alertas agora.</div>`;
    return;
  }
  el.innerHTML = rows.slice(0, 3).map(r=>`
    <div class="dash-alert-row">
      <div class="dash-alert-left">
        <div class="dash-ic ${escapeHTML(r.cls)}">${escapeHTML(r.ic)}</div>
        <div class="dash-alert-main">
          <div class="dash-alert-title">${escapeHTML(r.title)}</div>
          <div class="dash-alert-sub">${escapeHTML(r.sub)}</div>
        </div>
      </div>
      <div class="dash-alert-right">${escapeHTML(r.right || "")}</div>
    </div>
  `).join("");
}

function renderDashVipMini(_ordersSales){
  const el = document.getElementById("dash-vips-mini");
  if(!el) return;
  const clis = Object.values(buildCli(Array.isArray(allOrders) ? allOrders : []))
    .map(c=>({ c, s: calcCliScores(c), tot: (Array.isArray(c?.orders) ? c.orders.reduce((sum,o)=>sum+val(o),0) : 0) }))
    .filter(x=>x.s.status === "vip" && !x.s.isCnpj)
    .sort((a,b)=> (b.tot||0) - (a.tot||0))
    .slice(0, 4);
  if(!clis.length){
    el.innerHTML = `<div class="empty" style="padding:14px 0">Sem VIPs na base.</div>`;
    return;
  }
  el.innerHTML = clis.map(x=>{
    const nm = dashSafeName(x.c.nome || "VIP");
    return `<div class="dash-vip-row">
      <div class="dash-vip-left">
        <div class="dash-avatar">${escapeHTML(dashInitials(nm))}</div>
        <div class="dash-vip-main">
          <div class="dash-vip-name">${escapeHTML(nm)}</div>
          <div class="dash-vip-sub">${escapeHTML(String(x.s.n || 0))} pedidos · ${escapeHTML(fmtBRL(x.tot || 0))}</div>
        </div>
      </div>
      <div class="dash-vip-right">${escapeHTML(String(x.s.ds || 0))}d</div>
    </div>`;
  }).join("");
}

let _dashBrazilSvgText = null;
async function ensureDashBrazilSvg(){
  if(_dashBrazilSvgText) return _dashBrazilSvgText;
  try{
    const res = await fetch("./assets/brazil-states.svg");
    _dashBrazilSvgText = await res.text();
    return _dashBrazilSvgText;
  }catch(_e){
    _dashBrazilSvgText = "";
    return "";
  }
}

function renderDashGeoMini(ordersSales){
  const mapEl = document.getElementById("dash-brazil-map");
  const listEl = document.getElementById("dash-top-cities");
  if(!mapEl && !listEl) return;
  const cityAgg = {};
  const ufAgg = {};
  (Array.isArray(ordersSales) ? ordersSales : []).forEach(o=>{
    const city = cleanText(o?.contato?.endereco?.municipio || o?.contato?.endereco?.cidade || o?.endereco?.municipio || o?.cidade || "");
    const uf = normalizeUF(o?.contato?.endereco?.uf || o?.contato?.endereco?.estado || o?.uf || o?.estado || "");
    if(city) cityAgg[city] = (cityAgg[city] || 0) + 1;
    if(uf) ufAgg[uf] = (ufAgg[uf] || 0) + 1;
  });
  if(listEl){
    const list = Object.entries(cityAgg).sort((a,b)=>b[1]-a[1]).slice(0, 6);
    if(!list.length) listEl.innerHTML = `<div class="empty" style="padding:14px 0">Sem cidades no período.</div>`;
    else listEl.innerHTML = list.map(([city,n])=>`
      <div class="dash-city-row">
        <div class="dash-city-name">${escapeHTML(dashSafeName(city))}</div>
        <div class="dash-city-val">${escapeHTML(String(n))}</div>
      </div>
    `).join("");
  }
  if(!mapEl) return;
  ensureDashBrazilSvg().then(txt=>{
    if(!txt){
      mapEl.innerHTML = `<div class="dash-map-loading">Mapa indisponível.</div>`;
      return;
    }
    mapEl.innerHTML = txt;
    try{
      const svg = mapEl.querySelector("svg");
      if(svg){
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      }
      const vals = Object.values(ufAgg);
      const max = vals.length ? Math.max(...vals) : 0;
      const min = vals.length ? Math.min(...vals) : 0;
      const lerp = (a,b,t)=>Math.round(a + (b-a)*t);
      const fillFor = (v)=>{
        const t = max === min ? 0 : (v - min) / (max - min);
        const r = lerp(226, 22, t);
        const g = lerp(245, 163, t);
        const b = lerp(234, 74, t);
        return `rgb(${r},${g},${b})`;
      };
      mapEl.querySelectorAll(".state").forEach(node=>{
        const id = String(node.getAttribute("id") || "").trim().toUpperCase();
        const v = id ? (ufAgg[id] || 0) : 0;
        node.setAttribute("fill", v ? fillFor(v) : "rgba(148,163,184,.15)");
        node.setAttribute("stroke", "rgba(15,23,42,.06)");
        node.setAttribute("stroke-width", "1");
      });
    }catch(_e){}
  });
}

function setDashCanvasState(canvasId, hasData, msg, showClear){
  const canvas = document.getElementById(canvasId);
  const wrap = canvas ? canvas.parentElement : null;
  if(!wrap) return { canvas: null, shouldRender: false };
  const id = canvasId + "-empty";
  let box = document.getElementById(id);
  if(!box){
    box = document.createElement("div");
    box.id = id;
    box.className = "empty";
    box.style.padding = "18px 0";
    wrap.appendChild(box);
  }
  if(hasData){
    canvas.style.display = "";
    box.style.display = "none";
    return { canvas, shouldRender: true };
  }
  canvas.style.display = "none";
  box.style.display = "";
  const btn = showClear ? `<div style="margin-top:10px"><button class="btn" onclick="(function(){var s=document.getElementById('dash-canal-filter'); if(s) s.value=''; localStorage.setItem('crm_dash_canal',''); renderDash();})()">Ver todos os dados</button></div>` : "";
  box.innerHTML = `${escapeHTML(msg || "Sem dados no período")}${btn}`;
  return { canvas, shouldRender: false };
}

function renderDashSalesByDay(orders, prevOrders){
  const list = Array.isArray(orders) ? orders : [];
  const prevList = Array.isArray(prevOrders) ? prevOrders : [];
  const buildByDay = (arr)=>{
    const by = {};
    arr.forEach(o=>{
      const d = String(o?.data || "").slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      const ts = new Date(d + "T12:00:00").getTime();
      if(!isFinite(ts)) return;
      by[d] = (by[d] || 0) + val(o);
    });
    const keys = Object.keys(by).sort();
    return { keys, values: keys.map(k=>Number(by[k]||0) || 0) };
  };

  const cur = buildByDay(list);
  const prev = buildByDay(prevList);
  // Atualiza badge com total do período
  const totalBadge = document.getElementById("dash-dia-total");
  if(totalBadge){
    const total = cur.values.reduce((s,v)=>s+v,0);
    totalBadge.textContent = total > 0 ? fmtBRL(total) : "";
    totalBadge.style.display = total > 0 ? "" : "none";
  }
  const state = setDashCanvasState("chart-v2-dia", cur.keys.length > 0, "Sem dados no período", !!String(document.getElementById("dash-canal-filter")?.value||""));
  if(!state.shouldRender || !state.canvas || !state.canvas.getContext) return;
  const ctx = state.canvas.getContext("2d");
  if(!ctx) return;
  if(charts.v2dia) charts.v2dia.destroy();

  const values = cur.values;
  const prevAligned = prev.values.length ? prev.values.slice(0, values.length).concat(Array(Math.max(0, values.length - prev.values.length)).fill(null)) : [];

  const maxVal = values.length ? Math.max(...values) : 0;
  const minVal = values.length ? Math.min(...values) : 0;
  const maxIdx = values.indexOf(maxVal);
  const minIdx = values.indexOf(minVal);
  const highlights = values.map((v, i)=> (i === maxIdx || i === minIdx) ? v : null);

  const showMA = isDashMAEnabled();
  const maWindow = 7;
  const ma = showMA ? values.map((_, i)=>{
    const start = Math.max(0, i - (maWindow - 1));
    const slice = values.slice(start, i + 1);
    const sum = slice.reduce((s,v)=>s + (Number(v)||0), 0);
    return slice.length ? (sum / slice.length) : null;
  }) : [];

  const isLight = document.documentElement.classList.contains("light");
  const area = (()=>{
    const g = ctx.createLinearGradient(0, 0, 0, state.canvas.height || 300);
    g.addColorStop(0, "rgba(15,167,101,.30)");
    g.addColorStop(1, "rgba(15,167,101,0)");
    return g;
  })();

  const showCompare = isDashCompareEnabled() && prevAligned.length;
  const datasets = [];
  if(showCompare){
    datasets.push({
      label: "Período anterior",
      data: prevAligned,
      tension: 0.35,
      fill: false,
      borderColor: "rgba(148,163,184,.85)",
      borderWidth: 2,
      borderDash: [6,6],
      pointRadius: 0,
      pointHitRadius: 10
    });
  }
  datasets.push({
    label: "Receita",
    data: values,
    tension: 0.35,
    fill: true,
    borderColor: "#0FA765",
    backgroundColor: area,
    borderWidth: 3,
    pointRadius: 2,
    pointHoverRadius: 5,
    pointBackgroundColor: "#0FA765",
    pointBorderColor: "#ffffff",
    pointBorderWidth: 2,
    pointHitRadius: 14
  });
  if(showMA){
    datasets.push({
      label: "Média móvel (7d)",
      data: ma,
      tension: 0.35,
      fill: false,
      borderColor: "rgba(15,167,101,.55)",
      borderWidth: 2,
      borderDash: [4,5],
      pointRadius: 0,
      pointHitRadius: 10
    });
  }
  datasets.push({
    label: "Destaques",
    data: highlights,
    showLine: false,
    pointRadius: (c)=>{
      const i = c?.dataIndex ?? -1;
      if(i === maxIdx || i === minIdx) return 6;
      return 0;
    },
    pointHoverRadius: 7,
    pointBackgroundColor: (c)=>{
      const i = c?.dataIndex ?? -1;
      if(i === maxIdx) return "#16a34a";
      if(i === minIdx) return "#ef4444";
      return "transparent";
    },
    pointBorderColor: "#ffffff",
    pointBorderWidth: 2,
    pointHitRadius: 16
  });

  const calloutPlugin = {
    id: "dashCallouts",
    afterDatasetsDraw: (chart)=>{
      try{
        const area = chart.chartArea;
        if(!area) return;
        const x = chart.scales?.x;
        const y = chart.scales?.y;
        if(!x || !y) return;
        if(maxIdx < 0 || minIdx < 0) return;
        const ctx2 = chart.ctx;
        if(!ctx2) return;

        const xMax = x.getPixelForValue(maxIdx);
        const yMax = y.getPixelForValue(maxVal);
        const xMin = x.getPixelForValue(minIdx);
        const yMin = y.getPixelForValue(minVal);

        const drawRounded = (x0,y0,w,h,r)=>{
          const rr = Math.min(r, w/2, h/2);
          ctx2.beginPath();
          ctx2.moveTo(x0+rr, y0);
          ctx2.arcTo(x0+w, y0, x0+w, y0+h, rr);
          ctx2.arcTo(x0+w, y0+h, x0, y0+h, rr);
          ctx2.arcTo(x0, y0+h, x0, y0, rr);
          ctx2.arcTo(x0, y0, x0+w, y0, rr);
          ctx2.closePath();
        };
        const tag = (text, bg, xC, yC)=>{
          const padX = 10;
          const padY = 6;
          ctx2.save();
          ctx2.font = "800 11px Plus Jakarta Sans";
          const tw = ctx2.measureText(text).width;
          const w = tw + padX*2;
          const h = 24;
          let x0 = xC - w/2;
          let y0 = yC - h - 10;
          x0 = Math.max(area.left + 6, Math.min(x0, area.right - w - 6));
          y0 = Math.max(area.top + 6, y0);
          ctx2.fillStyle = bg;
          drawRounded(x0, y0, w, h, 10);
          ctx2.fill();
          ctx2.fillStyle = "#ffffff";
          ctx2.textBaseline = "middle";
          ctx2.fillText(text, x0 + padX, y0 + h/2 + 1);
          ctx2.restore();
        };

        ctx2.save();
        ctx2.setLineDash([4,4]);
        ctx2.lineWidth = 1;
        ctx2.strokeStyle = "rgba(15,23,42,.18)";
        ctx2.beginPath();
        ctx2.moveTo(xMax, area.top + 6);
        ctx2.lineTo(xMax, area.bottom - 6);
        ctx2.stroke();
        ctx2.restore();

        tag("Pico: " + fmtBRL(maxVal), "#16a34a", xMax, yMax);
        tag("Baixa: " + fmtBRL(minVal), "#ef4444", xMin, yMin);
      }catch(_e){}
    }
  };

  charts.v2dia = new Chart(ctx, {
    type: "line",
    data: {
      labels: cur.keys.map(k=>fmtDate(k)),
      datasets
    },
    plugins: [calloutPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isLight ? "#ffffff" : "#0e1018",
          borderColor: isLight ? "rgba(0,0,0,.12)" : "#1d2235",
          borderWidth: 1,
          titleColor: isLight ? "#111827" : "#edeef4",
          bodyColor: isLight ? "#334155" : "#a0a8be",
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (c)=>{
              const v = Number(c.parsed.y || 0) || 0;
              if(c.dataset?.label === "Destaques"){
                const i = c.dataIndex;
                if(i === maxIdx) return " Pico: " + fmtBRL(v);
                if(i === minIdx) return " Baixa: " + fmtBRL(v);
              }
              return " " + fmtBRL(v);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: isLight ? "#64748b" : "#9eb8a8", font: { size: 10, weight: 700 }, maxTicksLimit: 10 }
        },
        y: {
          grid: { color: isLight ? "rgba(15,23,42,.06)" : "rgba(255,255,255,.06)" },
          ticks: { color: isLight ? "#64748b" : "#9eb8a8", font: { size: 10, weight: 700 }, callback: (v)=>fmtBRL(v) }
        }
      }
    }
  });
}

function renderDashChannelBreakdown(input){
  const el = document.getElementById("dash-channel-breakdown");
  if(!el) return;
  const ordersAllRange = Array.isArray(input?.ordersAllRange) ? input.ordersAllRange : [];
  const ordersSales = Array.isArray(input?.ordersSales) ? input.ordersSales : [];
  const dashCh = normCanalKey(input?.dashCh || "");
  const base = dashCh ? ordersSales : ordersAllRange;
  if(!base.length){
    if(charts.vendasCanal){ try{ charts.vendasCanal.destroy(); }catch(_e){} charts.vendasCanal = null; }
    const btn = dashCh ? `<div style="margin-top:10px"><button class="btn" onclick="(function(){var s=document.getElementById('dash-canal-filter'); if(s) s.value=''; localStorage.setItem('crm_dash_canal',''); renderDash();})()">Ver todos</button></div>` : "";
    const msg = dashCh ? `Sem vendas via ${escapeHTML(CH[dashCh]||dashCh)} no período` : "Sem dados no período";
    el.innerHTML = `<div class="empty">${msg}${btn}</div>`;
    return;
  }

  const by = {};
  const byN = {};
  base.forEach(o=>{
    const ch = normCanalKey(detectCh(o) || "outros") || "outros";
    by[ch] = (by[ch] || 0) + val(o);
    byN[ch] = (byN[ch] || 0) + 1;
  });
  const preferred = ["shopee","ml","yampi","shopify","amazon","cnpj","outros"];
  const rows = preferred
    .filter(c=>Number(by[c]||0) > 0 || Number(byN[c]||0) > 0)
    .map(c=>({ canal: c, total: Number(by[c]||0) || 0, pedidos: Number(byN[c]||0) || 0 }))
    .filter(r=>r.total > 0 || r.pedidos > 0);

  if(!rows.length){
    if(charts.vendasCanal){ try{ charts.vendasCanal.destroy(); }catch(_e){} charts.vendasCanal = null; }
    const btn = dashCh ? `<div style="margin-top:10px"><button class="btn" onclick="(function(){var s=document.getElementById('dash-canal-filter'); if(s) s.value=''; localStorage.setItem('crm_dash_canal',''); renderDash();})()">Ver todos</button></div>` : "";
    const msg = dashCh ? `Sem vendas via ${escapeHTML(CH[dashCh]||dashCh)} no período` : "Sem dados no período";
    el.innerHTML = `<div class="empty">${msg}${btn}</div>`;
    return;
  }

  if(!document.getElementById("chart-vendas-canal")){
    el.innerHTML = `<canvas id="chart-vendas-canal" style="max-height:200px"></canvas>`;
  }
  const canvas = document.getElementById("chart-vendas-canal");
  if(!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  if(charts.vendasCanal){ try{ charts.vendasCanal.destroy(); }catch(_e){} charts.vendasCanal = null; }
  charts.vendasCanal = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: rows.map(r=>CH[r.canal] || r.canal),
      datasets: [{
        data: rows.map(r=>r.total),
        backgroundColor: rows.map(r=>CH_COLOR[r.canal] || "#0FA765"),
        borderColor: "transparent",
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: "68%",
      plugins: {
        legend: {
          display: true,
          position: "right",
          labels: { color: "rgba(160,168,190,0.85)", font: { size: 10, weight: 600 }, boxWidth: 10, padding: 10 }
        },
        tooltip: {
          backgroundColor: "#0e1018",
          borderColor: "rgba(15,167,101,.35)",
          borderWidth: 1,
          titleColor: "#edeef4",
          bodyColor: "#a0a8be",
          padding: 12,
          cornerRadius: 10,
          callbacks: {
            label: (c)=>{
              const row = rows[c.dataIndex] || {};
              return ` ${fmtBRL(row.total||0)} · ${Number(row.pedidos||0)} pedidos`;
            }
          }
        }
      }
    }
  });
}

async function renderDashExtraLists(ctx){
  const ordersAllRange = Array.isArray(ctx?.ordersAllRange) ? ctx.ordersAllRange : [];
  const ordersSales = Array.isArray(ctx?.ordersSales) ? ctx.ordersSales : ordersAllRange;
  const dashCh = String(ctx?.dashCh || "").trim();
  const dashTipo = String(ctx?.dashTipo || "").trim().toLowerCase();
  const filterActive = !!(dashCh || dashTipo);
  if(!ordersAllRange.length){
    const showClear = !!dashCh;
    const msg = "Sem dados no período";
    ["top-clientes","top-produtos-dash","dashv2-top-cidades"].forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      const btn = showClear ? `<div style="margin-top:10px"><button class="btn" onclick="(function(){var s=document.getElementById('dash-canal-filter'); if(s) s.value=''; localStorage.setItem('crm_dash_canal',''); renderDash();})()">Ver todos os dados</button></div>` : "";
      el.innerHTML = `<div class="empty">${escapeHTML(msg)}${btn}</div>`;
    });
  }

  if(supaConnected && supaClient){
    // Quando sem filtro ativo: busca as 4 views em paralelo (1 RTT em vez de 4)
    let topCitiesPre = null, semContatoPre = null, rowsReatPre = null, rowsVipPre = null;
    if(!filterActive){
      [topCitiesPre, semContatoPre, rowsReatPre, rowsVipPre] = await Promise.all([
        getTopCidadesView(supaClient, 10)
          .catch(e=>{ console.warn("[dashboard] top cidades:", e?.message||e); return []; }),
        getClientesSemContatoView(supaClient, 8)
          .catch(e=>{ console.warn("[dashboard] sem contato:", e?.message||e); return []; }),
        getClientesReativacaoView(supaClient, 8)
          .catch(e=>{ console.warn("[dashboard] reativação:", e?.message||e); return []; }),
        getClientesVipRiscoView(supaClient, 8)
          .catch(e=>{ console.warn("[dashboard] vip risco:", e?.message||e); return []; })
      ]);
    }

    // Top Cidades
    try{
      if(filterActive){
        renderDashTopCidadesFromOrders(ordersSales);
      }else{
        renderDashV2TopCidades(topCitiesPre);
      }
    }catch(e){ console.warn("[dashboard] falha ao renderizar top cidades:", e?.message||e); }

    // Sem Contato
    try{
      if(filterActive){
        const el = document.getElementById("dashv2-sem-contato");
        if(el){
          const rows = (clientesIntelCache||[])
            .filter(r=>r && r.cliente_id && (!r.last_interaction_at || String(r.last_interaction_at).trim() === ""))
            .slice(0,8);
          if(!rows.length) el.innerHTML = `<div class="empty">Sem dados no período</div>`;
          else el.innerHTML = rows.map((c, idx)=>{
            const id = escapeJsSingleQuote(String(c.cliente_id || c.id || ""));
            const nome = String(c.nome || "Cliente");
            const ltv = fmtBRL(c?.ltv || c?.total_gasto || 0);
            return `<div class="top-item" onclick="openClientePage('${id}')">
              <div class="top-rank">${idx+1}</div>
              <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· sem contato</span></div>
              <div class="top-val">${escapeHTML(ltv)}</div>
            </div>`;
          }).join("");
        }
      }else{
        renderDashV2SemContato(semContatoPre);
      }
    }catch(e){ console.warn("[dashboard] falha ao renderizar sem contato:", e?.message||e); }

    // Reativação Prioritária
    try{
      const riskEl = document.getElementById("dashv2-risk");
      if(riskEl){
        if(filterActive){
          const list = Object.values(buildCli(ordersSales))
            .filter(c=>!isCNPJ(c.doc) && daysSince(c.last) >= 30)
            .sort((a,b)=>daysSince(b.last)-daysSince(a.last) || (b.total-a.total))
            .slice(0,8);
          riskEl.innerHTML = list.map((c, idx)=>{
            const id = escapeJsSingleQuote(String(c.id || ""));
            const nome = String(c.nome || "Cliente");
            const dias = String(daysSince(c.last) || 0) + "d";
            const ltv = fmtBRL(c.total || 0);
            return `<div class="top-item" onclick="openClientePage('${id}')">
              <div class="top-rank">${idx+1}</div>
              <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(dias)}</span></div>
              <div class="top-val">${escapeHTML(ltv)}</div>
              <button class="opp-mini-btn" onclick="event.stopPropagation();openWaModal('${id}')">WA</button>
            </div>`;
          }).join("") || `<div class="empty">Sem dados no período</div>`;
        }else{
          riskEl.innerHTML = (Array.isArray(rowsReatPre) ? rowsReatPre : []).map((c, idx)=>{
            const id = escapeJsSingleQuote(String(c?.cliente_id || c?.id || ""));
            const nome = String(c?.nome || "Cliente");
            const dias = c?.dias_desde_ultima_compra == null ? "" : (String(c.dias_desde_ultima_compra) + "d");
            const ltv = fmtBRL(c?.ltv || c?.total_gasto || 0);
            return `<div class="top-item" onclick="openClientePage('${id}')">
              <div class="top-rank">${idx+1}</div>
              <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(dias)}</span></div>
              <div class="top-val">${escapeHTML(ltv)}</div>
              <button class="opp-mini-btn" onclick="event.stopPropagation();openWaModal('${id}')">WA</button>
            </div>`;
          }).join("") || `<div class="empty">Sem reativação prioritária.</div>`;
        }
      }
    }catch(e){ console.warn("[dashboard] falha ao renderizar reativação:", e?.message||e); }

    // VIP em Risco
    try{
      const vipRiskEl = document.getElementById("dashv2-vip-risk");
      if(vipRiskEl){
        if(filterActive){
          const list = Object.values(buildCli(ordersSales))
            .filter(c=>calcCliScores(c).status === "vip" && daysSince(c.last) >= 45)
            .sort((a,b)=>daysSince(b.last)-daysSince(a.last) || (b.total-a.total))
            .slice(0,8);
          vipRiskEl.innerHTML = list.map((c, idx)=>{
            const id = escapeJsSingleQuote(String(c.id || ""));
            const nome = String(c.nome || "VIP");
            const dias = String(daysSince(c.last) || 0) + "d";
            const ltv = fmtBRL(c.total || 0);
            return `<div class="top-item" onclick="openClientePage('${id}')">
              <div class="top-rank">${idx+1}</div>
              <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(dias)}</span></div>
              <div class="top-val">${escapeHTML(ltv)}</div>
              <button class="opp-mini-btn" onclick="event.stopPropagation();openWaModal('${id}')">WA</button>
            </div>`;
          }).join("") || `<div class="empty">Sem dados no período</div>`;
        }else{
          vipRiskEl.innerHTML = (Array.isArray(rowsVipPre) ? rowsVipPre : []).map((c, idx)=>{
            const id = escapeJsSingleQuote(String(c?.cliente_id || c?.id || ""));
            const nome = String(c?.nome || "VIP");
            const dias = c?.dias_desde_ultima_compra == null ? "" : (String(c.dias_desde_ultima_compra) + "d");
            const ltv = fmtBRL(c?.ltv || c?.total_gasto || 0);
            return `<div class="top-item" onclick="openClientePage('${id}')">
              <div class="top-rank">${idx+1}</div>
              <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(dias)}</span></div>
              <div class="top-val">${escapeHTML(ltv)}</div>
              <button class="opp-mini-btn" onclick="event.stopPropagation();openWaModal('${id}')">WA</button>
            </div>`;
          }).join("") || `<div class="empty">Sem VIPs em risco no período.</div>`;
        }
      }
    }catch(e){ console.warn("[dashboard] falha ao renderizar VIP em risco:", e?.message||e); }

    try{
      renderDashV2NextActions((clientesIntelCache||[]));
    }catch(e){ console.warn("[dashboard] falha ao renderizar próximas ações:", e?.message||e); }
  }else{
    renderDashTopCidadesFromOrders(ordersAllRange);
    const riskEl = document.getElementById("dashv2-risk");
    if(riskEl) riskEl.innerHTML = `<div class="empty">Conecte o Supabase para ver esta lista.</div>`;
    const vipRiskEl = document.getElementById("dashv2-vip-risk");
    if(vipRiskEl) vipRiskEl.innerHTML = `<div class="empty">Conecte o Supabase para ver esta lista.</div>`;
    const semContatoEl = document.getElementById("dashv2-sem-contato");
    if(semContatoEl) semContatoEl.innerHTML = `<div class="empty">Conecte o Supabase para ver esta lista.</div>`;
    const nextEl = document.getElementById("dashv2-next-actions");
    if(nextEl) nextEl.innerHTML = `<div class="empty">Conecte o Supabase para ver ações sugeridas.</div>`;
  }
}

function openDashActionsModal(){
  const modal = document.getElementById("modal-dash-actions");
  const bodyEl = document.getElementById("dash-actions-modal-body");
  if(!modal || !bodyEl) return;

  const actions = getTodaySalesActionsImpl({
    customerIntelligence: customerIntelligence,
    customerIntel: clientesIntelCache
  });

  const rows = Array.isArray(actions) ? actions : [];
  const list = rows.slice(0,20);

  const renderRow = (r, idx)=>{
    const id = escapeJsSingleQuote(String(r?.cliente_id || r?.cliente_uuid || r?.id || r?.cliente || ""));
    const nome = String(r?.nome || r?.cliente_nome || "Cliente");
    const act = String(r?.next_best_action || r?.acao_recomendada || r?.acao || "").trim() || "Ação sugerida";
    const dias = r?.dias_desde_ultima_compra != null ? (String(r.dias_desde_ultima_compra) + "d") : "";
    const ltv = fmtBRL(Number(r?.valor_total ?? r?.ltv ?? r?.total_gasto ?? 0) || 0);
    const phone = String(r?.celular || r?.telefone || "").replace(/\D/g,"");
    return `<div class="top-item" onclick="openClientePage('${id}')">
      <div class="top-rank">${idx+1}</div>
      <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(dias || act)}</span></div>
      <div class="top-val">${escapeHTML(ltv)}</div>
      ${phone?`<button class="opp-mini-btn" onclick="event.stopPropagation();openWaModal('${id}')">WA</button>`:""}
    </div>`;
  };

  bodyEl.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="profile-card" style="padding:14px">
        <div class="profile-h2" style="margin-bottom:8px">Clientes para contato hoje</div>
        <div class="top-list">${list.length ? list.map(renderRow).join("") : `<div class="empty">Sem ações sugeridas ainda.</div>`}</div>
      </div>
      <div class="profile-card" style="padding:14px">
        <div class="profile-h2" style="margin-bottom:8px">Atalhos rápidos</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn" onclick="showPage('inteligencia');fecharModal('modal-dash-actions')" style="justify-content:space-between;padding:10px 12px">
            <span>🧠 Inteligência</span><span style="color:var(--text-3)">→</span>
          </button>
          <button class="btn" onclick="showPage('clientes');fecharModal('modal-dash-actions')" style="justify-content:space-between;padding:10px 12px">
            <span>👥 Abrir Clientes</span><span style="color:var(--text-3)">→</span>
          </button>
          <button class="btn" onclick="showPage('tarefas');fecharModal('modal-dash-actions')" style="justify-content:space-between;padding:10px 12px">
            <span>✅ Abrir Tarefas</span><span style="color:var(--text-3)">→</span>
          </button>
        </div>
        <div style="margin-top:12px;font-size:11px;color:var(--text-3);line-height:1.5">
          Use este painel para executar rapidamente as ações recomendadas pela inteligência do CRM.
        </div>
      </div>
    </div>
  `;

  modal.classList.add("open");
}

function setDashRange(days){
  const n = Math.max(1, Number(days) || 30);
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (n - 1));
  const fromIso = iso(from);
  const toIso = iso(to);
  const fromEl = document.getElementById("dash-from");
  const toEl = document.getElementById("dash-to");
  const yearSel = document.getElementById("dash-year");
  if(yearSel && yearSel.value){
    yearSel.value = "";
    localStorage.setItem("crm_dash_year", "");
    dashLastYearRange = "";
  }
  if(fromEl) fromEl.value = fmtDate(fromIso);
  if(toEl) toEl.value = fmtDate(toIso);
  localStorage.setItem("crm_dash_from", fromIso);
  localStorage.setItem("crm_dash_to", toIso);
  renderDash();
}

function getDashRangeIso(){
  const fromEl = document.getElementById("dash-from");
  const toEl = document.getElementById("dash-to");
  const fromIso = parseDateToIso(String(fromEl?.value || "")) || String(localStorage.getItem("crm_dash_from") || "");
  const toIso = parseDateToIso(String(toEl?.value || "")) || String(localStorage.getItem("crm_dash_to") || "");
  if(fromIso && toIso) return { fromIso, toIso };
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 29);
  return { fromIso: iso(from), toIso: iso(to) };
}

function calcPrevRange(fromIso, toIso){
  const from = new Date(fromIso + "T12:00:00");
  const to = new Date(toIso + "T12:00:00");
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86400000);
  return { prevFromIso: iso(prevFrom), prevToIso: iso(prevTo), days };
}

function pctDelta(cur, prev){
  const a = Number(cur || 0) || 0;
  const b = Number(prev || 0) || 0;
  if(!b) return null;
  return ((a - b) / b) * 100;
}

function dashDeltaBadge(delta){
  if(delta == null || !isFinite(delta)) return "";
  const up = delta >= 0;
  const color = up ? "var(--green)" : "var(--red)";
  return `<span style="color:${color}">${up ? "▲" : "▼"}${Math.abs(delta).toFixed(1)}%</span>`;
}

// ATENÇÃO: renderDashV2 nunca é chamada (código morto).
// O fluxo real usa renderDashExtraLists + updateDashSecondaryFromSupabase.
// Mantida para referência até revisão futura.
async function renderDashV2(){
  const host = document.getElementById("dashv2-card");
  if(!host) return;
  const kpisEl = document.getElementById("dashv2-kpis");
  const riskEl = document.getElementById("dashv2-risk");
  const vipRiskEl = document.getElementById("dashv2-vip-risk");
  if(!kpisEl) return;

  const { fromIso, toIso } = getDashRangeIso();
  const prev = calcPrevRange(fromIso, toIso);

  const series = [];
  const channelAgg = {};
  const channelOrders = {};
  let faturamento = 0;
  let pedidos = 0;
  let faturamentoPrev = 0;
  let pedidosPrev = 0;
  let novosClientes = 0;
  let novosClientesPrev = 0;
  let totalClientes = null;
  let ltvMedio = null;

  if(supaConnected && supaClient){
    try{
      const kpis = await getDashboardKpisView(supaClient);
      if(kpis){
        totalClientes = Number(kpis.total_clientes ?? kpis.totalClientes ?? null);
        ltvMedio = Number(kpis.ltv_medio ?? kpis.ltvMedio ?? null);
      }
    }catch(_e){}

    const daily = await getDashboardDailyView(supaClient, fromIso, toIso);
    (Array.isArray(daily) ? daily : []).forEach(r=>{
      const diaIso = String(r?.dia || "").slice(0,10);
      const v = Number(r?.faturamento || 0) || 0;
      const q = Number(r?.pedidos || 0) || 0;
      const t = Number(r?.ticket_medio || 0) || 0;
      if(!diaIso) return;
      series.push({ diaIso, faturamento: v, pedidos: q, ticket_medio: t });
      faturamento += v;
      pedidos += q;
    });

    const dailyPrev = await getDashboardDailyView(supaClient, prev.prevFromIso, prev.prevToIso);
    (Array.isArray(dailyPrev) ? dailyPrev : []).forEach(r=>{
      faturamentoPrev += Number(r?.faturamento || 0) || 0;
      pedidosPrev += Number(r?.pedidos || 0) || 0;
    });

    const canalRows = await getDashboardDailyChannelView(supaClient, fromIso, toIso);
    (Array.isArray(canalRows) ? canalRows : []).forEach(r=>{
      const canal = String(r?.canal || "outros").toLowerCase().trim() || "outros";
      const v = Number(r?.faturamento || 0) || 0;
      const q = Number(r?.pedidos || 0) || 0;
      channelAgg[canal] = (channelAgg[canal] || 0) + v;
      channelOrders[canal] = (channelOrders[canal] || 0) + q;
    });

    const novosDaily = await getNewCustomersDailyView(supaClient, fromIso, toIso);
    const novosPrev = await getNewCustomersDailyView(supaClient, prev.prevFromIso, prev.prevToIso);
    const novosSeries = (Array.isArray(novosDaily) ? novosDaily : []).map(r=>({
      diaIso: String(r?.dia || "").slice(0,10),
      novos: Number(r?.novos_clientes || 0) || 0
    })).filter(r=>r.diaIso);
    novosClientes = novosSeries.reduce((s,r)=>s + r.novos, 0);
    novosClientesPrev = (Array.isArray(novosPrev) ? novosPrev : []).reduce((s,r)=>s + (Number(r?.novos_clientes||0)||0), 0);
    renderDashV2NovosClientes(novosSeries);

    // Fetch reativação + VIP risk in parallel — saves one full round-trip
    const [rowsReat, rowsVip] = await Promise.all([
      (riskEl    ? getClientesReativacaoView(supaClient, 8) : Promise.resolve([])),
      (vipRiskEl ? getClientesVipRiscoView(supaClient, 8)  : Promise.resolve([]))
    ]);

    const reativacaoEl = riskEl;
    if(reativacaoEl){
      reativacaoEl.innerHTML = (Array.isArray(rowsReat) ? rowsReat : []).map((c, idx)=>{
        const id = escapeJsSingleQuote(String(c?.cliente_id || c?.id || ""));
        const nome = String(c?.nome || "Cliente");
        const dias = c?.dias_desde_ultima_compra == null ? "" : (String(c.dias_desde_ultima_compra) + "d");
        const ltv = fmtBRL(c?.ltv || c?.total_gasto || 0);
        return `<div class="top-item" onclick="openClientePage('${id}')">
          <div class="top-rank">${idx+1}</div>
          <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(dias)}</span></div>
          <div class="top-val">${escapeHTML(ltv)}</div>
          <button class="opp-mini-btn" onclick="event.stopPropagation();openWaModal('${id}')">WA</button>
        </div>`;
      }).join("") || `<div class="empty">Sem reativação prioritária.</div>`;
    }

    if(vipRiskEl){
      vipRiskEl.innerHTML = (Array.isArray(rowsVip) ? rowsVip : []).map((c, idx)=>{
        const id = escapeJsSingleQuote(String(c?.cliente_id || c?.id || ""));
        const nome = String(c?.nome || "VIP");
        const dias = c?.dias_desde_ultima_compra == null ? "" : (String(c.dias_desde_ultima_compra) + "d");
        const ltv = fmtBRL(c?.ltv || c?.total_gasto || 0);
        return `<div class="top-item" onclick="openClientePage('${id}')">
          <div class="top-rank">${idx+1}</div>
          <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(dias)}</span></div>
          <div class="top-val">${escapeHTML(ltv)}</div>
          <button class="opp-mini-btn" onclick="event.stopPropagation();openWaModal('${id}')">WA</button>
        </div>`;
      }).join("") || `<div class="empty">Sem VIPs em risco no período.</div>`;
    }

    try{
      const topProds = await getProdutosFavoritosView(supaClient, 10);
      renderDashV2TopProdutos(topProds);
    }catch(_e){}
    try{
      const topCities = await getTopCidadesView(supaClient, 10);
      renderDashV2TopCidades(topCities);
    }catch(_e){}
    try{
      const semContato = await getClientesSemContatoView(supaClient, 8);
      renderDashV2SemContato(semContato);
    }catch(_e){}
    try{
      renderDashV2NextActions((clientesIntelCache||[]));
    }catch(_e){}
  }else{
    const orders = Array.isArray(allOrders) ? allOrders : [];
    const fromTs = new Date(fromIso + "T00:00:00").getTime();
    const toTs = new Date(toIso + "T23:59:59").getTime();
    const inRange = orders.filter(o=>{
      const d = String(o?.data || o?.data_pedido || o?.created_at || "").slice(0,10);
      if(!d) return false;
      const ts = new Date(d + "T12:00:00").getTime();
      return ts >= fromTs && ts <= toTs;
    });
    const byDay = {};
    inRange.forEach(o=>{
      const d = String(o?.data || "").slice(0,10);
      if(!d) return;
      const v = val(o);
      const ch = detectCh(o);
      byDay[d] = byDay[d] || { pedidos: 0, faturamento: 0 };
      byDay[d].pedidos += 1;
      byDay[d].faturamento += v;
      channelAgg[ch] = (channelAgg[ch] || 0) + v;
      channelOrders[ch] = (channelOrders[ch] || 0) + 1;
      faturamento += v;
      pedidos += 1;
    });
    Object.keys(byDay).sort().forEach(d=>{
      const q = Number(byDay[d].pedidos || 0) || 0;
      const v = Number(byDay[d].faturamento || 0) || 0;
      series.push({ diaIso: d, faturamento: v, pedidos: q, ticket_medio: q ? (v / q) : 0 });
    });
    renderDashV2NovosClientes([]);
  }

  const ticket = pedidos ? (faturamento / pedidos) : 0;
  const ticketPrev = pedidosPrev ? (faturamentoPrev / pedidosPrev) : 0;
  const kpi = [
    { l: "Faturamento", v: fmtBRL(faturamento), s: dashDeltaBadge(pctDelta(faturamento, faturamentoPrev)) },
    { l: "Pedidos", v: String(pedidos), s: dashDeltaBadge(pctDelta(pedidos, pedidosPrev)) },
    { l: "Ticket Médio", v: fmtBRL(ticket), s: dashDeltaBadge(pctDelta(ticket, ticketPrev)) },
    { l: "Novos Clientes", v: String(novosClientes), s: dashDeltaBadge(pctDelta(novosClientes, novosClientesPrev)) },
    { l: "Clientes (base)", v: totalClientes == null ? "—" : String(totalClientes), s: ltvMedio == null ? "" : `LTV médio ${fmtBRL(ltvMedio)}` },
  ];

  kpisEl.innerHTML = kpi.map(s=>`<div class="stat"><div class="stat-label">${s.l}</div><div class="stat-value">${s.v}</div><div class="stat-sub">${s.s || " "}</div></div>`).join("");

  const diaCanvas = document.getElementById("chart-v2-dia");
  if(diaCanvas && diaCanvas.getContext){
    const ctx = diaCanvas.getContext("2d");
    if(ctx){
      if(charts.v2dia) charts.v2dia.destroy();
      const labels = series.map(r=>fmtDate(r.diaIso));
      const values = series.map(r=>Number(r.faturamento || 0) || 0);
      const ordersSeries = series.map(r=>Number(r.pedidos || 0) || 0);
      const ticketSeries = series.map(r=>Number(r.ticket_medio || 0) || 0);
      charts.v2dia = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "Faturamento",
            data: values,
            tension: 0.35,
            fill: true,
            borderColor: "#0FA765",
            backgroundColor: "rgba(15,167,101,.18)",
            borderWidth: 2,
            pointRadius: 0,
            pointHitRadius: 12
          },{
            label: "Pedidos",
            data: ordersSeries,
            tension: 0.35,
            fill: false,
            borderColor: "#60a5fa",
            borderWidth: 2,
            pointRadius: 0,
            pointHitRadius: 12,
            yAxisID: "y2"
          },{
            label: "Ticket médio",
            data: ticketSeries,
            tension: 0.35,
            fill: false,
            borderColor: "#a78bfa",
            borderDash: [6,4],
            borderWidth: 2,
            pointRadius: 0,
            pointHitRadius: 12
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (c)=>{
                  const ds = String(c.dataset?.label || "");
                  if(ds === "Pedidos") return String(Number(c.parsed.y||0)||0) + " pedidos";
                  return fmtBRL(c.parsed.y||0);
                }
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 } } },
            y: { grid: { color: "rgba(255,255,255,.06)" }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 }, callback: (v)=>fmtBRL(v) } },
            y2: { position: "right", grid: { display: false }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 } } }
          }
        }
      });
    }
  }

  const canalCanvas = document.getElementById("chart-v2-canal");
  if(canalCanvas && canalCanvas.getContext){
    const ctx = canalCanvas.getContext("2d");
    if(ctx){
      if(charts.v2canal) charts.v2canal.destroy();
      const sorted = Object.entries(channelAgg).sort((a,b)=>b[1]-a[1]).slice(0,10);
      charts.v2canal = new Chart(ctx, {
        type: "bar",
        data: {
          labels: sorted.map(([c])=>CH[c] || c),
          datasets: [{
            label: "Faturamento",
            data: sorted.map(([,v])=>v),
            backgroundColor: sorted.map(([c])=>CH_COLOR[c] || "rgba(15,167,101,.6)"),
            borderRadius: 10,
            borderSkipped: false
          },{
            label: "Pedidos",
            data: sorted.map(([c])=>Number(channelOrders[c] || 0) || 0),
            type: "line",
            borderColor: "#60a5fa",
            backgroundColor: "rgba(96,165,250,.18)",
            borderWidth: 2,
            pointRadius: 0,
            pointHitRadius: 12,
            tension: 0.35,
            yAxisID: "y2"
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (c)=>{
                  const ds = String(c.dataset?.label || "");
                  if(ds === "Pedidos") return String(Number(c.parsed.y||0)||0) + " pedidos";
                  return fmtBRL(c.parsed.y||0);
                }
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 } } },
            y: { grid: { color: "rgba(255,255,255,.06)" }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 }, callback: (v)=>fmtBRL(v) } },
            y2: { position: "right", grid: { display: false }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 } } }
          }
        }
      });
    }
  }
}

function renderDashV2NovosClientes(series){
  const canvas = document.getElementById("chart-v2-novos");
  if(!canvas || !canvas.getContext || !globalThis.Chart) return;
  const list = Array.isArray(series) ? series : [];
  const labels = list.map(r=>fmtDate(r.diaIso));
  const values = list.map(r=>Number(r.novos || 0) || 0);
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  if(charts.v2novos) charts.v2novos.destroy();
  charts.v2novos = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Novos clientes",
        data: values,
        backgroundColor: "rgba(96,165,250,.25)",
        borderColor: "rgba(96,165,250,.5)",
        borderWidth: 1,
        borderRadius: 10,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c)=>String(Number(c.parsed.y||0)||0) + " novos" } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 } } },
        y: { grid: { color: "rgba(255,255,255,.06)" }, ticks: { color: "#9eb8a8", font: { size: 10, weight: 700 } } }
      }
    }
  });
}

function renderDashV2Funil(rows){
  const el = document.getElementById("dash-funil-bars");
  if(!el) return;
  const list = Array.isArray(rows) ? rows : [];
  const mapped = list.map(r=>{
    const label = String(r?.etapa || r?.stage || r?.funil || r?.label || "").trim() || "Etapa";
    const value = Number(r?.clientes ?? r?.qtd_clientes ?? r?.total_clientes ?? r?.count ?? r?.n ?? 0) || 0;
    const ord = Number(r?.ordem ?? r?.ord ?? r?.idx ?? 0) || 0;
    return { label, value, ord };
  });
  mapped.sort((a,b)=>a.ord-b.ord);
  if(!mapped.length || !mapped.some(x=>x.value>0)){
    el.innerHTML = `<div class="empty">Sem dados no período</div>`;
    return;
  }
  const max = Math.max(...mapped.map(x=>x.value), 1);
  const first = mapped[0]?.value || 1;
  el.innerHTML = mapped.map((x,i)=>{
    const pct = Math.round((x.value / max) * 100);
    const conv = i === 0 ? 100 : Math.round((x.value / first) * 100);
    const convColor = conv >= 60 ? "var(--chiva-primary)" : conv >= 30 ? "#f59e0b" : "#ef4444";
    return `<div class="funil-bar-item">
      <div class="funil-bar-label">
        <span class="funil-bar-name">${escapeHTML(x.label)}</span>
        <span class="funil-bar-val">${x.value.toLocaleString("pt-BR")} <span class="funil-bar-pct" style="color:${convColor}">${conv}%</span></span>
      </div>
      <div class="funil-bar-track"><div class="funil-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join("");
}

function renderDashTopCidadesFromOrders(orders){
  const el = document.getElementById("dashv2-top-cidades");
  if(!el) return;
  const list = Array.isArray(orders) ? orders : [];
  if(!list.length){
    el.innerHTML = `<div class="empty">Sem dados no período</div>`;
    return;
  }
  const m = {};
  list.forEach(o=>{
    const cidade = String(o?.cidade_entrega || o?.contato?.endereco?.municipio || o?.contato?.municipio || "").trim();
    const uf = normalizeUF(o?.uf_entrega || o?.contato?.endereco?.uf || o?.contato?.uf || "");
    if(!cidade) return;
    const key = cidade + "|" + (uf || "");
    if(!m[key]) m[key] = { cidade, uf, faturamento: 0, pedidos: 0 };
    m[key].faturamento += val(o);
    m[key].pedidos += 1;
  });
  const top = Object.values(m).sort((a,b)=>b.faturamento - a.faturamento).slice(0,10);
  el.innerHTML = top.map((r, idx)=>{
    const label = [r.cidade, r.uf].filter(Boolean).join(" / ");
    return `<div class="top-item">
      <div class="top-rank">${idx+1}</div>
      <div class="top-name">${escapeHTML(label)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(String(r.pedidos))} pedidos</span></div>
      <div class="top-val">${escapeHTML(fmtBRL(r.faturamento))}</div>
    </div>`;
  }).join("") || `<div class="empty">Sem dados no período</div>`;
}

function renderDashV2TopProdutos(rows){
  const el = document.getElementById("dashv2-top-produtos");
  if(!el) return;
  const list = Array.isArray(rows) ? rows : [];
  if(!list.length){
    el.innerHTML = `<div class="empty">Sem dados.</div>`;
    return;
  }
  el.innerHTML = list.slice(0,10).map((r, idx)=>{
    const nome = String(r?.produto || r?.produto_nome || r?.nome || r?.sku || "Produto").trim();
    const unidades = Number(r?.unidades_vendidas ?? r?.unidades ?? r?.qty ?? r?.quantidade ?? 0) || 0;
    const clientes = Number(r?.total_clientes ?? r?.clientes ?? 0) || 0;
    const pct = r?.pct_recompra ?? r?.percentual_recompra ?? r?.recompra_pct ?? null;
    const pctNum = pct == null ? null : (Number(pct) || 0);
    const right = pctNum == null ? `${unidades}` : `${unidades} · ${pctNum.toFixed(0)}%`;
    const sub = clientes ? `${clientes} clientes` : "—";
    return `<div class="top-item">
      <div class="top-rank">${idx+1}</div>
      <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(sub)}</span></div>
      <div class="top-val">${escapeHTML(right)}</div>
    </div>`;
  }).join("");
}

function renderDashV2TopCidades(rows){
  const el = document.getElementById("dashv2-top-cidades");
  if(!el) return;
  const list = Array.isArray(rows) ? rows : [];
  if(!list.length){
    el.innerHTML = `<div class="empty">Sem dados.</div>`;
    return;
  }
  el.innerHTML = list.slice(0,10).map((r, idx)=>{
    const cidade = String(r?.cidade || r?.municipio || r?.city || "Cidade").trim();
    const uf = String(r?.uf || r?.estado || "").trim().toUpperCase();
    const label = [cidade, uf].filter(Boolean).join(" / ");
    const fat = fmtBRL(Number(r?.faturamento ?? r?.receita ?? r?.total ?? 0) || 0);
    const pedidos = Number(r?.pedidos ?? r?.total_pedidos ?? 0) || 0;
    return `<div class="top-item">
      <div class="top-rank">${idx+1}</div>
      <div class="top-name">${escapeHTML(label)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(String(pedidos))} pedidos</span></div>
      <div class="top-val">${escapeHTML(fat)}</div>
    </div>`;
  }).join("");
}

function renderDashV2SemContato(rows){
  const el = document.getElementById("dashv2-sem-contato");
  if(!el) return;
  const list = Array.isArray(rows) ? rows : [];
  if(!list.length){
    el.innerHTML = `<div class="empty">Sem dados.</div>`;
    return;
  }
  el.innerHTML = list.slice(0,8).map((r, idx)=>{
    const id = escapeJsSingleQuote(String(r?.cliente_id || r?.id || ""));
    const nome = String(r?.nome || "Cliente").trim();
    const motivo = String(r?.motivo || r?.reason || "sem whatsapp/email").trim();
    const ltv = fmtBRL(Number(r?.ltv ?? r?.total_gasto ?? 0) || 0);
    return `<div class="top-item" onclick="openClientePage('${id}')">
      <div class="top-rank">${idx+1}</div>
      <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(motivo)}</span></div>
      <div class="top-val">${escapeHTML(ltv)}</div>
    </div>`;
  }).join("");
}

function renderDashV2NextActions(rows){
  const el = document.getElementById("dashv2-next-actions");
  if(!el) return;
  const list = Array.isArray(rows) ? rows : [];
  const actionable = list
    .filter(r=>r && r.cliente_id && String(r.next_best_action||"").trim())
    .slice()
    .sort((a,b)=>{
      const ar = Number(a.risco_churn||0)||0;
      const br = Number(b.risco_churn||0)||0;
      if(br !== ar) return br - ar;
      const as = Number(a.score_recompra||0)||0;
      const bs = Number(b.score_recompra||0)||0;
      if(bs !== as) return bs - as;
      const ag = Number(a.total_gasto||a.ltv||0)||0;
      const bg = Number(b.total_gasto||b.ltv||0)||0;
      return bg - ag;
    })
    .slice(0,8);

  if(!actionable.length){
    el.innerHTML = `<div class="empty">Sem ações sugeridas.</div>`;
    return;
  }
  el.innerHTML = actionable.map((c, idx)=>{
    const id = escapeJsSingleQuote(String(c.cliente_id));
    const nome = String(c.nome || "Cliente");
    const act = String(c.next_best_action || "").trim();
    const dias = c.dias_desde_ultima_compra == null ? "" : (String(c.dias_desde_ultima_compra) + "d");
    const phone = String(c.celular || c.telefone || "").replace(/\D/g,"");
    return `<div class="top-item" onclick="openClientePage('${id}')">
      <div class="top-rank">${idx+1}</div>
      <div class="top-name">${escapeHTML(nome)} <span style="color:var(--text-3);font-weight:600">· ${escapeHTML(dias)}</span></div>
      <div style="flex:1;font-size:10px;color:var(--text-3);margin-left:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(act)}</div>
      ${phone?`<button class="opp-mini-btn" onclick="event.stopPropagation();openWaModal('${id}')">WA</button>`:""}
    </div>`;
  }).join("");
}

function renderMeta(v){
  const meta=parseFloat(localStorage.getItem("crm_meta")||"0");
  const el = document.getElementById("meta-body");
  if(!el) return;
  if(!meta){el.innerHTML=`<span style="font-size:11px;color:var(--text-3)">Clique em "Editar" para definir sua meta.</span>`;return;}
  const pct=Math.min(v/meta*100,100),warn=pct<50;
  el.innerHTML=`
    <div style="display:flex;align-items:flex-end;gap:10px;margin-bottom:4px">
      <span class="meta-pct" style="color:${warn?"var(--amber)":"var(--green)"}">${pct.toFixed(1)}%</span>
      <span style="font-size:10px;color:var(--text-3);margin-bottom:3px">${fmtBRL(v)} de ${fmtBRL(meta)}</span>
    </div>
    <div class="meta-bar-bg"><div class="meta-bar ${warn?"warn":""}" style="width:${pct}%"></div></div>
    <div class="meta-row"><span>${fmtBRL(Math.max(0,meta-v))} restante</span><span>Meta: ${fmtBRL(meta)}</span></div>`;
}
async function editMeta(){
  const cur=localStorage.getItem("crm_meta")||""; const v=prompt("Meta mensal (R$):",cur); if(v===null)return;
  const mv=String(parseFloat(v.replace(/[^\d,.]/g,"").replace(",","."))||0);
  localStorage.setItem("crm_meta",mv);
  await sbSetConfig('meta_mensal',mv);
  renderDash();
}
function renderCompare(ordersOverride){
  const body = document.getElementById("cmp-body");
  if(!body) return;
  const now = new Date();
  const cur = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0");
  const prevDate = new Date(now.getFullYear(), now.getMonth()-1, 1);
  const prev = prevDate.getFullYear() + "-" + String(prevDate.getMonth()+1).padStart(2,"0");
  const a = prev;
  const b = cur;

  const aEl = document.getElementById("cmp-a");
  const bEl = document.getElementById("cmp-b");
  if(aEl) aEl.value = a;
  if(bEl) bEl.value = b;

  let orders = Array.isArray(ordersOverride) ? ordersOverride : allOrders;
  if(!Array.isArray(ordersOverride)){
    const dashCh = String(document.getElementById("dash-canal-filter")?.value||"").toLowerCase().trim();
    if(dashCh) orders = (Array.isArray(orders)?orders:[]).filter(o=>detectCh(o)===dashCh);
  }
  const flt=ym=>{ const[y,m]=ym.split("-"); return orders.filter(o=>{ const d=new Date(o.data); return d.getFullYear()===+y&&(d.getMonth()+1)===+m; }); };
  const oA=flt(a),oB=flt(b),vA=oA.reduce((s,o)=>s+val(o),0),vB=oB.reduce((s,o)=>s+val(o),0);
  const d=vA>0?((vB-vA)/vA*100):0;
  const mn=ym=>{ const[y,m]=ym.split("-"); return["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][+m-1]+"/"+y.slice(2); };
  body.innerHTML=`<div class="cmp-grid">
    <div class="cmp-col"><div class="cmp-col-title">${mn(a)} (mês anterior)</div><div class="cmp-val" style="color:var(--text)">${fmtBRL(vA)}</div><div class="cmp-sub">${oA.length} pedidos</div></div>
    <div class="cmp-col"><div class="cmp-col-title">${mn(b)} (mês atual)</div><div class="cmp-val" style="color:var(--green)">${fmtBRL(vB)}</div><div class="cmp-sub">${oB.length} pedidos</div><div class="cmp-delta ${d>=0?"delta-up":"delta-down"}">${d>=0?"▲":"▼"}${Math.abs(d).toFixed(1)}% vs ${mn(a)}</div></div>
  </div>`;
}
function renderAlertBanner(ordersOverride){
  const orders = Array.isArray(ordersOverride) ? ordersOverride : allOrders;
  const ad=parseInt(localStorage.getItem("crm_alertdays")||"60");
  const inat=Object.values(buildCli(orders)).filter(c=>daysSince(c.last)>ad&&!isCNPJ(c.doc));
  const el=document.getElementById("alert-banner");
  if(!inat.length){el.style.display="none";return;}
  el.style.display="block";
  el.innerHTML=`<div class="ab-title">⚠️ ${inat.length} cliente${inat.length!==1?"s":""} sem comprar há mais de ${ad} dias</div>
    ${inat.slice(0,3).map(c=>`<div class="ab-item"><strong>${escapeHTML(c.nome)}</strong> — ${daysSince(c.last)} dias</div>`).join("")}
    ${inat.length>3?`<span style="font-size:10px;color:var(--blue);cursor:pointer" onclick="showPage('alertas')">Ver todos →</span>`:""}`;
}
function renderChartCanal(ordersOverride){
  const orders = Array.isArray(ordersOverride) ? ordersOverride : allOrders;
  const t={};
  orders.forEach(o=>{ const c=detectCh(o); t[c]=(t[c]||0)+val(o); });
  Object.keys(t).forEach(k=>{ if(!t[k]) delete t[k]; });
  if(charts.canal) charts.canal.destroy();
  const canvas=document.getElementById("chart-canal");
  if(!canvas) return;
  const sorted=Object.entries(t).sort((a,b)=>b[1]-a[1]);
  const state = setDashCanvasState("chart-canal", sorted.length > 0, "Sem dados no período", !!String(document.getElementById("dash-canal-filter")?.value||""));
  if(!state.shouldRender || !state.canvas) return;
  const ctx = state.canvas.getContext("2d");
  if(!ctx) return;
  const total=sorted.reduce((s,[_c,v])=>s+(Number(v)||0),0)||1;
  const brandColors={
    ml:"#fbbf24",
    shopee:"#f97316",
    amazon:"#22d3ee",
    shopify:"#84cc16",
    yampi:"#d946ef",
    cnpj:"#f59e0b",
    outros:"#94a3b8",
    default:"#0FA765"
  };
  const isLight = document.documentElement.classList.contains("light");
  charts.canal=new Chart(ctx,{
    type:"doughnut",
    data:{
      labels:sorted.map(([c])=>CH[c]||c),
      datasets:[{
        data:sorted.map(([,v])=>v),
        backgroundColor:sorted.map(([c])=>brandColors[c]||brandColors.default),
        borderWidth:0,
        borderColor:"transparent",
        spacing:4,
        hoverOffset:8
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      cutout:'68%',
      plugins:{
        legend:{ display:false },
        tooltip:{
          backgroundColor: isLight ? '#ffffff' : '#0e1018',
          borderColor: isLight ? 'rgba(0,0,0,.12)' : '#1d2235',
          borderWidth:1,
          titleColor: isLight ? '#111827' : '#edeef4',
          bodyColor: isLight ? '#334155' : '#a0a8be',
          padding:10,
          callbacks:{
            label:function(ctx){
              const pct=Math.round(ctx.raw/total*100);
              return ' '+fmtBRL(ctx.raw)+' ('+pct+'%)';
            }
          }
        }
      }
    }
  });
  // Enhanced canal table
  const tbl=document.getElementById("canal-table");
  if(tbl) tbl.innerHTML=sorted.map(([c,v])=>{
    const pct=Math.round(v/total*100);
    const color=brandColors[c]||brandColors.default;
    return `<div class="dash-donut-row">
      <div class="dash-donut-left">
        <span class="dash-donut-dot" style="--c:${color}"></span>
        <span class="dash-donut-name">${escapeHTML(CH[c]||c)}</span>
      </div>
      <div class="dash-donut-right">
        <span class="dash-donut-value">${escapeHTML(fmtBRL(v))}</span>
        <span class="dash-donut-pct">${escapeHTML(String(pct))}%</span>
      </div>
      <div class="dash-donut-bar">
        <div class="dash-donut-bar-fill" style="--c:${color};width:${pct}%"></div>
      </div>
    </div>`;
  }).join("");
}


function renderChartMes(ordersOverride){
  const orders = Array.isArray(ordersOverride) ? ordersOverride : allOrders;
  const bm={};
  orders.forEach(o=>{ const d=new Date(o.data); if(isNaN(d))return; const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; bm[k]=(bm[k]||0)+val(o); });
  const sk=Object.keys(bm).sort();
  if(charts.mes) charts.mes.destroy();
  const canvas = document.getElementById("chart-mes");
  if(!canvas) return;
  const state = setDashCanvasState("chart-mes", sk.length > 0, "Sem dados no período", !!String(document.getElementById("dash-canal-filter")?.value||""));
  if(!state.shouldRender || !state.canvas) return;
  const ctx = state.canvas.getContext("2d");
  if(!ctx) return;
  charts.mes=new Chart(ctx,{
    type:"line",
    data:{
      labels:sk.map(k=>{ const[y,m]=k.split("-"); return m+"/"+y.slice(2); }),
      datasets:[{
        data:sk.map(k=>bm[k]),
        tension:0.4,
        fill:true,
        borderColor:"#0FA765",
        backgroundColor:(c)=>{
          const g=c.chart.ctx.createLinearGradient(0,0,0,c.chart.height);
          g.addColorStop(0,"rgba(15,167,101,0.28)");
          g.addColorStop(1,"rgba(15,167,101,0)");
          return g;
        },
        borderWidth:2.5,
        pointRadius:4,
        pointHoverRadius:7,
        pointBackgroundColor:"#0FA765",
        pointBorderColor:"var(--surface,#181f2e)",
        pointBorderWidth:2
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:"#0e1018",borderColor:"rgba(15,167,101,.35)",borderWidth:1,
          titleColor:"#edeef4",bodyColor:"#a0a8be",padding:12,cornerRadius:10,
          callbacks:{label:c=>" "+fmtBRL(c.raw)}
        }
      },
      scales:{
        x:{grid:{display:false},ticks:{color:"rgba(160,168,190,0.7)",font:{size:10},maxRotation:0,maxTicksLimit:8}},
        y:{grid:{color:"rgba(255,255,255,0.04)",drawBorder:false},
          ticks:{color:"rgba(160,168,190,0.7)",font:{size:10},callback:v=>v>=1000?(v/1000).toFixed(0)+"k":v}}
      }
    }
  })
}
function renderTopCli(ordersOverride){
  const orders = Array.isArray(ordersOverride) ? ordersOverride : allOrders;
  const el = document.getElementById("top-clientes");
  if(!el) return;
  if(!orders.length){
    const showClear = !!String(document.getElementById("dash-canal-filter")?.value||"");
    const btn = showClear ? `<div style="margin-top:10px"><button class="btn" onclick="(function(){var s=document.getElementById('dash-canal-filter'); if(s) s.value=''; localStorage.setItem('crm_dash_canal',''); renderDash();})()">Ver todos os dados</button></div>` : "";
    el.innerHTML = `<div class="empty">Sem dados no período${btn}</div>`;
    return;
  }
  const m={}; orders.forEach(o=>{
    const k = cliKey(o);
    if(!k) return;
    if(!m[k]){ m[k]={n:o.contato?.nome||"?",t:0,id:k,cid:""}; }
    if(!m[k].cid){
      const cid = String(o?.cliente_id || o?.contato?.id || "").trim();
      if(cid) m[k].cid = cid;
    }
    m[k].t += val(o);
  });
  const top=Object.values(m).sort((a,b)=>b.t-a.t).slice(0,10); const max=top[0]?.t||1;
  el.innerHTML=top.map((c,i)=>{
    const cid = escapeJsSingleQuote(String(c.cid || ""));
    const on = cid ? `onclick="openClientePage('${cid}')"` : "";
    return `<div class="top-item" ${on}>
      <span class="top-rank">#${i+1}</span>
      <div style="flex:1;overflow:hidden">
        <div class="top-name">${escapeHTML(c.n)}</div>
        <div class="top-bar-wrap"><div class="top-bar" style="width:${(c.t/max*100).toFixed(0)}%"></div></div>
      </div>
      <span class="top-val">${fmtBRL(c.t)}</span>
    </div>`;
  }).join("");
}
function renderTopProd(ordersOverride){
  const orders = Array.isArray(ordersOverride) ? ordersOverride : allOrders;
  const el = document.getElementById("top-produtos-dash");
  if(!el) return;
  if(!orders.length){
    const showClear = !!String(document.getElementById("dash-canal-filter")?.value||"");
    const btn = showClear ? `<div style="margin-top:10px"><button class="btn" onclick="(function(){var s=document.getElementById('dash-canal-filter'); if(s) s.value=''; localStorage.setItem('crm_dash_canal',''); renderDash();})()">Ver todos os dados</button></div>` : "";
    el.innerHTML = `<div class="empty">Sem dados no período${btn}</div>`;
    return;
  }
  const m={}; orders.forEach(o=>{
    const itens = getPedidoItens(o);
    if(!itens.length){
      try{ console.warn("[TopProd] pedido sem itens:", o?.id, Object.keys(o||{})); }catch(_e){}
      return;
    }
    itens.forEach(it=>{
      const desc = String(it?.descricao || "").trim();
      const code = String(it?.codigo || "").trim();
      const k = desc || code || "?";
      if(!m[k]) m[k] = { n: desc || code || "—", t: 0 };
      m[k].t += Number(it?.valor_total != null ? it.valor_total : ((Number(it?.valor||0)||0) * (Number(it?.quantidade||1)||1))) || 0;
    });
  });
  const top=Object.values(m).sort((a,b)=>b.t-a.t).slice(0,5); const max=top[0]?.t||1;
  el.innerHTML=top.length?top.map((p,i)=>`<div class="top-item"><span class="top-rank">#${i+1}</span><div style="flex:1;overflow:hidden"><div class="top-name">${escapeHTML(p.n)}</div><div class="top-bar-wrap"><div class="top-bar" style="width:${(p.t/max*100).toFixed(0)}%"></div></div></div><span class="top-val">${fmtBRL(p.t)}</span></div>`).join(""):`<div class="empty">Sem dados no período</div>`;
}

// ═══════════════════════════════════════════════════
//  AI ANALYSIS
// ═══════════════════════════════════════════════════

// ─── DASHBOARD NEW CHARTS ─────────────────────────────────────
function renderDashChartsCrescimento(ordersOverride){
  const orders = Array.isArray(ordersOverride) ? ordersOverride : allOrders;
  const canvas = document.getElementById("chart-crescimento");
  if(!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  const byMonth = {};
  orders.forEach(o=>{
    const d = new Date(o.data || o.data_pedido || o.dataPedido || "");
    if(isNaN(d)) return;
    const k = d.getFullYear()+"-"+(d.getMonth()+1).toString().padStart(2,"0");
    byMonth[k]=(byMonth[k]||0)+val(o);
  });
  const keys = Object.keys(byMonth).sort().slice(-12);
  const vals = keys.map(k=>byMonth[k]);

  if(window._chartCrescimento) window._chartCrescimento.destroy();
  window._chartCrescimento = new Chart(ctx, {
    type:"bar",
    data:{
      labels:keys.map(k=>{ const [y,m]=k.split("-"); return ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][parseInt(m)-1]+"/"+y.slice(2); }),
      datasets:[{
        data:vals,
        backgroundColor:"#0FA765",
        hoverBackgroundColor:"#13c97e",
        borderWidth:0,
        borderRadius:4,
        borderSkipped:false
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{color:"rgba(160, 168, 190, 0.8)",font:{size:9,family:"Plus Jakarta Sans"},maxRotation:0,autoSkip:true,maxTicksLimit:6},grid:{display:false}},
        y:{ticks:{color:"rgba(160, 168, 190, 0.8)",font:{size:9,family:"Plus Jakarta Sans"},callback:v=>"R$"+(v>=1000?(v/1000).toFixed(0)+"k":v)},grid:{display:false}}
      }
    }
  });
}

function renderDashChartsCidades(ordersOverride){
  const orders = Array.isArray(ordersOverride) ? ordersOverride : allOrders;
  const canvas = document.getElementById("chart-cidades");
  if(!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  const byCity = {};
  Object.values(buildCli(orders)).forEach(c=>{
    if(!c?.cidade) return;
    const k = (String(c.cidade||"")+" ("+String(c.uf||"")+")").trim();
    byCity[k]=(byCity[k]||0)+1;
  });
  const entries = Object.entries(byCity).sort((a,b)=>b[1]-a[1]).slice(0,8);

  if(window._chartCidades) window._chartCidades.destroy();
  window._chartCidades = new Chart(ctx, {
    type:"bar",
    data:{
      labels:entries.map(([k])=>k.length>15?k.slice(0,14)+"…":k),
      datasets:[{
        data:entries.map(([,v])=>v),
        backgroundColor:"#0FA765",
        hoverBackgroundColor:"#13c97e",
        borderWidth:0,
        borderRadius:4
      }]
    },
    options:{
      indexAxis:"y",
      responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{color:"rgba(160, 168, 190, 0.8)",font:{size:9,family:"Plus Jakarta Sans"},maxRotation:0,autoSkip:true,maxTicksLimit:6},grid:{display:false}},
        y:{ticks:{color:"rgba(160, 168, 190, 0.8)",font:{size:9,family:"Plus Jakarta Sans"}},grid:{display:false}}
      }
    }
  });
}


async function runAI(type){
  return runAIImpl(getIACtx(), type);
}

// ═══════════════════════════════════════════════════
//  SEGMENTOS
// ═══════════════════════════════════════════════════
const SEGMENTS=[
  {id:"vip",icon:"⭐",name:"VIPs",desc:"Compraram R$650+, excl. CNPJ. Prioridade máxima de retenção.",action:"Tratamento exclusivo + programa de fidelidade",filter:c=>calcCliScores(c).status==="vip"},
  {id:"recorrentes",icon:"🔄",name:"Recorrentes",desc:"2+ pedidos. Já confiam na marca — foco em aumentar LTV.",action:"Upsell e cross-sell de novos sabores",filter:c=>c.orders.length>=2&&!isCNPJ(c.doc)},
  {id:"prox_recompra",icon:"🎯",name:"Prontos p/ Recompra",desc:"Compraram 30-60 dias atrás. Momento ideal de abordagem.",action:"WhatsApp agora — maior conversão",filter:c=>{ const d=daysSince(c.last); return d>=30&&d<=60&&!isCNPJ(c.doc); }},
  {id:"risco_churn",icon:"⚠️",name:"Risco de Perda",desc:"Compraram há 61-90 dias sem voltar. Janela de resgate.",action:"Oferta especial urgente via WhatsApp",filter:c=>{ const d=daysSince(c.last); return d>=61&&d<=90&&!isCNPJ(c.doc); }},
  {id:"inativos",icon:"😴",name:"Inativos",desc:"Mais de 90 dias sem comprar. Reativação via campanha.",action:"Campanha de reativação com desconto",filter:c=>{ const d=daysSince(c.last); return d>90&&!isCNPJ(c.doc); }},
  {id:"novos",icon:"🆕",name:"Novos (1 compra)",desc:"Compraram apenas 1x. Converter em recorrentes é urgente.",action:"Sequência de onboarding + segundo sabor",filter:c=>c.orders.length===1&&daysSince(c.last)<=60&&!isCNPJ(c.doc)},
  {id:"alto_potencial",icon:"🚀",name:"Alto Potencial",desc:"Score de recompra >70. Candidatos a VIP.",action:"Programa de pontos e exclusividade",filter:c=>calcCliScores(c).recompraScore>70&&!isCNPJ(c.doc)},
  {id:"cnpj",icon:"🏢",name:"Empresas (CNPJ)",desc:"Clientes B2B. Potencial de volume mas excluídos do VIP.",action:"Proposta comercial B2B",filter:c=>isCNPJ(c.doc)},
];

function intelRow(customer, subtitle, rightHtml){
  const cid = escapeJsSingleQuote(String(customer?.id||""));
  const name = escapeHTML(String(customer?.nome||"Cliente"));
  const sub = escapeHTML(String(subtitle||""));
  const loc = escapeHTML([customer?.cidade, customer?.uf].filter(Boolean).join(" — "));
  const phone = rawPhone(customer?.telefone||"");
  return `
    <div class="drawer-order-row" style="cursor:default" onclick="openClientePage('${cid}')">
      <div>
        <div class="drawer-order-num">${name}</div>
        <div class="drawer-order-date">${sub}${loc?` · ${loc}`:""}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${rightHtml||""}
        ${phone?`<button class="opp-mini-btn" onclick="event.stopPropagation();openWaModal('${cid}')">WA</button>`:""}
        <button class="opp-mini-btn" onclick="event.stopPropagation();openClientePage('${cid}')">Abrir</button>
      </div>
    </div>
  `;
}

function renderInteligencia(){
  const sumEl = document.getElementById("intel-summary");
  const topEl = document.getElementById("intel-top");
  const riskEl = document.getElementById("intel-risk");
  const newEl = document.getElementById("intel-new");
  const recEl = document.getElementById("intel-rec");
  const actEl = document.getElementById("intel-actions");
  if(!sumEl || !topEl || !riskEl || !newEl || !recEl || !actEl) return;

  if(!allOrders.length){
    sumEl.innerHTML = `<div class="modern-empty-state"><div class="mes-icon">🧠</div><div class="mes-title">Sem dados ainda</div><div class="mes-desc">Conecte o Supabase e carregue pedidos reais.</div></div>`;
    [topEl,riskEl,newEl,recEl,actEl].forEach(el=>{ el.innerHTML=""; });
    return;
  }

  const clis = Object.values(buildCli(allOrders));
  const ad = parseInt(localStorage.getItem("crm_alertdays")||"60");
  const total = allOrders.reduce((s,o)=>s+val(o),0);
  const recorrentes = clis.filter(c=>c.orders.length>=2);
  const inativos = clis.filter(c=>daysSince(c.last)>ad && !isCNPJ(c.doc));
  const vips = clis.filter(c=>{ const sc=calcCliScores(c); return sc.status==="vip" && !sc.isCnpj; });
  const ticket = allOrders.length ? total/allOrders.length : 0;

  sumEl.innerHTML = `
    <div class="profile-h2">Resumo</div>
    <div class="profile-kpi-grid">
      <div class="profile-kpi"><div class="profile-kpi-label">Clientes</div><div class="profile-kpi-val">${escapeHTML(String(clis.length))}</div></div>
      <div class="profile-kpi"><div class="profile-kpi-label">VIPs</div><div class="profile-kpi-val">${escapeHTML(String(vips.length))}</div></div>
      <div class="profile-kpi"><div class="profile-kpi-label">Inativos</div><div class="profile-kpi-val">${escapeHTML(String(inativos.length))}</div></div>
      <div class="profile-kpi"><div class="profile-kpi-label">Recompra</div><div class="profile-kpi-val">${escapeHTML(String(clis.length?Math.round(recorrentes.length/clis.length*100):0))}%</div></div>
      <div class="profile-kpi"><div class="profile-kpi-label">Ticket médio</div><div class="profile-kpi-val">${escapeHTML(fmtBRL(ticket))}</div></div>
      <div class="profile-kpi"><div class="profile-kpi-label">Receita total</div><div class="profile-kpi-val">${escapeHTML(fmtBRL(total))}</div></div>
    </div>
  `;
  renderDashChartsCrescimento(allOrders);

  const top = clis
    .map(c=>({ c, s: calcCliScores(c), ltv: c.orders.reduce((x,o)=>x+val(o),0) }))
    .filter(x=>!x.s.isCnpj)
    .sort((a,b)=>b.ltv-a.ltv)
    .slice(0,10);

  const risk = clis
    .map(c=>({ c, s: calcCliScores(c) }))
    .filter(x=>!x.s.isCnpj)
    .sort((a,b)=>b.s.churnRisk-a.s.churnRisk)
    .slice(0,10);

  const nov = clis
    .map(c=>({ c, s: calcCliScores(c) }))
    .filter(x=>x.s.status==="novo")
    .sort((a,b)=>a.s.ds-b.s.ds)
    .slice(0,10);

  const rec = clis
    .filter(c=>c.orders.length>=2)
    .map(c=>({ c, s: calcCliScores(c) }))
    .filter(x=>!x.s.isCnpj)
    .sort((a,b)=>(b.c.orders.length-a.c.orders.length))
    .slice(0,10);

  topEl.innerHTML = `
    <div class="profile-h2">Top clientes (LTV)</div>
    ${top.length ? top.map(x=>{
      const sub = `${x.c.orders.length} pedidos · ${fmtBRL(x.ltv)}`;
      return intelRow(x.c, sub, `<span class="pill pill-soft">${escapeHTML(x.s.status||"")}</span>`);
    }).join("") : `<div class="empty">Nenhum cliente.</div>`}
  `;

  riskEl.innerHTML = `
    <div class="profile-h2">Clientes em risco</div>
    ${risk.length ? risk.map(x=>{
      const sub = `${x.s.ds}d sem comprar · risco ${x.s.churnRisk}%`;
      return intelRow(x.c, sub, `<span class="pill" style="background:var(--red-bg);color:var(--red)">${escapeHTML(String(x.s.churnRisk))}%</span>`);
    }).join("") : `<div class="empty">Sem riscos críticos.</div>`}
  `;

  newEl.innerHTML = `
    <div class="profile-h2">Clientes novos</div>
    ${nov.length ? nov.map(x=>{
      const last = x.c.last ? fmtDate(x.c.last) : "—";
      const sub = `${x.c.orders.length} pedido · última ${last}`;
      return intelRow(x.c, sub, `<span class="pill pill-soft">novo</span>`);
    }).join("") : `<div class="empty">Sem novos clientes no período.</div>`}
  `;

  recEl.innerHTML = `
    <div class="profile-h2">Recorrentes</div>
    ${rec.length ? rec.map(x=>{
      const sub = `${x.c.orders.length} pedidos · intervalo ${x.s.avgInterval?x.s.avgInterval+"d":"—"}`;
      return intelRow(x.c, sub, `<span class="pill" style="background:var(--green-bg);color:var(--green)">${escapeHTML(String(x.c.orders.length))}×</span>`);
    }).join("") : `<div class="empty">Sem recorrentes ainda.</div>`}
  `;

  const vipDorm = clis
    .map(c=>({ c, s: calcCliScores(c) }))
    .filter(x=>x.s.status==="vip" && x.s.ds>=45)
    .sort((a,b)=>b.s.ds-a.s.ds)
    .slice(0,10);
  const inactive = inativos
    .map(c=>({ c, s: calcCliScores(c) }))
    .sort((a,b)=>b.s.ds-a.s.ds)
    .slice(0,10);

  actEl.innerHTML = `
    <div class="profile-h2">Ações rápidas</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
      <div class="profile-card" style="padding:12px">
        <div class="profile-h2" style="margin-bottom:8px">VIPs inativos (45+ dias)</div>
        ${vipDorm.length ? vipDorm.map(x=>{
          const sub = `${x.s.ds}d sem comprar · ${fmtBRL(x.s.ltv)}`;
          return intelRow(x.c, sub, `<button class="opp-mini-btn" onclick="event.stopPropagation();openTaskModal(null,'${escapeJsSingleQuote(String(x.c.nome||"Cliente"))}')">+ Tarefa</button>`);
        }).join("") : `<div style="font-size:12px;color:var(--text-3);padding:8px 0">Nenhum VIP inativo agora.</div>`}
      </div>
      <div class="profile-card" style="padding:12px">
        <div class="profile-h2" style="margin-bottom:8px">Inativos (>${escapeHTML(String(ad))} dias)</div>
        ${inactive.length ? inactive.map(x=>{
          const sub = `${x.s.ds}d sem comprar · ${x.c.orders.length} pedidos`;
          return intelRow(x.c, sub, `<button class="opp-mini-btn" onclick="event.stopPropagation();openWaModal('${escapeJsSingleQuote(String(x.c.id||""))}')">WA</button>`);
        }).join("") : `<div style="font-size:12px;color:var(--text-3);padding:8px 0">Nenhum inativo acima do limite.</div>`}
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════
//  CLIENTES
// ═══════════════════════════════════════════════════
function setChCli(ch){ activeCh=ch; renderClientes(); }

function ensureClientesSentinel(){
  const listEl = document.getElementById("client-list");
  if(!listEl) return null;
  let sentinel = document.getElementById("clientes-sentinel");
  if(!sentinel){
    sentinel = document.createElement("div");
    sentinel.id = "clientes-sentinel";
    sentinel.style.height = "1px";
  }
  if(sentinel.parentElement !== listEl) listEl.appendChild(sentinel);
  return sentinel;
}

function observeClientesSentinel(){
  const sentinel = ensureClientesSentinel();
  if(!sentinel) return;
  if(!("IntersectionObserver" in window)) return;
  if(!clientesIntelObserver){
    clientesIntelObserver = new IntersectionObserver((entries)=>{
      const hit = entries && entries.some(e=>e && e.isIntersecting);
      if(!hit) return;
      const active = document.getElementById("page-clientes")?.classList.contains("active");
      if(!active) return;
      if(clientesIntelInFlight) return;
      if(!clientesIntelHasMore) return;
      loadClientesInteligenciaCache(false).then(()=>{
        renderClientes();
      }).catch(()=>{});
    }, { root: null, rootMargin: "800px 0px", threshold: 0 });
  }
  clientesIntelObserver.disconnect();
  clientesIntelObserver.observe(sentinel);
}

function appendClienteCards(html){
  if(!html) return;
  const listEl = document.getElementById("client-list");
  if(!listEl) return;
  const sentinel = ensureClientesSentinel();
  if(sentinel) sentinel.insertAdjacentHTML("beforebegin", html);
  else listEl.insertAdjacentHTML("beforeend", html);
}

function renderClientes(){
  const usingViews = !!(supaConnected && supaClient);
  const q=(document.getElementById("search-cli")?.value||"").toLowerCase();
  const statusFil=document.getElementById("fil-cli-status")?.value||"";
  const segFil=document.getElementById("fil-cli-seg")?.value||"";
  const canalFil=document.getElementById("fil-cli-canal")?.value||"";
  const uf=document.getElementById("fil-estado")?.value||"";
  const isDefaultFilters = !q && !statusFil && !segFil && !canalFil && !uf && activeCh === "all";

  if(usingViews){
    if(!clientesIntelCache.length){
      loadClientesInteligenciaCache().then(()=>{ renderClientes(); }).catch(()=>{});
      document.getElementById("cli-label").textContent = "Carregando…";
      document.getElementById("client-list").innerHTML = `<div class="empty">Carregando inteligência de clientes…</div>`;
      document.getElementById("ch-pills-cli").innerHTML = "";
      return;
    }

    const cc = {};
    clientesIntelCache.forEach(c=>{
      const ch = String(c.canal_principal || "outros").toLowerCase().trim() || "outros";
      cc[ch] = (cc[ch]||0) + 1;
    });
    const pills = [{id:"all",l:"Todos",n:clientesIntelCache.length},...["cnpj","shopify","ml","shopee","amazon","yampi","outros"].filter(c=>cc[c]).map(c=>({id:c,l:CH[c]||c,n:cc[c]}))];
    document.getElementById("ch-pills-cli").innerHTML = pills.map(p=>`<div class="ch-pill ${p.id} ${activeCh===p.id?"active":""}" onclick="setChCli('${p.id}')">${p.l} <strong>${p.n}</strong></div>`).join("");

    let rows = clientesIntelCache.slice();
    const canalFiltro = normCanalKey(canalFil || (activeCh !== "all" ? activeCh : ""));
    if(canalFiltro){
      let count = 0;
      rows = rows.filter(c=>{
        const cid = String(c?.cliente_id || c?.id || "").trim();
        const docDigits = String(c?.doc || "").replace(/\D/g,"");
        const email = String(c?.email || "").trim().toLowerCase();
        const tel = String(c?.telefone || c?.celular || "").replace(/\D/g,"");
        const key = docDigits || email || tel || cid;
        const ok = clienteTemPedidoNoCanal(key, canalFiltro);
        if(ok) count += 1;
        return ok;
      });
      console.log("[Filtro Canal]", canalFiltro, "clientes que têm pedidos nesse canal:", count);
      if(lastDetectChDebugCanal !== canalFiltro){
        lastDetectChDebugCanal = canalFiltro;
        try{
          (Array.isArray(allOrders) ? allOrders.slice(0,10) : []).forEach(o=>{
            console.log("[detectCh]", o?.numero || o?.numero_pedido || o?.id, detectCh(o));
          });
        }catch(_e){}
      }
    }
    if(uf) rows = rows.filter(c=>String(c.uf||"").toUpperCase()===String(uf).toUpperCase());
    if(statusFil){
      const st = String(statusFil||"").trim().toLowerCase();
      rows = rows.filter(c=>String(c.status||"").trim().toLowerCase()===st);
    }
    if(segFil){
      const sg = String(segFil||"").trim().toLowerCase();
      rows = rows.filter(c=>String(c.segmento_crm||"").trim().toLowerCase()===sg);
    }
    if(q){
      const qDigits = q.replace(/\D/g,"");
      rows = rows.filter(c=>{
        const hay = [
          c.nome,
          c.email,
          c.telefone,
          c.celular,
          c.doc,
          c.cidade,
          c.uf
        ].map(x=>String(x||"").toLowerCase()).join(" ");
        if(hay.includes(q)) return true;
        if(qDigits && (String(c.telefone||"").includes(qDigits) || String(c.celular||"").includes(qDigits) || String(c.doc||"").includes(qDigits))) return true;
        return false;
      });
    }

    console.log("[Filtro Clientes]", { busca: q, status: statusFil, segmento: segFil, canal: canalFiltro, uf }, "clientes encontrados:", rows.length);

    const suffix = clientesIntelHasMore ? "+" : "";
    document.getElementById("cli-label").textContent = isDefaultFilters ? `${rows.length}${suffix} cliente${rows.length!==1?"s":""}` : `${rows.length} encontrado${rows.length!==1?"s":""}`;
    const listEl = document.getElementById("client-list");
    if(!listEl) return;

    if(isDefaultFilters){
      if(clientesIntelDomMode !== "default"){
        clientesIntelDomMode = "default";
        clientesIntelDomCount = 0;
        listEl.innerHTML = "";
      }
      const next = rows.slice(clientesIntelDomCount);
      if(next.length){
        const html = next.map((c,i)=>renderCliIntelCard(c,"cli"+(clientesIntelDomCount+i))).join("");
        appendClienteCards(html);
        clientesIntelDomCount += next.length;
      }
      if(!rows.length) listEl.innerHTML = `<div class="empty">Nenhum cliente encontrado.</div>`;
    }else{
      clientesIntelDomMode = "filtered";
      clientesIntelDomCount = 0;
      if(rows.length){
        listEl.innerHTML = rows.slice(0,800).map((c,i)=>renderCliIntelCard(c,"cli"+i)).join("");
      }else{
        const canalFiltro = normCanalKey(canalFil || (activeCh !== "all" ? activeCh : ""));
        const clearBtn = canalFiltro ? `<div style="margin-top:10px"><button class="btn" onclick="(function(){var s=document.getElementById('fil-cli-canal'); if(s) s.value=''; activeCh='all'; renderClientes();})()">Limpar filtro</button></div>` : "";
        const msg = canalFiltro ? `Nenhum cliente via ${escapeHTML(CH[canalFiltro]||canalFiltro)} — limpar filtro?` : "Nenhum cliente encontrado.";
        listEl.innerHTML = `<div class="empty">${msg}${clearBtn}</div>`;
      }
    }
    observeClientesSentinel();
    return;
  }

  const cc={}; allOrders.forEach(o=>{ const c=detectCh(o); cc[c]=(cc[c]||0)+1; });
  const pills=[{id:"all",l:"Todos",n:allOrders.length},...["cnpj","shopify","ml","shopee","amazon","yampi","outros"].filter(c=>cc[c]).map(c=>({id:c,l:CH[c]||c,n:cc[c]}))];
  document.getElementById("ch-pills-cli").innerHTML=pills.map(p=>`<div class="ch-pill ${p.id} ${activeCh===p.id?"active":""}" onclick="setChCli('${p.id}')">${p.l} <strong>${p.n}</strong></div>`).join("");

  const filt=allOrders.filter(o=>{
    if(activeCh!=="all"&&detectCh(o)!==activeCh) return false;
    const ufOrder = String(o?.uf_entrega || o?.contato?.endereco?.uf || o?.contato?.uf || o?.uf || "").toUpperCase().trim();
    if(uf && ufOrder !== uf) return false;
    if(q){ const n=(o.contato?.nome||"").toLowerCase(),e=(o.contato?.email||"").toLowerCase(),t=rawPhone(o.contato?.telefone||""); if(!n.includes(q)&&!e.includes(q)&&!t.includes(q.replace(/\D/g,"")))return false; }
    return true;
  });

  let clis=Object.values(buildCli(filt)).sort((a,b)=>b.orders.reduce((s,o)=>s+val(o),0)-a.orders.reduce((s,o)=>s+val(o),0));

  console.log("[Filtro Clientes]", { busca: q, status: statusFil, segmento: segFil, canal: canalFil || activeCh, uf }, "clientes encontrados:", clis.length);

  const labelEl = document.getElementById("cli-label");
  if(labelEl) labelEl.textContent = isDefaultFilters ? `${clis.length} cliente${clis.length!==1?"s":""}` : `${clis.length} encontrado${clis.length!==1?"s":""}`;
  if(!clis.length){
    const canalFiltro = normCanalKey(canalFil || (activeCh !== "all" ? activeCh : ""));
    const clearBtn = canalFiltro ? `<div style="margin-top:10px"><button class="btn" onclick="(function(){var s=document.getElementById('fil-cli-canal'); if(s) s.value=''; activeCh='all'; renderClientes();})()">Limpar filtro</button></div>` : "";
    const msg = canalFiltro ? `Nenhum cliente via ${escapeHTML(CH[canalFiltro]||canalFiltro)} — limpar filtro?` : "Nenhum cliente encontrado.";
    document.getElementById("client-list").innerHTML = `<div class="empty">${msg}${clearBtn}</div>`;
    return;
  }
  document.getElementById("client-list").innerHTML=clis.map((c,i)=>renderCliCard(c,"cl"+i)).join("");
}

function renderCliIntelCard(c, eid){
  const id = escapeJsSingleQuote(String(c?.cliente_id || c?.id || ""));
  const nome = String(c?.nome || "Cliente").trim();
  const canal = String(c?.canal_principal || "outros").toLowerCase().trim() || "outros";
  const status = String(c?.status || "").trim();
  const segmento = String(c?.segmento_crm || "").trim();
  const faixaV = String(c?.faixa_valor || "").trim();
  const faixaF = String(c?.faixa_frequencia || "").trim();
  const pipeline = String(c?.pipeline_stage || "").trim();
  const dias = c?.dias_desde_ultima_compra == null ? null : Number(c.dias_desde_ultima_compra||0);
  const score = Number(c?.score_recompra || 0) || 0;
  const churn = Number(c?.risco_churn || 0) || 0;
  const pedidos = Number(c?.total_pedidos || 0) || 0;
  const ltv = Number(c?.ltv ?? c?.total_gasto ?? 0) || 0;
  const next = String(c?.next_best_action || "").trim();
  const phone = String(c?.celular || c?.telefone || "").replace(/\D/g,"");
  const email = String(c?.email || "").trim();
  const loc = [String(c?.cidade||"").trim(), String(c?.uf||"").trim().toUpperCase()].filter(Boolean).join(" — ");
  const lastIntAt = c?.last_interaction_at ? String(c.last_interaction_at).slice(0,10) : "";
  const lastIntType = String(c?.last_interaction_type || "").trim();
  const lastIntDesc = String(c?.last_interaction_desc || "").trim();
  const respUser = String(c?.responsible_user || "").trim();
  const scoreFinal = c?.score_final == null ? null : (Number(c.score_final||0)||0);
  const mainChClass=/^[a-z0-9_-]+$/i.test(String(canal||""))?String(canal):"outros";
  const isVip = segmento === "VIP" || String(c?.pipeline_stage||"") === "vip";
  const actionHot = (isVip && (dias||0) >= 45) || churn >= 70 || String(c?.pipeline_stage||"") === "reativacao";

  const statusBadge = (()=>{
    if(status === "VIP") return `<span class="badge vip">⭐ VIP</span>`;
    if(status === "Em Risco") return `<span class="badge alerta">⚠️ Em Risco</span>`;
    if(status === "Churn") return `<span class="badge inativo">😴 Churn</span>`;
    if(status === "Recompra") return `<span class="badge ativo">🎯 Recompra</span>`;
    if(status === "Novo Lead") return `<span class="badge novo">🆕 Novo</span>`;
    if(status === "Ativo") return `<span class="badge ativo">✅ Ativo</span>`;
    return status ? `<span class="badge" style="background:rgba(148,163,184,.10);color:var(--text-2);border-color:transparent">${escapeHTML(status)}</span>` : "";
  })();
  const riskBadge = churn >= 70 ? `<span class="badge alerta">⚠️ Crítico</span>` : "";
  const scoreShown = scoreFinal != null ? Number(scoreFinal||0) : score;
  const line2 = `${dias!=null?`${escapeHTML(String(dias))}d sem comprar`:"—"} · ${escapeHTML(String(pedidos))} pedidos`;
  const line3Parts = [];
  if(pipeline) line3Parts.push(`Pipeline ${pipeline}`);
  if(scoreShown != null) line3Parts.push(`Score ${Number(scoreShown||0).toFixed(0)}`);
  if(churn) line3Parts.push(`Risco ${Number(churn||0).toFixed(0)}`);
  const line3 = line3Parts.join(" · ");

  return `<div class="client-card" id="${eid}">
    <div class="client-head" onclick="openClientePage('${id}')">
      <div>
        <div class="client-name-row" style="align-items:flex-start">
          <span class="client-name client-name-hero">${escapeHTML(nome)}</span>
        </div>
        <div class="client-meta" style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${statusBadge}
          ${riskBadge}
          <span style="font-size:11px;color:var(--text-3);font-weight:600">${line2}</span>
        </div>
        <div class="client-meta" style="margin-top:6px;font-size:10px;color:var(--text-3)">${escapeHTML(line3 || (loc||"—"))}</div>
      </div>
      <div class="client-right">
        <div class="client-total">${fmtBRL(ltv)}</div>
        <div class="client-count" style="opacity:.75">${escapeHTML(CH[canal]||canal)}</div>
      </div>
    </div>
    ${(phone||email)?`<div class="contact-bar" onclick="event.stopPropagation()">
      <div class="contact-info">
        ${phone?`<span>📱 ${escapeHTML(fmtPhone(phone))}</span>`:""}
        ${email?`<span>✉️ ${escapeHTML(email)}</span>`:""}
      </div>
      <div class="contact-actions">
        ${phone?`<a class="btn-wa" href="#" onclick="openWa('${escapeJsSingleQuote(phone)}','${escapeJsSingleQuote(nome)}','');return false;">💬 WA</a>`:""}
        ${email?`<a class="btn-email" href="mailto:${encodeURIComponent(email)}">✉️</a>`:""}
      </div>
    </div>`:""}
  </div>`;
}

function openClientePage(clienteId){
  const raw = String(clienteId||"").trim();
  hydrateClienteInfoFromSupabase(raw);
  const mapped = clienteKeyToUuid?.[raw] || raw;
  currentClienteId = mapped;
  showPage("cliente");
}

function backToClientes(){
  currentClienteId = null;
  showPage("clientes");
}

function clienteWhatsApp(){
  if(!currentClienteId){ toast("⚠ Cliente não selecionado"); return; }
  openWaModal(currentClienteId);
}

function clienteAddTask(){
  const c = allCustomers.find(x=>x.id===currentClienteId);
  if(!c){ toast("⚠ Cliente não encontrado"); return; }
  openTaskModal(null, c.nome||"Cliente", currentClienteId);
}

function clienteAddNote(){
  if(!currentClienteId){ toast("⚠ Cliente não selecionado"); return; }
  openInteractionModal(currentClienteId, "nota");
}

function clienteAddNegotiation(){
  if(!currentClienteId){ toast("⚠ Cliente não selecionado"); return; }
  openInteractionModal(currentClienteId, "negociacao_registrada");
}

function summarizeOrderItemsMini(o){
  const itens = getPedidoItens(o);
  if(!itens.length) return "—";
  const parts = itens
    .map(it=>{
      const name = String(it?.descricao || it?.codigo || "").trim();
      const qty = Number(it?.quantidade ?? it?.quantity ?? 0) || 0;
      if(!name) return "";
      return qty > 1 ? `${name} x${qty}` : name;
    })
    .filter(Boolean);
  if(!parts.length) return "—";
  const head = parts.slice(0,2).join(", ");
  return parts.length > 2 ? `${head} +${parts.length-2}` : head;
}

function openCRMOrderDrawer(orderKey){
  const o = allOrders.find(x=>String(x.id||x.numero||"")===String(orderKey)) || allOrders.find(x=>String(x.numero||"")===String(orderKey));
  if(!o) return;
  const st = normSt(o.situacao);
  const ch = detectCh(o);
  const items = getPedidoItens(o);
  const total = fmtBRL(val(o));
  const bodyHTML = `
    <div class="drawer-section">
      <div class="drawer-section-title">Pedido</div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Número</span><span class="chiva-table-mono">#${escapeHTML(String(o.numero||o.id||"—"))}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Data</span><span>${escapeHTML(fmtDate(o.data))}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Canal</span><span>${escapeHTML(CH[ch]||ch)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Status</span><span><span class="sp ${ST_CLASS[st]||"s-outros"}">${escapeHTML(ST_LABEL[st]||st)}</span></span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px"><span style="color:var(--text-3)">Total</span><span style="font-size:15px;font-weight:800;color:var(--green)">${escapeHTML(total)}</span></div>
    </div>
    <div class="drawer-section">
      <div class="drawer-section-title">Itens</div>
      ${items.length ? items.map(it=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span>${escapeHTML(String(it?.descricao||it?.codigo||"—"))}</span><span style="font-family:var(--mono)">${escapeHTML(String(it?.quantidade ?? 1))}×</span></div>`).join("") : `<div style="font-size:12px;color:var(--text-3);padding:8px 0">Nenhum item disponível.</div>`}
    </div>
  `;
  openDrawer(`Pedido #${String(o.numero||o.id||"—")}`, fmtDate(o.data), bodyHTML, `<button class="drawer-btn drawer-btn-ghost" onclick="closeDrawer()">Fechar</button>`);
}

function renderClientePage(){
  const c = allCustomers.find(x=>x.id===currentClienteId);
  const infoEl = document.getElementById("cliente-info");
  const metricsEl = document.getElementById("cliente-metrics");
  const histEl = document.getElementById("cliente-history");
  if(!infoEl || !metricsEl || !histEl) return;
  if(!c){
    infoEl.innerHTML = `<div class="modern-empty-state"><div class="mes-icon">👤</div><div class="mes-title">Cliente não encontrado</div><div class="mes-desc">Volte para a lista e selecione novamente.</div></div>`;
    metricsEl.innerHTML = "";
    histEl.innerHTML = "";
    return;
  }

  // Tentar buscar dados mais completos do meta cache ou do banco
  const meta = cliMetaCache?.[c.id] || {};
  const orders = allOrders
    .filter(o=>orderCustomerKey(o)===c.id)
    .slice()
    .sort((a,b)=>new Date(b.data||0)-new Date(a.data||0));

  const total = orders.reduce((s,o)=>s+val(o),0);
  const n = orders.length;
  const ticket = n ? total/n : 0;
  const last = orders[0]?.data || c.last || null;
  const first = orders[orders.length-1]?.data || c.first || null;
  const ds = daysSince(last);
  const avgInterval = calcCliScores(c).avgInterval;
  
  // Enriquecer dados do cliente com o primeiro pedido se estiverem faltando
  const firstOrder = orders[orders.length-1] || {};
  const enriched = (()=>{
    const nome = cleanText(c.nome || firstOrder.contato?.nome || "");
    const telefone = cleanPhoneDigits(c.telefone || firstOrder.contato?.telefone || firstOrder.contato?.celular || "");
    const email = cleanEmail(c.email || firstOrder.contato?.email || "");
    const doc = cleanDocDigits(c.doc || firstOrder.contato?.cpfCnpj || firstOrder.contato?.numeroDocumento || "");
    const cidade = cleanText(c.cidade || firstOrder.contato?.endereco?.municipio || "");
    const uf = normalizeUF(c.uf || firstOrder.contato?.endereco?.uf || "");
    const cep = cleanCepDigits(c.cep || firstOrder.contato?.endereco?.cep || "");
    return { nome, telefone, email, doc, cidade, uf, cep };
  })();

  try{
    console.groupCollapsed("cliente carregado na tela");
    console.log("currentClienteId:", currentClienteId);
    console.log("cliente carregado na tela:", c);
    console.log("orders:", orders.length, orders[0] || null);
    console.log("firstOrder:", firstOrder || null);
    console.log("firstOrder.contato:", firstOrder?.contato || null);
    console.log("firstOrder.contato.endereco:", firstOrder?.contato?.endereco || null);
    console.log("enriched:", enriched);
    console.groupEnd();
  }catch(_e){}

  const loc = [enriched.cidade, enriched.uf].filter(Boolean).join(" — ");

  const titleEl = document.getElementById("cliente-title");
  const subEl = document.getElementById("cliente-sub");
  if(titleEl) titleEl.textContent = enriched.nome || "Cliente";
  
  const stageLabel = {
    novo_lead: "Novo lead",
    contato_iniciado: "Contato iniciado",
    negociacao: "Negociação",
    pedido_criado: "Pedido criado",
    fechado: "Fechado"
  }[meta.pipeline_stage] || null;
  
  const lastInt = meta.last_interaction_at ? fmtDate(String(meta.last_interaction_at).slice(0,10)) : null;
  const subParts = [
    c.status || "",
    stageLabel ? `Pipeline: ${stageLabel}` : "",
    loc || "—",
    lastInt ? `Última interação: ${lastInt}` : ""
  ].filter(Boolean);
  if(subEl) subEl.textContent = subParts.join(" · ");

  infoEl.innerHTML = `
    <div class="profile-h2">Informações</div>
    <div class="profile-row"><span style="color:var(--text-3)">Nome</span><span>${escapeHTML(enriched.nome||"—")}</span></div>
    <div class="profile-row"><span style="color:var(--text-3)">Documento</span><span>${escapeHTML(enriched.doc ? fmtDoc(enriched.doc) : "—")}</span></div>
    <div class="profile-row"><span style="color:var(--text-3)">Telefone</span><span>${escapeHTML(enriched.telefone ? fmtPhone(enriched.telefone) : "—")}</span></div>
    <div class="profile-row"><span style="color:var(--text-3)">Email</span><span>${escapeHTML(enriched.email||"—")}</span></div>
    <div class="profile-row"><span style="color:var(--text-3)">Cidade</span><span>${escapeHTML(loc||"—")}</span></div>
    <div class="profile-row"><span style="color:var(--text-3)">CEP</span><span>${escapeHTML(enriched.cep||"—")}</span></div>
    <div class="profile-row"><span style="color:var(--text-3)">Primeiro pedido</span><span>${escapeHTML(fmtDate(first))}</span></div>
  `;

  metricsEl.innerHTML = `
    <div class="profile-h2">Métricas</div>
    <div class="profile-kpi-grid">
      <div class="profile-kpi"><div class="profile-kpi-label">Total gasto</div><div class="profile-kpi-val">${escapeHTML(fmtBRL(total))}</div></div>
      <div class="profile-kpi"><div class="profile-kpi-label">Pedidos</div><div class="profile-kpi-val">${escapeHTML(String(n))}</div></div>
      <div class="profile-kpi"><div class="profile-kpi-label">Ticket médio</div><div class="profile-kpi-val">${escapeHTML(fmtBRL(ticket))}</div></div>
      <div class="profile-kpi"><div class="profile-kpi-label">Última compra</div><div class="profile-kpi-val">${escapeHTML(fmtDate(last))}</div></div>
      <div class="profile-kpi"><div class="profile-kpi-label">Dias sem comprar</div><div class="profile-kpi-val">${escapeHTML(String(ds))}</div></div>
      <div class="profile-kpi"><div class="profile-kpi-label">Intervalo médio</div><div class="profile-kpi-val">${escapeHTML(avgInterval ? (avgInterval+"d") : "—")}</div></div>
    </div>
  `;

  const chAgg = {};
  const prodAgg = {};
  orders.forEach(o=>{
    const ch = detectCh(o);
    chAgg[ch] = chAgg[ch] || { total:0, n:0 };
    chAgg[ch].n += 1;
    chAgg[ch].total += val(o);
    const itens = getPedidoItens(o);
    itens.forEach(it=>{
      const key = String(it?.codigo||it?.descricao||"—");
      if(!prodAgg[key]) prodAgg[key] = { nome: it?.descricao||key, qty:0, total:0 };
      const qty = Number(it?.quantidade||1) || 1;
      const price = Number(it?.valor||0) || 0;
      prodAgg[key].qty += qty;
      prodAgg[key].total += qty*price;
    });
  });
  const topCh = Object.entries(chAgg).sort((a,b)=>b[1].total-a[1].total).slice(0,3).map(([ch,v])=>`${CH[ch]||ch} (${v.n})`).join(" · ");
  const topProd = Object.values(prodAgg).sort((a,b)=>b.total-a.total).slice(0,5).map(p=>p.nome).join(", ");

  histEl.innerHTML = `
    <div class="profile-h2">Histórico</div>
    <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">${escapeHTML(topCh||"—")}<span>${topProd ? " · " + escapeHTML(topProd) : ""}</span></div>
    <div style="margin-bottom:14px;padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--card)">
      <div class="profile-h2" style="margin-bottom:8px">Timeline de interações</div>
      <div id="cliente-timeline">
        <div style="font-size:12px;color:var(--text-3);padding:8px 0">Carregando...</div>
      </div>
    </div>
    ${orders.length ? `<div class="profile-orders">${orders.map(o=>{
      const st = normSt(o.situacao);
      const ch = detectCh(o);
      const items = summarizeOrderItemsMini(o);
      return `<div class="profile-order" onclick="openCRMOrderDrawer('${escapeJsSingleQuote(String(o.id||o.numero||""))}')">
        <div class="profile-order-top">
          <div>
            <div class="profile-order-num">#${escapeHTML(String(o.numero||o.id||"—"))}</div>
            <div class="profile-order-sub">${escapeHTML(fmtDate(o.data))} · ${escapeHTML(CH[ch]||ch)} · <span class="sp ${ST_CLASS[st]||"s-outros"}">${escapeHTML(ST_LABEL[st]||st)}</span></div>
          </div>
          <div class="profile-order-num" style="color:var(--green)">${escapeHTML(fmtBRL(val(o)))}</div>
        </div>
        <div class="profile-order-items">${escapeHTML(items)}</div>
      </div>`;
    }).join("")}</div>` : `<div class="empty">Nenhum pedido para este cliente.</div>`}
  `;
  renderClienteTimeline(currentClienteId).catch(()=>{});
  hydrateClienteInfoFromSupabase(currentClienteId);
}

const clienteInfoHydrateInFlight = new Set();
const clienteInfoHydrateDone = new Set();
const clienteKeyToUuid = {};
function hydrateClienteInfoFromSupabase(customerKey){
  if(!supaConnected || !supaClient) return;
  const key = String(customerKey||"").trim();
  if(!key) return;
  if(clienteInfoHydrateDone.has(key) || clienteInfoHydrateInFlight.has(key)) return;
  clienteInfoHydrateInFlight.add(key);
  (async()=>{
    const digits = key.replace(/\D/g,"");
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
    const isEmail = key.includes("@");
    let q = supaClient.from("v2_clientes").select("*").limit(1);
    if(isUuid) q = q.eq("id", key);
    else if(digits.length===11 || digits.length===14) q = q.eq("doc", digits);
    else if(isEmail) q = q.ilike("email", key.toLowerCase());
    else if(digits.length>=10) q = q.eq("telefone", digits);
    else q = q.ilike("nome", key);
    const {data, error} = await q.maybeSingle();
    if(error){
      console.log("cliente v2_clientes (lookup) error:", error);
      return;
    }
    if(!data){
      console.log("cliente v2_clientes (lookup): não encontrado para", key);
      return;
    }
    const uuid = String(data.id||"").trim();
    if(uuid) clienteKeyToUuid[key] = uuid;

    const doc = cleanDocDigits(data.doc || "");
    const email = cleanEmail(data.email || "");
    const tel = cleanPhoneDigits(data.telefone || data.celular || "");
    const cidade = cleanText(data.cidade || "");
    const uf = normalizeUF(data.uf || "");
    const cep = cleanCepDigits(data.cep || "");

    const ensureCustomer = (id)=>{
      const existing = allCustomers.find(x=>String(x.id||"")===String(id));
      if(existing) return existing;
      const created = {
        id: String(id),
        nome: "",
        doc: "",
        email: "",
        telefone: "",
        cidade: "",
        uf: "",
        cep: "",
        orders: [],
        channels: new Set(),
        last: null,
        first: null,
        total_gasto: 0,
        status: "",
        canal_principal: ""
      };
      allCustomers.push(created);
      return created;
    };

    const cUuid = uuid ? ensureCustomer(uuid) : null;
    const cKey = ensureCustomer(key);
    [cKey, cUuid].filter(Boolean).forEach(c=>{
      if(doc) c.doc = doc;
      if(email) c.email = email;
      if(tel) c.telefone = tel;
      if(cidade) c.cidade = cidade;
      if(uf) c.uf = uf;
      if(cep) c.cep = cep;
      if(cleanText(data.nome)) c.nome = cleanText(data.nome);
    });

    if(currentClienteId === key && uuid) currentClienteId = uuid;
    clienteInfoHydrateDone.add(key);
    renderClientePage();
  })().finally(()=>{
    clienteInfoHydrateInFlight.delete(key);
    clienteInfoHydrateDone.add(key);
  });
}

async function renderClienteTimeline(customerKey){
  const host = document.getElementById("cliente-timeline");
  if(!host) return;
  if(!supaConnected || !supaClient){
    host.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:8px 0">Conecte o Supabase para ver interações.</div>`;
    return;
  }
  const uuid = await resolveCustomerUuid(customerKey);
  if(!uuid){
    host.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:8px 0">Não foi possível vincular o cliente ao Supabase.</div>`;
    return;
  }
  try{
    const {data, error} = await supaClient
      .from("interactions")
      .select("id,type,description,created_at,user_responsible,source")
      .eq("customer_id", uuid)
      .order("created_at",{ascending:false})
      .limit(80);
    if(error) throw error;
    const rows = (Array.isArray(data) ? data : []).filter(r => String(r?.type || "") !== "ligacao");
    if(!rows.length){
      host.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:8px 0">Nenhuma interação registrada ainda.</div>`;
      return;
    }
    const typeBucket = (t)=>{
      const tt = String(t||"");
      if(tt==="mensagem_enviada" || tt==="mensagem_recebida") return "whatsapp";
      if(tt==="tarefa_criada" || tt==="tarefa_concluida") return "tarefa";
      if(tt==="negociacao_registrada") return "negociação";
      if(tt==="pedido_criado" || tt==="pagamento_confirmado" || tt==="status_pedido_atualizado") return "pedido";
      if(tt==="nota") return "nota";
      return tt || "interação";
    };
    const bucketLabel = {
      whatsapp: "WhatsApp",
      tarefa: "Tarefa",
      "negociação": "Negociação",
      pedido: "Pedido",
      nota: "Nota"
    };
    const typeLabel = (t)=>{
      const tt = String(t||"");
      if(tt==="mensagem_enviada") return "WhatsApp (enviado)";
      if(tt==="mensagem_recebida") return "WhatsApp (recebido)";
      if(tt==="tarefa_criada") return "Tarefa criada";
      if(tt==="tarefa_concluida") return "Tarefa concluída";
      if(tt==="negociacao_registrada") return "Negociação";
      if(tt==="pedido_criado") return "Pedido criado";
      if(tt==="pagamento_confirmado") return "Pagamento confirmado";
      if(tt==="status_pedido_atualizado") return "Status do pedido";
      if(tt==="nota") return "Nota";
      return tt || "Interação";
    };
    host.innerHTML = `<div class="timeline">${rows.map(r=>{
      const d = new Date(r.created_at);
      const time = isNaN(d) ? "—" : d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
      const tl = typeLabel(r.type);
      const bucket = typeBucket(r.type);
      const bucketTitle = bucketLabel[bucket] || bucket || "Interação";
      const who = r.user_responsible ? `${escapeHTML(String(r.user_responsible))}` : "—";
      const desc = r.description ? escapeHTML(String(r.description)) : "";
      return `
        <div class="timeline-item">
          <div class="timeline-time">${escapeHTML(time)}</div>
          <div class="timeline-body">
            <div class="timeline-title">${escapeHTML(bucketTitle)}</div>
            <div class="timeline-sub">${escapeHTML(tl)} · ${who}</div>
            ${desc ? `<div class="timeline-desc">${desc}</div>` : ``}
          </div>
        </div>
      `;
    }).join("")}</div>`;
  }catch(_e){
    host.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:8px 0">Timeline indisponível.</div>`;
  }
}

function openInteractionModal(customerId, type){
  const c = allCustomers.find(x=>x.id===customerId);
  const nm = c?.nome || "Cliente";
  let t = String(type||"nota");
  if(t === "ligacao") t = "nota";
  const title = t==="nota" ? "📝 Adicionar nota" : t==="negociacao_registrada" ? "🤝 Registrar negociação" : "➕ Interação";
  const html=`
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:600;display:flex;align-items:center;justify-content:center;padding:16px" id="int-modal-overlay">
      <div style="background:var(--surface);border-radius:16px;padding:20px;width:100%;max-width:420px;border:1px solid var(--border)">
        <div style="font-size:14px;font-weight:800;margin-bottom:6px">${escapeHTML(title)}</div>
        <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">${escapeHTML(nm)}</div>
        <input type="hidden" id="im-customer" value="${escapeHTML(String(customerId))}"/>
        <select id="im-type" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:12px;margin-bottom:8px">
          <option value="nota" ${t==="nota"?"selected":""}>📝 Nota</option>
          <option value="negociacao_registrada" ${t==="negociacao_registrada"?"selected":""}>🤝 Negociação</option>
        </select>
        <textarea id="im-desc" placeholder="Descrição" rows="3"
          style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:12px;margin-bottom:14px;box-sizing:border-box;resize:none;font-family:inherit"></textarea>
        <div style="display:flex;gap:8px">
          <button onclick="document.getElementById('int-modal-overlay').remove()"
            style="flex:1;padding:10px;background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;cursor:pointer;font-family:inherit">Cancelar</button>
          <button onclick="saveInteraction()"
            style="flex:1;padding:10px;background:linear-gradient(135deg,var(--chiva-primary),var(--chiva-primary-light));border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit">Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", html);
}

async function saveInteraction(){
  const overlay = document.getElementById("int-modal-overlay");
  const customerId = document.getElementById("im-customer")?.value || "";
  const type = document.getElementById("im-type")?.value || "nota";
  const desc = document.getElementById("im-desc")?.value?.trim() || "";
  if(!desc){ toast("⚠ Descrição obrigatória"); return; }
  await logInteraction(customerId, type, desc, { manual: true });
  overlay?.remove();
  if(document.getElementById("page-cliente")?.classList.contains("active")) renderClienteTimeline(customerId).catch(()=>{});
  if(document.getElementById("page-oportunidades")?.classList.contains("active")) renderOportunidades();
  toast("✅ Interação salva!");
}

function renderCliCard(c,eid){
  const scores=calcCliScores(c);
  const meta=cliMeta[c.id]||{};
  const chs=[...c.channels];
  const chSpend={};
  c.orders.forEach(o=>{ const ch=detectCh(o); chSpend[ch]=(chSpend[ch]||0)+val(o); });
  const mainCh=Object.entries(chSpend).sort((a,b)=>b[1]-a[1])[0]?.[0]||chs[0]||"outros";
  const loc=[c.cidade,c.uf].filter(Boolean).join(" — ");
  const phoneRaw=rawPhone(c.telefone);
  const safeNote=escapeHTML(meta.notes||"");
  const safeId=escapeJsSingleQuote(c.id);
  const safeName=escapeJsSingleQuote(c.nome);
  const nameHtml=escapeHTML(c.nome||"");
  const locHtml=escapeHTML(loc);
  const emailText=escapeHTML(c.email||"");
  const mailtoHref="mailto:"+encodeURIComponent(String(c.email||""));
  const mainChClass=/^[a-z0-9_-]+$/i.test(String(mainCh||""))?String(mainCh):"outros";

  const sBadge={vip:`<span class="badge vip">⭐ VIP</span>`,inativo:`<span class="badge inativo">😴 Inativo</span>`,ativo:`<span class="badge ativo">✅ Ativo</span>`,alerta:`<span class="badge alerta">⚠️</span>`,novo:`<span class="badge novo">🆕 Novo</span>`,cnpj:`<span class="badge cnpj">🏢 CNPJ</span>`}[scores.status]||"";

  const scoreColor=(s)=>s>70?"var(--green)":s>40?"var(--amber)":"var(--red)";
  const churnColor=(s)=>s>60?"var(--red)":s>30?"var(--amber)":"var(--green)";

  const contactBar=(c.telefone||c.email)?`<div class="contact-bar" onclick="event.stopPropagation()">
    <div class="contact-info">
      ${c.telefone?`<span>📱 ${escapeHTML(fmtPhone(c.telefone))}</span>`:""}
      ${c.email?`<span>✉️ ${emailText}</span>`:""}
      ${loc?`<span>📍 ${locHtml}</span>`:""}
    </div>
    <div class="contact-actions">
      ${phoneRaw?`<a class="btn-wa" href="#" onclick="openWa('${phoneRaw}','${safeName}','${scores.status}');return false;">💬 WA</a>`:""}
      ${c.email?`<a class="btn-email" href="${mailtoHref}">✉️</a>`:""}
    </div>
  </div>`:"";

  const avgInt=scores.avgInterval?`cada ${scores.avgInterval}d`:"";

  return`<div class="client-card" id="${eid}">
    <div class="client-head" onclick="openClientePage('${safeId}')">
      <div>
        <div class="client-name-row">
          <span class="client-name client-name-hero">${nameHtml}</span>
          <span class="badge cli-channel-flag ${mainChClass}">${escapeHTML(CH[mainCh]||mainCh)}</span>
          ${sBadge}
          ${scores.proximoRecompra?`<span class="badge-hint recompra">🎯 Recompra</span>`:""}
          ${scores.riscoChurnInterval?`<span class="badge-hint churn">⚠️ Churn</span>`:""}
        </div>
        <div class="client-meta">${c.doc?escapeHTML(fmtDoc(c.doc))+"  ":""}${scores.avgInterval?"a cada "+scores.avgInterval+"d · ":""}${scores.ds<9999?scores.ds+"d sem comprar":""} ${avgInt}</div>
      </div>
      <div class="client-right">
        <div class="client-total">${fmtBRL(scores.ltv)}</div>
        <div class="client-count">${scores.n} ped.<span class="chevron">▾</span></div>
      </div>
    </div>
    <div class="client-body">
      <div class="score-bar-wrap">
        <span class="score-label">Score Recompra</span>
        <div class="score-track"><div class="score-fill" style="width:${scores.recompraScore}%;background:${scoreColor(scores.recompraScore)}"></div></div>
        <span class="score-num" style="color:${scoreColor(scores.recompraScore)}">${scores.recompraScore}</span>
      </div>
      <div class="score-bar-wrap">
        <span class="score-label">Risco de Churn</span>
        <div class="score-track"><div class="score-fill" style="width:${scores.churnRisk}%;background:${churnColor(scores.churnRisk)}"></div></div>
        <span class="score-num" style="color:${churnColor(scores.churnRisk)}">${scores.churnRisk}</span>
      </div>
      <div class="cli-marketing" onclick="event.stopPropagation()">
        <div class="cli-marketing-title">Ações de Marketing</div>
        <div class="cli-marketing-bar">
          <button class="btn-wa-campaign" onclick="event.stopPropagation();openWaModal('${safeId}')">📱 Disparar Campanha (WhatsApp)</button>
          <button class="btn-ai-suggest" onclick="event.stopPropagation();gerarMensagemIA('${safeId}','recompra')">🤖 Sugerir Mensagem com IA</button>
        </div>
      </div>
      ${contactBar}
      <div class="client-badges client-badges-body" onclick="event.stopPropagation()">${chs.map(ch=>`<span class="badge ${ch}">${escapeHTML(CH[ch]||ch)}</span>`).join("")}${c.telefone?`<span class="client-icon-hint">📱</span>`:""}${c.email?`<span class="client-icon-hint">✉️</span>`:""}</div>
      <div class="notes-bar" onclick="event.stopPropagation()">
        <select class="status-sel" onchange="saveCliStatus('${safeId}',this.value)">
          <option value="">Auto</option>
          <option value="vip"    ${meta.status==="vip"?"selected":""}>⭐ VIP</option>
          <option value="ativo"  ${meta.status==="ativo"?"selected":""}>✅ Ativo</option>
          <option value="inativo"${meta.status==="inativo"?"selected":""}>😴 Inativo</option>
          <option value="alerta" ${meta.status==="alerta"?"selected":""}>⚠️ Alerta</option>
        </select>
        <input class="note-inp" id="ni-${eid}" placeholder="Anotação..." value="${safeNote}"/>
        <button class="btn-note" onclick="saveNote('${safeId}','ni-${eid}')">💾</button>
        <button class="btn-task" onclick="openTaskModal(null,'${safeName}')">+ Tarefa</button>
      </div>
      <div class="order-head-row"><span>Pedido</span><span>Data</span><span style="text-align:right">Valor</span><span>Status</span><span>Canal</span></div>
      ${c.orders.map(o=>{ const ch=detectCh(o),st=normSt(o.situacao); return`<div class="order-row"><span class="order-num">#${escapeHTML(o.numero||o.id)}</span><span>${escapeHTML(fmtDate(o.data))}</span><span class="order-val" style="color:var(--green)">${fmtBRL(val(o))}</span><span><span class="sp ${ST_CLASS[st]||"s-outros"}">${escapeHTML(ST_LABEL[st]||st)}</span></span><span><span class="badge ${ch}">${escapeHTML(CH[ch]||ch)}</span></span></div>`; }).join("")}
    </div>
  </div>`;
}

const OPP_STAGES = [
  { id: "novo_lead", label: "Novo lead" },
  { id: "contato_iniciado", label: "Contato iniciado" },
  { id: "negociacao", label: "Negociação" },
  { id: "pedido_criado", label: "Pedido criado" },
  { id: "fechado", label: "Fechado" }
];

let oppRemoteLimit = 600;
const OPP_REMOTE_PAGE_STEP = 600;

let radarOppFilters = safeJsonParse("crm_radar_filters", { visitou:false, visitou_quente:false, visitou_frio:false, vip:false, churn:false, recompra:false, alto_valor:false, dias30:false, carrinho:false });
let radarOppLastModel = null;

function saveRadarOppFilters(){
  try{ localStorage.setItem("crm_radar_filters", JSON.stringify(radarOppFilters||{})); }catch(_e){}
}

function radarToggleOppFilter(key){
  if(!radarOppFilters || typeof radarOppFilters !== "object") radarOppFilters = { visitou:false, visitou_quente:false, visitou_frio:false, vip:false, churn:false, recompra:false, alto_valor:false, dias30:false, carrinho:false };
  const k = String(key||"").trim();
  if(!k) return;
  if(k === "todos"){
    radarOppFilters = { visitou:false, visitou_quente:false, visitou_frio:false, vip:false, churn:false, recompra:false, alto_valor:false, dias30:false, carrinho:false };
  }else{
    radarOppFilters[k] = !radarOppFilters[k];
  }
  saveRadarOppFilters();
  renderOportunidades();
}

function saveOppPipeline(){
  localStorage.setItem("crm_opp_pipeline", JSON.stringify(oppPipeline || []));
}

function seedOppPipeline(){
  if(!Array.isArray(oppPipeline)) oppPipeline = [];
  const byKey = new Set(oppPipeline.map(o=>`${o.cliente_id}::${o.title}`));

  const clis = Object.values(buildCli(allOrders))
    .map(c=>({ c, s: calcCliScores(c) }))
    .filter(x=>x.c && x.c.id);

  const vipDorm = clis
    .filter(x=>x.s.status==="vip" && x.s.ds>=45)
    .sort((a,b)=>b.s.ds-a.s.ds)
    .slice(0,8)
    .map(x=>({
      cliente_id: x.c.id,
      title: "Reativação VIP",
      value: x.s.ltv,
      hint: `${x.s.ds}d sem comprar`
    }));

  const churnHigh = clis
    .filter(x=>x.s.status!=="cnpj" && x.s.churnRisk>=70)
    .sort((a,b)=>b.s.churnRisk-a.s.churnRisk)
    .slice(0,10)
    .map(x=>({
      cliente_id: x.c.id,
      title: "Risco de churn",
      value: x.s.ltv,
      hint: `risco ${x.s.churnRisk}%`
    }));

  const rebuySoon = clis
    .filter(x=>x.s.status!=="cnpj" && x.s.recompraScore>=70 && x.s.avgInterval && x.s.ds >= Math.max(7, x.s.avgInterval-3))
    .sort((a,b)=>(b.s.recompraScore*100-b.s.ds)-(a.s.recompraScore*100-a.s.ds))
    .slice(0,10)
    .map(x=>({
      cliente_id: x.c.id,
      title: "Recompra provável",
      value: x.s.ltv,
      hint: `${x.s.ds}d · intervalo ${x.s.avgInterval}d`
    }));

  const pick = [...vipDorm, ...churnHigh, ...rebuySoon].slice(0,18);
  pick.forEach(p=>{
    const key = `${p.cliente_id}::${p.title}`;
    if(byKey.has(key)) return;
    byKey.add(key);
    oppPipeline.push({
      id: "opp_"+Date.now()+"_"+Math.random().toString(16).slice(2),
      stage: "novo_lead",
      cliente_id: p.cliente_id,
      title: p.title,
      value: p.value || 0,
      hint: p.hint || "",
      created_at: new Date().toISOString(),
      last_interaction: ""
    });
  });
  saveOppPipeline();
}

function addOpportunity(){
  const name = prompt("Cliente (nome ou email):","");
  if(name === null) return;
  const title = prompt("Oportunidade (ex: Kit, Assinatura, Reativação):","Oportunidade");
  if(title === null) return;
  const valStr = prompt("Valor potencial (R$):","0");
  if(valStr === null) return;
  const value = Number(String(valStr).replace(/[^\d,.-]/g,"").replace(",", ".")) || 0;

  const q = String(name||"").trim().toLowerCase();
  const c = allCustomers.find(x=>(x.nome||"").toLowerCase().includes(q) || (x.email||"").toLowerCase().includes(q));
  if(!c){ toast("⚠ Cliente não encontrado"); return; }

  if(!Array.isArray(oppPipeline)) oppPipeline = [];
  oppPipeline.unshift({
    id: "opp_"+Date.now()+"_"+Math.random().toString(16).slice(2),
    stage: "novo_lead",
    cliente_id: c.id,
    title: String(title||"Oportunidade").trim() || "Oportunidade",
    value,
    hint: "",
    created_at: new Date().toISOString(),
    last_interaction: ""
  });
  saveOppPipeline();
  renderOportunidades();
}

async function renderOportunidadesFromSupabase(){
  const kpisEl = document.getElementById("radar-kpis");
  const chipsEl = document.getElementById("radar-chips");
  const groupsEl = document.getElementById("radar-groups");
  if(!kpisEl || !chipsEl || !groupsEl) return;

  if(!supaConnected || !supaClient){
    groupsEl.innerHTML = `<div class="empty">Conecte o Supabase para ver o radar em tempo real.</div>`;
    return null;
  }

  const q = String(document.getElementById("radar-q")?.value || "").trim().toLowerCase();
  if(!radarOppFilters || typeof radarOppFilters !== "object") radarOppFilters = { visitou:false, visitou_quente:false, visitou_frio:false, vip:false, churn:false, recompra:false, alto_valor:false, dias30:false, carrinho:false };

  const chips = [
    { id: "visitou", label: "Visitou" },
    { id: "visitou_quente", label: "Carrinho quente" },
    { id: "visitou_frio", label: "Visitou frio" },
    { id: "vip", label: "VIP" },
    { id: "churn", label: "Churn" },
    { id: "recompra", label: "Recompra" },
    { id: "alto_valor", label: "Alto valor" },
    { id: "dias30", label: "30+ dias" },
    { id: "carrinho", label: "Carrinho abandonado" },
    { id: "todos", label: "Todos" },
  ];
  chipsEl.innerHTML = chips.map(c=>{
    const active = c.id==="todos" ? !Object.values(radarOppFilters).some(Boolean) : !!radarOppFilters[c.id];
    return `<button class="radar-chip ${active?"active":""}" onclick="radarToggleOppFilter('${escapeJsSingleQuote(c.id)}')">${escapeHTML(c.label)}</button>`;
  }).join("");

  kpisEl.innerHTML = `
    <div class="radar-kpi"><div class="radar-kpi-label">VIPs em risco</div><div class="radar-kpi-val">—</div></div>
    <div class="radar-kpi"><div class="radar-kpi-label">Carrinhos abandonados</div><div class="radar-kpi-val">—</div></div>
    <div class="radar-kpi"><div class="radar-kpi-label">Clientes 30+ dias</div><div class="radar-kpi-val">—</div></div>
    <div class="radar-kpi"><div class="radar-kpi-label">Novos clientes hoje</div><div class="radar-kpi-val">—</div></div>
  `;

  groupsEl.innerHTML = `<div class="empty">Carregando radar…</div>`;

  try{
    let healthMap = {};
    let intelMap = {};
    try{
      const {data:hRows, error:hErr} = await supaClient
        .from("vw_customer_health_score")
        .select("*")
        .range(0, Math.max(0, oppRemoteLimit - 1));
      if(!hErr && Array.isArray(hRows)){
        hRows.forEach(r=>{
          const id = String(r?.cliente_id || r?.cliente_uuid || r?.id || r?.customer_id || "").trim();
          if(!id) return;
          healthMap[id] = r;
        });
      }
    }catch(_e){}

    if(!Object.keys(healthMap).length){
      try{
        const {data:ciRows, error:ciErr} = await supaClient
          .from("customer_intelligence")
          .select("cliente_id,segmento,next_best_action,score_final,updated_at")
          .limit(5000);
        if(!ciErr && Array.isArray(ciRows)){
          ciRows.forEach(r=>{
            const id = String(r?.cliente_id||"").trim();
            if(!id) return;
            intelMap[id] = {
              segmento: String(r?.segmento||"").trim(),
              next_best_action: String(r?.next_best_action||"").trim(),
              score_final: r?.score_final == null ? null : Number(r.score_final)||0
            };
          });
        }
      }catch(_e){}
    }

    const {data, error} = await supaClient
      .from("v2_clientes")
      .select("*")
      .range(0, Math.max(0, oppRemoteLimit - 1));
    if(error) throw error;
    const rows = Array.isArray(data) ? data : [];
    const segMeta = (seg)=>{
      const s = String(seg||"").trim().toLowerCase();
      if(s === "visitou") return { cls: "seg-visitou", label: "Visitou" };
      if(s === "vip") return { cls: "seg-vip", label: "VIP" };
      if(s === "em risco" || s === "risco") return { cls: "seg-risco", label: "Em Risco" };
      if(s === "churn") return { cls: "seg-churn", label: "Churn" };
      if(s === "novo") return { cls: "seg-novo", label: "Novo" };
      return { cls: "seg-unk", label: (seg||"—") };
    };

    const fallbackNextAction = (seg)=>{
      const s = String(seg||"").trim().toLowerCase();
      if(s === "em risco" || s === "risco") return "Enviar cupom de desconto";
      if(s === "churn") return "Reativar com oferta forte + mensagem pessoal";
      if(s === "vip") return "Oferta VIP: lançamento/kit exclusivo";
      if(s === "novo") return "Boas-vindas + sugestão do best-seller";
      return "Registrar próxima ação";
    };

    const todayIso = new Date().toISOString().slice(0,10);
    const cartsOpen = []
      .concat(carrinhosAbandonados||[])
      .map(normalizeCarrinhoAbandonado)
      .filter(c=>c && c.checkout_id && !c.recuperado);

    const cartByEmail = {};
    cartsOpen.forEach(c=>{
      const em = String(c.email || c.customer_email || "").trim().toLowerCase();
      if(!em) return;
      cartByEmail[em] = (cartByEmail[em]||0) + 1;
    });

    const items = rows.map(r=>{
      const uuid = String(r.id || "").trim();
      const health = healthMap[uuid] || {};
      const intel = intelMap[uuid] || {};
      const key = String(r.doc || r.id || "").trim();
      const nm = String(r.nome || "Cliente").trim();
      const loc = [r.cidade, r.uf].filter(Boolean).join(" — ");
      const resp = String(r.responsible_user || "").trim();
      const localCust = allCustomers.find(c=>String(c.id||"")===key);
      const phone = rawPhone(localCust?.telefone||"");
      const email = String(localCust?.email || r.email || "").trim().toLowerCase();
      const segment = String(health?.segmento || health?.segment || intel?.segmento || r.status || localCust?.status || "").trim();
      const statusSaude = String(health?.status_saude || health?.statusSaude || segment || "").trim();
      const churnRisk = Number(health?.risco_churn ?? health?.churn_risk ?? r.risco_churn ?? 0) || 0;
      const recompraScore = Number(health?.score_recompra ?? health?.recompra_score ?? r.score_recompra ?? intel?.score_final ?? 0) || 0;
      const diasSemComprar = Number(health?.dias_sem_comprar ?? health?.diasSemComprar ?? health?.dias_desde_ultima_compra ?? health?.recencia_dias ?? r.dias_desde_ultima_compra ?? daysSince(health?.ultimo_pedido || r.ultimo_pedido) ?? 0) || 0;
      const totalPedidos = Number(health?.total_pedidos ?? r.total_pedidos ?? 0) || 0;
      const ltv = Number(health?.ltv ?? health?.valor_total ?? health?.total_gasto ?? r.total_gasto ?? 0) || 0;
      const ticket = Number(health?.ticket_medio ?? r.ticket_medio ?? (totalPedidos>0 ? (ltv/totalPedidos) : 0) ) || 0;
      const prob = Math.max(0, Math.min(100, Math.round(recompraScore)));
      const potencial = Math.max(0, ticket) * (prob/100);
      const nextAction = String(health?.next_best_action || health?.nextBestAction || intel.next_best_action || r.next_best_action || fallbackNextAction(segment || statusSaude) || "").trim();
      const primeiro = String(health?.primeiro_pedido || r.primeiro_pedido || "").slice(0,10);
      const cartCount = email ? (cartByEmail[email]||0) : 0;
      const lastInteractionAt = r.last_interaction_at || r.lastInteractionAt || null;
      const lastContactAt = r.last_contact_at || r.lastContactAt || null;
      const lastInteractionType = r.last_interaction_type || r.lastInteractionType || null;
      const lastInteractionDesc = r.last_interaction_desc || r.lastInteractionDesc || null;
      return { uuid, key, nm, loc, resp, phone, email, segment, statusSaude, churnRisk, prob, diasSemComprar, totalPedidos, ltv, ticket, potencial, nextAction, primeiro, cartCount, last_interaction_at: lastInteractionAt, last_contact_at: lastContactAt, last_interaction_type: lastInteractionType, last_interaction_desc: lastInteractionDesc };
    }).filter(x=>x.uuid && x.key);

    const ltvVals = items.map(i=>i.ltv).filter(v=>Number.isFinite(v) && v>0).sort((a,b)=>a-b);
    const p90 = ltvVals.length ? ltvVals[Math.max(0, Math.floor(ltvVals.length*0.9)-1)] : 0;
    const highValueThreshold = Math.max(400, Number(p90)||0);

    const purchasedByEmail = {};
    items.forEach(i=>{
      const em = String(i.email||"").trim().toLowerCase();
      if(!em) return;
      purchasedByEmail[em] = (Number(i.totalPedidos||0) > 0) || (Number(i.ltv||0) > 0);
    });

    const lookupCarr = buildClienteLookupParaCarrinhos();
    const visitouLeads = cartsOpen
      .filter(c=>{
        const em = String(c.email||"").trim().toLowerCase();
        if(!em) return true;
        return purchasedByEmail[em] !== true;
      })
      .map(c=>{
        const cid = String(c.checkout_id||"").trim();
        const calc = calcularScoreRecuperacaoCarrinho(c, lookupCarr);
        const score = c.score_recuperacao == null ? (Number(calc.score||0)||0) : (Number(c.score_recuperacao||0)||0);
        const prio = prioridadePorScore(score);
        const etapa = sugerirEtapaParaCarrinho(c, calc.mins);
        const valor = Number(c.valor||0)||0;
        const nm = String(c.cliente_nome || c.email || "Visitante").trim() || "Visitante";
        const em = String(c.email||"").trim().toLowerCase();
        const phone = rawPhone(c.telefone||"");
        const ds = daysSince(c.criado_em);
        const dias = ds>=9999 ? 0 : ds;
        const acao = etapa?.label ? `Carrinho: ${String(etapa.label)}` : "Recuperar carrinho";
        return {
          kind: "visitou",
          uuid: "visitou:"+cid,
          key: "visitou:"+cid,
          checkoutId: cid,
          nm,
          loc: "",
          resp: "",
          phone,
          email: em,
          segment: "Visitou",
          statusSaude: "Visitou",
          churnRisk: 0,
          prob: Math.max(0, Math.min(100, Math.round(score))),
          diasSemComprar: dias,
          tempoMin: calc.mins,
          prioridade_id: prio.id,
          prioridade_label: prio.label,
          totalPedidos: 0,
          ltv: 0,
          ticket: valor,
          potencial: valor,
          nextAction: acao,
          primeiro: "",
          cartCount: 1,
          cartValue: valor,
          link_finalizacao: c.link_finalizacao || null,
          criado_em: c.criado_em || null,
        };
      })
      .filter(x=>x.checkoutId);

    const allItems = [...visitouLeads, ...items];

    const vipRiskCount = items.filter(i=>String(i.segment||i.statusSaude).toLowerCase()==="vip" && (i.diasSemComprar>=45 || i.churnRisk>=70)).length;
    const cartsCount = cartsOpen.length;
    const d30Count = items.filter(i=>i.diasSemComprar>=30).length;
    const leadsTodayCount = visitouLeads.filter(x=>String(x.criado_em||"").slice(0,10)===todayIso).length;

    kpisEl.innerHTML = `
      <div class="radar-kpi"><div class="radar-kpi-label">VIPs em risco</div><div class="radar-kpi-val">${escapeHTML(String(vipRiskCount))}</div></div>
      <div class="radar-kpi"><div class="radar-kpi-label">Carrinhos abandonados</div><div class="radar-kpi-val">${escapeHTML(String(cartsCount))}</div></div>
      <div class="radar-kpi"><div class="radar-kpi-label">Clientes 30+ dias</div><div class="radar-kpi-val">${escapeHTML(String(d30Count))}</div></div>
      <div class="radar-kpi"><div class="radar-kpi-label">Leads novos hoje</div><div class="radar-kpi-val">${escapeHTML(String(leadsTodayCount))}</div></div>
    `;

    const filtered = allItems.filter(i=>{
      if(q){
        const hay = [i.nm, i.loc, i.resp, i.email].filter(Boolean).join(" ").toLowerCase();
        if(!hay.includes(q)) return false;
      }
      const isLead = i.kind === "visitou";
      const isHotLead = isLead && String(i.prioridade_id||"") === "alta";
      const segLower = String(i.segment||i.statusSaude||"").toLowerCase();
      if(radarOppFilters.visitou && !isLead) return false;
      if(radarOppFilters.visitou_quente && !isHotLead) return false;
      if(radarOppFilters.visitou_frio && (isLead && isHotLead)) return false;
      if(radarOppFilters.visitou_frio && !isLead) return false;
      if(radarOppFilters.vip && (isLead || segLower !== "vip")) return false;
      if(radarOppFilters.churn && (isLead || segLower !== "churn")) return false;
      if(radarOppFilters.recompra && (isLead || !(i.prob>=65 && i.diasSemComprar>=20 && i.diasSemComprar<60))) return false;
      if(radarOppFilters.alto_valor && (isLead || i.ltv < highValueThreshold)) return false;
      if(radarOppFilters.dias30 && (isLead || i.diasSemComprar < 30)) return false;
      if(radarOppFilters.carrinho && i.cartCount <= 0) return false;
      return true;
    });

    const visitou = filtered.filter(i=>i.kind === "visitou");
    const visitouHot = visitou.filter(i=>String(i.prioridade_id||"") === "alta");
    const visitouCold = visitou.filter(i=>String(i.prioridade_id||"") !== "alta");
    const customersOnly = filtered.filter(i=>i.kind !== "visitou");

    const priorityHigh = [];
    const highValue = [];
    const rebuy = [];
    const risk = [];
    const inactive = [];

    customersOnly.forEach(i=>{
      const segLower = String(i.segment||i.statusSaude||"").toLowerCase();
      const isVipRisk = segLower==="vip" && (i.diasSemComprar>=45 || i.churnRisk>=70);
      const isCartHot = i.cartCount>0 && i.diasSemComprar>=7;
      const isProbable = i.prob>=80 && i.diasSemComprar>=30 && i.ltv>0;
      const isRebuy = i.prob>=65 && i.diasSemComprar>=20 && i.diasSemComprar<60 && !isVipRisk;
      const isInactive = i.diasSemComprar>=120;
      const isRisk = !isInactive && (segLower==="churn" || segLower==="em risco" || segLower==="risco" || i.churnRisk>=70 || i.diasSemComprar>=60);
      if(isVipRisk || isCartHot || isProbable) priorityHigh.push(i);
      else if(i.ltv>=highValueThreshold) highValue.push(i);
      else if(isRebuy) rebuy.push(i);
      else if(isRisk) risk.push(i);
      else if(isInactive) inactive.push(i);
    });

    const sortByScore = (a,b)=>(b.prob-a.prob) || (b.potencial-a.potencial) || (b.ltv-a.ltv) || (b.diasSemComprar-a.diasSemComprar);
    priorityHigh.sort(sortByScore);
    highValue.sort((a,b)=>(b.ltv-a.ltv) || sortByScore(a,b));
    rebuy.sort(sortByScore);
    risk.sort((a,b)=>(b.churnRisk-a.churnRisk) || (b.diasSemComprar-a.diasSemComprar) || sortByScore(a,b));
    inactive.sort((a,b)=>(b.diasSemComprar-a.diasSemComprar) || sortByScore(a,b));

    const renderCard = (i)=>{
      if(i.kind === "visitou"){
        const cid = String(i.checkoutId||"").trim();
        const safeCid = escapeJsSingleQuote(cid);
        const seg = segMeta(i.segment || i.statusSaude);
        const prioId = String(i.prioridade_id||"").trim();
        const prioLabel = String(i.prioridade_label||"").trim() || "—";
        const prioIcon = prioId === "alta" ? "🔥" : (prioId === "media" ? "⚡" : "🧊");
        const contato = [i.email||"", i.phone?fmtPhone(i.phone):""].filter(Boolean).join(" · ") || "—";
        const kv = `
          <div class="radar-card-vals">
            <div class="radar-kv">
              <div class="radar-kv-label">POTENCIAL</div>
              <div class="radar-kv-val" style="color:var(--green)">${escapeHTML(fmtBRL(i.potencial||0))}</div>
            </div>
            <div class="radar-kv">
              <div class="radar-kv-label">ÚLTIMA VISITA</div>
              <div class="radar-kv-val">${escapeHTML(String(Math.max(0, Math.round(i.diasSemComprar||0))))}d</div>
            </div>
            <div class="radar-kv">
              <div class="radar-kv-label">CARRINHO</div>
              <div class="radar-kv-val">${escapeHTML(String(cid).slice(0,8))}</div>
            </div>
            <div class="radar-kv">
              <div class="radar-kv-label">CONTATO</div>
              <div class="radar-kv-val" style="font-family:var(--font)">${escapeHTML(contato)}</div>
            </div>
          </div>
        `;
        const prob = `
          <div class="radar-prob">
            <div class="radar-prob-row">
              <div class="radar-prob-label">Probabilidade de recuperação</div>
              <div class="radar-prob-num">${escapeHTML(String(i.prob||0))}%</div>
            </div>
            <div class="radar-prob-track"><div class="radar-prob-fill" style="width:${Math.max(0,Math.min(100,i.prob||0))}%"></div></div>
          </div>
        `;
        const action = `<div class="radar-action">AÇÃO SUGERIDA<br><b>${escapeHTML(i.nextAction || "Recuperar carrinho")}</b></div>`;
        const buttons = `
          <div class="radar-actions" onclick="event.stopPropagation()">
            ${rawPhone(i.phone||"")?`<button class="opp-mini-btn" onclick="openWhatsAppCarrinho('${safeCid}')">WhatsApp</button>`:""}
            ${i.link_finalizacao?`<button class="opp-mini-btn" onclick="openCarrinhoLinkFromRadar('${safeCid}')">Link</button>`:""}
            <button class="opp-mini-btn" onclick="openCarrinhoInComercialFromRadar('${safeCid}')">Abrir</button>
          </div>
        `;
        return `
          <div class="radar-card" onclick="openRadarVisitouDrawer('${safeCid}')">
            <div class="radar-card-top">
              <div style="min-width:0">
                <div class="radar-card-name">${escapeHTML(i.nm||"Visitante")}</div>
                <div class="radar-card-meta">${escapeHTML("Carrinho aberto (sem compra)")}</div>
              </div>
              <div class="opp-badges">
                <span class="seg-badge ${seg.cls}">${escapeHTML(seg.label)}</span>
                <span class="seg-badge" style="border-color:rgba(255,255,255,.10);background:rgba(255,255,255,.04);color:var(--text-2)">${escapeHTML(prioIcon+" "+prioLabel)}</span>
              </div>
            </div>
            ${kv}${prob}${action}${buttons}
          </div>
        `;
      }
      const safeKey = escapeJsSingleQuote(i.key);
      const seg = segMeta(i.segment || i.statusSaude);
      const nameLine = `
        <div class="radar-card-top">
          <div style="min-width:0">
            <div class="radar-card-name">${escapeHTML(i.nm)}</div>
            <div class="radar-card-meta">${escapeHTML(i.loc || "—")}${i.resp?` · ${escapeHTML(i.resp)}`:""}</div>
          </div>
          <div class="opp-badges">
            ${String(i.segment||"").toLowerCase()==="vip" ? `<span class="vip-crown">👑</span>` : ``}
            ${(i.segment||i.statusSaude)?`<span class="seg-badge ${seg.cls}">${escapeHTML(seg.label)}</span>`:""}
            ${i.cartCount>0?`<span class="seg-badge" style="border-color:rgba(251,191,36,.22);background:rgba(251,191,36,.08);color:var(--amber)">🛒 ${escapeHTML(String(i.cartCount))}</span>`:""}
          </div>
        </div>
      `;
      const kv = `
        <div class="radar-card-vals">
          <div class="radar-kv">
            <div class="radar-kv-label">POTENCIAL</div>
            <div class="radar-kv-val" style="color:var(--green)">${escapeHTML(fmtBRL(i.potencial||0))}</div>
          </div>
          <div class="radar-kv">
            <div class="radar-kv-label">ÚLTIMA COMPRA</div>
            <div class="radar-kv-val">${escapeHTML(String(Math.max(0, Math.round(i.diasSemComprar||0))))}d</div>
          </div>
          <div class="radar-kv">
            <div class="radar-kv-label">FATURAMENTO</div>
            <div class="radar-kv-val">${escapeHTML(fmtBRL(i.ltv||0))}</div>
          </div>
          <div class="radar-kv">
            <div class="radar-kv-label">TICKET MÉDIO</div>
            <div class="radar-kv-val">${escapeHTML(fmtBRL(i.ticket||0))}</div>
          </div>
        </div>
      `;
      const prob = `
        <div class="radar-prob">
          <div class="radar-prob-row">
            <div class="radar-prob-label">Probabilidade de recompra</div>
            <div class="radar-prob-num">${escapeHTML(String(i.prob||0))}%</div>
          </div>
          <div class="radar-prob-track"><div class="radar-prob-fill" style="width:${Math.max(0,Math.min(100,i.prob||0))}%"></div></div>
        </div>
      `;
      const action = `
        <div class="radar-action">AÇÃO SUGERIDA<br><b>${escapeHTML(i.nextAction || "Registrar próxima ação")}</b></div>
      `;
      const buttons = `
        <div class="radar-actions" onclick="event.stopPropagation()">
          ${i.phone?`<button class="opp-mini-btn" onclick="openWaModal('${safeKey}')">WhatsApp</button>`:""}
          ${i.phone?`<button class="opp-mini-btn" onclick="oppSendCoupon('${safeKey}',10)">Cupom</button>`:""}
          <button class="opp-mini-btn" onclick="openClientePage('${safeKey}')">Abrir</button>
        </div>
      `;
      return `<div class="radar-card" onclick="openOppClienteResumo('${safeKey}')">${nameLine}${kv}${prob}${action}${buttons}</div>`;
    };

    const renderGroup = (title, subtitle, list)=>{
      if(!list.length) return "";
      return `
        <div class="radar-group">
          <div class="radar-group-hdr">
            <div>
              <div class="radar-group-title">${escapeHTML(title)}</div>
              <div class="radar-group-sub">${escapeHTML(subtitle)}</div>
            </div>
            <div class="radar-group-sub">${escapeHTML(String(list.length))}</div>
          </div>
          <div class="radar-grid">${list.map(renderCard).join("")}</div>
        </div>
      `;
    };

    const sortVisitouHot = (a,b)=>{
      const as = Number(a.prob||0)||0;
      const bs = Number(b.prob||0)||0;
      if(bs !== as) return bs - as;
      const am = a.tempoMin == null ? 999999 : Number(a.tempoMin||0)||0;
      const bm = b.tempoMin == null ? 999999 : Number(b.tempoMin||0)||0;
      if(am !== bm) return am - bm;
      return (Number(b.potencial||0)||0) - (Number(a.potencial||0)||0);
    };
    const sortVisitouCold = (a,b)=>{
      const am = a.tempoMin == null ? 999999 : Number(a.tempoMin||0)||0;
      const bm = b.tempoMin == null ? 999999 : Number(b.tempoMin||0)||0;
      if(am !== bm) return am - bm;
      const as = Number(a.prob||0)||0;
      const bs = Number(b.prob||0)||0;
      if(bs !== as) return bs - as;
      return (Number(b.potencial||0)||0) - (Number(a.potencial||0)||0);
    };
    visitouHot.sort(sortVisitouHot);
    visitouCold.sort(sortVisitouCold);

    const groupsHtml =
      renderGroup("🛒 CARRINHO QUENTE", "Alta chance de recuperar agora", visitouHot) +
      renderGroup("👀 VISITOU (FRIO)", "Nutrir e acompanhar", visitouCold) +
      renderGroup("🔥 PRIORIDADE ALTA", "Execute hoje", priorityHigh) +
      renderGroup("💰 ALTO VALOR", `LTV acima de ${escapeHTML(fmtBRL(highValueThreshold))}`, highValue) +
      renderGroup("🔄 RECOMPRA", "Clientes no timing de reposição", rebuy) +
      renderGroup("⚠️ EM RISCO", "Recuperação e retenção", risk) +
      renderGroup("🧊 INATIVOS", "120+ dias sem comprar", inactive);

    groupsEl.innerHTML = groupsHtml || `<div class="empty">Nenhuma oportunidade com os filtros atuais.</div>`;
    radarOppLastModel = { items: allItems, filtered, groups: { visitouHot, visitouCold, priorityHigh, highValue, rebuy, risk, inactive }, thresholds: { highValueThreshold } };
    return radarOppLastModel;
  }catch(_e){
    groupsEl.innerHTML = `<div class="empty">Radar indisponível no momento.</div>`;
    return null;
  }
}

function enableOppDragAndSpring(host){
  if(!host) return;
  if(host.__oppDragBound) return;
  host.__oppDragBound = true;

  const springProgress = (t)=>{
    const stiffness = 220;
    const damping = 24;
    const mass = 1;
    const w0 = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    if(zeta >= 1){
      return 1 - Math.exp(-w0 * t);
    }
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const a = zeta * w0;
    const b = (zeta / Math.sqrt(1 - zeta * zeta));
    return 1 - Math.exp(-a * t) * (Math.cos(wd * t) + b * Math.sin(wd * t));
  };

  const buildSpringKeyframes = (fromX, fromY, toX, toY)=>{
    const frames = [];
    const n = 26;
    for(let i=0;i<n;i++){
      const t = (i/(n-1)) * 1.1;
      const p = springProgress(t);
      const x = fromX + (toX - fromX) * p;
      const y = fromY + (toY - fromY) * p;
      frames.push({ transform: `translate3d(${x}px, ${y}px, 0)` });
    }
    return frames;
  };

  host.addEventListener("pointerdown", (ev)=>{
    const e = ev;
    const target = e.target;
    if(target && target.closest && target.closest("button")) return;
    const card = target && target.closest ? target.closest(".opp-card") : null;
    if(!card) return;
    const uuid = card.getAttribute("data-client-uuid") || "";
    if(!uuid) return;
    e.preventDefault();
    const startRect = card.getBoundingClientRect();
    const clone = card.cloneNode(true);
    clone.classList.add("opp-drag-clone");
    clone.style.left = `${startRect.left}px`;
    clone.style.top = `${startRect.top}px`;
    clone.style.width = `${startRect.width}px`;
    clone.style.height = `${startRect.height}px`;
    clone.style.transform = `translate3d(0,0,0)`;
    document.body.appendChild(clone);
    card.style.opacity = "0.15";

    let lastDx = 0;
    let lastDy = 0;
    let activeCol = null;

    const clearTarget = ()=>{
      document.querySelectorAll(".kanban-col.drop-target").forEach(el=>el.classList.remove("drop-target"));
    };

    const move = (mv)=>{
      const dx = mv.clientX - (startRect.left + startRect.width/2);
      const dy = mv.clientY - (startRect.top + startRect.height/2);
      lastDx = dx;
      lastDy = dy;
      clone.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${Math.max(-2, Math.min(2, dx/180))}deg)`;
      const el = document.elementFromPoint(mv.clientX, mv.clientY);
      const col = el && el.closest ? el.closest(".kanban-col") : null;
      if(col !== activeCol){
        clearTarget();
        activeCol = col;
        if(activeCol) activeCol.classList.add("drop-target");
      }
    };

    const end = async (up)=>{
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      clearTarget();

      const el = document.elementFromPoint(up.clientX, up.clientY);
      const col = el && el.closest ? el.closest(".kanban-col") : null;
      const stage = col ? String(col.getAttribute("data-stage")||"").trim() : "";

      const cleanup = ()=>{
        try{ clone.remove(); }catch(_e){}
        card.style.opacity = "";
      };

      if(!stage){
        const anim = clone.animate(buildSpringKeyframes(lastDx, lastDy, 0, 0), { duration: 520, easing: "linear" });
        anim.onfinish = cleanup;
        return;
      }

      const targetRect = col.getBoundingClientRect();
      const toX = (targetRect.left + 18) - startRect.left;
      const toY = (targetRect.top + 54) - startRect.top;

      const anim = clone.animate(buildSpringKeyframes(lastDx, lastDy, toX, toY), { duration: 560, easing: "linear" });
      anim.onfinish = cleanup;

      try{
        await supaClient.from("v2_clientes").update({ pipeline_stage: stage, updated_at: new Date().toISOString() }).eq("id", uuid);
      }catch(_e){}
      setTimeout(()=>{ try{ renderOportunidades(); }catch(_e){} }, 80);
    };

    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", end, { passive: true });
  });
}

function oppLoadMore(){
  oppRemoteLimit += OPP_REMOTE_PAGE_STEP;
  renderOportunidades();
}

function oppSendCoupon(customerKey, pct){
  const id = String(customerKey||"").trim();
  const p = Number(pct||0) || 10;
  if(!id) return;
  const c = allCustomers.find(x=>String(x.id||"")===id);
  if(!c){ toast("⚠ Cliente não encontrado"); return; }
  const phone = rawPhone(c.telefone||"");
  if(!phone){ toast("⚠ Cliente sem telefone"); return; }
  openWaModal(id);
  const first = String(c.nome||"Cliente").trim().split(" ")[0] || "Cliente";
  const msg = `Oi ${first}! Tenho um cupom de ${p}% para você voltar hoje. Quer que eu te envie?`;
  setTimeout(()=>{
    const inp = document.getElementById("wa-custom");
    if(inp) inp.value = msg;
  }, 80);
}

async function oppSuggestTodayActions(){
  return generateRadarTodayActions();
}

let radarTodayActionsState = { loading: false, last: null, ts: 0 };

function radarGetPendingTaskCount(customerKey, customerName){
  const key = String(customerKey||"").trim();
  const nm = String(customerName||"").trim().toLowerCase();
  if(!Array.isArray(allTasks) || !allTasks.length) return 0;
  return allTasks.filter(t=>{
    if(!t || t.status === "concluida") return false;
    const tid = String(t.customer_id || t.cliente_id || t.clienteId || "").trim();
    if(key && tid && tid === key) return true;
    const tc = String(t.cliente || "").trim().toLowerCase();
    if(!tc || !nm) return false;
    if(tc === nm) return true;
    return tc.includes(nm) || nm.includes(tc);
  }).length;
}

function radarDaysSinceIso(isoStr){
  const ts = isoStr ? new Date(String(isoStr)).getTime() : NaN;
  if(!isFinite(ts)) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function radarBuildMotivo(flags){
  if(flags.vip && flags.d90) return "Cliente VIP em risco de churn";
  if(flags.risco && flags.altoValor && flags.semContato) return "Cliente valioso sem contato recente";
  if(flags.altoPotencial && flags.semContato) return "Alto potencial de recompra";
  if(flags.d90 && flags.recorrente) return "Recorrente com sinais de queda";
  if(flags.d45 && flags.altoValor) return "Muito tempo sem comprar e bom histórico";
  if(flags.risco) return "Cliente em risco com bom histórico";
  if(flags.altoValor) return "Cliente valioso com oportunidade de retorno";
  if(flags.d45) return "Muito tempo sem comprar";
  if(flags.altoPotencial) return "Bom potencial de recompra";
  return "Oportunidade de contato hoje";
}

function radarPickNextBestAction(item, flags){
  const segLower = String(item?.segment||item?.statusSaude||"").toLowerCase();
  if(flags.vip) return "Enviar WhatsApp com oferta VIP";
  if(segLower === "churn" || flags.risco) return "Enviar cupom de reativação";
  if(flags.altoPotencial) return "Enviar cupom de recompra";
  if(flags.d45) return "Reativar com campanha";
  return "Abrir atendimento manual";
}

function radarScoreCustomerOpportunity(item, ctx){
  const ltv = Number(item?.ltv||0) || 0;
  const ticket = Number(item?.ticket||0) || 0;
  const dias = Number(item?.diasSemComprar ?? 0) || 0;
  const n = Number(item?.totalPedidos ?? 0) || 0;
  const prob = Number(item?.prob ?? 0) || 0;
  const churnRisk = Number(item?.churnRisk ?? 0) || 0;
  const segLower = String(item?.segment||item?.statusSaude||"").toLowerCase();
  const vip = segLower === "vip";
  const risco = segLower === "churn" || segLower === "em risco" || segLower === "risco" || churnRisk >= 70;
  const altoValor = (ctx.avgLtv > 0) ? (ltv >= ctx.avgLtv) : (ltv >= 500);
  const d45 = dias >= 45;
  const d90 = dias >= 90;
  const recorrente = n >= 2;
  const altoPotencial = prob >= 75;

  const lastContactDays =
    radarDaysSinceIso(item?.last_contact_at) ??
    radarDaysSinceIso(item?.last_interaction_at);
  const semContato = lastContactDays == null ? true : lastContactDays > 7;

  const pendingCount = radarGetPendingTaskCount(item?.key, item?.nm);
  const temPendente = pendingCount > 0;

  let score = 0;
  score += vip ? 30 : 0;
  score += altoValor ? 20 : 0;
  score += d90 ? 35 : (d45 ? 25 : 0);
  score += recorrente ? 15 : 0;
  score += risco ? 20 : 0;
  score += altoPotencial ? 15 : 0;
  score += (ctx.avgTicket > 0 && ticket >= (ctx.avgTicket * 1.2)) ? 10 : 0;
  score += (risco && recorrente && altoValor) ? 10 : 0;
  score -= (lastContactDays != null && lastContactDays <= 7) ? 20 : 0;
  score -= temPendente ? 15 : 0;

  const flags = { vip, risco, altoValor, d45, d90, recorrente, altoPotencial, semContato, temPendente };
  const motivo = radarBuildMotivo(flags);
  const nextBest = String(item?.nextAction||"").trim() || radarPickNextBestAction(item, flags);
  const prio = score >= 85 ? { id: "alta", label: "Prioridade alta", cls: "high" } : (score >= 60 ? { id: "media", label: "Prioridade média", cls: "med" } : { id: "baixa", label: "Prioridade baixa", cls: "" });

  const badges = [];
  if(vip) badges.push("VIP");
  if(altoValor) badges.push("Alto valor");
  if(risco) badges.push("Em Risco");

  return {
    score,
    motivo,
    nextBest,
    prio,
    badges,
    pendingCount,
    lastContactDays
  };
}

function renderRadarTodayActionsBlock(state){
  const host = document.getElementById("radar-today-actions");
  if(!host) return;
  if(state.loading){
    host.innerHTML = `
      <div class="radar-today">
        <div class="radar-today-head">
          <div>
            <div class="radar-today-title">Ações recomendadas para hoje</div>
            <div class="radar-today-sub">Gerando recomendações…</div>
          </div>
          <div class="radar-prio-pill med">Processando</div>
        </div>
        <div class="radar-today-grid">
          <div class="radar-card" style="cursor:default"><div class="radar-card-name">—</div><div class="radar-card-meta">Carregando…</div></div>
          <div class="radar-card" style="cursor:default"><div class="radar-card-name">—</div><div class="radar-card-meta">Carregando…</div></div>
          <div class="radar-card" style="cursor:default"><div class="radar-card-name">—</div><div class="radar-card-meta">Carregando…</div></div>
        </div>
      </div>
    `;
    return;
  }
  const list = Array.isArray(state.last) ? state.last : [];
  if(!list.length){
    host.innerHTML = `
      <div class="radar-today">
        <div class="radar-today-head">
          <div>
            <div class="radar-today-title">Ações recomendadas para hoje</div>
            <div class="radar-today-sub">Sem dados suficientes para recomendar agora</div>
          </div>
          <div class="radar-prio-pill">Vazio</div>
        </div>
        <div class="empty">Importe/sincronize pedidos e clientes para gerar recomendações com base em histórico.</div>
      </div>
    `;
    return;
  }
  const updatedAt = state.ts ? new Date(state.ts).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "";
  host.innerHTML = `
    <div class="radar-today">
      <div class="radar-today-head">
        <div>
          <div class="radar-today-title">Ações recomendadas para hoje</div>
          <div class="radar-today-sub">Top 3 por valor, recência, risco e histórico</div>
        </div>
        <div class="radar-prio-pill">${updatedAt ? "Atualizado " + escapeHTML(updatedAt) : "Atualizado"}</div>
      </div>
      <div class="radar-today-grid">
        ${list.map(r=>{
          const safeKey = escapeJsSingleQuote(String(r.key||""));
          const segLower = String(r.segment||r.statusSaude||"").toLowerCase();
          const segCls = segLower==="vip" ? "seg-vip" : segLower==="churn" ? "seg-churn" : segLower==="em risco"||segLower==="risco" ? "seg-risco" : segLower==="novo" ? "seg-novo" : "seg-unk";
          const segLabel = segLower==="vip" ? "VIP" : segLower==="churn" ? "Churn" : segLower==="em risco"||segLower==="risco" ? "Em Risco" : segLower==="novo" ? "Novo" : (r.segment||"—");
          const pr = r.__score?.prio;
          const prCls = pr?.cls ? ` ${pr.cls}` : "";
          const motivo = r.__score?.motivo || "";
          const nextBest = r.__score?.nextBest || r.nextAction || "";
          const badgeExtra = (r.__score?.badges || []).filter(b=>b!=="VIP" && b!==segLabel);
          return `
            <div class="radar-card" onclick="openOppClienteResumo('${safeKey}')">
              <div class="radar-card-top">
                <div style="min-width:0">
                  <div class="radar-card-name">${escapeHTML(r.nm||"Cliente")}</div>
                  <div class="radar-card-meta">${escapeHTML(String(r.diasSemComprar||0))}d sem comprar · ${escapeHTML(fmtBRL(r.ltv||0))} faturados</div>
                </div>
                <div class="opp-badges">
                  ${segLower==="vip" ? `<span class="vip-crown">👑</span>` : ``}
                  <span class="radar-prio-pill${prCls}">${escapeHTML(pr?.label||"Prioridade")}</span>
                </div>
              </div>
              <div class="opp-badges" style="margin-top:8px">
                <span class="seg-badge ${segCls}">${escapeHTML(segLabel)}</span>
                ${badgeExtra.includes("Alto valor") ? `<span class="seg-badge" style="border-color:rgba(15,167,101,.24);background:rgba(15,167,101,.10);color:var(--green)">Alto valor</span>` : ``}
                ${badgeExtra.includes("Em Risco") ? `<span class="seg-badge" style="border-color:rgba(248,113,113,.24);background:rgba(248,113,113,.10);color:var(--red)">Em Risco</span>` : ``}
              </div>
              <div class="radar-card-vals">
                <div class="radar-kv">
                  <div class="radar-kv-label">PEDIDOS</div>
                  <div class="radar-kv-val">${escapeHTML(String(r.totalPedidos||0))}</div>
                </div>
                <div class="radar-kv">
                  <div class="radar-kv-label">TICKET MÉDIO</div>
                  <div class="radar-kv-val">${escapeHTML(fmtBRL(r.ticket||0))}</div>
                </div>
              </div>
              <div class="radar-reason">Motivo: <b>${escapeHTML(motivo)}</b></div>
              <div class="radar-action">Próxima melhor ação<br><b>${escapeHTML(nextBest)}</b></div>
              <div class="radar-actions" onclick="event.stopPropagation()">
                ${r.phone?`<button class="opp-mini-btn" onclick="openWaModal('${safeKey}')">WhatsApp</button>`:""}
                ${r.phone?`<button class="opp-mini-btn" onclick="oppSendCoupon('${safeKey}',10)">Cupom</button>`:""}
                <button class="opp-mini-btn" onclick="openClientePage('${safeKey}')">Abrir</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

async function generateRadarTodayActions(){
  if(radarTodayActionsState.loading) return;
  radarTodayActionsState = { loading: true, last: radarTodayActionsState.last, ts: radarTodayActionsState.ts };
  renderRadarTodayActionsBlock(radarTodayActionsState);

  let model = radarOppLastModel;
  if(!model || !Array.isArray(model.items)){
    try{
      if(supaConnected && supaClient) model = await renderOportunidadesFromSupabase().catch(()=>null);
      else { renderOportunidades(); model = radarOppLastModel; }
    }catch(_e){ model = null; }
  }
  const items = Array.isArray(model?.items) ? model.items : [];
  const customers = items.filter(i=>i && i.kind !== "visitou" && i.key && i.nm);
  const avgLtv = customers.length ? customers.reduce((s,i)=>s+(Number(i.ltv||0)||0),0) / customers.length : 0;
  const avgTicket = customers.length ? customers.reduce((s,i)=>s+(Number(i.ticket||0)||0),0) / customers.length : 0;
  const ctx = { avgLtv, avgTicket };

  const scored = customers.map(c=>{
    const s = radarScoreCustomerOpportunity(c, ctx);
    return { ...c, __score: s };
  }).filter(x=>Number(x.__score?.score||0) > 0);

  scored.sort((a,b)=>{
    const as = Number(a.__score?.score||0)||0;
    const bs = Number(b.__score?.score||0)||0;
    if(bs !== as) return bs - as;
    const bl = Number(b.ltv||0)||0;
    const al = Number(a.ltv||0)||0;
    if(bl !== al) return bl - al;
    const bd = Number(b.diasSemComprar||0)||0;
    const ad = Number(a.diasSemComprar||0)||0;
    if(bd !== ad) return bd - ad;
    return String(a.nm||"").localeCompare(String(b.nm||""), "pt-BR");
  });

  const top = scored.slice(0,3);
  radarTodayActionsState = { loading: false, last: top, ts: Date.now() };
  renderRadarTodayActionsBlock(radarTodayActionsState);
  try{ document.getElementById("radar-today-actions")?.scrollIntoView({ behavior: "smooth", block: "start" }); }catch(_e){}
}

async function openOppClienteResumo(customerKey){
  const key = String(customerKey||"").trim();
  if(!key){ toast("⚠ Cliente inválido"); return; }
  if(!supaConnected || !supaClient){
    openClientePage(key);
    return;
  }
  const uuid = await resolveCustomerUuid(key).catch(()=>null);
  if(!uuid){
    openClientePage(key);
    return;
  }

  let pedidos = [];
  try{
    const {data, error} = await supaClient
      .from("v2_pedidos")
      .select("id,total,data_pedido")
      .eq("cliente_id", uuid)
      .order("data_pedido", { ascending: false })
      .limit(1200);
    if(error) throw error;
    pedidos = Array.isArray(data) ? data : [];
  }catch(_e){}

  const pedidoIds = pedidos.map(p=>p.id).filter(Boolean);
  const itemsAgg = {};
  try{
    const okItems = await ensureV2PedidosItemsAvailable();
    if(okItems && pedidoIds.length){
      const totalCol = v2PedidosItemsTotalColumn || "valor_total";
      for(let i=0;i<pedidoIds.length;i+=200){
        const batch = pedidoIds.slice(i,i+200);
        const {data, error} = await supaClient
          .from("v2_pedidos_items")
          .select(`produto_nome,quantidade,${totalCol}`)
          .in("pedido_id", batch)
          .limit(20000);
        if(error) throw error;
        (data||[]).forEach(r=>{
          const nome = String(r.produto_nome||"").trim();
          if(!nome) return;
          if(!itemsAgg[nome]) itemsAgg[nome] = { nome, qty: 0, total: 0 };
          itemsAgg[nome].qty += Number(r.quantidade||0) || 0;
          itemsAgg[nome].total += Number(r?.[totalCol] ?? r?.valor_total ?? r?.total ?? 0) || 0;
        });
      }
    }
  }catch(_e){}

  const top = Object.values(itemsAgg).sort((a,b)=>b.qty-a.qty || b.total-a.total).slice(0,8);
  const totalPedidos = pedidos.length;
  const totalGasto = pedidos.reduce((s,p)=>s+(Number(p.total||0)||0),0);

  const nm = (allCustomers.find(c=>String(c.id||"")===key)?.nome) || "Cliente";
  const body = `
    <div class="drawer-section">
      <div class="drawer-section-title">Resumo</div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Pedidos</span><span class="chiva-table-mono">${escapeHTML(String(totalPedidos||0))}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px"><span style="color:var(--text-3)">Total gasto</span><span style="font-weight:900;color:var(--green)">${escapeHTML(fmtBRL(totalGasto||0))}</span></div>
    </div>
    <div class="drawer-section">
      <div class="drawer-section-title">Itens mais comprados</div>
      ${top.length ? `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${top.map(it=>`
            <div style="display:flex;justify-content:space-between;gap:10px;border:1px solid var(--border);background:var(--card);border-radius:12px;padding:10px">
              <div style="min-width:0">
                <div style="font-weight:900;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHTML(it.nome)}</div>
                <div style="font-size:10px;color:var(--text-3);margin-top:2px">Qtd: ${escapeHTML(String(Math.round(it.qty*1000)/1000))}</div>
              </div>
              <div style="font-family:var(--mono);font-weight:900;color:var(--green);font-size:12px">${escapeHTML(fmtBRL(it.total||0))}</div>
            </div>
          `).join("")}
        </div>
      ` : `<div style="font-size:12px;color:var(--text-3)">Sem itens disponíveis ainda.</div>`}
    </div>
  `;
  openDrawer(`💡 ${escapeHTML(nm)}`, "Resumo de compras", body, `<button class="drawer-btn drawer-btn-ghost" onclick="closeDrawer()">Fechar</button><button class="drawer-btn drawer-btn-primary" onclick="openClientePage('${escapeJsSingleQuote(key)}')">Abrir perfil</button>`);
}

function renderOportunidades(){
  if(supaConnected && supaClient){
    renderOportunidadesFromSupabase();
    return;
  }
  const kpisEl = document.getElementById("radar-kpis");
  const chipsEl = document.getElementById("radar-chips");
  const groupsEl = document.getElementById("radar-groups");
  if(!kpisEl || !chipsEl || !groupsEl) return;

  const q = String(document.getElementById("radar-q")?.value || "").trim().toLowerCase();
  if(!radarOppFilters || typeof radarOppFilters !== "object") radarOppFilters = { visitou:false, visitou_quente:false, visitou_frio:false, vip:false, churn:false, recompra:false, alto_valor:false, dias30:false, carrinho:false };

  const chips = [
    { id: "visitou", label: "Visitou" },
    { id: "visitou_quente", label: "Carrinho quente" },
    { id: "visitou_frio", label: "Visitou frio" },
    { id: "vip", label: "VIP" },
    { id: "churn", label: "Churn" },
    { id: "recompra", label: "Recompra" },
    { id: "alto_valor", label: "Alto valor" },
    { id: "dias30", label: "30+ dias" },
    { id: "carrinho", label: "Carrinho abandonado" },
    { id: "todos", label: "Todos" },
  ];
  chipsEl.innerHTML = chips.map(c=>{
    const active = c.id==="todos" ? !Object.values(radarOppFilters).some(Boolean) : !!radarOppFilters[c.id];
    return `<button class="radar-chip ${active?"active":""}" onclick="radarToggleOppFilter('${escapeJsSingleQuote(c.id)}')">${escapeHTML(c.label)}</button>`;
  }).join("");

  const todayIso = new Date().toISOString().slice(0,10);
  const cartsOpen = []
    .concat(carrinhosAbandonados||[])
    .map(normalizeCarrinhoAbandonado)
    .filter(c=>c && c.checkout_id && !c.recuperado);

  const cartByEmail = {};
  cartsOpen.forEach(c=>{
    const em = String(c.email || c.customer_email || "").trim().toLowerCase();
    if(!em) return;
    cartByEmail[em] = (cartByEmail[em]||0) + 1;
  });

  const clis = Object.values(buildCli(allOrders)).map(c=>({ c, s: calcCliScores(c) })).filter(x=>x.c && x.c.id);
  const items = clis.map(x=>{
    const c = x.c;
    const s = x.s || {};
    const id = String(c.id||"").trim();
    const nm = String(c.nome||"Cliente").trim();
    const loc = [c.cidade,c.uf].filter(Boolean).join(" — ");
    const email = String(c.email||"").trim().toLowerCase();
    const cartCount = email ? (cartByEmail[email]||0) : 0;
    const segment = String(s.status||"").trim();
    const diasSemComprar = Number(s.ds||0) || 0;
    const ltv = Number(s.ltv||0) || 0;
    const ticket = Number(s.avgTicket||0) || (s.ordersCount? (ltv/s.ordersCount) : 0);
    const prob = Math.max(0, Math.min(100, Math.round(Number(s.recompraScore||0) || 0)));
    const potencial = Math.max(0, ticket) * (prob/100);
    const nextAction = s.nextBestAction || (segment==="vip" ? "Oferta VIP: lançamento/kit exclusivo" : segment==="churn" ? "Reativar com oferta forte + mensagem pessoal" : "Enviar cupom de desconto");
    const primeiro = String(s.firstOrderAt||"").slice(0,10);
    const churnRisk = Number(s.churnRisk||0) || 0;
    const phone = rawPhone(c.telefone||"");
    return { key:id, uuid:id, nm, loc, resp:"", phone, email, segment, statusSaude:segment, churnRisk, prob, diasSemComprar, totalPedidos:s.ordersCount||0, ltv, ticket, potencial, nextAction, primeiro, cartCount };
  });

  const ltvVals = items.map(i=>i.ltv).filter(v=>Number.isFinite(v) && v>0).sort((a,b)=>a-b);
  const p90 = ltvVals.length ? ltvVals[Math.max(0, Math.floor(ltvVals.length*0.9)-1)] : 0;
  const highValueThreshold = Math.max(400, Number(p90)||0);

  const purchasedByEmail = {};
  items.forEach(i=>{
    const em = String(i.email||"").trim().toLowerCase();
    if(!em) return;
    purchasedByEmail[em] = (Number(i.totalPedidos||0) > 0) || (Number(i.ltv||0) > 0);
  });

  const lookupCarr = buildClienteLookupParaCarrinhos();
  const visitouLeads = cartsOpen
    .filter(c=>{
      const em = String(c.email||"").trim().toLowerCase();
      if(!em) return true;
      return purchasedByEmail[em] !== true;
    })
    .map(c=>{
      const cid = String(c.checkout_id||"").trim();
      const calc = calcularScoreRecuperacaoCarrinho(c, lookupCarr);
      const score = c.score_recuperacao == null ? (Number(calc.score||0)||0) : (Number(c.score_recuperacao||0)||0);
      const prio = prioridadePorScore(score);
      const etapa = sugerirEtapaParaCarrinho(c, calc.mins);
      const valor = Number(c.valor||0)||0;
      const nm = String(c.cliente_nome || c.email || "Visitante").trim() || "Visitante";
      const em = String(c.email||"").trim().toLowerCase();
      const phone = rawPhone(c.telefone||"");
      const ds = daysSince(c.criado_em);
      const dias = ds>=9999 ? 0 : ds;
      const acao = etapa?.label ? `Carrinho: ${String(etapa.label)}` : "Recuperar carrinho";
      return {
        kind: "visitou",
        uuid: "visitou:"+cid,
        key: "visitou:"+cid,
        checkoutId: cid,
        nm,
        loc: "",
        resp: "",
        phone,
        email: em,
        segment: "Visitou",
        statusSaude: "Visitou",
        churnRisk: 0,
        prob: Math.max(0, Math.min(100, Math.round(score))),
        diasSemComprar: dias,
        tempoMin: calc.mins,
        prioridade_id: prio.id,
        prioridade_label: prio.label,
        totalPedidos: 0,
        ltv: 0,
        ticket: valor,
        potencial: valor,
        nextAction: acao,
        primeiro: "",
        cartCount: 1,
        cartValue: valor,
        link_finalizacao: c.link_finalizacao || null,
        criado_em: c.criado_em || null,
      };
    })
    .filter(x=>x.checkoutId);

  const allItems = [...visitouLeads, ...items];

  const vipRiskCount = items.filter(i=>String(i.segment||i.statusSaude).toLowerCase()==="vip" && (i.diasSemComprar>=45 || i.churnRisk>=70)).length;
  const cartsCount = cartsOpen.length;
  const d30Count = items.filter(i=>i.diasSemComprar>=30).length;
  const leadsTodayCount = visitouLeads.filter(x=>String(x.criado_em||"").slice(0,10)===todayIso).length;

  kpisEl.innerHTML = `
    <div class="radar-kpi"><div class="radar-kpi-label">VIPs em risco</div><div class="radar-kpi-val">${escapeHTML(String(vipRiskCount))}</div></div>
    <div class="radar-kpi"><div class="radar-kpi-label">Carrinhos abandonados</div><div class="radar-kpi-val">${escapeHTML(String(cartsCount))}</div></div>
    <div class="radar-kpi"><div class="radar-kpi-label">Clientes 30+ dias</div><div class="radar-kpi-val">${escapeHTML(String(d30Count))}</div></div>
    <div class="radar-kpi"><div class="radar-kpi-label">Leads novos hoje</div><div class="radar-kpi-val">${escapeHTML(String(leadsTodayCount))}</div></div>
  `;

  const filtered = allItems.filter(i=>{
    if(q){
      const hay = [i.nm, i.loc, i.resp, i.email].filter(Boolean).join(" ").toLowerCase();
      if(!hay.includes(q)) return false;
    }
    const isLead = i.kind === "visitou";
    const isHotLead = isLead && String(i.prioridade_id||"") === "alta";
    const segLower = String(i.segment||i.statusSaude||"").toLowerCase();
    if(radarOppFilters.visitou && !isLead) return false;
    if(radarOppFilters.visitou_quente && !isHotLead) return false;
    if(radarOppFilters.visitou_frio && (isLead && isHotLead)) return false;
    if(radarOppFilters.visitou_frio && !isLead) return false;
    if(radarOppFilters.vip && (isLead || segLower !== "vip")) return false;
    if(radarOppFilters.churn && (isLead || segLower !== "churn")) return false;
    if(radarOppFilters.recompra && (isLead || !(i.prob>=65 && i.diasSemComprar>=20 && i.diasSemComprar<60))) return false;
    if(radarOppFilters.alto_valor && (isLead || i.ltv < highValueThreshold)) return false;
    if(radarOppFilters.dias30 && (isLead || i.diasSemComprar < 30)) return false;
    if(radarOppFilters.carrinho && i.cartCount <= 0) return false;
    return true;
  });

  const visitou = filtered.filter(i=>i.kind === "visitou");
  const visitouHot = visitou.filter(i=>String(i.prioridade_id||"") === "alta");
  const visitouCold = visitou.filter(i=>String(i.prioridade_id||"") !== "alta");
  const customersOnly = filtered.filter(i=>i.kind !== "visitou");

  const priorityHigh = [];
  const highValue = [];
  const rebuy = [];
  const risk = [];
  const inactive = [];

  customersOnly.forEach(i=>{
    const segLower = String(i.segment||i.statusSaude||"").toLowerCase();
    const isVipRisk = segLower==="vip" && (i.diasSemComprar>=45 || i.churnRisk>=70);
    const isCartHot = i.cartCount>0 && i.diasSemComprar>=7;
    const isProbable = i.prob>=80 && i.diasSemComprar>=30 && i.ltv>0;
    const isRebuy = i.prob>=65 && i.diasSemComprar>=20 && i.diasSemComprar<60 && !isVipRisk;
    const isInactive = i.diasSemComprar>=120;
    const isRisk = !isInactive && (segLower==="churn" || segLower==="em risco" || segLower==="risco" || i.churnRisk>=70 || i.diasSemComprar>=60);
    if(isVipRisk || isCartHot || isProbable) priorityHigh.push(i);
    else if(i.ltv>=highValueThreshold) highValue.push(i);
    else if(isRebuy) rebuy.push(i);
    else if(isRisk) risk.push(i);
    else if(isInactive) inactive.push(i);
  });

  const sortByScore = (a,b)=>(b.prob-a.prob) || (b.potencial-a.potencial) || (b.ltv-a.ltv) || (b.diasSemComprar-a.diasSemComprar);
  priorityHigh.sort(sortByScore);
  highValue.sort((a,b)=>(b.ltv-a.ltv) || sortByScore(a,b));
  rebuy.sort(sortByScore);
  risk.sort((a,b)=>(b.churnRisk-a.churnRisk) || (b.diasSemComprar-a.diasSemComprar) || sortByScore(a,b));
  inactive.sort((a,b)=>(b.diasSemComprar-a.diasSemComprar) || sortByScore(a,b));

  const renderCard = (i)=>{
    if(i.kind === "visitou"){
      const cid = String(i.checkoutId||"").trim();
      const safeCid = escapeJsSingleQuote(cid);
      const prioId = String(i.prioridade_id||"").trim();
      const prioLabel = String(i.prioridade_label||"").trim() || "—";
      const prioIcon = prioId === "alta" ? "🔥" : (prioId === "media" ? "⚡" : "🧊");
      const contato = [i.email||"", i.phone?fmtPhone(i.phone):""].filter(Boolean).join(" · ") || "—";
      return `
        <div class="radar-card" onclick="openRadarVisitouDrawer('${safeCid}')">
          <div class="radar-card-top">
            <div style="min-width:0">
              <div class="radar-card-name">${escapeHTML(i.nm||"Visitante")}</div>
              <div class="radar-card-meta">${escapeHTML("Carrinho aberto (sem compra)")}</div>
            </div>
            <div class="opp-badges">
              <span class="seg-badge seg-visitou">Visitou</span>
              <span class="seg-badge" style="border-color:rgba(255,255,255,.10);background:rgba(255,255,255,.04);color:var(--text-2)">${escapeHTML(prioIcon+" "+prioLabel)}</span>
            </div>
          </div>
          <div class="radar-card-vals">
            <div class="radar-kv">
              <div class="radar-kv-label">POTENCIAL</div>
              <div class="radar-kv-val" style="color:var(--green)">${escapeHTML(fmtBRL(i.potencial||0))}</div>
            </div>
            <div class="radar-kv">
              <div class="radar-kv-label">ÚLTIMA VISITA</div>
              <div class="radar-kv-val">${escapeHTML(String(Math.max(0, Math.round(i.diasSemComprar||0))))}d</div>
            </div>
            <div class="radar-kv">
              <div class="radar-kv-label">CARRINHO</div>
              <div class="radar-kv-val">${escapeHTML(String(cid).slice(0,8))}</div>
            </div>
            <div class="radar-kv">
              <div class="radar-kv-label">CONTATO</div>
              <div class="radar-kv-val" style="font-family:var(--font)">${escapeHTML(contato)}</div>
            </div>
          </div>
          <div class="radar-prob">
            <div class="radar-prob-row">
              <div class="radar-prob-label">Probabilidade de recuperação</div>
              <div class="radar-prob-num">${escapeHTML(String(i.prob||0))}%</div>
            </div>
            <div class="radar-prob-track"><div class="radar-prob-fill" style="width:${Math.max(0,Math.min(100,i.prob||0))}%"></div></div>
          </div>
          <div class="radar-action">AÇÃO SUGERIDA<br><b>${escapeHTML(i.nextAction || "Recuperar carrinho")}</b></div>
          <div class="radar-actions" onclick="event.stopPropagation()">
            ${rawPhone(i.phone||"")?`<button class="opp-mini-btn" onclick="openWhatsAppCarrinho('${safeCid}')">WhatsApp</button>`:""}
            ${i.link_finalizacao?`<button class="opp-mini-btn" onclick="openCarrinhoLinkFromRadar('${safeCid}')">Link</button>`:""}
            <button class="opp-mini-btn" onclick="openCarrinhoInComercialFromRadar('${safeCid}')">Abrir</button>
          </div>
        </div>
      `;
    }
    const safeKey = escapeJsSingleQuote(i.key);
    const segLower = String(i.segment||i.statusSaude||"").toLowerCase();
    const segCls = segLower==="vip" ? "seg-vip" : segLower==="churn" ? "seg-churn" : segLower==="em risco"||segLower==="risco" ? "seg-risco" : segLower==="novo" ? "seg-novo" : segLower==="visitou" ? "seg-visitou" : "seg-unk";
    const segLabel = segLower==="vip" ? "VIP" : segLower==="churn" ? "Churn" : segLower==="em risco"||segLower==="risco" ? "Em Risco" : segLower==="novo" ? "Novo" : segLower==="visitou" ? "Visitou" : (i.segment||"—");
    return `
      <div class="radar-card" onclick="openClientePage('${safeKey}')">
        <div class="radar-card-top">
          <div style="min-width:0">
            <div class="radar-card-name">${escapeHTML(i.nm)}</div>
            <div class="radar-card-meta">${escapeHTML(i.loc||"—")}</div>
          </div>
          <div class="opp-badges">
            ${segLower==="vip" ? `<span class="vip-crown">👑</span>` : ``}
            <span class="seg-badge ${segCls}">${escapeHTML(segLabel)}</span>
            ${i.cartCount>0?`<span class="seg-badge" style="border-color:rgba(251,191,36,.22);background:rgba(251,191,36,.08);color:var(--amber)">🛒 ${escapeHTML(String(i.cartCount))}</span>`:""}
          </div>
        </div>
        <div class="radar-card-vals">
          <div class="radar-kv">
            <div class="radar-kv-label">POTENCIAL</div>
            <div class="radar-kv-val" style="color:var(--green)">${escapeHTML(fmtBRL(i.potencial||0))}</div>
          </div>
          <div class="radar-kv">
            <div class="radar-kv-label">ÚLTIMA COMPRA</div>
            <div class="radar-kv-val">${escapeHTML(String(Math.max(0, Math.round(i.diasSemComprar||0))))}d</div>
          </div>
          <div class="radar-kv">
            <div class="radar-kv-label">FATURAMENTO</div>
            <div class="radar-kv-val">${escapeHTML(fmtBRL(i.ltv||0))}</div>
          </div>
          <div class="radar-kv">
            <div class="radar-kv-label">TICKET MÉDIO</div>
            <div class="radar-kv-val">${escapeHTML(fmtBRL(i.ticket||0))}</div>
          </div>
        </div>
        <div class="radar-prob">
          <div class="radar-prob-row">
            <div class="radar-prob-label">Probabilidade de recompra</div>
            <div class="radar-prob-num">${escapeHTML(String(i.prob||0))}%</div>
          </div>
          <div class="radar-prob-track"><div class="radar-prob-fill" style="width:${Math.max(0,Math.min(100,i.prob||0))}%"></div></div>
        </div>
        <div class="radar-action">AÇÃO SUGERIDA<br><b>${escapeHTML(i.nextAction || "Registrar próxima ação")}</b></div>
        <div class="radar-actions" onclick="event.stopPropagation()">
          ${i.phone?`<button class="opp-mini-btn" onclick="openWaModal('${safeKey}')">WhatsApp</button>`:""}
          ${i.phone?`<button class="opp-mini-btn" onclick="oppSendCoupon('${safeKey}',10)">Cupom</button>`:""}
          <button class="opp-mini-btn" onclick="openClientePage('${safeKey}')">Abrir</button>
        </div>
      </div>
    `;
  };

  const renderGroup = (title, subtitle, list)=>{
    if(!list.length) return "";
    return `
      <div class="radar-group">
        <div class="radar-group-hdr">
          <div>
            <div class="radar-group-title">${escapeHTML(title)}</div>
            <div class="radar-group-sub">${escapeHTML(subtitle)}</div>
          </div>
          <div class="radar-group-sub">${escapeHTML(String(list.length))}</div>
        </div>
        <div class="radar-grid">${list.map(renderCard).join("")}</div>
      </div>
    `;
  };

  const sortVisitouHot = (a,b)=>{
    const as = Number(a.prob||0)||0;
    const bs = Number(b.prob||0)||0;
    if(bs !== as) return bs - as;
    const am = a.tempoMin == null ? 999999 : Number(a.tempoMin||0)||0;
    const bm = b.tempoMin == null ? 999999 : Number(b.tempoMin||0)||0;
    if(am !== bm) return am - bm;
    return (Number(b.potencial||0)||0) - (Number(a.potencial||0)||0);
  };
  const sortVisitouCold = (a,b)=>{
    const am = a.tempoMin == null ? 999999 : Number(a.tempoMin||0)||0;
    const bm = b.tempoMin == null ? 999999 : Number(b.tempoMin||0)||0;
    if(am !== bm) return am - bm;
    const as = Number(a.prob||0)||0;
    const bs = Number(b.prob||0)||0;
    if(bs !== as) return bs - as;
    return (Number(b.potencial||0)||0) - (Number(a.potencial||0)||0);
  };
  visitouHot.sort(sortVisitouHot);
  visitouCold.sort(sortVisitouCold);

  const groupsHtml =
    renderGroup("🛒 CARRINHO QUENTE", "Alta chance de recuperar agora", visitouHot) +
    renderGroup("👀 VISITOU (FRIO)", "Nutrir e acompanhar", visitouCold) +
    renderGroup("🔥 PRIORIDADE ALTA", "Execute hoje", priorityHigh) +
    renderGroup("💰 ALTO VALOR", `LTV acima de ${escapeHTML(fmtBRL(highValueThreshold))}`, highValue) +
    renderGroup("🔄 RECOMPRA", "Clientes no timing de reposição", rebuy) +
    renderGroup("⚠️ EM RISCO", "Recuperação e retenção", risk) +
    renderGroup("🧊 INATIVOS", "120+ dias sem comprar", inactive);

  groupsEl.innerHTML = groupsHtml || `<div class="empty">Nenhuma oportunidade com os filtros atuais.</div>`;
  radarOppLastModel = { items: allItems, filtered, groups: { visitouHot, visitouCold, priorityHigh, highValue, rebuy, risk, inactive }, thresholds: { highValueThreshold } };
}

function moveOppStage(oppId, stage){
  if(!Array.isArray(oppPipeline)) oppPipeline = [];
  const idx = oppPipeline.findIndex(o=>String(o.id)===String(oppId));
  if(idx<0) return;
  oppPipeline[idx].stage = stage;
  oppPipeline[idx].updated_at = new Date().toISOString();
  saveOppPipeline();
  renderOportunidades();
}

async function saveCliStatus(id,status){
  if(!cliMeta[id])cliMeta[id]={};
  if(status) cliMeta[id].status=status; else delete cliMeta[id].status;
  localStorage.setItem("crm_climeta",JSON.stringify(cliMeta));
  // Sincronizar com v2_clientes via doc (id = cliKey = doc na maioria dos casos)
  if(supaConnected && supaClient){
    const uuid = cliMetaCache[id]?.uuid;
    if(uuid) supaClient.from('v2_clientes').update({status_manual:status||null,updated_at:new Date().toISOString()}).eq('id',uuid).then(()=>{});
  }
  toast("✓ Salvo!");
}
async function saveNote(id,inputId){
  const v=document.getElementById(inputId)?.value||"";
  if(!cliMeta[id])cliMeta[id]={};
  cliMeta[id].notes=v;
  localStorage.setItem("crm_climeta",JSON.stringify(cliMeta));
  // Sincronizar com v2_clientes
  if(supaConnected && supaClient){
    const uuid = cliMetaCache[id]?.uuid;
    if(uuid) supaClient.from('v2_clientes').update({notas:v,updated_at:new Date().toISOString()}).eq('id',uuid).then(()=>{});
  }
  toast("✓ Anotação salva!");
}

// ═══════════════════════════════════════════════════
//  WHATSAPP
// ═══════════════════════════════════════════════════
function openWaModal(clienteId){
  const c = allCustomers.find(x=>x.id===clienteId);
  if(!c){ toast("⚠ Cliente não encontrado"); return; }
  const phone = rawPhone(c.telefone||"");
  if(!phone){ toast("⚠ Cliente sem telefone"); return; }
  waCustomerId = clienteId;
  const perfil = c.status || "default";
  openWa(phone, c.nome||"Cliente", perfil);
}
function openWa(phone,name,perfil){
  waPhone=phone; waName=name;
  document.getElementById("wa-modal-name").textContent="para "+name;
  // Templates por perfil
  const tplsPerfil={
    vip: ["Oi {nome}! 🌟 Você é um dos nossos clientes mais especiais! Preparamos uma condição exclusiva VIP pra você. Posso te contar?","Olá {nome}! Como VIP Chiva Fit, você tem acesso antecipado às nossas novidades 🚀 Quer saber o que vem por aí?","Oi {nome}! Obrigada por confiar tanto na Chiva Fit ⭐ Você tem desconto especial esperando por você!"],
    inativo: ["Oi {nome}! 😊 Sentimos sua falta na Chiva Fit! Que tal voltar com condições especiais pra você? 💪","Olá {nome}! Faz um tempinho que não nos vemos... Temos novos sabores incríveis e uma oferta exclusiva pra te trazer de volta 🥤","Oi {nome}! A Chiva Fit tem uma surpresa especial pra quem volta! Bora conversar? 🎁"],
    recompra: ["Oi {nome}! Tá na hora de reabastecer? 🔥 Seu produto favorito pode estar acabando! Posso ajudar?","Olá {nome}! Com base no seu histórico, você deve estar quase no fim do seu shake 💪 Quer garantir o próximo com desconto?","Oi {nome}! Não deixa faltar sua suplementação! Temos combos especiais essa semana 🏋️"],
    novo: ["Oi {nome}! Seja bem-vinda à família Chiva Fit! 🎉 Ficou alguma dúvida sobre seu pedido?","Olá {nome}! Como foi sua primeira experiência com a Chiva Fit? Adoraria saber sua opinião 😊","Oi {nome}! Que tal conhecer todos os sabores da Chiva Fit? Temos uma sequência incrível pra te sugerir 🥤"],
    default: WA_TPLS
  };
  const tpls = tplsPerfil[perfil] || tplsPerfil.default;
  const tplsFormatados = tpls.map(t=>t.replace(/\{nome\}/g, name.split(" ")[0]));
  document.getElementById("wa-templates").innerHTML=tplsFormatados.map((t,i)=>`<div class="wa-tpl" id="wt${i}" onclick="selectTpl(${i})"><div class="wa-tpl-label">${escapeHTML(['💎 VIP','🔄 Reengajamento','⚡ Urgente'][i]||'Template '+(i+1))}</div><div>${escapeHTML(t).replace(/\n/g,"<br>")}</div></div>`).join("");
  document.getElementById("wa-custom").value=tplsFormatados[0]||"";
  document.getElementById("wa-modal").classList.add("open");
}
function selectTpl(i){ document.querySelectorAll(".wa-tpl").forEach((el,j)=>el.classList.toggle("selected",j===i)); const el=document.querySelectorAll(".wa-tpl")[i]; if(el) document.getElementById("wa-custom").value=el.innerText.split("\n").slice(1).join("\n").trim(); }
function closeWa(){ document.getElementById("wa-modal").classList.remove("open"); }
function sendWa(){ 
  const msg=document.getElementById("wa-custom").value.trim(); 
  if(!msg){toast("⚠ Escreva uma mensagem!");return;} 
  const phone=waPhone.replace(/\D/g,"");
  const url=`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`;
  window.open(url,"_blank"); 
  if(waCustomerId){
    logInteraction(waCustomerId, "mensagem_enviada", msg.slice(0,240), { channel: "whatsapp" }).catch(()=>{});
  }
  closeWa(); 
}
function loadTemplatesUI(){ WA_TPLS.forEach((t,i)=>{ const el=document.getElementById("tpl"+(i+1)); if(el)el.value=t; }); }
function saveTemplates(){ WA_TPLS=[1,2,3].map(i=>document.getElementById("tpl"+i)?.value||"").filter(Boolean); localStorage.setItem("crm_wa_tpls",JSON.stringify(WA_TPLS)); document.getElementById("tpl-status").textContent="✓ Salvos!"; document.getElementById("tpl-status").className="setup-status s-ok"; }

// ═══════════════════════════════════════════════════
//  PRODUTOS
// ═══════════════════════════════════════════════════
function findProdutoNoCatalogo(prodKey){
  const key = String(prodKey||"").trim();
  if(!key) return null;
  const k = key.toLowerCase();
  const list = Array.isArray(blingProducts) ? blingProducts : [];
  for(let i=0;i<list.length;i++){
    const p = list[i] || {};
    const id = String(p.id||"").trim().toLowerCase();
    const codigo = String(p.codigo||"").trim().toLowerCase();
    const nome = String(p.nome||"").trim().toLowerCase();
    if((id && id===k) || (codigo && codigo===k) || (nome && nome===k)) return p;
  }
  return null;
}

function openProdutoDrawer(prodKey){
  const key = String(prodKey||"").trim();
  const p = findProdutoNoCatalogo(key);
  const title = String(p?.nome || key || "Produto").trim() || "Produto";
  const subtitle = p ? (p.codigo ? `Código: ${String(p.codigo)}` : "Catálogo Bling") : "Produto não cadastrado";
  const estoqueTxt = p?.estoque == null ? "—" : String(Number(p.estoque||0).toLocaleString("pt-BR"));
  const precoTxt = p?.preco == null ? "—" : fmtBRL(Number(p.preco||0) || 0);
  const statusTxt = String(p?.situacao || "—");
  const origemTxt = String(p?.origem || "bling");
  const body = `
    <div class="drawer-section">
      <div class="drawer-section-title">Catálogo</div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Código</span><span class="chiva-table-mono">${escapeHTML(String(p?.codigo || key || "—"))}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Estoque</span><span>${escapeHTML(estoqueTxt)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Preço</span><span>${escapeHTML(precoTxt)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Situação</span><span>${escapeHTML(statusTxt)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px"><span style="color:var(--text-3)">Origem</span><span>${escapeHTML(origemTxt)}</span></div>
    </div>
    ${p ? "" : `<div class="drawer-section"><div class="drawer-section-title">Ação</div><div style="font-size:12px;color:var(--text-3);line-height:1.6">Este produto aparece nos itens dos pedidos, mas ainda não existe no catálogo (v2_produtos). Rode a sincronização de produtos ou aguarde o job automático.</div></div>`}
  `;
  openDrawer(title, subtitle, body, `<button class="drawer-btn drawer-btn-ghost" onclick="closeDrawer()">Fechar</button>`);
}

function setProdutosChartState(canvasId, hasData){
  const msgId = canvasId + "-empty";
  let canvas = document.getElementById(canvasId);
  let msg = document.getElementById(msgId);
  let wrap = null;
  if(canvas) wrap = canvas.parentElement;
  if(!wrap && msg) wrap = msg.parentElement;
  if(!wrap) return { canvas: null, shouldRender: false };

  if(!msg){
    msg = document.createElement("div");
    msg.id = msgId;
    msg.className = "empty";
    msg.textContent = "Sem dados";
    msg.style.padding = "22px 0";
    wrap.appendChild(msg);
  }
  if(!canvas){
    canvas = document.createElement("canvas");
    canvas.id = canvasId;
    wrap.insertBefore(canvas, msg);
  }
  if(hasData){
    canvas.style.display = "";
    msg.style.display = "none";
    return { canvas, shouldRender: true };
  }
  canvas.style.display = "none";
  msg.style.display = "";
  return { canvas, shouldRender: false };
}

function renderProdutos(_deferred){
  const detailedEl = document.getElementById("prod-list-detailed");
  if(!_deferred){
    if(detailedEl) detailedEl.innerHTML = `<div class="empty">Carregando produtos...</div>`;
    if(renderProdutos._pending) return;
    renderProdutos._pending = true;
    setTimeout(()=>{ renderProdutos._pending = false; renderProdutos(true); }, 0);
    return;
  }

  const q=(document.getElementById("search-prod")?.value||"").toLowerCase();
  const selCh=document.getElementById("fil-canal-prod");
  if(selCh){
    [...selCh.options].forEach(op=>{
      if(op.value && CH[op.value]) op.textContent=CH[op.value];
    });
  }
  const ch=normCanalKey(selCh?.value||"");
  const per=parseInt(document.getElementById("fil-periodo-prod")?.value||"0");
  const evolucaoDias = parseInt(document.getElementById("fil-evolucao-prod")?.value || "30");
  const now=new Date();
  const m={};
  const catalog = Array.isArray(blingProducts) ? blingProducts : [];
  if(allOrders[0]){
    try{
      console.log("[Pedido exemplo]", allOrders[0], "itens encontrados:", getPedidoItens(allOrders[0]).length);
    }catch(_e){}
  }

  if(!allOrders.length){
    if(detailedEl) detailedEl.innerHTML = `<div class="empty">Nenhum pedido carregado. Sincronize o Bling para ver os dados.</div>`;
    document.getElementById("prod-label").textContent = "0 produtos";
    document.getElementById("prod-kpis-row").innerHTML = "";
    document.getElementById("prod-rankings-row").innerHTML = "";
    if(charts.produtos){ charts.produtos.destroy(); charts.produtos = null; }
    if(charts.prodParticipacao){ charts.prodParticipacao.destroy(); charts.prodParticipacao = null; }
    if(charts.prodEvolucao){ charts.prodEvolucao.destroy(); charts.prodEvolucao = null; }
    setProdutosChartState("chart-produtos", false);
    setProdutosChartState("chart-participacao-produtos", false);
    setProdutosChartState("chart-evolucao-produtos", false);
    return;
  }
  if(!catalog.length){
    if(detailedEl) detailedEl.innerHTML = `<div class="empty">Catálogo do Bling não carregado. Vá em Configurações e sincronize os produtos.</div>`;
    document.getElementById("prod-label").textContent = "0 produtos";
    document.getElementById("prod-kpis-row").innerHTML = "";
    document.getElementById("prod-rankings-row").innerHTML = "";
    if(charts.produtos){ charts.produtos.destroy(); charts.produtos = null; }
    if(charts.prodParticipacao){ charts.prodParticipacao.destroy(); charts.prodParticipacao = null; }
    if(charts.prodEvolucao){ charts.prodEvolucao.destroy(); charts.prodEvolucao = null; }
    setProdutosChartState("chart-produtos", false);
    setProdutosChartState("chart-participacao-produtos", false);
    setProdutosChartState("chart-evolucao-produtos", false);
    return;
  }

  const normProd = (v)=>String(v||"")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9 ]/g," ")
    .replace(/\s+/g," ")
    .trim();
  const catalogByCode = {};
  const catalogByName = {};
  catalog.forEach(p=>{
    const code = String(p?.codigo||"").trim();
    const name = String(p?.nome||"").trim();
    if(code) catalogByCode[code] = p;
    const nk = normProd(name);
    if(nk && !catalogByName[nk]) catalogByName[nk] = p;
  });
  
  // Processamento de dados base
  allOrders
    .filter(o=>!ch||(normCanalKey(detectCh(o))===ch))
    .filter(o=>{ if(!per)return true; const d=new Date(o.data||o.dataPedido); return (now-d)/(86400000)<=per; })
    .forEach(o=>{
      const itens = getPedidoItens(o);
      itens.forEach(it=>{
      const code = String(it?.codigo || "").trim();
      const descRaw = String(it?.descricao || it?.produto_nome || "").trim();
      const descKey = normProd(descRaw);
      const catByCode = (code && catalogByCode[code]) ? catalogByCode[code] : null;
      const catByName = (!catByCode && descKey && catalogByName[descKey]) ? catalogByName[descKey] : null;
      const cat = catByCode || catByName;
      const k = String((cat?.codigo ? cat.codigo : "") || code || descKey || descRaw || "?").trim() || "?";
      const canal = normCanalKey(detectCh(o)) || "outros";
      const dataStr = o.data || o.dataPedido || "";
      
      if(!m[k]) m[k] = {
        nome: String((cat?.nome || "") || descRaw || k),
        code: String((cat?.codigo || "") || code || ""),
        total: 0,
        qty: 0,
        peds: new Set(),
        clis: new Set(),
        lastVenda: "",
        canais: {shopify:0, amazon:0, shopee:0, outros:0, ml:0, cnpj:0, yampi:0},
        historico: {} // { "YYYY-MM-DD": total }
      };
      
      const qtd = Number(it?.quantidade ?? it?.quantity ?? it?.qty ?? 1) || 1;
      const valorUnit = Number(it?.valor ?? it?.valor_unitario ?? it?.price ?? it?.preco ?? 0) || 0;
      const valorTotal =
        it?.valor_total != null
          ? (Number(it.valor_total) || 0)
          : (valorUnit * qtd);
      
      m[k].total += valorTotal;
      m[k].qty += qtd;
      m[k].peds.add(o.id||o.numero);
      m[k].clis.add(cliKey(o));
      
      if(!m[k].lastVenda || dataStr > m[k].lastVenda) m[k].lastVenda = dataStr;
      
      if(m[k].canais.hasOwnProperty(canal)) m[k].canais[canal] += qtd;
      else m[k].canais.outros += qtd;
      
      if(dataStr) {
        const dStr = dataStr.slice(0, 10);
        m[k].historico[dStr] = (m[k].historico[dStr]||0) + valorTotal;
      }
    });
    });

  if(catalog.length){
    catalog.forEach(p=>{
      const code = String(p?.codigo||"").trim();
      const name = String(p?.nome||"").trim();
      const key = code || normProd(name) || name || String(p?.id||"").trim();
      if(!key) return;
      if(!m[key]) m[key] = {
        nome: name || key,
        code: code || "",
        total: 0,
        qty: 0,
        peds: new Set(),
        clis: new Set(),
        lastVenda: "",
        canais: {shopify:0, amazon:0, shopee:0, outros:0, ml:0, cnpj:0, yampi:0},
        historico: {}
      };
      if(name && (!m[key].nome || m[key].nome === "?" || m[key].nome === key)) m[key].nome = name;
      if(code && !m[key].code) m[key].code = code;
      if(p?.estoque != null) m[key].estoque = Number(p.estoque||0) || 0;
      if(p?.preco != null) m[key].preco = Number(p.preco||0) || 0;
      if(p?.situacao) m[key].situacao_catalogo = String(p.situacao||"");
    });
  }

  let prods = Object.values(m).sort((a,b)=>b.total-a.total);
  if(q) prods = prods.filter(p=>p.nome.toLowerCase().includes(q)||p.code.toLowerCase().includes(q));
  
  document.getElementById("prod-label").textContent = `${prods.length} produto${prods.length!==1?"s/sabores":""}`;

  // 1. Cards de KPI no Topo
  const prodsComVenda = prods.filter(p=>p.qty>0 || p.total>0);
  console.log("[Produtos] Cruzamento resultou em:", prodsComVenda.length, "produtos com vendas");
  if(!prodsComVenda.length){
    const msg = `Nenhum dos ${catalog.length} produtos do catálogo foi vendido no período. Verifique se os códigos dos itens dos pedidos batem com o catálogo do Bling.`;
    if(detailedEl) detailedEl.innerHTML = `<div class="empty">${escapeHTML(msg)}</div>`;
    document.getElementById("prod-label").textContent = "0 produtos";
    document.getElementById("prod-kpis-row").innerHTML = "";
    document.getElementById("prod-rankings-row").innerHTML = "";
    if(charts.produtos){ charts.produtos.destroy(); charts.produtos = null; }
    if(charts.prodParticipacao){ charts.prodParticipacao.destroy(); charts.prodParticipacao = null; }
    if(charts.prodEvolucao){ charts.prodEvolucao.destroy(); charts.prodEvolucao = null; }
    setProdutosChartState("chart-produtos", false);
    setProdutosChartState("chart-participacao-produtos", false);
    setProdutosChartState("chart-evolucao-produtos", false);
    return;
  }
  const topVendido = prodsComVenda.length ? prodsComVenda.reduce((a, b) => (a.qty > b.qty ? a : b), {nome:"—", qty:0}) : {nome:"—", qty:0};
  const topReceita = prodsComVenda.length ? (prodsComVenda.slice().sort((a,b)=>b.total-a.total)[0] || {nome:"—", total:0}) : {nome:"—", total:0};
  
  // Calcular crescimento (últimos 7 dias vs 7 dias anteriores)
  const calculateGrowth = (prod) => {
    const week1 = 7, week2 = 14;
    const nowTs = now.getTime();
    let v1 = 0, v2 = 0;
    Object.entries(prod.historico).forEach(([d, v]) => {
      const ts = new Date(d).getTime();
      const diff = (nowTs - ts) / 86400000;
      const nv = Number(v) || 0;
      if(diff <= week1) v1 += nv;
      else if(diff <= week2) v2 += nv;
    });
    return v2 > 0 ? ((v1 - v2) / v2) * 100 : (v1 > 0 ? 100 : 0);
  };
  
  const growths = prods.map(p => ({p, g: calculateGrowth(p)})).sort((a,b) => b.g - a.g);
  const topGrowth = growths[0]?.g > 0 ? growths[0] : {p:{nome:"—"}, g:0};
  const topDecline = growths[growths.length-1]?.g < 0 ? growths[growths.length-1] : {p:{nome:"—"}, g:0};

  const kpisHtml = `
    <div class="stat" style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 2px 6px rgba(0,0,0,0.04)">
      <div class="stat-label" style="font-size:11px;color:var(--text-3);font-weight:600;text-transform:uppercase">Mais Vendido</div>
      <div class="stat-value" style="font-size:18px;font-weight:800;margin:4px 0">${escapeHTML(topVendido.nome)}</div>
      <div class="stat-sub" style="font-size:11px;color:var(--blue);font-weight:600">${topVendido.qty.toLocaleString("pt-BR")} unidades</div>
    </div>
    <div class="stat" style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 2px 6px rgba(0,0,0,0.04)">
      <div class="stat-label" style="font-size:11px;color:var(--text-3);font-weight:600;text-transform:uppercase">Maior Receita</div>
      <div class="stat-value" style="font-size:18px;font-weight:800;margin:4px 0">${escapeHTML(topReceita.nome)}</div>
      <div class="stat-sub" style="font-size:11px;color:var(--green);font-weight:600">${fmtBRL(topReceita.total)}</div>
    </div>
    <div class="stat" style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 2px 6px rgba(0,0,0,0.04)">
      <div class="stat-label" style="font-size:11px;color:var(--text-3);font-weight:600;text-transform:uppercase">Maior Crescimento</div>
      <div class="stat-value" style="font-size:18px;font-weight:800;margin:4px 0">${escapeHTML(topGrowth.p.nome)}</div>
      <div class="stat-sub" style="font-size:11px;color:var(--green);font-weight:600">▲ ${topGrowth.g.toFixed(1)}% (7d)</div>
    </div>
    <div class="stat" style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 2px 6px rgba(0,0,0,0.04)">
      <div class="stat-label" style="font-size:11px;color:var(--text-3);font-weight:600;text-transform:uppercase">Queda de Vendas</div>
      <div class="stat-value" style="font-size:18px;font-weight:800;margin:4px 0">${escapeHTML(topDecline.p.nome)}</div>
      <div class="stat-sub" style="font-size:11px;color:var(--red);font-weight:600">▼ ${Math.abs(topDecline.g).toFixed(1)}% (7d)</div>
    </div>
  `;
  document.getElementById("prod-kpis-row").innerHTML = kpisHtml;

  // 2. Gráfico de Receita por Produto (TOP 10)
  const top10 = prods.slice(0,10);
  if(charts.produtos){ charts.produtos.destroy(); charts.produtos = null; }
  const barState = setProdutosChartState("chart-produtos", top10.length > 0);
  const ctxP = barState.canvas;
  if(barState.shouldRender && ctxP && ctxP.getContext){
    charts.produtos=new Chart(ctxP,{type:"bar",data:{
      labels:top10.map(p=>p.nome.length>18?p.nome.slice(0,16)+"…":p.nome),
      datasets:[{
        data:top10.map(p=>p.total),
        backgroundColor:'rgba(15,167,101,0.8)',
        hoverBackgroundColor:'rgba(15,167,101,1)',
        borderRadius:6,
        borderSkipped:false
      }]
    },options:{
      indexAxis:'y',
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{label:ctx=>" "+fmtBRL(ctx.raw)}
        }
      },
      scales:{
        x:{grid:{display:false},ticks:{color:'#585f78',font:{size:9},callback:v=>v>=1000?(v/1000).toFixed(0)+'k':v}},
        y:{grid:{display:false},ticks:{color:'#585f78',font:{size:10,weight:'600'}}}
      },
      animation: { duration: 1000, easing: 'easeOutQuart' }
    }});
  }

  // 3. Gráfico de Participação (Donut)
  const totalReceita = prods.reduce((s,p)=>s+p.total, 0);
  if(charts.prodParticipacao){ charts.prodParticipacao.destroy(); charts.prodParticipacao = null; }
  const donutState = setProdutosChartState("chart-participacao-produtos", top10.length > 0);
  const ctxPart = donutState.canvas;
  if(donutState.shouldRender && ctxPart && ctxPart.getContext){
    const otherTotal = totalReceita - top10.reduce((s,p)=>s+p.total,0);
    const partData = top10.map(p=>p.total);
    const partLabels = top10.map(p=>p.nome);
    if(otherTotal > 0) { partData.push(otherTotal); partLabels.push("Outros"); }
    
    charts.prodParticipacao = new Chart(ctxPart, {
      type: "doughnut",
      data: {
        labels: partLabels.map(l=>l.length>15?l.slice(0,13)+"…":l),
        datasets: [{
          data: partData,
          backgroundColor: [
            '#0FA765', '#22d3ee', '#84cc16', '#fbbf24', '#f97316', 
            '#d946ef', '#6366f1', '#f43f5e', '#14b8a6', '#f59e0b', '#94a3b8'
          ],
          borderWidth: 2,
          borderColor: 'var(--card)',
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: { callbacks: { label: ctx => {
            const pct = ((ctx.raw/totalReceita)*100).toFixed(1);
            return ` ${ctx.label}: ${fmtBRL(ctx.raw)} (${pct}%)`;
          }}}
        },
        cutout: '65%'
      }
    });
  }

  // 4. Gráfico de Evolução (Linha)
  if(charts.prodEvolucao){ charts.prodEvolucao.destroy(); charts.prodEvolucao = null; }
  const lineState = setProdutosChartState("chart-evolucao-produtos", top10.length > 0);
  const ctxEv = lineState.canvas;
  if(lineState.shouldRender && ctxEv && ctxEv.getContext){
    const labels = [];
    for(let i=evolucaoDias-1; i>=0; i--){
      const d = new Date(now.getTime() - i*86400000);
      labels.push(d.toISOString().slice(0,10));
    }
    
    const datasets = top10.slice(0, 5).map((p, idx) => {
      const colors = ['#0FA765', '#22d3ee', '#fbbf24', '#d946ef', '#f97316'];
      return {
        label: p.nome,
        data: labels.map(l => p.historico[l] || 0),
        borderColor: colors[idx],
        backgroundColor: colors[idx] + '10',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2
      };
    });
    
    charts.prodEvolucao = new Chart(ctxEv, {
      type: "line",
      data: { labels: labels.map(l => l.split("-").slice(1).reverse().join("/")), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 9 }, maxTicksLimit: 10 } },
          y: { grid: { color: 'rgba(255,255,255,.04)' }, ticks: { font: { size: 9 }, callback: v => 'R$'+v } }
        }
      }
    });
  }

  // 5. Rankings
  const rankingsHtml = `
    <div style="background:var(--card);border-radius:14px;padding:16px;border:1px solid var(--border);box-shadow:0 2px 6px rgba(0,0,0,0.04)">
      <div style="font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:12px">🏆 TOP 10 POR RECEITA</div>
      ${prods.slice(0,10).map((p,i)=>`
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span style="font-size:12px;font-weight:800;color:var(--blue);width:20px">${i+1}</span>
          <span style="flex:1;font-size:11px;font-weight:600">${escapeHTML(p.nome)}</span>
          <span style="font-size:11px;font-weight:700;color:var(--green)">${fmtBRL(p.total)}</span>
        </div>`).join("")}
    </div>
    <div style="background:var(--card);border-radius:14px;padding:16px;border:1px solid var(--border);box-shadow:0 2px 6px rgba(0,0,0,0.04)">
      <div style="font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:12px">📦 TOP 10 POR QUANTIDADE</div>
      ${prods.sort((a,b)=>b.qty-a.qty).slice(0,10).map((p,i)=>`
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span style="font-size:12px;font-weight:800;color:var(--blue);width:20px">${i+1}</span>
          <span style="flex:1;font-size:11px;font-weight:600">${escapeHTML(p.nome)}</span>
          <span style="font-size:11px;font-weight:700;color:var(--text-2)">${p.qty.toLocaleString("pt-BR")} un</span>
        </div>`).join("")}
    </div>
    <div style="background:var(--card);border-radius:14px;padding:16px;border:1px solid var(--border);box-shadow:0 2px 6px rgba(0,0,0,0.04)">
      <div style="font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:12px">🛒 TOP 10 POR PEDIDOS</div>
      ${prods.sort((a,b)=>b.peds.size-a.peds.size).slice(0,10).map((p,i)=>`
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span style="font-size:12px;font-weight:800;color:var(--blue);width:20px">${i+1}</span>
          <span style="flex:1;font-size:11px;font-weight:600">${escapeHTML(p.nome)}</span>
          <span style="font-size:11px;font-weight:700;color:var(--text-2)">${p.peds.size} ped.</span>
        </div>`).join("")}
    </div>
  `;
  document.getElementById("prod-rankings-row").innerHTML = rankingsHtml;

  // 6. Lista Detalhada
  const avgBase = prodsComVenda.length ? prodsComVenda : prods;
  const avgQty = avgBase.reduce((s,p)=>s+p.qty,0)/avgBase.length || 1;
  const avgTotal = avgBase.reduce((s,p)=>s+p.total,0)/avgBase.length || 1;

  document.getElementById("prod-list-detailed").innerHTML = `
    <table class="chiva-table" style="width:100%;min-width:980px">
      <thead>
        <tr>
          <th>Produto</th>
          <th style="text-align:right">Estoque</th>
          <th style="text-align:right">Vendas</th>
          <th style="text-align:right">Receita</th>
          <th style="text-align:right">Ticket Médio</th>
          <th style="text-align:right">Pedidos</th>
          <th>Última Venda</th>
          <th>Canais (Qtd)</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${prods.map(p => {
          const tm = p.peds.size ? (p.total / p.peds.size) : 0;
          let status = '<span class="chiva-badge chiva-badge-amber">MÉDIO</span>';
          if(p.total > avgTotal * 1.5 || p.qty > avgQty * 1.5) status = '<span class="chiva-badge chiva-badge-green">🟢 LÍDER</span>';
          else if(p.total < avgTotal * 0.5) status = '<span class="chiva-badge chiva-badge-red">🔴 BAIXO</span>';
          
          const canaisHtml = Object.entries(p.canais)
            .filter(([,q])=>q>0)
            .map(([c,q])=>`<span style="font-size:9px;background:var(--border);padding:2px 5px;border-radius:4px;margin-right:3px" title="${CH[c]||c}">${(CH[c]||c).slice(0,3).toUpperCase()}: ${q}</span>`)
            .join("");

          const clickKey = escapeJsSingleQuote(String(p.code || p.nome || "").trim());
          return `
            <tr onclick="openProdutoDrawer('${clickKey}')" style="cursor:pointer">
              <td>
                <div style="font-weight:700">${escapeHTML(p.nome)}</div>
                <div style="font-size:10px;color:var(--text-3)">${escapeHTML(p.code)}</div>
              </td>
              <td style="text-align:right;font-weight:700">${p.estoque==null?"—":Number(p.estoque||0).toLocaleString("pt-BR")}</td>
              <td style="text-align:right;font-weight:700">${p.qty.toLocaleString("pt-BR")}</td>
              <td style="text-align:right;font-weight:800;color:var(--green)">${fmtBRL(p.total)}</td>
              <td style="text-align:right;font-size:11px">${fmtBRL(tm)}</td>
              <td style="text-align:right;font-size:11px">${p.peds.size}</td>
              <td style="font-size:11px;color:var(--text-3)">${fmtDate(p.lastVenda)}</td>
              <td>${canaisHtml}</td>
              <td>${status}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}


// ═══════════════════════════════════════════════════
//  CIDADES
// ═══════════════════════════════════════════════════
async function renderCidades(){
  const q = (document.getElementById("search-city")?.value||"").toLowerCase();
  const ufFilter = document.getElementById("fil-uf")?.value||"";
  const canalFilter = String(document.getElementById("fil-geo-canal")?.value||"").toLowerCase().trim();
  const typeFilter = document.getElementById("fil-geo-venda")?.value||"all";
  
  // 1. Carregar estados do Supabase se ainda não carregados
  if(supaConnected && !geoEstados.length){
    const {data} = await supaClient.from("estados").select("*").order("nome");
    if(data) geoEstados = data;
    // Popular select de UF
    const selUF = document.getElementById("fil-uf");
    if(selUF && geoEstados.length){
      selUF.innerHTML = '<option value="">Todos os Estados</option>' + 
        geoEstados.map(e => `<option value="${e.sigla}">${e.nome}</option>`).join("");
    }
  }

  // 2. Processar vendas por localidade
  const salesMap = {};
  const stateMap = {};
  geoEstados.forEach(e => { stateMap[e.sigla] = { ...e, total: 0, clis: new Set(), peds: 0 }; });

  allOrders.forEach(o => {
    if(canalFilter && detectCh(o)!==canalFilter) return;
    const ci = String(o?.cidade_entrega || o.contato?.endereco?.municipio || o.contato?.municipio || "").trim();
    const es = normalizeUF(o?.uf_entrega || o.contato?.endereco?.uf || o.contato?.uf || "");
    if(!ci || !es) return;
    
    const k = ci + "|" + es;
    if(!salesMap[k]) salesMap[k] = { ci, es, total: 0, peds: 0, clis: new Set() };
    salesMap[k].total += val(o);
    salesMap[k].peds++;
    salesMap[k].clis.add(orderCustomerKey(o));

    if(stateMap[es]){
      stateMap[es].total += val(o);
      stateMap[es].peds++;
      stateMap[es].clis.add(orderCustomerKey(o));
    }
  });

  // 3. Buscar cidades do Supabase baseadas no filtro
  let cities = [];
  if(supaConnected){
    let query = supaClient.from("cidades").select("*");
    if(ufFilter) query = query.eq("estado_sigla", ufFilter);
    if(q) query = query.ilike("nome", `%${q}%`);
    const {data} = await query.limit(q || ufFilter ? 1000 : 200).order("nome");
    cities = data || [];
  }

  // 4. Mesclar dados de vendas com a base de cidades
  const mergedCities = cities.map(c => {
    const sales = salesMap[c.nome + "|" + c.estado_sigla] || { total: 0, peds: 0, clis: new Set() };
    return { ...c, ...sales, clisCount: sales.clis.size };
  });

  // Se estiver pesquisando e não houver no Supabase, mostrar apenas o que tem nas vendas
  if(!mergedCities.length && (q || ufFilter)){
    Object.values(salesMap).forEach(s => {
      if((!ufFilter || s.es === ufFilter) && (!q || s.ci.toLowerCase().includes(q))){
        mergedCities.push({ id: 0, nome: s.ci, estado_sigla: s.es, ...s, clisCount: s.clis.size });
      }
    });
  }

  let finalCities = mergedCities;
  if(typeFilter === "with") finalCities = finalCities.filter(c => c.total > 0);
  if(typeFilter === "without") finalCities = finalCities.filter(c => c.total === 0);
  
  finalCities.sort((a,b) => b.total - a.total || a.nome.localeCompare(b.nome));

  // 5. Renderizar KPIs
  const totalEstadosVendas = Object.values(stateMap).filter(s => s.total > 0).length;
  const totalCidadesVendas = Object.values(salesMap).filter(s => s.total > 0).length;
  const topEstado = Object.values(stateMap).sort((a,b) => b.total - a.total)[0] || { sigla: "—", total: 0 };

  document.getElementById("geo-kpis-row").innerHTML = `
    <div class="stat-card-modern">
      <div class="stat-label">COBERTURA</div>
      <div class="stat-value">${totalEstadosVendas}/27 <span style="font-size:12px;font-weight:500">Estados</span></div>
      <div class="stat-sub">${totalCidadesVendas} cidades atendidas</div>
    </div>
    <div class="stat-card-modern">
      <div class="stat-label">LÍDER GEOGRÁFICO</div>
      <div class="stat-value">${topEstado.sigla}</div>
      <div class="stat-sub">${fmtBRL(topEstado.total)} em faturamento</div>
    </div>
    <div class="stat-card-modern">
      <div class="stat-label">POTENCIAL</div>
      <div class="stat-value">${(5570 - totalCidadesVendas).toLocaleString()}</div>
      <div class="stat-sub">Cidades brasileiras sem vendas</div>
    </div>
  `;

  // 6. Gráfico de Estados
  renderGeoChart(Object.values(stateMap));

  // 7. Mapa Heatmap (SVG)
  renderBrazilMap(stateMap, { canal: canalFilter });

  // 8. Tabela Detalhada
  const maxTotal = finalCities[0]?.total || 1;
  document.getElementById("city-table-detailed").innerHTML = `
    <table class="chiva-table">
      <thead>
        <tr>
          <th>Cidade</th>
          <th style="text-align:right">Clientes</th>
          <th style="text-align:right">Pedidos</th>
          <th style="text-align:right">Receita</th>
          <th>Penetração</th>
        </tr>
      </thead>
      <tbody>
        ${finalCities.map(c => `
          <tr>
            <td>
              <div style="font-weight:700">${escapeHTML(c.nome)}</div>
              <div style="font-size:10px;color:var(--text-3)">${escapeHTML(c.estado_sigla)}</div>
            </td>
            <td style="text-align:right">${c.clisCount}</td>
            <td style="text-align:right">${c.peds}</td>
            <td style="text-align:right;font-weight:700;color:var(--green)">${fmtBRL(c.total)}</td>
            <td>
              <div class="cidade-bar-track" style="width:80px">
                <div class="cidade-bar" style="width:${Math.min(100, (c.total/maxTotal)*100)}%"></div>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  // 9. Top 20 Cidades Ranking
  const top20 = Object.values(salesMap).sort((a,b) => b.total - a.total).slice(0,20);
  document.getElementById("geo-top-cities").innerHTML = top20.map((c, i) => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:11px">
      <span style="font-weight:800;color:var(--blue);width:20px">${i+1}</span>
      <span style="flex:1;font-weight:600">${escapeHTML(c.ci)} (${c.es})</span>
      <span style="font-weight:700">${fmtBRL(c.total)}</span>
    </div>
  `).join("") || '<div class="empty">Sem vendas registradas</div>';

  // Mostrar botão de importação se o banco estiver vazio
  if(supaConnected && !cities.length && !q && !ufFilter){
    document.getElementById("geo-sync-box").style.display = "block";
  } else {
    document.getElementById("geo-sync-box").style.display = "none";
  }
}

function renderGeoChart(data){
  if(charts.geoEstados) charts.geoEstados.destroy();
  const top = data.filter(s => s.total > 0).sort((a,b) => b.total - a.total).slice(0,10);
  const ctx = document.getElementById("chart-geo-estados");
  if(!ctx || !ctx.getContext || !top.length) return;

  charts.geoEstados = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(s => s.sigla),
      datasets: [{
        label: 'Receita',
        data: top.map(s => s.total),
        backgroundColor: 'rgba(34, 211, 238, 0.8)',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { display: false }, ticks: { font: { size: 10 } } },
        x: { grid: { display: false }, ticks: { font: { size: 10, weight: '700' } } }
      }
    }
  });
}

let brazilMapSvgEl = null;
let brazilMapSvgPromise = null;
let brazilMapBound = false;
let geoMapTooltipEl = null;
let geoMapStateNameByUf = {};
let geoMapCanalLabel = "";

function clamp01(n){ return Math.max(0, Math.min(1, Number(n)||0)); }
function hexToRgb(hex){
  const h = String(hex||"").replace("#","").trim();
  if(h.length===3){
    const r=parseInt(h[0]+h[0],16), g=parseInt(h[1]+h[1],16), b=parseInt(h[2]+h[2],16);
    return {r,g,b};
  }
  if(h.length===6){
    const r=parseInt(h.slice(0,2),16), g=parseInt(h.slice(2,4),16), b=parseInt(h.slice(4,6),16);
    return {r,g,b};
  }
  return {r:0,g:0,b:0};
}
function rgbToHex(r,g,b){
  const hx = (v)=>Math.round(Number(v)||0).toString(16).padStart(2,"0");
  return "#"+hx(r)+hx(g)+hx(b);
}
function lerp(a,b,t){ return a + (b-a)*t; }
function lerpColor(aHex,bHex,t){
  const a = hexToRgb(aHex), b = hexToRgb(bHex);
  const tt = clamp01(t);
  return rgbToHex(lerp(a.r,b.r,tt), lerp(a.g,b.g,tt), lerp(a.b,b.b,tt));
}

async function ensureBrazilMapSvg(container){
  if(brazilMapSvgEl) return brazilMapSvgEl;
  if(!brazilMapSvgPromise){
    brazilMapSvgPromise = (async()=>{
      const url = new URL("./assets/brazil-states.svg", window.location.href).toString();
      const resp = await fetch(url);
      if(!resp.ok) throw new Error("Falha ao carregar SVG do mapa do Brasil");
      const text = await resp.text();
      const tmp = document.createElement("div");
      tmp.innerHTML = String(text||"").trim();
      const svg = tmp.querySelector("svg");
      if(!svg) throw new Error("SVG inválido do mapa do Brasil");
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.setAttribute("aria-label", "Mapa do Brasil por estado");
      svg.querySelectorAll(".state").forEach(el=>{
        if(!el.getAttribute("id")) return;
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "img");
      });
      brazilMapSvgEl = svg;
      if(container && !container.contains(svg)) container.appendChild(svg);
    })();
  }
  await brazilMapSvgPromise;
  return brazilMapSvgEl;
}

function renderBrazilMap(stateMap, options){
  const container = document.getElementById("brazil-map-container");
  if(!container) return;

  const canal = String(options?.canal||"").toLowerCase().trim();
  const canalLabel = canal ? (CH[canal] || canal) : "Todos os canais";

  const stateNameByUf = {};
  Object.values(stateMap||{}).forEach(s=>{
    const uf = String(s?.sigla||"").trim().toUpperCase();
    if(uf) stateNameByUf[uf] = String(s?.nome||"").trim();
  });
  geoMapStateNameByUf = stateNameByUf;
  geoMapCanalLabel = canalLabel;

  const totals = Object.values(stateMap||{}).map(s=>Number(s?.total||0)||0);
  const maxTotal = Math.max(1, ...totals);
  const getFill = (val)=>{
    const v = Number(val||0) || 0;
    if(v<=0) return "#eef2f7";
    const t = Math.sqrt(v / maxTotal);
    return lerpColor("#dbeafe", "#1e1b4b", t);
  };

  container.innerHTML = "";
  ensureBrazilMapSvg(container).then(svg=>{
    if(!svg) return;
    if(!container.contains(svg)) container.appendChild(svg);

    const tooltip = document.createElement("div");
    tooltip.className = "geo-map-tooltip";
    tooltip.style.display = "none";
    geoMapTooltipEl = tooltip;

    const legend = document.createElement("div");
    legend.className = "geo-map-legend";
    legend.innerHTML = `<span class="lbl">${escapeHTML(fmtBRL(0))}</span><span class="bar"></span><span class="lbl">${escapeHTML(fmtBRL(maxTotal))}</span>`;

    container.appendChild(tooltip);
    container.appendChild(legend);

    const stateEls = svg.querySelectorAll(".state[id]");
    stateEls.forEach(el=>{
      const uf = String(el.getAttribute("id")||"").trim().toUpperCase();
      const s = stateMap?.[uf] || { total: 0, peds: 0, clis: new Set() };
      const total = Number(s?.total||0) || 0;
      const peds = Number(s?.peds||0) || 0;
      const clisCount = s?.clis && typeof s.clis.size === "number" ? s.clis.size : (Number(s?.clisCount||0)||0);
      el.style.fill = getFill(total);
      el.style.opacity = total>0 ? "1" : "0.7";
      el.setAttribute("data-total", String(total));
      el.setAttribute("data-peds", String(peds));
      el.setAttribute("data-clis", String(clisCount));
      el.setAttribute("aria-label", `${uf}: ${fmtBRL(total)}`);
    });

    if(!brazilMapBound){
      brazilMapBound = true;
      const show = (target, clientX, clientY)=>{
        if(!geoMapTooltipEl) return;
        const uf = String(target?.getAttribute("id")||"").trim().toUpperCase();
        const total = Number(target?.getAttribute("data-total")||0) || 0;
        const peds = Number(target?.getAttribute("data-peds")||0) || 0;
        const clis = Number(target?.getAttribute("data-clis")||0) || 0;
        const name = geoMapStateNameByUf[uf] || uf;
        geoMapTooltipEl.innerHTML =
          `<div class="tt-title">${escapeHTML(uf)} — ${escapeHTML(name)}</div>`+
          `<div>${escapeHTML(fmtBRL(total))} • ${escapeHTML(String(peds))} pedidos • ${escapeHTML(String(clis))} clientes</div>`+
          `<div>${escapeHTML(geoMapCanalLabel)}</div>`;
        geoMapTooltipEl.style.display = "block";
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        geoMapTooltipEl.style.left = Math.max(0, Math.min(rect.width - 10, x)) + "px";
        geoMapTooltipEl.style.top = Math.max(0, Math.min(rect.height - 10, y)) + "px";
      };
      const hide = ()=>{
        if(geoMapTooltipEl) geoMapTooltipEl.style.display = "none";
      };
      svg.addEventListener("mousemove",(e)=>{
        const t = e.target;
        if(t && t.classList && t.classList.contains("state") && t.getAttribute("id")){
          show(t, e.clientX, e.clientY);
        }
      });
      svg.addEventListener("mouseleave", hide);
      svg.addEventListener("blur", hide, true);
      svg.addEventListener("focusin",(e)=>{
        const t = e.target;
        if(t && t.classList && t.classList.contains("state") && t.getAttribute("id")){
          const rect = t.getBoundingClientRect();
          show(t, rect.left + rect.width/2, rect.top + rect.height/2);
        }
      });
      svg.addEventListener("focusout", hide);
    }
  }).catch(()=>{
    container.innerHTML = `<div style="font-size:11px;color:var(--text-3);padding:10px">Mapa indisponível.</div>`;
  });
}

async function seedCidadesIBGE(){
  if(!supaConnected || !supaClient) return;
  const btn = document.querySelector("#geo-sync-box button");
  btn.disabled = true;
  btn.textContent = "⌛ Importando (IBGE)...";
  
  try {
    // 1. Buscar todos os municípios via API do IBGE
    const resp = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios");
    const data = await resp.json();
    
    // 2. Preparar lotes para o Supabase
    const rows = data.map(m => ({
      id: m.id,
      nome: m.nome,
      estado_id: m.microrregiao.mesorregiao.UF.id,
      estado_sigla: m.microrregiao.mesorregiao.UF.sigla,
      nome_slug: m.nome.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    }));

    // 3. Inserir em lotes de 500
    for(let i=0; i<rows.length; i+=500){
      const batch = rows.slice(i, i+500);
      const {error} = await supaClient.from("cidades").upsert(batch);
      if(error) throw error;
      btn.textContent = `⌛ Importando (${Math.round((i/rows.length)*100)}%)`;
    }

    toast("✅ Base IBGE importada com sucesso!");
    renderCidades();
  } catch(e) {
    console.error(e);
    toast("❌ Erro na importação: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "📥 Importar Base IBGE";
  }
}


function renderAlertas(){
  const ad=parseInt(document.getElementById("alert-days")?.value||"60");
  const inat=Object.values(buildCli(allOrders)).filter(c=>daysSince(c.last)>ad&&!isCNPJ(c.doc)).sort((a,b)=>daysSince(b.last)-daysSince(a.last));
  document.getElementById("alert-label").textContent=`${inat.length} cliente${inat.length!==1?"s":""} sem comprar há mais de ${ad} dias`;
  document.getElementById("alert-list").innerHTML=inat.length?inat.map((c,i)=>renderCliCard(c,"al"+i)).join(""):`<div class="empty">🎉 Nenhum cliente inativo por mais de ${ad} dias!</div>`;
}

// ═══════════════════════════════════════════════════
//  EXPORT CSV
// ═══════════════════════════════════════════════════
function csvEscape(v){
  const s = String(v ?? "").replace(/"/g, '""');
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
}

function downloadCSV(filename, rows){
  const blob = new Blob(["\uFEFF" + rows.map(r => r.map(csvEscape).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportClientesCSV(){
  const source = clientesIntelCache.length ? clientesIntelCache : Object.values(buildCli(allOrders));
  if(!source.length){ toast("Nenhum cliente para exportar", "warning"); return; }
  const header = ["Nome","E-mail","Telefone","Documento","Canal","Status","Segmento","UF","Cidade","LTV (R$)","Total Pedidos","Dias desde última compra","Score Recompra","Risco Churn","Próxima Ação"];
  const rows = source.map(c => [
    c.nome || "",
    c.email || "",
    c.telefone || c.celular || "",
    c.doc || "",
    c.canal_principal || "",
    c.status || "",
    c.segmento_crm || "",
    c.uf || "",
    c.cidade || "",
    (c.ltv ?? c.total_gasto ?? c.orders?.reduce((s,o)=>s+val(o),0) ?? 0).toFixed(2),
    c.total_pedidos ?? c.orders?.length ?? 0,
    c.dias_desde_ultima_compra ?? "",
    c.score_recompra ?? "",
    c.risco_churn ?? "",
    c.next_best_action || ""
  ]);
  const today = new Date().toISOString().slice(0,10);
  downloadCSV(`clientes-chivafit-${today}.csv`, [header, ...rows]);
  toast(`✓ ${source.length} clientes exportados`, "success");
}

function exportPedidosCSV(){
  const orders = [...allOrders].sort((a,b) => String(b.data||"").localeCompare(String(a.data||"")));
  if(!orders.length){ toast("Nenhum pedido para exportar", "warning"); return; }
  const header = ["Número","Data","Canal","Cliente","E-mail","Telefone","Status","Total (R$)"];
  const rows = orders.map(o => [
    o.numero || o.numero_pedido || o.id || "",
    (o.data || "").slice(0,10),
    o._source || o._canal || detectCh(o) || "",
    o.contato?.nome || "",
    o.contato?.email || "",
    o.contato?.telefone || "",
    o.situacao?.nome || o.status || "",
    val(o).toFixed(2)
  ]);
  const today = new Date().toISOString().slice(0,10);
  downloadCSV(`pedidos-chivafit-${today}.csv`, [header, ...rows]);
  toast(`✓ ${orders.length} pedidos exportados`, "success");
}

// ═══════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════
function toast(m, type){
  const e = document.getElementById("toast");
  if(!e) return;
  e.textContent = m;
  e.className = "show" + (type === "error" ? " toast-error" : type === "success" ? " toast-success" : type === "warning" ? " toast-warning" : "");
  clearTimeout(e._toastTimer);
  e._toastTimer = setTimeout(() => e.classList.remove("show"), type === "error" ? 5000 : 2500);
}
const PENDING_OPS_KEY = "crm_pending_ops_v1";
let pendingOpsTimer = null;

function readPendingOps(){
  try{
    const raw = localStorage.getItem(PENDING_OPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  }catch(_e){
    return [];
  }
}

function writePendingOps(ops){
  try{
    localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(Array.isArray(ops) ? ops : []));
  }catch(_e){}
}

function setSyncStatus(status, meta){
  const el = document.getElementById("sync-dot");
  const txt = document.getElementById("sync-txt");
  const timeEl = document.getElementById("sync-time");
  if(!el || !txt) return;

  const st = String(status || "").toLowerCase();
  el.classList.remove("off","pending","pulse");
  if(st === "offline"){
    el.classList.add("off");
    txt.textContent = "Offline";
  }else if(st === "pending"){
    el.classList.add("pending","pulse");
    txt.textContent = "Sync pendente";
  }else{
    txt.textContent = "Sincronizado";
    const nowIso = new Date().toISOString();
    localStorage.setItem("crm_last_sync_ok", nowIso);
  }

  const lastIso = meta?.time || localStorage.getItem("crm_last_sync_ok") || "";
  if(timeEl){
    if(lastIso){
      const d = new Date(lastIso);
      timeEl.textContent = isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    }else{
      timeEl.textContent = "";
    }
  }
}

function setSyncDot(on){ setSyncStatus(on ? "ok" : "offline"); }

function enqueueUpsert(table, rows, onConflict){
  const ops = readPendingOps();
  ops.push({
    id: String(Date.now()) + String(Math.random()).slice(2),
    op: "upsert",
    table: String(table||""),
    onConflict: onConflict ? String(onConflict) : null,
    rows: Array.isArray(rows) ? rows : [],
    createdAt: new Date().toISOString()
  });
  writePendingOps(ops);
  setSyncStatus("pending");
}

function handleSyncError(context, error, meta){
  const ctx = String(context || "sync");
  const msg = error?.message || String(error);
  console.warn(ctx + ":", msg);
  if(/Failed to fetch|NetworkError|fetch failed|timeout|ECONN/i.test(msg)) setSyncStatus("offline");
  else setSyncStatus("pending");
  if(meta && meta.table && Array.isArray(meta.rows) && meta.rows.length){
    enqueueUpsert(meta.table, meta.rows, meta.onConflict || null);
  }
}

async function flushPendingOps(){
  if(!supaConnected || !supaClient) return;
  const ops = readPendingOps();
  if(!ops.length){
    setSyncStatus("ok");
    return;
  }
  setSyncStatus("pending");
  const remaining = [];
  for(let i=0;i<ops.length;i++){
    const op = ops[i];
    try{
      if(op?.op === "upsert" && op?.table){
        const rows = Array.isArray(op.rows) ? op.rows : [];
        if(!rows.length) continue;
        const cfg = op.onConflict ? { onConflict: op.onConflict } : undefined;
        const {error} = cfg
          ? await supaClient.from(op.table).upsert(rows, cfg)
          : await supaClient.from(op.table).upsert(rows);
        if(error) throw error;
      }
    }catch(e){
      console.warn("pending op failed:", e?.message || String(e));
      remaining.push(op);
      for(let j=i+1;j<ops.length;j++) remaining.push(ops[j]);
      break;
    }
  }
  writePendingOps(remaining);
  setSyncStatus(remaining.length ? "pending" : "ok");
}

function ensurePendingOpsPump(){
  if(pendingOpsTimer) return;
  pendingOpsTimer = setInterval(()=>{ flushPendingOps().catch(()=>{}); }, 30_000);
}

let deferred;
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); deferred=e; document.getElementById("install-bar").style.display="flex"; });
function installApp(){ if(deferred){ deferred.prompt(); deferred.userChoice.then(()=>{ deferred=null; document.getElementById("install-bar").style.display="none"; }); } }



// ═══════════════════════════════════════════════════
//  SUPABASE COMPLETO
// ═══════════════════════════════════════════════════
let geoEstados = []; // Cache completo de estados
let geoCidades = []; // Cache de cidades (apenas as que têm vendas + principais)

cliMetaCache = {};
tarefasCache = [];
canaisLookup = {}; // slug → uuid, carregado em loadSupabaseData()
let upsertOrdersInFlight = false;
const resolveUuidAutocreateTried = new Set();
const resolveUuidAutocreateInFlight = new Set();
let v2PedidosItemsAvailable = null;
let v2PedidosItemsTotalColumn = null;

async function ensureV2PedidosItemsAvailable(){
  if(v2PedidosItemsAvailable === false) return false;
  if(v2PedidosItemsAvailable === true) return true;
  if(!supaConnected || !supaClient) return false;
  try{
    const {error} = await supaClient.from("v2_pedidos_items").select("id").limit(1);
    if(error) throw error;
    if(!v2PedidosItemsTotalColumn){
      try{
        const {error: e1} = await supaClient.from("v2_pedidos_items").select("valor_total").limit(1);
        if(e1) throw e1;
        v2PedidosItemsTotalColumn = "valor_total";
      }catch(_e){
        try{
          const {error: e2} = await supaClient.from("v2_pedidos_items").select("total").limit(1);
          if(e2) throw e2;
          v2PedidosItemsTotalColumn = "total";
        }catch(_e2){
          v2PedidosItemsTotalColumn = "valor_total";
        }
      }
    }
    v2PedidosItemsAvailable = true;
    return true;
  }catch(_e){
    v2PedidosItemsAvailable = false;
    return false;
  }
}

async function upsertV2PedidosItemsFromOrders(orders){
  if(!supaConnected || !supaClient) return;
  const ok = await ensureV2PedidosItemsAvailable();
  if(!ok) return;
  const list = Array.isArray(orders) ? orders : [];
  const nums = Array.from(new Set(list.map(o=>String(o?.numero || o?.id || "").trim()).filter(Boolean))).slice(0,800);
  if(!nums.length) return;

  let pedidos = [];
  try{
    for(let i=0;i<nums.length;i+=200){
      const batch = nums.slice(i,i+200);
      const {data, error} = await supaClient
        .from("v2_pedidos")
        .select("id,numero_pedido")
        .in("numero_pedido", batch)
        .limit(2000);
      if(error) throw error;
      pedidos = pedidos.concat(Array.isArray(data) ? data : []);
    }
  }catch(_e){
    return;
  }
  const numToId = {};
  pedidos.forEach(p=>{
    const n = String(p?.numero_pedido || "").trim();
    const id = p?.id;
    if(n && id) numToId[n] = id;
  });
  const pedidoIds = Array.from(new Set(Object.values(numToId))).slice(0,1500);
  if(!pedidoIds.length) return;

  try{
    for(let i=0;i<pedidoIds.length;i+=200){
      const batch = pedidoIds.slice(i,i+200);
      await supaClient.from("v2_pedidos_items").delete().in("pedido_id", batch);
    }
  }catch(_e){}

  const rows = [];
  const getName = (it)=>String(it?.produto_nome || it?.descricao || it?.title || it?.nome || it?.name || "").trim();
  const getQty = (it)=>Number(it?.quantidade ?? it?.quantity ?? it?.qty ?? 0) || 0;
  const getUnit = (it)=>Number(it?.valor ?? it?.valor_unitario ?? it?.price ?? 0) || 0;
  const getTotal = (it, qty, unit)=>Number(it?.valor_total ?? it?.total ?? 0) || (qty*unit);
  list.forEach(o=>{
    const n = String(o?.numero || o?.id || "").trim();
    const pid = numToId[n];
    if(!pid) return;
    const itens = getPedidoItens(o);
    itens.forEach(it=>{
      const produtoNome = getName(it);
      const quantidade = getQty(it);
      const valorUnitario = getUnit(it);
      const valorTotal = getTotal(it, quantidade, valorUnitario);
      if(!produtoNome) return;
      const row = {
        pedido_id: pid,
        produto_nome: produtoNome,
        quantidade,
        valor_unitario: valorUnitario,
        created_at: new Date().toISOString()
      };
      row[v2PedidosItemsTotalColumn || "valor_total"] = valorTotal;
      rows.push(row);
    });
  });
  if(!rows.length) return;

  try{
    for(let i=0;i<rows.length;i+=500){
      const batch = rows.slice(i,i+500);
      const {error} = await supaClient.from("v2_pedidos_items").insert(batch);
      if(error) throw error;
    }
  }catch(_e){}
}

async function loadClienteMetaCache(){
  if(!supaConnected || !supaClient) return;
  try{
    const {data} = await supaClient
      .from('v2_clientes')
      .select('id,doc,status_manual,notas,pipeline_stage,last_interaction_at,last_interaction_type,last_contact_at,responsible_user')
      .limit(5000);
    const next = {};
    (data||[]).forEach(c=>{
      const key = c.doc || c.id;
      next[key] = {
        uuid: c.id,
        status: c.status_manual || null,
        notes: c.notas || '',
        pipeline_stage: c.pipeline_stage || null,
        last_interaction_at: c.last_interaction_at || null,
        last_interaction_type: c.last_interaction_type || null,
        last_contact_at: c.last_contact_at || null,
        responsible_user: c.responsible_user || null
      };
    });
    cliMetaCache = next;
  }catch(_e){}
}

async function resolveCustomerUuid(customerKey){
  const key = String(customerKey||"").trim();
  if(!key) return null;
  if(cliMetaCache?.[key]?.uuid) return cliMetaCache[key].uuid;
  if(!supaConnected || !supaClient) return null;

  const digits = key.replace(/\D/g,"");
  const isEmail = key.includes("@");
  
  try{
    const lookup = async ()=>{
      let existingId = null;
      if(digits.length===11 || digits.length===14){
        const {data, error} = await supaClient.from("v2_clientes").select("id").eq("doc", digits).maybeSingle();
        if(error) throw error;
        existingId = data?.id;
      }
      if(!existingId && isEmail){
        const em = key.toLowerCase();
        const {data, error} = await supaClient.from("v2_clientes").select("id").ilike("email", em).maybeSingle();
        if(error) throw error;
        existingId = data?.id;
      }
      if(!existingId && digits.length>=10){
        const {data, error} = await supaClient.from("v2_clientes").select("id").eq("telefone", digits).maybeSingle();
        if(error) throw error;
        existingId = data?.id;
      }
      return existingId || null;
    };

    const existingId = await lookup();

    if(existingId){
      cliMetaCache[key] = cliMetaCache[key] || {};
      cliMetaCache[key].uuid = existingId;
      return existingId;
    }

    // Tentar criação automática se não encontrar e for uma chave válida
    const foundLocal = allCustomers.find(c => cliKey({contato:c}) === key);
    if(foundLocal){
      if(resolveUuidAutocreateTried.has(key)) return null;
      if(resolveUuidAutocreateInFlight.has(key)) return null;
      resolveUuidAutocreateInFlight.add(key);
      resolveUuidAutocreateTried.add(key);
      console.log("Criando cliente no Supabase via resolveUuid:", foundLocal.nome);
      try{
        await upsertOrdersToSupabase(foundLocal.orders, { silent: true });
      }finally{
        resolveUuidAutocreateInFlight.delete(key);
      }

      const afterId = await lookup();
      if(afterId){
        cliMetaCache[key] = cliMetaCache[key] || {};
        cliMetaCache[key].uuid = afterId;
        return afterId;
      }
      return null;
    }

  }catch(_e){}
  return null;
}

function maskDigitsForLog(v){
  const s = String(v||"").replace(/\D/g,"");
  if(!s) return "";
  if(s.length<=4) return "*".repeat(s.length);
  return "*".repeat(Math.max(0, s.length-4)) + s.slice(-4);
}
function maskEmailForLog(v){
  const s = String(v||"").trim();
  const at = s.indexOf("@");
  if(at<=1) return s ? "***" : "";
  const user = s.slice(0, at);
  const dom = s.slice(at+1);
  const userMasked = user[0] + "***" + user.slice(-1);
  const domMasked = dom ? "***" + (dom.includes(".") ? dom.slice(dom.lastIndexOf(".")) : "") : "***";
  return userMasked + "@" + domMasked;
}
function sanitizeForSupabaseLog(obj){
  if(!obj || typeof obj !== "object") return obj;
  const next = Array.isArray(obj) ? obj.map(sanitizeForSupabaseLog) : { ...obj };
  if(!Array.isArray(next)){
    if("doc" in next) next.doc = maskDigitsForLog(next.doc) || String(next.doc||"");
    if("telefone" in next) next.telefone = maskDigitsForLog(next.telefone) || String(next.telefone||"");
    if("email" in next) next.email = maskEmailForLog(next.email) || String(next.email||"");
    if("customer_email" in next) next.customer_email = maskEmailForLog(next.customer_email) || String(next.customer_email||"");
    if("customer_phone" in next) next.customer_phone = maskDigitsForLog(next.customer_phone) || String(next.customer_phone||"");
  }
  return next;
}
function sanitizePayload(obj){
  if(typeof obj === "undefined") return undefined;
  if(obj == null) return obj;
  if(Array.isArray(obj)){
    const out = [];
    obj.forEach(v=>{
      const next = sanitizePayload(v);
      if(typeof next !== "undefined") out.push(next);
    });
    return out;
  }
  if(typeof obj === "object"){
    const out = {};
    Object.keys(obj).forEach(k=>{
      const v = obj[k];
      if(typeof v === "undefined") return;
      const next = sanitizePayload(v);
      if(typeof next === "undefined") return;
      out[k] = next;
    });
    return out;
  }
  return obj;
}
function logSupabaseUpsertError(label, error, payload){
  try{
    console.groupCollapsed(label);
    console.log("error:", error);
    if(payload != null) console.log("payload enviado:", sanitizeForSupabaseLog(payload));
    console.groupEnd();
  }catch(_e){}
}

async function logInteraction(customerKey, type, description, metadata){
  if(!supaConnected || !supaClient) return;
  const uuid = await resolveCustomerUuid(customerKey);
  if(!uuid) return;
  const payload = {
    customer_id: uuid,
    type: String(type||"").trim(),
    description: description ? String(description).trim().slice(0,500) : null,
    created_at: new Date().toISOString(),
    user_responsible: selectedUser || null,
    source: "crm",
    metadata: metadata && typeof metadata === "object" ? metadata : {}
  };
  try{
    await supaClient.from("interactions").insert(payload);
  }catch(_e){}
}

async function loadInsumosFromSupabase(){
  if(!supaConnected || !supaClient) return;
  try{
    const {data, error} = await supaClient
      .from("insumos")
      .select("id,nome,unidade,estoque_atual,estoque_minimo,custo_unitario,fornecedor,lead_time_dias,updated_at")
      .limit(5000);
    if(error || !Array.isArray(data)) return;
    if(!data.length) return;
    allInsumos.length = 0;
    data.forEach(r=>{
      const obj = {
        id: String(r.id),
        nome: r.nome || "",
        unidade: r.unidade || "kg",
        estoque_atual: Number(r.estoque_atual||0) || 0,
        estoque_minimo: Number(r.estoque_minimo||0) || 0,
        custo_unitario: Number(r.custo_unitario||0) || 0,
        fornecedor: r.fornecedor || "",
        lead_time_dias: Number(r.lead_time_dias||0) || 0,
        updated_at: r.updated_at || null
      };
      obj.estoque = obj.estoque_atual;
      obj.minimo = obj.estoque_minimo;
      obj.custo = obj.custo_unitario;
      obj.cat = "Insumo";
      allInsumos.push(obj);
    });
    safeSetItem("crm_insumos", JSON.stringify(allInsumos));
    if(document.getElementById("page-producao")?.classList.contains("active")) {
      if(typeof window.renderInsumos === "function") window.renderInsumos();
      if(typeof window.renderProdKpis === "function") window.renderProdKpis();
    }
    checkEstoqueCritico();
  }catch(_e){}
}

async function syncInsumosToSupabase(list){
  if(!supaConnected || !supaClient) return;
  if(!Array.isArray(list) || !list.length) return;
  const rows = list.map(i=>({
    id: String(i.id),
    nome: i.nome || null,
    unidade: i.unidade || null,
    estoque_atual: Number(i.estoque_atual ?? i.estoque ?? 0) || 0,
    estoque_minimo: Number(i.estoque_minimo ?? i.minimo ?? 0) || 0,
    custo_unitario: Number(i.custo_unitario ?? i.custo ?? 0) || 0,
    fornecedor: i.fornecedor || null,
    lead_time_dias: Number(i.lead_time_dias||0) || 0,
    updated_at: new Date().toISOString()
  }));
  try{
    for(let i=0;i<rows.length;i+=200){
      await supaClient.from("insumos").upsert(rows.slice(i,i+200), { onConflict: "id" });
    }
    setSyncStatus("ok");
  }catch(e){
    handleSyncError("syncInsumosToSupabase", e, { table: "insumos", rows, onConflict: "id" });
  }
}

async function loadReceitasProdutosFromSupabase(){
  if(!supaConnected || !supaClient) return;
  try{
    const {data, error} = await supaClient
      .from("receitas_produtos")
      .select("id,produto_id,insumo_id,quantidade_por_unidade,unidade,updated_at")
      .limit(10000);
    if(error || !Array.isArray(data)) return;
    safeSetItem("crm_receitas_produtos", JSON.stringify(data));
    const prods = Array.from(new Set((data||[]).map(r=>String(r.produto_id||"").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
    if(prods.length) localStorage.setItem("crm_receitas_produtos_produtos", JSON.stringify(prods));
    if(document.getElementById("page-producao")?.classList.contains("active")) {
      if(typeof window.renderReceitaDetalhe === "function") window.renderReceitaDetalhe();
    }
  }catch(_e){}
}

async function loadBlingProductsFromSupabase(){
  if(!supaConnected || !supaClient) return;
  try{
    const {data, error} = await supaClient
      .from("v2_produtos")
      .select("id,codigo,nome,estoque,preco,situacao,origem,updated_at")
      .order("updated_at", { ascending: false })
      .limit(5000);
    if(error || !Array.isArray(data)) return;
    blingProducts = (data||[]).map(r=>({
      id: String(r.id||""),
      codigo: r.codigo || "",
      nome: r.nome || "",
      estoque: r.estoque == null ? null : Number(r.estoque||0) || 0,
      preco: r.preco == null ? null : Number(r.preco||0) || 0,
      situacao: r.situacao || "",
      origem: r.origem || "bling",
      updated_at: r.updated_at || null
    })).filter(p=>p.id);
    safeSetItem("crm_bling_products", JSON.stringify(blingProducts));
    if(document.getElementById("page-produtos")?.classList.contains("active")) {
      renderProdutos();
    }
  }catch(_e){}
}

async function syncReceitasToSupabase(list){
  if(!supaConnected || !supaClient) return;
  if(!Array.isArray(list) || !list.length) return;
  let rows = [];
  try{
    const isUuidLike = (v)=>{
      const s = String(v||"").trim();
      if(!s) return false;
      if(/^[0-9a-f]{32}$/i.test(s)) return true;
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    };
    const parseNum = (v)=>{
      const s = String(v==null?"":v).trim().replace(",",".").replace(/[^0-9.\-]/g,"");
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    };
    const nowIso = new Date().toISOString();
    const invalid = [];
    rows = list.map(r=>{
      const id = String(r?.id||"").trim();
      const produto_id = String(r?.produto_id||"").trim();
      const insumo_id = String(r?.insumo_id||"").trim();
      const quantidade_por_unidade = parseNum(r?.quantidade_por_unidade);
      const unidade = String(r?.unidade||"g").trim() || "g";
      if(!id) invalid.push({ reason: "id", row: r });
      if(!produto_id || !isUuidLike(produto_id)) invalid.push({ reason: "produto_id", row: r });
      if(!insumo_id || !isUuidLike(insumo_id)) invalid.push({ reason: "insumo_id", row: r });
      return {
        id,
        produto_id: produto_id || null,
        insumo_id: insumo_id || null,
        quantidade_por_unidade,
        unidade,
        updated_at: nowIso
      };
    }).filter(r=>r.id && r.produto_id && r.insumo_id);
    if(invalid.length) throw new Error("invalid_payload_receitas_produtos");
    for(let i=0;i<rows.length;i+=500){
      const batch = rows.slice(i,i+500);
      const {error} = await supaClient.from("receitas_produtos").upsert(batch, { onConflict: "id" });
      if(error){
        logSupabaseUpsertError("syncReceitasToSupabase", error, batch);
        throw error;
      }
    }
    setSyncStatus("ok");
    return true;
  }catch(e){
    if(String(e?.message||"") === "invalid_payload_receitas_produtos") throw e;
    handleSyncError("syncReceitasToSupabase", e, { table: "receitas_produtos", rows, onConflict: "id" });
    return false;
  }
}

async function loadOrdensProducaoFromSupabase(){
  if(!supaConnected || !supaClient) return;
  try{
    const {data, error} = await supaClient
      .from("ordens_producao")
      .select("id,lote,produto_id,quantidade_planejada,quantidade_produzida,data_producao,status,observacoes,created_at")
      .limit(5000);
    if(error || !Array.isArray(data)) return;
    const rows = data.map(o=>({
      id: String(o.id),
      lote: o.lote || null,
      produto_id: o.produto_id || null,
      quantidade_planejada: Number(o.quantidade_planejada||0) || 0,
      quantidade_produzida: Number(o.quantidade_produzida||0) || 0,
      data_producao: o.data_producao ? String(o.data_producao).slice(0,10) : null,
      status: o.status || "planejada",
      observacoes: o.observacoes || "",
      created_at: o.created_at || null
    }));
    allOrdens.length = 0;
    rows.sort((a,b)=>{
      const ad = a.data_producao ? new Date(a.data_producao).getTime() : 0;
      const bd = b.data_producao ? new Date(b.data_producao).getTime() : 0;
      return bd - ad;
    }).forEach(r=>allOrdens.push(r));
    safeSetItem("crm_ordens_producao", JSON.stringify(allOrdens));
    if(document.getElementById("page-producao")?.classList.contains("active")) {
      if(typeof window.renderOrdens === "function") window.renderOrdens();
      if(typeof window.renderProdKpis === "function") window.renderProdKpis();
      if(typeof window.renderInsumos === "function") window.renderInsumos();
    }
  }catch(_e){}
}

async function loadMovimentosEstoqueFromSupabase(){
  if(!supaConnected || !supaClient) return;
  try{
    let data=null;
    let error=null;
    ({data, error} = await supaClient
      .from("movimentos_estoque")
      .select("id,insumo_id,ordem_id,lote,produto_id,tipo,quantidade,unidade,created_at,metadata")
      .order("created_at", { ascending: false })
      .limit(10000));
    if(error){
      ({data, error} = await supaClient
        .from("movimentos_estoque")
        .select("id,insumo_id,ordem_id,tipo,quantidade,unidade,created_at,metadata")
        .order("created_at", { ascending: false })
        .limit(10000));
    }
    if(error || !Array.isArray(data)) return;
    safeSetItem("crm_movimentos_estoque", JSON.stringify(data));
    if(document.getElementById("page-producao")?.classList.contains("active")) {
      if(typeof window.renderMovimentosEstoque === "function") window.renderMovimentosEstoque();
    }
  }catch(_e){}
}

async function syncOrdensProducaoToSupabase(list){
  if(!supaConnected || !supaClient) return;
  if(!Array.isArray(list) || !list.length) return;
  const rowsWithCost = list.map(o=>({
    id: String(o.id),
    lote: o.lote || null,
    produto_id: o.produto_id || null,
    quantidade_planejada: Number(o.quantidade_planejada||0) || 0,
    quantidade_produzida: Number(o.quantidade_produzida||0) || 0,
    data_producao: o.data_producao || null,
    status: o.status || "planejada",
    observacoes: o.observacoes || null,
    custo_total_lote: o.custo_total_lote != null ? Number(o.custo_total_lote||0) || 0 : null,
    created_at: o.created_at || new Date().toISOString()
  }));
  try{
    for(let i=0;i<rowsWithCost.length;i+=200){
      const chunk = rowsWithCost.slice(i,i+200);
      const {error} = await supaClient.from("ordens_producao").upsert(chunk, { onConflict: "id" });
      if(error){
        const fallback = chunk.map(({custo_total_lote, ...rest})=>rest);
        const {error: e2} = await supaClient.from("ordens_producao").upsert(fallback, { onConflict: "id" });
        if(e2) throw e2;
      }
    }
    setSyncStatus("ok");
  }catch(e){
    const fallbackRows = rowsWithCost.map(({custo_total_lote, ...rest})=>rest);
    handleSyncError("syncOrdensProducaoToSupabase", e, { table: "ordens_producao", rows: fallbackRows, onConflict: "id" });
  }
}

async function logMovimentoEstoque(mov){
  if(!supaConnected || !supaClient) return;
  if(!mov || !mov.insumo_id || !mov.tipo) return;
  let payloadWithColumns = null;
  try{
    payloadWithColumns = {
      id: mov.id || null,
      insumo_id: String(mov.insumo_id),
      ordem_id: mov.ordem_id ? String(mov.ordem_id) : null,
      lote: mov.lote || null,
      produto_id: mov.produto_id || null,
      tipo: String(mov.tipo),
      quantidade: Number(mov.quantidade||0) || 0,
      unidade: String(mov.unidade||""),
      created_at: mov.created_at || new Date().toISOString(),
      metadata: mov.metadata && typeof mov.metadata === "object" ? mov.metadata : {}
    };
    const {error} = await supaClient
      .from("movimentos_estoque")
      .upsert(payloadWithColumns, { onConflict: "ordem_id,insumo_id,tipo" });
    if(error){
      const {lote, produto_id, ...fallback} = payloadWithColumns;
      const {error: e2} = await supaClient.from("movimentos_estoque").upsert(fallback, { onConflict: "ordem_id,insumo_id,tipo" });
      if(e2) throw e2;
    }
    setSyncStatus("ok");
  }catch(e){
    if(payloadWithColumns) handleSyncError("logMovimentoEstoque", e, { table: "movimentos_estoque", rows: [payloadWithColumns], onConflict: "ordem_id,insumo_id,tipo" });
  }
}

async function initSupabase(){
  const url = getSupabaseProjectUrl();
  const key = getSupabaseAnonKey();
  const st = document.getElementById("supa-status");

  if(!url || !key){
    if(st){ st.textContent="⚠ Preencha URL e chave."; st.className="setup-status s-err"; }
    setSyncDot(false);
    return false;
  }

  try{
    supaClient = getSupabaseClient(url, key);

    try{
      if(!supaAuthUnsub && supaClient.auth && typeof supaClient.auth.onAuthStateChange === "function"){
        const res = supaClient.auth.onAuthStateChange((_event, session)=>{
          supaSession = session || null;
          supaAccessToken = session?.access_token ? String(session.access_token) : "";
        });
        supaAuthUnsub = res?.data?.subscription || res?.subscription || null;
      }
    }catch(_e){}
    await refreshSupabaseSession();

    if(!supaSession?.access_token){
      if(st){ st.textContent="⚠ Faça login novamente (Supabase Auth)."; st.className="setup-status s-err"; }
      supaConnected = false;
      setSyncDot(false);
      return false;
    }
    
    const { error } = await supaClient.from('configuracoes').select('chave').limit(1);
    
    if(error) throw error;

    supaConnected = true;
    if(st){ st.textContent="✓ Conectado"; st.className="setup-status s-ok"; }
    setSyncDot(true);
    ensurePendingOpsPump();
    flushPendingOps().catch(()=>{});
    return true;

  }catch(e){
    console.warn("Supabase connection failed:", e.message);
    let errMsg = e.message;
    if (e.message.includes("JWT") || e.message.includes("token")) {
      errMsg = "Chave (anon) inválida.";
    } else if (e.message.includes("Failed to fetch")) {
      errMsg = "URL do Supabase incorreta ou offline.";
    } else if (e.message.includes("RLS")) {
      errMsg = "Verifique as políticas de RLS da tabela 'configuracoes'.";
    }
    if(st){ st.textContent=`⚠ ${errMsg}`; st.className="setup-status s-err"; }
    supaConnected = false;
    setSyncDot(false);
    return false;
  }
}

async function loadSupabaseData(){
  if(!supaConnected || !supaClient) return;
  if(isLoadingData) return;
  isLoadingData = true;
  dataReady = false;
  try{
    // configuracoes — campo valor_texto (antigo: config.valor)
    const {data:metaRow} = await supaClient.from('configuracoes').select('valor_texto').eq('chave','meta_mensal').maybeSingle();
    if(metaRow?.valor_texto) localStorage.setItem('crm_meta', metaRow.valor_texto);

    const {data:alertRow} = await supaClient.from('configuracoes').select('valor_texto').eq('chave','alert_days').maybeSingle();
    if(alertRow?.valor_texto){ localStorage.setItem('crm_alertdays', alertRow.valor_texto); const el=document.getElementById('alert-days'); if(el) el.value=alertRow.valor_texto; }

    const {data:usersRow} = await supaClient.from('configuracoes').select('valor_texto').eq('chave','crm_access_users').maybeSingle();
    if(usersRow?.valor_texto){
      localStorage.setItem('crm_access_users', usersRow.valor_texto);
      renderAccessUsers();
    }

    // v2_tarefas — campos: descricao (antigo: desc), vencimento (antigo: data), status 'aberta'→'pendente' para UI
    const {data:tasks} = await supaClient.from('v2_tarefas').select('*').order('created_at',{ascending:false}).limit(500);
    tarefasCache = (tasks||[]).map(t => ({
      ...t,
      desc: t.descricao||'',
      data: t.vencimento||'',
      status: t.status === 'aberta' ? 'pendente' : t.status
    }));
    // Mesclar tarefas do Supabase em allTasks — associar _supaId a tarefas existentes pelo título
    if(tarefasCache.length){
      const sbById = {};
      tarefasCache.forEach(t => { sbById[t.id]=t; });
      // Tarefas locais que já têm _supaId: atualizar dados vindos do servidor
      allTasks = allTasks.map(local => {
        if(local._supaId && sbById[local._supaId]){
          const srv = sbById[local._supaId];
          return {...local, titulo:srv.titulo, desc:srv.descricao||'', prioridade:srv.prioridade||local.prioridade, status: srv.status==='aberta'?'pendente':srv.status, data:srv.vencimento||'', customer_id: String(srv.cliente_id||local.customer_id||"")};
        }
        return local;
      });
      // Tarefas no Supabase sem _supaId local: adicionar como novas
      const localSupaIds = new Set(allTasks.map(t=>t._supaId).filter(Boolean));
      tarefasCache.forEach(srv => {
        if(!localSupaIds.has(srv.id)){
          allTasks.push({
            id: taskIdSeq++,
            _supaId: srv.id,
            titulo: srv.titulo,
            desc: srv.descricao||'',
            cliente: '',
            customer_id: String(srv.cliente_id||""),
            prioridade: srv.prioridade||'media',
            status: srv.status==='aberta'?'pendente':srv.status,
            data: srv.vencimento||''
          });
        }
      });
      saveTasks();
    }

    await loadClienteMetaCache();
    await loadInsumosFromSupabase();
    await loadReceitasProdutosFromSupabase();
    await loadOrdensProducaoFromSupabase();
    await loadMovimentosEstoqueFromSupabase();
    await loadCarrinhosAbandonadosFromSupabase();
    await loadCanalLookup();
    await loadOrdersFromSupabaseForCRM();
    await loadClientesInteligenciaCache();
    await loadBlingProductsFromSupabase();

    updateBadge();
    mergeOrders();
    populateUFs();
    dataReady = true;
    console.log("[Load] Bling:", Array.isArray(blingOrders)?blingOrders.length:0, "Yampi:", Array.isArray(yampiOrders)?yampiOrders.length:0, "Total:", Array.isArray(allOrders)?allOrders.length:0, "Clientes:", Array.isArray(allCustomers)?allCustomers.length:0);
    renderAll();
  }catch(e){
    console.warn('loadSupabaseData:', e.message);
  }finally{
    isLoadingData = false;
    if(!dataReady) dataReady = true;
  }
}

function updateClientesIntelFiltersOptions(){
  try{
    const ufSel = document.getElementById("fil-estado");
    if(ufSel){
      const selected = String(ufSel.value || "");
      const ufs = Array.from(clientesIntelUfSet).sort();
      ufSel.innerHTML = `<option value="">UF</option>` + ufs.map(uf=>`<option value="${escapeHTML(uf)}">${escapeHTML(uf)}</option>`).join("");
      if(selected) ufSel.value = selected;
    }
    const segSel = document.getElementById("fil-cli-seg");
    if(segSel){
      const selected = String(segSel.value || "");
      const segs = Array.from(clientesIntelSegSet).sort((a,b)=>a.localeCompare(b));
      segSel.innerHTML = `<option value="">Segmento CRM</option>` + segs.map(s=>`<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join("");
      if(selected) segSel.value = selected;
    }
  }catch(_e){}
}

async function loadClientesInteligenciaCache(forceReset=false){
  if(!supaConnected || !supaClient) return;
  if(clientesIntelInFlight) return;
  if(!forceReset && !clientesIntelCursor && clientesIntelLoadedAt && (Date.now() - clientesIntelLoadedAt) < 3*60*1000 && clientesIntelCache.length) return;
  clientesIntelInFlight = true;
  try{
    if(forceReset){
      clientesIntelCache = [];
      clientesIntelCursor = null;
      clientesIntelHasMore = true;
      clientesIntelUfSet = new Set();
      clientesIntelSegSet = new Set();
      clientesIntelDomMode = "";
      clientesIntelDomCount = 0;
    }
    if(!clientesIntelHasMore && clientesIntelCache.length) return;
    const pageSize = 500;
    const res = await getClientesInteligenciaView(supaClient, { pageSize, cursor: clientesIntelCursor });
    const rawRows = Array.isArray(res?.rows) ? res.rows : [];
    const nextCursor = res?.nextCursor || null;
    const hasMore = !!res?.hasMore;
    const normalized = rawRows.map(normalizeClienteIntel).filter(r=>r && r.cliente_id);
    const seen = new Set(clientesIntelCache.map(r=>String(r?.cliente_id || "")));
    const fresh = [];
    normalized.forEach(r=>{
      const id = String(r.cliente_id || "");
      if(!id || seen.has(id)) return;
      seen.add(id);
      fresh.push(r);
      const uf = String(r.uf||"").toUpperCase().trim();
      if(uf) clientesIntelUfSet.add(uf);
      const seg = String(r.segmento_crm||"").trim();
      if(seg) clientesIntelSegSet.add(seg);
    });
    if(fresh.length) clientesIntelCache.push(...fresh);
    clientesIntelCursor = nextCursor;
    clientesIntelHasMore = hasMore;
    clientesIntelLoadedAt = Date.now();
    updateClientesIntelFiltersOptions();
    // Avisar se atingiu o limite da página (dados podem estar incompletos)
    if(!hasMore && clientesIntelCache.length > 0 && clientesIntelCache.length % pageSize === 0){
      console.warn(`[Clientes] Total carregado (${clientesIntelCache.length}) é múltiplo exato do pageSize — pode haver mais registros.`);
    }
  }catch(_e){}finally{
    clientesIntelInFlight = false;
  }
}

async function auditSupabaseSchema(){
  const outEl = document.getElementById("supa-audit");
  if(outEl){ outEl.textContent = "Auditando..."; outEl.className = "setup-status"; }
  try{
    const connected = await initSupabase();
    if(!connected){
      if(outEl){ outEl.textContent = "⚠ Conecte o Supabase primeiro."; outEl.className = "setup-status s-err"; }
      return;
    }
    const checks = [
      { table:"insumos", cols:"id,nome,unidade,estoque_atual,estoque_minimo,custo_unitario,fornecedor,lead_time_dias,updated_at" },
      { table:"receitas_produtos", cols:"id,produto_id,insumo_id,quantidade_por_unidade,unidade,updated_at" },
      { table:"ordens_producao", cols:"id,lote,produto_id,quantidade_planejada,quantidade_produzida,data_producao,status,observacoes,created_at" },
      { table:"movimentos_estoque", cols:"id,insumo_id,ordem_id,tipo,quantidade,unidade,created_at,metadata" },
      { table:"interactions", cols:"id,customer_id,type,description,created_at,user_responsible,source,metadata" },
      { table:"v2_clientes", cols:"id,doc,nome,email,telefone,cidade,uf" },
      { table:"v2_pedidos", cols:"id,numero_pedido,bling_id,cliente_id,canal_id,data_pedido,total,status,source,created_at" },
      { table:"v2_produtos", cols:"id,codigo,nome,estoque,preco,situacao,origem,updated_at" },
      { table:"customer_intelligence", cols:"cliente_id,score_final,next_best_action,updated_at" },
      { table:"carrinhos_abandonados", cols:"checkout_id,cliente_nome,telefone,email,valor,produtos,criado_em,recuperado,recuperado_em,recuperado_pedido_id,score_recuperacao,link_finalizacao,last_etapa_enviada,last_mensagem_at" },
      { table:"configuracoes", cols:"chave,valor_texto,updated_at" },
      { table:"v2_tarefas", cols:"id,titulo,descricao,vencimento,prioridade,status,created_at" },
      { table:"v2_insights", cols:"id,tipo,conteudo,gerado_por,created_at" }
    ];

    const results = [];
    for(let i=0;i<checks.length;i++){
      const c = checks[i];
      try{
        const {error} = await supaClient.from(c.table).select(c.cols).limit(1);
        if(error){
          results.push({ok:false, table:c.table, error:error.message || String(error)});
        }else{
          results.push({ok:true, table:c.table});
        }
      }catch(e){
        results.push({ok:false, table:c.table, error:e?.message || String(e)});
      }
    }

    let canaisStatus = "⚠ não encontrado";
    try{
      const candidates = [
        { table: "v2_canais", slug: "slug", id: "id" },
        { table: "canais", slug: "slug", id: "id" },
        { table: "canais", slug: "chave", id: "id" },
        { table: "canais_venda", slug: "slug", id: "id" },
        { table: "canais_venda", slug: "chave", id: "id" }
      ];
      for(let i=0;i<candidates.length;i++){
        const cand = candidates[i];
        const {data, error} = await supaClient.from(cand.table).select(`${cand.id},${cand.slug}`).limit(1);
        if(!error && Array.isArray(data)){
          canaisStatus = "✓ " + cand.table;
          break;
        }
      }
    }catch(_e){}

    const okCount = results.filter(r=>r.ok).length;
    const lines = [];
    lines.push(`Tabelas OK: ${okCount}/${results.length}`);
    results.forEach(r=>{
      if(r.ok) lines.push(`✓ ${r.table}`);
      else lines.push(`⚠ ${r.table}: ${r.error}`);
    });
    lines.push(`Canais (lookup): ${canaisStatus}`);
    if(outEl){
      outEl.textContent = lines.join("\n");
      outEl.className = results.some(r=>!r.ok) ? "setup-status s-err" : "setup-status s-ok";
    }
  }catch(e){
    if(outEl){
      outEl.textContent = "⚠ " + (e?.message || String(e));
      outEl.className = "setup-status s-err";
    }
  }
}

async function loadCanalLookup(){
  if(!supaConnected || !supaClient) return;
  try{
    const {data, error} = await supaClient.from("v2_canais").select("id,slug").limit(500);
    if(error || !Array.isArray(data) || !data.length) return;
    const next = {};
    data.forEach(r=>{
      const slug = String(r?.slug || "").trim().toLowerCase();
      const id = r?.id;
      if(slug && id) next[slug] = id;
    });
    if(Object.keys(next).length) canaisLookup = next;
  }catch(_e){}
}

function normalizeOrderForCRM(o, sourceHint){
  const next = o || {};
  const src = String(next._source || next.source || sourceHint || "").toLowerCase();
  next._source = src || sourceHint || "bling";

  const numeroRaw =
    next.numero ||
    next.numero_pedido ||
    next.numeroPedido ||
    next.numeroPedidoEcommerce ||
    next.order_number ||
    next.name ||
    next.id;
  if(numeroRaw != null) next.numero = String(numeroRaw);

  const dataRaw =
    next.data ||
    next.data_pedido ||
    next.dataPedido ||
    next.created_at ||
    next.updated_at ||
    next.dataCriacao;
  if(dataRaw){
    const raw = String(dataRaw).trim();
    const head = raw.slice(0,10);
    const isoDate = parseDateToIso(head) || head;
    next.data = isoDate;
  }

  const totalRaw =
    next.totalProdutos ??
    next.total ??
    next.valor_total ??
    next.total_price ??
    next.amount_total ??
    next.valor ??
    0;
  const total = Number(totalRaw) || 0;
  next.total = total;
  next.totalProdutos = total;

  const contato = next.contato || next.cliente || next.customer || next.buyer || {};
  const endereco = contato.endereco || next.endereco_entrega || next.shipping_address || next.billing_address || contato.address || {};
  const nome =
    contato.nome ||
    contato.name ||
    [contato.first_name, contato.last_name].filter(Boolean).join(" ").trim() ||
    next.nome_cliente ||
    next.customer_name ||
    "";
  const cpfCnpj = contato.cpfCnpj || contato.numeroDocumento || contato.cpf || contato.cnpj || contato.document || next.document || "";
  const email = contato.email || next.email || "";
  const telefone = contato.telefone || contato.celular || next.phone || "";
  const municipio = endereco.municipio || endereco.cidade || endereco.city || endereco.localidade || "";
  const uf = normalizeUF(endereco.uf || endereco.estado || endereco.state || endereco.province || endereco.province_code || "");
  const logradouro = endereco.logradouro || endereco.endereco || endereco.address1 || "";
  const numero = endereco.numero || endereco.number || "";
  const bairro = endereco.bairro || endereco.neighborhood || endereco.district || "";
  const cep = endereco.cep || endereco.zipcode || endereco.zip || "";

  next.contato = {
    id: contato.id || next.cliente_id || next.customer_id || next.contato_id || undefined,
    nome: nome || "Desconhecido",
    cpfCnpj: String(cpfCnpj || ""),
    email: String(email || ""),
    telefone: String(telefone || ""),
    celular: String(contato.celular || ""),
    endereco: {
      municipio: String(municipio || ""),
      uf: String(uf || ""),
      logradouro: String(logradouro || ""),
      numero: String(numero || ""),
      bairro: String(bairro || ""),
      cep: String(cep || "")
    }
  };

  next.itens = getPedidoItens(next);

  next._canal = next._canal || String(next.canal || next.channel || "").toLowerCase();
  if(!next._canal){
    const d = detectCh(next);
    next._canal = d;
  }
  return next;
}

async function loadOrdersFromSupabaseForCRM(){
  const options = arguments?.[0] && typeof arguments[0] === "object" ? arguments[0] : {};
  const persistBack = options.persistBack === true;
  const silent = options.silent === true;
  if(!supaConnected || !supaClient) return;
  try{
    const {data:cliRows, error:cliErr} = await supaClient
      .from("v2_clientes")
      .select("*")
      .limit(5000);
    if(cliErr) throw cliErr;
    const cliById = {};
    (cliRows||[]).forEach(c=>{ if(c?.id) cliById[c.id] = c; });

    let pedRows = null;
    let pedErr = null;
    try{
      ({data:pedRows, error:pedErr} = await supaClient
        .from("v2_pedidos")
        .select("*")
        .order("data_pedido",{ascending:false})
        .limit(5000));
    }catch(e){
      pedErr = e;
    }
    if(pedErr){
      try{
        ({data:pedRows, error:pedErr} = await supaClient
          .from("v2_pedidos")
          .select("*")
          .order("data",{ascending:false})
          .limit(5000));
      }catch(e){
        pedErr = e;
      }
    }
    if(pedErr){
      try{
        ({data:pedRows, error:pedErr} = await supaClient
          .from("v2_pedidos")
          .select("*")
          .order("created_at",{ascending:false})
          .limit(5000));
      }catch(e){
        pedErr = e;
      }
    }
    if(pedErr) throw pedErr;

    const {data:yampiRows, error:yampiErr} = await supaClient
      .from("yampi_orders")
      .select("*")
      .order("created_at",{ascending:false})
      .limit(5000);
    if(yampiErr) throw yampiErr;

    let itemsByPedidoId = {};
    try{
      const okItems = await ensureV2PedidosItemsAvailable();
      if(okItems && Array.isArray(pedRows) && pedRows.length){
        const totalCol = v2PedidosItemsTotalColumn || "valor_total";
        const pedidoIds = Array.from(new Set(pedRows.map(p=>p?.id).filter(Boolean))).slice(0,1000);
        for(let i=0;i<pedidoIds.length;i+=200){
          const batchIds = pedidoIds.slice(i,i+200);
          const {data, error} = await supaClient
            .from("v2_pedidos_items")
            .select(`pedido_id,produto_nome,quantidade,valor_unitario,${totalCol}`)
            .in("pedido_id", batchIds)
            .limit(20000);
          if(error) throw error;
          (data||[]).forEach(r=>{
            const pid = String(r.pedido_id||"");
            if(!pid) return;
            if(!itemsByPedidoId[pid]) itemsByPedidoId[pid] = [];
            const qty = Number(r.quantidade||0) || 0;
            const total = Number(r[totalCol]||0) || 0;
            const unit =
              r.valor_unitario != null
                ? (Number(r.valor_unitario||0) || 0)
                : (qty > 0 ? (total / qty) : 0);
            itemsByPedidoId[pid].push({
              descricao: r.produto_nome || "",
              codigo: "",
              quantidade: qty,
              valor: unit,
              valor_total: total
            });
          });
        }
      }
    }catch(_e){}

    const nextBling = [];
    const nextYampi = [];
    const canaisById = {};
    try{
      Object.entries(canaisLookup||{}).forEach(([slug,id])=>{
        if(!slug || !id) return;
        canaisById[String(id)] = String(slug).trim().toLowerCase();
      });
    }catch(_e){}

    const extractYampiCustomer = (raw)=>{
      const obj = raw && typeof raw === "object" ? raw : {};
      const customer = obj.customer || obj.cliente || obj.buyer || obj.comprador || obj.user || {};
      const shipping = obj.shipping_address || obj.shippingAddress || obj.shipping || obj.address || {};
      const billing = obj.billing_address || obj.billingAddress || {};
      const addr = (shipping && typeof shipping === "object" && Object.keys(shipping).length) ? shipping : billing;
      const name =
        customer.name ||
        customer.nome ||
        [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim() ||
        obj.customer_name ||
        obj.nome ||
        "";
      const email =
        customer.email ||
        customer.email_address ||
        customer.emailAddress ||
        customer.mail ||
        obj.customer_email ||
        obj.email ||
        "";
      const phone =
        customer.phone ||
        customer.phone_number ||
        customer.phoneNumber ||
        customer.mobile ||
        customer.cellphone ||
        customer.whatsapp ||
        customer.telefone ||
        customer.celular ||
        obj.customer_phone ||
        obj.phone ||
        "";
      const doc =
        customer.document ||
        customer.document_number ||
        customer.documentNumber ||
        customer.cpf ||
        customer.cnpj ||
        obj.document ||
        obj.doc ||
        "";
      const city = addr.city || addr.cidade || addr.municipio || addr.localidade || "";
      const state = addr.state || addr.uf || addr.estado || addr.province || addr.province_code || "";
      const cep = addr.zipcode || addr.cep || addr.zip || "";
      const logradouro = addr.address1 || addr.logradouro || addr.endereco || addr.street || "";
      const numero = addr.number || addr.numero || "";
      const bairro = addr.neighborhood || addr.bairro || addr.district || "";
      return { name, email, phone, doc, city, state, cep, logradouro, numero, bairro };
    };

    (pedRows||[]).forEach(p=>{
      const cli = cliById[p.cliente_id] || null;
      const pid = String(p.id || "");
      const canalId = p.canal_id ?? p.canalId ?? null;
      const canalSlugRaw = String(p.canal_slug || p.canalSlug || p.canal || p.channel || "").trim().toLowerCase();
      const canalSlug = canalSlugRaw || (canalId != null ? (canaisById[String(canalId)] || "") : "");
      const o = {
        id: String(p.id || p.bling_id || p.numero_pedido || ""),
        numero: String(p.numero_pedido || p.id || ""),
        cliente_id: p.cliente_id || null,
        pedido_uuid: pid || null,
        data: String(p.data_pedido || p.data || p.created_at || "").slice(0,10),
        total: p.total,
        situacao: { nome: p.status || "" },
        _source: String(p.source || "").toLowerCase() || "bling",
        cidade_entrega: p.cidade_entrega || null,
        uf_entrega: p.uf_entrega || null,
        _canal: canalSlug,
        origem_canal: p.origem_canal || null,
        origem_canal_nome: p.origem_canal_nome || null,
        tipo_venda: p.tipo_venda || null,
        contato: {
          id: p.cliente_id || undefined,
          nome: cli?.nome || "Desconhecido",
          cpfCnpj: cli?.doc || "",
          email: cli?.email || "",
          telefone: cli?.telefone || cli?.celular || "",
          endereco: { municipio: cli?.cidade || "", uf: cli?.uf || "", cep: cli?.cep || "" }
        },
        itens: (pid && Array.isArray(itemsByPedidoId[pid]) && itemsByPedidoId[pid].length) ? itemsByPedidoId[pid] : (Array.isArray(p.itens) ? p.itens : Array.isArray(p.items) ? p.items : [])
      };
      const normalized = normalizeOrderForCRM(o, o._source);
      if(normalized._source === "yampi") nextYampi.push(normalized);
      else nextBling.push(normalized);
    });

    (yampiRows||[]).forEach(y=>{
      // Normalização unificada para dados brutos da Yampi
      const raw = y.raw || {};
      const ex = extractYampiCustomer(raw);
      const city = y.city || ex.city || "";
      const state = y.state || ex.state || "";
      const o = {
        id: y.external_id,
        numero: y.external_id,
        cidade_entrega: city || null,
        uf_entrega: state || null,
        data: y.created_at,
        total: y.total,
        situacao: { nome: y.status || "" },
        _source: "yampi",
        _canal: "yampi",
        contato: {
          nome: y.customer_name || ex.name || "Cliente Yampi",
          cpfCnpj: ex.doc || "",
          email: y.customer_email || ex.email || "",
          telefone: y.customer_phone || ex.phone || "",
          endereco: { municipio: city || "", uf: state || "", cep: ex.cep || "", logradouro: ex.logradouro || "", numero: ex.numero || "", bairro: ex.bairro || "" }
        },
        itens: Array.isArray(y.raw?.items) ? y.raw.items.map(it=>({
          descricao: it.name || it.product_name || "",
          codigo: it.sku || it.id || "",
          quantidade: it.quantity,
          valor: it.price
        })) : []
      };
      
      const normalized = normalizeOrderForCRM(o, "yampi");
      
      // Evitar duplicidade se já veio de v2_pedidos
      const exists = nextYampi.some(ex => ex.id === normalized.id || ex.numero === normalized.numero);
      if(!exists) nextYampi.push(normalized);
    });

    blingOrders.length = 0;
    blingOrders.push(...nextBling);
    safeSetItem("crm_bling_orders", JSON.stringify(blingOrders));
    yampiOrders.length = 0;
    yampiOrders.push(...nextYampi);
    safeSetItem("crm_yampi_orders", JSON.stringify(yampiOrders));

    // Sincroniza dados de clientes com a tabela v2_clientes (garante que dados da Yampi entrem na base)
    if(persistBack && (nextYampi.length || nextBling.length)){
      const shouldBackfill =
        (!Array.isArray(pedRows) || pedRows.length === 0) ||
        (!Array.isArray(cliRows) || cliRows.length === 0);
      if(shouldBackfill){
        upsertOrdersToSupabase([...nextBling, ...nextYampi], { silent: true }).catch(e=>console.warn("[backfill upsert]", e?.message||e));
      }
    }
    return { bling: nextBling.length, yampi: nextYampi.length };
  }catch(_e){}
}

async function sbSetConfig(chave, valor){
  if(!supaConnected || !supaClient) return;
  try{ await supaClient.from('configuracoes').upsert({chave, valor_texto: valor, updated_at: new Date().toISOString()}); }catch(e){}
}

async function upsertOrdersToSupabase(orders){
  const options = arguments?.[1] && typeof arguments[1] === "object" ? arguments[1] : {};
  const silent = options.silent === true;
  if(!supaConnected || !supaClient || !orders.length) return;
  if(upsertOrdersInFlight) return;
  upsertOrdersInFlight = true;
  setSyncDot(true);
  try{
    let hadUpsertError = false;
    const isNil = (v)=>v === null || typeof v === "undefined";
    const isUuid = (v)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||"").trim());
    const toDateOrNull = (v)=>{
      const s = String(v||"").trim();
      if(!s) return null;
      if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
      const d = new Date(s);
      if(isNaN(d.getTime())) return null;
      return d.toISOString().slice(0,10);
    };
    const toIsoOrNull = (v)=>{
      const s = String(v||"").trim();
      if(!s) return null;
      const d = new Date(s);
      if(isNaN(d.getTime())) return null;
      return d.toISOString();
    };
    const splitValidRows = (rows, requiredKeys, label)=>{
      const ok = [];
      const invalid = [];
      (Array.isArray(rows) ? rows : []).forEach(r=>{
        const bad = requiredKeys.some(k=>{
          const val = r?.[k];
          if(isNil(val)) return true;
          if(typeof val === "string" && !val.trim()) return true;
          return false;
        });
        if(bad){
          invalid.push(r);
          try{ console.warn(label, "registro ignorado (campo obrigatório ausente)", sanitizeForSupabaseLog(r)); }catch(_e){}
          return;
        }
        ok.push(r);
      });
      return { ok, invalid };
    };

    const cliMap = buildCli(orders);
    const cliRows = Object.values(cliMap).map(c => {
      const sc = calcCliScores(c);
      
      // Captura de endereço completa
      const end = c.orders[0]?.contato?.endereco || {};
      const nome = cleanText(c.nome || "");
      const email = cleanEmail(c.email || "");
      const telefone = cleanPhoneDigits(c.telefone || "");
      const cidade = cleanText(c.cidade || end.municipio || "");
      const uf = normalizeUF(c.uf || end.uf || "");
      const nomeFinal = nome || email || telefone || String(c.doc || "").trim() || "Cliente";
      
      const row = {
        doc: String(c.doc || "").trim(),
        nome: nomeFinal,
        primeiro_pedido: c.first, 
        ultimo_pedido: c.last,
        total_pedidos: c.orders.length, 
        total_gasto: sc.ltv, 
        ltv: sc.ltv,
        ticket_medio: c.orders.length ? sc.ltv/c.orders.length : 0,
        intervalo_medio_dias: sc.avgInterval, 
        score_recompra: sc.recompraScore,
        risco_churn: sc.churnRisk, 
        status: sc.status,
        canal_principal: [...c.channels][0]||'outros',
        updated_at: new Date().toISOString() 
      };
      if(email) row.email = email;
      if(telefone) row.telefone = telefone;
      if(cidade) row.cidade = cidade;
      if(uf) row.uf = uf;
      return row;
    });
    cliRows.forEach(r=>{
      const digits = String(r.doc||"").replace(/\D/g,"");
      if(!(digits.length===11 || digits.length===14)){
        const key =
          (r.email && String(r.email).trim().toLowerCase()) ||
          (r.telefone && String(r.telefone).replace(/\D/g,"")) ||
          "";
        r.doc = key || r.doc || "";
      }else{
        r.doc = digits;
      }
    });
    const filteredCliRows = cliRows.filter(r=>String(r.doc||"").trim());
    const { ok: validCliRows } = splitValidRows(filteredCliRows, ["doc", "nome"], "[Upsert v2_clientes]");
    // upsert por doc (chave natural) — preserva UUID existente
    for(let i=0; i<validCliRows.length; i+=50){
      const batch = validCliRows.slice(i,i+50);
      const payload = batch.map(sanitizePayload).filter(Boolean);
      const {error} = await supaClient.from("v2_clientes").upsert(payload, { onConflict: "doc", ignoreDuplicates: true });
      if(error){
        hadUpsertError = true;
        try{ console.error("[Upsert v2_clientes]", error, sanitizeForSupabaseLog(payload.slice(0,10))); }catch(_e){}
        logSupabaseUpsertError("upsert v2_clientes error", error, batch.slice(0,5));
        for(const row of payload){
          try{
            const {error: rowErr} = await supaClient.from("v2_clientes").upsert([sanitizePayload(row)], { onConflict: "doc", ignoreDuplicates: true });
            if(rowErr){
              hadUpsertError = true;
              try{
                console.warn("[Upsert v2_clientes] registro ignorado (erro no upsert)", sanitizeForSupabaseLog(row));
                console.error("[Upsert v2_clientes]", rowErr, sanitizeForSupabaseLog(row));
              }catch(_e){}
            }
          }catch(_e){}
        }
      }
    }

    // Recarregar mapa doc→uuid após upsert de clientes (somente docs relevantes; evita LIMIT 5000)
    const docToUuid = {};
    const docsToResolve = Array.from(new Set(validCliRows.map(r=>String(r?.doc||"").trim()).filter(Boolean)));
    for(let i=0; i<docsToResolve.length; i+=200){
      const batch = docsToResolve.slice(i, i+200);
      const {data, error} = await supaClient.from("v2_clientes").select("id,doc").in("doc", batch).limit(5000);
      if(error){
        logSupabaseUpsertError("select v2_clientes refresh error", error, batch.slice(0,20));
        throw error;
      }
      (data||[]).forEach(c => { if(c?.doc) docToUuid[c.doc] = c.id; });
    }

    const yampiLegacyIds = Array.from(new Set(
      (Array.isArray(orders) ? orders : [])
        .filter(o => String(o?._source || "").toLowerCase() === "yampi")
        .map(o => String(o?.id || o?.numero || "").trim())
        .filter(Boolean)
        .filter(id => !id.includes(":"))
    )).slice(0, 1200);
    const existingLegacyYampiIds = new Set();
    if(yampiLegacyIds.length){
      for(let i=0;i<yampiLegacyIds.length;i+=200){
        const batch = yampiLegacyIds.slice(i,i+200);
        const {data, error} = await supaClient
          .from("v2_pedidos")
          .select("id")
          .eq("source","yampi")
          .in("id", batch)
          .limit(2000);
        if(!error && Array.isArray(data)){
          data.forEach(r=>{
            const id = String(r?.id || "").trim();
            if(id) existingLegacyYampiIds.add(id);
          });
        }
      }
    }

    const pedRows = orders.map(o => {
      const docDigits = String(o.contato?.cpfCnpj||o.contato?.numeroDocumento||"").replace(/\D/g,"");
      const doc =
        (docDigits.length===11 || docDigits.length===14) ? docDigits :
        (o.contato?.email ? String(o.contato.email).trim().toLowerCase() : "") ||
        (o.contato?.telefone ? String(o.contato.telefone).replace(/\D/g,"") : "") ||
        String(o.contato?.nome||"");
      const canalSlug = detectCh(o);
      const canalId = canaisLookup[canalSlug] || canaisLookup["outros"] || null;
      const source = String(o._source||"bling").toLowerCase().trim() || "bling";
      const baseId = String(o.id || o.numero || "").trim();
      let id = baseId || "";
      if(source === "yampi" && id && !id.includes(":")){
        id = existingLegacyYampiIds.has(id) ? id : ("yampi:" + id);
      }
      const createdAt = toIsoOrNull(o.dataCriacao || o.data) || new Date().toISOString();
      const row = {
        id,
        bling_id: source === "bling" ? (String(o.id||o.numero||"").trim() || null) : null,
        numero_pedido: (String(o.numero||o.id||"").trim() || null),
        cliente_id: docToUuid[doc] || null,
        canal_id: canalId,
        data_pedido: toDateOrNull(o.data),
        total: val(o),
        status: normSt(o.situacao),
        source,
        created_at: createdAt
      };
      return row;
    }).filter(p => p.id); // id é obrigatório (PK)
    const { ok: validPedRows } = splitValidRows(pedRows, ["id"], "[Upsert v2_pedidos]");
    const { ok: validPedRowsWithCli } = splitValidRows(validPedRows, ["cliente_id"], "[Upsert v2_pedidos]");
    validPedRows.forEach(r=>{
      if(!isNil(r.cliente_id) && !isUuid(r.cliente_id)){
        try{
          console.warn("[Upsert v2_pedidos] registro ignorado (cliente_id inválido)", sanitizeForSupabaseLog(r));
        }catch(_e){}
        r.__invalid_cliente_id = true;
      }
    });
    const finalPedRows = validPedRowsWithCli.filter(r=>!r.__invalid_cliente_id);
    for(let i=0; i<finalPedRows.length; i+=100){
      const batch = finalPedRows.slice(i,i+100);
      const payload = batch.map(sanitizePayload).filter(Boolean);
      const {error} = await supaClient.from("v2_pedidos").upsert(payload, { onConflict: "id" });
      if(error){
        hadUpsertError = true;
        try{ console.error("[Upsert v2_pedidos]", error, sanitizeForSupabaseLog(payload.slice(0,10))); }catch(_e){}
        logSupabaseUpsertError("upsert v2_pedidos error", error, batch.slice(0,5));
        for(const row of payload){
          try{
            const {error: rowErr} = await supaClient.from("v2_pedidos").upsert([sanitizePayload(row)], { onConflict: "id" });
            if(rowErr){
              hadUpsertError = true;
              try{
                console.warn("[Upsert v2_pedidos] registro ignorado (erro no upsert)", sanitizeForSupabaseLog(row));
                console.error("[Upsert v2_pedidos]", rowErr, sanitizeForSupabaseLog(row));
              }catch(_e){}
            }
          }catch(_e){}
        }
      }
    }

    try{
      const productsById = {};
      const list = Array.isArray(orders) ? orders : [];
      list.forEach(o=>{
        const itens = getPedidoItens(o);
        itens.forEach(it=>{
          const codigo = String(it?.codigo || it?.sku || "").trim();
          const nome = String(it?.descricao || it?.produto_nome || it?.title || it?.nome || it?.name || "").trim();
          const id = String(codigo || nome).trim();
          if(!id) return;
          if(!productsById[id]){
            productsById[id] = {
              id,
              codigo: codigo || null,
              nome: nome || null,
              estoque: null,
              preco: null,
              situacao: null,
              origem: String(o?._source || "bling"),
              updated_at: new Date().toISOString(),
              raw: { codigo: codigo || null, nome: nome || null, source: String(o?._source || "bling") }
            };
          }else{
            if(codigo && !productsById[id].codigo) productsById[id].codigo = codigo;
            if(nome && !productsById[id].nome) productsById[id].nome = nome;
          }
        });
      });
      const prodRows = Object.values(productsById);
      for(let i=0;i<prodRows.length;i+=200){
        const batch = prodRows.slice(i,i+200);
        const {error} = await supaClient.from("v2_produtos").upsert(batch, { onConflict: "id" });
        if(error){
          logSupabaseUpsertError("upsert v2_produtos error", error, batch.slice(0,5));
          throw error;
        }
      }
    }catch(e){
      logSupabaseUpsertError("upsert v2_produtos from orders error", e, null);
      throw e;
    }
    upsertV2PedidosItemsFromOrders(orders).catch(e=>console.warn("[items upsert]", e?.message||e));
    if(hadUpsertError){
      toast("⚠️ Erro ao salvar dados. Ver console F12.");
    }else{
      if(!silent) toast('✓ Dados salvos no Supabase!');
    }
  }catch(e){
    logSupabaseUpsertError("upsert orders error", e, { orders: Array.isArray(orders) ? orders.slice(0,2) : null });
    try{ console.error("[Upsert orders]", e, { orders: Array.isArray(orders) ? orders.slice(0,2) : null }); }catch(_e){}
    toast("⚠️ Erro ao salvar dados. Ver console F12.");
  }finally{
    upsertOrdersInFlight = false;
    setSyncDot(false);
  }
}

async function runPostFixValidation(){
  const result = {
    supabase: { connected: !!(supaConnected && supaClient) },
    local: {
      allOrders: Array.isArray(allOrders) ? allOrders.length : 0,
      allCustomers: Array.isArray(allCustomers) ? allCustomers.length : 0,
      blingOrders: Array.isArray(blingOrders) ? blingOrders.length : 0,
      yampiOrders: Array.isArray(yampiOrders) ? yampiOrders.length : 0
    },
    remote: {
      v2_pedidos: { count: null, sample: [] },
      v2_clientes: { count: null, sample: [] },
      v2_pedidos_items: { available: null, count: null }
    }
  };

  if(!supaConnected || !supaClient){
    console.warn("Validação: Supabase não conectado.");
    return result;
  }

  try{
    const q1 = await supaClient.from("v2_pedidos").select("id", { count: "exact", head: true });
    if(q1?.error) throw q1.error;
    result.remote.v2_pedidos.count = q1.count ?? null;
  }catch(e){
    console.warn("Validação: erro ao contar v2_pedidos", e);
  }

  try{
    const q2 = await supaClient.from("v2_clientes").select("id", { count: "exact", head: true });
    if(q2?.error) throw q2.error;
    result.remote.v2_clientes.count = q2.count ?? null;
  }catch(e){
    console.warn("Validação: erro ao contar v2_clientes", e);
  }

  try{
    const {data, error} = await supaClient
      .from("v2_pedidos")
      .select("id,numero_pedido,cliente_id,source,total,data_pedido,created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    if(error) throw error;
    result.remote.v2_pedidos.sample = Array.isArray(data) ? data : [];
  }catch(e){
    console.warn("Validação: erro ao buscar amostra v2_pedidos", e);
  }

  try{
    const {data, error} = await supaClient
      .from("v2_clientes")
      .select("id,nome,doc,email,telefone,cidade,uf,updated_at")
      .order("updated_at", { ascending: false })
      .limit(5);
    if(error) throw error;
    result.remote.v2_clientes.sample = Array.isArray(data) ? data : [];
  }catch(e){
    console.warn("Validação: erro ao buscar amostra v2_clientes", e);
  }

  try{
    const ok = await ensureV2PedidosItemsAvailable();
    result.remote.v2_pedidos_items.available = ok;
    if(ok){
      const q3 = await supaClient.from("v2_pedidos_items").select("id", { count: "exact", head: true });
      if(q3?.error) throw q3.error;
      result.remote.v2_pedidos_items.count = q3.count ?? null;
    }
  }catch(e){
    console.warn("Validação: erro ao checar v2_pedidos_items", e);
  }

  try{
    console.groupCollapsed("Validação pós-correção");
    console.log("result:", result);
    console.groupEnd();
  }catch(_e){}

  return result;
}

async function runClienteDebug(customerKey){
  const key = String(customerKey||"").trim();
  const result = { input: key, cliente: null, pedidos: [], itensByPedido: {}, match_clienteId: null, errors: [] };
  if(!supaConnected || !supaClient){
    result.errors.push("Supabase não conectado");
    console.warn("runClienteDebug: Supabase não conectado");
    return result;
  }
  if(!key){
    result.errors.push("Chave vazia");
    return result;
  }

  const digits = key.replace(/\D/g,"");
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
  const isEmail = key.includes("@");
  try{
    let q = supaClient.from("v2_clientes").select("*").limit(1);
    if(isUuid) q = q.eq("id", key);
    else if(digits.length===11 || digits.length===14) q = q.eq("doc", digits);
    else if(isEmail) q = q.ilike("email", key.toLowerCase());
    else if(digits.length>=10) q = q.eq("telefone", digits);
    else q = q.ilike("nome", key);
    const {data, error} = await q.maybeSingle();
    if(error) throw error;
    result.cliente = data || null;
  }catch(e){
    result.errors.push("Erro v2_clientes: " + (e?.message || String(e)));
  }

  const clienteId = result.cliente?.id;
  if(clienteId){
    try{
      const {data, error} = await supaClient
        .from("v2_pedidos")
        .select("id,numero_pedido,cliente_id,canal_id,data_pedido,total,status,created_at")
        .eq("cliente_id", clienteId)
        .order("data_pedido", { ascending: false })
        .limit(20);
      if(error) throw error;
      result.pedidos = Array.isArray(data) ? data : [];
      const first = result.pedidos[0];
      if(first?.cliente_id != null) result.match_clienteId = String(first.cliente_id) === String(clienteId);
    }catch(e){
      result.errors.push("Erro v2_pedidos: " + (e?.message || String(e)));
    }

    try{
      const ok = await ensureV2PedidosItemsAvailable();
      if(ok && result.pedidos.length){
        const ids = Array.from(new Set(result.pedidos.map(p=>p?.id).filter(Boolean))).slice(0,500);
        for(let i=0;i<ids.length;i+=200){
          const batch = ids.slice(i,i+200);
          const {data, error} = await supaClient
            .from("v2_pedidos_items")
            .select("pedido_id,produto_nome,quantidade,valor_unitario,valor_total")
            .in("pedido_id", batch)
            .limit(20000);
          if(error) throw error;
          (data||[]).forEach(r=>{
            const pid = String(r.pedido_id||"");
            if(!pid) return;
            if(!result.itensByPedido[pid]) result.itensByPedido[pid] = [];
            result.itensByPedido[pid].push(r);
          });
        }
      }
    }catch(e){
      result.errors.push("Erro v2_pedidos_items: " + (e?.message || String(e)));
    }
  }

  try{
    console.groupCollapsed("Cliente debug");
    console.log("result:", result);
    console.groupEnd();
  }catch(_e){}
  return result;
}

function setupRealtimeSync(){
  if(!supaClient) return;
  try{
    supaClient.channel('tarefas-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'v2_tarefas'}, async()=>{
        const {data} = await supaClient.from('v2_tarefas').select('*').order('created_at',{ascending:false}).limit(500);
        tarefasCache = (data||[]).map(t => ({
          ...t,
          desc: t.descricao||'',
          data: t.vencimento||'',
          status: t.status === 'aberta' ? 'pendente' : t.status
        }));
        renderTarefas();
        updateBadge();
        pushNotif('🔄 Tarefas atualizadas');
      }).subscribe();
    supaClient.channel('clientes-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'v2_clientes'}, async()=>{
        await loadClienteMetaCache();
        if(document.getElementById("page-oportunidades")?.classList.contains("active")) renderOportunidades();
        if(document.getElementById("page-cliente")?.classList.contains("active") && currentClienteId) renderClienteTimeline(currentClienteId).catch(()=>{});
        if(document.getElementById("page-inteligencia")?.classList.contains("active")) renderInteligencia();
        toast('🔄 Dados sincronizados!');
      }).subscribe();
    supaClient.channel('interactions-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'interactions'}, async()=>{
        await loadClienteMetaCache();
        if(document.getElementById("page-oportunidades")?.classList.contains("active")) renderOportunidades();
        if(document.getElementById("page-cliente")?.classList.contains("active") && currentClienteId) renderClienteTimeline(currentClienteId).catch(()=>{});
        if(document.getElementById("page-inteligencia")?.classList.contains("active")) renderInteligencia();
      }).subscribe();
    supaClient.channel('insumos-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'insumos'}, async()=>{
        await loadInsumosFromSupabase();
      }).subscribe();
    supaClient.channel('receitas-produtos-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'receitas_produtos'}, async()=>{
        await loadReceitasProdutosFromSupabase();
      }).subscribe();
    supaClient.channel('ordens-producao-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'ordens_producao'}, async()=>{
        await loadOrdensProducaoFromSupabase();
      }).subscribe();
    supaClient.channel('movimentos-estoque-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'movimentos_estoque'}, async()=>{
        await loadMovimentosEstoqueFromSupabase();
      }).subscribe();
    supaClient.channel('carrinhos-abandonados-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'carrinhos_abandonados'}, async()=>{
        await loadCarrinhosAbandonadosFromSupabase();
      }).subscribe();
    supaClient.channel('config-rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'configuracoes'}, async(payload)=>{
        if(payload.new?.chave==='meta_mensal'){ localStorage.setItem('crm_meta',payload.new.valor_texto||'0'); renderDash(); }
        if(payload.new?.chave==='alert_days'){ localStorage.setItem('crm_alertdays',payload.new.valor_texto||'60'); renderAlertas(); }
        if(payload.new?.chave==='crm_access_users'){ localStorage.setItem('crm_access_users',payload.new.valor_texto||'[]'); renderAccessUsers(); }
      }).subscribe();
  }catch(e){ console.warn('realtime:', e.message); }
}

// ═══════════════════════════════════════════════════════════
// MÓDULO PRODUÇÃO
// ═══════════════════════════════════════════════════════════

// PRODUCAO_MODULE_START
// PRODUCAO_MODULE_END

// ═══════════════════════════════════════════════════════════
// MÓDULO COMERCIAL
// ═══════════════════════════════════════════════════════════

let allCampanhas = safeJsonParse('crm_campanhas', null) || [
  {id:1,nome:'Semana do Chocolate',canal:'shopee',tipo:'desconto',inicio:'2025-03-15',fim:'2025-03-21',oferta:'25% off linha chocolate',budget:500,meta:8000,status:'encerrada',desc:''},
  {id:2,nome:'Frete Grátis Fim de Semana',canal:'site',tipo:'frete',inicio:'2025-03-29',fim:'2025-03-30',oferta:'Frete grátis acima de R$89',budget:200,meta:5000,status:'planejada',desc:''},
  {id:3,nome:'Lançamento Sabor Açaí',canal:'todos',tipo:'lancamento',inicio:'2025-04-07',fim:'2025-04-14',oferta:'R$10 off no primeiro pedido',budget:1200,meta:15000,status:'planejada',desc:''},
];
function saveCampanhas(){ localStorage.setItem('crm_campanhas',JSON.stringify(allCampanhas)); }

function mapComStatusFromOrder(o){
  const raw = String(o?.status || o?.situacao?.nome || o?.financial_status || "").toLowerCase();
  if(/cancel|cance|void|refun/.test(raw)) return "cancelado";
  if(/entreg|delivered|conclu/.test(raw)) return "entregue";
  if(/envi|shipp|dispatch/.test(raw)) return "enviado";
  if(/separ|prepar|paid|aprov|pago|processing/.test(raw)) return "separando";
  return "novo";
}

function summarizeOrderItems(o){
  const itens = getPedidoItens(o);
  if(!itens.length) return "—";
  const getName = (it)=>String(it?.descricao || it?.codigo || "").trim();
  const getQty = (it)=>Number(it?.quantidade ?? it?.quantity ?? it?.qty ?? 0) || 0;
  const parts = itens
    .map(it=>{
      const name = getName(it);
      const qty = getQty(it);
      if(!name) return "";
      return qty > 1 ? `${name} x${qty}` : name;
    })
    .filter(Boolean);
  if(!parts.length) return "—";
  const head = parts.slice(0,2).join(", ");
  return parts.length > 2 ? `${head} +${parts.length-2}` : head;
}

function normalizeCanal(origem){
  const norm = (v)=>String(v||"")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .trim();
  const s = norm(origem);
  if(!s) return { slug: "outros", nome: "Outros", emoji: "🔹", color: "var(--text-2)" };
  if(s === "ml" || s === "mercado_livre" || /\bmercado\s*livre\b|\bmercadolivre\b|\bmeli\b|\bmlb\b/.test(s)) return { slug: "mercado_livre", nome: "Mercado Livre", emoji: "🟡", color: "var(--ml)" };
  if(s === "shopee" || /\bshopee\b/.test(s)) return { slug: "shopee", nome: "Shopee", emoji: "🟠", color: "var(--shopee)" };
  if(s === "amazon" || /\bamazon\b/.test(s)) return { slug: "amazon", nome: "Amazon", emoji: "🟦", color: "var(--amazon)" };
  if(s === "shopify" || /\bshopify\b|\bloja\s*online\b|\becommerce\b|\bsite\b/.test(s)) return { slug: "shopify", nome: "Shopify / Site próprio", emoji: "🟢", color: "var(--shopify)" };
  if(s === "yampi" || /\byampi\b/.test(s)) return { slug: "yampi", nome: "Yampi / Checkout", emoji: "🟣", color: "var(--yampi)" };
  if(s === "b2b" || s === "cnpj" || /\bb2b\b|\bcnpj\b|\batacado\b/.test(s)) return { slug: "b2b", nome: "B2B / Atacado", emoji: "🟤", color: "var(--amber)" };
  return { slug: "outros", nome: "Outros", emoji: "🔹", color: "var(--text-2)" };
}

function canalFromOrder(o){
  const origem = String(o?.origem_canal ?? o?.origemCanal ?? "").trim();
  if(origem) return normalizeCanal(origem);
  const sourceHint = String(o?._source || o?.source || "").toLowerCase().trim();
  if(sourceHint === "yampi") return normalizeCanal("yampi");
  if(sourceHint === "shopify") return normalizeCanal("shopify");
  const raw =
    o?._canal ??
    o?.canal ??
    o?.channel ??
    o?.loja?.nome ??
    o?.origem?.nome ??
    o?.ecommerce?.nome ??
    "";
  const detected = normalizeCanal(raw || detectCh(o) || "");
  if(detected.slug !== "outros") return detected;
  const byDetect = normalizeCanal(detectCh(o) || "");
  return byDetect;
}

function getComPedidosBase(){
  const baseOrders =
    (Array.isArray(allOrders) && allOrders.length ? allOrders : null) ||
    (Array.isArray(blingOrders) && blingOrders.length ? blingOrders : null) ||
    (Array.isArray(yampiOrders) && yampiOrders.length ? yampiOrders : []);
  const orders = baseOrders.slice().sort((a,b)=>new Date(b.data || b.data_pedido || b.created_at || 0)-new Date(a.data || a.data_pedido || a.created_at || 0));
  return orders.map(o=>{
    const numRaw = o?.numero_pedido || o?.numero || o?.name || o?.order_number || o?.id || "";
    const num = numRaw ? (String(numRaw).startsWith("#") ? String(numRaw) : "#"+String(numRaw)) : "#—";
    const cliente = String(o?.contato?.nome || o?.customer?.name || o?.cliente?.nome || "—");
    const canalInfo = canalFromOrder(o);
    const produto = summarizeOrderItems(o);
    const valor = Number(val(o) || o?.total || o?.total_price || 0) || 0;
    const dataIso = String(o?.data_pedido || o?.data || o?.created_at || "").slice(0,10) || "";
    const data = dataIso ? fmtDate(dataIso) : "—";
    const status = mapComStatusFromOrder(o);
    return { id: String(o?.id || numRaw || cryptoRandomId()), num, cliente, canal: canalInfo.slug, canal_nome: canalInfo.nome, canal_color: canalInfo.color, canal_emoji: canalInfo.emoji, produto, valor, status, data };
  });
}

function cryptoRandomId(){
  try{
    if(globalThis.crypto?.getRandomValues){
      const b = new Uint8Array(8);
      crypto.getRandomValues(b);
      return Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("");
    }
  }catch(_e){}
  return String(Date.now()) + String(Math.random()).slice(2);
}

function renderComKpis(){
  var el=document.getElementById('com-kpis'); if(!el) return;
  var pedidos=getComPedidosBase();
  var receita=pedidos.reduce(function(s,p){return s+p.valor;},0);
  var ativas=allCampanhas.filter(function(c){return c.status==='ativa';}).length;
  var canais=[...new Set(pedidos.map(function(p){return p.canal;}))].length;
  el.innerHTML=kpiCard('Pedidos',pedidos.length,'no período','var(--text)')+kpiCard('Receita','R$'+receita.toLocaleString('pt-BR',{minimumFractionDigits:0}),'total','var(--green)')+kpiCard('Campanhas Ativas',ativas,'rodando','var(--indigo-hi)')+kpiCard('Canais',canais,'ativos','var(--amber)');
}

function renderComPedidos(){
  var el=document.getElementById('com-pedidos-list'); if(!el) return;
  var q=((document.getElementById('search-com')||{}).value||'').toLowerCase();
  var canal=(document.getElementById('fil-com-canal')||{}).value||'';
  var status=(document.getElementById('fil-com-status')||{}).value||'';
  var base=getComPedidosBase();
  var list=base.filter(function(p){
    if(q && !p.num.toLowerCase().includes(q) && !p.cliente.toLowerCase().includes(q)) return false;
    if(canal && p.canal!==canal) return false;
    if(status && p.status!==status) return false;
    return true;
  });
  if(!list.length){ el.innerHTML='<div class="empty">Nenhum pedido encontrado</div>'; return; }
  var stL={novo:'🆕 Novo',separando:'📦 Separando',enviado:'🚚 Enviado',entregue:'✅ Entregue',cancelado:'❌ Cancelado'};
  var stC={novo:'var(--blue)',separando:'var(--amber)',enviado:'var(--indigo-hi)',entregue:'var(--green)',cancelado:'var(--red)'};
  var stB={novo:'var(--blue-bg)',separando:'var(--amber-bg)',enviado:'var(--indigo-bg)',entregue:'var(--green-bg)',cancelado:'var(--red-bg)'};
  var cC={shopee:'var(--shopee)',shopify:'var(--shopify)',yampi:'var(--yampi)',amazon:'var(--amazon)',mercado_livre:'var(--ml)',b2b:'var(--amber)',outros:'var(--text-2)',whatsapp:'#25d366',instagram:'#e040fb'};
  var header='<div class="table-head table-head-com"><span>Pedido</span><span>Cliente / Produto</span><span>Canal</span><span class="ta-r">Valor</span><span class="ta-r">Status</span></div>';
  el.innerHTML=header+list.map(function(p){
    return '<div class="table-row table-row-com">'+
      '<div><div class="mono-link">'+escapeHTML(p.num)+'</div><div class="muted-xs">'+escapeHTML(p.data)+'</div></div>'+
      '<div><div class="row-title">'+escapeHTML(p.cliente)+'</div><div class="muted-sm">'+escapeHTML(p.produto)+'</div></div>'+
      '<div><span class="pill pill-soft" style="color:'+(cC[p.canal]||p.canal_color||'var(--text-2)')+'">'+escapeHTML(p.canal_nome||String(p.canal||"").toUpperCase())+'</span></div>'+
      '<div class="ta-r mono-strong">R$'+p.valor.toFixed(2)+'</div>'+
      '<div class="ta-r"><span class="pill" style="background:'+stB[p.status]+';color:'+stC[p.status]+'">'+escapeHTML(stL[p.status]||p.status)+'</span></div>'+
    '</div>';
  }).join('');
}

function renderCanaisGrid(){
  var el=document.getElementById('canais-grid'); if(!el) return;
  var por={};
  getComPedidosBase().forEach(function(p){
    var key=p.canal||"outros";
    if(!por[key]) por[key]={qtd:0,receita:0,info:{nome:p.canal_nome||key,emoji:p.canal_emoji||"🔹",color:p.canal_color||"var(--text-2)"}};
    por[key].qtd++;
    por[key].receita+=p.valor;
  });
  var sorted=Object.entries(por).sort(function(a,b){return (b[1].receita||0)-(a[1].receita||0);});
  el.innerHTML=sorted.map(function(e){
    var dados=e[1],info=dados.info||{nome:e[0],emoji:'🔹',color:'var(--text-2)'};
    var ticket=dados.qtd?dados.receita/dados.qtd:0;
    return '<div class="canal-card"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><div style="font-size:24px">'+info.emoji+'</div><div><div style="font-size:13px;font-weight:800">'+escapeHTML(info.nome)+'</div><div style="font-size:10px;color:var(--text-3)">'+dados.qtd+' pedidos</div></div></div><div style="font-size:22px;font-weight:800;font-family:var(--mono);color:'+info.color+';margin-bottom:8px">R$'+dados.receita.toLocaleString('pt-BR',{minimumFractionDigits:0})+'</div><div style="font-size:10px;color:var(--text-3)">Ticket médio: <b style="color:var(--text)">R$'+ticket.toFixed(2)+'</b></div></div>';
  }).join('');
}

function renderCampanhas(){
  var el=document.getElementById('campanhas-list'); if(!el) return;
  if(!allCampanhas.length){ el.innerHTML='<div class="empty">Nenhuma campanha cadastrada</div>'; return; }
  var stC={ativa:'cs-ativa',planejada:'cs-planejada',pausada:'cs-pausada',encerrada:'cs-encerrada'};
  var stL={ativa:'🟢 Ativa',planejada:'📋 Planejada',pausada:'⏸️ Pausada',encerrada:'🔴 Encerrada'};
  var tE={desconto:'🏷️',frete:'🚚',brinde:'🎁',kit:'📦',lancamento:'🚀'};
  el.innerHTML=[].concat(allCampanhas).reverse().map(function(c){
    return '<div class="campanha-card"><div><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:16px">'+(tE[c.tipo]||'📣')+'</span><div style="font-size:13px;font-weight:800">'+escapeHTML(c.nome)+'</div></div><div style="font-size:10px;color:var(--text-3);margin-bottom:8px">'+escapeHTML(fmtDate(c.inicio))+' → '+escapeHTML(fmtDate(c.fim))+' · '+escapeHTML(String(c.canal||"").toUpperCase())+' · '+escapeHTML(c.oferta)+'</div><div style="display:flex;gap:16px"><span style="font-size:10px;color:var(--text-3)">Budget: <b style="color:var(--text)">R$'+c.budget.toLocaleString('pt-BR')+'</b></span><span style="font-size:10px;color:var(--text-3)">Meta: <b style="color:var(--green)">R$'+c.meta.toLocaleString('pt-BR')+'</b></span></div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px"><span class="camp-status '+stC[c.status]+'">'+escapeHTML(stL[c.status]||c.status)+'</span><button onclick="abrirModalCampanha('+c.id+')" style="background:none;border:1px solid var(--border);border-radius:var(--r-md);padding:4px 10px;color:var(--text-2);font-size:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Editar</button></div></div>';
  }).join('');
}

function renderCarrinhosAbandonados(){
  var el=document.getElementById('carrinhos-list'); if(!el) return;
  try{
    carrinhosAbandonados = safeJsonParse("crm_carrinhos_abandonados", []) || carrinhosAbandonados || [];
  }catch(_e){}
  var q=String((document.getElementById('car-search')||{}).value||'').trim().toLowerCase();
  var st=String((document.getElementById('car-status')||{}).value||'');

  var lookup = buildClienteLookupParaCarrinhos();
  var list=[].concat(carrinhosAbandonados||[]).map(normalizeCarrinhoAbandonado).filter(function(c){
    if(!c.checkout_id) return false;
    if(st==='abertos' && c.recuperado) return false;
    if(st==='recuperados' && !c.recuperado) return false;
    if(q){
      var hit = String(c.cliente_nome||'').toLowerCase().includes(q) ||
        String(c.email||'').toLowerCase().includes(q) ||
        rawPhone(c.telefone||'').includes(rawPhone(q));
      if(!hit) return false;
    }
    return true;
  }).map(function(c){
    var calc = calcularScoreRecuperacaoCarrinho(c, lookup);
    var score = c.score_recuperacao == null ? calc.score : (Number(c.score_recuperacao||0)||0);
    var mins = calc.mins;
    var tempo = fmtTempoDesde(mins);
    var etapa = sugerirEtapaParaCarrinho(c, mins);
    var prioridade = prioridadePorScore(score);
    var lastMins = minutosDesdeIso(c.last_mensagem_at);
    var lastLabel = lastMins == null ? "" : fmtTempoDesde(lastMins);
    return Object.assign({}, c, {score_calc: score, tempo_min: mins, tempo_label: tempo, etapa_id: etapa.id, etapa_label: etapa.label, prioridade_id: prioridade.id, prioridade_label: prioridade.label, cli_status: calc.cli ? calc.cli.status : "", last_tempo_label: lastLabel});
  }).sort(function(a,b){
    if(a.recuperado !== b.recuperado) return a.recuperado ? 1 : -1;
    if((b.score_calc||0) !== (a.score_calc||0)) return (b.score_calc||0) - (a.score_calc||0);
    return new Date(b.criado_em||0) - new Date(a.criado_em||0);
  });

  if(!list.length){
    el.innerHTML='<div class="empty" style="padding:40px 0">Nenhum carrinho encontrado.</div>';
    return;
  }

  el.innerHTML =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:12px">'+
      '<table class="chiva-table">'+
        '<thead><tr>'+
          '<th>Tempo</th>'+
          '<th>Cliente</th>'+
          '<th>Prioridade</th>'+
          '<th style="text-align:right">Score</th>'+
          '<th style="text-align:right">Valor</th>'+
          '<th>Mensagem</th>'+
          '<th></th>'+
        '</tr></thead>'+
        '<tbody>'+
          list.map(function(c){
            var safeId = escapeJsSingleQuote(String(c.checkout_id||''));
            var name = escapeHTML(c.cliente_nome||'—');
            var contato = [c.telefone?fmtPhone(c.telefone):'', c.email?escapeHTML(c.email):''].filter(Boolean).join(' · ') || '—';
            var dt = c.tempo_label || '—';
            var prioridadeLabel = c.prioridade_label || '—';
            var prioridadeIcon = c.prioridade_id==='alta' ? '🔥' : (c.prioridade_id==='media' ? '⚡' : '🧊');
            var prioridadeTxt = prioridadeIcon+' '+prioridadeLabel;
            var scoreTxt = String(Math.round(c.score_calc||0));
            var msgLabel = c.recuperado ? '—' : (c.etapa_label || '—');
            var lastStageLabel = (function(id){
              if(id==='ajuda') return 'Ajuda';
              if(id==='link') return 'Link';
              if(id==='incentivo') return 'Incentivo';
              return id || '';
            })(String(c.last_etapa_enviada||''));
            var lastInfo = (!c.recuperado && c.last_etapa_enviada) ? ('<div style="font-size:10px;color:var(--text-3);margin-top:2px">Última: '+escapeHTML(lastStageLabel)+(c.last_tempo_label?(' · '+escapeHTML(c.last_tempo_label)):'')+'</div>') : '';
            var btnLabel = (function(id){
              if(id==='ajuda') return 'WhatsApp (ajuda)';
              if(id==='link') return 'WhatsApp (link)';
              if(id==='incentivo') return 'WhatsApp (24h)';
              if(id==='aguardar') return 'WhatsApp';
              return 'WhatsApp';
            })(String(c.etapa_id||''));
            var btn = c.recuperado ? '' : ('<button class="opp-mini-btn" onclick="openWhatsAppCarrinho(\''+safeId+'\')">'+escapeHTML(btnLabel)+'</button> ');
            var itens = Array.isArray(c.produtos) ? c.produtos : [];
            var resumo = itens.slice(0,3).map(function(it){ return String(it?.nome||it?.title||it?.descricao||it?.name||'').trim(); }).filter(Boolean).join(', ');
            var subtitle = resumo ? ('<div style="font-size:10px;color:var(--text-3);margin-top:2px">'+escapeHTML(resumo)+'</div>') : '';
            return '<tr>'+
              '<td class="chiva-table-mono">'+escapeHTML(dt)+'</td>'+
              '<td><div style="font-weight:800;color:var(--text)">'+name+'</div>'+subtitle+'<div style="font-size:10px;color:var(--text-3);margin-top:2px">'+escapeHTML(contato)+'</div></td>'+
              '<td>'+escapeHTML(prioridadeTxt)+'</td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(scoreTxt)+'</td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(fmtBRL(c.valor||0))+'</td>'+
              '<td>'+escapeHTML(msgLabel)+lastInfo+'</td>'+
              '<td style="text-align:right;white-space:nowrap">'+
                btn+
                '<button class="opp-mini-btn" onclick="copyCarrinhoId(\''+safeId+'\')">Copiar ID</button>'+
              '</td>'+
            '</tr>';
          }).join('')+
        '</tbody>'+
      '</table>'+
    '</div>';
}

function copyCarrinhoId(checkoutId){
  const id = String(checkoutId||"");
  try{
    navigator.clipboard.writeText(id).then(()=>toast("Checkout copiado")).catch(()=>{});
  }catch(_e){}
}

function setComTab(tab){
  ['pedidos','canais','campanhas','carrinhos'].forEach(function(t){
    var el=document.getElementById('com-tab-'+t);
    var btn=document.getElementById('ctab-'+t);
    if(el) el.style.display=t===tab?'':'none';
    if(btn) btn.classList.toggle('active-tab',t===tab);
  });
  if(tab==='pedidos'){ renderComPedidos(); setTimeout(renderChartsCom,100); }
  if(tab==='canais') renderCanaisGrid();
  if(tab==='campanhas') renderCampanhas();
  if(tab==='carrinhos') renderCarrinhosAbandonados();
}

function abrirModalCampanha(id){
  var m=document.getElementById('modal-campanha');
  var del=document.getElementById('btn-del-camp');
  if(id){
    var c=allCampanhas.find(function(x){return x.id===id;});
    if(!c) return;
    document.getElementById('camp-edit-id').value=id;
    document.getElementById('modal-campanha-title').textContent='Editar Campanha';
    document.getElementById('camp-nome').value=c.nome;
    document.getElementById('camp-canal').value=c.canal;
    document.getElementById('camp-tipo').value=c.tipo;
    document.getElementById('camp-inicio').value=c.inicio?fmtDate(c.inicio):'';
    document.getElementById('camp-fim').value=c.fim?fmtDate(c.fim):'';
    document.getElementById('camp-oferta').value=c.oferta||'';
    document.getElementById('camp-budget').value=c.budget||0;
    document.getElementById('camp-meta').value=c.meta||0;
    document.getElementById('camp-status').value=c.status;
    document.getElementById('camp-desc').value=c.desc||'';
    del.style.display='';
  } else {
    document.getElementById('camp-edit-id').value='';
    document.getElementById('modal-campanha-title').textContent='Nova Campanha';
    ['camp-nome','camp-inicio','camp-fim','camp-oferta','camp-budget','camp-meta','camp-desc'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
    document.getElementById('camp-status').value='planejada';
    del.style.display='none';
  }
  m.classList.add('open');
}
function salvarCampanha(){
  var id=document.getElementById('camp-edit-id').value;
  var obj={id:id?parseInt(id):Date.now(),nome:document.getElementById('camp-nome').value.trim(),canal:document.getElementById('camp-canal').value,tipo:document.getElementById('camp-tipo').value,inicio:parseDateToIso(document.getElementById('camp-inicio').value),fim:parseDateToIso(document.getElementById('camp-fim').value),oferta:document.getElementById('camp-oferta').value.trim(),budget:parseFloat(document.getElementById('camp-budget').value)||0,meta:parseFloat(document.getElementById('camp-meta').value)||0,status:document.getElementById('camp-status').value,desc:document.getElementById('camp-desc').value.trim()};
  if(!obj.nome){ toast('⚠️ Informe o nome da campanha'); return; }
  if(id){ var idx=allCampanhas.findIndex(function(x){return x.id===parseInt(id);}); if(idx>=0) allCampanhas[idx]=obj; } else allCampanhas.push(obj);
  saveCampanhas(); renderCampanhas(); renderComKpis(); fecharModal('modal-campanha'); toast('✅ Campanha salva!');
}
function deletarCampanha(){
  var id=parseInt(document.getElementById('camp-edit-id').value);
  allCampanhas=allCampanhas.filter(function(x){return x.id!==id;});
  saveCampanhas(); renderCampanhas(); renderComKpis(); fecharModal('modal-campanha'); toast('🗑️ Campanha excluída');
}

// ═══════════════════════════════════════════════════════════
// MÓDULO MARCA
// ═══════════════════════════════════════════════════════════

var calMesAtual=new Date().getMonth(), calAnoAtual=new Date().getFullYear(), filtroDia=null;

let allEventos = safeJsonParse('crm_eventos', null) || [
  {id:1,titulo:'Degustação Shopping Iguatemi',tipo:'degustacao',data:'2025-03-29',hora:'10:00',local:'Shopping Iguatemi — BH',responsavel:'Ana',custo:350,amostras:120,conversoes:18,receita:1620,obs:'Ótima receptividade sabor chocolate'},
  {id:2,titulo:'Feira Natural Expo',tipo:'feira',data:'2025-04-12',hora:'09:00',local:'Expo Center — SP',responsavel:'Carlos',custo:1200,amostras:250,conversoes:0,receita:0,obs:'Montar estande 3x3'},
  {id:3,titulo:'Live com Nutricionista',tipo:'live',data:'2025-04-05',hora:'19:00',local:'Instagram @chivafit',responsavel:'Marketing',custo:0,amostras:0,conversoes:0,receita:0,obs:'Tema: proteína na dieta feminina'},
  {id:4,titulo:'Degustação Academia FitLife',tipo:'degustacao',data:'2025-04-19',hora:'07:00',local:'Academia FitLife — BH',responsavel:'Ana',custo:150,amostras:60,conversoes:0,receita:0,obs:''},
];
function saveEventos(){ localStorage.setItem('crm_eventos',JSON.stringify(allEventos)); }

function renderMarcaKpis(){
  var el=document.getElementById('marca-kpis'); if(!el) return;
  var degust=allEventos.filter(function(e){return e.tipo==='degustacao';});
  var tA=degust.reduce(function(s,e){return s+(e.amostras||0);},0);
  var tC=degust.reduce(function(s,e){return s+(e.conversoes||0);},0);
  var tR=degust.reduce(function(s,e){return s+(e.receita||0);},0);
  var taxa=tA>0?Math.round(tC/tA*100):0;
  el.innerHTML=kpiCard('Eventos',allEventos.length,'cadastrados','var(--text)')+kpiCard('Degustações',degust.length,'realizadas','var(--amber)')+kpiCard('Amostras',tA,'distribuídas','var(--blue)')+kpiCard('Taxa Conv.',taxa+'%',tC+' vendas','var(--green)')+kpiCard('Receita Trade','R$'+tR.toLocaleString('pt-BR',{minimumFractionDigits:0}),'gerada','var(--green)');
}

function renderCalendario(){
  var el=document.getElementById('calendario-grid'), titulo=document.getElementById('cal-titulo');
  if(!el) return;
  var meses=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  if(titulo) titulo.textContent=meses[calMesAtual]+' '+calAnoAtual;
  var dias=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  var prim=new Date(calAnoAtual,calMesAtual,1).getDay();
  var ult=new Date(calAnoAtual,calMesAtual+1,0).getDate();
  var hoje=new Date();
  var evMes=allEventos.filter(function(e){ var d=new Date(e.data+'T12:00:00'); return d.getMonth()===calMesAtual && d.getFullYear()===calAnoAtual; });
  var diasEv=new Set(evMes.map(function(e){return parseInt(e.data.split('-')[2]);}));
  var h=dias.map(function(d){return '<div class="cal-header-day">'+d+'</div>';}).join('');
  for(var i=0;i<prim;i++) h+='<div class="cal-day outro-mes"><div class="cal-day-num" style="color:var(--text-4)">'+new Date(calAnoAtual,calMesAtual,-(prim-i-1)).getDate()+'</div></div>';
  for(var d=1;d<=ult;d++){
    var isH=d===hoje.getDate()&&calMesAtual===hoje.getMonth()&&calAnoAtual===hoje.getFullYear();
    var hasEv=diasEv.has(d);
    h+='<div class="cal-day'+(isH?' hoje':'')+(hasEv?' tem-evento':'')+'" onclick="filtrarDia('+d+')"><div class="cal-day-num">'+d+'</div></div>';
  }
  el.innerHTML=h; renderEventosLista();
}
function mudarMes(delta){ calMesAtual+=delta; if(calMesAtual>11){calMesAtual=0;calAnoAtual++;} if(calMesAtual<0){calMesAtual=11;calAnoAtual--;} renderCalendario(); }
function filtrarDia(dia){ filtroDia=filtroDia===dia?null:dia; renderEventosLista(); }

function renderEventosLista(){
  var el=document.getElementById('eventos-lista'); if(!el) return;
  var tE={degustacao:'🍫',feira:'🏪',evento:'🎪',reuniao:'🤝',live:'📱'};
  var tC={degustacao:'ev-degustacao',feira:'ev-feira',evento:'ev-evento',reuniao:'ev-reuniao',live:'ev-evento'};
  var list=[].concat(allEventos).sort(function(a,b){return a.data.localeCompare(b.data);});
  if(filtroDia!==null) list=list.filter(function(e){ var d=new Date(e.data+'T12:00:00'); return d.getMonth()===calMesAtual&&d.getFullYear()===calAnoAtual&&parseInt(e.data.split('-')[2])===filtroDia; });
  if(!list.length){ el.innerHTML='<div class="empty">Nenhum evento neste período</div>'; return; }
  el.innerHTML='<div style="font-size:9px;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">'+(filtroDia?'Eventos dia '+filtroDia:'Próximos eventos')+'</div>'+list.map(function(e){
    return '<div class="evento-card"><div class="evento-tipo-dot '+(tC[e.tipo]||'ev-evento')+'">'+(tE[e.tipo]||'📌')+'</div><div style="flex:1"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><div style="font-size:13px;font-weight:700">'+escapeHTML(e.titulo)+'</div><button onclick="abrirModalEvento('+e.id+')" style="background:none;border:1px solid var(--border);border-radius:var(--r-md);padding:3px 10px;color:var(--text-2);font-size:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Editar</button></div><div style="font-size:10px;color:var(--text-3);margin-top:3px">'+escapeHTML(fmtDate(e.data))+' '+escapeHTML(e.hora)+' · '+escapeHTML(e.local)+' · '+escapeHTML(e.responsavel)+'</div>'+(e.amostras||e.conversoes||e.receita?'<div style="display:flex;gap:16px;margin-top:8px;font-size:10px;color:var(--text-3)">'+(e.amostras?'<span>🧪 '+e.amostras+' amostras</span>':'')+(e.conversoes?'<span style="color:var(--green)">✅ '+e.conversoes+' conv.</span>':'')+(e.receita?'<span style="color:var(--green);font-weight:700">R$'+e.receita.toLocaleString('pt-BR')+'</span>':'')+'</div>':'')+(e.obs?'<div style="font-size:10px;color:var(--text-2);margin-top:3px;font-style:italic">'+escapeHTML(e.obs)+'</div>':'')+'</div></div>';
  }).join('');
}

function renderDegustacoes(){
  var el=document.getElementById('degustacoes-list'); if(!el) return;
  var list=allEventos.filter(function(e){return e.tipo==='degustacao';});
  if(!list.length){ el.innerHTML='<div class="empty">Nenhuma degustação cadastrada</div>'; return; }
  el.innerHTML=list.map(function(e){
    var roi=e.custo>0?((e.receita-e.custo)/e.custo*100).toFixed(0):null;
    var taxa=e.amostras>0?Math.round(e.conversoes/e.amostras*100):0;
    return '<div class="degust-card"><div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px"><div><div style="font-size:13px;font-weight:700;margin-bottom:3px">'+escapeHTML(e.titulo)+'</div><div style="font-size:10px;color:var(--text-3)">'+escapeHTML(fmtDate(e.data))+' · '+escapeHTML(e.local)+' · '+escapeHTML(e.responsavel)+'</div></div><button onclick="abrirModalEvento('+e.id+')" style="background:none;border:1px solid var(--border);border-radius:var(--r-md);padding:3px 10px;color:var(--text-2);font-size:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Editar</button></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-top:12px">'+miniKpi('🧪 Amostras',e.amostras||0,'var(--blue)')+miniKpi('✅ Conversões',e.conversoes||0,'var(--green)')+miniKpi('📈 Conv.%',taxa+'%','var(--indigo-hi)')+miniKpi('💰 Custo','R$'+(e.custo||0),'var(--red)')+miniKpi('💵 Receita','R$'+(e.receita||0),'var(--green)')+(roi!==null?miniKpi('🚀 ROI',roi+'%',parseInt(roi)>=0?'var(--green)':'var(--red)'):'')+'</div>'+(e.obs?'<div style="font-size:11px;color:var(--text-2);margin-top:12px;padding-top:12px;border-top:1px solid var(--border-sub);font-style:italic">'+escapeHTML(e.obs)+'</div>':'')+'</div>';
  }).join('');
}

function renderMarcaResultados(){
  var el=document.getElementById('marca-resultados'); if(!el) return;
  var degust=allEventos.filter(function(e){return e.tipo==='degustacao';});
  var tA=degust.reduce(function(s,e){return s+(e.amostras||0);},0);
  var tC=degust.reduce(function(s,e){return s+(e.conversoes||0);},0);
  var tCusto=degust.reduce(function(s,e){return s+(e.custo||0);},0);
  var tR=degust.reduce(function(s,e){return s+(e.receita||0);},0);
  var roi=tCusto>0?((tR-tCusto)/tCusto*100).toFixed(0):0;
  var taxa=tA>0?(tC/tA*100).toFixed(1):0;
  el.innerHTML='<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px;margin-bottom:12px"><div style="font-size:11px;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px">📊 Consolidado Trade Marketing</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">'+miniKpi('Total Amostras',tA,'var(--blue)')+miniKpi('Conversões',tC,'var(--green)')+miniKpi('Taxa Geral',taxa+'%','var(--indigo-hi)')+miniKpi('Custo Total','R$'+tCusto.toLocaleString('pt-BR'),'var(--red)')+miniKpi('Receita Total','R$'+tR.toLocaleString('pt-BR'),'var(--green)')+miniKpi('ROI Geral',roi+'%',parseInt(roi)>=0?'var(--green)':'var(--red)')+'</div></div>';
}

function setMarcaTab(tab){
  ['calendario','degustacoes','resultados'].forEach(function(t){
    var el=document.getElementById('marca-tab-'+t);
    var btn=document.getElementById('mtab-'+t);
    if(el) el.style.display=t===tab?'':'none';
    if(btn) btn.classList.toggle('active-tab',t===tab);
  });
  if(tab==='calendario') renderCalendario();
  if(tab==='degustacoes') renderDegustacoes();
  if(tab==='resultados') renderMarcaResultados();
}

function abrirModalEvento(id){
  var m=document.getElementById('modal-evento');
  var del=document.getElementById('btn-del-evento');
  if(id){
    var e=allEventos.find(function(x){return x.id===id;});
    if(!e) return;
    document.getElementById('ev-edit-id').value=id;
    document.getElementById('modal-evento-title').textContent='Editar Evento';
    document.getElementById('ev-titulo').value=e.titulo;
    document.getElementById('ev-tipo').value=e.tipo;
    document.getElementById('ev-data').value=e.data?fmtDate(e.data):'';
    document.getElementById('ev-hora').value=e.hora||'';
    document.getElementById('ev-local').value=e.local||'';
    document.getElementById('ev-responsavel').value=e.responsavel||'';
    document.getElementById('ev-custo').value=e.custo||0;
    document.getElementById('ev-amostras').value=e.amostras||0;
    document.getElementById('ev-conversoes').value=e.conversoes||0;
    document.getElementById('ev-receita').value=e.receita||0;
    document.getElementById('ev-obs').value=e.obs||'';
    del.style.display='';
  } else {
    document.getElementById('ev-edit-id').value='';
    document.getElementById('modal-evento-title').textContent='Novo Evento';
    ['ev-titulo','ev-data','ev-hora','ev-local','ev-responsavel','ev-custo','ev-amostras','ev-conversoes','ev-receita','ev-obs'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
    del.style.display='none';
  }
  m.classList.add('open');
}
function salvarEvento(){
  var id=document.getElementById('ev-edit-id').value;
  var obj={id:id?parseInt(id):Date.now(),titulo:document.getElementById('ev-titulo').value.trim(),tipo:document.getElementById('ev-tipo').value,data:parseDateToIso(document.getElementById('ev-data').value),hora:document.getElementById('ev-hora').value,local:document.getElementById('ev-local').value.trim(),responsavel:document.getElementById('ev-responsavel').value.trim(),custo:parseFloat(document.getElementById('ev-custo').value)||0,amostras:parseInt(document.getElementById('ev-amostras').value)||0,conversoes:parseInt(document.getElementById('ev-conversoes').value)||0,receita:parseFloat(document.getElementById('ev-receita').value)||0,obs:document.getElementById('ev-obs').value.trim()};
  if(!obj.titulo){ toast('⚠️ Informe o título'); return; }
  if(id){ var idx=allEventos.findIndex(function(x){return x.id===parseInt(id);}); if(idx>=0) allEventos[idx]=obj; } else allEventos.push(obj);
  saveEventos(); renderCalendario(); renderDegustacoes(); renderMarcaResultados(); renderMarcaKpis(); fecharModal('modal-evento'); toast('✅ Evento salvo!');
}
function deletarEvento(){
  var id=parseInt(document.getElementById('ev-edit-id').value);
  allEventos=allEventos.filter(function(x){return x.id!==id;});
  saveEventos(); renderCalendario(); renderMarcaKpis(); fecharModal('modal-evento'); toast('🗑️ Evento excluído');
}

function fecharModal(id){ var el=document.getElementById(id); if(el) el.classList.remove('open'); }
document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('.mod-overlay').forEach(function(el){
    el.addEventListener('click',function(e){ if(e.target===el) el.classList.remove('open'); });
  });
});

function renderChartEstoque(){
  var ctx=document.getElementById("chart-estoque"); if(!ctx || !ctx.getContext) return;
  if(window._chartEstoque) window._chartEstoque.destroy();
  var sorted=[].concat(allInsumos).sort(function(a,b){return getEstPct(b)-getEstPct(a);}).slice(0,10);
  window._chartEstoque=new Chart(ctx,{
    type:"bar",
    data:{
      labels:sorted.map(function(i){return i.nome.length>14?i.nome.slice(0,12)+"…":i.nome;}),
      datasets:[{
        label:"Nível de Estoque",
        data:sorted.map(function(i){return Math.min(100,getEstPct(i));}),
        backgroundColor:sorted.map(function(i){
          var st=getEstStatus(i);
          return st==="ok"?"rgba(34,197,94,.75)":st==="baixo"?"rgba(251,191,36,.75)":"rgba(248,113,113,.75)";
        }),
        borderRadius:4,borderSkipped:false,borderWidth:0
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},
        tooltip:{backgroundColor:"#0e1018",borderColor:"#1d2235",borderWidth:1,
          titleColor:"#edeef4",bodyColor:"#a0a8be",padding:10,
          callbacks:{label:function(c){return " "+c.raw.toFixed(0)+"% do mínimo";}}}},
      scales:{
        x:{grid:{display:false},ticks:{color:"#585f78",font:{size:9}}},
        y:{max:100,grid:{color:"rgba(255,255,255,.04)"},
          ticks:{color:"#585f78",font:{size:9},callback:function(v){return v+"%";}}}
      }
    }
  });
}

function renderChartsCom(){
  var cCtx=document.getElementById("chart-com-canal");
  if(cCtx && cCtx.getContext){
    if(window._chartComCanal) window._chartComCanal.destroy();
    var cData={};
    getComPedidosBase().forEach(function(p){ cData[p.canal]=(cData[p.canal]||0)+p.valor; });
    var sorted=Object.entries(cData).sort(function(a,b){return b[1]-a[1];});
    var cColors={shopee:"var(--shopee)",shopify:"var(--shopify)",yampi:"var(--yampi)",amazon:"var(--amazon)",mercado_livre:"var(--ml)",b2b:"var(--amber)",outros:"#94a3b8",whatsapp:"#25d366",instagram:"#e040fb"};
    window._chartComCanal=new Chart(cCtx,{
      type:"doughnut",
      data:{labels:sorted.map(function(e){return normalizeCanal(e[0]).nome;}),
        datasets:[{data:sorted.map(function(e){return e[1];}),
          backgroundColor:sorted.map(function(e){return cColors[e[0]]||"#94a3b8";}),
          borderWidth:3,borderColor:"#0e1018",hoverOffset:4}]},
      options:{responsive:true,maintainAspectRatio:false,cutout:"60%",
        plugins:{legend:{position:"right",labels:{color:"#585f78",font:{size:9},boxWidth:7,boxHeight:7,usePointStyle:true,padding:6}},
          tooltip:{backgroundColor:"#0e1018",borderColor:"#1d2235",borderWidth:1,padding:8,
            callbacks:{label:function(c){return " "+fmtBRL(c.raw);}}}}}
    });
  }
  var sCtx=document.getElementById("chart-com-status");
  if(sCtx && sCtx.getContext){
    if(window._chartComStatus) window._chartComStatus.destroy();
    var sData={};
    getComPedidosBase().forEach(function(p){ sData[p.status]=(sData[p.status]||0)+1; });
    var sColors={novo:"#60a5fa",separando:"#fbbf24",enviado:"#818cf8",entregue:"#22c55e",cancelado:"#f87171"};
    var sLabels={novo:"Novo",separando:"Separando",enviado:"Enviado",entregue:"Entregue",cancelado:"Cancelado"};
    var sorted2=Object.entries(sData).sort(function(a,b){return b[1]-a[1];});
    window._chartComStatus=new Chart(sCtx,{
      type:"bar",
      data:{labels:sorted2.map(function(e){return sLabels[e[0]]||e[0];}),
        datasets:[{data:sorted2.map(function(e){return e[1];}),
          backgroundColor:sorted2.map(function(e){return sColors[e[0]]||"#94a3b8";}),
          borderRadius:4,borderSkipped:false,borderWidth:0}]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{backgroundColor:"#0e1018",borderColor:"#1d2235",borderWidth:1,padding:8,
          callbacks:{label:function(c){return c.raw+" pedidos";}}}},
        scales:{x:{grid:{display:false},ticks:{color:"#585f78",font:{size:9}}},
          y:{grid:{color:"rgba(255,255,255,.04)"},ticks:{color:"#585f78",font:{size:9}}}}}
    });
  }
}

Object.assign(window,{
  closeMobileSidebar,
  openMobileSidebar,
  showPage,
  toggleTheme,
  goLogout,
  handleLoginSubmit,
  enterApp,
  hydrateConfigPage,
  addAccessUser,
  removeAccessUser,
  renderAccessUsers,
  openClienteDrawer,
  openClientePage,
  renderClientePage,
  backToClientes,
  clienteWhatsApp,
  clienteAddTask,
  clienteAddNote,
  clienteAddNegotiation,
  openInteractionModal,
  saveInteraction,
  openCRMOrderDrawer,
  openPedidoDrawer,
  filterClientesByCity,
  handleTopbarSearch,
  toggleNotif,
  closeWa,
  openWa,
  openWaModal,
  selectTpl,
  sendWa,
  saveCliStatus,
  saveNote,
  editMeta,
  renderCompare,
  renderTarefas,
  openTaskModal,
  saveTask,
  deleteTask,
  runAI,
  renderIADashboard,
  computeCustomerIntelligence,
  renderInteligencia,
  renderDash,
  setDashRange,
  renderClientes,
  selectSegment,
  setChCli,
  renderOportunidades,
  addOpportunity,
  moveOppStage,
  renderProdutos,
  openProdutoDrawer,
  renderCidades,
  renderPedidosPage,
  recarregar,
  oppLoadMore,
  radarToggleOppFilter,
  oppSendCoupon,
  generateRadarTodayActions,
  oppSuggestTodayActions,
  openOppClienteResumo,
  saveAlertDays,
  renderAlertas,
  saveSupabaseConfig,
  auditSupabaseSchema,
  syncInsumosToSupabase,
  syncReceitasToSupabase,
  syncOrdensProducaoToSupabase,
  logMovimentoEstoque,
  syncBling,
  syncBlingProdutos,
  refreshBlingAutoCard,
  backfillBlingEnderecos,
  syncYampi,
  syncCarrinhosAbandonadosYampi,
  fetchYampiAbandoned,
  renderCarrinhosAbandonados,
  openWhatsAppCarrinho,
  openCarrinhoLinkFromRadar,
  openCarrinhoInComercialFromRadar,
  openRadarVisitouDrawer,
  saveAIKey,
  saveTemplates,
  closeDrawer,
  abrirModalCampanha,
  setComTab,
  renderComPedidos,
  abrirModalEvento,
  setMarcaTab,
  mudarMes,
  filtrarDia,
  fecharModal,
  deletarCampanha,
  salvarCampanha,
  deletarEvento,
  salvarEvento,
  installApp,
  gerarMensagemIA,
  copyWhatsAppMessageForCustomer,
  openWhatsAppForCustomer,
  runPostFixValidation,
  runClienteDebug,
  detectCh,
  initSupabase,
  loadSupabaseData,
  recalculateSegments,
  openSegmentDetail,
  renderSegmentCustomers,
  exportSegmentData
});

export {
  detectCh,
  saveSupabaseConfig,
  syncBling,
  syncYampi,
  saveAIKey,
  addAccessUser,
  removeAccessUser,
  goLogout,
  renderPedidosPage,
  openClienteDrawer,
  openPedidoDrawer,
  auditSupabaseSchema,
  saveAlertDays,
  initSupabase,
  loadSupabaseData
};
