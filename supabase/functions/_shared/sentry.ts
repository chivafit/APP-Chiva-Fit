declare const Deno: any;

/**
 * Minimal Sentry client for Deno Edge Functions.
 * Usa a HTTP Store API do Sentry — sem SDK necessário.
 * Configura via variável de ambiente SENTRY_DSN.
 */

function parseDsn(dsn: string): { endpoint: string; publicKey: string } | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\//, "").replace(/\/$/, "");
    const endpoint = `${url.protocol}//${url.host}/api/${projectId}/store/`;
    return { endpoint, publicKey };
  } catch (_e) {
    return null;
  }
}

function parseStack(stack: string): Array<{ filename: string; function: string; lineno: number; colno: number }> {
  const frames: Array<{ filename: string; function: string; lineno: number; colno: number }> = [];
  const lines = String(stack || "").split("\n");
  for (const line of lines.slice(1)) {
    const m = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);
    if (m) {
      frames.unshift({
        function: m[1] || "<anonymous>",
        filename: m[2] || "<unknown>",
        lineno: parseInt(m[3], 10) || 0,
        colno: parseInt(m[4], 10) || 0,
      });
    }
  }
  return frames;
}

export async function captureToSentry(
  error: Error | unknown,
  tags?: Record<string, string>,
  extra?: Record<string, unknown>,
): Promise<void> {
  const dsn = String(Deno.env.get("SENTRY_DSN") || "").trim();
  if (!dsn) return;

  const parsed = parseDsn(dsn);
  if (!parsed) return;

  const err = error instanceof Error ? error : new Error(String(error));

  try {
    await fetch(parsed.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": [
          "Sentry sentry_version=7",
          `sentry_key=${parsed.publicKey}`,
          "sentry_client=deno-edge/1.0",
        ].join(", "),
      },
      body: JSON.stringify({
        event_id: crypto.randomUUID().replace(/-/g, ""),
        platform: "javascript",
        level: "error",
        timestamp: new Date().toISOString(),
        server_name: "supabase-edge-function",
        release: "crm-chivafit@20260317",
        environment: Deno.env.get("ENVIRONMENT") || "production",
        exception: {
          values: [
            {
              type: err.name || "Error",
              value: err.message,
              stacktrace: err.stack ? { frames: parseStack(err.stack) } : undefined,
            },
          ],
        },
        tags: { runtime: "deno", ...tags },
        extra,
      }),
    });
  } catch (_e) {
    // Nunca deixar o Sentry quebrar a Edge Function
  }
}
