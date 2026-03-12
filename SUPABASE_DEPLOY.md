# Instruções de Deploy e Configuração Supabase

Para que o CRM funcione 100%, siga os passos abaixo no seu **Painel do Supabase**.

---

## 1. Banco de Dados (SQL Editor)

1. Vá para o menu **SQL Editor** no Supabase.
2. Clique em **New Query**.
3. Copie todo o conteúdo do arquivo [000_full_schema_setup.sql](./migrations/000_full_schema_setup.sql) e cole no editor.
4. Clique em **Run**.
   - *Isso criará todas as tabelas e configurará as permissões de acesso (RLS).*

---

## 2. Configuração de Segredos (Secrets)

Para as Edge Functions funcionarem, você precisa configurar as variáveis de ambiente. No terminal (com Supabase CLI) ou no painel:

### Bling API v3
```bash
supabase secrets set BLING_CLIENT_ID="seu_id"
supabase secrets set BLING_CLIENT_SECRET="seu_secret"
```

### Cron (Bling Sync automático)
Crie um segredo para autorizar o job agendado (GitHub Actions) a rodar a sincronização persistente:
```bash
supabase secrets set CRON_SECRET="um_valor_aleatorio_longo"
```

### Yampi Webhook
```bash
supabase secrets set YAMPI_SECRET="wh_8lgW9FUnSkNZiQ5QSYIbXeUf4wIeg5biV279r"
```

---

## 3. Deploy das Edge Functions

No seu terminal, dentro da pasta raiz do projeto, execute os comandos para enviar as funções que criamos/ajustamos:

```bash
# Login no Supabase (se necessário)
supabase login

# Deploy da função de renovação de token do Bling
supabase functions deploy bling-renew-token

# Deploy da função de sincronização do Bling
supabase functions deploy bling-sync

# Deploy da função do Webhook da Yampi
supabase functions deploy yampi-webhook
```

---

## 4. Configuração na Yampi

1. Vá no painel da **Yampi** -> **Configurações** -> **Webhooks**.
2. Adicione um novo Webhook.
3. Use a URL: `https://nvbicjjtnobnnscmypeq.supabase.co/functions/v1/yampi-webhook`
4. Selecione os eventos que deseja receber (Pedidos, Carrinhos Abandonados).
5. Certifique-se de que a `YAMPI_SECRET` configurada no passo 2 coincide com a que a Yampi gerar (ou a que você já possui).

---

## 5. IA (Claude)

No frontend do CRM, vá em **Configurações** e salve sua chave da Anthropic (IA). Ela é armazenada localmente para segurança, mas usada para gerar as análises inteligentes.
