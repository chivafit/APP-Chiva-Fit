# 🔧 Como Executar as Migrations Pendentes

Você já executou a **Migration 036**. Agora precisa executar as **037** e **038** para completar o módulo.

---

## 📋 Status das Migrations

- ✅ **036_recompra_whatsapp_module.sql** - Executada
- ⏳ **037_automation_engine.sql** - **PENDENTE**
- ⏳ **038_increment_campaign_reads.sql** - **PENDENTE**

---

## 🚀 Passo a Passo

### **Opção 1: Via Supabase Dashboard (Recomendado)**

1. Acesse o **Supabase Dashboard**
2. Vá em **SQL Editor**
3. Clique em **New Query**

#### **Executar Migration 037:**

4. Copie **TODO** o conteúdo do arquivo:
   ```
   /migrations/037_automation_engine.sql
   ```

5. Cole no SQL Editor
6. Clique em **Run** (ou pressione `Ctrl+Enter`)
7. Aguarde a confirmação de sucesso ✅

#### **Executar Migration 038:**

8. Limpe o editor (ou abra nova query)
9. Copie **TODO** o conteúdo do arquivo:
   ```
   /migrations/038_increment_campaign_reads.sql
   ```

10. Cole no SQL Editor
11. Clique em **Run**
12. Aguarde a confirmação de sucesso ✅

---

### **Opção 2: Via Supabase CLI (Terminal)**

Se você tem o Supabase CLI instalado:

```bash
# Na pasta do projeto
cd /Users/iararodrigues/Documents/APP-Chiva-Fit

# Executar migration 037
supabase db execute --file migrations/037_automation_engine.sql

# Executar migration 038
supabase db execute --file migrations/038_increment_campaign_reads.sql
```

---

## ✅ Como Verificar se Funcionou

Após executar as migrations, rode no **SQL Editor**:

```sql
-- Verifica se as tabelas foram criadas
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'automation_queue',
    'automation_execution_log'
  );

-- Deve retornar 2 linhas
```

```sql
-- Verifica se as funções foram criadas
SELECT routine_name 
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

-- Deve retornar 6 linhas
```

---

## 📊 O que cada Migration faz

### **Migration 037** (26KB - a maior)
Cria o **motor de automação**:
- ✅ Tabela `automation_queue` (fila de mensagens)
- ✅ Tabela `automation_execution_log` (histórico de execuções)
- ✅ 5 funções SQL complexas para:
  - Avaliar clientes elegíveis
  - Detectar conversões
  - Expirar itens antigos
  - Estatísticas da fila
  - Resumo operacional
- ✅ 2 views para dashboard operacional

### **Migration 038** (pequena)
Cria a função `increment_campaign_reads`:
- ✅ Incrementa contador de leituras de campanha
- ✅ Usada pelo webhook do WhatsApp

---

## ⚠️ Importante

**Execute na ordem:** 037 → 038

A migration 038 é pequena e rápida. A 037 pode levar alguns segundos porque cria várias funções complexas.

---

## 🆘 Se der erro

### Erro: "relation already exists"
- Alguma tabela já existe
- Pode ignorar se for só warning
- Ou rode: `DROP TABLE nome_da_tabela CASCADE;` antes

### Erro: "function already exists"
- Alguma função já existe
- Rode: `DROP FUNCTION nome_da_funcao CASCADE;` antes
- Ou use `CREATE OR REPLACE FUNCTION` (já está no arquivo)

### Erro de permissão
- Certifique-se de estar usando o **service_role** ou **postgres** user
- No dashboard, você já tem permissão automaticamente

---

## ✅ Depois de executar

Após executar as migrations 037 e 038, você pode:

1. **Configurar o CRON** (veja `RECOMPRA_SETUP.md`)
2. **Criar regras de automação**
3. **Testar o motor**

---

**Dúvidas?** Me avise se der algum erro! 😊
