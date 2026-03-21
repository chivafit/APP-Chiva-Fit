-- ============================================================
-- MIGRAÇÃO 038 — Função SQL increment_campaign_reads
-- ============================================================
-- Cria função para incrementar contador de leituras de campanha
-- de forma atômica e eficiente (usada pelo whatsapp-webhook)
-- ============================================================

CREATE OR REPLACE FUNCTION increment_campaign_reads(p_campaign_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE campaign_whatsapp
  SET total_lidos = total_lidos + 1,
      updated_at = NOW()
  WHERE id = p_campaign_id;
END;
$$;

COMMENT ON FUNCTION increment_campaign_reads IS 'Incrementa contador de leituras de uma campanha de forma atômica';
