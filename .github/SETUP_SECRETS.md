# Guia de Configuração de Secrets - GitHub Actions

Este guia explica como configurar corretamente todos os secrets necessários para os workflows do repositório.

## 📍 Onde Configurar

1. Acesse: `https://github.com/chivafit/APP-Chiva-Fit/settings/secrets/actions`
2. Ou navegue: `Settings` → `Secrets and variables` → `Actions`

## 🔑 Secrets Obrigatórios

### 1. SUPABASE_PROJECT_ID

**Descrição**: ID do projeto Supabase (Reference ID)

**Formato**: 
- Exatamente 20 caracteres alfanuméricos (letras minúsculas + números)
- Exemplo: `nvbicjjtnobnnscmypeq`

**Como obter**:
1. Acesse: https://supabase.com/dashboard
2. Selecione seu projeto
3. Vá em `Project Settings` → `General`
4. Copie o **Reference ID**

**OU** extraia da URL do projeto:
- URL: `https://nvbicjjtnobnnscmypeq.supabase.co`
- ID: `nvbicjjtnobnnscmypeq` (parte entre `https://` e `.supabase.co`)

**⚠️ IMPORTANTE**:
- ❌ **NÃO** use a URL completa: `https://nvbicjjtnobnnscmypeq.supabase.co`
- ✅ **USE** apenas o ID: `nvbicjjtnobnnscmypeq`

---

### 2. SUPABASE_ACCESS_TOKEN

**Descrição**: Token de acesso pessoal do Supabase para deploy de Edge Functions

**Como obter**:
1. Acesse: https://supabase.com/dashboard/account/tokens
2. Clique em `Generate new token`
3. Dê um nome: `GitHub Actions - APP-Chiva-Fit`
4. Copie o token gerado (começa com `sbp_`)
5. **IMPORTANTE**: Salve imediatamente, não será mostrado novamente

**Formato**: `sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

**Usado em**: Deploy automático de Edge Functions

---

### 3. CRON_SECRET

**Descrição**: Secret compartilhado entre GitHub Actions e Edge Function para autenticação do cron

**Requisitos**:
- Mínimo 20 caracteres
- Recomendado: 32+ caracteres aleatórios

**Como gerar**:
```bash
# No terminal (Mac/Linux)
openssl rand -base64 32

# Ou use um gerador online
# https://www.random.org/strings/
```

**⚠️ CRÍTICO**:
Este secret deve ser configurado em **DOIS LUGARES**:

1. **GitHub Actions** (este repositório):
   - `Settings` → `Secrets and variables` → `Actions`
   - Nome: `CRON_SECRET`
   - Valor: O secret gerado

2. **Supabase Edge Function**:
   - Acesse: https://supabase.com/dashboard/project/nvbicjjtnobnnscmypeq/settings/functions
   - Adicione secret: `CRON_SECRET`
   - Valor: **O MESMO** secret do GitHub

**Usado em**: Workflow `bling-cron-sync.yml` para autenticar chamadas automáticas

---

## 🔔 Secrets Opcionais

### 4. SLACK_WEBHOOK_URL (Opcional)

**Descrição**: URL do webhook do Slack para notificações de falhas/sucessos

**Como obter**:
1. Acesse: https://api.slack.com/messaging/webhooks
2. Crie um Incoming Webhook
3. Copie a URL gerada

**Formato**: `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX`

**Usado em**: Notificações de falha/sucesso nos workflows

---

## ✅ Checklist de Configuração

Após configurar todos os secrets, verifique:

- [ ] `SUPABASE_PROJECT_ID` tem exatamente 20 caracteres
- [ ] `SUPABASE_PROJECT_ID` NÃO contém `https://` ou `.supabase.co`
- [ ] `SUPABASE_ACCESS_TOKEN` começa com `sbp_`
- [ ] `CRON_SECRET` tem pelo menos 20 caracteres
- [ ] `CRON_SECRET` está configurado no GitHub **E** no Supabase
- [ ] `SLACK_WEBHOOK_URL` configurado (se quiser notificações)

---

## 🧪 Como Testar

### Teste 1: Validação dos Secrets

Execute o workflow manualmente:

1. Vá em: `Actions` → `Bling Sync (Cron)`
2. Clique em `Run workflow`
3. Selecione `persist` mode
4. Clique em `Run workflow`
5. Aguarde a execução

**Resultado esperado**: 
- ✅ Step "Validate secrets" deve passar
- ✅ Step "Trigger bling-sync" deve executar sem erros 401/500

### Teste 2: Deploy de Edge Functions

Execute o workflow de deploy:

1. Vá em: `Actions` → `Deploy Supabase Edge Functions`
2. Clique em `Run workflow`
3. Clique em `Run workflow`

**Resultado esperado**:
- ✅ Todas as functions devem ser deployadas com sucesso

---

## 🔧 Comandos Úteis

### Listar secrets configurados (via GitHub CLI)
```bash
gh secret list
```

### Configurar secret via CLI
```bash
gh secret set SUPABASE_PROJECT_ID -b "nvbicjjtnobnnscmypeq"
gh secret set CRON_SECRET -b "$(openssl rand -base64 32)"
```

### Verificar se secret está configurado
```bash
gh secret list | grep SUPABASE_PROJECT_ID
```

---

## 🆘 Problemas Comuns

### "SUPABASE_PROJECT_ID must be the project ref only"
- **Causa**: Você colocou a URL completa
- **Solução**: Use apenas o ID de 20 caracteres

### "Missing SUPABASE_PROJECT_ID secret"
- **Causa**: Secret não configurado
- **Solução**: Configure o secret conforme instruções acima

### "CRON_SECRET looks too short"
- **Causa**: Secret tem menos de 20 caracteres
- **Solução**: Gere um novo secret com `openssl rand -base64 32`

### HTTP 401 no cron
- **Causa**: `CRON_SECRET` diferente entre GitHub e Supabase
- **Solução**: Verifique se o valor é **exatamente** o mesmo nos dois lugares

---

## 📚 Referências

- [Supabase CLI Documentation](https://supabase.com/docs/guides/cli)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
