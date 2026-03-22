-- Script de debug para verificar o que foi criado
-- Execute este SQL para ver o status atual

-- 1. Verificar todas as tabelas do módulo
SELECT 
  'TABELAS' as tipo,
  table_name as nome,
  CASE 
    WHEN table_name IN ('whatsapp_accounts', 'whatsapp_templates', 'customer_segments', 
                       'campaign_whatsapp', 'campaign_recipients', 'whatsapp_messages',
                       'automation_rules', 'automation_runs', 'attribution_orders', 'whatsapp_optouts',
                       'automation_queue', 'automation_execution_log') 
    THEN '✅ OK'
    ELSE '❌ Não é do módulo'
  END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name LIKE '%whatsapp%' 
   OR table_name LIKE '%campaign%' 
   OR table_name LIKE '%automation%' 
   OR table_name LIKE '%attribution%'
ORDER BY table_name;

-- 2. Verificar funções SQL
SELECT 
  'FUNÇÕES' as tipo,
  routine_name as nome,
  CASE 
    WHEN routine_name IN ('fn_eligible_for_rule', 'fn_detect_conversions', 
                         'fn_expire_queue_items', 'fn_queue_stats', 
                         'fn_rule_operational_summary', 'increment_campaign_reads')
    THEN '✅ OK'
    ELSE '❌ Não é do módulo'
  END as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND (
    routine_name LIKE 'fn_%' 
    OR routine_name = 'increment_campaign_reads'
  )
ORDER BY routine_name;

-- 3. Verificar views
SELECT 
  'VIEWS' as tipo,
  table_name as nome,
  CASE 
    WHEN table_name IN ('vw_campaign_metrics', 'vw_whatsapp_inbox', 
                       'vw_automation_queue_live', 'vw_automation_dashboard')
    THEN '✅ OK'
    ELSE '❌ Não é do módulo'
  END as status
FROM information_schema.views 
WHERE table_schema = 'public' 
  AND table_name LIKE 'vw_%'
ORDER BY table_name;

-- 4. Verificar se a tabela automation_rules existe (essencial)
SELECT 
  'CHECK ESSENCIAL' as tipo,
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'automation_rules')
    THEN '✅ automation_rules existe'
    ELSE '❌ automation_rules NÃO existe - migration 036 pode ter falhado'
  END as status;

-- 5. Verificar se a tabela whatsapp_accounts existe
SELECT 
  'CHECK ESSENCIAL' as tipo,
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'whatsapp_accounts')
    THEN '✅ whatsapp_accounts existe'
    ELSE '❌ whatsapp_accounts NÃO existe - migration 036 pode ter falhado'
  END as status;

-- 6. Contar tabelas totais do módulo
SELECT 
  'RESUMO' as tipo,
  COUNT(*) as total_tabelas,
  CASE 
    WHEN COUNT(*) >= 12 THEN '✅ Todas as tabelas criadas'
    ELSE '❌ Faltam tabelas'
  END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('whatsapp_accounts', 'whatsapp_templates', 'customer_segments', 
                     'campaign_whatsapp', 'campaign_recipients', 'whatsapp_messages',
                     'automation_rules', 'automation_runs', 'attribution_orders', 'whatsapp_optouts',
                     'automation_queue', 'automation_execution_log');
