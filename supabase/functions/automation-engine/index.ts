/**
 * Edge Function: automation-engine
 *
 * Motor de automação de recompra. Executa via cron a cada 15 min.
 * Também pode ser disparado manualmente via POST.
 *
 * Fluxo:
 *  1. Cria registro no automation_execution_log
 *  2. Expira itens vencidos da fila
 *  3. Para cada regra ativa:
 *     a. Chama fn_eligible_for_rule() — proteções aplicadas em SQL
 *     b. Insere na automation_queue (ON CONFLICT DO NOTHING = dedup)
 *  4. Despacha itens pendentes da fila (respeitando janela de horário + limite diário)
 *     → chama whatsapp-send Edge Function
 *     → cria automation_runs + whatsapp_messages
 *  5. Detecta conversões (fn_detect_conversions)
 *  6. Finaliza execution_log
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SEND_FUNCTION_URL  = `${SUPABASE_URL}/functions/v1/whatsapp-send`;

// Intervalo entre disparos (ms) — respeita rate limit da Z-API (~1 msg/s por conta)
const MSG_INTERVAL_MS = 1100;

// Máximo de mensagens por execução do motor (segurança)
const MAX_DISPATCH_PER_RUN = 200;

// ─── Entry point ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsOk();

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const startTime = Date.now();
  let execLogId: string | null = null;

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const triggeredBy: string = body.triggered_by || 'cron';
    const ruleFilter: string[] | null = body.rule_ids || null;

    // 1. Cria execution log
    const { data: execLog } = await supabase
      .from('automation_execution_log')
      .insert({ triggered_by: triggeredBy, status: 'running' })
      .select('id')
      .single();

    execLogId = execLog?.id || null;

    // 2. Expira itens vencidos
    const { data: expired } = await supabase.rpc('fn_expire_queue_items');
    const expiredCount = expired || 0;

    // 3. Carrega regras ativas
    let rulesQuery = supabase
      .from('automation_rules')
      .select(`
        *,
        whatsapp_accounts (id, nome, provider, status, zapi_instance_id, zapi_token, zapi_client_token),
        whatsapp_templates (id, template_name, preview_text, variaveis)
      `)
      .eq('ativo', true);

    if (ruleFilter?.length) {
      rulesQuery = rulesQuery.in('id', ruleFilter);
    }

    const { data: rules, error: rulesErr } = await rulesQuery;

    if (rulesErr) throw new Error(`Erro ao carregar regras: ${rulesErr.message}`);

    const activeRules = (rules || []).filter(
      r => r.whatsapp_accounts?.status === 'active'
    );

    let totalEnqueued = 0;
    let customersEvaluated = 0;
    const enqueueErrors: string[] = [];

    // 4. Para cada regra: avalia elegíveis e enfileira
    for (const rule of activeRules) {
      try {
        const { data: eligible, error: eligErr } = await supabase
          .rpc('fn_eligible_for_rule', { p_rule_id: rule.id, p_limit: 200 });

        if (eligErr) {
          enqueueErrors.push(`Regra ${rule.nome}: ${eligErr.message}`);
          continue;
        }

        if (!eligible || eligible.length === 0) continue;

        customersEvaluated += eligible.length;

        // Calcula scheduled_for: respeitando janela de horário da regra
        const scheduledFor = calcScheduledFor(rule);

        // Monta itens para inserção em batch
        const queueItems = (eligible as any[]).map(c => ({
          rule_id:              rule.id,
          cliente_id:           c.cliente_id || null,
          telefone:             normalizePhone(c.telefone),
          variaveis_resolvidas: buildVarsFromHint(rule.variaveis_mapa, c.variaveis_hint),
          trigger_data:         c.trigger_dados || {},
          status:               'pending',
          priority:             calcPriority(rule, c),
          scheduled_for:        scheduledFor,
          expires_at:           new Date(Date.now() + 48 * 3600000).toISOString(),
          max_attempts:         3,
        }));

        // INSERT com ON CONFLICT DO NOTHING (dedup via partial unique index)
        const { count } = await supabase
          .from('automation_queue')
          .insert(queueItems, { count: 'exact' })
          .select('id', { head: true });

        totalEnqueued += count ?? 0;

      } catch (e: any) {
        enqueueErrors.push(`Regra ${rule.nome}: ${e.message}`);
      }
    }

    // 5. Despacha fila pendente
    const dispatchResult = await processQueue(supabase, activeRules);

    // 6. Detecta conversões
    const { data: conversoes } = await supabase.rpc('fn_detect_conversions', {
      p_attribution_days: 7,
    });

    const duration = Date.now() - startTime;

    // 7. Finaliza execution log
    await supabase
      .from('automation_execution_log')
      .update({
        finished_at:          new Date().toISOString(),
        rules_evaluated:      activeRules.length,
        customers_evaluated:  customersEvaluated,
        newly_enqueued:       totalEnqueued,
        dispatched:           dispatchResult.dispatched,
        sent:                 dispatchResult.sent,
        failed:               dispatchResult.failed,
        skipped:              dispatchResult.skipped + expiredCount,
        conversions_detected: conversoes || 0,
        errors:               enqueueErrors,
        status:               enqueueErrors.length > 0 ? 'partial' : 'completed',
        duration_ms:          duration,
      })
      .eq('id', execLogId);

    return jsonResponse({
      ok: true,
      execution_id:  execLogId,
      rules_run:     activeRules.length,
      enqueued:      totalEnqueued,
      sent:          dispatchResult.sent,
      failed:        dispatchResult.failed,
      conversions:   conversoes || 0,
      duration_ms:   duration,
      errors:        enqueueErrors,
    });

  } catch (err: any) {
    console.error('[automation-engine] Fatal:', err);

    if (execLogId) {
      const supabase2 = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      await supabase2
        .from('automation_execution_log')
        .update({
          finished_at: new Date().toISOString(),
          status: 'failed',
          errors: [err.message],
          duration_ms: Date.now() - startTime,
        })
        .eq('id', execLogId);
    }

    return jsonResponse({ ok: false, error: err.message }, 500);
  }
});

// ─── Processamento da fila ────────────────────────────────────
async function processQueue(
  supabase: SupabaseClient,
  activeRules: any[]
): Promise<{ dispatched: number; sent: number; failed: number; skipped: number }> {

  const result = { dispatched: 0, sent: 0, failed: 0, skipped: 0 };

  // Busca itens pendentes (só os que deveriam ser enviados agora)
  const { data: items, error } = await supabase
    .from('automation_queue')
    .select(`
      *,
      automation_rules (
        id, nome, max_envios_dia, janela_horario_inicio, janela_horario_fim, dias_semana,
        account_id, template_id, variaveis_mapa,
        whatsapp_accounts (id, provider, status, zapi_instance_id, zapi_token, zapi_client_token),
        whatsapp_templates (id, template_name, preview_text)
      )
    `)
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .lt('attempts', 3)
    .gt('expires_at', new Date().toISOString())
    .order('priority', { ascending: false })
    .order('scheduled_for', { ascending: true })
    .limit(MAX_DISPATCH_PER_RUN);

  if (error || !items) return result;

  // Controla limite diário por regra
  const dailySentPerRule: Record<string, number> = {};
  for (const rule of activeRules) {
    if (!rule.max_envios_dia) continue;
    const { count } = await supabase
      .from('automation_queue')
      .select('id', { count: 'exact', head: true })
      .eq('rule_id', rule.id)
      .eq('status', 'sent')
      .gte('sent_at', new Date(new Date().setHours(0, 0, 0, 0)).toISOString());
    dailySentPerRule[rule.id] = count || 0;
  }

  // Despacha item por item
  for (const item of items) {
    const rule = item.automation_rules;
    if (!rule || !rule.whatsapp_accounts) {
      await skipItem(supabase, item.id, 'conta_nao_encontrada');
      result.skipped++;
      continue;
    }

    // Verifica janela de horário
    if (!isInSendWindow(rule)) {
      // Reagenda para o próximo início de janela
      await supabase
        .from('automation_queue')
        .update({ scheduled_for: nextWindowStart(rule) })
        .eq('id', item.id);
      result.skipped++;
      continue;
    }

    // Verifica limite diário
    const ruleId = item.rule_id;
    const maxDaily = rule.max_envios_dia || 9999;
    if ((dailySentPerRule[ruleId] || 0) >= maxDaily) {
      await skipItem(supabase, item.id, 'limite_diario_atingido');
      result.skipped++;
      continue;
    }

    // Verifica conta ativa
    if (rule.whatsapp_accounts.status !== 'active') {
      await skipItem(supabase, item.id, 'conta_inativa');
      result.skipped++;
      continue;
    }

    // Marca como processing (lock otimista)
    const { count: locked } = await supabase
      .from('automation_queue')
      .update({ status: 'processing', last_attempt_at: new Date().toISOString() })
      .eq('id', item.id)
      .eq('status', 'pending')   // garante idempotência
      .select('id', { count: 'exact', head: true });

    if (!locked) continue; // Outro worker pegou primeiro

    result.dispatched++;

    // Resolve texto da mensagem
    const messageText = resolveMessage(rule.whatsapp_templates, item.variaveis_resolvidas);

    // Chama whatsapp-send Edge Function
    const sendResult = await callSendFunction({
      account_id:  rule.account_id,
      telefone:    item.telefone,
      message:     messageText,
      template_id: rule.template_id || null,
      variaveis:   item.variaveis_resolvidas,
    });

    if (sendResult.ok) {
      result.sent++;
      dailySentPerRule[ruleId] = (dailySentPerRule[ruleId] || 0) + 1;

      // Atualiza fila
      await supabase
        .from('automation_queue')
        .update({ status: 'sent', wamid: sendResult.messageId, sent_at: new Date().toISOString() })
        .eq('id', item.id);

      // Cria automation_run
      const { data: run } = await supabase
        .from('automation_runs')
        .insert({
          rule_id:        ruleId,
          cliente_id:     item.cliente_id,
          trigger_evento: rule.trigger_tipo || item.trigger_data?.trigger || '',
          trigger_dados:  item.trigger_data,
          status:         'enviado',
          processado_em:  new Date().toISOString(),
        })
        .select('id')
        .single();

      // Vincula run ao item da fila
      if (run?.id) {
        await supabase
          .from('automation_queue')
          .update({ run_id: run.id })
          .eq('id', item.id);
      }

      // Registra no inbox unificado
      await supabase
        .from('whatsapp_messages')
        .insert({
          account_id:  rule.account_id,
          cliente_id:  item.cliente_id,
          wamid:       sendResult.messageId,
          direcao:     'outbound',
          tipo:        rule.template_id ? 'template' : 'text',
          conteudo: {
            text:        messageText,
            template:    rule.whatsapp_templates?.template_name,
            vars:        item.variaveis_resolvidas,
          },
          status:      'sent',
          telefone:    item.telefone,
          metadata: {
            via:        'automation',
            rule_id:    ruleId,
            queue_id:   item.id,
          },
        });

    } else {
      result.failed++;
      const newAttempts = (item.attempts || 0) + 1;
      const maxAttempts = item.max_attempts || 3;

      if (newAttempts >= maxAttempts) {
        // Esgotou tentativas
        await supabase
          .from('automation_queue')
          .update({
            status:       'failed',
            attempts:     newAttempts,
            error_detail: sendResult.error,
          })
          .eq('id', item.id);

        await supabase
          .from('automation_runs')
          .insert({
            rule_id:       ruleId,
            cliente_id:    item.cliente_id,
            trigger_evento: item.trigger_data?.trigger || '',
            trigger_dados:  item.trigger_data,
            status:         'erro',
            processado_em:  new Date().toISOString(),
            ignorado_motivo: sendResult.error,
          });
      } else {
        // Reagenda com backoff exponencial
        const backoffMs = Math.pow(2, newAttempts) * 60 * 1000;
        await supabase
          .from('automation_queue')
          .update({
            status:           'pending',
            attempts:         newAttempts,
            error_detail:     sendResult.error,
            scheduled_for:    new Date(Date.now() + backoffMs).toISOString(),
          })
          .eq('id', item.id);
      }
    }

    // Rate limit: pausa entre envios
    await sleep(MSG_INTERVAL_MS);
  }

  return result;
}

// ─── Chama a whatsapp-send Edge Function ─────────────────────
async function callSendFunction(payload: {
  account_id: string;
  telefone: string;
  message: string;
  template_id: string | null;
  variaveis: Record<string, string>;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const resp = await fetch(SEND_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await resp.json();

    if (!resp.ok || !json.ok) {
      return { ok: false, error: json.error || `HTTP ${resp.status}` };
    }

    return { ok: true, messageId: json.messageId };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function isInSendWindow(rule: any): boolean {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Dom, 1=Seg, ...
  const diasSemana: number[] = rule.dias_semana || [1, 2, 3, 4, 5];

  if (!diasSemana.includes(dayOfWeek)) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = (rule.janela_horario_inicio || '08:00').split(':').map(Number);
  const [eh, em] = (rule.janela_horario_fim   || '20:00').split(':').map(Number);

  return currentMinutes >= sh * 60 + sm && currentMinutes <= eh * 60 + em;
}

function nextWindowStart(rule: any): string {
  const now = new Date();
  const [sh, sm] = (rule.janela_horario_inicio || '08:00').split(':').map(Number);

  const next = new Date(now);
  next.setHours(sh, sm, 0, 0);

  // Se já passou do horário de hoje, agenda para amanhã
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  // Ajusta para o próximo dia permitido
  const diasSemana: number[] = rule.dias_semana || [1, 2, 3, 4, 5];
  let attempts = 0;
  while (!diasSemana.includes(next.getDay()) && attempts < 7) {
    next.setDate(next.getDate() + 1);
    attempts++;
  }

  return next.toISOString();
}

function calcScheduledFor(rule: any): string {
  const now = new Date();
  const delayMs = (rule.delay_minutos || 0) * 60 * 1000;
  const target = new Date(now.getTime() + delayMs);

  if (!isInSendWindow({ ...rule, delay_minutos: 0 })) {
    return nextWindowStart(rule);
  }

  return target.toISOString();
}

function calcPriority(rule: any, customer: any): number {
  // Prioridade 1-10: VIP em risco = 9, primeiro pedido = 8, demais = 5
  const action = customer.trigger_dados?.next_best_action || rule.trigger_tipo;
  if (action === 'tratamento_vip') return 9;
  if (rule.trigger_tipo === 'primeiro_pedido') return 8;
  if (rule.trigger_tipo === 'carrinho_abandonado') return 7;
  return 5;
}

function normalizePhone(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 10) return `55${digits}`;
  return digits;
}

function buildVarsFromHint(
  varMapa: Record<string, string> | null,
  hint: Record<string, any>
): Record<string, string> {
  if (!varMapa || !hint) return hint || {};

  const formatCurrency = (v: any) =>
    v != null ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '';

  const result: Record<string, string> = {};

  Object.entries(varMapa).forEach(([idx, field]) => {
    const val = hint[field];
    if (field === 'ticket_medio' || field === 'total_gasto') {
      result[idx] = formatCurrency(val);
    } else if (field === 'ultimo_pedido' && val) {
      result[idx] = new Date(val).toLocaleDateString('pt-BR');
    } else {
      result[idx] = val != null ? String(val) : '';
    }
  });

  return result;
}

function resolveMessage(template: any, vars: Record<string, string>): string {
  if (!template?.preview_text) return '';
  return Object.entries(vars || {}).reduce(
    (text, [idx, val]) => text.replace(new RegExp(`\\{\\{${idx}\\}\\}`, 'g'), val || ''),
    template.preview_text
  );
}

async function skipItem(supabase: SupabaseClient, itemId: string, reason: string) {
  await supabase
    .from('automation_queue')
    .update({ status: 'skipped', error_detail: reason })
    .eq('id', itemId);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function corsOk() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}
