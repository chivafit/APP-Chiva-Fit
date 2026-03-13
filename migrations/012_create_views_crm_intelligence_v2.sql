ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS celular text;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS pipeline_stage text;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS last_interaction_type text;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS last_interaction_desc text;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS last_contact_at timestamptz;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS responsible_user text;

CREATE OR REPLACE VIEW public.vw_dashboard_kpis AS
SELECT
  COALESCE(sum(COALESCE(p.total, 0)), 0)::numeric AS faturamento_total,
  COALESCE(count(p.*), 0)::int AS total_pedidos,
  (COALESCE(sum(COALESCE(p.total, 0)), 0) / NULLIF(count(p.*), 0))::numeric AS ticket_medio,
  (SELECT count(*)::int FROM public.v2_clientes c)::int AS total_clientes,
  (SELECT avg(COALESCE(c.ltv, c.total_gasto, 0))::numeric FROM public.v2_clientes c)::numeric AS ltv_medio
FROM public.v2_pedidos p
WHERE p.data_pedido IS NOT NULL;

CREATE OR REPLACE VIEW public.vw_clientes_inteligencia AS
WITH pedidos_canal AS (
  SELECT
    p.cliente_id,
    COALESCE(NULLIF(c.slug, ''), 'outros') AS canal_slug,
    count(*)::int AS pedidos,
    max(p.data_pedido) AS ultimo_pedido_canal
  FROM public.v2_pedidos p
  LEFT JOIN public.v2_canais c
    ON c.id = p.canal_id
  WHERE p.cliente_id IS NOT NULL
  GROUP BY 1, 2
),
canal_pick AS (
  SELECT
    cliente_id,
    (array_agg(canal_slug ORDER BY pedidos DESC, ultimo_pedido_canal DESC NULLS LAST))[1] AS canal_principal_calc
  FROM pedidos_canal
  GROUP BY 1
),
last_interaction_row AS (
  SELECT DISTINCT ON (i.customer_id)
    i.customer_id AS cliente_id,
    i.created_at AS last_interaction_at,
    NULLIF(i.type, '') AS last_interaction_type,
    NULLIF(left(COALESCE(i.description, ''), 240), '') AS last_interaction_desc,
    NULLIF(i.user_responsible, '') AS responsible_user
  FROM public.interactions i
  WHERE i.customer_id IS NOT NULL
  ORDER BY i.customer_id, i.created_at DESC
),
last_contact_row AS (
  SELECT DISTINCT ON (i.customer_id)
    i.customer_id AS cliente_id,
    i.created_at AS last_contact_at
  FROM public.interactions i
  WHERE i.customer_id IS NOT NULL
    AND (
      i.type IN ('whatsapp', 'email', 'mensagem_enviada', 'mensagem_recebida')
      OR i.type ILIKE 'mensagem_%'
    )
  ORDER BY i.customer_id, i.created_at DESC
),
base AS (
  SELECT
    c.id AS cliente_id,
    c.doc,
    c.nome,
    c.email,
    c.telefone,
    COALESCE(NULLIF(c.celular, ''), NULLIF(c.telefone, '')) AS celular,
    c.cidade,
    c.uf,
    c.total_pedidos,
    c.total_gasto,
    c.ltv,
    c.ticket_medio,
    c.primeiro_pedido,
    c.ultimo_pedido,
    c.intervalo_medio_dias,
    COALESCE(NULLIF(cp.canal_principal_calc, ''), NULLIF(c.canal_principal, ''), 'outros') AS canal_principal,
    ci.score_final,
    NULLIF(ci.segmento, '') AS segmento_ci,
    NULLIF(ci.next_best_action, '') AS next_best_action,
    lir.last_interaction_at,
    lir.last_interaction_type,
    lir.last_interaction_desc,
    lcr.last_contact_at,
    COALESCE(NULLIF(lir.responsible_user, ''), NULLIF(c.responsible_user, '')) AS responsible_user
  FROM public.v2_clientes c
  LEFT JOIN canal_pick cp
    ON cp.cliente_id = c.id
  LEFT JOIN public.customer_intelligence ci
    ON ci.cliente_id = c.id
  LEFT JOIN last_interaction_row lir
    ON lir.cliente_id = c.id
  LEFT JOIN last_contact_row lcr
    ON lcr.cliente_id = c.id
)
SELECT
  b.cliente_id,
  b.doc,
  b.nome,
  b.email,
  b.telefone,
  b.celular,
  b.cidade,
  b.uf,
  b.total_pedidos,
  b.total_gasto,
  b.ltv,
  b.ticket_medio,
  b.primeiro_pedido,
  b.ultimo_pedido,
  b.intervalo_medio_dias,
  b.canal_principal,
  CASE
    WHEN b.ultimo_pedido IS NULL THEN NULL
    ELSE GREATEST(0, (now()::date - b.ultimo_pedido)::int)
  END AS dias_desde_ultima_compra,
  CASE
    WHEN COALESCE(b.total_pedidos, 0) >= 6 OR COALESCE(b.ltv, b.total_gasto, 0) >= 650 THEN 'VIP'
    WHEN b.ultimo_pedido IS NULL THEN 'Novo Lead'
    WHEN (now()::date - b.ultimo_pedido)::int > 60 THEN 'Churn'
    WHEN (now()::date - b.ultimo_pedido)::int > 30 THEN 'Em Risco'
    WHEN COALESCE(b.total_pedidos, 0) >= 2 THEN 'Recompra'
    ELSE 'Ativo'
  END AS status,
  CASE
    WHEN COALESCE(b.total_pedidos, 0) >= 6 OR COALESCE(b.ltv, b.total_gasto, 0) >= 650 THEN 'vip'
    WHEN b.ultimo_pedido IS NULL THEN 'novo_lead'
    WHEN (now()::date - b.ultimo_pedido)::int > 60 THEN 'reativacao'
    WHEN COALESCE(b.total_pedidos, 0) >= 2 THEN 'recompra'
    ELSE 'primeira_compra'
  END AS pipeline_stage,
  COALESCE(
    b.segmento_ci,
    CASE
      WHEN COALESCE(b.total_pedidos, 0) >= 6 OR COALESCE(b.ltv, b.total_gasto, 0) >= 650 THEN 'VIP'
      WHEN b.ultimo_pedido IS NULL THEN 'Novo'
      WHEN (now()::date - b.ultimo_pedido)::int > 60 THEN 'Churn'
      WHEN (now()::date - b.ultimo_pedido)::int > 30 THEN 'Em Risco'
      ELSE 'Novo'
    END
  ) AS segmento_crm,
  CASE
    WHEN COALESCE(b.total_pedidos, 0) = 0 THEN 'sem_pedidos'
    WHEN COALESCE(b.total_pedidos, 0) = 1 THEN '1x'
    WHEN COALESCE(b.total_pedidos, 0) <= 3 THEN '2-3'
    WHEN COALESCE(b.total_pedidos, 0) <= 6 THEN '4-6'
    ELSE '7+'
  END AS faixa_frequencia,
  CASE
    WHEN COALESCE(b.ltv, b.total_gasto, 0) >= 650 THEN 'vip'
    WHEN COALESCE(b.ltv, b.total_gasto, 0) >= 400 THEN 'alto'
    WHEN COALESCE(b.ltv, b.total_gasto, 0) >= 200 THEN 'medio'
    WHEN COALESCE(b.ltv, b.total_gasto, 0) > 0 THEN 'baixo'
    ELSE 'sem_valor'
  END AS faixa_valor,
  CASE
    WHEN b.ultimo_pedido IS NULL THEN 0
    WHEN COALESCE(b.total_pedidos, 0) < 2 THEN 0
    WHEN COALESCE(b.intervalo_medio_dias, 0) <= 0 THEN 0
    ELSE round(LEAST(100, GREATEST(0, 100 - (((now()::date - b.ultimo_pedido)::numeric / GREATEST(1, b.intervalo_medio_dias)) * 40))))
  END AS score_recompra,
  CASE
    WHEN b.ultimo_pedido IS NULL THEN 0
    WHEN (now()::date - b.ultimo_pedido)::int >= 90 THEN 100
    ELSE round(LEAST(100, GREATEST(0, (((now()::date - b.ultimo_pedido)::numeric) / GREATEST(1, COALESCE(NULLIF(b.intervalo_medio_dias, 0), 45))) * 80)))
  END AS risco_churn,
  b.last_interaction_at,
  b.last_interaction_type,
  b.last_interaction_desc,
  b.last_contact_at,
  b.responsible_user,
  b.score_final,
  b.next_best_action
FROM base b;

CREATE OR REPLACE VIEW public.vw_dashboard_v2_daily AS
SELECT
  p.data_pedido AS dia,
  count(*)::int AS pedidos,
  sum(COALESCE(p.total, 0))::numeric AS faturamento,
  (sum(COALESCE(p.total, 0)) / NULLIF(count(*), 0))::numeric AS ticket_medio
FROM public.v2_pedidos p
WHERE p.data_pedido IS NOT NULL
GROUP BY 1
ORDER BY 1;

CREATE OR REPLACE VIEW public.vw_dashboard_v2_daily_channel AS
SELECT
  p.data_pedido AS dia,
  COALESCE(NULLIF(c.slug, ''), 'outros') AS canal,
  count(*)::int AS pedidos,
  sum(COALESCE(p.total, 0))::numeric AS faturamento
FROM public.v2_pedidos p
LEFT JOIN public.v2_canais c
  ON c.id = p.canal_id
WHERE p.data_pedido IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

CREATE OR REPLACE VIEW public.vw_dashboard_v2_new_customers_daily AS
SELECT
  c.primeiro_pedido AS dia,
  count(*)::int AS novos_clientes
FROM public.v2_clientes c
WHERE c.primeiro_pedido IS NOT NULL
GROUP BY 1
ORDER BY 1;
