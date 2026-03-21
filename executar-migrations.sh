#!/bin/bash

# Script para executar migrations 037 e 038 no Supabase
# Uso: ./executar-migrations.sh

echo "🚀 Executando Migrations 037 e 038..."
echo ""

# Verifica se o Supabase CLI está instalado
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI não encontrado."
    echo ""
    echo "📋 OPÇÃO 1: Instalar Supabase CLI"
    echo "   brew install supabase/tap/supabase"
    echo ""
    echo "📋 OPÇÃO 2: Executar manualmente no Supabase Dashboard"
    echo "   1. Acesse: https://supabase.com/dashboard"
    echo "   2. Vá em SQL Editor"
    echo "   3. Copie e cole o conteúdo de:"
    echo "      - migrations/037_automation_engine.sql"
    echo "      - migrations/038_increment_campaign_reads.sql"
    echo ""
    exit 1
fi

echo "✅ Supabase CLI encontrado"
echo ""

# Executa migration 037
echo "📝 Executando Migration 037 (Motor de Automação)..."
supabase db execute --file migrations/037_automation_engine.sql

if [ $? -eq 0 ]; then
    echo "✅ Migration 037 executada com sucesso!"
else
    echo "❌ Erro ao executar Migration 037"
    exit 1
fi

echo ""

# Executa migration 038
echo "📝 Executando Migration 038 (Função increment_campaign_reads)..."
supabase db execute --file migrations/038_increment_campaign_reads.sql

if [ $? -eq 0 ]; then
    echo "✅ Migration 038 executada com sucesso!"
else
    echo "❌ Erro ao executar Migration 038"
    exit 1
fi

echo ""
echo "🎉 Todas as migrations foram executadas com sucesso!"
echo ""
echo "📊 Próximos passos:"
echo "   1. Verifique se funcionou: ./verificar-migrations.sh"
echo "   2. Configure o módulo: veja RECOMPRA_SETUP.md"
