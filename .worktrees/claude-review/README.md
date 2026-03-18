# CRM (Frontend estático)

Frontend em HTML/CSS/JS para uso via GitHub Pages (ou qualquer host estático), com persistência e integrações via Supabase (DB + Realtime + Edge Functions).

## Rodar local

```bash
python3 -m http.server 8000
```

Abra: `http://localhost:8000/`

## Deploy no GitHub Pages

- Publicar a pasta do projeto como site estático.
- O app é carregado por `index.html` e `./main.js` (ESM).

## Supabase (pré-requisitos)

No CRM (Configurações) você informa:

- URL do projeto (`https://xxxx.supabase.co`)
- anon key (pública)

O frontend usa:

- Supabase JS v2 via CDN
- Realtime via `postgres_changes`
- Edge Functions via `POST {projectUrl}/functions/v1/*` com headers `apikey` + `Authorization: Bearer {anon}`

## Tabelas usadas pelo frontend

O frontend referencia tabelas e campos no Supabase. Mantenha o schema alinhado com as `select/insert/upsert/update` do código:

- `insumos`
- `receitas_produtos`
- `ordens_producao`
- `movimentos_estoque`
- `carrinhos_abandonados`
- `interactions`
- `v2_clientes`
- `v2_pedidos`
- `customer_intelligence`
- `v2_tarefas`
- `configuracoes`
- `v2_insights`

## Edge Functions esperadas

- `bootstrap-crm`
- `bling-sync`
- `yampi-sync`
- `yampi-abandoned-sync`
- `shopify-sync` (opcional)
- `ai-analyze` (IA)

## Observações de segurança

- Não commit de chaves: o app guarda URL/anon key no `localStorage` do navegador.
- O login do CRM é local (hash em `localStorage`) e não substitui autenticação/controle de acesso do Supabase.
