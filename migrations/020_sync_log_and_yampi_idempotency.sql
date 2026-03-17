-- ============================================================
-- Migration 020: sync_log + idempotência no yampi_orders
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Tabela de log de sincronizações
--    Registra cada execução de sync (sucesso ou falha)
--    para auditoria, monitoramento e painel de saúde.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  id            BIGSERIAL PRIMARY KEY,
  integration   TEXT        NOT NULL,           -- 'bling' | 'yampi' | 'bling_products'
  event         TEXT        NOT NULL,           -- 'orders_sync' | 'carrinhos_sync' | etc.
  status        TEXT        NOT NULL,           -- 'success' | 'error'
  message       TEXT,                           -- resumo ou mensagem de erro
  records_count INTEGER     DEFAULT 0,          -- registros processados
  duration_ms   INTEGER,                        -- duração em ms
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para consultas do painel de saúde
CREATE INDEX IF NOT EXISTS idx_sync_log_integration ON sync_log (integration, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_status      ON sync_log (status, created_at DESC);

-- Política RLS: apenas usuários autenticados lêem
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

-- DROP ... IF EXISTS garante idempotência (CREATE POLICY não tem IF NOT EXISTS)
DROP POLICY IF EXISTS sync_log_select ON sync_log;
CREATE POLICY sync_log_select ON sync_log
  FOR SELECT TO authenticated USING (true);

-- Service role pode inserir (via Edge Functions)
DROP POLICY IF EXISTS sync_log_insert ON sync_log;
CREATE POLICY sync_log_insert ON sync_log
  FOR INSERT TO service_role WITH CHECK (true);

-- Manter apenas últimos 90 dias para não crescer indefinidamente
-- (rodar periodicamente via cron job ou trigger)
CREATE OR REPLACE FUNCTION prune_sync_log() RETURNS void
LANGUAGE sql AS $$
  DELETE FROM sync_log WHERE created_at < NOW() - INTERVAL '90 days';
$$;


-- ────────────────────────────────────────────────────────────
-- 2. Idempotência no yampi_orders
--    Evita duplicatas quando o Yampi dispara o mesmo
--    evento mais de uma vez para o mesmo pedido.
-- ────────────────────────────────────────────────────────────

-- Adicionar constraint UNIQUE em (external_id, event) se ainda não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'yampi_orders_external_id_event_key'
  ) THEN
    ALTER TABLE yampi_orders
      ADD CONSTRAINT yampi_orders_external_id_event_key
      UNIQUE (external_id, event);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. Coluna de estado de erro do token Bling
--    Permite que o frontend detecte falha de renovação
--    sem precisar tentar chamar a API.
--    (já existe na tabela configuracoes como chave-valor,
--     mas garantir a chave existe para evitar null pointer)
-- ────────────────────────────────────────────────────────────
INSERT INTO configuracoes (chave, valor_texto, updated_at)
VALUES ('bling_token_error', '', NOW())
ON CONFLICT (chave) DO NOTHING;
