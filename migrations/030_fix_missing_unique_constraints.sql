-- ==============================================================================
-- FIX: GARANTIR CONSTRAINTS ÚNICAS AUSENTES
--
-- Problema: As tabelas abaixo foram criadas sem as constraints de PK/UNIQUE,
-- possivelmente porque já existiam antes da migration 000 ser aplicada
-- (o IF NOT EXISTS pulou a criação). Sem essas constraints, os upserts com
-- onConflict: 'col' falham com:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Tabelas afetadas:
--   1. carrinhos_abandonados  → onConflict: 'checkout_id'
--   2. v2_clientes            → onConflict: 'doc'
--   3. v2_pedidos             → onConflict: 'id'
-- ==============================================================================

-- -----------------------------------------------------------------------
-- 1. carrinhos_abandonados.checkout_id → PRIMARY KEY
-- -----------------------------------------------------------------------
DO $$
BEGIN
  -- Verificar se já tem PRIMARY KEY
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'carrinhos_abandonados'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    -- Remover duplicatas (mantém o mais recente por ctid)
    DELETE FROM public.carrinhos_abandonados a
    USING public.carrinhos_abandonados b
    WHERE a.ctid < b.ctid
      AND a.checkout_id = b.checkout_id
      AND a.checkout_id IS NOT NULL;

    -- Remover linhas sem checkout_id
    DELETE FROM public.carrinhos_abandonados WHERE checkout_id IS NULL OR checkout_id = '';

    BEGIN
      ALTER TABLE public.carrinhos_abandonados ADD PRIMARY KEY (checkout_id);
      RAISE NOTICE 'carrinhos_abandonados: PRIMARY KEY adicionada em checkout_id.';
    EXCEPTION WHEN others THEN
      RAISE WARNING 'carrinhos_abandonados: não foi possível adicionar PRIMARY KEY: %', SQLERRM;
      -- Fallback: unique index
      CREATE UNIQUE INDEX IF NOT EXISTS carrinhos_abandonados_checkout_id_uidx
        ON public.carrinhos_abandonados (checkout_id);
      RAISE NOTICE 'carrinhos_abandonados: UNIQUE INDEX criado em checkout_id como fallback.';
    END;
  ELSE
    RAISE NOTICE 'carrinhos_abandonados: PRIMARY KEY já existe — nenhuma ação necessária.';
  END IF;
END $$;

-- -----------------------------------------------------------------------
-- 2. v2_clientes.doc → UNIQUE constraint
-- -----------------------------------------------------------------------
DO $$
BEGIN
  -- Verificar se já tem UNIQUE em doc
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage cu
      ON cu.constraint_name = tc.constraint_name
     AND cu.table_schema    = tc.table_schema
    WHERE tc.table_schema   = 'public'
      AND tc.table_name     = 'v2_clientes'
      AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
      AND cu.column_name    = 'doc'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'v2_clientes'
      AND indexname  LIKE '%doc%unique%'
  ) THEN
    -- Remover duplicatas em doc (mantém o UUID mais recente / maior ctid)
    DELETE FROM public.v2_clientes a
    USING public.v2_clientes b
    WHERE a.ctid < b.ctid
      AND a.doc = b.doc
      AND a.doc IS NOT NULL
      AND a.doc <> '';

    BEGIN
      ALTER TABLE public.v2_clientes ADD CONSTRAINT v2_clientes_doc_unique UNIQUE (doc);
      RAISE NOTICE 'v2_clientes: UNIQUE constraint adicionada em doc.';
    EXCEPTION WHEN others THEN
      RAISE WARNING 'v2_clientes: não foi possível adicionar UNIQUE constraint: %', SQLERRM;
      -- Índice COMPLETO (não parcial) — necessário para onConflict: 'doc' funcionar
      CREATE UNIQUE INDEX IF NOT EXISTS v2_clientes_doc_uidx
        ON public.v2_clientes (doc);
      RAISE NOTICE 'v2_clientes: UNIQUE INDEX criado em doc como fallback.';
    END;
  ELSE
    RAISE NOTICE 'v2_clientes: UNIQUE já existe em doc — nenhuma ação necessária.';
  END IF;
END $$;

-- -----------------------------------------------------------------------
-- 3. v2_pedidos.id → PRIMARY KEY
-- -----------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'v2_pedidos'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    -- Remover duplicatas
    DELETE FROM public.v2_pedidos a
    USING public.v2_pedidos b
    WHERE a.ctid < b.ctid
      AND a.id = b.id
      AND a.id IS NOT NULL;

    DELETE FROM public.v2_pedidos WHERE id IS NULL OR id = '';

    BEGIN
      ALTER TABLE public.v2_pedidos ADD PRIMARY KEY (id);
      RAISE NOTICE 'v2_pedidos: PRIMARY KEY adicionada em id.';
    EXCEPTION WHEN others THEN
      RAISE WARNING 'v2_pedidos: não foi possível adicionar PRIMARY KEY: %', SQLERRM;
      CREATE UNIQUE INDEX IF NOT EXISTS v2_pedidos_id_uidx
        ON public.v2_pedidos (id);
      RAISE NOTICE 'v2_pedidos: UNIQUE INDEX criado em id como fallback.';
    END;
  ELSE
    RAISE NOTICE 'v2_pedidos: PRIMARY KEY já existe — nenhuma ação necessária.';
  END IF;
END $$;

-- -----------------------------------------------------------------------
-- 4. Garantir que produtos em carrinhos_abandonados é JSONB (não TEXT)
--    O código envia arrays JS; TEXT causaria erro de tipo silencioso.
-- -----------------------------------------------------------------------
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'carrinhos_abandonados'
    AND column_name  = 'produtos';

  IF col_type = 'text' THEN
    ALTER TABLE public.carrinhos_abandonados
      ALTER COLUMN produtos TYPE jsonb
      USING CASE
        WHEN produtos IS NULL OR produtos = '' THEN '[]'::jsonb
        WHEN produtos ~ '^\s*[\[{]' THEN produtos::jsonb
        ELSE '[]'::jsonb
      END;
    RAISE NOTICE 'carrinhos_abandonados: coluna produtos migrada de TEXT para JSONB.';
  ELSE
    RAISE NOTICE 'carrinhos_abandonados: produtos já é % — nenhuma ação necessária.', col_type;
  END IF;
END $$;

-- -----------------------------------------------------------------------
-- 5. Verificação final
-- -----------------------------------------------------------------------
DO $$
DECLARE
  issues int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'carrinhos_abandonados' AND constraint_type = 'PRIMARY KEY'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'carrinhos_abandonados' AND indexname LIKE '%checkout_id%'
  ) THEN
    issues := issues + 1;
    RAISE WARNING 'PROBLEMA: carrinhos_abandonados ainda sem constraint em checkout_id!';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage cu ON cu.constraint_name = tc.constraint_name AND cu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = 'v2_clientes' AND tc.constraint_type IN ('UNIQUE','PRIMARY KEY') AND cu.column_name = 'doc'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'v2_clientes' AND indexname LIKE '%doc%'
  ) THEN
    issues := issues + 1;
    RAISE WARNING 'PROBLEMA: v2_clientes ainda sem constraint em doc!';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'v2_pedidos' AND constraint_type = 'PRIMARY KEY'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'v2_pedidos' AND indexname LIKE '%id%'
  ) THEN
    issues := issues + 1;
    RAISE WARNING 'PROBLEMA: v2_pedidos ainda sem constraint em id!';
  END IF;

  IF issues = 0 THEN
    RAISE NOTICE '✓ Todas as constraints verificadas com sucesso. Pedidos devem importar normalmente agora.';
  END IF;
END $$;
