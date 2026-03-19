-- ==============================================================================
-- Migration 033: Adicionar 'yampi' ao enum tipo_source
-- Motivo: pedidos Yampi falhavam silenciosamente no upsert porque 'yampi'
--         não era um valor válido do enum tipo_source em v2_pedidos.source
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'yampi'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'tipo_source')
  ) THEN
    ALTER TYPE public.tipo_source ADD VALUE 'yampi';
    RAISE NOTICE 'tipo_source: valor ''yampi'' adicionado com sucesso.';
  ELSE
    RAISE NOTICE 'tipo_source: valor ''yampi'' já existe — nenhuma alteração feita.';
  END IF;
END $$;
