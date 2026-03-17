(function () {
  var existing = window.APP_CONFIG && typeof window.APP_CONFIG === "object" ? window.APP_CONFIG : {};

  function readLS(key) {
    try {
      return String(localStorage.getItem(key) || "");
    } catch (_e) {
      return "";
    }
  }

  // Valores fixos do projeto (fallback se não houver no LocalStorage)
  var FIXED_URL = "";
  var FIXED_KEY = "";

  // SEGURANÇA: Prioriza APP_CONFIG (injetado) > LocalStorage > FIXED (fallback).
  var supabaseUrl = String(existing.supabaseUrl || "").trim() || readLS("crm_supa_url") || readLS("supabase_url") || FIXED_URL;

  var supabaseAnonKey = String(existing.supabaseAnonKey || "").trim() || readLS("crm_supa_key") || readLS("supabase_key") || FIXED_KEY;

  // SENTRY: preencha com o DSN do seu projeto em https://sentry.io
  var sentryDsn = String(existing.sentryDsn || "").trim() || readLS("crm_sentry_dsn") || "";

  window.APP_CONFIG = {
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
    sentryDsn: sentryDsn,
  };
})();
