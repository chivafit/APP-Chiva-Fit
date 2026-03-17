(function () {
  var existing = window.APP_CONFIG && typeof window.APP_CONFIG === "object" ? window.APP_CONFIG : {};

  function readLS(key) {
    try {
      return String(localStorage.getItem(key) || "");
    } catch (_e) {
      return "";
    }
  }

  // Valores fixos do projeto
  var FIXED_URL = "https://nvbicjjtnobnnscmypeq.supabase.co";
  var FIXED_KEY = "sb_publishable_PEupIHnmmnChZMTEfJylcQ_T5I3tj-7";

  // SEGURANÇA: parâmetros de URL foram removidos intencionalmente.
  // Sobrescrever config via ?supa_url= era vetor de phishing.

  var supabaseUrl =
    String(existing.supabaseUrl || "").trim() ||
    readLS("crm_supa_url") ||
    readLS("supa_url") ||
    readLS("supabase_url") ||
    FIXED_URL;

  var supabaseAnonKey =
    String(existing.supabaseAnonKey || "").trim() ||
    readLS("crm_supa_key") ||
    readLS("supa_key") ||
    readLS("supabase_key") ||
    FIXED_KEY;

  window.APP_CONFIG = {
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
  };
})();
