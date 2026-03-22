# 🔗 Configurar Webhook na Z-API

## 📍 URL do Webhook

```
https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-webhook
```

**Substitua SEU-PROJETO pelo seu ID do Supabase**

## ⚙️ Eventos para Ativar

Na Z-API, ative TODOS estes eventos:

### ✅ Mensagens
- [x] Mensagem recebida
- [x] Mensagem enviada

### ✅ Status
- [x] Status de entrega (DELIVERED)
- [x] Status de leitura (READ)
- [x] Status de falha (FAILED)

### ✅ Conexão
- [x] Conectado
- [x] Desconectado
- [x] QRCODE
- [x] QRCODE lido

## 🧪 Como Testar

Após configurar:

1. Envie uma mensagem para seu WhatsApp
2. Verifique se aparece no webhook
3. No Supabase, verifique:
   ```sql
   SELECT * FROM whatsapp_messages 
   WHERE direcao = 'inbound' 
   ORDER BY created_at DESC 
   LIMIT 5;
   ```

## 🔍 Verificar se está Funcionando

```sql
-- Verificar mensagens recentes
SELECT 
  direcao,
  status,
  tipo,
  created_at,
  LEFT(conteudo::text, 50) as preview
FROM whatsapp_messages 
ORDER BY created_at DESC 
LIMIT 10;

-- Verificar se o webhook está recebendo
SELECT COUNT(*) as total_mensagens,
       MIN(created_at) as primeira,
       MAX(created_at) as ultima
FROM whatsapp_messages 
WHERE created_at > NOW() - INTERVAL '1 hour';
```
