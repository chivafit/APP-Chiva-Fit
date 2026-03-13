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
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'v2_pedidos_items'
      AND column_name = 'pedido_id'
      AND data_type = 'uuid'
  ) THEN
    EXECUTE 'DROP TABLE public.v2_pedidos_items';
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
