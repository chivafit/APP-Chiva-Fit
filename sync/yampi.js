export async function syncYampi(ctx){
  const st = document.getElementById("yampi-status");
  if(st){ st.textContent="Sincronizando com Supabase..."; st.className="setup-status"; }
  try{
    if(!ctx?.isSupaReady?.()){
      throw new Error("Supabase não conectado. Conecte primeiro para ver os dados do Webhook.");
    }
    await ctx.loadOrdersFromSupabaseForCRM({ persistBack: true });
    await ctx.loadCarrinhosAbandonadosFromSupabase();
    if(st){
      st.textContent = "✓ Dados da Yampi atualizados do banco";
      st.className = "setup-status s-ok";
    }
    ctx.toast("✓ Yampi sincronizado!");
  }catch(e){
    if(st){ st.textContent="⚠ "+(e?.message||String(e)); st.className="setup-status s-err"; }
  }
}

export async function syncCarrinhosAbandonadosYampi(ctx){
  const st = document.getElementById("abandoned-status");
  if(st){ st.textContent="Sincronizando carrinhos..."; st.className="setup-status"; }
  try{
    const raw = await ctx.fetchYampiAbandoned();
    const next = (Array.isArray(raw) ? raw : []).map(ctx.normalizeCarrinhoAbandonado).filter(c=>c.checkout_id);
    const byId = {};
    (ctx.getCarrinhosAbandonados()||[]).forEach(c=>{ if(c && c.checkout_id) byId[String(c.checkout_id)] = c; });
    next.forEach(c=>{
      const prev = byId[c.checkout_id] || null;
      byId[c.checkout_id] = prev ? {...prev, ...c, recuperado: prev.recuperado || c.recuperado, recuperado_em: prev.recuperado_em || c.recuperado_em, recuperado_pedido_id: prev.recuperado_pedido_id || c.recuperado_pedido_id} : c;
    });
    const merged = Object.values(byId).sort((a,b)=>new Date(b.criado_em||0)-new Date(a.criado_em||0));
    ctx.setCarrinhosAbandonados(merged);
    localStorage.setItem("crm_carrinhos_abandonados", JSON.stringify(merged));
    await ctx.reconcileCarrinhosRecuperados();
    await ctx.recomputeCarrinhosScoresAndPersist();
    if(ctx?.isSupaReady?.()) await ctx.upsertCarrinhosAbandonadosToSupabase(merged);
    ctx.renderCarrinhosAbandonados();
    if(st){ st.textContent=`✓ ${merged.length} carrinhos carregados`; st.className="setup-status s-ok"; }
    ctx.toast("✓ Carrinhos abandonados sincronizados!");
  }catch(e){
    if(st){ st.textContent="⚠ "+(e?.message||String(e)); st.className="setup-status s-err"; }
  }
}
