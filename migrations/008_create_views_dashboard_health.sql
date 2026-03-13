CREATE OR REPLACE VIEW public.vw_dashboard_revenue_growth AS
SELECT
  EXTRACT(YEAR FROM p.data_pedido)::int AS ano,
  EXTRACT(MONTH FROM p.data_pedido)::int AS mes_num,
  to_char(date_trunc('month', p.data_pedido), 'YYYY-MM') AS periodo,
  count(*)::int AS pedidos,
  sum(COALESCE(p.total, 0))::numeric AS faturamento,
  (sum(COALESCE(p.total, 0)) / NULLIF(count(*), 0))::numeric AS ticket_medio
FROM public.v2_pedidos p
WHERE p.data_pedido IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 2 DESC;

CREATE OR REPLACE VIEW public.vw_customer_health_score AS
WITH base AS (
  SELECT
    c.id AS cliente_id,
    c.doc,
    c.nome,
    c.email,
    c.telefone,
    c.cidade,
    c.uf,
    c.total_pedidos,
    c.total_gasto,
    c.ltv,
    c.ultimo_pedido,
    CASE
      WHEN c.ultimo_pedido IS NULL THEN NULL
      ELSE GREATEST(0, (now()::date - c.ultimo_pedido)::int)
    END AS dias_sem_comprar,
    ci.score_final,
    NULLIF(ci.segmento, '') AS segmento_ci,
    NULLIF(ci.next_best_action, '') AS next_best_action
  FROM public.v2_clientes c
  LEFT JOIN public.customer_intelligence ci
    ON ci.cliente_id = c.id
)
SELECT
  b.cliente_id,
  b.doc,
  b.nome,
  b.email,
  b.telefone,
  b.cidade,
  b.uf,
  b.total_pedidos,
  b.total_gasto,
  b.ltv,
  b.ultimo_pedido,
  b.dias_sem_comprar,
  COALESCE(
    b.segmento_ci,
    CASE
      WHEN COALESCE(b.ltv, b.total_gasto, 0) >= 650 OR COALESCE(b.total_pedidos, 0) >= 6 THEN 'VIP'
      WHEN b.ultimo_pedido IS NULL THEN 'Novo'
      WHEN b.dias_sem_comprar > 60 THEN 'Churn'
      WHEN b.dias_sem_comprar > 30 THEN 'Em Risco'
      ELSE 'Novo'
    END
  ) AS segmento,
  COALESCE(
    b.segmento_ci,
    CASE
      WHEN COALESCE(b.ltv, b.total_gasto, 0) >= 650 OR COALESCE(b.total_pedidos, 0) >= 6 THEN 'VIP'
      WHEN b.ultimo_pedido IS NULL THEN 'Novo'
      WHEN b.dias_sem_comprar > 60 THEN 'Churn'
      WHEN b.dias_sem_comprar > 30 THEN 'Em Risco'
      ELSE 'Novo'
    END
  ) AS status_saude,
  b.score_final,
  b.next_best_action
FROM base b;
