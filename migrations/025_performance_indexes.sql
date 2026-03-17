-- ============================================================
-- Migration 025: índices de performance para queries do Dashboard
-- ============================================================
-- Problema: as views do dashboard (vw_dashboard_analytics,
-- vw_clientes_inteligencia, vw_funil_recompra, etc.) fazem
-- seq scan em tabelas grandes por falta de índices nas colunas
-- mais usadas em JOIN, GROUP BY, DISTINCT ON e ORDER BY.
-- ============================================================

-- 1. v2_pedidos: cobre JOIN e DISTINCT ON por cliente + data
--    Beneficia: vw_dashboard_analytics (CTE canal_ultima_compra e pedidos_agg),
--               vw_clientes_inteligencia (CTE pedidos_canal e canal_pick),
--               vw_top_cidades
CREATE INDEX IF NOT EXISTS v2_pedidos_cliente_data_idx
  ON public.v2_pedidos (cliente_id, data_pedido DESC NULLS LAST)
  WHERE cliente_id IS NOT NULL;

-- 2. v2_pedidos: cobre JOIN com v2_canais
--    Beneficia: vw_dashboard_v2_daily_channel, vw_clientes_inteligencia,
--               vw_dashboard_analytics
CREATE INDEX IF NOT EXISTS v2_pedidos_canal_id_idx
  ON public.v2_pedidos (canal_id)
  WHERE canal_id IS NOT NULL;

-- 3. v2_clientes: GROUP BY em vw_dashboard_v2_new_customers_daily
CREATE INDEX IF NOT EXISTS v2_clientes_primeiro_pedido_idx
  ON public.v2_clientes (primeiro_pedido)
  WHERE primeiro_pedido IS NOT NULL;

-- 4. v2_clientes: filtros de churn, reativação e funil de recompra
--    Beneficia: vw_funil_recompra, vw_clientes_reativacao,
--               vw_clientes_vip_risco, vw_customer_health_score
CREATE INDEX IF NOT EXISTS v2_clientes_ultimo_pedido_idx
  ON public.v2_clientes (ultimo_pedido DESC NULLS LAST)
  WHERE ultimo_pedido IS NOT NULL;

-- 5. interactions: DISTINCT ON (customer_id) ORDER BY customer_id, created_at DESC
--    usado nas CTEs last_interaction_row e last_contact_row de vw_clientes_inteligencia
--    Sem este índice toda query de timeline faz sort completo da tabela
CREATE INDEX IF NOT EXISTS interactions_customer_created_idx
  ON public.interactions (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

-- 6. v2_pedidos_items: JOIN com v2_pedidos em vw_produtos_favoritos
CREATE INDEX IF NOT EXISTS v2_pedidos_items_pedido_id_idx
  ON public.v2_pedidos_items (pedido_id);
