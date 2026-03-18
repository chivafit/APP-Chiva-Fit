import { createClient } from '@supabase/supabase-js';

const clientsByConfig = new Map();

const DEFAULT_FETCH_TIMEOUT_MS = 20000;

function createTimeoutFetch(timeoutMs) {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_FETCH_TIMEOUT_MS;
  return async (input, init = {}) => {
    const baseFetch = globalThis.fetch;
    if (typeof baseFetch !== 'function') throw new Error('fetch não disponível neste ambiente.');

    const controller = new AbortController();
    const existingSignal = init && init.signal ? init.signal : null;
    if (existingSignal) {
      try {
        if (existingSignal.aborted) {
          controller.abort(existingSignal.reason);
        } else {
          existingSignal.addEventListener('abort', () => controller.abort(existingSignal.reason), {
            once: true,
          });
        }
      } catch (_e) {}
    }

    const timer = setTimeout(() => {
      try {
        controller.abort(new DOMException('Timeout', 'AbortError'));
      } catch (_e) {
        controller.abort();
      }
    }, ms);

    try {
      const nextInit = { ...(init || {}), signal: controller.signal };
      return await baseFetch(input, nextInit);
    } finally {
      clearTimeout(timer);
    }
  };
}

const timeoutFetch = createTimeoutFetch(DEFAULT_FETCH_TIMEOUT_MS);

/**
 * Singleton client instance based on environment variables
 */
const VITE_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const VITE_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (VITE_SUPABASE_URL && VITE_SUPABASE_ANON_KEY) 
  ? createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: timeoutFetch }
    })
  : null;

/**
 * Legacy support for dynamic client initialization (used in login/bootstrap)
 */
export function getSupabaseClient(projectUrl, anonKey) {
  const url = String(projectUrl || VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const key = String(anonKey || VITE_SUPABASE_ANON_KEY || '').trim();
  
  if (!url || !key) throw new Error('Supabase não configurado.');
  
  const cacheKey = url + '::' + key;
  if (clientsByConfig.has(cacheKey)) return clientsByConfig.get(cacheKey);
  
  const client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      fetch: timeoutFetch,
    },
  });
  
  clientsByConfig.set(cacheKey, client);
  return client;
}

export async function getSupabaseSession(projectUrl, anonKey) {
  const client = getSupabaseClient(projectUrl, anonKey);
  if (!client?.auth || typeof client.auth.getSession !== 'function') return null;
  try {
    const { data, error } = await client.auth.getSession();
    if (error) return null;
    return data?.session || null;
  } catch (_e) {
    return null;
  }
}

export async function signInWithEmailPassword(projectUrl, anonKey, email, password) {
  const client = getSupabaseClient(projectUrl, anonKey);
  if (!client?.auth || typeof client.auth.signInWithPassword !== 'function') {
    throw new Error('Supabase Auth não está disponível neste ambiente.');
  }
  const em = String(email || '')
    .trim()
    .toLowerCase();
  const pw = String(password || '');
  if (!em || !pw) throw new Error('Informe e-mail e senha.');
  const { data, error } = await client.auth.signInWithPassword({ email: em, password: pw });
  if (error || !data?.session)
    throw new Error(error?.message ? String(error.message) : 'Falha ao autenticar no Supabase.');
  return data.session;
}

export async function signOutSupabase(projectUrl, anonKey) {
  const client = getSupabaseClient(projectUrl, anonKey);
  if (!client?.auth || typeof client.auth.signOut !== 'function') return;
  try {
    await client.auth.signOut();
  } catch (_e) {}
}
