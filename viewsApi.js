function asNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asText(v){
  const s = String(v == null ? "" : v).trim();
  return s;
}

function firstKey(obj, keys){
  for(let i=0;i<keys.length;i++){
    const k = keys[i];
    if(obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
  }
  return null;
}

async function tryQueryDateRange(client, viewName, dateCols, fromIso, toIso, selectCols, extra){
  const cols = selectCols || "*";
  const opts = extra && typeof extra === "object" ? extra : {};
  for(let i=0;i<dateCols.length;i++){
    const dc = dateCols[i];
    try{
      let q = client.from(viewName).select(cols);
      if(fromIso) q = q.gte(dc, fromIso);
      if(toIso) q = q.lte(dc, toIso);
      if(opts.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending !== false });
      if(opts.limit) q = q.limit(opts.limit);
      const { data, error } = await q;
      if(error) continue;
      return Array.isArray(data) ? data : [];
    }catch(_e){}
  }
  try{
    let q = client.from(viewName).select(cols);
    if(opts.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending !== false });
    if(opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if(error) return [];
    const rows = Array.isArray(data) ? data : [];
    if(!fromIso && !toIso) return rows;
    const fromTs = fromIso ? new Date(fromIso + "T00:00:00").getTime() : null;
    const toTs = toIso ? new Date(toIso + "T23:59:59").getTime() : null;
    const pickDate = (r)=>String(firstKey(r, ["dia", "data", "date", "dt"]) || "").slice(0,10);
    return rows.filter(r=>{
      const d = pickDate(r);
      if(!d) return false;
      const ts = new Date(d + "T12:00:00").getTime();
      if(fromTs != null && ts < fromTs) return false;
      if(toTs != null && ts > toTs) return false;
      return true;
    });
  }catch(_e){
    return [];
  }
}

const DASHBOARD_KPI_COLS = "faturamento_total,faturamento_mes,faturamento_ontem,pedidos_total,pedidos_mes,pedidos_ontem,ticket_medio,ticket_medio_mes,clientes_ativos,clientes_novos_mes,clientes_churn,taxa_recompra,ltv_medio";

export async function getDashboardKpis(client){
  try{
    const { data, error } = await client.from("vw_dashboard_kpis").select(DASHBOARD_KPI_COLS).maybeSingle();
    if(error) return null;
    return data || null;
  }catch(_e){
    return null;
  }
}

export async function getDashboardDaily(client, fromIso, toIso){
  return await tryQueryDateRange(
    client,
    "vw_dashboard_v2_daily",
    ["dia"],
    fromIso,
    toIso,
    "dia,pedidos,faturamento,ticket_medio",
    { orderBy: "dia", ascending: true, limit: 5000 }
  );
}

export async function getDashboardDailyChannel(client, fromIso, toIso){
  return await tryQueryDateRange(
    client,
    "vw_dashboard_v2_daily_channel",
    ["dia"],
    fromIso,
    toIso,
    "dia,canal,pedidos,faturamento",
    { orderBy: "dia", ascending: true, limit: 20000 }
  );
}

export async function getNewCustomersDaily(client, fromIso, toIso){
  return await tryQueryDateRange(
    client,
    "vw_dashboard_v2_new_customers_daily",
    ["dia"],
    fromIso,
    toIso,
    "dia,novos_clientes",
    { orderBy: "dia", ascending: true, limit: 5000 }
  );
}

export async function getFunilRecompra(client){
  try{
    const { data, error } = await client.from("vw_funil_recompra").select("etapa,clientes,percentual").limit(50);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

export async function getTopCidades(client, limit){
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try{
    const { data, error } = await client.from("vw_top_cidades").select("cidade,uf,clientes,faturamento,pedidos").limit(n);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

export async function getProdutosFavoritos(client, limit){
  const n = Math.max(1, Math.min(100, Number(limit) || 10));
  try{
    const { data, error } = await client.from("vw_produtos_favoritos").select("produto,sku,quantidade,faturamento,clientes").limit(n);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

const CLIENTES_CARD_COLS = "cliente_id,nome,email,telefone,canal_principal,status,segmento_crm,ltv,score_recompra,risco_churn,dias_desde_ultima_compra,total_pedidos,uf,cidade,next_best_action";

export async function getClientesVipRisco(client, limit){
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try{
    const { data, error } = await client.from("vw_clientes_vip_risco").select(CLIENTES_CARD_COLS).limit(n);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

export async function getClientesReativacao(client, limit){
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try{
    const { data, error } = await client.from("vw_clientes_reativacao").select(CLIENTES_CARD_COLS).limit(n);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

export async function getClientesSemContato(client, limit){
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try{
    const { data, error } = await client.from("vw_clientes_sem_contato").select(CLIENTES_CARD_COLS).limit(n);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

function normalizeCursorValue(v){
  if(v == null) return null;
  if(typeof v === "number") return Number.isFinite(v) ? v : null;
  if(typeof v === "string"){
    const s = v.trim();
    if(!s) return null;
    const n = Number(s);
    if(Number.isFinite(n)) return n;
    return s;
  }
  return v;
}

function cursorToOrFilter(cursor){
  const risco = normalizeCursorValue(cursor?.risco_churn);
  const score = normalizeCursorValue(cursor?.score_recompra);
  const total = normalizeCursorValue(cursor?.total_gasto);
  const id = String(cursor?.cliente_id || "").trim();
  if(risco == null || score == null || total == null || !id) return "";
  const riscoS = String(risco);
  const scoreS = String(score);
  const totalS = String(total);
  return [
    `risco_churn.lt.${riscoS}`,
    `and(risco_churn.eq.${riscoS},score_recompra.lt.${scoreS})`,
    `and(risco_churn.eq.${riscoS},score_recompra.eq.${scoreS},total_gasto.lt.${totalS})`,
    `and(risco_churn.eq.${riscoS},score_recompra.eq.${scoreS},total_gasto.eq.${totalS},cliente_id.gt.${id})`
  ].join(",");
}

function pickNextCursor(rows){
  if(!Array.isArray(rows) || !rows.length) return null;
  const last = rows[rows.length - 1] || {};
  return {
    risco_churn: last.risco_churn ?? last.risco_churn === 0 ? Number(last.risco_churn) : null,
    score_recompra: last.score_recompra ?? last.score_recompra === 0 ? Number(last.score_recompra) : null,
    total_gasto: last.total_gasto ?? last.total_gasto === 0 ? Number(last.total_gasto) : null,
    cliente_id: String(last.cliente_id || last.id || "").trim()
  };
}

const CLIENTES_INTEL_COLS = [
  "cliente_id","nome","email","telefone","celular","doc","cidade","uf",
  "canal_principal","status","segmento_crm","faixa_valor","faixa_frequencia",
  "pipeline_stage","total_pedidos","total_gasto","ltv","ticket_medio",
  "dias_desde_ultima_compra","score_recompra","risco_churn","score_final",
  "next_best_action","ultimo_pedido","primeiro_pedido",
  "last_interaction_at","last_interaction_type","last_contact_at","responsible_user"
].join(",");

export async function getClientesInteligencia(client, opts){
  const legacyLimit = typeof opts === "number" ? opts : null;
  const input = (opts && typeof opts === "object") ? opts : {};
  const pageSize = Math.max(1, Math.min(500, Number(input.pageSize || (legacyLimit != null ? legacyLimit : 500)) || 500));
  const cursor = input.cursor || null;
  try{
    let q = client.from("vw_clientes_inteligencia").select(CLIENTES_INTEL_COLS).limit(pageSize);
    q = q
      .order("risco_churn", { ascending: false, nullsFirst: false })
      .order("score_recompra", { ascending: false, nullsFirst: false })
      .order("total_gasto", { ascending: false, nullsFirst: false })
      .order("cliente_id", { ascending: true, nullsFirst: false });
    if(cursor){
      const orFilter = cursorToOrFilter(cursor);
      if(orFilter) q = q.or(orFilter);
    }
    const { data, error } = await q;
    if(error) return { rows: [], nextCursor: null, hasMore: false };
    const rows = Array.isArray(data) ? data : [];
    const nextCursor = pickNextCursor(rows);
    const hasMore = rows.length === pageSize && !!nextCursor;
    return { rows, nextCursor, hasMore };
  }catch(_e){
    return { rows: [], nextCursor: null, hasMore: false };
  }
}

export function normalizeClienteIntel(row){
  const r = row && typeof row === "object" ? row : {};
  const id = asText(firstKey(r, ["cliente_id", "id", "customer_id"]));
  const nome = asText(firstKey(r, ["nome", "name"]));
  const email = asText(firstKey(r, ["email"]));
  const telefone = asText(firstKey(r, ["telefone", "phone"]));
  const celular = asText(firstKey(r, ["celular", "mobile"]));
  const doc = asText(firstKey(r, ["doc", "documento", "cpf_cnpj"]));
  const cidade = asText(firstKey(r, ["cidade", "city"]));
  const uf = asText(firstKey(r, ["uf", "estado", "state"])).toUpperCase();
  const canal = asText(firstKey(r, ["canal_principal", "canal", "channel"])).toLowerCase() || "outros";
  const status = asText(firstKey(r, ["status"]));
  const segmento = asText(firstKey(r, ["segmento_crm", "segmento", "segment"]));
  const faixaValor = asText(firstKey(r, ["faixa_valor"]));
  const faixaFreq = asText(firstKey(r, ["faixa_frequencia"]));
  const pipeline = asText(firstKey(r, ["pipeline_stage"]));
  const totalPedidos = asNum(firstKey(r, ["total_pedidos", "pedidos"]));
  const totalGasto = asNum(firstKey(r, ["total_gasto", "faturamento", "ltv"]));
  const ltv = asNum(firstKey(r, ["ltv", "total_gasto"]));
  const ticket = asNum(firstKey(r, ["ticket_medio"]));
  const dias = firstKey(r, ["dias_desde_ultima_compra", "dias_sem_comprar"]);
  const diasUltimaCompra = dias == null ? null : Number(dias);
  const scoreRecompra = asNum(firstKey(r, ["score_recompra"]));
  const riscoChurn = asNum(firstKey(r, ["risco_churn"]));
  const lastInteractionAt = asText(firstKey(r, ["last_interaction_at"]));
  const lastInteractionType = asText(firstKey(r, ["last_interaction_type"]));
  const lastInteractionDesc = asText(firstKey(r, ["last_interaction_desc"]));
  const lastContactAt = asText(firstKey(r, ["last_contact_at"]));
  const responsibleUser = asText(firstKey(r, ["responsible_user", "user_responsible"]));
  const scoreFinal = asNum(firstKey(r, ["score_final"]));
  const nextBestAction = asText(firstKey(r, ["next_best_action"]));
  const ultimoPedido = asText(firstKey(r, ["ultimo_pedido"]));
  const primeiroPedido = asText(firstKey(r, ["primeiro_pedido"]));
  return {
    cliente_id: id,
    nome,
    email,
    telefone,
    celular,
    doc,
    cidade,
    uf,
    canal_principal: canal,
    status,
    segmento_crm: segmento,
    faixa_valor: faixaValor,
    faixa_frequencia: faixaFreq,
    pipeline_stage: pipeline,
    total_pedidos: totalPedidos,
    total_gasto: totalGasto,
    ltv,
    ticket_medio: ticket,
    dias_desde_ultima_compra: diasUltimaCompra,
    score_recompra: scoreRecompra,
    risco_churn: riscoChurn,
    last_interaction_at: lastInteractionAt,
    last_interaction_type: lastInteractionType,
    last_interaction_desc: lastInteractionDesc,
    last_contact_at: lastContactAt,
    responsible_user: responsibleUser,
    score_final: scoreFinal,
    next_best_action: nextBestAction,
    ultimo_pedido: ultimoPedido,
    primeiro_pedido: primeiroPedido
  };
}
