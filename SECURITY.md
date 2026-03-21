# Security Policy

## Supported Versions

Atualmente, apenas a versão em produção (branch `main`) recebe atualizações de segurança.

| Version | Supported          |
| ------- | ------------------ |
| main    | :white_check_mark: |
| outras  | :x:                |

## Reporting a Vulnerability

Se você descobrir uma vulnerabilidade de segurança no CRM Chiva Fit, por favor reporte de forma responsável:

### Como Reportar

1. **NÃO** abra uma issue pública no GitHub
2. Envie um email para: **loja@chivafit.com.br**
3. Inclua no email:
   - Descrição detalhada da vulnerabilidade
   - Passos para reproduzir o problema
   - Impacto potencial
   - Sugestões de correção (se houver)

### O que Esperar

- **Confirmação**: Você receberá uma confirmação de recebimento em até 48 horas
- **Análise**: Avaliaremos a vulnerabilidade em até 7 dias úteis
- **Atualizações**: Manteremos você informado sobre o progresso da correção
- **Resolução**: Vulnerabilidades críticas serão corrigidas com prioridade máxima
- **Crédito**: Se desejar, você será creditado pela descoberta após a correção

### Escopo de Segurança

Este projeto utiliza:
- **Supabase** para backend (autenticação, banco de dados, edge functions)
- **Vercel** para hospedagem do frontend
- **GitHub Actions** para CI/CD

Vulnerabilidades relacionadas a essas plataformas devem ser reportadas diretamente aos respectivos fornecedores.

### Políticas de Segurança

- Credenciais são armazenadas em `localStorage` (client-side) ou GitHub Secrets (CI/CD)
- Edge Functions utilizam autenticação JWT + allowlist de emails
- CORS configurado para domínios específicos
- CodeQL analysis automático em todos os PRs
- Dependabot ativo para atualizações de segurança
