CREATE OR REPLACE VIEW public.vw_dashboard_analytics AS
WITH pedidos_agg AS (
  SELECT
    p.cliente_id,
    count(*)::bigint AS total_pedidos,
    sum(COALESCE(p.total, 0))::numeric AS receita_total,
    max(p.data_pedido) AS ultima_compra_em
  FROM public.v2_pedidos p
  WHERE p.cliente_id IS NOT NULL
    AND p.data_pedido IS NOT NULL
  GROUP BY 1
),
canal_ultima_compra AS (
  SELECT DISTINCT ON (p.cliente_id)
    p.cliente_id,
    COALESCE(NULLIF(c.slug, ''), 'outros') AS canal_ultima_compra
  FROM public.v2_pedidos p
  LEFT JOIN public.v2_canais c
    ON c.id = p.canal_id
  WHERE p.cliente_id IS NOT NULL
    AND p.data_pedido IS NOT NULL
  ORDER BY p.cliente_id, p.data_pedido DESC NULLS LAST
),
base AS (
  SELECT
    c.id AS cliente_id,
    NULLIF(c.nome, '') AS nome,
    NULLIF(c.email, '') AS email,
    NULLIF(c.telefone, '') AS telefone,
    NULLIF(c.celular, '') AS celular,
    NULLIF(c.cidade, '') AS cidade,
    upper(NULLIF(c.uf, '')) AS uf,
    COALESCE(NULLIF((c.canal_principal)::text, ''), cu.canal_ultima_compra, 'outros') AS canal_principal,
    COALESCE(pa.total_pedidos, c.total_pedidos, 0)::bigint AS total_pedidos,
    COALESCE(pa.receita_total, c.total_gasto, 0)::numeric AS receita_total,
    COALESCE(NULLIF(c.ltv, 0), NULLIF(c.total_gasto, 0), NULLIF(pa.receita_total, 0), 0)::numeric AS ltv_base,
    pa.ultima_compra_em,
    c.primeiro_pedido,
    c.ultimo_pedido,
    c.status,
    c.score_recompra,
    c.risco_churn,
    c.last_contact_at,
    c.responsible_user,
    ci.segmento AS segmento_crm,
    ci.next_best_action
  FROM public.v2_clientes c
  LEFT JOIN pedidos_agg pa
    ON pa.cliente_id = c.id
  LEFT JOIN canal_ultima_compra cu
    ON cu.cliente_id = c.id
  LEFT JOIN public.customer_intelligence ci
    ON ci.cliente_id = c.id
)
SELECT
  b.cliente_id,
  b.nome,
  b.email,
  b.telefone,
  b.celular,
  b.cidade,
  b.uf,
  b.canal_principal,
  b.total_pedidos,
  b.receita_total,
  (b.receita_total / NULLIF(b.total_pedidos, 0))::numeric AS ticket_medio,
  b.ltv_base AS ltv_medio,
  (
    CASE
      WHEN b.total_pedidos <= 0 THEN NULL
      ELSE (GREATEST(b.total_pedidos - 1, 0)::numeric / b.total_pedidos::numeric) * 100
    END
  )::numeric AS percentual_recompra,
  b.ultima_compra_em,
  (
    CASE
      WHEN b.ultima_compra_em IS NULL THEN NULL
      ELSE GREATEST(0, (now()::date - b.ultima_compra_em)::int)
    END
  ) AS dias_sem_comprar,
  b.status,
  b.score_recompra,
  b.risco_churn,
  NULLIF(b.segmento_crm, '') AS segmento_crm,
  NULLIF(b.next_best_action, '') AS next_best_action,
  b.last_contact_at,
  NULLIF(b.responsible_user, '') AS responsible_user,
  count(*) OVER ()::bigint AS kpi_total_clientes,
  sum(b.total_pedidos) OVER ()::bigint AS kpi_total_pedidos,
  sum(b.receita_total) OVER ()::numeric AS kpi_receita_total,
  (sum(b.receita_total) OVER () / NULLIF(sum(b.total_pedidos) OVER (), 0))::numeric AS kpi_ticket_medio,
  avg(COALESCE(NULLIF(b.receita_total, 0), 0)) OVER ()::numeric AS kpi_ltv_medio,
  (
    (sum(CASE WHEN b.total_pedidos > 1 THEN 1 ELSE 0 END) OVER ()::numeric)
    / NULLIF(count(*) OVER ()::numeric, 0)
  )::numeric * 100 AS kpi_percentual_recompra
FROM base b;

