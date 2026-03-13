create table if not exists public.v2_alertas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  conteudo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

