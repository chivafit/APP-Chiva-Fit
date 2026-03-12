-- ==========================================
-- SCRIPT DE BASE GEOGRÁFICA COMPLETA (IBGE)
-- ==========================================

-- 1. TABELA DE ESTADOS
CREATE TABLE IF NOT EXISTS public.estados (
    id integer PRIMARY KEY,
    nome text NOT NULL,
    sigla char(2) UNIQUE NOT NULL
);

-- 2. TABELA DE CIDADES
CREATE TABLE IF NOT EXISTS public.cidades (
    id integer PRIMARY KEY,
    nome text NOT NULL,
    estado_id integer REFERENCES public.estados(id),
    estado_sigla char(2),
    nome_slug text -- Para buscas otimizadas
);

CREATE INDEX IF NOT EXISTS idx_cidades_estado ON public.cidades(estado_sigla);
CREATE INDEX IF NOT EXISTS idx_cidades_nome ON public.cidades(nome);

-- 3. SEED DE ESTADOS
INSERT INTO public.estados (id, nome, sigla) VALUES
(11, 'Rondônia', 'RO'),
(12, 'Acre', 'AC'),
(13, 'Amazonas', 'AM'),
(14, 'Roraima', 'RR'),
(15, 'Pará', 'PA'),
(16, 'Amapá', 'AP'),
(17, 'Tocantins', 'TO'),
(21, 'Maranhão', 'MA'),
(22, 'Piauí', 'PI'),
(23, 'Ceará', 'CE'),
(24, 'Rio Grande do Norte', 'RN'),
(25, 'Paraíba', 'PB'),
(26, 'Pernambuco', 'PE'),
(27, 'Alagoas', 'AL'),
(28, 'Sergipe', 'SE'),
(29, 'Bahia', 'BA'),
(31, 'Minas Gerais', 'MG'),
(32, 'Espírito Santo', 'ES'),
(33, 'Rio de Janeiro', 'RJ'),
(35, 'São Paulo', 'SP'),
(41, 'Paraná', 'PR'),
(42, 'Santa Catarina', 'SC'),
(43, 'Rio Grande do Sul', 'RS'),
(50, 'Mato Grosso do Sul', 'MS'),
(51, 'Mato Grosso', 'MT'),
(52, 'Goiás', 'GO'),
(53, 'Distrito Federal', 'DF')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, sigla = EXCLUDED.sigla;

-- 4. AJUSTE NA TABELA DE CLIENTES
ALTER TABLE public.v2_clientes 
ADD COLUMN IF NOT EXISTS cidade_id integer REFERENCES public.cidades(id);

-- 5. POLÍTICAS DE RLS PARA AS NOVAS TABELAS
ALTER TABLE public.estados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cidades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon Full Access" ON public.estados;
CREATE POLICY "Anon Full Access" ON public.estados FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon Full Access" ON public.cidades;
CREATE POLICY "Anon Full Access" ON public.cidades FOR ALL USING (true) WITH CHECK (true);

-- NOTA: Para popular as 5570 cidades, recomenda-se importar via CSV 
-- ou usar a API do IBGE via script de automação.
-- Vou fornecer um script frontend para popular isso automaticamente se o banco estiver vazio.
