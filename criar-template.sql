-- Criar template de mensagem para recompra
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
  'recompra_30dias',
  'pt_BR',
  'MARKETING',
  'APPROVED',
  'Olá {{1}}! 👋 Sentimos sua falta! Faz tempo que você não compra conosco. Que tal dar uma olhada nas novidades? 🎁',
  '["nome"]'::jsonb
) RETURNING id, template_name, preview_text;

-- Verificar se foi criado
SELECT id, template_name, preview_text, created_at 
FROM whatsapp_templates 
ORDER BY created_at DESC 
LIMIT 1;
