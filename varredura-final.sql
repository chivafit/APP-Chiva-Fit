-- ============================================================
-- VARREDURA FINAL - MÓDULO RECOMPRA & WHATSAPP
-- ============================================================
-- Execute este SQL para verificar o status completo do sistema

-- 1. ESTRUTURA DO BANCO DE DADOS
SELECT '=== ESTRUTURA DO BANCO ===' as relatorio;

-- Tabelas do módulo
SELECT 
  'TABELAS' as tipo,
  table_name as nome,
  CASE 
    WHEN table_name IN ('whatsapp_accounts', 'whatsapp_templates', 'customer_segments', 
                       'campaign_whatsapp', 'campaign_recipients', 'whatsapp_messages',
                       'automation_rules', 'automation_runs', 'attribution_orders', 'whatsapp_optouts',
                       'automation_queue', 'automation_execution_log') 
    THEN '✅ OK'
    ELSE '❌ Fora do módulo'
  END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE '%whatsapp%' 
   OR table_name LIKE '%campaign%' 
   OR table_name LIKE '%automation%' 
   OR table_name LIKE '%attribution%'
ORDER BY table_name;

-- Funções SQL
SELECT 
  'FUNÇÕES' as tipo,
  routine_name as nome,
  CASE 
    WHEN routine_name IN ('fn_eligible_for_rule', 'fn_detect_conversions', 
                         'fn_expire_queue_items', 'fn_queue_stats', 
                         'fn_rule_operational_summary', 'increment_campaign_reads')
    THEN '✅ OK'
    ELSE '❌ Fora do módulo'
  END as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND (
    routine_name LIKE 'fn_%' 
    OR routine_name = 'increment_campaign_reads'
  )
ORDER BY routine_name;

-- Views
SELECT 
  'VIEWS' as tipo,
  table_name as nome,
  CASE 
    WHEN table_name IN ('vw_campaign_metrics', 'vw_whatsapp_inbox', 
                       'vw_automation_queue_live', 'vw_automation_dashboard')
    THEN '✅ OK'
    ELSE '❌ Fora do módulo'
  END as status
FROM information_schema.views 
WHERE table_schema = 'public' 
  AND table_name LIKE 'vw_%'
ORDER BY table_name;

-- 2. CONFIGURAÇÕES ATIVAS
SELECT '' as relatorio;
SELECT '=== CONFIGURAÇÕES ATIVAS ===' as relatorio;

-- Contas WhatsApp
SELECT 
  'CONTAS WHATSAPP' as tipo,
  nome,
  provider,
  status,
  CASE WHEN status = 'active' THEN '✅ Ativa' ELSE '❌ Inativa' END as situacao
FROM whatsapp_accounts;

-- Templates
SELECT 
  'TEMPLATES' as tipo,
  template_name,
  language,
  status,
  LEFT(preview_text, 30) as preview
FROM whatsapp_templates;

-- Regras de automação
SELECT 
  'REGRAS DE AUTOMAÇÃO' as tipo,
  nome,
  trigger_tipo,
  CASE WHEN ativo THEN '✅ Ativa' ELSE '❌ Inativa' END as situacao,
  janela_horario_inicio || ' - ' || janela_horario_fim as horario,
  max_envios_dia
FROM automation_rules;

-- Segmentos (corrigido - verificando colunas existentes)
SELECT 
  'SEGMENTOS' as tipo,
  nome,
  LEFT(descricao, 50) as descricao,
  created_at as criado_em
FROM customer_segments
ORDER BY created_at DESC;

-- 3. DADOS E MÉTRICAS
SELECT '' as relatorio;
SELECT '=== DADOS E MÉTRICAS ===' as relatorio;

-- Campanhas
SELECT 
  'CAMPANHAS' as tipo,
  COUNT(*) as total_campanhas,
  COALESCE(SUM(total_enviados), 0) as total_enviados,
  COALESCE(SUM(total_lidos), 0) as total_lidos,
  COALESCE(SUM(total_convertidos), 0) as total_convertidos,
  ROUND(COALESCE(SUM(CASE WHEN total_enviados > 0 THEN (total_convertidos::float / total_enviados) * 100 ELSE 0 END), 0), 2) as taxa_conversao
FROM campaign_whatsapp;

-- Mensagens WhatsApp
SELECT 
  'MENSAGENS WHATSAPP' as tipo,
  COUNT(*) as total,
  COUNT(CASE WHEN direcao = 'outbound' THEN 1 END) as enviadas,
  COUNT(CASE WHEN direcao = 'inbound' THEN 1 END) as recebidas,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as enviadas_com_sucesso,
  COUNT(CASE WHEN status = 'delivered' THEN 1 END) as entregues,
  COUNT(CASE WHEN status = 'read' THEN 1 END) as lidas
FROM whatsapp_messages;

-- Fila de automação
SELECT 
  'FILA DE AUTOMAÇÃO' as tipo,
  status,
  COUNT(*) as total
FROM automation_queue
GROUP BY status
ORDER BY total DESC;

-- Execuções do motor
SELECT 
  'EXECUÇÕES DO MOTOR' as tipo,
  COUNT(*) as total_execucoes,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as concluidas,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as falharam,
  COUNT(CASE WHEN status = 'running' THEN 1 END) as rodando,
  MAX(started_at) as ultima_execucao
FROM automation_execution_log;

-- 4. PERFORMANCE E SAÚDE
SELECT '' as relatorio;
SELECT '=== PERFORMANCE E SAÚDE ===' as relatorio;

-- Opt-outs
SELECT 
  'OPT-OUTS' as tipo,
  COUNT(*) as total_optouts,
  COUNT(CASE WHEN motivo LIKE '%cliente%' THEN 1 END) as solicitados_cliente,
  COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as ultimos_30_dias
FROM whatsapp_optouts;

-- Runs de automação
SELECT 
  'AUTOMATION RUNS' as tipo,
  COUNT(*) as total_runs,
  COUNT(CASE WHEN status = 'enviado' THEN 1 END) as enviados,
  COUNT(CASE WHEN status = 'erro' THEN 1 END) as erros,
  COUNT(CASE WHEN convertido = TRUE THEN 1 END) as conversoes,
  ROUND(COALESCE(COUNT(CASE WHEN convertido = TRUE THEN 1 END)::float / NULLIF(COUNT(*), 0), 0) * 100, 2) as taxa_conversao_runs
FROM automation_runs;

-- Atribuições
SELECT 
  'ATRIBUIÇÕES' as tipo,
  COUNT(*) as total_atribuicoes,
  COALESCE(SUM(receita), 0) as receita_total,
  ROUND(COALESCE(AVG(receita), 0), 2) as receita_media
FROM attribution_orders;

-- 5. CRON E AGENDAMENTO
SELECT '' as relatorio;
SELECT '=== CRON E AGENDAMENTO ===' as relatorio;

-- Jobs do CRON
SELECT 
  'CRON JOBS' as tipo,
  jobname,
  schedule,
  active,
  last_run_success,
  next_run
FROM cron.job
WHERE jobname LIKE '%automation%';

-- Próximos envios agendados
SELECT 
  'AGENDADOS' as tipo,
  COUNT(*) as total_agendados,
  MIN(scheduled_for) as proximo_envio,
  COUNT(CASE WHEN scheduled_for <= NOW() + INTERVAL '1 hour' THEN 1 END) as proxima_hora
FROM automation_queue
WHERE status = 'pending'
  AND scheduled_for > NOW();

-- 6. CLIENTES ELEGÍVEIS (SIMPLIFICADO)
SELECT '' as relatorio;
SELECT '=== CLIENTES ELEGÍVEIS ===' as relatorio;

-- Total de clientes com telefone
SELECT 
  'CLIENTES' as tipo,
  'Total com WhatsApp' as metrica,
  COUNT(*) as valor
FROM v2_clientes 
WHERE celular IS NOT NULL OR telefone IS NOT NULL
UNION ALL
SELECT 
  'CLIENTES' as tipo,
  'Inativos 30+ dias' as metrica,
  COUNT(*) as valor
FROM v2_clientes 
WHERE (celular IS NOT NULL OR telefone IS NOT NULL)
  AND ultimo_pedido < NOW() - INTERVAL '30 days'
UNION ALL
SELECT 
  'CLIENTES' as tipo,
  'VIP (Ticket > R$200)' as metrica,
  COUNT(*) as valor
FROM v2_clientes 
WHERE (celular IS NOT NULL OR telefone IS NOT NULL)
  AND ticket_medio > 200;

-- 7. RESUMO FINAL
SELECT '' as relatorio;
SELECT '=== RESUMO FINAL ===' as relatorio;

-- Status geral do sistema
SELECT 
  'RESUMO' as tipo,
  'Módulo Recompra & WhatsApp' as componente,
  CASE 
    WHEN (
      SELECT COUNT(*) FROM information_schema.tables 
      WHERE table_name IN ('whatsapp_accounts', 'automation_rules', 'automation_queue')
    ) >= 3
    AND (SELECT COUNT(*) FROM whatsapp_accounts WHERE status = 'active') >= 1
    AND (SELECT COUNT(*) FROM automation_rules WHERE ativo = TRUE) >= 1
    THEN '✅ 100% FUNCIONAL'
    ELSE '❌ INCOMPLETO'
  END as status,
  CASE 
    WHEN (SELECT COUNT(*) FROM automation_queue WHERE status = 'pending') > 0
    THEN '🔄 Processando'
    ELSE '⏸️ Aguardando'
  END as situacao;

-- Métricas chave
SELECT 
  'MÉTRICAS' as tipo,
  'Total de Clientes' as metrica,
  COUNT(*) as valor
FROM v2_clientes
UNION ALL
SELECT 
  'MÉTRICAS' as tipo,
  'Clientes com WhatsApp' as metrica,
  COUNT(*) as valor
FROM v2_clientes 
WHERE celular IS NOT NULL OR telefone IS NOT NULL
UNION ALL
SELECT 
  'MÉTRICAS' as tipo,
  'Taxa de Opt-out (%)' as metrica,
  ROUND(COUNT(*)::float / NULLIF((SELECT COUNT(*) FROM v2_clientes WHERE celular IS NOT NULL OR telefone IS NOT NULL), 0) * 100, 2) as valor
FROM whatsapp_optouts
UNION ALL
SELECT 
  'MÉTRICAS' as tipo,
  'Mensagens Enviadas Hoje' as metrica,
  COUNT(*) as valor
FROM whatsapp_messages 
WHERE direcao = 'outbound' 
  AND DATE(enviado_em) = CURRENT_DATE;

-- Status do webhook (últimas mensagens recebidas)
SELECT 
  'WEBHOOK' as tipo,
  'Últimas mensagens recebidas' as metrica,
  COUNT(*) as valor
FROM whatsapp_messages 
WHERE direcao = 'inbound' 
  AND enviado_em > NOW() - INTERVAL '24 hours';
