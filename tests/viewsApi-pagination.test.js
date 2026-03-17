import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getClientesVipRisco,
  getClientesReativacao,
  getClientesSemContato,
  getDashboardDailyChannel,
} from '../viewsApi.js';

// ── Helpers ──────────────────────────────────────────
function makeRow(overrides = {}) {
  return {
    cliente_id: 'cli-1',
    nome: 'Test User',
    email: 'test@example.com',
    telefone: '11999990000',
    celular: '11999990000',
    cidade: 'São Paulo',
    uf: 'SP',
    canal_principal: 'bling',
    total_pedidos: 10,
    receita_total: 1500,
    ticket_medio: 150,
    ltv_medio: 1500,
    score_recompra: 70,
    risco_churn: 20,
    dias_sem_comprar: 45,
    segmento_crm: 'VIP',
    next_best_action: 'reativacao',
    last_contact_at: null,
    responsible_user: 'admin',
    ...overrides,
  };
}

/**
 * Creates a mock Supabase client that captures the query chain and returns
 * a specified result from the terminal call (.limit()).
 */
function makeClient(result = { data: [], error: null }) {
  const spy = {
    calls: [],
    filters: {},
  };

  const chain = new Proxy(
    {},
    {
      get(_, method) {
        return (...args) => {
          spy.calls.push({ method, args });
          if (method === 'limit' || method === 'maybeSingle') {
            return Promise.resolve(result);
          }
          return chain;
        };
      },
    },
  );

  const client = {
    _spy: spy,
    from: vi.fn(() => chain),
  };

  return client;
}

// ──────────────────────────────────────────────────────
// getClientesVipRisco — server-side filters
// ──────────────────────────────────────────────────────
describe('getClientesVipRisco', () => {
  it('returns empty array on Supabase error', async () => {
    const client = makeClient({ data: null, error: new Error('db error') });
    const result = await getClientesVipRisco(client, 5);
    expect(result).toEqual([]);
  });

  it('returns empty array when no matching rows', async () => {
    const client = makeClient({ data: [], error: null });
    const result = await getClientesVipRisco(client, 5);
    expect(result).toEqual([]);
  });

  it('respects the limit parameter', async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow({ cliente_id: `cli-${i}`, dias_sem_comprar: 40 + i, ltv_medio: 700 }),
    );
    const client = makeClient({ data: rows, error: null });
    const result = await getClientesVipRisco(client, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('sorts by dias_sem_comprar descending, then ltv_medio descending', async () => {
    const rows = [
      makeRow({ cliente_id: 'a', dias_sem_comprar: 40, ltv_medio: 800 }),
      makeRow({ cliente_id: 'b', dias_sem_comprar: 90, ltv_medio: 700 }),
      makeRow({ cliente_id: 'c', dias_sem_comprar: 90, ltv_medio: 900 }),
    ];
    const client = makeClient({ data: rows, error: null });
    const result = await getClientesVipRisco(client, 3);
    // c comes first: same dias_sem_comprar as b but higher ltv_medio
    expect(result[0].cliente_id).toBe('c');
    expect(result[1].cliente_id).toBe('b');
    expect(result[2].cliente_id).toBe('a');
  });

  it('filters out rows without cliente_id', async () => {
    const rows = [
      makeRow({ cliente_id: '' }),
      makeRow({ cliente_id: 'valid-1' }),
    ];
    const client = makeClient({ data: rows, error: null });
    const result = await getClientesVipRisco(client, 10);
    expect(result.every((r) => r.cliente_id)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────
// getClientesReativacao — server-side filters
// ──────────────────────────────────────────────────────
describe('getClientesReativacao', () => {
  it('returns empty array on error', async () => {
    const client = makeClient({ data: null, error: new Error('fail') });
    expect(await getClientesReativacao(client, 5)).toEqual([]);
  });

  it('returns empty array for empty data', async () => {
    const client = makeClient({ data: [], error: null });
    expect(await getClientesReativacao(client, 5)).toEqual([]);
  });

  it('respects limit', async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow({ cliente_id: `cli-${i}`, dias_sem_comprar: 70, ltv_medio: 1000 - i * 10 }),
    );
    const client = makeClient({ data: rows, error: null });
    const result = await getClientesReativacao(client, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('sorts by ltv_medio descending', async () => {
    const rows = [
      makeRow({ cliente_id: 'a', ltv_medio: 500, dias_sem_comprar: 80 }),
      makeRow({ cliente_id: 'b', ltv_medio: 2000, dias_sem_comprar: 80 }),
    ];
    const client = makeClient({ data: rows, error: null });
    const result = await getClientesReativacao(client, 10);
    expect(result[0].cliente_id).toBe('b');
  });
});

// ──────────────────────────────────────────────────────
// getClientesSemContato — server-side pre-filter + JS classification
// ──────────────────────────────────────────────────────
describe('getClientesSemContato', () => {
  it('returns empty array on error', async () => {
    const client = makeClient({ data: null, error: new Error('fail') });
    expect(await getClientesSemContato(client, 5)).toEqual([]);
  });

  it('classifies "sem contato registrado" when last_contact_at is null', async () => {
    const rows = [makeRow({ last_contact_at: null })];
    const client = makeClient({ data: rows, error: null });
    const result = await getClientesSemContato(client, 10);
    expect(result[0].motivo).toBe('sem contato registrado');
  });

  it('classifies "30+ dias sem contato" for old contact date', async () => {
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString();
    const rows = [makeRow({ last_contact_at: oldDate })];
    const client = makeClient({ data: rows, error: null });
    const result = await getClientesSemContato(client, 10);
    expect(result[0].motivo).toBe('30+ dias sem contato');
  });

  it('classifies "sem whatsapp/email" when both are missing', async () => {
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString();
    const rows = [makeRow({ telefone: '', celular: '', email: '', last_contact_at: oldDate })];
    const client = makeClient({ data: rows, error: null });
    const result = await getClientesSemContato(client, 10);
    expect(result[0].motivo).toBe('sem whatsapp/email');
  });

  it('excludes rows with recent contact', async () => {
    const recentDate = new Date(Date.now() - 5 * 86400000).toISOString();
    const rows = [makeRow({ last_contact_at: recentDate })];
    const client = makeClient({ data: rows, error: null });
    const result = await getClientesSemContato(client, 10);
    expect(result).toHaveLength(0);
  });

  it('respects limit', async () => {
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString();
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow({ cliente_id: `cli-${i}`, last_contact_at: oldDate }),
    );
    const client = makeClient({ data: rows, error: null });
    const result = await getClientesSemContato(client, 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────────────
// getDashboardDailyChannel — reduced limit
// ──────────────────────────────────────────────────────
describe('getDashboardDailyChannel', () => {
  it('returns empty array on error', async () => {
    const client = makeClient({ data: null, error: new Error('fail') });
    const result = await getDashboardDailyChannel(client, '2024-01-01', '2024-03-01');
    expect(result).toEqual([]);
  });

  it('returns rows when query succeeds', async () => {
    const rows = [
      { dia: '2024-01-01', canal: 'bling', pedidos: 5, faturamento: 500 },
    ];
    const client = makeClient({ data: rows, error: null });
    const result = await getDashboardDailyChannel(client, '2024-01-01', '2024-01-31');
    expect(result).toEqual(rows);
  });
});
