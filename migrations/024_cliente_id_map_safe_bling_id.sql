ALTER TABLE public.v2_clientes
  ADD COLUMN IF NOT EXISTS bling_id text;

CREATE TABLE IF NOT EXISTS public.cliente_id_map (
  cliente_id uuid PRIMARY KEY REFERENCES public.v2_clientes(id) ON DELETE CASCADE,
  bling_id text NOT NULL,
  nome_normalizado text NOT NULL,
  contato_nome_normalizado text NOT NULL,
  evidence_orders integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'bling_csv',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  validated_by text
);

WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY bling_id
      ORDER BY evidence_orders DESC, created_at DESC, cliente_id
    ) AS rn
  FROM public.cliente_id_map
)
DELETE FROM public.cliente_id_map m
USING ranked r
WHERE r.ctid = m.ctid
  AND r.rn > 1;

DROP INDEX IF EXISTS public.cliente_id_map_bling_id_uniq;
CREATE UNIQUE INDEX cliente_id_map_bling_id_uniq
  ON public.cliente_id_map (bling_id);

CREATE INDEX IF NOT EXISTS cliente_id_map_nome_normalizado_idx
  ON public.cliente_id_map (nome_normalizado);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'stg_bling_csv_pedidos_itens'
  ) THEN
    WITH stg_orders AS (
      SELECT DISTINCT ON (coalesce(nullif(trim(s.bling_id), ''), nullif(trim(s.numero_pedido), '')))
        coalesce(nullif(trim(s.bling_id), ''), nullif(trim(s.numero_pedido), '')) AS pedido_id,
        nullif(trim(s.contato_id), '') AS contato_id,
        nullif(trim(s.contato_nome), '') AS contato_nome
      FROM public.stg_bling_csv_pedidos_itens s
      WHERE nullif(trim(s.contato_id), '') IS NOT NULL
        AND coalesce(nullif(trim(s.bling_id), ''), nullif(trim(s.numero_pedido), '')) IS NOT NULL
      ORDER BY coalesce(nullif(trim(s.bling_id), ''), nullif(trim(s.numero_pedido), '')), s.row_num DESC NULLS LAST
    ),
    cand AS (
      SELECT
        p.cliente_id,
        so.contato_id AS bling_id,
        lower(trim(c.nome)) AS nome_normalizado,
        lower(trim(so.contato_nome)) AS contato_nome_normalizado
      FROM public.v2_pedidos p
      JOIN stg_orders so
        ON so.pedido_id = COALESCE(NULLIF(trim(p.bling_id), ''), NULLIF(trim(p.numero_pedido), ''), (p.id)::text)
      JOIN public.v2_clientes c
        ON c.id = p.cliente_id
      WHERE p.cliente_id IS NOT NULL
        AND so.contato_id IS NOT NULL
        AND so.contato_nome IS NOT NULL
        AND nullif(trim(c.nome), '') IS NOT NULL
    ),
    named AS (
      SELECT *
      FROM cand
      WHERE nome_normalizado = contato_nome_normalizado
        AND nome_normalizado <> ''
    ),
    pairs AS (
      SELECT
        cliente_id,
        bling_id,
        nome_normalizado,
        contato_nome_normalizado,
        count(*)::int AS evidence_orders
      FROM named
      GROUP BY 1,2,3,4
    ),
    cliente_unico AS (
      SELECT cliente_id
      FROM pairs
      GROUP BY 1
      HAVING count(DISTINCT bling_id) = 1
    ),
    bling_unico AS (
      SELECT bling_id
      FROM pairs
      GROUP BY 1
      HAVING count(DISTINCT cliente_id) = 1
    ),
    final_rows AS (
      SELECT p.*
      FROM pairs p
      JOIN cliente_unico cu
        ON cu.cliente_id = p.cliente_id
      JOIN bling_unico bu
        ON bu.bling_id = p.bling_id
    )
    INSERT INTO public.cliente_id_map (
      cliente_id,
      bling_id,
      nome_normalizado,
      contato_nome_normalizado,
      evidence_orders,
      source,
      status
    )
    SELECT
      f.cliente_id,
      f.bling_id,
      f.nome_normalizado,
      f.contato_nome_normalizado,
      f.evidence_orders,
      'bling_csv',
      'pending'
    FROM final_rows f
    ON CONFLICT (cliente_id) DO UPDATE
      SET bling_id = EXCLUDED.bling_id,
          nome_normalizado = EXCLUDED.nome_normalizado,
          contato_nome_normalizado = EXCLUDED.contato_nome_normalizado,
          evidence_orders = EXCLUDED.evidence_orders,
          source = EXCLUDED.source
      WHERE public.cliente_id_map.status = 'pending';
  END IF;
END $$;

