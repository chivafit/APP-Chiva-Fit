function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asText(v) {
  const s = String(v == null ? '' : v).trim();
  return s;
}

function firstKey(obj, keys) {
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) return obj[k];
  }
  return null;
}

function normalizeSbError(error) {
  if (!error || typeof error !== 'object') return { message: String(error || '') };
  return {
    message: String(error.message || ''),
    details: error.details != null ? String(error.details) : '',
    hint: error.hint != null ? String(error.hint) : '',
    code: error.code != null ? String(error.code) : '',
  };
}

function logDashQueryError(ctx) {
  const view = String(ctx?.view || '');
  const op = String(ctx?.op || 'query');
  const select = String(ctx?.select || '*');
  const extra = ctx?.extra && typeof ctx.extra === 'object' ? ctx.extra : {};
  const err = normalizeSbError(ctx?.error);
  console.error('[dashboard][supabase] falha', { op, view, select, ...extra, ...err });
}

async function tryQueryDateRange(client, viewName, dateCols, fromIso, toIso, selectCols, extra) {
  const cols = selectCols || '*';
  const opts = extra && typeof extra === 'object' ? extra : {};
  for (let i = 0; i < dateCols.length; i++) {
    const dc = dateCols[i];
    try {
      let q = client.from(viewName).select(cols);
      if (fromIso) q = q.gte(dc, fromIso);
      if (toIso) q = q.lte(dc, toIso);
      if (opts.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending !== false });
      if (opts.limit) q = q.limit(opts.limit);
      const { data, error } = await q;
      if (error) continue;
      return Array.isArray(data) ? data : [];
    } catch (_e) {}
  }
  try {
    let q = client.from(viewName).select(cols);
    if (opts.orderBy) q = q.order(opts.orderBy, { ascending: opts.ascending !== false });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) return [];
    const rows = Array.isArray(data) ? data : [];
    if (!fromIso && !toIso) return rows;
    const fromTs = fromIso ? new Date(fromIso + 'T00:00:00').getTime() : null;
    const toTs = toIso ? new Date(toIso + 'T23:59:59').getTime() : null;
    const pickDate = (r) => String(firstKey(r, ['dia', 'data', 'date', 'dt']) || '').slice(0, 10);
    return rows.filter((r) => {
      const d = pickDate(r);
      if (!d) return false;
      const ts = new Date(d + 'T12:00:00').getTime();
      if (fromTs != null && ts < fromTs) return false;
      if (toTs != null && ts > toTs) return false;
      return true;
    });
  } catch (_e) {
    return [];
  }
}

const DASHBOARD_ANALYTICS_VIEW = 'vw_dashboard_analytics';
const DASHBOARD_KPI_COLS =
  'kpi_receita_total,kpi_total_pedidos,kpi_ticket_medio,kpi_total_clientes,kpi_ltv_medio,kpi_percentual_recompra';

export async function getDashboardKpis(client) {
  try {
    const { data, error } = await client
      .from(DASHBOARD_ANALYTICS_VIEW)
      .select(DASHBOARD_KPI_COLS)
      .limit(1)
      .maybeSingle();
    if (error) {
      logDashQueryError({
        op: 'getDashboardKpis',
        view: DASHBOARD_ANALYTICS_VIEW,
        select: DASHBOARD_KPI_COLS,
        error,
      });
      return null;
    }
    if (!data) return null;
    return {
      faturamento_total: asNum(data.kpi_receita_total),
      total_pedidos: asNum(data.kpi_total_pedidos),
      ticket_medio: asNum(data.kpi_ticket_medio),
      total_clientes: asNum(data.kpi_total_clientes),
      ltv_medio: asNum(data.kpi_ltv_medio),
      percentual_recompra: asNum(data.kpi_percentual_recompra),
    };
  } catch (_e) {
    return null;
  }
}

export async function getDashboardDaily(client, fromIso, toIso) {
  return await tryQueryDateRange(
    client,
    'vw_dashboard_v2_daily',
    ['dia'],
    fromIso,
    toIso,
    'dia,pedidos,faturamento,ticket_medio',
    { orderBy: 'dia', ascending: true, limit: 5000 },
  );
}

export async function getDashboardDailyChannel(client, fromIso, toIso) {
  return await tryQueryDateRange(
    client,
    'vw_dashboard_v2_daily_channel',
    ['dia'],
    fromIso,
    toIso,
    'dia,canal,pedidos,faturamento',
    { orderBy: 'dia', ascending: true, limit: 20000 },
  );
}

export async function getNewCustomersDaily(client, fromIso, toIso) {
  return await tryQueryDateRange(
    client,
    'vw_dashboard_v2_new_customers_daily',
    ['dia'],
    fromIso,
    toIso,
    'dia,novos_clientes',
    { orderBy: 'dia', ascending: true, limit: 5000 },
  );
}

export async function getFunilRecompra(client) {
  try {
    const select = 'dias_sem_comprar';
    const { data, error } = await client.from(DASHBOARD_ANALYTICS_VIEW).select(select).limit(10000);
    if (error) {
      logDashQueryError({ op: 'getFunilRecompra', view: DASHBOARD_ANALYTICS_VIEW, select, error });
      return [];
    }
    const rows = Array.isArray(data) ? data : [];
    const buckets = new Map();
    const add = (ordem, etapa) => {
      const key = String(ordem) + '::' + etapa;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    };
    rows.forEach((r) => {
      const dias = r?.dias_sem_comprar == null ? null : Number(r.dias_sem_comprar) || 0;
      if (dias == null) {
        add(5, 'Sem compra');
        return;
      }
      if (dias <= 30) add(1, 'Ativos (0–30d)');
      else if (dias <= 60) add(2, 'Atencao (31–60d)');
      else if (dias <= 120) add(3, 'Risco (61–120d)');
      else add(4, 'Churn (121+d)');
    });
    const out = Array.from(buckets.entries()).map(([k, clientes]) => {
      const parts = k.split('::');
      return {
        ordem: Number(parts[0] || 0) || 0,
        etapa: parts[1] || '—',
        clientes: Number(clientes || 0) || 0,
      };
    });
    out.sort((a, b) => a.ordem - b.ordem);
    return out;
  } catch (_e) {
    return [];
  }
}

export async function getTopCidades(client, limit) {
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try {
    const select = 'cidade,uf,cliente_id,receita_total,total_pedidos';
    const { data, error } = await client.from(DASHBOARD_ANALYTICS_VIEW).select(select).limit(10000);
    if (error) {
      logDashQueryError({ op: 'getTopCidades', view: DASHBOARD_ANALYTICS_VIEW, select, error });
      return [];
    }
    const rows = Array.isArray(data) ? data : [];
    const agg = new Map();
    rows.forEach((r) => {
      const cidade = asText(r?.cidade);
      if (!cidade) return;
      const uf = asText(r?.uf).toUpperCase();
      const key = cidade + '::' + uf;
      if (!agg.has(key)) {
        agg.set(key, { cidade, uf, pedidos: 0, faturamento: 0, total_clientes: 0 });
      }
      const it = agg.get(key);
      it.pedidos += asNum(r?.total_pedidos);
      it.faturamento += asNum(r?.receita_total);
      it.total_clientes += 1;
    });
    const out = Array.from(agg.values()).map((x) => ({
      cidade: x.cidade,
      uf: x.uf,
      pedidos: x.pedidos,
      faturamento: x.faturamento,
      total_clientes: x.total_clientes,
    }));
    out.sort((a, b) => (b.faturamento || 0) - (a.faturamento || 0));
    return out.slice(0, n);
  } catch (_e) {
    return [];
  }
}

export async function getProdutosFavoritos(client, limit) {
  const n = Math.max(1, Math.min(100, Number(limit) || 10));
  try {
    const select = 'produto,unidades_vendidas,faturamento,total_clientes';
    const { data, error } = await client.from('vw_produtos_favoritos').select(select).limit(n);
    if (error) {
      logDashQueryError({
        op: 'getProdutosFavoritos',
        view: 'vw_produtos_favoritos',
        select,
        error,
      });
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (_e) {
    return [];
  }
}

const CLIENTES_CARD_COLS =
  'cliente_id,nome,email,telefone,celular,cidade,uf,canal_principal,total_pedidos,receita_total,ticket_medio,ltv_medio,score_recompra,risco_churn,dias_sem_comprar,segmento_crm,next_best_action,last_contact_at,responsible_user';

function normalizeClienteCardRow(r) {
  const cliente_id = asText(firstKey(r, ['cliente_id', 'id']));
  const nome = asText(r?.nome);
  const email = asText(r?.email);
  const telefone = asText(firstKey(r, ['celular', 'telefone']));
  const cidade = asText(r?.cidade);
  const uf = asText(r?.uf).toUpperCase();
  const canal_principal = asText(r?.canal_principal);
  const total_pedidos = asNum(r?.total_pedidos);
  const receita_total = asNum(firstKey(r, ['receita_total', 'total_gasto', 'ltv']));
  const ticket_medio = asNum(r?.ticket_medio);
  const ltv_medio = asNum(firstKey(r, ['ltv_medio', 'ltv']));
  const score_recompra = asNum(r?.score_recompra);
  const risco_churn = asNum(r?.risco_churn);
  const dias_sem_comprar = r?.dias_sem_comprar == null ? null : Number(r.dias_sem_comprar) || 0;
  const segmento_crm = asText(r?.segmento_crm);
  const next_best_action = asText(r?.next_best_action);
  const last_contact_at = r?.last_contact_at || null;
  const responsible_user = asText(r?.responsible_user);
  return {
    cliente_id,
    nome,
    email,
    telefone,
    celular: asText(r?.celular),
    cidade,
    uf,
    canal_principal,
    total_pedidos,
    receita_total,
    ticket_medio,
    ltv_medio,
    score_recompra,
    risco_churn,
    dias_sem_comprar,
    segmento_crm,
    next_best_action,
    last_contact_at,
    responsible_user,
  };
}

export async function getClientesVipRisco(client, limit) {
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try {
    const { data, error } = await client
      .from(DASHBOARD_ANALYTICS_VIEW)
      .select(CLIENTES_CARD_COLS)
      .limit(10000);
    if (error) {
      logDashQueryError({
        op: 'getClientesVipRisco',
        view: DASHBOARD_ANALYTICS_VIEW,
        select: CLIENTES_CARD_COLS,
        error,
      });
      return [];
    }
    const rows = (Array.isArray(data) ? data : []).map(normalizeClienteCardRow);
    const vip = rows
      .filter((r) => r.cliente_id)
      .filter((r) => r.ltv_medio >= 650 || r.total_pedidos >= 6)
      .filter(
        (r) => r.dias_sem_comprar != null && r.dias_sem_comprar >= 30 && r.dias_sem_comprar <= 120,
      )
      .sort(
        (a, b) =>
          Number(b.dias_sem_comprar || 0) - Number(a.dias_sem_comprar || 0) ||
          Number(b.ltv_medio || 0) - Number(a.ltv_medio || 0),
      );
    return vip.slice(0, n);
  } catch (_e) {
    return [];
  }
}

export async function getClientesReativacao(client, limit) {
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try {
    const { data, error } = await client
      .from(DASHBOARD_ANALYTICS_VIEW)
      .select(CLIENTES_CARD_COLS)
      .limit(10000);
    if (error) {
      logDashQueryError({
        op: 'getClientesReativacao',
        view: DASHBOARD_ANALYTICS_VIEW,
        select: CLIENTES_CARD_COLS,
        error,
      });
      return [];
    }
    const rows = (Array.isArray(data) ? data : []).map(normalizeClienteCardRow);
    const list = rows
      .filter((r) => r.cliente_id)
      .filter(
        (r) => r.dias_sem_comprar != null && r.dias_sem_comprar >= 61 && r.dias_sem_comprar <= 120,
      )
      .sort(
        (a, b) =>
          Number(b.ltv_medio || 0) - Number(a.ltv_medio || 0) ||
          Number(b.dias_sem_comprar || 0) - Number(a.dias_sem_comprar || 0),
      );
    return list.slice(0, n);
  } catch (_e) {
    return [];
  }
}

export async function getClientesSemContato(client, limit) {
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  try {
    const select = CLIENTES_CARD_COLS;
    const { data, error } = await client.from(DASHBOARD_ANALYTICS_VIEW).select(select).limit(10000);
    if (error) {
      logDashQueryError({
        op: 'getClientesSemContato',
        view: DASHBOARD_ANALYTICS_VIEW,
        select,
        error,
      });
      return [];
    }
    const rows = (Array.isArray(data) ? data : []).map(normalizeClienteCardRow);
    const now = Date.now();
    const day30 = 30 * 86400000;
    const out = rows
      .filter((r) => r.cliente_id)
      .map((r) => {
        const phone = String(r.celular || r.telefone || '').trim();
        const hasPhone = !!phone;
        const hasEmail = !!String(r.email || '').trim();
        const lc = r.last_contact_at ? new Date(String(r.last_contact_at)).getTime() : NaN;
        let motivo = '—';
        if (!hasPhone && !hasEmail) motivo = 'sem whatsapp/email';
        else if (!r.last_contact_at) motivo = 'sem contato registrado';
        else if (Number.isFinite(lc) && now - lc > day30) motivo = '30+ dias sem contato';
        return { ...r, motivo };
      })
      .filter((r) => r.motivo !== '—')
      .sort(
        (a, b) =>
          Number(b.ltv_medio || 0) - Number(a.ltv_medio || 0) ||
          Number(b.dias_sem_comprar || 0) - Number(a.dias_sem_comprar || 0),
      );
    return out.slice(0, n);
  } catch (_e) {
    return [];
  }
}

function normalizeCursorValue(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
    return s;
  }
  return v;
}

function cursorToOrFilter(cursor) {
  const risco = normalizeCursorValue(cursor?.risco_churn);
  const score = normalizeCursorValue(cursor?.score_recompra);
  const total = normalizeCursorValue(cursor?.total_gasto);
  const id = String(cursor?.cliente_id || '').trim();
  if (risco == null || score == null || total == null || !id) return '';
  const riscoS = String(risco);
  const scoreS = String(score);
  const totalS = String(total);
  return [
    `risco_churn.lt.${riscoS}`,
    `and(risco_churn.eq.${riscoS},score_recompra.lt.${scoreS})`,
    `and(risco_churn.eq.${riscoS},score_recompra.eq.${scoreS},total_gasto.lt.${totalS})`,
    `and(risco_churn.eq.${riscoS},score_recompra.eq.${scoreS},total_gasto.eq.${totalS},cliente_id.gt.${id})`,
  ].join(',');
}

function pickNextCursor(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const last = rows[rows.length - 1] || {};
  // Correção: usar != null em vez de ?? para tratar 0 como valor válido
  // (o operador ?? não ativa para 0, mas o operador != null sim)
  return {
    risco_churn: last.risco_churn != null ? Number(last.risco_churn) : null,
    score_recompra: last.score_recompra != null ? Number(last.score_recompra) : null,
    total_gasto: last.total_gasto != null ? Number(last.total_gasto) : null,
    cliente_id: String(last.cliente_id || last.id || '').trim(),
  };
}

const CLIENTES_INTEL_COLS = [
  'cliente_id',
  'nome',
  'email',
  'telefone',
  'celular',
  'doc',
  'cidade',
  'uf',
  'canal_principal',
  'status',
  'segmento_crm',
  'faixa_valor',
  'faixa_frequencia',
  'pipeline_stage',
  'total_pedidos',
  'total_gasto',
  'ltv',
  'ticket_medio',
  'dias_desde_ultima_compra',
  'score_recompra',
  'risco_churn',
  'score_final',
  'next_best_action',
  'ultimo_pedido',
  'primeiro_pedido',
  'last_interaction_at',
  'last_interaction_type',
  'last_contact_at',
  'responsible_user',
].join(',');

export async function getClientesInteligencia(client, opts) {
  const legacyLimit = typeof opts === 'number' ? opts : null;
  const input = opts && typeof opts === 'object' ? opts : {};
  const pageSize = Math.max(
    1,
    Math.min(500, Number(input.pageSize || (legacyLimit != null ? legacyLimit : 500)) || 500),
  );
  const cursor = input.cursor || null;
  try {
    let q = client.from('vw_clientes_inteligencia').select(CLIENTES_INTEL_COLS).limit(pageSize);
    q = q
      .order('risco_churn', { ascending: false, nullsFirst: false })
      .order('score_recompra', { ascending: false, nullsFirst: false })
      .order('total_gasto', { ascending: false, nullsFirst: false })
      .order('cliente_id', { ascending: true, nullsFirst: false });
    if (cursor) {
      const orFilter = cursorToOrFilter(cursor);
      if (orFilter) q = q.or(orFilter);
    }
    const { data, error } = await q;
    if (error) return { rows: [], nextCursor: null, hasMore: false };
    const rows = Array.isArray(data) ? data : [];
    const nextCursor = pickNextCursor(rows);
    const hasMore = rows.length === pageSize && !!nextCursor;
    return { rows, nextCursor, hasMore };
  } catch (_e) {
    return { rows: [], nextCursor: null, hasMore: false };
  }
}

export function normalizeClienteIntel(row) {
  const r = row && typeof row === 'object' ? row : {};
  const id = asText(firstKey(r, ['cliente_id', 'id', 'customer_id']));
  const nome = asText(firstKey(r, ['nome', 'name']));
  const email = asText(firstKey(r, ['email']));
  const telefone = asText(firstKey(r, ['telefone', 'phone']));
  const celular = asText(firstKey(r, ['celular', 'mobile']));
  const doc = asText(firstKey(r, ['doc', 'documento', 'cpf_cnpj']));
  const cidade = asText(firstKey(r, ['cidade', 'city']));
  const uf = asText(firstKey(r, ['uf', 'estado', 'state'])).toUpperCase();
  const canal =
    asText(firstKey(r, ['canal_principal', 'canal', 'channel'])).toLowerCase() || 'outros';
  const status = asText(firstKey(r, ['status']));
  const segmento = asText(firstKey(r, ['segmento_crm', 'segmento', 'segment']));
  const faixaValor = asText(firstKey(r, ['faixa_valor']));
  const faixaFreq = asText(firstKey(r, ['faixa_frequencia']));
  const pipeline = asText(firstKey(r, ['pipeline_stage']));
  const totalPedidos = asNum(firstKey(r, ['total_pedidos', 'pedidos']));
  const totalGasto = asNum(firstKey(r, ['total_gasto', 'faturamento', 'ltv']));
  const ltv = asNum(firstKey(r, ['ltv', 'total_gasto']));
  const ticket = asNum(firstKey(r, ['ticket_medio']));
  const dias = firstKey(r, ['dias_desde_ultima_compra', 'dias_sem_comprar']);
  const diasUltimaCompra = dias == null ? null : Number(dias);
  const scoreRecompra = asNum(firstKey(r, ['score_recompra']));
  const riscoChurn = asNum(firstKey(r, ['risco_churn']));
  const lastInteractionAt = asText(firstKey(r, ['last_interaction_at']));
  const lastInteractionType = asText(firstKey(r, ['last_interaction_type']));
  const lastInteractionDesc = asText(firstKey(r, ['last_interaction_desc']));
  const lastContactAt = asText(firstKey(r, ['last_contact_at']));
  const responsibleUser = asText(firstKey(r, ['responsible_user', 'user_responsible']));
  const scoreFinal = asNum(firstKey(r, ['score_final']));
  const nextBestAction = asText(firstKey(r, ['next_best_action']));
  const ultimoPedido = asText(firstKey(r, ['ultimo_pedido']));
  const primeiroPedido = asText(firstKey(r, ['primeiro_pedido']));
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
    primeiro_pedido: primeiroPedido,
  };
}
