import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { getCorsHeaders } from '../_shared/utils.ts';

/**
 * Webhook da Yampi para CRM Chiva Fit.
 * Versão simples, com validação de assinatura HMAC.
 *
 * Lê eventos da Yampi e grava em "yampi_orders" no Supabase.
 */

declare const Deno: { env: { get(key: string): string | undefined } };

function base64FromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  const aa = String(a ?? '');
  const bb = String(b ?? '');
  if (aa.length !== bb.length) return false;
  let out = 0;
  for (let i = 0; i < aa.length; i++) out |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return out === 0;
}

async function yampiSignatureForPayload(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return base64FromBytes(new Uint8Array(sig));
}

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Only POST', { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY', {
      status: 500,
      headers: corsHeaders,
    });
  }

  const bodyText = await req.text();

  if (!bodyText || !bodyText.trim()) {
    return new Response('Empty body', { status: 400, headers: corsHeaders });
  }

  const yampiSecret = String(Deno.env.get('YAMPI_SECRET') || '').trim();
  if (!yampiSecret) {
    return new Response('Missing YAMPI_SECRET', { status: 500, headers: corsHeaders });
  }

  const receivedSig = String(
    req.headers.get('X-Yampi-Hmac-SHA256') || req.headers.get('x-yampi-hmac-sha256') || '',
  ).trim();
  if (!receivedSig) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  const expectedSig = await yampiSignatureForPayload(bodyText, yampiSecret);
  if (!timingSafeEqual(receivedSig, expectedSig)) {
    return new Response('Unauthorized', { status: 401, headers: corsHeaders });
  }

  let payloadRaw: unknown;
  try {
    payloadRaw = JSON.parse(bodyText);
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
  }

  if (!payloadRaw || typeof payloadRaw !== 'object') {
    return new Response('Invalid payload', { status: 400, headers: corsHeaders });
  }

  const payload = payloadRaw as Record<string, unknown>;
  const event = payload.event;
  const time = payload.time;
  const topic = payload.topic;
  const resource = (payload.resource && typeof payload.resource === 'object'
    ? payload.resource
    : null) as Record<string, unknown> | null;
  const finalEvent = event || topic;

  if (!finalEvent) {
    console.error("Payload missing 'event' or 'topic':", JSON.stringify(payload));
    return new Response(JSON.stringify({ error: 'Missing event', received: payload }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const isAbandonedCart =
    finalEvent === 'cart.abandoned' ||
    finalEvent === 'checkout.abandoned' ||
    finalEvent === 'abandoned_cart';

  const customer = (resource?.customer && typeof resource.customer === 'object'
    ? resource.customer
    : {}) as Record<string, unknown>;
  const shippingAddress = (resource?.shipping_address && typeof resource.shipping_address === 'object'
    ? resource.shipping_address
    : {}) as Record<string, unknown>;

  const order = {
    external_id: String(resource?.id ?? resource?.code ?? payload?.id ?? ''),
    canal: 'yampi',
    event: String(finalEvent),
    status: resource?.status ?? null,
    total: Number(resource?.total ?? resource?.total_price ?? 0),
    created_at: resource?.created_at ?? time ?? new Date().toISOString(),
    updated_at: resource?.updated_at ?? new Date().toISOString(),
    is_abandoned_cart: isAbandonedCart,
    customer_name: customer?.name ?? '',
    customer_email: customer?.email ?? '',
    customer_phone: customer?.phone ?? '',
    city: shippingAddress?.city ?? '',
    state: shippingAddress?.state ?? '',
    raw: resource ?? payload,
  };

  const table = 'yampi_orders';

  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=external_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([order]),
  });

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    console.error('Supabase upsert error:', err);
    return new Response('Supabase error', { status: 500, headers: corsHeaders });
  }

  return new Response('OK', { status: 200, headers: corsHeaders });
});
