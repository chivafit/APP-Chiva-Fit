# 📱 Módulo de Recompra & Automação WhatsApp - Guia de Setup

Este guia explica como configurar e ativar o módulo completo de automação de recompra via WhatsApp.

## 📋 Pré-requisitos

- ✅ Projeto Supabase configurado
- ✅ Conta WhatsApp Business
- ✅ Conta Z-API (ou Meta Cloud API)
- ✅ Migrations 036, 037 e 038 executadas

---

## 🚀 Passo 1: Executar Migrations SQL

No **SQL Editor** do Supabase, execute na ordem:

```sql
-- 1. Estrutura base do módulo
\i migrations/036_recompra_whatsapp_module.sql

-- 2. Motor de automação
\i migrations/037_automation_engine.sql

-- 3. Função de incremento de leituras
\i migrations/038_increment_campaign_reads.sql
```

Ou copie e cole o conteúdo de cada arquivo diretamente no SQL Editor.

---

## 📞 Passo 2: Configurar Conta WhatsApp (Z-API)

### 2.1. Criar conta na Z-API

1. Acesse https://www.z-api.io/
2. Crie uma conta e uma instância
3. Anote:
   - `Instance ID`
   - `Token`
   - `Client Token`

### 2.2. Registrar no CRM

No CRM, vá em **Recompra** → **Configurações WhatsApp** e adicione:

```
Nome: Minha Conta WhatsApp
Provider: Z-API
Instance ID: [seu instance id]
Token: [seu token]
Client Token: [seu client token]
Status: Ativo
```

Ou via SQL:

```sql
INSERT INTO whatsapp_accounts (
  nome,
  provider,
  zapi_instance_id,
  zapi_token,
  zapi_client_token,
  status
) VALUES (
  'Conta Principal',
  'zapi',
  'SEU_INSTANCE_ID',
  'SEU_TOKEN',
  'SEU_CLIENT_TOKEN',
  'active'
);
```

---

## 📝 Passo 3: Criar Templates de Mensagem

Templates são mensagens pré-aprovadas que você pode usar nas campanhas.

### Exemplo de Template:

```sql
INSERT INTO whatsapp_templates (
  account_id,
  template_name,
  language,
  category,
  status,
  preview_text,
  variaveis
) VALUES (
  (SELECT id FROM whatsapp_accounts WHERE status = 'active' LIMIT 1),
  'recompra_vip',
  'pt_BR',
  'MARKETING',
  'APPROVED',
  'Olá {{1}}! 👋 Sentimos sua falta! Que tal aproveitar {{2}} de desconto na sua próxima compra? 🎁',
  '["nome", "desconto"]'::jsonb
);
```

**Variáveis disponíveis:**
- `{{1}}`, `{{2}}`, etc. - Substituídas dinamicamente
- Mapeamento: `nome`, `ticket_medio`, `total_gasto`, `total_pedidos`, `ultimo_pedido`, `cidade`, `uf`

---

## ⚙️ Passo 4: Deploy das Edge Functions

No terminal, dentro da pasta do projeto:

```bash
# Login no Supabase (se necessário)
supabase login

# Deploy das 3 Edge Functions do módulo
supabase functions deploy whatsapp-send
supabase functions deploy whatsapp-webhook
supabase functions deploy automation-engine
```

---

## 🔄 Passo 5: Configurar CRON (Automação)

O motor de automação roda a cada 15 minutos via pg_cron.

### 5.1. Habilitar pg_cron no Supabase

1. Vá em **Database** → **Extensions**
2. Procure por `pg_cron`
3. Clique em **Enable**

### 5.2. Configurar Secrets

No **Project Settings** → **Edge Functions** → **Secrets**, adicione:

```
SUPABASE_URL=https://[seu-projeto].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[sua-service-role-key]
```

### 5.3. Criar Job do CRON

No **SQL Editor**, execute:

```sql
SELECT cron.schedule(
  'automation-engine-15min',
  '*/15 * * * *',  -- A cada 15 minutos
  $$
  SELECT net.http_post(
    url      := current_setting('app.supabase_url') || '/functions/v1/automation-engine',
    headers  := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body     := '{"triggered_by":"cron"}'::jsonb
  );
  $$
);
```

**Importante:** Configure as variáveis `app.supabase_url` e `app.service_role_key`:

```sql
ALTER DATABASE postgres SET app.supabase_url TO 'https://[seu-projeto].supabase.co';
ALTER DATABASE postgres SET app.service_role_key TO '[sua-service-role-key]';
```

---

## 🎯 Passo 6: Criar Primeira Regra de Automação

Exemplo: enviar mensagem para clientes que não compram há 30 dias.

```sql
INSERT INTO automation_rules (
  nome,
  descricao,
  ativo,
  trigger_tipo,
  trigger_config,
  account_id,
  template_id,
  variaveis_mapa,
  delay_minutos,
  janela_horario_inicio,
  janela_horario_fim,
  dias_semana,
  cooldown_dias,
  max_envios_dia
) VALUES (
  'Recompra 30 dias',
  'Clientes inativos há 30 dias recebem mensagem de recompra',
  true,  -- ativo
  'dias_desde_compra',
  '{"dias": 30}'::jsonb,
  (SELECT id FROM whatsapp_accounts WHERE status = 'active' LIMIT 1),
  (SELECT id FROM whatsapp_templates WHERE template_name = 'recompra_vip' LIMIT 1),
  '{"1": "nome", "2": "ticket_medio"}'::jsonb,
  0,      -- sem delay
  '09:00',
  '18:00',
  '{1,2,3,4,5}'::int[],  -- Seg a Sex
  7,      -- cooldown de 7 dias
  100     -- máximo 100 envios por dia
);
```

---

## 🔍 Passo 7: Testar Manualmente

### 7.1. Testar envio de mensagem

```bash
curl -X POST https://[seu-projeto].supabase.co/functions/v1/whatsapp-send \
  -H "Authorization: Bearer [sua-anon-key]" \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": "[uuid-da-conta]",
    "telefone": "5531999999999",
    "message": "Teste de mensagem"
  }'
```

### 7.2. Testar motor de automação

```bash
curl -X POST https://[seu-projeto].supabase.co/functions/v1/automation-engine \
  -H "Authorization: Bearer [sua-service-role-key]" \
  -H "Content-Type: application/json" \
  -d '{"triggered_by": "manual"}'
```

---

## 📊 Passo 8: Monitorar

### No CRM:

1. **Recompra** → **Painel Operacional**
   - Fila em tempo real
   - Métricas de envio
   - Taxa de conversão

2. **Recompra** → **Campanhas**
   - Criar campanhas manuais
   - Ver histórico e resultados

3. **Recompra** → **Automações**
   - Gerenciar regras
   - Ver estatísticas

### No Supabase:

```sql
-- Ver últimas execuções do motor
SELECT * FROM automation_execution_log
ORDER BY started_at DESC
LIMIT 10;

-- Ver fila atual
SELECT * FROM vw_automation_queue_live
LIMIT 20;

-- Ver conversões
SELECT * FROM attribution_orders
ORDER BY created_at DESC
LIMIT 10;
```

---

## 🔧 Troubleshooting

### Automações não estão rodando

1. Verifique se o CRON está ativo:
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'automation-engine-15min';
   ```

2. Verifique logs do CRON:
   ```sql
   SELECT * FROM cron.job_run_details
   WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'automation-engine-15min')
   ORDER BY start_time DESC
   LIMIT 5;
   ```

3. Execute manualmente para ver erros:
   ```bash
   curl -X POST https://[projeto].supabase.co/functions/v1/automation-engine \
     -H "Authorization: Bearer [service-role-key]" \
     -H "Content-Type: application/json"
   ```

### Mensagens não estão sendo enviadas

1. Verifique se a conta está ativa:
   ```sql
   SELECT * FROM whatsapp_accounts WHERE status = 'active';
   ```

2. Verifique a fila:
   ```sql
   SELECT status, COUNT(*) FROM automation_queue
   GROUP BY status;
   ```

3. Verifique se há opt-outs:
   ```sql
   SELECT * FROM whatsapp_optouts WHERE telefone = '5531999999999';
   ```

### Webhooks não estão funcionando

1. Configure o webhook na Z-API:
   - URL: `https://[projeto].supabase.co/functions/v1/whatsapp-webhook`
   - Eventos: Todos

2. Teste o webhook:
   ```bash
   curl -X POST https://[projeto].supabase.co/functions/v1/whatsapp-webhook \
     -H "Content-Type: application/json" \
     -d '{
       "type": "ReceivedCallback",
       "phone": "5531999999999",
       "text": {"message": "teste"}
     }'
   ```

---

## 📚 Recursos Adicionais

- **Segmentos pré-configurados**: 6 segmentos automáticos já criados
- **Triggers disponíveis**: 
  - `dias_desde_compra`
  - `primeiro_pedido`
  - `score_mudou`
  - `carrinho_abandonado`
  - `aniversario_cliente`

- **Proteções ativas**:
  - Opt-out automático
  - Cooldown entre mensagens
  - Janela de horário (9h-18h padrão)
  - Limite diário de envios
  - Deduplicação automática

---

## ✅ Checklist de Ativação

- [ ] Migrations 036, 037, 038 executadas
- [ ] Conta WhatsApp configurada
- [ ] Templates criados
- [ ] Edge Functions deployadas
- [ ] pg_cron habilitado
- [ ] CRON job configurado
- [ ] Secrets configurados
- [ ] Primeira regra de automação criada
- [ ] Teste manual executado com sucesso
- [ ] Webhook configurado na Z-API

---

**Pronto!** O módulo de Recompra & Automação WhatsApp está configurado e funcionando! 🎉
