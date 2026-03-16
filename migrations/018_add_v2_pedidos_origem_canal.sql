DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v2_pedidos'
      AND column_name = 'origem_canal'
  ) THEN
    EXECUTE 'ALTER TABLE public.v2_pedidos ADD COLUMN origem_canal text';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v2_pedidos'
      AND column_name = 'origem_canal_nome'
  ) THEN
    EXECUTE 'ALTER TABLE public.v2_pedidos ADD COLUMN origem_canal_nome text';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v2_pedidos'
      AND column_name = 'tipo_venda'
  ) THEN
    EXECUTE 'ALTER TABLE public.v2_pedidos ADD COLUMN tipo_venda text';
  END IF;
END $$;

UPDATE public.v2_pedidos p
SET
  origem_canal = COALESCE(
    p.origem_canal,
    CASE
      WHEN c.slug = 'ml' THEN 'mercado_livre'
      WHEN c.slug = 'cnpj' THEN 'b2b'
      WHEN c.slug IS NULL OR c.slug = '' THEN 'outros'
      ELSE c.slug
    END
  ),
  origem_canal_nome = COALESCE(
    p.origem_canal_nome,
    CASE
      WHEN c.slug = 'ml' THEN 'Mercado Livre'
      WHEN c.slug = 'cnpj' THEN 'B2B / Atacado'
      WHEN c.slug = 'shopify' THEN 'Shopify / Site próprio'
      WHEN c.slug = 'shopee' THEN 'Shopee'
      WHEN c.slug = 'amazon' THEN 'Amazon'
      WHEN c.slug = 'yampi' THEN 'Yampi'
      ELSE 'Outros'
    END
  ),
  tipo_venda = COALESCE(
    p.tipo_venda,
    CASE
      WHEN c.slug = 'cnpj' THEN 'b2b'
      ELSE 'b2c'
    END
  )
FROM public.v2_canais c
WHERE p.canal_id = c.id
  AND (
    p.origem_canal IS NULL
    OR p.origem_canal_nome IS NULL
    OR p.tipo_venda IS NULL
  );

CREATE INDEX IF NOT EXISTS v2_pedidos_origem_canal_idx ON public.v2_pedidos (origem_canal);
CREATE INDEX IF NOT EXISTS v2_pedidos_tipo_venda_idx ON public.v2_pedidos (tipo_venda);
CREATE INDEX IF NOT EXISTS v2_pedidos_data_pedido_idx ON public.v2_pedidos (data_pedido);
