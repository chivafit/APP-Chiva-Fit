let customerIntelSyncTimer = null;

export function definirNextBestAction(cli){
  const dias = cli.dias_desde_ultima_compra ?? 9999;
  const total = cli.total_pedidos ?? 0;
  const valor = cli.valor_total ?? 0;
  const score = cli.score_final ?? 0;
  const intervalo = cli.intervalo_medio_recompra || null;

  let action = "nutrir_cliente";

  if(dias < 7){
    action = "nao_acionar";
  } else if(total === 1 && dias < 20){
    action = "nutrir_cliente";
  } else if(valor >= 300 || total >= 5){
    action = "tratamento_vip";
  } else if(score >= 85){
    action = "oferta_kit";
  } else if(total >= 3 && intervalo && intervalo <= 35){
    action = "oferecer_assinatura";
  } else if(intervalo && dias > intervalo * 1.5){
    action = "reativar_sem_desconto";
  } else if(intervalo && dias >= intervalo){
    action = "sugerir_recompra";
  } else if(score < 40 && total >= 2){
    action = "reativacao_com_cupom";
  } else {
    action = "nutrir_cliente";
  }

  const priority = {
    tratamento_vip:1,
    oferta_kit:2,
    oferecer_assinatura:3,
    sugerir_recompra:4,
    reativar_sem_desconto:5,
    reativacao_com_cupom:6,
    nutrir_cliente:7,
    nao_acionar:8
  }[action] ?? 99;

  return { next_best_action: action, action_priority: priority };
}

export function getTodaySalesActions(ctx){
  if(Array.isArray(ctx.customerIntelligence) && ctx.customerIntelligence.length){
    return [...ctx.customerIntelligence].sort((a,b)=>{
      const pa=a.action_priority??99; const pb=b.action_priority??99;
      if(pa!==pb) return pa-pb;
      return (b.score_final??0)-(a.score_final??0);
    }).slice(0,20);
  }
  if(Array.isArray(ctx.customerIntel) && ctx.customerIntel.length){
    return [...ctx.customerIntel].sort((a,b)=>{
      const pa=a.action_priority??99; const pb=b.action_priority??99;
      if(pa!==pb) return pa-pb;
      const ra=a.risco_churn??0; const rb=b.risco_churn??0;
      if(rb!==ra) return rb-ra;
      return (b.score_geral??0)-(a.score_geral??0);
    }).slice(0,20);
  }
  return [];
}

function clamp(n,min,max){
  const x=Number(n);
  if(Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function safeNum(v, fallback=0){
  const n=Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function todayKey(){
  const d=new Date();
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function getIADoneMap(){
  try{
    const key="crm_ia_done_"+todayKey();
    const raw=localStorage.getItem(key);
    if(!raw) return {key, map:{}};
    const parsed=JSON.parse(raw);
    if(!parsed || typeof parsed!=="object") return {key, map:{}};
    return {key, map:parsed};
  }catch(_e){
    return {key:"crm_ia_done_"+todayKey(), map:{}};
  }
}

function setIADone(clienteId, done){
  const cid=String(clienteId||"");
  const {key,map}=getIADoneMap();
  if(done) map[cid]=new Date().toISOString();
  else delete map[cid];
  try{ localStorage.setItem(key, JSON.stringify(map)); }catch(_e){}
}

function formatMoney(ctx, v){
  const n=safeNum(v,0);
  if(typeof ctx.fmtBRL==="function") return ctx.fmtBRL(n);
  return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0});
}

function normalizeIntelRow(ctx, row){
  if(!row || typeof row!=="object") return null;
  const cliente_id = row.cliente_id ?? row.cliente_uuid ?? row.id ?? row.cliente ?? "";
  const nome = row.nome ?? row.cliente_nome ?? "";
  const total_pedidos = row.total_pedidos ?? row.n_pedidos ?? 0;
  const valor_total = row.valor_total ?? row.ltv ?? 0;
  const ticket_medio = row.ticket_medio ?? (safeNum(valor_total,0) && safeNum(total_pedidos,0) ? (safeNum(valor_total,0)/Math.max(1,safeNum(total_pedidos,0))) : 0);
  const dias_desde_ultima_compra = row.dias_desde_ultima_compra ?? row.recencia_dias ?? null;
  const intervalo_medio_recompra = row.intervalo_medio_recompra ?? row.intervalo_recompra ?? null;
  const score = clamp(Math.round(row.score_final ?? row.score_geral ?? 0), 0, 100);
  const next_best_action = row.next_best_action ?? row.acao_recomendada ?? "";
  const action_priority = row.action_priority ?? row.prioridade ?? 99;
  const last_order_at = row.last_order_at ?? row.ultima_compra ?? row.last ?? null;
  const telefone = row.telefone ?? "";
  const segmento = row.segmento ?? "";
  const risco_churn = row.risco_churn ?? 0;
  const chance_recompra = row.chance_recompra ?? 0;
  return {
    ...row,
    cliente_id,
    nome,
    total_pedidos,
    valor_total,
    ticket_medio,
    dias_desde_ultima_compra,
    intervalo_medio_recompra,
    score_norm: score,
    next_best_action,
    action_priority,
    last_order_at,
    telefone,
    segmento,
    risco_churn,
    chance_recompra
  };
}

function scoreTier(score){
  const s=clamp(score,0,100);
  if(s>=85) return {id:"elite",label:"Elite",className:"tier-elite"};
  if(s>=70) return {id:"forte",label:"Forte",className:"tier-forte"};
  if(s>=50) return {id:"moderado",label:"Moderado",className:"tier-moderado"};
  return {id:"risco",label:"Risco",className:"tier-risco"};
}

function estimatePotential(intel){
  const ticket = safeNum(intel.ticket_medio,0) || 110;
  const action = intel.next_best_action || "";
  const mult90 = action==="oferecer_assinatura" ? 3
    : action==="tratamento_vip" ? 2
    : action==="oferta_kit" ? 1.5
    : 1;
  const potential_90d = Math.round(ticket * mult90);
  const potential_12m = action==="oferecer_assinatura" ? Math.round(ticket * 12) : null;
  return {ticket, potential_90d, potential_12m};
}

function isVipRow(intel){
  if(intel.segmento==="vip") return true;
  const action=intel.next_best_action||"";
  return action==="tratamento_vip" || safeNum(intel.valor_total,0)>=650 || intel.score_norm>=90;
}

function isRiskRow(intel){
  if(intel.segmento==="risco") return true;
  const action=intel.next_best_action||"";
  if(action==="reativar_sem_desconto" || action==="reativacao_com_cupom") return true;
  const dias=safeNum(intel.dias_desde_ultima_compra,0);
  const score=intel.score_norm;
  return dias>=61 && score<55;
}

function isRebuyRow(intel){
  if(intel.segmento==="recompra") return true;
  const action=intel.next_best_action||"";
  if(action==="sugerir_recompra" || action==="oferta_kit") return true;
  return safeNum(intel.chance_recompra,0)>=70;
}

function isSubscriptionRow(intel){
  const action=intel.next_best_action||"";
  if(action==="oferecer_assinatura") return true;
  const total=safeNum(intel.total_pedidos,0);
  const intervalo=safeNum(intel.intervalo_medio_recompra,0);
  return total>=3 && intervalo>0 && intervalo<=35;
}

function applyScoreRings(root){
  if(!root) return;
  root.querySelectorAll(".ia-score-ring[data-score]").forEach(el=>{
    const s=clamp(parseInt(el.getAttribute("data-score")||"0",10),0,100);
    el.style.setProperty("--pct", String(s/100));
    const tier=scoreTier(s);
    el.classList.remove("tier-elite","tier-forte","tier-moderado","tier-risco");
    el.classList.add(tier.className);
  });
}

const WHATSAPP_ACTION_TEMPLATES = {
  nutrir_cliente: ({firstName,favoriteProduct,totalPedidos,dias}) =>
    `Oi ${firstName}! Aqui é da Chiva Fit 💛 Passando só pra saber como você está e como foi sua experiência com nossos produtos${favoriteProduct?` (principalmente o ${favoriteProduct})`:""}. Você já fez ${totalPedidos} pedido(s) com a gente e faz cerca de ${dias} dia(s) desde a última compra – se eu puder ajudar com qualquer dúvida ou indicação é só me chamar por aqui.`,
  sugerir_recompra: ({firstName,favoriteProduct,dias}) =>
    `Oi ${firstName}! Notei que já faz cerca de ${dias} dia(s) desde sua última compra na Chiva Fit e queria saber como você está se sentindo com os produtos${favoriteProduct?` (especialmente o ${favoriteProduct})`:""}. Se estiver gostando, posso te mandar algumas sugestões pensando na sua rotina pra facilitar essa próxima recompra, sem pressa e sem compromisso.`,
  oferta_kit: ({firstName,favoriteProduct,totalPedidos}) =>
    `Oi ${firstName}! Aqui é da Chiva Fit 💛 Vi que você já comprou conosco ${totalPedidos} vez(es) e isso significa muito pra gente. Pensando no seu perfil${favoriteProduct?` e no quanto você gosta de ${favoriteProduct}`:""}, montei uma sugestão de kit especial pra manter sua rotina em alta performance. Se fizer sentido pra você, te explico rapidinho como funciona e ajusto tudo de acordo com o seu momento.`,
  oferecer_assinatura: ({firstName,favoriteProduct}) =>
    `Oi ${firstName}! Tudo bem? Percebi que você tem uma boa constância com a Chiva Fit${favoriteProduct?` e sempre volta no ${favoriteProduct}`:""}. Talvez faça sentido pra você um formato de reposição mais automático, pra não ficar sem. Posso te mostrar uma ideia de “assinatura leve”, sem burocracia, pra você avaliar se combina com a sua rotina?`,
  reativar_sem_desconto: ({firstName,favoriteProduct,dias}) =>
    `Oi ${firstName}! Aqui é da Chiva Fit 💛 Vi que já faz um tempo (cerca de ${dias} dia(s)) que você não compra com a gente e quis passar pra saber como você está e se ainda faz sentido a Chiva na sua rotina${favoriteProduct?` – lembro bastante de você com o ${favoriteProduct}`:""}. Se quiser, posso te mandar algumas sugestões atualizadas do que temos hoje, sem pressão nenhuma, só pra você conhecer as novidades.`,
  reativacao_com_cupom: ({firstName,favoriteProduct,dias}) =>
    `Oi ${firstName}! Aqui é da Chiva Fit 💛 Notei que já faz um bom tempo (por volta de ${dias} dia(s)) desde sua última compra${favoriteProduct?` – e lembro que você gostava bastante do ${favoriteProduct}`:""}. Se ainda fizer sentido pra você, preparei um cupom especial de retorno pra facilitar essa próxima experiência. Posso te explicar rapidinho como usar e sugerir algo alinhado ao seu momento hoje?`,
  tratamento_vip: ({firstName,favoriteProduct,totalPedidos,valorTotal}) =>
    `Oi ${firstName}! Passando pra te agradecer de coração pela confiança na Chiva Fit 💛 Você já fez ${totalPedidos} pedido(s) com a gente e isso representa muito (${valorTotal.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})} em compras). Gostaria de te tratar com carinho de cliente VIP${favoriteProduct?` e pensar algo especial envolvendo o ${favoriteProduct}`:""}. Se quiser, posso montar algumas sugestões exclusivas só pra você e te mandar por aqui.`
};

export function generateWhatsAppMessage(ctx, intel, rawCli){
  if(!intel) return "";
  const nomeBase = (rawCli?.nome || intel.nome || "").trim();
  const firstName = nomeBase.split(" ")[0] || "você";
  const pedidos = intel.total_pedidos ?? rawCli?.orders?.length ?? 0;
  const dias = intel.dias_desde_ultima_compra ?? (rawCli?.last ? ctx.daysSince(rawCli.last) : 0);
  const valorTotal = intel.valor_total ?? 0;

  let favoriteProduct = "";
  const prodMap = {};
  (rawCli?.orders||[]).forEach(o=>{
    (o.itens||[]).forEach(it=>{
      const k = it.descricao||it.codigo||"?";
      if(!prodMap[k]) prodMap[k]=0;
      prodMap[k]+=(parseFloat(it.valor)||0)*(parseFloat(it.quantidade)||1);
    });
  });
  const favEntry = Object.entries(prodMap).sort((a,b)=>b[1]-a[1])[0];
  if(favEntry && favEntry[0] !== "?") favoriteProduct = favEntry[0];

  const action = intel.next_best_action || "nutrir_cliente";
  const tpl = WHATSAPP_ACTION_TEMPLATES[action] || WHATSAPP_ACTION_TEMPLATES.nutrir_cliente;
  return tpl({
    firstName,
    favoriteProduct,
    totalPedidos: pedidos,
    dias,
    valorTotal,
    ticketMedio: intel.ticket_medio ?? 0
  });
}

function scheduleCustomerIntelligenceSync(ctx){
  if(!ctx.supaConnected || !ctx.supaClient) return;
  if(!Array.isArray(ctx.customerIntelligence) || !ctx.customerIntelligence.length) return;
  if(customerIntelSyncTimer) clearTimeout(customerIntelSyncTimer);
  customerIntelSyncTimer = setTimeout(()=>{
    customerIntelSyncTimer = null;
    upsertCustomerIntelligenceToSupabase(ctx, ctx.customerIntelligence).catch(e=>console.warn("customerIntel sync:", e.message));
  }, 5000);
}

async function upsertCustomerIntelligenceToSupabase(ctx, intel){
  if(!ctx.supaConnected || !ctx.supaClient || !Array.isArray(intel) || !intel.length) return;
  const isUuid = (v)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||"").trim());
  const isEmail = (v)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim());
  const onlyDigits = (v)=>String(v||"").replace(/\D/g,"");

  let cliRows = [];
  try{
    const {data, error} = await ctx.supaClient.from("v2_clientes").select("id,doc,email,telefone").limit(10000);
    if(!error && Array.isArray(data)) cliRows = data;
  }catch(_e){}
  const byDoc = {};
  const byEmail = {};
  const byPhone = {};
  (cliRows||[]).forEach(r=>{
    const id = r?.id;
    const doc = String(r?.doc||"").trim().toLowerCase();
    const email = String(r?.email||"").trim().toLowerCase();
    const phone = onlyDigits(r?.telefone||"");
    if(id && doc) byDoc[doc] = id;
    if(id && email) byEmail[email] = id;
    if(id && phone) byPhone[phone] = id;
  });

  const rows = intel.map(c=>{
    const rawId = String(c?.cliente_id||"").trim();
    let customerId = null;
    if(isUuid(rawId)) customerId = rawId;
    if(!customerId){
      const docDigits = onlyDigits(rawId);
      if(docDigits.length===11 || docDigits.length===14) customerId = byDoc[docDigits] || null;
    }
    if(!customerId && isEmail(rawId)) customerId = byEmail[rawId.toLowerCase()] || null;
    if(!customerId){
      const phoneDigits = onlyDigits(c?.telefone||"");
      if(phoneDigits.length>=10) customerId = byPhone[phoneDigits] || null;
    }
    if(!customerId) return null;
    return {
      cliente_id: customerId,
      nome: c.nome,
      total_pedidos: c.total_pedidos,
      valor_total: c.valor_total,
      ticket_medio: c.ticket_medio,
      dias_desde_ultima_compra: c.dias_desde_ultima_compra,
      intervalo_medio_recompra: c.intervalo_medio_recompra,
      score_final: c.score_final,
      next_best_action: c.next_best_action,
      action_priority: c.action_priority,
      last_order_at: c.last_order_at,
      last_whatsapp_at: c.last_whatsapp_at || null,
      updated_at: new Date().toISOString(),
      suggested_whatsapp_message: c.suggested_whatsapp_message || null
    };
  }).filter(Boolean);
  let mustFallback = false;
  if(rows.length){
    for(let i=0;i<rows.length;i+=100){
      const {error} = await ctx.supaClient.from("customer_intelligence").upsert(rows.slice(i,i+100),{onConflict:"cliente_id"});
      if(error){ mustFallback = true; break; }
    }
  }else{
    mustFallback = true;
  }
  if(mustFallback){
    const legacyRows = intel.map(c=>({
      cliente_id: c.cliente_id,
      nome: c.nome,
      total_pedidos: c.total_pedidos,
      valor_total: c.valor_total,
      ticket_medio: c.ticket_medio,
      dias_desde_ultima_compra: c.dias_desde_ultima_compra,
      intervalo_medio_recompra: c.intervalo_medio_recompra,
      score_final: c.score_final,
      next_best_action: c.next_best_action,
      action_priority: c.action_priority,
      last_order_at: c.last_order_at,
      last_whatsapp_at: c.last_whatsapp_at || null,
      updated_at: new Date().toISOString(),
      suggested_whatsapp_message: c.suggested_whatsapp_message || null
    }));
    for(let i=0;i<legacyRows.length;i+=100){
      await ctx.supaClient.from("customer_intelligence").upsert(legacyRows.slice(i,i+100),{onConflict:"cliente_id"});
    }
  }
}

export function computeCustomerIntelligence(ctx){
  if(!Array.isArray(ctx.allOrders)||!ctx.allOrders.length){
    ctx.customerIntelligence.length = 0;
    return;
  }
  const map = ctx.buildCli(ctx.allOrders);
  const result = [];

  Object.values(map).forEach(c=>{
    const pedidos = c.orders||[];
    const total_pedidos = pedidos.length;
    if(!total_pedidos) return;

    const valor_total = pedidos.reduce((s,o)=>s+ctx.val(o),0);
    const ticket_medio = total_pedidos ? valor_total/total_pedidos : 0;
    const dias_desde_ultima_compra = ctx.daysSince(c.last);

    let intervalo_medio_recompra = null;
    if(total_pedidos>=2){
      const datas = pedidos.map(o=>new Date(o.data)).filter(d=>!isNaN(d)).sort((a,b)=>a-b);
      if(datas.length>=2){
        const gaps = datas.slice(1).map((d,i)=>Math.floor((d - datas[i])/86400000));
        if(gaps.length){
          intervalo_medio_recompra = Math.round(gaps.reduce((s,g)=>s+g,0)/gaps.length);
        }
      }
    }

    let recenciaScore = 0;
    if(dias_desde_ultima_compra<=7) recenciaScore = 100;
    else if(dias_desde_ultima_compra<=30) recenciaScore = 80;
    else if(dias_desde_ultima_compra<=60) recenciaScore = 60;
    else if(dias_desde_ultima_compra<=90) recenciaScore = 40;
    else if(dias_desde_ultima_compra<=120) recenciaScore = 20;
    else recenciaScore = 0;

    let freqScore = 0;
    if(total_pedidos>=6) freqScore = 100;
    else if(total_pedidos===5) freqScore = 90;
    else if(total_pedidos===4) freqScore = 75;
    else if(total_pedidos===3) freqScore = 60;
    else if(total_pedidos===2) freqScore = 40;
    else if(total_pedidos===1) freqScore = 20;

    let valorScore = 0;
    if(valor_total>=1000) valorScore = 100;
    else if(valor_total>=650) valorScore = 85;
    else if(valor_total>=400) valorScore = 70;
    else if(valor_total>=250) valorScore = 55;
    else if(valor_total>=120) valorScore = 40;
    else if(valor_total>0) valorScore = 25;

    const score_final = Math.round(
      recenciaScore*0.4 +
      freqScore*0.3 +
      valorScore*0.3
    );

    const base = {
      cliente_id: c.id,
      nome: c.nome||String(c.id),
      total_pedidos,
      valor_total,
      ticket_medio,
      dias_desde_ultima_compra,
      intervalo_medio_recompra: intervalo_medio_recompra,
      score_final,
      last_order_at: c.last,
      telefone: c.telefone||""
    };

    const nba = definirNextBestAction(base);
    const withActions = {...base, ...nba};
    withActions.suggested_whatsapp_message = generateWhatsAppMessage(ctx, withActions, c);
    result.push(withActions);
  });

  ctx.customerIntelligence.length = 0;
  ctx.customerIntelligence.push(...result);
  scheduleCustomerIntelligenceSync(ctx);
}

export function formatNextBestAction(a){
  switch(a){
    case "tratamento_vip": return "Tratamento VIP";
    case "oferta_kit": return "Oferta de kit";
    case "oferecer_assinatura": return "Oferecer assinatura";
    case "sugerir_recompra": return "Sugerir recompra";
    case "reativar_sem_desconto": return "Reativar (sem desconto)";
    case "reativacao_com_cupom": return "Reativação com cupom";
    case "nutrir_cliente": return "Nutrir cliente";
    case "nao_acionar": return "Não acionar";
    default: return a||"-";
  }
}

export function renderIADashboard(ctx){
  const sumEl=document.getElementById("ia-summary");
  const riskEl=document.getElementById("ia-risk-list");
  const rebuyEl=document.getElementById("ia-rebuy-list");
  const vipEl=document.getElementById("ia-vip-list");
  const subEl=document.getElementById("ia-subscription-list");
  const potEl=document.getElementById("ia-potential-list");
  const todayEl=document.getElementById("ia-today-actions");
  const actEl=document.getElementById("ia-actions");
  if(!sumEl||!riskEl||!rebuyEl||!vipEl) return;

  const cardEls=[sumEl,riskEl,rebuyEl,vipEl,subEl,potEl,todayEl,actEl].filter(Boolean);
  cardEls.forEach(el=>{
    el.classList.add("ia-bento-card");
  });
  [sumEl,todayEl,actEl].filter(Boolean).forEach(el=>{
    el.classList.add("ia-ai-glow");
  });

  const intelList=Array.isArray(ctx.customerIntel)?ctx.customerIntel:[];
  const localList=Array.isArray(ctx.customerIntelligence)?ctx.customerIntelligence:[];
  const hasAnyData=!!(intelList.length||localList.length);
  const emptyState=(icon,title,desc)=>`
    <div class="modern-empty-state">
      <div class="mes-icon">${icon}</div>
      <div class="mes-title">${ctx.escapeHTML(title)}</div>
      <div class="mes-desc">${ctx.escapeHTML(desc)}</div>
    </div>`;

  if(!hasAnyData){
    sumEl.innerHTML=emptyState("🧠","Nenhum dado de inteligência ainda","Importe pedidos e rode a inteligência de clientes.");
    riskEl.innerHTML=""; rebuyEl.innerHTML=""; vipEl.innerHTML="";
    if(subEl) subEl.innerHTML="";
    if(potEl) potEl.innerHTML="";
    if(actEl) actEl.innerHTML="";
    if(todayEl) todayEl.innerHTML="";
    return;
  }

  const baseList=(localList.length ? localList : intelList).map(r=>normalizeIntelRow(ctx,r)).filter(Boolean);
  const total=baseList.length;
  const topActions=getTodaySalesActions(ctx).map(r=>normalizeIntelRow(ctx,r)).filter(Boolean);
  const doneInfo=getIADoneMap();
  const doneMap=doneInfo.map;
  const actionableToday=topActions.filter(c=>(c.next_best_action||"")!=="nao_acionar");
  const remainingToday=actionableToday.filter(c=>!doneMap[String(c.cliente_id||"")]);
  const pot90Today=actionableToday.reduce((s,c)=>s+estimatePotential(c).potential_90d,0);
  const pot90Pipeline=baseList.reduce((s,c)=>s+estimatePotential(c).potential_90d,0);

  const emRisco=baseList.filter(isRiskRow).sort((a,b)=>(a.action_priority??99)-(b.action_priority??99));
  const recompra=baseList.filter(isRebuyRow).sort((a,b)=>(a.action_priority??99)-(b.action_priority??99));
  const vips=baseList.filter(isVipRow).sort((a,b)=>(b.score_norm??0)-(a.score_norm??0));
  const assinatura=baseList.filter(isSubscriptionRow).sort((a,b)=>(a.action_priority??99)-(b.action_priority??99));

  const resolveCustomer=(cidRaw)=>{
    const cid=String(cidRaw||"");
    const digits=cid.replace(/\D/g,"");
    const byId=Array.isArray(ctx.allCustomers)?ctx.allCustomers.find(x=>String(x.id||"")===cid):null;
    if(byId) return byId;
    const byDoc=digits && Array.isArray(ctx.allCustomers)?ctx.allCustomers.find(x=>String(x.doc||"").replace(/\D/g,"")===digits):null;
    return byDoc || null;
  };

  const kpiCard=(label,value,accent)=>`
    <div class="ia-kpi-card ${accent||""}">
      <div class="ia-kpi-label">${ctx.escapeHTML(label)}</div>
      <div class="ia-kpi-value">${ctx.escapeHTML(String(value))}</div>
    </div>`;

  sumEl.innerHTML=`
    <div class="ia-bento-header">
      <div>
        <div class="ia-section-title">Centro de Comando Comercial</div>
        <div class="ia-section-subtitle">Priorize hoje, execute rápido e registre contato com base em score, ciclo e valor potencial.</div>
      </div>
      <div class="ia-bento-chip">Hoje • ${ctx.escapeHTML(String(remainingToday.length))} pendentes • ${ctx.escapeHTML(formatMoney(ctx, pot90Today))} potencial 90d</div>
    </div>
    <div class="ia-bento-kpis">
      ${kpiCard("Clientes analisados", total, "accent")}
      ${kpiCard("Prioritários hoje", actionableToday.length, "")}
      ${kpiCard("Pendentes hoje", remainingToday.length, "")}
      ${kpiCard("Em risco", emRisco.length, "")}
      ${kpiCard("Recompra", recompra.length, "")}
      ${kpiCard("Assinatura", assinatura.length, "")}
      ${kpiCard("Potencial 90d (pipeline)", formatMoney(ctx, pot90Pipeline), "")}
    </div>`;

  const miniList=(items, emptyIcon, emptyTitle, emptyDesc, rowBuilder)=>{
    if(!items.length) return emptyState(emptyIcon, emptyTitle, emptyDesc);
    return `<div class="ia-mini-list">${items.map(rowBuilder).join("")}</div>`;
  };

  riskEl.innerHTML=`
    <div class="ia-card-header">
      <div>
        <div class="ia-card-title">Clientes em risco</div>
        <div class="ia-card-subtitle">Recuperação: abordagem humana + oferta certa no timing.</div>
      </div>
    </div>
    ${miniList(
      emRisco.slice(0,15),
      "🛡️",
      "Sem riscos críticos",
      "Nenhum cliente em alto risco agora.",
      (c)=>{
        const cid=String(c.cliente_id||"");
        const cli=resolveCustomer(cid);
        const name=(cli?.nome||cid.slice(0,8)+"…");
        const dias=safeNum(c.dias_desde_ultima_compra ?? c.recencia_dias,0);
        const risk=Math.round(safeNum(c.risco_churn,0));
        const sub=`${dias}d sem comprar${risk?` • risco ${risk}%`:""}`;
        const cidAttr=ctx.escapeHTML(cid);
        const score=c.score_norm ?? 0;
        return `<div class="ia-mini-row">
          <div class="ia-mini-main">
            <div class="ia-mini-name"><span class="ia-score-pill ${scoreTier(score).className}">${ctx.escapeHTML(String(score))}</span> ${ctx.escapeHTML(name)}</div>
            <div class="ia-mini-meta">${ctx.escapeHTML(sub)}</div>
          </div>
          <div class="ia-mini-actions">
            <button type="button" class="ia-ghost-btn" data-ia-action="generate-variants" data-context="risco" data-cid="${cidAttr}">Gerar ação</button>
          </div>
        </div>`;
      }
    )}`;

  rebuyEl.innerHTML=`
    <div class="ia-card-header">
      <div>
        <div class="ia-card-title">Oportunidades de recompra</div>
        <div class="ia-card-subtitle">Maior probabilidade de conversão hoje.</div>
      </div>
    </div>
    ${miniList(
      recompra.slice(0,15),
      "⚡",
      "Nenhuma recompra quente",
      "Não há clientes com alta chance de recompra agora.",
      (c)=>{
        const cid=String(c.cliente_id||"");
        const cli=resolveCustomer(cid);
        const name=(cli?.nome||cid.slice(0,8)+"…");
        const chance=Math.round(safeNum(c.chance_recompra,0));
        const dias=safeNum(c.dias_desde_ultima_compra ?? c.recencia_dias,0);
        const pot=estimatePotential(c).potential_90d;
        const sub=`${dias}d • ${chance?`chance ${chance}% • `:""}potencial ${formatMoney(ctx,pot)}`;
        const cidAttr=ctx.escapeHTML(cid);
        const score=c.score_norm ?? 0;
        return `<div class="ia-mini-row">
          <div class="ia-mini-main">
            <div class="ia-mini-name"><span class="ia-score-pill ${scoreTier(score).className}">${ctx.escapeHTML(String(score))}</span> ${ctx.escapeHTML(name)}</div>
            <div class="ia-mini-meta">${ctx.escapeHTML(sub)}</div>
          </div>
          <div class="ia-mini-actions">
            <button type="button" class="ia-ghost-btn" data-ia-action="generate-variants" data-context="recompra" data-cid="${cidAttr}">Sugerir</button>
          </div>
        </div>`;
      }
    )}`;

  vipEl.innerHTML=`
    <div class="ia-card-header">
      <div>
        <div class="ia-card-title">Clientes VIP</div>
        <div class="ia-card-subtitle">Encantamento e aumento de LTV.</div>
      </div>
    </div>
    ${miniList(
      vips.slice(0,15),
      "💎",
      "Sem VIPs identificados",
      "Quando houver, aparecem aqui com prioridade máxima.",
      (c)=>{
        const cid=String(c.cliente_id||"");
        const cli=resolveCustomer(cid);
        const name=(cli?.nome||cid.slice(0,8)+"…");
        const ltv=safeNum(c.valor_total,0);
        const sub=`LTV ${formatMoney(ctx, ltv)}`;
        const cidAttr=ctx.escapeHTML(cid);
        const score=c.score_norm ?? 0;
        return `<div class="ia-mini-row">
          <div class="ia-mini-main">
            <div class="ia-mini-name"><span class="ia-score-pill ${scoreTier(score).className}">${ctx.escapeHTML(String(score))}</span> ${ctx.escapeHTML(name)}</div>
            <div class="ia-mini-meta">${ctx.escapeHTML(sub)}</div>
          </div>
          <div class="ia-mini-actions">
            <button type="button" class="ia-ghost-btn" data-ia-action="generate-variants" data-context="vip" data-cid="${cidAttr}">Reconhecer</button>
          </div>
        </div>`;
      }
    )}`;

  if(subEl){
    subEl.innerHTML=`
      <div class="ia-card-header">
        <div>
          <div class="ia-card-title">Oportunidades de assinatura</div>
          <div class="ia-card-subtitle">Clientes com ciclo previsível e 3+ pedidos.</div>
        </div>
      </div>
      ${miniList(
        assinatura.slice(0,15),
        "📦",
        "Sem oportunidades agora",
        "Quando houver consistência, aparecem aqui para oferta de reposição.",
        (c)=>{
          const cid=String(c.cliente_id||"");
          const cli=resolveCustomer(cid);
          const name=(cli?.nome||cid.slice(0,8)+"…");
          const intervalo=safeNum(c.intervalo_medio_recompra,0);
          const p=estimatePotential({...c,next_best_action:"oferecer_assinatura"});
          const sub=`intervalo ${intervalo?`${intervalo}d`:"-"} • potencial ${formatMoney(ctx,p.potential_12m||0)}/ano`;
          const cidAttr=ctx.escapeHTML(cid);
          const score=c.score_norm ?? 0;
          return `<div class="ia-mini-row">
            <div class="ia-mini-main">
              <div class="ia-mini-name"><span class="ia-score-pill ${scoreTier(score).className}">${ctx.escapeHTML(String(score))}</span> ${ctx.escapeHTML(name)}</div>
              <div class="ia-mini-meta">${ctx.escapeHTML(sub)}</div>
            </div>
            <div class="ia-mini-actions">
              <button type="button" class="ia-ghost-btn" data-ia-action="generate-variants" data-context="assinatura" data-cid="${cidAttr}">Oferecer</button>
            </div>
          </div>`;
        }
      )}`;
  }

  if(potEl){
    const topByPot=[...baseList].map(c=>{
      const p=estimatePotential(c);
      return {...c, __pot90:p.potential_90d};
    }).sort((a,b)=>(b.__pot90||0)-(a.__pot90||0)).slice(0,15);
    potEl.innerHTML=`
      <div class="ia-card-header">
        <div>
          <div class="ia-card-title">Valor potencial</div>
          <div class="ia-card-subtitle">Estimativa rápida baseada em ticket e ação recomendada.</div>
        </div>
      </div>
      ${miniList(
        topByPot,
        "🧮",
        "Sem potencial calculável",
        "Importe pedidos para estimar ticket e oportunidades.",
        (c)=>{
          const cid=String(c.cliente_id||"");
          const cli=resolveCustomer(cid);
          const name=(cli?.nome||cid.slice(0,8)+"…");
          const actionLabel=formatNextBestAction(c.next_best_action||"");
          const sub=`90d ${formatMoney(ctx,c.__pot90||0)} • ${actionLabel}`;
          const cidAttr=ctx.escapeHTML(cid);
          const score=c.score_norm ?? 0;
          const ctxType=isRiskRow(c)?"risco":isSubscriptionRow(c)?"assinatura":isVipRow(c)?"vip":"recompra";
          return `<div class="ia-mini-row">
            <div class="ia-mini-main">
              <div class="ia-mini-name"><span class="ia-score-pill ${scoreTier(score).className}">${ctx.escapeHTML(String(score))}</span> ${ctx.escapeHTML(name)}</div>
              <div class="ia-mini-meta">${ctx.escapeHTML(sub)}</div>
            </div>
            <div class="ia-mini-actions">
              <button type="button" class="ia-ghost-btn" data-ia-action="open-console" data-context="${ctx.escapeHTML(ctxType)}" data-cid="${cidAttr}">Detalhar</button>
            </div>
          </div>`;
        }
      )}`;
  }

  if(todayEl){
    if(!topActions.length){
      todayEl.innerHTML=`
        <div class="ia-card-header">
          <div>
            <div class="ia-card-title">Clientes prioritários do dia</div>
            <div class="ia-card-subtitle">Lista diária para WhatsApp com score, potencial e ação.</div>
          </div>
        </div>
        ${emptyState("📡","Sem ações hoje","Nenhuma ação recomendada para hoje.")}
      `;
    }else{
      todayEl.innerHTML=`
        <div class="ia-card-header">
          <div>
            <div class="ia-card-title">Clientes prioritários do dia</div>
            <div class="ia-card-subtitle">Abra o painel, gere variações e marque como feito.</div>
          </div>
          <div class="ia-today-pill">${ctx.escapeHTML(String(Object.keys(doneMap).length))} feitos • ${ctx.escapeHTML(String(remainingToday.length))} pendentes</div>
        </div>
        <div class="ia-modern-list">
          <div class="ia-list-header">
            <div class="col-nome">Cliente</div>
            <div class="col-score">Score</div>
            <div class="col-pot">Potencial</div>
            <div class="col-ped">Pedidos</div>
            <div class="col-last">Última compra</div>
            <div class="col-acao">Ação</div>
            <div class="col-actions">Ações</div>
          </div>
          ${topActions.map(c=>{
            const cid=String(c.cliente_id||"");
            const cidAttr=ctx.escapeHTML(cid);
            const nome=c.nome || (resolveCustomer(cid)?.nome) || cid.slice(0,8)+"…";
            const score=c.score_norm ?? 0;
            const pedidos=(c.total_pedidos ?? c.n_pedidos ?? 0);
            const last=c.last_order_at || c.ultima_compra || null;
            const lastStr=last ? new Date(last).toLocaleDateString("pt-BR") : "-";
            const action=c.next_best_action || c.acao_recomendada || "";
            const actionLabel=formatNextBestAction(action);
            const pot=estimatePotential(c).potential_90d;
            const isDone=!!doneMap[cid];
            const ctxType=isRiskRow(c)?"risco":isSubscriptionRow(c)?"assinatura":isVipRow(c)?"vip":"recompra";
            return `<div class="ia-list-row ${isDone?"is-done":""}">
              <div class="col-nome">
                <div class="ia-row-title">${ctx.escapeHTML(nome)}</div>
                <div class="ia-row-sub">${ctx.escapeHTML(cid.slice(0,8))}…</div>
              </div>
              <div class="col-score"><div class="ia-score-ring" data-score="${ctx.escapeHTML(String(score))}"><div class="ia-score-ring-inner"><div class="ia-score-num">${ctx.escapeHTML(String(score))}</div><div class="ia-score-lbl">${ctx.escapeHTML(scoreTier(score).label)}</div></div></div></div>
              <div class="col-pot"><span class="ia-chip-mono">${ctx.escapeHTML(formatMoney(ctx, pot))}</span></div>
              <div class="col-ped"><span class="ia-chip-mono">${ctx.escapeHTML(String(pedidos))}</span></div>
              <div class="col-last"><span class="ia-chip">${ctx.escapeHTML(lastStr)}</span></div>
              <div class="col-acao"><span class="ia-chip">${ctx.escapeHTML(actionLabel)}</span></div>
              <div class="col-actions">
                <button type="button" class="ia-ghost-btn" data-ia-action="open-console" data-context="${ctx.escapeHTML(ctxType)}" data-cid="${cidAttr}">Painel</button>
                <button type="button" class="ia-ghost-btn" data-ia-action="generate-variants" data-context="${ctx.escapeHTML(ctxType)}" data-cid="${cidAttr}">Variações</button>
                <button type="button" class="ia-ghost-btn" data-ia-action="toggle-done" data-done="${isDone?"1":"0"}" data-cid="${cidAttr}">${isDone?"Desfazer":"Feito"}</button>
              </div>
            </div>`;
          }).join("")}
        </div>
      `;
    }
  }

  if(actEl){
    actEl.innerHTML=`
      <div class="ia-card-header">
        <div>
          <div class="ia-card-title">Painel de execução</div>
          <div class="ia-card-subtitle">Abra um cliente, gere variações e envie pelo WhatsApp com 1 clique.</div>
        </div>
      </div>
      ${emptyState("🛰️","Selecione um cliente","Use “Painel” ou “Variações” na lista do dia para operar de forma prática.")}
    `;
  }

  bindCommandCenterHandlers(ctx);
  applyScoreRings(sumEl);
  applyScoreRings(riskEl);
  applyScoreRings(rebuyEl);
  applyScoreRings(vipEl);
  if(subEl) applyScoreRings(subEl);
  if(potEl) applyScoreRings(potEl);
  if(todayEl) applyScoreRings(todayEl);
}

function bindCommandCenterHandlers(ctx){
  const pageEl=document.getElementById("page-ia");
  const actEl=document.getElementById("ia-actions");
  if(pageEl && !pageEl.dataset.iaCmdBound){
    pageEl.dataset.iaCmdBound="1";
    pageEl.addEventListener("click",(ev)=>{
      const btn=ev.target && ev.target.closest ? ev.target.closest("[data-ia-action]") : null;
      if(!btn) return;
      const action=btn.getAttribute("data-ia-action")||"";
      const cid=btn.getAttribute("data-cid")||"";
      if(action==="toggle-done"){
        const isDone=(btn.getAttribute("data-done")||"0")==="1";
        setIADone(cid, !isDone);
        if(btn.closest && btn.closest("#ia-actions")){
          btn.setAttribute("data-done", isDone ? "0" : "1");
          btn.textContent = isDone ? "Marcar feito" : "Desfazer";
          ctx.toast(isDone ? "↩ Ação desfeita" : "✓ Marcado como feito");
          return;
        }
        renderIADashboard(ctx);
        return;
      }
      if(action==="open-console"){
        const ctxType=btn.getAttribute("data-context")||"recompra";
        renderActionConsole(ctx, cid, ctxType, {autoGenerate:false});
        return;
      }
      if(action==="generate-variants"){
        const ctxType=btn.getAttribute("data-context")||"recompra";
        gerarMensagemIA(ctx, cid, ctxType);
        return;
      }
    });
  }
  if(actEl && !actEl.dataset.iaCmdBound){
    actEl.dataset.iaCmdBound="1";
    actEl.addEventListener("click",(ev)=>{
      const btn=ev.target && ev.target.closest ? ev.target.closest("[data-ia-action]") : null;
      if(!btn) return;
      const action=btn.getAttribute("data-ia-action")||"";
      const cid=btn.getAttribute("data-cid")||"";
      if(action==="copy-target" || action==="wa-target"){
        const sel=btn.getAttribute("data-target")||"";
        const ta=sel ? document.querySelector(sel) : null;
        const text=(ta && "value" in ta ? ta.value : "") || "";
        if(!text){ ctx.toast("⚠ Nada para copiar"); return; }
        if(action==="copy-target"){
          if(navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(text).then(()=>ctx.toast("📋 Copiado!")).catch(()=>{ prompt("Copie a mensagem abaixo:", text); });
          }else{
            prompt("Copie a mensagem abaixo:", text);
          }
          return;
        }
        openWhatsAppForCustomerWithText(ctx, cid, text);
        return;
      }
      if(action==="regen"){
        const ctxType=btn.getAttribute("data-context")||"recompra";
        gerarMensagemIA(ctx, cid, ctxType);
        return;
      }
    });
  }
}

function extractFirstJsonObject(text){
  const s=String(text||"").trim();
  if(!s) return null;
  const start=s.indexOf("{");
  const end=s.lastIndexOf("}");
  if(start<0 || end<0 || end<=start) return null;
  const candidate=s.slice(start,end+1);
  try{ return JSON.parse(candidate); }catch(_e){ return null; }
}

function parseCommercialAIResponse(data){
  if(!data) return null;
  if(typeof data==="object" && data.mensagens && Array.isArray(data.mensagens)) return data;
  const txt=typeof data==="object" ? (data.text||"") : String(data||"");
  const json=extractFirstJsonObject(txt);
  if(json && json.mensagens && Array.isArray(json.mensagens)) return json;
  const lines=String(txt||"").split("\n").map(l=>l.trim()).filter(Boolean);
  if(!lines.length) return null;
  const msgs=[];
  let cur=null;
  lines.forEach(l=>{
    const m=l.match(/^(?:\d+[\)\.\-]|[-•])\s*(.+)$/);
    if(m){
      if(cur && cur.texto) msgs.push(cur);
      cur={titulo:"Mensagem",texto:m[1],objetivo:"",tom:""};
    }else if(cur){
      cur.texto=(cur.texto?cur.texto+"\n":"")+l;
    }
  });
  if(cur && cur.texto) msgs.push(cur);
  if(!msgs.length) return null;
  return {diagnostico:[],acao_recomendada:"",valor_potencial_estimado:null,mensagens:msgs.slice(0,5)};
}

function renderActionConsole(ctx, clienteId, contextoTipo, opts){
  const actEl=document.getElementById("ia-actions");
  if(!actEl) return null;
  const cid=String(clienteId||"");
  const intelRaw = (ctx.customerIntelligence.find(c=>String(c.cliente_id)===cid)
    || ctx.customerIntel.find(c=>String(c.cliente_id)===cid));
  if(!intelRaw){
    actEl.innerHTML=`<div class="ia-error">⚠ Cliente não encontrado</div>`;
    return null;
  }
  const intel=normalizeIntelRow(ctx,intelRaw);
  const cliMap = ctx.buildCli(ctx.allOrders);
  const rawCli = cliMap[intel.cliente_id] || null;
  const nome = intel.nome || rawCli?.nome || cid.slice(0,8)+"…";
  const actionLabel=formatNextBestAction(intel.next_best_action||"");
  const score=intel.score_norm ?? 0;
  const p=estimatePotential(intel);
  const baseMsg = (intel.suggested_whatsapp_message || generateWhatsAppMessage(ctx, intel, rawCli) || "").trim();
  const doneMap=getIADoneMap().map;
  const isDone=!!doneMap[cid];
  const safeCid=ctx.escapeHTML(cid);
  const safeCtx=ctx.escapeHTML(contextoTipo||"recompra");
  actEl.innerHTML=`
    <div class="ia-console">
      <div class="ia-console-top">
        <div class="ia-console-title">
          <div class="ia-console-name">${ctx.escapeHTML(nome)}</div>
          <div class="ia-console-meta">
            <div class="ia-score-ring sm" data-score="${ctx.escapeHTML(String(score))}">
              <div class="ia-score-ring-inner">
                <div class="ia-score-num">${ctx.escapeHTML(String(score))}</div>
              </div>
            </div>
            <span class="ia-chip">${ctx.escapeHTML(actionLabel)}</span>
            <span class="ia-chip">Potencial 90d: ${ctx.escapeHTML(formatMoney(ctx, p.potential_90d))}</span>
            ${p.potential_12m?`<span class="ia-chip">Potencial 12m: ${ctx.escapeHTML(formatMoney(ctx, p.potential_12m))}</span>`:""}
          </div>
        </div>
        <div class="ia-console-ctas">
          <button type="button" class="ia-ghost-btn" data-ia-action="toggle-done" data-done="${isDone?"1":"0"}" data-cid="${safeCid}">${isDone?"Desfazer":"Marcar feito"}</button>
          <button type="button" class="ia-ghost-btn primary" data-ia-action="regen" data-context="${safeCtx}" data-cid="${safeCid}">Gerar variações IA</button>
        </div>
      </div>
      <div class="ia-console-grid">
        <div class="ia-msg-card">
          <div class="ia-msg-card-hdr">
            <div class="ia-msg-title">Mensagem base</div>
            <div class="ia-msg-actions">
              <button type="button" class="ia-ghost-btn" data-ia-action="copy-target" data-target="#ia-base-msg" data-cid="${safeCid}">Copiar</button>
              <button type="button" class="ia-ghost-btn primary" data-ia-action="wa-target" data-target="#ia-base-msg" data-cid="${safeCid}">WhatsApp</button>
            </div>
          </div>
          <div class="ia-msg-body">
            <textarea class="ia-msg-textarea" id="ia-base-msg" readonly>${ctx.escapeHTML(baseMsg||"")}</textarea>
          </div>
        </div>
        <div class="ia-msg-card">
          <div class="ia-msg-card-hdr">
            <div>
              <div class="ia-msg-title">Variações (IA)</div>
              <div class="ia-msg-sub">Contexto: ${ctx.escapeHTML(String(contextoTipo||"recompra"))}</div>
            </div>
          </div>
          <div class="ia-msg-body" id="ia-ai-variants">
            <div class="ai-thinking"><div class="ai-dots"><span></span><span></span><span></span></div>Pronto para gerar variações.</div>
          </div>
        </div>
      </div>
    </div>
  `;
  applyScoreRings(actEl);
  if(opts && opts.autoGenerate) gerarMensagemIA(ctx, cid, contextoTipo);
  return {intel, rawCli};
}

function openWhatsAppForCustomerWithText(ctx, clienteId, text){
  const cid=String(clienteId||"");
  const intelRaw = (ctx.customerIntelligence.find(c=>String(c.cliente_id)===cid)
    || ctx.customerIntel.find(c=>String(c.cliente_id)===cid));
  if(!intelRaw){ ctx.toast("⚠ Cliente não encontrado para WhatsApp"); return; }
  const intel=normalizeIntelRow(ctx,intelRaw);
  const cliMap = ctx.buildCli(ctx.allOrders);
  const raw = cliMap[intel.cliente_id] || null;
  const phone = intel.telefone || raw?.telefone || "";
  const url = normalizeBrazilPhone(phone);
  if(!url){ ctx.toast("⚠ Telefone inválido ou ausente para este cliente"); return; }
  const msg = String(text||"").trim();
  const fullUrl = msg ? (url+"?text="+encodeURIComponent(msg)) : url;
  window.open(fullUrl,"_blank","noopener");
  const nowIso = new Date().toISOString();
  try{ intelRaw.last_whatsapp_at = nowIso; }catch(_e){}
  const idx = ctx.customerIntelligence.findIndex(c=>String(c.cliente_id)===cid);
  if(idx>=0){
    ctx.customerIntelligence[idx].last_whatsapp_at = nowIso;
    scheduleCustomerIntelligenceSync(ctx);
  }
  setIADone(cid, true);
  if(typeof ctx.renderIADashboard === "function") ctx.renderIADashboard();
}

export async function gerarMensagemIA(ctx, clienteId, contextoTipo){
  const cid=String(clienteId||"");
  const intelRaw = (ctx.customerIntelligence.find(c=>String(c.cliente_id)===cid)
    || ctx.customerIntel.find(c=>String(c.cliente_id)===cid));
  if(!intelRaw){ ctx.toast("⚠ Cliente não encontrado na inteligência"); return; }
  const intel=normalizeIntelRow(ctx,intelRaw);
  const cliMap = ctx.buildCli(ctx.allOrders);
  const rawCli = cliMap[intel.cliente_id] || null;
  const pedidosCli=ctx.allOrders.filter(o=>String(o.cliente_id||o.cliente_uuid||ctx.cliKey(o))===cid).slice(0,30);
  const contexto={tipo:contextoTipo,inteligencia:intel,pedidos_recentes:pedidosCli};

  renderActionConsole(ctx, cid, contextoTipo, {autoGenerate:false});
  const variantsEl=document.getElementById("ia-ai-variants");
  if(variantsEl) variantsEl.innerHTML=`<div class="ai-thinking"><div class="ai-dots"><span></span><span></span><span></span></div>Gerando variações de mensagem...</div>`;

  const firstName=((rawCli?.nome||intel.nome||"").trim().split(" ")[0]||"");
  const promptMode = String(contextoTipo||"recompra");
  const pergunta = `
Você é head de CRM e vendas da Chiva Fit.

Tarefa: criar uma ação prática para operação comercial via WhatsApp.

Regras:
- Use tom humano, premium, direto e sem enrolação.
- Não invente dados; use apenas os dados do contexto.
- Mensagens curtas (até 450 caracteres), com CTA claro.
- Gere variações que sejam realmente diferentes entre si.

Contexto do cliente: ${promptMode}.

Responda APENAS em JSON no formato:
{
  "diagnostico": ["...","..."],
  "acao_recomendada": "...",
  "valor_potencial_estimado": {"90d": 0, "12m": 0, "moeda": "BRL"},
  "mensagens": [
    {"titulo":"Curta","texto":"...","objetivo":"...","tom":"..."},
    {"titulo":"Média","texto":"...","objetivo":"...","tom":"..."},
    {"titulo":"Follow-up 24h","texto":"...","objetivo":"...","tom":"..."},
    {"titulo":"Follow-up 72h","texto":"...","objetivo":"...","tom":"..."}
  ]
}

Personalização: use o primeiro nome do cliente quando possível (${firstName||"N/A"}).
  `.trim();

  try{
    const resp=await fetch(ctx.getSupaFnBase()+"/ia-commercial",{method:"POST",headers:ctx.supaFnHeaders(),body:JSON.stringify({contexto,pergunta})});
    if(!resp.ok){ const txt=await resp.text(); throw new Error(txt||"Erro na IA comercial"); }
    const data=await resp.json();
    const parsed=parseCommercialAIResponse(data);
    if(!parsed){
      const safeText=ctx.escapeHTML((data.text||"").trim());
      const html=safeText.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br>");
      if(variantsEl) variantsEl.innerHTML=`<div class="ai-result">${html}</div>`;
      return;
    }

    const msgs=(parsed.mensagens||[]).filter(m=>m && (m.texto||"").trim()).slice(0,5);
    const diag=(parsed.diagnostico||parsed.diagnóstico||[]).slice(0,5);
    const acao=String(parsed.acao_recomendada||parsed.ação_recomendada||"").trim();
    const potObj=parsed.valor_potencial_estimado||{};
    const pot90=safeNum(potObj["90d"], null);
    const pot12=safeNum(potObj["12m"], null);
    const potLocal=estimatePotential(intel);
    const pot90Final=pot90==null ? potLocal.potential_90d : pot90;
    const pot12Final=pot12==null ? potLocal.potential_12m : pot12;

    const diagHtml = diag.length ? `<ul class="ia-ai-bullets">${diag.map(x=>`<li>${ctx.escapeHTML(String(x))}</li>`).join("")}</ul>` : "";
    const acaoHtml = acao ? `<div class="ia-ai-action">${ctx.escapeHTML(acao)}</div>` : "";
    const potHtml = `<div class="ia-ai-pot">Potencial estimado: <strong>${ctx.escapeHTML(formatMoney(ctx,pot90Final))}</strong> (90d)${pot12Final?` • <strong>${ctx.escapeHTML(formatMoney(ctx,pot12Final))}</strong> (12m)`:""}</div>`;

    const listHtml = msgs.map((m,i)=>{
      const t=String(m.titulo||`Mensagem ${i+1}`);
      const objetivo=String(m.objetivo||"");
      const tom=String(m.tom||"");
      const texto=String(m.texto||"").trim();
      const id=`ia-ai-msg-${i}`;
      return `
        <div class="ia-ai-msg">
          <div class="ia-ai-msg-top">
            <div class="ia-ai-msg-title">${ctx.escapeHTML(t)}</div>
            <div class="ia-ai-msg-meta">${[objetivo,tom].filter(Boolean).map(x=>`<span class="ia-chip">${ctx.escapeHTML(x)}</span>`).join("")}</div>
          </div>
          <textarea class="ia-msg-textarea" id="${ctx.escapeHTML(id)}" readonly>${ctx.escapeHTML(texto)}</textarea>
          <div class="ia-ai-msg-actions">
            <button type="button" class="ia-ghost-btn" data-ia-action="copy-target" data-target="#${ctx.escapeHTML(id)}" data-cid="${ctx.escapeHTML(cid)}">Copiar</button>
            <button type="button" class="ia-ghost-btn primary" data-ia-action="wa-target" data-target="#${ctx.escapeHTML(id)}" data-cid="${ctx.escapeHTML(cid)}">WhatsApp</button>
          </div>
        </div>
      `;
    }).join("");

    if(variantsEl) variantsEl.innerHTML=`
      <div class="ia-ai-block">
        ${potHtml}
        ${acaoHtml}
        ${diagHtml}
        <div class="ia-ai-msg-list">${listHtml}</div>
      </div>
    `;
  }catch(e){
    if(variantsEl) variantsEl.innerHTML=`<div class="ia-error">⚠ ${ctx.escapeHTML(e.message||"Erro")}</div>`;
  }
}

export function normalizeBrazilPhone(phone){
  let digits=(phone||"").replace(/\D/g,"");
  if(!digits) return null;
  if(digits.startsWith("00")) digits=digits.slice(2);
  if(digits.length===11 && digits.startsWith("0")) digits=digits.slice(1);
  if(digits.length===13 && digits.startsWith("55")) digits=digits.slice(2);
  if(digits.length===10 || digits.length===11){
    if(!digits.startsWith("55")) digits="55"+digits;
  }else if(digits.length===12 && digits.startsWith("55")){
  }else{
    return null;
  }
  return "https://wa.me/"+digits;
}

export function copyWhatsAppMessageForCustomer(ctx, clienteId){
  const intel = (ctx.customerIntelligence.find(c=>String(c.cliente_id)===String(clienteId))
    || ctx.customerIntel.find(c=>String(c.cliente_id)===String(clienteId)));
  if(!intel){
    ctx.toast("⚠ Cliente não encontrado para copiar mensagem");
    return;
  }
  let msg = intel.suggested_whatsapp_message;
  if(!msg){
    const cliMap = ctx.buildCli(ctx.allOrders);
    const raw = cliMap[intel.cliente_id] || null;
    msg = generateWhatsAppMessage(ctx, intel, raw);
  }
  if(!msg){
    ctx.toast("⚠ Nenhuma mensagem sugerida para este cliente");
    return;
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(msg).then(()=>ctx.toast("📋 Mensagem copiada!")).catch(()=>{
      prompt("Copie a mensagem abaixo:", msg);
    });
  }else{
    prompt("Copie a mensagem abaixo:", msg);
  }
}

export function openWhatsAppForCustomer(ctx, clienteId){
  const intel = (ctx.customerIntelligence.find(c=>String(c.cliente_id)===String(clienteId))
    || ctx.customerIntel.find(c=>String(c.cliente_id)===String(clienteId)));
  if(!intel){
    ctx.toast("⚠ Cliente não encontrado para WhatsApp");
    return;
  }
  const cliMap = ctx.buildCli(ctx.allOrders);
  const raw = cliMap[intel.cliente_id] || null;
  const phone = intel.telefone || raw?.telefone || "";
  const url = normalizeBrazilPhone(phone);
  if(!url){
    ctx.toast("⚠ Telefone inválido ou ausente para este cliente");
    return;
  }
  const msg = intel.suggested_whatsapp_message || generateWhatsAppMessage(ctx, intel, raw) || "";
  const fullUrl = msg ? (url+"?text="+encodeURIComponent(msg)) : url;
  window.open(fullUrl,"_blank","noopener");
  const nowIso = new Date().toISOString();
  intel.last_whatsapp_at = nowIso;
  const idx = ctx.customerIntelligence.findIndex(c=>String(c.cliente_id)===String(clienteId));
  if(idx>=0){
    ctx.customerIntelligence[idx].last_whatsapp_at = nowIso;
    scheduleCustomerIntelligenceSync(ctx);
    if(typeof ctx.renderIADashboard === "function") ctx.renderIADashboard();
  }
}

function buildDataSummary(ctx){
  const clis=Object.values(ctx.buildCli(ctx.allOrders));
  const total=ctx.allOrders.reduce((s,o)=>s+ctx.val(o),0);
  const recorrentes=clis.filter(c=>c.orders.length>=2);
  const ad=parseInt(localStorage.getItem("crm_alertdays")||"60");
  const inativos=clis.filter(c=>ctx.daysSince(c.last)>ad&&!ctx.isCNPJ(c.doc));
  const vips=clis.filter(c=>{ const sc=ctx.calcCliScores(c); return sc.status==="vip"||sc.ltv>=650; }).filter(c=>!ctx.isCNPJ(c.doc));

  const canalStats={};
  ctx.allOrders.forEach(o=>{ const ch=ctx.detectCh(o); if(!canalStats[ch])canalStats[ch]={pedidos:0,total:0,clientes:new Set()}; canalStats[ch].pedidos++; canalStats[ch].total+=ctx.val(o); canalStats[ch].clientes.add(ctx.cliKey(o)); });
  const canalSummary=Object.entries(canalStats).map(([ch,s])=>(`${ctx.CH[ch]}: ${s.pedidos} pedidos, ${ctx.fmtBRL(s.total)}, ${s.clientes.size} clientes únicos`)).join(" | ");

  const prodMap={};
  ctx.allOrders.forEach(o=>(o.itens||[]).forEach(it=>{ const k=it.descricao||it.codigo||"?"; if(!prodMap[k])prodMap[k]={t:0,qty:0,clis:new Set()}; prodMap[k].t+=(parseFloat(it.valor)||0)*(parseFloat(it.quantidade)||1); prodMap[k].qty+=parseFloat(it.quantidade)||1; prodMap[k].clis.add(ctx.cliKey(o)); }));
  const topProds=Object.entries(prodMap).sort((a,b)=>b[1].t-a[1].t).slice(0,15).map(([n,v])=>`${n}: ${v.qty} un, ${ctx.fmtBRL(v.t)}, ${v.clis.size} clientes`).join("\n");

  const bm={};
  ctx.allOrders.forEach(o=>{ const d=new Date(o.data); if(isNaN(d))return; const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; bm[k]=(bm[k]||0)+ctx.val(o); });
  const monthlyTrend=Object.entries(bm).sort((a,b)=>a[0].localeCompare(b[0])).slice(-12).map(([k,v])=>`${k}: ${ctx.fmtBRL(v)}`).join(", ");

  const topClis=clis.filter(c=>!ctx.isCNPJ(c.doc)).sort((a,b)=>b.orders.reduce((s,o)=>s+ctx.val(o),0)-a.orders.reduce((s,o)=>s+ctx.val(o),0)).slice(0,10).map(c=>{
    const sc=ctx.calcCliScores(c);
    return `${c.nome}: LTV ${ctx.fmtBRL(sc.ltv)}, ${sc.n} pedidos, última há ${sc.ds}d, score recompra ${sc.recompraScore}/100`;
  }).join("\n");

  return `
MARCA: Chiva Fit (suplementos/shakes com diferentes sabores)
TICKET MÉDIO: R$110 (VIP = acima de R$650, excluindo CNPJ)
PERÍODO ANALISADO: ${ctx.allOrders.length} pedidos no total

MÉTRICAS GERAIS:
- Volume total: ${ctx.fmtBRL(total)}
- Clientes únicos (PF): ${clis.filter(c=>!ctx.isCNPJ(c.doc)).length}
- Clientes recorrentes (2+ pedidos): ${recorrentes.filter(c=>!ctx.isCNPJ(c.doc)).length}
- Taxa de recompra: ${clis.length?Math.round(recorrentes.length/clis.length*100):0}%
- VIPs (acima R$650): ${vips.length}
- Inativos (>${ad}d): ${inativos.length}

CANAIS:
${canalSummary}

TENDÊNCIA MENSAL (últimos 12 meses):
${monthlyTrend}

TOP PRODUTOS/SABORES:
${topProds}

TOP CLIENTES POR LTV:
${topClis}
  `.trim();
}

export async function runAI(ctx, type){
  if(!ctx.allOrders.length){ ctx.toast("⚠ Importe dados primeiro"); return; }

  const btn=document.getElementById("btn-"+type);
  const resultEl=document.getElementById("ai-"+type);
  if(btn){ btn.disabled=true; btn.textContent="⟳ Analisando..."; }
  if(resultEl) resultEl.innerHTML=`<div class="ai-thinking"><div class="ai-dots"><span></span><span></span><span></span></div>Analisando dados reais...</div>`;

  const dataSummary=buildDataSummary(ctx);
  const prompts={
    revenue:`Com base nesses dados reais da Chiva Fit, faça uma previsão de receita para os próximos 3 meses. Analise a tendência mensal e sazonalidade. Seja específico com valores em R$.`,
    churn:`Analise esses dados e identifique: 1) Padrão de clientes que abandonam a marca, 2) Sinais de alerta de churn, 3) Quais segmentos têm maior risco agora, 4) Ações específicas para reter esses clientes.`,
    canal:`Analise qual canal traz os melhores clientes para a Chiva Fit considerando: LTV médio por canal, taxa de recompra por canal, CAC implícito, e recomende onde concentrar esforços de marketing.`,
    sabores:`Analise os produtos/sabores mais vendidos e identifique: 1) Qual produto/sabor gera mais recompra (clientes que voltam), 2) Qual é o "produto de entrada" ideal, 3) Sequência de compra mais comum, 4) Oportunidades de lançamento baseadas no comportamento.`,
    oportunidades:`Identifique oportunidades específicas de cross-sell e upsell para a Chiva Fit: 1) Combinações de produtos que clientes compram juntos, 2) Clientes prontos para upsell agora, 3) Momentos ideais de abordagem baseados no ciclo de compra, 4) Mensagens de WhatsApp sugeridas.`,
    completa:`Faça uma análise completa e estratégica da Chiva Fit com foco em MAXIMIZAR RECOMPRA E LTV. Inclua: 1) Diagnóstico atual, 2) Principais alavancas de crescimento, 3) Segmentos prioritários, 4) Plano de ação das próximas 4 semanas, 5) Metas realistas de recompra, 6) Scripts de WhatsApp para os 3 principais segmentos.`
  };

  try{
    const response=await fetch(ctx.getSupaFnBase()+"/ia-claude",{
      method:"POST",
      headers:ctx.supaFnHeaders(),
      body:JSON.stringify({
        prompt:`${dataSummary}\n\nPERGUNTA: ${prompts[type]}`,
        system:"Você é um especialista em CRM e retenção de clientes para e-commerce brasileiro, especialmente marcas de suplementos/nutrição. Responda sempre em português, seja direto, use dados reais fornecidos, e dê insights acionáveis. Use bullet points e seja conciso mas impactante."
      })
    });
    if(!response.ok){ const errText=await response.text(); throw new Error(errText||"Erro na função IA"); }
    const data=await response.json();
    const text=(data.text||"").trim();
    const safeText=ctx.escapeHTML(text);
    if(resultEl) resultEl.innerHTML=`<div class="ai-result">${safeText.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\n/g,"<br>")}</div>`;
    try{
      if(ctx.supaConnected && ctx.supaClient){
        await ctx.supaClient.from('v2_insights').insert({tipo:type,conteudo:text,gerado_por:ctx.selectedUser,created_at:new Date().toISOString()});
        if(resultEl) resultEl.innerHTML+=`<div style="font-size:9px;color:var(--green);margin-top:4px">✓ Insight salvo no Supabase</div>`;
      }
    }catch(_e){}
  }catch(e){
    const safeErr = ctx.escapeHTML(e?.message || "Erro na função IA");
    if(resultEl) resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">⚠ ${safeErr}</div>`;
  } finally {
    if(btn){ btn.disabled=false; btn.innerHTML="✨ Analisar novamente"; }
  }
}
