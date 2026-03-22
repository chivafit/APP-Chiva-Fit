# Plano de Refatoração Ajustado: app.js → Arquitetura Modular

## 📊 Análise Crítica do Plano Original

### ❌ Problemas Identificados

1. **Redução tardia do app.js**: O plano deixava a refatoração do app.js para a Fase 7, mantendo o monólito até o final
2. **Ordem não priorizada por negócio**: Fases organizadas por tipo técnico (services, views, events) ao invés de por domínio
3. **Falta de entregáveis incrementais**: Cada fase era muito grande sem valor de negócio claro
4. **Risco de mini-monólitos**: Sem separação clara de responsabilidades entre controller/service/view
5. **Plano muito longo**: 7 fases sem marcos claros de progresso

### ✅ Ajustes Aplicados

1. **Redução incremental do app.js desde Sprint 1**
2. **Priorização por impacto de negócio**: customers → orders → dashboard → tasks
3. **Sprints executáveis** com entregáveis claros
4. **Separação estrita de responsabilidades** para evitar acoplamento
5. **Foco nas 3 primeiras sprints** com resultados tangíveis

---

## 🎯 Arquitetura Ajustada

### Princípios de Separação de Responsabilidades

```
┌─────────────────────────────────────────────────────────────┐
│                         app.js                              │
│              (Orquestrador - < 500 linhas)                  │
│  • Inicialização                                            │
│  • Registro de módulos                                      │
│  • Roteamento                                               │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   SERVICES   │    │   MODULES    │    │    SHARED    │
│              │    │              │    │              │
│ • Supabase   │◄───│ • Controller │    │ • Components │
│ • API calls  │    │ • View       │───►│ • Utils      │
│ • Sync       │    │ • Events     │    │ • Constants  │
│              │    │              │    │              │
│ Retorna      │    │ Orquestra    │    │ Reutilizável │
│ Promises     │    │ lógica       │    │ Genérico     │
└──────────────┘    └──────────────┘    └──────────────┘
```

### Regras Estritas por Camada

#### **Services** (Camada de Dados)
```javascript
// ✅ PODE
- Fazer queries ao Supabase
- Fazer chamadas HTTP
- Retornar Promises
- Tratar erros de rede/DB
- Transformar dados brutos

// ❌ NÃO PODE
- Manipular DOM
- Conhecer UI
- Importar de modules/
- Conter lógica de negócio
- Renderizar HTML
```

#### **Controllers** (Camada de Lógica)
```javascript
// ✅ PODE
- Orquestrar services
- Implementar regras de negócio
- Validar dados
- Decidir fluxo
- Chamar views

// ❌ NÃO PODE
- Fazer queries diretas ao Supabase
- Manipular DOM diretamente
- Renderizar HTML
- Adicionar event listeners
```

#### **Views** (Camada de Apresentação)
```javascript
// ✅ PODE
- Renderizar HTML
- Manipular DOM
- Formatar dados para exibição
- Retornar strings/elementos

// ❌ NÃO PODE
- Fazer queries ao Supabase
- Conter lógica de negócio
- Adicionar event listeners
- Fazer validações complexas
```

#### **Events** (Camada de Interação)
```javascript
// ✅ PODE
- Adicionar event listeners
- Capturar interações do usuário
- Chamar controllers
- Usar event delegation

// ❌ NÃO PODE
- Fazer queries ao Supabase
- Renderizar HTML
- Conter lógica de negócio
```

---

## 🗂️ Estrutura Final de Pastas

```
src/
├── core/
│   ├── app.js                          # Entry point (< 500 linhas)
│   ├── router.js                       # Roteamento SPA
│   ├── state.js                        # Estado global
│   └── init.js                         # Inicialização
│
├── services/
│   ├── supabase/
│   │   ├── client.js                   # Cliente Supabase
│   │   ├── customers.service.js        # CRUD clientes
│   │   ├── orders.service.js           # CRUD pedidos
│   │   ├── products.service.js         # CRUD produtos
│   │   ├── tasks.service.js            # CRUD tarefas
│   │   ├── insights.service.js         # CRUD insights
│   │   └── realtime.service.js         # Subscriptions
│   │
│   ├── analytics/
│   │   ├── views.service.js            # Views do banco
│   │   ├── kpis.service.js             # Cálculo de KPIs
│   │   └── reports.service.js          # Relatórios
│   │
│   ├── sync/
│   │   ├── bling.service.js            # Sync Bling
│   │   ├── yampi.service.js            # Sync Yampi
│   │   └── scheduler.service.js        # Agendamento
│   │
│   └── ai/
│       ├── intelligence.service.js     # IA/ML
│       └── recommendations.service.js  # Recomendações
│
├── modules/
│   ├── customers/                      # 🎯 SPRINT 1
│   │   ├── index.js                    # API pública
│   │   ├── customers.controller.js     # Lógica de negócio
│   │   ├── customers.view.js           # Renderização
│   │   ├── customers.events.js         # Event handlers
│   │   └── components/
│   │       ├── customer-list.js
│   │       ├── customer-profile.js
│   │       ├── customer-metrics.js
│   │       └── customer-insights.js
│   │
│   ├── orders/                         # 🎯 SPRINT 2
│   │   ├── index.js
│   │   ├── orders.controller.js
│   │   ├── orders.view.js
│   │   ├── orders.events.js
│   │   └── components/
│   │       ├── order-list.js
│   │       ├── order-detail.js
│   │       └── order-timeline.js
│   │
│   ├── dashboard/                      # 🎯 SPRINT 3
│   │   ├── index.js
│   │   ├── dashboard.controller.js
│   │   ├── dashboard.view.js
│   │   ├── dashboard.events.js
│   │   └── components/
│   │       ├── kpis-panel.js
│   │       ├── charts.js
│   │       └── filters.js
│   │
│   ├── tasks/                          # Sprint 4+
│   │   ├── index.js
│   │   ├── tasks.controller.js
│   │   ├── tasks.view.js
│   │   └── tasks.events.js
│   │
│   ├── production/                     # Já existe
│   │   └── (migrar de producao.js)
│   │
│   └── intelligence/                   # Já existe
│       └── (migrar de ia.js)
│
└── shared/
    ├── components/
    │   ├── modal.js                    # Modal reutilizável
    │   ├── toast.js                    # Notificações
    │   ├── table.js                    # Tabela genérica
    │   ├── form.js                     # Form helpers
    │   ├── loading.js                  # Loading states
    │   └── dropdown.js                 # Dropdown genérico
    │
    ├── utils/
    │   ├── date.utils.js               # Funções de data
    │   ├── format.utils.js             # Formatação
    │   ├── validation.utils.js         # Validações
    │   ├── dom.utils.js                # Helpers DOM
    │   └── array.utils.js              # Helpers array
    │
    ├── constants/
    │   ├── channels.constants.js       # Canais de venda
    │   ├── status.constants.js         # Status de pedidos
    │   └── colors.constants.js         # Paleta de cores
    │
    └── hooks/
        ├── useDebounce.js              # Debounce
        ├── useLocalStorage.js          # LocalStorage
        └── useRealtime.js              # Realtime subscriptions
```

---

## 🚀 Plano de Execução em Sprints

### **SPRINT 1: Módulo Customers** (5-7 dias)
**Objetivo**: Extrair toda lógica de clientes do app.js

**Redução do app.js**: ~3.000-4.000 linhas

#### Entregáveis

1. **Services**
   - `src/services/supabase/customers.service.js`
   - Funções: `getCustomers()`, `getCustomerById()`, `updateCustomer()`, `deleteCustomer()`

2. **Controller**
   - `src/modules/customers/customers.controller.js`
   - Funções: `loadCustomerList()`, `loadCustomerProfile()`, `updateCustomerData()`
   - Lógica: métricas, classificação, insights, recomendações

3. **View**
   - `src/modules/customers/customers.view.js`
   - Funções: `renderCustomerList()`, `renderCustomerProfile()`, `renderCustomerMetrics()`

4. **Events**
   - `src/modules/customers/customers.events.js`
   - Event delegation para lista e perfil

5. **Components**
   - `customer-list.js` - Lista de clientes
   - `customer-profile.js` - Perfil completo
   - `customer-metrics.js` - Métricas (LTV, ticket médio, etc)
   - `customer-insights.js` - Insights e recomendações

#### Funções a Extrair do app.js

```javascript
// SERVICES (app.js → customers.service.js)
- Todas as queries: supabase.from('v2_clientes')
- getCustomers()
- getCustomerById()
- updateCustomer()
- searchCustomers()

// CONTROLLER (app.js → customers.controller.js)
- getCustomerMetrics()           // linhas 99-158
- getCustomerOrdersStrict()      // linhas 165-189
- analyzeCustomerTrend()         // linhas 195-209
- classifyCustomer()             // linhas 215-240
- predictNextPurchase()          // linhas 246-276
- analyzePatterns()              // linhas 282-321
- calculateLTV()                 // linhas 327-347
- generateCustomerInsights()     // linhas 353-406
- generateRecommendations()      // linhas 412-464

// VIEW (app.js → customers.view.js)
- renderCustomerList()
- renderCustomerProfile()
- renderCustomerMetrics()
- renderCustomerInsights()

// EVENTS (app.js → customers.events.js)
- Event listeners de clientes
- Handlers de clique em lista
- Handlers de formulários
```

#### Checklist de Execução

- [ ] Criar estrutura de pastas `src/modules/customers/`
- [ ] Extrair `customers.service.js` (queries Supabase)
- [ ] Extrair `customers.controller.js` (lógica de negócio)
- [ ] Extrair `customers.view.js` (renderização)
- [ ] Extrair `customers.events.js` (event listeners)
- [ ] Criar `index.js` exportando API pública
- [ ] Atualizar imports no `app.js`
- [ ] Remover código extraído do `app.js`
- [ ] Testar lista de clientes
- [ ] Testar perfil de cliente
- [ ] Testar métricas e insights
- [ ] Verificar que nada quebrou

#### Exemplo Prático: Extrair getCustomerMetrics

**ANTES** (app.js - linhas 99-158):
```javascript
function getCustomerMetrics(customerId, context = {}) {
  const customerIdCanonical = String(customerId || '').trim();
  if (!customerIdCanonical) {
    console.warn('[getCustomerMetrics] customerId vazio');
    return { total_gasto: 0, total_pedidos: 0, ultimo_pedido: null, ticket_medio: 0, _source: 'invalid_input' };
  }
  
  // Busca por UUID canônico no cache
  const intelData = clientesIntelCache.find(c => 
    String(c.cliente_id || '') === customerIdCanonical
  );
  
  if (intelData) {
    const total = Number(intelData.total_gasto || intelData.ltv || 0) || 0;
    const pedidos = Number(intelData.total_pedidos || 0) || 0;
    const ticket = pedidos > 0 ? total / pedidos : 0;
    const ultimo = intelData.ultimo_pedido || intelData.last || null;
    
    return {
      total_gasto: total,
      total_pedidos: pedidos,
      ultimo_pedido: ultimo,
      ticket_medio: ticket,
      _source: 'cache'
    };
  }
  
  // Fallback
  const customer = allCustomers.find(c => String(c.id || '') === customerIdCanonical);
  if (!customer) {
    return { total_gasto: 0, total_pedidos: 0, ultimo_pedido: null, ticket_medio: 0, _source: 'not_found' };
  }
  
  const orders = allOrders
    .filter((o) => orderCustomerKey(o) === customer.id)
    .slice()
    .sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
  
  const total = orders.reduce((s, o) => s + val(o), 0);
  const pedidos = orders.length;
  const ticket = pedidos > 0 ? total / pedidos : 0;
  const ultimo = orders[0]?.data || null;
  
  return {
    total_gasto: total,
    total_pedidos: pedidos,
    ultimo_pedido: ultimo,
    ticket_medio: ticket,
    _source: 'fallback'
  };
}
```

**DEPOIS**:

```javascript
// src/modules/customers/customers.controller.js
import { getCustomerOrders } from '../../services/supabase/orders.service.js';
import { state } from '../../core/state.js';

export function getCustomerMetrics(customerId, context = {}) {
  const customerIdCanonical = String(customerId || '').trim();
  
  if (!customerIdCanonical) {
    console.warn('[getCustomerMetrics] customerId vazio');
    return createEmptyMetrics('invalid_input');
  }
  
  // 1. Busca no cache de inteligência
  const metricsFromCache = getMetricsFromIntelCache(customerIdCanonical);
  if (metricsFromCache) {
    return metricsFromCache;
  }
  
  // 2. Fallback: calcular a partir de pedidos
  return calculateMetricsFromOrders(customerIdCanonical);
}

function createEmptyMetrics(source) {
  return {
    total_gasto: 0,
    total_pedidos: 0,
    ultimo_pedido: null,
    ticket_medio: 0,
    _source: source
  };
}

function getMetricsFromIntelCache(customerId) {
  const intelData = state.clientesIntelCache.find(c => 
    String(c.cliente_id || '') === customerId
  );
  
  if (!intelData) return null;
  
  const total = Number(intelData.total_gasto || intelData.ltv || 0) || 0;
  const pedidos = Number(intelData.total_pedidos || 0) || 0;
  const ticket = pedidos > 0 ? total / pedidos : 0;
  const ultimo = intelData.ultimo_pedido || intelData.last || null;
  
  console.log(`[getCustomerMetrics] Cache hit: customerId=${customerId}`);
  
  return {
    total_gasto: total,
    total_pedidos: pedidos,
    ultimo_pedido: ultimo,
    ticket_medio: ticket,
    _source: 'cache'
  };
}

function calculateMetricsFromOrders(customerId) {
  const customer = state.allCustomers.find(c => String(c.id || '') === customerId);
  
  if (!customer) {
    console.error(`[getCustomerMetrics] Cliente não encontrado: ${customerId}`);
    return createEmptyMetrics('not_found');
  }
  
  const orders = state.allOrders
    .filter((o) => String(o.cliente_id || '') === customerId)
    .sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));
  
  const total = orders.reduce((sum, o) => Number(o.total || 0), 0);
  const pedidos = orders.length;
  const ticket = pedidos > 0 ? total / pedidos : 0;
  const ultimo = orders[0]?.data || null;
  
  console.log(`[getCustomerMetrics] Fallback: customerId=${customerId}`);
  
  return {
    total_gasto: total,
    total_pedidos: pedidos,
    ultimo_pedido: ultimo,
    ticket_medio: ticket,
    _source: 'fallback'
  };
}

// app.js (reduzido)
import { getCustomerMetrics } from './src/modules/customers/customers.controller.js';
// Apenas usa a função, não a define mais
```

**Redução**: ~60 linhas removidas do app.js

---

### **SPRINT 2: Módulo Orders** (5-7 dias)
**Objetivo**: Extrair toda lógica de pedidos do app.js

**Redução do app.js**: ~2.500-3.500 linhas

#### Entregáveis

1. **Services**
   - `src/services/supabase/orders.service.js`
   - Funções: `getOrders()`, `getOrderById()`, `getCustomerOrders()`, `updateOrder()`

2. **Controller**
   - `src/modules/orders/orders.controller.js`
   - Funções: `loadOrderList()`, `loadOrderDetail()`, `calculateOrderMetrics()`
   - Lógica: cálculo de totais, status, timeline

3. **View**
   - `src/modules/orders/orders.view.js`
   - Funções: `renderOrderList()`, `renderOrderDetail()`, `renderOrderTimeline()`

4. **Events**
   - `src/modules/orders/orders.events.js`
   - Event delegation para lista e detalhes

5. **Components**
   - `order-list.js` - Lista de pedidos
   - `order-detail.js` - Detalhes do pedido
   - `order-timeline.js` - Timeline de status

#### Funções a Extrair do app.js

```javascript
// SERVICES (app.js → orders.service.js)
- Todas as queries: supabase.from('v2_pedidos')
- getOrders()
- getOrderById()
- getCustomerOrders()
- updateOrderStatus()

// CONTROLLER (app.js → orders.controller.js)
- loadOrderList()
- loadOrderDetail()
- calculateOrderMetrics()
- detectOrderChannel()
- getOrderTimeline()

// VIEW (app.js → orders.view.js)
- renderOrderList()
- renderOrderDetail()
- renderOrderItems()
- renderOrderTimeline()

// EVENTS (app.js → orders.events.js)
- Event listeners de pedidos
- Handlers de filtros
- Handlers de status
```

#### Checklist de Execução

- [ ] Criar estrutura `src/modules/orders/`
- [ ] Extrair `orders.service.js`
- [ ] Extrair `orders.controller.js`
- [ ] Extrair `orders.view.js`
- [ ] Extrair `orders.events.js`
- [ ] Criar components
- [ ] Atualizar imports no `app.js`
- [ ] Remover código extraído
- [ ] Testar lista de pedidos
- [ ] Testar detalhes de pedido
- [ ] Testar filtros
- [ ] Verificar integração com customers

---

### **SPRINT 3: Módulo Dashboard** (5-7 dias)
**Objetivo**: Extrair toda lógica do dashboard do app.js

**Redução do app.js**: ~2.000-3.000 linhas

#### Entregáveis

1. **Services**
   - `src/services/analytics/kpis.service.js`
   - Funções: `calculateDashboardKPIs()`, `getDailyMetrics()`, `getChannelMetrics()`

2. **Controller**
   - `src/modules/dashboard/dashboard.controller.js`
   - Funções: `loadDashboard()`, `applyFilters()`, `refreshKPIs()`

3. **View**
   - `src/modules/dashboard/dashboard.view.js`
   - Funções: `renderDashboard()`, `renderKPIs()`, `renderCharts()`

4. **Events**
   - `src/modules/dashboard/dashboard.events.js`
   - Event listeners de filtros e período

5. **Components**
   - `kpis-panel.js` - Painel de KPIs
   - `charts.js` - Gráficos (Chart.js)
   - `filters.js` - Filtros de período

#### Funções a Extrair do app.js

```javascript
// SERVICES (app.js → kpis.service.js)
- getDashboardKpis()
- getDashboardDaily()
- getDashboardDailyChannel()
- getNewCustomersDaily()

// CONTROLLER (app.js → dashboard.controller.js)
- loadDashboard()
- calculateKPIs()
- applyDateFilter()
- refreshCharts()

// VIEW (app.js → dashboard.view.js)
- renderDashboard()
- renderKPIsPanel()
- renderRevenueChart()
- renderOrdersChart()
- renderChannelChart()

// EVENTS (app.js → dashboard.events.js)
- Event listeners de filtros
- Handlers de período
- Handlers de refresh
```

#### Checklist de Execução

- [ ] Criar estrutura `src/modules/dashboard/`
- [ ] Extrair `kpis.service.js`
- [ ] Extrair `dashboard.controller.js`
- [ ] Extrair `dashboard.view.js`
- [ ] Extrair `dashboard.events.js`
- [ ] Criar components
- [ ] Atualizar imports no `app.js`
- [ ] Remover código extraído
- [ ] Testar KPIs
- [ ] Testar gráficos
- [ ] Testar filtros
- [ ] Verificar performance

---

## 📐 Exemplo Completo: Módulo Customers

### Estrutura de Arquivos

```
src/modules/customers/
├── index.js                    # API pública do módulo
├── customers.controller.js     # Lógica de negócio
├── customers.view.js           # Renderização
├── customers.events.js         # Event handlers
└── components/
    ├── customer-list.js
    ├── customer-profile.js
    ├── customer-metrics.js
    └── customer-insights.js
```

### 1. Service Layer

```javascript
// src/services/supabase/customers.service.js
import { supabase } from './client.js';

/**
 * Busca todos os clientes
 */
export async function getCustomers(filters = {}) {
  let query = supabase
    .from('v2_clientes')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (filters.search) {
    query = query.or(`nome.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
  }
  
  if (filters.segment) {
    query = query.eq('segment', filters.segment);
  }
  
  const { data, error } = await query;
  
  if (error) throw error;
  return data;
}

/**
 * Busca cliente por ID
 */
export async function getCustomerById(id) {
  const { data, error } = await supabase
    .from('v2_clientes')
    .select('*')
    .eq('id', id)
    .single();
  
  if (error) throw error;
  return data;
}

/**
 * Atualiza dados do cliente
 */
export async function updateCustomer(id, updates) {
  const { data, error } = await supabase
    .from('v2_clientes')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

/**
 * Deleta cliente
 */
export async function deleteCustomer(id) {
  const { error } = await supabase
    .from('v2_clientes')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
}
```

### 2. Controller Layer

```javascript
// src/modules/customers/customers.controller.js
import { getCustomers, getCustomerById } from '../../services/supabase/customers.service.js';
import { getCustomerOrders } from '../../services/supabase/orders.service.js';
import { renderCustomerList, renderCustomerProfile } from './customers.view.js';
import { showToast } from '../../shared/components/toast.js';
import { state } from '../../core/state.js';

/**
 * Carrega lista de clientes
 */
export async function loadCustomerList(filters = {}) {
  try {
    const customers = await getCustomers(filters);
    
    // Enriquecer com métricas
    const enrichedCustomers = customers.map(customer => ({
      ...customer,
      metrics: getCustomerMetrics(customer.id),
      classification: classifyCustomer(customer.id)
    }));
    
    renderCustomerList(enrichedCustomers);
    
    return enrichedCustomers;
  } catch (error) {
    console.error('[loadCustomerList] Erro:', error);
    showToast('Erro ao carregar clientes', 'error');
    throw error;
  }
}

/**
 * Carrega perfil completo do cliente
 */
export async function loadCustomerProfile(customerId) {
  try {
    const [customer, orders] = await Promise.all([
      getCustomerById(customerId),
      getCustomerOrders(customerId)
    ]);
    
    const metrics = getCustomerMetrics(customerId);
    const classification = classifyCustomer(customerId);
    const trend = analyzeCustomerTrend(orders);
    const prediction = predictNextPurchase(metrics, orders);
    const patterns = analyzePatterns(orders);
    const insights = generateCustomerInsights(customer, orders, metrics, classification, trend, prediction);
    const recommendations = generateRecommendations(customer, orders, metrics, insights, prediction, patterns);
    
    const profileData = {
      customer,
      orders,
      metrics,
      classification,
      trend,
      prediction,
      patterns,
      insights,
      recommendations
    };
    
    renderCustomerProfile(profileData);
    
    return profileData;
  } catch (error) {
    console.error('[loadCustomerProfile] Erro:', error);
    showToast('Erro ao carregar perfil', 'error');
    throw error;
  }
}

/**
 * Calcula métricas do cliente
 */
export function getCustomerMetrics(customerId) {
  const customerIdCanonical = String(customerId || '').trim();
  
  if (!customerIdCanonical) {
    return createEmptyMetrics('invalid_input');
  }
  
  // Busca no cache de inteligência
  const metricsFromCache = getMetricsFromIntelCache(customerIdCanonical);
  if (metricsFromCache) {
    return metricsFromCache;
  }
  
  // Fallback: calcular a partir de pedidos
  return calculateMetricsFromOrders(customerIdCanonical);
}

/**
 * Classifica cliente (VIP, Regular, Novo, Em Risco)
 */
export function classifyCustomer(customerId) {
  const metrics = getCustomerMetrics(customerId);
  const orders = state.allOrders.filter(o => o.cliente_id === customerId);
  
  if (orders.length === 0) {
    return { segment: 'novo', icon: '🌱', label: 'Novo', color: 'var(--blue)' };
  }
  
  const avgInterval = calculateAverageInterval(orders);
  const daysSinceLastOrder = calculateDaysSinceLastOrder(orders);
  
  // VIP: gasta 2x+ acima da média
  const avgTotalGasto = calculateAverageSpending();
  if (metrics.total_gasto >= avgTotalGasto * 2) {
    return { segment: 'vip', icon: '🏆', label: 'VIP', color: 'var(--gold)' };
  }
  
  // Em risco: dias sem comprar > intervalo médio + 50%
  if (avgInterval && daysSinceLastOrder > avgInterval * 1.5) {
    return { segment: 'em_risco', icon: '⚠️', label: 'Em Risco', color: 'var(--red)' };
  }
  
  // Novo: menos de 3 pedidos
  if (orders.length < 3) {
    return { segment: 'novo', icon: '🌱', label: 'Novo', color: 'var(--blue)' };
  }
  
  // Regular
  return { segment: 'regular', icon: '✅', label: 'Regular', color: 'var(--green)' };
}

/**
 * Analisa tendência de compras
 */
export function analyzeCustomerTrend(orders) {
  if (orders.length < 4) {
    return { trend: 'insuficiente', change: 0, label: 'Dados insuficientes' };
  }
  
  const recent = orders.slice(0, 3).map(o => Number(o.total || 0));
  const previous = orders.slice(3, 6).map(o => Number(o.total || 0));
  
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const previousAvg = previous.reduce((a, b) => a + b, 0) / previous.length;
  
  const change = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;
  
  if (change > 10) {
    return { trend: 'crescente', change, label: `+${change.toFixed(0)}% nos últimos pedidos` };
  }
  if (change < -10) {
    return { trend: 'decrescente', change, label: `${change.toFixed(0)}% nos últimos pedidos` };
  }
  return { trend: 'estavel', change, label: 'Estável' };
}

/**
 * Prevê próxima compra
 */
export function predictNextPurchase(metrics, orders) {
  if (!orders.length) {
    return { predicted: null, status: 'indefinido', daysUntil: null, label: 'Sem dados' };
  }
  
  const avgInterval = calculateAverageInterval(orders);
  const lastOrder = orders[0];
  
  if (!lastOrder || !avgInterval) {
    return { predicted: null, status: 'indefinido', daysUntil: null, label: 'Sem dados suficientes' };
  }
  
  const lastDate = new Date(lastOrder.data);
  const predictedDate = new Date(lastDate.getTime() + avgInterval * 24 * 60 * 60 * 1000);
  const today = new Date();
  const daysUntil = Math.ceil((predictedDate - today) / (24 * 60 * 60 * 1000));
  
  let status, label, icon;
  if (daysUntil < -3) {
    status = 'atrasado';
    label = `Atrasado ${Math.abs(daysUntil)} dias`;
    icon = '🔴';
  } else if (daysUntil <= 0) {
    status = 'previsto_agora';
    label = 'Previsto para agora';
    icon = '🎯';
  } else if (daysUntil <= 7) {
    status = 'proximo';
    label = `Em ${daysUntil} dias`;
    icon = '🟡';
  } else {
    status = 'futuro';
    label = `Em ${daysUntil} dias`;
    icon = '🟢';
  }
  
  return { predicted: predictedDate, status, daysUntil, label, icon };
}

/**
 * Analisa padrões de compra
 */
export function analyzePatterns(orders) {
  if (!orders.length) return null;
  
  // Canal preferido
  const channelCount = {};
  orders.forEach(o => {
    const channel = o.canal || 'outros';
    channelCount[channel] = (channelCount[channel] || 0) + 1;
  });
  const topChannel = Object.entries(channelCount).sort((a, b) => b[1] - a[1])[0];
  
  return {
    channel: topChannel ? {
      name: topChannel[0],
      count: topChannel[1],
      pct: Math.round(topChannel[1] / orders.length * 100)
    } : null
  };
}

/**
 * Gera insights inteligentes
 */
export function generateCustomerInsights(customer, orders, metrics, classification, trend, prediction) {
  const insights = [];
  
  if (classification.segment === 'vip') {
    insights.push({
      icon: '🏆',
      title: 'Cliente VIP',
      desc: `Gasta acima da média`,
      type: 'success'
    });
  }
  
  if (prediction.status === 'atrasado') {
    insights.push({
      icon: '⚠️',
      title: 'Risco de Churn',
      desc: prediction.label,
      type: 'warning',
      action: 'Enviar mensagem de reengajamento'
    });
  }
  
  if (trend.trend === 'crescente') {
    insights.push({
      icon: '📈',
      title: 'Tendência Crescente',
      desc: trend.label,
      type: 'success'
    });
  }
  
  return insights;
}

/**
 * Gera recomendações
 */
export function generateRecommendations(customer, orders, metrics, insights, prediction, patterns) {
  const recommendations = [];
  
  if (prediction.status === 'atrasado') {
    recommendations.push({
      priority: 'urgent',
      icon: '🎯',
      title: 'Ação Urgente',
      desc: `Cliente atrasado ${Math.abs(prediction.daysUntil)} dias. Envie mensagem com oferta especial.`,
      action: 'whatsapp',
      actionLabel: 'Enviar WhatsApp'
    });
  }
  
  if (prediction.status === 'proximo') {
    recommendations.push({
      priority: 'high',
      icon: '📅',
      title: 'Próxima Compra Prevista',
      desc: `Cliente deve comprar ${prediction.label}. Prepare oferta personalizada.`,
      action: 'prepare_offer',
      actionLabel: 'Criar Oferta'
    });
  }
  
  return recommendations;
}

// Helper functions
function createEmptyMetrics(source) {
  return {
    total_gasto: 0,
    total_pedidos: 0,
    ultimo_pedido: null,
    ticket_medio: 0,
    _source: source
  };
}

function getMetricsFromIntelCache(customerId) {
  const intelData = state.clientesIntelCache.find(c => 
    String(c.cliente_id || '') === customerId
  );
  
  if (!intelData) return null;
  
  const total = Number(intelData.total_gasto || 0);
  const pedidos = Number(intelData.total_pedidos || 0);
  const ticket = pedidos > 0 ? total / pedidos : 0;
  const ultimo = intelData.ultimo_pedido || null;
  
  return {
    total_gasto: total,
    total_pedidos: pedidos,
    ultimo_pedido: ultimo,
    ticket_medio: ticket,
    _source: 'cache'
  };
}

function calculateMetricsFromOrders(customerId) {
  const orders = state.allOrders.filter(o => o.cliente_id === customerId);
  
  const total = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const pedidos = orders.length;
  const ticket = pedidos > 0 ? total / pedidos : 0;
  const ultimo = orders[0]?.data || null;
  
  return {
    total_gasto: total,
    total_pedidos: pedidos,
    ultimo_pedido: ultimo,
    ticket_medio: ticket,
    _source: 'calculated'
  };
}

function calculateAverageInterval(orders) {
  if (orders.length < 2) return null;
  
  const intervals = [];
  for (let i = 0; i < orders.length - 1; i++) {
    const date1 = new Date(orders[i].data);
    const date2 = new Date(orders[i + 1].data);
    const diff = Math.abs(date1 - date2) / (24 * 60 * 60 * 1000);
    intervals.push(diff);
  }
  
  return intervals.reduce((a, b) => a + b, 0) / intervals.length;
}

function calculateDaysSinceLastOrder(orders) {
  if (!orders.length) return null;
  
  const lastOrder = orders[0];
  const lastDate = new Date(lastOrder.data);
  const today = new Date();
  
  return Math.floor((today - lastDate) / (24 * 60 * 60 * 1000));
}

function calculateAverageSpending() {
  const allMetrics = state.allCustomers.map(c => getCustomerMetrics(c.id));
  return allMetrics.reduce((sum, m) => sum + m.total_gasto, 0) / allMetrics.length;
}
```

### 3. View Layer

```javascript
// src/modules/customers/customers.view.js
import { escapeHTML } from '../../shared/utils/dom.utils.js';
import { fmtMoney, fmtDateBr } from '../../shared/utils/format.utils.js';
import { renderCustomerListComponent } from './components/customer-list.js';
import { renderCustomerProfileComponent } from './components/customer-profile.js';

/**
 * Renderiza lista de clientes
 */
export function renderCustomerList(customers) {
  const container = document.getElementById('customer-list');
  if (!container) {
    console.error('[renderCustomerList] Container não encontrado');
    return;
  }
  
  container.innerHTML = renderCustomerListComponent(customers);
}

/**
 * Renderiza perfil do cliente
 */
export function renderCustomerProfile(profileData) {
  const container = document.getElementById('customer-profile');
  if (!container) {
    console.error('[renderCustomerProfile] Container não encontrado');
    return;
  }
  
  container.innerHTML = renderCustomerProfileComponent(profileData);
}
```

### 4. Events Layer

```javascript
// src/modules/customers/customers.events.js
import { loadCustomerProfile, loadCustomerList } from './customers.controller.js';
import { showModal } from '../../shared/components/modal.js';

/**
 * Registra event listeners do módulo customers
 */
export function bindCustomerEvents() {
  bindListEvents();
  bindSearchEvents();
  bindFilterEvents();
}

/**
 * Event delegation para lista de clientes
 */
function bindListEvents() {
  const container = document.getElementById('customer-list');
  if (!container) return;
  
  container.addEventListener('click', (e) => {
    const card = e.target.closest('[data-customer-id]');
    if (card) {
      const customerId = card.dataset.customerId;
      loadCustomerProfile(customerId);
    }
  });
}

/**
 * Event listeners de busca
 */
function bindSearchEvents() {
  const searchInput = document.getElementById('customer-search');
  if (!searchInput) return;
  
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const search = e.target.value;
      loadCustomerList({ search });
    }, 300);
  });
}

/**
 * Event listeners de filtros
 */
function bindFilterEvents() {
  const filterSelect = document.getElementById('customer-filter');
  if (!filterSelect) return;
  
  filterSelect.addEventListener('change', (e) => {
    const segment = e.target.value;
    loadCustomerList({ segment });
  });
}
```

### 5. Public API (index.js)

```javascript
// src/modules/customers/index.js
export {
  loadCustomerList,
  loadCustomerProfile,
  getCustomerMetrics,
  classifyCustomer,
  analyzeCustomerTrend,
  predictNextPurchase,
  analyzePatterns,
  generateCustomerInsights,
  generateRecommendations
} from './customers.controller.js';

export {
  renderCustomerList,
  renderCustomerProfile
} from './customers.view.js';

export {
  bindCustomerEvents
} from './customers.events.js';

/**
 * Inicializa módulo de clientes
 */
export function initCustomersModule() {
  console.log('[Customers] Módulo inicializado');
  bindCustomerEvents();
}
```

### 6. app.js (Reduzido)

```javascript
// app.js (DEPOIS da Sprint 1)
import { initCustomersModule } from './src/modules/customers/index.js';

// Inicializar módulos
initCustomersModule();

// app.js agora tem ~16.000 linhas (redução de ~3.000 linhas)
```

---

## ⚠️ Recomendações para Evitar Regressões

### 1. **Testes Manuais Obrigatórios**

Após cada sprint, testar:

**Sprint 1 (Customers)**:
- [ ] Listar clientes
- [ ] Buscar cliente
- [ ] Filtrar por segmento
- [ ] Abrir perfil de cliente
- [ ] Visualizar métricas
- [ ] Visualizar insights
- [ ] Visualizar recomendações
- [ ] Editar dados do cliente

**Sprint 2 (Orders)**:
- [ ] Listar pedidos
- [ ] Filtrar pedidos
- [ ] Abrir detalhes do pedido
- [ ] Visualizar itens do pedido
- [ ] Visualizar timeline
- [ ] Integração com perfil de cliente

**Sprint 3 (Dashboard)**:
- [ ] Carregar KPIs
- [ ] Visualizar gráficos
- [ ] Aplicar filtros de período
- [ ] Atualizar dados
- [ ] Performance de carregamento

### 2. **Estratégia de Branches**

```bash
# Branch principal
main

# Branch de desenvolvimento
develop

# Branches de sprint
feature/sprint-1-customers
feature/sprint-2-orders
feature/sprint-3-dashboard

# Workflow
1. Criar branch da sprint a partir de develop
2. Desenvolver e testar na branch
3. Merge para develop
4. Testar em develop
5. Merge para main (produção)
```

### 3. **Checklist de Segurança**

Antes de cada merge:

- [ ] Código compila sem erros
- [ ] Nenhum console.error em produção
- [ ] Imports corretos
- [ ] Nenhuma variável global não intencional
- [ ] Event listeners não duplicados
- [ ] Memória não vaza (verificar DevTools)
- [ ] Performance aceitável (< 3s carregamento)
- [ ] Funcionalidades testadas manualmente
- [ ] Código revisado por outro desenvolvedor

### 4. **Rollback Plan**

Se algo quebrar:

```bash
# Reverter último commit
git revert HEAD

# Ou voltar para commit específico
git reset --hard <commit-hash>

# Deploy da versão anterior
git push origin main --force
```

### 5. **Monitoramento em Produção**

Após cada deploy:

- [ ] Verificar Sentry para erros
- [ ] Verificar Vercel Analytics para performance
- [ ] Verificar logs do Supabase
- [ ] Monitorar feedback de usuários
- [ ] Verificar métricas de uso

### 6. **Feature Flags (Opcional)**

Para deploys mais seguros:

```javascript
// src/core/config.js
export const FEATURE_FLAGS = {
  USE_NEW_CUSTOMERS_MODULE: true,  // Sprint 1
  USE_NEW_ORDERS_MODULE: false,    // Sprint 2
  USE_NEW_DASHBOARD_MODULE: false  // Sprint 3
};

// app.js
if (FEATURE_FLAGS.USE_NEW_CUSTOMERS_MODULE) {
  initCustomersModule();
} else {
  // Código legado
}
```

### 7. **Documentação de Mudanças**

Manter changelog:

```markdown
# CHANGELOG.md

## Sprint 1 - Módulo Customers (2026-03-25)
### Added
- Módulo customers com service/controller/view/events
- Componentes: customer-list, customer-profile, customer-metrics, customer-insights

### Changed
- app.js reduzido de 19.621 para ~16.000 linhas

### Removed
- Funções de clientes movidas para src/modules/customers/

### Migration Notes
- Atualizar imports: `import { loadCustomerList } from './src/modules/customers/index.js'`
```

---

## 📊 Métricas de Sucesso

### Por Sprint

| Sprint | Linhas Removidas | Linhas Restantes | Módulos Criados | Testes Passando |
|--------|------------------|------------------|-----------------|-----------------|
| 0 (Inicial) | 0 | 19.621 | 0 | - |
| 1 (Customers) | ~3.500 | ~16.000 | 1 | ✅ |
| 2 (Orders) | ~3.000 | ~13.000 | 2 | ✅ |
| 3 (Dashboard) | ~2.500 | ~10.500 | 3 | ✅ |

### Objetivo Final (após todas as sprints)

- **app.js**: < 500 linhas (apenas orquestração)
- **Módulos**: ~8-10 módulos independentes
- **Testabilidade**: Alta (services isolados)
- **Manutenibilidade**: Alta (código organizado por domínio)
- **Performance**: Bundle inicial < 200KB (com code splitting)

---

## 🎯 Próximos Passos Imediatos

1. **Revisar este plano** com o time técnico
2. **Aprovar arquitetura** e separação de responsabilidades
3. **Criar branch** `feature/sprint-1-customers`
4. **Iniciar Sprint 1** seguindo checklist
5. **Testar exaustivamente** antes de merge
6. **Deploy em staging** primeiro
7. **Monitorar** por 24-48h
8. **Deploy em produção** se tudo OK

---

**Última atualização**: 2026-03-21  
**Versão**: 2.0 (Ajustada)  
**Status**: Pronta para Execução
