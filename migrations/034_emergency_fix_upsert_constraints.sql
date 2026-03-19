-- Migration 034: Fix upsert constraints for v2_clientes and v2_pedidos
-- This migration is idempotent and safe to run multiple times.
--
-- Fixes:
-- 1. [SUPA ERROR] upsert v2_clientes error (HTTP 400)
--    → Adds UNIQUE constraint on v2_clientes.doc (was missing)
-- 2. [SUPA ERROR] upsert v2_pedidos error (uuid/bling_id) (HTTP 400/409)
--    → Replaces PARTIAL unique indexes (incompatible with PostgREST ON CONFLICT)
--      with complete unique indexes on v2_pedidos.bling_id and (numero_pedido, source)
--
-- HOW TO APPLY:
--   Go to Supabase Dashboard → SQL Editor → paste this file → Run
-- -----------------------------------------------------------------------

-- -----------------------------------------------------------------------
-- 1. v2_clientes.doc unique constraint
-- -----------------------------------------------------------------------

-- Add unique constraint if not already present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'v2_clientes_doc_unique'
      AND conrelid = 'public.v2_clientes'::regclass
  ) THEN
    ALTER TABLE public.v2_clientes ADD CONSTRAINT v2_clientes_doc_unique UNIQUE (doc);
    RAISE NOTICE 'Added UNIQUE constraint v2_clientes_doc_unique';
  ELSE
    RAISE NOTICE 'Constraint v2_clientes_doc_unique already exists, skipping';
  END IF;
EXCEPTION
  WHEN duplicate_table THEN
    RAISE NOTICE 'Constraint already exists (duplicate_table), skipping';
  WHEN others THEN
    RAISE;
END $$;

-- Fallback: also ensure index exists (covers edge cases)
CREATE UNIQUE INDEX IF NOT EXISTS v2_clientes_doc_uidx ON public.v2_clientes (doc);

-- -----------------------------------------------------------------------
-- 2. v2_pedidos.bling_id — replace partial index with complete index
-- -----------------------------------------------------------------------

-- Drop the old partial index from migration 029 (incompatible with PostgREST)
DROP INDEX IF EXISTS public.v2_pedidos_bling_id_unique_idx;

-- Create complete unique index (PostgREST can use this with onConflict: 'bling_id')
CREATE UNIQUE INDEX IF NOT EXISTS v2_pedidos_bling_id_uidx
  ON public.v2_pedidos (bling_id);

-- -----------------------------------------------------------------------
-- 3. v2_pedidos.(numero_pedido, source) — replace partial composite index
-- -----------------------------------------------------------------------

-- Drop the old partial composite index from migration 031
DROP INDEX IF EXISTS public.v2_pedidos_numero_source_unique_idx;

-- Create complete composite unique index
CREATE UNIQUE INDEX IF NOT EXISTS v2_pedidos_numero_source_uidx
  ON public.v2_pedidos (numero_pedido, source);

-- -----------------------------------------------------------------------
-- Verification (optional — shows what was created)
-- -----------------------------------------------------------------------
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename IN ('v2_clientes', 'v2_pedidos')
  AND indexname IN (
    'v2_clientes_doc_uidx',
    'v2_pedidos_bling_id_uidx',
    'v2_pedidos_numero_source_uidx'
  )
ORDER BY tablename, indexname;
