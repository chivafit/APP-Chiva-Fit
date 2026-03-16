CREATE TABLE IF NOT EXISTS public.v2_produtos (
  id text PRIMARY KEY,
  codigo text,
  nome text,
  estoque numeric DEFAULT 0,
  preco numeric,
  situacao text,
  origem text DEFAULT 'bling',
  updated_at timestamp with time zone DEFAULT now(),
  raw jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.v2_produtos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon Full Access" ON public.v2_produtos;
DROP POLICY IF EXISTS "Authenticated Full Access" ON public.v2_produtos;
CREATE POLICY "Authenticated Full Access" ON public.v2_produtos FOR ALL TO authenticated USING (true) WITH CHECK (true);
