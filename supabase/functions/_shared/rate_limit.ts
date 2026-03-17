/**
 * _shared/rate_limit.ts
 * Rate limiting simples por usuário por janela de tempo.
 * Usa a tabela `configuracoes` existente como backend de contagem.
 *
 * Limitação conhecida: não é 100% atômico (race condition aceito para
 * rate limiting de IA — não é transação financeira).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: string; // ISO timestamp da próxima janela
}

/**
 * Verifica e incrementa o contador de rate limiting para um usuário.
 *
 * @param supabaseUrl  URL do projeto Supabase
 * @param serviceRoleKey  Chave service_role
 * @param userEmail  E-mail do usuário autenticado
 * @param functionName  Nome da função (para namespace da chave)
 * @param maxPerHour  Máximo de chamadas por hora (padrão: 30)
 */
export async function checkRateLimit(
  supabaseUrl: string,
  serviceRoleKey: string,
  userEmail: string,
  functionName: string,
  maxPerHour = 30,
): Promise<RateLimitResult> {
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0); // arredonda para a hora atual
  const windowHour = windowStart.toISOString().slice(0, 13); // ex: "2026-03-17T14"

  const nextHour = new Date(windowStart.getTime() + 60 * 60 * 1000);
  const resetAt = nextHour.toISOString();

  const windowKey = `rl:${functionName}:${userEmail}:${windowHour}`;

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data } = await supabase
      .from("configuracoes")
      .select("valor_texto")
      .eq("chave", windowKey)
      .maybeSingle();

    const count = parseInt(String(data?.valor_texto ?? "0")) || 0;

    if (count >= maxPerHour) {
      return { allowed: false, remaining: 0, resetAt };
    }

    // Incrementa o contador
    await supabase.from("configuracoes").upsert(
      [{ chave: windowKey, valor_texto: String(count + 1), updated_at: new Date().toISOString() }],
      { onConflict: "chave" },
    );

    return { allowed: true, remaining: maxPerHour - count - 1, resetAt };
  } catch (_e) {
    // Falha aberta: se o rate limit não puder ser verificado, permite a requisição
    console.warn("[rate_limit] falha ao verificar rate limit:", (_e as any)?.message);
    return { allowed: true, remaining: maxPerHour, resetAt };
  }
}
