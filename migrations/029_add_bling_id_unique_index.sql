-- ==============================================================================
-- FIX: GARANTIR ÍNDICE ÚNICO PARA BLING_ID EM V2_PEDIDOS
-- Necessário para o upsert via Edge Function que usa bling_id como chave de conflito.
-- ==============================================================================

DO $$
BEGIN
    -- 1. Remover duplicatas de bling_id se existirem (preserva o mais recente)
    DELETE FROM public.v2_pedidos p
    WHERE p.ctid NOT IN (
        SELECT max(ctid)
        FROM public.v2_pedidos
        WHERE bling_id IS NOT NULL
        GROUP BY bling_id
    ) AND bling_id IS NOT NULL;

    -- 2. Criar índice único se não existir
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public' 
          AND tablename = 'v2_pedidos' 
          AND indexname = 'v2_pedidos_bling_id_unique_idx'
    ) THEN
        CREATE UNIQUE INDEX v2_pedidos_bling_id_unique_idx ON public.v2_pedidos (bling_id) WHERE bling_id IS NOT NULL;
    END IF;

END $$;
