import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { refreshToken } = await req.json();
    const clientId = Deno.env.get("BLING_CLIENT_ID");
    const clientSecret = Deno.env.get("BLING_CLIENT_SECRET");

    if (!refreshToken || !clientId || !clientSecret) {
      throw new Error("Missing required environment variables or refresh token.");
    }

    const b64 = btoa(`${clientId}:${clientSecret}`);
    const url = "https://api.bling.com.br/Api/v3/oauth/token";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${b64}`,
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Bling API error: ${response.status} ${errorBody}`);
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
