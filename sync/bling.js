let blingAutoSyncTimer = null;

export function scheduleAutoBlingSync(ctx){
  if(blingAutoSyncTimer) clearInterval(blingAutoSyncTimer);
  blingAutoSyncTimer = setInterval(()=>{
    maybeRunAutoBlingSync(ctx).catch(()=>{});
  }, 20*60*1000);
  maybeRunAutoBlingSync(ctx).catch(()=>{});
}

export async function maybeRunAutoBlingSync(ctx){
  if(!ctx?.isSupaReady?.()) return;
  const today = new Date().toISOString().slice(0,10);
  const lastDay = String(localStorage.getItem("crm_bling_autosync_day") || "");
  if(lastDay === today) return;
  if(document.hidden) return;
  await syncBling(ctx, { silent: true, auto: true, omitDates: true });
  localStorage.setItem("crm_bling_autosync_day", today);
  try{
    const lastProdDay = String(localStorage.getItem("crm_bling_autosync_products_day") || "");
    if(lastProdDay !== today){
      await syncBlingProdutos(ctx);
      localStorage.setItem("crm_bling_autosync_products_day", today);
    }
  }catch(_e){}
}

export async function syncBling(ctx, options){
  const opts = options && typeof options === "object" ? options : {};
  const silent = opts.silent === true;
  const omitDates = opts.omitDates === true;
  const batchLimit = Math.max(1, Math.min(100, Number(opts.batchLimit ?? 50) || 50));
  const st = document.getElementById("bling-status");
  const fromEl = document.getElementById("date-from");
  const toEl = document.getElementById("date-to");
  const fmtDateBrFromIso = (iso)=>{
    const s = String(iso||"").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  };
  const parseDateToIso = (v)=>{
    const s = String(v||"").trim();
    if(!s) return "";
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(iso) return s;
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(br) return `${br[3]}-${br[2]}-${br[1]}`;
    return "";
  };
  let from = parseDateToIso(String(fromEl?.value||""));
  let to = parseDateToIso(String(toEl?.value||""));
  if((!from || !to) && !omitDates){
    try{
      if(!from){
        const d = new Date();
        d.setDate(d.getDate() - 365);
        from = d.toISOString().slice(0,10);
        if(fromEl) fromEl.value = fmtDateBrFromIso(from);
      }
      if(!to){
        to = new Date().toISOString().slice(0,10);
        if(toEl) toEl.value = fmtDateBrFromIso(to);
      }
    }catch(_e){}
  }

  try{
    let offset = 0;
    let batch = 0;
    let imported = 0;
    const out = [];

    const setStatus = (html, ok)=>{
      if(!st || silent) return;
      st.innerHTML = html;
      st.className = ok === true ? "setup-status s-ok" : ok === false ? "setup-status s-err" : "setup-status";
    };

    setStatus(
      `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><span>Iniciando importação…</span><span class="chiva-table-mono">0</span></div>`+
      `<div style="height:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:999px;overflow:hidden;margin-top:8px"><div style="height:100%;width:30%;background:linear-gradient(90deg, rgba(15,167,101,.2), rgba(164,233,107,.7), rgba(15,167,101,.2));animation:skel-shimmer 1.1s infinite"></div></div>`
    );

    let hasMore = true;
    while(hasMore){
      batch += 1;
      setStatus(
        `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><span>Processando lote ${batch}…</span><span class="chiva-table-mono">${imported}</span></div>`+
        `<div style="font-size:10px;color:var(--text-3);margin-top:6px">limit ${batchLimit} · offset ${offset}</div>`+
        `<div style="height:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:999px;overflow:hidden;margin-top:8px"><div style="height:100%;width:30%;background:linear-gradient(90deg, rgba(15,167,101,.2), rgba(164,233,107,.7), rgba(15,167,101,.2));animation:skel-shimmer 1.1s infinite"></div></div>`
      );

      const payload = omitDates ? { limit: batchLimit, offset } : { from, to, limit: batchLimit, offset };
      const resp = await fetch(ctx.getSupaFnBase()+"/bling-sync",{
        method:"POST",
        headers: await ctx.supaFnHeadersAsync(),
        body: JSON.stringify(payload)
      });

      const txt = await resp.text().catch(()=> "");
      let data = null;
      try{ data = txt ? JSON.parse(txt) : null; }catch(_e){ data = null; }
      if(!resp.ok){
        const msg = (data && (data.message || data.error)) ? String(data.message || data.error) : (txt || "Erro na função Bling");
        throw new Error(msg);
      }

      const orders = Array.isArray(data?.orders) ? data.orders : [];
      orders.forEach(o=>out.push(ctx.normalizeOrderForCRM(o,"bling")));
      imported += orders.length;

      const nextOffset = Number(data?.nextOffset);
      offset = Number.isFinite(nextOffset) ? nextOffset : (offset + orders.length);
      hasMore = data?.hasMore === true && orders.length > 0;
      if(!orders.length) hasMore = false;
      if(batch > 400) throw new Error("Importação interrompida (muitos lotes). Ajuste o período ou aumente o limit.");
    }

    ctx.blingOrders.length = 0;
    ctx.blingOrders.push(...out);
    localStorage.setItem("crm_bling_orders", JSON.stringify(ctx.blingOrders));
    ctx.mergeOrders();
    ctx.populateUFs();
    Promise.resolve(ctx.upsertOrdersToSupabase(ctx.blingOrders)).catch(e=>console.warn(e));
    ctx.renderAll();
    ctx.startTimers();
    try{ if(ctx.isSupaReady()) await ctx.sbSetConfig("ultima_sync_bling", new Date().toISOString()); }catch(e){}
    if(st){
      st.textContent = `✓ ${ctx.blingOrders.length} pedidos importados (lotes: ${batch})`;
      st.className = "setup-status s-ok";
    }
    if(!silent) ctx.toast("✓ Bling sincronizado!");
  }catch(e){
    if(st){
      st.textContent = "⚠ " + (e?.message || String(e));
      st.className = "setup-status s-err";
    }
  }
}

export async function syncBlingProdutos(ctx){
  const st = document.getElementById("bling-prod-status");
  if(st){ st.textContent="Importando produtos..."; st.className="setup-status"; }
  try{
    if(!ctx?.isSupaReady?.()) throw new Error("Conecte o Supabase primeiro.");

    const resp = await fetch(ctx.getSupaFnBase()+"/bling-products-sync",{
      method:"POST",
      headers: await ctx.supaFnHeadersAsync(),
      body: JSON.stringify({ limit: 100, maxPages: 200 })
    });

    const txt = await resp.text().catch(()=> "");
    let data = null;
    try{ data = txt ? JSON.parse(txt) : null; }catch(_e){ data = null; }
    if(!resp.ok){
      const msg = (data && (data.message || data.error)) ? String(data.message || data.error) : (txt || "Erro na função Bling (produtos)");
      throw new Error(msg);
    }

    const products = Array.isArray(data?.products) ? data.products : [];
    if(!products.length){
      if(st){ st.textContent="⚠ Nenhum produto retornado do Bling."; st.className="setup-status s-err"; }
      return;
    }

    const nowIso = new Date().toISOString();
    const rows = products.map(p=>({
      id: String(p?.id||"").trim(),
      codigo: p?.codigo ?? null,
      nome: p?.nome ?? null,
      estoque: p?.estoque ?? null,
      preco: p?.preco ?? null,
      situacao: p?.situacao ?? null,
      origem: p?.origem ?? "bling",
      updated_at: p?.updated_at ?? nowIso,
      raw: p?.raw ?? {}
    })).filter(r=>r.id);

    for(let i=0;i<rows.length;i+=200){
      const batch = rows.slice(i,i+200);
      const {error} = await ctx.getSupaClient().from("v2_produtos").upsert(batch, { onConflict: "id" });
      if(error) throw error;
    }

    ctx.blingProducts.length = 0;
    ctx.blingProducts.push(...rows.map(r=>({
      id: String(r.id||""),
      codigo: r.codigo || "",
      nome: r.nome || "",
      estoque: r.estoque == null ? null : Number(r.estoque||0) || 0,
      preco: r.preco == null ? null : Number(r.preco||0) || 0,
      situacao: r.situacao || "",
      origem: r.origem || "bling",
      updated_at: r.updated_at || null
    })).filter(p=>p.id));
    localStorage.setItem("crm_bling_products", JSON.stringify(ctx.blingProducts));

    if(document.getElementById("page-produtos")?.classList.contains("active")) ctx.renderProdutos();
    if(st){ st.textContent=`✓ ${rows.length} produtos importados`; st.className="setup-status s-ok"; }
    ctx.toast("✓ Produtos do Bling importados!");
  }catch(e){
    const msg = String(e?.message || String(e) || "");
    if(st){
      const hint =
        /relation .*v2_produtos.*does not exist|42P01/i.test(msg)
          ? " (Rode a migration 004_create_v2_produtos.sql no Supabase)"
          : "";
      st.textContent = "⚠ " + msg + hint;
      st.className = "setup-status s-err";
    }
  }
}

export async function backfillBlingEnderecos(ctx){
  const st = document.getElementById("bling-status");
  if(st){ st.textContent="Backfill: buscando período no Supabase..."; st.className="setup-status"; }
  try{
    if(!ctx?.isSupaReady?.()) throw new Error("Conecte o Supabase primeiro.");

    let from = "";
    try{
      const {data} = await ctx.getSupaClient()
        .from("v2_pedidos")
        .select("data_pedido")
        .order("data_pedido", { ascending: true })
        .limit(1);
      from = String(data?.[0]?.data_pedido || "").slice(0,10);
    }catch(_e){}

    const to = new Date().toISOString().slice(0,10);
    if(!from) from = "2020-01-01";

    if(st){ st.textContent=`Backfill: importando Bling (${from} → ${to})...`; st.className="setup-status"; }

    const resp = await fetch(ctx.getSupaFnBase()+"/bling-sync",{
      method:"POST",
      headers: await ctx.supaFnHeadersAsync(),
      body: JSON.stringify({from,to, maxPages: 200})
    });
    if(!resp.ok){
      const txt=await resp.text();
      throw new Error(txt||"Erro na função Bling");
    }
    const data=await resp.json();
    const orders = (data.orders||[]).map(o=>ctx.normalizeOrderForCRM(o,"bling"));
    if(!orders.length){
      if(st){ st.textContent="Backfill: nenhum pedido retornado."; st.className="setup-status s-err"; }
      return;
    }

    ctx.blingOrders.length = 0;
    ctx.blingOrders.push(...orders);
    localStorage.setItem("crm_bling_orders", JSON.stringify(ctx.blingOrders));

    ctx.mergeOrders();
    ctx.populateUFs();
    await ctx.upsertOrdersToSupabase(ctx.blingOrders, { silent: true });
    ctx.renderAll();

    if(st){ st.textContent=`✓ Backfill concluído: ${orders.length} pedidos`; st.className="setup-status s-ok"; }
    ctx.toast("✓ Backfill Bling concluído!");
  }catch(e){
    if(st){ st.textContent="⚠ "+(e?.message||String(e)); st.className="setup-status s-err"; }
  }
}

