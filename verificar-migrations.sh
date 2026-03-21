#!/bin/bash

# Script para verificar se as migrations foram executadas corretamente

echo "🔍 Verificando Migrations..."
echo ""

# Query para verificar tabelas
QUERY_TABLES="
SELECT 
  CASE 
    WHEN COUNT(*) = 2 THEN '✅ Tabelas criadas com sucesso'
    ELSE '❌ Faltam ' || (2 - COUNT(*))::text || ' tabelas'
  END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('automation_queue', 'automation_execution_log');
"

# Query para verificar funções
QUERY_FUNCTIONS="
SELECT 
  CASE 
    WHEN COUNT(*) = 6 THEN '✅ Funções criadas com sucesso'
    ELSE '❌ Faltam ' || (6 - COUNT(*))::text || ' funções'
  END as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN (
    'fn_eligible_for_rule',
    'fn_detect_conversions',
    'fn_expire_queue_items',
    'fn_queue_stats',
    'fn_rule_operational_summary',
    'increment_campaign_reads'
  );
"

echo "📋 Verificando tabelas..."
supabase db execute --query "$QUERY_TABLES"

echo ""
echo "📋 Verificando funções SQL..."
supabase db execute --query "$QUERY_FUNCTIONS"

echo ""
echo "✅ Verificação concluída!"
echo ""
echo "Se tudo estiver OK, você pode:"
echo "   1. Configurar conta WhatsApp"
echo "   2. Criar templates"
echo "   3. Configurar CRON"
echo ""
echo "Veja: RECOMPRA_SETUP.md"
