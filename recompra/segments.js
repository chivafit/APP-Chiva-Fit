/**
 * MÓDULO: Segmentos de Clientes
 * Carrega e atualiza contagens dos segmentos automáticos
 * usando as views e tabelas existentes do CRM.
 */

import { recompraState } from './recompra.js';

// ─── Queries por segmento automático ─────────────────────────
const SEGMENT_QUERIES = {
  vw_clientes_vip_risco: async (supaClient) => {
    const { count } = await supaClient
      .from('vw_clientes_vip_risco')
      .select('*', { count: 'exact', head: true });
    return count || 0;
  },

  vw_clientes_inteligencia_recompra: async (supaClient) => {
    const { count } = await supaClient
      .from('vw_clientes_inteligencia')
      .select('*', { count: 'exact', head: true })
      .in('next_best_action', ['sugerir_recompra', 'oferta_kit'])
      .gte('score_final', 60);
    return count || 0;
  },

  vw_clientes_inteligencia_reativ: async (supaClient) => {
    const { count } = await supaClient
      .from('vw_clientes_inteligencia')
      .select('*', { count: 'exact', head: true })
      .eq('next_best_action', 'reativar_sem_desconto');
    return count || 0;
  },

  vw_clientes_inteligencia_cupom: async (supaClient) => {
    const { count } = await supaClient
      .from('vw_clientes_inteligencia')
      .select('*', { count: 'exact', head: true })
      .eq('next_best_action', 'reativacao_com_cupom');
    return count || 0;
  },

  carrinhos_abandonados: async (supaClient) => {
    const { count } = await supaClient
      .from('carrinhos_abandonados')
      .select('*', { count: 'exact', head: true })
      .eq('recuperado', false)
      .gte('score_recuperacao', 50);
    return count || 0;
  },

  vw_clientes_inteligencia_assinatura: async (supaClient) => {
    const { count } = await supaClient
      .from('vw_clientes_inteligencia')
      .select('*', { count: 'exact', head: true })
      .eq('next_best_action', 'oferecer_assinatura');
    return count || 0;
  },
};

// ─── Inicialização: atualiza contagens dos segmentos ─────────
export async function initSegments(ctx) {
  const { supaClient } = ctx;

  const { data: segments } = await supaClient
    .from('customer_segments')
    .select('*')
    .eq('tipo', 'automatico')
    .order('nome');

  if (!segments) return;

  // Mapeia segmento → query de contagem
  const sourceMap = {
    'VIP em Risco': 'vw_clientes_vip_risco',
    'Recompra Provável': 'vw_clientes_inteligencia_recompra',
    'Reativação sem Cupom': 'vw_clientes_inteligencia_reativ',
    'Reativação com Cupom': 'vw_clientes_inteligencia_cupom',
    'Carrinhos Abandonados': 'carrinhos_abandonados',
    'Assinatura Potencial': 'vw_clientes_inteligencia_assinatura',
  };

  const updates = [];
  for (const seg of segments) {
    const queryKey = sourceMap[seg.nome];
    if (!queryKey || !SEGMENT_QUERIES[queryKey]) continue;

    try {
      const count = await SEGMENT_QUERIES[queryKey](supaClient);
      updates.push(
        supaClient
          .from('customer_segments')
          .update({ customer_count: count, ultima_contagem: new Date().toISOString() })
          .eq('id', seg.id)
      );
    } catch (e) {
      console.warn(`[segments] Erro ao contar segmento ${seg.nome}:`, e);
    }
  }

  await Promise.allSettled(updates.map(u => u));
}

// ─── Carrega clientes de um segmento para campanha ───────────
export async function loadSegmentClientes(supaClient, segment, limit = 500) {
  const rules = segment.regras || {};
  const source = rules.source;

  if (source === 'carrinhos_abandonados') {
    const { data } = await supaClient
      .from('carrinhos_abandonados')
      .select('telefone, cliente_nome, valor, produtos, score_recuperacao')
      .eq('recuperado', false)
      .gte('score_recuperacao', rules.score_min || 50)
      .order('score_recuperacao', { ascending: false })
      .limit(limit);

    return (data || []).map(c => ({
      id: null,
      nome: c.cliente_nome,
      telefone: c.telefone,
      ticket_medio: c.valor,
      _source: 'carrinho',
      _raw: c,
    }));
  }

  if (source === 'vw_clientes_vip_risco') {
    const { data } = await supaClient
      .from('vw_clientes_vip_risco')
      .select('id, nome, telefone, total_gasto, ticket_medio, total_pedidos, ultimo_pedido, score_final')
      .limit(limit);
    return data || [];
  }

  // Default: vw_clientes_inteligencia
  let query = supaClient
    .from('vw_clientes_inteligencia')
    .select('id, nome, telefone, total_gasto, ticket_medio, total_pedidos, ultimo_pedido, score_final, next_best_action, segmento')
    .order('score_final', { ascending: false })
    .limit(limit);

  if (rules.next_best_action) {
    query = query.eq('next_best_action', rules.next_best_action);
  }
  if (rules.next_best_action_in) {
    query = query.in('next_best_action', rules.next_best_action_in);
  }
  if (rules.score_min) {
    query = query.gte('score_final', rules.score_min);
  }

  const { data } = await query;
  return data || [];
}

// ─── Atualiza contagem de um segmento específico ─────────────
export async function refreshSegmentCount(supaClient, segmentId) {
  const { data: seg } = await supaClient
    .from('customer_segments')
    .select('*')
    .eq('id', segmentId)
    .maybeSingle();

  if (!seg) return 0;

  const clientes = await loadSegmentClientes(supaClient, seg, 1000);
  const count = clientes.length;

  await supaClient
    .from('customer_segments')
    .update({ customer_count: count, ultima_contagem: new Date().toISOString() })
    .eq('id', segmentId);

  return count;
}
