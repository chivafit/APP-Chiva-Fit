ALTER TABLE public.v2_pedidos_items
ADD COLUMN IF NOT EXISTS valor_total numeric DEFAULT 0;

ALTER TABLE public.v2_pedidos_items
ADD COLUMN IF NOT EXISTS total numeric DEFAULT 0;

CREATE OR REPLACE FUNCTION public.trg_v2_pedidos_items_sync_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.total IS NULL AND NEW.valor_total IS NOT NULL THEN
    NEW.total := NEW.valor_total;
  END IF;
  IF NEW.valor_total IS NULL AND NEW.total IS NOT NULL THEN
    NEW.valor_total := NEW.total;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS v2_pedidos_items_sync_totals ON public.v2_pedidos_items;

CREATE TRIGGER v2_pedidos_items_sync_totals
BEFORE INSERT OR UPDATE ON public.v2_pedidos_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_v2_pedidos_items_sync_totals();
