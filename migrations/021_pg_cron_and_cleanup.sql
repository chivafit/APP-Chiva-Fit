-- ============================================================
-- Migration 021: pg_cron para prune_sync_log + limpeza de
--                chaves temporárias de rate limiting na tabela
--                configuracoes.
--
-- PRÉ-REQUISITO: habilitar pg_cron no Supabase
--   Dashboard → Database → Extensions → pg_cron → Enable
--
-- COMO APLICAR: cole este script no SQL Editor do Supabase.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Agendar limpeza diária do sync_log (mantém últimos 90 dias)
--    Roda às 03:00 UTC todos os dias.
-- ────────────────────────────────────────────────────────────
SELECT cron.schedule(
  'prune-sync-log-daily',       -- nome único do job
  '0 3 * * *',                  -- cron: 03:00 UTC diariamente
  'SELECT prune_sync_log()'
);

-- ────────────────────────────────────────────────────────────
-- 2. Função para limpar chaves de rate limiting da IA.
--    As chaves têm formato: rl:{funcao}:{email}:{YYYY-MM-DDTHH}
--    São criadas automaticamente pelo _shared/rate_limit.ts e
--    ficam obsoletas após 1 hora. Esta função limpa as antigas.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prune_ia_rate_limit_keys() RETURNS void
LANGUAGE sql AS $$
  DELETE FROM configuracoes
  WHERE chave LIKE 'rl:%'
    AND updated_at < NOW() - INTERVAL '2 hours';
$$;

-- Agendar limpeza das chaves de rate limit a cada hora
SELECT cron.schedule(
  'prune-ia-rate-limit-hourly',
  '5 * * * *',                  -- cron: 5 minutos após cada hora
  'SELECT prune_ia_rate_limit_keys()'
);

-- ────────────────────────────────────────────────────────────
-- 3. Verificar se os jobs foram agendados corretamente
-- ────────────────────────────────────────────────────────────
-- SELECT jobid, schedule, command, active FROM cron.job;
