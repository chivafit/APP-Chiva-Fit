-- ==============================================================================
-- AUDITORIA COMPLETA DE CONSISTÊNCIA — CRM CHIVA FIT
-- Rodar no Supabase SQL Editor (cada bloco gera um resultado independente)
-- ==============================================================================

-- -----------------------------------------------------------------------
-- 1. VISÃO GERAL
-- -----------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM v2_pedidos)           AS total_pedidos,
  (SELECT COUNT(*) FROM v2_clientes)          AS total_clientes,
  (SELECT COUNT(*) FROM v2_produtos)          AS total_produtos,
  (SELECT COUNT(*) FROM v2_pedidos_items)     AS total_itens,
  (SELECT COUNT(*) FROM v2_canais)            AS total_canais,
  (SELECT COUNT(*) FROM customer_intelligence)AS total_intel,
  (SELECT COUNT(*) FROM carrinhos_abandonados)AS total_carrinhos,
  (SELECT COUNT(*) FROM yampi_orders)         AS total_yampi_raw;

-- -----------------------------------------------------------------------
-- 2. INTEGRIDADE RELACIONAL — PEDIDOS SEM CLIENTE
-- -----------------------------------------------------------------------
SELECT
  COUNT(*)                                          AS total_pedidos,
  COUNT(*) FILTER (WHERE cliente_id IS NULL)        AS sem_cliente_id,
  COUNT(*) FILTER (WHERE cliente_id IS NOT NULL)    AS com_cliente_id,
  ROUND(
    COUNT(*) FILTER (WHERE cliente_id IS NOT NULL)::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  )                                                  AS pct_com_cliente
FROM v2_pedidos;

-- -----------------------------------------------------------------------
-- 3. PEDIDOS SEM CLIENTE — amostra
-- -----------------------------------------------------------------------
SELECT id, numero_pedido, source, status, total, data_pedido
FROM v2_pedidos
WHERE cliente_id IS NULL
ORDER BY data_pedido DESC
LIMIT 20;

-- -----------------------------------------------------------------------
-- 4. CLIENTES DUPLICADOS POR EMAIL
-- -----------------------------------------------------------------------
SELECT email, COUNT(*) AS ocorrencias
FROM v2_clientes
WHERE email IS NOT NULL AND email <> ''
GROUP BY email
HAVING COUNT(*) > 1
ORDER BY ocorrencias DESC
LIMIT 20;

-- -----------------------------------------------------------------------
-- 5. CLIENTES DUPLICADOS POR TELEFONE
-- -----------------------------------------------------------------------
SELECT telefone, COUNT(*) AS ocorrencias
FROM v2_clientes
WHERE telefone IS NOT NULL AND telefone <> ''
GROUP BY telefone
HAVING COUNT(*) > 1
ORDER BY ocorrencias DESC
LIMIT 20;

-- -----------------------------------------------------------------------
-- 6. CANAIS — PEDIDOS SEM CANAL
-- -----------------------------------------------------------------------
SELECT
  COUNT(*)                                         AS total_pedidos,
  COUNT(*) FILTER (WHERE canal_id IS NULL)         AS sem_canal_id,
  COUNT(*) FILTER (WHERE canal_id IS NOT NULL)     AS com_canal_id
FROM v2_pedidos;

-- -----------------------------------------------------------------------
-- 7. CANAIS — DISTRIBUIÇÃO POR SOURCE E CANAL
-- -----------------------------------------------------------------------
SELECT
  p.source,
  c.nome AS canal_nome,
  COUNT(*) AS qtd
FROM v2_pedidos p
LEFT JOIN v2_canais c ON c.id = p.canal_id
GROUP BY p.source, c.nome
ORDER BY qtd DESC;

-- -----------------------------------------------------------------------
-- 8. CANAIS CADASTRADOS
-- -----------------------------------------------------------------------
SELECT id, nome, slug, ativo FROM v2_canais ORDER BY nome;

-- -----------------------------------------------------------------------
-- 9. CAMPOS ESSENCIAIS NULOS OU INVÁLIDOS
-- -----------------------------------------------------------------------
SELECT
  COUNT(*) FILTER (WHERE total IS NULL OR total = 0)          AS pedidos_sem_valor,
  COUNT(*) FILTER (WHERE data_pedido IS NULL)                  AS pedidos_sem_data,
  COUNT(*) FILTER (WHERE status IS NULL OR status = '')        AS pedidos_sem_status,
  COUNT(*) FILTER (WHERE numero_pedido IS NULL OR numero_pedido = '') AS pedidos_sem_numero,
  COUNT(*) FILTER (WHERE source IS NULL OR source = '')        AS pedidos_sem_source
FROM v2_pedidos;

-- -----------------------------------------------------------------------
-- 10. DISTRIBUIÇÃO DE STATUS
-- -----------------------------------------------------------------------
SELECT status, source, COUNT(*) AS qtd
FROM v2_pedidos
GROUP BY status, source
ORDER BY qtd DESC;

-- -----------------------------------------------------------------------
-- 11. PEDIDOS DUPLICADOS — mesmo numero_pedido + source
-- -----------------------------------------------------------------------
SELECT numero_pedido, source, COUNT(*) AS ocorrencias
FROM v2_pedidos
WHERE numero_pedido IS NOT NULL
GROUP BY numero_pedido, source
HAVING COUNT(*) > 1
ORDER BY ocorrencias DESC
LIMIT 20;

-- -----------------------------------------------------------------------
-- 12. PEDIDOS DUPLICADOS — mesmo bling_id
-- -----------------------------------------------------------------------
SELECT bling_id, COUNT(*) AS ocorrencias
FROM v2_pedidos
WHERE bling_id IS NOT NULL
GROUP BY bling_id
HAVING COUNT(*) > 1
ORDER BY ocorrencias DESC
LIMIT 20;

-- -----------------------------------------------------------------------
-- 13. ITENS — PEDIDOS COM E SEM ITENS
-- -----------------------------------------------------------------------
SELECT
  COUNT(DISTINCT p.id)                                                AS total_pedidos,
  COUNT(DISTINCT i.pedido_id)                                         AS pedidos_com_itens,
  COUNT(DISTINCT p.id) - COUNT(DISTINCT i.pedido_id)                  AS pedidos_sem_itens,
  COUNT(i.id)                                                         AS total_itens
FROM v2_pedidos p
LEFT JOIN v2_pedidos_items i ON i.pedido_id = p.id;

-- -----------------------------------------------------------------------
-- 14. ITENS — PEDIDOS SEM ITENS (amostra por source)
-- -----------------------------------------------------------------------
SELECT p.source, COUNT(*) AS pedidos_sem_itens
FROM v2_pedidos p
WHERE NOT EXISTS (
  SELECT 1 FROM v2_pedidos_items i WHERE i.pedido_id = p.id
)
GROUP BY p.source
ORDER BY pedidos_sem_itens DESC;

-- -----------------------------------------------------------------------
-- 15. CUSTOMER INTELLIGENCE — estado
-- -----------------------------------------------------------------------
SELECT
  COUNT(*)                                                  AS total_registros,
  COUNT(*) FILTER (WHERE ltv IS NULL OR ltv = 0)            AS sem_ltv,
  COUNT(*) FILTER (WHERE ultima_compra IS NULL)             AS sem_ultima_compra,
  COUNT(*) FILTER (WHERE frequencia_compra IS NULL)         AS sem_frequencia,
  MIN(ultima_compra)                                         AS compra_mais_antiga,
  MAX(ultima_compra)                                         AS compra_mais_recente
FROM customer_intelligence;

-- -----------------------------------------------------------------------
-- 16. CARRINHOS ABANDONADOS — estado
-- -----------------------------------------------------------------------
SELECT
  COUNT(*)                                                   AS total,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS ultimos_30d,
  MIN(created_at)                                            AS mais_antigo,
  MAX(created_at)                                            AS mais_recente
FROM carrinhos_abandonados;

-- -----------------------------------------------------------------------
-- 17. ÍNDICES EXISTENTES EM TABELAS CRÍTICAS
-- -----------------------------------------------------------------------
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('v2_pedidos', 'v2_clientes', 'v2_pedidos_items', 'v2_produtos')
ORDER BY tablename, indexname;

-- -----------------------------------------------------------------------
-- 18. PEDIDOS POR MÊS — volume temporal
-- -----------------------------------------------------------------------
SELECT
  TO_CHAR(data_pedido, 'YYYY-MM') AS mes,
  source,
  COUNT(*)                         AS qtd,
  SUM(total)                       AS receita
FROM v2_pedidos
WHERE data_pedido IS NOT NULL
GROUP BY mes, source
ORDER BY mes DESC, qtd DESC
LIMIT 24;

-- -----------------------------------------------------------------------
-- 19. TOP 10 CLIENTES POR LTV
-- -----------------------------------------------------------------------
SELECT
  c.nome,
  c.email,
  c.total_pedidos,
  c.total_gasto,
  c.status,
  c.ultimo_pedido
FROM v2_clientes c
ORDER BY c.total_gasto DESC NULLS LAST
LIMIT 10;

-- -----------------------------------------------------------------------
-- 20. DIAGNÓSTICO FINAL — checklist resumido
-- -----------------------------------------------------------------------
SELECT
  'pedidos_total'        AS metrica, COUNT(*)::text AS valor FROM v2_pedidos
UNION ALL
SELECT 'pedidos_sem_cliente',   COUNT(*)::text FROM v2_pedidos WHERE cliente_id IS NULL
UNION ALL
SELECT 'pedidos_sem_canal',     COUNT(*)::text FROM v2_pedidos WHERE canal_id IS NULL
UNION ALL
SELECT 'pedidos_sem_valor',     COUNT(*)::text FROM v2_pedidos WHERE total IS NULL OR total = 0
UNION ALL
SELECT 'pedidos_sem_status',    COUNT(*)::text FROM v2_pedidos WHERE status IS NULL OR status = ''
UNION ALL
SELECT 'pedidos_com_itens',     COUNT(DISTINCT pedido_id)::text FROM v2_pedidos_items
UNION ALL
SELECT 'itens_total',           COUNT(*)::text FROM v2_pedidos_items
UNION ALL
SELECT 'clientes_total',        COUNT(*)::text FROM v2_clientes
UNION ALL
SELECT 'clientes_sem_doc',      COUNT(*)::text FROM v2_clientes WHERE doc IS NULL OR doc = ''
UNION ALL
SELECT 'intel_total',           COUNT(*)::text FROM customer_intelligence
UNION ALL
SELECT 'carrinhos_total',       COUNT(*)::text FROM carrinhos_abandonados
UNION ALL
SELECT 'canais_total',          COUNT(*)::text FROM v2_canais
ORDER BY metrica;
