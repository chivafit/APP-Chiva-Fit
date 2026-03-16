create table if not exists public.stg_bling_csv_pedidos_itens (
  id uuid primary key default gen_random_uuid(),
  imported_at timestamptz not null default now(),
  source_file text,
  row_num int,
  merge_batch_id uuid,
  merged_at timestamptz,
  merge_error text,

  bling_id text,
  numero_pedido text,
  numero_pedido_loja_virtual text,
  data text,
  contato_id text,
  contato_nome text,
  cpf_cnpj text,
  endereco text,
  bairro text,
  municipio text,
  cep text,
  estado text,
  email text,
  telefone text,
  desconto_pedido text,
  frete text,
  observacoes text,
  situacao text,
  produto_id text,
  produto_descricao text,
  quantidade text,
  valor_unitario text,
  desconto_item text,
  preco_custo text,
  preco_total text,
  codigo_contato text,
  codigo_produto text,
  frete_proporcional text,
  desconto_proporcional text,
  vendedor text,
  nfe_numero text,
  nfe_natureza text,
  nfe_situacao text,
  ultima_ocorrencia text,
  outras_despesas text,
  outras_despesas_proporcional text,
  loja_virtual text
);

create index if not exists stg_bling_csv_merge_batch_id_idx on public.stg_bling_csv_pedidos_itens (merge_batch_id);
create index if not exists stg_bling_csv_bling_id_idx on public.stg_bling_csv_pedidos_itens (bling_id);
create index if not exists stg_bling_csv_numero_pedido_idx on public.stg_bling_csv_pedidos_itens (numero_pedido);

alter table public.v2_canais add column if not exists updated_at timestamptz not null default now();

create or replace function public.bling_parse_num(v text)
returns numeric
language sql
immutable
as $$
select
  coalesce(
    nullif(
      regexp_replace(
        replace(replace(replace(trim(coalesce(v,'')), 'R$', ''), '.', ''), ',', '.'),
        '[^0-9\\.-]',
        '',
        'g'
      ),
      ''
    )::numeric,
    0
  );
$$;

create or replace function public.bling_parse_date_br(v text)
returns date
language sql
immutable
as $$
select
  case
    when v is null or trim(v) = '' then null
    else to_date(trim(v), 'DD/MM/YYYY')
  end;
$$;

create or replace function public.bling_digits(v text)
returns text
language sql
immutable
as $$
select nullif(regexp_replace(coalesce(v,''), '\\D', '', 'g'), '');
$$;

create or replace function public.bling_doc_key(cpf_cnpj text, email text, telefone text, codigo_contato text)
returns text
language sql
immutable
as $$
select
  coalesce(
    case
      when length(public.bling_digits(cpf_cnpj)) in (11,14) then public.bling_digits(cpf_cnpj)
      else null
    end,
    nullif(lower(trim(coalesce(email,''))), ''),
    public.bling_digits(telefone),
    nullif(trim(coalesce(codigo_contato,'')), '')
  );
$$;

create or replace function public.bling_infer_canal_slug(loja_virtual text)
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

create or replace function public.merge_bling_csv_staging(p_merge_batch_id uuid, p_replace_items boolean default false)
returns jsonb
language plpgsql
as $$
declare
  v_batch uuid := p_merge_batch_id;
  v_orders int := 0;
  v_clients int := 0;
  v_items int := 0;
  v_products int := 0;
begin
  if v_batch is null then
    raise exception 'merge_batch_id_required';
  end if;

  with src as (
    select
      s.id as stg_id,
      nullif(trim(s.bling_id), '') as bling_id,
      nullif(trim(s.numero_pedido), '') as numero_pedido,
      nullif(trim(s.numero_pedido_loja_virtual), '') as numero_pedido_loja_virtual,
      public.bling_parse_date_br(s.data) as data_pedido,
      nullif(trim(s.contato_id), '') as contato_id,
      nullif(trim(s.contato_nome), '') as contato_nome,
      nullif(trim(s.email), '') as email_raw,
      public.bling_digits(s.telefone) as telefone_digits,
      nullif(trim(s.municipio), '') as municipio,
      nullif(trim(s.estado), '') as estado,
      nullif(trim(s.cep), '') as cep,
      nullif(trim(s.endereco), '') as endereco,
      nullif(trim(s.bairro), '') as bairro,
      nullif(trim(s.cpf_cnpj), '') as cpf_cnpj,
      public.bling_doc_key(s.cpf_cnpj, s.email, s.telefone, s.codigo_contato) as doc_key,
      public.bling_infer_canal_slug(s.loja_virtual) as canal_slug,
      nullif(trim(s.situacao), '') as situacao,
      nullif(trim(s.observacoes), '') as observacoes,

      nullif(trim(s.produto_id), '') as produto_id_raw,
      nullif(trim(s.codigo_produto), '') as sku_raw,
      nullif(trim(s.produto_descricao), '') as produto_nome,
      public.bling_parse_num(s.quantidade) as quantidade_num,
      public.bling_parse_num(s.valor_unitario) as valor_unitario_num,
      public.bling_parse_num(s.preco_total) as preco_total_num,
      public.bling_parse_num(s.desconto_item) as desconto_item_num,
      public.bling_parse_num(s.desconto_proporcional) as desconto_proporcional_num,
      public.bling_parse_num(s.frete_proporcional) as frete_prop_num,
      public.bling_parse_num(s.outras_despesas_proporcional) as outras_desp_prop_num,
      public.bling_parse_num(s.desconto_pedido) as desconto_pedido_num,
      public.bling_parse_num(s.frete) as frete_num,
      public.bling_parse_num(s.outras_despesas) as outras_desp_num,
      nullif(trim(s.loja_virtual), '') as loja_virtual
    from public.stg_bling_csv_pedidos_itens s
    where s.merge_batch_id = v_batch
      and s.merged_at is null
  ),
  canais as (
    select distinct canal_slug as slug, max(loja_virtual) as nome
    from src
    where canal_slug is not null and canal_slug <> ''
    group by 1
  ),
  ins_canais as (
    insert into public.v2_canais (slug, nome, created_at, updated_at)
    select c.slug, c.nome, now(), now()
    from canais c
    on conflict (slug) do update
      set nome = coalesce(nullif(public.v2_canais.nome,''), excluded.nome),
          updated_at = now()
    returning 1
  ),
  clientes_src as (
    select
      doc_key as doc,
      max(contato_nome) as nome,
      max(lower(email_raw)) as email,
      max(telefone_digits) as telefone,
      max(municipio) as cidade,
      max(estado) as uf,
      min(data_pedido) as primeiro_pedido,
      max(data_pedido) as ultimo_pedido
    from src
    where doc_key is not null and doc_key <> ''
    group by 1
  ),
  upsert_clientes as (
    insert into public.v2_clientes (doc, nome, email, telefone, cidade, uf, primeiro_pedido, ultimo_pedido, updated_at)
    select
      c.doc,
      coalesce(nullif(c.nome,''), 'Cliente'),
      nullif(c.email,''),
      nullif(c.telefone,''),
      nullif(c.cidade,''),
      nullif(c.uf,''),
      c.primeiro_pedido,
      c.ultimo_pedido,
      now()
    from clientes_src c
    on conflict (doc) do update set
      nome = coalesce(nullif(public.v2_clientes.nome,''), excluded.nome),
      email = coalesce(nullif(public.v2_clientes.email,''), excluded.email),
      telefone = coalesce(nullif(public.v2_clientes.telefone,''), excluded.telefone),
      cidade = coalesce(nullif(public.v2_clientes.cidade,''), excluded.cidade),
      uf = coalesce(nullif(public.v2_clientes.uf,''), excluded.uf),
      primeiro_pedido = case
        when public.v2_clientes.primeiro_pedido is null then excluded.primeiro_pedido
        when excluded.primeiro_pedido is null then public.v2_clientes.primeiro_pedido
        else least(public.v2_clientes.primeiro_pedido, excluded.primeiro_pedido)
      end,
      ultimo_pedido = case
        when public.v2_clientes.ultimo_pedido is null then excluded.ultimo_pedido
        when excluded.ultimo_pedido is null then public.v2_clientes.ultimo_pedido
        else greatest(public.v2_clientes.ultimo_pedido, excluded.ultimo_pedido)
      end,
      updated_at = now()
    returning 1
  ),
  pedidos_src as (
    select
      coalesce(bling_id, numero_pedido) as pedido_id,
      max(numero_pedido) as numero_pedido,
      max(bling_id) as bling_id,
      max(numero_pedido_loja_virtual) as numero_pedido_loja_virtual,
      max(data_pedido) as data_pedido,
      max(doc_key) as cliente_doc,
      max(canal_slug) as canal_slug,
      max(situacao) as status,
      sum(preco_total_num) as sum_preco_total,
      sum(desconto_item_num) as sum_desconto_item,
      max(desconto_pedido_num) as desconto_pedido,
      max(frete_num) as frete,
      max(outras_desp_num) as outras_despesas
    from src
    where coalesce(bling_id, numero_pedido) is not null
    group by 1
  ),
  pedidos_ready as (
    select
      p.pedido_id,
      p.numero_pedido,
      p.bling_id,
      p.data_pedido,
      c.id as cliente_id,
      ch.id as canal_id,
      coalesce(p.status, 'Atendido') as status,
      greatest(0, (p.sum_preco_total - p.sum_desconto_item - coalesce(p.desconto_pedido, 0) + coalesce(p.frete, 0) + coalesce(p.outras_despesas, 0))) as total
    from pedidos_src p
    left join public.v2_clientes c on c.doc = p.cliente_doc
    left join public.v2_canais ch on ch.slug = p.canal_slug
  ),
  upsert_pedidos as (
    insert into public.v2_pedidos (id, numero_pedido, bling_id, cliente_id, canal_id, data_pedido, total, status, source)
    select
      pr.pedido_id,
      pr.numero_pedido,
      pr.bling_id,
      pr.cliente_id,
      pr.canal_id,
      pr.data_pedido,
      pr.total,
      pr.status,
      'bling_csv'
    from pedidos_ready pr
    on conflict (id) do update set
      numero_pedido = coalesce(nullif(public.v2_pedidos.numero_pedido,''), excluded.numero_pedido),
      bling_id = coalesce(nullif(public.v2_pedidos.bling_id,''), excluded.bling_id),
      cliente_id = coalesce(public.v2_pedidos.cliente_id, excluded.cliente_id),
      canal_id = coalesce(public.v2_pedidos.canal_id, excluded.canal_id),
      data_pedido = coalesce(public.v2_pedidos.data_pedido, excluded.data_pedido),
      total = case when public.v2_pedidos.total is null or public.v2_pedidos.total = 0 then excluded.total else public.v2_pedidos.total end,
      status = coalesce(nullif(public.v2_pedidos.status,''), excluded.status),
      source = coalesce(nullif(public.v2_pedidos.source,''), excluded.source)
    returning 1
  ),
  produtos_src as (
    select distinct
      case
        when nullif(produto_id_raw,'') is not null and produto_id_raw <> '0' then produto_id_raw
        when nullif(sku_raw,'') is not null then 'sku:' || sku_raw
        else null
      end as produto_id,
      max(sku_raw) as codigo,
      max(produto_nome) as nome
    from src
    group by 1
  ),
  upsert_produtos as (
    insert into public.v2_produtos (id, codigo, nome, origem, updated_at)
    select
      p.produto_id,
      nullif(p.codigo,''),
      coalesce(nullif(p.nome,''), p.produto_id),
      'bling_csv',
      now()
    from produtos_src p
    where p.produto_id is not null and p.produto_id <> ''
    on conflict (id) do update set
      codigo = coalesce(nullif(public.v2_produtos.codigo,''), excluded.codigo),
      nome = coalesce(nullif(public.v2_produtos.nome,''), excluded.nome),
      origem = coalesce(nullif(public.v2_produtos.origem,''), excluded.origem),
      updated_at = now()
    returning 1
  ),
  pedidos_alvo as (
    select distinct coalesce(bling_id, numero_pedido) as pedido_id
    from src
    where coalesce(bling_id, numero_pedido) is not null
  ),
  delete_items as (
    delete from public.v2_pedidos_items i
    using pedidos_alvo p
    where p_replace_items is true
      and i.pedido_id = p.pedido_id
    returning 1
  ),
  existing_items as (
    select i.pedido_id, count(*)::int as cnt
    from public.v2_pedidos_items i
    join pedidos_alvo p on p.pedido_id = i.pedido_id
    group by 1
  ),
  itens_insert_src as (
    select
      coalesce(s.bling_id, s.numero_pedido) as pedido_id,
      coalesce(nullif(s.produto_nome,''), nullif(s.sku_raw,''), 'Produto') as produto_nome,
      s.quantidade_num as quantidade,
      s.valor_unitario_num as valor_unitario,
      greatest(0, (s.preco_total_num - s.desconto_item_num - s.desconto_proporcional_num + s.frete_prop_num + s.outras_desp_prop_num)) as valor_total
    from src s
  ),
  insert_items as (
    insert into public.v2_pedidos_items (pedido_id, produto_nome, quantidade, valor_unitario, valor_total)
    select
      it.pedido_id,
      it.produto_nome,
      it.quantidade,
      it.valor_unitario,
      it.valor_total
    from itens_insert_src it
    left join existing_items ex on ex.pedido_id = it.pedido_id
    where p_replace_items is true or coalesce(ex.cnt, 0) = 0
    returning 1
  ),
  mark_done as (
    update public.stg_bling_csv_pedidos_itens s
    set merged_at = now(),
        merge_error = null
    where s.merge_batch_id = v_batch
      and s.merged_at is null
    returning 1
  )
  select 1;

  select count(*) into v_clients from public.v2_clientes c where c.updated_at > now() - interval '2 minutes';
  select count(*) into v_orders from public.v2_pedidos p where p.source = 'bling_csv' and p.data_pedido is not null and p.data_pedido > now()::date - 730;
  select count(*) into v_items from public.v2_pedidos_items i where i.created_at > now() - interval '2 minutes';
  select count(*) into v_products from public.v2_produtos pr where pr.origem = 'bling_csv' and pr.updated_at > now() - interval '2 minutes';

  begin
    perform public.refresh_customer_intelligence();
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'merge_batch_id', v_batch,
    'clients_touched_recent', v_clients,
    'orders_total_bling_csv', v_orders,
    'items_touched_recent', v_items,
    'products_touched_recent', v_products
  );
exception
  when others then
    update public.stg_bling_csv_pedidos_itens s
      set merge_error = left(sqlerrm, 500)
    where s.merge_batch_id = v_batch
      and s.merged_at is null;
    raise;
end;
$$;
