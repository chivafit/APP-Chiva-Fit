import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

/**
 * Webhook da Yampi para CRM Chiva Fit.
 * Versão simples, ainda SEM validação de assinatura HMAC.
 *
 * Lê eventos da Yampi e grava em "yampi_orders" no Supabase.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Only POST", { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", {
      status: 500,
      headers: corsHeaders,
    });
  }

  const bodyText = await req.text();

  if (!bodyText || !bodyText.trim()) {
    return new Response("Empty body", { status: 400, headers: corsHeaders });
  }

  let payload: any;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  if (!payload || typeof payload !== "object") {
    return new Response("Invalid payload", { status: 400, headers: corsHeaders });
  }

  const { event, resource, time, topic } = payload;
  const finalEvent = event || topic;

  if (!finalEvent) {
    console.error("Payload missing 'event' or 'topic':", JSON.stringify(payload));
    return new Response(JSON.stringify({ error: "Missing event", received: payload }), { 
      status: 400, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }

  const isAbandonedCart =
    finalEvent === "cart.abandoned" ||
    finalEvent === "checkout.abandoned" ||
    finalEvent === "abandoned_cart";

  const order = {
    external_id: String(resource?.id ?? resource?.code ?? payload?.id ?? ""),
    canal: "yampi",
    event: String(finalEvent),
    status: resource?.status ?? null,
    total: Number(resource?.total ?? resource?.total_price ?? 0),
    created_at: resource?.created_at ?? time ?? new Date().toISOString(),
    updated_at: resource?.updated_at ?? new Date().toISOString(),
    is_abandoned_cart: isAbandonedCart,
    customer_name: resource?.customer?.name ?? "",
    customer_email: resource?.customer?.email ?? "",
    customer_phone: resource?.customer?.phone ?? "",
    city: resource?.shipping_address?.city ?? "",
    state: resource?.shipping_address?.state ?? "",
    raw: resource ?? payload,
  };

  const table = "yampi_orders";

  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([order]),
  });

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    console.error("Supabase upsert error:", err);
    return new Response("Supabase error", { status: 500, headers: corsHeaders });
  }

  return new Response("OK", { status: 200, headers: corsHeaders });
});
