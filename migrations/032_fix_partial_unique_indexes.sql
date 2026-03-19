-- ==============================================================================
-- Migration 032: Substituir índices únicos PARCIAIS por COMPLETOS
--
-- Causa raiz: PostgREST gera "ON CONFLICT (col)" sem cláusula WHERE.
-- O PostgreSQL exige que o WHERE do índice parcial seja repetido no ON CONFLICT.
-- Como o Supabase JS client não suporta isso, índices parciais causam HTTP 400.
--
-- Índices afetados (criados em 029 e 031 como parciais):
--   - v2_pedidos_bling_id_unique_idx        → WHERE bling_id IS NOT NULL
--   - v2_pedidos_numero_source_unique_idx   → WHERE numero_pedido IS NOT NULL ...
--
-- Solução: recriar como índices completos.
-- PostgreSQL trata NULLs como distintos em UNIQUE INDEX, então múltiplos NULLs
-- são permitidos — sem impacto em linhas existentes.
-- ==============================================================================

-- -----------------------------------------------------------------------
-- 1. bling_id: remover parcial e criar completo
-- -----------------------------------------------------------------------
DROP INDEX IF EXISTS public.v2_pedidos_bling_id_unique_idx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'v2_pedidos'
      AND indexname  = 'v2_pedidos_bling_id_uidx'
  ) THEN
    CREATE UNIQUE INDEX v2_pedidos_bling_id_uidx
      ON public.v2_pedidos (bling_id);
    RAISE NOTICE 'v2_pedidos: índice único COMPLETO criado em bling_id.';
  ELSE
    RAISE NOTICE 'v2_pedidos: índice único em bling_id já existe.';
  END IF;
END $$;

-- -----------------------------------------------------------------------
-- 2. (numero_pedido, source): remover parcial e criar completo
-- -----------------------------------------------------------------------
DROP INDEX IF EXISTS public.v2_pedidos_numero_source_unique_idx;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'v2_pedidos'
      AND indexname  = 'v2_pedidos_numero_source_uidx'
  ) THEN
    CREATE UNIQUE INDEX v2_pedidos_numero_source_uidx
      ON public.v2_pedidos (numero_pedido, source);
    RAISE NOTICE 'v2_pedidos: índice único COMPLETO criado em (numero_pedido, source).';
  ELSE
    RAISE NOTICE 'v2_pedidos: índice único em (numero_pedido, source) já existe.';
  END IF;
END $$;

-- -----------------------------------------------------------------------
-- 3. Verificação final
-- -----------------------------------------------------------------------
DO $$
DECLARE
  ok_bling  bool;
  ok_source bool;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'v2_pedidos'
      AND indexname = 'v2_pedidos_bling_id_uidx'
  ) INTO ok_bling;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'v2_pedidos'
      AND indexname = 'v2_pedidos_numero_source_uidx'
  ) INTO ok_source;

  IF ok_bling AND ok_source THEN
    RAISE NOTICE '✓ Migration 032 concluída. Upserts com onConflict devem funcionar agora.';
  ELSE
    RAISE WARNING '⚠ Verificação falhou — bling_id: %, numero_source: %', ok_bling, ok_source;
  END IF;
END $$;
