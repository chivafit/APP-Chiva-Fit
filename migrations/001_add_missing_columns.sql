-- Adiciona a coluna 'estoque_minimo' na tabela 'insumos'
ALTER TABLE public.insumos
ADD COLUMN IF NOT EXISTS estoque_minimo numeric;

-- Adiciona a coluna 'score_final' na tabela 'customer_intelligence'
ALTER TABLE public.customer_intelligence
ADD COLUMN IF NOT EXISTS score_final numeric;

-- Adiciona a coluna 'recuperado_em' na tabela 'carrinhos_abandonados'
ALTER TABLE public.carrinhos_abandonados
ADD COLUMN IF NOT EXISTS recuperado_em timestamp with time zone;

create table if not exists public.v2_pedidos_items ( 
    id uuid primary key default gen_random_uuid(), 
    pedido_id uuid not null references public.v2_pedidos(id) on delete cascade, 
    produto_nome text not null, 
    quantidade numeric default 0, 
    valor_unitario numeric default 0, 
    valor_total numeric default 0, 
    created_at timestamptz default now() 
);
