create table if not exists public.v2_alertas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  conteudo jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.v2_alertas enable row level security;

drop policy if exists "Anon Full Access" on public.v2_alertas;
drop policy if exists "Authenticated Full Access" on public.v2_alertas;
create policy "Authenticated Full Access" on public.v2_alertas for all to authenticated using (true) with check (true);
