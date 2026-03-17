# Schema (Supabase)

Este documento descreve o schema esperado pelo frontend do CRM.

## Tabelas principais

### configuracoes

- chave (text, pk lógica)
- valor_texto (text)
- updated_at (timestamptz)

### v2_clientes

- id (uuid)
- nome (text)
- doc (text)
- email (text)
- telefone (text)
- celular (text)
- cidade (text)
- uf (text)
- cep (text)
- total_pedidos (int)
- total_gasto (numeric)
- ticket_medio (numeric)
- intervalo_medio_dias (numeric)
- risco_churn (numeric)
- status (text)
- status_manual (text)
- produto_favorito (text)
- canal_principal (text)
- pipeline_stage (text)
- notas (text)
- updated_at (timestamptz)

### v2_pedidos

- id (uuid)
- numero (text)
- data (date ou text ISO)
- total (numeric)
- canal_id (uuid)
- cliente_id (uuid)
- situacao (jsonb/text)
- contato (jsonb)
- itens (jsonb)
- updated_at (timestamptz)

### v2_pedidos_items

- id (uuid)
- pedido_id (uuid)
- produto_id (uuid)
- sku (text)
- descricao (text)
- quantidade (numeric)
- valor_unitario (numeric)
- valor_total (numeric) ou total (numeric)

### v2_produtos

- id (uuid)
- codigo (text)
- nome (text)
- estoque (numeric)
- preco (numeric)
- situacao (text)
- origem (text)
- updated_at (timestamptz)

### v2_canais

- id (uuid)
- slug (text, único)
- nome (text)
- created_at (timestamptz)
- updated_at (timestamptz)

## Produção

### insumos

- id (uuid ou text)
- nome (text)
- unidade (text)
- estoque_atual (numeric)
- estoque_minimo (numeric)
- custo_unitario (numeric)
- fornecedor (text)
- lead_time_dias (int)
- updated_at (timestamptz)

### receitas_produtos

- id (uuid)
- produto_id (uuid)
- insumo_id (uuid)
- quantidade_por_unidade (numeric)
- unidade (text)
- updated_at (timestamptz)

### ordens_producao

- id (uuid)
- lote (text)
- produto_id (uuid/text)
- quantidade_planejada (numeric)
- quantidade_produzida (numeric)
- data_producao (date/text ISO)
- status (text)
- observacoes (text)
- custo_total_lote (numeric, opcional)
- created_at (timestamptz)

### movimentos_estoque

- id (uuid)
- insumo_id (uuid/text)
- ordem_id (uuid/text)
- lote (text, opcional)
- produto_id (uuid/text, opcional)
- tipo (text)
- quantidade (numeric)
- unidade (text)
- created_at (timestamptz)
- metadata (jsonb)

## Comercial / Marketing

### yampi_orders

- id (uuid)
- payload (jsonb) e/ou campos normalizados
- updated_at (timestamptz)

### carrinhos_abandonados

- checkout_id (text, único)
- email (text)
- nome (text)
- telefone (text)
- total (numeric)
- itens (jsonb)
- status (text)
- updated_at (timestamptz)

### v2_tarefas

- id (uuid)
- titulo (text)
- desc (text)
- prioridade (text)
- status (text)
- cliente_id (uuid/text)
- created_at (timestamptz)
- updated_at (timestamptz)

## IA / Logs

### v2_insights

- id (uuid)
- tipo (text)
- conteudo (text)
- gerado_por (text)
- created_at (timestamptz)

### interactions

- customer_id (uuid)
- type (text)
- description (text)
- created_at (timestamptz)
- user_responsible (text)
- source (text)
- metadata (jsonb)

## Geo

### estados

- id (uuid/int)
- uf (text)
- nome (text)

### cidades

- id (uuid/int)
- uf (text)
- nome (text)
- lat (numeric, opcional)
- lon (numeric, opcional)
