/**
 * _shared/auth.ts
 * Autenticação e autorização reutilizável para Edge Functions do CRM.
 * Centraliza requireUserAuth, allowlist e helpers de JWT.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

export interface AuthResult {
  ok: boolean;
  user?: any;
  email?: string;
  reason?: string;
}

let allowlistCache: { loadedAtMs: number; emails: Set<string> } | null = null;

export function readBearerToken(req: Request): string {
  const auth = String(req.headers.get("authorization") || "").trim();
  if (!auth) return "";
  const lower = auth.toLowerCase();
  if (!lower.startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

export function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

export async function getAllowlistEmails(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<Set<string>> {
  const ttlMs = 60_000;
  const now = Date.now();
  if (allowlistCache && now - allowlistCache.loadedAtMs < ttlMs) {
    return allowlistCache.emails;
  }

  const emails = new Set<string>();
  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from("configuracoes")
      .select("valor_texto")
      .eq("chave", "crm_access_users")
      .maybeSingle();
    if (!error) {
      const raw = String(data?.valor_texto || "").trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((u) => {
            const em = normalizeEmail((u as any)?.email);
            if (em) emails.add(em);
          });
        }
      }
    }
  } catch (_e) {
    // falha ao carregar allowlist — não bloqueia, mas loga
    console.warn("[auth] falha ao carregar crm_access_users:", (_e as any)?.message);
  }

  allowlistCache = { loadedAtMs: now, emails };
  return emails;
}

/**
 * Valida o JWT do usuário e verifica se o e-mail está na allowlist.
 * Se a allowlist estiver vazia, qualquer usuário autenticado é permitido.
 * NÃO há bypass de e-mail hardcoded — todo acesso passa pela allowlist.
 */
export async function requireUserAuth(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<AuthResult> {
  const jwt = readBearerToken(req);
  if (!jwt) return { ok: false, reason: "Missing bearer token" };

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase.auth.getUser(jwt);
    if (error || !data?.user) return { ok: false, reason: "Invalid JWT" };

    const email = normalizeEmail((data.user as any)?.email);
    if (!email) return { ok: false, reason: "Missing user email" };

    const allowlist = await getAllowlistEmails(supabaseUrl, serviceRoleKey);
    // allowlist vazia = todos os usuários autenticados são permitidos
    if (allowlist.size && !allowlist.has(email)) {
      return { ok: false, reason: "Email not allowed" };
    }

    return { ok: true, user: data.user, email };
  } catch (_e) {
    console.error("[auth] erro na verificação de auth:", (_e as any)?.message);
    return { ok: false, reason: "Auth check failed" };
  }
}
