CREATE OR REPLACE FUNCTION public.calculate_risco_churn(
  dias_ultima_compra integer,
  total_pedidos bigint,
  ticket_medio numeric
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN dias_ultima_compra IS NULL THEN 0
      WHEN dias_ultima_compra <= 0 THEN 0
      ELSE LEAST(
        100,
        GREATEST(
          0,
          round(
            LEAST(100, GREATEST(0, (dias_ultima_compra::numeric / 90) * 100))
            - CASE
                WHEN COALESCE(total_pedidos, 0) >= 6 THEN 25
                WHEN COALESCE(total_pedidos, 0) >= 3 THEN 10
                ELSE 0
              END
            - CASE
                WHEN COALESCE(ticket_medio, 0) >= 300 THEN 10
                WHEN COALESCE(ticket_medio, 0) >= 150 THEN 5
                ELSE 0
              END
          )::int
        )
      )
    END;
$$;

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
),
derived AS (
  SELECT
    b.*,
    CASE
      WHEN b.ultimo_pedido IS NULL THEN NULL
      ELSE GREATEST(0, (now()::date - b.ultimo_pedido)::int)
    END AS dias_desde_ultima_compra
  FROM base b
)
SELECT
  d.cliente_id,
  d.doc,
  d.nome,
  d.email,
  d.telefone,
  d.celular,
  d.cidade,
  d.uf,
  (d.total_pedidos::bigint) AS total_pedidos,
  d.total_gasto,
  d.ltv,
  d.ticket_medio,
  d.primeiro_pedido,
  d.ultimo_pedido,
  d.intervalo_medio_dias,
  d.canal_principal,
  d.dias_desde_ultima_compra,
  CASE
    WHEN COALESCE(d.total_pedidos, 0) >= 6 OR COALESCE(d.ltv, d.total_gasto, 0) >= 650 THEN 'VIP'
    WHEN d.ultimo_pedido IS NULL THEN 'Novo Lead'
    WHEN (now()::date - d.ultimo_pedido)::int > 60 THEN 'Churn'
    WHEN (now()::date - d.ultimo_pedido)::int > 30 THEN 'Em Risco'
    WHEN COALESCE(d.total_pedidos, 0) >= 2 THEN 'Recompra'
    ELSE 'Ativo'
  END AS status,
  CASE
    WHEN COALESCE(d.total_pedidos, 0) >= 6 OR COALESCE(d.ltv, d.total_gasto, 0) >= 650 THEN 'vip'
    WHEN d.ultimo_pedido IS NULL THEN 'novo_lead'
    WHEN (now()::date - d.ultimo_pedido)::int > 60 THEN 'reativacao'
    WHEN COALESCE(d.total_pedidos, 0) >= 2 THEN 'recompra'
    ELSE 'primeira_compra'
  END AS pipeline_stage,
  COALESCE(
    d.segmento_ci,
    CASE
      WHEN COALESCE(d.total_pedidos, 0) >= 6 OR COALESCE(d.ltv, d.total_gasto, 0) >= 650 THEN 'VIP'
      WHEN d.ultimo_pedido IS NULL THEN 'Novo'
      WHEN (now()::date - d.ultimo_pedido)::int > 60 THEN 'Churn'
      WHEN (now()::date - d.ultimo_pedido)::int > 30 THEN 'Em Risco'
      ELSE 'Novo'
    END
  ) AS segmento_crm,
  CASE
    WHEN COALESCE(d.total_pedidos, 0) = 0 THEN 'sem_pedidos'
    WHEN COALESCE(d.total_pedidos, 0) = 1 THEN '1x'
    WHEN COALESCE(d.total_pedidos, 0) <= 3 THEN '2-3'
    WHEN COALESCE(d.total_pedidos, 0) <= 6 THEN '4-6'
    ELSE '7+'
  END AS faixa_frequencia,
  CASE
    WHEN COALESCE(d.ltv, d.total_gasto, 0) >= 650 THEN 'vip'
    WHEN COALESCE(d.ltv, d.total_gasto, 0) >= 400 THEN 'alto'
    WHEN COALESCE(d.ltv, d.total_gasto, 0) >= 200 THEN 'medio'
    WHEN COALESCE(d.ltv, d.total_gasto, 0) > 0 THEN 'baixo'
    ELSE 'sem_valor'
  END AS faixa_valor,
  CASE
    WHEN d.ultimo_pedido IS NULL THEN 0
    WHEN COALESCE(d.total_pedidos, 0) < 2 THEN 0
    WHEN COALESCE(d.intervalo_medio_dias, 0) <= 0 THEN 0
    ELSE round(LEAST(100, GREATEST(0, 100 - (((now()::date - d.ultimo_pedido)::numeric / GREATEST(1, d.intervalo_medio_dias)) * 40))))
  END AS score_recompra,
  public.calculate_risco_churn(d.dias_desde_ultima_compra, d.total_pedidos::bigint, d.ticket_medio) AS risco_churn,
  d.last_interaction_at,
  d.last_interaction_type,
  d.last_interaction_desc,
  d.last_contact_at,
  d.responsible_user,
  d.score_final,
  d.next_best_action
FROM derived d;

CREATE VIEW public.vw_clientes_vip_risco AS
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

CREATE VIEW public.vw_clientes_reativacao AS
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

CREATE VIEW public.vw_clientes_sem_contato AS
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
