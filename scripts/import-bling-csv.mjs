import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function readArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function normalizeSupabaseUrl(url) {
  const u = String(url || "").trim().replace(/\/+$/, "");
  if (!u) return "";
  return u.startsWith("http") ? u : `https://${u}`;
}

function parseDecimalPtBr(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s
    .replace(/^R\$\s*/i, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^0-9.\-]/g, "");
}

function parseCsv(content, delimiter = ";") {
  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      field += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === delimiter) {
      cur.push(field);
      field = "";
      continue;
    }

    if (ch === "\r") continue;
    if (ch === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      continue;
    }

    field += ch;
  }

  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }

  return rows;
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text().catch(() => "");
  let json = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch (_e) {
    json = null;
  }
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) ? String(json.message || json.error) : (txt || `${res.status} ${res.statusText}`);
    throw new Error(msg);
  }
  return json;
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = readArgValue(args, "--file") || args.find((a) => !a.startsWith("--")) || "";
  if (!csvPath) throw new Error("missing --file <path>");

  const replaceItems = hasFlag(args, "--replace-items");

  const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL || process.env.CRM_SUPABASE_URL);
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl) throw new Error("missing SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("missing SUPABASE_SERVICE_ROLE_KEY");

  const abs = path.resolve(csvPath);
  const fileName = path.basename(abs);
  const content = fs.readFileSync(abs, "utf-8");

  const rows = parseCsv(content, ";");
  if (!rows.length) throw new Error("empty csv");

  const header = rows[0].map((h) => String(h || "").trim());
  const colIndex = new Map(header.map((h, i) => [h, i]));

  const map = {
    "ID": "bling_id",
    "N° do Pedido": "numero_pedido",
    "N° do Pedido na Loja Virtual": "numero_pedido_loja_virtual",
    "Data": "data",
    "ID contato": "contato_id",
    "Nome do contato": "contato_nome",
    "Cpf/Cnpj": "cpf_cnpj",
    "Endereco": "endereco",
    "Bairro": "bairro",
    "Município": "municipio",
    "Cep": "cep",
    "Estado": "estado",
    "E-mail": "email",
    "Telefone": "telefone",
    "Desconto pedido": "desconto_pedido",
    "Frete": "frete",
    "Observações": "observacoes",
    "Situação": "situacao",
    "ID produto": "produto_id",
    "Descrição": "produto_descricao",
    "Quantidade": "quantidade",
    "Valor unitário": "valor_unitario",
    "Desconto item": "desconto_item",
    "Preço de Custo": "preco_custo",
    "Preço Total": "preco_total",
    "Código do contato": "codigo_contato",
    "Código do produto": "codigo_produto",
    "Frete proporcional": "frete_proporcional",
    "Desconto proporcional": "desconto_proporcional",
    "Vendedor": "vendedor",
    "Nº da NFe": "nfe_numero",
    "Natureza da NFe": "nfe_natureza",
    "Situação da NFe": "nfe_situacao",
    "Última ocorrência": "ultima_ocorrencia",
    "Outras despesas": "outras_despesas",
    "Outras despesas proporcional": "outras_despesas_proporcional",
    "Loja virtual": "loja_virtual",
  };

  const requiredHeaders = Object.keys(map);
  const missing = requiredHeaders.filter((h) => !colIndex.has(h));
  if (missing.length) throw new Error(`missing columns: ${missing.join(", ")}`);

  const batchId = crypto.randomUUID();
  const headersAuth = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Prefer: "return=minimal",
  };

  const endpoint = `${supabaseUrl}/rest/v1/stg_bling_csv_pedidos_itens`;
  const rpc = `${supabaseUrl}/rest/v1/rpc/merge_bling_csv_staging`;

  const toRowObject = (row, rowNum) => {
    const out = {
      source_file: fileName,
      row_num: rowNum,
      merge_batch_id: batchId,
    };
    for (const [csvCol, stgCol] of Object.entries(map)) {
      const i = colIndex.get(csvCol);
      const v = i == null ? "" : String(row[i] ?? "").trim();
      if (stgCol.includes("valor") || stgCol.includes("preco") || stgCol.includes("desconto") || stgCol.includes("frete") || stgCol.includes("outras_despesas") || stgCol === "quantidade") {
        out[stgCol] = parseDecimalPtBr(v);
      } else {
        out[stgCol] = v;
      }
    }
    return out;
  };

  const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c || "").trim() !== ""));
  const batchSize = 500;
  for (let i = 0; i < dataRows.length; i += batchSize) {
    const chunk = dataRows.slice(i, i + batchSize).map((r, idx) => toRowObject(r, i + idx + 2));
    await postJson(endpoint, headersAuth, chunk);
    process.stdout.write(`inserted ${Math.min(i + batchSize, dataRows.length)}/${dataRows.length}\n`);
  }

  const mergeResult = await postJson(rpc, headersAuth, {
    p_merge_batch_id: batchId,
    p_replace_items: replaceItems,
  });

  process.stdout.write(JSON.stringify({ ok: true, batchId, mergeResult }, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(`error: ${e?.message || String(e)}\n`);
  process.exit(1);
});
