ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS celular text;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS pipeline_stage text;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS last_interaction_type text;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS last_interaction_desc text;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS last_contact_at timestamptz;
ALTER TABLE public.v2_clientes ADD COLUMN IF NOT EXISTS responsible_user text;

DROP VIEW IF EXISTS public.vw_dashboard_kpis;
CREATE VIEW public.vw_dashboard_kpis AS
SELECT
  COALESCE(sum(COALESCE(p.total, 0)), 0)::numeric AS faturamento_total,
  COALESCE(count(p.*), 0)::bigint AS total_pedidos,
  (COALESCE(sum(COALESCE(p.total, 0)), 0) / NULLIF(count(p.*), 0))::numeric AS ticket_medio,
  (SELECT count(*)::bigint FROM public.v2_clientes c)::bigint AS total_clientes,
  (SELECT avg(COALESCE(c.ltv, c.total_gasto, 0))::numeric FROM public.v2_clientes c)::numeric AS ltv_medio
FROM public.v2_pedidos p
WHERE p.data_pedido IS NOT NULL;

DROP VIEW IF EXISTS public.vw_clientes_sem_contato;
DROP VIEW IF EXISTS public.vw_clientes_reativacao;
DROP VIEW IF EXISTS public.vw_clientes_vip_risco;
DROP VIEW IF EXISTS public.vw_clientes_inteligencia;
CREATE VIEW public.vw_clientes_inteligencia AS
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
    COALESCE(NULLIF(cp.canal_principal_calc, '')::tipo_canal, c.canal_principal, 'outros'::tipo_canal) AS canal_principal,
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
  (b.total_pedidos::bigint) AS total_pedidos,
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

DROP VIEW IF EXISTS public.vw_dashboard_v2_daily;
CREATE VIEW public.vw_dashboard_v2_daily AS
SELECT
  p.data_pedido AS dia,
  count(*)::bigint AS pedidos,
  sum(COALESCE(p.total, 0))::numeric AS faturamento,
  (sum(COALESCE(p.total, 0)) / NULLIF(count(*), 0))::numeric AS ticket_medio
FROM public.v2_pedidos p
WHERE p.data_pedido IS NOT NULL
GROUP BY 1
ORDER BY 1;

DROP VIEW IF EXISTS public.vw_dashboard_v2_daily_channel;
CREATE VIEW public.vw_dashboard_v2_daily_channel AS
SELECT
  p.data_pedido AS dia,
  COALESCE(NULLIF(c.slug, ''), 'outros') AS canal,
  count(*)::bigint AS pedidos,
  sum(COALESCE(p.total, 0))::numeric AS faturamento
FROM public.v2_pedidos p
LEFT JOIN public.v2_canais c
  ON c.id = p.canal_id
WHERE p.data_pedido IS NOT NULL
GROUP BY 1, 2
ORDER BY 1, 2;

DROP VIEW IF EXISTS public.vw_dashboard_v2_new_customers_daily;
CREATE VIEW public.vw_dashboard_v2_new_customers_daily AS
SELECT
  c.primeiro_pedido AS dia,
  count(*)::bigint AS novos_clientes
FROM public.v2_clientes c
WHERE c.primeiro_pedido IS NOT NULL
GROUP BY 1
ORDER BY 1;

CREATE OR REPLACE VIEW public.vw_funil_recompra AS
WITH base AS (
  SELECT
    c.id AS cliente_id,
    c.ultimo_pedido,
    CASE
      WHEN c.ultimo_pedido IS NULL THEN NULL
      ELSE (now()::date - c.ultimo_pedido)::int
    END AS dias
  FROM public.v2_clientes c
)
SELECT
  s.etapa,
  s.ordem,
  count(*)::int AS clientes
FROM (
  SELECT
    CASE
      WHEN b.dias IS NULL THEN 'Sem compra'
      WHEN b.dias <= 30 THEN 'Ativos (0–30d)'
      WHEN b.dias <= 60 THEN 'Atenção (31–60d)'
      WHEN b.dias <= 120 THEN 'Risco (61–120d)'
      ELSE 'Churn (121+d)'
    END AS etapa,
    CASE
      WHEN b.dias IS NULL THEN 5
      WHEN b.dias <= 30 THEN 1
      WHEN b.dias <= 60 THEN 2
      WHEN b.dias <= 120 THEN 3
      ELSE 4
    END AS ordem
  FROM base b
) s
GROUP BY 1, 2
ORDER BY 2;

DROP VIEW IF EXISTS public.vw_top_cidades;
CREATE VIEW public.vw_top_cidades AS
SELECT
  NULLIF(trim(c.cidade), '') AS cidade,
  upper(NULLIF(trim(c.uf), '')) AS uf,
  count(p.*)::bigint AS pedidos,
  sum(COALESCE(p.total, 0))::numeric AS faturamento,
  count(DISTINCT c.id)::int AS total_clientes
FROM public.v2_pedidos p
JOIN public.v2_clientes c
  ON c.id = p.cliente_id
WHERE p.data_pedido IS NOT NULL
  AND NULLIF(trim(c.cidade), '') IS NOT NULL
GROUP BY 1, 2
ORDER BY faturamento DESC NULLS LAST;

CREATE OR REPLACE VIEW public.vw_produtos_favoritos AS
SELECT
  NULLIF(trim(i.produto_nome), '') AS produto,
  sum(COALESCE(i.quantidade, 0))::numeric AS unidades_vendidas,
  sum(COALESCE(i.valor_total, 0))::numeric AS faturamento,
  count(DISTINCT p.cliente_id)::int AS total_clientes
FROM public.v2_pedidos_items i
JOIN public.v2_pedidos p
  ON p.id = i.pedido_id
GROUP BY 1
ORDER BY faturamento DESC NULLS LAST;

CREATE OR REPLACE VIEW public.vw_clientes_vip_risco AS
SELECT
  v.cliente_id,
  v.nome,
  v.email,
  v.telefone,
  v.celular,
  v.cidade,
  v.uf,
  v.total_pedidos,
  v.total_gasto,
  v.ltv,
  v.dias_desde_ultima_compra,
  v.canal_principal,
  v.risco_churn
FROM public.vw_clientes_inteligencia v
WHERE (COALESCE(v.ltv, v.total_gasto, 0) >= 650 OR COALESCE(v.total_pedidos, 0) >= 6)
  AND COALESCE(v.dias_desde_ultima_compra, 0) >= 30
  AND COALESCE(v.dias_desde_ultima_compra, 0) <= 120
ORDER BY v.dias_desde_ultima_compra DESC NULLS LAST, COALESCE(v.ltv, v.total_gasto, 0) DESC NULLS LAST;

CREATE OR REPLACE VIEW public.vw_clientes_reativacao AS
SELECT
  v.cliente_id,
  v.nome,
  v.email,
  v.telefone,
  v.celular,
  v.cidade,
  v.uf,
  v.total_pedidos,
  v.total_gasto,
  v.ltv,
  v.dias_desde_ultima_compra,
  v.canal_principal,
  v.risco_churn
FROM public.vw_clientes_inteligencia v
WHERE COALESCE(v.dias_desde_ultima_compra, 0) >= 61
  AND COALESCE(v.dias_desde_ultima_compra, 0) <= 120
ORDER BY COALESCE(v.ltv, v.total_gasto, 0) DESC NULLS LAST, v.dias_desde_ultima_compra DESC NULLS LAST;

CREATE OR REPLACE VIEW public.vw_clientes_sem_contato AS
SELECT
  v.cliente_id,
  v.nome,
  v.email,
  v.telefone,
  v.celular,
  v.cidade,
  v.uf,
  v.total_pedidos,
  v.total_gasto,
  v.ltv,
  v.dias_desde_ultima_compra,
  v.canal_principal,
  v.last_contact_at,
  v.responsible_user,
  CASE
    WHEN NULLIF(trim(COALESCE(v.celular, v.telefone)), '') IS NULL AND NULLIF(trim(v.email), '') IS NULL THEN 'sem whatsapp/email'
    WHEN v.last_contact_at IS NULL THEN 'sem contato registrado'
    WHEN v.last_contact_at < (now() - interval '30 days') THEN '30+ dias sem contato'
    ELSE '—'
  END AS motivo
FROM public.vw_clientes_inteligencia v
WHERE (
  (NULLIF(trim(COALESCE(v.celular, v.telefone)), '') IS NULL AND NULLIF(trim(v.email), '') IS NULL)
  OR v.last_contact_at IS NULL
  OR v.last_contact_at < (now() - interval '30 days')
)
ORDER BY COALESCE(v.ltv, v.total_gasto, 0) DESC NULLS LAST, v.dias_desde_ultima_compra DESC NULLS LAST;
