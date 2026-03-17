select
  lower(trim(nome)) as nome_normalizado,
  count(*)::int as qtd,
  array_agg(id::text order by id) as cliente_ids,
  array_agg(coalesce(doc,'') order by doc) as docs
from public.v2_clientes
where nullif(trim(nome), '') is not null
group by 1
having count(*) > 1
order by qtd desc, nome_normalizado;

select
  bling_id,
  count(*)::int as qtd,
  array_agg(id order by id) as pedido_ids
from public.v2_pedidos
where nullif(trim(bling_id), '') is not null
group by 1
having count(*) > 1
order by qtd desc, bling_id;

with stg_orders as (
  select distinct on (coalesce(nullif(trim(s.bling_id), ''), nullif(trim(s.numero_pedido), '')))
    coalesce(nullif(trim(s.bling_id), ''), nullif(trim(s.numero_pedido), '')) as pedido_id,
    nullif(trim(s.contato_id), '') as contato_id,
    nullif(trim(s.contato_nome), '') as contato_nome
  from public.stg_bling_csv_pedidos_itens s
  where nullif(trim(s.contato_id), '') is not null
    and coalesce(nullif(trim(s.bling_id), ''), nullif(trim(s.numero_pedido), '')) is not null
  order by coalesce(nullif(trim(s.bling_id), ''), nullif(trim(s.numero_pedido), '')), s.row_num desc nulls last
),
pairs as (
  select
    p.cliente_id,
    so.contato_id as bling_id,
    lower(trim(c.nome)) as nome_normalizado,
    lower(trim(so.contato_nome)) as contato_nome_normalizado
  from public.v2_pedidos p
  join stg_orders so on so.pedido_id = coalesce(nullif(trim(p.bling_id), ''), nullif(trim(p.numero_pedido), ''), (p.id)::text)
  join public.v2_clientes c on c.id = p.cliente_id
  where p.cliente_id is not null
    and so.contato_id is not null
    and so.contato_nome is not null
    and nullif(trim(c.nome), '') is not null
),
named as (
  select *
  from pairs
  where nome_normalizado = contato_nome_normalizado
    and nome_normalizado <> ''
),
agg as (
  select
    nome_normalizado,
    count(distinct cliente_id)::int as clientes_distintos,
    count(distinct bling_id)::int as bling_ids_distintos,
    array_agg(distinct cliente_id::text order by cliente_id::text) as cliente_ids,
    array_agg(distinct bling_id order by bling_id) as bling_ids
  from named
  group by 1
)
select *
from agg
where clientes_distintos > 1
   or bling_ids_distintos > 1
order by greatest(clientes_distintos, bling_ids_distintos) desc, nome_normalizado;

select
  bling_id,
  count(*)::int as qtd,
  array_agg(cliente_id::text order by cliente_id::text) as cliente_ids
from public.cliente_id_map
group by 1
having count(*) > 1
order by qtd desc, bling_id;

select
  count(*) filter (where status = 'pending')::int as pending,
  count(*) filter (where status = 'validated')::int as validated,
  count(*) filter (where status = 'rejected')::int as rejected
from public.cliente_id_map;

select *
from public.cliente_id_map
order by evidence_orders desc, created_at desc
limit 200;

update public.v2_clientes c
set bling_id = m.bling_id
from public.cliente_id_map m
where m.status = 'validated'
  and m.cliente_id = c.id
  and (c.bling_id is null or trim(c.bling_id) = '');

