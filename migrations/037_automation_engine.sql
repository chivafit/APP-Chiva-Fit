-- ════════════════════════════════════════════════════════════════
-- MIGRAÇÃO 037 — Motor de Automação de Recompra (Fase 2)
-- ════════════════════════════════════════════════════════════════
--
-- ARQUITETURA DO FLUXO (executa a cada 15 min):
--
--   cron → automation-engine (Edge Function)
--              │
--        ┌─────▼─────────────────────────────────┐
--        │  1. Avalia regras ativas               │
--        │  2. fn_eligible_for_rule() → filtra    │
--        │     opt-out, cooldown, já converteu    │
--        │  3. INSERT automation_queue            │
--        │     (ON CONFLICT DO NOTHING = dedup)   │
--        │  4. Despacha fila pendente             │
--        │     → provider.send()                  │
--        │     → automation_runs                  │
--        │     → whatsapp_messages                │
--        │  5. fn_detect_conversions()            │
--        │  6. Atualiza execution_log             │
--        └────────────────────────────────────────┘
--
-- PROTEÇÕES:
--   ✓ Opt-out   (whatsapp_optouts — verificado em fn_eligible_for_rule)
--   ✓ Cooldown  (automation_queue + automation_runs — verificado em fn_eligible_for_rule)
--   ✓ Dedup ativo (partial unique index: rule_id + telefone WHERE pending/processing)
--   ✓ Janela de horário (verif. no dispatch, agenda para próxima janela se fora)
--   ✓ Limite diário (max_envios_dia — verif. no dispatch)
--   ✓ Já converteu (nova compra após último trigger — verif. em fn_eligible_for_rule)
--   ✓ Retry com backoff exponencial (attempts + scheduled_for)
--   ✓ Expiração automática (expires_at)
-- ════════════════════════════════════════════════════════════════

-- ─── 1. FILA DE AUTOMAÇÃO ────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_queue (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id               UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  cliente_id            UUID REFERENCES v2_clientes(id) ON DELETE SET NULL,
  telefone              TEXT NOT NULL,
  variaveis_resolvidas  JSONB NOT NULL DEFAULT '{}',
  trigger_data          JSONB NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',        -- aguardando disparo
      'processing',     -- sendo processado (lock otimista)
      'sent',           -- enviado com sucesso
      'delivered',      -- entregue (via webhook)
      'read',           -- lido (via webhook)
      'failed',         -- falhou (esgotou tentativas)
      'skipped',        -- pulado (regra de proteção pós-enfileiramento)
      'expired',        -- expirou sem ser despachado
      'opted_out',      -- cliente optou por não receber (pós-enfileiramento)
      'already_converted' -- cliente comprou antes do envio
    )),
  priority              INT DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  scheduled_for         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts              INT DEFAULT 0,
  max_attempts          INT DEFAULT 3,
  last_attempt_at       TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  error_detail          TEXT,
  wamid                 TEXT,
  run_id                UUID,   -- preenchido após disparo (FK para automation_runs)
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deduplicação ativa: impede mesma regra enfileirar 2x o mesmo telefone enquanto pendente/processando
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_active_dedup
  ON automation_queue (rule_id, telefone)
  WHERE status IN ('pending', 'processing');

-- Índices para polling eficiente da fila
CREATE INDEX IF NOT EXISTS idx_queue_dispatch
  ON automation_queue (status, scheduled_for, priority DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_queue_rule_status  ON automation_queue (rule_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_cliente       ON automation_queue (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_queue_wamid         ON automation_queue (wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_queue_created       ON automation_queue (created_at DESC);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_updated_at_automation_queue ON automation_queue;
CREATE TRIGGER trg_updated_at_automation_queue
  BEFORE UPDATE ON automation_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 2. LOG DE EXECUÇÕES DO MOTOR ────────────────────────────
CREATE TABLE IF NOT EXISTS automation_execution_log (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at           TIMESTAMPTZ,
  triggered_by          TEXT NOT NULL DEFAULT 'cron'
    CHECK (triggered_by IN ('cron', 'manual', 'webhook', 'system')),
  rules_evaluated       INT DEFAULT 0,
  customers_evaluated   INT DEFAULT 0,
  newly_enqueued        INT DEFAULT 0,
  dispatched            INT DEFAULT 0,
  sent                  INT DEFAULT 0,
  failed                INT DEFAULT 0,
  skipped               INT DEFAULT 0,
  skipped_cooldown      INT DEFAULT 0,
  skipped_opted_out     INT DEFAULT 0,
  skipped_converted     INT DEFAULT 0,
  conversions_detected  INT DEFAULT 0,
  errors                JSONB NOT NULL DEFAULT '[]',
  status                TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  duration_ms           INT,
  metadata              JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_exec_log_started ON automation_execution_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_log_status  ON automation_execution_log(status);

-- ─── 3. FUNÇÃO: Expirar itens vencidos ───────────────────────
CREATE OR REPLACE FUNCTION fn_expire_queue_items()
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
BEGIN
  UPDATE automation_queue
  SET status = 'expired', updated_at = NOW()
  WHERE status IN ('pending', 'processing')
    AND expires_at < NOW()
  RETURNING id INTO v_count;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN COALESCE(v_count, 0);
END;
$$;

-- ─── 4. FUNÇÃO: Elegíveis por regra ──────────────────────────
-- Retorna clientes elegíveis para uma regra, já aplicando todas as proteções:
-- opt-out, cooldown, dedup, já converteu.
CREATE OR REPLACE FUNCTION fn_eligible_for_rule(
  p_rule_id  UUID,
  p_limit    INT DEFAULT 200
)
RETURNS TABLE (
  cliente_id           UUID,
  telefone             TEXT,
  nome                 TEXT,
  trigger_dados        JSONB,
  variaveis_hint       JSONB  -- campos base para resolver template vars
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rule         automation_rules%ROWTYPE;
  v_dias         INT;
  v_minutos      INT;
  v_score_min    INT;
  v_action       TEXT;
BEGIN
  -- Carrega regra
  SELECT * INTO v_rule
  FROM automation_rules
  WHERE id = p_rule_id AND ativo = TRUE;

  IF NOT FOUND THEN RETURN; END IF;

  -- Extrai config tipada
  v_dias      := COALESCE((v_rule.trigger_config->>'dias')::int, 15);
  v_minutos   := COALESCE((v_rule.trigger_config->>'minutos')::int, 60);
  v_score_min := COALESCE((v_rule.trigger_config->>'score_min')::int, 50);
  v_action    := v_rule.trigger_config->>'next_best_action';

  RETURN QUERY

  -- ─── CTEs de proteção (aplicadas a todos os triggers) ───────
  WITH

  opted_out AS (
    SELECT LOWER(REGEXP_REPLACE(o.telefone, '\D', '', 'g')) AS tel
    FROM whatsapp_optouts o
  ),

  -- Clientes em cooldown: têm item ativo na fila OU run recente para esta regra
  in_cooldown AS (
    SELECT DISTINCT q.cliente_id AS cid, q.telefone AS tel
    FROM automation_queue q
    WHERE q.rule_id = p_rule_id
      AND q.status NOT IN ('failed', 'expired', 'already_converted')
      AND q.created_at > NOW() - (v_rule.cooldown_dias || ' days')::interval
    UNION
    SELECT DISTINCT r.cliente_id, NULL AS tel
    FROM automation_runs r
    WHERE r.rule_id = p_rule_id
      AND r.status = 'enviado'
      AND r.processado_em > NOW() - (v_rule.cooldown_dias || ' days')::interval
  ),

  -- Clientes que já compraram DEPOIS do último trigger desta regra (skip recompra)
  already_converted AS (
    SELECT DISTINCT ar.cliente_id AS cid
    FROM automation_runs ar
    WHERE ar.rule_id = p_rule_id
      AND ar.status = 'enviado'
      AND EXISTS (
        SELECT 1 FROM v2_pedidos p
        WHERE p.cliente_id = ar.cliente_id
          AND p.created_at > ar.processado_em
          AND p.created_at > NOW() - INTERVAL '30 days'
      )
  ),

  -- ─── TRIGGER: dias_desde_compra ─────────────────────────────
  eligible_dias_compra AS (
    SELECT
      c.id                                               AS cliente_id,
      REGEXP_REPLACE(
        COALESCE(NULLIF(c.celular,''), NULLIF(c.telefone,'')), '\D','','g'
      )                                                  AS telefone,
      c.nome,
      jsonb_build_object(
        'trigger',          'dias_desde_compra',
        'dias_sem_compra',  EXTRACT(DAY FROM NOW() - c.ultimo_pedido)::int,
        'ultimo_pedido',    c.ultimo_pedido
      )                                                  AS trigger_dados,
      jsonb_build_object(
        'nome',           split_part(c.nome, ' ', 1),
        'ticket_medio',   c.ticket_medio,
        'total_pedidos',  c.total_pedidos,
        'total_gasto',    c.ltv,
        'ultimo_pedido',  c.ultimo_pedido,
        'cidade',         c.cidade,
        'uf',             c.uf
      )                                                  AS variaveis_hint
    FROM v2_clientes c
    WHERE v_rule.trigger_tipo = 'dias_desde_compra'
      AND COALESCE(NULLIF(c.celular,''), NULLIF(c.telefone,'')) IS NOT NULL
      AND c.ultimo_pedido IS NOT NULL
      AND EXTRACT(DAY FROM NOW() - c.ultimo_pedido)::int >= v_dias
      -- Janela: até cooldown+3 dias além do trigger (evita acumular demais)
      AND EXTRACT(DAY FROM NOW() - c.ultimo_pedido)::int < (v_dias + GREATEST(v_rule.cooldown_dias, 3))
  ),

  -- ─── TRIGGER: primeiro_pedido ───────────────────────────────
  eligible_primeiro_pedido AS (
    SELECT
      c.id,
      REGEXP_REPLACE(
        COALESCE(NULLIF(c.celular,''), NULLIF(c.telefone,'')), '\D','','g'
      ),
      c.nome,
      jsonb_build_object('trigger', 'primeiro_pedido', 'total_pedidos', c.total_pedidos),
      jsonb_build_object(
        'nome',           split_part(c.nome, ' ', 1),
        'ticket_medio',   c.ticket_medio,
        'total_pedidos',  1,
        'total_gasto',    c.ltv
      )
    FROM v2_clientes c
    WHERE v_rule.trigger_tipo = 'primeiro_pedido'
      AND COALESCE(NULLIF(c.celular,''), NULLIF(c.telefone,'')) IS NOT NULL
      AND c.total_pedidos = 1
      AND c.ultimo_pedido > NOW() - INTERVAL '7 days'
      AND c.ultimo_pedido <= NOW() - (
        COALESCE((v_rule.trigger_config->>'delay_horas')::int, 2) || ' hours'
      )::interval
  ),

  -- ─── TRIGGER: score_mudou (next_best_action) ────────────────
  eligible_score AS (
    SELECT
      ci.id,
      REGEXP_REPLACE(
        COALESCE(NULLIF(ci.celular,''), NULLIF(ci.telefone,'')), '\D','','g'
      ),
      ci.nome,
      jsonb_build_object(
        'trigger',          'score_mudou',
        'score',            ci.score_recompra,
        'next_best_action', ci.next_best_action,
        'segmento',         ci.segmento_crm
      ),
      jsonb_build_object(
        'nome',           split_part(ci.nome, ' ', 1),
        'ticket_medio',   ci.ticket_medio,
        'total_pedidos',  ci.total_pedidos,
        'total_gasto',    ci.ltv,
        'ultimo_pedido',  ci.ultimo_pedido,
        'cidade',         ci.cidade,
        'uf',             ci.uf
      )
    FROM vw_clientes_inteligencia ci
    WHERE v_rule.trigger_tipo = 'score_mudou'
      AND COALESCE(NULLIF(ci.celular,''), NULLIF(ci.telefone,'')) IS NOT NULL
      AND (
        (v_action IS NOT NULL AND ci.next_best_action = v_action)
        OR
        (v_action IS NULL AND ci.score_recompra >= v_score_min)
      )
  ),

  -- ─── TRIGGER: carrinho_abandonado ───────────────────────────
  eligible_carrinho AS (
    SELECT
      c.id,
      REGEXP_REPLACE(
        COALESCE(NULLIF(ca.telefone,''), NULLIF(COALESCE(NULLIF(c.celular,''), c.telefone),'')), '\D','','g'
      ),
      COALESCE(c.nome, ca.cliente_nome),
      jsonb_build_object(
        'trigger',             'carrinho_abandonado',
        'valor_carrinho',      ca.valor,
        'minutos_abandonado',  EXTRACT(EPOCH FROM NOW() - ca.criado_em)::int / 60,
        'score_recuperacao',   ca.score_recuperacao
      ),
      jsonb_build_object(
        'nome',           split_part(COALESCE(c.nome, ca.cliente_nome, ''), ' ', 1),
        'ticket_medio',   ca.valor,
        'total_gasto',    c.ltv
      )
    FROM carrinhos_abandonados ca
    LEFT JOIN v2_clientes c ON
      (ca.email IS NOT NULL AND c.email = ca.email)
      OR REGEXP_REPLACE(COALESCE(ca.telefone,''),'\D','','g') =
         REGEXP_REPLACE(COALESCE(NULLIF(c.celular,''),c.telefone,''),'\D','','g')
    WHERE v_rule.trigger_tipo = 'carrinho_abandonado'
      AND NOT ca.recuperado
      AND ca.score_recuperacao >= v_score_min
      AND ca.criado_em <= NOW() - (v_minutos || ' minutes')::interval
      AND ca.criado_em >= NOW() - ((v_minutos * 10) || ' minutes')::interval  -- janela 10x
      AND COALESCE(
        REGEXP_REPLACE(ca.telefone, '\D','','g'),
        REGEXP_REPLACE(COALESCE(NULLIF(c.celular,''),c.telefone,''), '\D','','g')
      ) IS NOT NULL
  ),

  -- ─── TRIGGER: aniversario_cliente ───────────────────────────
  eligible_aniversario AS (
    SELECT
      c.id,
      REGEXP_REPLACE(
        COALESCE(NULLIF(c.celular,''), NULLIF(c.telefone,'')), '\D','','g'
      ),
      c.nome,
      jsonb_build_object('trigger', 'aniversario_cliente', 'data_nascimento', c.data_nascimento),
      jsonb_build_object('nome', split_part(c.nome, ' ', 1))
    FROM v2_clientes c
    WHERE v_rule.trigger_tipo = 'aniversario_cliente'
      AND COALESCE(NULLIF(c.celular,''), NULLIF(c.telefone,'')) IS NOT NULL
      AND c.data_nascimento IS NOT NULL
      AND EXTRACT(MONTH FROM c.data_nascimento) = EXTRACT(MONTH FROM NOW())
      AND EXTRACT(DAY   FROM c.data_nascimento) = EXTRACT(DAY   FROM NOW())
  ),

  -- ─── União de todos os triggers ─────────────────────────────
  all_eligible AS (
    SELECT * FROM eligible_dias_compra
    UNION ALL
    SELECT * FROM eligible_primeiro_pedido
    UNION ALL
    SELECT * FROM eligible_score
    UNION ALL
    SELECT * FROM eligible_carrinho
    UNION ALL
    SELECT * FROM eligible_aniversario
  )

  -- ─── Aplica proteções ───────────────────────────────────────
  SELECT
    ae.cliente_id,
    ae.telefone,
    ae.nome,
    ae.trigger_dados,
    ae.variaveis_hint
  FROM all_eligible ae
  WHERE
    ae.telefone IS NOT NULL
    AND LENGTH(ae.telefone) >= 10
    -- Opt-out: exclui se telefone normalizado está na lista
    AND LOWER(REGEXP_REPLACE(ae.telefone, '\D','','g')) NOT IN (SELECT tel FROM opted_out)
    -- Cooldown por cliente_id
    AND (ae.cliente_id IS NULL OR ae.cliente_id NOT IN (
      SELECT cid FROM in_cooldown WHERE cid IS NOT NULL
    ))
    -- Cooldown por telefone (para clientes sem ID)
    AND REGEXP_REPLACE(ae.telefone, '\D','','g') NOT IN (
      SELECT tel FROM in_cooldown WHERE tel IS NOT NULL
    )
    -- Já converteu após trigger
    AND (ae.cliente_id IS NULL OR ae.cliente_id NOT IN (
      SELECT cid FROM already_converted
    ))
  LIMIT p_limit;

END;
$$;

-- ─── 5. FUNÇÃO: Detectar conversões ──────────────────────────
-- Detecta pedidos realizados dentro da janela de atribuição após mensagens enviadas.
-- Atualiza automation_runs.convertido, cria attribution_orders, atualiza contadores.
CREATE OR REPLACE FUNCTION fn_detect_conversions(
  p_attribution_days INT DEFAULT 7
)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_count INT := 0;
  v_rec   RECORD;
BEGIN
  -- Para cada pedido recente sem atribuição
  FOR v_rec IN
    SELECT
      p.id             AS pedido_id,
      p.cliente_id,
      p.total_amount   AS receita,
      p.created_at     AS pedido_em,
      ar.id            AS run_id,
      ar.rule_id,
      c.id             AS campaign_id
    FROM v2_pedidos p
    JOIN v2_clientes cl ON cl.id = p.cliente_id
    -- Tenta encontrar automation_run recente para este cliente
    LEFT JOIN automation_runs ar ON
      ar.cliente_id = p.cliente_id
      AND ar.status = 'enviado'
      AND ar.processado_em BETWEEN p.created_at - (p_attribution_days || ' days')::interval AND p.created_at
    -- Tenta encontrar campaign_recipient recente
    LEFT JOIN campaign_recipients cr ON
      cr.cliente_id = p.cliente_id
      AND cr.status IN ('enviado', 'entregue', 'lido')
      AND cr.enviado_em BETWEEN p.created_at - (p_attribution_days || ' days')::interval AND p.created_at
    LEFT JOIN campaign_whatsapp c ON c.id = cr.campaign_id
    WHERE p.created_at >= NOW() - INTERVAL '8 days'
      AND NOT EXISTS (
        SELECT 1 FROM attribution_orders ao WHERE ao.pedido_id = p.id
      )
      AND (ar.id IS NOT NULL OR cr.id IS NOT NULL)
  LOOP
    -- Cria atribuição
    INSERT INTO attribution_orders (
      pedido_id, cliente_id, campaign_id, automation_run_id,
      modelo_atribuicao, receita_atribuida,
      dias_para_conversao
    )
    VALUES (
      v_rec.pedido_id, v_rec.cliente_id, v_rec.campaign_id, v_rec.run_id,
      'last_touch', COALESCE(v_rec.receita, 0),
      EXTRACT(DAY FROM v_rec.pedido_em - (
        SELECT processado_em FROM automation_runs WHERE id = v_rec.run_id
      ))::int
    )
    ON CONFLICT (pedido_id, modelo_atribuicao) DO NOTHING;

    -- Marca automation_run como convertido
    IF v_rec.run_id IS NOT NULL THEN
      UPDATE automation_runs
      SET convertido = TRUE, pedido_convertido_id = v_rec.pedido_id,
          receita_atribuida = COALESCE(v_rec.receita, 0)
      WHERE id = v_rec.run_id AND NOT convertido;

      -- Atualiza item da fila
      UPDATE automation_queue
      SET status = 'read'  -- mantém status mas marca conversão via run
      WHERE run_id = v_rec.run_id;
    END IF;

    -- Atualiza totais da campanha
    IF v_rec.campaign_id IS NOT NULL THEN
      UPDATE campaign_whatsapp
      SET total_convertidos = total_convertidos + 1,
          receita_atribuida = receita_atribuida + COALESCE(v_rec.receita, 0)
      WHERE id = v_rec.campaign_id;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ─── 6. FUNÇÃO: Estatísticas da fila ─────────────────────────
CREATE OR REPLACE FUNCTION fn_queue_stats()
RETURNS TABLE (
  status        TEXT,
  total         BIGINT,
  por_regra     JSONB
) LANGUAGE sql STABLE AS $$
  SELECT
    q.status,
    COUNT(*) AS total,
    jsonb_object_agg(ar.nome, cnt) AS por_regra
  FROM automation_queue q
  JOIN automation_rules ar ON ar.id = q.rule_id
  JOIN (
    SELECT rule_id, status AS s, COUNT(*) AS cnt
    FROM automation_queue
    GROUP BY rule_id, status
  ) sub ON sub.rule_id = q.rule_id AND sub.s = q.status
  WHERE q.created_at > NOW() - INTERVAL '48 hours'
  GROUP BY q.status;
$$;

-- ─── 7. FUNÇÃO: Resumo operacional por regra ─────────────────
CREATE OR REPLACE FUNCTION fn_rule_operational_summary()
RETURNS TABLE (
  rule_id            UUID,
  rule_nome          TEXT,
  trigger_tipo       TEXT,
  ativo              BOOLEAN,
  pendentes          BIGINT,
  enviados_24h       BIGINT,
  falhas_24h         BIGINT,
  convertidos        BIGINT,
  taxa_conversao     NUMERIC,
  ultimo_envio       TIMESTAMPTZ,
  proximo_elegivel   BIGINT   -- estimativa: clientes que entrarão na próxima execução
) LANGUAGE sql STABLE AS $$
  SELECT
    r.id,
    r.nome,
    r.trigger_tipo,
    r.ativo,
    COUNT(q.id) FILTER (WHERE q.status = 'pending')             AS pendentes,
    COUNT(q.id) FILTER (WHERE q.status = 'sent' AND q.sent_at > NOW() - INTERVAL '24 hours') AS enviados_24h,
    COUNT(q.id) FILTER (WHERE q.status = 'failed' AND q.updated_at > NOW() - INTERVAL '24 hours') AS falhas_24h,
    COUNT(ar.id) FILTER (WHERE ar.convertido = TRUE)            AS convertidos,
    CASE WHEN COUNT(ar.id) > 0
      THEN ROUND(COUNT(ar.id) FILTER (WHERE ar.convertido)::NUMERIC / COUNT(ar.id) * 100, 1)
      ELSE 0
    END                                                          AS taxa_conversao,
    MAX(q.sent_at)                                              AS ultimo_envio,
    0::BIGINT                                                    AS proximo_elegivel
  FROM automation_rules r
  LEFT JOIN automation_queue q ON q.rule_id = r.id
  LEFT JOIN automation_runs ar ON ar.rule_id = r.id
  GROUP BY r.id, r.nome, r.trigger_tipo, r.ativo
  ORDER BY r.ativo DESC, r.nome;
$$;

-- ─── 8. VIEW: Fila operacional em tempo real ─────────────────
CREATE OR REPLACE VIEW vw_automation_queue_live AS
SELECT
  q.id,
  q.status,
  q.priority,
  q.scheduled_for,
  q.sent_at,
  q.attempts,
  q.max_attempts,
  q.error_detail,
  q.wamid,
  q.created_at,
  q.expires_at,
  q.trigger_data,
  ar.nome      AS rule_nome,
  ar.trigger_tipo,
  ar.cooldown_dias,
  c.nome       AS cliente_nome,
  q.telefone
FROM automation_queue q
JOIN automation_rules ar ON ar.id = q.rule_id
LEFT JOIN v2_clientes c ON c.id = q.cliente_id
ORDER BY
  CASE q.status
    WHEN 'processing' THEN 1
    WHEN 'pending'    THEN 2
    WHEN 'sent'       THEN 3
    WHEN 'failed'     THEN 4
    ELSE 5
  END,
  q.priority DESC,
  q.scheduled_for;

COMMENT ON VIEW vw_automation_queue_live IS 'Fila de automação em tempo real, ordenada por urgência';

-- ─── 9. VIEW: Dashboard operacional ──────────────────────────
CREATE OR REPLACE VIEW vw_automation_dashboard AS
SELECT
  (SELECT COUNT(*) FROM automation_queue WHERE status = 'pending')                             AS fila_pendente,
  (SELECT COUNT(*) FROM automation_queue WHERE status = 'processing')                          AS fila_processando,
  (SELECT COUNT(*) FROM automation_queue WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '24h') AS enviados_24h,
  (SELECT COUNT(*) FROM automation_queue WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '24h') AS falhas_24h,
  (SELECT COUNT(*) FROM automation_rules WHERE ativo = TRUE)                                   AS regras_ativas,
  (SELECT started_at FROM automation_execution_log ORDER BY started_at DESC LIMIT 1)           AS ultima_execucao,
  (SELECT status FROM automation_execution_log ORDER BY started_at DESC LIMIT 1)               AS ultimo_status,
  (SELECT duration_ms FROM automation_execution_log ORDER BY started_at DESC LIMIT 1)         AS ultima_duracao_ms,
  (SELECT COUNT(*) FROM automation_runs WHERE convertido = TRUE AND processado_em > NOW() - INTERVAL '7d') AS conversoes_7d,
  (SELECT COALESCE(SUM(receita_atribuida), 0) FROM automation_runs WHERE processado_em > NOW() - INTERVAL '7d') AS receita_7d;

-- ─── 10. CRON (Supabase pg_cron) ─────────────────────────────
-- NOTA: execute no SQL Editor do Supabase após habilitar pg_cron:
--
-- SELECT cron.schedule(
--   'automation-engine-15min',
--   '*/15 * * * *',
--   $$
--   SELECT net.http_post(
--     url      := current_setting('app.supabase_url') || '/functions/v1/automation-engine',
--     headers  := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer ' || current_setting('app.service_role_key')
--     ),
--     body     := '{"triggered_by":"cron"}'::jsonb
--   );
--   $$
-- );

-- ─── 11. COLUNA: data_nascimento em v2_clientes (para trigger aniversário) ──
ALTER TABLE v2_clientes ADD COLUMN IF NOT EXISTS data_nascimento DATE;

-- ─── 12. FK retroativa: automation_queue → automation_runs ───
-- (adicionada depois que automation_runs já existe)
-- ALTER TABLE automation_queue
--   ADD CONSTRAINT fk_queue_run FOREIGN KEY (run_id)
--   REFERENCES automation_runs(id) ON DELETE SET NULL;
-- Comentado pois automation_runs pode não ter o registro ainda no momento do insert

COMMENT ON TABLE automation_queue         IS 'Fila central de disparos automáticos. Toda automação passa por aqui.';
COMMENT ON TABLE automation_execution_log IS 'Log histórico de cada execução do motor de automação.';
COMMENT ON FUNCTION fn_eligible_for_rule  IS 'Retorna clientes elegíveis para uma regra, já com proteções aplicadas.';
COMMENT ON FUNCTION fn_detect_conversions IS 'Detecta e registra conversões de pedidos atribuíveis a mensagens enviadas.';
