-- Limpeza de dados nulos em v2_clientes (Versão robusta para colunas ENUM)
-- Primeiro limpamos os campos de texto padrão
UPDATE public.v2_clientes 
SET 
  nome = COALESCE(NULLIF(TRIM(nome), ''), 'Cliente'),
  email = COALESCE(NULLIF(TRIM(email), ''), 'contato@cliente.com.br'),
  telefone = COALESCE(NULLIF(TRIM(telefone), ''), '00000000000')
WHERE nome IS NULL OR TRIM(nome) = '' OR email IS NULL OR TRIM(email) = '';

-- Para as colunas de status, usamos uma abordagem segura que converte para texto
-- antes de validar se está vazio, evitando erros de cast em tipos ENUM.
-- O bloco DO permite que a falha em um valor específico (ex: 'Novo Lead') não quebre o script.
DO $$
BEGIN
    UPDATE public.v2_clientes
    SET status = 'Novo Lead'
    WHERE (status::text IS NULL OR TRIM(status::text) = '')
      AND (nome = 'Cliente' OR email = 'contato@cliente.com.br');
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Não foi possível atualizar a coluna status. Pode ser um ENUM sem o valor Novo Lead.';
END $$;

DO $$
BEGIN
    UPDATE public.v2_clientes
    SET status_cliente = 'Novo Lead'
    WHERE (status_cliente::text IS NULL OR TRIM(status_cliente::text) = '')
      AND (nome = 'Cliente' OR email = 'contato@cliente.com.br');
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Não foi possível atualizar a coluna status_cliente.';
END $$;
