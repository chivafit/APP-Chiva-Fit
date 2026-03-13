-- ==========================================
-- SCRIPT DE CRIAÇÃO DO SCHEMA CRM CHIVA FIT
-- Rodar no SQL Editor do Supabase
-- ==========================================

-- 1. TABELA DE INSUMOS
CREATE TABLE IF NOT EXISTS public.insumos (
    id text PRIMARY KEY,
    nome text NOT NULL,
    unidade text DEFAULT 'kg',
    estoque_atual numeric DEFAULT 0,
    estoque_minimo numeric DEFAULT 0,
    custo_unitario numeric DEFAULT 0,
    fornecedor text,
    lead_time_dias integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now()
);

-- 2. TABELA DE RECEITAS DE PRODUTOS (Composição)
CREATE TABLE IF NOT EXISTS public.receitas_produtos (
    id text PRIMARY KEY,
    produto_id text NOT NULL,
    insumo_id text REFERENCES public.insumos(id),
    quantidade_por_unidade numeric DEFAULT 0,
    unidade text DEFAULT 'g',
    updated_at timestamp with time zone DEFAULT now()
);

-- 3. TABELA DE ORDENS DE PRODUÇÃO
CREATE TABLE IF NOT EXISTS public.ordens_producao (
    id text PRIMARY KEY,
    lote text,
    produto_id text,
    quantidade_planejada numeric DEFAULT 0,
    quantidade_produzida numeric DEFAULT 0,
    data_producao date,
    status text DEFAULT 'planejada',
    observacoes text,
    created_at timestamp with time zone DEFAULT now()
);

-- 4. TABELA DE MOVIMENTAÇÕES DE ESTOQUE
CREATE TABLE IF NOT EXISTS public.movimentos_estoque (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    insumo_id text REFERENCES public.insumos(id),
    ordem_id text REFERENCES public.ordens_producao(id),
    tipo text NOT NULL, -- 'entrada', 'saida', 'ajuste'
    quantidade numeric NOT NULL,
    unidade text,
    created_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb
);

-- 5. TABELA DE CLIENTES (v2)
CREATE TABLE IF NOT EXISTS public.v2_clientes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    doc text UNIQUE, -- CPF/CNPJ
    nome text NOT NULL,
    email text,
    telefone text,
    cidade text,
    uf text,
    primeiro_pedido date,
    ultimo_pedido date,
    total_pedidos integer DEFAULT 0,
    total_gasto numeric DEFAULT 0,
    ltv numeric DEFAULT 0,
    ticket_medio numeric DEFAULT 0,
    intervalo_medio_dias numeric DEFAULT 0,
    score_recompra numeric DEFAULT 0,
    risco_churn numeric DEFAULT 0,
    status text,
    canal_principal text,
    updated_at timestamp with time zone DEFAULT now()
);

-- 6. TABELA DE CANAIS DE VENDA
CREATE TABLE IF NOT EXISTS public.v2_canais (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nome text NOT NULL,
    slug text UNIQUE NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- 7. TABELA DE PEDIDOS (v2)
CREATE TABLE IF NOT EXISTS public.v2_pedidos (
    id text PRIMARY KEY,
    numero_pedido text,
    bling_id text,
    cliente_id uuid REFERENCES public.v2_clientes(id),
    canal_id uuid REFERENCES public.v2_canais(id),
    data_pedido date,
    total numeric DEFAULT 0,
    status text,
    source text DEFAULT 'bling',
    itens jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- 8. TABELA DE INTERAÇÕES / TIMELINE
CREATE TABLE IF NOT EXISTS public.interactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid REFERENCES public.v2_clientes(id),
    type text, -- 'whatsapp', 'email', 'ligacao', 'nota'
    description text,
    created_at timestamp with time zone DEFAULT now(),
    user_responsible text,
    source text DEFAULT 'crm',
    metadata jsonb DEFAULT '{}'::jsonb
);

-- 9. TABELA DE INTELIGÊNCIA DE CLIENTE (IA)
CREATE TABLE IF NOT EXISTS public.customer_intelligence (
    cliente_id uuid PRIMARY KEY REFERENCES public.v2_clientes(id),
    score_final numeric DEFAULT 0,
    next_best_action text,
    segmento text,
    perfil_compra text,
    updated_at timestamp with time zone DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'customer_intelligence'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customer_intelligence'
        AND column_name = 'atualizado_em'
        AND is_nullable = 'NO'
    ) THEN
      EXECUTE 'ALTER TABLE public.customer_intelligence ALTER COLUMN atualizado_em DROP NOT NULL';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customer_intelligence'
        AND column_name = 'updated_at'
        AND is_nullable = 'NO'
    ) THEN
      EXECUTE 'ALTER TABLE public.customer_intelligence ALTER COLUMN updated_at DROP NOT NULL';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customer_intelligence'
        AND column_name = 'score_final'
        AND is_nullable = 'NO'
    ) THEN
      EXECUTE 'ALTER TABLE public.customer_intelligence ALTER COLUMN score_final DROP NOT NULL';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customer_intelligence'
        AND column_name = 'score_recompra'
        AND is_nullable = 'NO'
    ) THEN
      EXECUTE 'ALTER TABLE public.customer_intelligence ALTER COLUMN score_recompra DROP NOT NULL';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'customer_intelligence'
        AND column_name = 'risco_churn'
        AND is_nullable = 'NO'
    ) THEN
      EXECUTE 'ALTER TABLE public.customer_intelligence ALTER COLUMN risco_churn DROP NOT NULL';
    END IF;
  END IF;
END $$;

-- 10. TABELA DE CARRINHOS ABANDONADOS
CREATE TABLE IF NOT EXISTS public.carrinhos_abandonados (
    checkout_id text PRIMARY KEY,
    cliente_nome text,
    telefone text,
    email text,
    valor numeric DEFAULT 0,
    produtos text,
    criado_em timestamp with time zone,
    recuperado boolean DEFAULT false,
    recuperado_em timestamp with time zone,
    recuperado_pedido_id text,
    score_recuperacao numeric DEFAULT 0,
    link_finalizacao text,
    last_etapa_enviada integer DEFAULT 0,
    last_mensagem_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb
);

-- 11. TABELA DE CONFIGURAÇÕES GERAIS
CREATE TABLE IF NOT EXISTS public.configuracoes (
    chave text PRIMARY KEY,
    valor_texto text,
    updated_at timestamp with time zone DEFAULT now()
);

-- 12. TABELA DE TAREFAS (v2)
CREATE TABLE IF NOT EXISTS public.v2_tarefas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo text NOT NULL,
    descricao text,
    vencimento date,
    prioridade text DEFAULT 'media',
    status text DEFAULT 'aberta', -- 'aberta', 'concluida', 'cancelada'
    created_at timestamp with time zone DEFAULT now()
);

-- 13. TABELA DE INSIGHTS DA IA
CREATE TABLE IF NOT EXISTS public.v2_insights (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo text,
    conteudo text,
    gerado_por text DEFAULT 'claude',
    created_at timestamp with time zone DEFAULT now()
);

-- 14. TABELA DE PEDIDOS YAMPI (Webhook RAW/Landing)
CREATE TABLE IF NOT EXISTS public.yampi_orders (
    external_id text PRIMARY KEY,
    canal text DEFAULT 'yampi',
    event text,
    status text,
    total numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_abandoned_cart boolean DEFAULT false,
    customer_name text,
    customer_email text,
    customer_phone text,
    city text,
    state text,
    raw jsonb DEFAULT '{}'::jsonb
);

-- Habilitar RLS em yampi_orders
ALTER TABLE public.yampi_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_insights ENABLE ROW LEVEL SECURITY;


-- Adicionar à política de acesso anon
-- (Isso será feito automaticamente pelo loop no final do script se rodar tudo de novo)


-- ==========================================
-- CONFIGURAÇÃO DE RLS (ACESSO PÚBLICO/ANON)
-- Importante: Para um CRM estático, as tabelas 
-- precisam permitir acesso via anon key.
-- ==========================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE public.insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receitas_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordens_producao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimentos_estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_canais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carrinhos_abandonados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_tarefas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_insights ENABLE ROW LEVEL SECURITY;

-- Criar políticas de acesso total para a anon key (simplificado para CRM interno)
-- NOTA: Em produção com dados sensíveis, o ideal é usar Auth.
DO $$ 
DECLARE 
    t text;
BEGIN
    -- Filtramos apenas por tabelas REAIS ('BASE TABLE'), ignorando VIEWS
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Anon Full Access" ON public.%I', t);
        EXECUTE format('CREATE POLICY "Anon Full Access" ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
    END LOOP;
END $$;
