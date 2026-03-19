-- ==============================================================================
-- AUDITORIA COMPLETA DE CONSISTÊNCIA — CRM CHIVA FIT
-- VERSÃO REVISADA: 100% read-only, schema validado, sem falsos positivos
--
-- SEGURANÇA: somente SELECT e subqueries. Nenhum INSERT/UPDATE/DELETE/DROP/ALTER.
-- EXECUÇÃO: rodar no Supabase SQL Editor. Cada bloco é independente.
-- ==============================================================================

-- -----------------------------------------------------------------------
-- 1. VISÃO GERAL — contagem de todas as tabelas
-- Esperado: pedidos >= 714, clientes > 0, canais > 0
-- -----------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM v2_pedidos)            AS total_pedidos,
  (SELECT COUNT(*) FROM v2_clientes)           AS total_clientes,
  (SELECT COUNT(*) FROM v2_produtos)           AS total_produtos,
  (SELECT COUNT(*) FROM v2_pedidos_items)      AS total_itens,
  (SELECT COUNT(*) FROM v2_canais)             AS total_canais,
  (SELECT COUNT(*) FROM customer_intelligence) AS total_intel,
  (SELECT COUNT(*) FROM carrinhos_abandonados) AS total_carrinhos,
  (SELECT COUNT(*) FROM yampi_orders)          AS total_yampi_raw;

-- -----------------------------------------------------------------------
-- 2. INTEGRIDADE RELACIONAL — PEDIDOS SEM CLIENTE
-- NOTA: sem_cliente_id pode ser alto se clientes anônimos (sem CPF/email).
-- Isso não é necessariamente um bug — é esperado para checkouts anônimos.
-- Alerta real: se pct_com_cliente < 60%
-- -----------------------------------------------------------------------
SELECT
  COUNT(*)                                           AS total_pedidos,
  COUNT(*) FILTER (WHERE cliente_id IS NULL)         AS sem_cliente_id,
  COUNT(*) FILTER (WHERE cliente_id IS NOT NULL)     AS com_cliente_id,
  ROUND(
    COUNT(*) FILTER (WHERE cliente_id IS NOT NULL)::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  )                                                   AS pct_com_cliente
FROM v2_pedidos;

-- -----------------------------------------------------------------------
-- 3. PEDIDOS SEM CLIENTE — amostra (verificar se é falta de dado ou bug)
-- -----------------------------------------------------------------------
SELECT id, numero_pedido, source, status, total, data_pedido
FROM v2_pedidos
WHERE cliente_id IS NULL
ORDER BY data_pedido DESC
LIMIT 20;

-- -----------------------------------------------------------------------
-- 4. CLIENTES DUPLICADOS POR EMAIL
-- NOTA: duplicatas podem existir se o mesmo cliente comprou em canais
-- diferentes com e-mails diferentes ou como guest. Verificar manualmente.
-- -----------------------------------------------------------------------
SELECT
  lower(trim(email)) AS email_normalizado,
  COUNT(*)           AS ocorrencias,
  array_agg(doc ORDER BY doc)  AS docs
FROM v2_clientes
WHERE email IS NOT NULL AND trim(email) <> ''
GROUP BY lower(trim(email))
HAVING COUNT(*) > 1
ORDER BY ocorrencias DESC
LIMIT 20;

-- -----------------------------------------------------------------------
-- 5. CLIENTES DUPLICADOS POR TELEFONE
-- -----------------------------------------------------------------------
SELECT
  regexp_replace(telefone, '\D', '', 'g') AS fone_digits,
  COUNT(*)                                 AS ocorrencias,
  array_agg(nome ORDER BY nome)            AS nomes
FROM v2_clientes
WHERE telefone IS NOT NULL
  AND regexp_replace(telefone, '\D', '', 'g') <> ''
  AND length(regexp_replace(telefone, '\D', '', 'g')) >= 10
GROUP BY regexp_replace(telefone, '\D', '', 'g')
HAVING COUNT(*) > 1
ORDER BY ocorrencias DESC
LIMIT 20;

-- -----------------------------------------------------------------------
-- 6. CANAIS — PEDIDOS SEM CANAL
-- NOTA: canal_id pode ser NULL se o slug do pedido não casou com v2_canais.
-- Ideal: 0 sem canal. Alerta real: > 10% sem canal.
-- -----------------------------------------------------------------------
SELECT
  COUNT(*)                                          AS total_pedidos,
  COUNT(*) FILTER (WHERE canal_id IS NULL)          AS sem_canal_id,
  COUNT(*) FILTER (WHERE canal_id IS NOT NULL)      AS com_canal_id,
  ROUND(
    COUNT(*) FILTER (WHERE canal_id IS NULL)::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  )                                                  AS pct_sem_canal
FROM v2_pedidos;

-- -----------------------------------------------------------------------
-- 7. CANAIS — DISTRIBUIÇÃO POR SOURCE E CANAL
-- NULL em canal_nome = pedido sem canal vinculado
-- -----------------------------------------------------------------------
SELECT
  p.source::text,
  COALESCE(c.nome, '⚠ SEM CANAL') AS canal_nome,
  c.slug,
  COUNT(*) AS qtd
FROM v2_pedidos p
LEFT JOIN v2_canais c ON c.id = p.canal_id
GROUP BY p.source::text, c.nome, c.slug
ORDER BY qtd DESC;

-- -----------------------------------------------------------------------
-- 8. CANAIS CADASTRADOS
-- -----------------------------------------------------------------------
SELECT id, nome, slug, created_at FROM v2_canais ORDER BY nome;

-- -----------------------------------------------------------------------
-- 9. CAMPOS ESSENCIAIS NULOS OU INVÁLIDOS
-- NOTA: pedidos_valor_zero pode incluir pedidos com desconto 100% (válido).
-- Não é necessariamente erro — verificar os exemplos da query seguinte.
-- -----------------------------------------------------------------------
SELECT
  COUNT(*) FILTER (WHERE total IS NULL)                              AS pedidos_total_null,
  COUNT(*) FILTER (WHERE total = 0)                                  AS pedidos_valor_zero,
  COUNT(*) FILTER (WHERE total < 0)                                  AS pedidos_valor_negativo,
  COUNT(*) FILTER (WHERE data_pedido IS NULL)                        AS pedidos_sem_data,
  COUNT(*) FILTER (WHERE status IS NULL OR trim(status::text) = '')   AS pedidos_sem_status,
  COUNT(*) FILTER (WHERE numero_pedido IS NULL OR trim(numero_pedido) = '') AS pedidos_sem_numero,
  COUNT(*) FILTER (WHERE source::text IS NULL OR trim(source::text) = '')   AS pedidos_sem_source
FROM v2_pedidos;

-- -----------------------------------------------------------------------
-- 10. DISTRIBUIÇÃO DE STATUS — verificar se os valores são válidos
-- -----------------------------------------------------------------------
SELECT
  COALESCE(status::text, '⚠ NULL') AS status,
  source::text,
  COUNT(*) AS qtd
FROM v2_pedidos
GROUP BY status::text, source::text
ORDER BY qtd DESC;

-- -----------------------------------------------------------------------
-- 11. PEDIDOS DUPLICADOS — mesmo numero_pedido + source
-- Esperado: 0 linhas (índice único garante). Qualquer linha = problema grave.
-- -----------------------------------------------------------------------
SELECT numero_pedido, source::text, COUNT(*) AS ocorrencias
FROM v2_pedidos
WHERE numero_pedido IS NOT NULL
GROUP BY numero_pedido, source::text
HAVING COUNT(*) > 1
ORDER BY ocorrencias DESC
LIMIT 20;

-- -----------------------------------------------------------------------
-- 12. PEDIDOS DUPLICADOS — mesmo bling_id
-- Esperado: 0 linhas. Qualquer linha = índice único não está funcionando.
-- -----------------------------------------------------------------------
SELECT bling_id, COUNT(*) AS ocorrencias
FROM v2_pedidos
WHERE bling_id IS NOT NULL
GROUP BY bling_id
HAVING COUNT(*) > 1
ORDER BY ocorrencias DESC
LIMIT 20;

-- -----------------------------------------------------------------------
-- 13. ITENS — PEDIDOS COM E SEM ITENS EM v2_pedidos_items
-- -----------------------------------------------------------------------
SELECT
  COUNT(DISTINCT p.id)               AS total_pedidos,
  COUNT(DISTINCT i.pedido_id)        AS pedidos_com_itens,
  COUNT(DISTINCT p.id)
    - COUNT(DISTINCT i.pedido_id)    AS pedidos_sem_itens,
  COUNT(*)                           AS total_linhas_itens
FROM v2_pedidos p
LEFT JOIN v2_pedidos_items i ON i.pedido_id::text = p.id::text;

-- -----------------------------------------------------------------------
-- 14. ITENS — PEDIDOS SEM ITENS POR SOURCE
-- -----------------------------------------------------------------------
SELECT p.source::text, COUNT(*) AS pedidos_sem_itens
FROM v2_pedidos p
WHERE NOT EXISTS (
  SELECT 1 FROM v2_pedidos_items i
  WHERE i.pedido_id::text = p.id::text
)
GROUP BY p.source::text
ORDER BY pedidos_sem_itens DESC;

-- -----------------------------------------------------------------------
-- 15. ITENS ÓRFÃOS — itens em v2_pedidos_items sem pedido pai em v2_pedidos
-- Esperado: 0 linhas. Qualquer resultado = corrupção de dados.
-- -----------------------------------------------------------------------
SELECT COUNT(*) AS itens_orfaos
FROM v2_pedidos_items i
WHERE NOT EXISTS (
  SELECT 1 FROM v2_pedidos p
  WHERE p.id::text = i.pedido_id::text
);

-- -----------------------------------------------------------------------
-- 17. YAMPI — reconciliação yampi_orders vs v2_pedidos
-- Mostra quantos pedidos do yampi_orders ainda não estão em v2_pedidos.
-- -----------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM yampi_orders)                            AS yampi_raw_total,
  (SELECT COUNT(*) FROM v2_pedidos WHERE source::text = 'yampi')       AS v2_pedidos_yampi,
  (SELECT COUNT(*) FROM yampi_orders yo
   WHERE NOT EXISTS (
     SELECT 1 FROM v2_pedidos p
     WHERE p.numero_pedido = yo.numero_pedido::text
        OR p.id::text = yo.numero_pedido::text
   ))                                                             AS yampi_nao_sincronizados;

-- -----------------------------------------------------------------------
-- 18. CUSTOMER INTELLIGENCE — estado
-- Esperado: total_intel próximo de total_clientes com pedidos.
-- sem_score alto = refresh_customer_intelligence() não foi executado.
-- -----------------------------------------------------------------------
SELECT
  COUNT(*)                                                          AS total_intel,
  COUNT(*) FILTER (WHERE score_final IS NULL OR score_final = 0)   AS sem_score,
  COUNT(*) FILTER (WHERE segmento IS NULL OR trim(segmento) = '')  AS sem_segmento,
  COUNT(*) FILTER (WHERE next_best_action IS NULL)                 AS sem_next_action
FROM customer_intelligence;

-- Clientes com pedidos mas SEM entrada em customer_intelligence
SELECT COUNT(*) AS clientes_sem_intel
FROM v2_clientes c
WHERE c.total_pedidos > 0
  AND NOT EXISTS (
    SELECT 1 FROM customer_intelligence ci WHERE ci.cliente_id = c.id
  );

-- LTV e métricas em v2_clientes
SELECT
  COUNT(*)                                                               AS total_clientes,
  COUNT(*) FILTER (WHERE total_gasto IS NULL OR total_gasto = 0)         AS sem_ltv,
  COUNT(*) FILTER (WHERE ultimo_pedido IS NULL)                          AS sem_ultimo_pedido,
  COUNT(*) FILTER (WHERE total_pedidos IS NULL OR total_pedidos = 0)     AS sem_pedidos_contados,
  MIN(ultimo_pedido)                                                     AS compra_mais_antiga,
  MAX(ultimo_pedido)                                                     AS compra_mais_recente,
  ROUND(AVG(total_gasto) FILTER (WHERE total_gasto > 0), 2)             AS ticket_medio_geral
FROM v2_clientes;

-- -----------------------------------------------------------------------
-- 19. CARRINHOS ABANDONADOS — estado
-- -----------------------------------------------------------------------
SELECT
  COUNT(*)                                                              AS total,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')      AS ultimos_30d,
  MIN(created_at)                                                       AS mais_antigo,
  MAX(created_at)                                                       AS mais_recente
FROM carrinhos_abandonados;

-- -----------------------------------------------------------------------
-- 20. ÍNDICES EXISTENTES EM TABELAS CRÍTICAS
-- Verificar se os índices únicos de bling_id e (numero_pedido, source) existem.
-- -----------------------------------------------------------------------
SELECT
  tablename,
  indexname,
  CASE WHEN indexdef LIKE '%UNIQUE%' THEN '✓ UNIQUE' ELSE 'INDEX' END AS tipo,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('v2_pedidos', 'v2_clientes', 'v2_pedidos_items', 'v2_produtos', 'v2_canais')
ORDER BY tablename, indexname;

-- -----------------------------------------------------------------------
-- 21. PEDIDOS POR MÊS — volume temporal
-- -----------------------------------------------------------------------
SELECT
  TO_CHAR(data_pedido, 'YYYY-MM') AS mes,
  source::text,
  COUNT(*)                         AS qtd,
  ROUND(SUM(total), 2)             AS receita
FROM v2_pedidos
WHERE data_pedido IS NOT NULL
GROUP BY TO_CHAR(data_pedido, 'YYYY-MM'), source::text
ORDER BY TO_CHAR(data_pedido, 'YYYY-MM') DESC, qtd DESC
LIMIT 24;

-- -----------------------------------------------------------------------
-- 22. TOP 10 CLIENTES POR LTV
-- -----------------------------------------------------------------------
SELECT
  c.nome,
  c.email,
  c.total_pedidos,
  ROUND(c.total_gasto, 2)      AS total_gasto,
  c.ultimo_pedido,
  ROUND(ci.score_final, 2)     AS score_final,
  ci.segmento
FROM v2_clientes c
LEFT JOIN customer_intelligence ci ON ci.cliente_id = c.id
WHERE c.total_gasto > 0
ORDER BY c.total_gasto DESC NULLS LAST
LIMIT 10;

-- -----------------------------------------------------------------------
-- 23. DIAGNÓSTICO FINAL — checklist resumido em uma tabela
-- Rodar este bloco para ter o panorama geral em segundos.
-- -----------------------------------------------------------------------
SELECT metrica, valor,
  CASE
    WHEN metrica = 'pedidos_total'        AND valor::int >= 714    THEN '✓ OK'
    WHEN metrica = 'pedidos_total'                                  THEN '⚠ BAIXO'
    WHEN metrica = 'pedidos_duplicados'   AND valor::int = 0        THEN '✓ OK'
    WHEN metrica = 'pedidos_duplicados'                             THEN '❌ DUPLICATAS'
    WHEN metrica = 'itens_orfaos'         AND valor::int = 0        THEN '✓ OK'
    WHEN metrica = 'itens_orfaos'                                   THEN '❌ CORRUPÇÃO'
    WHEN metrica = 'clientes_total'       AND valor::int > 0        THEN '✓ OK'
    WHEN metrica = 'intel_total'          AND valor::int > 0        THEN '✓ OK'
    WHEN metrica = 'intel_total'                                    THEN '⚠ VAZIO'
    WHEN metrica = 'canais_total'         AND valor::int > 0        THEN '✓ OK'
    WHEN metrica = 'canais_total'                                   THEN '❌ SEM CANAIS'
    ELSE '— verificar'
  END AS status
FROM (
  SELECT 'pedidos_total'       AS metrica, COUNT(*)::text                AS valor FROM v2_pedidos
  UNION ALL
  SELECT 'pedidos_sem_cliente',           COUNT(*)::text                 FROM v2_pedidos WHERE cliente_id IS NULL
  UNION ALL
  SELECT 'pedidos_sem_canal',             COUNT(*)::text FROM v2_pedidos WHERE canal_id IS NULL
  UNION ALL
  SELECT 'pedidos_valor_null_ou_zero',    COUNT(*)::text FROM v2_pedidos WHERE total IS NULL OR total = 0
  UNION ALL
    SELECT 'pedidos_sem_status',          COUNT(*)::text                 FROM v2_pedidos WHERE status IS NULL OR trim(status::text) = ''
  UNION ALL
  SELECT 'pedidos_duplicados',            COUNT(*)::text                 FROM (
    SELECT numero_pedido, source::text FROM v2_pedidos
    WHERE numero_pedido IS NOT NULL
    GROUP BY numero_pedido, source::text HAVING COUNT(*) > 1
  ) dup
  UNION ALL
  SELECT 'pedidos_com_itens',             COUNT(DISTINCT pedido_id)::text FROM v2_pedidos_items
  UNION ALL
  SELECT 'itens_total',                   COUNT(*)::text                 FROM v2_pedidos_items
  UNION ALL
  SELECT 'itens_orfaos',                  COUNT(*)::text                 FROM v2_pedidos_items i
                                          WHERE NOT EXISTS (SELECT 1 FROM v2_pedidos p WHERE p.id::text = i.pedido_id::text)
  UNION ALL
  SELECT 'clientes_total',                COUNT(*)::text                 FROM v2_clientes
  UNION ALL
  SELECT 'clientes_sem_doc',              COUNT(*)::text                 FROM v2_clientes WHERE doc IS NULL OR doc = ''
  UNION ALL
  SELECT 'intel_total',                   COUNT(*)::text                 FROM customer_intelligence
  UNION ALL
  SELECT 'clientes_sem_intel',            COUNT(*)::text                 FROM v2_clientes c
                                          WHERE c.total_pedidos > 0
                                          AND NOT EXISTS (SELECT 1 FROM customer_intelligence ci WHERE ci.cliente_id = c.id)
  UNION ALL
  SELECT 'carrinhos_total',               COUNT(*)::text                 FROM carrinhos_abandonados
  UNION ALL
  SELECT 'canais_total',                  COUNT(*)::text                 FROM v2_canais
) t
ORDER BY metrica;
