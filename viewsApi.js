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

export async function getDashboardKpis(client){
  try{
    const { data, error } = await client.from("vw_dashboard_kpis").select("*").maybeSingle();
    if(error) return null;
    return data || null;
  }catch(_e){
    return null;
  }
}

export async function getVendasPorDia(client, fromIso, toIso){
  const primary = await tryQueryDateRange(client, "vw_vendas_por_dia", ["dia", "data", "date"], fromIso, toIso, "*", { orderBy: "dia", ascending: true, limit: 4000 });
  if(primary.length) return primary;
  return await tryQueryDateRange(client, "vw_dashboard_v2_daily", ["dia"], fromIso, toIso, "*", { orderBy: "dia", ascending: true, limit: 4000 });
}

export async function getVendasPorCanal(client, fromIso, toIso){
  const rows = await tryQueryDateRange(client, "vw_vendas_por_canal", ["dia", "data", "date"], fromIso, toIso, "*", { limit: 20000 });
  if(rows.length) return rows;
  return await tryQueryDateRange(client, "vw_dashboard_v2_daily_channel", ["dia"], fromIso, toIso, "*", { limit: 20000 });
}

export async function getFunilRecompra(client){
  try{
    const { data, error } = await client.from("vw_funil_recompra").select("*").limit(50);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

export async function getTopCidades(client, limit){
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try{
    const { data, error } = await client.from("vw_top_cidades").select("*").limit(n);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

export async function getProdutosFavoritos(client, limit){
  const n = Math.max(1, Math.min(100, Number(limit) || 10));
  try{
    const { data, error } = await client.from("vw_produtos_favoritos").select("*").limit(n);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

export async function getClientesVipRisco(client, limit){
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try{
    const { data, error } = await client.from("vw_clientes_vip_risco").select("*").limit(n);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

export async function getClientesReativacao(client, limit){
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try{
    const { data, error } = await client.from("vw_clientes_reativacao").select("*").limit(n);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

export async function getClientesSemContato(client, limit){
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try{
    const { data, error } = await client.from("vw_clientes_sem_contato").select("*").limit(n);
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
  }
}

export async function getClientesInteligencia(client, limit){
  const n = Math.max(1, Math.min(15000, Number(limit) || 5000));
  try{
    let q = client.from("vw_clientes_inteligencia").select("*").limit(n);
    q = q.order("total_gasto", { ascending: false });
    const { data, error } = await q;
    if(error) return [];
    return Array.isArray(data) ? data : [];
  }catch(_e){
    return [];
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
  const lastContactAt = asText(firstKey(r, ["last_contact_at"]));
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
    last_contact_at: lastContactAt,
    next_best_action: nextBestAction,
    ultimo_pedido: ultimoPedido,
    primeiro_pedido: primeiroPedido
  };
}

