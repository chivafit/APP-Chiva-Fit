create extension if not exists pgcrypto;
create extension if not exists unaccent;

create table if not exists public.stg_drive_vendas (
  id uuid primary key default gen_random_uuid(),
  imported_at timestamptz not null default now(),
  source_file text,
  row_num int,
  raw jsonb not null default '{}'::jsonb,

  nome_contato text,
  id_contato text,
  cpf_cnpj text,
  endereco text,
  bairro text,
  municipio text,
  cep text,
  estado text,
  email text,
  telefone text,
  loja_virtual text,
  numero_pedido text,
  data_texto text,
  valor_total text
);

alter table public.stg_drive_vendas add column if not exists id uuid;
alter table public.stg_drive_vendas alter column id set default gen_random_uuid();

alter table public.stg_drive_vendas add column if not exists imported_at timestamptz;
alter table public.stg_drive_vendas alter column imported_at set default now();
update public.stg_drive_vendas set imported_at = now() where imported_at is null;
alter table public.stg_drive_vendas alter column imported_at set not null;

alter table public.stg_drive_vendas add column if not exists source_file text;
alter table public.stg_drive_vendas add column if not exists row_num int;
alter table public.stg_drive_vendas add column if not exists raw jsonb;
alter table public.stg_drive_vendas alter column raw set default '{}'::jsonb;
update public.stg_drive_vendas set raw = '{}'::jsonb where raw is null;
alter table public.stg_drive_vendas alter column raw set not null;

alter table public.stg_drive_vendas add column if not exists nome_contato text;
alter table public.stg_drive_vendas add column if not exists id_contato text;
alter table public.stg_drive_vendas add column if not exists cpf_cnpj text;
alter table public.stg_drive_vendas add column if not exists endereco text;
alter table public.stg_drive_vendas add column if not exists bairro text;
alter table public.stg_drive_vendas add column if not exists municipio text;
alter table public.stg_drive_vendas add column if not exists cep text;
alter table public.stg_drive_vendas add column if not exists estado text;
alter table public.stg_drive_vendas add column if not exists email text;
alter table public.stg_drive_vendas add column if not exists telefone text;
alter table public.stg_drive_vendas add column if not exists loja_virtual text;
alter table public.stg_drive_vendas add column if not exists numero_pedido text;
alter table public.stg_drive_vendas add column if not exists data_texto text;
alter table public.stg_drive_vendas add column if not exists valor_total text;

create index if not exists stg_drive_vendas_numero_pedido_idx on public.stg_drive_vendas (numero_pedido);
create index if not exists stg_drive_vendas_imported_at_idx on public.stg_drive_vendas (imported_at);
create index if not exists stg_drive_vendas_cpf_cnpj_idx on public.stg_drive_vendas (cpf_cnpj);
create index if not exists stg_drive_vendas_email_idx on public.stg_drive_vendas (email);
create index if not exists stg_drive_vendas_telefone_idx on public.stg_drive_vendas (telefone);

alter table public.stg_drive_vendas enable row level security;
drop policy if exists "Authenticated Full Access" on public.stg_drive_vendas;
create policy "Authenticated Full Access" on public.stg_drive_vendas for all to authenticated using (true) with check (true);

alter table public.v2_clientes add column if not exists cpf_cnpj text;
alter table public.v2_clientes add column if not exists endereco text;
alter table public.v2_clientes add column if not exists bairro text;
alter table public.v2_clientes add column if not exists cep text;
alter table public.v2_clientes add column if not exists municipio text;
alter table public.v2_clientes add column if not exists notas text;
alter table public.v2_clientes add column if not exists status_manual text;
alter table public.v2_clientes add column if not exists produto_favorito text;
alter table public.v2_clientes add column if not exists celular text;
alter table public.v2_clientes add column if not exists pipeline_stage text;
alter table public.v2_clientes add column if not exists last_interaction_at timestamptz;
alter table public.v2_clientes add column if not exists last_interaction_type text;
alter table public.v2_clientes add column if not exists last_interaction_desc text;
alter table public.v2_clientes add column if not exists last_contact_at timestamptz;
alter table public.v2_clientes add column if not exists responsible_user text;

alter table public.v2_clientes add column if not exists email_normalizado text;
alter table public.v2_clientes add column if not exists telefone_normalizado text;
alter table public.v2_clientes add column if not exists cpf_cnpj_normalizado text;
alter table public.v2_clientes add column if not exists cidade_normalizada text;
alter table public.v2_clientes add column if not exists uf_normalizado text;

alter table public.v2_clientes add column if not exists primeira_compra_em date;
alter table public.v2_clientes add column if not exists ultima_compra_em date;
alter table public.v2_clientes add column if not exists recencia_dias int;
alter table public.v2_clientes add column if not exists status_cliente text;

create index if not exists v2_clientes_email_lower_idx on public.v2_clientes (lower(email));
create index if not exists v2_clientes_telefone_digits_idx on public.v2_clientes (telefone);
create index if not exists v2_clientes_email_normalizado_idx on public.v2_clientes (email_normalizado);
create index if not exists v2_clientes_telefone_normalizado_idx on public.v2_clientes (telefone_normalizado);
create index if not exists v2_clientes_cpf_cnpj_normalizado_idx on public.v2_clientes (cpf_cnpj_normalizado);

create or replace function public.crm_digits(v text)
returns text
language sql
immutable
as $$
select nullif(regexp_replace(coalesce(v,''), '\D', '', 'g'), '');
$$;

create or replace function public.crm_parse_num(v text)
returns numeric
language sql
immutable
as $$
select
  coalesce(
    nullif(
      regexp_replace(
        replace(replace(replace(trim(coalesce(v,'')), 'R$', ''), '.', ''), ',', '.'),
        '[^0-9\.-]',
        '',
        'g'
      ),
      ''
    )::numeric,
    0
  );
$$;

create or replace function public.crm_norm_phone(v text)
returns text
language sql
immutable
as $$
select
  case
    when v is null or trim(v) = '' then null
    else
      case
        when length(public.crm_digits(v)) in (12,13) and left(public.crm_digits(v),2) = '55'
          then nullif(substr(public.crm_digits(v),3), '')
        else public.crm_digits(v)
      end
  end;
$$;

create or replace function public.refresh_customer_intelligence()
returns void
language plpgsql
as $$
begin
  if to_regclass('public.customer_intelligence') is null then
    return;
  end if;

  with cli as (
    select
      c.id as cliente_id,
      c.total_pedidos,
      coalesce(c.ltv, c.total_gasto, 0) as ltv,
      c.ultimo_pedido,
      case
        when c.ultimo_pedido is null then null
        else greatest(0, (now()::date - c.ultimo_pedido)::int)
      end as recencia_dias
    from public.v2_clientes c
    where c.id is not null
  ),
  scored as (
    select
      cli.cliente_id,
      cli.recencia_dias,
      cli.total_pedidos,
      cli.ltv,
      least(100, greatest(0, 100 - (cli.recencia_dias * 2)))::numeric as recencia_score,
      least(100, greatest(0, cli.total_pedidos * 10))::numeric as freq_score,
      least(100, greatest(0, ln(greatest(1, cli.ltv + 1)) * 18))::numeric as ltv_score
    from cli
    where cli.recencia_dias is not null
  ),
  final as (
    select
      s.cliente_id,
      round((s.recencia_score * 0.5) + (s.freq_score * 0.3) + (s.ltv_score * 0.2))::numeric as score_final,
      case
        when s.ltv >= 500 or s.total_pedidos >= 6 then 'VIP'
        when s.recencia_dias > 60 then 'Churn'
        when s.recencia_dias > 30 then 'Em Risco'
        else 'Novo'
      end as segmento,
      case
        when s.recencia_dias > 60 then 'Reativar com oferta forte + mensagem pessoal'
        when s.recencia_dias > 30 then 'Enviar cupom de desconto'
        when s.ltv >= 500 or s.total_pedidos >= 6 then 'Oferta VIP: lançamento/kit exclusivo'
        else 'Boas-vindas + sugestão do best-seller'
      end as next_best_action
    from scored s
  )
  insert into public.customer_intelligence (cliente_id, score_final, next_best_action, segmento, perfil_compra, updated_at)
  select
    f.cliente_id,
    f.score_final,
    f.next_best_action,
    f.segmento,
    null,
    now()
  from final f
  on conflict (cliente_id) do update set
    score_final = excluded.score_final,
    next_best_action = excluded.next_best_action,
    segmento = excluded.segmento,
    perfil_compra = excluded.perfil_compra,
    updated_at = now();
end;
$$;

create or replace function public.crm_norm_email(v text)
returns text
language sql
immutable
as $$
select
  case
    when v is null then null
    else
      case
        when position('@' in lower(trim(v))) > 1 then lower(trim(replace(v, ' ', '')))
        else null
      end
  end;
$$;

create or replace function public.crm_norm_cpf_cnpj(v text)
returns text
language sql
immutable
as $$
select
  case
    when length(public.crm_digits(v)) in (11,14) then public.crm_digits(v)
    else null
  end;
$$;

create or replace function public.crm_norm_city(v text)
returns text
language sql
immutable
as $$
select
  case
    when v is null or trim(v) = '' then null
    else regexp_replace(lower(unaccent(trim(v))), '\s+', ' ', 'g')
  end;
$$;

create or replace function public.crm_fmt_city(v text)
returns text
language sql
immutable
as $$
select
  case
    when v is null or trim(v) = '' then null
    else initcap(regexp_replace(lower(unaccent(trim(v))), '\s+', ' ', 'g'))
  end;
$$;

create or replace function public.crm_norm_uf(v text)
returns text
language sql
immutable
as $$
select
  case
    when v is null then null
    when length(upper(trim(v))) = 2 then upper(trim(v))
    else null
  end;
$$;

create or replace function public.crm_parse_date_any(v text)
returns date
language sql
immutable
as $$
select
  case
    when v is null or trim(v) = '' then null
    when trim(v) ~ '^\d{2}/\d{2}/\d{4}$' then to_date(trim(v), 'DD/MM/YYYY')
    when trim(v) ~ '^\d{4}-\d{2}-\d{2}$' then trim(v)::date
    else null
  end;
$$;

create or replace function public.crm_infer_canal_slug(loja_virtual text)
returns text
language sql
immutable
as $$
select
  case
    when loja_virtual is null or trim(loja_virtual) = '' then 'outros'
    when lower(loja_virtual) like '%shopee%' then 'shopee'
    when lower(loja_virtual) like '%amazon%' then 'amazon'
    when lower(loja_virtual) like '%mercado livre%' or lower(loja_virtual) like '%ml%' then 'ml'
    when lower(loja_virtual) like '%yampi%' then 'yampi'
    when lower(loja_virtual) like '%shopify%' then 'shopify'
    else 'outros'
  end;
$$;

create or replace function public.audit_clientes_schema()
returns jsonb
language sql
stable
as $$
select jsonb_build_object(
  'stg_drive_vendas',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'column', c.column_name,
            'type', c.data_type,
            'nullable', c.is_nullable,
            'default', c.column_default
          )
          order by c.ordinal_position
        )
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'stg_drive_vendas'
      ),
      '[]'::jsonb
    ),
  'v2_clientes',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'column', c.column_name,
            'type', c.data_type,
            'nullable', c.is_nullable,
            'default', c.column_default
          )
          order by c.ordinal_position
        )
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'v2_clientes'
      ),
      '[]'::jsonb
    )
);
$$;

create or replace function public.rebuild_v2_clientes_from_stg_drive_vendas(p_dry_run boolean default false)
returns jsonb
language plpgsql
as $$
declare
  v_total_lido bigint := 0;
  v_unicos bigint := 0;
  v_dup_grupos bigint := 0;
  v_dup_agrupados bigint := 0;
  v_incompletos bigint := 0;
  v_inseridos bigint := 0;
  v_atualizados bigint := 0;
begin
  select count(*) into v_total_lido from public.stg_drive_vendas;

  with src as (
    select
      s.id as stg_id,
      nullif(trim(s.nome_contato), '') as nome_contato,
      nullif(trim(s.id_contato), '') as id_contato,
      nullif(trim(s.cpf_cnpj), '') as cpf_cnpj_raw,
      public.crm_norm_cpf_cnpj(s.cpf_cnpj) as cpf_cnpj_norm,
      nullif(trim(s.email), '') as email_raw,
      public.crm_norm_email(s.email) as email_norm,
      nullif(trim(s.telefone), '') as telefone_raw,
      public.crm_norm_phone(s.telefone) as telefone_norm,
      nullif(trim(s.endereco), '') as endereco,
      nullif(trim(s.bairro), '') as bairro,
      nullif(trim(s.municipio), '') as municipio,
      public.crm_fmt_city(s.municipio) as cidade_fmt,
      public.crm_norm_city(s.municipio) as cidade_norm,
      nullif(trim(s.cep), '') as cep,
      nullif(trim(s.estado), '') as estado_raw,
      public.crm_norm_uf(s.estado) as uf_norm,
      nullif(trim(s.loja_virtual), '') as loja_virtual,
      nullif(trim(s.numero_pedido), '') as numero_pedido,
      public.crm_parse_date_any(s.data_texto) as data_pedido,
      public.crm_parse_num(s.valor_total) as valor_total_num,
      public.crm_infer_canal_slug(s.loja_virtual) as canal_slug
    from public.stg_drive_vendas s
  ),
  keyed as (
    select
      *,
      case
        when telefone_norm is not null and telefone_norm <> '' then telefone_norm
        when email_norm is not null and email_norm <> '' then email_norm
        when cpf_cnpj_norm is not null and cpf_cnpj_norm <> '' then cpf_cnpj_norm
        when nome_contato is not null and nome_contato <> '' and cidade_norm is not null and cidade_norm <> ''
          then 'nc_' || md5(public.crm_norm_city(nome_contato) || '|' || cidade_norm)
        else null
      end as cliente_key
    from src
  ),
  stats as (
    select
      count(*) filter (where cliente_key is null) as incompletos
    from keyed
  ),
  groups as (
    select cliente_key, count(*) as cnt
    from keyed
    where cliente_key is not null
    group by 1
  ),
  dup_stats as (
    select
      count(*) filter (where cnt > 1) as dup_grupos,
      coalesce(sum(greatest(0, cnt - 1)), 0) as dup_agrupados
    from groups
  ),
  pedidos as (
    select
      k.cliente_key,
      k.numero_pedido,
      max(k.data_pedido) as data_pedido,
      max(k.valor_total_num) as total_pedido,
      max(k.canal_slug) as canal_slug
    from keyed k
    where k.cliente_key is not null
      and k.numero_pedido is not null
      and k.numero_pedido <> ''
    group by 1, 2
  ),
  pedidos_agg as (
    select
      p.cliente_key,
      min(p.data_pedido) as primeira_compra_em,
      max(p.data_pedido) as ultima_compra_em,
      count(*)::int as total_pedidos,
      coalesce(sum(coalesce(p.total_pedido, 0)), 0)::numeric as total_gasto
    from pedidos p
    group by 1
  ),
  canal_rank as (
    select
      p.cliente_key,
      p.canal_slug,
      count(*)::int as pedidos,
      row_number() over (partition by p.cliente_key order by count(*) desc, p.canal_slug asc) as rn
    from pedidos p
    where p.canal_slug is not null and p.canal_slug <> ''
    group by 1, 2
  ),
  canal_pick as (
    select cliente_key, canal_slug
    from canal_rank
    where rn = 1
  ),
  clientes_agg as (
    select
      k.cliente_key as doc,
      coalesce(
        (array_agg(k.nome_contato order by length(k.nome_contato) desc nulls last))[1],
        'Cliente'
      ) as nome,
      (array_agg(k.email_norm order by length(k.email_norm) desc nulls last))[1] as email_normalizado,
      (array_agg(k.telefone_norm order by length(k.telefone_norm) desc nulls last))[1] as telefone_normalizado,
      (array_agg(k.cpf_cnpj_raw order by length(k.cpf_cnpj_raw) desc nulls last))[1] as cpf_cnpj,
      (array_agg(k.cpf_cnpj_norm order by length(k.cpf_cnpj_norm) desc nulls last))[1] as cpf_cnpj_normalizado,
      (array_agg(k.endereco order by length(k.endereco) desc nulls last))[1] as endereco,
      (array_agg(k.bairro order by length(k.bairro) desc nulls last))[1] as bairro,
      (array_agg(k.cep order by length(k.cep) desc nulls last))[1] as cep,
      (array_agg(k.municipio order by length(k.municipio) desc nulls last))[1] as municipio,
      (array_agg(k.cidade_fmt order by length(k.cidade_fmt) desc nulls last))[1] as cidade,
      (array_agg(k.cidade_norm order by length(k.cidade_norm) desc nulls last))[1] as cidade_normalizada,
      (array_agg(k.uf_norm order by length(k.uf_norm) desc nulls last))[1] as uf_normalizado
    from keyed k
    where k.cliente_key is not null
    group by 1
  ),
  clientes_ready as (
    select
      c.doc,
      c.nome,
      nullif(c.email_normalizado, '') as email_normalizado,
      nullif(c.telefone_normalizado, '') as telefone_normalizado,
      nullif(c.cpf_cnpj, '') as cpf_cnpj,
      nullif(c.cpf_cnpj_normalizado, '') as cpf_cnpj_normalizado,
      nullif(c.endereco, '') as endereco,
      nullif(c.bairro, '') as bairro,
      nullif(c.cep, '') as cep,
      nullif(c.municipio, '') as municipio,
      nullif(c.cidade, '') as cidade,
      nullif(c.cidade_normalizada, '') as cidade_normalizada,
      nullif(c.uf_normalizado, '') as uf_normalizado,
      pa.primeira_compra_em,
      pa.ultima_compra_em,
      coalesce(pa.total_pedidos, 0) as total_pedidos,
      coalesce(pa.total_gasto, 0) as total_gasto,
      (coalesce(pa.total_gasto, 0) / nullif(coalesce(pa.total_pedidos, 0), 0))::numeric as ticket_medio,
      cp.canal_slug as canal_principal,
      case
        when pa.ultima_compra_em is null then null
        else greatest(0, (now()::date - pa.ultima_compra_em)::int)
      end as recencia_dias,
      case
        when pa.ultima_compra_em is null then 'Novo Lead'
        when (now()::date - pa.ultima_compra_em)::int <= 30 then 'Ativo'
        when (now()::date - pa.ultima_compra_em)::int <= 60 then 'Atenção'
        when (now()::date - pa.ultima_compra_em)::int <= 120 then 'Em Risco'
        else 'Churn'
      end as status_cliente
    from clientes_agg c
    left join pedidos_agg pa on pa.cliente_key = c.doc
    left join canal_pick cp on cp.cliente_key = c.doc
  )
  select
    (select incompletos from stats) as incompletos,
    (select dup_grupos from dup_stats) as dup_grupos,
    (select dup_agrupados from dup_stats) as dup_agrupados,
    (select count(*) from clientes_ready) as unicos
  into
    v_incompletos,
    v_dup_grupos,
    v_dup_agrupados,
    v_unicos;

  if p_dry_run then
    raise notice '[drive->v2_clientes] total_lido=%', v_total_lido;
    raise notice '[drive->v2_clientes] unicos_consolidados=%', v_unicos;
    raise notice '[drive->v2_clientes] duplicados_grupos=% duplicados_agrupados=%', v_dup_grupos, v_dup_agrupados;
    raise notice '[drive->v2_clientes] incompletos_tratados=%', v_incompletos;
    return jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'total_lido', v_total_lido,
      'clientes_unicos_consolidados', v_unicos,
      'duplicados_grupos', v_dup_grupos,
      'duplicados_agrupados', v_dup_agrupados,
      'incompletos_tratados', v_incompletos,
      'inseridos_v2_clientes', 0,
      'atualizados_v2_clientes', 0
    );
  end if;

  with src as (
    select
      s.id as stg_id,
      nullif(trim(s.nome_contato), '') as nome_contato,
      nullif(trim(s.id_contato), '') as id_contato,
      nullif(trim(s.cpf_cnpj), '') as cpf_cnpj_raw,
      public.crm_norm_cpf_cnpj(s.cpf_cnpj) as cpf_cnpj_norm,
      nullif(trim(s.email), '') as email_raw,
      public.crm_norm_email(s.email) as email_norm,
      nullif(trim(s.telefone), '') as telefone_raw,
      public.crm_norm_phone(s.telefone) as telefone_norm,
      nullif(trim(s.endereco), '') as endereco,
      nullif(trim(s.bairro), '') as bairro,
      nullif(trim(s.municipio), '') as municipio,
      public.crm_fmt_city(s.municipio) as cidade_fmt,
      public.crm_norm_city(s.municipio) as cidade_norm,
      nullif(trim(s.cep), '') as cep,
      nullif(trim(s.estado), '') as estado_raw,
      public.crm_norm_uf(s.estado) as uf_norm,
      nullif(trim(s.loja_virtual), '') as loja_virtual,
      nullif(trim(s.numero_pedido), '') as numero_pedido,
      public.crm_parse_date_any(s.data_texto) as data_pedido,
      public.crm_parse_num(s.valor_total) as valor_total_num,
      public.crm_infer_canal_slug(s.loja_virtual) as canal_slug
    from public.stg_drive_vendas s
  ),
  keyed as (
    select
      *,
      case
        when telefone_norm is not null and telefone_norm <> '' then telefone_norm
        when email_norm is not null and email_norm <> '' then email_norm
        when cpf_cnpj_norm is not null and cpf_cnpj_norm <> '' then cpf_cnpj_norm
        when nome_contato is not null and nome_contato <> '' and cidade_norm is not null and cidade_norm <> ''
          then 'nc_' || md5(public.crm_norm_city(nome_contato) || '|' || cidade_norm)
        else null
      end as cliente_key
    from src
  ),
  pedidos as (
    select
      k.cliente_key,
      k.numero_pedido,
      max(k.data_pedido) as data_pedido,
      max(k.valor_total_num) as total_pedido,
      max(k.canal_slug) as canal_slug
    from keyed k
    where k.cliente_key is not null
      and k.numero_pedido is not null
      and k.numero_pedido <> ''
    group by 1, 2
  ),
  pedidos_agg as (
    select
      p.cliente_key,
      min(p.data_pedido) as primeira_compra_em,
      max(p.data_pedido) as ultima_compra_em,
      count(*)::int as total_pedidos,
      coalesce(sum(coalesce(p.total_pedido, 0)), 0)::numeric as total_gasto
    from pedidos p
    group by 1
  ),
  canal_rank as (
    select
      p.cliente_key,
      p.canal_slug,
      count(*)::int as pedidos,
      row_number() over (partition by p.cliente_key order by count(*) desc, p.canal_slug asc) as rn
    from pedidos p
    where p.canal_slug is not null and p.canal_slug <> ''
    group by 1, 2
  ),
  canal_pick as (
    select cliente_key, canal_slug
    from canal_rank
    where rn = 1
  ),
  clientes_agg as (
    select
      k.cliente_key as doc,
      coalesce(
        (array_agg(k.nome_contato order by length(k.nome_contato) desc nulls last))[1],
        'Cliente'
      ) as nome,
      (array_agg(k.email_norm order by length(k.email_norm) desc nulls last))[1] as email_normalizado,
      (array_agg(k.telefone_norm order by length(k.telefone_norm) desc nulls last))[1] as telefone_normalizado,
      (array_agg(k.cpf_cnpj_raw order by length(k.cpf_cnpj_raw) desc nulls last))[1] as cpf_cnpj,
      (array_agg(k.cpf_cnpj_norm order by length(k.cpf_cnpj_norm) desc nulls last))[1] as cpf_cnpj_normalizado,
      (array_agg(k.endereco order by length(k.endereco) desc nulls last))[1] as endereco,
      (array_agg(k.bairro order by length(k.bairro) desc nulls last))[1] as bairro,
      (array_agg(k.cep order by length(k.cep) desc nulls last))[1] as cep,
      (array_agg(k.municipio order by length(k.municipio) desc nulls last))[1] as municipio,
      (array_agg(k.cidade_fmt order by length(k.cidade_fmt) desc nulls last))[1] as cidade,
      (array_agg(k.cidade_norm order by length(k.cidade_norm) desc nulls last))[1] as cidade_normalizada,
      (array_agg(k.uf_norm order by length(k.uf_norm) desc nulls last))[1] as uf_normalizado
    from keyed k
    where k.cliente_key is not null
    group by 1
  ),
  clientes_ready as (
    select
      c.doc,
      c.nome,
      nullif(c.email_normalizado, '') as email_normalizado,
      nullif(c.telefone_normalizado, '') as telefone_normalizado,
      nullif(c.cpf_cnpj, '') as cpf_cnpj,
      nullif(c.cpf_cnpj_normalizado, '') as cpf_cnpj_normalizado,
      nullif(c.endereco, '') as endereco,
      nullif(c.bairro, '') as bairro,
      nullif(c.cep, '') as cep,
      nullif(c.municipio, '') as municipio,
      nullif(c.cidade, '') as cidade,
      nullif(c.cidade_normalizada, '') as cidade_normalizada,
      nullif(c.uf_normalizado, '') as uf_normalizado,
      pa.primeira_compra_em,
      pa.ultima_compra_em,
      coalesce(pa.total_pedidos, 0) as total_pedidos,
      coalesce(pa.total_gasto, 0) as total_gasto,
      (coalesce(pa.total_gasto, 0) / nullif(coalesce(pa.total_pedidos, 0), 0))::numeric as ticket_medio,
      cp.canal_slug as canal_principal,
      case
        when pa.ultima_compra_em is null then null
        else greatest(0, (now()::date - pa.ultima_compra_em)::int)
      end as recencia_dias,
      case
        when pa.ultima_compra_em is null then 'Novo Lead'
        when (now()::date - pa.ultima_compra_em)::int <= 30 then 'Ativo'
        when (now()::date - pa.ultima_compra_em)::int <= 60 then 'Atenção'
        when (now()::date - pa.ultima_compra_em)::int <= 120 then 'Em Risco'
        else 'Churn'
      end as status_cliente
    from clientes_agg c
    left join pedidos_agg pa on pa.cliente_key = c.doc
    left join canal_pick cp on cp.cliente_key = c.doc
  ),
  upserted as (
    insert into public.v2_clientes (
      doc,
      nome,
      email,
      telefone,
      cidade,
      uf,
      primeiro_pedido,
      ultimo_pedido,
      total_pedidos,
      total_gasto,
      ticket_medio,
      canal_principal,
      cpf_cnpj,
      endereco,
      bairro,
      cep,
      municipio,
      email_normalizado,
      telefone_normalizado,
      cpf_cnpj_normalizado,
      cidade_normalizada,
      uf_normalizado,
      primeira_compra_em,
      ultima_compra_em,
      recencia_dias,
      status_cliente,
      status,
      updated_at
    )
    select
      r.doc,
      coalesce(nullif(r.nome, ''), 'Cliente'),
      r.email_normalizado,
      r.telefone_normalizado,
      r.cidade,
      r.uf_normalizado,
      r.primeira_compra_em,
      r.ultima_compra_em,
      r.total_pedidos,
      r.total_gasto,
      r.ticket_medio,
      r.canal_principal,
      r.cpf_cnpj,
      r.endereco,
      r.bairro,
      r.cep,
      r.municipio,
      r.email_normalizado,
      r.telefone_normalizado,
      r.cpf_cnpj_normalizado,
      r.cidade_normalizada,
      r.uf_normalizado,
      r.primeira_compra_em,
      r.ultima_compra_em,
      r.recencia_dias,
      r.status_cliente,
      r.status_cliente,
      now()
    from clientes_ready r
    on conflict (doc) do update set
      nome = coalesce(nullif(public.v2_clientes.nome, ''), excluded.nome),
      email = coalesce(nullif(public.v2_clientes.email, ''), excluded.email),
      telefone = coalesce(nullif(public.v2_clientes.telefone, ''), excluded.telefone),
      cidade = coalesce(nullif(public.v2_clientes.cidade, ''), excluded.cidade),
      uf = coalesce(nullif(public.v2_clientes.uf, ''), excluded.uf),
      cpf_cnpj = coalesce(nullif(public.v2_clientes.cpf_cnpj, ''), excluded.cpf_cnpj),
      endereco = coalesce(nullif(public.v2_clientes.endereco, ''), excluded.endereco),
      bairro = coalesce(nullif(public.v2_clientes.bairro, ''), excluded.bairro),
      cep = coalesce(nullif(public.v2_clientes.cep, ''), excluded.cep),
      municipio = coalesce(nullif(public.v2_clientes.municipio, ''), excluded.municipio),
      email_normalizado = coalesce(nullif(public.v2_clientes.email_normalizado, ''), excluded.email_normalizado),
      telefone_normalizado = coalesce(nullif(public.v2_clientes.telefone_normalizado, ''), excluded.telefone_normalizado),
      cpf_cnpj_normalizado = coalesce(nullif(public.v2_clientes.cpf_cnpj_normalizado, ''), excluded.cpf_cnpj_normalizado),
      cidade_normalizada = coalesce(nullif(public.v2_clientes.cidade_normalizada, ''), excluded.cidade_normalizada),
      uf_normalizado = coalesce(nullif(public.v2_clientes.uf_normalizado, ''), excluded.uf_normalizado),

      primeira_compra_em = excluded.primeira_compra_em,
      ultima_compra_em = excluded.ultima_compra_em,
      primeiro_pedido = excluded.primeira_compra_em,
      ultimo_pedido = excluded.ultima_compra_em,
      total_pedidos = excluded.total_pedidos,
      total_gasto = excluded.total_gasto,
      ticket_medio = excluded.ticket_medio,
      canal_principal = excluded.canal_principal,
      recencia_dias = excluded.recencia_dias,
      status_cliente = excluded.status_cliente,
      status = excluded.status,
      updated_at = now()
    returning (xmax = 0) as inserted
  )
  select
    count(*) filter (where inserted) as inseridos,
    count(*) filter (where not inserted) as atualizados
  into
    v_inseridos,
    v_atualizados
  from upserted;

  raise notice '[drive->v2_clientes] total_lido=%', v_total_lido;
  raise notice '[drive->v2_clientes] unicos_consolidados=%', v_unicos;
  raise notice '[drive->v2_clientes] duplicados_grupos=% duplicados_agrupados=%', v_dup_grupos, v_dup_agrupados;
  raise notice '[drive->v2_clientes] incompletos_tratados=%', v_incompletos;
  raise notice '[drive->v2_clientes] inseridos=% atualizados=%', v_inseridos, v_atualizados;

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'total_lido', v_total_lido,
    'clientes_unicos_consolidados', v_unicos,
    'duplicados_grupos', v_dup_grupos,
    'duplicados_agrupados', v_dup_agrupados,
    'incompletos_tratados', v_incompletos,
    'inseridos_v2_clientes', v_inseridos,
    'atualizados_v2_clientes', v_atualizados
  );
end;
$$;
