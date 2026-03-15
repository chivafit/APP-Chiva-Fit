select public.audit_bling_csv_staging('00000000-0000-0000-0000-000000000000'::uuid);

select
  row_num,
  bling_id,
  numero_pedido,
  contato_nome,
  email,
  telefone,
  produto_descricao,
  codigo_produto,
  preco_total,
  desconto_item,
  desconto_proporcional,
  frete_proporcional,
  outras_despesas_proporcional
from public.stg_bling_csv_pedidos_itens
where merge_batch_id = '00000000-0000-0000-0000-000000000000'::uuid
  and (bling_id is null or trim(bling_id) = '')
order by row_num
limit 50;

select
  row_num,
  bling_id,
  numero_pedido,
  contato_nome,
  email,
  telefone
from public.stg_bling_csv_pedidos_itens
where merge_batch_id = '00000000-0000-0000-0000-000000000000'::uuid
  and public.bling_doc_key(cpf_cnpj, email, telefone, codigo_contato) is null
order by row_num
limit 50;

select
  row_num,
  bling_id,
  numero_pedido,
  produto_id,
  codigo_produto,
  produto_descricao
from public.stg_bling_csv_pedidos_itens
where merge_batch_id = '00000000-0000-0000-0000-000000000000'::uuid
  and (coalesce(nullif(trim(produto_id),''),'0') = '0' and nullif(trim(codigo_produto),'') is null)
order by row_num
limit 50;
