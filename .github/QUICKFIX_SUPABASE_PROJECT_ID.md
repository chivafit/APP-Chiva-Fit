# 🚨 Quick Fix: SUPABASE_PROJECT_ID Error

## Erro Comum

```
SUPABASE_PROJECT_ID must be the project ref only (ex: nvbicjjtnobnnscmypeq), not a URL
```

## ⚡ Solução Rápida (2 minutos)

### 1️⃣ Identifique o Valor Correto

Sua URL do Supabase:
```
https://nvbicjjtnobnnscmypeq.supabase.co
```

O valor correto é apenas:
```
nvbicjjtnobnnscmypeq
```

### 2️⃣ Atualize o Secret

1. Acesse: https://github.com/chivafit/APP-Chiva-Fit/settings/secrets/actions

2. Clique em `SUPABASE_PROJECT_ID`

3. Clique em `Update secret`

4. Cole **apenas** o ID:
   ```
   nvbicjjtnobnnscmypeq
   ```

5. Clique em `Update secret`

### 3️⃣ Teste

1. Vá em: https://github.com/chivafit/APP-Chiva-Fit/actions/workflows/bling-cron-sync.yml

2. Clique em `Run workflow`

3. Clique em `Run workflow` (botão verde)

4. Aguarde ~30 segundos

5. ✅ Deve passar na validação!

---

## 📋 Como Obter o ID Correto

### Opção 1: Da URL
```
URL:  https://[ESTE-É-O-ID].supabase.co
      https://nvbicjjtnobnnscmypeq.supabase.co
              ^^^^^^^^^^^^^^^^^^^^
              Este é o ID
```

### Opção 2: Do Dashboard
1. Acesse: https://supabase.com/dashboard
2. Selecione seu projeto
3. Vá em: `Project Settings` → `General`
4. Copie o **Reference ID**

---

## ✅ Formato Correto vs ❌ Incorreto

### ✅ CORRETO
```
nvbicjjtnobnnscmypeq
```
- 20 caracteres
- Apenas letras minúsculas e números
- Sem `https://`
- Sem `.supabase.co`

### ❌ INCORRETO
```
https://nvbicjjtnobnnscmypeq.supabase.co
nvbicjjtnobnnscmypeq.supabase.co
https://nvbicjjtnobnnscmypeq
```

---

## 🔍 Verificar se Está Correto

Execute localmente:
```bash
# Substitua pelo seu ID
ID="nvbicjjtnobnnscmypeq"

# Deve ter exatamente 20 caracteres
echo ${#ID}

# Deve retornar apenas o ID (sem output extra)
echo "$ID" | grep -E '^[a-z0-9]{20}$'

# NÃO deve conter URL
echo "$ID" | grep -qiE 'https?://|supabase\.co' && echo "❌ ERRO: Contém URL" || echo "✅ OK"
```

---

## 📚 Mais Ajuda

- **Documentação completa**: `.github/SETUP_SECRETS.md`
- **Troubleshooting**: `.github/TROUBLESHOOTING.md`
- **Validação local**: `.github/scripts/validate-secrets.sh`

---

## 🎯 Checklist

- [ ] Copiei apenas o ID (20 caracteres)
- [ ] Removi `https://`
- [ ] Removi `.supabase.co`
- [ ] Atualizei o secret no GitHub
- [ ] Testei executando o workflow manualmente
- [ ] Workflow passou na validação ✅
