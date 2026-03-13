create table if not exists public.v2_canais (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.v2_canais
  add column if not exists slug text;

create unique index if not exists v2_canais_slug_uq on public.v2_canais (lower(slug));

