import { escapeHTML, safeJsonParse } from "./utils.js";

function toast(msg){
  if(typeof globalThis.toast === "function") globalThis.toast(msg);
}

function fecharModal(id){
  if(typeof globalThis.fecharModal === "function") globalThis.fecharModal(id);
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
  return {id:i+1,nome:nome,estoque:0,minimo:2,critico:0.5,unidade:'kg',custo:PRECO_KG[nome],fornecedor:'',previsao:'',cat:'Insumo'};
});
let allOrdens = safeJsonParse('crm_ordens', null) || [];

function saveInsumos(){ localStorage.setItem('crm_insumos',JSON.stringify(allInsumos)); }
function saveOrdens(){ localStorage.setItem('crm_ordens',JSON.stringify(allOrdens)); }

function getEstStatus(i){ if(!i.estoque||i.estoque<=0)return 'zerado'; if(i.estoque<=i.critico)return 'critico'; if(i.estoque<=i.minimo)return 'baixo'; return 'ok'; }
function getEstPct(i){ var ref=Math.max(i.minimo*1.5,1); return Math.min(100,(i.estoque/ref)*100); }

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
  return o && (o.status==='planejada' || o.status==='producao');
}

function computeNeedsForOrder(o){
  var nec={};
  if(!o||!o.itens||!o.itens.length) return nec;
  o.itens.forEach(function(it){
    var r=RECEITAS_REAIS[it.produto];
    if(!r) return;
    Object.entries(r.insumos).forEach(function(e){
      var nome=e[0];
      var g=e[1];
      var kg=(g*(it.qty||0))/1000;
      nec[nome]=(nec[nome]||0)+kg;
    });
  });
  return nec;
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
  allInsumos.forEach(function(i){ byName[i.nome]=Number(i.estoque)||0; });
  var reserved=computeNeedsForOrders(allOrdens.filter(isOrderOpen));
  Object.entries(reserved).forEach(function(e){
    var nome=e[0];
    var kg=e[1];
    byName[nome]=Math.max(0,(Number(byName[nome])||0)-kg);
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
  var atencao=allInsumos.filter(function(i){return ['baixo','critico','zerado'].includes(getEstStatus(i));}).length;
  var valorTotal=allInsumos.reduce(function(s,i){return s+(i.estoque||0)*i.custo;},0);
  var ordsAtivas=allOrdens.filter(function(o){return o.status==='producao';}).length;
  var open=allOrdens.filter(isOrderOpen);
  var nec=computeNeedsForOrders(open);
  var faltaCusto=Object.entries(nec).reduce(function(s,e){
    var nome=e[0],kg=e[1];
    var ins=allInsumos.find(function(x){return x.nome===nome;});
    var disp=ins?(Number(ins.estoque)||0):0;
    var falta=Math.max(0, kg-disp);
    return s + falta*(Number((ins && ins.custo)||PRECO_KG[nome]||0)||0);
  },0);
  var stock=buildAvailableStockMap();
  var blockedProducts=Object.keys(RECEITAS_REAIS).filter(function(p){
    return computeProductCoverage(p, stock.available).max_units<=0;
  }).length;
  el.innerHTML=
    kpiCard('Insumos',allInsumos.length,'cadastrados','var(--text)')+
    kpiCard('Críticos',allInsumos.filter(function(i){return ['critico','zerado'].includes(getEstStatus(i));}).length,'prioridade alta','var(--red)')+
    kpiCard('Atenção',atencao,atencao>0?'repor estoque':'tudo ok',atencao>0?'var(--amber)':'var(--green)')+
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
  var opTable=computeInsumoOperationalTable();
  var filtered=opTable.filter(function(r){
    if(q && !String(r.nome||'').toLowerCase().includes(q)) return false;
    if(sf && r.status!==sf) return false;
    return true;
  });
  if(!filtered.length){el.innerHTML='<div class="empty">Nenhum insumo encontrado</div>';return;}

  var statusLabel={ok:'OK',baixo:'Baixo',critico:'Crítico',zerado:'Zerado'};
  var statusTone={ok:'tone-ok',baixo:'tone-warn',critico:'tone-crit',zerado:'tone-off'};

  var alerts=opTable.filter(function(r){
    return r.falta_op>0 || ['zerado','critico','baixo'].includes(r.status);
  }).slice(0,8);

  var restock=opTable.filter(function(r){
    return r.comprar>0 || r.falta_op>0;
  }).slice(0,10);

  var stock=buildAvailableStockMap();
  var prodCoverage=Object.keys(RECEITAS_REAIS).map(function(p){
    var cov=computeProductCoverage(p, stock.available);
    return {produto:p, max_units:cov.max_units, limiting:cov.limiting};
  }).sort(function(a,b){return a.max_units-b.max_units;});
  var lowCoverage=prodCoverage.filter(function(x){return x.max_units<=80;}).slice(0,12);

  el.innerHTML=
    '<div class="prod-cc">'+
      '<div class="prod-cc-grid">'+
        '<div class="prod-panel">'+
          '<div class="prod-panel-hdr"><div><div class="prod-panel-title">Alertas críticos</div><div class="prod-panel-sub">Prioridade por risco, impacto em OPs e cobertura.</div></div></div>'+
          (alerts.length?(
            '<div class="prod-alert-list">'+alerts.map(function(r){
              var i=r.insumo;
              var buy=r.comprar>0?('Comprar '+fmtNum(r.comprar,2)+' '+escapeHTML(i.unidade||'kg')):'—';
              var need=r.falta_op>0?('Falta p/ OPs '+fmtNum(r.falta_op,2)+' kg'):(r.reservado>0?('Reservado '+fmtNum(r.reservado,2)+' kg'):'Sem OPs pendentes');
              return '<div class="prod-alert-row '+statusTone[r.status]+'">'+
                '<div class="prod-alert-main">'+
                  '<div class="prod-alert-name">'+escapeHTML(r.nome)+'</div>'+
                  '<div class="prod-alert-meta">'+
                    '<span class="prod-chip '+statusTone[r.status]+'">'+statusLabel[r.status]+'</span>'+
                    '<span class="prod-chip">Estoque '+fmtNum(r.estoque,2)+' kg</span>'+
                    '<span class="prod-chip">'+escapeHTML(need)+'</span>'+
                    '<span class="prod-chip">Impacta '+r.impacto_produtos+' receitas</span>'+
                  '</div>'+
                '</div>'+
                '<div class="prod-alert-side">'+
                  '<div class="prod-alert-buy">'+escapeHTML(buy)+'</div>'+
                  '<button type="button" class="prod-btn" onclick="abrirModalInsumo('+i.id+')">Editar</button>'+
                '</div>'+
              '</div>';
            }).join('')+'</div>'
          ):('<div class="empty" style="padding:18px 0">Sem alertas críticos agora.</div>'))+
        '</div>'+

        '<div class="prod-panel">'+
          '<div class="prod-panel-hdr"><div><div class="prod-panel-title">Reposição recomendada</div><div class="prod-panel-sub">Sugestão = mínimo + reserva de OPs.</div></div></div>'+
          (restock.length?(
            '<div class="prod-restock-list">'+
              '<div class="prod-restock-head">'+
                '<div>Insumo</div><div>Status</div><div style="text-align:right">Comprar</div><div style="text-align:right">Previsão</div>'+
              '</div>'+
              restock.map(function(r){
                var previsao=r.previsao_str?new Date(r.previsao_str).toLocaleDateString('pt-BR'):'—';
                var buyKg=r.comprar>0?fmtNum(r.comprar,2)+' kg':'—';
                var warn=r.dias_previsao!=null && r.dias_previsao<=3 ? 'warn' : '';
                return '<div class="prod-restock-row '+warn+'">'+
                  '<div class="prod-restock-name">'+escapeHTML(r.nome)+'</div>'+
                  '<div><span class="prod-chip '+statusTone[r.status]+'">'+statusLabel[r.status]+'</span></div>'+
                  '<div class="prod-restock-num">'+escapeHTML(buyKg)+'</div>'+
                  '<div class="prod-restock-num">'+escapeHTML(previsao)+'</div>'+
                '</div>';
              }).join('')+
            '</div>'
          ):('<div class="empty" style="padding:18px 0">Sem itens para repor agora.</div>'))+
        '</div>'+
      '</div>'+

      '<div class="prod-panel">'+
        '<div class="prod-panel-hdr"><div><div class="prod-panel-title">Cobertura estimada por produto</div><div class="prod-panel-sub">Considera o estoque disponível após reservar ordens abertas.</div></div></div>'+
        (lowCoverage.length?(
          '<div class="prod-cov-list">'+
            '<div class="prod-cov-head"><div>Produto</div><div style="text-align:right">Cobertura (un)</div><div>Gargalo</div></div>'+
            lowCoverage.map(function(p){
              var units=p.max_units;
              var tone=units<=0?'tone-off':units<=20?'tone-crit':units<=50?'tone-warn':'tone-ok';
              return '<div class="prod-cov-row">'+
                '<div class="prod-cov-prod">'+escapeHTML(p.produto)+'</div>'+
                '<div style="text-align:right"><span class="prod-chip '+tone+'">'+escapeHTML(String(units))+'</span></div>'+
                '<div class="prod-cov-lim">'+escapeHTML(p.limiting||'—')+'</div>'+
              '</div>';
            }).join('')+
          '</div>'
        ):('<div class="empty" style="padding:18px 0">Nenhum produto com baixa cobertura.</div>'))+
      '</div>'+

      '<div class="prod-panel">'+
        '<div class="prod-panel-hdr"><div><div class="prod-panel-title">Estoque detalhado</div><div class="prod-panel-sub">Estoque, reserva para OPs, disponibilidade e valor.</div></div></div>'+
        '<div class="prod-stock-list">'+
          filtered.map(function(r){
            var i=r.insumo;
            var st=r.status;
            var pct=getEstPct(i);
            var ve=r.valor_estoque;
            var barTone=st==='ok'?'tone-ok':st==='baixo'?'tone-warn':st==='critico'?'tone-crit':'tone-off';
            var cover=r.dias_cobertura==null?'—':(r.dias_cobertura+'d');
            return '<div class="prod-stock-card '+barTone+'">'+
              '<div class="prod-stock-main">'+
                '<div class="prod-stock-top">'+
                  '<div class="prod-stock-name">'+escapeHTML(r.nome)+'</div>'+
                  '<div class="prod-stock-badges">'+
                    '<span class="prod-chip '+statusTone[st]+'">'+statusLabel[st]+'</span>'+
                    '<span class="prod-chip">Cobertura '+escapeHTML(String(cover))+'</span>'+
                    (r.reservado>0?('<span class="prod-chip">Reservado '+fmtNum(r.reservado,2)+' kg</span>'):'')+
                  '</div>'+
                '</div>'+
                '<div class="prod-stock-meta">'+
                  '<span>Disponível <b>'+fmtNum(r.disponivel,2)+' kg</b></span>'+
                  '<span>Estoque '+fmtNum(r.estoque,2)+' kg</span>'+
                  '<span>Mín. '+fmtNum(i.minimo||0,2)+' kg</span>'+
                  '<span>Valor '+escapeHTML(fmtBRL(ve))+'</span>'+
                '</div>'+
                '<div class="prod-stock-bar"><div class="prod-stock-fill" style="width:'+pct+'%"></div></div>'+
              '</div>'+
              '<div class="prod-stock-actions">'+
                (r.comprar>0?('<div class="prod-stock-cta">Sugestão: <b>'+fmtNum(r.comprar,2)+' kg</b></div>'):'<div class="prod-stock-cta">OK</div>')+
                '<button type="button" class="prod-btn" onclick="abrirModalInsumo('+i.id+')">Editar</button>'+
              '</div>'+
            '</div>';
          }).join('')+
        '</div>'+
      '</div>'+
    '</div>';
}

function renderOrdens(){
  var el=document.getElementById('ordens-prod-list'); if(!el) return;
  if(!allOrdens.length){el.innerHTML='<div class="empty" style="padding:40px 0">Nenhuma ordem. Use o Simulador para criar.</div>';return;}
  var q=((document.getElementById('search-ordem')||{}).value||'').toLowerCase();
  var sf=(document.getElementById('fil-ordem-status')||{}).value||'';
  var rf=(document.getElementById('fil-ordem-ready')||{}).value||'';
  var stL={planejada:'Planejada',producao:'Em Produção',concluida:'Concluída',cancelada:'Cancelada'};
  var stC={planejada:'os-planejada',producao:'os-producao',concluida:'os-concluida',cancelada:'os-cancelada'};
  var idx=buildInsumoIndex();
  var list=[].concat(allOrdens).reverse().map(function(o){
    var itStr=o.itens?o.itens.map(function(it){return escapeHTML(it.qty+'x '+it.produto);}).join(', '):'';
    var nec=computeNeedsForOrder(o);
    var faltaCusto=Object.entries(nec).reduce(function(s,e){
      var nome=e[0],kg=e[1];
      var ins=idx[nome];
      var disp=ins?(Number(ins.estoque)||0):0;
      var falta=Math.max(0, kg-disp);
      var custo=falta*(Number((ins && ins.custo)||PRECO_KG[nome]||0)||0);
      return s+custo;
    },0);
    var isBlocked=faltaCusto>0.001 && (o.status==='planejada' || o.status==='producao');
    var readyLabel=isBlocked?('Bloqueada • '+fmtBRL(faltaCusto)):'Pronta';
    if(q && !(String(o.nome||'').toLowerCase().includes(q) || itStr.toLowerCase().includes(q))) return null;
    if(sf && o.status!==sf) return null;
    if(rf){
      if(rf==='pronta' && isBlocked) return null;
      if(rf==='bloqueada' && !isBlocked) return null;
    }
    var quick='';
    if(o.status==='planejada'){
      quick='<button type="button" class="prod-btn '+(isBlocked?'disabled':'')+'" onclick="setOrdemStatusQuick('+o.id+',\'producao\')" '+(isBlocked?'disabled':'')+'>Iniciar</button>';
    }else if(o.status==='producao'){
      quick='<button type="button" class="prod-btn" onclick="setOrdemStatusQuick('+o.id+',\'concluida\')">Concluir</button>'+
        '<button type="button" class="prod-btn" onclick="baixarEstoqueDaOrdem('+o.id+')">Baixar estoque</button>';
    }
    return '<div class="ordem-card prod-ordem">'+
      '<div class="ordem-head">'+
        '<div>'+
          '<div class="prod-ordem-title">'+escapeHTML(o.nome)+'</div>'+
          '<div class="prod-ordem-items">'+itStr+'</div>'+
          '<div class="prod-ordem-meta">'+escapeHTML(o.data||'')+(o.responsavel?' · '+escapeHTML(o.responsavel):'')+'</div>'+
          '<div class="prod-ordem-tags">'+
            '<span class="prod-chip '+(isBlocked?'tone-crit':'tone-ok')+'">'+escapeHTML(readyLabel)+'</span>'+
            (o.custo_total?'<span class="prod-chip">Custo est. '+escapeHTML(fmtBRL(o.custo_total))+'</span>':'')+
          '</div>'+
        '</div>'+
        '<div class="prod-ordem-actions">'+
          '<span class="ordem-status '+stC[o.status]+'">'+stL[o.status]+'</span>'+
          '<div class="prod-ordem-btns">'+
            quick+
            '<button type="button" class="prod-btn" onclick="verDetalheOrdem('+o.id+')">Impacto</button>'+
            '<button type="button" class="prod-btn" onclick="abrirModalPedidoProd('+o.id+')">Editar</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div id="detalhe-ordem-'+o.id+'" class="prod-ordem-detail" style="display:none"></div>'+
    '</div>';
  }).filter(Boolean);

  var toolbar=
    '<div class="prod-ordem-toolbar">'+
      '<input id="search-ordem" class="filter-inp" placeholder="🔍 Buscar ordem..." value="'+escapeHTML(q)+'" oninput="renderOrdens()" style="flex:1;min-width:180px"/>'+
      '<select id="fil-ordem-status" class="filter-sel" onchange="renderOrdens()">'+
        '<option value="">Todos status</option>'+
        '<option value="planejada" '+(sf==='planejada'?'selected':'')+'>Planejada</option>'+
        '<option value="producao" '+(sf==='producao'?'selected':'')+'>Em produção</option>'+
        '<option value="concluida" '+(sf==='concluida'?'selected':'')+'>Concluída</option>'+
        '<option value="cancelada" '+(sf==='cancelada'?'selected':'')+'>Cancelada</option>'+
      '</select>'+
      '<select id="fil-ordem-ready" class="filter-sel" onchange="renderOrdens()">'+
        '<option value="">Prontas + bloqueadas</option>'+
        '<option value="pronta" '+(rf==='pronta'?'selected':'')+'>Só prontas</option>'+
        '<option value="bloqueada" '+(rf==='bloqueada'?'selected':'')+'>Só bloqueadas</option>'+
      '</select>'+
    '</div>';

  el.innerHTML=toolbar + (list.length?list.join(''):'<div class="empty" style="padding:40px 0">Nenhuma ordem com esses filtros.</div>');
}

function verDetalheOrdem(id){
  var o=allOrdens.find(function(x){return x.id===id;});
  var el=document.getElementById('detalhe-ordem-'+id);
  if(!el||!o||!o.itens)return;
  if(el.style.display!=='none'){el.style.display='none';return;}
  var nec=computeNeedsForOrder(o);
  var idx=buildInsumoIndex();
  var totalFalta=0;
  var rows=Object.entries(nec).sort(function(a,b){return b[1]-a[1];}).map(function(e){
    var nome=e[0],nKg=e[1];
    var ins=idx[nome];
    var disp=ins?(Number(ins.estoque)||0):0;
    var falta=Math.max(0, nKg-disp);
    var custo=falta*(Number((ins && ins.custo)||PRECO_KG[nome]||0)||0);
    totalFalta+=custo;
    var ok=falta<0.001;
    return '<div class="prod-nec-row">'+
      '<div class="prod-nec-name">'+escapeHTML(nome)+'</div>'+
      '<div class="prod-nec-num">'+fmtNum(nKg,3)+'</div>'+
      '<div class="prod-nec-num '+(disp>0?'ok':'bad')+'">'+fmtNum(disp,3)+'</div>'+
      '<div class="prod-nec-num '+(ok?'ok':'bad')+'">'+(ok?'—':fmtNum(falta,3))+'</div>'+
      '<div class="prod-nec-num '+(ok?'muted':'bad')+'">'+(ok?'—':fmtBRL(custo))+'</div>'+
      '<div class="prod-nec-tag"><span class="prod-chip '+(ok?'tone-ok':'tone-crit')+'">'+(ok?'OK':'Comprar')+'</span></div>'+
    '</div>';
  });

  var canStart=(o.status==='planejada' && totalFalta<0.01);
  var canFinish=(o.status==='producao');
  var btns='';
  if(canStart) btns+='<button type="button" class="prod-btn" onclick="setOrdemStatusQuick('+o.id+',\'producao\')">Iniciar</button>';
  if(canFinish){
    btns+='<button type="button" class="prod-btn" onclick="baixarEstoqueDaOrdem('+o.id+')">Baixar estoque</button>';
    btns+='<button type="button" class="prod-btn" onclick="setOrdemStatusQuick('+o.id+',\'concluida\')">Concluir</button>';
  }

  el.innerHTML=
    '<div class="prod-nec">'+
      '<div class="prod-nec-top">'+
        '<div>'+
          '<div class="prod-nec-title">Impacto da ordem</div>'+
          '<div class="prod-nec-sub">'+(totalFalta>0.01?('Bloqueada: falta '+fmtBRL(totalFalta)+' em insumos'):'Estoque suficiente para produzir')+'</div>'+
        '</div>'+
        (btns?'<div class="prod-nec-actions">'+btns+'</div>':'')+
      '</div>'+
      '<div class="prod-nec-head">'+
        '<div>Insumo</div><div style="text-align:right">Precisa (kg)</div><div style="text-align:right">Estoque (kg)</div><div style="text-align:right">Falta (kg)</div><div style="text-align:right">Custo</div><div style="text-align:right">Status</div>'+
      '</div>'+
      '<div class="prod-nec-body">'+rows.join('')+'</div>'+
    '</div>';
  el.style.display='block';
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
    var cf=falta*(PRECO_KG[nome]||0);
    var ct=nKg*(PRECO_KG[nome]||0);
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
  var nome='Ordem '+new Date().toLocaleDateString('pt-BR')+' — '+itens.map(function(i){return i.qty+'x '+i.produto;}).join(', ');
  var nova={id:Date.now(),nome:nome,itens:itens,data:new Date().toISOString().split('T')[0],status:'planejada',responsavel:'',obs:'',custo_total:window._ultimaSimulacao.custo_total};
  allOrdens.push(nova); saveOrdens(); toast('Ordem criada!'); setProdTab('ordens');
}

function renderReceitaDetalhe(){
  var sel=document.getElementById('sel-receita-produto');
  var sizeSel=document.getElementById('sel-receita-tamanho');
  var el=document.getElementById('receita-detalhe');
  if(!sel||!el)return;
  var mode=sizeSel?String(sizeSel.value||'250'):'250';
  var products=Object.keys(RECEITAS_REAIS).filter(function(p){
    if(mode==='30') return /30g/i.test(p);
    return /250g|200g/i.test(p);
  });
  if(!sel.options.length || sel.options[0].value===''){
    sel.innerHTML='<option value="">Selecione...</option>'+products.map(function(p){return '<option value="'+p+'">'+p+'</option>';}).join('');
  }else{
    var existing=[].slice.call(sel.options).map(function(o){return o.value;}).filter(Boolean);
    var shouldRefresh=(existing.length!==products.length) || products.some(function(p){return existing.indexOf(p)===-1;});
    if(shouldRefresh){
      var prev=sel.value;
      sel.innerHTML='<option value="">Selecione...</option>'+products.map(function(p){return '<option value="'+p+'">'+p+'</option>';}).join('');
      if(prev && products.indexOf(prev)>=0) sel.value=prev;
    }
  }
  var prod=sel.value;
  if(!prod){el.innerHTML='<div class="empty">Selecione um produto para ver a receita.</div>';return;}
  var r=RECEITAS_REAIS[prod];
  var totalG=Object.values(r.insumos).reduce(function(s,v){return s+v;},0);
  var custoU=0;
  var idx=buildInsumoIndex();
  var rawStock={};
  allInsumos.forEach(function(i){ rawStock[i.nome]=Number(i.estoque)||0; });
  var stock=buildAvailableStockMap();
  var covNow=computeProductCoverage(prod, stock.available);
  var covRaw=computeProductCoverage(prod, rawStock);
  var targetUnits=100;
  var buyCost=0;
  var buyLines=[];

  var rows=Object.entries(r.insumos).sort(function(a,b){return b[1]-a[1];}).map(function(e){
    var nome=e[0],g=e[1];
    var ins=idx[nome];
    var preco=Number((ins && ins.custo)||PRECO_KG[nome]||0)||0;
    var custo=(g/1000)*preco;
    custoU+=custo;
    var pct=Math.round(g/totalG*100);
    var cor=CAT_COLOR[r.categoria]||'#6bbf3a';
    var needKgUnit=g/1000;
    var stk=Number((ins && ins.estoque)||0)||0;
    var avail=Number(stock.available[nome]||0)||0;
    var unitsBy=Math.floor(avail/needKgUnit);
    var st=ins?getEstStatus(ins):'zerado';
    var tone=st==='ok'?'tone-ok':st==='baixo'?'tone-warn':st==='critico'?'tone-crit':'tone-off';
    var needTargetKg=needKgUnit*targetUnits;
    var faltaTarget=Math.max(0, needTargetKg-stk);
    if(faltaTarget>0.001){
      var cc=faltaTarget*preco;
      buyCost+=cc;
      buyLines.push('<div class="prod-buy-row"><div>'+escapeHTML(nome)+'</div><div style="text-align:right">'+fmtNum(faltaTarget,2)+' kg</div><div style="text-align:right">'+escapeHTML(fmtBRL(cc))+'</div></div>');
    }
    return '<div class="prod-recipe-row">'+
      '<div class="prod-recipe-name">'+escapeHTML(nome)+'</div>'+
      '<div class="prod-recipe-num">'+fmtNum(g,0)+'g</div>'+
      '<div class="prod-recipe-prop"><div class="prod-recipe-bar"><div class="prod-recipe-fill" style="width:'+pct+'%;background:'+cor+'"></div></div></div>'+
      '<div class="prod-recipe-num">'+escapeHTML(fmtBRL(custo))+'</div>'+
      '<div class="prod-recipe-num"><span class="prod-chip '+tone+'">'+unitsBy+' un</span></div>'+
    '</div>';
  });
  var covTone=covNow.max_units<=0?'tone-off':covNow.max_units<=20?'tone-crit':covNow.max_units<=50?'tone-warn':'tone-ok';
  var limiting=escapeHTML(covNow.limiting||'—');
  el.innerHTML=
    '<div class="prod-panel">'+
      '<div class="prod-panel-hdr">'+
        '<div>'+
          '<div class="prod-panel-title">'+escapeHTML(CAT_EMOJI[r.categoria]||'📖')+' '+escapeHTML(prod)+'</div>'+
          '<div class="prod-panel-sub">'+totalG+'g por unidade • gargalo: '+limiting+'</div>'+
        '</div>'+
        '<div class="prod-recipe-kpis">'+
          '<div class="prod-recipe-kpi"><div class="k">Cobertura (disp.)</div><div class="v"><span class="prod-chip '+covTone+'">'+covNow.max_units+' un</span></div></div>'+
          '<div class="prod-recipe-kpi"><div class="k">Cobertura (bruta)</div><div class="v"><span class="prod-chip">'+covRaw.max_units+' un</span></div></div>'+
          '<div class="prod-recipe-kpi"><div class="k">Custo/un</div><div class="v"><span class="prod-chip">'+escapeHTML(fmtBRL(custoU))+'</span></div></div>'+
        '</div>'+
      '</div>'+

      '<div class="prod-recipe-table">'+
        '<div class="prod-recipe-head">'+
          '<div>Insumo</div><div style="text-align:right">Qtd</div><div>Proporção</div><div style="text-align:right">Custo/un</div><div style="text-align:right">Cobertura</div>'+
        '</div>'+
        rows.join('')+
      '</div>'+

      '<div class="prod-recipe-footer">'+
        '<div class="prod-buy">'+
          '<div class="prod-buy-top">'+
            '<div><div class="prod-buy-title">Compra sugerida (para '+targetUnits+' unidades)</div><div class="prod-buy-sub">Baseada no estoque atual (sem reserva).</div></div>'+
            '<div class="prod-buy-total">'+escapeHTML(fmtBRL(buyCost))+'</div>'+
          '</div>'+
          (buyLines.length?('<div class="prod-buy-head"><div>Insumo</div><div style="text-align:right">Falta</div><div style="text-align:right">Custo</div></div><div class="prod-buy-body">'+buyLines.join('')+'</div>'):'<div class="empty" style="padding:16px 0">Sem compras necessárias para '+targetUnits+' unidades.</div>')+
        '</div>'+
      '</div>'+
    '</div>';
}

function abrirModalInsumo(id){
  var m=document.getElementById('modal-insumo');
  var del=document.getElementById('btn-del-insumo');
  if(id){
    var i=allInsumos.find(function(x){return x.id===id;});
    if(!i)return;
    document.getElementById('insumo-edit-id').value=id;
    document.getElementById('modal-insumo-title').textContent='Editar: '+i.nome;
    document.getElementById('in-nome').value=i.nome;
    document.getElementById('in-cat').value=i.cat||'Insumo';
    document.getElementById('in-estoque').value=i.estoque||0;
    document.getElementById('in-unidade').value=i.unidade||'kg';
    document.getElementById('in-minimo').value=i.minimo||0;
    document.getElementById('in-critico').value=i.critico||0;
    document.getElementById('in-custo').value=i.custo||0;
    document.getElementById('in-fornecedor').value=i.fornecedor||'';
    document.getElementById('in-previsao').value=i.previsao||'';
    del.style.display='inline-block';
  } else {
    document.getElementById('insumo-edit-id').value='';
    document.getElementById('modal-insumo-title').textContent='Novo Insumo';
    ['in-nome','in-estoque','in-minimo','in-critico','in-custo','in-fornecedor','in-previsao'].forEach(function(x){var e=document.getElementById(x);if(e)e.value='';});
    del.style.display='none';
  }
  m.classList.add('open');
}
function salvarInsumo(){
  var id=document.getElementById('insumo-edit-id').value;
  var obj={id:id?parseInt(id):Date.now(),nome:document.getElementById('in-nome').value.trim(),cat:document.getElementById('in-cat').value,estoque:parseFloat(document.getElementById('in-estoque').value)||0,unidade:document.getElementById('in-unidade').value,minimo:parseFloat(document.getElementById('in-minimo').value)||0,critico:parseFloat(document.getElementById('in-critico').value)||0,custo:parseFloat(document.getElementById('in-custo').value)||0,fornecedor:document.getElementById('in-fornecedor').value.trim(),previsao:document.getElementById('in-previsao').value};
  if(!obj.nome){toast('Informe o nome');return;}
  if(id){var idx=allInsumos.findIndex(function(x){return x.id===parseInt(id);});if(idx>=0)allInsumos[idx]=obj;}else allInsumos.push(obj);
  saveInsumos();renderInsumos();renderProdKpis();fecharModal('modal-insumo');toast('Insumo salvo!');
}
function deletarInsumo(){
  var id=parseInt(document.getElementById('insumo-edit-id').value);
  allInsumos=allInsumos.filter(function(x){return x.id!==id;});
  saveInsumos();renderInsumos();renderProdKpis();fecharModal('modal-insumo');toast('Excluido');
}

function abrirNovaOrdem(){ setProdTab('simulador'); renderSimuladorInputs(); }
function abrirModalPedidoProd(id){
  var m=document.getElementById('modal-ordem');
  var o=allOrdens.find(function(x){return x.id===id;});
  if(o){
    document.getElementById('ordem-edit-id').value=id;
    document.getElementById('modal-ordem-title').textContent='Editar Ordem';
    document.getElementById('or-responsavel').value=o.responsavel||'';
    document.getElementById('or-status').value=o.status||'planejada';
    document.getElementById('or-obs').value=o.obs||'';
    document.getElementById('or-inicio').value=o.data||'';
    document.getElementById('btn-del-ordem').style.display='inline-block';
  }
  m.classList.add('open');
}
function salvarOrdem(){
  var id=document.getElementById('ordem-edit-id').value;
  if(id){var idx=allOrdens.findIndex(function(x){return x.id===parseInt(id);});if(idx>=0){allOrdens[idx].responsavel=document.getElementById('or-responsavel').value;allOrdens[idx].status=document.getElementById('or-status').value;allOrdens[idx].obs=document.getElementById('or-obs').value;allOrdens[idx].data=document.getElementById('or-inicio').value;}}
  saveOrdens();renderOrdens();fecharModal('modal-ordem');toast('Ordem atualizada!');
}
function deletarOrdem(){
  var id=parseInt(document.getElementById('ordem-edit-id').value);
  allOrdens=allOrdens.filter(function(x){return x.id!==id;});
  saveOrdens();renderOrdens();fecharModal('modal-ordem');toast('Ordem excluida');
}

function setOrdemStatusQuick(id, status){
  var o=allOrdens.find(function(x){return x.id===id;});
  if(!o) return;
  o.status=status;
  if((status==='producao' || status==='concluida') && !o.data){
    o.data=new Date().toISOString().split('T')[0];
  }
  saveOrdens();
  renderOrdens();
  renderProdKpis();
  renderInsumos();
  toast('Ordem atualizada');
}

function baixarEstoqueDaOrdem(id){
  var o=allOrdens.find(function(x){return x.id===id;});
  if(!o) return;
  if(!confirm('Baixar estoque desta ordem agora?')) return;
  var nec=computeNeedsForOrder(o);
  var idx=buildInsumoIndex();
  var hasAny=false;
  Object.entries(nec).forEach(function(e){
    var nome=e[0],kg=e[1];
    var ins=idx[nome];
    if(!ins) return;
    hasAny=true;
    ins.estoque=Math.max(0,(Number(ins.estoque)||0)-kg);
  });
  if(!hasAny){
    toast('Nenhum insumo mapeado para baixar estoque');
    return;
  }
  saveInsumos();
  renderInsumos();
  renderProdKpis();
  toast('Estoque baixado');
}

function setProdTab(tab){
  ['insumos','ordens','simulador','receitas'].forEach(function(t){
    var el=document.getElementById('prod-tab-'+t);
    var btn=document.getElementById('ptab-'+t);
    if(el) el.style.display=t===tab?'':'none';
    if(btn) btn.classList.toggle('active-tab',t===tab);
  });
  if(tab==='insumos'){renderInsumos();renderProdKpis();}
  if(tab==='ordens') renderOrdens();
  if(tab==='simulador'){renderSimuladorInputs();var sr=document.getElementById('sim-resultado');if(sr)sr.innerHTML='';}
  if(tab==='receitas') renderReceitaDetalhe();
}

export {
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
  verDetalheOrdem,
  renderSimuladorInputs,
  calcularSimulador,
  salvarOrdemDeSimulacao,
  renderReceitaDetalhe,
  abrirModalInsumo,
  salvarInsumo,
  deletarInsumo,
  abrirNovaOrdem,
  abrirModalPedidoProd,
  salvarOrdem,
  deletarOrdem,
  setOrdemStatusQuick,
  baixarEstoqueDaOrdem,
  setProdTab
};

window.renderProdKpis = renderProdKpis;
window.renderInsumos = renderInsumos;
window.renderOrdens = renderOrdens;
window.verDetalheOrdem = verDetalheOrdem;
window.renderSimuladorInputs = renderSimuladorInputs;
window.calcularSimulador = calcularSimulador;
window.salvarOrdemDeSimulacao = salvarOrdemDeSimulacao;
window.renderReceitaDetalhe = renderReceitaDetalhe;
window.abrirModalInsumo = abrirModalInsumo;
window.salvarInsumo = salvarInsumo;
window.deletarInsumo = deletarInsumo;
window.abrirNovaOrdem = abrirNovaOrdem;
window.abrirModalPedidoProd = abrirModalPedidoProd;
window.salvarOrdem = salvarOrdem;
window.deletarOrdem = deletarOrdem;
window.setOrdemStatusQuick = setOrdemStatusQuick;
window.baixarEstoqueDaOrdem = baixarEstoqueDaOrdem;
window.setProdTab = setProdTab;
