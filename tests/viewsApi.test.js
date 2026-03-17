import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeClienteIntel } from '../viewsApi.js';

// ──────────────────────────────────────────────────────
// normalizeClienteIntel
// ──────────────────────────────────────────────────────
describe('normalizeClienteIntel', () => {
  it('normalizes a full database row correctly', () => {
    const row = {
      cliente_id: 'abc-123',
      nome: '  Maria Silva  ',
      email: 'maria@exemplo.com',
      telefone: '11999990000',
      celular: '11988880000',
      doc: '123.456.789-00',
      cidade: 'São Paulo',
      uf: 'sp',
      canal_principal: 'Bling',
      status: 'ativo',
      segmento_crm: 'VIP',
      faixa_valor: 'alto',
      faixa_frequencia: 'frequente',
      pipeline_stage: 'cliente',
      total_pedidos: '15',
      total_gasto: '2500.50',
      ltv: '2500.50',
      ticket_medio: '166.70',
      dias_desde_ultima_compra: '30',
      score_recompra: '85',
      risco_churn: '10',
      last_interaction_at: '2024-01-15',
      last_interaction_type: 'whatsapp',
      last_interaction_desc: 'Contato realizado',
      last_contact_at: '2024-01-15',
      responsible_user: 'admin',
      score_final: '90',
      next_best_action: 'upsell',
      ultimo_pedido: '2024-01-10',
      primeiro_pedido: '2022-06-01',
    };

    const result = normalizeClienteIntel(row);

    expect(result.cliente_id).toBe('abc-123');
    expect(result.nome).toBe('Maria Silva');
    expect(result.email).toBe('maria@exemplo.com');
    expect(result.telefone).toBe('11999990000');
    expect(result.celular).toBe('11988880000');
    expect(result.doc).toBe('123.456.789-00');
    expect(result.cidade).toBe('São Paulo');
    expect(result.uf).toBe('SP'); // uppercased
    expect(result.canal_principal).toBe('bling'); // lowercased
    expect(result.status).toBe('ativo');
    expect(result.segmento_crm).toBe('VIP');
    expect(result.total_pedidos).toBe(15);
    expect(result.total_gasto).toBe(2500.5);
    expect(result.ltv).toBe(2500.5);
    expect(result.ticket_medio).toBe(166.7);
    expect(result.dias_desde_ultima_compra).toBe(30);
    expect(result.score_recompra).toBe(85);
    expect(result.risco_churn).toBe(10);
    expect(result.score_final).toBe(90);
    expect(result.next_best_action).toBe('upsell');
  });

  it('handles null/undefined row gracefully', () => {
    const result = normalizeClienteIntel(null);
    expect(result.cliente_id).toBe('');
    expect(result.nome).toBe('');
    expect(result.total_pedidos).toBe(0);
    expect(result.total_gasto).toBe(0);
    expect(result.dias_desde_ultima_compra).toBeNull();
    expect(result.canal_principal).toBe('outros'); // default
  });

  it('handles empty object', () => {
    const result = normalizeClienteIntel({});
    expect(result.cliente_id).toBe('');
    expect(result.canal_principal).toBe('outros');
    expect(result.uf).toBe('');
    expect(result.total_pedidos).toBe(0);
  });

  it('uses fallback keys when primary keys missing', () => {
    const row = {
      id: 'fallback-id',
      name: 'João',
      phone: '11000000000',
      mobile: '11111111111',
      ltv: 500,
      pedidos: 3,
    };
    const result = normalizeClienteIntel(row);
    expect(result.cliente_id).toBe('fallback-id');
    expect(result.nome).toBe('João');
    expect(result.telefone).toBe('11000000000');
    expect(result.celular).toBe('11111111111');
    expect(result.total_gasto).toBe(500);
    expect(result.total_pedidos).toBe(3);
  });

  it('sets dias_desde_ultima_compra to null when missing', () => {
    const result = normalizeClienteIntel({ nome: 'Teste' });
    expect(result.dias_desde_ultima_compra).toBeNull();
  });

  it('converts dias_desde_ultima_compra to number', () => {
    const result = normalizeClienteIntel({ dias_desde_ultima_compra: '45' });
    expect(result.dias_desde_ultima_compra).toBe(45);
  });

  it('forces canal_principal to lowercase', () => {
    const result = normalizeClienteIntel({ canal_principal: 'YAMPI' });
    expect(result.canal_principal).toBe('yampi');
  });

  it('forces uf to uppercase', () => {
    const result = normalizeClienteIntel({ uf: 'rj' });
    expect(result.uf).toBe('RJ');
  });

  it('defaults canal_principal to "outros" when empty', () => {
    const result = normalizeClienteIntel({ canal_principal: '' });
    expect(result.canal_principal).toBe('outros');
  });

  it('coerces non-finite numbers to 0', () => {
    const result = normalizeClienteIntel({
      total_gasto: 'abc',
      score_recompra: NaN,
      risco_churn: undefined,
    });
    expect(result.total_gasto).toBe(0);
    expect(result.score_recompra).toBe(0);
    expect(result.risco_churn).toBe(0);
  });
});
