(function () {
  var existing = window.APP_CONFIG && typeof window.APP_CONFIG === "object" ? window.APP_CONFIG : {};

  function readLS(key) {
    try {
      return String(localStorage.getItem(key) || "");
    } catch (_e) {
      return "";
    }
  }

  var supabaseUrl =
    String(existing.supabaseUrl || "").trim() ||
    readLS("crm_supa_url") ||
    readLS("supa_url") ||
    readLS("supabase_url");

  var supabaseAnonKey =
    String(existing.supabaseAnonKey || "").trim() ||
    readLS("crm_supa_key") ||
    readLS("supa_key") ||
    readLS("supabase_key");

  window.APP_CONFIG = {
    supabaseUrl: supabaseUrl,
    supabaseAnonKey: supabaseAnonKey,
  };
})();
