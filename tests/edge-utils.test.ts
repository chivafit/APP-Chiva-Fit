import { describe, it, expect } from 'vitest';

// _shared/utils.ts has no external HTTP imports, import directly
import {
  safeJsonParse,
  jsonResponse,
  nowIso,
  firstTextFromAnthropic,
} from '../supabase/functions/_shared/utils.ts';

// ──────────────────────────────────────────────────────
// safeJsonParse (Edge Function version)
// ──────────────────────────────────────────────────────
describe('edge safeJsonParse', () => {
  it('parses valid JSON object', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses valid JSON array', () => {
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('returns empty object for empty string', () => {
    expect(safeJsonParse('')).toEqual({});
  });

  it('returns empty object for whitespace-only string', () => {
    expect(safeJsonParse('   ')).toEqual({});
  });

  it('returns null for invalid JSON', () => {
    expect(safeJsonParse('{not valid}')).toBeNull();
  });

  it('parses string values', () => {
    expect(safeJsonParse('"hello"')).toBe('hello');
  });
});

// ──────────────────────────────────────────────────────
// jsonResponse
// ──────────────────────────────────────────────────────
describe('jsonResponse', () => {
  it('returns a Response with default status 200', () => {
    const res = jsonResponse({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('returns correct status code when specified', () => {
    const res = jsonResponse({ error: 'not found' }, 404);
    expect(res.status).toBe(404);
  });

  it('includes custom CORS headers', () => {
    const req = new Request('https://example.com', { headers: { origin: 'https://example.com' } });
    const res = jsonResponse({ ok: true }, 200, req);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
  });

  it('serializes body as JSON', async () => {
    const body = { message: 'test', count: 42 };
    const res = jsonResponse(body);
    const parsed = await res.json();
    expect(parsed).toEqual(body);
  });

  it('handles null body', async () => {
    const res = jsonResponse(null);
    const parsed = await res.json();
    expect(parsed).toBeNull();
  });
});

// ──────────────────────────────────────────────────────
// nowIso
// ──────────────────────────────────────────────────────
describe('nowIso', () => {
  it('returns a valid ISO string', () => {
    const iso = nowIso();
    expect(() => new Date(iso)).not.toThrow();
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  it('returns a recent timestamp', () => {
    const before = Date.now();
    const iso = nowIso();
    const after = Date.now();
    const ts = new Date(iso).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ──────────────────────────────────────────────────────
// firstTextFromAnthropic
// ──────────────────────────────────────────────────────
describe('firstTextFromAnthropic', () => {
  it('extracts text from standard Claude response', () => {
    const response = {
      content: [
        { type: 'text', text: 'Hello from Claude' },
        { type: 'tool_use', id: 'tool1' },
      ],
    };
    expect(firstTextFromAnthropic(response)).toBe('Hello from Claude');
  });

  it('returns first text block when multiple exist', () => {
    const response = {
      content: [
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second' },
      ],
    };
    expect(firstTextFromAnthropic(response)).toBe('First');
  });

  it('falls back to top-level text property', () => {
    const response = { text: 'fallback text' };
    expect(firstTextFromAnthropic(response)).toBe('fallback text');
  });

  it('returns empty string when no text found', () => {
    expect(firstTextFromAnthropic({})).toBe('');
    expect(firstTextFromAnthropic(null)).toBe('');
    expect(firstTextFromAnthropic(undefined)).toBe('');
  });

  it('returns empty string when content has no text blocks', () => {
    const response = {
      content: [{ type: 'tool_use', id: 'tool1' }],
    };
    expect(firstTextFromAnthropic(response)).toBe('');
  });

  it('skips non-string text values', () => {
    const response = {
      content: [
        { type: 'text', text: 123 },
        { type: 'text', text: 'valid' },
      ],
    };
    expect(firstTextFromAnthropic(response)).toBe('valid');
  });
});
