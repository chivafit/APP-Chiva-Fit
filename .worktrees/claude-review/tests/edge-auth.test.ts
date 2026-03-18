import { describe, it, expect, vi } from 'vitest';

// Mock the Supabase dependency from esm.sh so the module can be imported
// in a Node/Vitest environment without network access.
vi.mock('https://esm.sh/@supabase/supabase-js@2.39.7', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  })),
}));

import { readBearerToken, normalizeEmail } from '../supabase/functions/_shared/auth.ts';

// ──────────────────────────────────────────────────────
// readBearerToken
// ──────────────────────────────────────────────────────
describe('readBearerToken', () => {
  const makeRequest = (authHeader: string) =>
    new Request('https://example.com', {
      headers: authHeader ? { authorization: authHeader } : {},
    });

  it('extracts token from valid Bearer header', () => {
    const req = makeRequest('Bearer my-jwt-token-abc123');
    expect(readBearerToken(req)).toBe('my-jwt-token-abc123');
  });

  it('handles case-insensitive Bearer prefix', () => {
    const req = makeRequest('bearer my-token');
    expect(readBearerToken(req)).toBe('my-token');
  });

  it('returns empty string when no Authorization header', () => {
    const req = makeRequest('');
    expect(readBearerToken(req)).toBe('');
  });

  it('returns empty string for non-Bearer auth type', () => {
    const req = makeRequest('Basic dXNlcjpwYXNz');
    expect(readBearerToken(req)).toBe('');
  });

  it('returns empty string for malformed header', () => {
    const req = makeRequest('Bearer');
    // "Bearer" without a space means no token after it
    expect(readBearerToken(req)).toBe('');
  });

  it('trims whitespace from token', () => {
    const req = makeRequest('Bearer   token-with-spaces   ');
    expect(readBearerToken(req)).toBe('token-with-spaces');
  });
});

// ──────────────────────────────────────────────────────
// normalizeEmail
// ──────────────────────────────────────────────────────
describe('normalizeEmail', () => {
  it('lowercases email', () => {
    expect(normalizeEmail('USER@EXAMPLE.COM')).toBe('user@example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('handles null', () => {
    expect(normalizeEmail(null)).toBe('');
  });

  it('handles undefined', () => {
    expect(normalizeEmail(undefined)).toBe('');
  });

  it('handles empty string', () => {
    expect(normalizeEmail('')).toBe('');
  });

  it('handles number input', () => {
    expect(normalizeEmail(123)).toBe('123');
  });

  it('normalizes mixed case with spaces', () => {
    expect(normalizeEmail('  Admin@ChivaFit.COM  ')).toBe('admin@chivafit.com');
  });
});
