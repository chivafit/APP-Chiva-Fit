-- Criar conta Z-API com seus dados
INSERT INTO whatsapp_accounts (
  nome,
  provider,
  zapi_instance_id,
  zapi_token,
  zapi_client_token,
  status
) VALUES (
  'Z-API - Chiva Fit',
  'zapi',
  '31997763371',
  '467D0F09A1ABB7375728B6D6F',
  '467D0F09A1ABB7375728B6D6F',
  'active'
) RETURNING id, nome, status;

-- Verificar se foi criada
SELECT id, nome, provider, status, created_at 
FROM whatsapp_accounts 
ORDER BY created_at DESC 
LIMIT 1;
