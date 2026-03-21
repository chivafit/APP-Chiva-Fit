# Configuração de Notificações Slack

Este guia explica como configurar notificações do Slack para os workflows do GitHub Actions.

## Pré-requisitos

1. Acesso administrativo ao workspace do Slack
2. Acesso às configurações do repositório GitHub

## Passo 1: Criar Incoming Webhook no Slack

1. Acesse https://api.slack.com/apps
2. Clique em **"Create New App"** → **"From scratch"**
3. Nome do app: `GitHub Notifications - CRM Chiva Fit`
4. Selecione seu workspace
5. No menu lateral, vá em **"Incoming Webhooks"**
6. Ative **"Activate Incoming Webhooks"**
7. Clique em **"Add New Webhook to Workspace"**
8. Selecione o canal onde deseja receber as notificações (ex: `#deploys`, `#alerts`)
9. Copie a **Webhook URL** (formato: `https://hooks.slack.com/services/...`)

## Passo 2: Adicionar Secret no GitHub

1. Vá para o repositório no GitHub
2. Acesse **Settings** → **Secrets and variables** → **Actions**
3. Clique em **"New repository secret"**
4. Nome: `SLACK_WEBHOOK_URL`
5. Value: Cole a URL do webhook copiada no Passo 1
6. Clique em **"Add secret"**

## Passo 3: Testar Notificações

As notificações estão configuradas para os seguintes eventos:

### Deploy de Edge Functions
- ✅ **Sucesso**: Notifica quando o deploy é concluído
- ❌ **Falha**: Notifica quando o deploy falha

### Bling Sync (Cron)
- ⚠️ **Falha**: Notifica quando a sincronização falha

### Teste Manual

Para testar, você pode:

1. Fazer um push que modifique alguma Edge Function
2. Ou rodar manualmente o workflow:
   - Vá em **Actions** → **Deploy Supabase Edge Functions**
   - Clique em **"Run workflow"**

## Formato das Notificações

### Sucesso
```
✅ Deploy de Edge Functions concluído com sucesso
Repositório: chivafit/APP-Chiva-Fit
Branch: main
Funções: bling-sync ia-claude
```

### Falha
```
❌ Deploy de Edge Functions falhou
Repositório: chivafit/APP-Chiva-Fit
Branch: main
Commit: abc123...
📋 Ver logs (link clicável)
```

## Personalização

Para personalizar as mensagens, edite os arquivos:
- `.github/workflows/supabase-functions-deploy.yml`
- `.github/workflows/bling-cron-sync.yml`

Procure pelas seções `Notify failure` e `Notify success`.

## Troubleshooting

### Notificações não aparecem
- Verifique se o secret `SLACK_WEBHOOK_URL` está configurado
- Confirme que a URL do webhook está correta
- Verifique os logs do workflow no GitHub Actions

### Canal errado
- Reconfigure o webhook no Slack para apontar para o canal correto
- Ou crie um novo webhook e atualize o secret no GitHub
