BEGIN;

DELETE FROM public.receitas_produtos
WHERE COALESCE(produto_id, '') = ''
   OR COALESCE(insumo_id, '') = ''
   OR quantidade_por_unidade IS NULL;

DELETE FROM public.receitas_produtos rp
WHERE NOT EXISTS (
  SELECT 1 FROM public.insumos i WHERE i.id = rp.insumo_id
);

WITH ranked AS (
  SELECT
    id,
    produto_id,
    insumo_id,
    updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY produto_id, insumo_id
      ORDER BY updated_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.receitas_produtos
)
DELETE FROM public.receitas_produtos rp
USING ranked r
WHERE rp.id = r.id
  AND r.rn > 1;

COMMIT;
