import { escapeHTML, safeJsonParse, escapeJsSingleQuote } from "./utils.js";

function toast(msg){
  if(typeof globalThis.toast === "function") globalThis.toast(msg);
}

function fecharModal(id){
  if(typeof globalThis.fecharModal === "function") globalThis.fecharModal(id);
}

function randomUUIDCompat(){
  try{
    if(globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    if(globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function"){
      const b = new Uint8Array(16);
      globalThis.crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const hex = Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("");
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    }
  }catch(_e){}
  return String(Date.now()) + String(Math.random()).slice(2);
}

function kpiCard(title, value, subtitle, color){
  if(typeof globalThis.kpiCard === "function") return globalThis.kpiCard(title, value, subtitle, color);
  return "";
}

function renderChartEstoque(){
  if(typeof globalThis.renderChartEstoque === "function") globalThis.renderChartEstoque();
}

const PRECO_KG = {
  'Castanha do Pará':      95.73,
  'Castanha de Caju':      44.60,
  'Amêndoas':              53.79,
  'Flocos de Milho':       19.75,
  'Semente de Abóbora':    20.07,
  'Semente de Girassol':   10.85,
  'Chia':                  10.75,
  'Gergelim':              12.80,
  'Linhaça Dourada':        7.56,
  'Uva Passa':             15.40,
  'Cranberry':             27.36,
  'Xilitol':               24.10,
  'Chips de Coco':        120.00,
  'Sal Himalaia':           8.15,
  'Óleo de Coco':         108.00,
  'Extrato de Baunilha':  778.00,
  'Stevia':               560.00,
  'TCM':                  131.00,
  'Quinoa em Flocos':      32.90,
  'Proteína de Ervilha':   68.90,
  'Canela':                 6.00,
};

const PRECO_KG_FALLBACK = PRECO_KG;

const RECEITAS_REAIS = {
  'Granola Cranberry 250g': { tamanho:'250g', categoria:'cranberry',
    insumos: {'Semente de Girassol':58,'Cranberry':40,'Flocos de Milho':38,'Castanha de Caju':30,'Semente de Abóbora':30,'Linhaça Dourada':20,'Chia':15,'Amêndoas':8,'Castanha do Pará':5,'Stevia':1,'Canela':1}},
  'Granola Cranberry 30g': { tamanho:'30g', categoria:'cranberry',
    insumos: {'Semente de Girassol':4,'Cranberry':4,'Flocos de Milho':8,'Castanha de Caju':3,'Semente de Abóbora':3,'Linhaça Dourada':2,'Chia':1,'Amêndoas':1,'Castanha do Pará':1,'Stevia':1,'Canela':1}},
  'Granola Tradicional 250g': { tamanho:'250g', categoria:'tradicional',
    insumos: {'Semente de Girassol':70,'Flocos de Milho':54,'Uva Passa':35,'Castanha de Caju':30,'Semente de Abóbora':30,'Linhaça Dourada':20,'Chips de Coco':5,'Stevia':1,'Canela':1}},
  'Granola Tradicional 30g': { tamanho:'30g', categoria:'tradicional',
    insumos: {'Semente de Girassol':1,'Flocos de Milho':11,'Uva Passa':5,'Castanha de Caju':2,'Semente de Abóbora':5,'Linhaça Dourada':2,'Chips de Coco':1,'Stevia':1,'Canela':1}},
  'Granola Low Carb 200g': { tamanho:'200g', categoria:'lowcarb',
    insumos: {'Semente de Girassol':35,'Semente de Abóbora':30,'Castanha de Caju':15,'Linhaça Dourada':30,'Amêndoas':45,'Chia':27,'Castanha do Pará':10,'Chips de Coco':3,'Stevia':1,'Canela':1,'Extrato de Baunilha':1}},
  'Granola Low Carb 30g': { tamanho:'30g', categoria:'lowcarb',
    insumos: {'Semente de Girassol':3,'Semente de Abóbora':4,'Castanha de Caju':2,'Linhaça Dourada':4,'Amêndoas':6,'Chia':3,'Castanha do Pará':1,'Chips de Coco':1,'Stevia':1,'Canela':1,'Extrato de Baunilha':1}},
  'Granola Energy 200g': { tamanho:'200g', categoria:'energy',
    insumos: {'Semente de Girassol':35,'Semente de Abóbora':30,'Castanha de Caju':15,'Linhaça Dourada':30,'Amêndoas':45,'Chia':27,'Castanha do Pará':10,'Chips de Coco':3,'Óleo de Coco':1,'Stevia':1,'Canela':1,'Extrato de Baunilha':1,'TCM':5}},
  'Granola Protein 200g': { tamanho:'200g', categoria:'protein',
    insumos: {'Quinoa em Flocos':32,'Proteína de Ervilha':35,'Semente de Abóbora':30,'Castanha de Caju':16,'Amêndoas':10,'Chia':10,'Linhaça Dourada':20,'Semente de Girassol':34,'Castanha do Pará':8,'Stevia':1,'Óleo de Coco':1,'Canela':1,'Sal Himalaia':1,'Extrato de Baunilha':1}},
  'Granola Protein 30g': { tamanho:'30g', categoria:'protein',
    insumos: {'Quinoa em Flocos':6,'Proteína de Ervilha':7,'Semente de Abóbora':4,'Castanha de Caju':2,'Amêndoas':1,'Chia':1,'Linhaça Dourada':2,'Semente de Girassol':2,'Castanha do Pará':1,'Stevia':1,'Óleo de Coco':1,'Canela':1,'Extrato de Baunilha':1}},
};

const CAT_EMOJI = {cranberry:'🍒',tradicional:'🌾',lowcarb:'🥜',energy:'⚡',protein:'💪'};
const CAT_COLOR = {cranberry:'#e11d48',tradicional:'#d97706',lowcarb:'#16a34a',energy:'#7c3aed',protein:'#0284c7'};

let allInsumos = safeJsonParse('crm_insumos', null) || Object.keys(PRECO_KG).map(function(nome,i){
  var base = {
    id: String(i+1),
    nome: nome,
    unidade: 'kg',
    estoque_atual: 0,
    estoque_minimo: 2,
    custo_unitario: PRECO_KG_FALLBACK[nome],
    fornecedor: '',
    lead_time_dias: 0,
    updated_at: new Date().toISOString()
  };
  base.estoque = base.estoque_atual;
  base.minimo = base.estoque_minimo;
  base.custo = base.custo_unitario;
  base.cat = 'Insumo';
  return base;
});
function migrateLegacyOrdensToProducao(){
  var legacy = safeJsonParse('crm_ordens', null) || [];
  var hasLegacy = Array.isArray(legacy) && legacy.some(function(o){ return o && Array.isArray(o.itens) && o.itens.length; });
  if(!hasLegacy) return [];
  var next = [];
  legacy.forEach(function(o){
    var st = String(o.status||'planejada');
    var status = st==='producao' ? 'em_producao' : st==='concluida' ? 'concluida' : 'planejada';
    var d = String(o.data || new Date().toISOString().slice(0,10));
    (o.itens||[]).forEach(function(it){
      if(!it || !it.produto) return;
      next.push({
        id: randomUUIDCompat(),
        lote: null,
        produto_id: String(it.produto),
        quantidade_planejada: Number(it.qty)||0,
        quantidade_produzida: 0,
        data_producao: d,
        status: status,
        observacoes: 'Migrado do simulador antigo',
        created_at: new Date().toISOString()
      });
    });
  });
  return next;
}

let allOrdens = safeJsonParse('crm_ordens_producao', null);
if(!Array.isArray(allOrdens) || !allOrdens.length){
  var migrated = migrateLegacyOrdensToProducao();
  allOrdens = Array.isArray(migrated) && migrated.length ? migrated : [];
  localStorage.setItem('crm_ordens_producao', JSON.stringify(allOrdens));
}
let allMovInsumos = safeJsonParse('crm_insumo_movs', null) || [];
let allMovimentosEstoque = safeJsonParse('crm_movimentos_estoque', null) || [];
let allReceitasProdutos = safeJsonParse('crm_receitas_produtos', null) || [];
let allProdutosReceitas = safeJsonParse('crm_receitas_produtos_produtos', null) || Object.keys(RECEITAS_REAIS);

let movFilters = { q:'', tipo:'', from:'', to:'' };

function normalizeInsumo(i){
  if(!i) return i;
  if(i.estoque_atual == null) i.estoque_atual = Number(i.estoque)||0;
  if(i.estoque_minimo == null) i.estoque_minimo = Number(i.minimo)||0;
  if(i.custo_unitario == null) i.custo_unitario = Number(i.custo)||0;
  if(i.unidade == null) i.unidade = i.un || 'kg';
  if(i.fornecedor == null) i.fornecedor = '';
  if(i.lead_time_dias == null) i.lead_time_dias = 0;
  if(i.updated_at == null) i.updated_at = new Date().toISOString();
  i.estoque = Number(i.estoque_atual)||0;
  i.minimo = Number(i.estoque_minimo)||0;
  i.custo = Number(i.custo_unitario)||0;
  return i;
}

function saveInsumos(){
  allInsumos.forEach(normalizeInsumo);
  localStorage.setItem('crm_insumos',JSON.stringify(allInsumos));
  if(typeof globalThis.syncInsumosToSupabase === "function") globalThis.syncInsumosToSupabase(allInsumos);
}
function saveOrdens(){
  localStorage.setItem('crm_ordens_producao', JSON.stringify(allOrdens));
  if(typeof globalThis.syncOrdensProducaoToSupabase === "function") globalThis.syncOrdensProducaoToSupabase(allOrdens);
}
function saveMovInsumos(){ localStorage.setItem('crm_insumo_movs', JSON.stringify(allMovInsumos)); }
function saveMovimentosEstoque(){ localStorage.setItem('crm_movimentos_estoque', JSON.stringify(allMovimentosEstoque)); }
function saveReceitasProdutos(){
  localStorage.setItem('crm_receitas_produtos', JSON.stringify(allReceitasProdutos));
  if(typeof globalThis.syncReceitasToSupabase === "function"){
    try{
      Promise.resolve(globalThis.syncReceitasToSupabase(allReceitasProdutos)).then(function(){
        renderReceitaDetalhe();
      }).catch(function(){
        toast('⚠️ Sync pendente: a receita será enviada ao Supabase quando a conexão voltar.');
        renderReceitaDetalhe();
      });
    }catch(_e){}
  }
}
function saveProdutosReceitas(){
  localStorage.setItem('crm_receitas_produtos_produtos', JSON.stringify(allProdutosReceitas));
}

function getEstStatus(i){
  normalizeInsumo(i);
  var est = Number(i.estoque_atual)||0;
  var min = Number(i.estoque_minimo)||0;
  if(est < min) return 'baixo';
  return 'ok';
}
function getEstPct(i){
  normalizeInsumo(i);
  var ref = Math.max((Number(i.estoque_minimo)||0)*1.5, 1);
  return Math.min(100, ((Number(i.estoque_atual)||0)/ref)*100);
}

function fmtBRL(v){
  var n=Number(v)||0;
  return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
}

function fmtNum(v, d){
  var n=Number(v);
  if(!isFinite(n)) n=0;
  return n.toFixed(d==null?2:d);
}

function parseISODate(s){
  if(!s) return null;
  var d=new Date(String(s));
  if(isNaN(d)) return null;
  return d;
}

function daysBetween(a,b){
  var da=(a instanceof Date)?a:parseISODate(a);
  var db=(b instanceof Date)?b:parseISODate(b);
  if(!da||!db) return null;
  var diff=(db.getTime()-da.getTime())/86400000;
  return Math.floor(diff);
}

function isOrderOpen(o){
  var st = String(o && o.status || '');
  return st === 'planejada' || st === 'em_producao';
}

function convertQty(qty, fromUnit, toUnit){
  var q = Number(qty)||0;
  var f = String(fromUnit||'').toLowerCase();
  var t = String(toUnit||'').toLowerCase();
  if(!f || !t || f===t) return q;
  if(f==='g' && t==='kg') return q/1000;
  if(f==='kg' && t==='g') return q*1000;
  return q;
}

function getRecipeLinesForProduct(produtoId){
  try{
    allReceitasProdutos = safeJsonParse('crm_receitas_produtos', null) || allReceitasProdutos || [];
  }catch(_e){}
  var pid = String(produtoId||"");
  var lines = (allReceitasProdutos||[]).filter(function(r){ return r && String(r.produto_id||"")===pid; });
  if(lines.length) return lines;
  var fallback = RECEITAS_REAIS[pid];
  if(!fallback || !fallback.insumos) return [];
  var byName = {};
  (allInsumos||[]).forEach(function(i){ normalizeInsumo(i); byName[String(i.nome||"").toLowerCase()] = i; });
  return Object.entries(fallback.insumos).map(function(e){
    var nome = String(e[0]||"");
    var g = Number(e[1]||0) || 0;
    var ins = byName[nome.toLowerCase()] || null;
    if(!ins || !ins.id) return null;
    return {
      id: null,
      produto_id: pid,
      insumo_id: String(ins.id),
      quantidade_por_unidade: g,
      unidade: 'g'
    };
  }).filter(Boolean);
}

function computeNeedsForOrderUnits(o, qtyUnits){
  var nec={};
  if(!o) return nec;
  var prod = String(o.produto_id||"");
  var units = Number(qtyUnits||0) || 0;
  if(!prod || units<=0) return nec;
  var lines = getRecipeLinesForProduct(prod);
  if(!lines.length) return nec;
  var byId = {};
  (allInsumos||[]).forEach(function(i){ normalizeInsumo(i); byId[String(i.id)] = i; });
  lines.forEach(function(l){
    var insId = String(l.insumo_id||"");
    var ins = byId[insId];
    var insUnit = (ins && ins.unidade) ? String(ins.unidade) : String(l.unidade||'g');
    var needPer = Number(l.quantidade_por_unidade||0) || 0;
    var need = needPer * units;
    var needInStockUnit = convertQty(need, l.unidade||'g', insUnit);
    nec[insId] = (nec[insId]||0) + needInStockUnit;
  });
  return nec;
}

function computeNeedsForOrder(o){
  return computeNeedsForOrderUnits(o, Number(o && o.quantidade_planejada || 0) || 0);
}

function computeNeedsForOrders(list){
  var nec={};
  (list||[]).forEach(function(o){
    var n=computeNeedsForOrder(o);
    Object.entries(n).forEach(function(e){
      nec[e[0]]=(nec[e[0]]||0)+e[1];
    });
  });
  return nec;
}

function buildInsumoIndex(){
  var idx={};
  allInsumos.forEach(function(i){
    idx[i.nome]=i;
  });
  return idx;
}

function computeProductCoverage(prod, stockByName){
  var r=RECEITAS_REAIS[prod];
  if(!r) return {max_units:0, limiting:null, limiting_units:0};
  var best=Infinity;
  var limiting=null;
  Object.entries(r.insumos).forEach(function(e){
    var nome=e[0];
    var g=e[1];
    var needKg=g/1000;
    if(!needKg) return;
    var stk=(stockByName && stockByName[nome]!=null)?stockByName[nome]:0;
    var units=Math.floor((Number(stk)||0)/needKg);
    if(units<best){
      best=units;
      limiting=nome;
    }
  });
  if(best===Infinity) best=0;
  return {max_units:best, limiting:limiting, limiting_units:best};
}

function buildAvailableStockMap(){
  var byName={};
  allInsumos.forEach(function(i){ normalizeInsumo(i); byName[String(i.id)]=Number(i.estoque_atual)||0; });
  var reserved=computeNeedsForOrders(allOrdens.filter(isOrderOpen));
  Object.entries(reserved).forEach(function(e){
    var insumoId=e[0];
    var q=e[1];
    byName[insumoId]=Math.max(0,(Number(byName[insumoId])||0)-q);
  });
  return {available:byName,reserved:reserved};
}

function listProductsByInsumo(){
  var map={};
  Object.entries(RECEITAS_REAIS).forEach(function(pe){
    var prod=pe[0];
    var r=pe[1];
    Object.keys(r.insumos||{}).forEach(function(nome){
      if(!map[nome]) map[nome]=[];
      map[nome].push(prod);
    });
  });
  return map;
}

function computeConsumptionRateKgPerDay(){
  var now=new Date();
  var cutoff=new Date(now.getTime()-30*86400000);
  var done=allOrdens.filter(function(o){
    if(!o || o.status!=='concluida') return false;
    var d=parseISODate(o.data);
    if(!d) return false;
    return d.getTime()>=cutoff.getTime();
  });
  if(!done.length) return null;
  var dates=done.map(function(o){return parseISODate(o.data);}).filter(Boolean).sort(function(a,b){return a-b;});
  var span=Math.max(1, Math.min(30, daysBetween(dates[0], dates[dates.length-1])||1));
  var nec=computeNeedsForOrders(done);
  var rate={};
  Object.entries(nec).forEach(function(e){
    rate[e[0]]=e[1]/span;
  });
  return rate;
}

function computeInsumoOperationalTable(){
  var idx=buildInsumoIndex();
  var stock=buildAvailableStockMap();
  var rate=computeConsumptionRateKgPerDay();
  var byInsumoToProducts=listProductsByInsumo();
  return allInsumos.map(function(i){
    var nome=i.nome;
    var estoque=Number(i.estoque)||0;
    var reservado=Number(stock.reserved[nome])||0;
    var disponivel=Math.max(0, estoque-reservado);
    var faltaOP=Math.max(0, reservado-estoque);
    var alvo=(Number(i.minimo)||0)+reservado;
    var comprar=Math.max(0, alvo-estoque);
    var status=getEstStatus(i);
    var diasCobertura=null;
    if(rate && rate[nome]!=null && rate[nome]>0){
      diasCobertura=Math.floor(disponivel/rate[nome]);
    }
    var previsao=parseISODate(i.previsao);
    var diasAtePrevisao=previsao?Math.max(0, daysBetween(new Date(), previsao)):null;
    var impactoProdutos=(byInsumoToProducts[nome]||[]).length;
    var severity=(status==='zerado'?100:status==='critico'?80:status==='baixo'?55:15) + (faltaOP>0?40:0) + (comprar>0 && status!=='ok'?15:0);
    if(diasCobertura!=null){
      if(diasCobertura<=3) severity+=40;
      else if(diasCobertura<=7) severity+=25;
      else if(diasCobertura<=14) severity+=12;
    }else if(faltaOP>0){
      severity+=25;
    }
    return {
      insumo:i,
      nome:nome,
      status:status,
      estoque:estoque,
      reservado:reservado,
      disponivel:disponivel,
      falta_op:faltaOP,
      comprar:comprar,
      dias_cobertura:diasCobertura,
      dias_previsao:diasAtePrevisao,
      previsao_str:i.previsao||'',
      valor_estoque:estoque*(Number(i.custo)||0),
      impacto_produtos:impactoProdutos,
      severity:severity
    };
  }).sort(function(a,b){return b.severity-a.severity;});
}

function renderProdKpis(){
  var el=document.getElementById('prod-kpis'); if(!el) return;
  var ok=allInsumos.filter(function(i){return getEstStatus(i)==='ok';}).length;
  var atencao=allInsumos.filter(function(i){return getEstStatus(i)==='baixo';}).length;
  var valorTotal=allInsumos.reduce(function(s,i){return s+(i.estoque||0)*i.custo;},0);
  var ordsAtivas=allOrdens.filter(function(o){return String(o.status||'')==='em_producao';}).length;
  var open=allOrdens.filter(isOrderOpen);
  var nec=computeNeedsForOrders(open);
  var idxById={};
  allInsumos.forEach(function(i){ normalizeInsumo(i); idxById[String(i.id)] = i; });
  var faltaCusto=Object.entries(nec).reduce(function(s,e){
    var insId=e[0],need=Number(e[1]||0)||0;
    var ins=idxById[String(insId)];
    var disp=ins?(Number(ins.estoque_atual)||0):0;
    var falta=Math.max(0, need-disp);
    var unitCost=Number((ins && ins.custo_unitario)||0)||0;
    return s + falta*unitCost;
  },0);
  var stock=buildAvailableStockMap();
  var products=[].concat(allProdutosReceitas||[]);
  (allReceitasProdutos||[]).forEach(function(rp){
    var p=String(rp && rp.produto_id || '').trim();
    if(p && products.indexOf(p)<0) products.push(p);
  });
  var blockedProducts=products.filter(function(p){
    var lines=getRecipeLinesForProduct(p);
    if(!lines.length) return false;
    var best=Infinity;
    lines.forEach(function(l){
      var ins=idxById[String(l.insumo_id||"")];
      var insUnit=(ins && ins.unidade) ? String(ins.unidade) : String(l.unidade||'g');
      var need=convertQty(Number(l.quantidade_por_unidade||0)||0, l.unidade||'g', insUnit);
      if(!need || need<=0){ best = 0; return; }
      var avail=Number(stock.available[String(l.insumo_id||"")]||0)||0;
      var units=Math.floor(avail/need);
      if(units<best) best=units;
    });
    if(best===Infinity) best=0;
    return best<=0;
  }).length;
  el.innerHTML=
    kpiCard('Insumos',allInsumos.length,'cadastrados','var(--text)')+
    kpiCard('Baixo estoque',atencao,atencao>0?'repor estoque':'tudo ok',atencao>0?'var(--red)':'var(--green)')+
    kpiCard('Falta p/ OPs',fmtBRL(faltaCusto),open.length?'ordens abertas':'—','var(--red)')+
    kpiCard('Valor em Estoque',fmtBRL(valorTotal),'custo total','var(--indigo-hi)')+
    kpiCard('Ordens Ativas',ordsAtivas,'em produção','var(--amber)')+
    kpiCard('Produtos bloqueados',blockedProducts,'cobertura = 0','var(--text)');
}

function renderInsumos(){
  var el=document.getElementById('insumos-list'); if(!el) return;
  var q=((document.getElementById('search-insumo')||{}).value||'').toLowerCase();
  var sf=(document.getElementById('fil-insumo-status')||{}).value||'';
  renderChartEstoque();
  var list=[].concat(allInsumos).map(normalizeInsumo);
  list = list.filter(function(i){
    if(q && !String(i.nome||'').toLowerCase().includes(q)) return false;
    var st=getEstStatus(i);
    if(sf && st!==sf) return false;
    return true;
  }).sort(function(a,b){ return String(a.nome||"").localeCompare(String(b.nome||"")); });

  if(!list.length){el.innerHTML='<div class="empty">Nenhum insumo encontrado</div>';return;}

  el.innerHTML =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:12px">'+
      '<table class="chiva-table">'+
        '<thead><tr>'+
          '<th>Insumo</th>'+
          '<th style="text-align:right">Estoque atual</th>'+
          '<th style="text-align:right">Mínimo</th>'+
          '<th style="text-align:right">Custo</th>'+
          '<th>Status</th>'+
          '<th></th>'+
        '</tr></thead>'+
        '<tbody>'+
          list.map(function(i){
            var est=fmtNum(i.estoque_atual,2)+' '+escapeHTML(i.unidade||'');
            var min=fmtNum(i.estoque_minimo,2)+' '+escapeHTML(i.unidade||'');
            var custo=fmtBRL(i.custo_unitario||0);
            var st=getEstStatus(i);
            var badge = st==='baixo'
              ? '<span class="chiva-badge chiva-badge-red">baixo</span>'
              : '<span class="chiva-badge chiva-badge-green">ok</span>';
            var rowClass = st==='baixo' ? 'insumo-row-low' : '';
            var safeId = escapeJsSingleQuote(String(i.id||""));
            return '<tr class="'+rowClass+'">'+
              '<td><span style="font-weight:800;color:var(--text)">'+escapeHTML(i.nome||'—')+'</span></td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(est)+'</td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(min)+'</td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(custo)+'</td>'+
              '<td>'+badge+'</td>'+
              '<td style="text-align:right;white-space:nowrap">'+
                '<button class="opp-mini-btn" onclick="abrirModalEntradaInsumo(\''+safeId+'\')">Entrada</button> '+
                '<button class="opp-mini-btn" onclick="abrirModalInsumo(\''+safeId+'\')">Editar</button>'+
              '</td>'+
            '</tr>';
          }).join('')+
        '</tbody>'+
      '</table>'+
    '</div>';
}

function renderOrdens(){
  var el=document.getElementById('ordens-prod-list'); if(!el) return;
  var q=((document.getElementById('search-ordem')||{}).value||'').toLowerCase();
  var sf=(document.getElementById('fil-ordem-status')||{}).value||'';
  var stLabel={planejada:'Planejada',em_producao:'Em produção',concluida:'Concluída'};
  var stBadge=function(st){
    var s=String(st||'planejada');
    if(s==='concluida') return '<span class="chiva-badge chiva-badge-green">concluída</span>';
    if(s==='em_producao') return '<span class="chiva-badge chiva-badge-amber">em produção</span>';
    return '<span class="chiva-badge chiva-badge-blue">planejada</span>';
  };

  var list=[].concat(allOrdens||[]).map(function(o){
    var obj=o||{};
    obj.lote = obj.lote || '';
    obj.produto_id = obj.produto_id || '';
    obj.quantidade_planejada = Number(obj.quantidade_planejada||0)||0;
    obj.quantidade_produzida = Number(obj.quantidade_produzida||0)||0;
    obj.custo_total_lote = obj.custo_total_lote == null ? null : (Number(obj.custo_total_lote||0) || 0);
    obj.data_producao = obj.data_producao || '';
    obj.status = obj.status || 'planejada';
    return obj;
  }).sort(function(a,b){
    var ad = a.data_producao ? new Date(a.data_producao).getTime() : 0;
    var bd = b.data_producao ? new Date(b.data_producao).getTime() : 0;
    return bd-ad;
  }).filter(function(o){
    if(q){
      var hit = String(o.lote||'').toLowerCase().includes(q) || String(o.produto_id||'').toLowerCase().includes(q);
      if(!hit) return false;
    }
    if(sf && String(o.status||'')!==sf) return false;
    return true;
  });

  var toolbar=
    '<div class="prod-ordem-toolbar">'+
      '<input id="search-ordem" class="filter-inp" placeholder="🔍 Buscar por lote/produto..." value="'+escapeHTML(q)+'" oninput="renderOrdens()" style="flex:1;min-width:180px"/>'+
      '<select id="fil-ordem-status" class="filter-sel" onchange="renderOrdens()">'+
        '<option value="">Todos status</option>'+
        '<option value="planejada" '+(sf==='planejada'?'selected':'')+'>Planejada</option>'+
        '<option value="em_producao" '+(sf==='em_producao'?'selected':'')+'>Em produção</option>'+
        '<option value="concluida" '+(sf==='concluida'?'selected':'')+'>Concluída</option>'+
      '</select>'+
    '</div>';

  if(!list.length){
    el.innerHTML = toolbar + '<div class="empty" style="padding:40px 0">Nenhuma ordem de produção.</div>';
    return;
  }

  el.innerHTML =
    toolbar +
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:12px">'+
      '<table class="chiva-table">'+
        '<thead><tr>'+
          '<th>Lote</th>'+
          '<th>Produto</th>'+
          '<th style="text-align:right">Planejada</th>'+
          '<th style="text-align:right">Produzida</th>'+
          '<th style="text-align:right">Custo lote</th>'+
          '<th>Data</th>'+
          '<th>Status</th>'+
          '<th></th>'+
        '</tr></thead>'+
        '<tbody>'+
          list.map(function(o){
            var safeId = escapeJsSingleQuote(String(o.id||""));
            var canStart = String(o.status||'')==='planejada';
            var canFinish = String(o.status||'')!=='concluida';
            var custo = (o.custo_total_lote != null && Number(o.custo_total_lote||0)>0) ? fmtBRL(Number(o.custo_total_lote||0)||0) : '—';
            return '<tr>'+
              '<td class="chiva-table-mono">'+escapeHTML(o.lote||'—')+'</td>'+
              '<td><span style="font-weight:800;color:var(--text)">'+escapeHTML(o.produto_id||'—')+'</span></td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(fmtNum(o.quantidade_planejada,2))+'</td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(fmtNum(o.quantidade_produzida,2))+'</td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(custo)+'</td>'+
              '<td>'+escapeHTML(o.data_producao||'—')+'</td>'+
              '<td>'+stBadge(o.status)+'</td>'+
              '<td style="text-align:right;white-space:nowrap">'+
                (canStart?('<button class="opp-mini-btn" onclick="setOrdemStatusQuick(\''+safeId+'\',\'em_producao\')">Iniciar</button> '):'')+
                (canFinish?('<button class="opp-mini-btn" onclick="marcarOrdemConcluida(\''+safeId+'\')">Concluir</button> '):'')+
                '<button class="opp-mini-btn" onclick="abrirModalPedidoProd(\''+safeId+'\')">Editar</button>'+
              '</td>'+
            '</tr>';
          }).join('')+
        '</tbody>'+
      '</table>'+
    '</div>';
}

function renderMovimentosEstoque(){
  var el=document.getElementById('movimentos-estoque-list'); if(!el) return;
  try{
    allMovimentosEstoque = safeJsonParse('crm_movimentos_estoque', null) || allMovimentosEstoque || [];
  }catch(_e){}
  var qEl=document.getElementById('mov-search');
  var tEl=document.getElementById('mov-tipo');
  var dfEl=document.getElementById('mov-date-from');
  var dtEl=document.getElementById('mov-date-to');
  var q = (qEl ? qEl.value : movFilters.q) || '';
  var tf = (tEl ? tEl.value : movFilters.tipo) || '';
  var df = (dfEl ? dfEl.value : movFilters.from) || '';
  var dt = (dtEl ? dtEl.value : movFilters.to) || '';
  movFilters.q = String(q||'');
  movFilters.tipo = String(tf||'');
  movFilters.from = String(df||'');
  movFilters.to = String(dt||'');
  q = String(q||'').toLowerCase();

  var idx={};
  allInsumos.forEach(function(i){ normalizeInsumo(i); idx[String(i.id)] = i; });

  var list=[].concat(allMovimentosEstoque||[]).map(function(m){
    var created = String(m.created_at||'');
    var date = created ? created.slice(0,10) : '';
    var meta = (m.metadata && typeof m.metadata==='object') ? m.metadata : {};
    var ins = idx[String(m.insumo_id||'')] || null;
    return {
      id: String(m.id||''),
      tipo: String(m.tipo||''),
      data: date,
      insumo_id: String(m.insumo_id||''),
      insumo_nome: ins ? String(ins.nome||'') : String(m.insumo_id||''),
      unidade: String(m.unidade || (ins ? ins.unidade : '') || ''),
      quantidade: Number(m.quantidade||0)||0,
      ordem_id: m.ordem_id ? String(m.ordem_id) : '',
      lote: m.lote || meta.lote || '',
      produto_id: m.produto_id || meta.produto_id || '',
      solicitado: Number(meta.solicitado||0)||0,
      consumido: Number(meta.consumido||0)||0,
      falta: Number(meta.falta||0)||0
    };
  }).filter(function(m){
    if(tf && m.tipo!==tf) return false;
    if(df && m.data && m.data < df) return false;
    if(dt && m.data && m.data > dt) return false;
    if(q){
      var hit = String(m.lote||'').toLowerCase().includes(q) ||
        String(m.produto_id||'').toLowerCase().includes(q) ||
        String(m.insumo_nome||'').toLowerCase().includes(q);
      if(!hit) return false;
    }
    return true;
  }).sort(function(a,b){
    return String(b.data||'').localeCompare(String(a.data||''));
  });

  var tipos = Array.from(new Set((allMovimentosEstoque||[]).map(function(m){ return String(m && m.tipo || '').trim(); }).filter(Boolean))).sort(function(a,b){return a.localeCompare(b);});
  var tipoOpts = '<option value="">Todos tipos</option>' + tipos.map(function(t){ return '<option value="'+escapeHTML(t)+'" '+(tf===t?'selected':'')+'>'+escapeHTML(t)+'</option>'; }).join('');

  var toolbar=
    '<div class="prod-ordem-toolbar">'+
      '<input id="mov-search" class="filter-inp" placeholder="🔍 Lote, produto, insumo..." value="'+escapeHTML(movFilters.q||'')+'" oninput="renderMovimentosEstoque()" style="flex:1;min-width:180px"/>'+
      '<select id="mov-tipo" class="filter-sel" onchange="renderMovimentosEstoque()">'+tipoOpts+'</select>'+
      '<input id="mov-date-from" class="filter-inp" type="date" value="'+escapeHTML(movFilters.from||'')+'" onchange="renderMovimentosEstoque()" style="min-width:140px"/>'+
      '<input id="mov-date-to" class="filter-inp" type="date" value="'+escapeHTML(movFilters.to||'')+'" onchange="renderMovimentosEstoque()" style="min-width:140px"/>'+
    '</div>';

  if(!list.length){
    el.innerHTML = toolbar + '<div class="empty" style="padding:40px 0">Nenhuma movimentação encontrada.</div>';
    return;
  }

  el.innerHTML =
    toolbar +
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:12px">'+
      '<table class="chiva-table">'+
        '<thead><tr>'+
          '<th>Data</th>'+
          '<th>Tipo</th>'+
          '<th>Lote</th>'+
          '<th>Produto</th>'+
          '<th>Insumo</th>'+
          '<th style="text-align:right">Qtd</th>'+
          '<th style="text-align:right">Solicitado</th>'+
          '<th style="text-align:right">Consumido</th>'+
          '<th style="text-align:right">Falta</th>'+
        '</tr></thead>'+
        '<tbody>'+
          list.map(function(m){
            return '<tr>'+
              '<td class="chiva-table-mono">'+escapeHTML(m.data||'—')+'</td>'+
              '<td>'+escapeHTML(m.tipo||'—')+'</td>'+
              '<td class="chiva-table-mono">'+escapeHTML(m.lote||'—')+'</td>'+
              '<td>'+escapeHTML(m.produto_id||'—')+'</td>'+
              '<td><span style="font-weight:800;color:var(--text)">'+escapeHTML(m.insumo_nome||'—')+'</span></td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(fmtNum(m.quantidade,3)+' '+(m.unidade||''))+'</td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(m.solicitado?fmtNum(m.solicitado,3):'—')+'</td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(m.consumido?fmtNum(m.consumido,3):'—')+'</td>'+
              '<td style="text-align:right" class="chiva-table-mono">'+escapeHTML(m.falta?fmtNum(m.falta,3):'—')+'</td>'+
            '</tr>';
          }).join('')+
        '</tbody>'+
      '</table>'+
    '</div>';
}

function renderSimuladorInputs(){
  var el=document.getElementById('sim-produtos-inputs'); if(!el) return;
  el.innerHTML=Object.keys(RECEITAS_REAIS).map(function(prod){
    var r=RECEITAS_REAIS[prod];
    var cor=CAT_COLOR[r.categoria]||'#6bbf3a';
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r-md);padding:var(--sp-3)">'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'+
        '<span style="font-size:16px">'+CAT_EMOJI[r.categoria]+'</span>'+
        '<div style="font-size:11px;font-weight:700;color:'+cor+'">'+prod+'</div>'+
      '</div>'+
      `<input type="number" min="0" value="0" id="sim-qty-${prod.replace(/[\s/]/g,"_")}" style="width:100%;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-md);padding:7px 10px;color:var(--text);font-size:16px;font-family:var(--mono);font-weight:800;outline:none;text-align:center" placeholder="0" oninput="this.style.borderColor=this.value>0?'${cor}':'var(--border)'" >`+
      '<div style="font-size:9px;color:var(--text-3);margin-top:4px;text-align:center">unidades</div>'+
    '</div>';
  }).join('');
}

function calcularSimulador(){
  var pedido={};
  Object.keys(RECEITAS_REAIS).forEach(function(prod){
    var id='sim-qty-'+prod.replace(/[\s/]/g,'_');
    var el=document.getElementById(id);
    var qty=el?parseInt(el.value)||0:0;
    if(qty>0) pedido[prod]=qty;
  });
  if(!Object.keys(pedido).length){document.getElementById('sim-resultado').innerHTML='<div class="empty">Informe ao menos uma quantidade.</div>';return;}
  var nec={};
  Object.entries(pedido).forEach(function(pe){
    var r=RECEITAS_REAIS[pe[0]]; if(!r)return;
    Object.entries(r.insumos).forEach(function(ie){nec[ie[0]]=(nec[ie[0]]||0)+(ie[1]*pe[1]/1000);});
  });
  var totalFalta=0, totalTudo=0;
  var rows=Object.entries(nec).sort(function(a,b){return b[1]-a[1];}).map(function(e){
    var nome=e[0],nKg=e[1];
    var ins=allInsumos.find(function(i){return i.nome===nome;});
    var disp=ins?(ins.estoque||0):0;
    var falta=Math.max(0,nKg-disp);
    var unitCost = ins && ins.custo_unitario != null ? (Number(ins.custo_unitario)||0) : (PRECO_KG_FALLBACK[nome]||0);
    var cf=falta*unitCost;
    var ct=nKg*unitCost;
    totalFalta+=cf; totalTudo+=ct;
    var ok=falta<0.001;
    return '<div style="display:grid;grid-template-columns:1.5fr 75px 75px 75px 95px 90px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-sub)">'+
      '<span style="font-size:11px;font-weight:600">'+nome+'</span>'+
      '<span style="text-align:right;font-size:11px;font-family:var(--mono);color:var(--text-2)">'+nKg.toFixed(3)+' kg</span>'+
      '<span style="text-align:right;font-size:11px;font-family:var(--mono);color:'+(disp>0?'var(--text)':'var(--red)')+'">'+disp.toFixed(3)+' kg</span>'+
      '<span style="text-align:right;font-size:11px;font-family:var(--mono);font-weight:700;color:'+(ok?'var(--green)':'var(--red)')+'">'+(!ok?falta.toFixed(3)+' kg':'—')+'</span>'+
      '<span style="text-align:right;font-size:11px;font-weight:700;color:'+(ok?'var(--text-3)':'var(--red)')+'">'+(!ok?'R$'+cf.toFixed(2):'R$0')+'</span>'+
      '<span style="text-align:right"><span style="padding:2px 8px;border-radius:9999px;font-size:9px;font-weight:800;background:'+(ok?'var(--green-bg)':'var(--red-bg)')+';color:'+(ok?'var(--green)':'var(--red)')+'">'+  (ok?'OK':'Comprar')+'</span></span>'+
    '</div>';
  });
  var resumo=Object.entries(pedido).map(function(pe){var r=RECEITAS_REAIS[pe[0]];return '<span style="padding:4px 10px;border-radius:9999px;font-size:10px;font-weight:700;background:'+CAT_COLOR[r.categoria]+'20;color:'+CAT_COLOR[r.categoria]+';border:1px solid '+CAT_COLOR[r.categoria]+'40">'+pe[1]+'x '+pe[0]+'</span>';}).join(' ');
  document.getElementById('sim-resultado').innerHTML=
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden">'+
      '<div style="padding:16px;background:var(--card);border-bottom:1px solid var(--border)">'+
        '<div style="font-size:12px;font-weight:800;margin-bottom:8px">Resultado da Simulacao</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">'+resumo+'</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'+
          '<div style="background:var(--bg);border-radius:var(--r-md);padding:12px;text-align:center">'+
            '<div style="font-size:9px;font-weight:800;color:var(--text-3);text-transform:uppercase;margin-bottom:4px">Custo Total Insumos</div>'+
            '<div style="font-size:22px;font-weight:800;font-family:var(--mono);color:var(--indigo-hi)">R$'+totalTudo.toFixed(2)+'</div>'+
          '</div>'+
          '<div style="background:var(--bg);border-radius:var(--r-md);padding:12px;text-align:center">'+
            '<div style="font-size:9px;font-weight:800;color:var(--text-3);text-transform:uppercase;margin-bottom:4px">Precisa Comprar</div>'+
            '<div style="font-size:22px;font-weight:800;font-family:var(--mono);color:'+(totalFalta>0?'var(--red)':'var(--green)')+'">'+  (totalFalta>0?'R$'+totalFalta.toFixed(2):'OK')+'</div>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div style="padding:0 16px 8px">'+
        '<div style="display:grid;grid-template-columns:1.5fr 75px 75px 75px 95px 90px;gap:8px;padding:10px 0;font-size:9px;font-weight:800;color:var(--text-3);text-transform:uppercase;border-bottom:1px solid var(--border)">'+
          '<span>Insumo</span><span style="text-align:right">Precisa</span><span style="text-align:right">Em Estoque</span><span style="text-align:right">Falta</span><span style="text-align:right">Custo Falta</span><span style="text-align:right">Status</span>'+
        '</div>'+
        rows.join('')+
      '</div>'+
      (totalFalta>0?
        '<div style="padding:12px 16px;background:rgba(248,113,113,.06);border-top:1px solid rgba(248,113,113,.2);font-size:12px;font-weight:700;color:var(--red)">Atualize os estoques apos realizar as compras.</div>':
        '<div style="padding:12px 16px;background:rgba(34,197,94,.06);border-top:1px solid rgba(34,197,94,.2);font-size:12px;font-weight:700;color:var(--green)">Estoque suficiente! Pode produzir tudo.</div>')+
    '</div>'+
    '<button onclick="salvarOrdemDeSimulacao()" style="margin-top:12px;width:100%;background:#5a9e30;border:none;border-radius:var(--r-md);padding:11px;color:#fff;font-size:12px;font-weight:800;cursor:pointer;font-family:var(--font)">Criar Ordem de Producao</button>';
  window._ultimaSimulacao={pedido:pedido,custo_total:totalTudo};
}

function salvarOrdemDeSimulacao(){
  if(!window._ultimaSimulacao)return;
  var itens=Object.entries(window._ultimaSimulacao.pedido).map(function(e){return{produto:e[0],qty:e[1]};});
  var today=new Date().toISOString().slice(0,10);
  itens.forEach(function(it){
    var qp = Number(it.qty)||0;
    if(qp<=0) return;
    var newId = randomUUIDCompat();
    allOrdens.unshift({
      id: newId,
      lote: generateLote(today),
      produto_id: String(it.produto),
      quantidade_planejada: qp,
      quantidade_produzida: 0,
      data_producao: today,
      status: 'planejada',
      observacoes: 'Criada pelo simulador',
      created_at: new Date().toISOString()
    });
  });
  saveOrdens();
  toast('OP(s) criada(s)!');
  setProdTab('ordens');
}

function renderReceitaDetalhe(){
  var sel=document.getElementById('sel-receita-produto');
  var el=document.getElementById('receita-detalhe');
  if(!sel||!el)return;
  try{
    var rpLS = safeJsonParse('crm_receitas_produtos', null);
    if(Array.isArray(rpLS)) allReceitasProdutos = rpLS;
    var prLS = safeJsonParse('crm_receitas_produtos_produtos', null);
    if(Array.isArray(prLS) && prLS.length) allProdutosReceitas = prLS;
  }catch(_e){}

  var products=[].concat(allProdutosReceitas||[]);
  Object.keys(RECEITAS_REAIS||{}).forEach(function(p){
    if(p && products.indexOf(p)<0) products.push(p);
  });
  allReceitasProdutos.forEach(function(rp){
    if(rp && rp.produto_id && products.indexOf(rp.produto_id)<0) products.push(rp.produto_id);
  });
  products = products.filter(Boolean).sort(function(a,b){ return String(a).localeCompare(String(b)); });

  var prev=sel.value;
  sel.innerHTML='<option value="">Selecione...</option>'+products.map(function(p){
    return '<option value="'+escapeHTML(p)+'">'+escapeHTML(p)+'</option>';
  }).join('');
  if(prev && products.indexOf(prev)>=0) sel.value=prev;

  var prod=sel.value;
  console.log('produto selecionado:', prod);
  console.log('receitas carregadas:', Array.isArray(allReceitasProdutos) ? allReceitasProdutos.length : 0);
  console.log('produtos no select:', products.length);
  if(!prod){el.innerHTML='<div class="empty">Selecione um produto para ver a ficha técnica.</div>';return;}

  var insumosSorted=[].concat(allInsumos).map(normalizeInsumo).slice().sort(function(a,b){
    return String(a.nome||"").localeCompare(String(b.nome||""));
  });
  if(!insumosSorted.length){
    el.innerHTML='<div class="empty">Cadastre insumos primeiro para montar a receita.</div>';
    return;
  }

  var hasSaved = (allReceitasProdutos||[]).some(function(rp){ return rp && String(rp.produto_id||"")===String(prod); });
  if(!hasSaved){
    var seeded = getRecipeLinesForProduct(prod);
    if(seeded && seeded.length){
      seeded.forEach(function(l){
        if(!l) return;
        allReceitasProdutos.push({
          id: randomUUIDCompat(),
          produto_id: String(prod),
          insumo_id: String(l.insumo_id||""),
          quantidade_por_unidade: Number(l.quantidade_por_unidade||0) || 0,
          unidade: String(l.unidade||"g")
        });
      });
      saveReceitasProdutos();
    }
  }

  var rows = (allReceitasProdutos||[])
    .filter(function(rp){ return rp && String(rp.produto_id||"")===String(prod); })
    .slice();
  if(rows.length){
    var byInsumo = {};
    rows.forEach(function(rp){
      var k = String(rp.insumo_id||"").trim();
      if(!k) return;
      if(!byInsumo[k]){ byInsumo[k] = rp; return; }
      var a = byInsumo[k];
      var ad = String(a.updated_at||"");
      var bd = String(rp.updated_at||"");
      if(bd && (!ad || bd > ad)) byInsumo[k] = rp;
    });
    rows = Object.values(byInsumo);
  }

  var idxInsumoById={};
  insumosSorted.forEach(function(i){ idxInsumoById[String(i.id)] = i; });
  rows.forEach(function(rp){
    var ins=idxInsumoById[String(rp.insumo_id||"")];
    rp.insumo_nome = ins ? ins.nome : "";
  });
  console.log('receita encontrada:', rows.length);
  rows.sort(function(a,b){
    var an = String(a.insumo_nome||"");
    var bn = String(b.insumo_nome||"");
    return an.localeCompare(bn);
  });

  var table =
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:14px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">'+
        '<div style="font-size:12px;font-weight:900">Ficha técnica</div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'+
          '<button class="btn" onclick="adicionarIngredienteReceita()" style="padding:8px 12px;font-size:11px">+ Ingrediente</button>'+
          '<button class="btn-primary" onclick="salvarReceitaProduto()" style="padding:8px 12px;font-size:11px">Salvar</button>'+
        '</div>'+
      '</div>'+
      '<table class="chiva-table">'+
        '<thead><tr>'+
          '<th>Insumo</th>'+
          '<th style="text-align:right">Qtd por unidade</th>'+
          '<th>Unidade</th>'+
          '<th></th>'+
        '</tr></thead>'+
        '<tbody>'+
          (rows.length ? rows.map(function(rp){
            var rid=String(rp.id||"");
            var selOps = insumosSorted.map(function(ins){
              var sid=String(ins.id);
              var isSel = String(rp.insumo_id||"")===sid ? ' selected' : '';
              return '<option value="'+escapeHTML(sid)+'"'+isSel+'>'+escapeHTML(ins.nome||sid)+'</option>';
            }).join('');
            var unit = String(rp.unidade||'g');
            var qty = rp.quantidade_por_unidade==null ? '' : String(rp.quantidade_por_unidade);
            return '<tr data-rp-id="'+escapeHTML(rid)+'">'+
              '<td><select class="chiva-select" style="width:100%" data-f="insumo">'+selOps+'</select></td>'+
              '<td style="text-align:right"><input class="chiva-input" data-f="qty" type="number" step="0.01" style="max-width:160px;display:inline-block" value="'+escapeHTML(qty)+'"/></td>'+
              '<td><select class="chiva-select" data-f="unit">'+
                '<option value="g"'+(unit==='g'?' selected':'')+'>g</option>'+
                '<option value="kg"'+(unit==='kg'?' selected':'')+'>kg</option>'+
                '<option value="unidade"'+(unit==='unidade'?' selected':'')+'>unidade</option>'+
              '</select></td>'+
              '<td style="text-align:right"><button class="opp-mini-btn" onclick="removerIngredienteReceita(\''+escapeJsSingleQuote(rid)+'\')">Remover</button></td>'+
            '</tr>';
          }).join('') : '<tr><td colspan="4" style="color:var(--text-3)">Nenhum ingrediente ainda. Clique em “+ Ingrediente”.</td></tr>')+
        '</tbody>'+
      '</table>'+
    '</div>';

  el.innerHTML = table;
}

function novoProdutoReceita(){
  var name = prompt('Nome do produto:','');
  if(name===null) return;
  var prod = String(name||'').trim();
  if(!prod){ toast('Informe o nome'); return; }
  if(!Array.isArray(allProdutosReceitas)) allProdutosReceitas = [];
  if(allProdutosReceitas.indexOf(prod)<0) allProdutosReceitas.push(prod);
  saveProdutosReceitas();
  var sel=document.getElementById('sel-receita-produto');
  if(sel) sel.value=prod;
  renderReceitaDetalhe();
}

function isUuidLike(v){
  var s = String(v||"").trim();
  if(!s) return false;
  if(/^[0-9a-f]{32}$/i.test(s)) return true;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function adicionarIngredienteReceita(){
  var sel=document.getElementById('sel-receita-produto');
  if(!sel || !sel.value){ toast('Selecione um produto'); return; }
  var prod=String(sel.value);
  var used = {};
  (allReceitasProdutos||[]).forEach(function(rp){
    if(rp && String(rp.produto_id||"")===String(prod)){
      used[String(rp.insumo_id||"")] = true;
    }
  });
  var first='';
  (allInsumos||[]).some(function(i){
    var id = i ? String(i.id||"") : "";
    if(id && !used[id]){ first = id; return true; }
    return false;
  });
  if(!first) first = allInsumos && allInsumos[0] ? String(allInsumos[0].id) : '';
  if(!first){ toast('Cadastre insumos primeiro'); return; }
  var id = randomUUIDCompat();
  allReceitasProdutos.push({
    id: id,
    produto_id: prod,
    insumo_id: first,
    quantidade_por_unidade: 0,
    unidade: 'g'
  });
  saveReceitasProdutos();
  renderReceitaDetalhe();
}

function removerIngredienteReceita(id){
  var rid=String(id||"");
  allReceitasProdutos = allReceitasProdutos.filter(function(rp){ return String(rp.id||"")!==rid; });
  saveReceitasProdutos();
  renderReceitaDetalhe();
}

function salvarReceitaProduto(){
  var sel=document.getElementById('sel-receita-produto');
  var prod=sel?String(sel.value||""):"";
  if(!prod){ toast('Selecione um produto'); return; }
  if(!isUuidLike(prod)){ toast('⚠ Produto inválido. Selecione um produto válido.'); return; }
  var host=document.getElementById('receita-detalhe');
  if(!host){ return; }
  var trs=host.querySelectorAll('tr[data-rp-id]');
  var seen = {};
  var toRemoveIds = [];
  trs.forEach(function(tr){
    var rid=String(tr.getAttribute('data-rp-id')||"");
    var ins=tr.querySelector('[data-f="insumo"]');
    var qtyEl=tr.querySelector('[data-f="qty"]');
    var unitEl=tr.querySelector('[data-f="unit"]');
    var rp=allReceitasProdutos.find(function(x){ return String(x.id||"")===rid; });
    if(!rp) return;
    rp.produto_id = prod;
    rp.insumo_id = String(ins?ins.value:"").trim();
    if(!rp.insumo_id || !isUuidLike(rp.insumo_id)){ toRemoveIds.push(rid); return; }
    var rawQty = String(qtyEl?qtyEl.value:"").trim().replace(",",".");
    rp.quantidade_por_unidade = parseFloat(rawQty) || 0;
    rp.unidade = String(unitEl?unitEl.value:"g");
    var key = prod + "|" + rp.insumo_id;
    if(seen[key]) toRemoveIds.push(rid);
    else seen[key] = true;
  });

  if(toRemoveIds.length){
    allReceitasProdutos = allReceitasProdutos.filter(function(rp){ return toRemoveIds.indexOf(String(rp.id||""))<0; });
  }
  allReceitasProdutos.forEach(function(rp){
    if(String(rp.produto_id||"")===prod) rp.updated_at = new Date().toISOString();
  });
  saveReceitasProdutos();
  toast('Receita salva!');
  renderReceitaDetalhe();
}

function abrirModalInsumo(id){
  var m=document.getElementById('modal-insumo');
  var del=document.getElementById('btn-del-insumo');
  if(id){
    var i=allInsumos.find(function(x){return String(x.id)===String(id);});
    if(!i)return;
    normalizeInsumo(i);
    document.getElementById('insumo-edit-id').value=id;
    document.getElementById('modal-insumo-title').textContent='Editar: '+i.nome;
    document.getElementById('in-nome').value=i.nome;
    document.getElementById('in-estoque').value=i.estoque_atual||0;
    document.getElementById('in-unidade').value=i.unidade||'kg';
    document.getElementById('in-minimo').value=i.estoque_minimo||0;
    document.getElementById('in-custo').value=i.custo_unitario||0;
    document.getElementById('in-fornecedor').value=i.fornecedor||'';
    document.getElementById('in-lead-time').value=i.lead_time_dias||0;
    del.style.display='inline-block';
  } else {
    document.getElementById('insumo-edit-id').value='';
    document.getElementById('modal-insumo-title').textContent='Novo Insumo';
    ['in-nome','in-estoque','in-minimo','in-custo','in-fornecedor','in-lead-time'].forEach(function(x){var e=document.getElementById(x);if(e)e.value='';});
    del.style.display='none';
  }
  m.classList.add('open');
}
function salvarInsumo(){
  var id=document.getElementById('insumo-edit-id').value;
  var nextId = id ? String(id) : randomUUIDCompat();
  var obj={
    id: nextId,
    nome: document.getElementById('in-nome').value.trim(),
    unidade: document.getElementById('in-unidade').value,
    estoque_atual: parseFloat(document.getElementById('in-estoque').value)||0,
    estoque_minimo: parseFloat(document.getElementById('in-minimo').value)||0,
    custo_unitario: parseFloat(document.getElementById('in-custo').value)||0,
    fornecedor: document.getElementById('in-fornecedor').value.trim(),
    lead_time_dias: parseInt(document.getElementById('in-lead-time').value)||0,
    updated_at: new Date().toISOString()
  };
  obj.estoque = obj.estoque_atual;
  obj.minimo = obj.estoque_minimo;
  obj.custo = obj.custo_unitario;
  obj.cat = 'Insumo';
  if(!obj.nome){toast('Informe o nome');return;}
  if(id){
    var idx=allInsumos.findIndex(function(x){return String(x.id)===String(id);});
    if(idx>=0) allInsumos[idx]=obj;
  }else{
    allInsumos.push(obj);
  }
  saveInsumos();renderInsumos();renderProdKpis();fecharModal('modal-insumo');toast('Insumo salvo!');
}
function deletarInsumo(){
  var id=String(document.getElementById('insumo-edit-id').value||"");
  var idx=allInsumos.findIndex(function(x){return String(x.id)===String(id);});
  if(idx>=0) allInsumos.splice(idx,1);
  saveInsumos();renderInsumos();renderProdKpis();fecharModal('modal-insumo');toast('Excluido');
}

function abrirModalEntradaInsumo(id){
  var i=allInsumos.find(function(x){return String(x.id)===String(id);});
  if(!i) return;
  normalizeInsumo(i);
  var m=document.getElementById('modal-entrada-insumo');
  document.getElementById('entrada-insumo-id').value=String(id);
  document.getElementById('modal-entrada-insumo-title').textContent='Registrar Entrada: '+i.nome;
  document.getElementById('en-qty').value='';
  document.getElementById('en-custo').value='';
  document.getElementById('en-fornecedor').value=i.fornecedor||'';
  var d=document.getElementById('en-data');
  if(d) d.value=new Date().toISOString().slice(0,10);
  m.classList.add('open');
}

function registrarEntradaInsumo(){
  var id=String(document.getElementById('entrada-insumo-id').value||"");
  var i=allInsumos.find(function(x){return String(x.id)===String(id);});
  if(!i){ toast('Insumo não encontrado'); return; }
  normalizeInsumo(i);
  var qty=parseFloat(document.getElementById('en-qty').value)||0;
  if(qty<=0){ toast('Informe a quantidade'); return; }
  var custoRaw=document.getElementById('en-custo').value;
  var custo = custoRaw==='' ? null : (parseFloat(custoRaw)||0);
  var forn=String(document.getElementById('en-fornecedor').value||'').trim();
  var data=String(document.getElementById('en-data').value||new Date().toISOString().slice(0,10));

  i.estoque_atual = (Number(i.estoque_atual)||0) + qty;
  if(custo != null && isFinite(custo) && custo>=0) i.custo_unitario = custo;
  if(forn) i.fornecedor = forn;
  i.updated_at = new Date().toISOString();
  i.estoque = Number(i.estoque_atual)||0;
  i.custo = Number(i.custo_unitario)||0;

  allMovInsumos.unshift({
    id: randomUUIDCompat(),
    insumo_id: String(i.id),
    tipo: 'entrada',
    quantidade: qty,
    custo_unitario: custo,
    fornecedor: forn || null,
    created_at: data
  });
  saveMovInsumos();

  saveInsumos();
  renderInsumos();
  renderProdKpis();
  fecharModal('modal-entrada-insumo');
  toast('Entrada registrada!');
}

function pad3(n){ var s=String(n||0); while(s.length<3) s='0'+s; return s; }
function generateLote(dateStr){
  var d = String(dateStr||new Date().toISOString().slice(0,10)).replace(/\D/g,'').slice(0,8);
  if(d.length!==8) d = new Date().toISOString().slice(0,10).replace(/\D/g,'');
  var pref = 'OP'+d+'-';
  var max = 0;
  (allOrdens||[]).forEach(function(o){
    var lote = String(o && o.lote || '');
    if(lote.indexOf(pref)!==0) return;
    var m = lote.slice(pref.length).match(/^(\d{1,4})/);
    if(m){ var n=parseInt(m[1],10)||0; if(n>max) max=n; }
  });
  return pref + pad3(max+1);
}

function abrirNovaOrdem(){ abrirModalPedidoProd(null); }
function abrirModalPedidoProd(id){
  var m=document.getElementById('modal-ordem');
  var o=id ? allOrdens.find(function(x){return String(x.id)===String(id);}) : null;
  try{
    allReceitasProdutos = safeJsonParse('crm_receitas_produtos', null) || allReceitasProdutos || [];
    allProdutosReceitas = safeJsonParse('crm_receitas_produtos_produtos', null) || allProdutosReceitas || [];
  }catch(_e){}

  var sel=document.getElementById('or-produto');
  if(sel){
    var products=[].concat(allProdutosReceitas||[]);
    (allReceitasProdutos||[]).forEach(function(rp){
      var p=String(rp && rp.produto_id || '').trim();
      if(p && products.indexOf(p)<0) products.push(p);
    });
    Object.keys(RECEITAS_REAIS||{}).forEach(function(p){
      if(p && products.indexOf(p)<0) products.push(p);
    });
    products = products.filter(Boolean).sort(function(a,b){return String(a).localeCompare(String(b));});
    sel.innerHTML = products.map(function(p){
      return '<option value="'+escapeHTML(p)+'">'+escapeHTML(p)+'</option>';
    }).join('');
  }

  var today=new Date().toISOString().slice(0,10);
  document.getElementById('ordem-edit-id').value = o ? String(o.id) : '';
  document.getElementById('modal-ordem-title').textContent = o ? 'Editar OP' : 'Nova OP';
  document.getElementById('or-status').value = o ? String(o.status||'planejada') : 'planejada';
  document.getElementById('or-data').value = o ? String(o.data_producao||today) : today;
  if(sel) sel.value = o ? String(o.produto_id||'') : (sel.options[0]?.value||'');
  document.getElementById('or-qtd-planejada').value = o ? String(o.quantidade_planejada||0) : '';
  document.getElementById('or-qtd-produzida').value = o ? String(o.quantidade_produzida||0) : '';
  document.getElementById('or-obs').value = o ? String(o.observacoes||'') : '';
  document.getElementById('or-lote').value = o ? String(o.lote||'') : generateLote(today);
  var custoEl=document.getElementById('or-custo-lote');
  if(custoEl){
    var custo = o && o.custo_total_lote != null ? Number(o.custo_total_lote||0)||0 : 0;
    custoEl.value = custo>0 ? fmtBRL(custo) : '';
    custoEl.placeholder = custo>0 ? '' : '—';
  }
  var estEl=document.getElementById('or-estoque-status');
  if(estEl){
    if(o && hasBaixaEstoqueMarker(o)){
      estEl.value = 'Baixado';
    }else if(o && String(o.status||'')==='concluida'){
      estEl.value = 'Pendente baixa';
    }else{
      estEl.value = '';
      estEl.placeholder = '—';
    }
  }
  document.getElementById('btn-del-ordem').style.display = o ? 'inline-block' : 'none';
  m.classList.add('open');
}

function abrirMovimentosDoLote(){
  var lote=String((document.getElementById('or-lote')||{}).value||'').trim();
  var produto=String((document.getElementById('or-produto')||{}).value||'').trim();
  movFilters.q = lote || produto || '';
  movFilters.tipo = 'saida_producao';
  setProdTab('movimentos');
}
function salvarOrdem(){
  var id=String(document.getElementById('ordem-edit-id').value||'');
  var prod=String(document.getElementById('or-produto').value||'').trim();
  var date=String(document.getElementById('or-data').value||new Date().toISOString().slice(0,10));
  var st=String(document.getElementById('or-status').value||'planejada');
  var lote=String(document.getElementById('or-lote').value||'').trim() || generateLote(date);
  var qp=parseFloat(document.getElementById('or-qtd-planejada').value)||0;
  var qdRaw=document.getElementById('or-qtd-produzida').value;
  var qd = qdRaw==='' ? 0 : (parseFloat(qdRaw)||0);
  var obs=String(document.getElementById('or-obs').value||'');
  if(!prod){ toast('Selecione um produto'); return; }
  if(qp<=0){ toast('Informe a quantidade planejada'); return; }
  if(st==='concluida' && (!qd || qd<=0)) qd = qp;

  var savedId = id;
  if(id){
    var idx=allOrdens.findIndex(function(x){return String(x.id)===id;});
    if(idx>=0){
      allOrdens[idx] = Object.assign({}, allOrdens[idx], {
        lote: lote,
        produto_id: prod,
        quantidade_planejada: qp,
        quantidade_produzida: qd,
        data_producao: date,
        status: st,
        observacoes: obs
      });
    }
  }else{
    var newId = randomUUIDCompat();
    savedId = newId;
    allOrdens.unshift({
      id: newId,
      lote: lote,
      produto_id: prod,
      quantidade_planejada: qp,
      quantidade_produzida: qd,
      data_producao: date,
      status: st,
      observacoes: obs,
      created_at: new Date().toISOString()
    });
  }
  saveOrdens();
  if(st==='concluida'){
    baixarEstoqueDaOrdem(savedId, { silent: true, auto: true });
  }
  renderOrdens();
  renderProdKpis();
  renderInsumos();
  fecharModal('modal-ordem');
  toast('OP salva!');
}
function deletarOrdem(){
  var id=String(document.getElementById('ordem-edit-id').value||'');
  allOrdens = (allOrdens||[]).filter(function(x){return String(x && x.id || '')!==id;});
  saveOrdens();
  renderOrdens();
  renderProdKpis();
  renderInsumos();
  fecharModal('modal-ordem');
  toast('OP excluída');
}

function setOrdemStatusQuick(id, status){
  var o=allOrdens.find(function(x){return String(x && x.id || '')===String(id);});
  if(!o) return;
  o.status=status;
  if((status==='em_producao' || status==='concluida') && !o.data_producao){
    o.data_producao=new Date().toISOString().split('T')[0];
  }
  if(status==='concluida' && (!o.quantidade_produzida || Number(o.quantidade_produzida)<=0)){
    o.quantidade_produzida = Number(o.quantidade_planejada)||0;
  }
  saveOrdens();
  renderOrdens();
  renderProdKpis();
  renderInsumos();
  toast('Ordem atualizada');
  if(status==='concluida'){
    baixarEstoqueDaOrdem(id, { silent: true, auto: true });
  }
}

function marcarOrdemConcluida(id){
  setOrdemStatusQuick(id, 'concluida');
  baixarEstoqueDaOrdem(id, { silent: true, auto: true });
}

function hasBaixaEstoqueMarker(o){
  return /#ESTOQUE_BAIXADO\b/.test(String(o && o.observacoes || ''));
}

function validarIdempotenciaBaixa(o){
  if(!o) return {ok:false, reason:'OP não encontrada'};
  if(hasBaixaEstoqueMarker(o)) return {ok:false, reason:'Esta OP já baixou estoque.'};
  return {ok:true};
}

function calcularConsumoDaOP(o){
  var units = Number(o && o.quantidade_produzida || 0) > 0 ? Number(o.quantidade_produzida||0) : (Number(o && o.quantidade_planejada || 0) || 0);
  var nec = computeNeedsForOrderUnits(o, units);
  var idx = {};
  allInsumos.forEach(function(i){ normalizeInsumo(i); idx[String(i.id)] = i; });
  var items = Object.entries(nec).map(function(e){
    var insId = String(e[0]||"");
    var solicitado = Number(e[1]||0)||0;
    var ins = idx[insId] || null;
    return {
      insumo_id: insId,
      insumo_nome: ins ? String(ins.nome||'') : insId,
      unidade: ins ? String(ins.unidade||'') : '',
      custo_unitario: ins ? (Number(ins.custo_unitario||0)||0) : 0,
      solicitado: solicitado,
      units: units
    };
  }).filter(function(x){ return x.solicitado>0; });
  return {units: units, items: items};
}

function registrarMovimentoEstoqueSaidaProducao(o, item, consumido, falta, before){
  var mov = {
    id: randomUUIDCompat(),
    tipo: 'saida_producao',
    insumo_id: String(item.insumo_id),
    unidade: String(item.unidade||''),
    quantidade: Number(consumido||0)||0,
    created_at: new Date().toISOString(),
    ordem_id: String(o.id),
    lote: o.lote || null,
    produto_id: o.produto_id || null,
    metadata: {
      solicitado: Number(item.solicitado||0)||0,
      consumido: Number(consumido||0)||0,
      falta: Number(falta||0)||0,
      estoque_antes: Number(before||0)||0,
      quantidade_produzida: Number(item.units||0)||0
    }
  };
  allMovimentosEstoque.unshift(mov);
  saveMovimentosEstoque();
  if(typeof globalThis.logMovimentoEstoque === "function") globalThis.logMovimentoEstoque(mov);
}

function aplicarBaixaDeEstoque(o, consumo){
  var idx = {};
  allInsumos.forEach(function(i){ normalizeInsumo(i); idx[String(i.id)] = i; });
  var insuficientes = [];
  var custoTotal = 0;
  consumo.items.forEach(function(item){
    var ins = idx[String(item.insumo_id)];
    if(!ins) return;
    var before = Number(ins.estoque_atual)||0;
    var solicitado = Number(item.solicitado||0)||0;
    var consumido = Math.max(0, Math.min(before, solicitado));
    var falta = Math.max(0, solicitado-consumido);
    if(falta>0) insuficientes.push(ins.nome || String(item.insumo_id));
    ins.estoque_atual = Math.max(0, before-consumido);
    ins.estoque = Number(ins.estoque_atual)||0;
    ins.updated_at = new Date().toISOString();
    custoTotal += consumido * (Number(ins.custo_unitario||0)||0);
    registrarMovimentoEstoqueSaidaProducao(o, item, consumido, falta, before);
  });
  saveInsumos();
  return {insuficientes: insuficientes, custo_total_lote: custoTotal};
}

function marcarBaixaRealizada(o, result){
  var tag = '#ESTOQUE_BAIXADO ' + new Date().toISOString();
  if(result && result.custo_total_lote != null) tag += ' CUSTO=' + Number(result.custo_total_lote||0).toFixed(2);
  o.observacoes = String(o.observacoes||'').trim() + (String(o.observacoes||'').trim() ? '\n' : '') + tag;
}

function baixarEstoqueDaOrdem(id, opts){
  opts = opts || {};
  var o=allOrdens.find(function(x){return String(x && x.id || '')===String(id);});
  var idem = validarIdempotenciaBaixa(o);
  if(!idem.ok){
    if(!opts.silent) toast(idem.reason);
    return {ok:false, reason: idem.reason};
  }
  if(!opts.silent && !confirm('Baixar estoque desta OP agora?')) return {ok:false, reason:'cancelado'};
  var consumo = calcularConsumoDaOP(o);
  if(!consumo.items.length){
    toast('Nenhum ingrediente encontrado em receitas_produtos para este produto');
    return {ok:false, reason:'sem_receita'};
  }
  var res = aplicarBaixaDeEstoque(o, consumo);
  o.custo_total_lote = Number(res.custo_total_lote||0)||0;
  marcarBaixaRealizada(o, res);
  saveOrdens();
  renderInsumos();
  renderProdKpis();
  if(res.insuficientes.length){
    toast('Estoque insuficiente: ' + res.insuficientes.join(', '));
  }else{
    toast('Estoque baixado');
  }
  return {ok:true, insuficientes: res.insuficientes, custo_total_lote: o.custo_total_lote};
}

function setProdTab(tab){
  ['insumos','ordens','movimentos','simulador','receitas'].forEach(function(t){
    var el=document.getElementById('prod-tab-'+t);
    var btn=document.getElementById('ptab-'+t);
    if(el) el.style.display=t===tab?'':'none';
    if(btn) btn.classList.toggle('active-tab',t===tab);
  });
  if(tab==='insumos'){renderInsumos();renderProdKpis();}
  if(tab==='ordens') renderOrdens();
  if(tab==='movimentos') renderMovimentosEstoque();
  if(tab==='simulador'){renderSimuladorInputs();var sr=document.getElementById('sim-resultado');if(sr)sr.innerHTML='';}
  if(tab==='receitas') renderReceitaDetalhe();
}

export {
  PRECO_KG_FALLBACK,
  PRECO_KG,
  RECEITAS_REAIS,
  CAT_EMOJI,
  CAT_COLOR,
  allInsumos,
  allOrdens,
  saveInsumos,
  saveOrdens,
  getEstStatus,
  getEstPct,
  renderProdKpis,
  renderInsumos,
  renderOrdens,
  renderMovimentosEstoque,
  renderSimuladorInputs,
  calcularSimulador,
  salvarOrdemDeSimulacao,
  renderReceitaDetalhe,
  novoProdutoReceita,
  adicionarIngredienteReceita,
  removerIngredienteReceita,
  salvarReceitaProduto,
  abrirModalInsumo,
  salvarInsumo,
  deletarInsumo,
  abrirModalEntradaInsumo,
  registrarEntradaInsumo,
  abrirNovaOrdem,
  abrirModalPedidoProd,
  salvarOrdem,
  deletarOrdem,
  setOrdemStatusQuick,
  marcarOrdemConcluida,
  baixarEstoqueDaOrdem,
  setProdTab
};

window.renderProdKpis = renderProdKpis;
window.renderInsumos = renderInsumos;
window.renderOrdens = renderOrdens;
window.renderMovimentosEstoque = renderMovimentosEstoque;
window.renderSimuladorInputs = renderSimuladorInputs;
window.calcularSimulador = calcularSimulador;
window.salvarOrdemDeSimulacao = salvarOrdemDeSimulacao;
window.marcarOrdemConcluida = marcarOrdemConcluida;
window.renderReceitaDetalhe = renderReceitaDetalhe;
window.novoProdutoReceita = novoProdutoReceita;
window.adicionarIngredienteReceita = adicionarIngredienteReceita;
window.removerIngredienteReceita = removerIngredienteReceita;
window.salvarReceitaProduto = salvarReceitaProduto;
window.abrirModalInsumo = abrirModalInsumo;
window.salvarInsumo = salvarInsumo;
window.deletarInsumo = deletarInsumo;
window.abrirModalEntradaInsumo = abrirModalEntradaInsumo;
window.registrarEntradaInsumo = registrarEntradaInsumo;
window.abrirNovaOrdem = abrirNovaOrdem;
window.abrirModalPedidoProd = abrirModalPedidoProd;
window.salvarOrdem = salvarOrdem;
window.deletarOrdem = deletarOrdem;
window.setOrdemStatusQuick = setOrdemStatusQuick;
window.baixarEstoqueDaOrdem = baixarEstoqueDaOrdem;
window.setProdTab = setProdTab;
window.abrirMovimentosDoLote = abrirMovimentosDoLote;
