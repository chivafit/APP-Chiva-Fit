import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BlingTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const auth = req.headers.get("authorization") || "";
    if (!supabaseKey || auth !== `Bearer ${supabaseKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!supabaseUrl) {
      throw new Error("Missing SUPABASE_URL environment variable.");
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const clientId = Deno.env.get("BLING_CLIENT_ID");
    const clientSecret = Deno.env.get("BLING_CLIENT_SECRET");
    const envRefreshToken = Deno.env.get("BLING_REFRESH_TOKEN") || "";

    if (!clientId || !clientSecret) {
      throw new Error("Missing environment variables: BLING_CLIENT_ID or BLING_CLIENT_SECRET.");
    }

    const { data: configData, error: configError } = await supabase
      .from("configuracoes")
      .select("valor_texto")
      .eq("chave", "bling_refresh_token")
      .maybeSingle();

    if (configError) throw configError;
    
    const body = await req.json().catch(() => ({}));
    const bodyRefresh = String(body?.refresh_token || body?.refreshToken || "").trim();
    const currentRefreshToken = String(configData?.valor_texto || bodyRefresh || envRefreshToken || "").trim();

    if (!currentRefreshToken) {
      throw new Error("Missing refresh token (set BLING_REFRESH_TOKEN secret or store bling_refresh_token in configuracoes).");
    }

    const b64 = btoa(`${clientId}:${clientSecret}`);
    const url = "https://www.bling.com.br/Api/v3/oauth/token";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "enable-jwt": "1",
        "Authorization": `Basic ${b64}`,
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(currentRefreshToken)}`,
    });

    if (!response.ok) {
      throw new Error(`Erro API Bling: ${response.status} - Verifique se o Refresh Token ainda é válido.`);
    }

    const data = (await response.json()) as BlingTokenResponse;
    const access_token = String(data?.access_token || "").trim();
    const refresh_token = String(data?.refresh_token || "").trim();
    if (!access_token) throw new Error("Bling token response missing access_token.");

    const nextRefresh = refresh_token || currentRefreshToken;
    if (nextRefresh && nextRefresh !== currentRefreshToken) {
      await supabase.from("configuracoes").upsert([
        { chave: "bling_refresh_token", valor_texto: nextRefresh, updated_at: new Date().toISOString() },
      ]);
    }

    const safeResponse = {
      access_token,
      token_type: data?.token_type,
      expires_in: data?.expires_in,
      scope: data?.scope,
    };

    return new Response(JSON.stringify(safeResponse), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
