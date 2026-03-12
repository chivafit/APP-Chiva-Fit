import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const clientId = Deno.env.get("BLING_CLIENT_ID");
    const clientSecret = Deno.env.get("BLING_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      throw new Error("Missing environment variables: BLING_CLIENT_ID or BLING_CLIENT_SECRET.");
    }

    // 1. Obter o Refresh Token ATUAL do banco de dados
    const { data: configData, error: configError } = await supabase
      .from("configuracoes")
      .select("valor_texto")
      .eq("chave", "bling_refresh_token")
      .maybeSingle();

    if (configError) throw configError;
    
    // Se não tiver no banco, tenta pegar do corpo da requisição (fallback para primeira configuração)
    let currentRefreshToken = configData?.valor_texto;
    if (!currentRefreshToken) {
      const body = await req.json().catch(() => ({}));
      currentRefreshToken = body.refreshToken;
    }

    if (!currentRefreshToken) {
      throw new Error("Nenhum Refresh Token encontrado no banco ou na requisição.");
    }

    // 2. Renovar com a API do Bling
    const b64 = btoa(`${clientId}:${clientSecret}`);
    const url = "https://api.bling.com.br/Api/v3/oauth/token";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${b64}`,
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(currentRefreshToken)}`,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Erro Bling:", errorBody);
      throw new Error(`Erro API Bling: ${response.status} - Verifique se o Refresh Token ainda é válido.`);
    }

    const data = await response.json();
    const { access_token, refresh_token } = data;

    // 3. Salvar os NOVOS tokens no banco de dados para a próxima vez
    await supabase.from("configuracoes").upsert([
      { chave: "bling_access_token", valor_texto: access_token, updated_at: new Date().toISOString() },
      { chave: "bling_refresh_token", valor_texto: refresh_token || currentRefreshToken, updated_at: new Date().toISOString() }
    ]);

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Renew error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
