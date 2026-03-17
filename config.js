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

  // SEGURANÇA: URL e chave NÃO são lidas do localStorage nem de parâmetros de URL.
  // Ambos eram vetores de phishing (extensão maliciosa ou XSS poderia redirecionar
  // para um Supabase controlado pelo atacante). A única fonte confiável é window.APP_CONFIG
  // (injetado pelo servidor) ou as constantes fixas abaixo.

  var supabaseUrl = String(existing.supabaseUrl || "").trim() || FIXED_URL;

  var supabaseAnonKey = String(existing.supabaseAnonKey || "").trim() || FIXED_KEY;

  // SENTRY: preencha com o DSN do seu projeto em https://sentry.io
  var sentryDsn = String(existing.sentryDsn || "").trim() || readLS("crm_sentry_dsn") || "";

  window.APP_CONFIG = {
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
    sentryDsn: sentryDsn,
  };
})();
