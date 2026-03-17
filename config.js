(function () {
  var existing = window.APP_CONFIG && typeof window.APP_CONFIG === "object" ? window.APP_CONFIG : {};

  function readLS(key) {
    try {
      return String(localStorage.getItem(key) || "");
    } catch (_e) {
      return "";
    }
  }

  function writeLS(key, value) {
    try {
      localStorage.setItem(key, String(value || ""));
    } catch (_e) {}
  }

  function readParam(name) {
    try {
      return String(new URLSearchParams(window.location.search).get(name) || "");
    } catch (_e) {
      return "";
    }
  }

  // Valores fixos do projeto — não precisam ser informados em Configurações
  var FIXED_URL = "https://nvbicjjtnobnnscmypeq.supabase.co";
  var FIXED_KEY = "sb_publishable_PEupIHnmmnChZMTEfJylcQ_T5I3tj-7";

  var paramUrl = readParam("supa_url") || readParam("supabase_url") || readParam("crm_supa_url");
  var paramKey = readParam("supa_key") || readParam("supabase_key") || readParam("crm_supa_key");
  if (paramUrl && !String(existing.supabaseUrl || "").trim()) {
    writeLS("crm_supa_url", paramUrl);
    existing.supabaseUrl = paramUrl;
  }
  if (paramKey && !String(existing.supabaseAnonKey || "").trim()) {
    writeLS("crm_supa_key", paramKey);
    existing.supabaseAnonKey = paramKey;
  }

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
