# Troubleshooting - GitHub Actions

## Erro: "SUPABASE_PROJECT_ID must be the project ref only"

### Causa
O secret `SUPABASE_PROJECT_ID` está configurado com a URL completa ao invés de apenas o ID do projeto.

### Solução
1. Acesse: `Settings` → `Secrets and variables` → `Actions`
2. Edite `SUPABASE_PROJECT_ID`
3. Use apenas o ID (20 caracteres): `nvbicjjtnobnnscmypeq`
4. **NÃO** use a URL completa: `https://nvbicjjtnobnnscmypeq.supabase.co`

### Como encontrar o ID correto
- Acesse seu projeto no Supabase Dashboard
- Vá em `Project Settings` → `General`
- Copie o **Reference ID** (20 caracteres alfanuméricos)
- Ou extraia da URL: `https://[ESTE-É-O-ID].supabase.co`

---

## Erro: "Missing SUPABASE_PROJECT_ID secret"

### Causa
O secret não está configurado no repositório.

### Solução
1. Acesse: `Settings` → `Secrets and variables` → `Actions`
2. Clique em `New repository secret`
3. Nome: `SUPABASE_PROJECT_ID`
4. Valor: Seu project ID (20 caracteres)
5. Clique em `Add secret`

---

## Erro: "CRON_SECRET looks too short"

### Causa
O secret `CRON_SECRET` tem menos de 20 caracteres.

### Solução
1. Gere um secret forte:
   ```bash
   openssl rand -base64 32
   ```
2. Configure no GitHub: `Settings` → `Secrets and variables` → `Actions`
3. Configure o **mesmo valor** na Edge Function `bling-sync`

---

## Erro: HTTP 401 "Unauthorized"

### Causas Possíveis
1. `CRON_SECRET` no GitHub diferente do configurado na Edge Function
2. `SUPABASE_ACCESS_TOKEN` inválido ou expirado
3. Edge Function não deployada

### Solução
1. Verifique se os secrets estão corretos
2. Regenere o `SUPABASE_ACCESS_TOKEN` se necessário:
   - Acesse Supabase Dashboard
   - `Account` → `Access Tokens`
   - Gere novo token
3. Faça deploy manual das functions:
   ```bash
   supabase functions deploy bling-sync --project-ref nvbicjjtnobnnscmypeq
   ```

---

## Erro: HTTP 500 "invalid input syntax for type uuid"

### Causa
O `SUPABASE_PROJECT_ID` está com formato incorreto (muito curto ou muito longo).

### Solução
- Verifique se tem exatamente 20 caracteres
- Deve conter apenas letras minúsculas e números
- Exemplo válido: `nvbicjjtnobnnscmypeq`

---

## Como Testar Manualmente

### 1. Testar Workflow Manualmente
1. Vá em `Actions` → `Bling Sync (Cron)`
2. Clique em `Run workflow`
3. Selecione `persist` mode
4. Clique em `Run workflow`
5. Aguarde e verifique os logs

### 2. Testar Edge Function Localmente
```bash
# Instalar Supabase CLI
brew install supabase/tap/supabase

# Fazer login
supabase login

# Testar função localmente
supabase functions serve bling-sync
```

### 3. Verificar Secrets Configurados
```bash
# Listar secrets (não mostra valores)
gh secret list
```

---

## Checklist de Configuração

- [ ] `SUPABASE_PROJECT_ID` configurado (20 caracteres)
- [ ] `SUPABASE_ACCESS_TOKEN` configurado
- [ ] `CRON_SECRET` configurado (mínimo 20 caracteres)
- [ ] Edge Functions deployadas
- [ ] Workflow executado com sucesso
- [ ] Logs sem erros

---

## Logs Úteis

### Ver logs do último run
1. Acesse: `Actions` → `Bling Sync (Cron)`
2. Clique no run mais recente
3. Clique em `sync` job
4. Expanda cada step para ver detalhes

### Logs da Edge Function
1. Acesse Supabase Dashboard
2. `Edge Functions` → `bling-sync`
3. Clique em `Logs`
4. Filtre por erros

---

## Contato

Se o problema persistir após seguir este guia:
1. Verifique os logs completos do workflow
2. Verifique os logs da Edge Function no Supabase
3. Abra uma issue com os logs relevantes
