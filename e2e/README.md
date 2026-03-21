# Testes E2E com Playwright

Testes end-to-end para validar fluxos críticos do CRM.

## Executar Testes

```bash
# Instalar browsers do Playwright (primeira vez)
npx playwright install

# Rodar todos os testes
npm run test:e2e

# Rodar em modo UI (interativo)
npm run test:e2e:ui

# Rodar apenas um browser
npx playwright test --project=chromium

# Rodar em modo debug
npx playwright test --debug
```

## Estrutura

- `login.spec.js` - Testes de autenticação
- `dashboard.spec.js` - Testes da dashboard principal
- `clientes.spec.js` - Testes de gestão de clientes (a criar)
- `pedidos.spec.js` - Testes de gestão de pedidos (a criar)

## Configuração

A configuração está em `playwright.config.js`. Por padrão:

- **Base URL**: `http://localhost:8000`
- **Browsers**: Chrome, Firefox, Safari, Mobile Chrome, Mobile Safari
- **Screenshots**: Apenas em falhas
- **Traces**: Apenas em retry

## Variáveis de Ambiente

Crie um arquivo `.env.test` para credenciais de teste:

```bash
TEST_PASSWORD=sua_senha_de_teste
BASE_URL=http://localhost:8000
```

## CI/CD

Os testes E2E podem ser integrados ao GitHub Actions criando um workflow específico.
