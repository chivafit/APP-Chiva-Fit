import { allInsumos, getEstPct, getEstStatus } from "./producao.js";
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
  const label = document.getElementById("theme-label");
  if(icon) icon.textContent = isLight ? "☀️" : "🌙";
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
let shopifyOrders = safeJsonParse("crm_shopify_orders", []);
let allOrders = [];
let allCustomers = [];
let customerIntel = [];
let customerIntelligence = [];
let activeCh = "all";
let charts   = {};
let activeSegment = null;
let syncTimer = null;
let waPhone="", waName="";
let selectedUser="admin";
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
  integrations: { bling: blingOrders, shopify: shopifyOrders },
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
  [...blingOrders,...shopifyOrders].forEach(o=>{
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

    // Pedidos
    if(Array.isArray(data.pedidos)){
      const nextBling = data.pedidos.map(o => {
        o._source = "bling";
        o._canal  = detectCh(o);
        return o;
      });
      blingOrders.length = 0;
      blingOrders.push(...nextBling);
      localStorage.setItem("crm_bling_orders", JSON.stringify(blingOrders));
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
  if(errEl) errEl.textContent="";
  (async()=>{
    try{
      if(!email || !pass){
        if(errEl) errEl.textContent="Informe e-mail e senha.";
        return;
      }

      const ADMIN_EMAILS = new Set(["admin@chivafit.com","admin@chivafit.com.br","admin"]);
      const isAdmin = ADMIN_EMAILS.has(email);
      if(isAdmin && pass==="chiva2026"){
        localStorage.setItem(STORAGE_KEYS.loginFlag, "true");
        localStorage.setItem(STORAGE_KEYS.sessionEmail, email==="admin"?"admin@chivafit.com":email);
        enterApp(email==="admin"?"admin@chivafit.com":email);
        return;
      }
      const ok = await verifyAccessUser(email, pass);
      if(ok){
        localStorage.setItem(STORAGE_KEYS.loginFlag, "true");
        localStorage.setItem(STORAGE_KEYS.sessionEmail, email);
        enterApp(email);
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
  const loginEl = document.getElementById("login-screen");
  if(loginEl) loginEl.style.display="none";
  const shell = document.getElementById("app-shell");
  if(shell){
    shell.style.display="flex";
    shell.classList.add("visible");
  }
  const emojiEl = document.getElementById("user-emoji");
  if(emojiEl) emojiEl.textContent=(userEmail && userEmail !== "admin@chivafit.com") ? "👤" : "🛡️";
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
  const q = (document.getElementById("ped-search")||{value:""}).value.toLowerCase();
  const sf = (document.getElementById("ped-status-filter")||{value:""}).value.toLowerCase();
  let orders = allOrders;
  if(q) orders = orders.filter(o=>(o.numero_pedido||"").toLowerCase().includes(q) || (() => {const c=allCustomers.find(x=>x.id===o.cliente_id); return c&&(c.nome||"").toLowerCase().includes(q);})());
  if(sf) orders = orders.filter(o=>(o.status||"").toLowerCase()===sf);
  orders = orders.sort((a,b)=>new Date(b.data_pedido||0)-new Date(a.data_pedido||0));

  // KPIs
  const total = orders.reduce((s,o)=>s+(o.total||0),0);
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
      const c = allCustomers.find(x=>x.id===o.cliente_id);
      return `<div class="pedido-row" onclick="openPedidoDrawer('${o.id}')">
        <span class="pedido-num">#${escapeHTML(o.numero_pedido||o.id.slice(0,8))}</span>
        <span class="pedido-client">${escapeHTML(c?c.nome:"—")}<br><span class="pedido-date">${o.data_pedido?new Date(o.data_pedido).toLocaleDateString("pt-BR"):"—"}</span></span>
        <span class="pedido-canal">${escapeHTML(o.canal||o.canal_id||"—")}</span>
        <span class="pedido-val">${fmt(o.total)}</span>
        <span class="pedido-status"><span class="chiva-badge pedido-status-badge ${o.status==="atendido"?"chiva-badge-green":o.status==="cancelado"?"chiva-badge-red":"chiva-badge-amber"}">${escapeHTML(o.status||"—")}</span></span>
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
  const u = localStorage.getItem("crm_supa_url") || "";
  const k = localStorage.getItem("crm_supa_key") || "";
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
  const u = localStorage.getItem("crm_supa_url") || "";
  const k = localStorage.getItem("crm_supa_key") || "";

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
  if(!REFRESH||!CID||!CSEC) throw new Error("Refresh Token/Client ID/Secret necessários.");
  const b64=btoa(`${CID}:${CSEC}`);
  const url="https://corsproxy.io/?"+encodeURIComponent("https://api.bling.com.br/Api/v3/oauth/token");
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Authorization":"Basic "+b64},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(REFRESH)}`});
  if(!r.ok) throw new Error("Falha ao renovar token");
  const d=await r.json(); TOKEN=d.access_token; REFRESH=d.refresh_token||REFRESH; saveCreds();
  toast("🔄 Token renovado!");
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
    const nextBling = (data.orders||[]).map(o=>{ o._source="bling"; o._canal=detectCh(o); return o; });
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
  const navEl = document.getElementById("nav-"+id);
  if(navEl) navEl.classList.add("active");

  // Update topbar title
  const titles = {dashboard:"Dashboard",clientes:"Clientes",pedidos:"Pedidos",
    "pedidos-page":"Pedidos",cidades:"Cidades",produtos:"Produtos",tarefas:"Tarefas",
    oportunidades:"Oportunidades",alertas:"Alertas",ia:"IA & Insights",segmentos:"Segmentos",
    comercial:"Comercial",producao:"Produção",marca:"Marca",config:"Configurações"};
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
      `<div class="drawer-order-row" onclick="openClienteDrawer('${c.id}')">
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

function openTaskModal(id, cliente){
  const t = id ? allTasks.find(t=>t.id===id) : null;
  const html=`
    <div style="position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:500;display:flex;align-items:center;justify-content:center;padding:16px" id="task-modal-overlay">
      <div style="background:var(--surface);border-radius:16px;padding:20px;width:100%;max-width:400px;border:1px solid var(--border)">
        <div style="font-size:14px;font-weight:800;margin-bottom:14px">${t?"✏️ Editar":"➕ Nova"} Tarefa</div>
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
    +(shopifyOrders.length?`<span style="background:rgba(150,191,72,.1);border:1px solid rgba(150,191,72,.2);border-radius:7px;padding:3px 9px">🟢 Shopify: ${shopifyOrders.length}</span>`:"")
    +(!allOrders.length?`<span style="color:var(--text-3)">Nenhum dado — vá em ⚙️ Config</span>`:"");

  document.getElementById("dash-stats").innerHTML=[
    {l:"Volume Total",v:fmtBRL(total),s:"consolidado"},
    {l:"Este Mês",v:fmtBRL(tMo),s:`<span style="color:${delta>=0?"var(--green)":"var(--red)"}">${delta>=0?"▲":"▼"}${Math.abs(delta).toFixed(1)}%</span>`},
    {l:"Clientes",v:cliList.length,s:`${vipCount} VIPs`},
    {l:"Taxa Recompra",v:pctRec+"%",s:`${recorrentes} com 2+ pedidos`},
    {l:"Ticket Médio",v:fmtBRL(allOrders.length?total/allOrders.length:0),s:"por pedido"},
    {l:"Pedidos Total",v:allOrders.length,s:`${blingOrders.length}+${shopifyOrders.length}`},
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
    <div class="client-head" onclick="document.getElementById('${eid}').classList.toggle('open')">
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
  const now=new Date();
  const m={};
  allOrders
    .filter(o=>!ch||detectCh(o)===ch)
    .filter(o=>{ if(!per)return true; const d=new Date(o.data||o.dataPedido); return (now-d)/(86400000)<=per; })
    .forEach(o=>(o.itens||[]).forEach(it=>{
      const k=it.codigo||it.descricao||"?";
      if(!m[k])m[k]={nome:it.descricao||k,code:it.codigo||"",total:0,qty:0,peds:new Set(),clis:new Set()};
      m[k].total+=(parseFloat(it.valor)||0)*(parseFloat(it.quantidade)||1);
      m[k].qty+=parseFloat(it.quantidade)||1;
      m[k].peds.add(o.id||o.numero);
      m[k].clis.add(cliKey(o));
    }));
  let prods=Object.values(m).sort((a,b)=>b.total-a.total);
  if(q) prods=prods.filter(p=>p.nome.toLowerCase().includes(q)||p.code.toLowerCase().includes(q));
  document.getElementById("prod-label").textContent=`${prods.length} produto${prods.length!==1?"s/sabores":""}`;
  // Gráfico top 10
  const top10=prods.slice(0,10);
  if(charts.produtos) charts.produtos.destroy();
  const ctxP=document.getElementById("chart-produtos");
  if(ctxP && top10.length){
    charts.produtos=new Chart(ctxP,{type:"bar",data:{
      labels:top10.map(p=>p.nome.length>22?p.nome.slice(0,20)+"…":p.nome),
      datasets:[{
        data:top10.map(p=>p.total),
        backgroundColor:top10.map((_,i)=>{
          const alpha = 1 - i*0.07;
          return `rgba(107,191,58,${alpha.toFixed(2)})`;
        }),
        hoverBackgroundColor:'rgba(150,225,105,.95)',
        borderRadius:4,
        borderSkipped:false,
        borderWidth:0
      }]
    },options:{
      indexAxis:'y',
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'#0e1018',borderColor:'#1d2235',borderWidth:1,
          titleColor:'#edeef4',bodyColor:'#a0a8be',padding:10,
          callbacks:{label:ctx=>fmtBRL(ctx.raw)}
        }
      },
      scales:{
        x:{grid:{color:'rgba(255,255,255,.04)'},ticks:{color:'#585f78',font:{size:9},callback:v=>v>=1000?(v/1000).toFixed(0)+'k':v}},
        y:{grid:{display:false},ticks:{color:'#a0a8be',font:{size:10,weight:'600'}}}
      }
    }})
  }
  // Lista
  document.getElementById("prod-list").innerHTML=prods.length?prods.map((p,i)=>`
    <div class="prod-item" style="display:flex;align-items:center;gap:10px;background:var(--card);border-radius:10px;padding:10px 12px;margin-bottom:6px;border:1px solid var(--border)">
      <div style="font-size:18px;font-weight:900;color:var(--blue);width:24px;text-align:center">${i+1}</div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:700">${escapeHTML(p.nome)}</div>
        <div style="font-size:10px;color:var(--text-3)">${p.code?escapeHTML(p.code)+" · ":""}${p.clis.size} clientes · ${p.peds.size} pedidos</div>
        <div style="margin-top:4px;height:4px;background:var(--border);border-radius:4px">
          <div style="height:4px;background:var(--blue);border-radius:4px;width:${Math.round(p.total/prods[0].total*100)}%"></div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:13px;font-weight:800;color:var(--green)">${fmtBRL(p.total)}</div>
        <div style="font-size:10px;color:var(--text-3)">${p.qty.toLocaleString("pt-BR")} un</div>
      </div>
    </div>`).join(""):`<div class="empty">Nenhum produto encontrado.</div>`;
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

async function initSupabase(){
  try{
    if(supaConnected && supaClient) return true;
    const savedUrl =
      localStorage.getItem("supa_url") ||
      localStorage.getItem("crm_supa_url") ||
      localStorage.getItem("supabase_url") ||
      "";

    const savedKey =
      localStorage.getItem("supa_key") ||
      localStorage.getItem("crm_supa_key") ||
      localStorage.getItem("supabase_key") ||
      "";

    const inputUrl = document.getElementById("inp-supa-url")?.value?.trim() || "";
    const inputKey = document.getElementById("inp-supa-key")?.value?.trim() || "";

    const supabaseUrl = savedUrl || inputUrl;
    const supabaseKey = savedKey || inputKey;

    if(typeof supabase === 'undefined'){
      console.warn('Supabase SDK not loaded');
      supaConnected = false;
      setSyncDot(false);
      if (typeof updateSupabaseStatus === "function") {
        updateSupabaseStatus("SDK do Supabase não carregado.", "err");
      }
      return false;
    }

    if(!supabaseUrl || !supabaseKey){
      console.warn('Supabase init: URL/chave ausentes');
      supaConnected = false;
      setSyncDot(false);
      if (typeof updateSupabaseStatus === "function") {
        updateSupabaseStatus("Informe URL e chave pública do Supabase.", "err");
      }
      return false;
    }

    supaClient = supabase.createClient(supabaseUrl, supabaseKey);

    const {error} = await supaClient
      .from('configuracoes')
      .select('chave')
      .limit(1);

    if(!error){
      supaConnected = true;
      setSyncDot(true);

      if (typeof updateSupabaseStatus === "function") {
        updateSupabaseStatus("✓ Conectado ao Supabase", "ok");
      } else if (typeof toast === "function") {
        toast('🟣 Supabase conectado!');
      }

      await loadSupabaseData();

      if (typeof setupRealtimeSync === "function") {
        setupRealtimeSync();
      }
      return true;
    } else {
      console.warn('Supabase error:', error.message);
      supaConnected = false;
      setSyncDot(false);

      if (typeof updateSupabaseStatus === "function") {
        updateSupabaseStatus("Falha na conexão: " + error.message, "err");
      }
      return false;
    }
  }catch(e){
    console.warn('Supabase init failed:', e.message);
    supaConnected = false;
    setSyncDot(false);

    if (typeof updateSupabaseStatus === "function") {
      updateSupabaseStatus("Erro ao conectar: " + e.message, "err");
    }
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

    let loadedV2 = false;
    try{
      const {data:canais} = await supaClient.from('v2_canais').select('id,slug').limit(200);
      canaisLookup = {};
      const canalById = {};
      (canais||[]).forEach(r=>{
        const slug = String(r?.slug||"").trim();
        const id = r?.id;
        if(slug && id){
          canaisLookup[slug] = id;
          canalById[id] = slug;
        }
      });

      const {data:clientes} = await supaClient
        .from('v2_clientes')
        .select('id,doc,nome,email,telefone,cidade,uf,status_manual,notas')
        .limit(5000);
      const cliById = {};
      cliMetaCache = {};
      (clientes||[]).forEach(c=>{
        if(c?.id) cliById[c.id] = c;
        const key = c?.doc || c?.id;
        if(key){
          cliMetaCache[key] = {uuid: c.id, status: c.status_manual || null, notes: c.notas || ""};
        }
      });

      const {data:pedidos} = await supaClient
        .from('v2_pedidos')
        .select('id,numero_pedido,cliente_id,canal_id,data_pedido,total,status,source')
        .order('data_pedido',{ascending:false})
        .limit(10000);

      if(Array.isArray(pedidos) && pedidos.length){
        const nextOrders = pedidos.map(p=>{
          const c = p?.cliente_id ? cliById[p.cliente_id] : null;
          const canalSlug =
            (p?.canal_id && canalById[p.canal_id]) ||
            (typeof p?.canal === "string" ? p.canal : "") ||
            "outros";

          const nome = String(
            c?.nome ||
            p?.cliente_nome ||
            p?.nome_cliente ||
            ""
          ).trim();

          const doc = String(c?.doc || "").trim();
          const email = String(c?.email || "").trim();
          const telefone = String(c?.telefone || "").trim();
          const cidade = String(c?.cidade || "").trim();
          const uf = String(c?.uf || "").trim();

          return {
            _source: p?.source || "supabase",
            _canal: canalSlug,
            id: p?.id,
            numero: p?.numero_pedido || p?.id,
            data: p?.data_pedido || null,
            total: p?.total,
            totalProdutos: p?.total,
            situacao: {nome: p?.status || "outros"},
            contato: {
              nome: nome || "Desconhecido",
              cpfCnpj: doc,
              email,
              telefone,
              endereco: {municipio: cidade, uf}
            }
          };
        });

        blingOrders.length = 0;
        blingOrders.push(...nextOrders);
        localStorage.setItem("crm_bling_orders", JSON.stringify(blingOrders));
        mergeOrders();
        populateUFs();
        renderAll();
        loadedV2 = true;
      }
    }catch(e){
      console.warn('loadSupabaseData v2:', e.message);
    }

    updateBadge();
    if(!loadedV2) renderDash();
  }catch(e){ console.warn('loadSupabaseData:', e.message); }
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
      return { nome:c.nome, doc:c.doc, email:c.email, telefone:c.telefone,
        cidade:c.cidade, uf:c.uf, primeiro_pedido:c.first, ultimo_pedido:c.last,
        total_pedidos:c.orders.length, total_gasto:sc.ltv, ltv:sc.ltv,
        ticket_medio: c.orders.length ? sc.ltv/c.orders.length : 0,
        intervalo_medio_dias:sc.avgInterval, score_recompra:sc.recompraScore,
        risco_churn:sc.churnRisk, status:sc.status,
        canal_principal:[...c.channels][0]||'outros',
        updated_at: new Date().toISOString() };
    });
    // upsert por doc (chave natural) — preserva UUID existente
    for(let i=0; i<cliRows.length; i+=50)
      await supaClient.from('v2_clientes').upsert(cliRows.slice(i,i+50), {onConflict:'doc'});

    // Recarregar mapa doc→uuid após upsert de clientes
    const {data:cliRefresh} = await supaClient.from('v2_clientes').select('id,doc').limit(5000);
    const docToUuid = {};
    (cliRefresh||[]).forEach(c => { if(c.doc) docToUuid[c.doc] = c.id; });

    const pedRows = orders.map(o => {
      const doc = o.contato?.cpfCnpj||o.contato?.email||o.contato?.telefone||o.contato?.nome||'';
      const canalSlug = detectCh(o);
      return {
        bling_id: String(o.id||o.numero),
        numero_pedido: String(o.numero||o.id),
        cliente_id: docToUuid[doc] || null,
        canal_id: canaisLookup[canalSlug] || null,
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
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'v2_clientes'}, async()=>{
        const {data} = await supaClient.from('v2_clientes').select('id,doc,status_manual,notas').limit(5000);
        cliMetaCache = {};
        (data||[]).forEach(c=>{
          const key = c.doc || c.id;
          cliMetaCache[key]={uuid:c.id,status:c.status_manual||null,notes:c.notas||''};
        });
        toast('🔄 Dados sincronizados!');
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
let allComPedidos = safeJsonParse('crm_com_pedidos', null) || [
  {id:1,num:'#SPE-8821',cliente:'Maria Silva',canal:'shopee',produto:'Shake Chocolate 500g x2',valor:167.80,status:'enviado',data:'2025-03-22'},
  {id:2,num:'#SITE-0341',cliente:'João Ferreira',canal:'site',produto:'Shake Neutro 1kg',valor:219.90,status:'entregue',data:'2025-03-21'},
  {id:3,num:'#WPP-0092',cliente:'Ana Costa',canal:'whatsapp',produto:'Kit Shake Variedades x4',valor:335.60,status:'separando',data:'2025-03-23'},
  {id:4,num:'#SPE-8834',cliente:'Carlos Rocha',canal:'shopee',produto:'Shake Baunilha 500g',valor:89.90,status:'novo',data:'2025-03-23'},
  {id:5,num:'#ML-5521',cliente:'Lúcia Mendes',canal:'ml',produto:'Shake Morango 500g x2',valor:167.80,status:'enviado',data:'2025-03-22'},
];
function saveCampanhas(){ localStorage.setItem('crm_campanhas',JSON.stringify(allCampanhas)); }

function renderComKpis(){
  var el=document.getElementById('com-kpis'); if(!el) return;
  var receita=allComPedidos.reduce(function(s,p){return s+p.valor;},0);
  var ativas=allCampanhas.filter(function(c){return c.status==='ativa';}).length;
  var canais=[...new Set(allComPedidos.map(function(p){return p.canal;}))].length;
  el.innerHTML=kpiCard('Pedidos',allComPedidos.length,'no período','var(--text)')+kpiCard('Receita','R$'+receita.toLocaleString('pt-BR',{minimumFractionDigits:0}),'total','var(--green)')+kpiCard('Campanhas Ativas',ativas,'rodando','var(--indigo-hi)')+kpiCard('Canais',canais,'ativos','var(--amber)');
}

function renderComPedidos(){
  var el=document.getElementById('com-pedidos-list'); if(!el) return;
  var q=((document.getElementById('search-com')||{}).value||'').toLowerCase();
  var canal=(document.getElementById('fil-com-canal')||{}).value||'';
  var status=(document.getElementById('fil-com-status')||{}).value||'';
  var list=allComPedidos.filter(function(p){
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
  var header='<div style="display:grid;grid-template-columns:100px 1fr 90px 90px 100px;gap:12px;padding:8px 12px;font-size:9px;font-weight:800;color:var(--text-3);text-transform:uppercase;letter-spacing:.7px;background:var(--card);border-radius:var(--r-md);margin-bottom:8px"><span>Pedido</span><span>Cliente / Produto</span><span>Canal</span><span style="text-align:right">Valor</span><span style="text-align:right">Status</span></div>';
  el.innerHTML=header+list.map(function(p){
    return '<div class="com-pedido-row"><div><div style="font-size:10px;font-family:var(--mono);color:var(--indigo-hi);font-weight:600">'+escapeHTML(p.num)+'</div><div style="font-size:9px;color:var(--text-3);margin-top:1px">'+escapeHTML(p.data)+'</div></div><div><div style="font-size:12px;font-weight:600">'+escapeHTML(p.cliente)+'</div><div style="font-size:10px;color:var(--text-3);margin-top:1px">'+escapeHTML(p.produto)+'</div></div><div><span style="font-size:10px;font-weight:700;color:'+(cC[p.canal]||'var(--text-2)')+'">'+escapeHTML(String(p.canal||"").toUpperCase())+'</span></div><div style="text-align:right;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--green)">R$'+p.valor.toFixed(2)+'</div><div style="text-align:right"><span style="padding:3px 8px;border-radius:9999px;font-size:9px;font-weight:800;background:'+stB[p.status]+';color:'+stC[p.status]+'">'+escapeHTML(stL[p.status]||p.status)+'</span></div></div>';
  }).join('');
}

function renderCanaisGrid(){
  var el=document.getElementById('canais-grid'); if(!el) return;
  var cI={shopee:{nome:'Shopee',emoji:'🟠',color:'var(--shopee)'},site:{nome:'Site Próprio',emoji:'🌐',color:'var(--indigo-hi)'},ml:{nome:'Mercado Livre',emoji:'🟡',color:'var(--ml)'},whatsapp:{nome:'WhatsApp',emoji:'💬',color:'#25d366'}};
  var por={};
  allComPedidos.forEach(function(p){ if(!por[p.canal]) por[p.canal]={qtd:0,receita:0}; por[p.canal].qtd++; por[p.canal].receita+=p.valor; });
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

function setComTab(tab){
  ['pedidos','canais','campanhas'].forEach(function(t){
    var el=document.getElementById('com-tab-'+t);
    var btn=document.getElementById('ctab-'+t);
    if(el) el.style.display=t===tab?'':'none';
    if(btn) btn.classList.toggle('active-tab',t===tab);
  });
  if(tab==='pedidos'){ renderComPedidos(); setTimeout(renderChartsCom,100); }
  if(tab==='canais') renderCanaisGrid();
  if(tab==='campanhas') renderCampanhas();
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
    allComPedidos.forEach(function(p){ cData[p.canal]=(cData[p.canal]||0)+p.valor; });
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
    allComPedidos.forEach(function(p){ sData[p.status]=(sData[p.status]||0)+1; });
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
  renderClientes,
  selectSegment,
  setChCli,
  renderProdutos,
  renderCidades,
  renderPedidosPage,
  recarregar,
  saveAlertDays,
  renderAlertas,
  saveSupabaseConfig,
  syncBling,
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
