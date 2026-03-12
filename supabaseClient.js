const clientsByConfig = new Map();

export function getSupabaseClient(projectUrl, anonKey){
  const url = String(projectUrl || "").trim().replace(/\/+$/,"");
  const key = String(anonKey || "").trim();
  if(!url || !key) throw new Error("Supabase não configurado.");
  const cacheKey = url + "::" + key;
  if(clientsByConfig.has(cacheKey)) return clientsByConfig.get(cacheKey);
  const lib = globalThis.supabase;
  if(!lib || typeof lib.createClient !== "function") throw new Error("Supabase JS não carregado.");
  const client = lib.createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  clientsByConfig.set(cacheKey, client);
  return client;
}
