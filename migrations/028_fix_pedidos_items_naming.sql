-- ==============================================================================
-- FIX: PADRONIZAÇÃO DE TABELAS DE ITENS DE PEDIDOS
-- Este script resolve a inconsistência entre v2_pedidos_itens e v2_pedidos_items
-- e atualiza as views dependentes.
-- ==============================================================================

DO $$
DECLARE
    pedidos_id_type text;
BEGIN
    -- 0. Detectar o tipo de ID da v2_pedidos (pode ser UUID ou TEXT)
    SELECT data_type INTO pedidos_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'v2_pedidos' AND column_name = 'id';

    -- 1. Se existir a tabela com 'itens' (plural PT), renomeia para 'items' (EN)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'v2_pedidos_itens') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'v2_pedidos_items') THEN
            ALTER TABLE public.v2_pedidos_itens RENAME TO v2_pedidos_items;
        ELSE
            -- Se ambas existem, movemos os dados de uma para outra e removemos a antiga
            INSERT INTO public.v2_pedidos_items (pedido_id, produto_nome, quantidade, valor_unitario, valor_total, created_at)
            SELECT CAST(pedido_id AS text), produto_nome, quantidade, valor_unitario, valor_total, created_at
            FROM public.v2_pedidos_itens
            ON CONFLICT DO NOTHING;
            
            DROP TABLE public.v2_pedidos_itens;
        END IF;
    END IF;

    -- 2. Garantir que a v2_pedidos_items existe com o tipo de FK correto
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'v2_pedidos_items') THEN
        IF pedidos_id_type = 'uuid' THEN
            CREATE TABLE public.v2_pedidos_items (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                pedido_id uuid NOT NULL REFERENCES public.v2_pedidos(id) ON DELETE CASCADE,
                produto_nome text NOT NULL,
                quantidade numeric DEFAULT 0,
                valor_unitario numeric DEFAULT 0,
                valor_total numeric DEFAULT 0,
                created_at timestamptz DEFAULT now()
            );
        ELSE
            CREATE TABLE public.v2_pedidos_items (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                pedido_id text NOT NULL REFERENCES public.v2_pedidos(id) ON DELETE CASCADE,
                produto_nome text NOT NULL,
                quantidade numeric DEFAULT 0,
                valor_unitario numeric DEFAULT 0,
                valor_total numeric DEFAULT 0,
                created_at timestamptz DEFAULT now()
            );
        END IF;
    ELSE
        -- Se a tabela já existe, verificar se o tipo de pedido_id bate com v2_pedidos.id
        DECLARE
            items_id_type text;
        BEGIN
            SELECT data_type INTO items_id_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'v2_pedidos_items' AND column_name = 'pedido_id';

            IF items_id_type <> pedidos_id_type THEN
                -- Incompatibilidade detectada: recriar a coluna com o tipo correto
                -- (Isso é drástico mas necessário para garantir o JOIN)
                ALTER TABLE public.v2_pedidos_items DROP CONSTRAINT IF EXISTS v2_pedidos_items_pedido_id_fkey;
                
                IF pedidos_id_type = 'uuid' THEN
                    ALTER TABLE public.v2_pedidos_items ALTER COLUMN pedido_id TYPE uuid USING (pedido_id::uuid);
                ELSE
                    ALTER TABLE public.v2_pedidos_items ALTER COLUMN pedido_id TYPE text USING (pedido_id::text);
                END IF;
                
                ALTER TABLE public.v2_pedidos_items ADD CONSTRAINT v2_pedidos_items_pedido_id_fkey 
                    FOREIGN KEY (pedido_id) REFERENCES public.v2_pedidos(id) ON DELETE CASCADE;
            END IF;
        END;
    END IF;

    -- 3. Garantir colunas adicionais
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'v2_pedidos_items' AND column_name = 'valor_total') THEN
        ALTER TABLE public.v2_pedidos_items ADD COLUMN valor_total numeric DEFAULT 0;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'v2_pedidos_items' AND column_name = 'produto_nome') THEN
        ALTER TABLE public.v2_pedidos_items ADD COLUMN produto_nome text;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'v2_pedidos_items' AND column_name = 'produto_id') THEN
        ALTER TABLE public.v2_pedidos_items ADD COLUMN produto_id text;
    END IF;

END $$;

-- 3. Atualizar/Recriar a View vw_produtos_favoritos para garantir que usa a tabela correta
DROP VIEW IF EXISTS public.vw_produtos_favoritos;
CREATE OR REPLACE VIEW public.vw_produtos_favoritos AS
SELECT
  NULLIF(trim(i.produto_nome), '') AS produto,
  sum(COALESCE(i.quantidade, 0))::numeric AS unidades_vendidas,
  sum(COALESCE(i.valor_total, 0))::numeric AS faturamento,
  count(DISTINCT p.cliente_id)::int AS total_clientes
FROM public.v2_pedidos_items i
JOIN public.v2_pedidos p ON p.id = i.pedido_id
GROUP BY 1
ORDER BY faturamento DESC NULLS LAST;

-- 4. Garantir RLS na tabela correta
ALTER TABLE public.v2_pedidos_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated Full Access" ON public.v2_pedidos_items;
CREATE POLICY "Authenticated Full Access" ON public.v2_pedidos_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
