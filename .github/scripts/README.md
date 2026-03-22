# GitHub Actions Scripts

Scripts reutilizáveis para workflows do GitHub Actions.

## validate-secrets.sh

Script centralizado para validação de secrets do Supabase.

### Uso nos Workflows

```yaml
- uses: actions/checkout@v4
  with:
    sparse-checkout: |
      .github/scripts
    sparse-checkout-cone-mode: false

- name: Validate secrets
  env:
    SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    CRON_SECRET: ${{ secrets.CRON_SECRET }}
  run: |
    set -euo pipefail
    source .github/scripts/validate-secrets.sh
    validate_supabase_secrets
```

### Uso Manual (Local)

```bash
# Validar todos os secrets
export SUPABASE_PROJECT_ID="nvbicjjtnobnnscmypeq"
export CRON_SECRET="your-secret-here"
.github/scripts/validate-secrets.sh

# Validar apenas SUPABASE_PROJECT_ID
source .github/scripts/validate-secrets.sh
validate_supabase_project_id "nvbicjjtnobnnscmypeq"
```

### Funções Disponíveis

#### `validate_supabase_project_id(project_id)`
Valida o formato do SUPABASE_PROJECT_ID:
- ✅ Exatamente 20 caracteres
- ✅ Apenas letras minúsculas e números
- ❌ Não pode conter URLs ou domínios

#### `validate_supabase_access_token(token)`
Valida o formato do SUPABASE_ACCESS_TOKEN:
- ✅ Deve começar com `sbp_`
- ✅ Mínimo 40 caracteres

#### `validate_cron_secret(secret, min_length)`
Valida o CRON_SECRET:
- ✅ Mínimo 20 caracteres (configurável)

#### `validate_supabase_secrets()`
Valida todos os secrets de uma vez.

### Mensagens de Erro

O script fornece mensagens de erro detalhadas com:
- ✅ GitHub Actions annotations (`::error::`, `::warning::`)
- ✅ Explicação clara do problema
- ✅ Exemplos de formato correto vs incorreto
- ✅ Instruções passo a passo para corrigir
- ✅ Links para documentação relevante

### Exemplo de Output

```
🔍 Validating Supabase secrets...

❌ SUPABASE_PROJECT_ID has invalid format

Current value appears to be a URL or contains URL parts.

✅ Expected format:
  nvbicjjtnobnnscmypeq

❌ Invalid examples:
  https://nvbicjjtnobnnscmypeq.supabase.co
  nvbicjjtnobnnscmypeq.supabase.co

📋 How to fix:
  1. Go to: Settings → Secrets and variables → Actions
  2. Edit SUPABASE_PROJECT_ID
  3. Extract only the project ref from your URL
  4. Or get it from: Supabase Dashboard → Project Settings → General → Reference ID
```

## Benefícios

1. **Centralizado**: Um único lugar para lógica de validação
2. **Reutilizável**: Usado em múltiplos workflows
3. **Mensagens Claras**: Erros acionáveis com instruções de correção
4. **GitHub Annotations**: Erros aparecem na UI do GitHub Actions
5. **Testável**: Pode ser executado localmente
6. **Manutenível**: Fácil atualizar validações em um só lugar
