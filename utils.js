export function escapeHTML(str){
  if(str === null || str === undefined) return "";
  const s = String(str);
  const map = {
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    "\"":"&quot;",
    "'":"&#39;",
    "`":"&#96;",
    "=":"&#61;",
    "/":"&#47;"
  };
  return s.replace(/[&<>"'`=\/]/g, ch => map[ch] || ch);
}

export function safeJsonParse(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(raw == null) return fallback;
    return JSON.parse(raw);
  }catch(_e){
    try{ localStorage.removeItem(key); }catch(_e2){}
    return fallback;
  }
}

export function escapeJsSingleQuote(str){
  return String(str||"")
    .replace(/\\/g,"\\\\")
    .replace(/'/g,"\\'")
    .replace(/\r/g,"\\r")
    .replace(/\n/g,"\\n")
    .replace(/\u2028/g,"\\u2028")
    .replace(/\u2029/g,"\\u2029");
}
