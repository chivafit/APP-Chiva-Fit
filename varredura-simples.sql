-- ============================================================
-- VARREDURA SIMPLES - MÓDULO RECOMPRA & WHATSAPP
-- ============================================================
-- Execute este SQL para verificar o status básico do sistema

-- 1. ESTRUTURA DO BANCO
SELECT '=== ESTRUTURA ===' as relatorio;
SELECT 
  'TABELAS' as tipo,
  COUNT(*) as total,
  CASE 
    WHEN COUNT(*) >= 12 THEN '✅ OK'
    ELSE '❌ Incompleto'
  END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('whatsapp_accounts', 'whatsapp_templates', 'customer_segments', 
                     'campaign_whatsapp', 'campaign_recipients', 'whatsapp_messages',
                     'automation_rules', 'automation_runs', 'attribution_orders', 'whatsapp_optouts',
                     'automation_queue', 'automation_execution_log');

-- 2. CONFIGURAÇÕES ATIVAS
SELECT '' as relatorio;
SELECT '=== CONFIGURAÇÕES ===' as relatorio;

-- Contas WhatsApp
SELECT 
  'CONTAS WHATSAPP' as tipo,
  COUNT(*) as total,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as ativas
FROM whatsapp_accounts;

-- Templates
SELECT 
  'TEMPLATES' as tipo,
  COUNT(*) as total,
  COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as aprovados
FROM whatsapp_templates;

-- Regras de automação
SELECT 
  'REGRAS DE AUTOMAÇÃO' as tipo,
  COUNT(*) as total,
  COUNT(CASE WHEN ativo = TRUE THEN 1 END) as ativas
FROM automation_rules;

-- 3. DADOS E MÉTRICAS
SELECT '' as relatorio;
SELECT '=== MÉTRICAS ===' as relatorio;

-- Mensagens WhatsApp
SELECT 
  'MENSAGENS' as tipo,
  COUNT(*) as total_mensagens,
  COUNT(CASE WHEN direcao = 'outbound' THEN 1 END) as enviadas,
  COUNT(CASE WHEN direcao = 'inbound' THEN 1 END) as recebidas,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as com_sucesso
FROM whatsapp_messages;

-- Fila de automação
SELECT 
  'FILA AUTOMAÇÃO' as tipo,
  COUNT(*) as total,
  COUNT(CASE WHEN status = 'pending' THEN 1 END) as pendentes,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as enviados,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as falharam
FROM automation_queue;

-- Execuções do motor
SELECT 
  'EXECUÇÕES MOTOR' as tipo,
  COUNT(*) as total_execucoes,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as concluidas,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as falharam,
  MAX(started_at) as ultima_execucao
FROM automation_execution_log;

-- 4. CLIENTES
SELECT '' as relatorio;
SELECT '=== CLIENTES ===' as relatorio;

SELECT 
  'CLIENTES' as tipo,
  COUNT(*) as total,
  COUNT(CASE WHEN celular IS NOT NULL OR telefone IS NOT NULL THEN 1 END) as com_whatsapp,
  COUNT(CASE WHEN ultimo_pedido < NOW() - INTERVAL '30 days' THEN 1 END) as inativos_30d
FROM v2_clientes;

-- 5. OPT-OUTS
SELECT 
  'OPT-OUTS' as tipo,
  COUNT(*) as total,
  COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as ultimos_30d
FROM whatsapp_optouts;

-- 6. CRON
SELECT '' as relatorio;
SELECT '=== CRON ===' as relatorio;

SELECT 
  'CRON JOBS' as tipo,
  COUNT(*) as total,
  COUNT(CASE WHEN active = TRUE THEN 1 END) as ativos
FROM cron.job
WHERE jobname LIKE '%automation%';

-- 7. RESUMO FINAL
SELECT '' as relatorio;
SELECT '=== RESUMO FINAL ===' as relatorio;

-- Status geral
SELECT 
  'STATUS GERAL' as tipo,
  CASE 
    WHEN (SELECT COUNT(*) FROM whatsapp_accounts WHERE status = 'active') >= 1
     AND (SELECT COUNT(*) FROM automation_rules WHERE ativo = TRUE) >= 1
     AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'automation_queue') >= 1
    THEN '✅ 100% FUNCIONAL'
    ELSE '❌ INCOMPLETO'
  END as status;

-- Métricas chave
SELECT 
  'MÉTRICAS CHAVE' as tipo,
  'Mensagens enviadas hoje' as metrica,
  COUNT(*) as valor
FROM whatsapp_messages 
WHERE direcao = 'outbound' 
  AND DATE(enviado_em) = CURRENT_DATE
UNION ALL
SELECT 
  'MÉTRICAS CHAVE' as tipo,
  'Regras ativas' as metrica,
  COUNT(*) as valor
FROM automation_rules 
WHERE ativo = TRUE
UNION ALL
SELECT 
  'MÉTRICAS CHAVE' as tipo,
  'Fila pendente' as metrica,
  COUNT(*) as valor
FROM automation_queue 
WHERE status = 'pending';

-- Últimas atividades
SELECT 
  'ÚLTIMAS ATIVIDADES' as tipo,
  'Última mensagem enviada' as metrica,
  MAX(enviado_em) as valor
FROM whatsapp_messages 
WHERE direcao = 'outbound'
UNION ALL
SELECT 
  'ÚLTIMAS ATIVIDADES' as tipo,
  'Última execução do motor' as metrica,
  MAX(started_at) as valor
FROM automation_execution_log;
