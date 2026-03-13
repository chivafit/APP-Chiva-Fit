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
  fk_name text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v2_pedidos_items'
      AND column_name = 'pedido_id'
      AND data_type = 'uuid'
  ) THEN
    IF to_regclass('public.vw_vendas_por_produto') IS NOT NULL THEN
      SELECT pg_get_viewdef('public.vw_vendas_por_produto'::regclass, true) INTO viewdef;
      EXECUTE 'DROP VIEW public.vw_vendas_por_produto';
    END IF;

    SELECT conname
    INTO fk_name
    FROM pg_constraint
    WHERE conrelid = 'public.v2_pedidos_items'::regclass
      AND contype = 'f'
    LIMIT 1;

    IF fk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.v2_pedidos_items DROP CONSTRAINT %I', fk_name);
    END IF;

    EXECUTE 'ALTER TABLE public.v2_pedidos_items ALTER COLUMN pedido_id TYPE text USING pedido_id::text';

    EXECUTE 'ALTER TABLE public.v2_pedidos_items ADD CONSTRAINT v2_pedidos_items_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES public.v2_pedidos(id) ON DELETE CASCADE';

    IF viewdef IS NOT NULL AND viewdef <> '' THEN
      EXECUTE 'CREATE VIEW public.vw_vendas_por_produto AS ' || viewdef;
    END IF;
  END IF;
END $$;

create table if not exists public.v2_pedidos_items ( 
    id uuid primary key default gen_random_uuid(), 
    pedido_id text not null references public.v2_pedidos(id) on delete cascade, 
    produto_nome text not null, 
    quantidade numeric default 0, 
    valor_unitario numeric default 0, 
    valor_total numeric default 0, 
    created_at timestamptz default now() 
);

ALTER TABLE public.v2_pedidos_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon Full Access" ON public.v2_pedidos_items;
CREATE POLICY "Anon Full Access" ON public.v2_pedidos_items FOR ALL USING (true) WITH CHECK (true);
