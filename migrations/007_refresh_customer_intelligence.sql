CREATE OR REPLACE FUNCTION public.refresh_customer_intelligence()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  has_pedidos_bling boolean;
  has_pedidos_bling_raw boolean;
BEGIN
  SELECT to_regclass('public.pedidos_bling') IS NOT NULL INTO has_pedidos_bling;
  IF has_pedidos_bling THEN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pedidos_bling'
        AND column_name = 'raw'
        AND data_type IN ('json', 'jsonb')
    )
    INTO has_pedidos_bling_raw;
  ELSE
    has_pedidos_bling_raw := false;
  END IF;

  IF has_pedidos_bling AND has_pedidos_bling_raw THEN
    WITH ords AS (
      SELECT
        regexp_replace(
          COALESCE(
            pedidos_bling.raw->'contato'->>'cpfCnpj',
            pedidos_bling.raw->'contato'->>'numeroDocumento',
            pedidos_bling.raw->'contato'->>'cpf',
            pedidos_bling.raw->'contato'->>'cnpj',
            ''
          ),
          '\D',
          '',
          'g'
        ) AS doc_digits,
        lower(COALESCE(pedidos_bling.raw->'contato'->>'email', '')) AS email,
        regexp_replace(
          COALESCE(
            pedidos_bling.raw->'contato'->>'telefone',
            pedidos_bling.raw->'contato'->>'celular',
            ''
          ),
          '\D',
          '',
          'g'
        ) AS telefone,
        NULLIF(trim(COALESCE(pedidos_bling.raw->'contato'->>'nome', '')), '') AS nome,
        COALESCE(
          NULLIF(left(COALESCE(pedidos_bling.raw->>'data', pedidos_bling.raw->>'dataPedido', pedidos_bling.raw->>'dataEmissao', ''), 10), '')::date,
          pedidos_bling.created_at::date,
          now()::date
        ) AS data_pedido,
        COALESCE(
          NULLIF(pedidos_bling.raw->>'total', '')::numeric,
          NULLIF(pedidos_bling.raw->>'totalProdutos', '')::numeric,
          0
        ) AS total
      FROM public.pedidos_bling
      WHERE pedidos_bling.raw IS NOT NULL
    ),
    agg AS (
      SELECT
        COALESCE(
          NULLIF(doc_digits, ''),
          NULLIF(email, ''),
          NULLIF(telefone, '')
        ) AS doc,
        max(nome) FILTER (WHERE nome IS NOT NULL AND nome <> '') AS nome,
        max(email) FILTER (WHERE email IS NOT NULL AND email <> '') AS email,
        max(telefone) FILTER (WHERE telefone IS NOT NULL AND telefone <> '') AS telefone,
        min(data_pedido) AS primeiro_pedido,
        max(data_pedido) AS ultimo_pedido,
        count(*)::integer AS total_pedidos,
        sum(total)::numeric AS total_gasto,
        (sum(total) / NULLIF(count(*), 0))::numeric AS ticket_medio
      FROM ords
      WHERE COALESCE(NULLIF(doc_digits, ''), NULLIF(email, ''), NULLIF(telefone, '')) IS NOT NULL
      GROUP BY 1
    )
    INSERT INTO public.v2_clientes (
      doc,
      nome,
      email,
      telefone,
      primeiro_pedido,
      ultimo_pedido,
      total_pedidos,
      total_gasto,
      ltv,
      ticket_medio,
      updated_at
    )
    SELECT
      a.doc,
      COALESCE(a.nome, 'Desconhecido'),
      CASE WHEN position('@' in a.doc) > 0 THEN a.doc ELSE a.email END,
      CASE WHEN a.doc ~ '^[0-9]{10,}$' THEN a.doc ELSE a.telefone END,
      a.primeiro_pedido,
      a.ultimo_pedido,
      a.total_pedidos,
      a.total_gasto,
      a.total_gasto,
      a.ticket_medio,
      now()
    FROM agg a
    ON CONFLICT (doc) DO UPDATE SET
      nome = EXCLUDED.nome,
      email = COALESCE(EXCLUDED.email, public.v2_clientes.email),
      telefone = COALESCE(EXCLUDED.telefone, public.v2_clientes.telefone),
      primeiro_pedido = LEAST(public.v2_clientes.primeiro_pedido, EXCLUDED.primeiro_pedido),
      ultimo_pedido = GREATEST(public.v2_clientes.ultimo_pedido, EXCLUDED.ultimo_pedido),
      total_pedidos = EXCLUDED.total_pedidos,
      total_gasto = EXCLUDED.total_gasto,
      ltv = EXCLUDED.ltv,
      ticket_medio = EXCLUDED.ticket_medio,
      updated_at = now();

    WITH cli AS (
      SELECT
        c.id AS cliente_id,
        c.doc,
        c.total_pedidos,
        c.total_gasto,
        c.ltv,
        c.ultimo_pedido,
        GREATEST(0, (now()::date - c.ultimo_pedido)::integer) AS recencia_dias
      FROM public.v2_clientes c
      WHERE c.doc IS NOT NULL AND c.doc <> ''
    ),
    scored AS (
      SELECT
        cli.cliente_id,
        cli.recencia_dias,
        cli.total_pedidos,
        cli.ltv,
        LEAST(100, GREATEST(0, 100 - (cli.recencia_dias * 2)))::numeric AS recencia_score,
        LEAST(100, GREATEST(0, cli.total_pedidos * 10))::numeric AS freq_score,
        LEAST(100, GREATEST(0, ln(GREATEST(1, cli.ltv + 1)) * 18))::numeric AS ltv_score
      FROM cli
      WHERE cli.ultimo_pedido IS NOT NULL
    ),
    final AS (
      SELECT
        s.cliente_id,
        round((s.recencia_score * 0.5) + (s.freq_score * 0.3) + (s.ltv_score * 0.2))::numeric AS score_final,
        CASE
          WHEN s.ltv >= 500 OR s.total_pedidos >= 6 THEN 'VIP'
          WHEN s.recencia_dias > 60 THEN 'Churn'
          WHEN s.recencia_dias > 30 THEN 'Em Risco'
          ELSE 'Novo'
        END AS segmento,
        CASE
          WHEN s.recencia_dias > 60 THEN 'Reativar com oferta forte + mensagem pessoal'
          WHEN s.recencia_dias > 30 THEN 'Enviar cupom de desconto'
          WHEN s.ltv >= 500 OR s.total_pedidos >= 6 THEN 'Oferta VIP: lançamento/kit exclusivo'
          ELSE 'Boas-vindas + sugestão do best-seller'
        END AS next_best_action
      FROM scored s
    )
    INSERT INTO public.customer_intelligence (cliente_id, score_final, next_best_action, segmento, perfil_compra, updated_at)
    SELECT
      f.cliente_id,
      f.score_final,
      f.next_best_action,
      f.segmento,
      NULL,
      now()
    FROM final f
    ON CONFLICT (cliente_id) DO UPDATE SET
      score_final = EXCLUDED.score_final,
      next_best_action = EXCLUDED.next_best_action,
      segmento = EXCLUDED.segmento,
      perfil_compra = EXCLUDED.perfil_compra,
      updated_at = now();
  END IF;
END $$;
