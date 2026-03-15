-- Adiciona a coluna 'estoque_minimo' na tabela 'insumos'
ALTER TABLE public.insumos
ADD COLUMN IF NOT EXISTS estoque_minimo numeric;

-- Adiciona a coluna 'score_final' na tabela 'customer_intelligence'
ALTER TABLE public.customer_intelligence
ADD COLUMN IF NOT EXISTS score_final numeric;

-- Adiciona a coluna 'recuperado_em' na tabela 'carrinhos_abandonados'
ALTER TABLE public.carrinhos_abandonados
ADD COLUMN IF NOT EXISTS recuperado_em timestamp with time zone;

DO $$
DECLARE
  viewdef text;
  pedidos_id_type text;
  items_id_type text;
  items_exists boolean;
BEGIN
  SELECT data_type
  INTO pedidos_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'v2_pedidos'
    AND column_name = 'id';

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'v2_pedidos_items'
  )
  INTO items_exists;

  IF items_exists THEN
    SELECT data_type
    INTO items_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v2_pedidos_items'
      AND column_name = 'pedido_id';
  ELSE
    items_id_type := NULL;
  END IF;

  IF items_exists AND pedidos_id_type IS NOT NULL AND items_id_type IS NOT NULL AND pedidos_id_type <> items_id_type THEN
    IF to_regclass('public.vw_vendas_por_produto') IS NOT NULL THEN
      SELECT pg_get_viewdef('public.vw_vendas_por_produto'::regclass, true) INTO viewdef;
      EXECUTE 'DROP VIEW public.vw_vendas_por_produto';
    END IF;
    EXECUTE 'DROP TABLE public.v2_pedidos_items';
    items_exists := false;
  END IF;

  IF NOT items_exists THEN
    IF pedidos_id_type = 'uuid' THEN
      EXECUTE $ct$
        CREATE TABLE public.v2_pedidos_items ( 
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), 
          pedido_id uuid NOT NULL REFERENCES public.v2_pedidos(id) ON DELETE CASCADE, 
          produto_nome text NOT NULL, 
          quantidade numeric DEFAULT 0, 
          valor_unitario numeric DEFAULT 0, 
          valor_total numeric DEFAULT 0, 
          created_at timestamptz DEFAULT now() 
        )
      $ct$;
    ELSE
      EXECUTE $ct$
        CREATE TABLE public.v2_pedidos_items ( 
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), 
          pedido_id text NOT NULL REFERENCES public.v2_pedidos(id) ON DELETE CASCADE, 
          produto_nome text NOT NULL, 
          quantidade numeric DEFAULT 0, 
          valor_unitario numeric DEFAULT 0, 
          valor_total numeric DEFAULT 0, 
          created_at timestamptz DEFAULT now() 
        )
      $ct$;
    END IF;
  END IF;

  EXECUTE 'ALTER TABLE public.v2_pedidos_items ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS "Anon Full Access" ON public.v2_pedidos_items';
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated Full Access" ON public.v2_pedidos_items';
  EXECUTE 'CREATE POLICY "Authenticated Full Access" ON public.v2_pedidos_items FOR ALL TO authenticated USING (true) WITH CHECK (true)';

  IF viewdef IS NOT NULL AND viewdef <> '' THEN
    EXECUTE 'CREATE VIEW public.vw_vendas_por_produto AS ' || viewdef;
  END IF;
END $$;
