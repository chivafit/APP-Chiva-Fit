-- ============================================================
-- MIGRAÇÃO 036 — Módulo de Recompra & Automação WhatsApp
-- ============================================================
-- Cria todas as tabelas do módulo satélite de recompra.
-- Não altera nenhuma tabela existente.
-- ============================================================

-- ─── 1. CONTAS WHATSAPP ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                 TEXT NOT NULL,
  -- Z-API fields
  zapi_instance_id     TEXT,
  zapi_token           TEXT,
  zapi_client_token    TEXT,
  -- Meta Cloud API fields (futuro)
  phone_number_id      TEXT,
  waba_id              TEXT,
  access_token_enc     TEXT,
  -- Controle
  provider             TEXT NOT NULL DEFAULT 'zapi' CHECK (provider IN ('zapi', 'meta', 'twilio')),
  status               TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'pending_review', 'banned')),
  webhook_verify_token TEXT,
  quality_rating       TEXT DEFAULT 'GREEN' CHECK (quality_rating IN ('GREEN', 'YELLOW', 'RED')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. TEMPLATES WHATSAPP ───────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'pt_BR',
  category      TEXT NOT NULL DEFAULT 'MARKETING' CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  status        TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED', 'PENDING', 'REJECTED', 'PAUSED')),
  componentes   JSONB NOT NULL DEFAULT '[]',
  variaveis     JSONB NOT NULL DEFAULT '[]',
  preview_text  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wpp_templates_account ON whatsapp_templates(account_id);
CREATE INDEX IF NOT EXISTS idx_wpp_templates_status  ON whatsapp_templates(status);

-- ─── 3. SEGMENTOS DE CLIENTES ────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_segments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT NOT NULL,
  descricao        TEXT,
  tipo             TEXT NOT NULL DEFAULT 'automatico' CHECK (tipo IN ('automatico', 'manual', 'hibrido')),
  regras           JSONB NOT NULL DEFAULT '{}',
  customer_count   INT DEFAULT 0,
  ultima_contagem  TIMESTAMPTZ,
  criado_por       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segments_tipo ON customer_segments(tipo);

-- Segmentos automáticos pré-criados
INSERT INTO customer_segments (nome, descricao, tipo, regras) VALUES
  (
    'VIP em Risco',
    'Clientes VIP que não compram há mais tempo que o intervalo médio deles',
    'automatico',
    '{"next_best_action": "tratamento_vip", "source": "vw_clientes_vip_risco"}'
  ),
  (
    'Recompra Provável',
    'Clientes com alta chance de recompra pelo score de inteligência',
    'automatico',
    '{"next_best_action_in": ["sugerir_recompra", "oferta_kit"], "source": "vw_clientes_inteligencia", "score_min": 60}'
  ),
  (
    'Reativação sem Cupom',
    'Clientes inativos que podem ser reativados sem desconto',
    'automatico',
    '{"next_best_action": "reativar_sem_desconto", "source": "vw_clientes_inteligencia"}'
  ),
  (
    'Reativação com Cupom',
    'Clientes inativos com maior risco de churn — oferecer desconto',
    'automatico',
    '{"next_best_action": "reativacao_com_cupom", "source": "vw_clientes_inteligencia"}'
  ),
  (
    'Carrinhos Abandonados',
    'Clientes que abandonaram o carrinho com alto score de recuperação',
    'automatico',
    '{"source": "carrinhos_abandonados", "score_min": 50}'
  ),
  (
    'Assinatura Potencial',
    'Clientes com padrão recorrente — candidatos a assinar',
    'automatico',
    '{"next_best_action": "oferecer_assinatura", "source": "vw_clientes_inteligencia"}'
  )
ON CONFLICT DO NOTHING;

-- ─── 4. CAMPANHAS WHATSAPP ───────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_whatsapp (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                  TEXT NOT NULL,
  descricao             TEXT,
  segment_id            UUID REFERENCES customer_segments(id) ON DELETE SET NULL,
  account_id            UUID NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE RESTRICT,
  template_id           UUID REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
  variaveis_mapa        JSONB NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'agendada', 'enviando', 'concluida', 'pausada', 'erro')),
  agendada_para         TIMESTAMPTZ,
  enviada_em            TIMESTAMPTZ,
  concluida_em          TIMESTAMPTZ,
  total_destinatarios   INT DEFAULT 0,
  total_enviados        INT DEFAULT 0,
  total_erros           INT DEFAULT 0,
  total_entregues       INT DEFAULT 0,
  total_lidos           INT DEFAULT 0,
  total_convertidos     INT DEFAULT 0,
  receita_atribuida     NUMERIC(12,2) DEFAULT 0,
  janela_atribuicao_dias INT DEFAULT 7,
  criado_por            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status       ON campaign_whatsapp(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_segment      ON campaign_whatsapp(segment_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_agendada     ON campaign_whatsapp(agendada_para) WHERE agendada_para IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_created      ON campaign_whatsapp(created_at DESC);

-- ─── 5. DESTINATÁRIOS DE CAMPANHA ────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_recipients (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           UUID NOT NULL REFERENCES campaign_whatsapp(id) ON DELETE CASCADE,
  cliente_id            UUID REFERENCES v2_clientes(id) ON DELETE SET NULL,
  telefone              TEXT NOT NULL,
  variaveis_resolvidas  JSONB NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'enviado', 'entregue', 'lido', 'respondido', 'erro', 'opt_out')),
  wamid                 TEXT,
  erro_detalhe          TEXT,
  enviado_em            TIMESTAMPTZ,
  entregue_em           TIMESTAMPTZ,
  lido_em               TIMESTAMPTZ,
  respondido_em         TIMESTAMPTZ,
  convertido            BOOLEAN DEFAULT FALSE,
  convertido_em         TIMESTAMPTZ,
  pedido_convertido_id  TEXT REFERENCES v2_pedidos(id) ON DELETE SET NULL,
  receita_atribuida     NUMERIC(12,2) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_recipients_campaign  ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_recipients_cliente   ON campaign_recipients(cliente_id);
CREATE INDEX IF NOT EXISTS idx_recipients_status    ON campaign_recipients(status);
CREATE INDEX IF NOT EXISTS idx_recipients_wamid     ON campaign_recipients(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recipients_converted ON campaign_recipients(convertido) WHERE convertido = TRUE;

-- ─── 6. MENSAGENS WHATSAPP (INBOX UNIFICADO) ─────────────────
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  cliente_id   UUID REFERENCES v2_clientes(id) ON DELETE SET NULL,
  campaign_id  UUID REFERENCES campaign_whatsapp(id) ON DELETE SET NULL,
  recipient_id UUID REFERENCES campaign_recipients(id) ON DELETE SET NULL,
  wamid        TEXT UNIQUE,
  direcao      TEXT NOT NULL CHECK (direcao IN ('outbound', 'inbound')),
  tipo         TEXT NOT NULL DEFAULT 'text' CHECK (tipo IN ('template', 'text', 'image', 'document', 'interactive', 'audio', 'video')),
  conteudo     JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed', 'pending')),
  telefone     TEXT NOT NULL,
  enviado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata     JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_wpp_msgs_wamid     ON whatsapp_messages(wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wpp_msgs_cliente   ON whatsapp_messages(cliente_id);
CREATE INDEX IF NOT EXISTS idx_wpp_msgs_campaign  ON whatsapp_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_wpp_msgs_direcao   ON whatsapp_messages(direcao);
CREATE INDEX IF NOT EXISTS idx_wpp_msgs_telefone  ON whatsapp_messages(telefone);
CREATE INDEX IF NOT EXISTS idx_wpp_msgs_enviado   ON whatsapp_messages(enviado_em DESC);

-- ─── 7. REGRAS DE AUTOMAÇÃO ──────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_rules (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                   TEXT NOT NULL,
  descricao              TEXT,
  ativo                  BOOLEAN NOT NULL DEFAULT FALSE,
  trigger_tipo           TEXT NOT NULL
    CHECK (trigger_tipo IN ('dias_desde_compra', 'score_mudou', 'carrinho_abandonado', 'primeiro_pedido', 'aniversario_cliente')),
  trigger_config         JSONB NOT NULL DEFAULT '{}',
  condicoes              JSONB NOT NULL DEFAULT '{}',
  account_id             UUID NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE RESTRICT,
  template_id            UUID REFERENCES whatsapp_templates(id) ON DELETE SET NULL,
  variaveis_mapa         JSONB NOT NULL DEFAULT '{}',
  delay_minutos          INT DEFAULT 0,
  janela_horario_inicio  TIME DEFAULT '08:00',
  janela_horario_fim     TIME DEFAULT '20:00',
  dias_semana            INT[] DEFAULT '{1,2,3,4,5}',
  cooldown_dias          INT DEFAULT 7,
  max_envios_dia         INT DEFAULT 500,
  criado_por             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_ativo  ON automation_rules(ativo) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_automation_trigger ON automation_rules(trigger_tipo);

-- ─── 8. EXECUÇÕES DE AUTOMAÇÃO ───────────────────────────────
CREATE TABLE IF NOT EXISTS automation_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id              UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  cliente_id           UUID REFERENCES v2_clientes(id) ON DELETE SET NULL,
  message_id           UUID REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  trigger_evento       TEXT NOT NULL,
  trigger_dados        JSONB DEFAULT '{}',
  status               TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'enviado', 'ignorado', 'erro')),
  ignorado_motivo      TEXT,
  processado_em        TIMESTAMPTZ,
  convertido           BOOLEAN DEFAULT FALSE,
  pedido_convertido_id TEXT REFERENCES v2_pedidos(id) ON DELETE SET NULL,
  receita_atribuida    NUMERIC(12,2) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_auto_runs_rule      ON automation_runs(rule_id);
CREATE INDEX IF NOT EXISTS idx_auto_runs_cliente   ON automation_runs(cliente_id);
CREATE INDEX IF NOT EXISTS idx_auto_runs_status    ON automation_runs(status);
CREATE INDEX IF NOT EXISTS idx_auto_runs_processado ON automation_runs(processado_em DESC);

-- ─── 9. ATRIBUIÇÃO DE CONVERSÃO ──────────────────────────────
CREATE TABLE IF NOT EXISTS attribution_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id            TEXT NOT NULL REFERENCES v2_pedidos(id) ON DELETE CASCADE,
  cliente_id           UUID REFERENCES v2_clientes(id) ON DELETE SET NULL,
  campaign_id          UUID REFERENCES campaign_whatsapp(id) ON DELETE SET NULL,
  automation_run_id    UUID REFERENCES automation_runs(id) ON DELETE SET NULL,
  modelo_atribuicao    TEXT NOT NULL DEFAULT 'last_touch'
    CHECK (modelo_atribuicao IN ('last_touch', 'first_touch', 'linear')),
  receita_atribuida    NUMERIC(12,2) DEFAULT 0,
  dias_para_conversao  INT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_attribution_pedido_modelo UNIQUE (pedido_id, modelo_atribuicao)
);

CREATE INDEX IF NOT EXISTS idx_attribution_pedido    ON attribution_orders(pedido_id);
CREATE INDEX IF NOT EXISTS idx_attribution_campaign  ON attribution_orders(campaign_id);
CREATE INDEX IF NOT EXISTS idx_attribution_auto_run  ON attribution_orders(automation_run_id);
CREATE INDEX IF NOT EXISTS idx_attribution_cliente   ON attribution_orders(cliente_id);

-- ─── 10. OPT-OUT DE CLIENTES ─────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_optouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone    TEXT NOT NULL UNIQUE,
  cliente_id  UUID REFERENCES v2_clientes(id) ON DELETE SET NULL,
  motivo      TEXT DEFAULT 'solicitacao_cliente',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_optouts_telefone  ON whatsapp_optouts(telefone);
CREATE INDEX IF NOT EXISTS idx_optouts_cliente   ON whatsapp_optouts(cliente_id);

-- ─── TRIGGERS DE updated_at ──────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'whatsapp_accounts',
    'whatsapp_templates',
    'customer_segments',
    'campaign_whatsapp',
    'automation_rules'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_updated_at_%I ON %I;
       CREATE TRIGGER trg_updated_at_%I
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END;
$$;

-- ─── VIEW: MÉTRICAS DE CAMPANHA ──────────────────────────────
CREATE OR REPLACE VIEW vw_campaign_metrics AS
SELECT
  c.id,
  c.nome,
  c.status,
  c.created_at,
  c.agendada_para,
  c.enviada_em,
  c.total_destinatarios,
  c.total_enviados,
  c.total_erros,
  c.total_entregues,
  c.total_lidos,
  c.total_convertidos,
  c.receita_atribuida,
  s.nome AS segmento_nome,
  t.template_name,
  CASE WHEN c.total_enviados > 0
    THEN ROUND((c.total_lidos::NUMERIC / c.total_enviados) * 100, 1)
    ELSE 0
  END AS taxa_leitura,
  CASE WHEN c.total_enviados > 0
    THEN ROUND((c.total_convertidos::NUMERIC / c.total_enviados) * 100, 1)
    ELSE 0
  END AS taxa_conversao
FROM campaign_whatsapp c
LEFT JOIN customer_segments s ON s.id = c.segment_id
LEFT JOIN whatsapp_templates t ON t.id = c.template_id;

-- ─── VIEW: INBOX UNIFICADO (ÚLTIMAS CONVERSAS) ───────────────
CREATE OR REPLACE VIEW vw_whatsapp_inbox AS
SELECT DISTINCT ON (m.telefone)
  m.telefone,
  m.cliente_id,
  cl.nome AS cliente_nome,
  m.enviado_em AS ultima_mensagem_em,
  m.direcao AS ultima_direcao,
  m.conteudo,
  m.status AS ultimo_status,
  COUNT(*) FILTER (WHERE m2.direcao = 'inbound' AND m2.status = 'sent')
    OVER (PARTITION BY m.telefone) AS nao_lidas
FROM whatsapp_messages m
LEFT JOIN v2_clientes cl ON cl.id = m.cliente_id
LEFT JOIN whatsapp_messages m2 ON m2.telefone = m.telefone
ORDER BY m.telefone, m.enviado_em DESC;

-- ─── COMENTÁRIOS ─────────────────────────────────────────────
COMMENT ON TABLE whatsapp_accounts    IS 'Contas WhatsApp Business conectadas (Z-API ou Meta Cloud API)';
COMMENT ON TABLE whatsapp_templates   IS 'Templates de mensagem aprovados para disparo';
COMMENT ON TABLE customer_segments    IS 'Segmentos de clientes para campanhas';
COMMENT ON TABLE campaign_whatsapp    IS 'Campanhas de disparo em massa';
COMMENT ON TABLE campaign_recipients  IS 'Destinatários individuais por campanha com tracking';
COMMENT ON TABLE whatsapp_messages    IS 'Inbox unificado: todas as mensagens enviadas e recebidas';
COMMENT ON TABLE automation_rules     IS 'Regras de automação baseadas em triggers';
COMMENT ON TABLE automation_runs      IS 'Log de execuções de automações por cliente';
COMMENT ON TABLE attribution_orders   IS 'Atribuição de pedidos a campanhas ou automações';
COMMENT ON TABLE whatsapp_optouts     IS 'Clientes que optaram por não receber mensagens';
