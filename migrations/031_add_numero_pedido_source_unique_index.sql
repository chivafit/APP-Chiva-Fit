-- ==============================================================================
-- Migration 031: Índice único em (numero_pedido, source) para v2_pedidos
-- Necessário para upsert de pedidos Yampi quando v2_pedidos.id é UUID.
-- Quando id é UUID o onConflict deve usar uma chave de negócio estável.
-- ==============================================================================

DO $$
BEGIN
  -- Remove duplicatas por (numero_pedido, source) antes de criar o índice
  -- Preserva a linha mais recente (maior ctid)
  DELETE FROM public.v2_pedidos a
  USING public.v2_pedidos b
  WHERE a.ctid < b.ctid
    AND a.numero_pedido = b.numero_pedido
    AND a.source = b.source
    AND a.numero_pedido IS NOT NULL
    AND a.source IS NOT NULL;

  -- Cria índice único parcial em (numero_pedido, source)
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'v2_pedidos'
      AND indexname  = 'v2_pedidos_numero_source_unique_idx'
  ) THEN
    CREATE UNIQUE INDEX v2_pedidos_numero_source_unique_idx
      ON public.v2_pedidos (numero_pedido, source)
      WHERE numero_pedido IS NOT NULL AND source IS NOT NULL;
    RAISE NOTICE 'v2_pedidos: índice único (numero_pedido, source) criado.';
  ELSE
    RAISE NOTICE 'v2_pedidos: índice único (numero_pedido, source) já existe.';
  END IF;
END $$;
