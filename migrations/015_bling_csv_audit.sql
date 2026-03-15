create or replace function public.audit_bling_csv_staging(p_merge_batch_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_batch uuid := p_merge_batch_id;
  v_rows int := 0;
  v_orders int := 0;
  v_clients int := 0;
  v_products int := 0;
  v_orders_missing_key int := 0;
  v_clients_missing_key int := 0;
  v_items_missing_name int := 0;
  v_items_missing_product_ref int := 0;
  v_orders_total_mismatch int := 0;
begin
  if v_batch is null then
    raise exception 'merge_batch_id_required';
  end if;

  with src as (
    select
      s.*,
      coalesce(nullif(trim(s.bling_id), ''), nullif(trim(s.numero_pedido), '')) as pedido_id,
      public.bling_doc_key(s.cpf_cnpj, s.email, s.telefone, s.codigo_contato) as doc_key,
      public.bling_parse_date_br(s.data) as data_pedido,
      public.bling_parse_num(s.quantidade) as quantidade_num,
      public.bling_parse_num(s.valor_unitario) as valor_unitario_num,
      public.bling_parse_num(s.preco_total) as preco_total_num,
      public.bling_parse_num(s.desconto_item) as desconto_item_num,
      public.bling_parse_num(s.desconto_proporcional) as desconto_proporcional_num,
      public.bling_parse_num(s.frete_proporcional) as frete_prop_num,
      public.bling_parse_num(s.outras_despesas_proporcional) as outras_desp_prop_num,
      public.bling_parse_num(s.desconto_pedido) as desconto_pedido_num,
      public.bling_parse_num(s.frete) as frete_num,
      public.bling_parse_num(s.outras_despesas) as outras_desp_num
    from public.stg_bling_csv_pedidos_itens s
    where s.merge_batch_id = v_batch
  ),
  pedidos_calc as (
    select
      pedido_id,
      sum(preco_total_num) as sum_preco_total,
      sum(desconto_item_num) as sum_desc_item,
      max(desconto_pedido_num) as desconto_pedido,
      max(frete_num) as frete,
      max(outras_desp_num) as outras_despesas
    from src
    where pedido_id is not null and pedido_id <> ''
    group by 1
  ),
  pedidos_total_calc as (
    select
      pedido_id,
      greatest(0, (sum_preco_total - sum_desc_item - coalesce(desconto_pedido, 0) + coalesce(frete, 0) + coalesce(outras_despesas, 0))) as total_calc
    from pedidos_calc
  ),
  pedidos_db as (
    select
      p.id as pedido_id,
      coalesce(p.total, 0) as total_db
    from public.v2_pedidos p
    where p.id in (select pedido_id from pedidos_total_calc)
  ),
  pedidos_mismatch as (
    select
      c.pedido_id
    from pedidos_total_calc c
    join pedidos_db d on d.pedido_id = c.pedido_id
    where abs(coalesce(d.total_db, 0) - coalesce(c.total_calc, 0)) > 0.01
  )
  select
    (select count(*) from src),
    (select count(distinct pedido_id) from src where pedido_id is not null and pedido_id <> ''),
    (select count(distinct doc_key) from src where doc_key is not null and doc_key <> ''),
    (select count(distinct case
      when nullif(trim(produto_id), '') is not null and trim(produto_id) <> '0' then trim(produto_id)
      when nullif(trim(codigo_produto), '') is not null then 'sku:' || trim(codigo_produto)
      else null
    end) from src),
    (select count(*) from src where pedido_id is null or pedido_id = ''),
    (select count(*) from src where doc_key is null or doc_key = ''),
    (select count(*) from src where nullif(trim(produto_descricao), '') is null),
    (select count(*) from src where (nullif(trim(produto_id), '') is null or trim(produto_id) = '0') and nullif(trim(codigo_produto), '') is null),
    (select count(*) from pedidos_mismatch)
  into
    v_rows,
    v_orders,
    v_clients,
    v_products,
    v_orders_missing_key,
    v_clients_missing_key,
    v_items_missing_name,
    v_items_missing_product_ref,
    v_orders_total_mismatch;

  return jsonb_build_object(
    'ok', true,
    'merge_batch_id', v_batch,
    'rows', v_rows,
    'orders_distinct', v_orders,
    'clients_distinct', v_clients,
    'products_distinct', v_products,
    'issues', jsonb_build_object(
      'orders_missing_key', v_orders_missing_key,
      'clients_missing_key', v_clients_missing_key,
      'items_missing_name', v_items_missing_name,
      'items_missing_product_ref', v_items_missing_product_ref,
      'orders_total_mismatch_vs_db', v_orders_total_mismatch
    ),
    'tips', jsonb_build_array(
      'items_missing_product_ref > 0 indica combos/kits sem SKU/ID; normal para Bling em alguns casos',
      'orders_total_mismatch_vs_db > 0 indica que um pedido já existia e não foi sobrescrito (ou precisa --replace-items)'
    )
  );
end;
$$;
