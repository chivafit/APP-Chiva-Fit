-- Migration 035: Add missing 'cnpj' value to tipo_canal enum
--
-- Fix: [SUPA ERROR] upsert v2_clientes error
--   code: 22P02 — invalid input value for enum tipo_canal: "cnpj"
--
-- Root cause: detectCh() returns 'cnpj' for orders from CNPJ customers
-- (contacts with 14-digit document), but the tipo_canal enum was never
-- created with this value.
--
-- Also ensures other channel slugs used by the app are present.
--
-- HOW TO APPLY:
--   Supabase Dashboard → SQL Editor → paste → Run
-- -----------------------------------------------------------------------

-- Add 'cnpj' if not already in the enum
-- (IF NOT EXISTS is supported in PostgreSQL 9.6+)
DO $$ BEGIN
  ALTER TYPE public.tipo_canal ADD VALUE IF NOT EXISTS 'cnpj';
EXCEPTION
  WHEN duplicate_object THEN null;
  WHEN undefined_object THEN
    RAISE NOTICE 'tipo_canal enum does not exist — canal_principal may be text type, which needs no fix';
END $$;

-- Also ensure other slugs that the app uses are present (safe no-ops if already there)
DO $$ BEGIN
  ALTER TYPE public.tipo_canal ADD VALUE IF NOT EXISTS 'bling';
EXCEPTION WHEN duplicate_object OR undefined_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.tipo_canal ADD VALUE IF NOT EXISTS 'b2b';
EXCEPTION WHEN duplicate_object OR undefined_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.tipo_canal ADD VALUE IF NOT EXISTS 'ml';
EXCEPTION WHEN duplicate_object OR undefined_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.tipo_canal ADD VALUE IF NOT EXISTS 'shopify';
EXCEPTION WHEN duplicate_object OR undefined_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.tipo_canal ADD VALUE IF NOT EXISTS 'shopee';
EXCEPTION WHEN duplicate_object OR undefined_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.tipo_canal ADD VALUE IF NOT EXISTS 'amazon';
EXCEPTION WHEN duplicate_object OR undefined_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.tipo_canal ADD VALUE IF NOT EXISTS 'yampi';
EXCEPTION WHEN duplicate_object OR undefined_object THEN null; END $$;

DO $$ BEGIN
  ALTER TYPE public.tipo_canal ADD VALUE IF NOT EXISTS 'outros';
EXCEPTION WHEN duplicate_object OR undefined_object THEN null; END $$;

-- Verify: show all current enum values
SELECT enumlabel AS valor
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'tipo_canal'
ORDER BY e.enumsortorder;
