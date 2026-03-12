import { allInsumos, allOrdens, getEstPct, getEstStatus } from "./producao.js";
import {
  computeCustomerIntelligence as computeCustomerIntelligenceImpl,
  definirNextBestAction as definirNextBestActionImpl,
  getTodaySalesActions as getTodaySalesActionsImpl,
  renderIADashboard as renderIADashboardImpl,
  gerarMensagemIA as gerarMensagemIAImpl,
  runAI as runAIImpl,
  copyWhatsAppMessageForCustomer as copyWhatsAppMessageForCustomerImpl,
  openWhatsAppForCustomer as openWhatsAppForCustomerImpl
} from "./ia.js";
import { escapeHTML, safeJsonParse, escapeJsSingleQuote } from "./utils.js";
import { CRMStore } from "./store.js";
import { STORAGE_KEYS } from "./constants.js";

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
let canaisLookup = {};

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

let TOKEN   = localStorage.getItem("crm_token")||"";
let REFRESH = localStorage.getItem("crm_refresh")||"";
let CID     = localStorage.getItem("crm_cid")||"";
let CSEC    = localStorage.getItem("crm_csec")||"";
let SHOP    = localStorage.getItem("crm_shop")||"";
let SHOPKEY = localStorage.getItem("crm_shopkey")||"";
let AI_KEY  = localStorage.getItem("crm_ai_key")||"";

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
  {id:1,titulo:"Ligar para clientes VIP inativos",desc:"Clientes VIP que não compram há +60 dias",prioridade:"alta",status:"pendente",cliente:"",data:new Date().toISOString().slice(0,10)},
  {id:2,titulo:"Enviar campanha de reativação",desc:"Segmento de inativos - template WhatsApp",prioridade:"media",status:"pendente",cliente:"",data:new Date().toISOString().slice(0,10)},
  {id:3,titulo:"Verificar pedidos pendentes no Bling",desc:"Conferir status de entregas desta semana",prioridade:"alta",status:"em_andamento",cliente:"",data:new Date().toISOString().slice(0,10)},
];
let taskIdSeq = allTasks.length ? Math.max(...allTasks.map(t=>t.id))+1 : 1;
let CRM_BOOTSTRAPPED = false;
let CRM_BOOTSTRAP_ERROR = null;

const CRM_STATE = {
  orders: allOrders,
  customers: allCustomers,
  intelligence: customerIntelligence,
  tasks: allTasks,
  integrations: { bling: blingOrders, yampi: yampiOrders, shopify: shopifyOrders },
  cache: { tarefas: tarefasCache, notifs: notifs },
  ui: { activeChannel: activeCh, charts: charts, activeSegment: activeSegment }
};

CRMStore.data.orders = allOrders;
CRMStore.data.customers = allCustomers;
CRMStore.data.tasks = allTasks;
CRMStore.intelligence.customerScores = customerIntelligence;
CRMStore.ui.currentPage = "dashboard";
window.CRMStore = CRMStore;

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", ()=>{
  const loggedIn = localStorage.getItem(STORAGE_KEYS.loginFlag) === "true";
  if(!loggedIn) return;
  const shell = document.getElementById("app-shell");
  if(shell && shell.classList.contains("visible")) return;
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
    if(blingFromEl) blingFromEl.value = iso(from);
    if(blingToEl) blingToEl.value = iso(now);
    const shopFromEl = document.getElementById("shop-date-from");
    const shopToEl = document.getElementById("shop-date-to");
    if(shopFromEl) shopFromEl.value = shopFromSaved || iso(from);
    if(shopToEl) shopToEl.value = shopToSaved || iso(now);
    const y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,"0");
    const pm=now.getMonth()===0?12:now.getMonth(), py=now.getMonth()===0?y-1:y;
    const ca=document.getElementById("cmp-a"), cb=document.getElementById("cmp-b");
    if(ca) ca.value=`${y}-${m}`; if(cb) cb.value=`${py}-${String(pm).padStart(2,"0")}`;
    const ad=localStorage.getItem("crm_alertdays"); if(ad){ const el=document.getElementById("alert-days"); if(el) el.value=ad; }
    if(TOKEN){ const el=document.getElementById("inp-token"); if(el) el.value=TOKEN; }
    if(REFRESH){ const el=document.getElementById("inp-refresh"); if(el) el.value=REFRESH; }
    if(CID){ const el=document.getElementById("inp-cid"); if(el) el.value=CID; }
    if(CSEC){ const el=document.getElementById("inp-csec"); if(el) el.value=CSEC; }
    if(SHOP){ const el=document.getElementById("inp-shop"); if(el) el.value=SHOP; }
    if(SHOPKEY){ const el=document.getElementById("inp-shopkey"); if(el) el.value=SHOPKEY; }
    if(AI_KEY){ const el=document.getElementById("inp-ai-key"); if(el) el.value=AI_KEY; }
    loadTemplatesUI();
  })();
}catch(e){
  console.warn("Init:", e?.message || String(e));
}

function mergeOrders(){
  const seen=new Set();
  allOrders.length=0;
  [...blingOrders,...yampiOrders].forEach(o=>{
    const k=(o._source||"b")+":"+(o.id||o.numero);
    if(!seen.has(k)){ seen.add(k); allOrders.push(o); }
  });
  const nextCustomers = Object.values(buildCli(allOrders)).map(c=>{
    const sc=calcCliScores(c);
    return {...c, total_gasto:sc.ltv, status:sc.status, canal_principal:c.channels&&c.channels.size?[...c.channels][0]:""};
  });
  allCustomers.length=0;
  allCustomers.push(...nextCustomers);
  computeCustomerIntelligence();
  reconcileCarrinhosRecuperados().catch(()=>{});
  recomputeCarrinhosScoresAndPersist().catch(()=>{});
}

function iso(d){ return d.toISOString().slice(0,10); }
function blng(d){ if(!d)return""; const[y,m,dd]=d.split("-"); return`${dd}/${m}/${y}`; }

// Endpoints e headers para Edge Functions do Supabase
function getSupabaseProjectUrl(){
  const raw =
    localStorage.getItem("crm_supa_url") ||
    localStorage.getItem("supa_url") ||
    localStorage.getItem("supabase_url") ||
    "";
  return String(raw || "").trim().replace(/\/+$/,"");
}

function getSupabaseAnonKey(){
  const raw =
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

function supaFnHeaders(){
  const anonKey = getSupabaseAnonKey();
  if(!anonKey) throw new Error("Supabase não configurado: informe a chave pública (anon) em Configurações.");
  return {
    "Content-Type":"application/json",
    "apikey": anonKey,
    "Authorization": "Bearer "+anonKey
  };
}

async function bootstrapFromSupabase(){
  try{
    const resp = await fetch(getSupaFnBase() + "/bootstrap-crm", {
      method: "POST",
      headers: supaFnHeaders(),
      body: JSON.stringify({})
    });
    if(!resp.ok){
      const txt = await resp.text();
      throw new Error(txt || "Erro no bootstrap-crm");
    }
    const data = await resp.json();

    // Pedidos (Bling + Yampi)
    const pedidosRaw = Array.isArray(data.pedidos) ? data.pedidos : [];
    const pedidosYampiRaw =
      Array.isArray(data.yampiOrders) ? data.yampiOrders :
      Array.isArray(data.yampi_pedidos) ? data.yampi_pedidos :
      Array.isArray(data.pedidos_yampi) ? data.pedidos_yampi :
      [];

    if(pedidosRaw.length || pedidosYampiRaw.length){
      const nextBling = [];
      const nextYampi = [];

      const pushNormalized = (o, fallbackSource)=>{
        const src = String(o?._source || o?.source || fallbackSource || "").toLowerCase();
        o._source = src || fallbackSource || "bling";
        if(!o.numero && (o.numero_pedido || o.order_number || o.name)) o.numero = o.numero_pedido || o.order_number || o.name;
        if(!o.data){
          const d = o.data_pedido || o.dataPedido || o.created_at || o.updated_at || "";
          if(d) o.data = String(d).slice(0,10);
        }
        o._canal = detectCh(o);
        if(o._source === "yampi" || src.includes("yampi") || o._canal === "yampi") nextYampi.push(o);
        else nextBling.push(o);
      };

      pedidosRaw.forEach(o => pushNormalized(o, "bling"));
      pedidosYampiRaw.forEach(o => pushNormalized(o, "yampi"));

      blingOrders.length = 0;
      blingOrders.push(...nextBling);
      localStorage.setItem("crm_bling_orders", JSON.stringify(blingOrders));

      yampiOrders.length = 0;
      yampiOrders.push(...nextYampi);
      localStorage.setItem("crm_yampi_orders", JSON.stringify(yampiOrders));
    }

    // Tarefas
    if(Array.isArray(data.tarefas)){
      const nextTasks = data.tarefas.map(t => ({
        ...t,
        desc: t.descricao || "",
        data: t.vencimento || "",
        status: t.status === "aberta" ? "pendente" : t.status
      }));
      tarefasCache.length = 0;
      tarefasCache.push(...nextTasks);
    }

    // Configurações
    if(Array.isArray(data.configuracoes)){
      const byKey = {};
      data.configuracoes.forEach(c => { byKey[c.chave] = c.valor_texto; });
      if(byKey.meta_mensal){
        localStorage.setItem("crm_meta", byKey.meta_mensal);
      }
      if(byKey.alert_days){
        localStorage.setItem("crm_alertdays", byKey.alert_days);
        const el=document.getElementById("alert-days");
        if(el) el.value = byKey.alert_days;
      }
      if(byKey.crm_access_users){
        localStorage.setItem("crm_access_users", byKey.crm_access_users);
      }
    }

    // Templates WhatsApp
    if(Array.isArray(data.wa_templates) && data.wa_templates.length){
      WA_TPLS = data.wa_templates.map(t => t.corpo || t.template || "");
      localStorage.setItem("crm_wa_tpls", JSON.stringify(WA_TPLS));
    }

    // Inteligência por cliente
    if(Array.isArray(data.customer_intelligence)){
      customerIntel = data.customer_intelligence;
    }

    mergeOrders();
    populateUFs();
    renderAll();

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
function handleLoginSubmit(e){
  if(e){ e.preventDefault(); e.stopPropagation(); }
  const emailEl=document.getElementById("login-email");
  const passEl=document.getElementById("login-pass");
  const errEl=document.getElementById("login-error");
  const email=emailEl ? String(emailEl.value||"").trim().toLowerCase() : "";
  const pass=passEl ? String(passEl.value||"").trim() : "";
  if(errEl){ errEl.textContent=""; errEl.style.color=""; }
  (async()=>{
    try{
      if(!email || !pass){
        if(errEl) errEl.textContent="Informe e-mail e senha.";
        return;
      }

      const ADMIN_EMAILS = new Set(["admin@chivafit.com","admin@chivafit.com.br","admin"]);
      const isAdmin = ADMIN_EMAILS.has(email);
      const canonicalEmail =
        email === "admin" || email === "admin@chivafit.com.br"
          ? "admin@chivafit.com"
          : email;
      const ok = await verifyAccessUser(canonicalEmail, pass);
      if(ok){
        localStorage.setItem(STORAGE_KEYS.loginFlag, "true");
        localStorage.setItem(STORAGE_KEYS.sessionEmail, canonicalEmail);
        enterApp(canonicalEmail);
        return;
      }
      if(isAdmin){
        if(errEl) errEl.textContent="Senha do administrador inválida.";
        return;
      }
      if(errEl) errEl.textContent="Credenciais inválidas. Use o admin ou um usuário cadastrado em Gerenciamento de Acessos.";
    }catch(_e){
      if(!window.isSecureContext){
        if(errEl) errEl.textContent="Este login precisa de HTTPS (ou servidor local). Evite abrir o arquivo via file://";
        return;
      }
      if(errEl) errEl.textContent="Erro ao validar credenciais.";
    }
  })();
  return false;
}
function enterApp(userEmail){
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
      if(connected) await bootstrapFromSupabase();
      safeInvokeName("updateBadge");
      if(blingOrders.length) safeInvokeName("startTimers");
    }catch(e){
      console.warn("Erro no bootstrap, usando cache local:", e.message);
      // Fallback: usar dados locais se existirem
      if(!blingOrders.length){
        const cached = safeJsonParse("crm_bling_orders", []);
        blingOrders.length = 0;
        blingOrders.push(...cached);
      }
      safeInvokeName("mergeOrders");
      safeInvokeName("populateUFs");
      safeInvokeName("renderAll");
      safeInvokeName("updateBadge");
    }finally{
      clearTimeout(overlayKill);
      if(overlay){ overlay.style.display="none"; overlay.style.pointerEvents="none"; }
    }
  })();
}

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
        <div class="drawer-order-date">${o.data_pedido ? new Date(o.data_pedido).toLocaleDateString("pt-BR") : "—"} · ${escapeHTML(o.canal||o.canal_id||"—")}</div>
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
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span style="color:var(--text-3)">Canal</span><span>${escapeHTML(o.canal||o.canal_id||"—")}</span></div>`,
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
  const from = String((document.getElementById("ped-date-from")||{value:""}).value||"").trim();
  const to = String((document.getElementById("ped-date-to")||{value:""}).value||"").trim();
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

function goLogout(){
  if(!confirm("Sair?"))return;
  if(syncTimer) clearInterval(syncTimer);
  try{ localStorage.removeItem(STORAGE_KEYS.loginFlag); }catch(_e){}
  try{ localStorage.removeItem(STORAGE_KEYS.sessionEmail); }catch(_e){}
  document.getElementById("login-screen").style.display="flex";
  const shell = document.getElementById("app-shell");
  shell.style.display="none"; shell.classList.remove("visible");
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  const errEl = document.getElementById("login-error");
  if(errEl) errEl.textContent = "";
  const passEl = document.getElementById("login-pass");
  if(passEl) passEl.value = "";
}

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
  if(urlEl) urlEl.value = u;
  if(keyEl) keyEl.value = k;

  const ai = localStorage.getItem("crm_ai_key") || "";
  const aiEl = document.getElementById("inp-ai-key");
  if(aiEl) aiEl.value = ai;

  const from = localStorage.getItem("crm_shopify_from") || "";
  const to = localStorage.getItem("crm_shopify_to") || "";
  const fromEl = document.getElementById("shop-date-from");
  const toEl = document.getElementById("shop-date-to");
  if(fromEl && from) fromEl.value = from;
  if(toEl && to) toEl.value = to;

  loadTemplatesUI();
  renderAccessUsers();
}

ensureBootstrapAdminUser().catch(()=>{});

// ═══════════════════════════════════════════════════
//  CREDENTIALS
// ═══════════════════════════════════════════════════
function saveCreds(){
  localStorage.setItem("crm_token",TOKEN); localStorage.setItem("crm_refresh",REFRESH);
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
  const url = document.getElementById("inp-supa-url")?.value?.trim();
  const key = document.getElementById("inp-supa-key")?.value?.trim();
  const st = document.getElementById("supa-status");
  if(!url||!key){ if(st) st.textContent="⚠ Preencha URL e chave."; if(st) st.className="setup-status s-err"; return; }
  localStorage.setItem("crm_supa_url", url);
  localStorage.setItem("crm_supa_key", key);
  localStorage.setItem("supa_url", url);
  localStorage.setItem("supa_key", key);
  localStorage.setItem("supabase_url", url);
  localStorage.setItem("supabase_key", key);
  if(st){ st.textContent="✓ Salvo! Conectando..."; st.className="setup-status s-ok"; }
  setTimeout(async()=>{
    const connected = await initSupabase();
    if(connected && document.getElementById("app-shell")?.classList.contains("visible")){
      try{ await bootstrapFromSupabase(); }catch(_e){}
    }
  }, 300);
}
// Load supa config into form on page open
document.addEventListener("DOMContentLoaded", ()=>{
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
});

function saveAIKey(){
  AI_KEY=document.getElementById("inp-ai-key").value.trim();
  localStorage.setItem("crm_ai_key",AI_KEY);
  const st=document.getElementById("ai-key-status");
  st.textContent=AI_KEY?"✓ Chave salva! IA ativada.":"Chave removida.";
  st.className="setup-status s-ok";
}
async function renewToken(){
  if(!REFRESH) throw new Error("Refresh Token necessário.");
  try {
    const resp = await fetch(getSupaFnBase() + "/bling-renew-token", {
      method: "POST",
      headers: supaFnHeaders(),
      body: JSON.stringify({ refreshToken: REFRESH })
    });

    if (!resp.ok) {
      const errorData = await resp.json();
      throw new Error(errorData.error || "Falha ao renovar token via Edge Function");
    }

    const d = await resp.json();
    TOKEN = d.access_token;
    REFRESH = d.refresh_token || REFRESH;
    saveCreds();
    toast("🔄 Token renovado com sucesso!");
  } catch (e) {
    console.error("renewToken error:", e);
    toast(`⚠ ${e.message}`);
    throw e;
  }
}

// ═══════════════════════════════════════════════════
//  BLING
// ═══════════════════════════════════════════════════
async function syncBling(){
  const st=document.getElementById("bling-status");
  const from=document.getElementById("date-from").value;
  const to=document.getElementById("date-to").value;
  if(!from||!to){
    st.textContent="⚠ Preencha o período de importação";
    st.className="setup-status s-err";
    return;
  }
  st.textContent="Importando...";
  st.className="setup-status";
  try{
    const resp=await fetch(getSupaFnBase()+"/bling-sync",{
      method:"POST",
      headers:supaFnHeaders(),
      body:JSON.stringify({from,to})
    });
    if(!resp.ok){
      const txt=await resp.text();
      throw new Error(txt||"Erro na função Bling");
    }
    const data=await resp.json();
    const nextBling = (data.orders||[]).map(o=>normalizeOrderForCRM(o,"bling"));
    blingOrders.length = 0;
    blingOrders.push(...nextBling);
    localStorage.setItem("crm_bling_orders",JSON.stringify(blingOrders));
    mergeOrders(); populateUFs();
    upsertOrdersToSupabase(blingOrders).catch(e=>console.warn(e)); renderAll(); startTimers();
    try{ if(supaConnected) await sbSetConfig('ultima_sync_bling',new Date().toISOString()); }catch(e){}
    st.textContent=`✓ ${blingOrders.length} pedidos importados`; st.className="setup-status s-ok";
    toast("✓ Bling sincronizado!");
  }catch(e){
    st.textContent="⚠ "+e.message;
    st.className="setup-status s-err";
  }
}

// ═══════════════════════════════════════════════════
//  YAMPI
// ═══════════════════════════════════════════════════
async function syncYampi(){
  const st = document.getElementById("yampi-status");
  if(st){ st.textContent="Sincronizando com Supabase..."; st.className="setup-status"; }
  try{
    if(!supaConnected || !supaClient){
      throw new Error("Supabase não conectado. Conecte primeiro para ver os dados do Webhook.");
    }
    
    // Como a Yampi trabalha apenas via Webhook, o "Recarregar" busca os dados
    // que o Webhook da Yampi já salvou no nosso banco de dados Supabase.
    await loadOrdersFromSupabaseForCRM();
    await loadCarrinhosAbandonadosFromSupabase();
    
    if(st){ 
      st.textContent=`✓ Dados da Yampi atualizados do banco`; 
      st.className="setup-status s-ok"; 
    }
    toast("✓ Yampi sincronizado!");
  }catch(e){
    if(st){ st.textContent="⚠ "+(e?.message||String(e)); st.className="setup-status s-err"; }
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
  next.contato = next.contato || {
    nome: nome || "Cliente",
    cpfCnpj: cliente.cpf || cliente.cnpj || cliente.document || "",
    email: cliente.email || next.email || "",
    telefone: cliente.telefone || cliente.phone || next.phone || "",
    endereco: {
      municipio: endereco.cidade || endereco.city || endereco.municipio || "",
      uf: (endereco.uf || endereco.state || endereco.province || endereco.estado || "").toString().toUpperCase().slice(0,2),
      logradouro: endereco.logradouro || endereco.address1 || endereco.endereco || ""
    }
  };

  const itens = next.itens || next.items || next.produtos || next.products || next.line_items || [];
  if(Array.isArray(itens)){
    next.itens = itens.map(it=>({
      descricao: it.descricao || it.title || it.nome || it.name || it.produto || "",
      codigo: it.codigo || it.sku || it.id || "",
      quantidade: Number(it.quantidade ?? it.quantity ?? it.qty ?? 1) || 1,
      valor: Number(it.valor ?? it.price ?? it.preco ?? 0) || 0
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

function clamp01(n){ n=Number(n); if(!isFinite(n)) return 0; return Math.max(0, Math.min(1, n)); }

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
    localStorage.setItem("crm_carrinhos_abandonados", JSON.stringify(carrinhosAbandonados));
    if(document.getElementById("page-comercial")?.classList.contains("active")) {
      if(typeof window.renderCarrinhosAbandonados === "function") window.renderCarrinhosAbandonados();
    }
    await reconcileCarrinhosRecuperados();
    await recomputeCarrinhosScoresAndPersist();
  }catch(_e){}
}

async function upsertCarrinhosAbandonadosToSupabase(list){
  if(!supaConnected || !supaClient) return;
  const rowsWithUpdatedAt = (Array.isArray(list) ? list : []).filter(x=>x && x.checkout_id).map(c=>({
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
    last_mensagem_at: c.last_mensagem_at || null,
    updated_at: new Date().toISOString()
  }));
  const rowsFallback = rowsWithUpdatedAt.map(({updated_at, ...rest})=>rest);
  const rowsFallbackCore = rowsFallback.map(({score_recuperacao, link_finalizacao, last_etapa_enviada, last_mensagem_at, ...rest})=>rest);
  if(!rowsWithUpdatedAt.length) return;
  try{
    for(let i=0;i<rowsWithUpdatedAt.length;i+=200){
      const chunk = rowsWithUpdatedAt.slice(i,i+200);
      const {error} = await supaClient.from("carrinhos_abandonados").upsert(chunk, { onConflict: "checkout_id" });
      if(error){
        const {error: e2} = await supaClient.from("carrinhos_abandonados").upsert(rowsFallback.slice(i,i+200), { onConflict: "checkout_id" });
        if(e2){
          await supaClient.from("carrinhos_abandonados").upsert(rowsFallbackCore.slice(i,i+200), { onConflict: "checkout_id" });
        }
      }
    }
  }catch(_e){}
}

async function syncCarrinhosAbandonadosYampi(){
  const st = document.getElementById("abandoned-status");
  if(st){ st.textContent="Sincronizando..."; st.className="setup-status"; }
  try{
    const raw = await fetchYampiAbandoned();
    const next = (Array.isArray(raw) ? raw : []).map(normalizeCarrinhoAbandonado).filter(c=>c.checkout_id);
    const byId = {};
    (carrinhosAbandonados||[]).forEach(c=>{ if(c && c.checkout_id) byId[String(c.checkout_id)] = c; });
    next.forEach(c=>{
      const prev = byId[c.checkout_id] || null;
      byId[c.checkout_id] = prev ? {...prev, ...c, recuperado: prev.recuperado || c.recuperado, recuperado_em: prev.recuperado_em || c.recuperado_em, recuperado_pedido_id: prev.recuperado_pedido_id || c.recuperado_pedido_id} : c;
    });
    carrinhosAbandonados = Object.values(byId).sort((a,b)=>new Date(b.criado_em||0)-new Date(a.criado_em||0));
    localStorage.setItem("crm_carrinhos_abandonados", JSON.stringify(carrinhosAbandonados));
    await reconcileCarrinhosRecuperados();
    await recomputeCarrinhosScoresAndPersist();
    if(supaConnected && supaClient) await upsertCarrinhosAbandonadosToSupabase(carrinhosAbandonados);
    if(typeof window.renderCarrinhosAbandonados === "function") window.renderCarrinhosAbandonados();
    if(st){ st.textContent=`✓ ${carrinhosAbandonados.length} carrinhos carregados`; st.className="setup-status s-ok"; }
    toast("✓ Carrinhos abandonados sincronizados!");
  }catch(e){
    if(st){ st.textContent="⚠ "+(e?.message||String(e)); st.className="setup-status s-err"; }
  }
}

function buildCarrinhoWaMessage(c, ctx){
  const nome = String(c?.cliente_nome || "tudo bem?");
  const itens = Array.isArray(c?.produtos) ? c.produtos : [];
  const produtosTxt = itens.slice(0,4).map(it=>String(it.nome || it.title || it.descricao || it.name || "").trim()).filter(Boolean).join(", ");
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
    await supaClient.from("v2_clientes").upsert({
      doc: docKey,
      nome: c?.cliente_nome || null,
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
      localStorage.setItem("crm_carrinhos_abandonados", JSON.stringify(carrinhosAbandonados));
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
    headers:supaFnHeaders(),
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
    localStorage.setItem("crm_shopify_orders",JSON.stringify(shopifyOrders));
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
  syncTimer=setInterval(async()=>{ try{ await recarregar(true); }catch(e){} },6*60*60*1000);
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
      headers:supaFnHeaders(),
      body:JSON.stringify({from,to})
    });
    if(resp.ok){
      const data=await resp.json();
      const fresh=(data.orders||[]).map(o=>{ o._source="bling"; o._canal=detectCh(o); return o; });
      const known=new Set(blingOrders.map(o=>String(o.id||o.numero)));
      fresh.filter(o=>!known.has(String(o.id||o.numero))).forEach(o=>pushNotif(`🛒 Novo pedido #${o.numero||o.id} — ${fmtBRL(val(o))}`));
      blingOrders.length = 0;
      blingOrders.push(...fresh);
      localStorage.setItem("crm_bling_orders",JSON.stringify(blingOrders));
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
  const navId = id === "cliente" ? "clientes" : id;
  const navEl = document.getElementById("nav-"+navId);
  if(navEl) navEl.classList.add("active");

  // Update topbar title
  const titles = {dashboard:"Dashboard",clientes:"Clientes",inteligencia:"Inteligência",pedidos:"Pedidos",
    "pedidos-page":"Pedidos",cidades:"Cidades",produtos:"Produtos",tarefas:"Tarefas",
    oportunidades:"Oportunidades",alertas:"Alertas",ia:"IA & Insights",segmentos:"Segmentos",
    comercial:"Comercial",producao:"Produção",marca:"Marca",config:"Configurações",cliente:"Cliente"};
  const titleEl = document.getElementById("topbar-title");
  if(titleEl) titleEl.textContent = titles[id] || id;

  const pageEl = document.getElementById("page-"+id);
  if(pageEl) pageEl.classList.add("active");

  if(id==='oportunidades') setTimeout(()=>safeInvokeName("renderOportunidades"),50);
  if(id==='tarefas') setTimeout(()=>safeInvokeName("renderTarefas"),50);
  if(id==="segmentos") safeInvokeName("renderSegmentos");
  if(id==="producao"){ safeInvokeName("renderProdKpis"); safeInvokeName("renderInsumos"); }
  if(id==="comercial"){ safeInvokeName("renderComKpis"); safeInvokeName("renderComPedidos"); setTimeout(()=>safeInvokeName("renderChartsCom"),100); }
  if(id==="marca"){ safeInvokeName("renderMarcaKpis"); safeInvokeName("renderCalendario"); }
  if(id==="pedidos-page") setTimeout(()=>safeInvokeName("renderPedidosPage"),50);
  if(id==="clientes") setTimeout(()=>safeInvokeName("renderClientes"),50);
  if(id==="cliente") setTimeout(()=>safeInvokeName("renderClientePage"),0);
  if(id==="inteligencia") setTimeout(()=>safeInvokeName("renderInteligencia"),0);
  if(id==="cidades") setTimeout(()=>safeInvokeName("renderCidades"),50);
  if(id==="ia") setTimeout(()=>safeInvokeName("renderIADashboard"),50);
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
            ${t.data?`<span class="task-badge">📅 ${escapeHTML(t.data)}</span>`:""}
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
      supaClient.from('v2_tarefas').update({status:sbStatus}).eq('id',t._supaId).then(()=>{});
    }
  }
}

function deleteTask(id){
  const t=allTasks.find(t=>t.id===id);
  // Remover do Supabase se tiver UUID
  if(supaConnected && supaClient && t?._supaId){
    supaClient.from('v2_tarefas').delete().eq('id',t._supaId).then(()=>{});
  }
  allTasks=allTasks.filter(t=>t.id!==id);
  saveTasks(); renderTarefas();
  toast("🗑️ Tarefa removida");
}

function openTaskModal(id, cliente, customerId){
  const t = id ? allTasks.find(t=>t.id===id) : null;
  const html=`
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:500;display:flex;align-items:center;justify-content:center;padding:16px" id="task-modal-overlay">
      <div style="background:var(--surface);border-radius:16px;padding:20px;width:100%;max-width:400px;border:1px solid var(--border)">
        <div style="font-size:14px;font-weight:800;margin-bottom:14px">${t?"✏️ Editar":"➕ Nova"} Tarefa</div>
        <input type="hidden" id="tm-customer-id" value="${escapeHTML(String(customerId||""))}"/>
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
        <input id="tm-data" type="date" value="${t?.data||new Date().toISOString().slice(0,10)}"
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
    prioridade: document.getElementById("tm-prio")?.value||"media",
    status: document.getElementById("tm-status")?.value||"pendente",
    data: document.getElementById("tm-data")?.value||"",
  };
  if(id) { const i=allTasks.findIndex(t=>t.id===id); if(i>=0) allTasks[i]=task; }
  else allTasks.push(task);
  saveTasks();
  // Sincronizar com v2_tarefas (fire-and-forget)
  if(supaConnected && supaClient){
    const sbTask = {
      titulo: task.titulo,
      descricao: task.desc||null,
      prioridade: task.prioridade,
      status: task.status === 'pendente' ? 'aberta' : task.status,
      vencimento: task.data||null,
    };
    if(task._supaId){
      // tarefa existente com UUID conhecido — atualizar
      supaClient.from('v2_tarefas').update(sbTask).eq('id', task._supaId).then(()=>{});
    } else {
      // nova tarefa — inserir
      supaClient.from('v2_tarefas').insert({...sbTask, created_at: new Date().toISOString()})
        .select('id').single().then(({data})=>{
          if(data?.id){
            // guardar UUID para sincronizações futuras
            const t2=allTasks.find(t=>t.id===task.id);
            if(t2){ t2._supaId=data.id; saveTasks(); }
          }
        });
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
}

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════
function detectCh(o){
  const doc=(o.contato?.cpfCnpj||o.contato?.numeroDocumento||"").replace(/\D/g,"");
  if(doc.length===14) return "cnpj";

  if(o._source==="shopify") return "shopify";

  const norm=(v)=>String(v||"")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"");

  const fields=[
    o.observacoes,
    o.loja?.nome, o.loja?.descricao,
    o.origem?.nome, o.origem?.descricao,
    o.canal?.nome, o.canal?.descricao,
    o.ecommerce?.nome, o.ecommerce?.descricao,
    o.numeroPedidoEcommerce
  ].map(norm).join(" ");

  if(fields.includes("shopify")) return "shopify";

  const numExt=norm(o.numeroPedidoEcommerce);
  if(/\bmercado\s*livre\b|\bmercadolivre\b|\bmlb\b|\bmeli\b/.test(fields) || /^mlb/.test(numExt)) return "ml";
  if(/\bshopee\b/.test(fields) || /^shopee/.test(numExt)) return "shopee";
  if(/\bamazon\b/.test(fields)) return "amazon";

  if(/\byampi\b/.test(fields)) return "yampi";

  const known={ml:1,shopee:1,amazon:1,shopify:1,cnpj:1,yampi:1,outros:1};
  if(o._canal && known[o._canal]) return o._canal;
  return "outros";
}
const CH={ml:"Mercado Livre",shopee:"Shopee",amazon:"Amazon",shopify:"Site (Shopify)",cnpj:"B2B (Atacado)",yampi:"Yampi",outros:"Outros"};
const CH_COLOR={ml:"#f3b129",shopee:"#f06320",amazon:"#00a8e0",shopify:"#96bf48",yampi:"#e040fb",cnpj:"#f59e0b",outros:"#9b8cff"};
function normSt(s){ const v=(s?.nome||s?.id||s||"").toString().toLowerCase(); if(/aprovado|pago|conclu|fatur|enviado|entregue|paid|authorized/i.test(v)) return "aprovado"; if(/pendent|aguard|aberto|novo|pending/i.test(v)) return "pendente"; if(/cancel|refund|void/i.test(v)) return "cancelado"; return "outros"; }
const ST_LABEL={aprovado:"Aprovado",pendente:"Pendente",cancelado:"Cancelado"};
const ST_CLASS={aprovado:"s-aprovado",pendente:"s-pendente",cancelado:"s-cancelado"};
function fmtBRL(v){ return(parseFloat(v)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}); }
function fmtDate(d){ if(!d)return"—"; const dt=new Date(d); return isNaN(dt)?"—":dt.toLocaleDateString("pt-BR"); }
function fmtDoc(d){ d=(d||"").replace(/\D/g,""); if(d.length===11)return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4"); if(d.length===14)return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,"$1.$2.$3/$4-$5"); return d; }
function fmtPhone(p){ p=(p||"").replace(/\D/g,""); if(!p)return""; if(p.length===11)return`(${p.slice(0,2)}) ${p.slice(2,7)}-${p.slice(7)}`; if(p.length===10)return`(${p.slice(0,2)}) ${p.slice(2,6)}-${p.slice(6)}`; return p; }
function rawPhone(p){ return(p||"").replace(/\D/g,""); }
function val(o){ return parseFloat(o.totalProdutos||o.total)||0; }
function cliKey(o){ return o.contato?.id||o.contato?.email||o.contato?.cpfCnpj||o.contato?.telefone||o.contato?.nome||"?"; }
function daysSince(ds){ if(!ds)return 9999; const d=new Date(ds); return isNaN(d)?9999:Math.floor((Date.now()-d)/86400000); }
function isCNPJ(doc){ return (doc||"").replace(/\D/g,"").length===14; }

function buildCli(list){
  const m={};
  list.forEach(o=>{
    const k=cliKey(o);
    if(!m[k]) m[k]={id:k,nome:o.contato?.nome||"Desconhecido",doc:o.contato?.cpfCnpj||"",email:o.contato?.email||"",telefone:o.contato?.telefone||o.contato?.celular||"",cidade:o.contato?.endereco?.municipio||"",uf:o.contato?.endereco?.uf||"",orders:[],channels:new Set(),last:null,first:null};
    m[k].orders.push(o);
    m[k].channels.add(detectCh(o));
    if(!m[k].email&&o.contato?.email) m[k].email=o.contato.email;
    if(!m[k].telefone&&(o.contato?.telefone||o.contato?.celular)) m[k].telefone=o.contato?.telefone||o.contato?.celular;
    const d=new Date(o.data);
    if(!isNaN(d)){
      if(!m[k].last||d>new Date(m[k].last)) m[k].last=o.data;
      if(!m[k].first||d<new Date(m[k].first)) m[k].first=o.data;
    }
  });
  return m;
}

// ── Scores ──────────────────────────────────────────
function calcCliScores(c){
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
  const ufs=new Set(); allOrders.forEach(o=>{ const uf=(o.contato?.endereco?.uf||o.contato?.uf||"").trim().toUpperCase(); if(uf)ufs.add(uf); });
  ["fil-estado","fil-uf"].forEach(id=>{ const s=document.getElementById(id); if(!s)return; const v=s.value; s.innerHTML=`<option value="">Todos estados</option>`; [...ufs].sort().forEach(uf=>s.innerHTML+=`<option>${escapeHTML(uf)}</option>`); s.value=v; });
}

// ═══════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════
function renderDash(){
  // Atualizar período
  if(allOrders.length){
    const dates = allOrders.map(o=>new Date(o.data||o.dataPedido)).filter(d=>!isNaN(d)).sort((a,b)=>a-b);
    const dp = document.getElementById('dash-period');
    if(dp && dates.length) dp.textContent = `${dates[0].toLocaleDateString('pt-BR')} — ${dates[dates.length-1].toLocaleDateString('pt-BR')} · ${allOrders.length} pedidos`;
  }

  const total=allOrders.reduce((s,o)=>s+val(o),0);
  const now=new Date();
  const thisMo=allOrders.filter(o=>{ const d=new Date(o.data); return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth(); });
  const prevMo=allOrders.filter(o=>{ const d=new Date(o.data); const pm=now.getMonth()===0?11:now.getMonth()-1,py=now.getMonth()===0?now.getFullYear()-1:now.getFullYear(); return d.getFullYear()===py&&d.getMonth()===pm; });
  const tMo=thisMo.reduce((s,o)=>s+val(o),0),pMo=prevMo.reduce((s,o)=>s+val(o),0);
  const delta=pMo>0?((tMo-pMo)/pMo*100):0;
  const cliMap=buildCli(allOrders);
  const cliList=Object.values(cliMap);
  const vipCount=cliList.filter(c=>calcCliScores(c).status==="vip").length;
  const recorrentes=cliList.filter(c=>c.orders.length>=2).length;
  const pctRec=cliList.length?Math.round(recorrentes/cliList.length*100):0;

  // Source row
  document.getElementById("source-row").innerHTML=
    (blingOrders.length?`<span style="background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.2);border-radius:7px;padding:3px 9px">🔵 Bling: ${blingOrders.length}</span>`:"")
    +(yampiOrders.length?`<span style="background:rgba(217,70,239,.1);border:1px solid rgba(217,70,239,.2);border-radius:7px;padding:3px 9px">🟣 Yampi: ${yampiOrders.length}</span>`:"")
    +(shopifyOrders.length?`<span style="background:rgba(150,191,72,.1);border:1px solid rgba(150,191,72,.2);border-radius:7px;padding:3px 9px">🟢 Shopify: ${shopifyOrders.length}</span>`:"")
    +(!allOrders.length?`<span style="color:var(--text-3)">Nenhum dado — vá em ⚙️ Config</span>`:"");

  const autoEl = document.getElementById("auto-insights");
  if(autoEl){
    const weekMs = 7*86400000;
    const nowTs = Date.now();
    const inLast = (days)=>allOrders.filter(o=>{ const d=new Date(o.data); return !isNaN(d) && (nowTs - d.getTime()) <= days*86400000; });
    const w1 = inLast(7);
    const w2 = allOrders.filter(o=>{ const d=new Date(o.data); const dt=d.getTime(); return !isNaN(d) && (nowTs - dt) > weekMs && (nowTs - dt) <= 2*weekMs; });
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
    w1.forEach(o=>(o.itens||[]).forEach(it=>{
      const k = String(it.codigo||it.descricao||"—");
      prod7[k] = (prod7[k]||0) + (Number(it.quantidade||1)||1);
    }));
    const prod14 = {};
    w2.forEach(o=>(o.itens||[]).forEach(it=>{
      const k = String(it.codigo||it.descricao||"—");
      prod14[k] = (prod14[k]||0) + (Number(it.quantidade||1)||1);
    }));
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
        action:`showPage('segmentos');selectSegment('vip')`
      });
    }
    if(ticket2 > 0 && Math.abs(ticketDelta) >= 8){
      const dir = ticketDelta >= 0 ? "subiu" : "caiu";
      insights.push({
        title:`📉 Ticket médio ${dir} ${Math.abs(ticketDelta).toFixed(0)}% na semana`,
        desc:`Compare últimos 7 dias vs semana anterior para ajustar oferta/kit.`,
        cta:`Comparar`,
        action:`document.getElementById('cmp-a')?.focus();showPage('dashboard')`
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

  document.getElementById("dash-stats").innerHTML=[
    {l:"Volume Total",v:fmtBRL(total),s:"consolidado"},
    {l:"Este Mês",v:fmtBRL(tMo),s:`<span style="color:${delta>=0?"var(--green)":"var(--red)"}">${delta>=0?"▲":"▼"}${Math.abs(delta).toFixed(1)}%</span>`},
    {l:"Clientes",v:cliList.length,s:`${vipCount} VIPs`},
    {l:"Taxa Recompra",v:pctRec+"%",s:`${recorrentes} com 2+ pedidos`},
    {l:"Ticket Médio",v:fmtBRL(allOrders.length?total/allOrders.length:0),s:"por pedido"},
    {l:"Pedidos Total",v:allOrders.length,s:`${yampiOrders.length} Yampi · ${blingOrders.length} Bling`},
  ].map(s=>`<div class="stat"><div class="stat-label">${s.l}</div><div class="stat-value">${s.v}</div><div class="stat-sub">${s.s}</div></div>`).join("");

  renderMeta(tMo); renderCompare(); renderAlertBanner();
  renderChartCanal(); renderChartMes(); renderTopCli(); renderTopProd(); setTimeout(()=>{renderDashChartsCrescimento();renderDashChartsCidades();},150);
}

function renderMeta(v){
  const meta=parseFloat(localStorage.getItem("crm_meta")||"0");
  if(!meta){document.getElementById("meta-body").innerHTML=`<span style="font-size:11px;color:var(--text-3)">Clique em "Editar" para definir sua meta.</span>`;return;}
  const pct=Math.min(v/meta*100,100),warn=pct<50;
  document.getElementById("meta-body").innerHTML=`
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
function renderCompare(){
  const a=document.getElementById("cmp-a")?.value,b=document.getElementById("cmp-b")?.value; if(!a||!b)return;
  const flt=ym=>{ const[y,m]=ym.split("-"); return allOrders.filter(o=>{ const d=new Date(o.data); return d.getFullYear()===+y&&(d.getMonth()+1)===+m; }); };
  const oA=flt(a),oB=flt(b),vA=oA.reduce((s,o)=>s+val(o),0),vB=oB.reduce((s,o)=>s+val(o),0);
  const d=vB>0?((vA-vB)/vB*100):0;
  const mn=ym=>{ const[y,m]=ym.split("-"); return["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][+m-1]+"/"+y.slice(2); };
  document.getElementById("cmp-body").innerHTML=`<div class="cmp-grid">
    <div class="cmp-col"><div class="cmp-col-title">${mn(a)}</div><div class="cmp-val" style="color:var(--blue)">${fmtBRL(vA)}</div><div class="cmp-sub">${oA.length} pedidos</div><div class="cmp-delta ${d>=0?"delta-up":"delta-down"}">${d>=0?"▲":"▼"}${Math.abs(d).toFixed(1)}% vs ${mn(b)}</div></div>
    <div class="cmp-col"><div class="cmp-col-title">${mn(b)}</div><div class="cmp-val" style="color:var(--violet-hi)">${fmtBRL(vB)}</div><div class="cmp-sub">${oB.length} pedidos</div></div>
  </div>`;
}
function renderAlertBanner(){
  const ad=parseInt(localStorage.getItem("crm_alertdays")||"60");
  const inat=Object.values(buildCli(allOrders)).filter(c=>daysSince(c.last)>ad&&!isCNPJ(c.doc));
  const el=document.getElementById("alert-banner");
  if(!inat.length){el.style.display="none";return;}
  el.style.display="block";
  el.innerHTML=`<div class="ab-title">⚠️ ${inat.length} cliente${inat.length!==1?"s":""} sem comprar há mais de ${ad} dias</div>
    ${inat.slice(0,3).map(c=>`<div class="ab-item"><strong>${escapeHTML(c.nome)}</strong> — ${daysSince(c.last)} dias</div>`).join("")}
    ${inat.length>3?`<span style="font-size:10px;color:var(--blue);cursor:pointer" onclick="showPage('alertas')">Ver todos →</span>`:""}`;
}
function renderChartCanal(){
  const t={};
  allOrders.forEach(o=>{ const c=detectCh(o); t[c]=(t[c]||0)+val(o); });
  Object.keys(t).forEach(k=>{ if(!t[k]) delete t[k]; });
  if(charts.canal) charts.canal.destroy();
  const canvas=document.getElementById("chart-canal");
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  const total=Object.values(t).reduce((a,b)=>a+b,0)||1;
  const sorted=Object.entries(t).sort((a,b)=>b[1]-a[1]);
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
  charts.canal=new Chart(ctx,{
    type:"doughnut",
    data:{
      labels:sorted.map(([c])=>CH[c]||c),
      datasets:[{
        data:sorted.map(([,v])=>v),
        backgroundColor:sorted.map(([c])=>brandColors[c]||brandColors.default),
        borderWidth:0,
        borderColor:"transparent",
        spacing:5,
        hoverOffset:8
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      cutout:'68%',
      plugins:{
        legend:{
          position:"bottom",
          labels:{color:"rgba(160, 168, 190, 0.8)",font:{size:10,family:"Plus Jakarta Sans"},
            boxWidth:8,boxHeight:8,padding:10,
            usePointStyle:true,pointStyle:'circle'}
        },
        tooltip:{
          backgroundColor:'#0e1018',
          borderColor:'#1d2235',
          borderWidth:1,
          titleColor:'#edeef4',
          bodyColor:'#a0a8be',
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
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-sub)">
      <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div>
      <div style="flex:1;font-size:11px;font-weight:600">${CH[c]||c}</div>
      <div style="font-size:11px;font-weight:700;font-family:var(--mono);color:var(--green)">${fmtBRL(v)}</div>
      <div style="font-size:10px;color:var(--text-3);width:36px;text-align:right;font-weight:600">${pct}%</div>
      <div style="width:50px;height:4px;background:var(--border);border-radius:99px;overflow:hidden">
        <div style="height:4px;border-radius:99px;background:${color};width:${pct}%"></div>
      </div>
    </div>`;
  }).join("");
}


function renderChartMes(){
  const bm={};
  allOrders.forEach(o=>{ const d=new Date(o.data); if(isNaN(d))return; const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; bm[k]=(bm[k]||0)+val(o); });
  const sk=Object.keys(bm).sort();
  if(charts.mes) charts.mes.destroy();
  const canvas = document.getElementById("chart-mes");
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  charts.mes=new Chart(ctx,{
    type:"bar",
    data:{
      labels:sk.map(k=>{ const[y,m]=k.split("-"); return m+"/"+y.slice(2); }),
      datasets:[{
        data:sk.map(k=>bm[k]),
        backgroundColor:"#0FA765",
        hoverBackgroundColor:"#13c97e",
        borderWidth:0,
        borderRadius:4,
        borderSkipped:false
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{backgroundColor:"#0e1018",borderColor:"#1d2235",borderWidth:1,
          titleColor:"#edeef4",bodyColor:"#a0a8be",padding:10,
          callbacks:{label:c=>" "+fmtBRL(c.raw)}}
      },
      scales:{
        x:{grid:{display:false},ticks:{color:"rgba(160, 168, 190, 0.8)",font:{size:9,family:"Plus Jakarta Sans"},maxRotation:0,autoSkip:true,maxTicksLimit:6}},
        y:{grid:{display:false},
          ticks:{color:"rgba(160, 168, 190, 0.8)",font:{size:9,family:"Plus Jakarta Sans"},callback:v=>v>=1000?(v/1000).toFixed(0)+"k":v}}
      }
    }
  })
}
function renderTopCli(){
  const m={}; allOrders.forEach(o=>{
    const k=cliKey(o);
    if(!m[k]){ const cli=allCustomers.find(x=>(x.nome||"")===(o.contato?.nome||"")||x.doc===(o.contato?.cpfCnpj||o.contato?.numeroDocumento||"")); m[k]={n:o.contato?.nome||"?",t:0,id:cli?cli.id:""}; }
    m[k].t+=val(o);
  });
  const top=Object.values(m).sort((a,b)=>b.t-a.t).slice(0,10); const max=top[0]?.t||1;
  document.getElementById("top-clientes").innerHTML=top.map((c,i)=>`<div class="top-item"><span class="top-rank">#${i+1}</span><div style="flex:1;overflow:hidden"><div class="top-name">${escapeHTML(c.n)}</div><div class="top-bar-wrap"><div class="top-bar" style="width:${(c.t/max*100).toFixed(0)}%"></div></div></div><span class="top-val">${fmtBRL(c.t)}</span></div>`).join("");
}
function renderTopProd(){
  const m={}; allOrders.forEach(o=>(o.itens||[]).forEach(it=>{ const k=it.codigo||it.descricao||"?"; if(!m[k])m[k]={n:it.descricao||k,t:0}; m[k].t+=(parseFloat(it.valor)||0)*(parseFloat(it.quantidade)||1); }));
  const top=Object.values(m).sort((a,b)=>b.t-a.t).slice(0,10); const max=top[0]?.t||1;
  document.getElementById("top-produtos-dash").innerHTML=top.length?top.map((p,i)=>`<div class="top-item"><span class="top-rank">#${i+1}</span><div style="flex:1;overflow:hidden"><div class="top-name">${escapeHTML(p.n)}</div><div class="top-bar-wrap"><div class="top-bar" style="width:${(p.t/max*100).toFixed(0)}%"></div></div></div><span class="top-val">${fmtBRL(p.t)}</span></div>`).join(""):`<div style="padding:10px;font-size:11px;color:var(--text-3)">Nenhum produto</div>`;
}

// ═══════════════════════════════════════════════════
//  AI ANALYSIS
// ═══════════════════════════════════════════════════

// ─── DASHBOARD NEW CHARTS ─────────────────────────────────────
function renderDashChartsCrescimento(){
  const canvas = document.getElementById("chart-crescimento");
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  const byMonth = {};
  allOrders.forEach(o=>{
    if(!o.data_pedido) return;
    const d = new Date(o.data_pedido);
    const k = d.getFullYear()+"-"+(d.getMonth()+1).toString().padStart(2,"0");
    byMonth[k]=(byMonth[k]||0)+(o.total||0);
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

function renderDashChartsCidades(){
  const canvas = document.getElementById("chart-cidades");
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  if(!ctx) return;
  const byCity = {};
  allCustomers.forEach(c=>{
    if(!c.cidade) return;
    const k = (c.cidade+" ("+c.uf+")").trim();
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

function renderSegmentos(){
  const clis=Object.values(buildCli(allOrders));
  document.getElementById("seg-grid").innerHTML=SEGMENTS.map(seg=>{
    const count=clis.filter(seg.filter).length;
    return`<div class="seg-card ${activeSegment===seg.id?"active":""}" onclick="selectSegment('${seg.id}')">
      <div class="seg-icon">${seg.icon}</div>
      <div class="seg-name">${seg.name}</div>
      <div class="seg-desc">${seg.desc}</div>
      <div class="seg-count">${count} cliente${count!==1?"s":""}</div>
      <div class="seg-action">💡 ${seg.action}</div>
    </div>`;
  }).join("");
  if(activeSegment) renderSegmentClients(activeSegment);
}

function selectSegment(id){
  activeSegment=activeSegment===id?null:id;
  renderSegmentos();
}

function renderSegmentClients(id){
  const seg=SEGMENTS.find(s=>s.id===id);
  if(!seg){ document.getElementById("seg-result").innerHTML=""; return; }
  const clis=Object.values(buildCli(allOrders)).filter(seg.filter).sort((a,b)=>b.orders.reduce((s,o)=>s+val(o),0)-a.orders.reduce((s,o)=>s+val(o),0));
  if(!clis.length){ document.getElementById("seg-result").innerHTML=`<div class="empty">Nenhum cliente neste segmento.</div>`; return; }

  document.getElementById("seg-result").innerHTML=`
    <div style="font-size:11px;font-weight:700;color:var(--ai);margin:14px 0 8px;text-transform:uppercase;letter-spacing:.6px">${seg.icon} ${seg.name} — ${clis.length} clientes</div>
    <div class="client-list">${clis.map((c,i)=>renderCliCard(c,"sg"+i)).join("")}</div>`;
}

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

function renderClientes(){
  const cc={}; allOrders.forEach(o=>{ const c=detectCh(o); cc[c]=(cc[c]||0)+1; });
  const pills=[{id:"all",l:"Todos",n:allOrders.length},...["cnpj","shopify","ml","shopee","amazon","yampi","outros"].filter(c=>cc[c]).map(c=>({id:c,l:CH[c]||c,n:cc[c]}))];
  document.getElementById("ch-pills-cli").innerHTML=pills.map(p=>`<div class="ch-pill ${p.id} ${activeCh===p.id?"active":""}" onclick="setChCli('${p.id}')">${p.l} <strong>${p.n}</strong></div>`).join("");

  const q=(document.getElementById("search-cli")?.value||"").toLowerCase();
  const stP=document.getElementById("fil-status-pedido")?.value||"";
  const uf=document.getElementById("fil-estado")?.value||"";
  const pf=document.getElementById("fil-perfil")?.value||"";

  const filt=allOrders.filter(o=>{
    if(activeCh!=="all"&&detectCh(o)!==activeCh) return false;
    if(stP&&normSt(o.situacao)!==stP) return false;
    if(uf&&(o.contato?.endereco?.uf||o.contato?.uf||"").toUpperCase()!==uf) return false;
    if(q){ const n=(o.contato?.nome||"").toLowerCase(),e=(o.contato?.email||"").toLowerCase(),t=rawPhone(o.contato?.telefone||""); if(!n.includes(q)&&!e.includes(q)&&!t.includes(q.replace(/\D/g,"")))return false; }
    return true;
  });

  let clis=Object.values(buildCli(filt)).sort((a,b)=>b.orders.reduce((s,o)=>s+val(o),0)-a.orders.reduce((s,o)=>s+val(o),0));
  if(pf) clis=clis.filter(c=>calcCliScores(c).status===pf);

  document.getElementById("cli-label").textContent=`${clis.length} cliente${clis.length!==1?"s":""}`;
  if(!clis.length){ document.getElementById("client-list").innerHTML=`<div class="empty">Nenhum cliente encontrado.</div>`; return; }
  document.getElementById("client-list").innerHTML=clis.map((c,i)=>renderCliCard(c,"cl"+i)).join("");
}

function openClientePage(clienteId){
  currentClienteId = clienteId;
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

function clienteAddCall(){
  if(!currentClienteId){ toast("⚠ Cliente não selecionado"); return; }
  openInteractionModal(currentClienteId, "ligacao");
}

function clienteAddNegotiation(){
  if(!currentClienteId){ toast("⚠ Cliente não selecionado"); return; }
  openInteractionModal(currentClienteId, "negociacao_registrada");
}

function summarizeOrderItemsMini(o){
  const itens = Array.isArray(o?.itens) ? o.itens : [];
  if(!itens.length) return "—";
  const parts = itens
    .map(it=>{
      const name = String(it?.descricao || it?.name || it?.produto || "").trim();
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
  const items = Array.isArray(o.itens) ? o.itens : [];
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
      ${items.length ? items.map(it=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-sub);font-size:12px"><span>${escapeHTML(it.descricao||it.codigo||"—")}</span><span style="font-family:var(--mono)">${escapeHTML(String(it.quantidade||1))}×</span></div>`).join("") : `<div style="font-size:12px;color:var(--text-3);padding:8px 0">Nenhum item disponível.</div>`}
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

  const orders = allOrders
    .filter(o=>cliKey(o)===c.id)
    .slice()
    .sort((a,b)=>new Date(b.data||0)-new Date(a.data||0));

  const total = orders.reduce((s,o)=>s+val(o),0);
  const n = orders.length;
  const ticket = n ? total/n : 0;
  const last = orders[0]?.data || c.last || null;
  const first = orders[orders.length-1]?.data || c.first || null;
  const ds = daysSince(last);
  const avgInterval = calcCliScores(c).avgInterval;
  const loc = [c.cidade,c.uf].filter(Boolean).join(" — ");

  const titleEl = document.getElementById("cliente-title");
  const subEl = document.getElementById("cliente-sub");
  if(titleEl) titleEl.textContent = c.nome || "Cliente";
  const meta = cliMetaCache?.[c.id] || {};
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
    <div class="profile-row"><span style="color:var(--text-3)">Nome</span><span>${escapeHTML(c.nome||"—")}</span></div>
    <div class="profile-row"><span style="color:var(--text-3)">Telefone</span><span>${escapeHTML(c.telefone ? fmtPhone(c.telefone) : "—")}</span></div>
    <div class="profile-row"><span style="color:var(--text-3)">Email</span><span>${escapeHTML(c.email||"—")}</span></div>
    <div class="profile-row"><span style="color:var(--text-3)">Cidade</span><span>${escapeHTML(loc||"—")}</span></div>
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
    (o.itens||[]).forEach(it=>{
      const key = String(it.codigo||it.descricao||"—");
      if(!prodAgg[key]) prodAgg[key] = { nome: it.descricao||key, qty:0, total:0 };
      const qty = Number(it.quantidade||1) || 1;
      const price = Number(it.valor||0) || 0;
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
    host.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:8px 0">Cliente ainda não vinculado no Supabase.</div>`;
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
    const rows = Array.isArray(data) ? data : [];
    if(!rows.length){
      host.innerHTML = `<div style="font-size:12px;color:var(--text-3);padding:8px 0">Nenhuma interação registrada ainda.</div>`;
      return;
    }
    const typeBucket = (t)=>{
      const tt = String(t||"");
      if(tt==="mensagem_enviada" || tt==="mensagem_recebida") return "whatsapp";
      if(tt==="tarefa_criada" || tt==="tarefa_concluida") return "tarefa";
      if(tt==="ligacao") return "ligação";
      if(tt==="negociacao_registrada") return "negociação";
      if(tt==="pedido_criado" || tt==="pagamento_confirmado" || tt==="status_pedido_atualizado") return "pedido";
      if(tt==="nota") return "nota";
      return tt || "interação";
    };
    const bucketLabel = {
      whatsapp: "WhatsApp",
      tarefa: "Tarefa",
      "ligação": "Ligação",
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
      if(tt==="ligacao") return "Ligação";
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
  const t = String(type||"nota");
  const title = t==="ligacao" ? "📞 Registrar ligação" : t==="nota" ? "📝 Adicionar nota" : t==="negociacao_registrada" ? "🤝 Registrar negociação" : "➕ Interação";
  const html=`
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:600;display:flex;align-items:center;justify-content:center;padding:16px" id="int-modal-overlay">
      <div style="background:var(--surface);border-radius:16px;padding:20px;width:100%;max-width:420px;border:1px solid var(--border)">
        <div style="font-size:14px;font-weight:800;margin-bottom:6px">${escapeHTML(title)}</div>
        <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">${escapeHTML(nm)}</div>
        <input type="hidden" id="im-customer" value="${escapeHTML(String(customerId))}"/>
        <select id="im-type" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text);font-size:12px;margin-bottom:8px">
          <option value="nota" ${t==="nota"?"selected":""}>📝 Nota</option>
          <option value="ligacao" ${t==="ligacao"?"selected":""}>📞 Ligação</option>
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
      ${phoneRaw?`<a class="btn-call" href="tel:+55${phoneRaw}">📞</a>`:""}
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
  const host = document.getElementById("opp-kanban");
  if(!host) return;
  if(!supaConnected || !supaClient){
    host.innerHTML = `<div class="empty">Conecte o Supabase para ver o pipeline real.</div>`;
    return;
  }
  const respSel = document.getElementById("opp-resp-filter");
  const slaDays = Math.max(0, parseInt(document.getElementById("opp-sla-days")?.value||"0")||0);
  const onlySla = !!document.getElementById("opp-only-sla")?.checked;
  try{
    const {data, error} = await supaClient
      .from("v2_clientes")
      .select("id,doc,nome,cidade,uf,pipeline_stage,last_interaction_at,last_interaction_type,last_interaction_desc,last_contact_at,responsible_user")
      .limit(2000);
    if(error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if(respSel){
      const current = respSel.value || "";
      const users = Array.from(new Set(rows.map(r=>String(r.responsible_user||"").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
      respSel.innerHTML = `<option value="">Todos responsáveis</option>` + users.map(u=>`<option value="${escapeHTML(u)}">${escapeHTML(u)}</option>`).join("");
      respSel.value = users.includes(current) ? current : "";
    }
    const respFilter = String(respSel?.value || "").trim();
    const byStage = {};
    OPP_STAGES.forEach(s=>{ byStage[s.id] = []; });
    rows.forEach(r=>{
      const st = byStage[r.pipeline_stage] ? r.pipeline_stage : "novo_lead";
      const resp = String(r.responsible_user||"").trim();
      if(respFilter && resp !== respFilter) return;
      const dsContact = daysSince(r.last_contact_at || r.last_interaction_at);
      const slaHit = slaDays>0 && dsContact<9999 && dsContact>slaDays && (st==="contato_iniciado" || st==="negociacao");
      if(onlySla && !slaHit) return;
      r.__dsContact = dsContact;
      r.__slaHit = slaHit;
      byStage[st].push(r);
    });
    OPP_STAGES.forEach(s=>{
      byStage[s.id].sort((a,b)=>{
        const ad = a.last_interaction_at ? new Date(a.last_interaction_at).getTime() : 0;
        const bd = b.last_interaction_at ? new Date(b.last_interaction_at).getTime() : 0;
        return bd - ad;
      });
    });

    const stageLabel = Object.fromEntries(OPP_STAGES.map(s=>[s.id,s.label]));
    const typeLabel = {
      mensagem_enviada: "Mensagem enviada",
      mensagem_recebida: "Mensagem recebida",
      ligacao: "Ligação",
      tarefa_criada: "Tarefa criada",
      tarefa_concluida: "Tarefa concluída",
      negociacao_registrada: "Negociação",
      pedido_criado: "Pedido criado",
      pagamento_confirmado: "Pagamento confirmado",
      status_pedido_atualizado: "Status do pedido",
      nota: "Nota"
    };

    host.innerHTML = OPP_STAGES.map(s=>{
      const list = byStage[s.id] || [];
      return `
        <div class="kanban-col" data-stage="${escapeHTML(s.id)}">
          <div class="kanban-col-title">
            <span>${escapeHTML(s.label)}</span>
            <span class="kanban-col-count">${list.length}</span>
          </div>
          <div class="kanban-drop">
            ${list.map(r=>{
              const key = String(r.doc || r.id || "");
              const safeKey = escapeJsSingleQuote(key);
              const nm = String(r.nome || "Cliente");
              const loc = [r.cidade, r.uf].filter(Boolean).join(" — ");
              const lastAt = r.last_interaction_at ? new Date(r.last_interaction_at) : null;
              const lastLabel = typeLabel[r.last_interaction_type] || r.last_interaction_type || "—";
              const lastTime = lastAt && !isNaN(lastAt) ? lastAt.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "—";
              const dsContact = typeof r.__dsContact === "number" ? r.__dsContact : daysSince(r.last_contact_at || r.last_interaction_at);
              const dsText = dsContact>=9999 ? "—" : `${dsContact}d sem contato`;
              const resp = r.responsible_user ? String(r.responsible_user) : "—";
              const desc = r.last_interaction_desc ? String(r.last_interaction_desc) : "";
              const descMini = desc.length > 90 ? desc.slice(0,90)+"…" : desc;
              const localCust = allCustomers.find(c=>String(c.id||"")===key);
              const phone = rawPhone(localCust?.telefone||"");
              const slaHit = !!r.__slaHit;
              return `
                <div class="opp-card ${slaHit?"opp-sla":""}" onclick="openClientePage('${safeKey}')">
                  <div class="opp-title">${escapeHTML(nm)}</div>
                  <div class="opp-meta">Estágio: ${escapeHTML(stageLabel[r.pipeline_stage]||stageLabel[s.id]||"—")}</div>
                  <div class="opp-meta">Última: ${escapeHTML(lastLabel)} · ${escapeHTML(lastTime)}${descMini?` · ${escapeHTML(descMini)}`:""}</div>
                  <div class="opp-meta">Contato: ${escapeHTML(dsText)} · Resp: ${escapeHTML(resp)}${slaHit?` · <span class="opp-sla-tag">SLA</span>`:""}</div>
                  <div class="opp-actions" onclick="event.stopPropagation()">
                    ${phone?`<button class="opp-mini-btn" onclick="openWaModal('${safeKey}')">WA</button>`:""}
                    <button class="opp-mini-btn" onclick="openInteractionModal('${safeKey}','ligacao')">Lig</button>
                    <button class="opp-mini-btn" onclick="openInteractionModal('${safeKey}','nota')">Nota</button>
                    <button class="opp-mini-btn" onclick="openInteractionModal('${safeKey}','negociacao_registrada')">Neg</button>
                    <button class="opp-mini-btn" onclick="openClientePage('${safeKey}')">Abrir</button>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("");
  }catch(_e){
    host.innerHTML = `<div class="empty">Pipeline indisponível no momento.</div>`;
  }
}

function renderOportunidades(){
  if(supaConnected && supaClient){
    renderOportunidadesFromSupabase();
    return;
  }
  seedOppPipeline();
  const host = document.getElementById("opp-kanban");
  if(!host) return;
  const byStage = {};
  OPP_STAGES.forEach(s=>{ byStage[s.id] = []; });
  (oppPipeline||[]).forEach(o=>{
    const st = byStage[o.stage] ? o.stage : "novo_lead";
    byStage[st].push(o);
  });
  OPP_STAGES.forEach(s=>{
    byStage[s.id].sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));
  });

  host.innerHTML = OPP_STAGES.map(s=>{
    const list = byStage[s.id] || [];
    return `
      <div class="kanban-col" data-stage="${escapeHTML(s.id)}">
        <div class="kanban-col-title">
          <span>${escapeHTML(s.label)}</span>
          <span class="kanban-col-count">${list.length}</span>
        </div>
        <div class="kanban-drop" data-stage="${escapeHTML(s.id)}">
          ${list.map(o=>{
            const c = allCustomers.find(x=>x.id===o.cliente_id);
            const nm = c?.nome || "Cliente";
            const loc = [c?.cidade,c?.uf].filter(Boolean).join(" — ");
            const hint = [o.hint, loc].filter(Boolean).join(" · ");
            return `
              <div class="opp-card" data-opp-id="${escapeHTML(String(o.id))}">
                <div class="opp-title">${escapeHTML(nm)}</div>
                <div class="opp-meta">${escapeHTML(o.title)}${hint?` · ${escapeHTML(hint)}`:""}</div>
                <div class="opp-val">${escapeHTML(fmtBRL(o.value||0))}</div>
                <div class="opp-actions">
                  <button class="opp-mini-btn" onclick="openClientePage('${escapeJsSingleQuote(String(o.cliente_id||""))}')">Cliente</button>
                  <button class="opp-mini-btn" onclick="openWaModal('${escapeJsSingleQuote(String(o.cliente_id||""))}')">WA</button>
                  ${s.id!=="fechado" ? `<button class="opp-mini-btn" onclick="moveOppStage('${escapeJsSingleQuote(String(o.id))}','fechado')">✓</button>` : ``}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }).join("");
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
function renderProdutos(){
  const q=(document.getElementById("search-prod")?.value||"").toLowerCase();
  const selCh=document.getElementById("fil-canal-prod");
  if(selCh){
    [...selCh.options].forEach(op=>{
      if(op.value && CH[op.value]) op.textContent=CH[op.value];
    });
  }
  const ch=selCh?.value||"";
  const per=parseInt(document.getElementById("fil-periodo-prod")?.value||"0");
  const evolucaoDias = parseInt(document.getElementById("fil-evolucao-prod")?.value || "30");
  const now=new Date();
  const m={};
  
  // Processamento de dados base
  allOrders
    .filter(o=>!ch||detectCh(o)===ch)
    .filter(o=>{ if(!per)return true; const d=new Date(o.data||o.dataPedido); return (now-d)/(86400000)<=per; })
    .forEach(o=>(o.itens||[]).forEach(it=>{
      const k=it.codigo||it.descricao||"?";
      const canal = detectCh(o);
      const dataStr = o.data || o.dataPedido || "";
      
      if(!m[k]) m[k] = {
        nome: it.descricao||k,
        code: it.codigo||"",
        total: 0,
        qty: 0,
        peds: new Set(),
        clis: new Set(),
        lastVenda: "",
        canais: {shopify:0, amazon:0, shopee:0, outros:0, ml:0, cnpj:0, yampi:0},
        historico: {} // { "YYYY-MM-DD": total }
      };
      
      const valorTotal = (parseFloat(it.valor)||0)*(parseFloat(it.quantidade)||1);
      const qtd = parseFloat(it.quantidade)||1;
      
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
    }));

  let prods = Object.values(m).sort((a,b)=>b.total-a.total);
  if(q) prods = prods.filter(p=>p.nome.toLowerCase().includes(q)||p.code.toLowerCase().includes(q));
  
  document.getElementById("prod-label").textContent = `${prods.length} produto${prods.length!==1?"s/sabores":""}`;

  // 1. Cards de KPI no Topo
  const topVendido = prods.reduce((a, b) => (a.qty > b.qty ? a : b), {nome:"—", qty:0});
  const topReceita = prods[0] || {nome:"—", total:0};
  
  // Calcular crescimento (últimos 7 dias vs 7 dias anteriores)
  const calculateGrowth = (prod) => {
    const week1 = 7, week2 = 14;
    const nowTs = now.getTime();
    let v1 = 0, v2 = 0;
    Object.entries(prod.historico).forEach(([d, v]) => {
      const ts = new Date(d).getTime();
      const diff = (nowTs - ts) / 86400000;
      if(diff <= week1) v1 += v;
      else if(diff <= week2) v2 += v;
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
  if(charts.produtos) charts.produtos.destroy();
  const ctxP=document.getElementById("chart-produtos");
  if(ctxP && top10.length){
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
  if(charts.prodParticipacao) charts.prodParticipacao.destroy();
  const ctxPart = document.getElementById("chart-participacao-produtos");
  if(ctxPart && top10.length){
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
  if(charts.prodEvolucao) charts.prodEvolucao.destroy();
  const ctxEv = document.getElementById("chart-evolucao-produtos");
  if(ctxEv && top10.length){
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
  const avgQty = prods.reduce((s,p)=>s+p.qty,0)/prods.length || 1;
  const avgTotal = prods.reduce((s,p)=>s+p.total,0)/prods.length || 1;

  document.getElementById("prod-list-detailed").innerHTML = `
    <table class="chiva-table" style="width:100%;min-width:900px">
      <thead>
        <tr>
          <th>Produto</th>
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
          const tm = p.total / p.peds.size;
          let status = '<span class="chiva-badge chiva-badge-amber">MÉDIO</span>';
          if(p.total > avgTotal * 1.5 || p.qty > avgQty * 1.5) status = '<span class="chiva-badge chiva-badge-green">🟢 LÍDER</span>';
          else if(p.total < avgTotal * 0.5) status = '<span class="chiva-badge chiva-badge-red">🔴 BAIXO</span>';
          
          const canaisHtml = Object.entries(p.canais)
            .filter(([,q])=>q>0)
            .map(([c,q])=>`<span style="font-size:9px;background:var(--border);padding:2px 5px;border-radius:4px;margin-right:3px" title="${CH[c]||c}">${(CH[c]||c).slice(0,3).toUpperCase()}: ${q}</span>`)
            .join("");

          return `
            <tr>
              <td>
                <div style="font-weight:700">${escapeHTML(p.nome)}</div>
                <div style="font-size:10px;color:var(--text-3)">${escapeHTML(p.code)}</div>
              </td>
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
function renderCidades(){
  const q=(document.getElementById("search-city")?.value||"").toLowerCase();
  const uf=document.getElementById("fil-uf")?.value||"";
  const m={}, estados={};
  allOrders.forEach(o=>{
    // Tentar múltiplos campos de endereço do Bling
    const ci=(o.contato?.endereco?.municipio||o.contato?.endereco?.cidade||
               o.contato?.municipio||o.contato?.cidade||"").trim();
    const es=(o.contato?.endereco?.uf||o.contato?.endereco?.estado||
               o.contato?.uf||o.contato?.estado||"").toUpperCase().trim().slice(0,2);
    if(!ci) return;
    const k=ci+"|"+es;
    if(!m[k])m[k]={ci,es,total:0,peds:0,clis:new Set(),pedidos:[]};
    m[k].total+=val(o); m[k].peds++; m[k].clis.add(cliKey(o));
    // Acumular por estado
    if(es){ if(!estados[es])estados[es]={total:0,peds:0,clis:new Set()}; estados[es].total+=val(o); estados[es].peds++; estados[es].clis.add(cliKey(o)); }
  });
  // Popular select de UF
  const selUF=document.getElementById("fil-uf");
  const ufs=Object.keys(estados).sort();
  if(selUF && selUF.options.length<=1){
    ufs.forEach(u=>{ const op=document.createElement("option"); op.value=u; op.textContent=u; selUF.appendChild(op); });
  }
  let cids=Object.values(m).sort((a,b)=>b.total-a.total);
  if(uf) cids=cids.filter(c=>c.es===uf);
  if(q) cids=cids.filter(c=>c.ci.toLowerCase().includes(q)||c.es.toLowerCase().includes(q));
  const max=cids[0]?.total||1;
  document.getElementById("city-label").textContent=`${cids.length} cidade${cids.length!==1?"s":""} encontrada${cids.length!==1?"s":""}`;
  // Resumo por estado (quando sem filtro)
  let estadoHtml="";
  if(!uf && !q){
    const topEst=Object.entries(estados).sort((a,b)=>b[1].total-a[1].total).slice(0,8);
    const maxEst=topEst[0]?.[1]?.total||1;
    estadoHtml=`<div class="estado-card">
      <div class="estado-title">📍 RECEITA POR ESTADO</div>
      ${topEst.map(([est,d])=>`
        <div class="estado-row">
          <div class="estado-uf">${est}</div>
          <div class="estado-bar-track">
            <div class="estado-bar" data-pct="${Math.round(d.total/maxEst*100)}"></div>
          </div>
          <div class="estado-total">${fmtBRL(d.total)}</div>
          <div class="estado-clis">${d.clis.size} cli.</div>
        </div>`).join("")}
    </div>`;
  }
  const host = document.getElementById("city-table");
  if(!host) return;
  host.innerHTML=estadoHtml+
    (cids.length?cids.map((c,i)=>`
    <div class="cidade-row" data-ci="${escapeHTML(c.ci)}" data-uf="${escapeHTML(c.es||"")}" onclick="filterClientesByCity(this.dataset.ci,this.dataset.uf)">
      <div class="cidade-rank">${i+1}</div>
      <div class="cidade-info">
        <div class="cidade-name">${escapeHTML(c.ci)} <span class="cidade-uf-badge">${escapeHTML(c.es||"?")}</span></div>
        <div class="cidade-bar-track">
          <div class="cidade-bar" data-pct="${Math.round(c.total/max*100)}"></div>
        </div>
      </div>
      <div class="cidade-right">
        <div class="cidade-total">${fmtBRL(c.total)}</div>
        <div class="cidade-sub">${c.clis.size} cli. · ${c.peds} ped.</div>
      </div>
    </div>`).join(""):
    `<div class="empty">Nenhuma cidade encontrada.</div>`);

  host.querySelectorAll(".cidade-bar[data-pct], .estado-bar[data-pct]").forEach(el=>{
    const pct = parseFloat(el.getAttribute("data-pct")||"0");
    el.style.width = (isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0) + "%";
  });
}


function renderAlertas(){
  const ad=parseInt(document.getElementById("alert-days")?.value||"60");
  const inat=Object.values(buildCli(allOrders)).filter(c=>daysSince(c.last)>ad&&!isCNPJ(c.doc)).sort((a,b)=>daysSince(b.last)-daysSince(a.last));
  document.getElementById("alert-label").textContent=`${inat.length} cliente${inat.length!==1?"s":""} sem comprar há mais de ${ad} dias`;
  document.getElementById("alert-list").innerHTML=inat.length?inat.map((c,i)=>renderCliCard(c,"al"+i)).join(""):`<div class="empty">🎉 Nenhum cliente inativo por mais de ${ad} dias!</div>`;
}

// ═══════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════
function toast(m){ const e=document.getElementById("toast"); e.textContent=m; e.classList.add("show"); setTimeout(()=>e.classList.remove("show"),2500); }
function setSyncDot(on){
  const el = document.getElementById("sync-dot");
  if(!el) return;
  if(on) el.classList.remove("off");
  else el.classList.add("off");
}
let deferred;
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); deferred=e; document.getElementById("install-bar").style.display="flex"; });
function installApp(){ if(deferred){ deferred.prompt(); deferred.userChoice.then(()=>{ deferred=null; document.getElementById("install-bar").style.display="none"; }); } }



// ═══════════════════════════════════════════════════
//  SUPABASE COMPLETO
// ═══════════════════════════════════════════════════
supaClient = null;
supaConnected = false;
cliMetaCache = {};
tarefasCache = [];
canaisLookup = {}; // slug → uuid, carregado em loadSupabaseData()

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
  const key = String(customerKey||"");
  if(cliMetaCache?.[key]?.uuid) return cliMetaCache[key].uuid;
  if(!supaConnected || !supaClient) return null;

  const digits = key.replace(/\D/g,"");
  const isEmail = key.includes("@");
  try{
    if(digits.length===11 || digits.length===14){
      const {data} = await supaClient.from("v2_clientes").select("id,doc").eq("doc", digits).maybeSingle();
      if(data?.id){
        cliMetaCache[key] = cliMetaCache[key] || {};
        cliMetaCache[key].uuid = data.id;
        return data.id;
      }
    }
    if(isEmail){
      const em = key.trim().toLowerCase();
      const {data} = await supaClient.from("v2_clientes").select("id,email").ilike("email", em).maybeSingle();
      if(data?.id) return data.id;
    }
    if(digits.length>=10){
      const {data} = await supaClient.from("v2_clientes").select("id,telefone").eq("telefone", digits).maybeSingle();
      if(data?.id) return data.id;
    }
  }catch(_e){}
  return null;
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
    localStorage.setItem("crm_insumos", JSON.stringify(allInsumos));
    if(document.getElementById("page-producao")?.classList.contains("active")) {
      if(typeof window.renderInsumos === "function") window.renderInsumos();
      if(typeof window.renderProdKpis === "function") window.renderProdKpis();
    }
  }catch(_e){}
}

async function syncInsumosToSupabase(list){
  if(!supaConnected || !supaClient) return;
  if(!Array.isArray(list) || !list.length) return;
  try{
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
    for(let i=0;i<rows.length;i+=200){
      await supaClient.from("insumos").upsert(rows.slice(i,i+200), { onConflict: "id" });
    }
  }catch(_e){}
}

async function loadReceitasProdutosFromSupabase(){
  if(!supaConnected || !supaClient) return;
  try{
    const {data, error} = await supaClient
      .from("receitas_produtos")
      .select("id,produto_id,insumo_id,quantidade_por_unidade,unidade,updated_at")
      .limit(10000);
    if(error || !Array.isArray(data)) return;
    localStorage.setItem("crm_receitas_produtos", JSON.stringify(data));
    const prods = Array.from(new Set((data||[]).map(r=>String(r.produto_id||"").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
    if(prods.length) localStorage.setItem("crm_receitas_produtos_produtos", JSON.stringify(prods));
    if(document.getElementById("page-producao")?.classList.contains("active")) {
      if(typeof window.renderReceitaDetalhe === "function") window.renderReceitaDetalhe();
    }
  }catch(_e){}
}

async function syncReceitasToSupabase(list){
  if(!supaConnected || !supaClient) return;
  if(!Array.isArray(list) || !list.length) return;
  try{
    const rows = list.map(r=>({
      id: String(r.id),
      produto_id: r.produto_id || null,
      insumo_id: String(r.insumo_id||""),
      quantidade_por_unidade: Number(r.quantidade_por_unidade||0) || 0,
      unidade: r.unidade || "g",
      updated_at: new Date().toISOString()
    }));
    for(let i=0;i<rows.length;i+=500){
      await supaClient.from("receitas_produtos").upsert(rows.slice(i,i+500), { onConflict: "id" });
    }
  }catch(_e){}
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
    localStorage.setItem("crm_ordens_producao", JSON.stringify(allOrdens));
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
    localStorage.setItem("crm_movimentos_estoque", JSON.stringify(data));
    if(document.getElementById("page-producao")?.classList.contains("active")) {
      if(typeof window.renderMovimentosEstoque === "function") window.renderMovimentosEstoque();
    }
  }catch(_e){}
}

async function syncOrdensProducaoToSupabase(list){
  if(!supaConnected || !supaClient) return;
  if(!Array.isArray(list) || !list.length) return;
  try{
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
    for(let i=0;i<rowsWithCost.length;i+=200){
      const chunk = rowsWithCost.slice(i,i+200);
      const {error} = await supaClient.from("ordens_producao").upsert(chunk, { onConflict: "id" });
      if(error){
        const fallback = chunk.map(({custo_total_lote, ...rest})=>rest);
        await supaClient.from("ordens_producao").upsert(fallback, { onConflict: "id" });
      }
    }
  }catch(_e){}
}

async function logMovimentoEstoque(mov){
  if(!supaConnected || !supaClient) return;
  if(!mov || !mov.insumo_id || !mov.tipo) return;
  try{
    const payloadWithColumns = {
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
      await supaClient.from("movimentos_estoque").upsert(fallback, { onConflict: "ordem_id,insumo_id,tipo" });
    }
  }catch(_e){}
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
    if(!supaClient) supaClient = supabase.createClient(url, key);
    
    const { error } = await supaClient.from('configuracoes').select('chave').limit(1);
    
    if(error) throw error;

    supaConnected = true;
    if(st){ st.textContent="✓ Conectado"; st.className="setup-status s-ok"; }
    setSyncDot(true);
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
          return {...local, titulo:srv.titulo, desc:srv.descricao||'', prioridade:srv.prioridade||local.prioridade, status: srv.status==='aberta'?'pendente':srv.status, data:srv.vencimento||''};
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

    updateBadge();
    renderDash();
  }catch(e){ console.warn('loadSupabaseData:', e.message); }
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
  const candidates = [
    { table: "v2_canais", slug: "slug", id: "id" },
    { table: "canais", slug: "slug", id: "id" },
    { table: "canais", slug: "chave", id: "id" },
    { table: "canais_venda", slug: "slug", id: "id" },
    { table: "canais_venda", slug: "chave", id: "id" }
  ];
  for(let i=0;i<candidates.length;i++){
    const c = candidates[i];
    try{
      const {data, error} = await supaClient.from(c.table).select(`${c.id},${c.slug}`).limit(500);
      if(error || !Array.isArray(data) || !data.length) continue;
      const next = {};
      data.forEach(r=>{
        const slug = String(r?.[c.slug] || "").trim().toLowerCase();
        const id = r?.[c.id];
        if(slug && id) next[slug] = id;
      });
      if(Object.keys(next).length){
        canaisLookup = next;
        return;
      }
    }catch(_e){}
  }
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
  if(dataRaw) next.data = String(dataRaw).slice(0,10);

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
  const uf = (endereco.uf || endereco.estado || endereco.state || endereco.province || endereco.province_code || "").toString().toUpperCase().slice(0,2);
  const logradouro = endereco.logradouro || endereco.endereco || endereco.address1 || "";

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
      logradouro: String(logradouro || "")
    }
  };

  const itens = next.itens || next.items || next.produtos || next.products || next.line_items || [];
  if(Array.isArray(itens)){
    next.itens = itens.map(it=>({
      descricao: it?.descricao || it?.title || it?.nome || it?.name || it?.produto || "",
      codigo: it?.codigo || it?.sku || it?.id || "",
      quantidade: Number(it?.quantidade ?? it?.quantity ?? it?.qty ?? 1) || 1,
      valor: Number(it?.valor ?? it?.price ?? it?.preco ?? 0) || 0
    })).filter(it=>it.descricao || it.codigo);
  }else{
    next.itens = [];
  }

  next._canal = next._canal || String(next.canal || next.channel || "").toLowerCase();
  if(!next._canal){
    const d = detectCh(next);
    next._canal = d;
  }
  return next;
}

async function loadOrdersFromSupabaseForCRM(){
  if(!supaConnected || !supaClient) return;
  try{
    const {data:cliRows, error:cliErr} = await supaClient
      .from("v2_clientes")
      .select("id,nome,doc,email,telefone,cidade,uf")
      .limit(5000);
    if(cliErr) throw cliErr;
    const cliById = {};
    (cliRows||[]).forEach(c=>{ if(c?.id) cliById[c.id] = c; });

    const {data:pedRows, error:pedErr} = await supaClient
      .from("v2_pedidos")
      .select("*")
      .order("data_pedido",{ascending:false})
      .limit(5000);
    if(pedErr) throw pedErr;

    const {data:yampiRows, error:yampiErr} = await supaClient
      .from("yampi_orders")
      .select("*")
      .order("created_at",{ascending:false})
      .limit(5000);

    const nextBling = [];
    const nextYampi = [];

    (pedRows||[]).forEach(p=>{
      const cli = cliById[p.cliente_id] || null;
      const o = {
        id: String(p.bling_id || p.id || p.numero_pedido || ""),
        numero: String(p.numero_pedido || p.id || ""),
        data: String(p.data_pedido || p.created_at || "").slice(0,10),
        total: Number(p.total || 0) || 0,
        totalProdutos: Number(p.total || 0) || 0,
        situacao: { nome: p.status || "" },
        _source: String(p.source || "").toLowerCase() || "bling",
        _canal: (()=>{
          const inv = Object.entries(canaisLookup||{}).find(([,id])=>String(id)===String(p.canal_id));
          return inv ? inv[0] : "";
        })(),
        contato: {
          id: p.cliente_id || undefined,
          nome: cli?.nome || "Desconhecido",
          cpfCnpj: cli?.doc || "",
          email: cli?.email || "",
          telefone: cli?.telefone || "",
          endereco: { municipio: cli?.cidade || "", uf: cli?.uf || "" }
        },
        itens: Array.isArray(p.itens) ? p.itens : Array.isArray(p.items) ? p.items : []
      };
      const normalized = normalizeOrderForCRM(o, o._source);
      if(normalized._source === "yampi") nextYampi.push(normalized);
      else nextBling.push(normalized);
    });

    (yampiRows||[]).forEach(y=>{
      const o = {
        id: y.external_id,
        numero: y.external_id,
        data: String(y.created_at || "").slice(0,10),
        total: Number(y.total || 0),
        totalProdutos: Number(y.total || 0),
        situacao: { nome: y.status || "" },
        _source: "yampi",
        _canal: "yampi",
        contato: {
          nome: y.customer_name || "Cliente Yampi",
          email: y.customer_email || "",
          telefone: y.customer_phone || "",
          endereco: { municipio: y.city || "", uf: y.state || "" }
        },
        itens: Array.isArray(y.raw?.items) ? y.raw.items.map(it=>({
          descricao: it.name || it.product_name || "",
          codigo: it.sku || it.id || "",
          quantidade: Number(it.quantity || 1),
          valor: Number(it.price || 0)
        })) : []
      };
      const normalized = normalizeOrderForCRM(o, "yampi");
      // Evitar duplicidade se já veio de v2_pedidos (caso tenha sido processado por algum outro script)
      if(!nextYampi.some(existing => existing.id === normalized.id)){
        nextYampi.push(normalized);
      }
    });

    if(nextBling.length){
      blingOrders.length = 0;
      blingOrders.push(...nextBling);
      localStorage.setItem("crm_bling_orders", JSON.stringify(blingOrders));
    }
    if(nextYampi.length){
      yampiOrders.length = 0;
      yampiOrders.push(...nextYampi);
      localStorage.setItem("crm_yampi_orders", JSON.stringify(yampiOrders));
    }

    mergeOrders();
    populateUFs();
    renderAll();
  }catch(_e){}
}

async function sbSetConfig(chave, valor){
  if(!supaConnected || !supaClient) return;
  try{ await supaClient.from('configuracoes').upsert({chave, valor_texto: valor, updated_at: new Date().toISOString()}); }catch(e){}
}

async function upsertOrdersToSupabase(orders){
  if(!supaConnected || !supaClient || !orders.length) return;
  try{
    const cliMap = buildCli(orders);
    const cliRows = Object.values(cliMap).map(c => {
      const sc = calcCliScores(c);
      const docDigits = String(c.doc||"").replace(/\D/g,"");
      const docKey = docDigits.length===11 || docDigits.length===14 ? docDigits : "";
      const fallbackKey =
        (c.email && String(c.email).trim().toLowerCase()) ||
        (c.telefone && String(c.telefone).replace(/\D/g,"")) ||
        String(c.id||"");
      const telDigits = (c.telefone && String(c.telefone).replace(/\D/g,"")) || "";
      return { nome:c.nome, doc:c.doc, email: c.email ? String(c.email).trim().toLowerCase() : "", telefone: telDigits,
        cidade:c.cidade, uf:c.uf, primeiro_pedido:c.first, ultimo_pedido:c.last,
        total_pedidos:c.orders.length, total_gasto:sc.ltv, ltv:sc.ltv,
        ticket_medio: c.orders.length ? sc.ltv/c.orders.length : 0,
        intervalo_medio_dias:sc.avgInterval, score_recompra:sc.recompraScore,
        risco_churn:sc.churnRisk, status:sc.status,
        canal_principal:[...c.channels][0]||'outros',
        updated_at: new Date().toISOString() };
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
    // upsert por doc (chave natural) — preserva UUID existente
    for(let i=0; i<filteredCliRows.length; i+=50)
      await supaClient.from('v2_clientes').upsert(filteredCliRows.slice(i,i+50), {onConflict:'doc'});

    // Recarregar mapa doc→uuid após upsert de clientes
    const {data:cliRefresh} = await supaClient.from('v2_clientes').select('id,doc').limit(5000);
    const docToUuid = {};
    (cliRefresh||[]).forEach(c => { if(c.doc) docToUuid[c.doc] = c.id; });

    const pedRows = orders.map(o => {
      const docDigits = String(o.contato?.cpfCnpj||o.contato?.numeroDocumento||"").replace(/\D/g,"");
      const doc =
        (docDigits.length===11 || docDigits.length===14) ? docDigits :
        (o.contato?.email ? String(o.contato.email).trim().toLowerCase() : "") ||
        (o.contato?.telefone ? String(o.contato.telefone).replace(/\D/g,"") : "") ||
        String(o.contato?.nome||"");
      const canalSlug = detectCh(o);
      const canalId = canaisLookup[canalSlug] || canaisLookup["outros"] || null;
      return {
        bling_id: String(o.id||o.numero),
        numero_pedido: String(o.numero||o.id),
        cliente_id: docToUuid[doc] || null,
        canal_id: canalId,
        data_pedido: o.data,
        total: val(o),
        status: normSt(o.situacao),
        source: o._source||'bling',
        created_at: o.dataCriacao||o.data||new Date().toISOString()
      };
    }).filter(p => p.canal_id); // pedidos sem canal_id são descartados (NOT NULL constraint)
    for(let i=0; i<pedRows.length; i+=100)
      await supaClient.from('v2_pedidos').upsert(pedRows.slice(i,i+100), {onConflict:'numero_pedido'});
    toast('✓ Dados salvos no Supabase!');
  }catch(e){ console.warn('upsert:', e.message); }
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
  const itens = Array.isArray(o?.itens) ? o.itens : Array.isArray(o?.items) ? o.items : Array.isArray(o?.produtos) ? o.produtos : null;
  if(!itens || !itens.length) return "—";
  const getName = (it)=>String(it?.descricao || it?.title || it?.nome || it?.name || it?.produto || "").trim();
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

function getComPedidosBase(){
  const baseOrders = Array.isArray(yampiOrders) && yampiOrders.length ? yampiOrders : [];
  const orders = baseOrders.slice().sort((a,b)=>new Date(b.data || b.data_pedido || b.created_at || 0)-new Date(a.data || a.data_pedido || a.created_at || 0));
  return orders.map(o=>{
    const numRaw = o?.numero_pedido || o?.numero || o?.name || o?.order_number || o?.id || "";
    const num = numRaw ? (String(numRaw).startsWith("#") ? String(numRaw) : "#"+String(numRaw)) : "#—";
    const cliente = String(o?.contato?.nome || o?.customer?.name || o?.cliente?.nome || "—");
    const canal = String(o?._canal || o?.canal || o?.channel || detectCh(o) || "yampi").toLowerCase();
    const produto = summarizeOrderItems(o);
    const valor = Number(val(o) || o?.total || o?.total_price || 0) || 0;
    const data = String(o?.data_pedido || o?.data || o?.created_at || "").slice(0,10) || "—";
    const status = mapComStatusFromOrder(o);
    return { id: String(o?.id || numRaw || cryptoRandomId()), num, cliente, canal, produto, valor, status, data };
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
  var cC={shopee:'var(--shopee)',site:'var(--indigo-hi)',ml:'var(--ml)',whatsapp:'#25d366',instagram:'#e040fb'};
  var header='<div class="table-head table-head-com"><span>Pedido</span><span>Cliente / Produto</span><span>Canal</span><span class="ta-r">Valor</span><span class="ta-r">Status</span></div>';
  el.innerHTML=header+list.map(function(p){
    return '<div class="table-row table-row-com">'+
      '<div><div class="mono-link">'+escapeHTML(p.num)+'</div><div class="muted-xs">'+escapeHTML(p.data)+'</div></div>'+
      '<div><div class="row-title">'+escapeHTML(p.cliente)+'</div><div class="muted-sm">'+escapeHTML(p.produto)+'</div></div>'+
      '<div><span class="pill pill-soft" style="color:'+(cC[p.canal]||'var(--text-2)')+'">'+escapeHTML(String(p.canal||"").toUpperCase())+'</span></div>'+
      '<div class="ta-r mono-strong">R$'+p.valor.toFixed(2)+'</div>'+
      '<div class="ta-r"><span class="pill" style="background:'+stB[p.status]+';color:'+stC[p.status]+'">'+escapeHTML(stL[p.status]||p.status)+'</span></div>'+
    '</div>';
  }).join('');
}

function renderCanaisGrid(){
  var el=document.getElementById('canais-grid'); if(!el) return;
  var cI={shopee:{nome:'Shopee',emoji:'🟠',color:'var(--shopee)'},site:{nome:'Site Próprio',emoji:'🌐',color:'var(--indigo-hi)'},ml:{nome:'Mercado Livre',emoji:'🟡',color:'var(--ml)'},whatsapp:{nome:'WhatsApp',emoji:'💬',color:'#25d366'}};
  var por={};
  getComPedidosBase().forEach(function(p){ if(!por[p.canal]) por[p.canal]={qtd:0,receita:0}; por[p.canal].qtd++; por[p.canal].receita+=p.valor; });
  el.innerHTML=Object.entries(por).map(function(e){
    var canal=e[0],dados=e[1],info=cI[canal]||{nome:canal,emoji:'🔹',color:'var(--text-2)'};
    var ticket=dados.receita/dados.qtd;
    return '<div class="canal-card"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><div style="font-size:24px">'+info.emoji+'</div><div><div style="font-size:13px;font-weight:800">'+info.nome+'</div><div style="font-size:10px;color:var(--text-3)">'+dados.qtd+' pedidos</div></div></div><div style="font-size:22px;font-weight:800;font-family:var(--mono);color:'+info.color+';margin-bottom:8px">R$'+dados.receita.toLocaleString('pt-BR',{minimumFractionDigits:0})+'</div><div style="font-size:10px;color:var(--text-3)">Ticket médio: <b style="color:var(--text)">R$'+ticket.toFixed(2)+'</b></div></div>';
  }).join('');
}

function renderCampanhas(){
  var el=document.getElementById('campanhas-list'); if(!el) return;
  if(!allCampanhas.length){ el.innerHTML='<div class="empty">Nenhuma campanha cadastrada</div>'; return; }
  var stC={ativa:'cs-ativa',planejada:'cs-planejada',pausada:'cs-pausada',encerrada:'cs-encerrada'};
  var stL={ativa:'🟢 Ativa',planejada:'📋 Planejada',pausada:'⏸️ Pausada',encerrada:'🔴 Encerrada'};
  var tE={desconto:'🏷️',frete:'🚚',brinde:'🎁',kit:'📦',lancamento:'🚀'};
  el.innerHTML=[].concat(allCampanhas).reverse().map(function(c){
    return '<div class="campanha-card"><div><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:16px">'+(tE[c.tipo]||'📣')+'</span><div style="font-size:13px;font-weight:800">'+escapeHTML(c.nome)+'</div></div><div style="font-size:10px;color:var(--text-3);margin-bottom:8px">'+escapeHTML(c.inicio)+' → '+escapeHTML(c.fim)+' · '+escapeHTML(String(c.canal||"").toUpperCase())+' · '+escapeHTML(c.oferta)+'</div><div style="display:flex;gap:16px"><span style="font-size:10px;color:var(--text-3)">Budget: <b style="color:var(--text)">R$'+c.budget.toLocaleString('pt-BR')+'</b></span><span style="font-size:10px;color:var(--text-3)">Meta: <b style="color:var(--green)">R$'+c.meta.toLocaleString('pt-BR')+'</b></span></div></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px"><span class="camp-status '+stC[c.status]+'">'+escapeHTML(stL[c.status]||c.status)+'</span><button onclick="abrirModalCampanha('+c.id+')" style="background:none;border:1px solid var(--border);border-radius:var(--r-md);padding:4px 10px;color:var(--text-2);font-size:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Editar</button></div></div>';
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
            var resumo = itens.slice(0,3).map(function(it){ return String(it.nome||it.title||it.descricao||it.name||'').trim(); }).filter(Boolean).join(', ');
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
    document.getElementById('camp-inicio').value=c.inicio||'';
    document.getElementById('camp-fim').value=c.fim||'';
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
  var obj={id:id?parseInt(id):Date.now(),nome:document.getElementById('camp-nome').value.trim(),canal:document.getElementById('camp-canal').value,tipo:document.getElementById('camp-tipo').value,inicio:document.getElementById('camp-inicio').value,fim:document.getElementById('camp-fim').value,oferta:document.getElementById('camp-oferta').value.trim(),budget:parseFloat(document.getElementById('camp-budget').value)||0,meta:parseFloat(document.getElementById('camp-meta').value)||0,status:document.getElementById('camp-status').value,desc:document.getElementById('camp-desc').value.trim()};
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
    return '<div class="evento-card"><div class="evento-tipo-dot '+(tC[e.tipo]||'ev-evento')+'">'+(tE[e.tipo]||'📌')+'</div><div style="flex:1"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"><div style="font-size:13px;font-weight:700">'+escapeHTML(e.titulo)+'</div><button onclick="abrirModalEvento('+e.id+')" style="background:none;border:1px solid var(--border);border-radius:var(--r-md);padding:3px 10px;color:var(--text-2);font-size:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Editar</button></div><div style="font-size:10px;color:var(--text-3);margin-top:3px">'+escapeHTML(e.data)+' '+escapeHTML(e.hora)+' · '+escapeHTML(e.local)+' · '+escapeHTML(e.responsavel)+'</div>'+(e.amostras||e.conversoes||e.receita?'<div style="display:flex;gap:16px;margin-top:8px;font-size:10px;color:var(--text-3)">'+(e.amostras?'<span>🧪 '+e.amostras+' amostras</span>':'')+(e.conversoes?'<span style="color:var(--green)">✅ '+e.conversoes+' conv.</span>':'')+(e.receita?'<span style="color:var(--green);font-weight:700">R$'+e.receita.toLocaleString('pt-BR')+'</span>':'')+'</div>':'')+(e.obs?'<div style="font-size:10px;color:var(--text-2);margin-top:3px;font-style:italic">'+escapeHTML(e.obs)+'</div>':'')+'</div></div>';
  }).join('');
}

function renderDegustacoes(){
  var el=document.getElementById('degustacoes-list'); if(!el) return;
  var list=allEventos.filter(function(e){return e.tipo==='degustacao';});
  if(!list.length){ el.innerHTML='<div class="empty">Nenhuma degustação cadastrada</div>'; return; }
  el.innerHTML=list.map(function(e){
    var roi=e.custo>0?((e.receita-e.custo)/e.custo*100).toFixed(0):null;
    var taxa=e.amostras>0?Math.round(e.conversoes/e.amostras*100):0;
    return '<div class="degust-card"><div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px"><div><div style="font-size:13px;font-weight:700;margin-bottom:3px">'+escapeHTML(e.titulo)+'</div><div style="font-size:10px;color:var(--text-3)">'+escapeHTML(e.data)+' · '+escapeHTML(e.local)+' · '+escapeHTML(e.responsavel)+'</div></div><button onclick="abrirModalEvento('+e.id+')" style="background:none;border:1px solid var(--border);border-radius:var(--r-md);padding:3px 10px;color:var(--text-2);font-size:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Editar</button></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:8px;margin-top:12px">'+miniKpi('🧪 Amostras',e.amostras||0,'var(--blue)')+miniKpi('✅ Conversões',e.conversoes||0,'var(--green)')+miniKpi('📈 Conv.%',taxa+'%','var(--indigo-hi)')+miniKpi('💰 Custo','R$'+(e.custo||0),'var(--red)')+miniKpi('💵 Receita','R$'+(e.receita||0),'var(--green)')+(roi!==null?miniKpi('🚀 ROI',roi+'%',parseInt(roi)>=0?'var(--green)':'var(--red)'):'')+'</div>'+(e.obs?'<div style="font-size:11px;color:var(--text-2);margin-top:12px;padding-top:12px;border-top:1px solid var(--border-sub);font-style:italic">'+escapeHTML(e.obs)+'</div>':'')+'</div>';
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
    document.getElementById('ev-data').value=e.data||'';
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
  var obj={id:id?parseInt(id):Date.now(),titulo:document.getElementById('ev-titulo').value.trim(),tipo:document.getElementById('ev-tipo').value,data:document.getElementById('ev-data').value,hora:document.getElementById('ev-hora').value,local:document.getElementById('ev-local').value.trim(),responsavel:document.getElementById('ev-responsavel').value.trim(),custo:parseFloat(document.getElementById('ev-custo').value)||0,amostras:parseInt(document.getElementById('ev-amostras').value)||0,conversoes:parseInt(document.getElementById('ev-conversoes').value)||0,receita:parseFloat(document.getElementById('ev-receita').value)||0,obs:document.getElementById('ev-obs').value.trim()};
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
  var ctx=document.getElementById("chart-estoque"); if(!ctx) return;
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
  if(cCtx){
    if(window._chartComCanal) window._chartComCanal.destroy();
    var cData={};
    getComPedidosBase().forEach(function(p){ cData[p.canal]=(cData[p.canal]||0)+p.valor; });
    var sorted=Object.entries(cData).sort(function(a,b){return b[1]-a[1];});
    var cColors={shopee:"#f97316",site:"#6bbf3a",ml:"#f59e0b",whatsapp:"#25d366",instagram:"#e040fb"};
    window._chartComCanal=new Chart(cCtx,{
      type:"doughnut",
      data:{labels:sorted.map(function(e){return e[0].toUpperCase();}),
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
  if(sCtx){
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
  clienteAddCall,
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
  renderClientes,
  selectSegment,
  setChCli,
  renderOportunidades,
  addOpportunity,
  moveOppStage,
  renderProdutos,
  renderCidades,
  renderPedidosPage,
  recarregar,
  saveAlertDays,
  renderAlertas,
  saveSupabaseConfig,
  auditSupabaseSchema,
  syncInsumosToSupabase,
  syncReceitasToSupabase,
  syncOrdensProducaoToSupabase,
  logMovimentoEstoque,
  syncBling,
  syncYampi,
  syncCarrinhosAbandonadosYampi,
  renderCarrinhosAbandonados,
  openWhatsAppCarrinho,
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
  openWhatsAppForCustomer
});

window.handleLoginSubmit = handleLoginSubmit;
