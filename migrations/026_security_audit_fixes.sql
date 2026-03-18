-- ==========================================
-- AUDITORIA DE SEGURANÇA E RLS - FIXES
-- ==========================================

-- 1. Limpeza de políticas inseguras (Anon access)
DO $$ 
DECLARE 
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Anon Full Access" ON public.%I', t);
        EXECUTE format('DROP POLICY IF EXISTS "Anon Read Config" ON public.%I', t);
    END LOOP;
END $$;

-- 2. Reforçar configuracoes (Ocultar tokens sensíveis do frontend)
ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS is_sensitive boolean DEFAULT false;

-- Marcar chaves conhecidas como sensíveis
UPDATE public.configuracoes 
SET is_sensitive = true 
WHERE chave IN ('bling_access_token', 'bling_refresh_token', 'BLING_CLIENT_ID', 'BLING_CLIENT_SECRET', 'YAMPI_SECRET', 'CRON_SECRET');

-- Política para usuários autenticados: Ver apenas o que NÃO é sensível
DROP POLICY IF EXISTS "Auth Read Non-Sensitive Config" ON public.configuracoes;
CREATE POLICY "Auth Read Non-Sensitive Config" ON public.configuracoes
    FOR SELECT
    TO authenticated
    USING (is_sensitive = false);

-- Política para Service Role: Acesso total (já implícito, mas para clareza em migrations futuras)
-- O Supabase já permite service_role bypassar RLS, então não precisamos de política explícita aqui.

-- 3. Garantir que anon não veja NADA por padrão (Safe by default)
-- Já removemos as políticas acima, então por padrão anon não tem acesso se RLS estiver on.

-- 4. Ajustar RLS de outras tabelas críticas para apenas Authenticated
-- Se o projeto for colaborativo (SaaS Single-Tenant), mantemos 'authenticated' vendo tudo.
-- Se for Multi-Tenant, precisaríamos de column user_id/tenant_id (não presente hoje).

-- Re-garantir RLS ativo em tudo
DO $$ 
DECLARE 
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;
